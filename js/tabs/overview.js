/** 개요 탭 — 두 조사 KPI 장부 + 소개 카드 */
import { fmt, fmtInt } from "../aggregate.js";
import { esc } from "../panel.js";

export async function render({ main, sub, app }) {
  await app.ensureCubes("school_survey", ["student", "teacher"]);
  await app.ensureCubes("status_survey", ["inst_school", "inst_local", "inst_early", "inst_public"]);
  const sc = app.codebooks.school_survey, st = app.codebooks.status_survey;
  const S = app.cubes.student, T = app.cubes.teacher, SCH = app.cubes.inst_school, LOC = app.cubes.inst_local, ECE = app.cubes.inst_early, PUB = app.cubes.inst_public;
  const g = (cube, key) => cube.aggregate(key, { by: [] })?.groups?.[0];
  const instTotal = Object.values(st.populations).reduce((a, p) => a + (p.participation?.responded ?? p.n), 0);

  const kpis = [
    { lbl: "학생 응답", val: fmtInt(sc.populations.student.n), unit: "명", cmp: "초 4,868 · 중 4,263 · 고 3,940 (300교)" },
    { lbl: "교원 응답", val: fmtInt(sc.populations.teacher.n), unit: "명", cmp: "일반교원 5,502 · 담당교원 306" },
    { lbl: "실태조사 응답 기관", val: fmtInt(instTotal), unit: "곳", cmp: "9종 기관 · 유아·초중등은 표본(가중 추정)" },
    { lbl: "기준 연도", val: "2025", unit: "", cmp: "현황조사 2025.10~11 · 실태조사 기준일 2024.12.31" },
    { lbl: "기후위기·환경문제가 심각하다 (학생)", val: fmt(g(S, "S01")?.positive, 1), unit: "%", cmp: `교원 <b>${fmt(g(T, "T01")?.positive, 1)}%</b>` },
    { lbl: "학교환경교육 전반적 만족도 (학생)", val: fmt(g(S, "S14_1")?.mean, 2), unit: "점/5", cmp: `교원 <b>${fmt(g(T, "T15_1")?.mean, 2)}점</b>` },
    { lbl: "향후 환경교육 확대에 동의 (학생)", val: fmt(g(S, "S16")?.positive, 1), unit: "%", cmp: `교원 <b>${fmt(g(T, "T18")?.positive, 1)}%</b>` },
    { lbl: "환경교육 계획을 세운 초·중·고", val: fmt(g(SCH, "SCH_PLAN_YN")?.positive, 1), unit: "%", cmp: `유아교육기관 <b>${fmt(g(ECE, "ECE_PLAN_YN")?.positive, 1)}%</b> · 기초지자체 조례 제정 <b>${fmt(g(LOC, "LOC_ORD_YN")?.positive, 1)}%</b>` },
  ];

  main.innerHTML = `
    <div class="page-head"><h2>두 조사를 한눈에</h2><span class="desc">학생·교원 인식조사(현황조사)와 기관 실태조사의 핵심 수치</span>
      <div class="right"><span class="badge synthetic">${esc(app.config.dataLabel || "합성 데이터")}</span></div></div>
    <div class="ledger">${kpis.map(k => `<div class="kpi"><div class="lbl">${esc(k.lbl)}</div><div class="val num">${k.val}<small>${k.unit}</small></div><div class="cmp">${k.cmp}</div></div>`).join("")}</div>
    <div class="cards">
      <div class="card">
        <h3>${esc(sc.title)}</h3>
        <p style="color:var(--ink-2);font-size:.9rem">학생·교원이 환경과 환경교육을 어떻게 인식하고 경험하는지 묻는 인식조사입니다. 학교급·학년·지역·교원 구분별로 비교할 수 있습니다.</p>
        <div class="kv"><span>주관</span><b>${esc(sc.publisher)}</b><span>조사 기간</span><b>${esc(sc.fieldwork)}</b><span>표본</span><b>${esc(sc.sampling)}</b></div>
        <div class="links"><a class="btn small" href="#school/student">학생 결과</a><a class="btn small" href="#school/teacher">교원 결과</a><a class="btn small" href="#school/coordinator">담당교원</a><a class="btn small" href="#school/compare">학생·교원 비교</a></div>
      </div>
      <div class="card">
        <h3>${esc(st.title)}</h3>
        <p style="color:var(--ink-2);font-size:.9rem">중앙행정기관부터 유아·초중등·대학까지 9종 기관의 환경교육 기반(법령·계획·인력·사업·시설·연수·거버넌스)을 묻는 국가승인통계입니다.</p>
        <div class="kv"><span>주관</span><b>${esc(st.publisher)}</b><span>조사 기간</span><b>${esc(st.fieldwork)}</b><span>조사 방법</span><b>${esc(st.sampling)}</b></div>
        <div class="links"><a class="btn small" href="#status/overview">전체 개요</a><a class="btn small" href="#status/inst_school">초·중등학교</a><a class="btn small" href="#status/inst_local">기초지자체</a><a class="btn small" href="#status/inst_edu_office">시도교육청</a></div>
      </div>
      <div class="card" style="grid-column:1/-1">
        <h3>이 대시보드로 할 수 있는 것</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;font-size:.88rem;color:var(--ink-2)">
          <div><b style="color:var(--ink)">칸(패널) 바꾸기</b><br>각 패널의 ⚙ 버튼으로 문항·비교 축·차트를 바꿉니다. 구성은 브라우저에 저장됩니다.</div>
          <div><b style="color:var(--ink)">간단 분석</b><br>상단 필터로 학교급·학년·지역을 좁히고, '분석' 탭에서 두 축 교차표를 만듭니다.</div>
          <div><b style="color:var(--ink)">보고서 만들기</b><br>패널의 ＋ 버튼으로 담은 뒤 '보고서' 탭에서 메모를 적고 PDF로 저장합니다.</div>
          <div><b style="color:var(--ink)">실데이터로 교체</b><br>원자료는 화면으로 가지 않습니다. 집계 큐브만 바꾸면 같은 화면이 실데이터로 동작합니다(데이터 안내).</div>
        </div>
      </div>
    </div>`;
}
