// 대시보드 런타임 설정. 화면 코드 수정 없이 데이터 소스·표시 규칙을 바꿀 수 있습니다.
window.ECO_CONFIG = {
  // 'static' : data/cubes/*.json 파일을 읽음 (GitHub Pages, 내부망 정적 배치)
  // 'api'    : apiBase 아래 같은 경로로 요청 (추후 KEEP 서버 연계용 래퍼)
  dataSource: 'static',
  dataBase: 'data/',
  apiBase: '',
  buildId: '2026-10-29.1',          // 캐시 무효화용. 큐브를 다시 만들면 올립니다.
  dataLabel: '합성 데이터 · 2025년 보고서 공표값 기반',
  synthetic: true,                   // true면 모든 패널에 "합성 데이터" 배지 표시
  suppression: {
    person: { minN: 30 },            // 사람 단위 조사: 비가중 n < 30 → 값 숨김
    weighted: { unstableN: 10 },     // 가중 추정: 비가중 n < 10 → "불안정 추정" 표시
    institution: { minN: 0 }         // 기관 조사: 억제 없음(1기관 1응답, 보고서 관례)
  }
};
