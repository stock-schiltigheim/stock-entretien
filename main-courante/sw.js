/* Main courante technique – ouverture rapide, hors connexion et notifications du téléphone */
const ICONE = 'icone-180.png';
const BADGE = 'badge-96.png';
const APP = 'mc-app-v1';      // la page de l'application (mise à jour en arrière-plan)
const LIBS = 'mc-libs-v1';    // bibliothèques externes (versions figées)

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(Promise.all([
    caches.open(APP).then((c) => c.addAll(['./', 'manifest.webmanifest', ICONE, BADGE]).catch(() => {})),
    caches.open(LIBS).then((c) => c.add('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js').catch(() => {}))
  ]));
});
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (![APP, LIBS].includes(k)) await caches.delete(k);
  await self.clients.claim();
})()));

const pageUrl = () => new URL('./', self.registration.scope).href;
async function prevenir(type) {
  for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage({ type });
}
// Page : on montre tout de suite la version gardée sur le téléphone, puis on vérifie en arrière-plan
// s'il en existe une plus récente ; si oui, elle est rangée et l'application propose « Mettre à jour ».
async function page(req, e) {
  const cache = await caches.open(APP);
  const garde = await cache.match(pageUrl());
  const ancienTxt = garde ? garde.clone().text() : Promise.resolve(null);
  const reseau = fetch(pageUrl(), { cache: 'no-store' }).then(async (r) => {
    if (!r || !r.ok) return r;
    const neuf = await r.clone().text();
    const ancien = await ancienTxt;
    if (ancien !== neuf) { await cache.put(pageUrl(), r.clone()); if (ancien !== null) await prevenir('mc-maj'); }
    return r;
  }).catch(() => null);
  e.waitUntil(reseau);
  if (garde) return garde;
  return (await reseau) || new Response('<h1>Pas de connexion</h1><p>Ouvrez l\'application une première fois avec Internet.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
async function biblio(req) {
  const cache = await caches.open(LIBS);
  const garde = await cache.match(req);
  if (garde) return garde;
  const r = await fetch(req);
  if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone());
  return r;
}
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (req.mode === 'navigate' && u.href.startsWith(self.registration.scope) && !/\.[a-z0-9]{2,5}$/i.test(u.pathname.replace(/\/$/, ''))) { e.respondWith(page(req, e)); return; }
  if (/^(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)$/.test(u.hostname)) { e.respondWith(biblio(req)); return; }
  if (u.origin === self.location.origin && /\.(png|svg|webmanifest)$/.test(u.pathname)) e.respondWith(caches.match(req).then((g) => g || fetch(req)));
});

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
