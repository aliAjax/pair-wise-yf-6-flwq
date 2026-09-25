export const STATUSES = {
  all: "全部",
  todo: "待处理",
  doing: "处理中",
  done: "已完成"
};

export const PRIORITIES = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

export const BACKUP_APP = "zfl-14-home-repair";
export const BACKUP_VERSION = 1;

const STATUS_KEYS = Object.keys(STATUSES).filter((key) => key !== "all");
const PRIORITY_KEYS = Object.keys(PRIORITIES);
// 旧记录缺修改时间时补为时间起点，合并时任何带真实时间的记录都能覆盖它
const EMPTY_TIME = new Date(0).toISOString();

export function nowIso() {
  return new Date().toISOString();
}

function toTime(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
  }
  return null;
}

function toIso(value, fallback) {
  const time = toTime(value);
  return time === null ? fallback : new Date(time).toISOString();
}

// 旧记录缺编号时按内容算出稳定编号，重复导入同一份备份不会产生重复事项
function legacyIdFor(repair) {
  const basis = [repair.location, repair.title, repair.priority, repair.cost, repair.status, repair.photo, repair.note].join("|");
  let hash = 5381;
  for (let index = 0; index < basis.length; index += 1) {
    hash = ((hash << 5) + hash + basis.charCodeAt(index)) >>> 0;
  }
  return `legacy-${hash.toString(16)}`;
}

export function normalizeRepair(item) {
  const source = item && typeof item === "object" ? item : {};
  const repair = {
    location: typeof source.location === "string" ? source.location.trim() : "",
    title: typeof source.title === "string" ? source.title.trim() : "",
    priority: PRIORITY_KEYS.includes(source.priority) ? source.priority : "medium",
    cost: Number.isFinite(Number(source.cost)) && Number(source.cost) >= 0 ? Number(source.cost) : 0,
    status: STATUS_KEYS.includes(source.status) ? source.status : "todo",
    photo: typeof source.photo === "string" ? source.photo.trim() : "",
    note: typeof source.note === "string" ? source.note.trim() : ""
  };
  repair.id = typeof source.id === "string" && source.id.trim() ? source.id.trim() : legacyIdFor(repair);
  repair.updatedAt = toIso(source.updatedAt, EMPTY_TIME);
  return repair;
}

export function normalizeState(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const repairs = [];
  const seen = new Set();
  for (const item of Array.isArray(source.repairs) ? source.repairs : []) {
    const repair = normalizeRepair(item);
    if (seen.has(repair.id)) continue;
    seen.add(repair.id);
    repairs.push(repair);
  }

  const tombstones = new Map();
  for (const item of Array.isArray(source.deleted) ? source.deleted : []) {
    if (!item || typeof item.id !== "string" || !item.id.trim()) continue;
    const deletedAt = toIso(item.deletedAt, nowIso());
    const known = tombstones.get(item.id);
    if (!known || toTime(deletedAt) > toTime(known)) tombstones.set(item.id, deletedAt);
  }

  const alive = repairs.filter((repair) => {
    const deletedAt = tombstones.get(repair.id);
    return !deletedAt || toTime(deletedAt) < toTime(repair.updatedAt);
  });

  return {
    filter: typeof source.filter === "string" && STATUSES[source.filter] ? source.filter : "all",
    repairs: alive,
    deleted: [...tombstones.entries()].map(([id, deletedAt]) => ({ id, deletedAt }))
  };
}

export function buildBackup(state) {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: nowIso(),
    repairs: state.repairs,
    deleted: state.deleted
  };
}

