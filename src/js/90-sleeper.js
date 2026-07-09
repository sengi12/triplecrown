// ═════════════════════════════════════════════════════════════════════════════
// Sleeper live data integration
// ═════════════════════════════════════════════════════════════════════════════
const SLEEPER_STAT_MAP = {
  pass_yd:'passing_yards', pass_td:'passing_touchdowns', pass_att:'passing_attempts',
  pass_cmp:'passing_completions', pass_int:'interceptions_thrown',
  rush_yd:'rushing_yards', rush_td:'rushing_touchdowns', rush_att:'rushing_attempts',
  rec:'receptions', rec_yd:'receiving_yards', rec_td:'receiving_touchdowns',
  rec_tgt:'receiving_targets', fum_lost:'fumbles_lost', gp:'games_played',
  adp_std:'adp', adp_ppr:'adp_ppr', adp_half_ppr:'adp_half_ppr', adp_2qb:'adp_2qb',
};
const POS_KEEP = {QB:1,RB:1,WR:1,TE:1};

async function sleeperFetch(url){
  // Guard against a stalled connection hanging a load forever (which would strand the
  // seasonLoading flag and block further season clicks). AbortController enforces a cap.
  const ctrl = (typeof AbortController!=='undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(()=>ctrl.abort(), 20000) : null;
  try{
    const res = await fetch(url, {headers:{'Accept':'application/json'}, signal: ctrl?ctrl.signal:undefined});
    if(!res.ok) throw new Error(`Sleeper ${res.status}`);
    return await res.json();
  }catch(e){
    if(e && e.name==='AbortError') throw new Error('request timed out');
    throw e;
  }finally{
    if(timer) clearTimeout(timer);
  }
}

// Load (and cache in-memory) the big Sleeper player DB — fetched at most once.
// Keep ALL skill players (even currently teamless / retired) so historical seasons
// can still resolve a player's name even if they're no longer rostered.
// `silent` suppresses the loading toast for background boots (seed already loaded).
// Concurrent callers share a single in-flight promise: without this, a slow/pending
// background load could be awaited by a season click, stranding it (and the season's
// seasonLoading guard) until that fetch resolved. On rejection we clear the promise so
// a later call can retry.
async function loadSleeperPlayers(silent){
  if(sleeperPlayers) return sleeperPlayers;
  if(sleeperPlayersPromise) return sleeperPlayersPromise;   // a load is already running — reuse it
  if(!silent) toast('Fetching Sleeper player database…');
  sleeperPlayersPromise = (async()=>{
    const raw = await sleeperFetch(SLEEPER_PLAYERS_URL);
    const slim = {};
    for(const pid in raw){
      const p = raw[pid];
      // Keep all individual players (skill + defensive + K) so their cards resolve; exclude only
      // team defenses ('DEF'). Seed/roster logic still filters to POS_KEEP separately.
      if(!p.position || p.position==='DEF') continue;
      slim[pid] = {
        player_id:pid, name:`${p.first_name||''} ${p.last_name||''}`.trim(),
        pos:p.position, team:p.team||null, age:p.age||null, years_exp:p.years_exp,
        height:p.height||null, weight:p.weight||null, college:p.college||null,
        number:(p.number!=null?p.number:null), espn_id:(p.espn_id!=null?String(p.espn_id):null),
      };
    }
    sleeperPlayers = slim;
    buildSleeperNameIndex();
    return slim;
  })();
  try{
    return await sleeperPlayersPromise;
  }catch(e){
    sleeperPlayersPromise = null;   // clear so a later attempt can retry
    throw e;
  }
}

// name(+pos) → player_id, so imported players (or any without an id) can be matched to a
// Sleeper player_id and therefore get a Sleeper headshot.
let sleeperNameIdx=null;
function normName(s){ return (s||'').toLowerCase().replace(/[.'\-]/g,'').replace(/\s+(jr|sr|ii|iii|iv|v)$/,'').replace(/\s+/g,' ').trim(); }
function buildSleeperNameIndex(){
  sleeperNameIdx={};
  if(!sleeperPlayers) return;
  for(const pid in sleeperPlayers){
    const p=sleeperPlayers[pid];
    sleeperNameIdx[normName(p.name)]=pid;
    if(p.pos) sleeperNameIdx[normName(p.name)+'|'+p.pos]=pid;
  }
}
// Resolve a player_id from a name (and optional position). Returns null if no match.
function resolvePlayerId(name,pos){
  if(!sleeperNameIdx) buildSleeperNameIndex();
  if(!sleeperNameIdx) return null;
  const n=normName(name);
  return (pos&&sleeperNameIdx[n+'|'+pos]) || sleeperNameIdx[n] || null;
}

// Pull season team + identity off the stat/projection row itself, since a player's
// team changes year to year. The row's `team` is the team they were on THAT season.
function normalizeSleeperRow(row){
  const s = row.stats||{}; const out={};
  for(const k in SLEEPER_STAT_MAP){ if(s[k]!=null) out[SLEEPER_STAT_MAP[k]] = s[k]; }
  // ADP lives under stats (adp_ppr, adp_half_ppr, adp_2qb, adp_std, …); 999 = unranked.
  const adp = {
    adp_std: s.adp_std!=null ? s.adp_std : 999,
    adp_ppr: s.adp_ppr!=null ? s.adp_ppr : 999,
    adp_half_ppr: s.adp_half_ppr!=null ? s.adp_half_ppr : 999,
    adp_2qb: s.adp_2qb!=null ? s.adp_2qb : 999,
    adp: (s.adp_ppr!=null ? s.adp_ppr : (s.adp_std!=null ? s.adp_std : 999)),
  };
  return {
    stats:out, pid:String(row.player_id),
    team: row.team || null,
    pos: row.position || (row.player&&row.player.position) || null,
    name: (row.player && `${row.player.first_name||''} ${row.player.last_name||''}`.trim()) || null,
    adp,
  };
}

// Build a SEED-shaped object {team:{QB/RB/WR/TE:[...]}} from a per-season index.
// The index is keyed by player_id; each value carries that SEASON's team/pos/name/stats,
// so a player lands on the team they actually played for that year (DJ Moore → CHI in
// 2024, BUF in 2026), and rotating backup QBs resolve correctly per season.
function buildSeedEntry(pid, row, meta){
  const team = row.team || meta.team;
  const pos  = row.pos  || meta.pos;
  const name = row.name || meta.name || 'Unknown';
  if(!team) return null;
  if(!POS_KEEP[pos]) return null;
  const st = row.stats || {};
  const ad = row.adp || {};
  const entry={
    name, slug:null, player_id:pid, pos, team, headshot:null, age:meta.age||null,
    passing_yards:st.passing_yards||0, passing_touchdowns:st.passing_touchdowns||0,
    passing_tds:st.passing_touchdowns||0,
    passing_attempts:st.passing_attempts||0, passing_completions:st.passing_completions||0,
    interceptions_thrown:st.interceptions_thrown||0,
    rushing_yards:st.rushing_yards||0, rushing_tds:st.rushing_touchdowns||0,
    rushing_attempts:st.rushing_attempts||0,
    receiving_targets:st.receiving_targets||0, receptions:st.receptions||0,
    receiving_yards:st.receiving_yards||0, receiving_tds:st.receiving_touchdowns||0,
    adp:ad.adp||999, adp_ppr:ad.adp_ppr||999, adp_half_ppr:ad.adp_half_ppr||999, adp_2qb:ad.adp_2qb||999, adp_std:ad.adp_std||999,
    bye_week:null, risk:5, upside:5,
    games_played: (row.games_played!=null?row.games_played:(st.games_played||0)),
    games_started: (row.games_started!=null?row.games_started:(st.games_started||0)),
    snap_pct: (row.snap_pct!=null?row.snap_pct:null),
  };
  if(!entry.receiving_targets && entry.receptions){
    const cr = pos==='TE' ? 0.68 : 0.65;
    entry.receiving_targets = Math.round(entry.receptions / cr);
  }
  const skillInvolved = entry.passing_yards||entry.rushing_attempts||entry.receiving_targets||entry.receptions;
  const qbInvolved = entry.passing_attempts>0 || entry.passing_yards>0 || (entry.games_played||0)>0;
  const include = pos==='QB' ? qbInvolved : skillInvolved;
  return include ? entry : null;
}

function finalizeSeed(seed, isProjection){
  for(const t in seed){
    ['RB','WR','TE'].forEach(pos=>{
      seed[t][pos].sort((a,b)=>(a.adp_ppr||999)-(b.adp_ppr||999)
        || -((b.passing_yards+b.rushing_yards+b.receiving_yards)-(a.passing_yards+a.rushing_yards+a.receiving_yards)));
    });
    // For projections, Sleeper sets gp=18 for everyone (useless). Derive projected games
    // from each QB's share of the team's projected passing yards instead.
    if(isProjection) projectQBGames(seed[t].QB);
    seed[t].QB.sort((a,b)=>
      (b.games||b.games_played||0)-(a.games||a.games_played||0)
      || (b.passing_attempts||0)-(a.passing_attempts||0)
      || (b.passing_yards||0)-(a.passing_yards||0));
    assignQBSnapShares(seed[t].QB);
    // For non-projection (historical) data, games come straight from real gp.
    if(!isProjection) seed[t].QB.forEach(q=>{ if(q.games==null) q.games=q.games_played||0; });
  }
  return seed;
}

// Project games played for a team's QBs from their share of projected passing yards.
// - A clear bell-cow (>=75% of team pass yards) → 17 games, everyone else → 0.
// - A genuine committee (e.g. ATL Tua 57% / Penix 40%) → games ∝ yard share, rounded up.
// - QBs with a tiny share (Sleeper padding so they aren't buried in ADP) → 0 games.
function projectQBGames(qbs){
  if(!qbs||!qbs.length) return;
  if(qbs.length===1){ qbs[0].games=SEASON_GAMES; qbs[0].games_played=SEASON_GAMES; return; }
  const total=qbs.reduce((s,q)=>s+(q.passing_yards||0),0);
  if(total<=0){ qbs.forEach((q,i)=>{ q.games=i===0?SEASON_GAMES:0; q.games_played=q.games; }); return; }
  const shares=qbs.map(q=>(q.passing_yards||0)/total);
  const top=Math.max(...shares);
  if(top>=0.75){
    // clear starter
    qbs.forEach((q,i)=>{ q.games=shares[i]===top?SEASON_GAMES:0; q.games_played=q.games; });
    return;
  }
  // committee: games proportional to yards, rounded up; cap each at 17; ignore <12% padding
  qbs.forEach((q,i)=>{
    const g = shares[i] < 0.12 ? 0 : Math.min(SEASON_GAMES, Math.ceil(shares[i]*SEASON_GAMES));
    q.games=g; q.games_played=g;
  });
}

function assembleSeed(players, idx, isProjection){
  const seed={}; TEAMS.forEach(t=>seed[t]={QB:[],RB:[],WR:[],TE:[]});
  for(const pid in idx){
    const entry=buildSeedEntry(pid, idx[pid], players[pid]||{});
    if(entry && seed[entry.team]) seed[entry.team][entry.pos].push(entry);
  }
  return finalizeSeed(seed, isProjection);
}

// Record-list variant: each record is one team-stint (a traded player yields 2+ records).
function assembleSeedFromRecords(players, records, isProjection){
  const seed={}; TEAMS.forEach(t=>seed[t]={QB:[],RB:[],WR:[],TE:[]});
  records.forEach(row=>{
    const entry=buildSeedEntry(row.pid, row, players[row.pid]||{});
    if(entry && seed[entry.team]) seed[entry.team][entry.pos].push(entry);
  });
  return finalizeSeed(seed, isProjection);
}

// Default snap share from games played (gp). The primary QB (most games) gets exactly
// gp/SEASON_GAMES (so Rodgers at 16 of 17 ≈ 94%). The remaining share is split among the
// other QBs in proportion to their own games. A lone QB gets 100%.
function assignQBSnapShares(qbs){
  if(!qbs||!qbs.length) return;
  if(qbs.length===1){ qbs[0].snap_share=1; return; }
  const anyGP = qbs.some(q=>(q.games_played||0)>0);
  if(!anyGP){ qbs.forEach(q=>{ q.snap_share=1/qbs.length; }); return; }
  const starter=qbs[0]; // already sorted by gp desc
  const starterShare=Math.min(1,(starter.games_played||0)/SEASON_GAMES);
  starter.snap_share=starterShare;
  const remainder=Math.max(0,1-starterShare);
  const others=qbs.slice(1);
  const othersGP=others.reduce((s,q)=>s+(q.games_played||0),0);
  if(othersGP>0){ others.forEach(q=>{ q.snap_share=remainder*((q.games_played||0)/othersGP); }); }
  else { others.forEach(q=>{ q.snap_share=remainder/others.length; }); }
}

// Pull current-season projections live and make them the working seed.
// Background refresh of the current projection season's ADP (and, opportunistically, fresh
// projection numbers) from Sleeper, MERGED into the already-loaded embedded seed. This keeps
// ADP current for VONA/VOR without a rebuild, and is best-effort: if the network is blocked
// (file:// / offline), it silently keeps the baked seed. It NEVER touches the user's edited
// working projections or historical seasons — only the read-only SEED baseline's ADP, plus
// projection stats for players the user hasn't edited.
let _bgAdpRefreshed = false;
async function backgroundRefreshADP(){
  if(_bgAdpRefreshed) return;
  try{
    const rows = await sleeperFetch(SLEEPER_PROJ_URL(PROJ_SEASON));
    if(!Array.isArray(rows) || !rows.length) return;
    // Build a pid → {adp fields, fresh proj stats} index from the live feed.
    const live = {};
    rows.forEach(r=>{ const n=normalizeSleeperRow(r); if(n.pid) live[n.pid]=n; });
    let adpUpdated=0, teamsTouched=new Set();
    // Merge ADP into every SEED entry by player_id (read-only baseline — safe to update).
    TEAMS.forEach(t=>{
      ['QB','RB','WR','TE'].forEach(pos=>{
        (SEED[t] && SEED[t][pos] || []).forEach(e=>{
          const l = live[e.player_id];
          if(l && l.adp){
            const before=e.adp_ppr;
            e.adp = l.adp.adp; e.adp_ppr = l.adp.adp_ppr;
            e.adp_half_ppr = l.adp.adp_half_ppr; e.adp_2qb = l.adp.adp_2qb;
            e.adp_std = l.adp.adp_std;
            if(before!==e.adp_ppr){ adpUpdated++; teamsTouched.add(t); }
          }
        });
      });
    });
    _bgAdpRefreshed = true;
    if(adpUpdated>0){
      // If the rankings or a team view is showing, re-render so fresh ADP flows into VOR/VONA.
      if(currentPhase==='Rankings') renderRankings();
      else if(currentTeam) renderContent();
      toast(`ADP refreshed from Sleeper (${adpUpdated} players) ✓`,'ok');
    }
  }catch(e){ /* offline / CORS / file:// — keep the baked seed silently */ }
}

async function refreshFromSleeper(bootRestore){
  try{
    const players=await loadSleeperPlayers();
    toast(`Fetching ${PROJ_SEASON} projections…`);
    const rows=await sleeperFetch(SLEEPER_PROJ_URL(PROJ_SEASON));
    const idx={}; rows.forEach(r=>{const n=normalizeSleeperRow(r);idx[n.pid]=n;});
    SEED=assembleSeed(players,idx,true); rosterMergedTeams.clear();
    seasonStatsCache['proj']=SEED;
    projSeed=SEED;
    // reset the working set to the fresh seed
    workingProj={}; userProj=workingProj; importedSnapshot=null; dirtySinceImport=false;
    activeSeason='proj';
    // On the very first (boot) load, restore any saved session over the fresh seed. A manual
    // "refresh from Sleeper" (bootRestore=false) intentionally starts clean instead.
    let restored=false;
    if(bootRestore){ restored=restoreSession(); _persistReady=true; }
    renderSeasonTabs(); renderSidebar();
    if(currentTeam){ ensureTeam(currentTeam); renderContent(); }
    else document.getElementById('content').innerHTML=emptyHTML();
    toast(`Loaded live ${PROJ_SEASON} projections from Sleeper${restored?' · session restored':''} ✓`,'ok');
  }catch(e){
    if(bootRestore) _persistReady = true;   // allow saves once the app is interactive
    toast('Sleeper fetch failed: '+e.message,'err');
    // If we have nothing loaded at all, show actionable guidance.
    const empty = !SEED || !Object.keys(SEED).some(t=>SEED[t]&&(SEED[t].QB.length||SEED[t].WR.length||SEED[t].RB.length||SEED[t].TE.length));
    if(empty){
      document.getElementById('content').innerHTML=`<div class="empty">
        <div class="empty-icon">⚠️</div><div class="empty-title">Couldn't reach Sleeper</div>
        <div class="empty-body">The live pull was blocked (often browser CORS when opening the file directly).
        Two easy fixes:<br><br>
        <b>1.</b> Run <code>python build_seed.py</code> locally, then click <b>📦 Seed</b> and load the generated
        <code>triplecrown_seed.json</code>.<br>
        <b>2.</b> Or serve the file over http (e.g. <code>python -m http.server</code>) and click <b>↻ Sleeper</b> to retry.</div></div>`;
    }
  }
}

// App-side mirror of build_seed.py's weekly aggregation. Splits a QB's season by team
// using per-week snap share, so a live reference load (no prebuilt seed) still shows a
// traded QB on each team with snap-based games. STARTER threshold matches the builder.
const STARTER_SNAP_THRESHOLD = 0.50;
function aggregateWeeksByTeam(weekly){
  const byTeam={};
  for(const wk in (weekly||{})){
    const row=weekly[wk];
    if(!row || typeof row!=='object') continue;
    const s=row.stats||{}; const team=row.team;
    if(!team) continue;
    const b=byTeam[team]||(byTeam[team]={team,games_played:0,games_started:0,starter_games:0,
      off:0,tmoff:0,starterOff:0,starterTm:0,stats:{}});
    const off=s.off_snp||0, tmoff=s.tm_off_snp||0, gp=s.gp||0;
    const hasSnapData = ('off_snp' in s) && ('tm_off_snp' in s) && tmoff>0;
    const wkSnap = hasSnapData ? off/tmoff : 0;
    b.off+=off; b.tmoff+=tmoff; b.games_started+=s.gs||0;
    // Count as a starter game if snap share exceeds threshold, OR if snap data is missing
    // but the player had a recorded game (some weeks on Sleeper lack snap tracking).
    if(gp && (wkSnap>=STARTER_SNAP_THRESHOLD || !hasSnapData)){ b.starter_games++; b.starterOff+=off; b.starterTm+=tmoff; }
    for(const k in SLEEPER_STAT_MAP){
      if(['gp','gs','off_snp','tm_off_snp'].includes(k)) continue;
      if(s[k]!=null) b.stats[SLEEPER_STAT_MAP[k]]=(b.stats[SLEEPER_STAT_MAP[k]]||0)+s[k];
    }
  }
  const out=[];
  for(const team in byTeam){
    const b=byTeam[team];
    b.games_played=b.starter_games;
    const denom=b.starterTm||b.tmoff, num=b.starterOff||b.off;
    b.snap_pct=denom>0?Math.round(num/denom*1000)/10:null;
    b.stats.games_played=b.games_played; b.stats.games_started=b.games_started;
    out.push({team:b.team,games_played:b.games_played,games_started:b.games_started,snap_pct:b.snap_pct,stats:b.stats});
  }
  out.sort((a,b)=>(b.games_played-a.games_played)||(b.stats.passing_yards||0)-(a.stats.passing_yards||0));
  return out;
}

// Build a reference-season seed live from Sleeper, fetching weekly data for QODs (QBs with
// games) so traded QBs split by team. Falls back to season-grouping for everyone else.
async function buildLiveReferenceSeed(season, players, seasonIdx){
  // Identify QBs who played, to fetch their weekly splits.
  const qbPids=[];
  for(const pid in seasonIdx){
    const r=seasonIdx[pid];
    const isQB = r.pos==='QB' || (players[pid]&&players[pid].pos==='QB');
    const gp = (r.stats&&r.stats.games_played)||0;
    if(isQB && gp>0) qbPids.push(pid);
  }
  // Fetch weekly for those QBs (bounded; cached per session).
  const records=[];
  const handled=new Set();
  for(const pid of qbPids){
    try{
      const weekly=await sleeperFetch(SLEEPER_WEEKLY_URL(pid,season));
      const split=aggregateWeeksByTeam(weekly);
      if(split.length){
        const meta=players[pid]||{};
        split.forEach(r=>records.push({pid, team:r.team, pos:'QB', name:meta.name||(seasonIdx[pid]&&seasonIdx[pid].name),
          games_played:r.games_played, games_started:r.games_started, snap_pct:r.snap_pct, stats:r.stats}));
        handled.add(pid);
      }
    }catch(e){ /* skip this QB's split on error; falls back below */ }
  }
  // Everyone else (and any QB whose weekly failed) uses their season-grouping row.
  for(const pid in seasonIdx){
    if(handled.has(pid)) continue;
    const r=seasonIdx[pid];
    records.push({pid, team:r.team, pos:r.pos, name:r.name, stats:r.stats,
      games_played:(r.stats&&r.stats.games_played)||0});
  }
  const meta={};
  for(const pid in players) meta[pid]=players[pid];
  return assembleSeedFromRecords(meta, records);
}
// Background-enhance a season's seed with per-team QB splits from weekly data.
// Fetches all QBs in PARALLEL (not sequential) so it completes in ~1-2 seconds,
// then re-renders regardless of which tab the user is on.
async function enhanceQBSplits(season, players, seasonIdx){
  try{
    const qbPids=[];
    for(const pid in seasonIdx){
      const r=seasonIdx[pid];
      const isQB = r.pos==='QB' || (players[pid]&&players[pid].pos==='QB');
      const gp = (r.stats&&r.stats.games_played)||0;
      if(isQB && gp>0) qbPids.push(pid);
    }
    if(!qbPids.length) return;
    // Fetch weekly for all QBs in parallel — much faster than sequential.
    const results=await Promise.allSettled(
      qbPids.map(pid=>sleeperFetch(SLEEPER_WEEKLY_URL(pid,season)).then(w=>({pid,weekly:w})))
    );
    const records=[];
    const handled=new Set();
    for(const r of results){
      if(r.status!=='fulfilled'||!r.value) continue;
      const {pid,weekly}=r.value;
      const split=aggregateWeeksByTeam(weekly);
      if(split && split.length){
        const meta=players[pid]||{};
        split.forEach(s=>records.push({pid, team:s.team, pos:'QB',
          name:meta.name||(seasonIdx[pid]&&seasonIdx[pid].name),
          games_played:s.games_played, games_started:s.games_started,
          snap_pct:s.snap_pct, stats:s.stats}));
        handled.add(pid);
      }
    }
    if(!handled.size) return;
    // Everyone not handled uses their season-grouping row.
    for(const pid in seasonIdx){
      if(handled.has(pid)) continue;
      const r=seasonIdx[pid];
      records.push({pid, team:r.team, pos:r.pos, name:r.name, stats:r.stats,
        games_played:(r.stats&&r.stats.games_played)||0});
    }
    const meta={};
    for(const pid in players) meta[pid]=players[pid];
    seasonStatsCache[season]=assembleSeedFromRecords(meta, records);
    // Re-render if still viewing this season — works from ANY tab (QB, Passing, etc).
    if(activeSeason===season){
      SEED=seasonStatsCache[season];
      referenceProj={}; userProj=referenceProj;
      if(currentTeam){ ensureTeam(currentTeam); renderContent(); }
      toast(`QB team splits loaded for ${season} ✓`,'ok');
    }
  }catch(e){ /* background enhancement failed — season still works unsplit */ }
}
// re-render so things like the vacated-production note can appear once the data arrives.
// Used when running off a live Sleeper pull (no prebuilt HISTORY) and we need last year.
async function ensureSeasonStats(season){
  if(seasonStatsCache[season] || seasonStatsFetching[season]) return;
  seasonStatsFetching[season]=true;
  try{
    const players=await loadSleeperPlayers();
    const rows=await sleeperFetch(SLEEPER_STATS_URL(season));
    const idx={}; rows.forEach(r=>{const n=normalizeSleeperRow(r);idx[n.pid]=n;});
    seasonStatsCache[season]=assembleSeed(players,idx);
    // re-render the current view so the note/record now has data
    if(currentTeam) renderContent();
  }catch(e){ /* offline / CORS — silently skip; note just won't show */ }
  finally{ seasonStatsFetching[season]=false; }
}
async function loadSeason(season){
  if(season===activeSeason) return;
  // Switching to proj or to an already-loaded/buildable season needs no network — allow it
  // even if another season's live fetch is in flight (so clicks are never dead-ended).
  if(season==='proj'){
    activeSeason='proj';
    SEED = projSeed || seasonStatsCache['proj'] || SEED;
    userProj = workingProj;     // restore the editable working set
    afterSeasonSwitch();
    return;
  }
  // entering reference mode — build that season's seed from embedded history if possible
  if(!seasonStatsCache[season] && HISTORY && Object.keys(HISTORY).length){
    const built=buildSeedFromHistory(season);
    if(built) seasonStatsCache[season]=built;
  }
  if(seasonStatsCache[season]){ enterReference(season); return; }
  // Past here we need a live Sleeper fetch. Only THIS path is guarded, so a stuck/slow
  // live load can't block switching to proj or to cached seasons.
  if(seasonLoading){ toast('Still loading another season — one moment…'); return; }
  seasonLoading=true;
  const host=document.getElementById('seasonTabs');
  if(host){ const btns=host.querySelectorAll('.season-tab'); btns.forEach(b=>{if(b.textContent===season)b.textContent=season+' …';}); }
  try{
    const players=await loadSleeperPlayers();
    toast(`Fetching ${season} stats…`);
    const rows=await sleeperFetch(SLEEPER_STATS_URL(season));
    const idx={}; rows.forEach(r=>{const n=normalizeSleeperRow(r);idx[n.pid]=n;});
    // Load immediately with season-grouping data (fast, one call).
    seasonStatsCache[season]=assembleSeed(players,idx);
    seasonLoading=false;
    enterReference(season);
    toast(`Loaded ${season} actual stats ✓`,'ok');
    // Then enhance QB splits in the background (optional; traded QBs land on correct teams).
    enhanceQBSplits(season, players, idx);
  }catch(e){
    seasonLoading=false;
    renderSeasonTabs();
    toast(`Could not load ${season}: ${e.message} — this needs a live connection to Sleeper`,'err');
  }
}

// Enter read-only reference mode for a past season. Working set is preserved untouched.
function enterReference(season){
  if(activeSeason==='proj') workingProj = userProj;  // stash the working set
  activeSeason=season;
  SEED = seasonStatsCache[season];
  referenceProj = {};
  userProj = referenceProj;     // render code now reads the reference state
  afterSeasonSwitch();
  // fetch the team's record for that season (ESPN) in the background
  if(currentTeam) fetchTeamRecord(season,currentTeam);
}

// Build a seed from embedded HISTORY. New shape: player_id → { season: [ {team, pos,
// name, games_played, games_started, snap_pct, stats}, ... ] } — a LIST so a traded
// player (e.g. Flacco 2025: CLE + CIN) appears on each team with that stint's stats.
// Older builds stored a single object or flat stats; both are handled.
function buildSeedFromHistory(season){
  if(!HISTORY||!Object.keys(HISTORY).length) return null;
  const meta={};
  const base=seasonStatsCache['proj']|| (typeof SEED_DATA!=='undefined'?SEED_DATA:{});
  // Iterate the four position arrays explicitly. A plain `for(pos in base[t])` would also
  // pick up non-array bookkeeping keys like `_rosterMerged` (added by mergeRosterPlayers
  // after a team is opened), and calling .forEach on that boolean throws — which silently
  // killed season switching after a team had been selected.
  for(const t in base){
    if(!base[t]) continue;
    ['QB','RB','WR','TE'].forEach(pos=>{
      const arr=base[t][pos];
      if(!Array.isArray(arr)) return;
      arr.forEach(p=>{
        if(p.player_id) meta[p.player_id]={player_id:p.player_id,name:p.name,pos:p.pos,team:p.team,age:p.age};
      });
    });
  }
  // Flatten to a list of normalized records (one per team-stint).
  const records=[];
  for(const pid in HISTORY){
    const rec=HISTORY[pid][season];
    if(!rec) continue;
    const list = Array.isArray(rec) ? rec : [rec];
    list.forEach(r=>{
      const stats = r.stats || (r.team?{}:r); // flat-stats fallback
      records.push({
        pid, stats,
        team: r.team||null, pos: r.pos||null, name: r.name||null,
        games_played: r.games_played!=null?r.games_played:(stats.games_played||0),
        games_started: r.games_started!=null?r.games_started:(stats.games_started||0),
        snap_pct: r.snap_pct!=null?r.snap_pct:null,
      });
    });
  }
  if(!records.length) return null;
  return assembleSeedFromRecords(meta, records);
}

function afterSeasonSwitch(){
  // We DON'T wipe the working set anymore — proj mode restores workingProj, reference mode
  // uses a fresh referenceProj. Just re-render for the active view.
  if(currentTeam && !(SEED[currentTeam])) currentTeam=null;
  renderSeasonTabs(); renderSidebar();
  // League-wide views (Full Rankings, league-wide Advanced Stats) aren't team-scoped, so keep
  // showing them across a season switch — same idea as preserving a selected team.
  if(currentPhase==='Rankings' || currentPhase==='AdvancedLeague'){ renderContent(); return; }
  if(currentTeam){ ensureTeam(currentTeam); renderContent(); }
  else document.getElementById('content').innerHTML=emptyHTML();
}

function renderSeasonTabs(){
  const host=document.getElementById('seasonTabs'); if(!host) return;
  // If a prebuilt seed bundled history, show exactly those seasons. Otherwise offer the
  // last 10 seasons (clickable; each fetches live from Sleeper on demand). This way you
  // always have reference years even when running off a live pull with no prebuilt seed.
  const hist = (HISTORY_SEASONS && HISTORY_SEASONS.length)
    ? HISTORY_SEASONS
    : Array.from({length:10},(_,n)=>String(PROJ_SEASON-1-n));
  const seasons=['proj', ...hist];
  host.innerHTML = seasons.map(s=>{
    const label = s==='proj' ? `${PROJ_SEASON} Proj` : s;
    return `<button class="season-tab ${activeSeason===s?'active':''}" onclick="loadSeason('${s}')">${label}</button>`;
  }).join('');
}

