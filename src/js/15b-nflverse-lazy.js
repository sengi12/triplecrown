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
const _RB_LANES=["LE","LT","LG","MID","RG","RT","RE"];
const _RB_LANE_KEYS=["attempts","ypc","success_rate","league_ypc","ypc_diff"];
const _RB_TOT_KEYS=["attempts","yards","ypc","success_rate"];
const _QB_ZONES=(()=>{const o=[];for(const d of["deep","inter","short","behind"])for(const l of["left","middle","right"])o.push(d+"|"+l);return o;})();
const _QB_ZONE_KEYS=["rating","league_avg","attempts"];
const _QB_TOT_KEYS=["passer_rating","comp_pct","yards","td","int","attempts"];
// Rank-table decode (sharp categories + nflverse team tables share this shape).
function _decTable(cnode){
  if(!cnode || !Array.isArray(cnode.vcols)) return cnode;
  const c2={}; for(const k in cnode){ if(k!=="vcols" && k!=="teams") c2[k]=cnode[k]; }
  const vcols=cnode.vcols, teams={};
  for(const tm in cnode.teams){
    const row=cnode.teams[tm];
    const values={}, ranks={};
    for(let i=0;i<vcols.length;i++){
      if(row[0][i]!==undefined) values[vcols[i]]=row[0][i];
      if(row[1][i]!==undefined) ranks[vcols[i]]=row[1][i];
    }
    teams[tm]={values, ranks};
    if(row.length>2 && row[2]) Object.assign(teams[tm], row[2]);
  }
  c2.teams=teams;
  return c2;
}
const _keysToObj=(keys,arr)=>{const o={};for(let i=0;i<keys.length;i++){ if(arr && arr[i]!==undefined && arr[i]!==null) o[keys[i]]=arr[i]; else if(arr && arr[i]===null) o[keys[i]]=null; } return o;};

