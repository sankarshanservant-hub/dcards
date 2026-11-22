// Сканер QR игры (22.11.2026): камера → код комнаты → игра. Камера останавливается сразу после считывания и при закрытии.
// Распознавание — BarcodeDetector, где он есть; иначе (iPhone) — jsQR из /vendor/jsqr (загружается только при открытии).
// «Ввести код игры» — вход по коду комнаты без камеры: при отказе, без камеры и просто по желанию.
import { esc, tt, u, api, visitorId } from './util.js';

const CODE_RE = /^[A-Za-z0-9]{4,8}$/;
/** Код комнаты из содержимого QR: ссылка …/g/<код> или сам код. */
export function roomCodeFrom(text) {
  const t = String(text || '').trim();
  if (CODE_RE.test(t)) return t.toUpperCase();
  try { const m = new URL(t).pathname.match(/\/g\/([A-Za-z0-9]{4,8})\/?$/); return m ? m[1].toUpperCase() : null; } catch { return null; }
}
let jsqrP = null;
const loadJsQR = () => jsqrP || (jsqrP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = u('/vendor/jsqr/jsQR.js'); s.onload = () => res(window.jsQR); s.onerror = () => { jsqrP = null; rej(new Error('jsqr')); }; document.head.appendChild(s); }));

/** Проверка кода: комната есть и идёт — открыть; иначе — понятная причина. */
async function checkRoom(code) {
  try { const s = await api(`/api/group/${encodeURIComponent(code)}/state?device=${encodeURIComponent(visitorId())}`); return s.status === 'ended' ? { error: tt('Эта игра уже закончилась. Попросите ведущего открыть новую.', 'This game has already ended. Ask the host to open a new one.') } : { ok: true }; }
  catch (e) { return { error: e.status === 404 ? tt('Игра с таким кодом не найдена. Проверьте код.', 'No game with this code. Check the code.') : tt('Не удалось проверить код. Проверьте интернет и попробуйте ещё раз.', 'Could not check the code. Check your connection and try again.') }; }
}

