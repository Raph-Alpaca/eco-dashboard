# 환경교육 조사 결과 대시보드 (프로토타입)

> **먼저 읽기:** `index.html`을 더블클릭하면 동작하지 않습니다(브라우저가 로컬 파일에서 모듈·데이터 읽기를 막음).
> 폴더의 **`서버실행.bat`** 을 더블클릭하거나, 배포 주소 **https://raph-alpaca.github.io/eco-dashboard/** 로 접속하세요.

2025년 **학교환경교육 현황조사**(교육부·한국환경보전원)와 2025년 **환경교육 실태조사**(기후에너지환경부·한국환경보전원, 국가승인통계 제106037호) 결과를
학교급·학년·지역·기관유형별로 살펴보고, 패널을 바꾸고, 교차분석하고, 보고서(PDF)로 뽑을 수 있는 대시보드입니다.

**이 저장소의 모든 수치는 보고서에 공표된 값에 맞춰 만든 합성(synthetic) 데이터이며 실제 응답 자료가 아닙니다.**
실제 데이터는 저장소 밖(`data/real/`, git 제외)에서 집계 큐브로 변환해 교체합니다. 원자료는 화면으로 가지 않습니다.

화면 디자인은 **국가기후에너지환경교육플랫폼(keep.go.kr)** 의 양식(Noto Sans KR 글꼴, 초록 `#15875f`·파랑 `#237db1`, 흰 헤더와 주요 메뉴, 둥근 카드, 위쪽 굵은 선 표, 회색 링크 띠 푸터)을 따릅니다. 홈페이지에 연계했을 때 이질감이 없도록 한 것으로, 색·글꼴은 `css/app.css` 맨 위의 변수에서 바꿉니다.

## 무엇이 들어 있나

| 폴더 | 내용 |
|---|---|
| `index.html`, `js/`, `css/` | 화면(빌드 없이 동작하는 정적 사이트, ES 모듈 + Apache ECharts) |
| `vendor/echarts.min.js` | 차트 라이브러리(Apache-2.0, 5.6.0) — 내부망에서도 동작하도록 포함 |
| `data/codebook/` | 코드북(문항·보기·척도·축 정의) = 데이터 계약 |
| `data/source/` | 보고서 공표 수치 전사(JSON, 출처 표·그림·PDF 쪽수 포함) |
| `data/synthetic/` | 합성 원자료 CSV(응답자·기관 단위) |
| `data/cubes/` | 대시보드가 읽는 집계 큐브(JSON) |
| `data/real/` | 실데이터 양식(헤더만). 실제 파일은 커밋되지 않음 |
| `data/validation_report.md` | 큐브 재집계 vs 공표값 자동 비교 결과 |
| `tools/` | 코드북 생성·합성 생성·큐브 생성·검증 스크립트(파이썬 표준 라이브러리만) |
| `tests/` | 큐브 생성기 단위 테스트, JS/파이썬 집계 패리티 테스트 |
| `docs/` | 홈페이지 연계 단계 안내, 데이터 규격, 사용 안내 |

## 로컬 실행

```
서버실행.bat            # 또는: python -m http.server 8000  → http://localhost:8000
```

## 데이터 다시 만들기

```
python tools/build_codebook.py        # 코드북
python tools/generate_synthetic.py    # 합성 원자료 (seed 42, 결정적)
python tools/build_cubes.py           # 집계 큐브
python tools/validate.py              # 공표값 대조 → data/validation_report.md
python -m unittest tests/test_build_cubes.py
node --test tests/
```

## 실데이터로 바꾸기(요약)

1. `data/real/TEMPLATE_*.csv` 양식으로 원자료 CSV 준비
2. 기관 내부 PC에서 `python tools/build_cubes.py --real --suppress-min 30 --coarsen sido=region5s`
3. `data/cubes/*.json`만 배포, `config.js`의 `synthetic:false`·`dataLabel` 수정

자세한 내용: [docs/data-spec.md](docs/data-spec.md) · 홈페이지 연계: [docs/integration-roadmap.md](docs/integration-roadmap.md) · 사용법: [docs/dashboard-guide.md](docs/dashboard-guide.md)

## 출처
- 2025년 학교환경교육 현황조사 결과보고서 (교육부·17개 시·도교육청·한국환경보전원, 2025.12, 발간등록번호 KECI-B55098-202602-10)
- 2025년 환경교육 실태조사 기술통계보고서 (기후에너지환경부·한국환경보전원, 2025.12, 발간등록번호 11-1482000-100081-10)

## 라이선스
코드: MIT. 합성 데이터: 자유 이용(출처 표기 권장). 보고서 원문의 저작권은 발간 기관에 있습니다.
