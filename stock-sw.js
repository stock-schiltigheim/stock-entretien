/* Stock Entretien – notifications du téléphone et fonctionnement sans réseau */
const ICONE = 'balai-192.png';
const APP_CACHE = 'stock-app-v2';
const CDN = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js'
];
const LOCAL = ['./', 'index.html', 'balai-180.png', 'balai-192.png', 'balai-512.png', 'balai.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(APP_CACHE);
    // Un fichier qui manque n'empêche pas l'installation
    await Promise.all([...LOCAL, ...CDN].map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('stock-app-') && k !== APP_CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

const estCdn = (u) => /^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//.test(u);
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const memeSite = url.origin === self.location.origin && url.pathname.startsWith(new URL(self.registration.scope).pathname);
  // L'application : réseau d'abord (pour avoir la dernière version), sinon la copie du téléphone
  if (req.mode === 'navigate' && memeSite) {
    e.respondWith((async () => {
      const c = await caches.open(APP_CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) c.put('index.html', res.clone());
        return res;
      } catch (_) {
        return (await c.match('index.html')) || (await c.match('./')) || Response.error();
      }
    })());
    return;
  }
  // Bibliothèques et polices : la copie du téléphone d'abord (adresses figées)
  if (estCdn(req.url) || (memeSite && /\.(png|webmanifest|svg|woff2?)$/.test(url.pathname))) {
    e.respondWith((async () => {
      const c = await caches.open(APP_CACHE);
      const hit = await c.match(req, { ignoreSearch: !estCdn(req.url) });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      } catch (_) { return Response.error(); }
    })());
  }
  // Supabase et le reste : pas de copie (les données sont gardées par l'application)
});

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
