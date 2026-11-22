// Два входа в одно приложение (решение владельца 21.11.2026):
//   • https://dialogue.cards/ — своё нейтральное приложение для всех (PUBLIC_URL, корень домена);
//   • https://harekrishna.info/dialogue-cards/ — то же приложение внутри портала (SITE_URL + SITE_BASE_PATH), со входом аккаунтом
//     портала. База, карты, встречи и люди — общие; ссылки, QR, письма и уведомления — на тот адрес, с которого пришёл человек.
// Вход определяется по Host запроса (nginx пускает сюда только свои домены). Без SITE_URL — один вход, как раньше (BASE_PATH).
const { AsyncLocalStorage } = require('node:async_hooks');
const config = require('./config');

const als = new AsyncLocalStorage();
const hostOf = (u) => { try { return new URL(u).host.toLowerCase(); } catch { return ''; } };
const appHost = hostOf(config.publicUrl);
const siteHost = hostOf(config.siteUrl);

/** Контекст запроса: base — путь приложения ('' или '/dialogue-cards'), origin — адрес сайта, portal — вход через портал. */
function contextFor(req) {
  const host = String(req.get('host') || '').toLowerCase();
  if (siteHost && host === siteHost) return { base: config.siteBasePath, origin: config.siteUrl, portal: true };
  if (config.siteUrl) return { base: '', origin: config.publicUrl || `${req.protocol}://${req.get('host')}`, portal: false };
  return { base: config.basePath, origin: config.publicUrl || `${req.protocol}://${req.get('host')}`, portal: true };
}
function middleware(req, res, next) {
  const ctx = contextFor(req);
  req.site = ctx;
  als.run(ctx, next);
}
const fallback = () => (config.siteUrl ? { base: '', origin: config.publicUrl, portal: false } : { base: config.basePath, origin: config.publicUrl, portal: true });
const current = () => als.getStore() || fallback();

module.exports = {
  middleware, contextFor, appHost, siteHost,
  /** Путь приложения для текущего запроса ('' или '/dialogue-cards'); вне запроса — основной вход. */
  base: () => current().base,
  /** Полный адрес приложения для текущего запроса, без «/» в конце. */
  appUrl: () => current().origin + current().base,
  /** Адрес для ссылок другим людям (поделиться, приглашения, QR): всегда нейтральный dialogue.cards, если входов два
   *  (решение владельца 22.11.2026); один вход — адрес текущего запроса. */
  shareUrl: () => (config.siteUrl && config.publicUrl ? config.publicUrl : current().origin + current().base),
  /** То же для страницы: пусто — браузер возьмёт текущий адрес. */
  shareMeta: () => (config.siteUrl && config.publicUrl ? config.publicUrl : ''),
  /** Вход через портал (кнопка «Аккаунт harekrishna.info»). */
  portalNow: () => current().portal,
  /** Пути, на которых сервер отвечает. */
  mounts: () => (config.siteUrl ? [config.siteBasePath, ''] : [config.basePath]),
};
