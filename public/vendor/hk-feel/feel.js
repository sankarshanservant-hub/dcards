// Копия /apps/feel.js сайта harekrishna.info (репозиторий HareKrishna: src/scripts/feel.js + src/scripts/apps-feel.js).
// Пружины, листы, вжатие кнопок, поля ≥16px на iPhone, «назад» смахиванием, плашка «Было · Стало» (?feel=compare).
// Ключ localStorage 'feel' общий с сайтом: на harekrishna.info/dialogue-cards/ переключатель один. Обновлять копией оттуда.
// «Ощущение» интерфейса по скиллу apple-design (.claude/skills/apple-design): пружины, листы, которые тянутся за пальцем
// и закрываются броском, отклик на касание. Обычный JS без импортов: этот же файл целиком вставляется в рамку страниц общины
// (/host-chrome.js, перед menu.js). Сравнение «было / стало» (17.11.2026): html[data-feel="old"] — прежнее поведение;
// ?feel=old / ?feel=new — включить / выключить прежнее, ?feel=compare — плашка «Было · Стало» вверху экрана.
(function () {
  if (window.HKFeel) return;
  var root = document.documentElement;
  var LS = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} } };

  function apply() { if (LS.get('feel') === 'old') root.dataset.feel = 'old'; else delete root.dataset.feel; }
  try {
    var q = new URLSearchParams(location.search).get('feel');
    if (q === 'old') LS.set('feel', 'old');
    if (q === 'new') LS.set('feel', null);
    if (q === 'compare') LS.set('feelCmp', '1');
  } catch (e) {}
  apply();

  var framed = false; try { framed = window.self !== window.top; } catch (e) { framed = true; }
  function on() { return root.dataset.feel !== 'old'; }
  function reduced() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }

  // Пружина в параметрах Apple: response — «за сколько секунд доходит», damping — 1 без перелёта, меньше — с отскоком.
  // Начинает с текущего значения и текущей скорости — поэтому её можно перехватить в любой момент без рывка.
  function spring(o) {
    var response = o.response || 0.35, damping = o.damping == null ? 1 : o.damping;
    var k = Math.pow(2 * Math.PI / response, 2), c = 4 * Math.PI * damping / response;
    var x = o.from, v = o.velocity || 0, to = o.to, last = 0, raf = 0, done = false;
    function step(t) {
      if (done) return;
      var dt = last ? Math.min((t - last) / 1000, 1 / 30) : 1 / 60; last = t;
      var n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
      for (var i = 0; i < n; i++) { v += (-k * (x - to) - c * v) * h; x += v * h; }
      if (Math.abs(x - to) < 0.4 && Math.abs(v) < 8) { x = to; v = 0; done = true; o.onUpdate(x); if (o.onDone) o.onDone(); return; }
      o.onUpdate(x);
      raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return { stop: function () { done = true; cancelAnimationFrame(raf); }, velocity: function () { return v; } };
  }
  // куда «долетит» брошенный лист — функция Apple (как замедление прокрутки)
  function project(v, d) { d = d || 0.998; return (v / 1000) * d / (1 - d); }
  // за краем — мягкое сопротивление, а не упор
  function rubber(over, dim) { var c = 0.55; return (over * dim * c) / (dim + c * Math.abs(over)); }

  // Лист снизу: el сдвигается по Y (0 — открыт, size() — убран). Тянется за пальцем с ручки и с содержимого,
  // когда оно прокручено до верха; закрывается, если бросок «долетает» дальше середины.
  function sheet(o) {
    var el = o.el, y = 0, anim = null, target = 0, touch = null;
    var size = function () { return o.size ? o.size() : el.offsetHeight; };
    function paint(v) {
      y = v;
      el.style.transform = 'translate3d(0,' + v.toFixed(2) + 'px,0)';
      if (o.onProgress) { var s = size() || 1; o.onProgress(Math.max(0, Math.min(1, 1 - v / s))); }
    }
    function go(to, vel, done, opts) {
      vel = typeof vel === 'number' && isFinite(vel) ? vel : 0;
      if (anim) anim.stop();
      anim = null; target = to;
      if (reduced()) { paint(to); finish(done); return; }
      var flick = Math.abs(vel || 0) > 400 && to === 0;
      anim = spring({ from: y, to: to, velocity: vel || 0, response: (opts && opts.response) || (vel ? 0.3 : 0.36), damping: flick ? 0.86 : 1,
        onUpdate: paint, onDone: function () { anim = null; finish(done); } });
    }
    function finish(done) { if (target === 0 && !touch) el.style.transform = ''; if (done) done(); }
    var api = {
      get open() { return target === 0; },
      show: function () { if (!anim) paint(size()); go(0, 0, o.onOpened); },
      hide: function (vel, done) { go(size(), vel || 0, function () { el.style.transform = ''; if (o.onProgress) o.onProgress(0); if (done) done(); if (o.onClosed) o.onClosed(); }); },
      reset: function () { if (anim) anim.stop(); anim = null; target = 0; y = 0; el.style.transform = ''; },
    };
    var SKIP = 'input, textarea, select, .scrub, [data-nodrag]' + (o.skip ? ', ' + o.skip : '');  // o.skip — свои ползунки приложения
    el.addEventListener('touchstart', function (e) {
      if (!on() || (o.enabled && !o.enabled()) || e.touches.length > 1) { touch = null; return; }
      var t = e.touches[0], tg = e.target instanceof Element ? e.target : null;
      if (tg && tg.closest(SKIP)) { touch = null; return; }
      var handle = !!(o.handle && tg && o.handle().contains(tg));
      var sc = o.scroller ? o.scroller() : null;
      touch = { x: t.clientX, y: t.clientY, handle: handle, sc: sc && tg && sc.contains(tg) ? sc : null, active: false, dead: false, hist: [] };
      if (anim) { anim.stop(); anim = null; touch.active = true; touch.base = y; touch.hist.push([t.clientY, e.timeStamp]); }  // поймали на лету
    }, { passive: true });
    el.addEventListener('touchmove', function (e) {
      if (!touch || touch.dead) return;
      var t = e.touches[0], dx = t.clientX - touch.x, dy = t.clientY - touch.y;
      if (!touch.active) {
        var vertical = Math.abs(dy) >= Math.abs(dx);
        var canPull = touch.handle || !touch.sc || (touch.sc.scrollTop <= 0 && dy > 0);
        if (!vertical && Math.abs(dx) > 6) { touch.dead = true; return; }
        if (!canPull || !e.cancelable) { if (Math.abs(dy) > 6) touch.dead = true; return; }
        e.preventDefault();  // иначе Safari начнёт свою прокрутку и уже не отдаст жест
        if (Math.abs(dy) < 8) return;  // порог, чтобы касание не стало перетаскиванием
        touch.active = true; touch.base = y; touch.y = t.clientY;  // без скачка на величину порога
      }
      if (e.cancelable) e.preventDefault();
      var raw = touch.base + (t.clientY - touch.y);
      paint(raw < 0 ? -rubber(-raw, size()) : raw);
      touch.hist.push([t.clientY, e.timeStamp]);
      while (touch.hist.length > 2 && e.timeStamp - touch.hist[0][1] > 100) touch.hist.shift();
    }, { passive: false });
    function end(e) {
      var tc = touch; touch = null;
      if (!tc || !tc.active) return;
      var h = tc.hist, v = 0;
      if (h.length > 1 && e.timeStamp - h[h.length - 1][1] < 80) {
        var a = h[0], b = h[h.length - 1];
        if (b[1] > a[1]) v = (b[0] - a[0]) / (b[1] - a[1]) * 1000;
      }
      if (y + project(v) > size() * (o.threshold || 0.5)) api.hide(v); else go(0, v);  // o.threshold — для листов во весь экран меньше
    }
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return api;
  }

  // iOS Safari показывает :active на кнопках, только если на странице есть обработчик касаний
  document.addEventListener('touchstart', function () {}, { passive: true });

  // ── плашка «Было · Стало» для сравнения ──
  var CSS = '.feelcmp{position:fixed;z-index:2147483000;top:calc(env(safe-area-inset-top,0px) + 8px);left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:2px;padding:3px;border-radius:999px;' +
    'background:color-mix(in srgb,var(--surface,#fff) 72%,transparent);-webkit-backdrop-filter:blur(20px) saturate(1.8);backdrop-filter:blur(20px) saturate(1.8);box-shadow:0 6px 24px rgb(0 0 0 / .18),0 0 0 1px color-mix(in srgb,var(--ink,#000) 10%,transparent);font:600 13px/1 Onest,system-ui,sans-serif;color:var(--ink,#1B2030)}' +
    '.feelcmp button{border:0;background:transparent;color:inherit;font:inherit;height:30px;padding:0 14px;border-radius:999px;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
    '.feelcmp button[aria-pressed=true]{background:var(--ink,#1B2030);color:var(--bg,#fff)}.feelcmp .x{padding:0 10px;opacity:.6}' +
    '@media (prefers-reduced-transparency:reduce){.feelcmp{background:var(--surface,#fff);-webkit-backdrop-filter:none;backdrop-filter:none}}';
  function cmp() {
    var box = document.getElementById('feelcmp');
    // внутри рамки (/apps/<id>/ — приложение в iframe) плашка только у страницы сайта: она же переключает и приложение (storage)
    if (LS.get('feelCmp') !== '1' || framed) { if (box) box.remove(); return; }
    if (!document.getElementById('feelcmp-css')) { var st = document.createElement('style'); st.id = 'feelcmp-css'; st.textContent = CSS; document.head.appendChild(st); }
    if (!box) {
      box = document.createElement('div'); box.id = 'feelcmp'; box.className = 'feelcmp'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Сравнение: прежнее или новое поведение');
      box.innerHTML = '<button type="button" data-feel-set="old">Было</button><button type="button" data-feel-set="new">Стало</button><button type="button" class="x" data-feel-set="off" aria-label="Убрать сравнение">✕</button>';
      document.body.appendChild(box);
    }
    box.querySelector('[data-feel-set="old"]').setAttribute('aria-pressed', String(!on()));
    box.querySelector('[data-feel-set="new"]').setAttribute('aria-pressed', String(on()));
  }
  document.addEventListener('click', function (e) {
    var t = e.target instanceof Element ? e.target : null; if (!t) return;
    var b = t.closest('[data-feel-set]');
    if (b) {
      var k = b.getAttribute('data-feel-set');
      if (k === 'off') LS.set('feelCmp', null); else LS.set('feel', k === 'old' ? 'old' : null);
      apply(); cmp(); document.dispatchEvent(new CustomEvent('hk:feel'));
      return;
    }
    if (t.closest('[data-feel-cmp]')) { LS.set('feelCmp', '1'); cmp(); window.scrollTo({ top: 0, behavior: on() ? 'smooth' : 'auto' }); }
  });
  document.addEventListener('astro:after-swap', function () { apply(); cmp(); });
  // переключили в другой вкладке или на странице-рамке — приложение в iframe меняется сразу
  window.addEventListener('storage', function (e) {
    if (e.key !== 'feel' && e.key !== 'feelCmp') return;
    var was = on(); apply(); cmp(); if (was !== on()) document.dispatchEvent(new CustomEvent('hk:feel'));
  });
  if (document.body) cmp(); else document.addEventListener('DOMContentLoaded', cmp);

  window.HKFeel = { on: on, reduced: reduced, spring: spring, sheet: sheet, project: project, rubber: rubber };
})();

