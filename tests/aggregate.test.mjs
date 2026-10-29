/**
 * JS 집계(js/aggregate.js) ↔ 파이썬 검증기(tools/validate.py)가 낸 기대 집계의 패리티 테스트.
 * 실행: node --test tests/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CubeIndex } from "../js/aggregate.js";

const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf-8"));
const expected = read("./expected_aggregates.json");
const codebooks = { school_survey: read("../data/codebook/school_survey.json"), status_survey: read("../data/codebook/status_survey.json") };
const cubes = {};
function cubeOf(pop) {
  if (!cubes[pop]) {
    const survey = pop.startsWith("inst_") ? "status_survey" : "school_survey";
    cubes[pop] = new CubeIndex(read(`../data/cubes/${pop}.json`), codebooks[survey]);
  }
  return cubes[pop];
}
function popOfKey(key) {
  for (const cb of Object.values(codebooks)) for (const q of cb.questions) if (q.cubeKeys.includes(key)) return q.pop;
  return null;
}

test("JS aggregate matches Python expected aggregates (sample)", () => {
  let checked = 0;
  const step = Math.max(1, Math.floor(expected.length / 400));
  for (let i = 0; i < expected.length; i += step) {
    const e = expected[i];
    const pop = popOfKey(e.key);
    if (!pop) continue;
    const ci = cubeOf(pop);
    const by = e.by === "all" ? [] : [e.by];
    const filters = e.by === "all" ? {} : { [e.by]: [e.val] };
    if (e.by !== "all" && !ci.hasAxis(e.by)) continue;
    const agg = ci.aggregate(e.key, { by, filters, suppression: { minN: 0, unstableN: 0 } });
    assert.ok(agg, `aggregate null for ${e.key}`);
    const g = e.by === "all" ? agg.groups[0] : agg.groups.find(x => String(x.keys[0]) === String(e.val));
    assert.ok(g, `group ${e.by}=${e.val} missing for ${e.key}`);
    assert.equal(g.n, e.n, `n mismatch ${e.key} [${e.by}=${e.val}]`);
    if (e.pct) {
      e.pct.forEach((p, j) => { if (p != null && g.pct[j] != null) assert.ok(Math.abs(g.pct[j] - p) < 0.02, `pct ${e.key} cat${j}: ${g.pct[j]} vs ${p}`); });
    }
    if (e.pctOfN) {
      e.pctOfN.forEach((p, j) => { if (p != null && g.pct[j] != null) assert.ok(Math.abs(g.pct[j] - p) < 0.02, `rank pct ${e.key} cat${j}`); });
    }
    if (e.mean != null && g.mean != null) assert.ok(Math.abs(g.mean - e.mean) < 0.01, `mean ${e.key} [${e.by}=${e.val}]: ${g.mean} vs ${e.mean}`);
    checked++;
  }
  assert.ok(checked > 100, `too few checks: ${checked}`);
});

test("suppression and derived axes", () => {
  const ci = cubeOf("student");
  const agg = ci.aggregate("S01", { by: ["region5s"], filters: { gender: ["F"] }, suppression: { minN: 30, unstableN: 10 } });
  assert.equal(agg.groups.length, 5);
  assert.ok(agg.groups.every(g => g.n > 30 && !g.suppressed));
  const tiny = ci.aggregate("S01", { by: ["grade"], filters: { sido: ["36"], urban: ["rural"], gender: ["F"] }, suppression: { minN: 30, unstableN: 10 } });
  assert.ok(tiny.groups.some(g => g.suppressed || g.empty), "소집단은 억제되어야 함");
});
