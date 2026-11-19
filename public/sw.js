// Service worker Dialogue Cards: только push-уведомления (страницы не кэшируются — всегда свежая версия сайта).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  const base = self.registration.scope;
  e.waitUntil(self.registration.showNotification(d.title || 'Dialogue Cards', {
    body: d.body || '', tag: d.tag || undefined, renotify: false,
    icon: base + 'img/icon-192.png', badge: base + 'img/badge-96.png',
    data: { url: d.url || base },
  }));
});

// Нажатие открывает конкретное сообщение: уже открытую вкладку сайта переводим туда, иначе открываем новую.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || self.registration.scope, self.registration.scope).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // открытое приложение: выводим вперёд и просим само перейти (на iPhone navigate() из уведомления часто не срабатывает)
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
        try { await c.focus(); } catch { /* */ }
        c.postMessage({ type: 'dc-open', url });
        return;
      }
    }
    return self.clients.openWindow(url);
  })());
});
