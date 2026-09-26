/**
 * 연구학교웹앱DB 시트용 Apps Script  (Apps Script 의 Code.gs 에 전체 붙여 넣기)
 *
 * 메뉴 [사이트 반영]
 *   - 지금 사이트에 반영하기 : Cloudflare 배포 훅 호출 → 시트 내용과 드라이브 PDF 가 사이트에 반영
 *   - 시트 구성 정리        : 열 순서·목록·안내 탭·드롭다운·1행 보호를 한 번에 설정 (입력한 자료는 유지)
 * 자동 동작
 *   - '단계'를 고르면 '항목' 드롭다운이 그 단계 항목만 보여줌
 *   - '항목'을 먼저 고르면 '단계'가 자동으로 채워짐
 *
 * [배포] 버튼은 누르지 않습니다. 저장만 하면 됩니다.
 * 배포 훅 주소는 비밀번호처럼 다룰 것 (아는 사람은 누구나 배포를 시작할 수 있음).
 */
const DEPLOY_HOOK = 'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/여기에-주소';

// 로드맵 단계·항목 — 사이트(index.html)의 이름과 글자까지 같아야 함
const ROADMAP = [
  ['1 초기 적응 지원', ['KLS 기초 한국어 선이수제', '선이수제 학생 추수지도', '생활적응교육']],
  ['2 학생 진단', ['언어권별 기초학력 진단', '학생별 지원 필요 영역 확인 및 관리']],
  ['3 학습 지원', ['특별학급 운영', '개별수업 운영', '이중언어 교육', '교과 이해 지원', '기초학력 향상 지원']],
  ['4 정서 지원', ['상호문화교육', '어울림 집단 상담', '예체능교육', '또래멘토링']],
  ['5 미래 인재 양성', ['세계 각국 학생 대사', '이중언어 말하기 대회', '유네스코 세계시민교육', '글로컬 문제해결 프로젝트']],
];

const DATA = '자료';
const LIST = '목록';
const GUIDE = '안내';
const HEADERS = ['단계', '항목', '분류', '제목', 'PDF 링크', '유튜브 링크', '설명'];
const WIDTHS = [130, 230, 110, 220, 320, 280, 260];
const RENAME = { '항목ID': '항목', 'ID': '항목', '파일': 'PDF 링크', 'PDF': 'PDF 링크', '유튜브': '유튜브 링크' };
const COL_STAGE = 1;
const COL_ITEM = 2;

const GUIDE_TEXT = [
  '자료 입력 안내',
  '',
  '한 줄 = 자료 하나. 시트에 적은 순서대로 사이트에 보입니다.',
  '',
  '단계 : 드롭다운에서 고르기 (항목을 먼저 고르면 자동으로 채워짐)',
  '항목 : 드롭다운에서 고르기 (필수)',
  '분류 : 선택. 한 항목 안에 과목 등이 여러 개면 적기 (예: 국어, 수학). 같은 분류는 글자까지 똑같이',
  '제목 : 선택. 비우면 PDF 파일 이름 / 유튜브 영상 제목이 그대로 쓰임',
  'PDF 링크 : 구글 드라이브의 PDF 파일 링크 (파일 우클릭 → 공유 → 링크 복사). 폴더 링크 아님',
  '유튜브 링크 : 영상 주소 (일부공개로 올리기). PDF 링크와 둘 중 하나만',
  '설명 : 선택',
  '',
  '주의',
  '- PDF 공유 설정은 "링크가 있는 모든 사용자 · 뷰어" (공유 폴더에 올리면 자동)',
  '- 한글·PPT는 PDF로 저장해서 올리기, 한 파일 25MB 이하',
  '- 학생 이름·얼굴·성적 등 개인정보가 보이는 자료는 올리지 않기',
  '- 1행(열 제목)과 탭 이름은 바꾸지 않기',
  '- PDF 링크·유튜브 링크를 아직 안 넣은 줄은 반영할 때 자동으로 빠짐',
  '- 다 적은 뒤 메뉴 [사이트 반영 → 지금 사이트에 반영하기] → 2~3분 뒤 사이트 확인',
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('사이트 반영')
    .addItem('지금 사이트에 반영하기', 'deploySite')
    .addSeparator()
    .addItem('시트 구성 정리 (처음 한 번)', 'setupSheet')
    .addToUi();
}

