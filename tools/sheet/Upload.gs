/**
 * 자료 올리기 앱 (웹앱) + 기존 자료 정리
 * Apps Script 파일: Upload.gs(이 파일), UploadPage.html, Migrate.html
 * Code.gs 의 DEPLOY_HOOK(배포 후크 주소)을 같이 씀
 *
 * - 시트가 그대로 저장소. 앱은 시트 '자료' 탭에 사람이 넣는 것과 같은 형식으로 쓰고 읽음
 * - 파일은 이 스크립트 주인 드라이브의 '연구학교 자료/단계/항목/(분류)' 폴더에 저장하고 공유를 엶
 * - 중간에 실패하면 만든 파일을 휴지통으로 보내고 시트는 건드리지 않음
 * - 바뀐 게 있으면 1분 뒤 사이트 반영 (여러 번 바꿔도 한 번만)
 */
const ROOT_NAME = '연구학교 자료';
const DATA_SHEET = '자료';
const LIST_SHEET = '목록';
const STAGE_INTRO = '단계 소개';
const MAX_BYTES = 45 * 1024 * 1024; // 앱스스크립트로 한 번에 받을 수 있는 크기 안쪽

// 시트 열 제목 → 내부 이름 (사이트 배포 tools/build_data.py 와 같은 규칙)
const KEYS = {
  stage: ['단계'], item: ['항목', '항목id', 'id'], group: ['분류'], sub: ['소분류'], title: ['제목'],
  file: ['pdf링크', 'pdf', '파일', '파일링크', '링크'], youtube: ['유튜브링크', '유튜브'], desc: ['설명'],
  thumb: ['썸네일', '썸네일링크', '대표이미지'],
  by: ['올린사람'], uid: ['관리번호'], at: ['수정시각'], prev: ['이전링크'],
};
// 앱이 쓰는 열 — 없으면 맨 오른쪽에 만듦 (사이트 배포는 이 열들을 무시하거나 썸네일만 읽음)
const EXTRA = { thumb: '썸네일', by: '올린 사람', uid: '관리번호', at: '수정 시각', prev: '이전 링크' };

