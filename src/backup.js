export const BACKUP_APP = "zfl-14-home-repair";
export const BACKUP_VERSION = 1;

const PRIORITIES = ["high", "medium", "low"];
const STATUSES = ["todo", "doing", "done"];

export function buildBackup(state) {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    repairs: state.repairs,
    tombstones: state.tombstones
  };
}

// 整份校验：任何一条缺字段或格式不对就整体拒绝，调用方保持当前数据不变。
// 旧记录缺编号或修改时间不算错误，导入时自动补齐。
export function validateBackup(raw) {
  try {
    return { ok: true, ...parseBackup(raw) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function parseBackup(raw) {
  if (!isPlainObject(raw)) throw new Error("备份内容不是 JSON 对象");
  if (raw.version !== undefined) {
    if (!Number.isInteger(raw.version) || raw.version < 1) throw new Error("备份版本号格式不对");
    if (raw.version > BACKUP_VERSION) throw new Error(`备份版本（v${raw.version}）比当前应用新，请升级后再导入`);
  }
  let exportedAtTime = null;
  if (raw.exportedAt !== undefined) {
    exportedAtTime = parseTime(raw.exportedAt);
    if (exportedAtTime === null) throw new Error("导出时间 exportedAt 格式不对");
  }
  if (!Array.isArray(raw.repairs)) throw new Error("备份缺少 repairs 事项列表");
  if (raw.tombstones !== undefined && !Array.isArray(raw.tombstones)) throw new Error("tombstones 移除标记格式不对");

  // 旧记录缺修改时间时，以文件导出时间补齐；文件也没有就用当前时间
  const fallbackTime = exportedAtTime ?? Date.now();
  const repairs = raw.repairs.map((item, index) => normalizeRepair(item, index, fallbackTime));
  const tombstones = (raw.tombstones || []).map(normalizeTombstone);
  return { repairs, tombstones };
}

function normalizeRepair(item, index, fallbackTime) {
  const where = `第 ${index + 1} 条事项`;
  if (!isPlainObject(item)) throw new Error(`${where}不是对象`);
  const repair = { ...item };
  if (typeof repair.location !== "string" || !repair.location.trim()) throw new Error(`${where}缺少位置`);
  if (typeof repair.title !== "string" || !repair.title.trim()) throw new Error(`${where}缺少问题描述`);
  if (!PRIORITIES.includes(repair.priority)) throw new Error(`${where}优先级格式不对`);
  if (!STATUSES.includes(repair.status)) throw new Error(`${where}处理状态格式不对`);
  if (typeof repair.cost !== "number" || !Number.isFinite(repair.cost) || repair.cost < 0) {
    throw new Error(`${where}预计费用格式不对`);
  }
  if (typeof repair.photo !== "string") throw new Error(`${where}照片链接格式不对`);
  if (typeof repair.note !== "string") throw new Error(`${where}备注格式不对`);
  if (repair.id === undefined || repair.id === null || repair.id === "") {
    repair.id = crypto.randomUUID();
  } else if (typeof repair.id !== "string") {
    throw new Error(`${where}编号格式不对`);
  }
  if (repair.updatedAt === undefined || repair.updatedAt === null) {
    repair.updatedAt = new Date(fallbackTime).toISOString();
  } else if (parseTime(repair.updatedAt) === null) {
    throw new Error(`${where}修改时间格式不对`);
  }
  return repair;
}

function normalizeTombstone(item, index) {
  const where = `第 ${index + 1} 条移除标记`;
  if (!isPlainObject(item)) throw new Error(`${where}不是对象`);
  if (typeof item.id !== "string" || !item.id) throw new Error(`${where}缺少编号`);
  if (parseTime(item.deletedAt) === null) throw new Error(`${where}移除时间格式不对`);
  return { id: item.id, deletedAt: item.deletedAt };
}

// 按编号合并：同一编号取最后修改的一份；移除标记挡住不比它新的事项，旧备份无法带回已删事项。
export function mergeBackup(state, backup) {
  const repairs = new Map(state.repairs.map((repair) => [repair.id, repair]));
  const tombstones = new Map(state.tombstones.map((tomb) => [tomb.id, tomb]));
  const summary = { added: 0, updated: 0, removed: 0, skipped: 0 };

  // 备份内部先去重：同号留最新；事项与移除标记冲突时，时间新的一方生效
  const incoming = newestById(backup.repairs, "updatedAt");
  const incomingTombs = newestById(backup.tombstones, "deletedAt");
  for (const [id, tomb] of incomingTombs) {
    const live = incoming.get(id);
    if (live && timeOf(live.updatedAt) >= timeOf(tomb.deletedAt)) {
      incomingTombs.delete(id);
    } else {
      incoming.delete(id);
    }
  }

  for (const [id, item] of incoming) {
    const tomb = tombstones.get(id);
    if (tomb && timeOf(tomb.deletedAt) >= timeOf(item.updatedAt)) {
      summary.skipped += 1;
      continue;
    }
    if (tomb) tombstones.delete(id);
    const local = repairs.get(id);
    if (!local) {
      repairs.set(id, item);
      summary.added += 1;
    } else if (timeOf(item.updatedAt) > timeOf(local.updatedAt)) {
      repairs.set(id, item);
      summary.updated += 1;
    } else {
      summary.skipped += 1;
    }
  }

  for (const [id, tomb] of incomingTombs) {
    const localTomb = tombstones.get(id);
    if (localTomb) {
      if (timeOf(tomb.deletedAt) > timeOf(localTomb.deletedAt)) tombstones.set(id, tomb);
      summary.skipped += 1;
      continue;
    }
    const local = repairs.get(id);
    if (!local) {
      tombstones.set(id, tomb);
      summary.skipped += 1;
      continue;
    }
    if (timeOf(tomb.deletedAt) > timeOf(local.updatedAt)) {
      repairs.delete(id);
      tombstones.set(id, tomb);
      summary.removed += 1;
    } else {
      summary.skipped += 1;
    }
  }

  return { repairs: [...repairs.values()], tombstones: [...tombstones.values()], summary };
}

function newestById(list, field) {
  const map = new Map();
  for (const item of list) {
    const existing = map.get(item.id);
    if (!existing || timeOf(item[field]) > timeOf(existing[field])) map.set(item.id, item);
  }
  return map;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseTime(value) {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function timeOf(value) {
  return parseTime(value) ?? 0;
}
