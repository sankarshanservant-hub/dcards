// Вход по email без пароля (код в письме), вход владельца по паролю, демо-роли; профиль.
import { lang } from '../i18n.js';
import { esc, tt, u, api, errorText, toast } from '../util.js';
import { session, refreshSession, rolesText, needLogin, stepsBar, ic, siteSession, siteProfileName, loginWithSite } from '../ui.js';

const DEMO_ROLES = [['guest', 'Участник', 'Participant', 'Галерея и встречи', 'Gallery and meetings'], ['facilitator', 'Фасилитатор', 'Facilitator', 'Подборка, QR, встречи', 'Selection, QR, meetings'], ['artist', 'Художник', 'Artist', 'Работы и возвраты', 'Works and returns'], ['curator', 'Куратор', 'Curator', 'Работы на рассмотрении', 'Works under review'], ['admin', 'Администратор', 'Admin', 'Люди, заявки, встречи', 'People, applications, meetings']];
const demoBtn = ([k, ru, en, dru, den], i) => `<button class="btn ${i === 0 ? 'yellow' : 'light'}" type="button" data-demo="${k}"><b>${esc(tt(ru, en))}</b><span class="small">${esc(tt(dru, den))}</span></button>`;

/** Отдельный экран выбора демо-ролей (все роли, включая тестовую кнопку администратора). */
export function demoRoles(ctx) {
  if (!session.config.demoMode) { ctx.main.innerHTML = `<div class="wrap page narrow"><p class="empty">${esc(tt('Демо-режим выключен.', 'Demo mode is off.'))}</p></div>`; return; }
  ctx.main.innerHTML = `<div class="wrap page narrow stack"><p class="eyebrow">${esc(tt('Демо', 'Demo'))}</p><h1>${esc(tt('Демо-роли', 'Demo roles'))}</h1>
    <p class="muted">${esc(tt('Тестовый вход для показа путей. Роли проверяются на сервере; демо-данные хранятся отдельно от настоящих. В рабочей версии администратор входит через обычный вход.', 'Test sign-in to walk through each path. Roles are checked on the server; demo data is kept apart from real data. In the live version the administrator signs in the regular way.'))}</p>
    <div class="demo-roles">${DEMO_ROLES.map(demoBtn).join('')}</div></div>`;
  ctx.main.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api('/api/demo/login', { method: 'POST', body: { as: b.dataset.demo } }); await refreshSession(); goAfterLogin(ctx); } catch (x) { toast(errorText(x)); b.disabled = false; }
  }));
}

const goAfterLogin = (ctx) => {
  const next = ctx.query.get('next');
  ctx.navigate(next && next.startsWith('/') ? next : (window.dcHomeFor ? window.dcHomeFor() : '/start'));
};