// =========================================================
// 웹앱 입구
// =========================================================
function doGet() {
  return HtmlService.createHtmlOutputFromFile('UploadPage')
    .setTitle('연구학교 자료 올리기')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// 앱 화면이 부르는 유일한 함수 — 업로드 코드부터 확인
function api(code, action, p) {
  checkCode_(code);
  switch (action) {
    case 'init': return init_();
    case 'list': return list_();
    case 'check': return check_(p || []);
    case 'upload': return upload_(p);
    case 'update': return update_(p);
    case 'remove': return remove_(p);
    case 'fix': return fix_(p);
    case 'expand': return expand_(p);
  }
  throw new Error('알 수 없는 요청입니다.');
}

function checkCode_(code) {
  const want = props_().getProperty('UPLOAD_CODE');
  if (!want) throw new Error('업로드 코드가 아직 정해지지 않았습니다. 담당 선생님께 알려 주세요.');
  if (String(code || '').trim() !== want) throw new Error('CODE:업로드 코드가 맞지 않습니다.');
}

// 시트 메뉴 [사이트 반영 → 업로드 코드 정하기]
function setUploadCode() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('업로드 코드 정하기', '자료를 올리는 선생님들께 알려 줄 코드를 입력하세요. (4자 이상)', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const code = res.getResponseText().trim();
  if (code.length < 4) return ui.alert('4자 이상으로 정해 주세요.');
  props_().setProperty('UPLOAD_CODE', code);
  props_().setProperty('SHEET_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
  const url = ScriptApp.getService().getUrl();
  ui.alert('업로드 코드를 저장했습니다.\n\n앱 주소: ' + (url || '(아직 웹앱으로 배포하지 않았습니다)'));
}

// =========================================================
// 시트 읽기·쓰기
// =========================================================
function props_() { return PropertiesService.getScriptProperties(); }

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(props_().getProperty('SHEET_ID'));
}

function keyOf_(h) {
  h = String(h).replace(/[(\[（].*?[)\]）]/g, '').replace(/\s+/g, '').toLowerCase();
  for (const k in KEYS) if (KEYS[k].indexOf(h) >= 0) return k;
  if (h.indexOf('pdf') >= 0) return 'file';
  if (h.indexOf('유튜브') >= 0 || h.indexOf('youtube') >= 0 || h.indexOf('영상') >= 0) return 'youtube';
  return '';
}

// 자료 탭의 열 위치 {키: 0부터 센 열 번호}. 앱용 열이 없으면 만듦
function table_() {
  const sh = ss_().getSheetByName(DATA_SHEET);
  if (!sh) throw new Error(`시트에 '${DATA_SHEET}' 탭이 없습니다.`);
  let width = Math.max(sh.getLastColumn(), 1);
  const head = sh.getRange(1, 1, 1, width).getValues()[0];
  const col = {};
  head.forEach((h, i) => { const k = keyOf_(h); if (k && !(k in col)) col[k] = i; });
  if (!('item' in col) || !('file' in col) || !('youtube' in col)) {
    throw new Error("자료 탭 1행에서 '항목', 'PDF 링크', '유튜브 링크' 열을 찾지 못했습니다.");
  }
  for (const k in EXTRA) {
    if (!(k in col)) { width++; sh.getRange(1, width).setValue(EXTRA[k]); col[k] = width - 1; }
  }
  return { sh, col, width };
}

// 모든 줄 → [{row, uid, stage, item, …, at(숫자), hidden{file,youtube}}]. 관리번호가 없으면 붙임
function rows_(t) {
  const n = t.sh.getLastRow() - 1;
  if (n < 1) return [];
  const rng = t.sh.getRange(2, 1, n, t.width);
  const shown = rng.getDisplayValues();
  const raw = rng.getValues();
  const rich = rng.getRichTextValues();
  const out = [];
  let newIds = false;
  shown.forEach((v, i) => {
    const r = { row: i + 2, hidden: {} };
    for (const k in t.col) r[k] = String(v[t.col[k]] || '').trim();
    const at = raw[i][t.col.at];
    r.at = at instanceof Date ? at.getTime() : 0;
    // 글자 뒤에 숨긴 링크(주소 대신 글자가 보이는 칸)
    ['file', 'youtube'].forEach((k) => {
      const rt = rich[i][t.col[k]];
      if (!rt || !r[k] || /^https?:\/\//i.test(r[k])) return;
      const url = rt.getRuns().map((x) => x.getLinkUrl()).filter(Boolean)[0];
      if (url) r.hidden[k] = url;
    });
    if (!['stage', 'item', 'title', 'file', 'youtube'].some((k) => r[k])) return; // 빈 줄
    if (!r.uid) newIds = true;
    out.push(r);
  });
  if (newIds) {
    // 관리번호가 빈 줄에 붙임 (동시에 다른 요청이 붙였으면 그 번호를 씀)
    withLock_(() => {
      const ids = t.sh.getRange(2, t.col.uid + 1, n, 1).getDisplayValues();
      out.forEach((r) => {
        const k = r.row - 2;
        const now = String(ids[k][0]).trim();
        if (now) r.uid = now;
        else if (!r.uid) { r.uid = newId_(); ids[k][0] = r.uid; }
      });
      t.sh.getRange(2, t.col.uid + 1, n, 1).setValues(ids);
    });
  }
  return out;
}

function newId_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 10); }

function findRow_(t, uid) {
  const n = t.sh.getLastRow() - 1;
  if (n < 1 || !uid) return 0;
  const ids = t.sh.getRange(2, t.col.uid + 1, n, 1).getDisplayValues();
  const k = ids.findIndex((x) => String(x[0]).trim() === uid);
  return k < 0 ? 0 : k + 2;
}

