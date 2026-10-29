/**
 * aggregate.js — 집계 큐브(cube)에서 필터·축을 적용해 표/차트용 집계를 만든다.
 *
 * 규칙은 tools/validate.py 의 Agg 클래스와 같다(파이썬/JS 패리티 테스트로 확인).
 *  - 큐브 값 v 는 "단위 기여도 합"(비가중 0/1, 가중 w, 건수). n 은 비가중 응답 수, b 는 가중 응답 수.
 *  - 비율 분모: 단일응답류 = Σv, 복수응답(사람) = b|n, 복수응답(건 기준)/events = sum(건수), 순위 = b|n, numeric 구간 = Σv
 *  - 5점 평균 = Σ(j+1)·v_j / Σv, 수치 평균 = sum / (ev | b | n)
 *  - 억제: 사람 단위 조사에서 비가중 n < minN → suppressed. 가중 추정에서 n < unstableN → unstable.
 */

const EVENT_BASE_KINDS = new Set(["사업 건", "계획 건", "연수 건", "시설 건", "교보재 건", "조례 건", "법령 건", "회의체 건", "과목 건", "동아리 건"]);
const ORDERED_TYPES = new Set(["likert5", "item_likert5", "item_cat"]);

export class CubeIndex {
  /**
   * @param {object} cube  data/cubes/<pop>.json
   * @param {object} codebook  data/codebook/<survey>.json
   */
  constructor(cube, codebook) {
    this.cube = cube;
    this.cb = codebook;
    this.pop = cube.pop;
    this.pdef = codebook.populations[cube.pop];
    this.weighted = !!cube.weighted;
    this.dims = cube.dims;
    this.shape = cube.shape;
    this.ncell = cube.ncell;
    this.strides = [];
    let s = 1;
    for (let i = this.shape.length - 1; i >= 0; i--) { this.strides[i] = s; s *= this.shape[i]; }
    this.codes = {};
    for (const d of this.dims) this.codes[d] = codebook.dims[d].codes.map(c => c[0]);
    // 셀별 축 코드 캐시 (dims + 파생 그룹)
    this.axisCache = {};
    for (const d of this.dims) {
      const arr = new Array(this.ncell);
      for (let c = 0; c < this.ncell; c++) arr[c] = this.codes[d][Math.floor(c / this.strides[this.dims.indexOf(d)]) % this.shape[this.dims.indexOf(d)]];
      this.axisCache[d] = arr;
    }
    for (const [g, def] of Object.entries(codebook.groups || {})) {
      if (this.dims.includes(def.from) && !this.dims.includes(g)) {
        this.axisCache[g] = this.axisCache[def.from].map(code => def.map[code] ?? null);
      }
    }
    this.questions = {};
    for (const q of codebook.questions) if (q.pop === cube.pop) this.questions[q.qid] = q;
  }

  /** 이 큐브에서 쓸 수 있는 축(저장 축 + 파생 축) */
  axes() { return Object.keys(this.axisCache); }
  hasAxis(a) { return a in this.axisCache; }

  axisCodes(axis) {
    if (this.dims.includes(axis)) return this.codes[axis];
    return (this.cb.dims[axis]?.codes || []).map(c => c[0]);
  }
  axisLabel(axis, code) {
    const d = this.cb.dims[axis];
    if (!d) return code;
    const hit = d.codes.find(c => c[0] === code);
    return hit ? hit[1] : code;
  }

  /** 문항 메타: 큐브 키 → {q, item} */
  keyMeta(key) {
    if (this.questions[key]) return { q: this.questions[key], item: null, rank: null };
    for (const q of Object.values(this.questions)) {
      if (!q.cubeKeys.includes(key)) continue;
      if (q.type === "rank") return { q, item: null, rank: key.slice(q.qid.length + 1) };
      if (q.type.startsWith("item_")) {
        const itemId = key.slice(q.qid.length + 1);
        return { q, item: (q.items || []).find(it => it.id === itemId) || { id: itemId, label: itemId }, rank: null };
      }
    }
    return null;
  }

  /** 필터 {axis: [codes]} → 셀 통과 여부 배열 */
  cellMask(filters) {
    const mask = new Uint8Array(this.ncell).fill(1);
    for (const [axis, codes] of Object.entries(filters || {})) {
      if (!codes || !codes.length || !this.axisCache[axis]) continue;
      const set = new Set(codes.map(String));
      const arr = this.axisCache[axis];
      for (let c = 0; c < this.ncell; c++) if (mask[c] && !set.has(String(arr[c]))) mask[c] = 0;
    }
    return mask;
  }

