/** 보고서 탭 — 담은 패널을 A4 인쇄 레이아웃으로 모아 PDF 저장(브라우저 인쇄), CSV 일괄 내보내기 */
import { reportState, onReportChange, toast } from "../state.js";
import { chartOn, optionFromAgg, optionBattery, tableOf, downloadCSV, autoChart, autoMeasure } from "../charts.js";
import { fmt, fmtInt } from "../aggregate.js";
import { esc, ICONS } from "../panel.js";

let unsub = null;

export async function render({ main, sub, app }) {
  await Promise.all([app.ensureSurvey("school_survey"), app.ensureSurvey("status_survey")]);
  sub.innerHTML = `<div class="wrap"><div class="subtabs"><span style="font-size:.86rem;color:var(--ink-2)">패널의 ＋ 버튼으로 담은 항목이 여기에 모입니다. 순서를 바꾸고 메모를 적은 뒤 'PDF로 저장'을 누르세요.</span></div></div>`;
  main.innerHTML = `
    <div class="page-head"><h2>보고서 만들기</h2><span class="desc">담은 패널 → 메모 → A4 인쇄(PDF 저장)</span>
      <div class="right no-print"><button class="btn b-csv">전체 CSV</button><button class="btn primary b-print">PDF로 저장(인쇄)</button></div></div>
    <div class="report-layout">
      <aside class="report-side no-print">
        <label class="field"><span>제목</span><input type="text" name="title"></label>
        <label class="field"><span>부제</span><input type="text" name="subtitle" placeholder="예: 2025년 조사 결과 중 학교급별 비교"></label>
        <div class="field"><div class="row"><label class="field"><span>작성자</span><input type="text" name="author"></label><label class="field"><span>기준일</span><input type="text" name="date"></label></div></div>
        <div class="field"><span>담은 항목 <span class="cnt"></span></span><div class="report-items"></div></div>
        <button class="btn ghost small b-clear">모두 비우기</button>
      </aside>
      <div class="report-print-root"><div class="sheet"><p class="loading">담은 항목이 없습니다. 각 조사 탭에서 패널의 ＋ 버튼을 눌러 주세요.</p></div></div>
    </div>`;
  const meta = reportState.meta();
  for (const k of ["title", "subtitle", "author", "date"]) {
    const inp = main.querySelector(`[name=${k}]`);
    inp.value = meta[k] || "";
    inp.oninput = () => { meta[k] = inp.value; reportState.setMeta(meta); drawSheet(); };
  }
  main.querySelector(".b-clear").onclick = () => { if (confirm("담은 항목을 모두 비울까요?")) reportState.clear(); };
  main.querySelector(".b-print").onclick = async () => { await drawSheet(true); document.body.classList.add("printing-report"); await document.fonts?.ready; setTimeout(() => { window.print(); document.body.classList.remove("printing-report"); }, 150); };
  main.querySelector(".b-csv").onclick = () => exportAll();

  const list = main.querySelector(".report-items");
  const drawList = () => {
    const items = reportState.items();
    main.querySelector(".cnt").textContent = `(${items.length})`;
    list.innerHTML = items.map((it, i) => `<div class="report-item" data-id="${esc(it.id)}"><span class="t" title="${esc(it.title)}">${i + 1}. ${esc(it.title)}</span>
      <button class="icon-btn" data-a="up" title="위로">${ICONS.up}</button><button class="icon-btn" data-a="down" title="아래로">${ICONS.downArrow}</button><button class="icon-btn" data-a="rm" title="빼기">${ICONS.close}</button></div>`).join("");
    list.querySelectorAll("button").forEach(b => (b.onclick = () => {
      const id = b.closest(".report-item").dataset.id;
      if (b.dataset.a === "up") reportState.move(id, -1); if (b.dataset.a === "down") reportState.move(id, 1); if (b.dataset.a === "rm") reportState.remove(id);
    }));
  };

  const sheet = main.querySelector(".sheet");
  const drawSheet = async (forPrint = false) => {
    const items = reportState.items();
    const m = reportState.meta();
    if (!items.length) { sheet.innerHTML = `<p class="loading">담은 항목이 없습니다. 각 조사 탭에서 패널의 ＋ 버튼을 눌러 주세요.</p>`; return; }
    for (const it of items) await app.ensureCubes(it.cfg.survey, [it.cfg.pop]);
    sheet.innerHTML = `<div class="cover"><h1>${esc(m.title || "환경교육 조사 결과 요약")}</h1>${m.subtitle ? `<div class="by">${esc(m.subtitle)}</div>` : ""}<div class="by">${[m.author, m.date].filter(Boolean).map(esc).join(" · ")} · ${esc(app.config.dataLabel || "")}</div></div>
      ${items.map((it, i) => `<div class="fig" data-id="${esc(it.id)}"><h3>${i + 1}. ${esc(it.title)}</h3><div class="cap">${esc(it.sub)}</div><div class="chart"></div><div class="tbl"></div>
        ${forPrint ? (it.memo ? `<div class="memo">${esc(it.memo)}</div>` : "") : `<textarea class="memo-in no-print" placeholder="이 그림에 대한 메모(보고서에 함께 인쇄됩니다)" rows="2" style="width:100%;font:inherit;font-size:.86rem;border:1px solid var(--line-2);border-radius:6px;padding:6px 8px;margin-top:6px">${esc(it.memo || "")}</textarea>`}
        <div class="cap" style="margin-top:4px">${esc(it.src)}</div></div>`).join("")}
      <div class="foot">${esc(app.config.dataLabel || "")} · 본 자료의 수치는 보고서 공표값에 맞춘 합성 데이터이며 실제 응답 자료가 아닙니다. 생성: 환경교육 조사 결과 대시보드</div>`;
    for (const it of items) {
      const fig = sheet.querySelector(`.fig[data-id="${CSS.escape(it.id)}"]`);
      const cube = app.cubes[it.cfg.pop];
      const cb = app.codebooks[it.cfg.survey];
      const filters = { ...(it.cfg.filters || {}) };
      const opt = { filters, by: it.cfg.by, suppression: { minN: 30, unstableN: 10 }, kind: cb.kind };
      const q = cube.questions[it.cfg.key];
      let option, table;
      if (q && q.type.startsWith("item_")) {
        const aggs = q.cubeKeys.map(k => cube.aggregate(k, opt)).filter(Boolean);
        const measure = it.cfg.measure || (q.type === "item_likert5" ? "mean" : "positive");
        option = optionBattery(aggs, it.cfg, measure);
        const groups = aggs[0].groups;
        table = { columns: ["항목", ...groups.map(g => (g.labels.join(" · ") || "전체"))], rows: aggs.map(a => ({ cells: [a.item?.label || a.key, ...a.groups.map(g => (g.suppressed || g.empty ? "–" : (measure === "mean" ? fmt(g.mean, 2) : fmt(g.positive, 1))))] })) };
      } else {
        const agg = cube.aggregate(it.cfg.key, opt);
        if (!agg) continue;
        option = optionFromAgg(agg, { ...it.cfg, measure: it.cfg.measure || autoMeasure(agg, it.cfg.chart !== "auto" ? it.cfg.chart : autoChart(agg, it.cfg)) });
        table = tableOf(agg, it.cfg, Object.fromEntries(Object.entries(cb.dims).map(([k, v]) => [k, v.label])));
      }
      option.animation = false;
      const chartEl = fig.querySelector(".chart");
      chartOn(chartEl, option, { renderer: "svg" });
      fig.querySelector(".tbl").innerHTML = `<table class="data"><thead><tr>${table.columns.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${table.rows.slice(0, 40).map(r => `<tr>${r.cells.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      fig.querySelector(".memo-in")?.addEventListener("change", e => reportState.update(it.id, { memo: e.target.value }));
    }
  };
  const exportAll = () => {
    const items = reportState.items();
    if (!items.length) return toast("담은 항목이 없습니다");
    const out = [];
    for (const it of items) {
      const cube = app.cubes[it.cfg.pop]; if (!cube) continue;
      const cb = app.codebooks[it.cfg.survey];
      const keys = cube.questions[it.cfg.key]?.type.startsWith("item_") ? cube.questions[it.cfg.key].cubeKeys : [it.cfg.key];
      for (const k of keys) {
        const agg = cube.aggregate(k, { by: it.cfg.by, filters: it.cfg.filters || {}, kind: cb.kind });
        if (!agg) continue;
        for (const g of agg.groups) {
          const base = [it.title, k, agg.item?.label || "", g.labels.join(" | ") || "전체", g.n];
          agg.categories.forEach((c, j) => out.push([...base, c, g.suppressed ? "" : fmt(g.pct[j], 2)]));
          if (g.mean != null) out.push([...base, "평균", g.suppressed ? "" : fmt(g.mean, 3)]);
          if (g.positive != null) out.push([...base, "긍정/해당 비율", g.suppressed ? "" : fmt(g.positive, 2)]);
        }
      }
    }
    downloadCSV("보고서_전체_데이터.csv", ["패널", "큐브 키", "항목", "집단", "n", "지표", "값"], out);
    toast("전체 CSV를 내려받았습니다");
  };
  drawList();
  await drawSheet();
  unsub?.();
  unsub = onReportChange(async () => { drawList(); await drawSheet(); });
}
export function destroy() { unsub?.(); unsub = null; }
