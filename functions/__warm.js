/**
 * /__warm — 모든 자료 PDF 를 KV(PDF_STORE)에 미리 채워 두기 (로그인한 사람만, _middleware.js)
 * 발표회 전에 한 번 열어 두면 당일 첫 방문자도 기다리지 않음.
 *   /__warm        아직 없는 파일만
 *   /__warm?all=1  드라이브에서 파일을 바꿨을 때: 전부 새로 받기
 * Cloudflare 무료 한도(요청당 외부 호출 50회) 때문에 한 번에 40개씩, 페이지가 알아서 이어서 진행.
 */
import { fromDrive } from './pdf/[id].js';

const BATCH = 40;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const store = env.PDF_STORE;
  if (!store) return page('PDF_STORE 저장소가 연결되지 않았습니다. Cloudflare 설정 → 바인딩에서 KV 를 연결해 주세요.', true);

  const list = await env.ASSETS.fetch(new URL('/assets/data.json', request.url));
  const data = list.ok ? await list.json() : { materials: [] };
  const ids = [...new Set([
    ...data.materials.map((m) => m.file),
    ...Object.values(data.intros || {}),
  ].filter((f) => f && f.startsWith('pdf/')).map((f) => f.slice(4)))];

  const all = url.searchParams.get('all') === '1';
  const from = Number(url.searchParams.get('from')) || 0;
  let todo = ids.slice(from);
  if (!all) {
    const have = new Set();
    let cursor;
    do {
      const r = await store.list({ cursor });
      r.keys.forEach((k) => have.add(k.name));
      cursor = r.list_complete ? null : r.cursor;
    } while (cursor);
    todo = todo.filter((id) => !have.has(id));
  }

  const batch = todo.slice(0, BATCH);
  let ok = 0;
  const failed = [];
  for (const id of batch) {
    const got = await fromDrive(id);
    if (got) {
      await store.put(id, got.body, { metadata: { t: Math.floor(Date.now() / 1000), cd: got.cd } });
      ok += 1;
    } else {
      failed.push(id);
    }
  }

  const left = todo.length - batch.length;
  const next = all ? `/__warm?all=1&from=${from + batch.length}` : '/__warm';
  const msg = `전체 ${ids.length}개 중 이번에 ${ok}개를 불러왔습니다.`
    + (failed.length ? ` 실패 ${failed.length}개 (공유 설정 확인): ${failed.join(', ')}` : '')
    + (left > 0 ? ` 남은 ${left}개를 이어서 불러옵니다…` : ' 모두 끝났습니다.');
  return page(msg, false, left > 0 && batch.length > failed.length ? next : '');
}

function page(message, error, next = '') {
  return new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${next ? `<meta http-equiv="refresh" content="1;url=${next}">` : ''}
<title>파일 미리 불러오기</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:15vh auto;padding:0 20px;line-height:1.7;color:#222}
h1{font-size:20px;color:#2d3c85}p{font-size:16px}${error ? 'p{color:#c0392b}' : ''}</style></head>
<body><h1>파일 미리 불러오기</h1><p>${message}</p>${next ? '' : '<p><a href="/">← 사이트로</a></p>'}</body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
