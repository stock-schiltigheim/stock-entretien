/* Registres de sécurité – notifications du téléphone */
const ICONE = 'icone-192.png';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { titre: 'Registres de sécurité', corps: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.titre || 'Registres de sécurité', {
      body: d.corps || '',
      icon: ICONE,
      tag: d.tag || undefined,
      data: { lien: d.lien || '' },
      vibrate: d.urgent ? [200, 100, 200] : [120],
      requireInteraction: !!d.urgent
    });
    try { if (self.navigator.setAppBadge) await self.navigator.setAppBadge(d.nonLues || 1); } catch (_) {}
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    fenetres.forEach((c) => c.postMessage({ type: 'notif' }));
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const lien = (e.notification.data && e.notification.data.lien) || '';
  const url = self.registration.scope + lien;
  e.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of fenetres) {
      if (c.url.startsWith(self.registration.scope)) { await c.focus(); c.postMessage({ type: 'ouvrir', lien }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
