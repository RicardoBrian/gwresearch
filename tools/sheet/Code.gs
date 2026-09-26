/**
 * 연구학교웹앱DB 시트의 Apps Script (Code.gs 에 전체 붙여 넣고 저장. [배포] 버튼은 누르지 않음)
 * 시트 메뉴 [사이트 반영 → 지금 사이트에 반영하기] → Cloudflare 배포 훅 호출
 */
const DEPLOY_HOOK = 'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/여기에-주소';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('사이트 반영')
    .addItem('지금 사이트에 반영하기', 'deploySite')
    .addToUi();
}

function deploySite() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('사이트 반영', '시트 내용을 사이트에 반영할까요? (2~3분 걸립니다)', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  const res = UrlFetchApp.fetch(DEPLOY_HOOK, { method: 'post', muteHttpExceptions: true });
  if (res.getResponseCode() === 200) {
    ui.alert('배포를 시작했습니다. 2~3분 뒤 사이트를 확인해 주세요.\n'
      + '방금 고친 내용이 안 보이면 5분 뒤 한 번 더 눌러 주세요.');
  } else {
    ui.alert('배포 요청 실패 (' + res.getResponseCode() + ')\n' + res.getContentText().slice(0, 500));
  }
}

/**
 * 자료 탭: A열(단계)을 고르면 B열(항목) 드롭다운이 그 단계 항목만 보이게 함.
 * 단계·항목은 '목록' 탭(A열 단계, B열 항목)에서 읽음.
 */
function onEdit(e) {
  const sh = e.range.getSheet();
  if (sh.getName() !== '자료' || e.range.getColumn() !== 1) return;
  const first = Math.max(e.range.getRow(), 2);
  const last = e.range.getLastRow();
  if (last < first) return;

  const list = e.source.getSheetByName('목록').getDataRange().getValues().slice(1);
  const stages = sh.getRange(first, 1, last - first + 1, 1).getValues();
  stages.forEach(([stage], k) => {
    const cell = sh.getRange(first + k, 2);
    if (!stage) {
      cell.clearDataValidations();
      return;
    }
    const items = list.filter((r) => r[0] === stage).map((r) => r[1]);
    cell.setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(items, true).setAllowInvalid(false).build());
    if (cell.getValue() && items.indexOf(cell.getValue()) < 0) cell.clearContent();
  });
}
