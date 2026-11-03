/* Main courante technique – notifications du téléphone */
const ICONE = 'icone-180.png';
const BADGE = 'badge-96.png';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { titre: 'Main courante', corps: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.titre || 'Main courante', {
      body: d.corps || '',
      icon: ICONE,
      badge: BADGE,
      tag: d.tag || undefined,
      data: { lien: d.lien || '' },
      vibrate: d.urgent ? [200, 100, 200] : [120],
      requireInteraction: !!d.urgent
    });
    try { if (self.navigator.setAppBadge) await self.navigator.setAppBadge(d.nonLues || 1); } catch (_) {}
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const lien = (e.notification.data && e.notification.data.lien) || '';
  const url = new URL(lien || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of fenetres) {
      if (c.url.startsWith(self.registration.scope)) { await c.focus(); c.postMessage({ type: 'ouvrir', lien }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
