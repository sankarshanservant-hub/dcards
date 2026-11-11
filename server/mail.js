// Письма сайта. Если задан SMTP_URL — письмо уходит по-настоящему. Иначе (демо-режим) письмо не отправляется:
// оно сохраняется в журнале outbox и возвращается, чтобы интерфейс показал его текст с пометкой «демо».
const db = require('./db');
const config = require('./config');

let transport = null;
if (config.smtpUrl) {
  const nodemailer = require('nodemailer');
  transport = nodemailer.createTransport(config.smtpUrl);
}

const insert = db.prepare('INSERT INTO outbox (to_email, subject, body, status, error) VALUES (?, ?, ?, ?, ?)');

async function send(to, subject, body) {
  if (!transport) {
    insert.run(to, subject, body, 'demo', null);
    return { sent: false, demo: true, subject, body };
  }
  try {
    await transport.sendMail({ from: config.mailFrom, to, subject, text: body });
    insert.run(to, subject, body, 'sent', null);
    return { sent: true, demo: false, subject };
  } catch (e) {
    insert.run(to, subject, body, 'failed', String(e.message || e).slice(0, 300));
    return { sent: false, demo: false, failed: true, subject };
  }
}

module.exports = { send, connected: () => !!transport };
