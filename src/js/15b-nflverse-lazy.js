// ─────────────────────────────────────────────────────────────────────────────
// Lazy-loaded heavy nflverse sections (def_weekly, coaching_scheme)
// ─────────────────────────────────────────────────────────────────────────────
// These two blocks are by far the largest nflverse payloads and are only read when a
// user opens a specific defensive player card or a team's coaching-scheme modal. To keep
// the initial seed load lean/fast, build_seed.py writes them to sidecar files that the app
// fetches on demand (hosted). The baked/offline file re-embeds them as SEED_NFLVERSE_*
// constants (file:// can't fetch), which we merge into NFLVERSE at load below.
let _nflverseLazyLoaded = { def_weekly:false, coaching_scheme:false };
let _nflverseLazyPromise = {};
const _NFLVERSE_SIDECAR_URL = {
  def_weekly: 'triplecrown_seed.def_weekly.json',
  coaching_scheme: 'triplecrown_seed.coaching.json',
};

// Merge a {season:{key:{...}}} payload into NFLVERSE[season][section].
function mergeNflverseSection(section, data){
  if(!data || typeof NFLVERSE==='undefined' || !NFLVERSE) return;
  for(const s in data){ (NFLVERSE[s] = NFLVERSE[s] || {})[section] = data[s]; }
}

// True when a section is already available (embedded/baked, previously fetched, or carried
// inline by an older full seed).
function nflverseSectionReady(section){
  if(_nflverseLazyLoaded[section]) return true;
  if(typeof NFLVERSE==='object' && NFLVERSE){
    for(const s in NFLVERSE){ if(NFLVERSE[s] && NFLVERSE[s][section]) return true; }
  }
  return false;
}

// Reset lazy state — called when the app replaces NFLVERSE wholesale (seed (re)load).
function resetNflverseLazy(){
  _nflverseLazyLoaded = { def_weekly:false, coaching_scheme:false };
  _nflverseLazyPromise = {};
  _coachingSeasonLoaded = {};
  _coachingSeasonPromise = {};
}

// Fetch a sidecar section on demand and merge it in. Returns a promise resolving to whether
// the data is now available. Never throws (file:// / missing file just resolves false).
function ensureNflverseSection(section){
  if(nflverseSectionReady(section)) return Promise.resolve(true);
  if(_nflverseLazyPromise[section]) return _nflverseLazyPromise[section];
  const url = _NFLVERSE_SIDECAR_URL[section];
  _nflverseLazyPromise[section] = (async()=>{
    try{
      const res = await fetch(url, {cache:'no-store'});
      if(!res.ok) return false;
      const data = await res.json();
      mergeNflverseSection(section, data);
      _nflverseLazyLoaded[section] = true;
      return true;
    }catch(e){ return false; }
  })();
  return _nflverseLazyPromise[section];
}

// ── Per-season coaching-scheme loading ───────────────────────────────────────
// The coaching-scheme block is by far the largest nflverse payload and is viewed one season
// at a time, so build_seed.py writes a separate sidecar per season
// (triplecrown_seed.coaching.<season>.json). The modal fetches only the season being viewed,
// so the typical first open downloads ~1 season instead of the whole multi-season block.
let _coachingSeasonLoaded = {};
let _coachingSeasonPromise = {};

function coachingSeasonReady(season){
  season = String(season);
  if(_coachingSeasonLoaded[season]) return true;
  return !!(typeof NFLVERSE==='object' && NFLVERSE && NFLVERSE[season] && NFLVERSE[season].coaching_scheme);
}

function ensureNflverseCoachingSeason(season){
  season = String(season);
  if(coachingSeasonReady(season)) return Promise.resolve(true);
  if(_coachingSeasonPromise[season]) return _coachingSeasonPromise[season];
  _coachingSeasonPromise[season] = (async()=>{
    try{
      const res = await fetch(`triplecrown_seed.coaching.${season}.json`, {cache:'no-store'});
      if(!res.ok) return false;
      const data = await res.json();
      if(data && typeof data==='object' && typeof NFLVERSE==='object' && NFLVERSE){
        (NFLVERSE[season] = NFLVERSE[season] || {}).coaching_scheme = data;
        _coachingSeasonLoaded[season] = true;
        return true;
      }
      return false;
    }catch(e){ return false; }
  })();
  return _coachingSeasonPromise[season];
}

// Merge any embedded sidecars (baked/offline path) into NFLVERSE once at load.
(function(){
  try{
    const dw = (typeof SEED_NFLVERSE_DEF_WEEKLY!=='undefined') ? SEED_NFLVERSE_DEF_WEEKLY : null;
    const cs = (typeof SEED_NFLVERSE_COACHING!=='undefined') ? SEED_NFLVERSE_COACHING : null;
    if(dw && Object.keys(dw).length){ mergeNflverseSection('def_weekly', dw); _nflverseLazyLoaded.def_weekly = true; }
    if(cs && Object.keys(cs).length){ mergeNflverseSection('coaching_scheme', cs); _nflverseLazyLoaded.coaching_scheme = true; }
  }catch(e){ /* no embedded sidecars — hosted lazy path will fetch on demand */ }
})();
