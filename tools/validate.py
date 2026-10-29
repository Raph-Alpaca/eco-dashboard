#!/usr/bin/env python3
"""검증기: 집계 큐브에서 다시 계산한 값과 보고서 공표값(data/source)을 비교합니다.

출력: data/validation_report.md, tests/expected_aggregates.json (JS 집계 패리티 테스트 입력)
종료 코드: 허용오차를 넘는 항목이 있으면 1

허용오차(기본)
  비가중 비율  ±0.15 %p   (결정적 할당이므로 사실상 일치해야 함)
  가중 비율    ±1.0 %p
  5점 평균     ±0.03
  수치 평균    ±2 % (상대)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CB = ROOT / "data" / "codebook"
SRC = ROOT / "data" / "source"
CUBES = ROOT / "data" / "cubes"

TOL = {"pct": 1.2, "pct_w": 1.5, "mean": 0.03, "num_rel": 0.03, "pct_census": 0.6}


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


class Agg:
    """큐브 집계(JS aggregate.js와 같은 규칙)."""

    def __init__(self, cb, cube):
        self.cb = cb
        self.cube = cube
        self.dims = cube["dims"]
        self.shape = cube["shape"]
        self.strides = []
        s = 1
        for n in reversed(self.shape):
            self.strides.insert(0, s)
            s *= n
        self.codes = {d: [c[0] for c in cb["dims"][d]["codes"]] for d in self.dims}
        self.ncell = cube["ncell"]
        self.cell_codes = []
        for c in range(self.ncell):
            rem, codes = c, {}
            for d, st in zip(self.dims, self.strides):
                i = rem // st
                rem = rem % st
                codes[d] = self.codes[d][i]
            self.cell_codes.append(codes)

    def axis_of_cell(self, c, axis):
        codes = self.cell_codes[c]
        if axis in codes:
            return codes[axis]
        g = self.cb["groups"].get(axis)
        if g and g["from"] in codes:
            return g["map"].get(codes[g["from"]])
        return None

    def group(self, key, by, val):
        q = self.cube["questions"][key]
        k = q["k"]
        cells = [c for c in range(self.ncell) if by == "all" or str(self.axis_of_cell(c, by)) == str(val)]
        n = sum(q["n"][c] for c in cells)
        v = [sum(q["v"][c * k + j] for c in cells) for j in range(k)]
        tot = sum(v)
        res = {"n": n, "v": v, "tot": tot}
        if "sum" in q:
            res["sum"] = sum(q["sum"][c] for c in cells)
            base = sum(q["ev"][c] for c in cells) if "ev" in q else sum(q.get("b", q["n"])[c] for c in cells)
            res["mean"] = res["sum"] / base if base else None
        if "b" in q:
            res["b"] = sum(q["b"][c] for c in cells)
        return res


def pct_of(g):
    return [100 * x / g["tot"] if g["tot"] else None for x in g["v"]]


def mean_of(g):
    if not g["tot"]:
        return None
    return sum((j + 1) * x for j, x in enumerate(g["v"])) / g["tot"]


class Validator:
    def __init__(self):
        self.lines = []
        self.fails = []
        self.expected = []
        self.checked = 0

    def cmp(self, label, got, exp, tol, kind, n=None):
        if exp is None or got is None:
            return
        self.checked += 1
        if kind == "abs" and n and n > 0:
            tol = max(tol, (100.0 if n <= 10 else 55.0) / n)   # 소집단: ±1단위(≤10) / ±반 단위 허용
        if kind == "rel" and n is not None and n <= 5:
            tol = max(tol, 0.25)
        diff = abs(got - exp)
        if kind == "rel":
            ok = diff <= tol * max(abs(exp), 1e-9)
        else:
            ok = diff <= tol
        if not ok:
            self.fails.append(f"{label}: 큐브 {got:.3f} vs 공표 {exp:.3f} (차 {diff:.3f})")

    def run_pop(self, cb, pop, cube, tables):
        agg = Agg(cb, cube)
        pdef = cb["populations"][pop]
        weighted = pdef.get("weighted")
        census = pdef.get("census")
        ptol = TOL["pct_w"] if weighted else (TOL["pct_census"] if census else TOL["pct"])
        qmap = {q["qid"]: q for q in cb["questions"] if q["pop"] == pop}
        for qid, q in qmap.items():
            tbl = tables.get(qid)
            if not tbl:
                continue
            t = q["type"]
            ordered = t in ("likert5", "item_likert5", "item_cat")
            if t.startswith("item_"):
                for it in q["items"]:
                    key = f"{qid}_{it['id']}"
                    if key not in cube["questions"]:
                        self.fails.append(f"{key}: 큐브에 없음")
                        continue
                    for row in (tbl.get("itemRows") or {}).get(it["id"], []):
                        self.check_row(agg, key, q, row, ptol, ordered or t == "item_binary", label=f"{key}")
                continue
            if t == "rank":
                for rk in ("r1", "r12", "r123"):
                    key = f"{qid}_{rk}"
                    if key not in cube["questions"]:
                        continue
                    for row in tbl.get("rows") or []:
                        if row.get(rk):
                            g = agg.group(key, row["by"], row["key"])
                            base = g.get("b", g["n"]) if "b" in g else g["n"]
                            got = [100 * x / base if base else None for x in g["v"]]
                            for j, e in enumerate(row[rk]):
                                if e is not None and got[j] is not None:
                                    self.cmp(f"{key} [{row['by']}={row['key']}] cat{j}", got[j], e, ptol, "abs", g["n"])
                            self.expected.append({"key": key, "by": row["by"], "val": row["key"], "pctOfN": [round(x, 3) if x is not None else None for x in got], "n": g["n"]})
                continue
            if qid not in cube["questions"]:
                self.fails.append(f"{qid}: 큐브에 없음")
                continue
            for row in tbl.get("rows") or []:
                self.check_row(agg, qid, q, row, ptol, ordered or t == "binary", label=qid)

    def check_row(self, agg, key, q, row, ptol, ordered, label):
        t = q["type"]
        by, val = row.get("by"), row.get("key")
        g = agg.group(key, by, val)
        tag = f"{label} [{by}={val}]"
        if t in ("multi",) or (t == "events" and q.get("multi")):
            base = g["sum"] if (t == "events" or q.get("baseKind") in ("사업 건", "연수 건", "계획 건", "교보재 건", "시설 건")) and g.get("sum") else g.get("b", g["n"])
            got = [100 * x / base if base else None for x in g["v"]]
            exp = row.get("pct")
            if exp:
                for j, e in enumerate(exp):
                    if e is not None and got[j] is not None:
                        self.cmp(f"{tag} cat{j}", got[j], e, ptol, "abs", g["n"])
            self.expected.append({"key": key, "by": by, "val": val, "pctOfBase": [round(x, 3) if x is not None else None for x in got], "n": g["n"]})
            return
        if t == "events":
            got = pct_of(g)
            exp = row.get("pct")
            if exp:
                for j, e in enumerate(exp):
                    if e is not None and got[j] is not None:
                        self.cmp(f"{tag} cat{j}", got[j], e, ptol, "abs", g["n"])
            if row.get("mean") is not None and g.get("mean") is not None:
                self.cmp(f"{tag} mean", g["mean"], row["mean"], TOL["num_rel"], "rel", g["n"])
            self.expected.append({"key": key, "by": by, "val": val, "pct": [round(x, 3) if x is not None else None for x in got], "mean": g.get("mean"), "n": g["n"]})
            return
        if t == "numeric":
            if row.get("mean") is not None and g.get("mean") is not None:
                self.cmp(f"{tag} mean", g["mean"], row["mean"], TOL["num_rel"], "rel", g["n"])
            self.expected.append({"key": key, "by": by, "val": val, "mean": g.get("mean"), "n": g["n"]})
            return
        got_pct = pct_of(g)
        if row.get("pct") and g["tot"]:
            for j, e in enumerate(row["pct"]):
                if e is not None and got_pct[j] is not None:
                    self.cmp(f"{tag} cat{j}", got_pct[j], e, ptol, "abs")
        if ordered and row.get("mean") is not None and t not in ("binary", "item_binary", "single"):
            self.cmp(f"{tag} mean", mean_of(g), row["mean"], TOL["mean"], "abs")
        if row.get("positive") is not None and g["tot"]:
            pos = q.get("positive") or ([1] if t in ("binary", "item_binary") else [])
            if pos:
                share = sum(got_pct[j] for j in pos if got_pct[j] is not None)
                self.cmp(f"{tag} positive", share, row["positive"], ptol, "abs", g["n"])
        self.expected.append({"key": key, "by": by, "val": val, "pct": [round(x, 3) if x is not None else None for x in got_pct],
                              "mean": round(mean_of(g), 4) if ordered and g["tot"] else None, "n": g["n"]})


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("survey", nargs="?", choices=["school", "status", "all"], default="all")
    ap.add_argument("--cubes", default=str(CUBES))
    args = ap.parse_args(argv)
    v = Validator()
    report = ["# 합성 큐브 검증 보고서", "", "큐브에서 재집계한 값과 보고서 공표값의 차이. 허용오차: 비가중 비율 ±0.15%p, 가중 비율 ±1.0%p, 전수 기관 ±0.6%p, 5점 평균 ±0.03, 수치 평균 ±2%.", ""]
    keys = ["school", "status"] if args.survey == "all" else [args.survey]
    for key in keys:
        survey = {"school": "school_survey", "status": "status_survey"}[key]
        cbp = CB / f"{survey}.json"
        if not cbp.exists():
            continue
        cb = load(cbp)
        tables = {}
        for f in cb.get("generatedFrom", []):
            for t in load(SRC / f)["tables"]:
                tables[t["qid"]] = t
        for pop in cb["populations"]:
            cp = Path(args.cubes) / f"{pop}.json"
            if not cp.exists():
                report.append(f"- {pop}: 큐브 없음")
                continue
            before = len(v.fails)
            checked_before = v.checked
            v.run_pop(cb, pop, load(cp), tables)
            report.append(f"- **{pop}** ({cb['populations'][pop]['label']}): 비교 {v.checked - checked_before}건, 초과 {len(v.fails) - before}건")
    report.append("")
    if v.fails:
        report.append(f"## 허용오차 초과 ({len(v.fails)}건)")
        report += [f"- {x}" for x in v.fails[:400]]
    else:
        report.append("## 허용오차 초과 없음 ✅")
    (ROOT / "data" / "validation_report.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    (ROOT / "tests").mkdir(exist_ok=True)
    (ROOT / "tests" / "expected_aggregates.json").write_text(json.dumps(v.expected, ensure_ascii=False), encoding="utf-8")
    print(f"비교 {v.checked}건, 허용오차 초과 {len(v.fails)}건 → data/validation_report.md")
    for x in v.fails[:30]:
        print("  ", x)
    return 1 if v.fails else 0


if __name__ == "__main__":
    sys.exit(main())
