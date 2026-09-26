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

## 입장 비밀번호

사이트 전체가 비밀번호로 잠겨 있습니다 (`functions/_middleware.js`). Cloudflare → gwresearch → 설정 → 변수 및 비밀:

| 이름 | 종류 | 내용 |
|---|---|---|
| `SITE_PASSWORD` | 비밀(암호화) | 입장 비밀번호. **바꾸면 기존 로그인은 모두 풀림.** 없으면 사이트가 열리지 않음 |
| `SESSION_HOURS` | 일반 텍스트 (선택) | 로그인 유지 시간(시간 단위), 기본 12 |

비밀번호를 바꾼 뒤에는 한 번 다시 배포해야 적용됩니다 (시트의 [사이트 반영]).

## 자료 넣는 법

자료 목록은 구글 시트 **연구학교웹앱DB**의 `자료` 탭 한 장으로 관리합니다. 한 줄이 자료 하나입니다.

| 단계 | 항목 | 분류 | 제목 | PDF 링크 | 유튜브 링크 | 설명 |
|---|---|---|---|---|---|---|
| 1 초기 적응 지원 | KLS 기초 한국어 선이수제 | 국어 | | (드라이브 PDF 파일 링크) | | |
| 1 초기 적응 지원 | KLS 기초 한국어 선이수제 | 국어 | 수업 영상 | | https://youtu.be/… | |

- **단계·항목**: 드롭다운 (`목록` 탭). 단계와 항목이 서로 안 맞으면 배포 전에 걸러짐
- **분류**: 선택. 한 항목 안에 과목 등이 여러 개일 때만. 채우면 항목을 눌렀을 때 분류 카드가 먼저 나옴
- **제목**: 선택. 비우면 PDF 파일 이름 / 유튜브 영상 제목을 씀
- **PDF 링크**: 구글 드라이브 PDF 파일 링크 (‘링크가 있는 모든 사용자’ 공유). **유튜브 링크**와 둘 중 하나만
  - **폴더 링크**를 넣으면 폴더 안 PDF를 모두 가져옴: 파일 이름순, 제목 = 파일 이름. 순서를 정하려면 파일 이름 앞에 `01_`, `02_`… (사이트 제목에서는 자동으로 뗌). 폴더에 PDF를 더 넣고 [사이트 반영]만 누르면 추가됨
- 순서: 시트에 적은 순서대로 보입니다
- (고급) `소분류` 열을 추가하면 같은 분류 안에서 [전체][1학년]… 칩 버튼으로 걸러 봄

시트 메뉴 **[사이트 반영 → 지금 사이트에 반영하기]**로 배포합니다 (`tools/sheet/Code.gs`, Cloudflare 배포 훅).

배포 때 `tools/build_data.py`가 시트(`SHEET_CSV_URL`)를 읽고, 드라이브 PDF는 **앞부분만 확인**합니다(PDF 여부·공유·파일 이름).
PDF 파일 자체는 사이트에 올리지 않고, 방문자가 열 때 `functions/pdf/[id].js`가 드라이브에서 가져와 1시간 캐시합니다.
그래서 배포가 빠르고, 드라이브에서 파일을 새 버전으로 바꾸면 재배포 없이 1시간 안에 반영됩니다.
대신 **드라이브에서 파일을 지우거나 공유를 닫으면 사이트에서도 열리지 않습니다.**
없는 항목, 단계·항목 불일치, PDF가 아닌 파일, 공유가 막힌 파일, 25MB 초과 등이 있으면 행 번호와 함께 알려주고 멈춥니다.
PDF·유튜브 링크가 둘 다 빈 줄(입력 중)은 건너뜁니다.

로드맵 항목 이름을 바꾸면 `index.html`과 시트 `목록` 탭을 같이 고치세요.

### 항목ID 표

| 단계 | 항목 | 항목ID |
|---|---|---|
| 1 초기 적응 지원 | KLS 기초 한국어 선이수제 | `kls-prerequisite` |
| 1 초기 적응 지원 | 선이수제 학생 추수지도 | `prerequisite-followup` |
| 1 초기 적응 지원 | 생활적응교육 | `life-adaptation` |
| 2 학생 진단 | 언어권별 기초학력 진단 | `language-diagnosis` |
| 2 학생 진단 | 학생별 지원 필요 영역 확인 및 관리 | `needs-management` |
| 3 학습 지원 | 특별학급 운영 | `special-class` |
| 3 학습 지원 | 개별수업 운영 | `individual-class` |
| 3 학습 지원 | 이중언어 교육 | `bilingual-education` |
| 3 학습 지원 | 교과 이해 지원 | `subject-support` |
| 3 학습 지원 | 기초학력 향상 지원 | `basic-skills` |
| 4 정서 지원 | 상호문화교육 | `intercultural-education` |
| 4 정서 지원 | 어울림 집단 상담 | `group-counseling` |
| 4 정서 지원 | 예체능교육 | `arts-sports` |
| 4 정서 지원 | 또래멘토링 | `peer-mentoring` |
| 5 미래 인재 양성 | 세계 각국 학생 대사 | `student-ambassadors` |
| 5 미래 인재 양성 | 이중언어 말하기 대회 | `bilingual-speech` |
| 5 미래 인재 양성 | 유네스코 세계시민교육 | `unesco-gced` |
| 5 미래 인재 양성 | 글로컬 문제해결 프로젝트 | `glocal-project` |

