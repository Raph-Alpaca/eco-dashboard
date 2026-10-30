/**
 * charts.js — ECharts 옵션 생성과 인스턴스 관리.
 * 팔레트는 dataviz 검증기를 통과한 8색(인접 쌍 색각이상 ΔE ≥ 8). 범주형은 항상 고정 순서로 배정한다.
 */
import { KOREA_TILES, TILE_COLS, TILE_ROWS } from "./tilemap-korea.js";
import { fmt, fmtInt } from "./aggregate.js";

export const PALETTE = ["#15875f", "#eb6834", "#237db1", "#eda100", "#e87ba4", "#6250d6", "#9e5317", "#e34948"];
/** 순서 척도(5점 등) 누적막대용 단일 색상 램프(밝음→짙음) */
export const ORDERED_RAMP = {
  2: ["#c3e6d6", "#15875f"],
  3: ["#c3e6d6", "#5db38f", "#0b5f42"],
  4: ["#dcf1e7", "#9fd3b7", "#4fae8b", "#0b5f42"],
  5: ["#e6f4ee", "#b9e0cf", "#78c2a3", "#2d9e76", "#0b5f42"],
  6: ["#e6f4ee", "#c3e6d6", "#9fd3b7", "#78c2a3", "#2d9e76", "#0b5f42"],
};
export const SEQ = ["#eefdf8", "#d6efe3", "#b3dfca", "#8ccdae", "#62b892", "#3ea27a", "#1f8a62", "#0b5f42"];
const INK = "#222222", INK2 = "#555555", INK3 = "#777777", GRID = "#e8e8e8";
const FONT = '"Noto Sans KR", Roboto, -apple-system, "Segoe UI", "Malgun Gothic", system-ui, sans-serif';
const narrow = () => window.innerWidth < 640;
const LW = (w) => (narrow() ? Math.round(w * 0.6) : w);

const instances = new Map();

export function chartOn(el, option, { renderer = "canvas", notMerge = true } = {}) {
  let ch = instances.get(el);
  if (ch && ch._renderer !== renderer) { ch.dispose(); ch = null; }
  if (!ch) {
    ch = echarts.init(el, null, { renderer, locale: "ko" });
    ch._renderer = renderer;
    instances.set(el, ch);
  }
  ch.setOption(option, notMerge);
  return ch;
}
export function chartOf(el) { return instances.get(el); }
export function disposeChart(el) { const ch = instances.get(el); if (ch) { ch.dispose(); instances.delete(el); } }
export function resizeAll() { for (const ch of instances.values()) { try { ch.resize(); } catch { /* ignore */ } } }
window.addEventListener("resize", () => { clearTimeout(window.__rz); window.__rz = setTimeout(resizeAll, 120); });

export function baseOption(extra = {}) {
  return {
    color: PALETTE,
    textStyle: { fontFamily: FONT, color: INK },
    animationDuration: 300,
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: "#fff", borderColor: GRID, textStyle: { color: INK, fontSize: 12 }, confine: true },
    legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 8, icon: "roundRect", textStyle: { color: INK2, fontSize: 12 } },
    ...extra,
  };
}

const axisBase = {
  axisLine: { lineStyle: { color: "#cccccc" } },
  axisTick: { show: false },
  axisLabel: { color: INK2, fontSize: 12, hideOverlap: true },
  splitLine: { lineStyle: { color: GRID } },
};

function valueAxis(measure, max) {
  const isPct = measure !== "mean" && measure !== "value";
  return { type: "value", ...axisBase, max: isPct ? (max ?? null) : null, axisLabel: { ...axisBase.axisLabel, formatter: v => (isPct ? `${v}%` : v) }, splitNumber: 4 };
}

