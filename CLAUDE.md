# gwresearch 작업 지침 (학생 성장 지원 로드맵)

시안(`design/roadmap.pdf`)을 옮긴 로드맵 메인 화면과 자료(PDF) 보기 창. 자세한 건 `README.md`.

## 구조
- 빌드 없음. `index.html`, `css/`, `js/main.js`(단계 강조), `js/viewer.js`(자료 보기, 주소 `#항목id`·`#stage-N`).
- `assets/data.json` 자료 목록 — **구글 시트에서 생성**한다(`tools/sheet/Code.gs`, 시트 메뉴 [사이트 반영]). 손으로 고치지 말고 시트를 고친다.
- `assets/vendor/pdfjs/` pdf.js(외부 코드, 고치지 않는다). 검색할 때 이 폴더는 뺀다.
- `assets/fonts/gosanja-subset.woff2` 제목 글자만 남긴 글꼴 — **제목 문구를 바꾸면 `tools/subset_font.py` 로 다시 만든다.**
- 시안이 바뀌면 `python3 tools/extract.py` 로 에셋 재추출.
- `functions/_middleware.js`(지금은 공개, 비밀번호 안 씀), `functions/pdf/[id].js` PDF 를 드라이브에서 가져와 Cloudflare 에 7일 보관.

## DB
- Firebase 없음. Cloudflare KV `gwresearch-pdf`, Google Apps Script(시트·드라이브).

## 배포
- Cloudflare Pages, 빌드 없음. 시트의 [사이트 반영] 이 Cloudflare 배포 훅을 부른다. 주소는 확인되면 여기에 적는다.

## 테스트
- 자동 테스트 없음. 로컬: `python3 -m http.server 8000`(파일을 직접 열면 자료·PDF 가 안 불러와진다).

## 작업 원칙
- 고치기 전에 **실제 오류 메시지를 먼저 확보**한다. 메시지 없이 추측으로 고치지 않는다.
  사용자에게 확인을 부탁할 때는 열어볼 주소·볼 곳을 하나로 정확히 준다.
- 잘 되던 기능은 요청 없이 건드리지 않는다. 원인이 확인되면 그 원인만 고치고, "겸사겸사" 개선은 먼저 묻는다.
- 같은 문제로 두 번 고쳐도 안 되면 멈추고, 확인한 사실과 모르는 것을 정리해 보고한다.
- 사용자에게는 한국어로, 짧게, 무엇을 바꿨고 무엇을 확인했는지(확인 못 한 것도) 말한다.
- 전체 DB 지도는 `RicardoBrian/Ohweb` 의 `DB.md`. 컬렉션을 새로 만들면 그 표도 고친다.
