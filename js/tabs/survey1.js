/** 학교환경교육 현황조사 탭 — 학생 · 교원 · 담당교원 · 학생-교원 비교 */
import { chartOn, optionDumbbell, downloadCSV } from "../charts.js";
import { fmt, fmtInt } from "../aggregate.js";
import { filterState, layoutState, toast } from "../state.js";
import { esc } from "../panel.js";

const SUBS = [
  { id: "student", label: "학생", pop: "student" },
  { id: "teacher", label: "교원", pop: "teacher" },
  { id: "coordinator", label: "담당교원", pop: "teacher" },
  { id: "compare", label: "학생·교원 비교", pop: null },
];
const SURVEY = "school_survey";

export async function render({ main, sub, app, params }) {
  const subId = SUBS.some(s => s.id === params[0]) ? params[0] : "student";
  const def = SUBS.find(s => s.id === subId);
  await app.ensureSurvey(SURVEY);
  const cb = app.codebooks[SURVEY];
  // 보조 막대: 하위 탭 + 필터
  sub.innerHTML = `<div class="wrap"><div class="subtabs">${SUBS.map(s => `<button type="button" data-id="${s.id}" class="${s.id === subId ? "active" : ""}">${s.label}</button>`).join("")}</div><div class="fhost"></div></div>`;
  sub.querySelectorAll(".subtabs button").forEach(b => (b.onclick = () => (location.hash = `#school/${b.dataset.id}`)));
  const fhost = sub.querySelector(".fhost");
  const pop = def.pop || "student";
  await app.ensureCube(SURVEY, pop);
  if (def.pop) app.renderFilterBar(fhost, SURVEY, pop, () => app.refreshPanels());
  const pdef = cb.populations[pop];

  if (subId === "compare") return renderCompare({ main, app, cb });

  const tabId = `school/${subId}`;
  main.innerHTML = `
    <div class="page-head"><h2>${esc(cb.shortTitle)} — ${def.label}</h2>
      <span class="desc">${subId === "coordinator" ? "환경교육 담당교원 306명만 답한 운영 여건 문항" : `${pdef.label} ${fmtInt(pdef.n)}명 · 상단 필터로 범위를 좁힐 수 있습니다`}</span>
      <div class="right"><button class="btn small b-add">＋ 패널 추가</button><button class="btn small ghost b-reset">기본 구성으로</button></div></div>
    <p class="notice">${esc(pdef.ui?.note || "")} 패널의 ⚙로 문항·비교 축·차트를 바꿀 수 있습니다.</p>
    <div class="panels"></div>`;
  const host = main.querySelector(".panels");
  const grid = await app.mountPanels(host, tabId, SURVEY);
  main.querySelector(".b-reset").onclick = () => { grid.reset(); location.reload(); };
  main.querySelector(".b-add").onclick = async () => {
    const first = cb.questions.find(q => q.pop === pop && (subId !== "coordinator" || q.section === "운영 여건"));
    const p = await grid.add({ survey: SURVEY, pop, key: first.cubeKeys[0], by: ["level"], chart: "auto" });
    p.openConfig();
  };
}

