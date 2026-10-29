/** 환경교육 실태조사 탭 — 전체 개요(참여 현황·공통지표 히트맵·지역 비교) + 9종 기관유형 상세 */
import { chartOn, optionIndicatorHeatmap } from "../charts.js";
import { fmt, fmtInt } from "../aggregate.js";
import { createPanel, esc } from "../panel.js";
import { DEFAULT_LAYOUTS } from "../layouts.js";

const SURVEY = "status_survey";

export async function render({ main, sub, app, params }) {
  await app.ensureSurvey(SURVEY);
  const cb = app.codebooks[SURVEY];
  const pops = Object.keys(cb.populations);
  const view = params[0] && (params[0] === "overview" || pops.includes(params[0])) ? params[0] : "overview";
  const areaOf = pop => cb.areas.find(a => a.pops.includes(pop));
  sub.innerHTML = `<div class="wrap"><div class="subtabs">
      <button type="button" data-id="overview" class="${view === "overview" ? "active" : ""}">전체 개요</button>
      ${cb.areas.map(a => `<span style="font-size:.78rem;color:var(--ink-3);margin-left:8px">${a.label}</span>${a.pops.map(p => `<button type="button" data-id="${p}" class="${view === p ? "active" : ""}">${cb.populations[p].label}</button>`).join("")}`).join("")}
    </div><div class="fhost"></div></div>`;
  sub.querySelectorAll(".subtabs button").forEach(b => (b.onclick = () => (location.hash = `#status/${b.dataset.id}`)));
  if (view === "overview") return renderOverview({ main, app, cb });
  return renderPop({ main, sub, app, cb, pop: view, area: areaOf(view) });
}

