/**
 * panel.js — "바꿀 수 있는 칸". 한 문항의 집계를 차트+표로 보여주고,
 * ⚙ 지표 변경 · ⊞ 표 보기 · ⤓ 다운로드(CSV/PNG) · ＋ 보고서 담기 를 제공한다.
 *
 * cfg = { survey, pop, key, by:[axis...], chart:'auto'|'bar'|'stack'|'hbar'|'line'|'tile', measure:'pct'|'positive'|'mean', cat?, span?, title?, filters? }
 * ctx = { cubeOf(pop) -> CubeIndex, codebook(survey) -> cb, filtersOf(pop) -> {axis:[codes]}, suppression, synthetic,
 *         onChange(panel, cfg), onRemove(panel), allowRemove, tableFirst }
 */
import { chartOn, disposeChart, optionFromAgg, optionBattery, tableOf, downloadCSV, exportPNG, autoChart, autoMeasure, measureLabel, positiveLabel } from "./charts.js";
import { fmtInt, fmt } from "./aggregate.js";
import { reportState, onReportChange, panelId, toast } from "./state.js";
import { keyOptions } from "./data.js";

export const ICONS = {
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  table: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 4v12m0 0 5-5m-5 5-5-5M4 20h16"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5m0 0-6 6m6-6 6 6"/></svg>',
  downArrow: '<svg viewBox="0 0 24 24"><path d="M12 5v14m0 0 6-6m-6 6-6-6"/></svg>',
};

const observer = new IntersectionObserver(entries => {
  for (const e of entries) {
    const p = e.target.__panel;
    if (!p) continue;
    if (e.isIntersecting) { p.visible = true; if (p.dirty) p.renderChart(); }
    else p.visible = false;
  }
}, { rootMargin: "240px 0px" });

export function createPanel(cfg, ctx) { return new Panel(cfg, ctx); }

export class Panel {
  constructor(cfg, ctx) {
    this.cfg = { chart: "auto", by: [], ...cfg };
    this.ctx = ctx;
    this.el = document.createElement("section");
    this.el.className = `panel span-${this.cfg.span || 6}${ctx.tableFirst ? " table-first" : ""}`;
    this.el.__panel = this;
    this.showTable = !!ctx.tableFirst;
    this.dirty = true;
    this.visible = false;
    this.build();
    observer.observe(this.el);
    this.unsub = onReportChange(() => this.syncReportBtn());
  }

  get cube() { return this.ctx.cubeOf(this.cfg.pop); }
  get cb() { return this.ctx.codebook(this.cfg.survey); }
  get isBattery() { const q = this.cube?.questions[this.cfg.key]; return !!(q && q.type.startsWith("item_")); }

  build() {
    const el = this.el;
    el.innerHTML = `
      <header>
        <div class="ttl"><h3></h3><div class="sub"></div></div>
        <div class="acts">
          <button class="icon-btn b-table" title="표 보기" aria-label="표 보기">${ICONS.table}</button>
          <button class="icon-btn b-cfg" title="지표 변경" aria-label="지표 변경">${ICONS.gear}</button>
          <button class="icon-btn b-dl" title="다운로드" aria-label="다운로드">${ICONS.down}</button>
          <button class="icon-btn b-rep" title="보고서에 담기" aria-label="보고서에 담기">${ICONS.plus}</button>
          ${this.ctx.allowRemove ? `<button class="icon-btn b-rm" title="패널 제거" aria-label="패널 제거">${ICONS.close}</button>` : ""}
        </div>
      </header>
      <div class="body"><div class="chart" role="img"></div></div>
      <div class="table-wrap" ${this.showTable ? "" : "hidden"}></div>
      <footer><span class="src"></span><span class="badges"></span></footer>`;
    el.querySelector(".b-table").addEventListener("click", () => this.toggleTable());
    el.querySelector(".b-cfg").addEventListener("click", () => this.openConfig());
    el.querySelector(".b-dl").addEventListener("click", e => this.downloadMenu(e.currentTarget));
    el.querySelector(".b-rep").addEventListener("click", () => this.toggleReport());
    el.querySelector(".b-rm")?.addEventListener("click", () => this.ctx.onRemove?.(this));
    if (this.ctx.allowConfig === false) el.querySelector(".b-cfg").hidden = true;
    if (this.showTable) { el.querySelector(".b-table").classList.add("on"); el.querySelector(".b-table").innerHTML = ICONS.chart; el.querySelector(".b-table").title = "차트 보기"; }
    this.syncReportBtn();
  }

