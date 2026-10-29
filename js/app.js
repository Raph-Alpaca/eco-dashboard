/**
 * app.js — 진입점. 해시 라우팅(#overview, #school/student, #status/inst_school, #analysis, #report, #about),
 * 필터 막대, 패널 그리드 관리, 데이터 로딩을 담당한다.
 */
import { loadCodebook, loadCube, config } from "./data.js";
import { filterState, layoutState, reportState, onReportChange, toast } from "./state.js";
import { createPanel } from "./panel.js";
import { DEFAULT_LAYOUTS } from "./layouts.js";
import { resizeAll } from "./charts.js";
import * as overview from "./tabs/overview.js";
import * as survey1 from "./tabs/survey1.js";
import * as survey2 from "./tabs/survey2.js";
import * as analysis from "./tabs/analysis.js";
import * as report from "./tabs/report.js";
import * as about from "./tabs/about.js";

const TABS = [
  { id: "overview", label: "개요", mod: overview },
  { id: "school", label: "학교환경교육 현황조사", mod: survey1 },
  { id: "status", label: "환경교육 실태조사", mod: survey2 },
  { id: "analysis", label: "분석", mod: analysis },
  { id: "report", label: "보고서", mod: report },
  { id: "about", label: "데이터 안내", mod: about },
];

export const app = {
  config,
  codebooks: {},
  cubes: {},
  activePanels: [],
  current: null,

  async ensureSurvey(surveyId) {
    if (!this.codebooks[surveyId]) this.codebooks[surveyId] = await loadCodebook(surveyId);
    return this.codebooks[surveyId];
  },
  async ensureCube(surveyId, pop) {
    if (!this.cubes[pop]) this.cubes[pop] = await loadCube(surveyId, pop);
    return this.cubes[pop];
  },
  async ensureCubes(surveyId, pops) {
    await this.ensureSurvey(surveyId);
    await Promise.all(pops.map(p => this.ensureCube(surveyId, p)));
  },
  surveyOfPop(pop) {
    for (const [sid, cb] of Object.entries(this.codebooks)) if (cb.populations[pop]) return sid;
    return pop.startsWith("inst_") ? "status_survey" : "school_survey";
  },

  /** Panel 컨텍스트 */
  ctx(surveyId, extra = {}) {
    const sup = this.config.suppression || {};
    return {
      cubeOf: pop => this.cubes[pop],
      codebook: id => this.codebooks[id || surveyId],
      filtersOf: pop => filterState.get(pop),
      suppression: { minN: sup.person?.minN ?? 30, unstableN: sup.weighted?.unstableN ?? 10 },
      synthetic: !!this.config.synthetic,
      allowRemove: true,
      ...extra,
    };
  },

  /** 패널 그리드 */
  async mountPanels(container, tabId, surveyId, options = {}) {
    const defaults = DEFAULT_LAYOUTS[tabId] || [];
    const saved = layoutState.get(tabId);
    const cfgs = (saved && saved.length ? saved : defaults).map((c, i) => ({ ...c, _i: i }));
    const pops = [...new Set(cfgs.map(c => c.pop))];
    await this.ensureCubes(surveyId, pops);
    const grid = document.createElement("div");
    grid.className = "grid";
    container.appendChild(grid);
    const panels = [];
    const persist = () => layoutState.set(tabId, panels.map(p => stripCfg(p.cfg)));
    const ctx = this.ctx(surveyId, {
      onChange: async (panel, cfg) => { await this.ensureCube(surveyId, cfg.pop); persist(); },
      onRemove: panel => { panels.splice(panels.indexOf(panel), 1); panel.destroy(); persist(); if (!panels.length) container.querySelector(".grid-empty")?.removeAttribute("hidden"); },
      ...options.ctx,
    });
    for (const cfg of cfgs) {
      const p = createPanel(cfg, ctx);
      panels.push(p);
      grid.appendChild(p.el);
      p.update();
    }
    this.activePanels.push(...panels);
    const empty = document.createElement("p");
    empty.className = "grid-empty loading";
    empty.textContent = "패널이 없습니다. '패널 추가' 또는 '기본 구성으로'를 눌러 주세요.";
    empty.hidden = panels.length > 0;
    container.appendChild(empty);
    return {
      panels,
      add: async cfg => {
        await this.ensureCube(surveyId, cfg.pop);
        const p = createPanel({ span: 6, ...cfg }, ctx);
        panels.push(p); grid.appendChild(p.el); p.update(); this.activePanels.push(p); persist();
        empty.hidden = true;
        p.el.scrollIntoView({ behavior: "smooth", block: "center" });
        return p;
      },
      reset: () => { layoutState.reset(tabId); },
      refresh: () => panels.forEach(p => p.update()),
    };
  },

  refreshPanels() { for (const p of this.activePanels) p.update(); },
  clearPanels() { for (const p of this.activePanels) p.destroy(); this.activePanels = []; },

  /** 필터 막대(모집단 하나 기준) */
  renderFilterBar(host, surveyId, pop, onChange) {
    const cb = this.codebooks[surveyId];
    const pdef = cb.populations[pop];
    host.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "filters";
    const lbl = document.createElement("span");
    lbl.className = "label";
    lbl.textContent = "필터";
    wrap.appendChild(lbl);
    const current = filterState.get(pop);
    for (const axis of pdef.ui?.filters || []) {
      const dim = cb.dims[axis];
      if (!dim) continue;
      const sel = document.createElement("div");
      sel.className = "fsel";
      const chosen = new Set(current[axis] || []);
      const btn = document.createElement("button");
      btn.type = "button";
      const label = () => `${dim.label}${chosen.size ? `: ${chosen.size}개` : ""} ▾`;
      btn.textContent = label();
      btn.className = chosen.size ? "on" : "";
      const menu = document.createElement("div");
      menu.className = "menu";
      for (const [code, name] of dim.codes) {
        const l = document.createElement("label");
        l.innerHTML = `<input type="checkbox" value="${code}" ${chosen.has(code) ? "checked" : ""}> ${name}`;
        l.querySelector("input").addEventListener("change", e => {
          if (e.target.checked) chosen.add(code); else chosen.delete(code);
          commit();
        });
        menu.appendChild(l);
      }
      const acts = document.createElement("div");
      acts.className = "actions";
      acts.innerHTML = `<button type="button" data-a="clear">전체 해제</button><button type="button" data-a="close">닫기</button>`;
      acts.querySelector("[data-a=clear]").onclick = () => { chosen.clear(); menu.querySelectorAll("input").forEach(i => (i.checked = false)); commit(); };
      acts.querySelector("[data-a=close]").onclick = () => sel.classList.remove("open");
      menu.appendChild(acts);
      const commit = () => {
        const f = filterState.get(pop);
        if (chosen.size) f[axis] = [...chosen]; else delete f[axis];
        filterState.set(pop, f);
        btn.textContent = label(); btn.className = chosen.size ? "on" : "";
        onChange?.();
      };
      btn.onclick = e => { e.stopPropagation(); document.querySelectorAll(".fsel.open").forEach(x => x !== sel && x.classList.remove("open")); sel.classList.toggle("open"); };
      sel.append(btn, menu);
      wrap.appendChild(sel);
    }
    const reset = document.createElement("button");
    reset.className = "btn small ghost";
    reset.textContent = "필터 초기화";
    reset.onclick = () => { filterState.clear(pop); this.renderFilterBar(host, surveyId, pop, onChange); onChange?.(); };
    wrap.appendChild(reset);
    host.appendChild(wrap);
  },
};
document.addEventListener("click", e => { if (!e.target.closest(".fsel")) document.querySelectorAll(".fsel.open").forEach(x => x.classList.remove("open")); });

