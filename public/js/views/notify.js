// «Уведомления»: push на телефон и компьютер по согласию; категории; режим для каждого чата. Email о сообщениях не отправляется.
import { esc, tt, api, errorText, toast } from '../util.js';
import { session, needLogin, loading, failed, ic } from '../ui.js';
import { pushSupport, currentSubscription, enablePush, disablePush } from '../push.js';

const ROOM_TITLE = { general: ['Общий чат', 'General chat'], curators: ['Чат кураторов', 'Curators’ chat'], facilitators: ['Чат фасилитаторов', 'Facilitators’ chat'] };
/** Категории уведомлений — сервер присылает только применимые человеку (по ролям). */
const CAT_LABEL = { replies: ['Ответы на мои сообщения', 'Replies to my messages'], mentions: ['Упоминания меня', 'Mentions of me'], direct: ['Сообщения администрации', 'Messages from the team'],
  exchanges: ['Ответы друзей и сторис', 'Friends’ answers and Stories'], meetings: ['Встречи и записи', 'Meetings and sign-ups'], applications: ['Мои заявки', 'My applications'],
  works: ['Решения по моим работам', 'Decisions on my works'], collection: ['Изменения в коллекции', 'Collection changes'], curation: ['Работы на рассмотрении', 'Works in review'], admin: ['Задачи администратора', 'Administrator tasks'] };
export const MODE_LABEL = { all: ['Все сообщения', 'All messages'], mentions: ['Ответы и упоминания', 'Replies and mentions'], none: ['Без уведомлений', 'No notifications'] };

