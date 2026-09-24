# 관산중학교 학생 성장 지원 로드맵

시안(`design/roadmap.pdf`, 1920×1080)을 웹 페이지로 옮긴 메인 화면과 자료 보기 창입니다. 빌드 과정은 없습니다.

로컬에서 볼 때는 파일을 직접 열지 말고 간단한 서버로 띄워야 자료 목록(`assets/data.json`)과 PDF가 불러와집니다.

```bash
python3 -m http.server 8000   # → http://localhost:8000
```

## 구조

| 경로 | 내용 |
|---|---|
| `index.html` | 메인 페이지 (글자는 모두 HTML 텍스트) |
| `css/style.css` | 1024px 이상은 시안 구도 그대로, 그 미만은 세로 타임라인 |
| `js/main.js` | 단계 강조(hover·focus) |
| `js/viewer.js`, `css/viewer.css` | 자료 보기 창. 주소 `#항목id` → 항목 자료, `#stage-N` → 단계 개요. 뒤로가기·Esc로 닫힘 |
| `assets/data.json` | 자료 목록 (지금은 견본. 나중에 구글 시트에서 생성) |
| `assets/docs/` | PDF 문서 (`sample/`은 견본, `tools/make_sample_pdf.py`로 생성) |
| `assets/vendor/pdfjs/` | PDF 표시용 pdf.js 4.10.38 (구형 브라우저 호환 빌드) |
| `assets/img/` | PDF에서 추출한 벡터 에셋 (`bg.svg` 길·장식, `pins.svg` 핀·지구본, `stage-1~5.svg` 일러스트, `logo.png`) |
| `assets/fonts/gosanja-subset.woff2` | 제목용 고산자체. 제목에 쓰인 글자 44자만 남긴 파일 (원본 13MB → 6KB) |
| `tools/subset_font.py` | 위 폰트 파일 생성 스크립트 |
| `tools/extract.py` | PDF → 에셋 추출 스크립트. 길 위 점선은 `index.html`의 `DASHES` 표시 사이에 직접 넣음 |

시안이 바뀌면 `design/roadmap.pdf`를 교체하고 `pip install pymupdf && python3 tools/extract.py`를 실행하면 됩니다.

## 폰트

- 제목(학교명, 큰 제목, 단계 제목, 번호 뱃지): **고산자체** — 사이트에 직접 포함
- 나머지: **Pretendard** — jsDelivr CDN

고산자체는 제목에 쓰인 글자만 들어 있습니다. **제목 문구를 바꾸면** 새 글자가 기본 서체로 보이므로 폰트를 다시 만들어야 합니다.

```bash
npm i @noonnu/gosanja && pip install fonttools brotli
python3 tools/subset_font.py node_modules/@noonnu/gosanja/fonts/gosanja-normal.woff
```

## 자료 넣는 규칙

- 문서는 모두 **PDF**, 영상은 **YouTube**(일부공개) 주소만
- `assets/data.json`의 한 항목 = 자료 하나

```json
{ "item": "bilingual-education", "type": "pdf",   "title": "운영 보고서", "file": "assets/docs/…pdf", "desc": "설명(선택)" }
{ "item": "bilingual-education", "type": "video", "title": "수업 영상",   "youtube": "https://www.youtube.com/watch?v=…" }
```

`item`은 `index.html` 항목 링크(`href="#…"`)와 같아야 합니다. 자료가 없는 항목은 “자료 준비 중”으로 표시됩니다.