async function renderOverview({ main, app, cb }) {
  const pops = Object.keys(cb.populations);
  await app.ensureCubes(SURVEY, pops);
  const inds = cb.indicators;
  // 참여 현황 표
  const rows = [];
  for (const [pid, p] of Object.entries(cb.populations)) {
    const pt = p.participation || {};
    if (pt.detail) for (const d of pt.detail) rows.push({ area: cb.areas.find(a => a.pops.includes(pid)).label, label: `${p.label} · ${d.label}`, ...d });
    else rows.push({ area: cb.areas.find(a => a.pops.includes(pid)).label, label: p.label, ...pt });
  }
  main.innerHTML = `
    <div class="page-head"><h2>${esc(cb.shortTitle)} — 전체 개요</h2><span class="desc">9종 기관의 조사 참여 현황과 공통 지표 비교</span></div>
    <div class="grid">
      <section class="panel span-5 compact" style="grid-column:span 5"><header><div class="ttl"><h3>조사 참여 현황</h3><div class="sub">표 1-10 · 유아·초중등은 표본 목표 대비 응답(가중 추정)</div></div></header>
        <div class="table-wrap" style="max-height:none"><table class="data"><thead><tr><th>영역</th><th>기관</th><th>모집단</th><th>목표</th><th>응답</th><th>응답률</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${esc(r.area)}</td><td>${esc(r.label)}</td><td>${fmtInt(r.population)}</td><td>${fmtInt(r.target)}</td><td>${fmtInt(r.responded)}</td><td>${fmt(r.rate, 1)}%</td></tr>`).join("")}</tbody></table></div>
        <footer><span class="src">출처: ${esc(cb.shortTitle)} 표 1-10 (PDF p.47)</span></footer></section>
      <section class="panel span-7" style="grid-column:span 7"><header><div class="ttl"><h3>공통 지표 × 기관유형</h3><div class="sub">각 기관유형에서 해당 요건을 갖춘 비율. 기관 수가 17 이하인 유형은 '갖춘 기관 수/전체'로 표시</div></div></header>
        <div class="body"><div class="chart hm" style="height:520px"></div></div>
        <footer><span class="src">코드북의 indicator 태그로 자동 산출 · 유형마다 기준 문항이 다르므로 정확한 정의는 각 유형 화면의 출처를 확인</span><span class="badges"><span class="badge synthetic">합성 데이터</span></span></footer></section>
    </div>
    <div class="section-head"><h3>지역 비교</h3><div class="rule"></div><span class="n">17개 시도 타일맵 — 지표를 골라 보세요</span></div>
    <div class="grid region"></div>`;
  // 히트맵
  const xs = pops.map(p => cb.populations[p].label);
  const ys = inds.map(i => i.label);
  const cells = [];
  pops.forEach((pid, x) => {
    const cube = app.cubes[pid];
    inds.forEach((ind, y) => {
      const q = cb.questions.find(qq => qq.pop === pid && qq.indicator === ind.id);
      if (!q) return;
      const key = q.cubeKeys[0];
      const g = cube.aggregate(key, { by: [] })?.groups?.[0];
      if (!g || !g.n) return;
      let val = null, text = "";
      if (q.type === "binary" || (q.type === "single" && q.positive)) { val = g.positive; }
      else if (q.type === "numeric" || q.type === "events") { val = null; text = `평균 ${fmt(g.mean, 2)} (n=${fmtInt(g.n)})`; }
      else if (q.type === "multi") { val = Math.max(...g.pct.filter(x => x != null)); text = `가장 높은 보기 ${fmt(val, 1)}%`; }
      if (val == null && !text) return;
      const census = cb.populations[pid].census || g.n <= 17;
      const cnt = census && val != null ? Math.round((val / 100) * g.n) : null;
      const short = val == null ? "" : (census ? `${cnt}/${g.n}` : `${fmt(val, 1)}%`);
      cells.push({ x, y, value: val ?? 0, short, text: `${esc(q.short)}: ${text || `${fmt(val, 1)}%${cnt != null ? ` (${cnt}/${g.n})` : ` (n=${fmtInt(g.n)})`}`}` });
    });
  });
  chartOn(main.querySelector(".hm"), optionIndicatorHeatmap(xs, ys, cells));
  // 지역 비교 패널(시도 축을 가진 모집단의 yes/no·수치 문항)
  const regionPops = pops.filter(p => app.cubes[p].hasAxis("sido"));
  const choices = [];
  for (const p of regionPops) for (const q of cb.questions.filter(q => q.pop === p && ["binary", "numeric"].includes(q.type) && !q.base)) choices.push({ pop: p, key: q.cubeKeys[0], label: `${cb.populations[p].label} · ${q.short}` });
  const host = main.querySelector(".region");
  const sel = document.createElement("div");
  sel.className = "span-12";
  sel.innerHTML = `<label class="field"><span>지표 선택</span><select class="pick">${choices.map((c, i) => `<option value="${i}" ${c.key === "SCH_PLAN_YN" ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label>`;
  host.appendChild(sel);
  let panel = null;
  const draw = () => {
    const c = choices[+sel.querySelector(".pick").value];
    const q = cb.questions.find(x => x.cubeKeys[0] === c.key);
    if (panel) panel.destroy();
    panel = createPanel({ survey: SURVEY, pop: c.pop, key: c.key, by: ["sido"], chart: "tile", measure: q.type === "numeric" ? "mean" : "positive", span: 6, title: `${c.label} — 시도별` }, app.ctx(SURVEY, { allowRemove: false }));
    host.appendChild(panel.el);
    app.activePanels.push(panel);
    panel.update();
    const rank = createPanel({ survey: SURVEY, pop: c.pop, key: c.key, by: ["sido"], chart: "bar", measure: q.type === "numeric" ? "mean" : "positive", span: 6, title: `${c.label} — 시도별 막대` }, app.ctx(SURVEY, { allowRemove: false }));
    host.appendChild(rank.el);
    app.activePanels.push(rank);
    rank.update();
    panel._rank = rank;
  };
  sel.querySelector(".pick").onchange = () => { panel?._rank?.destroy(); draw(); };
  draw();
}

async function renderPop({ main, sub, app, cb, pop, area }) {
  await app.ensureCube(SURVEY, pop);
  const pdef = cb.populations[pop];
  const fhost = sub.querySelector(".fhost");
  app.renderFilterBar(fhost, SURVEY, pop, () => app.refreshPanels());
  const tabId = `status/${pop}`;
  const pt = pdef.participation || {};
  main.innerHTML = `
    <div class="page-head"><h2>${esc(pdef.label)}</h2><span class="desc">${esc(area?.label || "")} · 응답 ${fmtInt(pt.responded ?? pdef.n)}곳${pt.population && pt.population !== pt.responded ? ` / 모집단 ${fmtInt(pt.population)}` : ""}${pdef.weighted ? " · 가중 추정" : ""}</span>
      <div class="right"><button class="btn small b-add">＋ 패널 추가</button><button class="btn small ghost b-reset">기본 구성으로</button></div></div>
    <p class="notice">${esc(pdef.ui?.note || "")}</p>
    <div class="section-head"><h3>핵심 패널</h3><div class="rule"></div><span class="n">⚙로 바꿀 수 있습니다</span></div>
    <div class="panels"></div>
    <div class="section-head"><h3>전체 문항</h3><div class="rule"></div><span class="n">보고서의 모든 수치 표 · 표가 먼저 보이고, 차트 버튼으로 전환</span></div>
    <div class="auto"></div>`;
  const grid = await app.mountPanels(main.querySelector(".panels"), tabId, SURVEY);
  main.querySelector(".b-reset").onclick = () => { grid.reset(); location.reload(); };
  main.querySelector(".b-add").onclick = async () => {
    const first = cb.questions.find(q => q.pop === pop);
    const p = await grid.add({ survey: SURVEY, pop, key: first.cubeKeys[0], by: [pdef.ui?.defaultBy].filter(Boolean), chart: "auto" });
    p.openConfig();
  };
  // 자동 패널: 섹션별, 표 우선
  const auto = main.querySelector(".auto");
  const qs = cb.questions.filter(q => q.pop === pop);
  const sections = [...new Set(qs.map(q => q.section))];
  const ctx = app.ctx(SURVEY, { allowRemove: false, tableFirst: true });
  const defaultBy = pdef.census ? [pdef.unitDim] : [pdef.ui?.defaultBy].filter(Boolean);
  for (const s of sections) {
    const head = document.createElement("div");
    head.className = "section-head";
    head.innerHTML = `<h3 style="font-size:.92rem;color:var(--ink-2)">${esc(s)}</h3><div class="rule"></div>`;
    auto.appendChild(head);
    const g = document.createElement("div");
    g.className = "grid";
    auto.appendChild(g);
    for (const q of qs.filter(x => x.section === s)) {
      const key = q.type.startsWith("item_") ? q.qid : q.cubeKeys[0];
      const p = createPanel({ survey: SURVEY, pop, key, by: pdef.census && q.type !== "multi" && q.type !== "events" ? defaultBy : (q.type === "multi" || q.type === "events" || q.type === "rank" || q.type === "single" ? [] : defaultBy), chart: "auto", span: 6 }, ctx);
      g.appendChild(p.el);
      app.activePanels.push(p);
      p.update();
    }
  }
}
