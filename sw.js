/* Service worker: makes the game work offline without ever pinning an old version.
   - Same-origin files: network first (so a merged change shows on the next open), cache as the offline fallback.
   - Google Fonts: cache first, refreshed in the background.
   The cache is rewritten on every successful network fetch, so no version bump is needed per release.
   Bump CACHE only if the list of files in SHELL changes shape. */
const CACHE = 'sabr-maze-v1';
const FONTS = 'sabr-maze-fonts-v1';
const NETWORK_TIMEOUT = 4000;
const SHELL = [
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k !== FONTS) await caches.delete(k);
    await self.clients.claim();
  })());
});

// "/", "/?source=pwa" and "/index.html" are one page: always store and look it up under index.html.
const PAGE = new URL('index.html', self.registration.scope).href;
const keyFor = req => {
  const u = new URL(req.url);
  return req.mode === 'navigate' || u.pathname.endsWith('/') ? PAGE : req;
};

function networkFirst(req) {
  const key = keyFor(req);
  return new Promise(resolve => {
    let settled = false;
    const fallback = async () => {
      return caches.match(key, { ignoreSearch: true });
    };
    const timer = setTimeout(async () => {
      const hit = await fallback();
      if (hit && !settled) { settled = true; resolve(hit); }
    }, NETWORK_TIMEOUT);
    fetch(req, { cache: 'no-cache' }).then(async res => {
      clearTimeout(timer);
      if (res.ok) { const c = await caches.open(CACHE); c.put(key, res.clone()); }
      if (!settled) { settled = true; resolve(res); }
    }).catch(async () => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const hit = await fallback();
      resolve(hit || Response.error());
    });
  });
}

async function fontsCacheFirst(req) {
  const c = await caches.open(FONTS);
  const hit = await c.match(req);
  const refresh = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; });
  if (hit) { refresh.catch(() => {}); return hit; }
  return refresh;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) e.respondWith(networkFirst(req));
  else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') e.respondWith(fontsCacheFirst(req));
});
