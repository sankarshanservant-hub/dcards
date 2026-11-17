// Прототип «Что ты видишь?» для страницы vision.html: весь путь за двоих на одном телефоне.
// Карты — настоящие из галереи (./api/cards). Ничего не отправляется и не сохраняется на сервере.
(function () {
  const app = document.getElementById('app');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { step: 0, cards: [], card: null, author: '', mine: '', theirs: '', me: 'Майя', friend: 'Друг' };

  // тема: светлая/тёмная, знак — под тему
  const root = document.documentElement;
  const isLight = () => (root.dataset.theme ? root.dataset.theme === 'light' : matchMedia('(prefers-color-scheme: light)').matches);
  const syncEm = () => { document.getElementById('em').src = isLight() ? 'img/emblem-black.webp' : 'img/emblem-cream.webp'; };
  document.getElementById('theme').addEventListener('click', () => { root.dataset.theme = isLight() ? 'dark' : 'light'; syncEm(); });
  syncEm();

  const dots = () => `<div class="dots" aria-hidden="true">${[0, 1, 2, 3].map((i) => `<i class="${i <= st.step ? 'on' : ''}"></i>`).join('')}</div>`;
  const cardImg = (cls = '') => `<img class="card ${cls}" src="${esc(st.card.full || st.card.thumb)}" alt="Карта ${esc(st.card.code)}">`;

  function pick() {
    const pool = st.cards.filter((c) => !st.card || c.code !== st.card.code);
    st.card = pool[Math.floor(Math.random() * pool.length)];
    st.author = '';
    fetch(`api/cards/${encodeURIComponent(st.card.code)}`).then((r) => r.json()).then((d) => { st.author = d.author || ''; }).catch(() => {});
  }

  function draw() {
    let h = '';
    if (st.step === 0) {
      h = `<p class="who">Вы</p><h3>Что ты здесь видишь?</h3>${cardImg()}
        <button class="link" type="button" data-other>Другая карта</button>
        <label class="muted" for="t1">Одной строкой — первое, что пришло в голову</label>
        <textarea id="t1" maxlength="140" placeholder="Я вижу…">${esc(st.mine)}</textarea>
        <button class="btn y w" type="button" data-next ${st.mine.trim() ? '' : 'disabled'}>Отправить другу</button>${dots()}`;
    } else if (st.step === 1) {
      h = `<p class="who">Сообщение другу</p><h3>Так ссылка выглядит в мессенджере</h3>
        <div class="msg"><img src="${esc(st.card.thumb)}" alt=""><div><b>${esc(st.me)}</b> прислал(а) карту<br><span class="muted">«Что ты здесь видишь? Ответь — и увидишь, что увидел(а) я»</span></div></div>
        <p class="muted">Друг открывает ссылку без установки и регистрации. Ответ отправителя спрятан, пока друг не ответит сам.</p>
        <button class="btn y w" type="button" data-next>Открыть как друг</button>
        <button class="link" type="button" data-back>Назад</button>${dots()}`;
    } else if (st.step === 2) {
      h = `<p class="who">Друг</p><h3>${esc(st.me)} спрашивает: что ты здесь видишь?</h3>${cardImg('sm')}
        <div class="locked">🔒 Ответ ${esc(st.me)} откроется, когда ответите вы</div>
        <label class="muted" for="t2">Ваш ответ (в прототипе — напишите за друга)</label>
        <textarea id="t2" maxlength="140" placeholder="Я вижу…">${esc(st.theirs)}</textarea>
        <button class="btn y w" type="button" data-next ${st.theirs.trim() ? '' : 'disabled'}>Ответить и увидеть</button>${dots()}`;
    } else {
      h = `<p class="who">Вы оба</p><h3>Одна карта — два взгляда</h3>${cardImg('sm')}
        <div class="pair"><div><b>${esc(st.me)}</b>${esc(st.mine)}</div><div><b>${esc(st.friend)}</b>${esc(st.theirs)}</div></div>
        <button class="btn y w" type="button" data-story>Картинка для сторис</button>
        <div id="story"></div>
        <div class="row"><button class="btn" type="button" data-reply style="flex:1">Ответить своей картой</button></div>
        <button class="link" type="button" data-restart>Сыграть заново</button>${dots()}`;
    }
    app.innerHTML = h;
    const t1 = app.querySelector('#t1'); if (t1) t1.addEventListener('input', () => { st.mine = t1.value; app.querySelector('[data-next]').disabled = !st.mine.trim(); });
    const t2 = app.querySelector('#t2'); if (t2) t2.addEventListener('input', () => { st.theirs = t2.value; app.querySelector('[data-next]').disabled = !st.theirs.trim(); });
  }

  app.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-next')) { st.step++; draw(); }
    else if (b.hasAttribute('data-back')) { st.step--; draw(); }
    else if (b.hasAttribute('data-other')) { pick(); draw(); }
    else if (b.hasAttribute('data-restart')) { Object.assign(st, { step: 0, mine: '', theirs: '' }); pick(); draw(); }
    else if (b.hasAttribute('data-reply')) { // роли меняются: теперь отвечает своей картой друг
      Object.assign(st, { step: 0, mine: '', theirs: '', me: st.friend, friend: st.me }); pick(); draw();
    } else if (b.hasAttribute('data-story')) { b.disabled = true; b.textContent = 'Рисуем…'; await story(); b.remove(); }
  });

  // ---------- картинка для сторис 1080×1920 ----------
  function wrap(ctx, text, maxW) {
    const words = String(text).split(/\s+/); const lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur); return lines.slice(0, 4);
  }
  async function story() {
    const W = 1080; const H = 1920; const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#060c1e'; x.fillRect(0, 0, W, H);
    try { await document.fonts.load('800 60px Rubik'); await document.fonts.load('400 40px Onest'); } catch { /* системный шрифт */ }
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = st.card.full || st.card.thumb; });
    const ch = 980; const cw = Math.round(ch * img.width / img.height); const cx = (W - cw) / 2; const cy = 230;
    x.save(); x.beginPath(); x.roundRect(cx, cy, cw, ch, 34); x.clip(); x.drawImage(img, cx, cy, cw, ch); x.restore();
    x.fillStyle = '#f1e6c8'; x.font = '800 64px Rubik, sans-serif'; x.textAlign = 'center';
    x.fillText('Что ты здесь видишь?', W / 2, 150);
    const col = (name, text, left) => {
      const bx = left ? 70 : W / 2 + 15; const bw = W / 2 - 85; let y = 1290;
      x.fillStyle = 'rgba(241,230,200,.08)'; x.beginPath(); x.roundRect(bx, y, bw, 330, 28); x.fill();
      x.textAlign = 'left'; x.fillStyle = '#f6c23c'; x.font = '600 34px Onest, sans-serif'; x.fillText(name.toUpperCase(), bx + 30, y + 64);
      x.fillStyle = '#f1e6c8'; x.font = '400 40px Onest, sans-serif'; y += 124;
      for (const line of wrap(x, text, bw - 60)) { x.fillText(line, bx + 30, y); y += 52; }
    };
    col(st.me, st.mine, true); col(st.friend, st.theirs, false);
    x.textAlign = 'center'; x.fillStyle = 'rgba(241,230,200,.7)'; x.font = '400 34px Onest, sans-serif';
    x.fillText(`${st.card.code}${st.author ? ' · художник: ' + st.author : ''}`, W / 2, 1700);
    x.fillStyle = '#f6c23c'; x.font = '800 44px Rubik, sans-serif'; x.fillText('D-Cards', W / 2, 1800);
    x.fillStyle = 'rgba(241,230,200,.7)'; x.font = '400 32px Onest, sans-serif'; x.fillText('harekrishna.info/dialogue-cards', W / 2, 1852);
    const url = c.toDataURL('image/png');
    document.getElementById('story').innerHTML = `<img class="story-prev" src="${url}" alt="Картинка для сторис"><a class="btn w" href="${url}" download="d-cards-${esc(st.card.code)}.png">Скачать картинку</a>`;
  }

  fetch('api/cards').then((r) => r.json()).then((d) => {
    st.cards = (d.cards || []).filter((c) => !c.isDemo);
    if (!st.cards.length) { app.innerHTML = '<p class="muted">В галерее пока нет карт.</p>'; return; }
    pick(); draw();
  }).catch(() => { app.innerHTML = '<p class="muted">Не удалось загрузить карты. Обновите страницу.</p>'; });
})();