  /** 현재 cfg·필터로 집계 */
  compute() {
    const cube = this.cube;
    if (!cube) return null;
    const filters = { ...(this.ctx.filtersOf?.(this.cfg.pop) || {}), ...(this.cfg.filters || {}) };
    for (const a of this.cfg.by || []) delete filters[a]; // 비교 축은 전체 범주를 보여준다
    const opt = { filters, by: this.cfg.by, suppression: this.ctx.suppression, kind: this.cb.kind };
    if (this.isBattery) {
      const q = cube.questions[this.cfg.key];
      const aggs = q.cubeKeys.map(k => cube.aggregate(k, opt)).filter(Boolean);
      return { battery: true, aggs, q };
    }
    const agg = cube.aggregate(this.cfg.key, opt);
    return agg ? { battery: false, agg, q: agg.q } : null;
  }

  update() {
    this.dirty = true;
    this.renderHeader();
    if (this.visible) this.renderChart();
    if (this.showTable) this.renderTable();
  }

  titleText() {
    const res = this.last;
    if (!res) return this.cfg.title || this.cfg.key;
    const q = res.q;
    const meta = res.battery ? null : this.cube.keyMeta(this.cfg.key);
    if (this.cfg.title) return this.cfg.title;
    if (meta?.item) return `${q.short} — ${meta.item.label}`;
    if (meta?.rank) return `${q.short} (${{ r1: "1순위", r12: "1+2순위", r123: "1+2+3순위" }[meta.rank]})`;
    return q?.short || q?.label || this.cfg.key;
  }

  renderHeader() {
    const res = this.compute();
    this.last = res;
    const h3 = this.el.querySelector("h3");
    const sub = this.el.querySelector(".sub");
    h3.textContent = this.titleText();
    if (!res) { sub.textContent = ""; return; }
    const q = res.q;
    const groups = res.battery ? res.aggs[0]?.groups || [] : res.agg.groups;
    const n = groups.reduce((a, g) => a + g.n, 0);
    const wn = groups.reduce((a, g) => a + (g.base || 0), 0);
    const popLabel = this.cb.populations[this.cfg.pop]?.label || this.cfg.pop;
    const byLabel = (this.cfg.by || []).map(a => this.cb.dims[a]?.label || a).join(" × ");
    const parts = [popLabel, byLabel ? `${byLabel}별` : "전체", `n=${fmtInt(n)}${this.cube.weighted ? ` (가중 ${fmtInt(wn)})` : ""}`];
    const measure = this.currentMeasure(res);
    parts.push(measureLabel(measure, res.battery ? res.aggs[0] : res.agg));
    if (q?.base) parts.push("조건부 문항");
    if (groups.some(g => g.suppressed)) parts.push("일부 집단 n<30 표시 안 함");
    sub.textContent = parts.join(" · ");
    const src = (q?.source || []).map(s => `${s.ref} (PDF p.${s.pdf})`).join(", ");
    this.el.querySelector(".src").textContent = src ? `출처: ${this.cb.shortTitle} ${src}` : "";
    const badges = this.el.querySelector(".badges");
    badges.innerHTML = "";
    if (this.ctx.synthetic) badges.innerHTML += `<span class="badge synthetic" title="보고서 공표값에 맞춘 합성 데이터입니다">합성 데이터</span> `;
    if (q?.publishedBy?.length) {
      const pub = q.publishedBy.map(a => this.cb.dims[a]?.label || a).join("·");
      badges.innerHTML += `<span class="badge neutral" title="보고서에 이 축별 값이 공표되어 있어 그 값에 맞춰 생성했습니다. 다른 축의 차이는 임의 생성입니다.">공표 축: ${pub}</span>`;
    }
  }

  currentMeasure(res) {
    if (this.cfg.measure) return this.cfg.measure;
    if (res.battery) return res.q.type === "item_likert5" ? "mean" : "positive";
    const chart = this.cfg.chart !== "auto" ? this.cfg.chart : autoChart(res.agg, this.cfg);
    return autoMeasure(res.agg, chart);
  }

  buildOption(res) {
    if (res.battery) return optionBattery(res.aggs, this.cfg, this.currentMeasure(res));
    return optionFromAgg(res.agg, { ...this.cfg, measure: this.cfg.measure || this.currentMeasure(res) });
  }