// Общий «слой касаний» для приложений раздела /apps/ (скилл apple-design + mobile-native, аудит 17.11.2026).
// Отдаётся вместе с src/scripts/feel.js одним файлом /apps/feel.js (src/pages/apps/feel.js.ts); приложение подключает его
// в <head> без defer: <script src="/apps/feel.js"></script>. Всё — только при новом поведении (html:not([data-feel="old"]));
// прежнее остаётся для сравнения («Было · Стало» — ?feel=compare, тот же ключ, что у сайта: переключатель общий).
//  · кнопка «вжимается» в момент касания и мягко отпускается (Web Animations по свойству scale — не мешает своим
//    transform и transition приложения); большие поверхности (чётки, карта) не трогаем — у них свой отклик;
//  · без серой вспышки касания, без выделения подписей кнопок и меню ссылки по долгому нажатию;
//  · на iPhone поля ввода не мельче 16px — иначе страница увеличивается при фокусе и сама не возвращается;
//  · цвет строки состояния — по фону приложения (своя тема, светлая и тёмная);
//  · в установленном приложении «назад» — смахиванием от левого края (если есть куда возвращаться внутри приложения).
(function () {
  if (window.__hkAppsFeel) return;
  window.__hkAppsFeel = true;
  var F = window.HKFeel, root = document.documentElement;
  function on() { return !F || F.on(); }

  var css = 'html:not([data-feel="old"]){-webkit-tap-highlight-color:transparent}' +
    'html:not([data-feel="old"]) :is(button,[role=button],summary,[role=tab]){-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:manipulation}' +
    'html:not([data-feel="old"]) a{-webkit-touch-callout:none}' +
    'html:not([data-feel="old"]) :is(p,li,span,blockquote) a:active{opacity:.6}' +
    '@supports (-webkit-touch-callout:none){html:not([data-feel="old"]) :is(input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=color]),textarea,select){font-size:max(16px,1em)!important}}';
  function addCss() {
    if (document.getElementById('hk-apps-feel')) return;
    var st = document.createElement('style'); st.id = 'hk-apps-feel'; st.textContent = css;
    (document.head || root).appendChild(st);
  }
  addCss();

  // ── вжатие ──
  var PRESS = 'button,[role=button],[role=tab],a[href],summary,label[for],.hk-press';
  var SKIP = 'input,select,textarea,[data-nopress],[draggable="true"]';
  var cur = null;
  function release() {
    var p = cur; cur = null;
    if (!p) return;
    var s = parseFloat(getComputedStyle(p.el).scale) || p.s;
    p.a.cancel();
    var back = p.el.animate([{ scale: String(s) }, { scale: '1' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
    back.onfinish = back.oncancel = function () { back.cancel(); };
  }
  document.addEventListener('pointerdown', function (e) {
    if (!on() || e.button > 0 || !e.isPrimary) return;
    var t = e.target instanceof Element ? e.target : null;
    var el = t && t.closest(PRESS);
    if (!el || el.closest(SKIP) || el.disabled || el.getAttribute('aria-disabled') === 'true' || !el.animate) return;
    if (F && F.reduced()) return;
    var cs = getComputedStyle(el);
    if (cs.display === 'inline' || cs.display === 'contents') return;
    var r = el.getBoundingClientRect();
    if (r.width * r.height > innerWidth * innerHeight * 0.2) return;  // чётки, карта, большие полотна — со своим откликом
    release();
    var s = r.height <= 64 && r.width <= 260 ? 0.96 : 0.985;
    var a = el.animate([{ scale: '1' }, { scale: String(s) }], { duration: 90, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
    cur = { el: el, a: a, s: s, x: e.clientX, y: e.clientY };
  }, { passive: true, capture: true });
  document.addEventListener('pointermove', function (e) {
    if (cur && (Math.abs(e.clientX - cur.x) > 10 || Math.abs(e.clientY - cur.y) > 10)) release();  // это прокрутка, а не нажатие
  }, { passive: true, capture: true });
  ['pointerup', 'pointercancel', 'dragstart'].forEach(function (k) { document.addEventListener(k, release, { passive: true, capture: true }); });
  window.addEventListener('blur', release);

  // ── «назад» смахиванием от левого края — только в установленном приложении: там у iPhone своего жеста «назад» нет ──
  // Глубина своих переходов хранится в history.state.hkDepth: на первом экране смахивание не уводит из приложения в пустоту.
  var framedApp = false; try { framedApp = window.self !== window.top; } catch (e) { framedApp = true; }
  var STANDALONE = !framedApp && (navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches));
  var depth = 0;
  function mark(d) { try { var st = history.state; if (st === null || typeof st === 'object') history.replaceState(Object.assign({}, st, { hkDepth: d }), ''); } catch (e) {} }
  try { depth = (history.state && history.state.hkDepth) || 0; if (!history.state || history.state.hkDepth == null) mark(0); } catch (e) {}
  var push = history.pushState;
  history.pushState = function (st, t, u) {
    depth++;
    if (st === null || st === undefined || typeof st === 'object') st = Object.assign({}, st, { hkDepth: depth });
    return push.call(history, st, t, u);
  };
  window.addEventListener('popstate', function (e) { depth = (e.state && e.state.hkDepth) || 0; });
  window.addEventListener('hashchange', function () { if (!history.state || history.state.hkDepth == null) { depth++; mark(depth); } });
  if (STANDALONE) {
    var EDGE = 22, PULL = 72, ind = null, sw = null;
    var icss = '.hk-back{position:fixed;z-index:2147483001;left:0;top:50%;width:44px;height:44px;margin:-22px 0 0 -52px;border-radius:50%;display:grid;place-items:center;' +
      'background:rgba(20,20,24,.62);color:#fff;-webkit-backdrop-filter:blur(14px) saturate(1.6);backdrop-filter:blur(14px) saturate(1.6);pointer-events:none;will-change:transform}' +
      '.hk-back svg{width:20px;height:20px}@media (prefers-reduced-transparency:reduce){.hk-back{background:#222;-webkit-backdrop-filter:none;backdrop-filter:none}}';
    function indicator() {
      if (ind && ind.isConnected) return ind;
      if (!document.getElementById('hk-back-css')) { var st = document.createElement('style'); st.id = 'hk-back-css'; st.textContent = icss; document.head.appendChild(st); }
      ind = document.createElement('div'); ind.className = 'hk-back'; ind.setAttribute('aria-hidden', 'true');
      ind.innerHTML = '<svg viewBox="0 0 20 20" fill="none"><path d="M12.5 4 6.5 10l6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      document.body.appendChild(ind); return ind;
    }
    function place(x, ready) { var el = indicator(); el.style.transform = 'translateX(' + x.toFixed(1) + 'px) scale(' + (ready ? 1.08 : 0.9 + 0.1 * Math.min(1, x / PULL)) + ')'; el.style.opacity = String(Math.min(1, x / 30)); }
    document.addEventListener('touchstart', function (e) {
      sw = null;
      if (!on() || depth <= 0 || e.touches.length !== 1) return;
      var t = e.touches[0];
      if (t.clientX > EDGE) return;
      sw = { x: t.clientX, y: t.clientY, on: false, h: [] };
    }, { passive: true, capture: true });
    document.addEventListener('touchmove', function (e) {
      if (!sw) return;
      var t = e.touches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
      if (!sw.on) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; }  // это прокрутка
        if (dx < 10) return;
        sw.on = true;
      }
      if (e.cancelable) e.preventDefault();
      var x = F ? (dx > PULL ? PULL + F.rubber(dx - PULL, 120) : dx) : Math.min(dx, PULL + 20);
      sw.dx = dx; place(x, dx >= PULL);
      sw.h.push([t.clientX, e.timeStamp]); while (sw.h.length > 2 && e.timeStamp - sw.h[0][1] > 100) sw.h.shift();
    }, { passive: false, capture: true });
    function endSwipe(e) {
      var s = sw; sw = null;
      if (!s || !s.on) return;
      var h = s.h, v = 0;
      if (h.length > 1 && e.timeStamp - h[h.length - 1][1] < 80 && h[h.length - 1][1] > h[0][1]) v = (h[h.length - 1][0] - h[0][0]) / (h[h.length - 1][1] - h[0][1]) * 1000;
      var go = s.dx + (F ? F.project(v, 0.99) : 0) >= PULL;
      var el = indicator(), from = parseFloat((el.style.transform.match(/translateX\(([-\d.]+)px/) || [0, 0])[1]) || 0;
      if (go) history.back();
      if (F && !F.reduced()) F.spring({ from: from, to: 0, velocity: go ? 0 : v, response: 0.3, damping: 1, onUpdate: function (x) { place(x, false); } });
      else { el.style.opacity = '0'; }
    }
    document.addEventListener('touchend', endSwipe, { capture: true });
    document.addEventListener('touchcancel', endSwipe, { capture: true });
  }

  // ── строка состояния под цвет приложения ──
  var meta = null, orig = null, busy = false;
  function opaque(c) { return c && c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c) && !/\/\s*0\)$/.test(c); }
  function toHex(c) {
    var m = c.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (!m) return null;
    return '#' + [m[1], m[2], m[3]].map(function (v) { return ('0' + (+v).toString(16)).slice(-2); }).join('');
  }
  function sync() {
    if (busy) return;
    // несколько меток theme-color (свои для светлой и тёмной темы) — приложение ведёт цвет само, не вмешиваемся
    if (document.querySelectorAll('meta[name="theme-color"]').length > 1) return;
    meta = meta || document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    if (orig === null) orig = meta.getAttribute('content') || '';
    if (!on()) { busy = true; if (meta.__hkSet && meta.getAttribute('content') === meta.__hkSet) meta.setAttribute('content', orig); meta.__hkSet = null; busy = false; return; }
    var b = document.body, c = b && getComputedStyle(b).backgroundColor;
    if (!opaque(c)) c = getComputedStyle(root).backgroundColor;
    var hex = opaque(c) && toHex(c);
    if (!hex || hex === meta.getAttribute('content')) return;
    busy = true; meta.setAttribute('content', hex); meta.__hkSet = hex; busy = false;
  }
  function later() { requestAnimationFrame(sync); }
  function watch() {
    sync();
    var mo = new MutationObserver(later);
    mo.observe(root, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-feel'] });
    if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    if (meta) mo.observe(meta, { attributes: true, attributeFilter: ['content'] });  // приложение само поменяло цвет — сверим с фоном
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', later); } catch (e) {}
    document.addEventListener('hk:feel', later);
    setTimeout(sync, 600);  // фон приложения может появиться после загрузки данных
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
})();
