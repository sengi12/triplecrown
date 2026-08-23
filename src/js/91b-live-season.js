// ═════════════════════════════════════════════════════════════════════════════
// Live current-season stats — once the season starts, the current season becomes
// a normal reference season, fed from Sleeper as the weeks complete.
//
// One season-aggregate call per completed week writes history-shaped records into
// HISTORY[pid][year], so everything that already understands a past season —
// buildSeedFromHistory, player cards, red-zone/air-yard columns, per-game math —
// lights up for the season in progress with zero new assembly code. The working
// projection set (workingProj/projSeed) is never touched: same isolation contract
// as backgroundRefreshADP.
// ═════════════════════════════════════════════════════════════════════════════

// Pure: Sleeper season-aggregate rows → history-shaped records. Each record's stats
// object holds the RAW Sleeper blob (rec_rz_tgt, rec_air_yd, …) overlaid with the
// mapped names buildSeedEntry reads (receiving_yards, games_played, …) so both the
// seed assembler and the opportunity/red-zone readers find what they need.
function liveSeasonRecordsFromRows(rows){
  const records=[];
  (Array.isArray(rows)?rows:[]).forEach(row=>{
    const n=normalizeSleeperRow(row);
    if(!n.pid || !POS_KEEP[n.pos]) return;
    const raw=row.stats||{};
    const stats=Object.assign({}, raw, n.stats);
    const gp=Number(stats.games_played||0);
    const involved=gp>0 || stats.passing_attempts||stats.rushing_attempts||stats.receiving_targets||stats.receptions;
    if(!involved) return;
    const snap=(raw.off_snp!=null && raw.tm_off_snp>0) ? raw.off_snp/raw.tm_off_snp : null;
    records.push({pid:n.pid, team:n.team, pos:n.pos, name:n.name,
      games_played:gp, games_started:Number(stats.games_started||raw.gs||0),
      snap_pct:snap, stats});
  });
  return records;
}

var _liveSeasonRetryTimer = null;
var _liveSeasonWeek = -1;   // last completedWeeks() we fetched for — also the UI cache epoch
var _liveSeasonBusy = false;
function liveSeasonEpoch(){ return _liveSeasonWeek < 0 ? 0 : _liveSeasonWeek; }

// Fetch this season's aggregate stats and fold them into HISTORY. Idempotent: refetches at
// most once per completed week (force overrides). Writes ONLY HISTORY / HISTORY_SEASONS /
// seasonStatsCache — never the working projections.
async function refreshLiveSeasonStats(force){
  if(typeof hasSeasonStarted!=='function' || !hasSeasonStarted()) return false;
  const yr = String(TC_SEASON.year);
  if(!force && _liveSeasonWeek === completedWeeks()) return false;
  if(_liveSeasonBusy) return false;
  _liveSeasonBusy = true;
  try{
    // Time machine: the season-aggregate endpoint would leak the whole (finished) season, so
    // rebuild the aggregate from the weeks that were complete as of the frozen week.
    const rows = (typeof tcTimeMachine==='function' && tcTimeMachine())
      ? await liveSeasonRowsThroughWeek(yr, completedWeeks())
      : await sleeperFetch(SLEEPER_STATS_URL(yr));
    if(rows===null && typeof tcTimeMachine==='function' && tcTimeMachine()){
      // Partial fetch — keep last good data and quietly try again in a bit.
      if(!_liveSeasonRetryTimer) _liveSeasonRetryTimer=setTimeout(()=>{ _liveSeasonRetryTimer=null; refreshLiveSeasonStats(true).catch(()=>{}); }, 45000);
      return false;
    }
    const records = liveSeasonRecordsFromRows(rows);
    if(!records.length) return false;
    const byPid={};
    records.forEach(r=>{ (byPid[r.pid]=byPid[r.pid]||[]).push({team:r.team, pos:r.pos, name:r.name,
      games_played:r.games_played, games_started:r.games_started, snap_pct:r.snap_pct, stats:r.stats}); });
    // Replace this season's records wholesale — live data supersedes the previous pull.
    for(const pid in byPid){ (HISTORY[pid]=HISTORY[pid]||{})[yr]=byPid[pid]; }
    if(HISTORY_SEASONS.indexOf(yr)<0) HISTORY_SEASONS.unshift(yr);
    delete seasonStatsCache[yr];   // stale assembly — rebuilt from HISTORY on next view
    _liveSeasonWeek = completedWeeks();
    if(typeof renderSeasonTabs==='function') renderSeasonTabs();
    if(activeSeason===yr){
      const built=buildSeedFromHistory(yr);
      if(built){
        seasonStatsCache[yr]=built; SEED=built;
        if(typeof invalidateBuildPlayerCache==='function') invalidateBuildPlayerCache();
        if(currentPhase==='Rankings') renderRankings();
        else if(currentTeam) renderContent();
      }
    }
    return true;
  }catch(e){ return false; }   // offline / CORS / preseason quirk — try again next trigger
  finally{ _liveSeasonBusy=false; }
}

