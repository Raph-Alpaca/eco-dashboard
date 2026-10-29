/**
 * state.js — 화면 상태 저장(localStorage). 필터·패널 구성·보고서 담기.
 * 실패해도(사생활 보호 모드 등) 동작은 계속되도록 모든 접근을 try/catch 로 감싼다.
 */
const PREFIX = "eco-dashboard:v1:";

function read(key, def) {
  try { const s = localStorage.getItem(PREFIX + key); return s ? JSON.parse(s) : def; } catch { return def; }
}
function write(key, val) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); } catch { /* 저장 불가 환경 */ }
}
function remove(key) { try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ } }

export const store = { read, write, remove };

/** 모집단별 필터 {axis: [codes]} */
export const filterState = {
  get(pop) { return read(`filters:${pop}`, {}); },
  set(pop, filters) { write(`filters:${pop}`, filters); },
  clear(pop) { remove(`filters:${pop}`); },
};

/** 탭별 패널 구성(기본 구성 대비 사용자가 바꾼 것만 저장) */
export const layoutState = {
  get(tabId) { return read(`layout:${tabId}`, null); },
  set(tabId, panels) { write(`layout:${tabId}`, panels); },
  reset(tabId) { remove(`layout:${tabId}`); },
};

/** 보고서 담기 */
export const reportState = {
  items() { return read("report:items", []); },
  meta() { return read("report:meta", { title: "환경교육 조사 결과 요약", subtitle: "", author: "", date: new Date().toISOString().slice(0, 10) }); },
  setMeta(m) { write("report:meta", m); },
  has(id) { return this.items().some(it => it.id === id); },
  add(item) {
    const items = this.items();
    if (items.some(it => it.id === item.id)) return false;
    items.push({ ...item, memo: "" });
    write("report:items", items);
    notify();
    return true;
  },
  remove(id) { write("report:items", this.items().filter(it => it.id !== id)); notify(); },
  update(id, patch) { write("report:items", this.items().map(it => (it.id === id ? { ...it, ...patch } : it))); notify(); },
  move(id, dir) {
    const items = this.items();
    const i = items.findIndex(it => it.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    write("report:items", items);
    notify();
  },
  clear() { remove("report:items"); notify(); },
};

const listeners = new Set();
export function onReportChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { for (const fn of listeners) fn(reportState.items()); }

/** 패널 구성 → 안정적인 id (같은 구성은 같은 id) */
export function panelId(cfg) {
  const parts = [cfg.survey, cfg.pop, cfg.key, (cfg.by || []).join("+"), cfg.measure || "", cfg.chart || "", cfg.cat ?? ""];
  return "p_" + parts.join("|").replace(/[^\w|+:-]/g, "_");
}

let toastEl;
export function toast(msg) {
  if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2200);
}