function decodeFantasy(c){
    // fantasy-1 and fantasy-2 both decode here, back to the exact in-memory shapes every
    // renderer/lookup has always seen — the codec is invisible past this function.
    // fantasy-2 adds three compactions (measured ~30% of the raw seed):
    //   players: one row per name [base_values, ref1_values, ...] against a refs list — was
    //     14 refinement tables each re-keyed by player name with identical columns arrays;
    //   routes: four index-aligned arrays against the rt intern — was four {ROUTE: n} dicts
    //     per player (null = absent, so a genuine 0 survives the round-trip);
    //   sharp: values/ranks as parallel arrays against a per-category vcols list.
    if(!c || (c.__codec!=="fantasy-1" && c.__codec!=="fantasy-2")) return c;
    const v2 = (c.__codec==="fantasy-2");
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
    const decArr = arr => { const o={}; if(!Array.isArray(arr)) return decRK(arr);
      for(let i=0;i<arr.length;i++){ if(arr[i]!=null) o[rt[i]]=arr[i]; } return o; };
    const nv={};
    for(const yr in nc.years){
      const node=nc.years[yr], n2={};
      for(const k in node) n2[k]=node[k];
      if(node.routes && typeof node.routes==="object"){
        const r2={};
        for(const pn in node.routes){
          const rec=node.routes[pn];
          if(v2 && Array.isArray(rec)){
            r2[pn]={pos:rec[0], total:rec[1], total_rec:rec[2], total_yds:rec[3], total_tds:rec[4],
                    tree:decArr(rec[5]), route_rec:decArr(rec[6]),
                    route_yds:decArr(rec[7]), route_tds:decArr(rec[8])};
          } else {
            const rr={}; for(const k in rec) rr[k]=rec[k];
            for(const kk of ["tree","route_tds","route_rec","route_yds"]) if(kk in rr) rr[kk]=decRK(rr[kk]);
            r2[pn]=rr;
          }
        }
        n2.routes=r2;
      }
      if(v2 && node.players && typeof node.players==="object"){
        const p2={};
        for(const pos in node.players){
          const blk=node.players[pos];
          if(!blk || !Array.isArray(blk.refs)){ p2[pos]=blk; continue; }
          const cols=blk.columns, refs=blk.refs;
          const basePlayers={}, refTables={};
          refs.forEach(rk=>{ refTables[rk]={columns:cols, players:{}}; });
          for(const name in blk.players){
            const row=blk.players[name];
            if(row[0]!=null) basePlayers[name]={values:row[0]};
            for(let i=0;i<refs.length;i++){
              if(row[i+1]!=null) refTables[refs[i]].players[name]={values:row[i+1]};
            }
          }
          const dec={columns:cols, players:basePlayers};
          if(refs.length) dec.refinements=refTables;
          p2[pos]=dec;
        }
        n2.players=p2;
      }
      if(v2 && node.rb_fan && node.rb_fan.players){
        const r={}, lines=node.rb_fan.__lines||{};
        for(const name in node.rb_fan.players){
          const [tm, tot, laneArr]=node.rb_fan.players[name];
          const lanes={};
          (laneArr||[]).forEach((cell,i)=>{ if(cell) lanes[_RB_LANES[i]]=_keysToObj(_RB_LANE_KEYS,cell); });
          const rec={team:tm, totals:_keysToObj(_RB_TOT_KEYS,tot), lanes};
          if(tm!=null && lines[tm]!==undefined) rec.line=lines[tm];
          r[name]=rec;
        }
        n2.rb_fan=r;
      }
      if(v2 && node.qb_passing && node.qb_passing.players){
        const q={};
        for(const name in node.qb_passing.players){
          const [tm, tot, zarr]=node.qb_passing.players[name];
          const zones={};
          (zarr||[]).forEach((cell,i)=>{
            if(!cell) return;
            const [d,l]=_QB_ZONES[i].split("|");
            (zones[d]=zones[d]||{})[l]=_keysToObj(_QB_ZONE_KEYS,cell);
          });
          q[name]={team:tm, totals:_keysToObj(_QB_TOT_KEYS,tot), zones};
        }
        n2.qb_passing=q;
      }
      if(v2 && node.team && typeof node.team==="object"){
        const t={}; for(const cat in node.team) t[cat]=_decTable(node.team[cat]);
        n2.team=t;
      }
      nv[yr]=n2;
    }
    out.nflverse=nv;
    if(v2 && out.sharp && typeof out.sharp==="object"){
      const s2={}; for(const cat in out.sharp) s2[cat]=_decTable(out.sharp[cat]);
      out.sharp=s2;
    }
    return out;
  }

// ── seed fetch: pre-gzipped twin first ──────────────────────────────────────
// build_seed writes a .json.gz next to every seed. Fetching that + DecompressionStream
// guarantees the ~5x-smaller download on ANY host (local dev servers and bare static hosts
// don't compress; CDNs compress at lighter levels). Falls back to the plain .json when the
// .gz is missing (older deploys) or DecompressionStream is unavailable (older browsers) —
// so this can never make loading WORSE, only smaller.
async function fetchSeedJson(url){
  try{
    if(typeof DecompressionStream==='function'){
      const r = await fetch(url + '.gz', {cache:'no-store'});
      if(r.ok && r.body){
        const txt = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text();
        return JSON.parse(txt);
      }
    }
  }catch(e){ /* fall through to plain */ }
  const r = await fetch(url, {cache:'no-store'});
  if(!r.ok) return null;
  return await r.json();
}

// ── universal dispatcher: safe on any seed (compact or plain, any type) ─────
function decodeAnySeed(data){
  return decodeSeed(decodeDefWeekly(decodeFantasy(data)));
}

if(typeof module!=='undefined') module.exports={decodeSeed,decodeDefWeekly,decodeFantasy,decodeAnySeed,fetchSeedJson};

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
      const raw = await fetchSeedJson(url);
      if(!raw) return false;
      const data = decodeAnySeed(raw);
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
      const raw = await fetchSeedJson(`seeds/triplecrown_seed.coaching.${season}.json`);
      if(!raw) return false;
      const data = decodeAnySeed(raw);
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