// 整份校验：任何一条不合格就整体拒绝，调用方保证当前数据不被改动
export function validateBackup(raw) {
  try {
    const data = Array.isArray(raw) ? { repairs: raw } : raw;
    if (!data || typeof data !== "object") throw new Error("文件内容不是备份数据");
    if (data.version !== undefined && Number(data.version) > BACKUP_VERSION) {
      throw new Error("备份文件版本过新，请更新应用后再导入");
    }
    if (!Array.isArray(data.repairs)) throw new Error("缺少 repairs 事项列表");
    if (data.deleted !== undefined && !Array.isArray(data.deleted)) throw new Error("deleted 移除标记格式不对");
    return {
      ok: true,
      repairs: data.repairs.map((item, index) => strictRepair(item, index + 1)),
      deleted: (Array.isArray(data.deleted) ? data.deleted : []).map((item, index) => strictTombstone(item, index + 1))
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function strictRepair(item, order) {
  const label = `第 ${order} 条事项`;
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${label}格式不正确`);
  if (typeof item.location !== "string" || !item.location.trim()) throw new Error(`${label}缺少位置`);
  if (typeof item.title !== "string" || !item.title.trim()) throw new Error(`${label}缺少问题描述`);
  if (!PRIORITY_KEYS.includes(item.priority)) throw new Error(`${label}的优先级无效`);
  if (!STATUS_KEYS.includes(item.status)) throw new Error(`${label}的处理状态无效`);
  if (typeof item.cost !== "number" || !Number.isFinite(item.cost) || item.cost < 0) throw new Error(`${label}的预计费用无效`);
  if (item.photo !== undefined && typeof item.photo !== "string") throw new Error(`${label}的照片链接格式不对`);
  if (item.note !== undefined && typeof item.note !== "string") throw new Error(`${label}的备注格式不对`);
  if (item.id !== undefined && (typeof item.id !== "string" || !item.id.trim())) throw new Error(`${label}的编号格式不对`);
  if (item.updatedAt !== undefined && toTime(item.updatedAt) === null) throw new Error(`${label}的修改时间格式不对`);
  return normalizeRepair(item);
}

function strictTombstone(item, order) {
  const label = `第 ${order} 条移除标记`;
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${label}格式不正确`);
  if (typeof item.id !== "string" || !item.id.trim()) throw new Error(`${label}缺少编号`);
  if (item.deletedAt !== undefined && toTime(item.deletedAt) === null) throw new Error(`${label}的时间格式不对`);
  return { id: item.id.trim(), deletedAt: toIso(item.deletedAt, nowIso()) };
}

// 按编号合并：同编号取最后修改的一份；移除标记挡住旧备份里已删除的事项
export function mergeBackup(state, backup) {
  const tombstones = new Map(state.deleted.map((tomb) => [tomb.id, tomb.deletedAt]));
  const byId = new Map(state.repairs.map((repair) => [repair.id, repair]));
  const counts = { added: 0, updated: 0, removed: 0, skipped: 0 };
  const addedIds = [];

  for (const tomb of backup.deleted) {
    const known = tombstones.get(tomb.id);
    if (known && toTime(known) >= toTime(tomb.deletedAt)) continue;
    tombstones.set(tomb.id, tomb.deletedAt);
    const local = byId.get(tomb.id);
    if (local && toTime(local.updatedAt) <= toTime(tomb.deletedAt)) {
      byId.delete(tomb.id);
      counts.removed += 1;
    }
  }

  for (const incoming of backup.repairs) {
    const deletedAt = tombstones.get(incoming.id);
    if (deletedAt && toTime(deletedAt) >= toTime(incoming.updatedAt)) {
      counts.skipped += 1;
      continue;
    }
    const local = byId.get(incoming.id);
    if (!local) {
      byId.set(incoming.id, incoming);
      addedIds.push(incoming.id);
      counts.added += 1;
    } else if (toTime(incoming.updatedAt) > toTime(local.updatedAt)) {
      byId.set(incoming.id, incoming);
      counts.updated += 1;
    } else {
      counts.skipped += 1;
    }
  }

  const kept = state.repairs.filter((repair) => byId.has(repair.id)).map((repair) => byId.get(repair.id));
  const repairs = [...addedIds.map((id) => byId.get(id)), ...kept];
  const deleted = [...tombstones.entries()].map(([id, deletedAt]) => ({ id, deletedAt }));
  return { repairs, deleted, counts };
}