/** 측정값 추출 */
export function measureOf(g, measure, cat) {
  if (!g || g.suppressed || g.empty) return null;
  if (measure === "mean") return g.mean;
  if (measure === "positive") return g.positive;
  if (measure === "pct") return cat != null ? g.pct[cat] : null;
  if (measure === "n") return g.n;
  if (measure === "value") return g.mean;
  return null;
}
export function measureLabel(measure, agg) {
  if (measure === "mean") return agg?.q?.type === "numeric" ? `평균${agg.q.unit ? ` (${agg.q.unit})` : ""}` : "평균(5점)";
  if (measure === "positive") return positiveLabel(agg?.q);
  if (measure === "n") return "응답 수";
  return "비율(%)";
}
export function positiveLabel(q) {
  if (!q) return "긍정 비율(%)";
  if (q.type === "binary" || q.type === "item_binary") return `${(q.categories || ["", "있음"])[1] || "있음"} 비율(%)`;
  if (q.type === "item_cat") return "'뜻도 안다' 비율(%)";
  if (q.type === "single" && q.positive) return "해당 비율(%)";
  return "긍정 비율(%)";
}
export function groupLabel(g) { return g.labels.length ? g.labels.join(" · ") : "전체"; }

/** 단일 키 집계 → 옵션 */
export function optionFromAgg(agg, cfg) {
  const chart = cfg.chart && cfg.chart !== "auto" ? cfg.chart : autoChart(agg, cfg);
  const measure = cfg.measure || autoMeasure(agg, chart);
  if (chart === "tile") return optionTile(agg, { ...cfg, measure });
  if (chart === "stack") return optionStack(agg, cfg);
  if (chart === "hbar") return optionCategoryBars(agg, { ...cfg, measure: "pct" });
  if (chart === "line") return optionLine(agg, { ...cfg, measure });
  return optionGroupBars(agg, { ...cfg, measure });
}

export function autoChart(agg, cfg) {
  const t = agg.q?.type;
  const by = cfg.by || [];
  if (by.includes("sido") && by.length === 1 && t !== "single" && t !== "multi" && t !== "rank" && t !== "events") return "tile";
  if (by[0] === "grade" && by.length === 1) return "line";
  if (["likert5", "item_likert5", "item_cat"].includes(t)) return by.length <= 1 ? "stack" : "bar";
  if (["single", "multi", "rank", "events"].includes(t)) return "hbar";
  return "bar";
}
export function autoMeasure(agg, chart) {
  const t = agg.q?.type;
  if (chart === "stack" || chart === "hbar") return "pct";
  if (t === "numeric") return "mean";
  if (["likert5", "item_likert5"].includes(t)) return "mean";
  if (["binary", "item_binary", "item_cat", "single"].includes(t)) return "positive";
  return "pct";
}

/** 집단별 100% 누적 가로막대(순서 척도·단일응답 분포) */
export function optionStack(agg, cfg) {
  const groups = agg.groups;
  const k = agg.k;
  const cats = agg.categories.length ? agg.categories : Array.from({ length: k }, (_, j) => `보기 ${j + 1}`);
  const ramp = agg.ordered ? (ORDERED_RAMP[k] || SEQ.slice(0, k)) : PALETTE.slice(0, k);
  const ylabels = groups.map(groupLabel);
  const series = cats.map((c, j) => ({
    name: c, type: "bar", stack: "total", barMaxWidth: 28,
    itemStyle: { color: ramp[j], borderColor: "#fff", borderWidth: 1 },
    emphasis: { focus: "series" },
    label: { show: true, position: "inside", color: j >= Math.ceil(k / 2) && agg.ordered ? "#fff" : INK, fontSize: 11, formatter: p => (p.value >= 7 ? `${fmt(p.value, 1)}` : "") },
    data: groups.map(g => (g.suppressed || g.empty ? null : +(g.pct[j] ?? 0).toFixed(2))),
  }));
  const meanLabels = agg.ordered ? groups.map(g => (g.mean == null || g.suppressed ? "" : `평균 ${fmt(g.mean, 2)}`)) : [];
  return baseOption({
    grid: { left: 8, right: agg.ordered ? 70 : 16, top: 40, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: ps => tooltipStack(ps, groups) },
    xAxis: { type: "value", max: 100, ...axisBase, axisLabel: { ...axisBase.axisLabel, formatter: v => `${v}%` } },
    yAxis: { type: "category", data: ylabels, inverse: true, ...axisBase, splitLine: { show: false },
      axisLabel: { ...axisBase.axisLabel, width: LW(110), overflow: "truncate" } },
    series: series.concat(agg.ordered ? [{
      type: "bar", stack: "total", silent: true, data: groups.map(() => 0), barMaxWidth: 28,
      label: { show: true, position: "right", color: INK2, fontSize: 11, formatter: p => meanLabels[p.dataIndex] },
      itemStyle: { color: "transparent" }, tooltip: { show: false },
    }] : []),
  });
}
function tooltipStack(ps, groups) {
  if (!ps.length) return "";
  const g = groups[ps[0].dataIndex];
  const head = `<b>${groupLabel(g)}</b> <span style="color:${INK3}">n=${fmtInt(g.n)}</span>`;
  if (g.suppressed) return `${head}<br>응답 수가 적어 값을 표시하지 않습니다`;
  const lines = ps.filter(p => p.seriesName && p.value != null && p.seriesType === "bar" && p.color !== "transparent")
    .map(p => `${p.marker} ${p.seriesName} <b>${fmt(p.value, 1)}%</b>`);
  return [head, ...lines].join("<br>");
}

