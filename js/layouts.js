/**
 * layouts.js — 탭별 기본 패널 구성. 사용자가 ⚙로 바꾼 구성은 localStorage 에 따로 저장되고,
 * "기본 구성으로" 버튼이 이 파일의 값으로 되돌린다.
 *
 * 패널 cfg: { survey, pop, key, by, chart, measure, cat, span, title }
 *   key 가 항목 묶음 문항(item_*)의 qid 이면 항목 전체를 한 차트에 그린다.
 */
const S = "school_survey", T = "status_survey";

export const DEFAULT_LAYOUTS = {
  "school/student": [
    { survey: S, pop: "student", key: "S01", by: ["level"], chart: "stack", span: 6 },
    { survey: S, pop: "student", key: "S03", by: ["level"], measure: "positive", span: 6, title: "환경 용어 인지도 — '뜻도 안다' 비율" },
    { survey: S, pop: "student", key: "S07", by: ["level"], measure: "positive", span: 6, title: "수업방식별 경험률" },
    { survey: S, pop: "student", key: "S07E", by: ["level"], measure: "mean", span: 6, title: "수업방식별 효과성 인식(경험자, 5점 평균)" },
    { survey: S, pop: "student", key: "S14", by: ["level"], measure: "mean", span: 4, title: "학교환경교육 만족도(5점 평균)" },
    { survey: S, pop: "student", key: "S04_r1", by: ["level"], chart: "hbar", span: 8 },
    { survey: S, pop: "student", key: "S09", by: ["level"], chart: "hbar", span: 6 },
    { survey: S, pop: "student", key: "S01", by: ["sido"], chart: "tile", measure: "positive", span: 6, title: "심각성 인식 — 시도별(합성 축)" },
    { survey: S, pop: "student", key: "S16", by: ["grade"], chart: "line", measure: "positive", span: 6, title: "환경교육 확대 동의율 — 학년별(합성 축)" },
    { survey: S, pop: "student", key: "S08", by: [], measure: "mean", span: 6, title: "환경 수업·활동을 통한 경험(5점 평균)" },
  ],
  "school/teacher": [
    { survey: S, pop: "teacher", key: "T01", by: ["level"], chart: "stack", span: 6 },
    { survey: S, pop: "teacher", key: "T06", by: ["role"], measure: "mean", span: 6, title: "환경교육 교수학습 역량 — 교원 구분별(5점 평균)" },
    { survey: S, pop: "teacher", key: "T07", by: ["level"], measure: "mean", span: 6, title: "환경교육 운영 — 학교급별(5점 평균)" },
    { survey: S, pop: "teacher", key: "T11", by: ["role"], chart: "hbar", span: 6 },
    { survey: S, pop: "teacher", key: "T14", by: ["level"], measure: "positive", span: 6, title: "수업방법 활용 경험률" },
    { survey: S, pop: "teacher", key: "T14E", by: ["level"], measure: "mean", span: 6, title: "수업방식별 효과성 인식(5점 평균)" },
    { survey: S, pop: "teacher", key: "T15", by: ["role"], measure: "mean", span: 4, title: "학교환경교육 만족도(5점 평균)" },
    { survey: S, pop: "teacher", key: "T16", by: ["level"], chart: "hbar", span: 8 },
    { survey: S, pop: "teacher", key: "T22_r1", by: [], chart: "hbar", span: 6 },
    { survey: S, pop: "teacher", key: "T21_r1", by: [], chart: "hbar", span: 6 },
  ],
  "school/coordinator": [
    { survey: S, pop: "teacher", key: "C01_2025", by: ["level"], measure: "positive", span: 4, title: "2025년 환경교육 지정 여부" },
    { survey: S, pop: "teacher", key: "C02", by: ["level"], chart: "stack", span: 8, title: "운영 계획 대비 이행 정도" },
    { survey: S, pop: "teacher", key: "C05", by: ["level"], measure: "positive", span: 4, title: "2025년 환경교육 예산 마련 여부" },
    { survey: S, pop: "teacher", key: "C06", by: [], chart: "hbar", span: 8 },
    { survey: S, pop: "teacher", key: "C07", by: ["level"], chart: "hbar", span: 6 },
    { survey: S, pop: "teacher", key: "C13_r1", by: [], chart: "hbar", span: 6 },
  ],
  "status/inst_central": [
    { survey: T, pop: "inst_central", key: "CEN_LAW_N", by: ["unit"], measure: "mean", span: 4, title: "환경교육 관련 법령 수(기관별)" },
    { survey: T, pop: "inst_central", key: "CEN_STAFF_N", by: ["unit"], measure: "mean", span: 4, title: "담당 인력 총인원(기관별)" },
    { survey: T, pop: "inst_central", key: "CEN_PROGRAM_N", by: ["unit"], measure: "mean", span: 4, title: "자체 환경교육 사업 수(기관별)" },
  ],
  "status/inst_metro": [
    { survey: T, pop: "inst_metro", key: "MET_LAW_N", by: ["sido"], chart: "bar", measure: "mean", span: 6, title: "환경교육 조례 수 — 시도별" },
    { survey: T, pop: "inst_metro", key: "MET_BUDGET", by: ["sido"], chart: "bar", measure: "mean", span: 6, title: "환경교육 총예산(백만원) — 시도별" },
    { survey: T, pop: "inst_metro", key: "MET_ACT10_YN", by: ["sido"], chart: "tile", measure: "positive", span: 6, title: "환경교육법 제10조(학교환경교육 지원) 진행 여부" },
  ],
  "status/inst_local": [
    { survey: T, pop: "inst_local", key: "LOC_ORD_YN", by: ["metro"], measure: "positive", span: 4, title: "환경교육 조례 제정률 — 수도권 여부" },
    { survey: T, pop: "inst_local", key: "LOC_PLAN_YN", by: ["region5"], measure: "positive", span: 4, title: "환경교육 계획 수립률 — 권역별(합성 축)" },
    { survey: T, pop: "inst_local", key: "LOC_ORD_YN", by: ["sido"], chart: "tile", measure: "positive", span: 4, title: "조례 제정률 — 시도별(합성 축)" },
  ],
  "status/inst_public": [
    { survey: T, pop: "inst_public", key: "PUB_DEPT_YN", by: ["orgtype"], measure: "positive", span: 4, title: "담당 부서·인력 보유율 — 기관유형별" },
    { survey: T, pop: "inst_public", key: "PUB_PROGRAM_YN", by: ["ministry"], measure: "positive", span: 4, title: "자체 환경교육 사업 보유율 — 주무부처별" },
    { survey: T, pop: "inst_public", key: "PUB_TRAINING_TOPIC", by: [], chart: "hbar", span: 4 },
  ],
  "status/inst_social": [
    { survey: T, pop: "inst_social", key: "SOC_LEGAL", by: [], chart: "hbar", span: 4 },
    { survey: T, pop: "inst_social", key: "SOC_FACILITY_YN", by: ["soctype"], measure: "positive", span: 4, title: "환경교육 시설 보유율 — 기관 유형별" },
    { survey: T, pop: "inst_social", key: "SOC_PROGRAM_TYPE", by: [], chart: "hbar", span: 4 },
  ],
  "status/inst_edu_office": [
    { survey: T, pop: "inst_edu_office", key: "EDU_PROGRAM_N", by: ["sido"], chart: "bar", measure: "mean", span: 6, title: "자체 환경교육 사업 수 — 교육청별" },
    { survey: T, pop: "inst_edu_office", key: "EDU_BUDGET_EE", by: ["sido"], chart: "bar", measure: "mean", span: 6, title: "환경교육 총예산(백만원) — 교육청별" },
    { survey: T, pop: "inst_edu_office", key: "EDU_STAFF_TOTAL", by: ["sido"], chart: "bar", measure: "mean", span: 6, title: "담당 인력 총인원 — 교육청별" },
  ],
  "status/inst_early": [
    { survey: T, pop: "inst_early", key: "ECE_PLAN_YN", by: ["kind"], measure: "positive", span: 4, title: "환경교육 계획 수립률 — 기관구분별" },
    { survey: T, pop: "inst_early", key: "ECE_NURI_AREA", by: ["kind"], chart: "hbar", span: 4 },
    { survey: T, pop: "inst_early", key: "ECE_EDUCATOR_YN", by: ["region5"], measure: "positive", span: 4, title: "환경교육사 활용률 — 권역별" },
  ],
  "status/inst_school": [
    { survey: T, pop: "inst_school", key: "SCH_PLAN_YN", by: ["level"], measure: "positive", span: 4, title: "환경교육 계획 수립률 — 학교급별" },
    { survey: T, pop: "inst_school", key: "SCH_STAFF", by: ["level"], chart: "stack", span: 8, title: "환경교육 담당 인력 — 학교급별" },
    { survey: T, pop: "inst_school", key: "SCH_EXT_SOURCE", by: ["level"], chart: "hbar", span: 6 },
    { survey: T, pop: "inst_school", key: "SCH_LECTURER_YN", by: ["region5"], measure: "positive", span: 6, title: "외부강사 활용률 — 권역별" },
  ],
  "status/inst_univ": [
    { survey: T, pop: "inst_univ", key: "UNI_ESG_YN", by: ["univtype"], measure: "positive", span: 4, title: "ESG 경영계획 수립률 — 대학 유형별" },
    { survey: T, pop: "inst_univ", key: "UNI_GE_YN", by: ["metro"], measure: "positive", span: 4, title: "교양 환경과목 개설률 — 수도권 여부" },
    { survey: T, pop: "inst_univ", key: "UNI_EXT_TYPE", by: [], chart: "hbar", span: 4 },
  ],
};

/** 큐레이션에 포함된 문항(qid) 집합 — 자동 패널에서 제외 */
export function curatedQids(tabId) {
  return new Set((DEFAULT_LAYOUTS[tabId] || []).map(p => p.key.replace(/_r1(2|23)?$/, "").replace(/_[A-Za-z0-9]+$/, m => m)));
}