// rowNo 가 0이면 맨 아래에 새 줄, 아니면 그 줄에서 data 에 있는 칸만 바꿈
function writeRow_(t, rowNo, data) {
  if (!rowNo) {
    const cur = new Array(t.width).fill('');
    for (const k in data) if (k in t.col) cur[t.col[k]] = data[k];
    t.sh.appendRow(cur);
    return;
  }
  for (const k in data) if (k in t.col) t.sh.getRange(rowNo, t.col[k] + 1).setValue(data[k]);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// 목록 탭(A 단계, B 항목) → [{name, items:[…]}]
function stages_() {
  const sh = ss_().getSheetByName(LIST_SHEET);
  if (!sh) throw new Error(`시트에 '${LIST_SHEET}' 탭이 없습니다.`);
  const out = [];
  sh.getDataRange().getDisplayValues().slice(1).forEach(([s, it]) => {
    s = String(s).trim(); it = String(it).trim();
    if (!s || !it) return;
    let st = out.find((x) => x.name === s);
    if (!st) out.push(st = { name: s, items: [] });
    if (st.items.indexOf(it) < 0) st.items.push(it);
  });
  return out;
}

const norm_ = (s) => String(s || '').replace(/\s+/g, '');
const stageKey_ = (s) => norm_(String(s || '').replace(/^\d+/, ''));

// =========================================================
// 링크 알아보기 (build_data.py 와 같은 규칙)
// =========================================================
function driveId_(v) { const m = String(v).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]{20,})/); return m ? m[1] : ''; }
function folderId_(v) { const m = String(v).match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]{10,})/); return m ? m[1] : ''; }
function gdocId_(v) { const m = String(v).match(/docs\.google\.com\/(?:spreadsheets|document|presentation)\/d\/([\w-]{20,})/); return m ? m[1] : ''; }
function ytId_(v) {
  v = String(v || '').trim();
  if (/^[\w-]{11}$/.test(v)) return v;
  const m = v.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/);
  return m ? m[1] : '';
}
function isWeb_(v) {
  v = String(v || '').trim();
  return /^https?:\/\/\S+$/i.test(v) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(v);
}
function fileUrl_(f) { return `https://drive.google.com/file/d/${f.getId()}/view`; }

// 행의 자료 종류
function kindOf_(r) {
  if (/^(단계소개|소개)$/.test(norm_(r.item))) return 'stageintro';
  if (norm_(r.group) === '소개') return 'intro';
  if (r.youtube) return 'video';
  if (!r.file) return 'none';
  if (folderId_(r.file)) return 'folder';
  if (driveId_(r.file)) return 'pdf';
  if (gdocId_(r.file)) return 'gdoc';
  if (isWeb_(r.file)) return 'web';
  return 'bad';
}

// =========================================================
// 드라이브
// =========================================================
function shared_(x) {
  try {
    const a = x.getSharingAccess();
    return a === DriveApp.Access.ANYONE_WITH_LINK || a === DriveApp.Access.ANYONE;
  } catch (e) { return false; }
}

function mine_(x) {
  try { return x.getOwner().getEmail() === Session.getEffectiveUser().getEmail(); } catch (e) { return false; }
}

// 공유 열고 실제로 열렸는지 확인
function publish_(x) {
  x.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  if (!shared_(x)) throw new Error('파일 공유를 열지 못했습니다.');
  return x;
}

function rootFolder_() {
  const id = props_().getProperty('ROOT_ID');
  if (id) {
    try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* 새로 만듦 */ }
  }
  const f = DriveApp.createFolder(ROOT_NAME);
  props_().setProperty('ROOT_ID', f.getId());
  return f;
}

function child_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// 연구학교 자료/단계/항목/(분류)
function folderFor_(stage, item, group) {
  let f = child_(rootFolder_(), stage || '단계 없음');
  f = child_(f, item || '항목 없음');
  if (group) f = child_(f, group);
  return f;
}

// 앱이 만든 파일(연구학교 자료 폴더 안)인지 — 선생님 개인 파일은 지우거나 옮기지 않으려고
function inRoot_(x) {
  const root = rootFolder_().getId();
  let level = [x];
  for (let d = 0; d < 6 && level.length; d++) {
    const next = [];
    for (const f of level) {
      const it = f.getParents();
      while (it.hasNext()) {
        const p = it.next();
        if (p.getId() === root) return true;
        next.push(p);
      }
    }
    level = next;
  }
  return false;
}

function openFile_(id) { try { return DriveApp.getFileById(id); } catch (e) { return null; } }

// 드라이브 링크의 PDF를 폴더로 복사 → {f: 복사본, name: 원래 이름}
function copyFromLink_(link, folder) {
  const id = driveId_(link);
  if (!id) {
    if (gdocId_(link)) throw new Error("구글 문서·시트·슬라이드는 PDF가 아니에요. '웹사이트·웹앱'으로 올리거나 PDF로 저장해 주세요.");
    throw new Error('드라이브 파일 링크가 아니에요. (drive.google.com/file/d/… 형태)');
  }
  const src = openFile_(id);
  if (!src) throw new Error("파일을 열 수 없어요. 공유를 '링크가 있는 모든 사용자'로 바꾸거나, 파일을 내려받아 [내 컴퓨터에서 올리기]로 올려 주세요.");
  if (src.getMimeType() !== MimeType.PDF) throw new Error(`PDF가 아니에요 (${src.getName()}). PDF로 저장해서 올려 주세요.`);
  return { f: src.makeCopy(src.getName(), folder), name: src.getName() };
}