function stripCfg(cfg) { const { _i, ...rest } = cfg; return rest; }

/* ───────────── 라우팅 ───────────── */
function parseHash() {
  const h = (location.hash || "#overview").slice(1);
  const [tab, ...rest] = h.split("/");
  return { tab: TABS.some(t => t.id === tab) ? tab : "overview", params: rest };
}

async function route() {
  const { tab, params } = parseHash();
  document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("active", a.dataset.tab === tab));
  const main = document.getElementById("main");
  const sub = document.getElementById("subbar");
  if (app.current?.mod?.destroy) { try { app.current.mod.destroy(); } catch { /* ignore */ } }
  app.clearPanels();
  main.innerHTML = `<p class="loading">불러오는 중…</p>`;
  sub.innerHTML = "";
  const def = TABS.find(t => t.id === tab);
  app.current = { tab, params, mod: def.mod };
  try {
    await def.mod.render({ main, sub, app, params, tab });
    document.title = `${def.label} · 환경교육 조사 결과 대시보드`;
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="error"><b>화면을 그리지 못했습니다.</b><br>${escapeHtml(err.message || String(err))}<br><span style="font-size:.8rem">index.html 을 더블클릭해 연 경우 동작하지 않습니다. 서버실행.bat 으로 실행하거나 배포 주소로 접속해 주세요.</span></div>`;
  }
  setTimeout(resizeAll, 50);
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function buildMasthead() {
  const tabs = document.querySelector(".tabs");
  tabs.innerHTML = TABS.map(t => `<a href="#${t.id}" data-tab="${t.id}">${t.label}${t.id === "report" ? ' <span class="rep-count"></span>' : ""}</a>`).join("");
  const badge = document.querySelector(".masthead .badge");
  if (badge) badge.textContent = config.dataLabel || "";
  const syncCount = items => { const el = document.querySelector(".rep-count"); if (el) el.textContent = items.length ? `(${items.length})` : ""; };
  syncCount(reportState.items());
  onReportChange(syncCount);
}

window.addEventListener("hashchange", route);
window.addEventListener("beforeprint", resizeAll);
buildMasthead();
route();
