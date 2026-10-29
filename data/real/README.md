# data/real/ — 실제(비공개) 원자료 폴더

이 폴더의 내용은 `TEMPLATE_*.csv`(헤더만 있는 양식)와 이 안내문을 제외하고 **모두 git에서 제외**됩니다(.gitignore).

실제 데이터로 대시보드를 만들 때:
1. 양식(TEMPLATE_*.csv)에 맞춰 원자료 CSV를 이 폴더에 둡니다.
2. 기관 내부 PC에서 `python tools/build_cubes.py --real` 을 실행합니다.
3. 생성된 `data/cubes/*.json`(집계 큐브)만 배포 대상 서버에 복사합니다.
   원자료는 외부로 나가지 않습니다. 자세한 절차는 `docs/data-spec.md` 참고.
