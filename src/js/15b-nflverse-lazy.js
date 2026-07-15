// ─────────────────────────────────────────────────────────────────────────────
// Lazy-loaded heavy nflverse sections (def_weekly, coaching_scheme)
// ─────────────────────────────────────────────────────────────────────────────
// These two blocks are by far the largest nflverse payloads and are only read when a
// user opens a specific defensive player card or a team's coaching-scheme modal. To keep
// the initial seed load lean/fast, build_seed.py writes them to sidecar files that the app
// fetches on demand (hosted). The baked/offline file re-embeds them as SEED_NFLVERSE_*
// constants (file:// can't fetch), which we merge into NFLVERSE at load below.

// Seed decoders reverse the compaction applied by the seed codecs. Each decoder is a
// no-op on non-compacted data, so decodeAnySeed(...) is safe on plain or compact payloads.

// ── coaching seed (triplecrown_seed.coaching.<season>.json) ────────────────
function decodeSeed(c){
    if(!c || (c.v!==2 && c.v!==3)) return c;   // v2 = pre-production seeds, v3 = current
    const rt=c.leg.rt, ln=c.leg.ln;
    const decRoutes = rc => rc.map(([i,pct])=>[rt[i],pct]);
    const out={};
    for(const code in c.teams){
      const t=c.teams[code], slots=t.slots, names=t.names;
      const formations={}, sigOrder=[];
      for(const f of t.forms){
        const [sig,name,backs,te,wr,ol,assignsC]=f;
        sigOrder.push(sig);
        const parts=sig.split("|");
        const assigns=assignsC.map(([slot,routesC])=>{
          const pid=slots[slot];
          return {slot, name:(pid&&names[pid])||"\u2014", routes:decRoutes(routesC)};
        });
        formations[sig]={p:parts[0], align:parts[1], name, backs, te, wr, ol, assigns};
      }
      const decLanes = lc => lc.map(([i,n,epa])=>[ln[i],n,epa]);
      const decGroup = g => {
        const [fi,n,share,pass_rate,epa,succ,np,ep,sp,er,sr,lanesC]=g;
        // v3 appended production (yards/TDs). Read defensively so v2 seeds — which never
        // measured it — still decode, just with zeros.
        const py=g[12]||0, ptd=g[13]||0, ry=g[14]||0, rtd=g[15]||0;
        return {sig:sigOrder[fi], n, share, pass_rate, epa, succ,
                np, ep, sp, nr:n-np, er, sr, py, ptd, ry, rtd, lanes:decLanes(lanesC)};
      };
      const views={};
      for(const dk in t.views){ views[dk]={};
        for(const dsk in t.views[dk]){ views[dk][dsk]={};
          for(const pk in t.views[dk][dsk]){
            const node=t.views[dk][dsk][pk];
            views[dk][dsk][pk] = node==null ? null : {total:node[0], groups:node[1].map(decGroup)};
          }
        }
      }
      out[code]={team:t.team, slots, names, jerseys:t.jerseys||{}, formations, views};
    }
    return out;
  }

// ── def_weekly seed (triplecrown_seed.def_weekly.json) ─────────────────────
function decodeDefWeekly(c){
    if(!c || c.kind!=="def_weekly") return c;
    const wf=c.wf;
    const decRow = row => { if(row==null) return null;
      const o={}; for(let i=0;i<row.length;i++){ if(row[i]!=null) o[wf[i]]=row[i]; } return o; };
    const out={};
    for(const y in c.years){
      const node=c.years[y], pl={};
      for(const pname in node){
        const [name,team,pos,group,totalsC,weeksC]=node[pname];
        const p={name,team,pos,group};
        if(totalsC!=null) p.totals=decRow(totalsC);
        p.weeks=weeksC.map(decRow);
        pl[pname]=p;
      }
      out[y]=pl;
    }
    return out;
  }