// 폴더 링크 → 안의 PDF 목록 (이름순) {files:[{name, link}], skipped:[이름]}
function expand_(link) {
  const id = folderId_(link);
  let folder;
  try { folder = DriveApp.getFolderById(id); } catch (e) {
    throw new Error("폴더를 열 수 없어요. 폴더 공유를 '링크가 있는 모든 사용자'로 바꿔 주세요.");
  }
  const files = [];
  const skipped = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getMimeType() === MimeType.PDF) files.push({ name: f.getName(), link: fileUrl_(f) });
    else skipped.push(f.getName());
  }
  const key = (n) => n.replace(/\d+/g, (d) => d.padStart(8, '0')).toLowerCase();
  files.sort((a, b) => (key(a.name) < key(b.name) ? -1 : 1));
  if (!files.length) throw new Error('폴더 안에 PDF가 없어요.');
  return { files, skipped };
}

function cleanTitle_(name) {
  name = String(name).trim().replace(/\s*의 사본$/, '').replace(/^(?:Copy of|사본)\s+/, '');
  name = name.replace(/\.(pdf|png|jpe?g|gif|webp)$/i, '');
  return name.replace(/^\d+\s*[._\-)]\s*/, '').trim() || name;
}

function blob_(file, wantPdf) {
  if (!file || !file.data) throw new Error('파일이 없습니다.');
  const bytes = Utilities.base64Decode(file.data);
  if (bytes.length > MAX_BYTES) throw new Error(`${file.name}: 45MB보다 커서 올릴 수 없습니다.`);
  if (wantPdf) {
    const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (head !== '%PDF') throw new Error(`${file.name}: PDF 파일이 아닙니다.`);
    return Utilities.newBlob(bytes, 'application/pdf', file.name);
  }
  if (!/^image\//.test(file.type || '')) throw new Error(`${file.name}: 그림 파일이 아닙니다.`);
  return Utilities.newBlob(bytes, file.type, file.name);
}

// =========================================================
// 사이트 반영: 1분 뒤 한 번 (그 사이 여러 번 바꿔도 한 번만)
// =========================================================
function scheduleDeploy_() {
  const has = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'runScheduledDeploy');
  if (!has) ScriptApp.newTrigger('runScheduledDeploy').timeBased().after(60 * 1000).create();
}

function runScheduledDeploy() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'runScheduledDeploy')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  if (!/^https:\/\/api\.cloudflare\.com\//.test(DEPLOY_HOOK)) return; // 테스트용 사본 등 후크 주소가 없을 때
  const res = UrlFetchApp.fetch(DEPLOY_HOOK, { method: 'post', muteHttpExceptions: true });
  if (res.getResponseCode() === 200) props_().setProperty('LAST_DEPLOY_AT', String(Date.now()));
}

function deployState_() {
  return {
    lastDeploy: Number(props_().getProperty('LAST_DEPLOY_AT') || 0),
    pending: ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'runScheduledDeploy'),
  };
}

// =========================================================
// 앱 기능
// =========================================================
function init_() {
  return { stages: stages_(), stageIntro: STAGE_INTRO };
}

function list_() {
  const t = table_();
  const rows = rows_(t);
  return {
    stages: stages_(),
    rows: rows.map((r) => ({
      uid: r.uid, row: r.row, stage: r.stage, item: r.item, group: r.group, title: r.title, desc: r.desc,
      by: r.by, at: r.at, kind: kindOf_(r), link: r.youtube || r.file, thumb: r.thumb,
    })),
    deploy: deployState_(),
  };
}

// 줄마다 점검 → {uid: {s: 'ok'|'bad'|'warn', why, fix}}
function check_(uids) {
  const t = table_();
  const all = rows_(t);
  const st = stages_();
  const out = {};
  uids.forEach((uid) => {
    const r = all.find((x) => x.uid === uid);
    if (r) out[uid] = checkRow_(r, st);
  });
  return out;
}

