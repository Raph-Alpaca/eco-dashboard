#!/usr/bin/env python3
"""합성 원자료 생성기 (표준 라이브러리만 사용).

입력  : data/codebook/<survey>.json (build_codebook.py 산출물) + data/source/*.json (보고서 공표 수치)
출력  : data/synthetic/<pop>.csv  (응답자/기관 1행, UTF-8 BOM, 엑셀에서 바로 열림)

원칙
- 무작위 표집이 아니라 **결정적 할당(quota allocation)**: 집단×보기별 목표 인원을 먼저 계산하고,
  응답자를 잠재점수(λ·z + 임의효과 + ε) 순으로 정렬해 할당량만큼 잘라 보기를 부여한다.
  → 보고서에 공표된 집단(학교급·교원구분·권역 등)의 주변분포가 ±1명 안에서 맞고,
    한 사람의 잠재변수 z가 모든 문항에 들어가므로 문항 간 상관이 생겨 교차분석이 자연스럽다.
- 두 축(예: 학교급 × 교원구분)에 모두 공표값이 있으면 IPF(반복비례적합)로 교차 셀 목표를 만든다.
- 공표되지 않은 축(학년·시도·성별 등)에는 작은 임의효과만 주어 '그럴듯한 차이'만 만든다.
- 가중 표본(유아·초중등)은 가중 합 기준으로 할당한다.
- 기관별 값이 그대로 공표된 전수 유형(중앙 6·광역 17·교육청 17)은 공표 행을 그대로 적재한다.

사용: python tools/generate_synthetic.py [school|status] [--seed 42]
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import random
import sys
from collections import defaultdict
from pathlib import Path
from statistics import NormalDist

ROOT = Path(__file__).resolve().parents[1]
CB = ROOT / "data" / "codebook"
SRC = ROOT / "data" / "source"
OUT = ROOT / "data" / "synthetic"
ND = NormalDist()

EVENT_BASE_KINDS = {"사업 건", "계획 건", "연수 건", "시설 건", "교보재 건", "조례 건", "법령 건", "회의체 건", "과목 건", "동아리 건"}


# ----------------------------------------------------------------------------- 공통 도구
def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def largest_remainder(fracs, total):
    """실수 목표값 목록을 합이 total인 정수로 (최대 잔여법)."""
    if total <= 0 or not fracs:
        return [0] * len(fracs)
    s = sum(fracs)
    if s <= 0:
        base = [total // len(fracs)] * len(fracs)
        for i in range(total - sum(base)):
            base[i] += 1
        return base
    scaled = [f * total / s for f in fracs]
    ints = [int(math.floor(x)) for x in scaled]
    rem = total - sum(ints)
    order = sorted(range(len(fracs)), key=lambda i: scaled[i] - ints[i], reverse=True)
    for i in order[:rem]:
        ints[i] += 1
    return ints


def ipf_2d(seed, row_tot, col_tot, iters=300):
    """2차원 IPF. seed: 행×열 실수 행렬(0은 구조적 0으로 유지)."""
    m = [row[:] for row in seed]
    R, C = len(m), len(m[0])
    for _ in range(iters):
        for i in range(R):
            s = sum(m[i])
            if s > 0:
                f = row_tot[i] / s
                m[i] = [v * f for v in m[i]]
        for j in range(C):
            s = sum(m[i][j] for i in range(R))
            if s > 0:
                f = col_tot[j] / s
                for i in range(R):
                    m[i][j] *= f
    return m


def ipf_round_2d(seed, row_tot, col_tot):
    """IPF 후 행·열 합이 정확히 맞는 정수 행렬."""
    m = ipf_2d(seed, row_tot, col_tot)
    R, C = len(m), len(m[0])
    ints = [largest_remainder(m[i], int(row_tot[i])) for i in range(R)]
    # 열 합 보정: 남는 열에서 모자란 열로 1씩 이동(잔여가 큰 셀 우선)
    for _ in range(10000):
        colsum = [sum(ints[i][j] for i in range(R)) for j in range(C)]
        diff = [colsum[j] - int(col_tot[j]) for j in range(C)]
        if all(d == 0 for d in diff):
            break
        jp = max(range(C), key=lambda j: diff[j])
        jm = min(range(C), key=lambda j: diff[j])
        # 행 i에서 jp→jm 이동: seed가 0이 아닌 셀만
        cand = [i for i in range(R) if ints[i][jp] > 0 and seed[i][jm] > 0]
        if not cand:
            cand = [i for i in range(R) if ints[i][jp] > 0]
        i = max(cand, key=lambda i: (m[i][jm] - ints[i][jm]) - (m[i][jp] - ints[i][jp]))
        ints[i][jp] -= 1
        ints[i][jm] += 1
    return ints


def cutpoints(p_ref):
    """기준 분포(k개 비율)에서 순서 프로빗 절단점 k-1개."""
    cum, out = 0.0, []
    for p in p_ref[:-1]:
        cum += p
        cum = min(max(cum, 1e-6), 1 - 1e-6)
        out.append(ND.inv_cdf(cum))
    return out


def probit_dist(cuts, mu, sigma):
    cdf = [ND.cdf((c - mu) / sigma) for c in cuts]
    probs, prev = [], 0.0
    for c in cdf:
        probs.append(max(c - prev, 0.0))
        prev = c
    probs.append(max(1 - prev, 0.0))
    s = sum(probs)
    return [p / s for p in probs]


def dist_mean_sd(p):
    k = len(p)
    mean = sum((j + 1) * p[j] for j in range(k))
    var = sum(((j + 1) - mean) ** 2 * p[j] for j in range(k))
    return mean, math.sqrt(max(var, 0))


def solve_mu(cuts, sigma, target_mean):
    lo, hi = -8.0, 8.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if dist_mean_sd(probit_dist(cuts, mid, sigma))[0] < target_mean:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def shift_to_mean(p_ref, target_mean, target_sd=None):
    """기준 분포를 순서프로빗 이동으로 목표 평균(±SD)에 맞춘 분포."""
    cuts = cutpoints(p_ref)
    if target_sd is None:
        return probit_dist(cuts, solve_mu(cuts, 1.0, target_mean), 1.0)
    best, best_err = None, 1e9
    sigma = 0.45
    while sigma <= 3.0:
        mu = solve_mu(cuts, sigma, target_mean)
        d = probit_dist(cuts, mu, sigma)
        err = abs(dist_mean_sd(d)[1] - target_sd)
        if err < best_err:
            best, best_err = d, err
        sigma += 0.05
    return best


def shift_to_mean_positive(p_ref, target_mean, positive_idx, target_share, target_sd=None):
    """μ,σ 두 매개변수로 목표 평균과 긍정 비율을 동시에 맞춘 분포(필요 시 SD는 참고만)."""
    cuts = cutpoints(p_ref)
    best, best_err = None, 1e9
    sigma = 0.4
    while sigma <= 3.5:
        mu = solve_mu(cuts, sigma, target_mean)
        d = probit_dist(cuts, mu, sigma)
        err = abs(sum(d[j] for j in positive_idx) - target_share)
        if target_sd is not None:
            err += 0.02 * abs(dist_mean_sd(d)[1] - target_sd)
        if err < best_err:
            best, best_err = d, err
        sigma += 0.025
    return best


def shift_to_positive(p_ref, positive_idx, target_share):
    """기준 분포를 이동해 긍정(positive_idx) 비율을 목표에 맞춘 분포."""
    cuts = cutpoints(p_ref)
    lo, hi = -8.0, 8.0
    for _ in range(60):
        mid = (lo + hi) / 2
        d = probit_dist(cuts, mid, 1.0)
        share = sum(d[j] for j in positive_idx)
        # positive가 상위 범주면 mu↑ → share↑ ; 하위 범주면 반대
        upper = max(positive_idx) >= len(p_ref) - 1 or min(positive_idx) > 0
        if (share < target_share) == upper:
            lo = mid
        else:
            hi = mid
    return probit_dist(cuts, (lo + hi) / 2, 1.0)


def default_shape(k):
    """공표 분포가 전혀 없을 때 쓰는 완만한 종 모양 기준 분포."""
    mid = (k - 1) / 2
    w = [math.exp(-((j - mid) ** 2) / (2 * (k / 3) ** 2)) for j in range(k)]
    s = sum(w)
    return [x / s for x in w]


# ----------------------------------------------------------------------------- 생성기 본체
class Generator:
    def __init__(self, survey_key, seed=42):
        self.survey_key = survey_key
        self.survey = {"school": "school_survey", "status": "status_survey"}[survey_key]
        self.cb = load(CB / f"{self.survey}.json")
        self.rng = random.Random(seed)
        self.seed = seed
        self.dims = self.cb["dims"]
        self.groups = self.cb.get("groups", {})
        self.codes = {d: [c[0] for c in v["codes"]] for d, v in self.dims.items()}
        self.qmap = {q["qid"]: q for q in self.cb["questions"]}
        self.sources = {}
        for f in self.cb.get("generatedFrom", []):
            doc = load(SRC / f)
            for t in doc["tables"]:
                self.sources[t["qid"]] = t
        self.log = []

    # ---- 축 값
    def axis_value(self, unit, axis):
        if axis in unit:
            return unit[axis]
        g = self.groups.get(axis)
        if g:
            return g["map"].get(unit.get(g["from"]))
        return None

    # ---- 프레임(응답자·기관 목록) 만들기
    def build_frame(self, pop):
        pdef = self.cb["populations"][pop]
        if self.survey_key == "school":
            frame = self._frame_student() if pop == "student" else self._frame_teacher()
        else:
            frame = self._frame_institution(pop, pdef)
        for i, u in enumerate(frame):
            u["id"] = f"{pop[:3].upper()}{i + 1:05d}"
            u.setdefault("weight", 1.0)
            u["_z"] = self.rng.gauss(0, 1)
        return frame

    def _frame_student(self):
        f = self.cb["frame"]["student"]
        sidos = self.codes["sido"]
        levels = ["E", "M", "H"]
        seed = [[f["schoolsBySidoLevel"][s][j] * f["classSize"][j] for j in range(3)] for s in sidos]
        joint = ipf_round_2d(seed, [f["nBySido"][s] for s in sidos], [f["nByLevel"][l] for l in levels])
        # 지역규모: 시도별 구조 → 전체 목표에 IPF
        urb = ["metro", "city", "rural"]
        useed = []
        for s in sidos:
            if s in f["metroCities"]:
                useed.append([0.95, 0.0, 0.05])
            else:
                r = f["ruralShareByProvince"].get(s, 0.4)
                useed.append([0.0, 1 - r, r])
        ujoint = ipf_round_2d([[useed[i][j] * f["nBySido"][s] for j in range(3)] for i, s in enumerate(sidos)],
                              [f["nBySido"][s] for s in sidos], [f["urban"][u] for u in urb])
        units = []
        for i, s in enumerate(sidos):
            # 시도 내 학교급별 학생 목록
            pool = []
            for j, l in enumerate(levels):
                n = joint[i][j]
                grades = [g[0] for g in self.dims["grade"]["codes"] if g[2] == l]
                for t in range(n):
                    pool.append({"sido": s, "grade": grades[t % 2]})
            self.rng.shuffle(pool)
            # 지역규모 부여(시도 내 할당량)
            k = 0
            for j, u in enumerate(urb):
                for _ in range(ujoint[i][j]):
                    pool[k]["urban"] = u
                    k += 1
            units.extend(pool)
        # 성별: 전체 할당
        self.rng.shuffle(units)
        nm = f["gender"]["M"]
        for i, u in enumerate(units):
            u["gender"] = "M" if i < nm else "F"
        units.sort(key=lambda u: (u["sido"], u["grade"]))
        return units

    def _frame_teacher(self):
        f = self.cb["frame"]["teacher"]
        levels = ["E", "M", "H"]
        roles = ["principal", "general", "eeteacher"]
        # 담당교원 설문(coord=1) 306명: 학교급 × 역할 IPF
        c_lv = [f["coordByLevel"][l] for l in levels]
        c_role = [f["coordByRole"][r] for r in roles]
        cj = ipf_round_2d([[1.0] * 3 for _ in range(3)], c_lv, c_role)
        # 일반 설문(coord=0): 나머지
        g_lv = [f["nByLevel"][l] - c_lv[i] for i, l in enumerate(levels)]
        g_role = [f["role"][r] - c_role[j] for j, r in enumerate(roles)]
        gseed = [[1.0, 1.0, 1.0 if g_role[2] > 0 else 0.0] for _ in range(3)]
        gj = ipf_round_2d(gseed, g_lv, g_role)
        units = []
        for i, l in enumerate(levels):
            for j, r in enumerate(roles):
                units += [{"level": l, "role": r, "coord": "1"} for _ in range(cj[i][j])]
                units += [{"level": l, "role": r, "coord": "0"} for _ in range(gj[i][j])]
        # 근속: 교장(감)은 경력이 길다 → 점수 기반 정렬 할당
        score = {id(u): (3.0 if u["role"] == "principal" else 0.0) + self.rng.gauss(0, 1) for u in units}
        order = sorted(units, key=lambda u: score[id(u)])
        k = 0
        for t, n in f["tenure"].items():
            for _ in range(n):
                order[k]["tenure"] = t
                k += 1
        # 지역규모·권역: 임의 할당
        for dim in ("urban", "region5s"):
            self.rng.shuffle(units)
            k = 0
            for code, n in f[dim].items():
                for _ in range(n):
                    units[k][dim] = code
                    k += 1
        units.sort(key=lambda u: (u["level"], u["role"], u["coord"]))
        return units

    def _frame_institution(self, pop, pdef):
        W = self.cb.get("weights", {})
        sidos = self.codes["sido"]
        if pdef.get("census"):
            dim = pdef["unitDim"]
            return [{dim: c} for c in self.codes[dim]]
        if pop == "inst_local":
            units = []
            for s, n in W["inst_local"]["countBySido"].items():
                units += [{"sido": s} for _ in range(n)]
            return units
        if pop == "inst_public":
            # 주무부처 × 기관유형 (기후에너지환경부 산하 10의 유형 구성은 비공표 → 임의)
            table = {"env": {"public_corp": 1, "quasi": 5, "other_public": 4},
                     "other": {"public_corp": 27, "quasi": 42, "other_public": 203}}
            units = []
            for m, d in table.items():
                for o, n in d.items():
                    units += [{"ministry": m, "orgtype": o} for _ in range(n)]
            return units
        if pop == "inst_social":
            types = {"center": 72, "designated": 26, "nature_center": 2, "trainer": 3}
            regions = {"cap": 50, "yeongnam": 16, "honam": 10, "chungcheong": 21, "gangwon_jeju": 6}
            tkeys, rkeys = list(types), list(regions)
            joint = ipf_round_2d([[1.0] * 5 for _ in tkeys], [types[t] for t in tkeys], [regions[r] for r in rkeys])
            units = []
            for i, t in enumerate(tkeys):
                for j, r in enumerate(rkeys):
                    for _ in range(joint[i][j]):
                        units.append({"soctype": t, "sido": self._pick_sido_in_region(r)})
            return units
        if pop == "inst_univ":
            units = []
            # 교육대 7곳(수도권 2·비수도권 5), 그 외 34곳(수도권 8·비수도권 26) — 응답 기관 배치는 임의
            edu_sidos = ["11", "28", "27", "29", "44", "45", "43"]
            units += [{"univtype": "edu_univ", "sido": s} for s in edu_sidos]
            other = ["11"] * 5 + ["41"] * 2 + ["28"] + ["26"] * 3 + ["27"] * 2 + ["29"] * 2 + ["30"] * 2 + ["31"] + \
                    ["42"] * 2 + ["43"] * 2 + ["44"] * 2 + ["45"] * 2 + ["46"] * 2 + ["47"] * 3 + ["48"] * 3 + ["50"]
            units += [{"univtype": "other_univ", "sido": s} for s in other[:34]]
            return units
        if pop == "inst_school":
            w = W["inst_school"]
            levels = w["levelOrder"]
            # 응답 수를 시도별 설계 표본에 비례 배분
            units = []
            for j, l in enumerate(levels):
                design = [w["sampleBySidoLevel"][s][j] for s in sidos]
                alloc = largest_remainder(design, w["respondedByLevel"][j])
                for i, s in enumerate(sidos):
                    pop_n = w["populationBySidoLevel"][s][j]
                    wt = pop_n / alloc[i] if alloc[i] else 0
                    units += [{"level": l, "sido": s, "weight": wt} for _ in range(alloc[i])]
            return units
        if pop == "inst_early":
            w = W["inst_early"]
            kinds = w["kindOrder"]
            units = []
            for j, kd in enumerate(kinds):
                design = [w["sampleBySidoKind"][s][j] for s in sidos]
                alloc = largest_remainder(design, w["respondedByKind"][j])
                for i, s in enumerate(sidos):
                    pop_n = w["populationBySidoKind"][s][j]
                    wt = pop_n / alloc[i] if alloc[i] else 0
                    units += [{"kind": kd, "sido": s, "weight": wt} for _ in range(alloc[i])]
            return units
        raise SystemExit(f"프레임 정의 없음: {pop}")

    def _pick_sido_in_region(self, region):
        cands = [s for s, r in self.groups["region5"]["map"].items() if r == region]
        return self.rng.choice(cands)

    # ---- 문항 처리 순서(조건부 문항은 선행 문항 뒤로)
    def ordered_questions(self, pop):
        qs = [q for q in self.cb["questions"] if q["pop"] == pop]
        done, out, pending = set(), [], qs[:]
        for _ in range(len(qs) + 2):
            rest = []
            for q in pending:
                b = q.get("base") or {}
                need = b.get("qid")
                if need and need not in done and need != q["qid"]:
                    rest.append(q)
                else:
                    out.append(q)
                    done.add(q["qid"])
            pending = rest
            if not pending:
                break
        if pending:
            self.log.append(f"[경고] 선행 문항을 찾지 못한 조건부 문항: {[q['qid'] for q in pending]} → 전체 기준으로 생성")
            out += pending
        return out

    # ---- base 해석
    def base_units(self, frame, q, item_id=None):
        """조건부 문항의 대상 단위 인덱스. eq/in 값은 **0기준 보기 인덱스**(binary는 0/1)."""
        b = q.get("base")
        if not b:
            return list(range(len(frame)))
        if "dim" in b:
            return [i for i, u in enumerate(frame) if str(self.axis_value(u, b["dim"])) == str(b["eq"])]
        bq = self.qmap.get(b["qid"], {})
        btype = bq.get("type", "single")
        wanted = set()
        if "eq" in b:
            wanted.add(int(b["eq"]))
        if "in" in b:
            wanted |= {int(x) for x in b["in"]}
        neq = b.get("neq")
        idx = []
        if btype in ("multi", "events"):
            cols = [f"{b['qid']}__c{j + 1}" for j in sorted(wanted)]
            for i, u in enumerate(frame):
                if any((u.get(c) not in (None, "")) and float(u.get(c)) > 0 for c in cols):
                    idx.append(i)
            return idx
        col = b["qid"]
        if b.get("sameItem") and item_id is not None:
            col = f"{b['qid']}_{item_id}"
        elif b.get("item"):
            col = f"{b['qid']}_{b['item']}"
        one_based = btype in ("single", "likert5", "item_likert5", "item_cat")
        for i, u in enumerate(frame):
            v = u.get(col)
            if v in (None, ""):
                continue
            cat = int(float(v)) - (1 if one_based else 0)
            if neq is not None:
                if cat != int(neq):
                    idx.append(i)
            elif cat in wanted:
                idx.append(i)
        return idx

    # ---- 목표 분포 만들기
    def target_distributions(self, q, rows, k, ordered):
        """rows → {axis: {key: p(k)}}, p_all"""
        positive = q.get("positive") or []
        p_all = None
        rows = [dict(r, pct=[100.0 * (c or 0) / sum(x or 0 for x in r["counts"]) for c in r["counts"]])
                if (not r.get("pct") or any(v is None for v in r["pct"])) and r.get("counts") and sum(x or 0 for x in r["counts"]) > 0 else r
                for r in rows]
        rows = [dict(r, pct=[(v or 0) for v in r["pct"]]) if r.get("pct") and any(v is not None for v in r["pct"]) else r
                for r in rows]
        for r in rows:
            if r.get("by") == "all" and r.get("pct") and all(v is not None for v in r["pct"]):
                s = sum(r["pct"])
                if s > 0:
                    p_all = [v / s for v in r["pct"]]
        if p_all is None:
            allrow = next((r for r in rows if r.get("by") == "all"), None)
            if q["type"] in ("binary", "item_binary") and allrow and allrow.get("positive") is not None:
                p_all = [1 - allrow["positive"] / 100, allrow["positive"] / 100]
            elif allrow and ordered and allrow.get("mean") is not None:
                p_all = shift_to_mean(default_shape(k), allrow["mean"], allrow.get("sd"))
            elif allrow and ordered and allrow.get("positive") is not None and positive:
                p_all = shift_to_positive(default_shape(k), positive, allrow["positive"] / 100)
            else:
                p_all = default_shape(k) if ordered else [1 / k] * k
        targets = defaultdict(dict)
        for r in rows:
            if r.get("by") in (None, "all"):
                continue
            if (not r.get("pct") or any(v is None for v in r["pct"])) and r.get("counts") and any(r["counts"]):
                cs = [c or 0 for c in r["counts"]]
                r = dict(r, pct=[100.0 * c / sum(cs) for c in cs] if sum(cs) else None)
            p = None
            if r.get("pct") and all(v is not None for v in r["pct"]) and sum(r["pct"]) > 0:
                s = sum(r["pct"])
                p = [v / s for v in r["pct"]]
            elif q["type"] in ("binary", "item_binary") and r.get("positive") is not None:
                p = [1 - r["positive"] / 100, r["positive"] / 100]
            elif ordered and r.get("mean") is not None and r.get("positive") is not None and positive:
                p = shift_to_mean_positive(p_all, r["mean"], positive, r["positive"] / 100, r.get("sd"))
            elif ordered and r.get("mean") is not None:
                p = shift_to_mean(p_all, r["mean"], r.get("sd"))
            elif ordered and r.get("positive") is not None and positive:
                p = shift_to_positive(p_all, positive, r["positive"] / 100)
            elif (not ordered) and r.get("positive") is not None and positive:
                t_share = r["positive"] / 100
                s0 = sum(p_all[j] for j in positive)
                if 0 < s0 < 1:
                    p = [p_all[j] * (t_share / s0 if j in positive else (1 - t_share) / (1 - s0)) for j in range(k)]
            if p:
                targets[r["by"]][str(r["key"])] = p
        return p_all, targets

    # ---- 셀별 목표(IPF) 후 할당
    def allocate(self, frame, idx, k, p_all, targets, scores, ordered):
        """idx의 단위들에 0..k-1 범주를 배정해 dict{i: cat} 반환."""
        axes = [a for a in targets if any(self.axis_value(frame[i], a) is not None for i in idx)]
        cells = defaultdict(list)
        for i in idx:
            key = tuple(str(self.axis_value(frame[i], a)) for a in axes)
            cells[key].append(i)
        cell_keys = list(cells)
        W = {c: sum(frame[i]["weight"] for i in cells[c]) for c in cell_keys}
        N = {c: [W[c] * p for p in p_all] for c in cell_keys}
        # 축별 목표 합계
        for _ in range(60 if axes else 0):
            for ai, a in enumerate(axes):
                for key, p in targets[a].items():
                    members = [c for c in cell_keys if c[ai] == key]
                    if not members:
                        continue
                    Wg = sum(W[c] for c in members)
                    for j in range(k):
                        cur = sum(N[c][j] for c in members)
                        tgt = Wg * p[j]
                        if cur > 1e-12:
                            f = tgt / cur
                            for c in members:
                                N[c][j] *= f
                        elif tgt > 0:
                            for c in members:
                                N[c][j] = tgt * W[c] / Wg
                # 셀 합 보정(각 셀의 범주 합 = 셀 가중치)
                for c in cell_keys:
                    s = sum(N[c])
                    if s > 0:
                        N[c] = [v * W[c] / s for v in N[c]]
        # 비가중: 1차 축(공표 순서상 첫 축) 집단별 합계가 정확히 맞도록 셀 할당량을 정수화
        int_quota = {}
        weighted_any = any(frame[i]["weight"] != 1.0 for i in idx)
        if not weighted_any and axes:
            groups0 = defaultdict(list)
            for c in cell_keys:
                groups0[c[0]].append(c)
            for g, members_c in groups0.items():
                gsize = sum(len(cells[c]) for c in members_c)
                tot = [sum(N[c][j] for c in members_c) for j in range(k)]
                T = largest_remainder(tot, gsize)
                # 범주별로 셀에 배분
                alloc = {c: [0] * k for c in members_c}
                for j in range(k):
                    parts = largest_remainder([N[c][j] for c in members_c], T[j])
                    for c, v in zip(members_c, parts):
                        alloc[c][j] = v
                # 셀 크기 보정(범주 간 ±1 이동, 1차 축 합계는 불변)
                for _ in range(1000):
                    over = [c for c in members_c if sum(alloc[c]) > len(cells[c])]
                    under = [c for c in members_c if sum(alloc[c]) < len(cells[c])]
                    if not over or not under:
                        break
                    co, cu = over[0], under[0]
                    j = max(range(k), key=lambda j: alloc[co][j] - N[co][j])
                    alloc[co][j] -= 1
                    alloc[cu][j] += 1
                int_quota.update(alloc)
        assign = {}
        for c in cell_keys:
            members = cells[c]
            if ordered:
                members = sorted(members, key=lambda i: scores[i], reverse=True)
            else:
                members = members[:]
                self.rng.shuffle(members)
            weighted = any(frame[i]["weight"] != 1.0 for i in members)
            if not weighted:
                quotas = int_quota.get(c) or largest_remainder(N[c], len(members))
                if sum(quotas) != len(members):
                    quotas = largest_remainder(N[c], len(members))
                pos = 0
                for j in range(k - 1, -1, -1):  # 높은 범주부터(점수 내림차순)
                    for _ in range(quotas[j]):
                        assign[members[pos]] = j
                        pos += 1
            else:
                total = sum(frame[i]["weight"] for i in members)
                cum, j, acc = 0.0, k - 1, 0.0
                bounds = []
                for jj in range(k - 1, -1, -1):
                    acc += N[c][jj] * total / max(sum(N[c]), 1e-9)
                    bounds.append((jj, acc))
                bi = 0
                for i in members:
                    cum += frame[i]["weight"]
                    while bi < len(bounds) - 1 and cum > bounds[bi][1] + frame[i]["weight"] / 2:
                        bi += 1
                    assign[i] = bounds[bi][0]
        return assign

    # ---- 점수(잠재변수 + 임의효과)
    def make_scores(self, frame, idx, q, reverse=False, lam=0.55, item_key=None):
        pop = q["pop"]
        pdef = self.cb["populations"][pop]
        published = set()
        rows = self.sources[q["qid"]].get("rows") or []
        for r in rows:
            if r.get("by") not in (None, "all"):
                published.add(r["by"])
        secondary = [d for d in pdef["dims"] if d not in published and d not in ("coord",)]
        key = f"{q['qid']}|{item_key or ''}"
        srng = random.Random(f"{self.seed}|{key}")
        eff = {}
        for d in secondary:
            codes = self.codes[d]
            if d == "grade":
                eff[d] = {c: 0.06 * (i % 2) for i, c in enumerate(codes)}
            elif d == "tenure":
                eff[d] = {c: 0.04 * i for i, c in enumerate(codes)}
            else:
                eff[d] = {c: srng.gauss(0, 0.08) for c in codes}
        sign = -1.0 if reverse else 1.0
        sd_eps = math.sqrt(max(1 - lam * lam, 0.1))
        scores = {}
        for i in idx:
            u = frame[i]
            s = sign * lam * u["_z"] + srng.gauss(0, sd_eps)
            for d, m in eff.items():
                s += m.get(str(u.get(d)), 0.0)
            scores[i] = s
        return scores

    # ---- 전수 유형: 공표 행 직접 적재
    def census_fill(self, frame, q, col, rows, k, unit_dim):
        done = set()
        for r in rows:
            if r.get("by") != unit_dim:
                continue
            i = next((i for i, u in enumerate(frame) if str(u.get(unit_dim)) == str(r["key"])), None)
            if i is None:
                continue
            t = q["type"]
            if t in ("binary", "item_binary"):
                if r.get("pct") and r["pct"][1] is not None:
                    frame[i][col] = 1 if r["pct"][1] >= 50 else 0
                elif r.get("positive") is not None:
                    frame[i][col] = 1 if r["positive"] >= 50 else 0
                else:
                    continue
            elif t in ("single", "likert5", "item_likert5", "item_cat"):
                if r.get("pct") and any(v for v in r["pct"] if v):
                    frame[i][col] = max(range(k), key=lambda j: (r["pct"][j] or 0)) + 1
                else:
                    continue
            elif t == "numeric":
                if r.get("mean") is None:
                    continue
                frame[i][col] = r["mean"]
            elif t == "multi" and q.get("baseKind") in EVENT_BASE_KINDS:
                cnt = r.get("events") if r.get("events") is not None else r.get("n")
                if cnt is None:
                    continue
                owner = (q.get("base") or {}).get("qid") or q["qid"]
                if frame[i].get(f"{owner}__events") is None:
                    frame[i][f"{owner}__events"] = int(round(cnt))
                frame[i][f"{col}__base"] = int(round(cnt))
                if r.get("counts"):
                    for j in range(k):
                        frame[i][f"{col}__c{j + 1}"] = int(r["counts"][j] or 0)
                else:
                    pcts = r.get("pct") or [0] * k
                    for j in range(k):
                        frame[i][f"{col}__c{j + 1}"] = int(round((pcts[j] or 0) / 100 * cnt))
            elif t == "multi":
                for j in range(k):
                    v = (r.get("pct") or [None] * k)[j]
                    frame[i][f"{col}__c{j + 1}"] = (1 if (v or 0) >= 50 else 0)
            elif t == "rank":
                if r.get("r1") and any(v for v in r["r1"] if v):
                    frame[i][f"{col}__1"] = max(range(k), key=lambda j: (r["r1"][j] or 0)) + 1
                else:
                    continue
            elif t == "events":
                cnt = r.get("events")
                if cnt is None and r.get("counts"):
                    cnt = sum(c or 0 for c in r["counts"])
                if cnt is None and r.get("mean") is not None:
                    cnt = r["mean"]
                if cnt is None and r.get("n") is not None and q.get("baseKind") in EVENT_BASE_KINDS:
                    cnt = r["n"]
                if cnt is None:
                    continue
                owner = (q.get("base") or {}).get("qid") or q["qid"]
                if frame[i].get(f"{owner}__events") is None or t == "events":
                    frame[i][f"{owner}__events"] = int(round(cnt))
                frame[i][f"{col}__base"] = int(round(cnt))
                if r.get("counts"):
                    alloc = [int(c or 0) for c in r["counts"]]
                else:
                    pcts = r.get("pct") or [100 / k] * k
                    alloc = largest_remainder([(p or 0) for p in pcts], int(round(cnt)))
                for j in range(k):
                    frame[i][f"{col}__c{j + 1}"] = alloc[j]
            done.add(i)
        return done

    # ---- 문항 하나 생성
    def generate_question(self, frame, pop, q):
        src = self.sources[q["qid"]]
        t = q["type"]
        k = q["k"]
        pdef = self.cb["populations"][pop]
        census_dim = pdef.get("unitDim") if pdef.get("census") else None
        ordered = t in ("likert5", "item_likert5", "item_cat", "binary", "item_binary")
        if t.startswith("item_"):
            for it in q["items"]:
                col = f"{q['qid']}_{it['id']}"
                rows = (src.get("itemRows") or {}).get(it["id"], [])
                idx = self.base_units(frame, q, item_id=it["id"])
                kk = 2 if t == "item_binary" else k
                done = self.census_fill(frame, q, col, rows, kk, census_dim) if census_dim else set()
                rest = [i for i in idx if i not in done]
                if not rest:
                    continue
                p_all, targets = self.target_distributions(q, rows, kk, True)
                scores = self.make_scores(frame, rest, q, reverse=bool(it.get("reverse")), item_key=it["id"])
                assign = self.allocate(frame, rest, kk, p_all, targets, scores, True)
                for i, c in assign.items():
                    frame[i][col] = c if t == "item_binary" else c + 1
            return
        rows = src.get("rows") or []
        idx = self.base_units(frame, q)
        col = q["qid"]
        done = self.census_fill(frame, q, col, rows, k, census_dim) if census_dim else set()
        idx = [i for i in idx if i not in done]
        if not idx:
            return
        if t in ("likert5", "single", "binary"):
            p_all, targets = self.target_distributions(q, rows, k, ordered)
            det_axis = None
            for a, keys in targets.items():
                if keys and all(max(p) >= 0.999 for p in keys.values()):
                    det_axis = a
                    break
            if det_axis and not ordered:
                for i in idx:
                    p = targets[det_axis].get(str(self.axis_value(frame[i], det_axis)))
                    if p:
                        frame[i][col] = max(range(k), key=lambda j: p[j]) + 1
                idx = [i for i in idx if frame[i].get(col) is None]
                if not idx:
                    return
                for a in list(targets):
                    if a == det_axis:
                        targets.pop(a)
            scores = self.make_scores(frame, idx, q) if ordered else {}
            assign = self.allocate(frame, idx, k, p_all, targets, scores, ordered)
            for i, c in assign.items():
                frame[i][col] = c if t == "binary" else c + 1
        elif t == "multi":
            event_base = q["baseKind"] in EVENT_BASE_KINDS
            if event_base:
                self._generate_event_multi(frame, idx, q, rows, k)
                return
            for j in range(k):
                sub_rows = []
                for r in rows:
                    if r.get("pct") and r["pct"][j] is not None:
                        sub_rows.append({"by": r["by"], "key": r["key"], "positive": r["pct"][j]})
                qq = dict(q, type="binary", positive=[1])
                p_all, targets = self.target_distributions(qq, sub_rows, 2, True)
                scores = self.make_scores(frame, idx, q, item_key=f"c{j}", lam=0.3)
                assign = self.allocate(frame, idx, 2, p_all, targets, scores, True)
                for i, c in assign.items():
                    frame[i][f"{col}__c{j + 1}"] = c
        elif t == "rank":
            self._generate_rank(frame, idx, q, rows, k)
        elif t == "numeric":
            self._generate_numeric(frame, idx, q, rows)
        elif t == "events":
            if q.get("multi"):
                self._generate_event_multi(frame, idx, q, rows, k)
            else:
                self._generate_events(frame, idx, q, rows, k)

    def _generate_rank(self, frame, idx, q, rows, k):
        col = q["qid"]
        r1rows = [{"by": r["by"], "key": r["key"], "pct": r["r1"]} for r in rows if r.get("r1")]
        p_all, targets = self.target_distributions(dict(q, type="single"), r1rows, k, False)
        first = self.allocate(frame, idx, k, p_all, targets, {}, False)
        for i, c in first.items():
            frame[i][f"{col}__1"] = c + 1
        has = {key: any(r.get(key) for r in rows) for key in ("r12", "r123")}
        for pos in (2, 3):
            drows = []
            for r in rows:
                if not r.get("r1"):
                    continue
                d = None
                if pos == 2:
                    if r.get("r12"):
                        d = [max((r["r12"][j] or 0) - (r["r1"][j] or 0), 0) for j in range(k)]
                    elif r.get("r123") and not has["r12"]:
                        d = [max((r["r123"][j] or 0) - (r["r1"][j] or 0), 0) / 2 for j in range(k)]
                else:
                    if r.get("r123") and r.get("r12"):
                        d = [max((r["r123"][j] or 0) - (r["r12"][j] or 0), 0) for j in range(k)]
                    elif r.get("r123") and not has["r12"]:
                        d = [max((r["r123"][j] or 0) - (r["r1"][j] or 0), 0) / 2 for j in range(k)]
                if d is None:
                    continue
                drows.append({"by": r["by"], "key": r["key"], "pct": d + [max(100 - sum(d), 0)]})
            if not drows:
                break
            p_all, targets = self.target_distributions(dict(q, type="single"), drows, k + 1, False)
            cand = self.allocate(frame, idx, k + 1, p_all, targets, {}, False)
            axes = list(targets.keys())
            taken = {i: {int(frame[i][f"{col}__{p}"]) - 1 for p in range(1, pos) if frame[i].get(f"{col}__{p}")} for i in idx}
            # 셀별 할당량 = 후보 배정 집계 → 셀 안에서 탐욕 재배정(이미 고른 보기 제외)
            cells = defaultdict(list)
            for i in idx:
                cells[tuple(str(self.axis_value(frame[i], a)) for a in axes)].append(i)
            for members in cells.values():
                quota = [0.0] * (k + 1)
                for i in members:
                    quota[cand[i]] += frame[i]["weight"]
                remain = quota[:]
                order = members[:]
                self.rng.shuffle(order)
                # 선택지가 적은(이미 많이 고른) 단위부터 처리
                order.sort(key=lambda i: -len(taken[i]))
                for i in order:
                    w = frame[i]["weight"]
                    best, best_r = None, -1.0
                    for j in range(k):
                        if j in taken[i] or quota[j] <= 0:
                            continue
                        r = remain[j] / quota[j]
                        if r > best_r:
                            best, best_r = j, r
                    if best is None or best_r <= 0:
                        if remain[k] > 0 or best is None:
                            remain[k] -= w
                            continue
                    # 남은 '없음' 할당량과 비교: 없음 비율이 더 크면 없음 처리
                    if quota[k] > 0 and remain[k] / quota[k] > best_r:
                        remain[k] -= w
                        continue
                    remain[best] -= w
                    frame[i][f"{col}__{pos}"] = best + 1

    def _group_rows(self, rows, key):
        return [(r["by"], str(r["key"]), r[key]) for r in rows if r.get(key) is not None]

    def _generate_numeric(self, frame, idx, q, rows):
        col = q["qid"]
        b = q.get("base") or {}
        # 선행 YN 문항의 '건수' 역할: rows에 events(총 건수)가 있으면 이 값이 단위별 건수 열이 된다
        is_count_q = bool(b.get("qid")) and any(r.get("events") is not None for r in rows) and q["baseKind"] not in EVENT_BASE_KINDS
        if q["baseKind"] in EVENT_BASE_KINDS:
            return self._generate_numeric_per_event(frame, idx, q, rows)
        allrow = next((r for r in rows if r.get("by") == "all"), None)
        mean_all = (allrow or {}).get("mean")
        if mean_all is None and allrow and allrow.get("total") is not None:
            denom = allrow.get("n") or allrow.get("wn") or len(idx)
            mean_all = allrow["total"] / denom if denom else None
        if mean_all is None:
            vals = [r["mean"] for r in rows if r.get("mean") is not None]
            mean_all = sum(vals) / len(vals) if vals else 0.0
        decimals = q.get("decimals", 0)
        minv = q.get("min", 0)
        srng = random.Random(f"{self.seed}|{col}")
        # 로그정규 기본값(변동계수≈0.7) + 잠재변수 약한 반영
        vals = {}
        for i in idx:
            z = 0.35 * frame[i]["_z"] + srng.gauss(0, 0.65)
            vals[i] = math.exp(z - 0.65 ** 2 / 2 - 0.35 ** 2 / 2)
        groups = [(by, key, m) for by, key, m in self._group_rows(rows, "mean") if by != "all"]
        # 축별 평균을 반복 보정
        for _ in range(12):
            for by, key, m in groups:
                members = [i for i in idx if str(self.axis_value(frame[i], by)) == key]
                if not members:
                    continue
                wsum = sum(frame[i]["weight"] for i in members)
                cur = sum(vals[i] * frame[i]["weight"] for i in members) / wsum
                if cur > 0:
                    f = m / cur
                    for i in members:
                        vals[i] *= f
            wsum = sum(frame[i]["weight"] for i in idx)
            cur = sum(vals[i] * frame[i]["weight"] for i in idx) / wsum
            if cur > 0 and mean_all:
                f = mean_all / cur
                for i in idx:
                    vals[i] *= f
        for i in idx:
            v = max(vals[i], minv)
            frame[i][col] = round(v, decimals) if decimals else int(round(v))
        if is_count_q:
            ccol = f"{b['qid']}__events"
            for i in idx:
                frame[i][ccol] = max(int(round(frame[i][col])), 1)

    def _generate_numeric_per_event(self, frame, idx, q, rows):
        """건당 평균(예: 사업당 예산)을 단위별 총액으로 생성. 큐브에서는 sum/ev 로 복원."""
        col = q["qid"]
        ccol = self._event_count_col(frame, idx, q, rows)
        allrow = next((r for r in rows if r.get("by") == "all"), None)
        mean_all = (allrow or {}).get("mean")
        if mean_all is None and allrow and allrow.get("total") is not None:
            tot_ev = sum(frame[i][ccol] for i in idx) or 1
            mean_all = allrow["total"] / tot_ev
        decimals = q.get("decimals", 0)
        srng = random.Random(f"{self.seed}|{col}")
        per = {}
        for i in idx:
            z = 0.3 * frame[i]["_z"] + srng.gauss(0, 0.7)
            per[i] = math.exp(z - 0.7 ** 2 / 2 - 0.3 ** 2 / 2)
        groups = [(by, key, m) for by, key, m in self._group_rows(rows, "mean") if by != "all"]
        for _ in range(12):
            for by, key, m in groups:
                members = [i for i in idx if str(self.axis_value(frame[i], by)) == key]
                ev = sum(frame[i][ccol] * frame[i]["weight"] for i in members)
                cur = sum(per[i] * frame[i][ccol] * frame[i]["weight"] for i in members) / ev if ev else 0
                if cur > 0:
                    f = m / cur
                    for i in members:
                        per[i] *= f
            ev = sum(frame[i][ccol] * frame[i]["weight"] for i in idx)
            cur = sum(per[i] * frame[i][ccol] * frame[i]["weight"] for i in idx) / ev if ev else 0
            if cur > 0 and mean_all:
                f = mean_all / cur
                for i in idx:
                    per[i] *= f
        for i in idx:
            v = per[i] * frame[i][ccol]
            frame[i][col] = round(v, decimals) if decimals else int(round(v))

    def _event_count_col(self, frame, idx, q, rows):
        """사업/연수 등 '건' 기준 표의 단위당 건수 열(공유)."""
        b = q.get("base") or {}
        owner = b.get("qid") or q["qid"]
        ccol = f"{owner}__events"
        if all(frame[i].get(ccol) is not None for i in idx):
            return ccol
        allrow = next((r for r in rows if r.get("by") == "all"), None)
        mean = None
        if allrow:
            denom = allrow.get("n") or allrow.get("wn") or len(idx)
            if allrow.get("mean") is not None and q["type"] == "events" and not q.get("fromNumeric"):
                mean = allrow["mean"]
            elif allrow.get("events") and denom:
                mean = allrow["events"] / denom
            elif allrow.get("total") is not None and denom:
                mean = allrow["total"] / denom
            elif allrow.get("counts") and denom:
                mean = sum(c or 0 for c in allrow["counts"]) / denom
        if not mean or mean < 1:
            mean = 1.3
        srng = random.Random(f"{self.seed}|{ccol}")
        for i in idx:
            if frame[i].get(ccol) is None:
                lam = max(mean - 1, 0.05)
                # 포아송(λ) + 1
                L, kk, p = math.exp(-lam), 0, 1.0
                while True:
                    p *= srng.random()
                    if p <= L:
                        break
                    kk += 1
                frame[i][ccol] = 1 + kk
        return ccol

    def _generate_events(self, frame, idx, q, rows, k):
        col = q["qid"]
        ccol = self._event_count_col(frame, idx, q, rows)
        self._spread_events(frame, idx, q, rows, k, col, ccol, exclusive=True)

    def _generate_event_multi(self, frame, idx, q, rows, k):
        col = q["qid"]
        ccol = self._event_count_col(frame, idx, q, rows)
        self._spread_events(frame, idx, q, rows, k, col, ccol, exclusive=False)

    def _spread_events(self, frame, idx, q, rows, k, col, ccol, exclusive):
        """단위별 건수를 범주로 배분. exclusive=True면 건마다 범주 하나, False면 건마다 여러 범주 가능."""
        # 건 단위 목록 만들기
        events = []
        for i in idx:
            frame[i][f"{col}__base"] = int(frame[i][ccol])
            for e in range(int(frame[i][ccol])):
                events.append(i)
        srng = random.Random(f"{self.seed}|{col}")
        # 집단별 목표 비율
        if exclusive:
            qq = dict(q, type="single")
            p_all, targets = self.target_distributions(qq, rows, k, False)
            pseudo = [dict(frame[i], weight=frame[i]["weight"]) for i in events]
            assign = self._allocate_pseudo(pseudo, k, p_all, targets, srng)
            counts = defaultdict(lambda: [0] * k)
            for e, i in enumerate(events):
                counts[i][assign[e]] += 1
            for i in idx:
                for j in range(k):
                    frame[i][f"{col}__c{j + 1}"] = counts[i][j]
        else:
            for j in range(k):
                sub_rows = [{"by": r["by"], "key": r["key"], "positive": r["pct"][j]} for r in rows
                            if r.get("pct") and r["pct"][j] is not None]
                qq = dict(q, type="binary", positive=[1])
                p_all, targets = self.target_distributions(qq, sub_rows, 2, True)
                pseudo = [dict(frame[i], weight=frame[i]["weight"]) for i in events]
                assign = self._allocate_pseudo(pseudo, 2, p_all, targets, srng)
                counts = defaultdict(int)
                for e, i in enumerate(events):
                    counts[i] += assign[e]
                for i in idx:
                    frame[i][f"{col}__c{j + 1}"] = counts[i]

    def _allocate_pseudo(self, pseudo, k, p_all, targets, srng):
        """건 단위 pseudo 프레임에 대한 할당(무작위 순서)."""
        idx = list(range(len(pseudo)))
        scores = {i: srng.random() for i in idx}
        saved = self.rng
        self.rng = srng
        try:
            return self.allocate(pseudo, idx, k, p_all, targets, scores, True)
        finally:
            self.rng = saved

    # ---- 모집단 전체 실행
    def run_pop(self, pop):
        pdef = self.cb["populations"][pop]
        frame = self.build_frame(pop)
        qs = self.ordered_questions(pop)
        for q in qs:
            if q["qid"] not in self.sources:
                self.log.append(f"[경고] {q['qid']} 공표표 없음 → 건너뜀")
                continue
            self.generate_question(frame, pop, q)
        self.write_csv(pop, pdef, frame, qs)
        return len(frame), len(qs)

    def write_csv(self, pop, pdef, frame, qs):
        OUT.mkdir(parents=True, exist_ok=True)
        cols = ["id"] + pdef["dims"] + (["weight"] if pdef.get("weighted") else [])
        for q in qs:
            t = q["type"]
            if t.startswith("item_"):
                cols += [f"{q['qid']}_{it['id']}" for it in q["items"]]
            elif t in ("multi", "events"):
                cols += [f"{q['qid']}__c{j + 1}" for j in range(q["k"])]
            elif t == "rank":
                cols += [f"{q['qid']}__{p}" for p in (1, 2, 3) if any(f"{q['qid']}__{p}" in u for u in frame)]
            else:
                cols.append(q["qid"])
        # 이벤트 건수 열
        extra = sorted({c for u in frame for c in u if c.endswith("__events")})
        cols += extra
        path = OUT / f"{pop}.csv"
        with path.open("w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(cols)
            for u in frame:
                row = []
                for c in cols:
                    v = u.get(c, "")
                    if c == "weight" and v != "":
                        v = round(v, 4)
                    row.append("" if v is None else v)
                w.writerow(row)
        self.log.append(f"{path.name}: {len(frame)}행 × {len(cols)}열")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("survey", nargs="?", choices=["school", "status", "all"], default="all")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--pop", help="특정 모집단만")
    args = ap.parse_args(argv)
    keys = ["school", "status"] if args.survey == "all" else [args.survey]
    for key in keys:
        g = Generator(key, seed=args.seed)
        for pop in g.cb["populations"]:
            if args.pop and pop != args.pop:
                continue
            if not any(q["pop"] == pop for q in g.cb["questions"]):
                print(f"  {pop}: 문항 없음(전사 전) → 건너뜀")
                continue
            n, nq = g.run_pop(pop)
            print(f"  {pop}: 단위 {n}, 문항 {nq}")
        for line in g.log:
            print("  ", line)


if __name__ == "__main__":
    main()
