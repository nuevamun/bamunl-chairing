// Keeps the chairing app working when the wifi drops.
//
// Every page of the app is the same empty shell (all the data is on the device), so a copy of each kind of page is
// kept and used when the network doesn't answer. Scripts, styles and fonts are kept as they're fetched.
// Online, pages still come from the server first, so signing in, signing out and new versions work as normal.
// Nothing from the API or the database is ever stored here.

const PAGES = 'chairing-pages-v1';
const FILES = 'chairing-files-v1';
const MARK = 'data-chairing';          // every real page of this app carries this; a hotel wifi login page doesn't
const WAIT_MS = 4000;                  // a page that takes longer than this to arrive is replaced by the kept copy
const MAX_FILES = 400;

// Which kind of page is this? The shell for each kind is the same whatever the committee or conference id.
const kindOf = (p) => (p === '/' ? 'home' : p === '/login' ? 'login'
  : /^\/conf\/[^/]+\/?$/.test(p) ? 'conf'
  : /^\/c\/[^/]+\/display\/?$/.test(p) ? 'display'
  : /^\/c\/[^/]+\/?$/.test(p) ? 'console' : null);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const within = (promise, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('slow')), ms);
  promise.then((v) => { clearTimeout(t); resolve(v); }, (err) => { clearTimeout(t); reject(err); });
});

async function keepShell(kind, res) {
  try {
    if (!kind || kind === 'login' || !res.ok || res.redirected || res.type === 'opaqueredirect') return;
    if (!(res.headers.get('content-type') || '').includes('text/html')) return;
    const html = await res.clone().text();
    if (!html.includes(MARK)) return;
    await (await caches.open(PAGES)).put(`/__shell/${kind}`, new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    return html;
  } catch { /* keeping a copy is a bonus, never a reason to fail */ }
}

async function page(req, url) {
  const kind = kindOf(url.pathname);
  try {
    const res = await within(fetch(req), WAIT_MS);
    keepShell(kind, res);
    return res;
  } catch {
    if (kind && kind !== 'login') {
      const kept = await (await caches.open(PAGES)).match(`/__shell/${kind}`);
      if (kept) return kept;
    }
    return new Response('You are offline and this page has not been opened on this device yet. Reconnect, open it once, and it will keep working offline.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_FILES))) await cache.delete(k);
}

async function file(req) {
  const cache = await caches.open(FILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && !(res.headers.get('content-type') || '').includes('text/html')) { await cache.put(req, res.clone()); trim(cache); }
    return res;
  } catch { return Response.error(); }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;
  if (req.mode === 'navigate') event.respondWith(page(req, url));
  else if (/^\/(_astro|img)\//.test(url.pathname) || /\.(?:png|ico|svg|woff2?|css|js)$/.test(url.pathname)) event.respondWith(file(req));
});

// Right after sign-in the app asks for every kind of page and its files to be kept, so the first time the wifi drops
// nothing is missing, even for a page that hasn't been opened yet.
async function warm() {
  const cache = await caches.open(FILES);
  for (const icon of ['/favicon.ico', '/favicon-32.png', '/apple-touch-icon.png']) {
    if (!(await cache.match(icon))) { try { const r = await fetch(icon); if (r.ok) await cache.put(icon, r); } catch { /* next one */ } }
  }
  for (const path of ['/', '/conf/warm', '/c/warm', '/c/warm/display']) {
    try {
      const res = await fetch(path, { redirect: 'manual' });
      const html = await keepShell(kindOf(path), res);
      if (!html) continue;
      for (const asset of new Set(html.match(/\/_astro\/[^"'\s)]+|\/img\/[^"'\s)]+/g) || [])) {
        if (!(await cache.match(asset))) { try { const r = await fetch(asset); if (r.ok) await cache.put(asset, r); } catch { /* next one */ } }
      }
    } catch { /* offline right now: try again next time */ }
  }
}
self.addEventListener('message', (e) => { if (e.data && e.data.type === 'warm') e.waitUntil(warm()); });
