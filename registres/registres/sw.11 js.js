/* Registres de sécurité – notifications du téléphone + fonctionnement hors ligne */
const ICONE = 'icone-192.png';
const CACHE = 'registres-v2';
const LOCAL = ['./', './index.html', './manifest.webmanifest', './icone-180.png', './icone-192.png', './icone-512.png'];
const CDN = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
];
const HOTES_CDN = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all([...LOCAL.map((u) => c.add(u).catch(() => {})),
      ...CDN.map((u) => fetch(u, { mode: 'no-cors' }).then((r) => c.put(u, r)).catch(() => {}))]);
  })());
});
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('registres-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// Page et fichiers de l'application : réseau d'abord (toujours la dernière version), copie de secours hors ligne.
// Bibliothèques (CDN) : copie locale d'abord. Données Supabase : jamais mises en cache ici (gérées par l'application).
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try {
        const r = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('lent')), 8000))]);
        if (r && r.ok) c.put(req.mode === 'navigate' ? './index.html' : req, r.clone()).catch(() => {});
        return r;
      } catch (err) {
        const m = (req.mode === 'navigate' ? (await c.match('./index.html')) || (await c.match('./')) : await c.match(req, { ignoreSearch: true }));
        if (m) return m; throw err;
      }
    })());
    return;
  }
  if (HOTES_CDN.includes(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const m = await c.match(req); if (m) return m;
      const r = await fetch(req); if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()).catch(() => {});
      return r;
    })());
  }
});

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
