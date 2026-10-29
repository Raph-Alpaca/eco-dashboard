# data/source/*.json — 보고서 공표 수치 전사 규격 (schemaVersion 1)

이 폴더의 JSON은 **보고서에 인쇄된 숫자를 그대로 옮긴 것**입니다. 합성 데이터의 목표값이자,
대시보드 코드북(문항·보기·척도)의 원천입니다. 숫자는 보고서와 1:1로 일치해야 하며,
인쇄 오류를 보정한 경우 반드시 `notes`에 근거를 적습니다.

## 파일 하나 = 모집단(pop) 하나

```json
{
  "schemaVersion": 1,
  "survey": "school_survey",            // school_survey(현황조사) | status_survey(실태조사)
  "pop": "student",                     // student | teacher | inst_central | inst_metro | inst_local | inst_public |
                                        // inst_social | inst_edu_office | inst_early | inst_school | inst_univ
  "sourceDoc": "2025년 학교환경교육 현황조사 결과보고서 (교육부·한국환경보전원, 2025.12)",
  "tables": [ { ...표 하나... }, ... ]
}
```

## 표(table) 객체

| 필드 | 필수 | 설명 |
|---|---|---|
| `qid` | ✔ | 문항 id. 영문 대문자+숫자+밑줄. 예 `S01`, `T14`, `SCH_PLAN_YN` |
| `label` | ✔ | 문항 전체 제목(보고서 표현) |
| `short` | ✔ | 카드 제목용 짧은 이름(20자 내) |
| `section` | ✔ | 보고서 영역명. 예 `관심도`, `학습경험`, `성과와 개선`, `계획`, `조직/인력`, `사업/예산`, `시설`, `연수`, `거버넌스` |
| `indicator` | 실태조사 공통지표만 | `law`(법령/조례) `plan`(계획) `staff`(담당부서·인력) `affiliate`(산하기관) `program`(자체사업) `facility`(시설) `training`(연수) `council`(회의체) `material`(교보재) `educator`(환경교육사). 해당 없으면 생략 |
| `type` | ✔ | 아래 표 참고 |
| `scale` | likert류 | 척도 이름: `likert5` `severity5` `agree5` `interest5` `aware3` `yn` (코드북 base의 scales) |
| `categories` | 범주형 | 보기 라벨 배열. `single` `multi` `rank` `binary` `events` `item_cat`(공통 보기) `numeric`(구간 라벨) |
| `items` | item_* | `[{"id":"1","label":"...","reverse":false}]` — id는 짧은 영숫자 |
| `positive` | 선택 | 긍정으로 묶는 보기 인덱스(0기준). 예 5점 척도 `[3,4]`, 인지도 `[2]` |
| `base` | 조건부 문항 | `{"qid":"S07","item":"1","eq":1}` 또는 `{"dim":"coord","eq":"1"}`. 없으면 생략(전체) |
| `baseKind` | ✔ | `응답자` `기관` `가중 기관 수` `사업 건` `계획 건` `연수 건` 중 하나 |
| `source` | ✔ | `[{"ref":"표 4-44","pdf":266}]` — PDF 뷰어 쪽수(본문 쪽수 아님) |
| `notes` | 선택 | 보정·주의 사항 |
| `rows` | ✔(item_* 제외) | 공표된 집단별 수치(아래) |
| `itemRows` | item_* | `{"1":[rows...], "2":[rows...]}` |

### type 별 rows 값

| type | 응답 1개의 의미 | rows에 들어가는 값 |
|---|---|---|
| `likert5` | 1~5 중 하나 | `pct`(5개, 합≈100) 또는 `mean`(+`sd`), `positive`(%) |
| `single` | 보기 중 하나 | `pct`(보기 수만큼) |
| `binary` | 없음/있음 | `pct`=[없음%, 있음%] 또는 `positive`(있음%) |
| `multi` | 보기별 예/아니오 | `pct`(보기별 "예" %) |
| `rank` | 1·2·3순위 선택 | `r1`, `r12`, `r123`(보기별 %) 중 공표된 것 |
| `item_likert5` | 항목별 1~5 | itemRows: `mean`(+`sd`), `pct`, `positive` |
| `item_cat` | 항목별 보기 하나 | itemRows: `pct` |
| `item_binary` | 항목별 예/아니오 | itemRows: `positive`(예 %) |
| `numeric` | 숫자(시간·건수·원) | `mean`(+`sd`,`rse`), 선택 `bins`(구간별 %) |
| `events` | 기관이 보유한 건(사업 등)의 범주 구성 | `n`(기관 수), `events`(총 건수), `mean`(기관당 건수), `pct`(건 기준 범주 %) |

### row 객체

```json
{"by":"level","key":"E","n":4868,"wn":null,"pct":[...],"mean":4.03,"sd":0.92,"positive":78.1}
```
- `by`: 분해 축 이름. 전체는 `"all"`/`"all"`. 축 이름은 코드북 dims 또는 groups 이름(`level` `grade` `sido` `urban` `gender` `role` `coord` `tenure` `region5s` `region5` `kind` `metro` `univtype` `ministry` `orgtype` `unit`).
- `key`: 축의 코드. 시도는 행정코드 2자리(11 서울 26 부산 27 대구 28 인천 29 광주 30 대전 31 울산 36 세종 41 경기 42 강원 43 충북 44 충남 45 전북 46 전남 47 경북 48 경남 50 제주).
  권역(실태조사 `region5`): `cap`(수도권) `yeongnam` `honam` `chungcheong` `gangwon_jeju`. 권역(현황조사 `region5s`): `cap` `gc`(강원/충청) `dg`(대구/경북) `bug`(부산/울산/경남) `hj`(호남/제주).
- `n`: 비가중 응답 수. `wn`: 가중 사례수(유아·초중등처럼 가중 추정일 때). 둘 중 공표된 것만.
- 비율은 보고서 그대로 소수 1자리. 평균은 소수 2자리. 없는 값(`-`)은 `0`이 아니라 `null`.
- 명칭 목록(조례명·사업명·기관명)은 전사하지 않습니다. 숫자 표만.

## 예시 (학생 심각성 인식)

```json
{"qid":"S01","label":"기후위기 및 환경문제의 심각성 인식","short":"심각성 인식","section":"관심도",
 "type":"likert5","scale":"severity5","positive":[3,4],"baseKind":"응답자",
 "source":[{"ref":"그림 2-1-2","pdf":40},{"ref":"표 2-3-1","pdf":80}],
 "rows":[
  {"by":"all","key":"all","n":13071,"pct":[1.7,2.4,13.1,46.3,36.5],"mean":4.14,"sd":0.85,"positive":82.8},
  {"by":"level","key":"E","n":4868,"mean":4.03,"sd":0.92,"positive":78.1},
  {"by":"level","key":"M","n":4263,"mean":4.14,"sd":0.83,"positive":83.5},
  {"by":"level","key":"H","n":3940,"mean":4.27,"sd":0.76,"positive":87.8},
  {"by":"urban","key":"metro","positive":83.8},{"by":"urban","key":"city","positive":82.7},{"by":"urban","key":"rural","positive":81.2}
 ]}
```
