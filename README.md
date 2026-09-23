# 관산중학교 학생 성장 지원 로드맵

시안(`design/roadmap.pdf`, 1920×1080)을 웹 페이지로 옮긴 메인 화면입니다. 빌드 과정 없이 `index.html`을 열면 바로 볼 수 있습니다.

## 구조

| 경로 | 내용 |
|---|---|
| `index.html` | 메인 페이지 (글자는 모두 HTML 텍스트) |
| `css/style.css` | 1024px 이상은 시안 구도 그대로, 그 미만은 세로 타임라인 |
| `js/main.js` | 단계 강조(hover·focus), 클릭 시 “준비 중” 안내 |
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

## 자료 페이지 연결

각 항목 링크(`.item`)의 `href`는 지금 `#항목-id` 형태의 자리표시입니다. 자료 페이지가 준비되면 `href`를 실제 주소로 바꾸고, `js/main.js`의 클릭 처리(준비 중 안내)를 걷어내면 됩니다.
