#!/usr/bin/env python3
"""코드북 생성기: data/codebook/base_<survey>.json + data/source/*.json → data/codebook/<survey>.json

코드북 = 대시보드와 데이터 도구가 공유하는 '데이터 계약'. 문항 메타데이터(라벨·보기·척도·축·조건)만 담고
공표 수치(rows)는 담지 않습니다.

사용: python tools/build_codebook.py            # 두 조사 모두
      python tools/build_codebook.py school      # school_survey 만
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "source"
CB = ROOT / "data" / "codebook"

SURVEYS = {"school": "school_survey", "status": "status_survey"}
EVENT_KINDS = {"사업 건", "계획 건", "연수 건", "시설 건", "교보재 건", "조례 건", "법령 건", "회의체 건", "과목 건", "동아리 건"}


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def dump(p, obj):
    Path(p).write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")


def cube_keys(tbl):
    """표 하나가 큐브에 만드는 키 목록."""
    t = tbl["type"]
    q = tbl["qid"]
    if t.startswith("item_"):
        return [f"{q}_{it['id']}" for it in tbl["items"]]
    if t == "rank":
        keys = []
        rows = tbl.get("rows") or []
        for r in ("r1", "r12", "r123"):
            if any(r in row and row[r] is not None for row in rows):
                keys.append(f"{q}_{r}")
        return keys or [f"{q}_r1"]
    return [q]


def category_count(tbl, scales):
    t = tbl["type"]
    if t in ("likert5", "item_likert5"):
        return len(scales[tbl.get("scale", "likert5")])
    if t == "item_cat":
        return len(scales[tbl["scale"]]) if tbl.get("scale") in scales else len(tbl["categories"])
    if t in ("binary", "item_binary"):
        return 2
    if t == "numeric":
        return len(tbl.get("categories") or [])
    return len(tbl.get("categories") or [])


def build(survey_key):
    survey = SURVEYS[survey_key]
    base = load(CB / f"base_{survey_key}.json")
    scales = base.get("scales", {})
    questions = []
    seen = set()
    for pop, pdef in base["populations"].items():
        for fname in pdef.get("sources", []):
            fp = SRC / fname
            if not fp.exists():
                print(f"  [건너뜀] {fname} 없음 (pop {pop})")
                continue
            doc = load(fp)
            if doc.get("pop") != pop:
                print(f"  [경고] {fname}: pop '{doc.get('pop')}' ≠ '{pop}'")
            for tbl in doc["tables"]:
                qid = tbl["qid"]
                if qid in seen:
                    raise SystemExit(f"qid 중복: {qid} ({fname})")
                seen.add(qid)
                if tbl["type"] == "numeric" and tbl.get("categories"):
                    tbl = dict(tbl, type="events", fromNumeric=True)
                if tbl["type"] == "single" and tbl.get("baseKind") in EVENT_KINDS:
                    tbl = dict(tbl, type="events")   # 건(사업·연수…) 기준 단일응답 = 건별 범주
                q = {
                    "qid": qid, "pop": pop, "survey": survey,
                    "label": tbl["label"], "short": tbl.get("short") or tbl["label"],
                    "section": tbl["section"], "indicator": tbl.get("indicator"),
                    "type": tbl["type"], "scale": tbl.get("scale"),
                    "categories": tbl.get("categories") or (scales.get(tbl.get("scale")) if tbl.get("scale") else None),
                    "items": tbl.get("items"), "positive": tbl.get("positive"),
                    "base": tbl.get("base"), "baseKind": tbl["baseKind"],
                    "source": tbl["source"], "sourceFile": fname, "notes": tbl.get("notes"),
                    "k": category_count(tbl, scales), "cubeKeys": cube_keys(tbl),
                }
                if tbl["type"] == "numeric":
                    q["bins"] = tbl.get("bins") or tbl.get("categories")
                    q["unit"] = tbl.get("unit")
                    q["decimals"] = tbl.get("decimals", 0)
                    q["min"] = tbl.get("min", 0)
                if tbl.get("multi"):
                    q["multi"] = True
                if tbl.get("fromNumeric"):
                    q["fromNumeric"] = True
                # 공표 분해 축(어느 축의 값이 보고서에 있는지) — 화면에서 '공표값 일치 축' 표시용
                axes = []
                rows = tbl.get("rows") or []
                if tbl["type"].startswith("item_"):
                    rows = [r for rs in (tbl.get("itemRows") or {}).values() for r in rs]
                for r in rows:
                    if r.get("by") and r["by"] != "all" and r["by"] not in axes:
                        axes.append(r["by"])
                q["publishedBy"] = axes
                questions.append(q)
    out = {k: v for k, v in base.items()}
    out["questions"] = questions
    out["generatedFrom"] = sorted({q["sourceFile"] for q in questions})
    dump(CB / f"{survey}.json", out)
    print(f"{survey}.json: 문항 {len(questions)}개, 큐브 키 {sum(len(q['cubeKeys']) for q in questions)}개")
    return out


def main(argv):
    keys = [a for a in argv[1:] if a in SURVEYS] or list(SURVEYS)
    for k in keys:
        build(k)


if __name__ == "__main__":
    main(sys.argv)
