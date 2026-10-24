// Offline shell for the check page: cache-first, so the page opens even when the host is unreachable.
// Scope /emma/check/ (its own registration). The app's worker skips /emma/check/ and never deletes "emma-check-" caches;
// this worker only ever deletes older "emma-check-" caches. Keep CACHE equal to 'emma-check-' + CHECK_VERSION in logic.js.
const CACHE = 'emma-check-2';
const SHELL = ['./', './index.html', './page.js', './logic.js', './manifest.webmanifest', './icon-180.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('emma-check-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true, cacheName: CACHE }).then(hit => hit || fetch(req).then(res => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }))
  );
});
