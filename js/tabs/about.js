/** 데이터 안내 탭 — 합성 데이터 고지, 공표 일치 축/임의 축, 오류 보정 메모, 큐브 규격, 실데이터 교체 절차 */
import { esc } from "../panel.js";
import { loadManifest } from "../data.js";

export async function render({ main, sub, app }) {
  await Promise.all([app.ensureSurvey("school_survey"), app.ensureSurvey("status_survey")]);
  const sc = app.codebooks.school_survey, st = app.codebooks.status_survey;
  const manifest = await loadManifest();
  sub.innerHTML = `<div class="wrap"><div class="subtabs"><span style="font-size:.86rem;color:var(--ink-2)">이 화면의 숫자가 어디서 왔고, 어디까지 믿을 수 있는지</span></div></div>`;
  const notes = [...sc.questions, ...st.questions].filter(q => q.notes);
  const popRows = [];
  for (const cb of [sc, st]) for (const [pid, p] of Object.entries(cb.populations)) popRows.push({ survey: cb.shortTitle, label: p.label, n: p.n, dims: p.dims.map(d => cb.dims[d].label).join(" · "), note: p.ui?.note || "", census: p.census });
  main.innerHTML = `
    <div class="page-head"><h2>데이터 안내</h2></div>
    <div class="prose">
      <p class="notice">이 대시보드의 모든 수치는 <b>보고서에 공표된 값에 맞춰 만든 합성(synthetic) 데이터</b>입니다. 실제 응답 자료가 아니며, 보고서에 없는 교차(예: 학년 × 시도)는 상위 집단과 같은 분포로 채운 값이므로 차이를 해석하면 안 됩니다. 실제 데이터로 바꾸면 같은 화면이 그대로 동작합니다.</p>
      <h3>1. 출처</h3>
      <ul><li>${esc(sc.sourceDoc)} — ${esc(sc.publisher)}</li><li>${esc(st.sourceDoc)} — ${esc(st.publisher)}</li></ul>
      <h3>2. 어떤 축이 보고서와 같고, 어떤 축이 임의인가</h3>
      <div class="table-wrap"><table class="data"><thead><tr><th>조사</th><th>대상</th><th>단위 수</th><th>저장 축</th><th>설명</th></tr></thead><tbody>
        ${popRows.map(r => `<tr><td>${esc(r.survey)}</td><td>${esc(r.label)}${r.census ? ' <span class="badge good">공표값 그대로</span>' : ""}</td><td>${r.n.toLocaleString()}</td><td>${esc(r.dims)}</td><td>${esc(r.note)}</td></tr>`).join("")}
      </tbody></table></div>
      <p style="margin-top:8px">각 패널 아래의 <span class="badge neutral">공표 축</span> 배지가 그 문항에서 보고서에 실제로 공표된 분해 축입니다. 그 축별 값은 보고서와 ±1명(±반 단위 반올림) 안에서 같습니다. 공표되지 않은 축(학년·시도·성별 등)은 상위 집단과 같은 분포로 채웠으므로 <b>차이가 없습니다</b> — 보고서에 없는 값을 만들어내지 않기 위한 선택이며, 실데이터에서는 실제 차이가 그대로 표시됩니다.</p>
      <h3>3. 합성 방법(요약)</h3>
      <ul>
        <li>응답자·기관 목록(프레임)은 보고서의 응답자 특성표·표본 설계표와 같은 구성으로 만듭니다.</li>
        <li>문항마다 공표된 집단별 분포·평균·긍정률에 맞춰 <b>할당량</b>을 정하고, 응답자를 잠재점수 순으로 정렬해 할당합니다(무작위 추출이 아니라 결정적 할당). 그래서 공표된 집단의 값은 사실상 정확히 맞습니다.</li>
        <li>한 응답자의 잠재변수가 모든 문항에 들어가므로 문항 간 상관이 생깁니다(그 크기는 실제와 다를 수 있음). 공표되지 않은 축에는 어떤 체계적 차이도 넣지 않았습니다.</li>
        <li>기관별 값이 그대로 공표된 전수 유형(중앙행정기관 6, 광역지자체 17, 시도교육청 17)은 합성하지 않고 공표 행을 그대로 적재했습니다.</li>
        <li>유아·초중등 실태조사는 표본에 설계가중치(모집단/표본)를 주어 보고서의 가중 추정치와 같게 맞췄습니다.</li>
        <li>검증: 큐브에서 다시 집계한 값과 공표값을 <b>${manifest ? "자동" : ""} 비교</b>한 결과가 저장소의 <code>data/validation_report.md</code>에 있습니다(8천여 개 비교, 소집단 ±1단위 반올림 수준의 차이만 잔존).</li>
      </ul>
      <h3>4. 억제 규칙</h3>
      <ul><li>사람 단위 조사(현황조사): 집단의 응답 수가 30명 미만이면 값을 표시하지 않습니다(‘–’). 화면의 표시 규칙일 뿐 보안 장치는 아니며, 실데이터에서는 큐브를 만들 때 미리 마스킹·축 축소를 합니다.</li>
        <li>가중 추정(유아·초중등): 비가중 응답 수가 10 미만이면 ‘불안정 추정’으로 표시합니다.</li>
        <li>기관 전수조사: 보고서 관례대로 억제하지 않습니다(1기관 1응답).</li></ul>
      <h3>5. 보고서 인쇄 오류 보정 메모</h3>
      <p>전사 과정에서 발견한 보고서 자체의 오기·불일치와 처리 방식입니다(문항별 ⚙ 창에도 표시).</p>
      <table class="data"><thead><tr><th>문항</th><th>메모</th></tr></thead><tbody>${notes.map(q => `<tr><td>${esc(q.qid)} ${esc(q.short)}</td><td>${esc(q.notes)}</td></tr>`).join("")}</tbody></table>
      <h3>6. 실제 데이터로 바꾸는 방법(3단계)</h3>
      <ol>
        <li><b>원자료 준비</b> — <code>data/real/TEMPLATE_*.csv</code> 양식(열 이름 = 코드북 문항 id)에 맞춰 응답자·기관 단위 CSV를 둡니다. 이 폴더는 git에 올라가지 않습니다.</li>
        <li><b>큐브 생성</b> — 기관 내부 PC에서 <code>python tools/build_cubes.py --real --suppress-min 30 --coarsen sido=region5s</code> 를 실행합니다. 원자료는 그대로 두고 <code>data/cubes/*.json</code>(집계 합계만)이 만들어집니다.</li>
        <li><b>배포</b> — 큐브 파일만 서버에 올리고 <code>config.js</code>의 <code>dataLabel</code>·<code>synthetic:false</code>를 바꿉니다. 화면 코드는 수정하지 않습니다.</li>
      </ol>
      <p>자세한 규격은 저장소의 <code>docs/data-spec.md</code>, 홈페이지 연계 절차는 <code>docs/integration-roadmap.md</code>를 보세요.</p>
      <h3>7. 큐브 현황</h3>
      ${manifest ? `<table class="data"><thead><tr><th>모집단</th><th>단위 수</th><th>큐브 키</th><th>파일</th></tr></thead><tbody>${manifest.cubes.map(c => `<tr><td>${esc(c.pop)}</td><td>${c.nUnits.toLocaleString()}</td><td>${c.keys}</td><td>${esc(c.file)}</td></tr>`).join("")}</tbody></table><p style="font-size:.8rem;color:var(--ink-3)">생성: ${esc(manifest.generated)} · 소스: ${esc(manifest.source)}</p>` : "<p>manifest.json 을 찾지 못했습니다.</p>"}
    </div>`;
}
