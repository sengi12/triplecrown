// ─────────────────────────────────────────────────────────────────────────────
// Rankings
// ─────────────────────────────────────────────────────────────────────────────
// Fantasy points for one player under the CURRENT scoring settings.
//   p  = a player row from buildPlayerList() — carries pos + raw stat totals
//   sc = the live scoringSettings object (the scoring panel writes straight into it)
//   f  = the running points total
// `*_yardage` fields are yards-PER-POINT (25 = 1pt per 25 yds), which is why they divide.
function calcFpts(p){
  const sc=scoringSettings;let f=0;
  f+=(p.passing_yards||0)/sc.passing_yards_yardage*sc.passing_yards_points;
  f+=(p.passing_tds||0)*sc.passing_touchdowns;
  f+=(p.interceptions_thrown||0)*sc.interceptions_thrown;
  f+=(p.passing_attempts||0)*sc.passing_attempts;
  f+=(p.passing_completions||0)*sc.passing_completions;
  f+=(p.receiving_yards||0)/sc.receiving_yards_yardage*sc.receiving_yards_points;
  f+=(p.receiving_tds||0)*sc.receiving_touchdowns;
  // Receptions, plus the TE-premium bonus for tight ends only. Because VOR baselines derive
  // from these fpts, TEP cascades correctly: TEs score more -> they win more FLEX slots in
  // leagueStarterCounts() -> the TE replacement level rises -> TE VOR reshapes on its own.
  f+=(p.receptions||0)*(sc.receptions + (p.pos==='TE' ? (sc.receptions_te_bonus||0) : 0));
  f+=(p.rushing_yards||0)/sc.rushing_yards_yardage*sc.rushing_yards_points;
  f+=(p.rushing_tds||0)*sc.rushing_touchdowns;
  f+=(p.rushing_attempts||0)*sc.rushing_attempts;
  f+=(p.fumbles_lost||0)*sc.fumbles_lost;
  return f;
}
// ── FantasyPros ECR lookup (replaces ADP) ──
// Normalize a name to match the ECR keys built by build_seed.py.
function ecrNormName(s){
  return (s||'').toLowerCase().replace(/[.'\-]/g,'').replace(/\s+(jr|sr|ii|iii|iv|v)$/,'').replace(/\s+/g,' ').trim();
}
// Which ECR table to read for the current format. Superflex uses the half-PPR superflex
// page by default; dynasty/std/ppr/half each have their own.
function ecrTableFor(fmt){
  if(fmt==='dynasty_superflex') return ECR.dynasty_superflex || ECR.dynasty || ECR.superflex || {};
  if(fmt==='superflex') return ECR.superflex || ECR.superflex_ppr || {};
  if(fmt==='dynasty')   return ECR.dynasty || {};
  if(fmt==='std')       return ECR.std || {};
  if(fmt==='ppr')       return ECR.ppr || {};
  return ECR.half_ppr || {};  // half_ppr default
}
// Look up a player's ECR entry for the active format. Returns {rank_ecr, tier, age} or null.
function ecrEntry(p){
  const tbl=ecrTableFor(rankFormat);
  return tbl[ecrNormName(p.name)] || null;
}
function ecrFor(p){
  const e=ecrEntry(p);
  if(!(e&&e.rank_ecr!=null)) return null;
  const v = Number(e.rank_ecr);
  return Number.isFinite(v) && v>0 ? v : null;
}
function ecrTierFor(p){
  const e=ecrEntry(p);
  if(!(e&&e.tier!=null)) return null;
  const v = Number(e.tier);
  return Number.isFinite(v) && v>0 ? v : null;
}
function hasECR(){ const t=ecrTableFor(rankFormat); return t && Object.keys(t).length>0; }

// ── SumerSports advanced stats (rankings "Advanced" toggle) ──────────────────
// Reference-season only: available whenever the rankings page views a completed season the
// nflverse seed carries (every entry in `history_seasons`). Never on
// the projection season. Already fully per-season: switch the season tabs and Adv. Metrics
// follows automatically — there is no allowlist to maintain.
// The data is fully data-driven: each position table carries its own ordered `columns` +
// `pct_cols`, so the app renders whatever the seed provides (and future refinements slot in).
function sumerSeasonKey(){
  // activeSeason is 'proj' or a year string; return the year only when we have adv data for it.
  const D=advSumerData();
  if(activeSeason!=='proj') return (D && D[activeSeason]) ? String(activeSeason) : null;
  // Projection view during the season: advanced metrics are this season's, to date (the
  // live sidecar merges the current year's player tables).
  if(typeof tcIsLiveSeason==='function' && typeof TC_SEASON!=='undefined'){
    const yr=String(TC_SEASON.year);
    if(tcIsLiveSeason(yr) && D && D[yr]) return yr;
  }
  return null;
}
function sumerAvailable(){ return !!sumerSeasonKey(); }
// Columns that are percentages in the nflverse player tables (for correct formatting).
function _nflversePct(cols){
  const pct=['Scramble %','Sack %','Success %','Comp %','TFL %','Explosive %','First Down %','Catch %','Target Share'];
  return cols.filter(c=>pct.includes(c));
}
// The advanced player-stats map {season:{pos:{columns,players,pct_cols,refinements}}}.
// SumerSports was retired as a source — these are now always computed from nflverse play-by-play,
// carrying each position's situational `refinements` (with per-refinement pct_cols) through.
// Memoized by NFLVERSE identity: the adapted structure is built ONCE (not per player row per
// render), so the rankings "Adv. Metrics" view has no per-render rebuild latency. The cache
// auto-invalidates when a new seed reassigns NFLVERSE (object identity changes).
let _advSumerCache=null, _advSumerCacheSrc=null;
function advSumerData(){
  if(_advSumerCacheSrc===NFLVERSE) return _advSumerCache||{};
  _advSumerCacheSrc = NFLVERSE;
  if(!NFLVERSE){ _advSumerCache={}; return _advSumerCache; }
  const out={};
  for(const s in NFLVERSE){
    const pl=(NFLVERSE[s]&&NFLVERSE[s].players)||{};
    const tbl={};
    ['QB','RB','WR','TE'].forEach(pos=>{
      const t=pl[pos];
      if(!(t&&t.columns)) return;
      const entry={columns:t.columns, players:t.players, pct_cols:_nflversePct(t.columns)};
      if(t.refinements){
        entry.refinements={};
        for(const r in t.refinements){
          const rt=t.refinements[r];
          entry.refinements[r]={columns:rt.columns||t.columns, players:rt.players,
                                pct_cols:_nflversePct(rt.columns||t.columns)};
        }
      }
      tbl[pos]=entry;
    });
    if(Object.keys(tbl).length) out[s]=tbl;
  }
  _advSumerCache=out;
  return out;
}
// Ordered list + display labels for the "Situational" refinement dropdown (SumerSports splits).
// Order is the sequence shown in the dropdown; only the refinements a position actually tracks
// (present in its baked `refinements` map) are offered.
const SUMER_REFINE_ORDER = ["when_leading","when_trailing","red_zone","non_garbage_time",
  "1st_down","2nd_down","3rd_down","4th_down",
  "late_down","early_downs","play_action","pure_dropback","vs_man","vs_zone","blitzed","pressured",
  "zone-concepts","duo-concepts","gap-concepts",
  "light_box","7_box","stacked_box",
  "under-7-box-defenders","7-box-defenders","8-plus-box-defenders"];
const SUMER_REFINE_LABELS = {
  when_leading:"When Leading", when_trailing:"When Trailing", red_zone:"Red Zone",
  non_garbage_time:"Non-Garbage Time", late_down:"Late Downs", early_downs:"Early Downs",
  "1st_down":"1st Down", "2nd_down":"2nd Down", "3rd_down":"3rd Down", "4th_down":"4th Down",
  play_action:"Play Action", pure_dropback:"Pure Dropback", vs_man:"vs. Man",
  vs_zone:"vs. Zone", blitzed:"When Blitzed", pressured:"When Pressured",
  "zone-concepts":"Zone Concepts", "duo-concepts":"Duo Concepts", "gap-concepts":"Gap Concepts",
  light_box:"Light Box (<7)", "7_box":"7-Man Box", stacked_box:"Stacked Box (8+)",
  "under-7-box-defenders":"Light Box (<7)", "7-box-defenders":"7-Man Box", "8-plus-box-defenders":"Stacked Box (8+)",
};
// The situational refinements available for the current position filter. Single position → its
// own baked refinements; ALL/FLEX → the refinements COMMON to every position in view (so a split
// the dropdown offers is guaranteed to exist for each row's position). Ordered per SUMER_REFINE_ORDER.
function sumerRefinementsForFilter(){
  const k=sumerSeasonKey(); if(!k) return [];
  const s=advSumerData()[k]; const pos=rankPosFilter;
  const refsOf=(pp)=> (s[pp] && s[pp].refinements) ? Object.keys(s[pp].refinements) : [];
  let avail;
  if(pos==='QB'||pos==='RB'||pos==='WR'||pos==='TE'){
    avail=new Set(refsOf(pos));
  } else {
    const posList=(pos==='FLEX')?['RB','WR','TE']:['QB','RB','WR','TE'];
    const lists=posList.map(refsOf).filter(l=>l.length);
    if(!lists.length) return [];
    let common=lists[0].slice();
    for(let i=1;i<lists.length;i++) common=common.filter(x=>lists[i].includes(x));
    avail=new Set(common);
  }
  return SUMER_REFINE_ORDER.filter(r=>avail.has(r));
}
function sumerTableFor(pos){
  const k=sumerSeasonKey(); if(!k) return null;
  const s=advSumerData()[k]; const base=(s && s[pos]) ? s[pos] : null;
  if(!base) return null;
  // Situational view: swap in the selected refinement's table (its own columns/pct/players),
  // falling back to the base table when this position doesn't track the chosen split.
  if(sumerRefinement && base.refinements && base.refinements[sumerRefinement]){
    const r=base.refinements[sumerRefinement];
    return {columns:r.columns||base.columns, pct_cols:r.pct_cols||base.pct_cols,
            players:r.players, refinements:base.refinements};
  }
  return base;
}
// A player's Sumer row for the active reference season (matched by normalized name), or null.
function sumerEntry(p){
  const t=sumerTableFor(p.pos); if(!t) return null;
  return t.players[ecrNormName(p.name)] || null;
}
// The ordered stat columns to show for the current position filter. A specific position uses
// that position's columns; ALL/FLEX use the labels COMMON to every available position table
// (so mixed-position rows never render blank columns for a stat a position doesn't track).
function sumerColumnsForFilter(){
  const k=sumerSeasonKey(); if(!k) return null;
  const pos=rankPosFilter;
  if(pos==='QB'||pos==='RB'||pos==='WR'||pos==='TE'){
    const t=sumerTableFor(pos); return t ? {cols:t.columns.slice(), pct:new Set(t.pct_cols||[]), single:pos} : null;
  }
  // ALL / FLEX → intersection of columns across the positions in view (FLEX excludes QB).
  const posList = (pos==='FLEX') ? ['RB','WR','TE'] : ['QB','RB','WR','TE'];
  const tables = posList.map(pp=>sumerTableFor(pp)).filter(Boolean);
  if(!tables.length) return null;
  let common = tables[0].columns.slice();
  const pct = new Set();
  tables.forEach(t=>{ common = common.filter(c=>t.columns.includes(c)); (t.pct_cols||[]).forEach(c=>pct.add(c)); });
  if(!common.length) return null;
  return {cols:common, pct, single:null};
}
// Look up one player's value for a Sumer column label (indexes into their position's table),
// so ALL/FLEX views can read a common column from each player's own position row.
function sumerValue(p, label){
  const t=sumerTableFor(p.pos); if(!t) return null;
  const e=t.players[ecrNormName(p.name)]; if(!e) return null;
  const i=t.columns.indexOf(label); if(i<0) return null;
  const v=e.values[i];
  return (v===undefined) ? null : v;
}
// Format a Sumer value for display (numbers keep a sensible precision; % columns get a %).
function fmtSumer(v, isPct){
  if(v==null || v==='') return '—';
  if(typeof v!=='number') return v;
  let s;
  if(Number.isInteger(v)) s=v.toLocaleString();
  else s=(Math.abs(v)<1 && !isPct)? v.toFixed(2) : v.toFixed(1);
  return isPct ? s+'%' : s;
}
// Which minimum-volume bucket a position falls in (WR and TE share the "routes" bucket).
function sumerBucket(pos){ return pos==='QB' ? 'QB' : pos==='RB' ? 'RB' : 'WRTE'; }
// The Sumer column that represents "volume" for a position — the one the minimum filter reads.
// Memoised: the answer depends only on (position, active season table, refinement), yet this
// was called twice per rendered row — ~1,100 times for one Adv. Metrics render — and each call
// copied the column array and ran up to six regexes over it.
// Keyed on the nflverse payload by OBJECT IDENTITY (same trick advSumerData() uses) plus the
// active season and refinement — all three are plain comparisons, no allocation per call.
let _sumerVolColMemo = {ref:undefined, season:undefined, refine:undefined, map:null};
function sumerVolCol(pos){
  const ref    = (typeof NFLVERSE!=='undefined') ? NFLVERSE : null;
  const season = (typeof activeSeason!=='undefined') ? activeSeason : '';
  const refine = (typeof sumerRefinement!=='undefined') ? (sumerRefinement||'') : '';
  const m = _sumerVolColMemo;
  if(m.ref!==ref || m.season!==season || m.refine!==refine || !m.map){
    _sumerVolColMemo = {ref, season, refine, map:new Map()};
  }
  const cache = _sumerVolColMemo.map;
  if(cache.has(pos)) return cache.get(pos);
  const v = _sumerVolColCompute(pos);
  cache.set(pos, v);
  return v;
}
function _sumerVolColCompute(pos){
  const t=sumerTableFor(pos);
  const cols=(t && Array.isArray(t.columns)) ? t.columns.slice() : [];
  const pick=(rx)=>cols.find(c=>rx.test(String(c||'').toLowerCase()) && !/\//.test(String(c||''))) || null;
  const fallback = pos==='QB' ? 'Plays' : (pos==='RB' ? 'Rushes' : 'Routes Run');
  if(!cols.length) return fallback;
  if(pos==='QB'){
    return pick(/\bplays?\b/) || pick(/\bdropbacks?\b/) || pick(/\battempts?\b/) || fallback;
  }
  if(pos==='RB'){
    return pick(/\brush(?:es| attempts?)\b/) || pick(/\bcarries?\b/) || fallback;
  }
  return pick(/\broutes?(?: run)?\b/) || pick(/\btargets?\b/) || fallback;
}

// ── OverTheCap contract lookup (Dynasty tab only: Age / APY / Free-Agency year) ──
// Reuses the same name-normalization as ECR so the keys line up with build_seed.py.
function contractEntry(p){ return CONTRACTS[ecrNormName(p.name)] || null; }

// Rankings age source should match player cards: Sleeper player metadata first.
// Falls back to base-seed age, then contract age if neither is available.
function rankingAgeFromSleeper(p, baseEntry){
  let pid = p && p.player_id ? String(p.player_id) : '';
  if(!pid && typeof resolvePlayerId==='function'){
    pid = resolvePlayerId(p.name, p.pos) || resolvePlayerId(p.name) || '';
  }
  const sp = (pid && typeof sleeperPlayers!=='undefined' && sleeperPlayers)
    ? sleeperPlayers[pid]
    : null;
  if(sp && sp.age!=null && !Number.isNaN(Number(sp.age))) return Number(sp.age);
  if(baseEntry && baseEntry.age!=null && !Number.isNaN(Number(baseEntry.age))) return Number(baseEntry.age);
  const c = contractEntry(p);
  if(c && c.age!=null && !Number.isNaN(Number(c.age))) return Number(c.age);
  return null;
}

function rankingYearsExpFromSleeper(p, baseEntry){
  let pid = p && p.player_id ? String(p.player_id) : '';
  if(!pid && typeof resolvePlayerId==='function'){
    pid = resolvePlayerId(p.name, p.pos) || resolvePlayerId(p.name) || '';
  }
  const sp = (pid && typeof sleeperPlayers!=='undefined' && sleeperPlayers)
    ? sleeperPlayers[pid]
    : null;
  if(sp && sp.years_exp!=null && !Number.isNaN(Number(sp.years_exp))) return (typeof tcYearsExpFor==='function') ? tcYearsExpFor(sp) : Number(sp.years_exp);
  if(baseEntry && baseEntry.years_exp!=null && !Number.isNaN(Number(baseEntry.years_exp))) return Number(baseEntry.years_exp);
  return null;
}

function rankingIsRookieForSeason(p, season){
  if(!p) return false;
  const exp = Number(p.years_exp);
  const hasExp = Number.isFinite(exp) && exp>=0;
  if(String(season||'')==='proj') return hasExp ? exp===0 : !!(p.is_rookie===true);
  const yr = Number(season);
  const cur = Number(PROJ_SEASON);
  if(hasExp && Number.isFinite(yr) && Number.isFinite(cur)) return (cur - exp)===yr;
  return hasExp ? exp===0 : !!(p.is_rookie===true);
}

function hasContracts(){ return CONTRACTS && Object.keys(CONTRACTS).length>0; }
// Format an APY (annual salary in dollars) compactly, e.g. 40250000 → "$40.3M".
function fmtAPY(v){
  if(v==null || isNaN(v)) return '';
  if(v>=1e6) return '$'+(v/1e6).toFixed(1).replace(/\.0$/,'')+'M';
  if(v>=1e3) return '$'+Math.round(v/1e3)+'K';
  return '$'+v;
}
// A compact contract band for the top of a player card, built from the baked OverTheCap data
// (already loaded in CONTRACTS — no network). Shows APY, derived length, total value, guaranteed
// and free-agency year. Returns '' when we have no contract for the player (rendered nowhere).
function contractSummaryHTML(name){
  if(!hasContracts() || !name) return '';
  const c = CONTRACTS[ecrNormName(name)];
  if(!c || (c.apy==null && c.total==null && c.fa==null)) return '';
  const parts=[];
  if(c.apy!=null) parts.push(`<span><b>${fmtAPY(c.apy)}</b><span class="muted">/yr</span></span>`);
  const sub=[];
  const yrs = (c.total!=null && c.apy>0) ? Math.round(c.total/c.apy) : null;
  if(yrs) sub.push(`${yrs} yr${yrs===1?'':'s'}`);
  if(c.total!=null) sub.push(`${fmtAPY(c.total)} total`);
  if(sub.length) parts.push(`<span class="muted">${sub.join(' · ')}</span>`);
  if(c.gtd!=null) parts.push(`<span class="muted">${fmtAPY(c.gtd)} gtd</span>`);
  if(c.fa!=null) parts.push(`<span class="pcard-ct-fa">FA <b>${c.fa}</b></span>`);
  return `<div class="pcard-contract"><span class="pcard-contract-lbl">CONTRACT</span>${parts.join('')}</div>`;
}

// ── KeepTradeCut dynasty link (player card) ──────────────────────────────────
// KTC (keeptradecut.com) crowd-sources dynasty trade values. The seed bakes a {nameKey:{slug,pos}}
// map, so we can deep-link a player straight to their KTC page. Position-guarded so a same-named
// player on the other side of the ball doesn't borrow a skill player's link. Returns null on miss.
function ktcEntry(name, pos){
  if(!KTC || !name) return null;
  const e = KTC[ecrNormName(name)];
  if(!e || !e.slug) return null;
  if(pos && e.pos && e.pos!==pos) return null;   // position mismatch → not the same player
  return e;
}
// A small KTC icon link for the player-card hero (bottom-right). Opens the player's KTC dynasty
// page in a new tab. Returns '' when we have no KTC slug for them (so nothing renders).
function ktcLinkHTML(name, pos){
  const e = ktcEntry(name, pos);
  if(!e) return '';
  const url = `https://keeptradecut.com/dynasty-rankings/players/${e.slug}`;
  return `<a class="pcard-ktc" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="View ${name} on KeepTradeCut (opens in a new tab)" title="View on KeepTradeCut — dynasty trade value"><img src="${KTC_ICON}" class="pcard-ktc-img" alt="KeepTradeCut"></a>`;
}

let _buildPlayerCache = {
  userProjRef: null,
  activeSeason: null,
  rankFormat: null,
  scoringSig: '',
  list: null,
};
let _buildPlayerCacheEpoch = 0;

function buildPlayerScoringSig(){
  const sc = scoringSettings || {};
  return [
    sc.passing_yards_points, sc.passing_yards_yardage,
    sc.passing_touchdowns, sc.interceptions_thrown,
    sc.passing_attempts, sc.passing_completions,
    sc.receiving_yards_points, sc.receiving_yards_yardage,
    sc.receiving_touchdowns, sc.receptions, sc.receptions_te_bonus,
    sc.rushing_yards_points, sc.rushing_yards_yardage,
    sc.rushing_touchdowns, sc.rushing_attempts,
    sc.fumbles_lost,
  ].join('|');
}

function invalidateBuildPlayerCache(){
  if(typeof TC_DEV_MODE!=='undefined' && TC_DEV_MODE)
    try{ console.debug('[buildPlayerList] cache invalidated (epoch→'+(_buildPlayerCacheEpoch+1)+')'); }catch(_e){}
  _buildPlayerCache.userProjRef = null;
  _buildPlayerCache.activeSeason = null;
  _buildPlayerCache.rankFormat = null;
  _buildPlayerCache.scoringSig = '';
  _buildPlayerCache.list = null;
  _buildPlayerCacheEpoch++;
  if(typeof invalidateRankingsRenderCache==='function') invalidateRankingsRenderCache();
}

// Everything VOR depends on besides scoring: the league's roster shape (a synced league,
// a followed draft) and the ADP refresh. None of these were in the cache key, so linking a
// 10-team 3-WR league with the same scoring as before returned the 12-team 2-WR VOR.
function buildPlayerShapeSig(){
  try{
    const sc = (typeof leagueStarterCounts==='function') ? leagueStarterCounts() : null;
    return JSON.stringify([sc, (typeof draftId!=='undefined')?draftId:null,
      (typeof _adpRefreshEpoch!=='undefined')?_adpRefreshEpoch:0]);
  }catch(e){ return ''; }
}

function buildPlayerList(){
  const scoringSig = buildPlayerScoringSig();
  const shapeSig = buildPlayerShapeSig();
  const cacheHit = (_buildPlayerCache.list
    && _buildPlayerCache.userProjRef===userProj
    && _buildPlayerCache.activeSeason===activeSeason
    && _buildPlayerCache.rankFormat===rankFormat
    && _buildPlayerCache.scoringSig===scoringSig
    && _buildPlayerCache.shapeSig===shapeSig);
  if(cacheHit){
    if(typeof TC_DEV_MODE!=='undefined' && TC_DEV_MODE)
      try{ console.debug('[buildPlayerList] cache hit ('+_buildPlayerCache.list.length+' players, epoch='+_buildPlayerCacheEpoch+')'); }catch(_e){}
    // Return detached rows so callers can sort/annotate without mutating the cache.
    return _buildPlayerCache.list.map(p=>Object.assign({}, p));
  }

  const list=[];
  // Index of list position by `team|name`. The receiving and rushing passes below need to know
  // whether a player is already in the list, and used to answer that with list.findIndex() —
  // a linear scan of a list that grows as they run, i.e. roughly n^2 string comparisons over
  // ~500 shares. It is survivable at today's ~560 players and gets worse as the pool grows
  // (mergeRosterPlayers already pushes it higher).
  const listIdx = new Map();
  const _lk = (team, name)=>team+'|'+name;
  const pushPlayer = (obj)=>{ listIdx.set(_lk(obj.team, obj.name), list.length); list.push(obj); };
  const findPlayer = (team, name)=>{ const i=listIdx.get(_lk(team,name)); return i==null ? -1 : i; };
  // Per-team lookup of a player's base seed row, built once per team instead of re-spreading
  // four position arrays into a fresh array on every single lookup.
  const _baseByTeam = new Map();
  const teamBaseIndex = (team)=>{
    let idx = _baseByTeam.get(team);
    if(!idx){
      idx = {byName:new Map(), byId:new Map()};
      ['QB','RB','WR','TE'].forEach(pos=>{
        (getBase(team,pos)||[]).forEach(x=>{
          if(x && x.name!=null && !idx.byName.has(x.name)) idx.byName.set(x.name, x);
          if(x && x.player_id!=null && !idx.byId.has(x.player_id)) idx.byId.set(x.player_id, x);
        });
      });
      _baseByTeam.set(team, idx);
    }
    return idx;
  };
  // Auto-populate: make sure every team with seed data is initialized so all players
  // appear in the rankings without the user opening each team first.
  TEAMS.forEach(team=>{
    if(!userProj[team] && SEED[team] &&
       (SEED[team].QB.length||SEED[team].RB.length||SEED[team].WR.length||SEED[team].TE.length)){
      ensureTeam(team);
      // Materialised for the rankings math — NOT opened by the user. Without this mark the
      // sidebar's "opened, untouched" dot lit up all 32 teams the moment anything computed
      // fantasy points (opening one team does, via its per-row point tags).
      if(userProj[team]) userProj[team]._auto = true;
    }
  });
  TEAMS.forEach(team=>{
    const state=userProj[team]; if(!state) return;
    // Ensure receiver/rusher shares exist so every player auto-populates in the rankings.
    if(!state.passing_shares) initPassingShares(team);
    if(!state.rushing||!state.rushing.shares) initRushingShares(team);
    const totalTgts=teamTargetPool(state);
    const totalPassTDs=teamPassTDs(state);
    state.qbs.forEach(qb=>{
      pushPlayer({name:qb.name,team,pos:'QB',headshot:qb.headshot,slug:qb.slug,player_id:qb.player_id||null,
        passing_yards:qb.passing_yards,passing_tds:qb.passing_tds,passing_attempts:qb.passing_attempts,
        passing_completions:qb.passing_completions,interceptions_thrown:qb.interceptions_thrown,
        rushing_yards:qb.qb_rush_yards,rushing_tds:qb.qb_rush_tds,rushing_attempts:qb.qb_rush_attempts,
        receiving_yards:0,receiving_tds:0,receptions:0,receiving_targets:0,fumbles_lost:0,
        proj_games:(qb.games!=null?Number(qb.games):null)});
    });
    // Roster fills (camp bodies merged in from the Sleeper DB so they're selectable) stay off
    // the board until they're given a share. Before this, whether a team's ~9 zero-point
    // WR/TEs showed up depended on whether its state was built before or after the player DB
    // loaded — 564 players at boot, 841 after a reset/import — which looked like the pool
    // "changing on its own".
    const untouchedFill = p => !!p.fill && !(p.share>0) && !(p.td_share>0);
    if(state.passing_shares){
      state.passing_shares.forEach(p=>{
        if(untouchedFill(p) && findPlayer(team,p.name)<0) return;
        const projTgts=Math.round(p.share*totalTgts);
        const projRec=Math.round(projTgts*(p.catch_rate||0.65));
        const projYds=Math.round(projTgts*(p.ypt||9));
        const projTDs=parseFloat((p.td_share*totalPassTDs).toFixed(1));
        const bp=teamBaseIndex(team).byName.get(p.name)||{};
        const ex=findPlayer(team,p.name);
        if(ex>=0){list[ex].receiving_yards=projYds;list[ex].receiving_tds=projTDs;list[ex].receptions=projRec;list[ex].receiving_targets=projTgts;
          if(p.player_id&&!list[ex].player_id)list[ex].player_id=p.player_id;}
        else pushPlayer({name:p.name,team,pos:p.pos,headshot:p.headshot,slug:p.slug,player_id:p.player_id||null,
          passing_yards:0,passing_tds:0,passing_attempts:0,passing_completions:0,interceptions_thrown:0,
          rushing_yards:bp.rushing_yards||0,rushing_tds:bp.rushing_tds||bp.rushing_touchdowns||0,rushing_attempts:bp.rushing_attempts||0,
          receiving_yards:projYds,receiving_tds:projTDs,receptions:projRec,receiving_targets:projTgts,fumbles_lost:0});
      });
    }
    if(state.rushing.shares){
      const r=state.rushing;
      const totalRushTDs=teamRushTDs(state);
      r.shares.forEach(p=>{
        if(untouchedFill(p) && findPlayer(team,p.name)<0) return;
        const att=Math.round(p.share*r.total_attempts);
        const yds=Math.round(att*(p.ypc||r.ypa||4));
        const tds=parseFloat((p.td_share*totalRushTDs).toFixed(1));
        const ex=findPlayer(team,p.name);
        if(ex>=0){list[ex].rushing_yards=yds;list[ex].rushing_tds=tds;list[ex].rushing_attempts=att;
          if(p.player_id&&!list[ex].player_id)list[ex].player_id=p.player_id;}
        else{
          pushPlayer({name:p.name,team,pos:'RB',headshot:p.headshot,slug:p.slug,player_id:p.player_id||null,
            passing_yards:0,passing_tds:0,passing_attempts:0,passing_completions:0,interceptions_thrown:0,
            rushing_yards:yds,rushing_tds:tds,rushing_attempts:att,
            receiving_yards:0,receiving_tds:0,receptions:0,receiving_targets:0,fumbles_lost:0});}
      });
    }
  });
  // Fantasy points + ECR rank/tier + YPC + (dynasty) contract age/APY/FA for each player.
  list.forEach(p=>{
    p.fpts=calcFpts(p);
    p.ecr=ecrFor(p);
    p.ecr_tier=ecrTierFor(p);
    p.ypc = (p.rushing_attempts>0) ? p.rushing_yards/p.rushing_attempts : 0;
    // Attach ADP (all formats) from the base seed entry so VONA can model who others draft.
    const be = basePlayerEntryIdx(teamBaseIndex(p.team), p.name, p.player_id);
    p.adp = be && be.adp!=null ? be.adp : 999;
    // TC model projection rides on the projection-seed entry; null for rookies and in
    // reference seasons (whose seed rows never carry a tc block) — the column hides there.
    // The column shows a SEASON total in the league's scoring so it reads next to FPTS:
    // the model's opinion is a ratio vs the Sleeper baseline (both PPR/G), applied to this
    // player's league-scored fpts. Deep-bench baselines (<5 PPR/G) bake in playing time the
    // model doesn't predict, so the ratio is meaningless there — fall back to the model's
    // 17-game PPR pace. Ratio clamped: the model's edge is an adjustment, not a rewrite.
    const _tc = be && be.tc;
    p.tcFpg = (_tc && _tc.fpg!=null) ? _tc.fpg : null;
    if(p.tcFpg==null) p.tcPts = null;
    else if(_tc.base!=null && _tc.base>=5 && p.fpts>0)
      p.tcPts = p.fpts * Math.min(2, Math.max(0.25, _tc.fpg/_tc.base));
    else p.tcPts = p.tcFpg*17;
    p.adp_ppr = be && be.adp_ppr!=null ? be.adp_ppr : 999;
    p.adp_half_ppr = be && be.adp_half_ppr!=null ? be.adp_half_ppr : 999;
    p.adp_std = be && be.adp_std!=null ? be.adp_std : 999;
    p.adp_2qb = be && be.adp_2qb!=null ? be.adp_2qb : 999;
    const c=contractEntry(p);
    p.age = rankingAgeFromSleeper(p, be);
    p.years_exp = rankingYearsExpFromSleeper(p, be);
    p.is_rookie = (p.years_exp===0);
    p.apy = c && c.apy!=null ? c.apy : null;
    p.fa  = c && c.fa!=null ? c.fa : null;
  });
  computeVOR(list);   // scarcity-aware value over replacement (last-starter baseline)
  _buildPlayerCache.userProjRef = userProj;
  _buildPlayerCache.activeSeason = activeSeason;
  _buildPlayerCache.rankFormat = rankFormat;
  _buildPlayerCache.scoringSig = scoringSig;
  _buildPlayerCache.shapeSig = shapeSig;
  _buildPlayerCache.list = list.map(p=>Object.assign({}, p));
  if(typeof TC_DEV_MODE!=='undefined' && TC_DEV_MODE)
    try{ console.debug('[buildPlayerList] rebuilt '+list.length+' players (epoch='+_buildPlayerCacheEpoch+', season='+activeSeason+', fmt='+rankFormat+')'); }catch(_e){}
  return list;
}
// Find a player's base seed entry (for ADP etc.) by id first, then name+team.
// Kept for any external caller; buildPlayerList uses the prebuilt per-team index instead of
// re-spreading four arrays per player.
function basePlayerEntry(team, pos, name, pid){
  const pool=[...getBase(team,'QB'),...getBase(team,'RB'),...getBase(team,'WR'),...getBase(team,'TE')];
  if(pid){ const byId=pool.find(x=>x.player_id===pid); if(byId) return byId; }
  return pool.find(x=>x.name===name) || null;
}
function basePlayerEntryIdx(idx, name, pid){
  if(!idx) return null;
  if(pid!=null){ const byId=idx.byId.get(pid); if(byId) return byId; }
  return idx.byName.get(name) || null;
}
// Return the ADP value appropriate to the active scoring format (used for VONA's "who will
// be drafted before my next pick" model). Superflex/2QB formats boost QBs, so use adp_2qb;
// PPR/half/standard pick the matching column; falls back to the generic adp.
function adpFor(p){
  const f=rankFormat;
  let v;
  if(f==='superflex'||f==='dynasty_superflex') v=p.adp_2qb;
  else if(f==='ppr') v=p.adp_ppr;
  else if(f==='half_ppr') v=p.adp_half_ppr;
  else if(f==='std') v=(p.adp_std!=null && p.adp_std<999) ? p.adp_std : p.adp;   // `adp` is the PPR board
  else v=p.adp_ppr;   // dynasty (non-SF) → ppr board as the closest proxy
  if(v==null||v>=999){ v=p.adp_ppr!=null&&p.adp_ppr<999?p.adp_ppr:(p.adp!=null&&p.adp<999?p.adp:999); }
  return v;
}
// ── Value Over Replacement (VOR) ────────────────────────────────────────────
// Rank players by points ABOVE a replacement-level player at their position, rather than by
// raw points — which is what makes scoring settings and league shape matter realistically
// (an elite RB's edge over a waiver RB is bigger than an elite QB's edge over a waiver QB).
//
// Replacement level = the "last starter" at each position across the whole league, derived
// from the actual roster shape: starters at each position PLUS the share of FLEX/superflex
// demand that lands on that position given YOUR projections. We simulate filling every team's
// starting lineup from the projection pool (best-first), and the last player consumed at each
// position sets that position's baseline. Everything is scoring-independent because it all
// flows from each player's fpts under the current scoring.
function leagueStarterCounts(){
  // Per-position starter demand across the league, in priority order:
  //   1. a LIVE linked draft's lineup (most authoritative — it's the actual draft)
  //   2. the linked LEAGUE's roster_positions, which we now keep even when its draft is
  //      COMPLETE. This is the case that used to silently fall through to a generic
  //      12-team/2-WR board, so a 3-WR league's WR baseline sat at ~WR24 instead of ~WR36.
  //   3. no league at all → a standard 12-team lineup shaped by the current rankFormat, so
  //      flipping the format dropdown to Superflex still moves QB scarcity.
  let lineup=null, teams=null;
  if(draftId && draftLineup && draftLineup.length){
    lineup = draftLineup;
    teams  = (draftMeta && draftMeta.settings && draftMeta.settings.teams)
             || (leagueShape && leagueShape.teams) || 12;
  } else if(leagueShape && leagueShape.lineup && leagueShape.lineup.length){
    lineup = leagueShape.lineup;
    teams  = leagueShape.teams || 12;
  }
  const base = { QB:1, RB:2, WR:2, TE:1 };
  let flex=0, superflex=0;
  // Flex demand PER TYPE: a WRRB or REC flex must never hand its demand to an ineligible
  // position (folding them into generic FLEX let RBs absorb a WR/TE-only slot's demand,
  // deflating the WR/TE baselines in exactly the leagues built around that restriction).
  let flexTypes={FLEX:0, WRRB_FLEX:0, REC_FLEX:0};
  if(lineup){
    const c={QB:0,RB:0,WR:0,TE:0,FLEX:0,WRRB_FLEX:0,REC_FLEX:0,SUPER_FLEX:0};
    lineup.forEach(s=>{ if(c[s]!=null) c[s]++; });
    // Use the REAL counts. A zero is meaningful (e.g. a superflex-only lineup with no
    // dedicated QB slot) — the old `c.QB||1` defaults masked that.
    base.QB=c.QB; base.RB=c.RB; base.WR=c.WR; base.TE=c.TE;
    flexTypes={FLEX:c.FLEX, WRRB_FLEX:c.WRRB_FLEX, REC_FLEX:c.REC_FLEX};
    flex=c.FLEX+c.WRRB_FLEX+c.REC_FLEX; superflex=c.SUPER_FLEX;
  } else {
    teams = 12;
    flex  = 1;
    flexTypes={FLEX:1, WRRB_FLEX:0, REC_FLEX:0};
    if(rankFormat==='superflex' || rankFormat==='dynasty_superflex') superflex=1;
  }
  return { teams: teams||12, base, flex, flexTypes, superflex };
}
function computeVOR(list){
  if(!list||!list.length) return;
  const { teams, base, flexTypes, superflex } = leagueStarterCounts();
  // Pools sorted by projected points (best first) per position.
  const byPos={QB:[],RB:[],WR:[],TE:[]};
  list.forEach(p=>{ if(byPos[p.pos]) byPos[p.pos].push(p); });
  Object.keys(byPos).forEach(k=>byPos[k].sort((a,b)=>b.fpts-a.fpts));
  // Fill dedicated starter slots first.
  const used={QB:base.QB*teams, RB:base.RB*teams, WR:base.WR*teams, TE:base.TE*teams};
  // FLEX demand: consume the best remaining player among the positions ELIGIBLE for each
  // flex type. Restricted types run first so the generic flex absorbs whatever's left.
  const flexIdx={RB:used.RB, WR:used.WR, TE:used.TE};
  [['WRRB_FLEX',['RB','WR']], ['REC_FLEX',['WR','TE']], ['FLEX',['RB','WR','TE']]].forEach(([ft, eligible])=>{
    let flexLeft=((flexTypes&&flexTypes[ft])||0)*teams;
    while(flexLeft>0){
      // pick the position whose NEXT available player has the highest fpts
      let bestPos=null, bestVal=-Infinity;
      eligible.forEach(pos=>{
        const nx=byPos[pos][flexIdx[pos]];
        if(nx && nx.fpts>bestVal){ bestVal=nx.fpts; bestPos=pos; }
      });
      if(!bestPos) break;
      flexIdx[bestPos]++; used[bestPos]++; flexLeft--;
    }
  });
  // SUPERFLEX demand (QB/RB/WR/TE): usually consumed by QBs.
  let sfLeft=superflex*teams;
  const sfIdx={QB:used.QB, RB:used.RB, WR:used.WR, TE:used.TE};
  while(sfLeft>0){
    let bestPos=null, bestVal=-Infinity;
    ['QB','RB','WR','TE'].forEach(pos=>{
      const nx=byPos[pos][sfIdx[pos]];
      if(nx && nx.fpts>bestVal){ bestVal=nx.fpts; bestPos=pos; }
    });
    if(!bestPos) break;
    sfIdx[bestPos]++; used[bestPos]++; sfLeft--;
  }

  // Superflex QB replacement floor: 2.3 QBs per team.
  if(superflex>0){
    const qbFloor = Math.ceil(teams * 2.3);
    used.QB = Math.max(used.QB, qbFloor);
  }

  // Replacement baseline per position = fpts of the LAST starter consumed (index used-1),
  // clamped to the pool. Store both the baseline and each player's VOR.
  const baseline={};
  ['QB','RB','WR','TE'].forEach(pos=>{
    const pool=byPos[pos];
    if(!pool.length){ baseline[pos]=0; return; }
    const idx=Math.min(Math.max(used[pos]-1,0), pool.length-1);
    baseline[pos]=pool[idx].fpts;
  });
  VOR_BASELINE=baseline;
  list.forEach(p=>{ p.vor = (baseline[p.pos]!=null) ? +(p.fpts-baseline[p.pos]).toFixed(1) : 0; });
}

// ── Generic display utils (used app-wide) ───────────────────────────────────
// Full team name for team pages (e.g. "Cincinnati Bengals"); falls back to the code.
function teamDisplayName(code){ return (TEAM_NAMES && TEAM_NAMES[code]) || code; }
// 1 → "1st", 2 → "2nd", 22 → "22nd", etc. The single ordinal helper for the whole app
// (the League Analyzer's positional ranks call this too).
function ordinal(n){
  if(n==null) return '';
  const s=n%100;
  const suff=(s>=11&&s<=13)?'th':(n%10===1)?'st':(n%10===2)?'nd':(n%10===3)?'rd':'th';
  return n+suff;
}
// NOTE: the Advanced Stats (nflverse "Sharp") data helpers — sharpHasData / advTeamSeason /
// nflverseSharpTables / activeSharp / sharpRankClass / sharpRankBadge / fmtSharpVal /
// sharpColIsPct — live with their renderers in 76-sharp-sos.js.

// ── Roster Changes (Spotrac offseason: free agency, draft, trades, losses) ──
// Read-only per-team view tying prior-season weaknesses to how the team addressed them.