/** 집단(x) × 측정값 막대 */
export function optionGroupBars(agg, cfg) {
  const measure = cfg.measure;
  const groups = agg.groups;
  const by = cfg.by || [];
  let series, xcats;
  if (by.length === 2) {
    const a0 = [...new Set(groups.map(g => g.keys[0]))];
    const a1 = [...new Set(groups.map(g => g.keys[1]))];
    xcats = a0.map(c => groups.find(g => g.keys[0] === c).labels[0]);
    series = a1.map((c1, si) => ({
      name: groups.find(g => g.keys[1] === c1).labels[1], type: "bar", barMaxWidth: 36, itemStyle: { color: PALETTE[si % 8], borderRadius: [3, 3, 0, 0] },
      label: valueLabel(measure),
      data: a0.map(c0 => { const g = groups.find(x => x.keys[0] === c0 && x.keys[1] === c1); return num(measureOf(g, measure, cfg.cat)); }),
    }));
  } else {
    xcats = groups.map(groupLabel);
    series = [{
      name: measureLabel(measure, agg), type: "bar", barMaxWidth: 44,
      itemStyle: { color: PALETTE[0], borderRadius: [3, 3, 0, 0] },
      label: valueLabel(measure),
      data: groups.map(g => num(measureOf(g, measure, cfg.cat))),
    }];
  }
  const yMax = measure === "mean" && agg.ordered ? 5 : (measure === "mean" ? null : 100);
  return baseOption({
    legend: { show: by.length === 2, top: 0, left: 0 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: v => fmtMeasure(v, measure) },
    xAxis: { type: "category", data: xcats, ...axisBase, splitLine: { show: false }, axisLabel: { ...axisBase.axisLabel, interval: 0, width: LW(90), overflow: "break", fontSize: narrow() ? 11 : 12 } },
    yAxis: { ...valueAxis(measure, yMax), min: 0 },
    series,
  });
}

/** 보기(category) × 집단 시리즈 가로막대 — 단일/복수응답·순위·건 기준 */
export function optionCategoryBars(agg, cfg) {
  const groups = agg.groups.filter(g => !g.empty);
  const cats = agg.categories;
  const series = groups.map((g, si) => ({
    name: groupLabel(g), type: "bar", barMaxWidth: 22, itemStyle: { color: PALETTE[si % 8], borderRadius: [0, 3, 3, 0] },
    label: { show: groups.length <= 3, position: "right", fontSize: 11, color: INK2, formatter: p => (p.value == null ? "" : fmt(p.value, 1)) },
    data: cats.map((_, j) => (g.suppressed ? null : num(g.pct[j]))),
  }));
  return baseOption({
    legend: { show: groups.length > 1, top: 0, left: 0 },
    grid: { left: 8, right: 36, top: groups.length > 1 ? 36 : 12, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: v => (v == null ? "–" : `${fmt(v, 1)}%`) },
    xAxis: { ...valueAxis("pct", null), min: 0 },
    yAxis: { type: "category", data: cats, inverse: true, ...axisBase, splitLine: { show: false }, axisLabel: { ...axisBase.axisLabel, width: LW(150), overflow: "truncate", interval: 0 } },
    series,
  });
}

