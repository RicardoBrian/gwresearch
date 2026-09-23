(() => {
  const map = document.getElementById('roadmap');
  const stages = [...map.querySelectorAll('.stage')];
  const toast = document.querySelector('.toast');
  let clearTimer;
  let toastTimer;

  // ---- 단계 강조: 그림·제목·항목 어디에 올려도 같은 단계 전체가 반응 ----
  function activate(stage) {
    clearTimeout(clearTimer);
    stages.forEach((s) => s.classList.toggle('is-active', s === stage));
    map.dataset.active = stage ? stage.dataset.stage : '';
  }

  function scheduleClear() {
    clearTimeout(clearTimer);
    // 같은 단계 안에서 그림 → 글자로 옮길 때 깜빡이지 않도록 약간 지연
    clearTimer = setTimeout(() => activate(null), 80);
  }

  stages.forEach((stage) => {
    const hotspots = stage.querySelectorAll('.stage__art, .stage__link, .item');
    hotspots.forEach((el) => {
      el.addEventListener('pointerenter', () => activate(stage));
      el.addEventListener('pointerleave', scheduleClear);
      el.addEventListener('focus', () => activate(stage));
      el.addEventListener('blur', scheduleClear);
    });

    const art = stage.querySelector('.stage__art');
    art.addEventListener('pointerenter', () => stage.classList.add('is-art-hover'));
    art.addEventListener('pointerleave', () => stage.classList.remove('is-art-hover'));
  });

  // ---- 클릭: 자료 페이지는 추후 연결 (지금은 준비 중 안내) ----
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
  }

  map.addEventListener('click', (e) => {
    const link = e.target.closest('.stage__art, .stage__link, .item');
    if (!link) return;
    e.preventDefault();
    const stage = link.closest('.stage');
    const label = link.classList.contains('item')
      ? link.textContent.trim()
      : stage.querySelector('.stage__name').textContent.trim();
    showToast(`‘${label}’ 자료 페이지는 준비 중입니다.`);
  });
})();