function checkRow_(r, stages) {
  const ok = { s: 'ok' };
  const bad = (why, fix) => ({ s: 'bad', why, fix: fix || '' });
  const kind = kindOf_(r);

  // 항목·단계
  if (kind === 'stageintro') {
    if (!stages.some((s) => stageKey_(s.name) === stageKey_(r.stage))) return bad('단계 소개는 단계를 골라야 해요');
  } else {
    const st = stages.find((s) => s.items.some((it) => norm_(it) === norm_(r.item)));
    if (!r.item) return bad('항목이 비어 있어요');
    if (!st) return bad(`'${r.item}'은(는) 로드맵에 없는 항목이에요`);
    if (r.stage && stageKey_(r.stage) !== stageKey_(st.name)) return bad(`'${r.item}'은(는) '${st.name}' 단계 항목이에요`);
  }
  if (r.file && r.youtube) return bad('PDF 링크와 유튜브 링크가 둘 다 있어요. 하나만 남겨 주세요');
  if (r.hidden.file || r.hidden.youtube) return bad('주소 대신 글자가 들어 있어요 (링크가 글자 뒤에 숨어 있음)', 'unhide');

  let res = ok;
  if (kind === 'none') return bad('링크가 비어 있어요');
  if (kind === 'bad') return bad('링크를 알아볼 수 없어요');
  if (kind === 'video') {
    const did = driveId_(r.youtube);
    if (did) res = checkFile_(did, false);
    else if (!ytId_(r.youtube)) return bad('유튜브 주소를 알아볼 수 없어요');
  } else if (kind === 'folder') {
    let f;
    try { f = DriveApp.getFolderById(folderId_(r.file)); } catch (e) { return bad('폴더를 열 수 없어요 (지워졌거나 공유가 꺼져 있어요)'); }
    if (!shared_(f)) return bad('폴더 공유가 꺼져 있어요', mine_(f) ? 'share' : '');
    const it = f.getFilesByType(MimeType.PDF);
    if (!it.hasNext()) return bad('폴더 안에 PDF가 없어요');
  } else if (kind === 'pdf' || kind === 'intro' || kind === 'stageintro') {
    const id = driveId_(r.file);
    if (!id) return bad('드라이브 PDF 링크가 아니에요');
    res = checkFile_(id, true);
  } else if (kind === 'gdoc') {
    const f = openFile_(gdocId_(r.file));
    if (!f || !shared_(f)) res = { s: 'warn', why: '구글 문서 공유가 꺼져 있어 사이트에서 "액세스 필요"로 보여요', fix: f && mine_(f) ? 'share' : '' };
  }
  if (res.s !== 'ok') return res;

  // 썸네일은 문제가 있어도 사이트엔 기본 그림으로 나옴 → 주의만
  if (r.thumb) {
    const tid = driveId_(r.thumb);
    if (tid) {
      const f = openFile_(tid);
      if (!f || !shared_(f)) return { s: 'warn', why: '썸네일 그림 공유가 꺼져 있어 기본 그림으로 보여요', fix: f && mine_(f) ? 'share-thumb' : '' };
    } else if (!/^https:\/\//i.test(r.thumb)) {
      return { s: 'warn', why: '썸네일 링크를 알아볼 수 없어 기본 그림으로 보여요' };
    }
  }
  return ok;
}

function checkFile_(id, needPdf) {
  const f = openFile_(id);
  if (!f) return { s: 'bad', why: '파일을 열 수 없어요 (지워졌거나 공유가 꺼져 있어요)' };
  if (f.isTrashed()) return { s: 'bad', why: '파일이 휴지통에 있어요', fix: mine_(f) ? 'restore' : '' };
  if (needPdf && f.getMimeType() !== MimeType.PDF) return { s: 'bad', why: `PDF가 아니에요 (${f.getName()})` };
  if (!shared_(f)) return { s: 'bad', why: '공유가 꺼져 있어요', fix: mine_(f) ? 'share' : '' };
  return { s: 'ok' };
}