/** 학년 등 순서 축 꺾은선 */
export function optionLine(agg, cfg) {
  const measure = cfg.measure;
  const groups = agg.groups;
  return baseOption({
    tooltip: { trigger: "axis", valueFormatter: v => fmtMeasure(v, measure) },
    xAxis: { type: "category", data: groups.map(groupLabel), boundaryGap: false, ...axisBase, splitLine: { show: false } },
    yAxis: { ...valueAxis(measure, measure === "mean" && agg.ordered ? 5 : (measure === "mean" ? null : 100)), scale: true },
    series: [{
      name: measureLabel(measure, agg), type: "line", symbol: "circle", symbolSize: 8, lineStyle: { width: 2, color: PALETTE[0] }, itemStyle: { color: PALETTE[0] },
      label: { show: true, position: "top", fontSize: 11, color: INK2, formatter: p => fmtMeasure(p.value, measure) },
      data: groups.map(g => num(measureOf(g, measure, cfg.cat))),
    }],
  });
}

/** 17개 시도 타일맵(heatmap) */
export function optionTile(agg, cfg) {
  const measure = cfg.measure || "positive";
  const axisIdx = (cfg.by || []).indexOf("sido");
  const data = [];
  const vals = [];
  for (const g of agg.groups) {
    const code = g.keys[axisIdx >= 0 ? axisIdx : 0];
    const pos = KOREA_TILES[code];
    if (!pos) continue;
    const v = measureOf(g, measure, cfg.cat);
    if (v != null) vals.push(v);
    data.push({ value: [pos[0], TILE_ROWS - 1 - pos[1], v == null ? null : +v.toFixed(2)], name: g.labels[axisIdx >= 0 ? axisIdx : 0], n: g.n, suppressed: g.suppressed, unstable: g.unstable });
  }
  const min = vals.length ? Math.min(...vals) : 0, max = vals.length ? Math.max(...vals) : 1;
  return baseOption({
    grid: { left: 10, right: 10, top: 10, bottom: 46 },
    tooltip: { trigger: "item", formatter: p => `<b>${p.data.name}</b> <span style="color:${INK3}">n=${fmtInt(p.data.n)}</span><br>${measureLabel(measure, agg)}: <b>${p.data.value[2] == null ? "표시 안 함(n 부족)" : fmtMeasure(p.data.value[2], measure)}</b>${p.data.unstable ? "<br><span style=color:#aa652d>불안정 추정(n<10)</span>" : ""}` },
    xAxis: { type: "category", data: Array.from({ length: TILE_COLS }, (_, i) => i), show: false },
    yAxis: { type: "category", data: Array.from({ length: TILE_ROWS }, (_, i) => i), show: false },
    visualMap: {
      min, max: max === min ? min + 1 : max, calculable: false, orient: "horizontal", left: "center", bottom: 0, itemWidth: 12, itemHeight: 140,
      inRange: { color: SEQ.slice(1) }, text: [fmtMeasure(max, measure), fmtMeasure(min, measure)], textStyle: { color: INK2, fontSize: 11 },
    },
    series: [{
      type: "heatmap", data, itemStyle: { borderColor: "#fff", borderWidth: 3, borderRadius: 4 },
      label: { show: true, fontSize: 11, color: INK, formatter: p => `${p.data.name}\n${p.data.value[2] == null ? "–" : fmtMeasure(p.data.value[2], measure, true)}` },
      emphasis: { itemStyle: { borderColor: INK } },
    }],
  });
}