/** 학생 vs 교원 덤벨 비교 */
async function renderCompare({ main, app, cb }) {
  await app.ensureCubes(SURVEY, ["student", "teacher"]);
  const S = app.cubes.student, T = app.cubes.teacher;
  const levelCodes = cb.dims.level.codes;
  main.innerHTML = `
    <div class="page-head"><h2>학생 · 교원 비교</h2><span class="desc">같은 내용을 물은 문항을 학교급별로 나란히 봅니다(점: 학생 ↔ 교원)</span>
      <div class="right"><label class="field" style="display:inline-grid"><select class="lv"><option value="">전체</option>${levelCodes.map(c => `<option value="${c[0]}">${c[1]}</option>`).join("")}</select></label></div></div>
    <p class="notice info">보고서 '학생/교원 결과 비교' 장(표 2-3-1 ~ 2-3-56)에 해당합니다. 학생 필터·교원 필터는 여기서는 적용되지 않고 학교급만 선택합니다.</p>
    <div class="grid cmp-grid"></div>`;
  const grid = main.querySelector(".cmp-grid");
  const draw = () => {
    const lv = main.querySelector(".lv").value;
    grid.innerHTML = "";
    const filters = lv ? { level: [lv] } : {};
    for (const pair of cb.pairs) {
      const qs = S.questions[pair.student], qt = T.questions[pair.teacher];
      if (!qs || !qt) continue;
      const sec = document.createElement("section");
      sec.className = "panel span-6";
      const rows = [];
      let measure = "mean", ordered = true;
      const agg = (cube, key) => cube.aggregate(key, { filters: { ...filters }, by: [] })?.groups?.[0];
      if (qs.type.startsWith("item_")) {
        measure = qs.type === "item_likert5" ? "mean" : "positive"; ordered = qs.type === "item_likert5";
        const map = pair.itemMap || Object.fromEntries(qs.items.map(it => [it.id, it.id]));
        for (const it of qs.items) {
          const tid = map[it.id]; if (!tid) continue;
          const ga = agg(S, `${qs.qid}_${it.id}`), gb = agg(T, `${qt.qid}_${tid}`);
          rows.push({ label: it.label, a: measure === "mean" ? ga?.mean : ga?.positive, b: measure === "mean" ? gb?.mean : gb?.positive });
        }
      } else if (qs.type === "rank") {
        measure = "pct"; ordered = false;
        const ga = agg(S, `${qs.qid}_r1`), gb = agg(T, `${qt.qid}_r1`);
        qs.categories.forEach((c, j) => rows.push({ label: c, a: ga?.pct[j], b: gb?.pct[j] }));
      } else if (qs.type === "single") {
        measure = "pct"; ordered = false;
        const ga = agg(S, qs.qid), gb = agg(T, qt.qid);
        qs.categories.forEach((c, j) => rows.push({ label: c, a: ga?.pct[j], b: gb?.pct[j] }));
      } else {
        const ga = agg(S, qs.qid), gb = agg(T, qt.qid);
        rows.push({ label: "5점 평균", a: ga?.mean, b: gb?.mean });
        rows.push({ label: "긍정 비율(%)", a: ga?.positive, b: gb?.positive });
        measure = "mixed";
      }
      const unit = measure === "mean" ? "5점 평균" : measure === "pct" ? "1순위·응답 비율(%)" : measure === "positive" ? "비율(%)" : "평균·긍정률";
      sec.innerHTML = `<header><div class="ttl"><h3>${esc(pair.label)}</h3><div class="sub">학생 ${esc(qs.qid)} ↔ 교원 ${esc(qt.qid)} · ${unit}${lv ? ` · ${levelCodes.find(c => c[0] === lv)[1]}` : ""}</div></div>
        <div class="acts"><button class="icon-btn b-csv" title="CSV">⤓</button></div></header><div class="body"><div class="chart"></div></div>
        <footer><span class="src">출처: ${esc(cb.shortTitle)} ${(qs.source || []).map(s => `${s.ref}`).join(", ")} · 교원 ${(qt.source || []).map(s => s.ref).join(", ")}</span><span class="badges"><span class="badge synthetic">합성 데이터</span></span></footer>`;
      grid.appendChild(sec);
      const chartEl = sec.querySelector(".chart");
      chartEl.style.height = `${Math.max(220, rows.length * 30 + 70)}px`;
      if (measure === "mixed") {
        const r1 = rows[0], r2 = rows[1];
        chartOn(chartEl, optionDumbbell([{ label: "5점 평균 (×20 환산)", a: r1.a * 20, b: r1.b * 20 }, r2], { measure: "pct", ordered: false }));
      } else {
        chartOn(chartEl, optionDumbbell(rows, { measure: measure === "positive" ? "pct" : measure, ordered }));
      }
      sec.querySelector(".b-csv").onclick = () => downloadCSV(`비교_${pair.label}.csv`, ["항목", "학생", "교원", "차이(교원-학생)"], rows.map(r => [r.label, fmt(r.a, 2), fmt(r.b, 2), fmt((r.b ?? 0) - (r.a ?? 0), 2)]));
    }
  };
  main.querySelector(".lv").onchange = draw;
  draw();
}
