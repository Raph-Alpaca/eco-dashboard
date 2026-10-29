# data/synthetic — 합성 원자료

`tools/generate_synthetic.py`(seed 42)가 `data/source/*.json`(보고서 공표 수치)에 맞춰 만든 **가짜 응답 자료**입니다.
실제 응답자·기관의 자료가 아니며, 공표된 집단(학교급·교원구분·권역·기관유형 등)의 주변분포만 보고서와 같습니다.
공표되지 않은 축(학년·시도·성별 등)의 차이와 문항 간 상관은 임의로 만든 것입니다.

| 파일 | 단위 | 행 수 |
|---|---|---|
| student.csv | 학생 | 13,071 |
| teacher.csv | 교원(담당교원 306명 포함, `coord`=1) | 5,808 |
| inst_central.csv ~ inst_univ.csv | 기관(9종) | 6 / 17 / 226 / 282 / 103 / 17 / 979 / 2,937 / 41 |

열 규칙은 `docs/data-spec.md` 3장을 보세요. 실데이터도 같은 열 이름으로 준비하면 `tools/build_cubes.py --real` 로 바로 큐브를 만들 수 있습니다.