/** 항목 묶음(battery): y = 항목, 시리즈 = 집단 */
export function optionBattery(aggs, cfg, measure) {
  const first = aggs[0];
  const groups = first.groups;
  const multi = groups.length > 1;
  const series = groups.map((g, gi) => ({
    name: multi ? groupLabel(g) : measureLabel(measure, first), type: "bar", barMaxWidth: 28,
    itemStyle: { color: PALETTE[gi % 8], borderRadius: [0, 3, 3, 0] },
    label: { show: groups.length <= 2, position: "right", fontSize: 11, color: INK2, formatter: p => (p.value == null ? "" : fmtMeasure(p.value, measure, true)) },
    data: aggs.map(a => num(measureOf(a.groups[gi], measure, cfg.cat))),
  }));
  const xMax = measure === "mean" && first.ordered ? 5 : (measure === "mean" ? null : 100);
  return baseOption({
    legend: { show: multi, top: 0, left: 0 },
    grid: { left: 8, right: 40, top: multi ? 36 : 12, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: v => fmtMeasure(v, measure) },
    xAxis: { ...valueAxis(measure, xMax), min: measure === "mean" && first.ordered ? 1 : 0 },
    yAxis: { type: "category", data: aggs.map(a => a.item?.label || a.key), inverse: true, ...axisBase, splitLine: { show: false }, axisLabel: { ...axisBase.axisLabel, width: LW(170), overflow: "truncate", interval: 0 } },
    series,
  });
}