// 입력 확인 → {stage, item(시트에 쓸 값), folderItem}
function validate_(p) {
  const stages = stages_();
  const st = stages.find((s) => s.name === p.stage);
  if (!st) throw new Error('단계를 골라 주세요.');
  if (p.item === STAGE_INTRO) {
    if (p.kind !== 'intro') throw new Error('단계 소개에는 카드뉴스만 올릴 수 있어요.');
    return { stage: st.name, item: STAGE_INTRO, stageIntro: true };
  }
  if (st.items.indexOf(p.item) < 0) throw new Error('항목을 골라 주세요.');
  if (norm_(p.group) === '소개' && p.kind !== 'intro') throw new Error("분류에 '소개'는 쓸 수 없어요. (카드뉴스 전용)");
  return { stage: st.name, item: p.item, stageIntro: false };
}

function upload_(p) {
  const v = validate_(p);
  const made = [];
  try {
    const row = {
      stage: v.stage, item: v.item, group: String(p.group || '').trim(), title: String(p.title || '').trim(),
      desc: String(p.desc || '').trim(), by: String(p.by || '').trim(), file: '', youtube: '', thumb: '',
    };
    if (p.kind === 'pdf' || p.kind === 'intro') {
      if (p.kind === 'intro') row.group = v.stageIntro ? '' : '소개';
      const folder = folderFor_(v.stage, v.item, p.kind === 'intro' ? (v.stageIntro ? '' : '소개') : row.group);
      const got = p.link ? copyFromLink_(p.link, folder) : { f: folder.createFile(blob_(p.file, true)), name: p.file.name };
      made.push(got.f);
      publish_(got.f);
      row.file = fileUrl_(got.f);
      if (!row.title) row.title = p.kind === 'intro' ? '소개' : cleanTitle_(got.name);
    } else if (p.kind === 'video') {
      if (!ytId_(p.url)) throw new Error('유튜브 주소를 알아볼 수 없어요.');
      row.youtube = String(p.url).trim();
    } else if (p.kind === 'web') {
      let url = String(p.url || '').trim();
      if (!isWeb_(url)) throw new Error('웹 주소를 알아볼 수 없어요. (예: https://…)');
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      row.file = url;
      if (p.thumb) {
        const f = publish_(folderFor_(v.stage, v.item, '썸네일').createFile(blob_(p.thumb, false)));
        made.push(f);
        row.thumb = fileUrl_(f);
      }
    } else {
      throw new Error('자료 종류를 골라 주세요.');
    }
    row.uid = newId_();
    row.at = new Date();
    withLock_(() => writeRow_(table_(), 0, row));
  } catch (e) {
    made.forEach((f) => { try { f.setTrashed(true); } catch (_) { /* 이미 없음 */ } });
    throw e;
  }
  scheduleDeploy_();
  return { ok: true };
}

