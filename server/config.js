const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));

module.exports = {
  root,
  dataDir,
  mediaDir: path.join(dataDir, 'media'),
  port: Number(process.env.PORT || 3000),
  isProduction: process.env.NODE_ENV === 'production',
  // Пароль владельца проекта для прототипа. В продакшене обязателен.
  adminPassword: process.env.ADMIN_PASSWORD || '',
  // Публичный адрес сайта для ссылок и QR (например https://dialogue.cards). Если пусто — берётся из запроса.
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  maxCollectionSize: 40,
  maxRounds: 20,
};
