const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const isProduction = process.env.NODE_ENV === 'production';

// Адрес, под которым живёт приложение: '/' или, например, '/dialogue-cards' (если сайт стоит в подпапке чужого домена).
const basePath = ('/' + (process.env.BASE_PATH || '').replace(/^\/+|\/+$/g, '')).replace(/^\/$/, '');

module.exports = {
  root,
  dataDir,
  mediaDir: path.join(dataDir, 'media'),
  port: Number(process.env.PORT || 3000),
  isProduction,
  basePath, // '' или '/prefix'
  // Пароль владельца проекта (вход «Владелец»). В продакшене обязателен.
  adminPassword: process.env.ADMIN_PASSWORD || '',
  // Публичный адрес сайта для ссылок, писем и QR (например https://example.org). Если пусто — берётся из запроса.
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  // Демо-режим: тестовый переключатель ролей и показ писем на экране вместо отправки.
  // По умолчанию включён, кроме продакшена; DEMO_MODE=1 / 0 задаёт явно.
  demoMode: process.env.DEMO_MODE ? process.env.DEMO_MODE === '1' : !isProduction,
  // Отправка писем: SMTP_URL=smtps://user:pass@host:465 и MAIL_FROM="Dialogue Cards <noreply@…>".
  smtpUrl: process.env.SMTP_URL || '',
  mailFrom: process.env.MAIL_FROM || 'Dialogue Cards <noreply@localhost>',
  // Вход общим аккаунтом сайта, на котором стоит приложение (harekrishna.info: Google, Яндекс, письмо).
  // Сервер проверяет сессию сайта запросом «me» к его API. По умолчанию — PUBLIC_URL + '/api/seva'; SITE_AUTH_URL=off — выключить.
  siteAuthUrl: process.env.SITE_AUTH_URL === 'off' ? ''
    : (process.env.SITE_AUTH_URL || (process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/$/, '') + '/api/seva' : '')),
  maxCollectionSize: 40,
  maxRounds: 20,
  termsVersion: 'draft-2026-11-11',
};
