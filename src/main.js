import "./styles.css";
import { buildBackup, validateBackup, mergeBackup } from "./backup.js";

const STORAGE_KEY = "zfl-14-repairs";
const statuses = {
  all: "全部",
  todo: "待处理",
  doing: "处理中",
  done: "已完成"
};

const priorities = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

let state = loadState();
let backupMessage = null;
const app = document.querySelector("#app");

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      let migrated = false;
      const repairs = (Array.isArray(parsed.repairs) ? parsed.repairs : []).map((repair) => {
        // 旧数据没有编号或修改时间时自动补齐
        const next = { ...repair };
        if (!next.id) {
          next.id = crypto.randomUUID();
          migrated = true;
        }
        if (!next.updatedAt) {
          next.updatedAt = new Date().toISOString();
          migrated = true;
        }
        return next;
      });
      const next = {
        filter: statuses[parsed.filter] ? parsed.filter : "all",
        repairs,
        tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : []
      };
      if (migrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    } catch {
      // 本地数据损坏时回退到初始数据
    }
  }
  return {
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
        updatedAt: new Date().toISOString()
      }
    ],
    tombstones: []
  };
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

      <section class="backup panel">
        <div class="backup-info">
          <h2>备份与接续</h2>
          <p>导出 JSON 备份拷到另一台设备导入；导入前整份校验，按编号合并，同一编号取最后修改。</p>
        </div>
        <div class="backup-actions">
          <button class="ghost" id="export-btn" type="button">导出备份</button>
          <label class="ghost import-btn">导入备份<input id="import-input" type="file" accept="application/json,.json" hidden></label>
        </div>
        ${backupMessage ? `<p class="backup-message ${backupMessage.type}">${escapeHtml(backupMessage.text)}</p>` : ""}
      </section>

      <section class="layout">
        <aside class="panel">
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
      updatedAt: new Date().toISOString()
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
      repair.updatedAt = new Date().toISOString();
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.delete;
      state.repairs = state.repairs.filter((repair) => repair.id !== id);
      // 留下移除标记，旧备份导入时不能把已删事项带回来
      state.tombstones = state.tombstones.filter((tomb) => tomb.id !== id);
      state.tombstones.push({ id, deletedAt: new Date().toISOString() });
      saveState();
      render();
    });
  });

  document.querySelector("#export-btn").addEventListener("click", () => {
    const payload = buildBackup(state);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `维修备份-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}.json`;
    link.click();
    URL.revokeObjectURL(url);
    backupMessage = { type: "success", text: `已导出 ${state.repairs.length} 条事项，把文件拷到另一台设备导入即可。` };
    render();
  });

  const importInput = document.querySelector("#import-input");
  importInput.addEventListener("change", () => {
    const file = importInput.files[0];
    importInput.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      handleImport(reader.result);
    });
    reader.addEventListener("error", () => {
      backupMessage = { type: "error", text: "导入已取消：文件读取失败，当前数据未改动。" };
      render();
    });
    reader.readAsText(file);
  });
}

function handleImport(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    backupMessage = { type: "error", text: "导入已取消：文件不是有效的 JSON，当前数据未改动。" };
    render();
    return;
  }
  const result = validateBackup(raw);
  if (!result.ok) {
    backupMessage = { type: "error", text: `导入已取消：${result.error}，当前数据未改动。` };
    render();
    return;
  }
  const merged = mergeBackup(state, result);
  state.repairs = merged.repairs;
  state.tombstones = merged.tombstones;
  saveState();
  const { added, updated, removed, skipped } = merged.summary;
  backupMessage = { type: "success", text: `导入完成：新增 ${added} · 更新 ${updated} · 移除 ${removed} · 跳过 ${skipped}` };
  render();
}

function filteredRepairs() {
  if (state.filter === "all") return state.repairs;
  return state.repairs.filter((repair) => repair.status === state.filter);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

render();
