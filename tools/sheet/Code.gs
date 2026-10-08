/**
 * 연구학교웹앱DB 시트의 Apps Script (Code.gs)
 * 자료 올리기 앱은 Upload.gs · UploadPage.html · Migrate.html
 * 시트 메뉴 [사이트 반영 → 지금 사이트에 반영하기] → Cloudflare 배포 훅 호출
 */
const DEPLOY_HOOK = 'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/여기에-주소';
const SITE_URL = 'https://gwresearch.pages.dev';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('사이트 반영')
    .addItem('지금 사이트에 반영하기', 'deploySite')
    .addItem('반영 결과 보기', 'showReport')
    .addSeparator()
    .addItem('업로드 코드 정하기', 'setUploadCode')
    .addItem('기존 자료 정리하기', 'openMigrate')
    .addToUi();
}

function deploySite() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('사이트 반영', '시트 내용을 사이트에 반영할까요? (2~3분 걸립니다)', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  const res = UrlFetchApp.fetch(DEPLOY_HOOK, { method: 'post', muteHttpExceptions: true });
  if (res.getResponseCode() === 200) {
    ui.alert('배포를 시작했습니다. 2~3분 뒤 [사이트 반영 → 반영 결과 보기]로 결과를 확인해 주세요.\n'
      + '방금 고친 내용이 안 보이면 5분 뒤 한 번 더 눌러 주세요.');
  } else {
    ui.alert('배포 요청 실패 (' + res.getResponseCode() + ')\n' + res.getContentText().slice(0, 500));
  }
}

// 반영 결과 페이지(사이트 주소/report)를 새 탭으로 엶. 팝업이 막히면 링크를 눌러 열기
function showReport() {
  const url = SITE_URL + '/report';
  const html = HtmlService.createHtmlOutput(
    '<p style="font:15px sans-serif">마지막 반영 결과를 엽니다. 안 열리면 아래 링크를 눌러 주세요.</p>'
    + '<p><a href="' + url + '" target="_blank" style="font:600 15px sans-serif">' + url + '</a></p>'
    + '<script>window.open("' + url + '", "_blank");</script>'
  ).setWidth(420).setHeight(140);
  SpreadsheetApp.getUi().showModalDialog(html, '반영 결과 보기');
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
