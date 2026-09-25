import "./styles.css";
import {
  STATUSES,
  PRIORITIES,
  buildBackup,
  mergeBackup,
  normalizeState,
  nowIso,
  validateBackup
} from "./backup.js";

const STORAGE_KEY = "zfl-14-repairs";
const statuses = STATUSES;
const priorities = PRIORITIES;

let state = loadState();
let backupMessage = null;
const app = document.querySelector("#app");

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return normalizeState(JSON.parse(saved));
    } catch {
      // 本地数据损坏时回退到默认示例
    }
  }
  return normalizeState({
    filter: "all",
    repairs: [
      {
        id: crypto.randomUUID(),
        location: "厨房",
        title: "水槽下方渗水",
        priority: "high",
        cost: 260,
        status: "todo",
        photo: "",
        note: "先检查软管接口",
        updatedAt: nowIso()
      }
    ],
    deleted: []
  });
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  const repairs = filteredRepairs();
  const unfinished = state.repairs.filter((repair) => repair.status !== "done");
  const totalCost = unfinished.reduce((total, repair) => total + Number(repair.cost || 0), 0);
  const doing = state.repairs.filter((repair) => repair.status === "doing").length;

  app.innerHTML = `
    <main class="shell">
      <header class="header">
        <div>
          <p class="eyebrow">本地家庭维护台</p>
          <h1>家庭维修事项</h1>
        </div>
        <section class="stats">
          <div class="stat"><span>未完成</span><strong>${unfinished.length}</strong></div>
          <div class="stat"><span>处理中</span><strong>${doing}</strong></div>
          <div class="stat"><span>预计费用</span><strong>¥${totalCost}</strong></div>
        </section>
      </header>

      <section class="layout">
        <aside class="side">
          <section class="panel">
            <h2>新增维修事项</h2>
            <form class="form" id="repair-form">
              <label>位置<input name="location" required placeholder="例如卫生间"></label>
              <label>问题描述<textarea name="title" required placeholder="例如门锁松动"></textarea></label>
              <label>优先级<select name="priority">${renderPriorityOptions("medium")}</select></label>
              <label>预计费用<input name="cost" type="number" min="0" step="1" value="0"></label>
              <label>处理状态<select name="status">${renderStatusOptions("todo")}</select></label>
              <label>照片链接<input name="photo" type="url" placeholder="可选，粘贴图片地址"></label>
              <label>备注<textarea name="note" placeholder="师傅电话、材料或注意事项"></textarea></label>
              <button class="primary" type="submit">保存事项</button>
            </form>
          </section>

          <section class="panel">
            <h2>备份与恢复</h2>
            <p class="hint">数据只保存在本机浏览器。换设备时先导出备份文件，再在另一台设备导入，两边按事项编号自动合并。</p>
            <div class="backup-actions">
              <button class="ghost" id="export-backup" type="button">导出备份</button>
              <button class="ghost" id="import-backup" type="button">导入备份</button>
              <input id="import-file" type="file" accept="application/json,.json" hidden>
            </div>
            ${backupMessage ? `<p class="backup-msg ${backupMessage.type}">${escapeHtml(backupMessage.text)}</p>` : ""}
          </section>
        </aside>

        <section>
          <div class="toolbar">
            ${Object.entries(statuses).map(([value, label]) => `<button class="seg ${state.filter === value ? "active" : ""}" data-filter="${value}">${label}</button>`).join("")}
          </div>
          <div class="repairs">
            ${repairs.length ? repairs.map(renderRepair).join("") : `<div class="empty">当前状态下没有维修事项</div>`}
          </div>
        </section>
      </section>
    </main>
  `;

  bindEvents();
}

function renderRepair(repair) {
  return `
    <article class="repair">
      <div class="photo">${repair.photo ? `<img src="${escapeHtml(repair.photo)}" alt="${escapeHtml(repair.location)}维修照片">` : "未添加照片"}</div>
      <div class="content">
        <div class="row">
          <h3>${escapeHtml(repair.location)}</h3>
          <span class="priority ${repair.priority}">${priorities[repair.priority]}</span>
          <span class="status ${repair.status}">${statuses[repair.status]}</span>
        </div>
        <p>${escapeHtml(repair.title)}</p>
        <div class="row">
          <span class="chip">预计 ¥${Number(repair.cost || 0)}</span>
          <span class="chip">${escapeHtml(repair.note || "暂无备注")}</span>
        </div>
        <div class="actions">
          <select data-status="${repair.id}">${renderStatusOptions(repair.status)}</select>
          <button class="ghost" data-delete="${repair.id}">删除</button>
        </div>
      </div>
    </article>
  `;
}

function renderStatusOptions(selected) {
  return Object.entries(statuses)
    .filter(([value]) => value !== "all")
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function renderPriorityOptions(selected) {
  return Object.entries(priorities)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function bindEvents() {
  document.querySelector("#repair-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    state.repairs.unshift({
      id: crypto.randomUUID(),
      location: data.location.trim(),
      title: data.title.trim(),
      priority: data.priority,
      cost: Number(data.cost || 0),
      status: data.status,
      photo: data.photo.trim(),
      note: data.note.trim(),
      updatedAt: nowIso()
    });
    saveState();
    render();
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-status]").forEach((select) => {
    select.addEventListener("change", () => {
      const repair = state.repairs.find((item) => item.id === select.dataset.status);
      repair.status = select.value;
      repair.updatedAt = nowIso();
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.delete;
      state.repairs = state.repairs.filter((repair) => repair.id !== id);
      // 留下移除标记，旧备份导入时不会把已删除的事项带回来
      state.deleted = [...state.deleted.filter((tomb) => tomb.id !== id), { id, deletedAt: nowIso() }];
      saveState();
      render();
    });
  });

  document.querySelector("#export-backup").addEventListener("click", exportBackup);
  document.querySelector("#import-backup").addEventListener("click", () => document.querySelector("#import-file").click());
  document.querySelector("#import-file").addEventListener("change", importBackup);
}

function exportBackup() {
  const payload = buildBackup(state);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `维修备份-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  backupMessage = { type: "ok", text: `已导出 ${state.repairs.length} 条事项、${state.deleted.length} 条移除标记` };
  render();
}

function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let parsed = null;
    try {
      parsed = JSON.parse(reader.result);
    } catch {
      backupMessage = { type: "error", text: "导入失败：文件不是有效的 JSON，当前事项保持原样" };
      render();
      return;
    }
    const check = validateBackup(parsed);
    if (!check.ok) {
      backupMessage = { type: "error", text: `导入失败：${check.error}，当前事项保持原样` };
      render();
      return;
    }
    const merged = mergeBackup(state, check);
    state.repairs = merged.repairs;
    state.deleted = merged.deleted;
    saveState();
    const { added, updated, removed, skipped } = merged.counts;
    backupMessage = { type: "ok", text: `导入完成：新增 ${added}、更新 ${updated}、移除 ${removed}、跳过 ${skipped}` };
    render();
  };
  reader.readAsText(file);
}

function filteredRepairs() {
  if (state.filter === "all") return state.repairs;
  return state.repairs.filter((repair) => repair.status === state.filter);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

saveState();
render();