  renderChart() {
    const res = this.last || this.compute();
    this.last = res;
    const chartEl = this.el.querySelector(".chart");
    const body = this.el.querySelector(".body");
    let empty = this.el.querySelector(".empty");
    const showEmpty = msg => {
      if (!empty) { empty = document.createElement("div"); empty.className = "empty"; body.appendChild(empty); }
      empty.textContent = msg; disposeChart(chartEl); this.dirty = false;
    };
    if (!res || (res.battery ? !res.aggs.length : !res.agg)) return showEmpty("표시할 데이터가 없습니다");
    const groups = res.battery ? res.aggs[0].groups : res.agg.groups;
    if (groups.every(g => g.suppressed || g.empty)) {
      return showEmpty(groups.every(g => g.empty) ? "선택한 조건에 해당하는 응답이 없습니다" : "응답 수가 30명 미만이어서 값을 표시하지 않습니다(억제 규칙)");
    }
    empty?.remove();
    const firstAgg = res.battery ? res.aggs[0] : res.agg;
    const chart = this.cfg.chart !== "auto" ? this.cfg.chart : (res.battery ? "hbar" : autoChart(firstAgg, this.cfg));
    const nItems = res.battery ? res.aggs.length : (chart === "hbar" ? firstAgg.categories.length : groups.length);
    let h = 260;
    if (chart === "tile") h = 440;
    else if (chart === "hbar" || res.battery) h = Math.max(240, 24 * nItems * Math.max(1, Math.min(groups.length, 3)) + 70);
    else if (chart === "stack") h = Math.max(200, 36 * groups.length + 90);
    chartEl.style.height = `${Math.min(h, 600)}px`;
    this.option = this.buildOption(res);
    const ch = chartOn(chartEl, this.option);
    chartEl.setAttribute("aria-label", `${this.titleText()} 차트. 표 보기 버튼으로 수치를 확인할 수 있습니다.`);
    this.dirty = false;
    // 그리드 행 높이에 맞춰 차트를 늘린다(옆 패널이 더 길 때 빈 공간 방지)
    setTimeout(() => {
      const bh = body.clientHeight;
      if (!this.ctx.tableFirst && bh > chartEl.clientHeight + 8) chartEl.style.height = `${bh}px`;
      ch.resize();
    }, 0);
  }

  tableData() {
    const res = this.last || this.compute();
    if (!res) return null;
    const dimLabels = Object.fromEntries(Object.entries(this.cb.dims).map(([k, v]) => [k, v.label]));
    if (res.battery) {
      const measure = this.currentMeasure(res);
      const groups = res.aggs[0].groups;
      const columns = ["항목", ...groups.map(g => (g.labels.length ? g.labels.join(" · ") : "전체") + (measure === "mean" ? " 평균" : " %"))];
      const rows = res.aggs.map(a => ({ cells: [a.item?.label || a.key, ...a.groups.map(g => (g.suppressed || g.empty ? "–" : (measure === "mean" ? fmt(g.mean, 2) : fmt(g.positive ?? g.pct?.[this.cfg.cat ?? 0], 1))))] }));
      rows.push({ cells: ["응답 수", ...groups.map(g => fmtInt(g.n))], total: true });
      return { columns, rows };
    }
    return tableOf(res.agg, this.cfg, dimLabels);
  }