export async function settings(ctx) {
  if (!session.user) return needLogin(ctx.main, tt('Настройки уведомлений — после входа.', 'Notification settings are available after signing in.'));
  loading(ctx.main);
  let st; let rooms;
  try { [st, { rooms }] = await Promise.all([api('/api/push'), api('/api/chats')]); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  let sub = null; try { sub = await currentSubscription(); } catch { /* нет service worker */ }
  // На этом устройстве уведомления включены, только если есть подписка браузера и сервер её знает.
  let onHere = !!sub && st.subscriptions.some((s) => s.endpoint === sub.endpoint);
  let busy = false; let msg = '';
  const draw = () => {
    const support = pushSupport();
    let status;
    if (st.demo) status = `<div class="notice">${esc(tt('В демо-ролях уведомления не включаются: демо-аккаунт общий, уведомления получали бы другие люди. Войдите под своим email.', 'Notifications are not available for demo roles: the demo account is shared, so other people would get them. Sign in with your own email.'))}</div>`;
    else if (support === 'ios-home') status = `<div class="notice stack" style="gap:6px"><b>${esc(tt('На iPhone и iPad уведомления приходят от приложения на экране «Домой»', 'On iPhone and iPad, notifications come from the Home Screen app'))}</b>
      <ol class="steps" style="margin:0"><li>${esc(tt('Откройте этот сайт в Safari.', 'Open this site in Safari.'))}</li>
        <li>${esc(tt('Нажмите «Поделиться» и выберите «На экран “Домой”».', 'Tap Share and choose “Add to Home Screen”.'))}</li>
        <li>${esc(tt('Откройте D-Cards с иконки на экране «Домой», войдите и включите уведомления на этой странице.', 'Open D-Cards from the Home Screen icon, sign in and turn on notifications on this page.'))}</li></ol>
      <span class="small muted">${esc(tt('Нужна iOS или iPadOS 16.4 или новее. Открытая вкладка Safari сама по себе уведомления не получает.', 'Requires iOS or iPadOS 16.4 or later. A Safari tab on its own does not receive notifications.'))}</span></div>`;
    else if (support === 'unsupported') status = `<div class="notice">${esc(tt('Этот браузер не поддерживает уведомления на устройство. События видны в колокольчике.', 'This browser does not support device notifications. Events are shown under the bell.'))}</div>`;
    else if (support === 'denied') status = `<div class="notice">${esc(tt('Разрешите уведомления в настройках браузера или устройства', 'Allow notifications in your browser or device settings'))}</div>`;
    else if (onHere) status = `<div class="notice green stack" style="gap:8px"><b>${ic.check} ${esc(tt('Уведомления включены на этом устройстве', 'Notifications are on for this device'))}</b>
      <div class="row"><button class="btn sm" type="button" id="ptest" ${busy ? 'disabled' : ''}>${esc(tt('Отправить проверочное', 'Send a test'))}</button><button class="btn light sm" type="button" id="poff" ${busy ? 'disabled' : ''}>${esc(tt('Выключить на этом устройстве', 'Turn off on this device'))}</button></div></div>`;
    else status = `<div class="card-ui flat stack" style="gap:10px"><p style="margin:0">${esc(tt('Включите уведомления, чтобы не пропустить ответ на своё сообщение или упоминание. Браузер спросит разрешение — подтвердите его.', 'Turn on notifications so you do not miss a reply or a mention. Your browser will ask for permission — please allow it.'))}</p>
      <div><button class="btn yellow" type="button" id="pon" ${busy ? 'disabled aria-busy="true"' : ''}>${ic.bell} ${esc(busy ? tt('Включаем…', 'Turning on…') : tt('Включить уведомления', 'Turn on notifications'))}</button></div></div>`;
    const p = st.prefs; const cats = st.categories || [];
    const isOn = (k) => !!p.enabled && !!p[k];
    const onN = cats.filter(isOn).length;
    const sw = (k) => `<label class="switch-row"><span>${esc(tt(...CAT_LABEL[k]))}</span><input type="checkbox" role="switch" data-pref="${k}" ${isOn(k) ? 'checked' : ''}></label>`;
    ctx.main.innerHTML = `<div class="wrap page narrow stack">
      <div class="page-head"><h1>${esc(tt('Уведомления', 'Notifications'))}</h1></div>
      ${status}
      <p class="form-error" role="alert" id="perr">${esc(msg)}</p>
      ${st.devices && !onHere ? `<p class="small muted" style="margin:0">${esc(tt(`Включено на других устройствах: ${st.devices}.`, `On for other devices: ${st.devices}.`))}</p>` : ''}
      <section class="card-ui flat stack" style="gap:4px"><h2 style="margin:0 0 6px;font-size:1.1rem">${esc(tt('Что присылать', 'What to send'))}</h2>
        <label class="switch-row all-row"><span><b>${esc(tt('Получать все уведомления', 'Receive all notifications'))}</b></span><input type="checkbox" id="pall" ${onN === cats.length && cats.length ? 'checked' : ''}></label>
        ${cats.map(sw).join('')}</section>
      <section class="card-ui flat stack" style="gap:8px"><h2 style="margin:0 0 4px;font-size:1.1rem">${esc(tt('Чаты', 'Chats'))}</h2>
        ${rooms.map((r) => `<label class="field small">${r.closed ? ic.lock : ''} ${esc(tt(...ROOM_TITLE[r.room]))}<select data-room="${r.room}">${Object.entries(MODE_LABEL).map(([k, v]) => `<option value="${k}" ${r.notify === k ? 'selected' : ''}>${esc(tt(...v))}</option>`).join('')}</select></label>`).join('')}
        <p class="small muted" style="margin:0">${esc(tt('По умолчанию — ответы и упоминания; «Все сообщения» включайте для чатов, где важно каждое сообщение.', 'Default: replies and mentions. Choose “All messages” for chats where every message matters.'))}</p></section>
    </div>`;
    wire();
  };
  const wire = () => {
    const $ = (s) => ctx.main.querySelector(s);
    if ($('#pon')) $('#pon').addEventListener('click', async () => {
      busy = true; msg = ''; draw();
      try {
        const r = await enablePush(st.publicKey);
        if (r === 'on') { sub = await currentSubscription(); st = await api('/api/push'); toast(tt('Уведомления включены', 'Notifications are on')); }
        else if (r === 'default') msg = tt('Разрешение не дано. Можно включить позже.', 'Permission was not given. You can turn it on later.');
      } catch (e) {
        // Ошибка браузера (не сервера): чаще всего недоступен сервис уведомлений браузера или он отклонил подписку.
        msg = e && !e.status && e.name ? tt('Браузер не смог оформить подписку: сервис уведомлений браузера недоступен или отклонил запрос. Попробуйте позже или в другом браузере. Уведомления не включены.', 'The browser could not create a subscription: its notification service is unavailable or refused. Try later or in another browser. Notifications are not on.')
          : `${errorText(e)} ${tt('Уведомления не включены.', 'Notifications are not on.')}`;
      }
      busy = false;
      onHere = !!sub && st.subscriptions.some((x) => x.endpoint === sub.endpoint);
      draw();
    });
    if ($('#poff')) $('#poff').addEventListener('click', async () => { busy = true; draw(); try { await disablePush(); toast(tt('Уведомления на этом устройстве выключены', 'Notifications are off for this device')); } catch (e) { toast(errorText(e)); } busy = false; ctx.rerender(); });
    if ($('#ptest')) $('#ptest').addEventListener('click', async () => {
      try { const r = await api('/api/push/test', { method: 'POST' }); toast(r.sent ? tt('Отправлено. Уведомление должно появиться в течение минуты.', 'Sent. The notification should appear within a minute.') : tt('Не удалось доставить: подписка не принята сервисом уведомлений.', 'Could not deliver: the notification service did not accept the subscription.')); }
      catch (e) { toast(errorText(e)); }
    });
    const all = $('#pall'); const cats = st.categories || [];
    if (all) { const n = cats.filter((k) => st.prefs.enabled && st.prefs[k]).length; all.indeterminate = n > 0 && n < cats.length; }
    const save = async (body, revert) => { try { ({ prefs: st.prefs } = await api('/api/push/prefs', { method: 'PUT', body })); draw(); } catch (e) { revert(); toast(errorText(e)); } };
    if (all) all.addEventListener('change', () => { const v = all.checked; save({ enabled: true, ...Object.fromEntries(cats.map((k) => [k, v])) }, () => { all.checked = !v; }); });
    ctx.main.querySelectorAll('[data-pref]').forEach((c) => c.addEventListener('change', () => {
      save({ enabled: true, ...Object.fromEntries(cats.map((k) => [k, st.prefs.enabled && st.prefs[k]])), [c.dataset.pref]: c.checked }, () => { c.checked = !c.checked; });
    }));
    ctx.main.querySelectorAll('[data-room]').forEach((s) => s.addEventListener('change', async () => {
      try { await api(`/api/chats/${s.dataset.room}/notify`, { method: 'PUT', body: { mode: s.value } }); toast(tt('Сохранено', 'Saved')); } catch (e) { toast(errorText(e)); }
    }));
  };
  draw();
}