// Season-to-date aggregate built from per-week rows (weeks 1..maxWeek). Counting stats sum;
// games = weeks with gp>0; team/position follow the latest week. Used by the time machine
// and usable as a fallback whenever the aggregate endpoint is behind the weekly feed.
async function liveSeasonRowsThroughWeek(season, maxWeek){
  const weeks=[]; for(let w=1; w<=Math.max(0,maxWeek); w++) weeks.push(w);
  if(!weeks.length) return [];
  // These are big responses; on a phone one or two routinely time out or hit a 429. A season
  // aggregate built from 3 of 9 weeks poisons everything downstream (pace said "3 gms played",
  // the Live view showed a third of a season), so: retry the misses with a pause, and if any
  // week STILL failed, return null — the caller keeps last good data and tries again later.
  let perWeek = await fetchWeekRange(season, weeks, null);
  for(let attempt=0; attempt<2; attempt++){
    const missing = weeks.filter((w,i)=>!Array.isArray(perWeek[i])||!perWeek[i].length);
    if(!missing.length) break;
    await new Promise(r=>setTimeout(r, 1200*(attempt+1)));
    const retry = await fetchWeekRange(season, missing, null);
    missing.forEach((w,j)=>{ const i=weeks.indexOf(w); if(Array.isArray(retry[j])&&retry[j].length) perWeek[i]=retry[j]; });
  }
  if(weeks.some((w,i)=>!Array.isArray(perWeek[i])||!perWeek[i].length)) return null;
  const agg = {};
  const SUM_SKIP = /^(pos_rank_|rank_|.*_ypr$|.*_ypt$|.*_ypa$|.*_ypc$|.*_lng$|.*_pct$|.*_rate$)/;
  perWeek.forEach((rows, i)=>{
    (Array.isArray(rows)?rows:[]).forEach(row=>{
      const pid=row.player_id; if(!pid) return;
      const st=row.stats||{}; if(!Object.keys(st).length) return;
      const a = agg[pid] = agg[pid] || { player_id:pid, player:row.player, team:row.team, position:row.position, stats:{}, _weeks:0 };
      a.team=row.team||a.team; a.position=row.position||a.position; if(row.player) a.player=row.player;
      for(const k in st){
        const v=st[k]; if(typeof v!=='number' || !Number.isFinite(v)) continue;
        if(SUM_SKIP.test(k)) continue;
        a.stats[k]=(a.stats[k]||0)+v;
      }
      if((st.gp||0)>0) a._weeks++;   // played, not merely active on the roster
    });
  });
  return Object.values(agg).map(a=>{ a.stats.gp=a._weeks; delete a._weeks; if(a.stats.rec>0) a.stats.rec_ypr=+(a.stats.rec_yd/a.stats.rec).toFixed(2); if(a.stats.rush_att>0) a.stats.rush_ypa=+(a.stats.rush_yd/a.stats.rush_att).toFixed(2); return a; });
}
// The truncated aggregate is the honest one whenever the sum of weeks is what's wanted —
// use it for the frozen build; live seasons still use the single aggregate endpoint.

// ── Per-week league-wide stats (weekly trends, DvP, matchup context) ─────────
// Completed weeks are immutable, so they cache forever: in-memory first, then the
// Cache API (its own quota — never squeezes the localStorage session store; simply
// absent on file://, which degrades to memory-only).
var _weekStatsMem = {};
const TC_WEEKS_CACHE = 'tc-sleeper-weeks-v1';
function _weekIsCompleted(season, week){
  const cur = String(TC_SEASON.year);
  if(String(season)!==cur) return Number(season)<Number(cur);
  return week <= completedWeeks();
}
async function fetchWeekStats(season, week, pos){
  const key = `${season}|${week}|${pos||''}`;
  if(_weekStatsMem[key]) return _weekStatsMem[key];
  const url = SLEEPER_WEEK_STATS_URL(season, week, pos);
  let cache=null;
  if(_weekIsCompleted(season, week)){
    try{ if(typeof caches!=='undefined') cache = await caches.open(TC_WEEKS_CACHE); }catch(e){ cache=null; }
  }
  if(cache){
    try{ const hit=await cache.match(url); if(hit){ const rows=await hit.json(); _weekStatsMem[key]=rows; return rows; } }catch(e){}
  }
  const rows = await sleeperFetch(url);
  // Only memoize real data: caching a failed/empty pull would freeze the failure for the
  // whole session (every retry would "succeed" with nothing).
  if(!(Array.isArray(rows) && rows.length)) return rows;
  _weekStatsMem[key]=rows;
  if(cache && Array.isArray(rows) && rows.length){
    try{ await cache.put(url, new Response(JSON.stringify(rows), {headers:{'Content-Type':'application/json'}})); }catch(e){}
  }
  return rows;
}
// Bounded fan-out: run week fetches through a fixed-width promise pool. Failed weeks
// resolve null so one bad fetch never sinks the batch.
async function _tcPool(tasks, width){
  const out=new Array(tasks.length); let i=0;
  async function worker(){ while(i<tasks.length){ const k=i++; out[k]=await tasks[k]().catch(()=>null); } }
  await Promise.all(Array.from({length:Math.min(width||3, tasks.length)}, worker));   // 3-wide: phones and Sleeper rate limits both prefer it
  return out;
}
async function fetchWeekRange(season, weeks, pos){
  return _tcPool(weeks.map(w=>()=>fetchWeekStats(season, w, pos)), 3);
}