// ---------- 사이트 반영 ----------
function deploySite() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('사이트 반영', '시트 내용을 사이트에 반영할까요? (2~3분 걸립니다)', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  const res = UrlFetchApp.fetch(DEPLOY_HOOK, { method: 'post', muteHttpExceptions: true });
  if (res.getResponseCode() === 200) {
    ui.alert('배포를 시작했습니다. 2~3분 뒤 사이트를 새로 고쳐 확인해 주세요.\n'
      + '방금 고친 내용이 안 보이면 5분 뒤 한 번 더 눌러 주세요. (시트 게시본이 몇 분 늦게 바뀜)\n'
      + '문제가 있는 줄은 Cloudflare 배포 기록에 행 번호와 함께 나옵니다.');
  } else {
    ui.alert('배포 요청 실패 (' + res.getResponseCode() + '). 배포 훅 주소를 확인해 주세요.');
  }
}

// ---------- 시트 구성 정리 ----------
function setupSheet() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('시트 구성 정리',
    "'자료' 탭의 열을 [" + HEADERS.join(' | ') + "] 순서로 정리하고\n"
    + "'목록'·'안내' 탭을 새로 씁니다. 입력한 자료는 그대로 옮겨집니다. 진행할까요?",
    ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;

  const ss = SpreadsheetApp.getActive();
  const pairs = [];
  ROADMAP.forEach(([stage, items]) => items.forEach((item) => pairs.push([stage, item])));

  // 목록 탭: A 단계, B 항목 / D 단계 목록(단계 드롭다운용)
  const list = ss.getSheetByName(LIST) || ss.insertSheet(LIST);
  list.clear();
  list.getRange(1, 1, 1, 2).setValues([['단계', '항목']]);
  list.getRange(2, 1, pairs.length, 2).setValues(pairs);
  list.getRange(1, 4).setValue('단계 목록');
  list.getRange(2, 4, ROADMAP.length, 1).setValues(ROADMAP.map((r) => [r[0]]));
  styleHeader(list.getRange(1, 1, 1, 2));
  styleHeader(list.getRange(1, 4));
  list.setColumnWidth(1, 150);
  list.setColumnWidth(2, 260);
  list.setColumnWidth(4, 150);

  // 자료 탭: 열 제목 기준으로 기존 값을 새 순서로 옮김
  const sh = ss.getSheetByName(DATA) || ss.insertSheet(DATA, 0);
  const values = sh.getDataRange().getValues();
  const oldHeads = (values[0] || []).map((h) => RENAME[String(h).trim()] || String(h).trim());
  const rows = values.slice(1).filter((r) => r.some((v) => v !== ''));
  // 알 수 없는 열(예: 소분류)은 값이 있을 때만 뒤에 남김
  const extras = oldHeads.filter((h, i) => h && HEADERS.indexOf(h) < 0 && rows.some((r) => r[i] !== ''));
  const heads = HEADERS.concat(extras);
  const stageOf = {};
  pairs.forEach(([s, i]) => { stageOf[i] = s; });
  const moved = rows.map((r) => heads.map((h) => {
    const i = oldHeads.indexOf(h);
    return i >= 0 ? r[i] : '';
  }));
  moved.forEach((r) => { if (!r[0] && stageOf[r[1]]) r[0] = stageOf[r[1]]; });

  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach((p) => {
    if (p.getDescription() === '열 제목') p.remove();
  });
  sh.clear();
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  if (sh.getMaxColumns() < heads.length) sh.insertColumnsAfter(sh.getMaxColumns(), heads.length - sh.getMaxColumns());
  sh.getRange(1, 1, 1, heads.length).setValues([heads]);
  styleHeader(sh.getRange(1, 1, 1, heads.length));
  if (moved.length) sh.getRange(2, 1, moved.length, heads.length).setValues(moved);
  sh.setFrozenRows(1);
  heads.forEach((_, i) => sh.setColumnWidth(i + 1, WIDTHS[i] || 150));
  if (sh.getMaxColumns() > heads.length) sh.deleteColumns(heads.length + 1, sh.getMaxColumns() - heads.length);

  // 드롭다운: 단계 = 단계 목록, 항목 = 전체 항목 (단계가 있는 줄은 그 단계 항목만)
  const n = Math.max(sh.getMaxRows() - 1, 1);
  sh.getRange(2, COL_STAGE, n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(list.getRange(2, 4, ROADMAP.length, 1), true)
      .setAllowInvalid(false).setHelpText('단계를 고르세요').build());
  sh.getRange(2, COL_ITEM, n, 1).setDataValidation(allItemsRule(list, pairs.length));
  moved.forEach((r, k) => { if (r[0]) sh.getRange(k + 2, COL_ITEM).setDataValidation(stageRule(r[0])); });

  // 1행 보호 (시트 주인만 수정)
  const p = sh.getRange('1:1').protect().setDescription('열 제목');
  p.removeEditors(p.getEditors().filter((u) => u.getEmail() !== Session.getEffectiveUser().getEmail()));
  if (p.canDomainEdit()) p.setDomainEdit(false);

  // 안내 탭
  const guide = ss.getSheetByName(GUIDE) || ss.insertSheet(GUIDE);
  guide.clear();
  guide.getRange(1, 1, GUIDE_TEXT.length, 1).setValues(GUIDE_TEXT.map((t) => [t]));
  guide.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  guide.getRange(13, 1).setFontWeight('bold');
  guide.setColumnWidth(1, 900);

  ss.setActiveSheet(sh);
  ss.moveActiveSheet(1);
  ui.alert('정리했습니다. 자료 ' + moved.length + '줄을 옮겼습니다.'
    + (extras.length ? '\n값이 있어 남겨 둔 열: ' + extras.join(', ') : ''));
}

