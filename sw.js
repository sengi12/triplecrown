/* TripleCrown service worker.
 *
 * The app is one big self-contained HTML file plus a set of pre-gzipped seed sidecars —
 * about 3MB on a cold load, none of which changes between deploys. Without a worker every
 * visit re-downloads all of it (and before the cache fix, even the HTTP cache was opted out
 * of), which on a phone is several seconds of staring at a loading state for bytes the
 * device already had.
 *
 * Strategy, by asset class:
 *   • index.html  — network-first with a cache fallback. A new deploy must win, but a flaky
 *                   connection should still open the app you already have.
 *   • seeds/*.gz  — cache-first, revalidated in the background. These are large and change at
 *                   most once per seed rebuild; serving yesterday's seed instantly and
 *                   refreshing it silently is the right trade for a projection tool.
 *   • images/     — cache-first. They never change.
 * Everything else (Sleeper, ESPN, CDN scripts) is left alone — those are live data and must
 * not be served stale.
 *
 * CACHE_VERSION is bumped by the Pages workflow so a deploy cleanly retires old entries.
 */
const CACHE_VERSION = 'tc-__BUILD_ID__';
const CORE = ['./', './index.html', './images/app-icon.png'];

self.addEventListener('install', e=>{
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(c=>c.addAll(CORE).catch(()=>{}))   // a missing optional asset must not fail install
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE_VERSION).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

function cacheFirst(req, revalidate){
  return caches.match(req).then(hit=>{
    if(hit){
      if(revalidate){
        // Refresh in the background; this request is already answered.
        fetch(req).then(res=>{
          if(res && res.ok) caches.open(CACHE_VERSION).then(c=>c.put(req, res.clone()));
        }).catch(()=>{});
      }
      return hit;
    }
    return fetch(req).then(res=>{
      if(res && res.ok){ const copy=res.clone(); caches.open(CACHE_VERSION).then(c=>c.put(req, copy)); }
      return res;
    });
  });
}

function networkFirst(req){
  return fetch(req).then(res=>{
    if(res && res.ok){ const copy=res.clone(); caches.open(CACHE_VERSION).then(c=>c.put(req, copy)); }
    return res;
  }).catch(()=>caches.match(req).then(hit=>hit || caches.match('./index.html')));
}

self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method !== 'GET') return;
  let url;
  try{ url = new URL(req.url); }catch(err){ return; }
  if(url.origin !== self.location.origin) return;      // live APIs and CDNs: never intercept

  const path = url.pathname;
  if(req.mode === 'navigate' || path.endsWith('/') || path.endsWith('/index.html')){
    e.respondWith(networkFirst(req));
    return;
  }
  if(path.indexOf('/seeds/') >= 0){ e.respondWith(cacheFirst(req, true)); return; }
  if(path.indexOf('/images/') >= 0){ e.respondWith(cacheFirst(req, false)); return; }
});
