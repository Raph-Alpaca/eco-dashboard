#!/usr/bin/env python3
"""집계 큐브 생성기: 원자료 CSV → data/cubes/<pop>.json

대시보드가 읽는 유일한 데이터. 응답자·기관 단위 자료는 여기서 끝나고, 화면에는 셀별 합계만 갑니다.

사용
  python tools/build_cubes.py                       # data/synthetic/*.csv → data/cubes/
  python tools/build_cubes.py --real                # data/real/*.csv → data/cubes/ (실데이터)
  python tools/build_cubes.py --real --suppress-min 30 --coarsen sido=region5s
      --suppress-min N : 단위 수가 N 미만인 셀을 통째로 비움(사전 마스킹)
      --coarsen a=b    : 축 a를 그룹 b로 바꿔 더 거친 큐브 생성(예: 시도→권역)
  --src DIR / --out DIR 로 경로를 바꿀 수 있습니다(테스트용).

큐브 규격(schemaVersion 1)
  {"pop","weighted","dims":[...],"shape":[...],"units":[셀별 단위 수],
   "questions":{"S01":{"k":5,"n":[셀별 응답 수],"v":[셀×k 합계],"b":[가중 응답 수(가중일 때)],
                        "sum":[셀별 값 합계(numeric/events)],"sq":[제곱합(numeric)],"bins":[...]}}}
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CB = ROOT / "data" / "codebook"
EVENT_BASE_KINDS = {"사업 건", "계획 건", "연수 건", "시설 건", "교보재 건", "조례 건", "법령 건", "회의체 건", "과목 건", "동아리 건"}


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def r3(x):
    return round(x, 3) if isinstance(x, float) else x


class CubeBuilder:
    def __init__(self, cb, pop, coarsen=None, suppress_min=0):
        self.cb = cb
        self.pop = pop
        self.pdef = cb["populations"][pop]
        self.coarsen = coarsen or {}
        self.suppress_min = suppress_min
        self.dims = [self.coarsen.get(d, d) for d in self.pdef["dims"]]
        self.codes = {}
        for d in self.dims:
            self.codes[d] = [c[0] for c in cb["dims"][d]["codes"]]
        self.shape = [len(self.codes[d]) for d in self.dims]
        self.strides = []
        s = 1
        for n in reversed(self.shape):
            self.strides.insert(0, s)
            s *= n
        self.ncell = s
        self.weighted = bool(self.pdef.get("weighted"))

    def cell_of(self, row):
        idx = 0
        for d, orig, st in zip(self.dims, self.pdef["dims"], self.strides):
            v = row.get(orig, "")
            if d != orig:  # coarsen: 그룹 매핑
                v = self.cb["groups"][d]["map"].get(v)
            if v is None or v == "":
                return None
            try:
                idx += self.codes[d].index(str(v)) * st
            except ValueError:
                return None
        return idx

    def build(self, rows):
        units = [0] * self.ncell
        cells = []
        weights = []
        for r in rows:
            c = self.cell_of(r)
            cells.append(c)
            w = float(r.get("weight") or 1.0) if self.weighted else 1.0
            weights.append(w)
            if c is not None:
                units[c] += 1
        out = {}
        for q in self.cb["questions"]:
            if q["pop"] != self.pop:
                continue
            for key, arrs in self.question_arrays(q, rows, cells, weights):
                out[key] = arrs
        if self.suppress_min > 0:
            masked = 0
            for c in range(self.ncell):
                if 0 < units[c] < self.suppress_min:
                    masked += 1
                    units[c] = 0
                    for arrs in out.values():
                        arrs["n"][c] = 0
                        for name in ("b", "sum", "sq"):
                            if name in arrs:
                                arrs[name][c] = 0
                        k = arrs["k"]
                        for j in range(k):
                            arrs["v"][c * k + j] = 0
            print(f"    사전 마스킹: 단위 {self.suppress_min} 미만 셀 {masked}개 비움")
        return {
            "schemaVersion": 1, "survey": self.cb["survey"], "pop": self.pop, "label": self.pdef["label"],
            "weighted": self.weighted, "dims": self.dims, "shape": self.shape, "ncell": self.ncell,
            "nUnits": sum(units), "units": units, "questions": out,
            "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "suppressMin": self.suppress_min, "coarsen": self.coarsen,
        }

    # ---- 문항별 배열
    def _new(self, k, with_sum=False):
        a = {"k": k, "n": [0] * self.ncell, "v": [0.0] * (self.ncell * k)}
        if self.weighted:
            a["b"] = [0.0] * self.ncell
        if with_sum:
            a["sum"] = [0.0] * self.ncell
            a["sq"] = [0.0] * self.ncell
        return a

    def _hit(self, a, c, w):
        a["n"][c] += 1
        if "b" in a:
            a["b"][c] += w

    @staticmethod
    def _num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    def question_arrays(self, q, rows, cells, weights):
        t = q["type"]
        qid = q["qid"]
        k = q["k"]
        res = []
        if t.startswith("item_"):
            kk = 2 if t == "item_binary" else k
            for it in q["items"]:
                col = f"{qid}_{it['id']}"
                a = self._new(kk)
                for r, c, w in zip(rows, cells, weights):
                    if c is None:
                        continue
                    v = self._num(r.get(col))
                    if v is None:
                        continue
                    cat = int(v) if t == "item_binary" else int(v) - 1
                    if 0 <= cat < kk:
                        a["v"][c * kk + cat] += w
                        self._hit(a, c, w)
                res.append((col, self._finish(a)))
            return res
        if t in ("likert5", "single", "binary"):
            a = self._new(k)
            for r, c, w in zip(rows, cells, weights):
                if c is None:
                    continue
                v = self._num(r.get(qid))
                if v is None:
                    continue
                cat = int(v) if t == "binary" else int(v) - 1
                if 0 <= cat < k:
                    a["v"][c * k + cat] += w
                    self._hit(a, c, w)
            res.append((qid, self._finish(a)))
        elif t == "multi" or t == "events":
            event_based = t == "events" or q.get("baseKind") in EVENT_BASE_KINDS
            a = self._new(k, with_sum=event_based)
            owner = (q.get("base") or {}).get("qid") or qid
            ecol = f"{owner}__events"
            for r, c, w in zip(rows, cells, weights):
                if c is None:
                    continue
                vals = [self._num(r.get(f"{qid}__c{j + 1}")) for j in range(k)]
                if all(v is None for v in vals):
                    continue
                for j, v in enumerate(vals):
                    if v:
                        a["v"][c * k + j] += w * v
                self._hit(a, c, w)
                if event_based:
                    ev = self._num(r.get(f"{qid}__base"))
                    if ev is None:
                        ev = self._num(r.get(ecol))
                    if ev is None:
                        ev = sum(v for v in vals if v) if t == "events" and not q.get("multi") else (max([v for v in vals if v] or [0]))
                    a["sum"][c] += w * ev
            if event_based:
                a.pop("sq", None)
            res.append((qid, self._finish(a)))
        elif t == "rank":
            for key, depth in (("r1", 1), ("r12", 2), ("r123", 3)):
                if f"{qid}_{key}" not in q["cubeKeys"]:
                    continue
                a = self._new(k)
                for r, c, w in zip(rows, cells, weights):
                    if c is None:
                        continue
                    first = self._num(r.get(f"{qid}__1"))
                    if first is None:
                        continue
                    self._hit(a, c, w)
                    for p in range(1, depth + 1):
                        v = self._num(r.get(f"{qid}__{p}"))
                        if v is not None and 1 <= int(v) <= k:
                            a["v"][c * k + int(v) - 1] += w
                res.append((f"{qid}_{key}", self._finish(a)))
        elif t == "numeric":
            vals_all = []
            for r, c in zip(rows, cells):
                if c is None:
                    continue
                v = self._num(r.get(qid))
                if v is not None:
                    vals_all.append(v)
            edges = self._bin_edges(q, vals_all)
            kb = len(edges) + 1
            a = self._new(kb, with_sum=True)
            per_event = q.get("baseKind") in EVENT_BASE_KINDS
            ecol = f"{(q.get('base') or {}).get('qid') or qid}__events"
            if per_event:
                a["ev"] = [0.0] * self.ncell
            for r, c, w in zip(rows, cells, weights):
                if c is None:
                    continue
                v = self._num(r.get(qid))
                if v is None:
                    continue
                b = 0
                while b < len(edges) and v > edges[b]:
                    b += 1
                a["v"][c * kb + b] += w
                a["sum"][c] += w * v
                a["sq"][c] += w * v * v
                self._hit(a, c, w)
                if per_event:
                    a["ev"][c] += w * (self._num(r.get(ecol)) or 1)
            fin = self._finish(a)
            fin["binEdges"] = edges
            fin["bins"] = self._bin_labels(edges, q)
            res.append((qid, fin))
        return res

    def _bin_edges(self, q, vals):
        if q.get("binEdges"):
            return q["binEdges"]
        if not vals:
            return [0, 1, 2, 5, 10]
        vals = sorted(vals)
        if len(set(vals)) <= 6:
            uniq = sorted(set(vals))
            return uniq[:-1]
        qs = [vals[int(len(vals) * p)] for p in (0.2, 0.4, 0.6, 0.8)]
        edges = []
        for v in qs:
            if not edges or v > edges[-1]:
                edges.append(round(v, 2))
        return edges or [vals[len(vals) // 2]]

    @staticmethod
    def _bin_labels(edges, q):
        unit = q.get("unit") or ""
        labels = []
        prev = None
        for e in edges:
            labels.append(f"≤{e:g}{unit}" if prev is None else f"{prev:g}~{e:g}{unit}")
            prev = e
        labels.append(f">{prev:g}{unit}" if prev is not None else "전체")
        return labels

    def _finish(self, a):
        a["v"] = [r3(x) for x in a["v"]]
        for name in ("b", "sum", "sq", "ev"):
            if name in a:
                a[name] = [r3(x) for x in a[name]]
        return a


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("survey", nargs="?", choices=["school", "status", "all"], default="all")
    ap.add_argument("--real", action="store_true", help="data/real/ 의 CSV 사용")
    ap.add_argument("--src", help="입력 CSV 폴더(기본: synthetic 또는 real)")
    ap.add_argument("--out", help="출력 폴더(기본: data/cubes)")
    ap.add_argument("--suppress-min", type=int, default=0)
    ap.add_argument("--coarsen", action="append", default=[], help="dim=group (예: sido=region5)")
    ap.add_argument("--pop")
    args = ap.parse_args(argv)
    src = Path(args.src) if args.src else (ROOT / "data" / ("real" if args.real else "synthetic"))
    out = Path(args.out) if args.out else ROOT / "data" / "cubes"
    out.mkdir(parents=True, exist_ok=True)
    coarsen = dict(x.split("=", 1) for x in args.coarsen)
    keys = ["school", "status"] if args.survey == "all" else [args.survey]
    manifest = {"schemaVersion": 1, "generated": time.strftime("%Y-%m-%dT%H:%M:%S"), "source": "real" if args.real else "synthetic", "cubes": []}
    for key in keys:
        survey = {"school": "school_survey", "status": "status_survey"}[key]
        cbp = CB / f"{survey}.json"
        if not cbp.exists():
            print(f"코드북 없음: {cbp}")
            continue
        cb = load(cbp)
        for pop in cb["populations"]:
            if args.pop and pop != args.pop:
                continue
            csvp = src / f"{pop}.csv"
            if not csvp.exists():
                print(f"  {pop}: {csvp.name} 없음 → 건너뜀")
                continue
            rows = read_csv(csvp)
            b = CubeBuilder(cb, pop, coarsen=coarsen, suppress_min=args.suppress_min)
            cube = b.build(rows)
            outp = out / f"{pop}.json"
            outp.write_text(json.dumps(cube, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            size = outp.stat().st_size / 1024
            print(f"  {pop}: 단위 {cube['nUnits']}, 셀 {cube['ncell']}, 큐브 키 {len(cube['questions'])}, {size:,.0f} KB")
            manifest["cubes"].append({"pop": pop, "survey": survey, "file": outp.name, "nUnits": cube["nUnits"], "keys": len(cube["questions"])})
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