// ── fantasy seed (triplecrown_seed.json) ───────────────────────────────────
function decodeFantasy(c){
    if(!c || c.__codec!=="fantasy-1") return c;
    const out={};
    for(const k in c){ if(k!=="__codec") out[k]=c[k]; }
    const hc=c.history, sf=hc.sf;
    const decStats = row => { const o={}; for(let i=0;i<row.length;i++){ if(row[i]!=null) o[sf[i]]=row[i]; } return o; };
    const hist={};
    for(const pid in hc.players){
      const [name,pos,sc]=hc.players[pid];
      const seasons={};
      for(const yr in sc){
        seasons[yr]=sc[yr].map(base=>{
          const rec={team:base[0], pos, name, games_played:base[1], games_started:base[2],
                    snap_pct:base[3], stats:decStats(base[4])};
          if(base.length>5 && base[5]) Object.assign(rec, base[5]);
          return rec;
        });
      }
      hist[pid]=seasons;
    }
    out.history=hist;
    const nc=c.nflverse, rt=nc.rt;
    const decRK = dct => { if(!dct||typeof dct!=="object") return dct;
      const o={}; for(const i in dct) o[rt[+i]]=dct[i]; return o; };
    const nv={};
    for(const yr in nc.years){
      const node=nc.years[yr], n2={};
      for(const k in node) n2[k]=node[k];
      if(node.routes && typeof node.routes==="object"){
        const r2={};
        for(const pn in node.routes){
          const rr={}; for(const k in node.routes[pn]) rr[k]=node.routes[pn][k];
          for(const kk of ["tree","route_tds","route_rec","route_yds"]) if(kk in rr) rr[kk]=decRK(rr[kk]);
          r2[pn]=rr;
        }
        n2.routes=r2;
      }
      nv[yr]=n2;
    }
    out.nflverse=nv;
    return out;
  }

// ── universal dispatcher: safe on any seed (compact or plain, any type) ─────
function decodeAnySeed(data){
  return decodeSeed(decodeDefWeekly(decodeFantasy(data)));
}

if(typeof module!=='undefined') module.exports={decodeSeed,decodeDefWeekly,decodeFantasy,decodeAnySeed};

let _nflverseLazyLoaded = { def_weekly:false, coaching_scheme:false };
let _nflverseLazyPromise = {};
const _NFLVERSE_SIDECAR_URL = {
  def_weekly: 'seeds/triplecrown_seed.def_weekly.json',
  coaching_scheme: 'seeds/triplecrown_seed.coaching.json',
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
      const data = decodeAnySeed(await res.json());
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
      const res = await fetch(`seeds/triplecrown_seed.coaching.${season}.json`, {cache:'no-store'});
      if(!res.ok) return false;
      const data = decodeAnySeed(await res.json());
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
    const dw = decodeAnySeed((typeof SEED_NFLVERSE_DEF_WEEKLY!=='undefined') ? SEED_NFLVERSE_DEF_WEEKLY : null);
    // SEED_NFLVERSE_COACHING is embedded as {season: payload}. Each season payload may itself
    // be compact-coded, so decode per season before merging into NFLVERSE.
    const rawCs = (typeof SEED_NFLVERSE_COACHING!=='undefined') ? SEED_NFLVERSE_COACHING : null;
    const cs = {};
    if(rawCs && typeof rawCs==='object'){
      for(const season of Object.keys(rawCs)){
        const dec = decodeAnySeed(rawCs[season]);
        if(dec && typeof dec==='object' && Object.keys(dec).length) cs[season] = dec;
      }
    }
    if(dw && Object.keys(dw).length){ mergeNflverseSection('def_weekly', dw); _nflverseLazyLoaded.def_weekly = true; }
    if(cs && Object.keys(cs).length){ mergeNflverseSection('coaching_scheme', cs); _nflverseLazyLoaded.coaching_scheme = true; }
  }catch(e){ /* no embedded sidecars — hosted lazy path will fetch on demand */ }
})();
