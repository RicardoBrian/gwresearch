/* =========================================================
   자료 보기 창
   - 주소 #항목id → 항목 자료 창, #stage-N → 단계 개요 창
   - 뒤로가기·Esc·바깥 클릭·✕ 로 닫힘
   - 자료 목록: assets/data.json (나중에 구글 시트에서 생성)
   - PDF: pdf.js 로 직접 그림 (휴대폰에서도 같은 화면), 영상: YouTube
   ========================================================= */
(() => {
  const dialog = document.getElementById('viewer');
  const DATA_URL = 'assets/data.json';
  const PDFJS = new URL('assets/vendor/pdfjs/', document.baseURI).href;

  // ---- 로드맵 구조는 index.html 이 원본 ----
  const stages = [...document.querySelectorAll('.stage')].map((el) => ({
    n: Number(el.dataset.stage),
    id: `stage-${el.dataset.stage}`,
    name: el.querySelector('.stage__name').textContent.trim(),
    art: el.querySelector('.stage__art img').getAttribute('src'),
    items: [],
  }));
  const items = [];
  document.querySelectorAll('.stage').forEach((el, i) => {
    el.querySelectorAll('.item').forEach((a) => {
      const item = { id: a.hash.slice(1), title: a.textContent.trim(), stage: stages[i] };
      stages[i].items.push(item);
      items.push(item);
    });
  });
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const itemById = new Map(items.map((it) => [it.id, it]));

  // ---- 자료 목록 ----
  let materials = new Map();
  let loadFailed = false;
  const dataReady = fetch(DATA_URL, { cache: 'no-cache' })
    .then((r) => {
      // 로그인 시간이 끝났으면 새로 고쳐서 비밀번호 화면으로
      if (r.status === 401) location.reload();
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    })
    .then((data) => {
      for (const m of data.materials || []) {
        if (!materials.has(m.item)) materials.set(m.item, []);
        materials.get(m.item).push(m);
      }
    })
    .catch((err) => {
      loadFailed = true;
      console.error('자료 목록을 불러오지 못했습니다:', err);
    });

  // ---- 유틸 ----
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  function youtubeId(v) {
    if (!v) return '';
    if (/^[\w-]{11}$/.test(v)) return v;
    try {
      const u = new URL(v);
      if (u.hostname === 'youtu.be') return u.pathname.slice(1, 12);
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = u.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{11})/);
      return m ? m[1] : '';
    } catch {
      return '';
    }
  }

  // ---- 분류 (시트의 "분류" 칸) ----
  // 분류가 하나라도 있으면: 항목 → 분류 카드 → 분류별 자료
  // 분류 칸이 빈 자료는 "공통"으로 묶음
  const COMMON = '공통';
  const hasGroups = (list) => list.some((m) => (m.group || '').trim());

  function groupsOf(list) {
    const out = [];
    for (const m of list) {
      const name = (m.group || '').trim() || COMMON;
      let g = out.find((x) => x.name === name);
      if (!g) out.push(g = { name, list: [] });
      g.list.push(m);
    }
    return out;
  }

  const groupPath = (item, name) => `${item.id}/${encodeURIComponent(name)}`;

  function summary(list) {
    if (!list.length) return '자료 준비 중';
    const pdf = list.filter((m) => m.type === 'pdf').length;
    const video = list.filter((m) => m.type === 'video').length;
    return [pdf && `문서 ${pdf}`, video && `영상 ${video}`].filter(Boolean).join(' · ');
  }

  const ICON = {
    pdf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3v5h5M9 13h6M9 17h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12M12 6v12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  // ---- 주소(해시) ↔ 창 ----
  // #stage-N, #항목id, #항목id/분류
  function routeOf(hash) {
    const raw = hash.replace(/^#/, '');
    const [id, g] = raw.split('/');
    const group = g ? decodeURIComponent(g) : null;
    if (!group && stageById.has(id)) return { kind: 'stage', stage: stageById.get(id), path: id };
    if (itemById.has(id)) {
      return { kind: 'item', item: itemById.get(id), group, path: group ? groupPath(itemById.get(id), group) : id };
    }
    return null;
  }

  // 창 안에서 몇 번 이동했는지 기억 → 닫을 때 그만큼 뒤로 가서 로드맵 주소로 복귀
  const depth = () => (history.state && history.state.viewerDepth) || 0;

  function go(path, replace) {
    const d = replace ? depth() : depth() + 1;
    history[replace ? 'replaceState' : 'pushState']({ viewerDepth: d }, '', `#${path}`);
    render();
  }

  function close() {
    const d = depth();
    if (d > 0) {
      history.go(-d);
    } else {
      history.replaceState(null, '', location.pathname + location.search);
      render();
    }
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const route = routeOf(a.getAttribute('href'));
    if (!route) return;
    e.preventDefault();
    go(route.path, a.hasAttribute('data-replace'));
  });

  window.addEventListener('popstate', render);
  window.addEventListener('hashchange', render);

  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });

  // 바깥(배경) 클릭 시 닫기
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });

  // ---- 그리기 ----
  let shownKey = '';
  let cleanup = () => {};
  let token = 0;

  function openDialog() {
    if (dialog.open) return;
    dialog.classList.remove('is-closing');
    dialog.showModal();
    document.documentElement.classList.add('has-modal');
  }

  function closeDialog() {
    if (!dialog.open) return;
    cleanup();
    cleanup = () => {};
    shownKey = '';
    const done = () => {
      dialog.close();
      dialog.classList.remove('is-closing');
      dialog.replaceChildren();
      document.documentElement.classList.remove('has-modal');
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
    dialog.classList.add('is-closing');
    setTimeout(done, 180);
  }

  async function render() {
    const route = routeOf(location.hash);
    if (!route) return closeDialog();
    if (route.path === shownKey && dialog.open) return;
    shownKey = route.path;
    cleanup();
    cleanup = () => {};
    const my = ++token;

    openDialog();
    if (route.kind === 'stage') renderStage(route.stage);
    else renderItem(route.item, route.group, my);
  }

  // 머리글: [위치 표시 / 제목]  ……  [닫기]
  // 단계 화면은 제목 대신 단계 탭(①~⑤)을 보여줌 — 지금 단계가 보이고 다른 단계로 바로 이동
  function head({ stage, title, crumb, tabs = '' }) {
    return `
      <header class="viewer__head${tabs ? ' has-tabs' : ''}">
        <div class="viewer__heading">
          <div class="viewer__crumb">${crumb}</div>
          <div class="viewer__titleline">
            <h2 class="viewer__title${tabs ? ' sr-only' : ''}" id="viewer-title" tabindex="-1">${esc(title)}</h2>
          </div>
          ${tabs}
        </div>
        <img class="viewer__art" src="${esc(stage.art)}" alt="">
        <div class="viewer__actions">
          <button class="hbtn viewer__close" type="button" aria-label="닫기">${ICON.close}</button>
        </div>
      </header>`;
  }

  function stageTabs(current) {
    return `
      <nav class="stagetabs" aria-label="단계">
        ${stages.map((s) => `
          <a class="stagetab" href="#${s.id}" data-replace${s === current ? ' aria-current="page"' : ''}>
            <span class="stagetab__num">${s.n}</span><span class="stagetab__name">${esc(s.name)}</span>
          </a>`).join('')}
      </nav>`;
  }

  function mount(html) {
    dialog.innerHTML = html;
    dialog.setAttribute('aria-labelledby', 'viewer-title');
    dialog.querySelector('.viewer__close').addEventListener('click', close);
    dialog.querySelector('#viewer-title').focus({ preventScroll: true });
  }

  // ---- 단계 개요 ----
  async function renderStage(stage) {
    await dataReady;
    const cards = stage.items.map((it) => {
      const list = materials.get(it.id) || [];
      let meta = summary(list);
      if (hasGroups(list)) {
        const names = groupsOf(list).map((g) => g.name);
        meta = names.slice(0, 3).join(' · ') + (names.length > 3 ? ` 외 ${names.length - 3}` : '');
      }
      return `
        <li><a class="card" href="#${esc(it.id)}">
          <span class="card__title">${esc(it.title)}</span>
          <span class="card__meta${list.length ? '' : ' is-empty'}">${esc(meta)}</span>
          <span class="card__arrow">${ICON.next}</span>
        </a></li>`;
    }).join('');
    mount(`
      ${head({
        stage,
        title: stage.name,
        crumb: '<span>학생 성장 지원 로드맵</span>',
        tabs: stageTabs(stage),
      })}
      <div class="viewer__body viewer__body--stage">
        <ul class="cards">${cards}</ul>
      </div>`);
    // 휴대폰에서 가로로 넘치면 지금 단계 탭이 보이게
    const cur = dialog.querySelector('.stagetab[aria-current]');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  // ---- 항목 자료 ----
  async function renderItem(item, group, my) {
    const stage = item.stage;
    const stageLink = `<a class="viewer__back" href="#${stage.id}" data-replace><span class="badge">${stage.n}</span><span>${esc(stage.name)}</span></a>`;

    await dataReady;
    if (my !== token) return;

    const all = materials.get(item.id) || [];
    const groups = hasGroups(all) ? groupsOf(all) : [];
    const current = group ? groups.find((g) => g.name === group) : null;

    // 분류가 있는 항목인데 분류를 아직 안 골랐으면 → 분류 카드
    if (groups.length && !current) {
      renderGroups(item, groups, all, stageLink);
      return;
    }

    const list = current ? current.list : all;
    const crumb = current
      ? `${stageLink}<span class="viewer__sep" aria-hidden="true">›</span><a class="viewer__crumbitem" href="#${esc(item.id)}" data-replace>${esc(item.title)}</a>`
      : stageLink;

    mount(`
      ${head({ stage, title: current ? current.name : item.title, crumb })}
      <div class="viewer__body"></div>`);
    const body = dialog.querySelector('.viewer__body');

    if (loadFailed) {
      body.innerHTML = state('자료 목록을 불러오지 못했습니다.', '잠시 후 다시 시도해 주세요. 계속되면 담당 선생님께 알려 주세요.', stage);
      return;
    }
    if (!list.length) {
      body.innerHTML = state('자료 준비 중입니다.', '이 항목의 자료는 곧 올라올 예정입니다.', stage);
      return;
    }

    // 소분류(시트의 "소분류" 칸): 목록 위 칩 버튼으로 걸러 보기
    const subs = [...new Set(list.map((m) => (m.sub || '').trim()).filter(Boolean))];
    const subBar = subs.length ? `
      <div class="subfilter" role="group" aria-label="소분류">
        <button class="subfilter__btn" type="button" data-sub="" aria-pressed="true">전체 <small>${list.length}</small></button>
        ${subs.map((x) => `
          <button class="subfilter__btn" type="button" data-sub="${esc(x)}" aria-pressed="false">${esc(x)}
            <small>${list.filter((m) => (m.sub || '').trim() === x).length}</small></button>`).join('')}
      </div>` : '';

    body.classList.toggle('has-list', list.length > 1);
    body.innerHTML = `
      ${list.length > 1 ? `
        <div class="mside">
          ${subBar}
          <nav class="mlist" aria-label="자료 목록">
            ${list.map((m, k) => `
              <button class="mlist__item" type="button" data-k="${k}" data-sub="${esc((m.sub || '').trim())}">
                <span class="mlist__icon is-${esc(m.type)}">${ICON[m.type] || ICON.pdf}</span>
                <span class="mlist__text"><span class="mlist__title">${esc(m.title)}</span>
                <span class="mlist__type">${m.type === 'video' ? '영상' : '문서 · PDF'}${!subs.length || !m.sub ? '' : ` · ${esc(m.sub)}`}</span></span>
              </button>`).join('')}
          </nav>
        </div>` : ''}
      <section class="pane" aria-live="polite"></section>`;

    const pane = body.querySelector('.pane');
    const buttons = [...body.querySelectorAll('.mlist__item')];
    let currentK = -1;
    const select = (k) => {
      if (k === currentK) return;
      currentK = k;
      buttons.forEach((b, j) => b.setAttribute('aria-current', j === k ? 'true' : 'false'));
      cleanup();
      cleanup = () => {};
      const m = list[k];
      if (m.type === 'video') showVideo(pane, m);
      else showPdf(pane, m, my);
    };
    buttons.forEach((b) => b.addEventListener('click', () => select(Number(b.dataset.k))));

    // 소분류 고르면 목록을 거르고, 보고 있던 자료가 빠지면 첫 자료를 엶
    body.querySelectorAll('.subfilter__btn').forEach((btn) => btn.addEventListener('click', () => {
      const x = btn.dataset.sub;
      body.querySelectorAll('.subfilter__btn').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      buttons.forEach((b) => { b.hidden = Boolean(x) && b.dataset.sub !== x; });
      const visible = buttons.filter((b) => !b.hidden);
      if (visible.length && buttons[currentK].hidden) select(Number(visible[0].dataset.k));
    }));
    select(0);
  }

  // ---- 분류 카드 (단계 개요와 같은 모양) ----
  function renderGroups(item, groups, all, stageLink) {
    const cards = groups.map((g) => `
      <li><a class="card" href="#${esc(groupPath(item, g.name))}">
        <span class="card__title">${esc(g.name)}</span>
        <span class="card__meta">${esc(summary(g.list))}</span>
        <span class="card__arrow">${ICON.next}</span>
      </a></li>`).join('');
    mount(`
      ${head({
        stage: item.stage,
        title: item.title,
        crumb: stageLink,
      })}
      <div class="viewer__body viewer__body--stage">
        <ul class="cards">${cards}</ul>
      </div>`);
  }

  function state(title, text, stage) {
    return `
      <div class="state">
        <img class="state__art" src="${esc(stage.art)}" alt="">
        <p class="state__title">${esc(title)}</p>
        <p class="state__text">${esc(text)}</p>
      </div>`;
  }

  // ---- 영상 ----
  function showVideo(pane, m) {
    const id = youtubeId(m.youtube);
    if (!id) {
      pane.innerHTML = '<div class="state"><p class="state__title">영상 주소가 올바르지 않습니다.</p></div>';
      return;
    }
    pane.innerHTML = `
      <div class="video-wrap">
        <div class="video">
          <button class="video__poster" type="button" style="background-image:url('https://i.ytimg.com/vi/${id}/hqdefault.jpg')">
            <span class="video__play" aria-hidden="true"></span>
            <span class="sr-only">${esc(m.title)} 재생</span>
          </button>
        </div>
        <div class="video__info">
          <h3 class="pane__title">${esc(m.title)}</h3>
          ${m.desc ? `<p class="pane__desc">${esc(m.desc)}</p>` : ''}
          <a class="btn" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener">${ICON.external}YouTube에서 보기</a>
        </div>
      </div>`;
    // 누를 때 불러와서 창이 빨리 뜨게 함
    pane.querySelector('.video__poster').addEventListener('click', (e) => {
      const iframe = document.createElement('iframe');
      iframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;
      iframe.title = m.title;
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      iframe.allowFullscreen = true;
      e.currentTarget.replaceWith(iframe);
    }, { once: true });
  }

  // ---- PDF ----
  let pdfjsLib;
  async function loadPdfjs() {
    if (!pdfjsLib) {
      pdfjsLib = await import(`${PDFJS}pdf.min.mjs`);
      pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.mjs`;
    }
    return pdfjsLib;
  }

  async function showPdf(pane, m, my) {
    const file = new URL(m.file, document.baseURI).href;
    pane.innerHTML = `
      <div class="pdf">
        <div class="pdf__bar">
          <div class="pdf__name">
            <div class="pdf__nameline">
              <h3 class="pane__title">${esc(m.title)}</h3>
              <span class="pdf__page" aria-live="off"><b>–</b> / <span>–</span></span>
            </div>
            ${m.desc ? `<p class="pdf__desc" title="${esc(m.desc)}">${esc(m.desc)}</p>` : ''}
          </div>
          <div class="pdf__tools">
            <button class="icon-btn" type="button" data-zoom="-1" aria-label="축소">${ICON.minus}</button>
            <button class="pdf__zoom" type="button" data-zoom="0" title="화면에 맞추기">맞춤</button>
            <button class="icon-btn" type="button" data-zoom="1" aria-label="확대">${ICON.plus}</button>
            <a class="icon-btn" href="${esc(file)}" target="_blank" rel="noopener" aria-label="새 창에서 열기" title="새 창에서 열기">${ICON.external}</a>
            <a class="btn btn--solid" href="${esc(file)}" download>${ICON.download}<span>내려받기</span></a>
          </div>
        </div>
        <div class="pdf__scroll" tabindex="0" aria-label="${esc(m.title)} 미리보기">
          <div class="pdf__pages"><div class="pdf__sheet is-skeleton"></div></div>
        </div>
      </div>`;

    const scroller = pane.querySelector('.pdf__scroll');
    const holder = pane.querySelector('.pdf__pages');
    const pageNow = pane.querySelector('.pdf__page b');
    const pageAll = pane.querySelector('.pdf__page span');
    const zoomLabel = pane.querySelector('.pdf__zoom');

    let alive = true;
    let doc;
    const pages = [];
    let zoom = 1;
    const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];

    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) draw(pages[Number(en.target.dataset.i)]);
      });
    }, { root: scroller, rootMargin: '800px 0px' });

    const ro = new ResizeObserver(() => {
      clearTimeout(ro.t);
      ro.t = setTimeout(relayout, 120);
    });

    cleanup = () => {
      alive = false;
      io.disconnect();
      ro.disconnect();
      if (task) task.destroy();
    };

    let task;
    try {
      const lib = await loadPdfjs();
      if (!alive || my !== token) return;
      task = lib.getDocument({
        url: file,
        cMapUrl: `${PDFJS}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${PDFJS}standard_fonts/`,
      });
      doc = await task.promise;
      if (!alive) return;
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        pages.push({ page, w: vp.width, h: vp.height, el: null, drawnAt: 0, busy: false });
      }
      if (!alive) return;
    } catch (err) {
      if (!alive) return;
      console.error(err);
      holder.innerHTML = `
        <div class="state">
          <p class="state__title">문서를 표시하지 못했습니다.</p>
          <p class="state__text">내려받기 버튼으로 파일을 직접 열어 주세요.</p>
        </div>`;
      return;
    }

    pageAll.textContent = pages.length;
    pageNow.textContent = '1';
    holder.replaceChildren(...pages.map((p, i) => {
      const el = document.createElement('div');
      el.className = 'pdf__sheet is-skeleton';
      el.dataset.i = i;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', `${i + 1}쪽`);
      el.style.aspectRatio = `${p.w} / ${p.h}`;
      p.el = el;
      return el;
    }));
    relayout();
    ro.observe(scroller);

    // 기본 크기(“맞춤”)
    // - 가로 문서(발표자료): 한 쪽 전체가 화면 안에 들어오게
    // - 세로 문서(보고서): 폭에 맞춤 (읽기 편한 최대 900px)
    function baseWidth() {
      const pad = scroller.clientWidth < 600 ? 16 : 40;
      const fitWidth = Math.min(scroller.clientWidth - pad, 900);
      const first = pages[0];
      if (first && first.w > first.h) {
        const fitPage = (scroller.clientHeight - pad) * (first.w / first.h);
        return Math.max(200, Math.min(fitWidth, fitPage));
      }
      return Math.max(200, fitWidth);
    }

    function relayout() {
      if (!alive) return;
      const ratio = scroller.scrollTop / Math.max(1, scroller.scrollHeight);
      const w = baseWidth() * zoom;
      pages.forEach((p) => { p.el.style.width = `${w}px`; });
      scroller.scrollTop = ratio * scroller.scrollHeight;
      zoomLabel.textContent = zoom === 1 ? '맞춤' : `${Math.round(zoom * 100)}%`;
      // 이미 보이는 쪽도 다시 알림 받도록 재등록
      pages.forEach((p) => { io.unobserve(p.el); io.observe(p.el); });
    }

    async function draw(p) {
      const cssW = p.el.clientWidth;
      if (!cssW || Math.abs(p.drawnAt - cssW) < 2) return;
      if (p.busy) { p.again = true; return; }
      p.busy = true;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = p.page.getViewport({ scale: (cssW / p.w) * dpr });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      try {
        await p.page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        if (!alive) return;
        p.el.replaceChildren(canvas);
        p.el.classList.remove('is-skeleton');
        p.drawnAt = cssW;
      } catch (err) {
        if (alive) console.error(err);
      } finally {
        p.busy = false;
        if (p.again && alive) { p.again = false; draw(p); }
      }
    }

    // 현재 쪽 번호
    let raf = 0;
    scroller.addEventListener('scroll', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const line = scroller.scrollTop + scroller.clientHeight * 0.35;
        let cur = 0;
        pages.forEach((p, i) => { if (p.el.offsetTop <= line) cur = i; });
        pageNow.textContent = String(cur + 1);
      });
    }, { passive: true });

    pane.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
      const d = Number(b.dataset.zoom);
      const idx = ZOOMS.indexOf(zoom);
      zoom = d === 0 ? 1 : ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, idx + d))];
      relayout();
    }));
  }

  // 처음 들어온 주소가 항목이면 바로 열기 (공유 링크)
  render();
})();