function update_(p) {
  const t = table_();
  const rowNo = findRow_(t, p.uid);
  if (!rowNo) throw new Error('자료를 찾지 못했습니다. 목록을 새로 고쳐 주세요.');
  const cur = rows_(t).find((r) => r.uid === p.uid);
  const kind = kindOf_(cur);
  const v = validate_(Object.assign({}, p, { kind: kind === 'stageintro' ? 'intro' : kind === 'intro' ? 'intro' : 'x' }));
  const data = {
    stage: v.stage, item: v.item, title: String(p.title || '').trim(), desc: String(p.desc || '').trim(), at: new Date(),
  };
  if (kind !== 'stageintro' && kind !== 'intro') data.group = String(p.group || '').trim();
  const group = kind === 'intro' ? '소개' : kind === 'stageintro' ? '' : data.group;

  const made = [];
  const trash = [];
  try {
    // 파일 교체 (PDF·카드뉴스)
    if ((p.file || p.link) && (kind === 'pdf' || kind === 'intro' || kind === 'stageintro')) {
      const folder = folderFor_(v.stage, v.item, group);
      const f = p.link ? copyFromLink_(p.link, folder).f : folder.createFile(blob_(p.file, true));
      made.push(f);
      publish_(f);
      data.file = fileUrl_(f);
      const old = openFile_(driveId_(cur.file));
      if (old && inRoot_(old)) trash.push(old);
    } else if (kind === 'pdf' || kind === 'intro' || kind === 'stageintro') {
      // 단계·항목·분류가 바뀌면 앱이 만든 파일은 새 폴더로 옮김
      const old = openFile_(driveId_(cur.file));
      if (old && inRoot_(old) && (cur.stage !== v.stage || cur.item !== v.item || norm_(cur.group) !== norm_(group))) {
        old.moveTo(folderFor_(v.stage, v.item, group));
      }
    }
    // 주소 바꾸기 (영상·웹)
    if (p.url !== undefined && (kind === 'video' || kind === 'web' || kind === 'gdoc')) {
      const url = String(p.url).trim();
      if (kind === 'video') {
        if (!ytId_(url) && !driveId_(url)) throw new Error('유튜브 주소를 알아볼 수 없어요.');
        data.youtube = url;
      } else {
        if (!isWeb_(url)) throw new Error('웹 주소를 알아볼 수 없어요.');
        data.file = /^https?:\/\//i.test(url) ? url : 'https://' + url;
      }
    }
    // 썸네일 (웹)
    if (p.thumb || p.dropThumb) {
      const old = cur.thumb ? openFile_(driveId_(cur.thumb)) : null;
      if (old && inRoot_(old)) trash.push(old);
      data.thumb = '';
      if (p.thumb) {
        const f = publish_(folderFor_(v.stage, v.item, '썸네일').createFile(blob_(p.thumb, false)));
        made.push(f);
        data.thumb = fileUrl_(f);
      }
    }
    withLock_(() => {
      const n = findRow_(t, p.uid);
      if (!n) throw new Error('그 사이 자료가 지워졌습니다. 목록을 새로 고쳐 주세요.');
      writeRow_(t, n, data);
    });
  } catch (e) {
    made.forEach((f) => { try { f.setTrashed(true); } catch (_) { /* 이미 없음 */ } });
    throw e;
  }
  trash.forEach((f) => { try { f.setTrashed(true); } catch (_) { /* 이미 없음 */ } });
  scheduleDeploy_();
  return { ok: true };
}

function remove_(uid) {
  const t = table_();
  const cur = rows_(t).find((r) => r.uid === uid);
  if (!cur) throw new Error('자료를 찾지 못했습니다. 목록을 새로 고쳐 주세요.');
  withLock_(() => {
    const n = findRow_(t, uid);
    if (n) t.sh.deleteRow(n);
  });
  // 앱이 만든 파일만 휴지통으로 (30일 안에 되살릴 수 있음)
  [driveId_(cur.file), driveId_(cur.thumb)].filter(Boolean).forEach((id) => {
    const f = openFile_(id);
    if (f && inRoot_(f)) f.setTrashed(true);
  });
  scheduleDeploy_();
  return { ok: true };
}

// [고치기] 버튼: share(공유 열기) · share-thumb · restore(휴지통에서 꺼내기) · unhide(숨은 링크를 주소로)
function fix_(p) {
  const t = table_();
  const cur = rows_(t).find((r) => r.uid === p.uid);
  if (!cur) throw new Error('자료를 찾지 못했습니다. 목록을 새로 고쳐 주세요.');
  if (p.fix === 'unhide') {
    const data = {};
    if (cur.hidden.file) data.file = cur.hidden.file;
    if (cur.hidden.youtube) data.youtube = cur.hidden.youtube;
    data.at = new Date();
    withLock_(() => writeRow_(t, findRow_(t, p.uid), data));
  } else {
    const link = p.fix === 'share-thumb' ? cur.thumb : (cur.youtube || cur.file);
    const id = driveId_(link) || gdocId_(link);
    let x = id ? openFile_(id) : null;
    if (!id && folderId_(link)) { try { x = DriveApp.getFolderById(folderId_(link)); } catch (e) { x = null; } }
    if (!x || !mine_(x)) throw new Error('선생님 드라이브의 파일이 아니라 여기서 고칠 수 없어요. 파일 주인에게 공유를 부탁해 주세요.');
    if (p.fix === 'restore') x.setTrashed(false);
    else publish_(x);
    withLock_(() => writeRow_(t, findRow_(t, p.uid), { at: new Date() }));
  }
  scheduleDeploy_();
  return checkRow_(rows_(t).find((r) => r.uid === p.uid), stages_());
}

// =========================================================
// 기존 자료 정리 (시트 메뉴 → 주인만): 드라이브 파일을 '연구학교 자료' 폴더로 복사, 링크 교체, 원래 링크는 '이전 링크' 칸에
// =========================================================
function openMigrate() {
  const html = HtmlService.createHtmlOutputFromFile('Migrate').setWidth(720).setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, '기존 자료 정리');
}

