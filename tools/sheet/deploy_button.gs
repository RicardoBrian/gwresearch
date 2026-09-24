/**
 * 구글 시트에 [사이트 반영] 메뉴를 추가한다.
 * 누르면 Cloudflare Pages 배포 훅을 호출 → 시트 내용과 드라이브 PDF가 사이트에 반영된다.
 *
 * 설치 (시트 주인 계정에서 한 번만):
 *  1. 시트에서 [확장 프로그램 → Apps Script] 열기
 *  2. 이 파일 내용을 붙여 넣고 저장
 *  3. DEPLOY_HOOK 에 Cloudflare Pages 배포 훅 주소 넣기
 *     (Cloudflare → Workers & Pages → gwresearch → 설정 → 빌드 → 배포 후크 → 추가)
 *  4. 시트를 새로 고치면 상단에 [사이트 반영] 메뉴가 생김. 처음 누를 때 권한 허용.
 *
 * 배포 훅 주소는 비밀번호처럼 다룰 것 (아는 사람은 누구나 배포를 시작할 수 있음).
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
  const ok = ui.alert('사이트 반영', '시트 내용을 사이트에 반영할까요? (2~3분 걸립니다)', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  // "웹에 게시" CSV 는 수정 후 반영까지 몇 분 늦을 수 있어 알림
  const res = UrlFetchApp.fetch(DEPLOY_HOOK, { method: 'post', muteHttpExceptions: true });
  if (res.getResponseCode() === 200) {
    ui.alert('배포를 시작했습니다. 2~3분 뒤 사이트를 새로 고쳐 확인해 주세요.\n'
      + '방금 고친 내용이 안 보이면 5분 뒤 한 번 더 눌러 주세요.\n'
      + '오류가 있으면 Cloudflare 배포 기록에 행 번호와 함께 표시됩니다.');
  } else {
    ui.alert('배포 요청 실패 (' + res.getResponseCode() + '). 배포 훅 주소를 확인해 주세요.');
  }
}