  renderTable() {
    const wrap = this.el.querySelector(".table-wrap");
    const td = this.tableData();
    if (!td) { wrap.innerHTML = ""; return; }
    const thead = `<tr>${td.columns.map(c => `<th>${esc(c)}</th>`).join("")}</tr>`;
    const tbody = td.rows.map(r => `<tr class="${r.total ? "total" : ""}">${r.cells.map((c, i) => `<td class="${r.suppressed ? "sup" : ""}">${esc(c)}${i === r.cells.length - 1 && r.unstable ? '<span class="flag" title="비가중 n<10">불안정</span>' : ""}</td>`).join("")}</tr>`).join("");
    wrap.innerHTML = `<table class="data"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
  }

  toggleTable() {
    this.showTable = !this.showTable;
    const wrap = this.el.querySelector(".table-wrap");
    const btn = this.el.querySelector(".b-table");
    wrap.hidden = !this.showTable;
    btn.classList.toggle("on", this.showTable);
    if (this.ctx.tableFirst) {
      this.el.classList.toggle("show-chart", !this.showTable);
      btn.innerHTML = this.showTable ? ICONS.chart : ICONS.table;
      btn.title = this.showTable ? "차트 보기" : "표 보기";
      if (!this.showTable) { this.dirty = true; this.renderChart(); }
    }
    if (this.showTable) this.renderTable();
  }

  downloadMenu(btn) {
    const name = (this.titleText() || this.cfg.key).replace(/[\\/:*?"<>|]/g, "_");
    const menu = document.createElement("div");
    menu.className = "fsel open";
    menu.style.position = "absolute";
    menu.innerHTML = `<div class="menu" style="display:block;right:0;left:auto;min-width:170px">
      <button class="btn ghost small" data-k="csv">표 CSV 내려받기</button>
      <button class="btn ghost small" data-k="png">차트 PNG 내려받기</button></div>`;
    btn.parentElement.style.position = "relative";
    btn.parentElement.appendChild(menu);
    const close = () => menu.remove();
    menu.addEventListener("click", async e => {
      const k = e.target.closest("button")?.dataset.k;
      if (k === "csv") { const td = this.tableData(); if (td) { downloadCSV(`${name}.csv`, td.columns, td.rows.map(r => r.cells)); toast("CSV를 내려받았습니다"); } }
      if (k === "png") {
        if (!this.option) { this.dirty = true; this.renderChart(); }
        if (this.option) { await exportPNG(this.option, { title: this.titleText(), subtitle: `${this.el.querySelector(".sub").textContent}\n${this.el.querySelector(".src").textContent}`, filename: `${name}.png` }); toast("PNG를 내려받았습니다"); }
      }
      close();
    });
    setTimeout(() => document.addEventListener("click", close, { once: true }), 0);
  }

  reportItem() {
    return { id: panelId(this.cfg), cfg: { ...this.cfg }, title: this.titleText(), sub: this.el.querySelector(".sub").textContent, src: this.el.querySelector(".src").textContent };
  }
  toggleReport() {
    const item = this.reportItem();
    if (reportState.has(item.id)) { reportState.remove(item.id); toast("보고서에서 뺐습니다"); }
    else { reportState.add(item); toast("보고서에 담았습니다 · 상단 '보고서' 탭에서 확인"); }
    this.syncReportBtn();
  }
  syncReportBtn() {
    const b = this.el.querySelector(".b-rep");
    if (!b) return;
    const on = reportState.has(panelId(this.cfg));
    b.classList.toggle("on", on);
    b.innerHTML = on ? ICONS.check : ICONS.plus;
    b.title = on ? "보고서에 담김 (클릭하면 뺌)" : "보고서에 담기";
  }

  /** ⚙ 지표 변경 모달 */
  openConfig() {
    const cb = this.cb;
    const dlg = document.createElement("dialog");
    dlg.className = "modal";
    const pops = Object.entries(cb.populations).map(([id, p]) => ({ id, label: p.label }));
    const state = { ...this.cfg, by: [...(this.cfg.by || [])] };
    const render = () => {
      const pop = state.pop;
      const pcb = cb.populations[pop];
      const qs = cb.questions.filter(q => q.pop === pop);
      const sections = [...new Set(qs.map(q => q.section))];
      const q = qs.find(x => x.qid === (state.qid || this.qidOfKey(state.key))) || qs[0];
      state.qid = q.qid;
      const keyOpts = q.type.startsWith("item_") ? [{ key: q.qid, label: "항목 전체(묶음)" }, ...keyOptions(q)] : keyOptions(q);
      if (!keyOpts.some(o => o.key === state.key)) state.key = keyOpts[0].key;
      const axes = [...pcb.dims, ...(pcb.derived || [])].filter(a => a !== "coord");
      const axisOpts = axes.map(a => `<option value="${a}">${cb.dims[a]?.label || a}</option>`).join("");
      const t = q.type;
      const measures = [];
      if (["likert5", "item_likert5"].includes(t)) measures.push(["mean", "평균(5점)"], ["positive", "긍정 비율"], ["pct", "응답 분포"]);
      else if (t === "item_cat") measures.push(["positive", positiveLabel(q)], ["pct", "응답 분포"]);
      else if (["binary", "item_binary"].includes(t)) measures.push(["positive", positiveLabel(q)], ["pct", "응답 분포"]);
      else if (t === "numeric") measures.push(["mean", "평균"]);
      else measures.push(["pct", "비율(%)"]);
      if (!measures.some(m => m[0] === state.measure)) state.measure = measures[0][0];
      const charts = [["auto", "자동"], ["bar", "막대"], ["hbar", "가로막대(보기별)"], ["stack", "누적막대(분포)"], ["line", "꺾은선"], ["tile", "시도 타일맵"]];
      const needsCat = ["single", "multi", "rank", "events"].includes(t);
      dlg.innerHTML = `
        <div class="mhead"><h3>지표 변경</h3><button class="icon-btn b-x" aria-label="닫기">${ICONS.close}</button></div>
        <div class="mbody">
          <label class="field"><span>조사 대상</span><select name="pop">${pops.map(p => `<option value="${p.id}" ${p.id === pop ? "selected" : ""}>${p.label}</option>`).join("")}</select></label>
          <label class="field"><span>문항</span><select name="qid">${sections.map(s => `<optgroup label="${esc(s)}">${qs.filter(x => x.section === s).map(x => `<option value="${x.qid}" ${x.qid === q.qid ? "selected" : ""}>${esc(x.short)}${x.base ? " (조건부)" : ""}</option>`).join("")}</optgroup>`).join("")}</select></label>
          ${keyOpts.length > 1 ? `<label class="field"><span>세부 항목</span><select name="key">${keyOpts.map(o => `<option value="${o.key}" ${o.key === state.key ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>` : ""}
          <div class="field"><span>비교 축</span><div class="row">
            <select name="by0"><option value="">전체(축 없음)</option>${axisOpts}</select>
            <select name="by1"><option value="">두 번째 축 없음</option>${axisOpts}</select></div></div>
          <div class="field"><span>값</span><div class="radio-row">${measures.map(m => `<label><input type="radio" name="measure" value="${m[0]}" ${state.measure === m[0] ? "checked" : ""}>${m[1]}</label>`).join("")}</div></div>
          <div class="field"><span>차트</span><div class="radio-row">${charts.map(c => `<label><input type="radio" name="chart" value="${c[0]}" ${(state.chart || "auto") === c[0] ? "checked" : ""}>${c[1]}</label>`).join("")}</div></div>
          ${needsCat ? `<label class="field"><span>타일맵·꺾은선·막대에서 쓸 보기(비율)</span><select name="cat">${(q.categories || []).map((c, i) => `<option value="${i}" ${(state.cat ?? 0) === i ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>` : ""}
          <p style="font-size:.8rem;color:var(--ink-3);margin:0">${esc(q.label)}${q.notes ? ` · 참고: ${esc(q.notes)}` : ""}</p>
        </div>
        <div class="mfoot"><button class="btn b-cancel">취소</button><button class="btn primary b-ok">적용</button></div>`;
      dlg.querySelector("[name=by0]").value = state.by[0] || "";
      dlg.querySelector("[name=by1]").value = state.by[1] || "";
      dlg.querySelector(".b-x").onclick = () => dlg.close();
      dlg.querySelector(".b-cancel").onclick = () => dlg.close();
      dlg.querySelector("[name=pop]").onchange = e => { state.pop = e.target.value; state.qid = null; state.key = null; state.by = []; render(); };
      dlg.querySelector("[name=qid]").onchange = e => { state.qid = e.target.value; state.key = null; render(); };
      dlg.querySelector("[name=key]")?.addEventListener("change", e => { state.key = e.target.value; });
      dlg.querySelector(".b-ok").onclick = () => {
        const by = [dlg.querySelector("[name=by0]").value, dlg.querySelector("[name=by1]").value].filter(Boolean);
        const catEl = dlg.querySelector("[name=cat]");
        const next = { ...this.cfg, pop: state.pop, key: dlg.querySelector("[name=key]")?.value || state.key, by: [...new Set(by)],
          measure: dlg.querySelector("[name=measure]:checked")?.value, chart: dlg.querySelector("[name=chart]:checked")?.value || "auto",
          cat: catEl ? +catEl.value : undefined, title: undefined };
        dlg.close();
        this.cfg = next;
        this.ctx.onChange?.(this, next);
        this.update();
      };
    };
    render();
    document.body.appendChild(dlg);
    dlg.addEventListener("close", () => dlg.remove());
    dlg.showModal();
  }
  qidOfKey(key) { return key ? (this.cube?.keyMeta(key)?.q?.qid || key) : null; }

  destroy() { observer.unobserve(this.el); this.unsub?.(); disposeChart(this.el.querySelector(".chart")); this.el.remove(); }
}

export function esc(s) { return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