function ownerOnly_() {
  const me = Session.getEffectiveUser().getEmail();
  if (!me || Session.getActiveUser().getEmail() !== me) throw new Error('시트 주인만 할 수 있습니다.');
}

// 정리할 줄 미리보기
function migratePlan() {
  ownerOnly_();
  const t = table_();
  const rows = rows_(t);
  const stages = stages_();
  const plan = [];
  rows.forEach((r) => {
    if (r.prev) return; // 이미 정리함
    const kind = kindOf_(r);
    const link = r.youtube || r.file;
    const id = driveId_(link);
    const fid = folderId_(link);
    if (!id && !fid) return; // 유튜브·웹 주소는 그대로
    const p = { uid: r.uid, row: r.row, title: r.title || r.item, kind, stage: stageOf_(r, stages) };
    if (fid) {
      try {
        const f = DriveApp.getFolderById(fid);
        if (inRoot_(f)) return;
        p.name = f.getName() + ' (폴더)';
      } catch (e) { p.problem = '폴더를 열 수 없음 (공유 꺼짐·삭제)'; }
    } else {
      const f = openFile_(id);
      if (!f) p.problem = '파일을 열 수 없음 (공유 꺼짐·삭제)';
      else if (inRoot_(f)) return;
      else p.name = f.getName();
    }
    if (!p.stage) p.problem = p.problem || '단계를 알 수 없음 (항목 확인)';
    plan.push(p);
  });
  return plan;
}

function stageOf_(r, stages) {
  if (kindOf_(r) === 'stageintro') {
    const s = stages.find((x) => stageKey_(x.name) === stageKey_(r.stage));
    return s ? s.name : '';
  }
  const s = stages.find((x) => x.items.some((it) => norm_(it) === norm_(r.item)));
  return s ? s.name : '';
}

// 몇 줄씩 나눠서 실행 (앱스스크립트 실행 시간 제한) → [{uid, ok, why}]
function migrateRun(uids) {
  ownerOnly_();
  const t = table_();
  const stages = stages_();
  const rows = rows_(t);
  return uids.map((uid) => {
    const r = rows.find((x) => x.uid === uid);
    if (!r || r.prev) return { uid, ok: true };
    const made = [];
    try {
      const kind = kindOf_(r);
      const stage = stageOf_(r, stages);
      const item = kind === 'stageintro' ? STAGE_INTRO : r.item;
      const group = kind === 'intro' ? '소개' : kind === 'stageintro' ? '' : r.group;
      const col = r.youtube ? 'youtube' : 'file';
      const link = r[col];
      let url;
      if (folderId_(link)) {
        const src = DriveApp.getFolderById(folderId_(link));
        const dest = folderFor_(stage, item, group).createFolder(src.getName());
        made.push(dest);
        const it = src.getFiles();
        while (it.hasNext()) {
          const f = it.next();
          publish_(f.makeCopy(f.getName(), dest));
        }
        publish_(dest);
        url = dest.getUrl();
      } else {
        const src = DriveApp.getFileById(driveId_(link));
        const f = publish_(src.makeCopy(src.getName(), folderFor_(stage, item, group)));
        made.push(f);
        url = fileUrl_(f);
      }
      const data = { prev: link, at: new Date() };
      data[col] = url;
      withLock_(() => writeRow_(t, findRow_(t, uid), data));
      return { uid, ok: true };
    } catch (e) {
      made.forEach((x) => { try { x.setTrashed(true); } catch (_) { /* 이미 없음 */ } });
      return { uid, ok: false, why: e.message };
    }
  });
}

function migrateFinish() {
  ownerOnly_();
  scheduleDeploy_();
}

// 되돌리기: '이전 링크'를 다시 링크 칸으로 (복사한 파일은 드라이브에 그대로 남음)
function migrateUndo() {
  ownerOnly_();
  const t = table_();
  const rows = rows_(t);
  let n = 0;
  withLock_(() => {
    rows.forEach((r) => {
      if (!r.prev) return;
      const col = r.youtube ? 'youtube' : 'file';
      const data = { prev: '', at: new Date() };
      data[col] = r.prev;
      writeRow_(t, findRow_(t, r.uid), data);
      n++;
    });
  });
  if (n) scheduleDeploy_();
  return n;
}
