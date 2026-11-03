/* Stock Entretien – notifications du téléphone */
const ICONE = 'balai-192.png';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { titre: 'Stock Entretien', corps: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.titre || 'Stock Entretien', {
      body: d.corps || '',
      icon: ICONE,
      badge: ICONE,
      tag: d.tag || undefined,
      data: { lien: d.lien || '' },
      vibrate: [120]
    });
    try { if (self.navigator.setAppBadge) await self.navigator.setAppBadge(d.nonLues || 1); } catch (_) {}
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    fenetres.forEach((c) => c.postMessage({ type: 'notif' }));
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const lien = (e.notification.data && e.notification.data.lien) || '';
  const url = self.registration.scope + 'index.html' + lien;
  e.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of fenetres) {
      if (c.url.startsWith(self.registration.scope) && !/registres|main-courante/.test(c.url)) { await c.focus(); c.postMessage({ type: 'ouvrir', lien }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
