// ═════════════════════════════════════════════════════════════════════════════
// Lazy third-party script loading
//
// Chart.js and the Supabase SDK used to sit in the document head as ordinary blocking
// script-src tags. That stopped HTML parsing — before the browser had even
// reached the ~1.3MB inline app script — while it did DNS + TLS + download
// against two separate third-party origins. Roughly 190KB gzipped on the
// critical path of every cold load, on a phone, before a single pixel.
//
// Neither is needed to boot:
//   • Chart.js draws exactly one doughnut (mkDoughnut, 50-pie-sliders.js) and is
//     only reachable once you open a team's Passing/Rushing tab. Every other
//     chart in the app — passing charts, route trees, rushing fans, the SOS arc —
//     is hand-rolled SVG/DOM with no library behind it.
//   • The Supabase SDK is only reachable if you sign in. Signed-out users (and
//     any offline/baked copy) never touch it.
//
// So both are fetched on first use instead. Each URL is loaded at most once, and
// the promise is cached so concurrent callers share one request.
// ═════════════════════════════════════════════════════════════════════════════
const TC_CHARTJS_SRC  = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js';
const TC_SUPABASE_SDK_SRC = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';

const _tcScriptPromises = {};
function tcLoadScriptOnce(url){
  if(_tcScriptPromises[url]) return _tcScriptPromises[url];
  _tcScriptPromises[url] = new Promise((resolve, reject)=>{
    if(typeof document==='undefined' || !document.createElement){
      reject(new Error('no document')); return;
    }
    let el;
    try{ el = document.createElement('script'); }
    catch(e){ reject(e); return; }
    el.src = url;
    el.async = true;
    el.onload = ()=>resolve(true);
    el.onerror = ()=>{
      // Let a later attempt retry rather than caching the failure forever — a phone
      // that was offline when you first opened a pie chart should get one on the
      // next try, not a permanently empty canvas.
      delete _tcScriptPromises[url];
      reject(new Error('failed to load '+url));
    };
    const host = document.head || document.body || document.documentElement;
    if(!host){ reject(new Error('no document host')); return; }
    host.appendChild(el);
  });
  return _tcScriptPromises[url];
}

// Resolves true once window.Chart is usable. Instant when Chart.js is already present
// (a baked/offline copy, a test harness, or a second call).
function tcEnsureChartJs(){
  if(typeof Chart!=='undefined') return Promise.resolve(true);
  return tcLoadScriptOnce(TC_CHARTJS_SRC).then(()=>typeof Chart!=='undefined').catch(()=>false);
}

// Resolves true once window.supabase (the UMD SDK) is usable.
function tcEnsureSupabaseSdk(){
  if(typeof window!=='undefined' && window.supabase && typeof window.supabase.createClient==='function')
    return Promise.resolve(true);
  return tcLoadScriptOnce(TC_SUPABASE_SDK_SRC)
    .then(()=>!!(typeof window!=='undefined' && window.supabase && typeof window.supabase.createClient==='function'))
    .catch(()=>false);
}

if(typeof module!=='undefined') module.exports={tcLoadScriptOnce, tcEnsureChartJs, tcEnsureSupabaseSdk};

// ── Service worker ───────────────────────────────────────────────────────────
// Registered after load so it never competes with the first paint or the seed fetch.
// Only over http(s): a file:// (baked) copy has no worker and doesn't need one — it is
// already fully self-contained.
if(typeof window!=='undefined' && typeof navigator!=='undefined' && navigator.serviceWorker &&
   typeof location!=='undefined' && /^https?:$/.test(location.protocol)){
  window.addEventListener('load', ()=>{
    // Deliberately late: registration kicks off its own network work, and nothing about the
    // first visit benefits from it. The payoff is entirely on visit two.
    setTimeout(()=>{
      navigator.serviceWorker.register('sw.js').catch(e=>{
        try{ console.info('[TC] service worker not registered:', e && e.message); }catch(_e){}
      });
    }, 1500);
  });
}