/** 비교(덤벨): rows = [{label, a, b}] */
export function optionDumbbell(rows, { aName = "학생", bName = "교원", measure = "mean", ordered = true } = {}) {
  const cats = rows.map(r => r.label);
  const max = measure === "mean" && ordered ? 5 : (measure === "mean" ? null : 100);
  return baseOption({
    legend: { top: 0, left: 0, data: [aName, bName] },
    grid: { left: 8, right: 30, top: 36, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", valueFormatter: v => fmtMeasure(v, measure) },
    xAxis: { ...valueAxis(measure, max), min: measure === "mean" && ordered ? 1 : 0 },
    yAxis: { type: "category", data: cats, inverse: true, ...axisBase, splitLine: { show: false }, axisLabel: { ...axisBase.axisLabel, width: LW(170), overflow: "truncate", interval: 0 } },
    series: [
      { name: "차이", type: "custom", silent: true, renderItem: (params, api) => {
          const a = api.value(0), b = api.value(1);
          if (a == null || b == null) return null;
          const pa = api.coord([a, params.dataIndex]), pb = api.coord([b, params.dataIndex]);
          return { type: "line", shape: { x1: pa[0], y1: pa[1], x2: pb[0], y2: pb[1] }, style: { stroke: "#cfd6d2", lineWidth: 2 } };
        }, data: rows.map(r => [r.a, r.b]), tooltip: { show: false }, z: 1 },
      { name: aName, type: "scatter", symbolSize: 12, itemStyle: { color: PALETTE[0] }, data: rows.map(r => num(r.a)), z: 3,
        label: { show: true, position: "left", fontSize: 10, color: INK2, formatter: p => fmtMeasure(p.value, measure, true) } },
      { name: bName, type: "scatter", symbolSize: 12, itemStyle: { color: PALETTE[1] }, data: rows.map(r => num(r.b)), z: 3,
        label: { show: true, position: "right", fontSize: 10, color: INK2, formatter: p => fmtMeasure(p.value, measure, true) } },
    ],
  });
}

/** 지표 × 기관유형 히트맵. cells: [{x, y, value, text, short}] */
export function optionIndicatorHeatmap(xs, ys, cells) {
  return baseOption({
    grid: { left: 10, right: 10, top: 10, bottom: 60, containLabel: true },
    tooltip: { trigger: "item", formatter: p => `<b>${xs[p.data.value[0]]}</b> · ${ys[p.data.value[1]]}<br>${p.data.text}` },
    xAxis: { type: "category", data: xs, position: "top", ...axisBase, splitLine: { show: false }, axisLabel: { ...axisBase.axisLabel, interval: 0, width: 80, overflow: "break" } },
    yAxis: { type: "category", data: ys, inverse: true, ...axisBase, splitLine: { show: false }, axisLabel: { ...axisBase.axisLabel, width: 120, overflow: "truncate" } },
    visualMap: { min: 0, max: 100, orient: "horizontal", left: "center", bottom: 0, itemHeight: 140, itemWidth: 12, inRange: { color: SEQ.slice(1) }, text: ["100%", "0%"], textStyle: { color: INK2, fontSize: 11 } },
    series: [{ type: "heatmap", data: cells.map(c => ({ value: [c.x, c.y, c.value], text: c.text, short: c.short })), itemStyle: { borderColor: "#fff", borderWidth: 2 },
      label: { show: true, fontSize: 11, color: INK, formatter: p => p.data.short } }],
  });
}

function num(v) { return v == null || Number.isNaN(v) ? null : +Number(v).toFixed(3); }
function valueLabel(measure) {
  return { show: true, position: "top", fontSize: 11, color: INK2, formatter: p => (p.value == null ? "" : fmtMeasure(p.value, measure, true)) };
}
export function fmtMeasure(v, measure, short = false) {
  if (v == null) return "–";
  if (measure === "mean" || measure === "value") return fmt(v, Math.abs(v) >= 100 ? 0 : 2);
  if (measure === "n") return fmtInt(v);
  return `${fmt(v, 1)}%`;
}

/** 표/CSV 행: {columns, rows:[{cells, suppressed, unstable}]} */
export function tableOf(agg, cfg, dimLabels = {}) {
  const by = cfg.by || [];
  const cats = agg.categories;
  const isNumeric = agg.q?.type === "numeric";
  const cols = by.length ? by.map(a => dimLabels[a] || a) : ["구분"];
  cols.push(agg.weighted ? "응답 수(비가중)" : "응답 수");
  if (agg.weighted) cols.push("가중 N");
  if (!isNumeric) for (const c of cats) cols.push(`${c} (%)`);
  if (agg.ordered) cols.push("평균");
  if (isNumeric) { cols.push("평균"); cols.push("합계"); }
  const hasPos = agg.groups.some(g => g.positive != null);
  if (hasPos) cols.push(positiveLabel(agg.q));
  const rows = agg.groups.map(g => {
    const r = by.length ? [...g.labels] : ["전체"];
    r.push(fmtInt(g.n));
    if (agg.weighted) r.push(fmtInt(g.base));
    const sup = g.suppressed || g.empty;
    if (!isNumeric) for (let j = 0; j < cats.length; j++) r.push(sup ? "–" : fmt(g.pct[j], 1));
    if (agg.ordered) r.push(sup ? "–" : fmt(g.mean, 2));
    if (isNumeric) { r.push(sup ? "–" : fmt(g.mean, 2)); r.push(sup ? "–" : fmt(g.sum, 0)); }
    if (hasPos) r.push(sup ? "–" : fmt(g.positive, 1));
    return { cells: r, suppressed: sup, unstable: g.unstable };
  });
  return { columns: cols, rows };
}

export function downloadCSV(filename, columns, rows) {
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [columns.map(esc).join(","), ...rows.map(r => r.map(esc).join(","))];
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, filename);
}
export function triggerDownload(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/** 제목·출처를 심은 PNG 내보내기(오프스크린 canvas 렌더) */
export async function exportPNG(option, { title, subtitle, filename, width = 1100, height = 620 }) {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;height:${height}px;background:#fff`;
  document.body.appendChild(host);
  const ch = echarts.init(host, null, { renderer: "canvas", devicePixelRatio: 2 });
  const opt = cloneOption(option);
  opt.animation = false;
  opt.title = { text: title, subtext: subtitle, left: 12, top: 8, textStyle: { fontSize: 18, fontWeight: 700, color: INK }, subtextStyle: { fontSize: 12, color: INK3, lineHeight: 16 } };
  opt.grid = { ...(opt.grid || {}), top: 100 };
  if (opt.legend) opt.legend.top = 72;
  ch.setOption(opt, true);
  await new Promise(r => setTimeout(r, 80));
  const url = ch.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#fff" });
  ch.dispose(); host.remove();
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
}
/** 함수(포맷터)를 보존하는 복제 */
export function cloneOption(src) {
  if (Array.isArray(src)) return src.map(cloneOption);
  if (src && typeof src === "object") { const o = {}; for (const k of Object.keys(src)) o[k] = cloneOption(src[k]); return o; }
  return src;
}