// ---------- 단계 ↔ 항목 드롭다운 연동 ----------
function onEdit(e) {
  const sh = e.range.getSheet();
  if (sh.getName() !== DATA) return;
  const r0 = Math.max(e.range.getRow(), 2);
  const r1 = e.range.getLastRow();
  const c0 = e.range.getColumn();
  const c1 = e.range.getLastColumn();
  if (r1 < 2 || c0 > COL_ITEM || c1 < COL_STAGE) return;

  const list = e.source.getSheetByName(LIST);
  const vals = sh.getRange(r0, COL_STAGE, r1 - r0 + 1, 2).getValues();
  vals.forEach(([stage, item], k) => {
    const row = r0 + k;
    const itemCell = sh.getRange(row, COL_ITEM);
    const touchedStage = c0 <= COL_STAGE && COL_STAGE <= c1;
    const touchedItem = c0 <= COL_ITEM && COL_ITEM <= c1;

    if (touchedItem && item && !stage) {
      // 항목을 먼저 고름 → 단계 자동 채움
      const s = stageOfItem(item);
      if (s) {
        sh.getRange(row, COL_STAGE).setValue(s);
        itemCell.setDataValidation(stageRule(s));
      }
    } else if (touchedStage) {
      if (stage) {
        itemCell.setDataValidation(stageRule(stage));
        if (item && itemsOf(stage).indexOf(item) < 0) itemCell.clearContent();
      } else if (list) {
        itemCell.setDataValidation(allItemsRule(list));
      }
    }
  });
}

// ---------- 도우미 ----------
function itemsOf(stage) {
  const hit = ROADMAP.find((r) => r[0] === stage);
  return hit ? hit[1] : [];
}

function stageOfItem(item) {
  const hit = ROADMAP.find((r) => r[1].indexOf(item) >= 0);
  return hit ? hit[0] : '';
}

function stageRule(stage) {
  return SpreadsheetApp.newDataValidation().requireValueInList(itemsOf(stage), true)
    .setAllowInvalid(false).setHelpText(stage + ' 단계의 항목').build();
}

function allItemsRule(list, count) {
  const n = count || ROADMAP.reduce((a, r) => a + r[1].length, 0);
  return SpreadsheetApp.newDataValidation().requireValueInRange(list.getRange(2, 2, n, 1), true)
    .setAllowInvalid(false).setHelpText('항목을 고르세요').build();
}

function styleHeader(range) {
  range.setFontWeight('bold').setBackground('#456d2a').setFontColor('#ffffff').setHorizontalAlignment('center');
}