  /**
   * 집계.
   * @param {string} key 큐브 키 (예: "S01", "S03_biodiv", "S04_r1")
   * @param {object} opt {filters, by: [axis, axis2], suppression:{minN, unstableN}, kind:'person'|'institution'}
   */
  aggregate(key, opt = {}) {
    const qd = this.cube.questions[key];
    if (!qd) return null;
    const meta = this.keyMeta(key) || {};
    const q = meta.q || {};
    const k = qd.k;
    const by = (opt.by || []).filter(a => a && this.axisCache[a]);
    const mask = this.cellMask(opt.filters);
    const sup = opt.suppression || {};
    const kindPerson = (opt.kind || this.cb.kind) === "person";
    const minN = kindPerson ? (sup.minN ?? 30) : 0;
    const unstableN = this.weighted ? (sup.unstableN ?? 10) : 0;

    // 그룹 열거(0 행도 유지)
    const axesCodes = by.map(a => this.axisCodes(a));
    const combos = [];
    const rec = (i, acc) => {
      if (i === by.length) { combos.push(acc.slice()); return; }
      for (const code of axesCodes[i]) { acc.push(code); rec(i + 1, acc); acc.pop(); }
    };
    rec(0, []);
    const groups = combos.map(keys => ({
      keys, labels: keys.map((code, i) => this.axisLabel(by[i], code)),
      n: 0, b: 0, v: new Array(k).fill(0), sum: 0, sq: 0, ev: 0,
    }));
    const index = new Map(combos.map((c, i) => [c.join("|"), i]));
    for (let c = 0; c < this.ncell; c++) {
      if (!mask[c]) continue;
      const gk = by.map(a => String(this.axisCache[a][c])).join("|");
      const gi = by.length ? index.get(gk) : 0;
      if (gi === undefined) continue;
      const g = groups[gi];
      g.n += qd.n[c];
      if (qd.b) g.b += qd.b[c];
      for (let j = 0; j < k; j++) g.v[j] += qd.v[c * k + j];
      if (qd.sum) g.sum += qd.sum[c];
      if (qd.sq) g.sq += qd.sq[c];
      if (qd.ev) g.ev += qd.ev[c];
    }
    const type = q.type || "single";
    const eventBased = type === "events" || EVENT_BASE_KINDS.has(q.baseKind);
    const ordered = ORDERED_TYPES.has(type);
    for (const g of groups) {
      const tot = g.v.reduce((a, x) => a + x, 0);
      const base = this.weighted ? g.b : g.n;
      let denom;
      if (type === "multi") denom = eventBased ? g.sum : base;
      else if (type === "events") denom = q.multi ? g.sum : tot;
      else if (type === "rank") denom = base;
      else denom = tot;
      g.tot = tot;
      g.base = base;
      g.denom = denom;
      g.pct = g.v.map(x => (denom > 0 ? (100 * x) / denom : null));
      g.mean = null;
      if (ordered && tot > 0) g.mean = g.v.reduce((a, x, j) => a + (j + 1) * x, 0) / tot;
      if (type === "numeric" || (type === "events" && !q.multi)) {
        const d = qd.ev ? g.ev : (this.weighted ? g.b : g.n);
        if (type === "numeric") g.mean = d > 0 ? g.sum / d : null;
        else g.mean = base > 0 ? g.sum / base : null; // 건수/기관
      }
      g.positive = null;
      if (q.positive && q.positive.length && denom > 0) g.positive = q.positive.reduce((a, j) => a + (g.pct[j] || 0), 0);
      else if ((type === "binary" || type === "item_binary") && denom > 0) g.positive = g.pct[1];
      g.suppressed = minN > 0 && g.n < minN;
      g.unstable = unstableN > 0 && g.n > 0 && g.n < unstableN;
      g.empty = g.n === 0;
    }
    const categories = q.type === "numeric" ? (qd.bins || []) : (q.categories || []);
    return { key, q, item: meta.item, rank: meta.rank, k, by, categories, groups, weighted: this.weighted, eventBased, ordered };
  }
}

/** 두 집계 결과(같은 by)를 나란히 비교할 때 쓰는 보조 */
export function pickValue(group, mode, positiveIdx) {
  if (!group || group.suppressed || group.empty) return null;
  if (mode === "mean") return group.mean;
  if (mode === "positive") return group.positive;
  if (mode === "n") return group.n;
  return null;
}

export function fmt(x, digits = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  return Number(x).toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function fmtInt(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  return Math.round(Number(x)).toLocaleString("ko-KR");
}
