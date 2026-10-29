#!/usr/bin/env python3
"""data/source/*.json 구조 검사기.

사용: python -I tools/check_source.py data/source/s1_students.json [...]
숫자 자체가 보고서와 같은지는 사람이 확인해야 하지만, 구조·합계·길이 오류는 여기서 잡습니다.
"""
import json
import sys
from pathlib import Path

TYPES = {"likert5", "single", "binary", "multi", "rank", "item_likert5", "item_cat",
         "item_binary", "numeric", "events"}
SCALE_LEN = {"likert5": 5, "severity5": 5, "agree5": 5, "interest5": 5, "aware3": 3, "yn": 2}
BY_KEYS = {"all", "level", "grade", "sido", "urban", "gender", "role", "coord", "tenure",
           "region5s", "region5", "kind", "metro", "univtype", "ministry", "orgtype", "unit",
           "soctype", "legal"}
BASE_KINDS = {"응답자", "기관", "가중 기관 수", "사업 건", "계획 건", "연수 건", "시설 건", "교보재 건",
              "조례 건", "법령 건", "회의체 건", "과목 건", "동아리 건"}
REQUIRED = ["qid", "label", "short", "section", "type", "baseKind", "source"]


def approx(total, target, tol):
    return abs(total - target) <= tol


def check_row(tbl, row, ncat, errs, warns, where):
    by = row.get("by")
    if by not in BY_KEYS:
        errs.append(f"{where}: by '{by}' 허용 목록에 없음")
    if "key" not in row:
        errs.append(f"{where}: key 없음")
    t = tbl["type"]
    for k in ("pct", "r1", "r12", "r123", "bins"):
        if k in row and row[k] is not None:
            arr = row[k]
            if not isinstance(arr, list):
                errs.append(f"{where}: {k} 배열 아님"); continue
            if ncat and len(arr) != ncat:
                errs.append(f"{where}: {k} 길이 {len(arr)} ≠ 보기 수 {ncat}")
            vals = [v for v in arr if isinstance(v, (int, float))]
            s = sum(vals)
            if k == "pct" and t in ("likert5", "single", "binary", "item_cat"):
                if not approx(s, 100, 1.6):
                    errs.append(f"{where}: pct 합 {s:.1f} (100 기대)")
            if k == "pct" and t == "events" and not approx(s, 100, 1.6) and not tbl.get("multi"):
                warns.append(f"{where}: events pct 합 {s:.1f}")
            if k == "r1" and not approx(s, 100, 1.6):
                errs.append(f"{where}: r1 합 {s:.1f} (100 기대)")
            if k == "r12" and not (150 <= s <= 201.6):
                warns.append(f"{where}: r12 합 {s:.1f} (≈200 기대)")
            if k == "r123" and not (200 <= s <= 301.6):
                warns.append(f"{where}: r123 합 {s:.1f} (≈300 기대)")
    for k in ("mean", "sd", "positive", "n", "wn", "rse", "events"):
        if k in row and row[k] is not None and not isinstance(row[k], (int, float)):
            errs.append(f"{where}: {k} 숫자 아님")
    if t == "numeric" and "mean" not in row and "bins" not in row:
        warns.append(f"{where}: numeric인데 mean/bins 없음")


def check_file(path):
    errs, warns = [], []
    try:
        doc = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception as e:  # noqa
        return [f"JSON 파싱 실패: {e}"], []
    for k in ("schemaVersion", "survey", "pop", "tables"):
        if k not in doc:
            errs.append(f"최상위 {k} 없음")
    qids = set()
    for i, tbl in enumerate(doc.get("tables", [])):
        where = f"tables[{i}] {tbl.get('qid','?')}"
        for k in REQUIRED:
            if k not in tbl:
                errs.append(f"{where}: {k} 없음")
        qid = tbl.get("qid")
        if qid in qids:
            errs.append(f"{where}: qid 중복")
        qids.add(qid)
        t = tbl.get("type")
        if t not in TYPES:
            errs.append(f"{where}: type '{t}' 미지원"); continue
        if tbl.get("baseKind") not in BASE_KINDS:
            errs.append(f"{where}: baseKind '{tbl.get('baseKind')}' 미지원")
        if not isinstance(tbl.get("source"), list) or not tbl["source"]:
            errs.append(f"{where}: source 배열 필요")
        else:
            for s in tbl["source"]:
                if "pdf" not in s or "ref" not in s:
                    errs.append(f"{where}: source에 ref/pdf 필요")
        ncat = None
        if t in ("likert5", "item_likert5"):
            sc = tbl.get("scale", "likert5")
            if sc not in SCALE_LEN:
                errs.append(f"{where}: scale '{sc}' 미지원")
            else:
                ncat = SCALE_LEN[sc]
        elif t == "item_cat":
            sc = tbl.get("scale")
            if sc in SCALE_LEN:
                ncat = SCALE_LEN[sc]
            elif tbl.get("categories"):
                ncat = len(tbl["categories"])
            else:
                errs.append(f"{where}: item_cat은 scale 또는 categories 필요")
        elif t == "binary":
            ncat = 2
        elif t in ("single", "multi", "rank", "events", "numeric"):
            cats = tbl.get("categories")
            if t != "numeric" and not cats:
                errs.append(f"{where}: categories 필요")
            ncat = len(cats) if cats else None
        if t.startswith("item_"):
            items = tbl.get("items") or []
            if not items:
                errs.append(f"{where}: items 필요")
            ids = [it.get("id") for it in items]
            if len(set(ids)) != len(ids):
                errs.append(f"{where}: items id 중복")
            ir = tbl.get("itemRows") or {}
            for it in ids:
                rows = ir.get(it)
                if not rows:
                    errs.append(f"{where}: itemRows['{it}'] 없음"); continue
                for j, row in enumerate(rows):
                    check_row(tbl, row, ncat if t != "item_binary" else None, errs, warns, f"{where} item {it} row {j}")
        else:
            rows = tbl.get("rows") or []
            if not rows:
                errs.append(f"{where}: rows 비어 있음")
            for j, row in enumerate(rows):
                check_row(tbl, row, ncat, errs, warns, f"{where} row {j}")
        base = tbl.get("base")
        if base and "qid" in base and base["qid"] not in qids and base["qid"] != qid:
            # 선행 문항이 아직 안 나왔을 수 있으므로 경고만
            warns.append(f"{where}: base qid '{base['qid']}'가 앞에 정의되지 않음(순서 확인)")
    return errs, warns


def main(argv):
    if len(argv) < 2:
        print(__doc__); return 2
    bad = 0
    for p in argv[1:]:
        errs, warns = check_file(p)
        doc_tables = 0
        try:
            doc_tables = len(json.loads(Path(p).read_text(encoding="utf-8")).get("tables", []))
        except Exception:
            pass
        print(f"== {p}: 표 {doc_tables}개, 오류 {len(errs)}, 경고 {len(warns)}")
        for e in errs:
            print("  [오류]", e)
        for w in warns:
            print("  [경고]", w)
        bad += len(errs)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
