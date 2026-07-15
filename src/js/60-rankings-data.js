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
function ecrFor(p){ const e=ecrEntry(p); return e&&e.rank_ecr!=null ? e.rank_ecr : null; }
function ecrTierFor(p){ const e=ecrEntry(p); return e&&e.tier!=null ? e.tier : null; }
function hasECR(){ const t=ecrTableFor(rankFormat); return t && Object.keys(t).length>0; }

// ── SumerSports advanced stats (rankings "Advanced" toggle) ──────────────────
// Reference-season only: available whenever the rankings page views a completed season the
// nflverse seed carries (currently 2021-2025 = every entry in `history_seasons`). Never on
// the projection season. Already fully per-season: switch the season tabs and Adv. Metrics
// follows automatically — there is no allowlist to maintain.
// The data is fully data-driven: each position table carries its own ordered `columns` +
// `pct_cols`, so the app renders whatever the seed provides (and future refinements slot in).
function sumerSeasonKey(){
  // activeSeason is 'proj' or a year string; return the year only when we have adv data for it.
  const D=advSumerData();
  return (activeSeason!=='proj' && D && D[activeSeason]) ? String(activeSeason) : null;
}
function sumerAvailable(){ return !!sumerSeasonKey(); }
// Does the nflverse A/B source have data for a season?
function nflverseHasSeason(season){ return !!(NFLVERSE && NFLVERSE[String(season)]); }
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
// Switch the advanced-stats data source and re-render whichever advanced view is open.
function setAdvSource(src){
  // Advanced Stats source switching was removed; keep this for backward-compat calls.
  if(src!=='nflverse') return;
  if(advSource==='nflverse') return;
  advSource='nflverse';
  sharpTable=null; sharpSortCol=null;
  if(currentPhase==='AdvancedLeague' && typeof renderSharpLeague==='function') renderSharpLeague();
  else if(currentPhase==='Advanced' && typeof renderContent==='function') renderContent();
  else if(currentPhase==='Rankings') renderRankings();
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
function sumerVolCol(pos){ return pos==='QB' ? 'Plays' : pos==='RB' ? 'Rushes' : 'Routes Run'; }

// ── OverTheCap contract lookup (Dynasty tab only: Age / APY / Free-Agency year) ──
// Reuses the same name-normalization as ECR so the keys line up with build_seed.py.
function contractEntry(p){ return CONTRACTS[ecrNormName(p.name)] || null; }
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

function buildPlayerList(){
  const list=[];
  // Auto-populate: make sure every team with seed data is initialized so all players
  // appear in the rankings without the user opening each team first.
  TEAMS.forEach(team=>{
    if(!userProj[team] && SEED[team] &&
       (SEED[team].QB.length||SEED[team].RB.length||SEED[team].WR.length||SEED[team].TE.length)){
      ensureTeam(team);
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
      list.push({name:qb.name,team,pos:'QB',headshot:qb.headshot,slug:qb.slug,player_id:qb.player_id||null,
        passing_yards:qb.passing_yards,passing_tds:qb.passing_tds,passing_attempts:qb.passing_attempts,
        passing_completions:qb.passing_completions,interceptions_thrown:qb.interceptions_thrown,
        rushing_yards:qb.qb_rush_yards,rushing_tds:qb.qb_rush_tds,rushing_attempts:qb.qb_rush_attempts,
        receiving_yards:0,receiving_tds:0,receptions:0,receiving_targets:0,fumbles_lost:0});
    });
    if(state.passing_shares){
      state.passing_shares.forEach(p=>{
        const projTgts=Math.round(p.share*totalTgts);
        const projRec=Math.round(projTgts*(p.catch_rate||0.65));
        const projYds=Math.round(projTgts*(p.ypt||9));
        const projTDs=parseFloat((p.td_share*totalPassTDs).toFixed(1));
        const bp=[...getBase(team,'WR'),...getBase(team,'TE'),...getBase(team,'RB')].find(x=>x.name===p.name)||{};
        const ex=list.findIndex(x=>x.name===p.name&&x.team===team);
        if(ex>=0){list[ex].receiving_yards=projYds;list[ex].receiving_tds=projTDs;list[ex].receptions=projRec;list[ex].receiving_targets=projTgts;
          if(p.player_id&&!list[ex].player_id)list[ex].player_id=p.player_id;}
        else list.push({name:p.name,team,pos:p.pos,headshot:p.headshot,slug:p.slug,player_id:p.player_id||null,
          passing_yards:0,passing_tds:0,passing_attempts:0,passing_completions:0,interceptions_thrown:0,
          rushing_yards:bp.rushing_yards||0,rushing_tds:0,rushing_attempts:bp.rushing_attempts||0,
          receiving_yards:projYds,receiving_tds:projTDs,receptions:projRec,receiving_targets:projTgts,fumbles_lost:0});
      });
    }
    if(state.rushing.shares){
      const r=state.rushing;
      const totalRushTDs=teamRushTDs(state);
      r.shares.forEach(p=>{
        const att=Math.round(p.share*r.total_attempts);
        const yds=Math.round(att*(p.ypc||r.ypa||4));
        const tds=parseFloat((p.td_share*totalRushTDs).toFixed(1));
        const ex=list.findIndex(x=>x.name===p.name&&x.team===team);
        if(ex>=0){list[ex].rushing_yards=yds;list[ex].rushing_tds=tds;list[ex].rushing_attempts=att;
          if(p.player_id&&!list[ex].player_id)list[ex].player_id=p.player_id;}
        else{
          list.push({name:p.name,team,pos:'RB',headshot:p.headshot,slug:p.slug,player_id:p.player_id||null,
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
    const be = basePlayerEntry(p.team, p.pos, p.name, p.player_id);
    p.adp = be && be.adp!=null ? be.adp : 999;
    p.adp_ppr = be && be.adp_ppr!=null ? be.adp_ppr : 999;
    p.adp_half_ppr = be && be.adp_half_ppr!=null ? be.adp_half_ppr : 999;
    p.adp_2qb = be && be.adp_2qb!=null ? be.adp_2qb : 999;
    const c=contractEntry(p);
    p.age = c && c.age!=null ? c.age : null;
    p.apy = c && c.apy!=null ? c.apy : null;
    p.fa  = c && c.fa!=null ? c.fa : null;
  });
  computeVOR(list);   // scarcity-aware value over replacement (last-starter baseline)
  return list;
}
// Find a player's base seed entry (for ADP etc.) by id first, then name+team.
function basePlayerEntry(team, pos, name, pid){
  const pool=[...getBase(team,'QB'),...getBase(team,'RB'),...getBase(team,'WR'),...getBase(team,'TE')];
  if(pid){ const byId=pool.find(x=>x.player_id===pid); if(byId) return byId; }
  return pool.find(x=>x.name===name) || null;
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
  else if(f==='std') v=p.adp;
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
  if(lineup){
    const c={QB:0,RB:0,WR:0,TE:0,FLEX:0,SUPER_FLEX:0};
    lineup.forEach(s=>{ if(c[s]!=null) c[s]++; else if(s==='WRRB_FLEX'||s==='REC_FLEX') c.FLEX++; });
    // Use the REAL counts. A zero is meaningful (e.g. a superflex-only lineup with no
    // dedicated QB slot) — the old `c.QB||1` defaults masked that.
    base.QB=c.QB; base.RB=c.RB; base.WR=c.WR; base.TE=c.TE;
    flex=c.FLEX; superflex=c.SUPER_FLEX;
  } else {
    teams = 12;
    flex  = 1;
    if(rankFormat==='superflex' || rankFormat==='dynasty_superflex') superflex=1;
  }
  return { teams: teams||12, base, flex, superflex };
}
function computeVOR(list){
  if(!list||!list.length) return;
  const { teams, base, flex, superflex } = leagueStarterCounts();
  // Pools sorted by projected points (best first) per position.
  const byPos={QB:[],RB:[],WR:[],TE:[]};
  list.forEach(p=>{ if(byPos[p.pos]) byPos[p.pos].push(p); });
  Object.keys(byPos).forEach(k=>byPos[k].sort((a,b)=>b.fpts-a.fpts));
  // Fill dedicated starter slots first.
  const used={QB:base.QB*teams, RB:base.RB*teams, WR:base.WR*teams, TE:base.TE*teams};
  // FLEX demand (RB/WR/TE): consume best remaining across those positions.
  let flexLeft=flex*teams;
  const flexIdx={RB:used.RB, WR:used.WR, TE:used.TE};
  while(flexLeft>0){
    // pick the position whose NEXT available player has the highest fpts
    let bestPos=null, bestVal=-Infinity;
    ['RB','WR','TE'].forEach(pos=>{
      const nx=byPos[pos][flexIdx[pos]];
      if(nx && nx.fpts>bestVal){ bestVal=nx.fpts; bestPos=pos; }
    });
    if(!bestPos) break;
    flexIdx[bestPos]++; used[bestPos]++; flexLeft--;
  }
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

// ── Advanced Stats (Warren Sharp) ───────────────────────────────────────────
// Read-only reference. Two views: a per-team card (this team's row across all Sharp
// tables, with league rank 1–32 per stat), and a league-wide sortable table view.
// None of this touches projections.
function sharpHasData(){ return activeSharp() && Object.keys(activeSharp()).length>0; }
// Which season the Advanced Stats tables describe. Follows the season tabs: when you're on a
// completed season that the nflverse seed carries team data for (2021-2025), the tables show
// THAT season. On the projection view — or a season with no team data — it falls back to the
// seed's reference season (SHARP_SEASON), which is the newest completed year.
// This is the single hook for the whole feature: every Advanced Stats renderer (team card and
// league-wide) reads activeSharp(), which reads this.
function advTeamSeason(){
  const s = String(activeSeason);
  if(activeSeason!=='proj' && NFLVERSE && NFLVERSE[s] && NFLVERSE[s].team) return s;
  return String(SHARP_SEASON);
}
// Adapt the nflverse team tables for the ACTIVE season into the Sharp-shaped dict the league
// view renders (adds title/category/pct_cols). Returns {} when no nflverse data for it.
// ("Sharp-shaped" is historical — the Warren Sharp source is gone; this is all nflverse now.)
function nflverseSharpTables(){
  const t=(NFLVERSE && NFLVERSE[advTeamSeason()] && NFLVERSE[advTeamSeason()].team) || null;
  if(!t) return {};
  const META={
    offense:{title:'Offensive Metrics',category:'offense'},
    defense:{title:'Defensive Metrics',category:'defense'},
    tendencies:{title:'Tendencies',category:'offense'},
    offensive_line:{title:'O-Line',category:'offense'},
    pace:{title:'Pace',category:'offense'},
    personnel:{title:'Personnel',category:'offense'},
    coverage:{title:'Coverage (man/zone)',category:'defense'},
    def_tendencies:{title:'Defensive Tendencies',category:'defense'},
    defensive_line:{title:'Pass Rush & Run D',category:'defense'},
  };
  const PCT=['Explosive Play Rate','Down Conversion Rate','Shotgun Rate','NoHuddle Rate','3WR Rate','Multi TE Rate','Man Rate','Zone Rate',
    'Motion Rate','Play Action Rate','RPO Rate','Screen Rate','Trick Play Rate','Drop Rate','Blitz Rate',
    'Pressure Rate Allowed','Rush Stuff Rate','Pressure Rate','No Blitz Pressure Rate',
    '11 Personnel','12 Personnel','13 Personnel','21 Personnel','Multi RB Rate','Sub Package Rate','Nickel Rate','Dime+ Rate',
    'Neutral DB Rate','Neutral DB Rate Last 5','Middle Closed Rate','Middle Open Rate','Cover 1','Cover 2','Cover 3'];
  const out={};
  for(const k in t){
    const m=META[k]||{title:k,category:'offense'};
    out[k]={columns:t[k].columns, title:m.title, category:m.category,
            pct_cols:(t[k].columns||[]).filter(c=>PCT.includes(c)), teams:t[k].teams};
  }
  return out;
}
// The active source for the league-wide Advanced Stats tables: Warren Sharp or nflverse.
function activeSharp(){
  return nflverseSharpTables();
}
// True when the nflverse A/B source can back the league-wide Advanced Stats view.
function nflverseSharpAvailable(){ return Object.keys(nflverseSharpTables()).length>0; }
// Full team name for team pages (e.g. "Cincinnati Bengals"); falls back to the code.
function teamDisplayName(code){ return (TEAM_NAMES && TEAM_NAMES[code]) || code; }
// 1 → "1st", 2 → "2nd", 22 → "22nd", etc.
function ordinal(n){
  if(n==null) return '';
  const s=n%100;
  const suff=(s>=11&&s<=13)?'th':(n%10===1)?'st':(n%10===2)?'nd':(n%10===3)?'rd':'th';
  return n+suff;
}
function sharpRankClass(rank){
  if(rank==null) return '';
  if(rank<=8)  return 'sr-good';    // top quarter
  if(rank<=16) return 'sr-okhi';
  if(rank<=24) return 'sr-oklo';
  return 'sr-bad';                  // bottom quarter
}
function sharpRankBadge(rank){
  if(rank==null) return '';
  const suff = (rank%10===1&&rank!==11)?'st':(rank%10===2&&rank!==12)?'nd':(rank%10===3&&rank!==13)?'rd':'th';
  return `<span class="sr-badge ${sharpRankClass(rank)}">${rank}${suff}</span>`;
}
function fmtSharpVal(v, isPct){
  if(v==null) return '—';
  if(typeof v!=='number') return v;
  let s;
  if(Number.isInteger(v)){
    s = String(v);
  } else {
    // Small-magnitude metrics (e.g. EPA/Play, ~ -0.25..0.25) need 2 decimals — 1 decimal
    // collapses meaningful differences (0.19 → 0.2). Larger stats read fine at 1 decimal.
    const dp = (Math.abs(v) < 1 && !isPct) ? 2 : 1;
    s = v.toFixed(dp);
  }
  return isPct ? s+'%' : s;
}
// Is a column a percentage in the given table? (build_seed flags these in pct_cols.)
function sharpColIsPct(tbl, col){
  return !!(tbl && Array.isArray(tbl.pct_cols) && tbl.pct_cols.includes(col));
}

// ── Roster Changes (Spotrac offseason: free agency, draft, trades, losses) ──
// Read-only per-team view tying the 2025 weaknesses to how the team addressed them.
