"""큐브 생성기 단위 테스트: 조건부 문항, 가중 추정, 건 기준 표, 사전 마스킹, 축 축소, 실데이터 드라이런.

실행: python -m unittest tests/test_build_cubes.py
"""
import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import build_cubes  # noqa: E402

CB = json.loads((ROOT / "data" / "codebook" / "school_survey.json").read_text(encoding="utf-8"))
ST = json.loads((ROOT / "data" / "codebook" / "status_survey.json").read_text(encoding="utf-8"))


def rows_student(n=40):
    """학생 가짜 원자료: 초5 서울 특광역시 남 20명, 고1 경기 중소도시 여 20명."""
    out = []
    for i in range(n):
        a = i < n // 2
        out.append({"id": f"X{i}", "grade": "E5" if a else "H1", "sido": "11" if a else "41", "urban": "metro" if a else "city", "gender": "M" if a else "F",
                    "S01": "5" if a else "3", "S07_lecture": "1" if a else "0", "S07E_lecture": "4" if a else "", "S04__1": "1", "S04__2": "2"})
    return out


class CubeTests(unittest.TestCase):
    def test_conditional_base_counts(self):
        b = build_cubes.CubeBuilder(CB, "student")
        cube = b.build(rows_student())
        s01 = cube["questions"]["S01"]
        self.assertEqual(sum(s01["n"]), 40)
        eff = cube["questions"]["S07E_lecture"]
        self.assertEqual(sum(eff["n"]), 20, "경험자(20명)만 효과성 응답")
        r12 = cube["questions"]["S04_r12"]
        self.assertEqual(sum(r12["n"]), 40)
        self.assertEqual(sum(r12["v"]), 80, "1+2순위는 응답자당 2개")

    def test_weighted_and_events(self):
        b = build_cubes.CubeBuilder(ST, "inst_school")
        rows = [{"id": "A", "level": "E", "sido": "11", "weight": "6.2", "SCH_PLAN_YN": "1", "SCH_EXT_YN": "1", "SCH_EXT_YN__events": "2", "SCH_EXT_SOURCE__c1": "1", "SCH_EXT_SOURCE__c5": "1", "SCH_EXT_SOURCE__base": "2"},
                {"id": "B", "level": "M", "sido": "41", "weight": "3.7", "SCH_PLAN_YN": "0", "SCH_EXT_YN": "0"}]
        cube = b.build(rows)
        self.assertTrue(cube["weighted"])
        plan = cube["questions"]["SCH_PLAN_YN"]
        self.assertAlmostEqual(sum(plan["b"]), 9.9, places=3)
        self.assertAlmostEqual(sum(plan["v"][1::2]), 6.2, places=3, msg="있음 가중합")
        src = cube["questions"]["SCH_EXT_SOURCE"]
        self.assertEqual(sum(src["n"]), 1)
        self.assertAlmostEqual(sum(src["sum"]), 6.2 * 2, places=3, msg="사업 건수 가중합")

    def test_suppress_and_coarsen(self):
        b = build_cubes.CubeBuilder(CB, "student", suppress_min=25)
        cube = b.build(rows_student(40))
        self.assertEqual(cube["nUnits"], 0, "20명짜리 셀 두 개 모두 마스킹")
        b2 = build_cubes.CubeBuilder(CB, "student", coarsen={"sido": "region5s"})
        cube2 = b2.build(rows_student(40))
        self.assertIn("region5s", cube2["dims"])
        self.assertNotIn("sido", cube2["dims"])
        self.assertEqual(cube2["nUnits"], 40)

    def test_real_dry_run_cli(self):
        """--real 모드 드라이런: 임시 폴더에 10행짜리 CSV를 두고 큐브가 생성되는지."""
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "src"; out = Path(td) / "out"; src.mkdir()
            rows = rows_student(10)
            with (src / "student.csv").open("w", newline="", encoding="utf-8-sig") as f:
                w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
            build_cubes.main(["school", "--src", str(src), "--out", str(out), "--pop", "student", "--suppress-min", "3"])
            cube = json.loads((out / "student.json").read_text(encoding="utf-8"))
            self.assertEqual(cube["schemaVersion"], 1)
            self.assertEqual(cube["nUnits"], 10)
            self.assertTrue((out / "manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