export function login(ctx) {
  let step = 1; let email = ''; let info = null;
  const siteOn = !!session.config.siteLogin;
  // Вход общим аккаунтом сайта: если человек войдёт в другой вкладке, эта страница подхватит вход сама.
  const onStorage = async (e) => {
    if (e.key !== 'amSession' || !e.newValue || !document.body.contains(ctx.main)) return;
    if (await loginWithSite({ force: true })) { await refreshSession(); toast(tt('Вы вошли', 'Signed in')); goAfterLogin(ctx); }
  };
  if (siteOn) window.addEventListener('storage', onStorage);
  const siteBlock = () => {
    if (!siteOn) return '';
    const s = siteSession(); const nm = siteProfileName();
    return `<div class="card-ui stack" id="siteblock">
      <h2 style="margin:0">${esc(tt('Аккаунт harekrishna.info', 'harekrishna.info account'))}</h2>
      <p class="muted" style="margin:0">${esc(tt('Тот же вход, что на всём сайте: Google, Яндекс или ссылка на почту. Пароль не нужен.', 'The same sign-in as the rest of the site: Google, Yandex or an email link. No password.'))}</p>
      ${s ? `<button class="btn yellow wide" type="button" id="site-go">${esc(nm ? tt(`Продолжить как ${nm}`, `Continue as ${nm}`) : tt('Продолжить с аккаунтом сайта', 'Continue with the site account'))}</button>`
        : `<a class="btn yellow wide" href="/me/" target="_blank" rel="opener" id="site-open">${esc(tt('Войти через Google, Яндекс или почту', 'Sign in with Google, Yandex or email'))}</a>
           <p class="small muted" style="margin:0">${esc(tt('Откроется вход сайта в новой вкладке. После входа вернитесь сюда — Dialogue Cards узнает вас сам.', 'The site sign-in opens in a new tab. After signing in, come back here — Dialogue Cards will recognise you.'))}</p>`}
      <p class="form-error" id="serr" role="alert"></p></div>`;
  };
  const draw = () => {
    const codeLogin = session.config.emailLogin !== false;
    ctx.main.innerHTML = `<div class="wrap page narrow stack">${step === 1 ? `<h1>${esc(tt('Вход в Dialogue Cards', 'Sign in to Dialogue Cards'))}</h1>` : ''}
      ${step === 1 && session.config.demoMode ? `<div class="card-ui demo-entry stack" id="demo-entry">
        <div class="row between" style="align-items:flex-start"><div><h2 style="margin:0">${esc(tt('Посмотреть демо', 'View the demo'))}</h2>
          <p class="muted" style="margin:4px 0 0">${esc(tt('Без регистрации. Тестовые встречи, подборка и работы хранятся отдельно от настоящих и видны только в демо.', 'No sign-up. Test meetings, a selection and works are kept separate from real data and visible only in the demo.'))}</p></div>
          <span class="pill demo">${esc(tt('демо', 'demo'))}</span></div>
        <div class="demo-roles">${DEMO_ROLES.filter((r) => r[0] !== 'admin').map(demoBtn).join('')}</div>
        <a class="small" href="${u('/demo')}">${esc(tt('Все демо-роли →', 'All demo roles →'))}</a>
      </div>` : ''}
      ${step === 1 ? siteBlock() : ''}
      ${!codeLogin && !siteOn ? `<p class="notice demo">${esc(tt('Вход по email заработает после подключения почты. Сейчас роли можно посмотреть в демо выше.', 'Email sign-in will work once email is connected. For now, try the roles in the demo above.'))}</p>` : ''}
      ${codeLogin ? `<div class="card-ui navy stack">
        ${stepsBar(step, 2)}
        <h1 style="color:var(--on-navy)">${esc(step === 1 ? tt(siteOn ? 'Или кодом на почту' : 'Вход и регистрация', siteOn ? 'Or with an emailed code' : 'Sign in or sign up') : tt('Введите код', 'Enter the code'))}</h1>
        <p class="muted">${esc(step === 1 ? tt('Без пароля: пришлём код на email. Если вы здесь впервые, аккаунт создастся автоматически.', 'No password: we will email you a code. If you are new, an account is created automatically.') : tt(`Код отправлен на ${email}. Он действует 15 минут.`, `The code was sent to ${email}. It is valid for 15 minutes.`))}</p>
        ${step === 1 && session.config.emailLogin !== false ? `<form class="form" id="f1">
            <label class="field">Email<input type="email" name="email" required autocomplete="email" value="${esc(email)}"></label>
            <p class="form-error" id="err" role="alert"></p>
            <button class="btn yellow wide" type="submit">${esc(tt('Получить код', 'Get a code'))}</button></form>`
        : step === 1 ? '' : `${info && info.demo ? `<div class="notice demo" style="color:var(--on-navy)"><b>${esc(tt('Демо: почта не подключена, письмо не отправлено.', 'Demo: email is not connected, no letter was sent.'))}</b> ${esc(tt('Ваш код:', 'Your code:'))} <b style="font-size:1.3rem;letter-spacing:.15em">${esc(info.demoCode)}</b></div>` : ''}
          ${info && info.failed ? `<div class="notice red">${esc(tt('Письмо не удалось отправить. Попробуйте позже.', 'The email could not be sent. Try again later.'))}</div>` : ''}
          <form class="form" id="f2">
            <label class="field">${esc(tt('Код из письма', 'Code from the email'))}<input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
            ${info && info.isNew ? `<label class="field">${esc(tt('Имя', 'Name'))} *<input type="text" name="name" required maxlength="100"></label>
              <label class="field">${esc(tt('Публичное имя или псевдоним', 'Public name or pen name'))} <span class="hint">${esc(tt('по желанию: так вас увидят в обсуждениях и под картами', 'optional: shown in discussions and under cards'))}</span><input type="text" name="publicName" maxlength="100"></label>` : ''}
            <p class="form-error" id="err" role="alert"></p>
            <button class="btn yellow wide" type="submit">${esc(tt('Войти', 'Sign in'))}</button>
            <button class="linkbtn" type="button" id="back" style="color:var(--on-navy)">${esc(tt('Другой email', 'Another email'))}</button></form>`}
      </div>` : ''}
      <details class="card-ui flat"><summary><b>${esc(tt('Вход владельца проекта (пароль)', 'Project owner sign-in (password)'))}</b></summary>
        <form class="form" id="fo" style="margin-top:12px"><label class="field">${esc(tt('Пароль', 'Password'))}<input type="password" name="password" autocomplete="current-password" required></label>
          <p class="form-error" id="oerr" role="alert"></p><button class="btn dark" type="submit">${esc(tt('Войти как владелец', 'Sign in as owner'))}</button></form></details>
    </div>`;
    const err = (m) => { const e = ctx.main.querySelector('#err'); if (e) e.textContent = m; };
    const sg = ctx.main.querySelector('#site-go');
    if (sg) sg.addEventListener('click', async () => {
      if (await loginWithSite({ force: true })) { await refreshSession(); toast(tt('Вы вошли', 'Signed in')); goAfterLogin(ctx); }
      else ctx.main.querySelector('#serr').textContent = tt('Сессия сайта устарела — войдите на сайте заново.', 'The site session has expired — sign in on the site again.');
    });
    const so = ctx.main.querySelector('#site-open');
    if (so) so.addEventListener('click', () => {
      // вход через Яндекс или письмо уводит на /auth/… и возвращает по amAuthReturn — вернём сюда
      try { localStorage.setItem('amAuthReturn', JSON.stringify({ p: location.pathname + location.search, t: Date.now() })); } catch { /* ignore */ }
    });
    const f1 = ctx.main.querySelector('#f1');
    if (f1) f1.addEventListener('submit', async (e) => {
      e.preventDefault(); email = f1.email.value.trim().toLowerCase();
      try { info = await api('/api/auth/request', { method: 'POST', body: { email, lang } }); step = 2; draw(); } catch (x) { err(errorText(x)); }
    });
    const f2 = ctx.main.querySelector('#f2');
    if (f2) {
      f2.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api('/api/auth/verify', { method: 'POST', body: { email, code: f2.code.value, name: f2.name ? f2.name.value : '', publicName: f2.publicName ? f2.publicName.value : '' } });
          await refreshSession(); toast(tt('Вы вошли', 'Signed in')); goAfterLogin(ctx);
        } catch (x) { err(errorText(x)); }
      });
      ctx.main.querySelector('#back').addEventListener('click', () => { step = 1; draw(); });
    }
    ctx.main.querySelector('#fo').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/api/auth/owner', { method: 'POST', body: { password: e.target.password.value } }); await refreshSession(); goAfterLogin(ctx); }
      catch (x) { ctx.main.querySelector('#oerr').textContent = errorText(x); }
    });
    ctx.main.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true; b.classList.add('busy');
      try { await api('/api/demo/login', { method: 'POST', body: { as: b.dataset.demo } }); await refreshSession(); goAfterLogin(ctx); } catch (x) { toast(errorText(x)); b.disabled = false; b.classList.remove('busy'); }
    }));
  };
  draw();
}