export function openScanner(navigate) {
  const opener = document.activeElement;
  const el = document.createElement('div'); el.className = 'qr-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', tt('Сканер QR-кода игры', 'Game QR code scanner'));
  el.innerHTML = `<div class="qr-pop-in">
    <button class="icon-btn qr-x" type="button" data-x aria-label="${esc(tt('Закрыть', 'Close'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    <div class="qr-view"><video playsinline muted aria-hidden="true"></video><span class="qr-frame" aria-hidden="true"></span></div>
    <p class="qr-msg" role="status" aria-live="polite">${esc(tt('Наведите камеру на QR-код игры.', 'Point the camera at the game’s QR code.'))}</p>
    <button class="btn light" type="button" data-code>${esc(tt('Ввести код игры', 'Enter the game code'))}</button>
    <form class="qr-form" hidden><label class="field" for="qr-code">${esc(tt('Код игры', 'Game code'))}</label>
      <div class="row"><input id="qr-code" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text"><button class="btn yellow" type="submit">${esc(tt('Войти', 'Join'))}</button></div></form>
  </div>`;
  document.body.appendChild(el);
  const video = el.querySelector('video'); const msg = el.querySelector('.qr-msg'); const form = el.querySelector('.qr-form');
  let stream = null; let timer = null; let closed = false; let busy = false;
  const stop = () => { clearTimeout(timer); timer = null; if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } video.srcObject = null; };
  const close = () => { if (closed) return; closed = true; stop(); el.remove(); document.removeEventListener('keydown', onKey); if (opener && opener.focus) opener.focus({ preventScroll: true }); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const say = (t, bad = false) => { msg.textContent = t; msg.classList.toggle('bad', bad); };
  const showForm = () => { form.hidden = false; el.querySelector('[data-code]').hidden = true; el.querySelector('#qr-code').focus(); };
  const go = async (code, fromCamera) => {
    if (busy) return; busy = true;
    if (fromCamera) stop(); // код считан — камера больше не нужна
    say(tt('Проверяем код…', 'Checking the code…'));
    const r = await checkRoom(code); busy = false;
    if (closed) return;
    if (r.ok) { close(); navigate('/g/' + code); return; }
    say(r.error, true); showForm(); el.querySelector('#qr-code').value = code;
  };
  el.addEventListener('click', (e) => { if (e.target.closest('[data-x]') || e.target === el) close(); else if (e.target.closest('[data-code]')) showForm(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); const v = el.querySelector('#qr-code').value.trim(); const code = roomCodeFrom(v); if (!code) { say(tt('Код игры — 5 букв и цифр, как на экране ведущего.', 'The game code is 5 letters and digits, as on the host’s screen.'), true); return; } go(code, false); });
  el.querySelector('[data-x]').focus();

  (async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { say(tt('Камера недоступна в этом браузере. Введите код игры.', 'The camera is not available in this browser. Enter the game code.'), true); showForm(); return; }
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); }
    catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      const none = e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError');
      say(denied ? tt('Нет доступа к камере. Разрешите камеру в настройках браузера или введите код игры.', 'No access to the camera. Allow the camera in your browser settings or enter the game code.')
        : none ? tt('Камера не найдена. Введите код игры.', 'No camera found. Enter the game code.') : tt('Камеру не удалось включить. Введите код игры.', 'Could not start the camera. Enter the game code.'), true);
      showForm(); return;
    }
    if (closed) { stop(); return; }
    video.srcObject = stream; try { await video.play(); } catch { /* */ }
    let detect;
    if ('BarcodeDetector' in window) { try { const bd = new window.BarcodeDetector({ formats: ['qr_code'] }); detect = async () => { const r = await bd.detect(video); return r[0] && r[0].rawValue; }; } catch { detect = null; } }
    if (!detect) {
      let jsQR; try { jsQR = await loadJsQR(); } catch { say(tt('Не удалось загрузить сканер. Введите код игры.', 'Could not load the scanner. Enter the game code.'), true); showForm(); return; }
      const cv = document.createElement('canvas'); const g = cv.getContext('2d', { willReadFrequently: true });
      detect = async () => { const w = video.videoWidth; const h = video.videoHeight; if (!w) return null; const k = Math.min(1, 640 / Math.max(w, h)); cv.width = Math.round(w * k); cv.height = Math.round(h * k); g.drawImage(video, 0, 0, cv.width, cv.height); const d = g.getImageData(0, 0, cv.width, cv.height); const r = jsQR(d.data, cv.width, cv.height, { inversionAttempts: 'dontInvert' }); return r && r.data; };
    }
    let lastBad = '';
    const tick = async () => {
      if (closed || !stream) return;
      let text = null; try { text = await detect(); } catch { /* кадр не готов */ }
      if (text) {
        const code = roomCodeFrom(text);
        if (code) { go(code, true); return; }
        if (text !== lastBad) { lastBad = text; say(tt('Это не QR-код игры Dialogue Cards. Наведите камеру на код с экрана ведущего.', 'This is not a Dialogue Cards game QR code. Point the camera at the code on the host’s screen.'), true); }
      }
      timer = setTimeout(tick, 180);
    };
    tick();
  })();
  return close;
}

/** Кнопка-значок сканера: только пиктограмма, имя — для экранного диктора, без всплывающей подсказки. */
export const scanButton = (qrIcon) => `<button class="icon-btn qr-scan-btn" type="button" data-qrscan aria-label="${esc(tt('Сканировать QR-код игры', 'Scan a game QR code'))}">${qrIcon}</button>`;
export function wireScan(root, navigate) { root.querySelectorAll('[data-qrscan]').forEach((b) => b.addEventListener('click', () => openScanner(navigate))); }
