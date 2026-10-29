/** 분석 탭 — 교차분석 빌더: 조사 → 대상 → 문항 → 행 축 → 열 축 → 값 → 결과 패널(표+차트) */
import { createPanel, esc } from "../panel.js";
import { keyOptions } from "../data.js";
import { filterState } from "../state.js";

export async function render({ main, sub, app }) {
  await Promise.all([app.ensureSurvey("school_survey"), app.ensureSurvey("status_survey")]);
  sub.innerHTML = `<div class="wrap"><div class="subtabs"><span style="font-size:.86rem;color:var(--ink-2)">문항 하나를 골라 두 축까지 교차해 봅니다. 상단 필터(각 조사 탭에서 설정한 값)가 함께 적용됩니다.</span></div><div class="fhost"></div></div>`;
  main.innerHTML = `
    <div class="page-head"><h2>간단 분석(교차분석)</h2><span class="desc">학교급·학년·지역·교원구분 등 축을 골라 표와 차트를 만듭니다</span></div>
    <div class="builder">
      <form class="form">
        <label class="field"><span>조사</span><select name="survey"><option value="school_survey">학교환경교육 현황조사</option><option value="status_survey">환경교육 실태조사</option></select></label>
        <label class="field"><span>대상</span><select name="pop"></select></label>
        <label class="field"><span>문항</span><select name="qid"></select></label>
        <label class="field key-field" hidden><span>세부 항목</span><select name="key"></select></label>
        <label class="field"><span>행 축</span><select name="by0"></select></label>
        <label class="field"><span>열 축(선택)</span><select name="by1"></select></label>
        <label class="field"><span>값</span><select name="measure"></select></label>
        <label class="field"><span>차트</span><select name="chart"><option value="auto">자동</option><option value="bar">막대</option><option value="hbar">가로막대(보기별)</option><option value="stack">누적막대(분포)</option><option value="line">꺾은선</option><option value="tile">시도 타일맵</option></select></label>
        <button class="btn primary" type="submit">분석 실행</button>
        <p style="font-size:.78rem;color:var(--ink-3);margin:0">결과 패널의 ⊞로 표를 보고, ⤓로 CSV·PNG를 내려받고, ＋로 보고서에 담습니다. 사람 단위 조사는 응답 30명 미만 집단을 표시하지 않습니다.</p>
      </form>
      <div class="result"><p class="loading">왼쪽에서 조건을 고르고 '분석 실행'을 누르세요.</p></div>
    </div>`;
  const f = main.querySelector("form");
  const el = n => f.querySelector(`[name=${n}]`);
  const fhost = sub.querySelector(".fhost");
  let panel = null;

  const fillPops = () => {
    const cb = app.codebooks[el("survey").value];
    el("pop").innerHTML = Object.entries(cb.populations).map(([id, p]) => `<option value="${id}">${esc(p.label)}</option>`).join("");
    fillQuestions();
  };
  const fillQuestions = () => {
    const cb = app.codebooks[el("survey").value];
    const pop = el("pop").value;
    const qs = cb.questions.filter(q => q.pop === pop);
    const sections = [...new Set(qs.map(q => q.section))];
    el("qid").innerHTML = sections.map(s => `<optgroup label="${esc(s)}">${qs.filter(q => q.section === s).map(q => `<option value="${q.qid}">${esc(q.short)}${q.base ? " (조건부)" : ""}</option>`).join("")}</optgroup>`).join("");
    const pdef = cb.populations[pop];
    const axes = [...pdef.dims, ...(pdef.derived || [])].filter(a => a !== "coord");
    const opts = axes.map(a => `<option value="${a}">${esc(cb.dims[a]?.label || a)}</option>`).join("");
    el("by0").innerHTML = `<option value="">전체(축 없음)</option>${opts}`;
    el("by1").innerHTML = `<option value="">없음</option>${opts}`;
    el("by0").value = pdef.ui?.defaultBy || "";
    app.renderFilterBar(fhost, el("survey").value, pop, () => panel?.update());
    fillKeys();
  };
  const fillKeys = () => {
    const cb = app.codebooks[el("survey").value];
    const q = cb.questions.find(x => x.qid === el("qid").value);
    const opts = q.type.startsWith("item_") ? [{ key: q.qid, label: "항목 전체(묶음)" }, ...keyOptions(q)] : keyOptions(q);
    const kf = main.querySelector(".key-field");
    kf.hidden = opts.length <= 1;
    el("key").innerHTML = opts.map(o => `<option value="${o.key}">${esc(o.label)}</option>`).join("");
    const t = q.type;
    const ms = [];
    if (["likert5", "item_likert5"].includes(t)) ms.push(["mean", "평균(5점)"], ["positive", "긍정 비율"], ["pct", "응답 분포"]);
    else if (["item_cat", "binary", "item_binary"].includes(t)) ms.push(["positive", "해당 비율"], ["pct", "응답 분포"]);
    else if (t === "numeric") ms.push(["mean", "평균"]);
    else ms.push(["pct", "비율(%)"]);
    el("measure").innerHTML = ms.map(m => `<option value="${m[0]}">${m[1]}</option>`).join("");
  };
  el("survey").onchange = async () => { await app.ensureSurvey(el("survey").value); fillPops(); };
  el("pop").onchange = fillQuestions;
  el("qid").onchange = fillKeys;
  fillPops();

  f.onsubmit = async e => {
    e.preventDefault();
    const survey = el("survey").value, pop = el("pop").value;
    await app.ensureCube(survey, pop);
    const by = [el("by0").value, el("by1").value].filter(Boolean);
    const cfg = { survey, pop, key: el("key").value || el("qid").value, by: [...new Set(by)], measure: el("measure").value, chart: el("chart").value, span: 12 };
    const host = main.querySelector(".result");
    if (panel) { panel.destroy(); }
    host.innerHTML = "";
    panel = createPanel(cfg, app.ctx(survey, { allowRemove: false, onChange: () => {} }));
    host.appendChild(panel.el);
    app.activePanels.push(panel);
    panel.update();
    if (!panel.showTable) panel.toggleTable();
  };
}