export function profile(ctx) {
  const s = session.user;
  if (!s) return needLogin(ctx.main, tt('Профиль доступен после входа.', 'Sign in to see your profile.'));
  const has = (...r) => s.roles.includes('admin') || r.some((x) => s.roles.includes(x));
  // «Мои кабинеты»: только доступные; администрирование — только администратору.
  const links = [
    ...(has('artist') ? [['/artist', ic.brush, tt('Кабинет художника', 'Artist space')]] : []),
    ...(has('facilitator') ? [['/facilitator', ic.qr, tt('Кабинет фасилитатора', 'Facilitator space')]] : []),
    ...(has('curator') ? [['/curator', ic.check, tt('Кабинет куратора', 'Curator space')]] : []),
    ...(s.roles.includes('admin') ? [['/admin', ic.shield, tt('Администрирование', 'Administration')]] : []),
  ];
  ctx.main.innerHTML = `<div class="wrap page narrow stack">
    <p class="eyebrow">${esc(rolesText(s.roles))}${s.isDemo ? ' · ' + esc(tt('демо-пользователь', 'demo user')) : ''}</p>
    <h1>${esc(s.publicName)}</h1>
    <form class="card-ui form" id="pf">
      <label class="field">${esc(tt('Имя', 'Name'))}<input type="text" name="name" required maxlength="100" value="${esc(s.name)}"></label>
      <label class="field">${esc(tt('Публичное имя или псевдоним', 'Public name or pen name'))} <span class="hint">${esc(tt('Показывается в обсуждениях и под картами. Пусто — показывается имя.', 'Shown in discussions and under cards. Empty — your name is shown.'))}</span><input type="text" name="publicName" maxlength="100" value="${esc(s.publicName !== s.name ? s.publicName : '')}"></label>
      <p class="small muted" style="margin:0">Email: ${esc(s.email || tt('не указан', 'not set'))}</p>
      <div><button class="btn dark" type="submit">${esc(tt('Сохранить', 'Save'))}</button></div></form>
    ${links.length ? `<h2 style="margin:8px 0 0">${esc(tt('Мои кабинеты', 'My spaces'))}</h2><div class="list">${links.map(([href, icon, label]) => `<a class="item" href="${u(href)}"><span class="ic">${icon}</span><span class="body"><b>${esc(label)}</b></span><span>→</span></a>`).join('')}</div>` : `<div class="card-ui flat"><p class="muted" style="margin:0 0 10px">${esc(tt('Хотите присоединиться к проекту?', 'Want to join the project?'))}</p><a class="btn dark" href="${u('/start#join')}">${esc(tt('Как участвовать', 'Ways to take part'))}</a></div>`}
  </div>`;
  ctx.main.querySelector('#pf').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/me', { method: 'PATCH', body: { name: e.target.name.value, publicName: e.target.publicName.value } }); await refreshSession(); toast(tt('Сохранено', 'Saved')); ctx.rerender(); }
    catch (x) { toast(errorText(x)); }
  });
}
