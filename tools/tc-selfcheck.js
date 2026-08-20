/* TripleCrown live self-check — paste into the DevTools console on the deployed site.
 * Read-only: it inspects state and prints a report. It changes nothing.
 * Run it AFTER the board has finished loading (wait for the team list to appear).
 */
(async () => {
  const R = [];
  const ok   = (n, d) => R.push(['PASS', n, d]);
  const bad  = (n, d) => R.push(['FAIL', n, d]);
  const info = (n, d) => R.push(['INFO', n, d]);
  const warn = (n, d) => R.push(['WARN', n, d]);
  // Top-level `let`/`const` in a classic script live in the global LEXICAL environment, not on
  // window — so `window.ECR` is undefined even though `ECR` resolves. Read them by direct
  // reference inside try/catch; that resolves through the real scope chain everywhere.
  const D = fn => { try { return fn(); } catch (e) { return undefined; } };

  // ── 1. blocking CDN scripts should be gone from <head> ────────────────────
  const headScripts = [...document.head.querySelectorAll('script[src]')].map(s => s.src);
  const blocking = headScripts.filter(s => /cdnjs|jsdelivr/.test(s));
  blocking.length ? bad('no blocking CDN scripts in <head>', blocking.join(', '))
                  : ok('no blocking CDN scripts in <head>', headScripts.length + ' head script(s)');

  // ── 2. did the deploy ship minified? ──────────────────────────────────────
  const html = document.documentElement.outerHTML;
  info('shipped index.html', (html.length / 1024).toFixed(0) + 'KB in memory');
  const commentLines = (html.match(/\n\s*\/\/ /g) || []).length;
  commentLines > 200
    ? warn('minified', `NO — ${commentLines} source comment lines still shipped (see §0 in TESTING.md)`)
    : ok('minified', 'yes (source comments stripped)');

  // ── 2b. is the live site actually serving the WORKFLOW ARTIFACT? ──────────
  // Decisive, because these two differences exist only in the artifact:
  //   • sw.js has __BUILD_ID__ replaced with the commit SHA
  //   • README screenshots are NOT copied (only app-icon.png + ktc.png)
  try {
    const swSrc = await fetch('sw.js', { cache: 'no-store' }).then(r => r.text());
    /__BUILD_ID__/.test(swSrc)
      ? bad('deploy source', 'sw.js still contains __BUILD_ID__ — the Actions artifact is NOT what is being served')
      : ok('deploy source', 'sw.js was stamped by the workflow');
  } catch (e) { warn('deploy source', 'could not fetch sw.js: ' + e.message); }
  try {
    const shot = await fetch('images/receiving.png', { method: 'HEAD', cache: 'no-store' });
    shot.ok
      ? warn('README screenshots', 'still deployed (~2MB) — expected 404 from the new workflow')
      : ok('README screenshots', 'not deployed (404), as intended');
  } catch (e) { info('README screenshots', 'probe failed: ' + e.message); }

  // ── 3. seed actually loaded ───────────────────────────────────────────────
  const ecrTbl   = D(() => ECR);
  const seedTbl  = D(() => SEED);
  const contrTbl = D(() => CONTRACTS);
  const ecrN  = ecrTbl ? Object.keys(ecrTbl).reduce((n, f) => n + Object.keys(ecrTbl[f] || {}).length, 0) : 0;
  const teams = seedTbl ? Object.keys(seedTbl).length : 0;
  (teams >= 30 && ecrN > 1000)
    ? ok('seed loaded', `${teams} teams · ${ecrN} ECR ranks · ${Object.keys(contrTbl || {}).length} contracts`)
    : bad('seed loaded', `only ${teams} teams / ${ecrN} ECR — the seed did NOT apply`);

  // ── 4. exactly one seed request, and it was cacheable ─────────────────────
  const seedReqs = performance.getEntriesByType('resource').filter(r => /triplecrown_seed\.json/.test(r.name));
  seedReqs.length === 1 ? ok('seed fetched once', seedReqs[0].name.split('/').pop())
    : seedReqs.length === 0 ? info('seed fetched once', 'no request this load (served from cache — fine)')
    : bad('seed fetched once', seedReqs.length + ' requests: ' + seedReqs.map(r => r.name.split('/').pop()).join(', '));
  const notFound = performance.getEntriesByType('resource')
    .filter(r => /triplecrown_seed\.json$/.test(r.name) && r.transferSize > 0 && r.decodedBodySize === 0);
  notFound.length && warn('gz fallback', 'the plain .json was requested — check Content-Encoding handling');

  // ── 5. service worker ─────────────────────────────────────────────────────
  if (!navigator.serviceWorker) { warn('service worker', 'unsupported in this browser'); }
  else {
    const regs = await navigator.serviceWorker.getRegistrations();
    if (!regs.length) warn('service worker', 'not registered yet — it registers ~1.5s after load; re-run this');
    else {
      const r = regs[0];
      ok('service worker', `scope ${r.scope} · ${r.active ? 'active' : r.installing ? 'installing' : 'waiting'}`);
      const keys = await caches.keys();
      const tc = keys.filter(k => k.startsWith('tc-'));
      tc.length ? ok('sw cache', tc.join(', ')) : warn('sw cache', 'no tc-* cache yet');
      if (tc.length > 1) warn('sw cache', 'more than one version present: ' + tc.join(', '));
      for (const k of tc) {
        const names = (await (await caches.open(k)).keys()).map(q => q.url.split('/').pop() || 'index');
        info('  cached in ' + k, names.join(', ') || '(empty)');
      }
    }
  }

  // ── 6. manifest / installability ──────────────────────────────────────────
  const man = document.querySelector('link[rel="manifest"]');
  man ? ok('web manifest', man.href) : bad('web manifest', 'missing');
  const icon = document.querySelector('link[rel="icon"]');
  icon && /svg/.test(icon.type || '') ? bad('favicon type', 'still declared image/svg+xml') : ok('favicon type', icon ? (icon.type || 'unset') : 'none');

  // ── 7. the rankings DOM diet (only meaningful on the Rankings view) ───────
  const content = document.getElementById('content');
  const noteCells = content ? content.querySelectorAll('[data-noteable="1"]').length : 0;
  if (noteCells) {
    let noteAttrs = 0, scopeRows = 0;
    content.querySelectorAll('*').forEach(el => { for (const a of el.attributes) if (a.name.startsWith('data-note-')) noteAttrs++; });
    scopeRows = content.querySelectorAll('[data-note-scope]').length;
    const perCell = (noteAttrs / noteCells).toFixed(1);
    scopeRows > 0 && perCell < 4
      ? ok('note metadata split', `${noteCells} tagged cells · ${perCell} attrs/cell · ${scopeRows} row scopes`)
      : bad('note metadata split', `${perCell} attrs/cell, ${scopeRows} row scopes — looks un-split`);
    info('rankings HTML', (content.innerHTML.length / 1024).toFixed(0) + 'KB · ' + content.querySelectorAll('*').length + ' nodes');
  } else {
    info('note metadata split', 'open the Rankings view and re-run to check this');
  }

  // ── 8. bounded caches present ─────────────────────────────────────────────
  const cacheBytes = D(() => rankingsRenderCacheBytes);
  typeof cacheBytes === 'function'
    ? ok('render cache is byte-bounded', (cacheBytes() / 1024).toFixed(0) + 'KB held')
    : bad('render cache is byte-bounded', 'rankingsRenderCacheBytes() missing — old build?');
  const lru = D(() => _coachingLru);
  Array.isArray(lru) ? ok('coaching LRU', 'seasons held: ' + (lru.join(', ') || 'none yet')) : warn('coaching LRU', 'not present');

  // ── 9. the three bug fixes ────────────────────────────────────────────────
  typeof D(() => laCloseRadarPops) === 'function'
    ? ok('bug: radar popovers', 'laCloseRadarPops defined')
    : bad('bug: radar popovers', 'laCloseRadarPops STILL missing');
  let adpOk = true;
  try { void _bgAdpRefreshed; } catch (e) { adpOk = false; bad('bug: baked-file ADP', e.message); }
  adpOk && ok('bug: baked-file ADP', 'binding reachable (no TDZ)');
  // Match the old guard, not the bare name — the name legitimately appears in the comment
  // that explains the fix, so a bare-name search false-fails on an unminified build.
  /typeof\s+calcTeamWinsLosses/.test(html)
    ? bad('bug: swipe header record', 'the old typeof calcTeamWinsLosses guard is still there')
    : ok('bug: swipe header record', 'rewired to espnRecordCache');

  // ── 10. timings ───────────────────────────────────────────────────────────
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const fcp = (performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint') || {}).startTime;
  info('timings', `FCP ${fcp ? Math.round(fcp) : '?'}ms · DCL ${Math.round(nav.domContentLoadedEventEnd || 0)}ms · load ${Math.round(nav.loadEventEnd || 0)}ms`);

  // Document transfer vs. decoded size. These are the two numbers to compare when A/B-ing a
  // minified build against an unminified one:
  //   decoded  = bytes the browser must parse and compile   (minify shrinks this)
  //   transfer = bytes actually sent over the wire          (gzip + minify shrink this)
  const tx = nav.transferSize || 0, dec = nav.decodedBodySize || 0;
  if (dec) {
    const ratio = tx ? (dec / tx).toFixed(2) : '?';
    info('document bytes', `${(tx / 1024).toFixed(0)}KB over the wire · ${(dec / 1024).toFixed(0)}KB decoded · ${ratio}x`);
    if (tx && dec && tx >= dec * 0.9) {
      warn('compression', `served essentially uncompressed (${(tx / 1024).toFixed(0)}KB) — expected roughly a 3-4x gzip win`);
    } else if (tx) {
      ok('compression', `gzipped ${ratio}x on the wire`);
    }
  } else {
    info('document bytes', 'not reported (served from cache or by the service worker)');
  }
  if (performance.memory) info('JS heap', Math.round(performance.memory.usedJSHeapSize / 1048576) + 'MB');
  info('compare hint', 'for a clean A/B, run this on each build in a fresh tab and note: document bytes, DCL, JS heap');

  // ── report ────────────────────────────────────────────────────────────────
  const pad = s => (s + '                                   ').slice(0, 34);
  console.log('%c TripleCrown self-check ', 'background:#1599E6;color:#000;font-weight:700');
  R.forEach(([lvl, n, d]) => {
    const c = lvl === 'PASS' ? 'color:#3fb950' : lvl === 'FAIL' ? 'color:#f85149;font-weight:700'
            : lvl === 'WARN' ? 'color:#d29922' : 'color:#8b949e';
    console.log('%c' + lvl + '  ' + pad(n) + ' ' + d, c);
  });
  const fails = R.filter(r => r[0] === 'FAIL').length, warns = R.filter(r => r[0] === 'WARN').length;
  console.log('%c' + (fails ? `${fails} FAILED` : 'all checks passed') + (warns ? ` · ${warns} warning(s)` : ''),
              fails ? 'color:#f85149;font-weight:700' : 'color:#3fb950;font-weight:700');
  return { fails, warns };
})();
