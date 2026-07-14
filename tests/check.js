


// ═══ TRIPLECROWN_SEED_START ═══ (build_seed.py / bake_seed.py replace this whole block)
// SEED_DATA intentionally empty — TripleCrown pulls 2026 projections live from Sleeper
// on first load (or load a prebuilt triplecrown_seed.json via the 📦 Seed button, or bake
// a seed straight into this file with bake_seed.py for a phone-friendly offline copy).
const SEED_SEASON = 2026;
const SEED_DATA = {};
const SEED_HISTORY = {};
const SEED_HISTORY_SEASONS = [];
const SEED_ECR = {};
const SEED_CONTRACTS = {};
const SEED_SHARP = {};
const SEED_SOS = {};
const SEED_TEAM_NAMES = {};
const SEED_COORDINATORS = {};
const SEED_HC_PLAYCALLERS = {};
const SEED_HC_HISTORY = {};
const SEED_ADDITIONS = {};
const SEED_SHARP_SEASON = 2025;
// SumerSports advanced per-player stats, per completed season (2022-2025). Empty by default —
// baked in by build_seed.py / loaded from triplecrown_seed.json.
const SEED_SUMER = {};
const SEED_SUMER_SEASONS = [];
// KeepTradeCut dynasty player-page slugs, {nameKey:{slug,pos}} — baked in / loaded from seed.
// Used to link a player card straight to their KTC dynasty page. Empty by default.
const SEED_KTC = {};
// nflverse-computed advanced metrics (opt-in `build_seed.py --nflverse`): a parallel A/B source
// shaped like Sharp (team tables) + Sumer (QB/RB player tables). Empty unless built with --nflverse.
const SEED_NFLVERSE = {};
// Heavy nflverse sections split into lazy-loaded sidecars (def_weekly, coaching_scheme). Empty in
// the shipped/online build (fetched on demand from triplecrown_seed.def_weekly.json /
// triplecrown_seed.coaching.json); re-embedded by bake_seed.py for the offline/baked file.
const SEED_NFLVERSE_DEF_WEEKLY = {};
const SEED_NFLVERSE_COACHING = {};
// ═══ TRIPLECROWN_SEED_END ═══


// ─────────────────────────────────────────────────────────────────────────────
// Constants & URLs
// ─────────────────────────────────────────────────────────────────────────────
const NFL_LOGO = t => `https://static.www.nfl.com/t_headshot_desktop/f_auto/league/api/clubs/logos/${t==='JAX'?'JAC':t}`;
// ESPN college-team logo by ESPN team id (used on rookie player cards' college game logs).
const NCAA_LOGO = id => `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
// ESPN athlete headshot (fallback when Sleeper has no photo). league = 'nfl' | 'college-football'.
const ESPN_HEADSHOT = (league,id) => `https://a.espncdn.com/i/headshots/${league}/players/full/${id}.png`;
// Primary team colors (the dominant color of each club, matching their logos). Fixed set of
// 32, so a lookup is instant, correct, CORS-free, and works in the offline baked file.
const TEAM_COLORS = {
  ARI:'#97233F', ATL:'#A71930', BAL:'#241773', BUF:'#00338D', CAR:'#0085CA',
  CHI:'#0B162A', CIN:'#FB4F14', CLE:'#311D00', DAL:'#003594', DEN:'#FB4F14',
  DET:'#0076B6', GB:'#203731', HOU:'#03202F', IND:'#002C5F', JAX:'#006778',
  KC:'#E31837', LAC:'#0080C6', LAR:'#003594', LV:'#000000', MIA:'#008E97',
  MIN:'#4F2683', NE:'#002244', NO:'#D3BC8D', NYG:'#0B2265', NYJ:'#125740',
  PHI:'#004C54', PIT:'#FFB612', SEA:'#002244', SF:'#AA0000', TB:'#D50A0A',
  TEN:'#0C2340', WAS:'#5A1414',
};
function teamColor(t){ return TEAM_COLORS[t] || '#2b2f3a'; }
// Relative luminance (0..1) of a hex color, for choosing readable text over it.
function _hexLum(hex){
  const m=/^#?([0-9a-f]{6})$/i.exec(hex||''); if(!m) return 0;
  const n=parseInt(m[1],16), r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  const f=c=>{c/=255; return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);};
  return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);
}
// A darkened version of a hex color (mix toward black by `amt` 0..1), for light team colors.
function _darken(hex, amt){
  const m=/^#?([0-9a-f]{6})$/i.exec(hex||''); if(!m) return hex;
  const n=parseInt(m[1],16); let r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  r=Math.round(r*(1-amt)); g=Math.round(g*(1-amt)); b=Math.round(b*(1-amt));
  return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
}
// Sleeper APIs (browser can reach these directly; container cannot)
const SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nfl';
const SLEEPER_PROJ_URL = (season)=>`https://api.sleeper.com/projections/nfl/${season}?season_type=regular&grouping=season`;
const SLEEPER_STATS_URL = (season)=>`https://api.sleeper.com/stats/nfl/${season}?season_type=regular&grouping=season`;
const SLEEPER_WEEKLY_URL = (pid,season)=>`https://api.sleeper.com/stats/nfl/player/${pid}?season_type=regular&season=${season}&grouping=week`;
const SLEEPER_PICKS_URL = (draftId)=>`https://api.sleeper.app/v1/draft/${draftId}/picks`;
const SLEEPER_DRAFT_URL = (draftId)=>`https://api.sleeper.app/v1/draft/${draftId}`;
const SLEEPER_HEADSHOT = (pid)=>`https://sleepercdn.com/content/nfl/players/${pid}.jpg`;
// League-linking (username → leagues → draft) endpoints. All read-only, no auth token.
const SLEEPER_USER_URL   = (name)=>`https://api.sleeper.app/v1/user/${encodeURIComponent(name)}`;
const SLEEPER_STATE_URL  = 'https://api.sleeper.app/v1/state/nfl';
const SLEEPER_LEAGUES_URL= (userId,season)=>`https://api.sleeper.app/v1/user/${userId}/leagues/nfl/${season}`;
const SLEEPER_LG_DRAFTS_URL=(leagueId)=>`https://api.sleeper.app/v1/league/${leagueId}/drafts`;
const SLEEPER_AVATAR_THUMB=(id)=>`https://sleepercdn.com/avatars/thumbs/${id}`;

// ─────────────────────────────────────────────────────────────────────────────
// Embedded image assets (base64 data URIs → self-contained, render offline / from file://)
// ─────────────────────────────────────────────────────────────────────────────
// KeepTradeCut logo mark (their favicon-96), shown as the player-card KTC link icon.
const KTC_ICON = 'images/ktc.png';
// ═════════════════════════════════════════════════════════════════════════════
// Week-range filtering (reference seasons only) — lets the user drag a dual
// slider to see what a WR/RB/TE put up over just a stretch of weeks (e.g. Tucker
// Kraft's hot weeks 1-9 before injury), instead of only the full-season total.
// Weekly data is fetched lazily (only for the team being viewed) and cached.
// ═════════════════════════════════════════════════════════════════════════════
let weeklySkillCache = {};   // `${season}:${pid}` -> raw weekly json from Sleeper
async function fetchPlayerWeekly(pid, season){
  const key = `${season}:${pid}`;
  if(weeklySkillCache[key]) return weeklySkillCache[key];
  const data = await sleeperFetch(SLEEPER_WEEKLY_URL(pid, season));
  weeklySkillCache[key] = data;
  return data;
}

// Sum one player's weekly rows between fromWk..toWk (inclusive), restricted to the
// given team (so a trade mid-window doesn't blend two teams' stats together).
function sumWeeklyRange(weekly, team, fromWk, toWk){
  const out = {receiving_targets:0, receptions:0, receiving_yards:0, receiving_tds:0,
               rushing_attempts:0, rushing_yards:0, rushing_tds:0, games_played:0};
  for(const wk in (weekly||{})){
    const wn = parseInt(wk);
    if(isNaN(wn) || wn<fromWk || wn>toWk) continue;
    const row = weekly[wk];
    if(!row || typeof row!=='object' || row.team!==team) continue;
    const s = row.stats||{};
    if(s.gp) out.games_played += s.gp;
    out.receiving_targets += s.rec_tgt||0;
    out.receptions        += s.rec||0;
    out.receiving_yards   += s.rec_yd||0;
    out.receiving_tds     += s.rec_td||0;
    out.rushing_attempts  += s.rush_att||0;
    out.rushing_yards     += s.rush_yd||0;
    out.rushing_tds       += s.rush_td||0;
  }
  return out;
}

// QB version of sumWeeklyRange: passing + rushing totals over the requested window, restricted
// to the same team so a traded player's split doesn't blend multiple rosters together.
function sumWeeklyRangeQB(weekly, team, fromWk, toWk){
  const out = {pass_yards:0, pass_att:0, pass_td:0, comp:0, pass_int:0,
               rush_att:0, rush_yards:0, rush_td:0, games_played:0};
  for(const wk in (weekly||{})){
    const wn = parseInt(wk);
    if(isNaN(wn) || wn<fromWk || wn>toWk) continue;
    const row = weekly[wk];
    if(!row || typeof row!=='object' || row.team!==team) continue;
    const s = row.stats||{};
    if(s.gp) out.games_played += s.gp;
    out.pass_yards += s.pass_yd||0;
    out.pass_att   += s.pass_att||0;
    out.pass_td    += s.pass_td||0;
    out.comp       += s.pass_cmp||0;
    out.pass_int   += s.pass_int||0;
    out.rush_att   += s.rush_att||0;
    out.rush_yards += s.rush_yd||0;
    out.rush_td    += s.rush_td||0;
  }
  return out;
}

// Fetch + cache weekly data for every WR/RB/TE on a team's roster (reference season),
// then build {player_id -> filtered totals} for the given week window. Players whose
// fetch fails just fall back to season totals (handled by the caller).
async function buildWeekFilterData(team, season, fromWk, toWk){
  const roster=[...getBase(team,'WR'),...getBase(team,'TE'),...getBase(team,'RB')]
    .filter(p=>p.player_id);
  const results = await Promise.allSettled(
    roster.map(p=>fetchPlayerWeekly(p.player_id, season).then(w=>({pid:p.player_id, weekly:w})))
  );
  const data={};
  for(const r of results){
    if(r.status!=='fulfilled'||!r.value||!r.value.weekly) continue;
    data[r.value.pid]=sumWeeklyRange(r.value.weekly, team, fromWk, toWk);
  }
  return data;
}

// Per-QB filtered totals for the active week window. The passing/rushing tabs already use the
// aggregated QB pool; this finer map powers the QB phase itself and the 17-game pace tooltip.
async function buildWeekFilterQBData(team, season, fromWk, toWk){
  const qbs=getBase(team,'QB').filter(p=>p.player_id);
  const results = await Promise.allSettled(
    qbs.map(p=>fetchPlayerWeekly(p.player_id, season).then(w=>({pid:p.player_id, weekly:w})))
  );
  const data={};
  for(const r of results){
    if(r.status!=='fulfilled'||!r.value||!r.value.weekly) continue;
    data[r.value.pid]=sumWeeklyRangeQB(r.value.weekly, team, fromWk, toWk);
  }
  return data;
}

// Same idea for the team's QB(s) — used ONLY to keep the receiving-yards-available pool
// sane while a week window is active (does not touch the QB tab/editing state at all).
async function buildWeekFilterQBPool(team, season, fromWk, toWk){
  const qbs=getBase(team,'QB').filter(p=>p.player_id);
  const results = await Promise.allSettled(
    qbs.map(p=>fetchPlayerWeekly(p.player_id, season).then(w=>({pid:p.player_id, weekly:w})))
  );
  let pass_yards=0, pass_att=0, pass_tds=0, comp=0;
  for(const r of results){
    if(r.status!=='fulfilled'||!r.value||!r.value.weekly) continue;
    for(const wk in r.value.weekly){
      const wn=parseInt(wk); if(isNaN(wn)||wn<fromWk||wn>toWk) continue;
      const row=r.value.weekly[wk];
      if(!row||typeof row!=='object'||row.team!==team) continue;
      const s=row.stats||{};
      pass_yards+=s.pass_yd||0; pass_att+=s.pass_att||0; pass_tds+=s.pass_td||0; comp+=s.pass_cmp||0;
    }
  }
  return {pass_yards, pass_att, pass_tds, comp};
}

// Overlay week-filtered totals onto a roster list (used by initPassingShares /
// initRushingShares). Players with no filtered data (fetch still pending or failed)
// keep their season totals so the tab doesn't silently go blank.
function applyWeekFilterOverrides(list, filterData){
  if(!filterData) return list;
  return list.map(p=>{
    const f = p.player_id && filterData[p.player_id];
    if(!f) return p;
    return Object.assign({}, p, {
      receiving_targets:f.receiving_targets, receptions:f.receptions,
      receiving_yards:f.receiving_yards, receiving_tds:f.receiving_tds,
      rushing_attempts:f.rushing_attempts, rushing_yards:f.rushing_yards,
      rushing_tds:f.rushing_tds, games_played:f.games_played,
    });
  });
}

// HTML-escape a string that is going into a title="..." attribute.
function escAttr(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
// Close any open 17-game pace popovers.
function closeWeekFilterPacePops(){
  if(!document || !document.querySelectorAll) return;
  document.querySelectorAll('.pace-info-pop').forEach(el=>el.remove());
}
// Toggle a persistent, selectable popover containing the 17-game pace text so the user can
// copy it without racing a hover tooltip.
function toggleWeekFilterPace(btn, text){
  if(!btn || !btn.parentNode) return;
  const wrap = btn.parentNode;
  const existing = wrap.querySelector ? wrap.querySelector('.pace-info-pop') : null;
  if(existing){ existing.remove(); return; }
  closeWeekFilterPacePops();
  const pop = document.createElement('div');
  pop.className='pace-info-pop';
  pop.onclick=(e)=>e.stopPropagation();
  pop.innerHTML = `<div class="pace-info-pop-head">
      <span class="pace-info-pop-lbl">17-game pace</span>
      <button class="pace-info-pop-close" onclick="this.closest('.pace-info-pop').remove()" aria-label="Close">✕</button>
    </div>
    <div class="pace-info-pop-body">${escAttr(text)}</div>`;
  wrap.appendChild(pop);
  // Position as viewport-fixed and clamp so it never runs off-screen (mobile or narrow desktop).
  // Prefer right-aligned to the button and below it; flip above / clamp to the edges as needed.
  try{
    const M=8, vw=window.innerWidth, vh=window.innerHeight;
    const br=btn.getBoundingClientRect(), pr=pop.getBoundingClientRect();
    let left=br.right-pr.width;
    if(left+pr.width>vw-M) left=vw-M-pr.width;
    if(left<M) left=M;
    let top=br.bottom+6;
    if(top+pr.height>vh-M) top=br.top-pr.height-6;   // flip above when no room below
    if(top<M) top=M;
    pop.style.position='fixed'; pop.style.left=left+'px'; pop.style.top=top+'px'; pop.style.right='auto';
  }catch(e){ /* positioning is best-effort; CSS fallback still shows it */ }
}
if(document && document.addEventListener){
  document.addEventListener('click', e=>{
    const t=e.target;
    if(t && t.closest && t.closest('.pace-info-wrap')) return;
    closeWeekFilterPacePops();
  });
  // The popover is viewport-fixed, so close it on scroll to avoid it detaching from its button.
  if(typeof window!=='undefined' && window.addEventListener) window.addEventListener('scroll', closeWeekFilterPacePops, true);
}
// 17-game pace helper shown beside a player's name when a historical week window is active.
// Scale from GAMES PLAYED in the filtered sample, not week span, so missed games/injuries are
// represented realistically. Returns '' when no filtered sample is available.
function weekFilterPaceText(state, pid, mode){
  if(activeSeason==='proj' || !state || !isWeekFilterActive(state) || !pid) return '';
  const src = (mode==='qb') ? (state.weekFilterQBData && state.weekFilterQBData[pid])
                            : (state.weekFilterData && state.weekFilterData[pid]);
  if(!src || !src.games_played) return '';
  const [lo,hi]=state.weekFilter||[1,18];
  const gp=src.games_played;
  const scale=v=>Math.round((v||0)/gp*SEASON_GAMES);
  let parts=[];
  if(mode==='qb'){
    parts=[`${scale(src.pass_yards).toLocaleString()} pass yds`, `${scale(src.pass_td)} pass TD`, `${scale(src.pass_att)} att`,
           `${scale(src.rush_att)} rush att`, `${scale(src.rush_yards)} rush yds`, `${scale(src.rush_td)} rush TD`];
  } else if(mode==='rush'){
    parts=[`${scale(src.rushing_attempts)} att`, `${scale(src.rushing_yards).toLocaleString()} rush yds`, `${scale(src.rushing_tds)} rush TD`];
  } else {
    parts=[`${scale(src.receiving_targets)} tgt`, `${scale(src.receptions)} rec`, `${scale(src.receiving_yards).toLocaleString()} rec yds`, `${scale(src.receiving_tds)} rec TD`];
  }
  return `17-game pace from weeks ${lo}-${hi} (${gp} game${gp===1?'':'s'}): ${parts.join(' · ')}`;
}
function weekFilterPaceButton(state, pid, mode){
  const text = weekFilterPaceText(state, pid, mode);
  if(!text) return '';
  return `<span class="pace-info-wrap"><button class="pace-info-btn" onclick="toggleWeekFilterPace(this, ${pcardArg(text)})" aria-label="Show 17-game pace">i</button></span>`;
}

function isWeekFilterActive(state){
  return !!(state.weekFilter && (state.weekFilter[0]>1 || state.weekFilter[1]<18));
}

// Kick off a week-range fetch+recompute+rerender. Called when the slider is released.
async function applyWeekRange(team, fromWk, toWk){
  const state=userProj[team]; if(!state) return;
  state.weekFilter=[fromWk,toWk];
  state.weekFilterLoading=true;
  renderContent();
  try{
    const [skillData, qbPool, qbData] = await Promise.all([
      buildWeekFilterData(team, activeSeason, fromWk, toWk),
      buildWeekFilterQBPool(team, activeSeason, fromWk, toWk),
      buildWeekFilterQBData(team, activeSeason, fromWk, toWk),
    ]);
    state.weekFilterData=skillData;
    state.weekFilterQBPool=qbPool;
    state.weekFilterQBData=qbData;
    state.weekFilterLoading=false;
    state.passing_shares=null; state.rushing.shares=null;  // force rebuild from filtered data
    initPassingShares(team); initRushingShares(team);
    renderContent();
  }catch(e){
    state.weekFilterLoading=false;
    toast('Could not load weekly data for that range','err');
    renderContent();
  }
}
function resetWeekRange(team){
  const state=userProj[team]; if(!state) return;
  state.weekFilter=null; state.weekFilterData=null; state.weekFilterQBPool=null; state.weekFilterQBData=null;
  state.passing_shares=null; state.rushing.shares=null;
  initPassingShares(team); initRushingShares(team);
  renderContent();
}
// Live label update while dragging (cheap — no fetch until release).
function weekRangeDrag(team, which, val){
  const state=userProj[team]; if(!state) return;
  const cur = state.weekFilter || [1,18];
  let [lo,hi]=cur;
  val=parseInt(val);
  if(which==='lo'){ lo=Math.min(val,hi); } else { hi=Math.max(val,lo); }
  const loEl=document.getElementById(`wr-lo-${team}`); if(loEl) loEl.textContent=lo;
  const hiEl=document.getElementById(`wr-hi-${team}`); if(hiEl) hiEl.textContent=hi;
  const fill=document.getElementById(`wr-fill-${team}`);
  if(fill){ fill.style.left=((lo-1)/17*100)+'%'; fill.style.right=((18-hi)/17*100)+'%'; }
  state._weekDragPending=[lo,hi];
}
function weekRangeCommit(team){
  const state=userProj[team]; if(!state||!state._weekDragPending) return;
  const [lo,hi]=state._weekDragPending;
  applyWeekRange(team, lo, hi);
}
const TEAMS = ['CIN','PIT','BAL','CLE','HOU','JAX','TEN','IND','BUF','NE',
  'MIA','NYJ','KC','LAC','LV','DEN','GB','DET','MIN','CHI','TB','CAR',
  'ATL','NO','PHI','DAL','WAS','NYG','LAR','SF','SEA','ARI'];
const PCOLORS = ['#4a9eff','#00d4aa','#ff6b35','#c084fc','#fbbf24','#f472b6',
  '#34d399','#a78bfa','#fb923c','#60a5fa','#e879f9','#38bdf8','#f97316','#86efac'];
const SEASON_GAMES = 17;
const TARGET_RATE = 0.95; // targets ≈ pass attempts × this
const PROJ_SEASON = (typeof SEED_SEASON!=='undefined') ? SEED_SEASON : 2026;
document.getElementById('scenarioName').value = PROJ_SEASON + ' Projections';

function hsURL(p){
  if(!p) return '';
  // Prefer Sleeper's headshot by player_id (most reliable, auto-updates with roster moves).
  if(p.player_id) return SLEEPER_HEADSHOT(p.player_id);
  // No id (e.g. imported from another site) — try to resolve one by name so we still get
  // a Sleeper headshot rather than a broken third-party URL.
  if(typeof resolvePlayerId==='function'){
    const rid=resolvePlayerId(p.name,p.pos);
    if(rid){ p.player_id=rid; return SLEEPER_HEADSHOT(rid); }
  }
  return '';
}
function imgTag(src,cls,fb='🏈'){
  if(!src) return `<div class="${cls} ph-err">${fb}</div>`;
  return `<img src="${src}" class="${cls}" alt="" onerror="this.outerHTML='<div class=\\'${cls} ph-err\\'>${fb}</div>'">`;
}
function imgSm(src,cls='share-hs',fb='🏈'){
  if(!src) return `<div class="${cls}-err">${fb}</div>`.replace(cls+'-err',cls.replace('share-hs','share-hs')+'-err');
  return `<img src="${src}" class="${cls}" alt="" onerror="this.outerHTML='<div class=\\'share-hs-err\\'>${fb}</div>'">`;
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
let userProj = {};             // the state the render code reads (working set OR reference)
let workingProj = userProj;    // THE working set (2026 projections in progress) — preserved across season views
let referenceProj = {};        // read-only per-team state for the currently-viewed historical season
let referenceSeed = null;      // the SEED for the active reference season (proj SEED stays in projSeed)
let projSeed = null;           // snapshot of the projection-season SEED (working baseline)
let importedSnapshot = null;   // deep copy of last-imported state (for 2-stage reset)
let dirtySinceImport = false;  // have edits happened since import/last reset-to-import?
let currentTeam = null;
let currentPhase = 'QB';
let passingSubTab = 'targets';
let rushingSubTab = 'carries';
let pieChart = null;
let rankSortKey = 'ecr';
let VOR_BASELINE = {};   // {QB,RB,WR,TE} replacement-level fpts from the last VOR computation
let rankSortDir = -1;
let rankFormat = 'half_ppr';   // std | ppr | half_ppr | superflex | dynasty (matches default 0.5 PPR scoring)
// Source of truth for the SCORING axis buttons (std | half_ppr | ppr | superflex). Kept
// independent of rankFormat so Dynasty — whose non-SF ECR table is identical regardless of
// std/half/ppr — can still show and apply the chosen scoring format instead of feeling dead.
let scoringAxis = 'half_ppr';
let rankPosFilter = 'ALL';
let rankScope = 'all';   // 'all' = full league rankings, 'team' = current team only
let rankAdvanced = false; // rankings "Adv. Metrics" (SumerSports) view — swaps stat columns for advanced metrics
// Per-position minimum-volume filter for the Adv. Metrics view (0 = no filter). Rate stats
// like YPRR / EPADrop are noisy on tiny samples, so a floor keeps the board meaningful.
let sumerMin = { QB:0, WRTE:0, RB:0 };   // QB→min Plays, WRTE→min Routes Run, RB→min Rushes
// "Situational" split for the Adv. Metrics view (null = Standard/overall). When set to a
// SumerSports refinement value (e.g. 'red_zone'), the stat columns read that game-situation
// split instead of the overall season table. Only ever applied on the Adv. Metrics view.
let sumerRefinement = null;
// ═════════════════════════════════════════════════════════════════════════════
// Session persistence (localStorage) — auto-saves your working projections so they
// survive a refresh/close. Only the EDITABLE state is stored (working projections,
// custom scoring, selected format, undo stacks); the seed/history/ECR reload fresh
// from the seed each time. Silently restores on load; the Reset button clears it.
// (Requires a real http(s)/file origin; wrapped in try/catch so a blocked localStorage
// — e.g. private-mode quirks — degrades gracefully to in-memory-only behavior.)
// ═════════════════════════════════════════════════════════════════════════════
const TC_STORE_KEY = 'triplecrown.session.v1';
let _persistTimer = null;
let _persistReady = false;   // becomes true after boot restore, so we don't save during load
function persistAvailable(){
  try{ const k='__tc_test__'; localStorage.setItem(k,'1'); localStorage.removeItem(k); return true; }
  catch(e){ return false; }
}
function saveSession(){
  if(!_persistReady) return;
  if(!persistAvailable()) return;
  // Debounce: edits fire rapidly (sliders), so coalesce writes.
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(()=>{
    try{
      const payload = {
        v: 1,
        season: PROJ_SEASON,          // guard: only restore onto a matching-season seed
        savedAt: Date.now(),
        workingProj: workingProj,
        scoringSettings: scoringSettings,
        rankFormat: rankFormat,
        scoringAxis: scoringAxis,
        undoStacks: undoStacks,
      };
      localStorage.setItem(TC_STORE_KEY, JSON.stringify(payload));
    }catch(e){ /* quota or serialization issue — skip silently */ }
  }, 400);
}
function loadSession(){
  if(!persistAvailable()) return null;
  try{
    const raw = localStorage.getItem(TC_STORE_KEY);
    if(!raw) return null;
    const p = JSON.parse(raw);
    if(!p || p.v!==1) return null;
    return p;
  }catch(e){ return null; }
}
function clearSession(){
  try{ localStorage.removeItem(TC_STORE_KEY); }catch(e){}
}
// Apply a saved session over the freshly-loaded seed. Returns true if anything was restored.
// Only restores the working projections when the saved season matches the current seed,
// so 2025 edits never land on a 2026 seed. Scoring/format restore regardless (harmless).
function restoreSession(){
  const p = loadSession();
  if(!p) return false;
  let restored = false;
  if(p.scoringSettings && typeof p.scoringSettings==='object'){
    scoringSettings = Object.assign({}, scoringSettings, p.scoringSettings); restored = true;
  }
  if(p.rankFormat){ rankFormat = p.rankFormat; restored = true; }
  // Restore the scoring axis if saved; otherwise derive it from the restored rankFormat so
  // older sessions (pre-scoringAxis) still light up the correct scoring button.
  scoringAxis = p.scoringAxis || scoringAxisOf(rankFormat);
  if(p.season===PROJ_SEASON && p.workingProj && Object.keys(p.workingProj).length){
    workingProj = p.workingProj;
    if(activeSeason==='proj') userProj = workingProj;
    if(p.undoStacks && typeof p.undoStacks==='object') undoStacks = p.undoStacks;
    restored = true;
  }
  return restored;
}
// Live seed (starts from embedded SEED_DATA; can be replaced by a live Sleeper pull)
let SEED = (typeof SEED_DATA!=='undefined') ? SEED_DATA : {};
let HISTORY = (typeof SEED_HISTORY!=='undefined') ? SEED_HISTORY : {};
let HISTORY_SEASONS = (typeof SEED_HISTORY_SEASONS!=='undefined') ? SEED_HISTORY_SEASONS : [];
// FantasyPros Expert Consensus Rankings (replaces ADP). Shape: {format:{nameKey:{rank_ecr,tier,age}}}
let ECR = (typeof SEED_ECR!=='undefined') ? SEED_ECR : {};
// OverTheCap contracts (dynasty only): {nameKey:{age,apy,fa,pos}}
let CONTRACTS = (typeof SEED_CONTRACTS!=='undefined') ? SEED_CONTRACTS : {};
// Warren Sharp advanced offensive stats (read-only reference): {tableKey:{columns,title,teams:{CODE:{values,ranks}}}}
let SHARP = (typeof SEED_SHARP!=='undefined') ? SEED_SHARP : {};
// 2026 Strength of Schedule: {CODE:{rank, win_total, name}}
let SOS = (typeof SEED_SOS!=='undefined') ? SEED_SOS : {};
let _sosSchedLoading=false, _sosSchedLoaded=false;   // opponent-schedule fetch state (SOS arc)
// Full team display names: {CODE:"Cincinnati Bengals"}
let TEAM_NAMES = (typeof SEED_TEAM_NAMES!=='undefined') ? SEED_TEAM_NAMES : {};
// Coordinators (from Wikipedia via seed): {CODE:{offense:{...},defense:{...}}}
let COORDINATORS = (typeof SEED_COORDINATORS!=='undefined') ? SEED_COORDINATORS : {};
// Head coaches who call their own plays: {CODE:"Name"}
let HC_PLAYCALLERS = (typeof SEED_HC_PLAYCALLERS!=='undefined') ? SEED_HC_PLAYCALLERS : {};
// Head-coach history (Wikipedia via seed): {CODE:{name,since,prev_code,prev_role,prev_years,is_new}}
// Used so a playcalling HC who's new this season carries over their FORMER team's scheme.
let HC_HISTORY = (typeof SEED_HC_HISTORY!=='undefined') ? SEED_HC_HISTORY : {};
// Roster Changes (Spotrac via seed): {CODE:{free_agents,draft,trades,free_agents_lost}}
// (var kept as ADDITIONS to match the seed key; the UI tab is labeled "Roster Changes").
let ADDITIONS = (typeof SEED_ADDITIONS!=='undefined') ? SEED_ADDITIONS : {};
// Which season the Sharp advanced stats describe (projection season − 1).
let SHARP_SEASON = (typeof SEED_SHARP_SEASON!=='undefined') ? SEED_SHARP_SEASON : (PROJ_SEASON-1);
// SumerSports advanced per-player stats: {season:{POS:{columns,pct_cols,players:{nameKey:{values,team,rank}}}}}.
// Reference-season only — shown on the rankings page via the "Advanced (SumerSports)" toggle
// when viewing a season that has data (2022-2025), never on projections or seasons without data.
let SUMER = (typeof SEED_SUMER!=='undefined') ? SEED_SUMER : {};
let SUMER_SEASONS = (typeof SEED_SUMER_SEASONS!=='undefined') ? SEED_SUMER_SEASONS : [];
// KeepTradeCut dynasty player-page slugs (player-card links): {nameKey:{slug,pos}}
let KTC = (typeof SEED_KTC!=='undefined') ? SEED_KTC : {};
// nflverse-computed advanced metrics (opt-in A/B source): {season:{team:{...}, players:{QB,RB}}}
let NFLVERSE = (typeof SEED_NFLVERSE!=='undefined') ? SEED_NFLVERSE : {};
// Advanced team tables are now nflverse-only (the old curated toggle was retired).
let advSource = 'nflverse';
// Head coaches fetched live from ESPN this session: {CODE:{name,headshot,experience}|null}
let headCoaches = {};
let hcInFlight = {};
let sharpCategory = 'offense';   // 'offense' | 'defense' — which side to show in league-wide view
let sharpTable = null;      // which Sharp table is active in the league-wide view (set on first render)
let sharpSortCol = null;    // active sort column in league-wide view
let sharpSortDir = 1;       // 1 = best-first (rank asc), -1 = worst-first
let activeSeason = 'proj';   // 'proj' = working projections, or a year string for read-only reference
let sleeperPlayers = null;   // cached Sleeper player DB (id → meta), fetched once
let sleeperPlayersPromise = null;   // shared in-flight promise so concurrent callers dedupe
let seasonStatsCache = {};   // season → seed-shaped data built from Sleeper stats
let espnRecordCache = {};    // 'season:TEAM' → record string (from ESPN)
let seasonLoading = false;   // guard for loadSeason to prevent concurrent loads
let seasonStatsFetching = {};// per-season guard for background ensureSeasonStats
// Live draft follow
let draftId = null;
let draftedIds = {};         // player_id → true
let draftTimer = null;
let hideDrafted = false;     // toggle: strike-through vs hide
// ── Roster tracker ──────────────────────────────────────────────────────────
// Built from the live draft: buckets every pick into per-slot rosters, ties each slot
// to its Sleeper username, and slots players into a lineup (real league settings when a
// league is linked, else a generic default). "My slot" is auto-detected from a linked
// league's draft_order, or tapped once for a pasted mock draft.
const DEFAULT_LINEUP = ['QB','RB','RB','WR','WR','TE','FLEX','K','DEF'];
const DEFAULT_BENCH = 5;   // generic default bench size (synced to real league/draft when linked)
const FLEX_ELIGIBLE = { FLEX:['RB','WR','TE'], WRRB_FLEX:['RB','WR'], REC_FLEX:['WR','TE'], SUPER_FLEX:['QB','RB','WR','TE'] };
let draftMeta = null;        // the Sleeper draft object (draft_order, slot_to_roster_id, settings, metadata)
let draftLineup = DEFAULT_LINEUP.slice();  // starter slots (+bench) for this draft
let draftBenchCount = DEFAULT_BENCH;     // number of BN slots
let draftUsers = {};         // user_id → display_name
let draftPicksBySlot = {};   // slot number → [ {player_id, name, pos, team, pick_no}, ... ]
let mySlot = null;           // which draft slot is "mine"
let trackerOpen = false;     // is the expanded tracker panel showing?
let trackerViewSlot = null;  // which slot's roster is being viewed in the panel (null = mine)
let rosterBarVisible = false;// is the pinned bar shown at all?
let _trackerNeedsSlotPick = false;  // mock draft: waiting for the user to tap their seat
let _lastPickCount = -1;            // last seen pick count (skip redundant bar re-renders)
let scoringSettings = {
  passing_yards_points:1, passing_yards_yardage:25,
  passing_touchdowns:6, interceptions_thrown:-2,
  passing_attempts:0, passing_completions:0,
  receiving_yards_points:1, receiving_yards_yardage:10,
  receiving_touchdowns:6, receptions:0.5,
  rushing_yards_points:1, rushing_yards_yardage:10,
  rushing_touchdowns:6, rushing_attempts:0,
  fumbles_lost:-2,
};

function getBase(team,pos){ return (SEED[team]||{})[pos]||[]; }

// Ensure every skill player Sleeper lists on this team's CURRENT roster appears in the
// projection seed, even with zero stats — so a user can dial up a player like Erick All Jr
// who has no baseline projection. Only runs for the projection season (not historical).
// We track which teams have been merged in a SEPARATE Set (not a flag stored inside
// SEED[team]) so the position object never contains anything but QB/RB/WR/TE arrays —
// otherwise a `for(pos in SEED[team])` elsewhere would trip over the flag.
let rosterMergedTeams = new Set();
function mergeRosterPlayers(team){
  if(activeSeason!=='proj') return;
  if(!sleeperPlayers || !SEED[team]) return;
  if(rosterMergedTeams.has(team)) return;          // once per team is enough
  const have=new Set();
  ['QB','RB','WR','TE'].forEach(pos=>(SEED[team][pos]||[]).forEach(p=>{
    if(p.player_id) have.add(p.player_id);
    have.add(normName(p.name));
  }));
  for(const pid in sleeperPlayers){
    const sp=sleeperPlayers[pid];
    if(sp.team!==team) continue;
    if(!POS_KEEP[sp.pos]) continue;
    if(have.has(pid) || have.has(normName(sp.name))) continue;
    if(!Array.isArray(SEED[team][sp.pos])) continue;
    // add a zeroed-out entry so the player is selectable with sliders at 0
    SEED[team][sp.pos].push({
      name:sp.name, player_id:pid, pos:sp.pos, team:team, slug:null, headshot:null, age:sp.age||null,
      passing_yards:0,passing_touchdowns:0,passing_attempts:0,passing_completions:0,interceptions_thrown:0,
      rushing_yards:0,rushing_tds:0,rushing_attempts:0,
      receiving_targets:0,receptions:0,receiving_yards:0,receiving_tds:0,
      adp:999,adp_ppr:999,adp_half_ppr:999,adp_2qb:999,games_played:0,
    });
  }
  rosterMergedTeams.add(team);
}
function deepCopy(o){ return JSON.parse(JSON.stringify(o)); }
function markDirty(){ if(importedSnapshot) dirtySinceImport = true; saveSession(); }

// ── Per-team undo history ──────────────────────────────────────────────────
// Each team keeps its own stack of state snapshots so you can step back through
// just that team's edits without touching any other team's projections. Snapshots
// always capture the WORKING set for that team (workingProj[team]) — not whatever
// view is currently on screen — so this also covers actions triggered from a
// reference-season page, like "copy team to working set" or "copy player to working
// set" (e.g. copying Michael Pittman's 2025 Colts season onto his new Steelers slot).
// A snapshot is taken right before a mutation begins (slider drag start, an editable-
// field commit, or a copy-to-working action). We cap the stack so memory stays bounded.
const UNDO_LIMIT = 40;
let undoStacks = {};   // team -> [snapshot|null, ...] (oldest first; null = "didn't exist yet")
// Snapshot the given team's working-set state (AND the underlying proj-seed roster row,
// since copy-to-working actions mutate both — see copyTeamToWorking/copyPlayerToWorking)
// before it's about to change. `coalesceKey` lets a continuous interaction (one slider
// drag) push only a single snapshot instead of one per tick. Discrete one-shot actions
// (copy-to-working) should omit coalesceKey so every call attempts a fresh snapshot (true
// no-ops are still caught by the dedup check).
let _lastUndoKey = null;
function pushUndo(team, coalesceKey){
  if(!team) return;
  if(coalesceKey && coalesceKey===_lastUndoKey) return;  // same interaction, already snapped
  _lastUndoKey = coalesceKey || null;
  const stack = undoStacks[team] || (undoStacks[team]=[]);
  const curWorking = workingProj[team];
  const curSeed = projSeed && projSeed[team];
  const snap = {
    working: curWorking ? deepCopy(curWorking) : null,   // null = team had no working state yet
    seed: curSeed ? deepCopy(curSeed) : null,             // null = team had no proj-seed roster row yet
  };
  const snapStr = JSON.stringify(snap);
  // Skip if identical to the most recent snapshot (e.g. focus+blur with no real change,
  // or clicking "copy" twice with nothing different to copy).
  if(stack.length && JSON.stringify(stack[stack.length-1])===snapStr) return;
  stack.push(snap);
  if(stack.length>UNDO_LIMIT) stack.shift();
  updateUndoButton();
}
function clearUndoCoalesce(){ _lastUndoKey=null; }
function canUndo(team){ return !!(team && undoStacks[team] && undoStacks[team].length); }
function undoTeam(team){
  if(!canUndo(team)) return;
  const prev = undoStacks[team].pop();
  if(prev.working===null) delete workingProj[team];   // reverts to "never copied/edited"
  else workingProj[team] = prev.working;
  // Also revert the underlying proj-seed roster row (copy-to-working mutates the seed
  // roster, not just the working set) — otherwise a later rebuild for this team would
  // still start from the copied-in stat line even after "undoing" it.
  if(projSeed){
    if(prev.seed===null) delete projSeed[team];
    else projSeed[team] = prev.seed;
  }
  markDirty();
  // If the working (proj) view is on screen, refresh immediately so the change is visible.
  // (userProj IS workingProj in proj mode.) If undo fully deleted the team (reverted to
  // "never existed"), rebuild a valid default via ensureTeam first — otherwise rendering
  // the currently-displayed team would crash on an undefined state.
  if(activeSeason==='proj'){
    if(currentTeam) ensureTeam(currentTeam);
    renderContent();
  } else {
    updateUndoButton();   // viewing a reference season: nothing on screen changes, just the button
  }
  const n=undoStacks[team].length;
  toast(`Undid last working-set change to ${team}${n?` · ${n} more step${n===1?'':'s'} available`:''}`,'ok');
}
function updateUndoButton(){
  const btn=document.getElementById('undoBtn');
  if(!btn) return;
  const team=currentTeam;
  const n = team && undoStacks[team] ? undoStacks[team].length : 0;
  btn.disabled = !n;
  btn.classList.toggle('disabled', !n);
  btn.title = n ? `Undo last working-set change to ${team} (${n} step${n===1?'':'s'} available)` : `Nothing to undo for ${team}'s working set`;
  const cnt=document.getElementById('undoCount');
  if(cnt) cnt.textContent = n? ` ${n}`:'';
}

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
    if(!c || c.v!==2) return c;
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
        return {sig:sigOrder[fi], n, share, pass_rate, epa, succ,
                np, ep, sp, nr:n-np, er, sr, lanes:decLanes(lanesC)};
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
// ─────────────────────────────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────────────────────────────
function toast(msg,type=''){
  const el=document.getElementById('toast');
  el.textContent=msg;
  el.style.borderColor=type==='ok'?'var(--success)':type==='err'?'var(--danger)':'var(--border)';
  el.classList.add('show');
  clearTimeout(el._t);
  el._t=setTimeout(()=>el.classList.remove('show'),2800);
}

function mkDelta(cur,base,invert){
  const d=+cur-+base;
  if(Math.abs(d)<0.05) return '';
  const s=d>0?'+':'',v=Math.abs(d)<10?d.toFixed(1):Math.round(d);
  // For "bad" stats (interceptions, fumbles) an increase should read RED, not green.
  const good = invert ? (d<0) : (d>0);
  return `<span class="${good?'delta-up':'delta-dn'}">${s}${v}</span>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Slider fill (div overlay, pixel-perfect)
// ─────────────────────────────────────────────────────────────────────────────
function setFill(el,color){
  const min=parseFloat(el.min)||0,max=parseFloat(el.max)||100,v=parseFloat(el.value)||0;
  const pct=Math.max(0,Math.min(100,(v-min)/(max-min)*100));
  const fill=el.previousElementSibling;
  if(fill&&fill.classList.contains('slider-fill')){
    fill.style.width=pct+'%';
    if(color) fill.style.background=color;
  }
}

function initSliders(){
  document.querySelectorAll('input.sl').forEach(el=>{
    setFill(el,el.dataset.col||null);
    el.oninput=function(){ setFill(this,this.dataset.col||null); handleSlider(this); };
    // Resort the player list only when the user releases the slider (avoids glitchy
    // reordering mid-drag). 'change' fires on pointer-up / keyboard commit.
    el.onchange=function(){ resortAfterRelease(this); };
  });
}
// Set true while a share slider is mid-drag so live updaters skip the DOM reorder.
let sliderDragging=false;
function resortAfterRelease(el){
  sliderDragging=false;
  clearUndoCoalesce();   // next drag starts a fresh undo step
  const key=el.dataset.key||'';
  const state=userProj[el.dataset.team]; if(!state) return;
  if(key.startsWith('ps_')) reorderShareBlocks('shareControls','pblk-',state.passing_shares,'share');
  else if(key.startsWith('tds_')) reorderShareBlocks('shareControls','pblk-',state.passing_shares,'td_share');
  else if(key.startsWith('rs_')) reorderShareBlocks('rushShareControls','rblk-',state.rushing.shares,'share');
  else if(key.startsWith('rtds_')) reorderShareBlocks('rushShareControls','rblk-',state.rushing.shares,'td_share');
}

// ─────────────────────────────────────────────────────────────────────────────
// Slider row builders
// ─────────────────────────────────────────────────────────────────────────────
function sRow(key,label,cur,base,min,max,step,col,invert){
  col=col||'var(--accent)';
  const pct=Math.max(0,Math.min(100,(cur-min)/(max-min)*100));
  const disp=(step<1&&cur%1!==0)?(+cur).toFixed(2):Math.round(cur*10)/10;
  const bDisp=(step<1&&base%1!==0)?(+base).toFixed(2):Math.round(+base);
  return `<div class="stat-row" id="row-${key}" data-invert="${invert?1:0}">
    <div class="stat-header">
      <span class="stat-label">${label}</span>
      <div class="stat-val-group">
        <span class="stat-current" id="sv-${key}" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="manualEdit('${key}',this.textContent,${min},${max})"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">${disp}</span>
        <span class="stat-baseline">/ ${bDisp}</span>
        <span id="sd-${key}">${mkDelta(cur,base,invert)}</span>
      </div>
    </div>
    <div class="slider-track">
      <div class="slider-fill" style="width:${pct}%;background:${col}"></div>
      <input class="sl" type="range" min="${min}" max="${max}" step="${step}" value="${cur}"
        data-key="${key}" data-team="${currentTeam}" data-col="${col}" style="--col:${col}">
    </div>
    <div class="slider-labels"><span>${min}</span><span>${max}</span></div>
  </div>`;
}
function selAll(el){
  // Snapshot the team before this field is edited, so a single edit is one undo step.
  // Coalesced per element so re-selecting the same field doesn't stack duplicates.
  pushUndo(currentTeam, 'edit:'+(el.id||el.getAttribute('onblur')||'field'));
  setTimeout(()=>{ const r=document.createRange();r.selectNodeContents(el);
    const s=window.getSelection();s.removeAllRanges();s.addRange(r);},0);
}
function manualEdit(key,raw,min,max){
  const v=parseFloat(raw);
  if(isNaN(v)){ renderContent(); return; }
  const clamped=Math.max(min,Math.min(max,v));
  const sl=document.querySelector(`input.sl[data-key="${key}"]`);
  if(sl){ sl.value=clamped; setFill(sl,sl.dataset.col||null); handleSliderKey(key,clamped,currentTeam,true); }
  else { handleSliderKey(key,clamped,currentTeam,true); }
}


// ─────────────────────────────────────────────────────────────────────────────
// State init
// ─────────────────────────────────────────────────────────────────────────────
function ensureTeam(team,qbsFromData){
  if(userProj[team]) return userProj[team];
  mergeRosterPlayers(team);   // add zero-stat rostered players so they're selectable
  const seedQBs=getBase(team,'QB');
  const src=qbsFromData||seedQBs;
  userProj[team]={
    qbs:src.map((qb,i)=>{
      const gp=parseFloat(qb.games_played)||0;
      // Prefer the seed's projected `games` (set by projectQBGames from yard share);
      // fall back to real gp, then to a sensible default (starter full season, backups 0).
      let games;
      if(qb.games!=null) games=parseFloat(qb.games)||0;
      else if(gp>0 && gp<=SEASON_GAMES) games=gp;  // real historical gp (≤17)
      else games = (i===0?SEASON_GAMES:0);
      const baseStats = (games>0?games:1);
      const o={
        name:qb.name,headshot:qb.headshot||null,slug:qb.slug||null,player_id:qb.player_id||null,
        adp:parseFloat(qb.adp)||999,adp_ppr:parseFloat(qb.adp_ppr)||999,
        adp_half_ppr:parseFloat(qb.adp_half_ppr)||999,adp_2qb:parseFloat(qb.adp_2qb)||999,
        passing_yards:parseFloat(qb.passing_yards)||0,
        passing_tds:parseFloat(qb.passing_touchdowns||qb.passing_tds)||0,
        passing_attempts:parseFloat(qb.passing_attempts)||0,
        passing_completions:parseFloat(qb.passing_completions)||0,
        interceptions_thrown:parseFloat(qb.interceptions_thrown)||0,
        qb_rush_yards:parseFloat(qb.rushing_yards)||0,
        qb_rush_tds:parseFloat(qb.rushing_touchdowns||qb.rushing_tds)||0,
        qb_rush_attempts:parseFloat(qb.rushing_attempts)||0,
        games_played:(gp<=SEASON_GAMES?gp:0),
        games:games,
        base_games:baseStats,
        snap_pct:(qb.snap_pct!=null)?qb.snap_pct:100,
        snap_share:(typeof qb.snap_share==='number')?qb.snap_share:1/src.length,
      };
      return o;
    }),
    activeQB:0, passing_shares:null,
    rushing:{mode:'carries',total_attempts:null,total_yards:null,ypa:null,shares:null}
  };
  return userProj[team];
}

// Per-game rate for a QB stat. Prefers the stored rate snapshot (survives 0 games),
// else derives from current totals / base_games.
function perGame(qb,key){
  if(qb._rate && qb._rate[key]!=null) return qb._rate[key];
  const bg=qb.base_games||1; return (qb[key]||0)/bg;
}
// Stat projected to the QB's current `games` setting (pace × games).
function pace(qb,key){ return perGame(qb,key)*(qb.games||0); }

function initPassingShares(team){
  const state=ensureTeam(team);
  if(state.passing_shares) return;
  // Include ALL WR/TE on the roster (even zero-stat, so upside picks like a buried TE are
  // selectable), plus RBs with meaningful receiving work.
  let all=[...getBase(team,'WR'),...getBase(team,'TE'),
    ...getBase(team,'RB').filter(p=>(p.receiving_targets>5)||(p.receptions>5))];
  // Reference-season week-range filter active? Overlay windowed totals onto the roster
  // before computing shares — everything downstream (pies, edits) just works on it.
  if(isWeekFilterActive(state) && state.weekFilterData) all=applyWeekFilterOverrides(all, state.weekFilterData);
  // If targets are missing entirely, fall back to receptions for the share denominator.
  const hasTargets = all.some(p=>p.receiving_targets>0);
  const weightOf = p => hasTargets ? (p.receiving_targets||0) : (p.receptions||0);
  const total=all.reduce((s,p)=>s+weightOf(p),0)||1;
  const totalTDs=all.reduce((s,p)=>s+(p.receiving_tds||0),0)||0;
  // Anchor the team target pool to the ACTUAL sum of receiver targets in the data,
  // so share×pool reproduces each player's real targets exactly (no inflation).
  // teamPassAtt×TARGET_RATE is only used as a fallback if no receiver data exists.
  state.team_targets = total;
  state.base_pass_att = teamPassAtt(state); // QB attempts at the moment shares were built
  state.passing_shares=all.map(p=>{
    // If targets are missing, estimate them from receptions so per-player math works.
    const cr = p.pos==='TE' ? 0.68 : 0.65;
    const tgts = p.receiving_targets>0 ? p.receiving_targets
               : (p.receptions>0 ? Math.round(p.receptions/cr) : 0);
    return {
      name:p.name,pos:p.pos,headshot:p.headshot||null,slug:p.slug||null,player_id:p.player_id||null,
      baseline_targets:tgts,baseline_yards:p.receiving_yards,
      baseline_tds:p.receiving_tds||0,baseline_rec:p.receptions,
      share:weightOf(p)/total,
      td_share:totalTDs>0?(p.receiving_tds||0)/totalTDs:1/all.length,
      ypt:tgts>0?p.receiving_yards/tgts:9,
      catch_rate:tgts>0?p.receptions/tgts:cr,
      adp:parseFloat(p.adp)||999,adp_ppr:parseFloat(p.adp_ppr)||999,adp_half_ppr:parseFloat(p.adp_half_ppr)||999,adp_2qb:parseFloat(p.adp_2qb)||999,
    };
  });
  // team_targets should reflect derived targets when actuals are missing
  state.team_targets = state.passing_shares.reduce((s,p)=>s+p.baseline_targets,0)||total;
}

function initRushingShares(team){
  const state=ensureTeam(team);
  if(state.rushing.shares) return;
  let rbs=getBase(team,'RB');
  if(isWeekFilterActive(state) && state.weekFilterData) rbs=applyWeekFilterOverrides(rbs, state.weekFilterData);
  const elig=rbs.filter(p=>p.rushing_attempts>0||p.adp<300);
  const src=elig.length?elig:rbs.slice(0,2);
  const totalAtt=src.reduce((s,p)=>s+p.rushing_attempts,0)||200;
  const totalYds=src.reduce((s,p)=>s+p.rushing_yards,0)||1600;
  const totalTDs=src.reduce((s,p)=>s+(p.rushing_tds||0),0)||0;
  state.rushing.total_attempts=totalAtt;
  state.rushing.total_yards=totalYds;
  state.rushing.ypa=totalAtt>0?totalYds/totalAtt:4.0;
  state.rushing.total_rush_tds=totalTDs;
  state.rushing.shares=src.map(p=>({
    name:p.name,pos:'RB',headshot:p.headshot||null,slug:p.slug||null,player_id:p.player_id||null,
    baseline_att:p.rushing_attempts,baseline_yards:p.rushing_yards,baseline_tds:p.rushing_tds||0,
    share:totalAtt>0?p.rushing_attempts/totalAtt:1/src.length,
    td_share:totalTDs>0?(p.rushing_tds||0)/totalTDs:1/src.length,
    ypc:p.rushing_attempts>0?p.rushing_yards/p.rushing_attempts:4.0,
    adp:parseFloat(p.adp)||999,adp_ppr:parseFloat(p.adp_ppr)||999,adp_half_ppr:parseFloat(p.adp_half_ppr)||999,adp_2qb:parseFloat(p.adp_2qb)||999,
  }));
  recomputeTeamRushYards(state); // sync total yards to sum of per-player (att×ypc)
}

// Team rush TD total — held in state so editing a player's absolute TDs can grow/shrink it.
function teamRushTDs(state){
  const r=state.rushing;
  if(r&&typeof r.total_rush_tds==='number') return r.total_rush_tds;
  return r&&r.shares ? r.shares.reduce((s,p)=>s+(p.baseline_tds||0),0)||0 : 0;
}

// Team rush yards = sum of each RB's (carries × their ypc). Keeps pie + total in sync.
function recomputeTeamRushYards(state){
  const r=state.rushing;
  if(!r.shares) return;
  let total=0;
  r.shares.forEach(p=>{ total += Math.round(p.share*r.total_attempts)*(p.ypc||r.ypa||4); });
  r.total_yards=Math.round(total);
  if(r.total_attempts>0) r.ypa=r.total_yards/r.total_attempts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────────────────────────
const SIDEBAR_DIVISIONS = [
  { title:'AFC North', teams:['CIN','PIT','BAL','CLE'] },
  { title:'AFC South', teams:['HOU','JAX','TEN','IND'] },
  { title:'AFC East',  teams:['BUF','NE','MIA','NYJ'] },
  { title:'AFC West',  teams:['KC','LAC','LV','DEN'] },
  { title:'NFC North', teams:['GB','DET','MIN','CHI'] },
  { title:'NFC South', teams:['TB','CAR','ATL','NO'] },
  { title:'NFC East',  teams:['PHI','DAL','WAS','NYG'] },
  { title:'NFC West',  teams:['LAR','SF','SEA','ARI'] },
];

const SIDEBAR_TEAM_LABEL = {
  CIN:'Bengals', PIT:'Steelers', BAL:'Ravens', CLE:'Browns',
  HOU:'Texans', JAX:'Jaguars', TEN:'Titans', IND:'Colts',
  BUF:'Bills', NE:'Patriots', MIA:'Dolphins', NYJ:'Jets',
  KC:'Chiefs', LAC:'Chargers', LV:'Raiders', DEN:'Broncos',
  GB:'Packers', DET:'Lions', MIN:'Vikings', CHI:'Bears',
  TB:'Buccaneers', CAR:'Panthers', ATL:'Atlanta', NO:'Saints',
  PHI:'Eagles', DAL:'Cowboys', WAS:'Commanders', NYG:'Giants',
  LAR:'Rams', SF:'49ers', SEA:'Seahawks', ARI:'Cardinals',
};

function sidebarTeamLabel(t){
  return SIDEBAR_TEAM_LABEL[t] || t;
}

let mobileTeamPickerExpanded = false;

function isMobileTeamPickerLayout(){
  return !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
}

function toggleMobileTeamPicker(){
  if(!isMobileTeamPickerLayout()) return;
  mobileTeamPickerExpanded = !mobileTeamPickerExpanded;
  renderSidebar();
}

function renderSidebar(){
  const sb=document.getElementById('sidebar');
  let done=0;
  const doneClass = t => {
    const st=userProj[t]; if(!st) return '';
    const a=st.qbs&&st.qbs[0]&&st.qbs[0].passing_yards>0;
    const b=!!st.passing_shares;const c=!!st.rushing.shares;
    if(a&&b&&c){ done++; return 'done'; }
    return (a||b||c) ? 'partial' : '';
  };

  const mkTeamItem = (t, cls) => `<div class="team-item ${t===currentTeam?'active':''}" onclick="selectTeam('${t}')">
    <img src="${NFL_LOGO(t)}" class="team-logo-sm" alt="${t}" onerror="this.style.display='none'">
    <div class="team-dot ${cls}"></div><span class="team-name">${sidebarTeamLabel(t)}</span></div>`;

  const conferences = [
    { title:'AFC', divisions:SIDEBAR_DIVISIONS.filter(d=>d.title.startsWith('AFC')) },
    { title:'NFC', divisions:SIDEBAR_DIVISIONS.filter(d=>d.title.startsWith('NFC')) },
  ];

  const groupsHtml = conferences.map(conf=>{
    const divisionHtml = conf.divisions.map(div=>{
      const teamsHtml = div.teams.map(t=>mkTeamItem(t, doneClass(t))).join('');
      return `<div class="sidebar-division-block">
        <div class="sidebar-section">${div.title}</div>
        <div class="sidebar-team-grid">${teamsHtml}</div>
      </div>`;
    }).join('');
    return `<div class="sidebar-conference-block">
      <div class="sidebar-conference-title">${conf.title}</div>
      <div class="sidebar-division-grid">${divisionHtml}</div>
    </div>`;
  }).join('');

  const mobile = isMobileTeamPickerLayout();
  const hasTeam = !!currentTeam;
  const selectedLabel = hasTeam ? `${sidebarTeamLabel(currentTeam)} (${currentTeam})` : 'Select Team';
  const chevron = mobileTeamPickerExpanded ? '▾' : '▸';
  const mobileToggle = `<button class="team-picker-toggle" onclick="toggleMobileTeamPicker()" aria-expanded="${mobileTeamPickerExpanded?'true':'false'}" title="Tap to ${mobileTeamPickerExpanded?'collapse':'expand'} team selector">
    <span class="team-picker-toggle-label">Teams: ${selectedLabel}</span>
    <span class="team-picker-toggle-icon">${chevron}</span>
  </button>`;

  const collapsedClass = (mobile && !mobileTeamPickerExpanded) ? 'mobile-collapsed' : '';
  const html = `${mobileToggle}<div class="sidebar-groups ${collapsedClass}">${groupsHtml}</div>`;

  sb.innerHTML=html;
  document.getElementById('progressText').textContent=`${done}/32 teams`;
  document.getElementById('progressFill').style.width=`${done/32*100}%`;
}

function selectTeam(t){
  currentTeam=t;
  // Keep whatever phase the user was on (Targets stays Targets across teams). Only the
  // global Rankings view falls back to a per-team phase since it isn't team-scoped here.
  if(currentPhase==='Rankings') currentPhase='Passing';
  ensureTeam(t);
  // make sure shares exist so the targets/rushing tab is populated as if previously opened
  if(currentPhase==='Passing') initPassingShares(t);
  else if(currentPhase==='Rushing') initRushingShares(t);
  if(isMobileTeamPickerLayout()) mobileTeamPickerExpanded=false;
  renderSidebar();renderContent();
}
function setPhase(p){
  // The per-team "Rankings" phase tab is team-scoped; the header 🏆 button is league-wide.
  if(p==='Rankings') rankScope='team';
  // The Advanced tab is per-team; if no team is selected, fall back to the league-wide view.
  if(p==='Advanced' && !currentTeam){ showSharpLeague(); return; }
  currentPhase=p;renderContent();
}
function showFullRankings(){ rankScope='all'; currentPhase='Rankings'; renderContent(); }

function renderContent(){
  if(currentPhase==='Rankings'){renderRankings();return;}
  if(currentPhase==='AdvancedLeague'){renderSharpLeague();return;}
  if(!currentTeam){document.getElementById('content').innerHTML=emptyHTML();return;}
  const t=currentTeam,state=userProj[t];
  const tabs=tabBar();
  let body='';
  if(currentPhase==='QB') body=renderQB(t,state);
  else if(currentPhase==='Passing'){initPassingShares(t);body=renderPassing(t,state);}
  else if(currentPhase==='Rushing'){initRushingShares(t);body=renderRushing(t,state);}
  else if(currentPhase==='Advanced') body=renderTeamAdvanced(t);
  else if(currentPhase==='Additions') body=renderTeamAdditions(t);
  const prev=TEAMS[TEAMS.indexOf(t)-1],next=TEAMS[TEAMS.indexOf(t)+1];
  const isRef = activeSeason!=='proj';
  const recKey = `${activeSeason}:${t}`;
  // In reference mode, fetch this team's record if we don't have it yet (covers switching
  // teams while already viewing a past season — not just entering the season first).
  if(isRef && espnRecordCache[recKey]==null) fetchTeamRecord(activeSeason,t);
  const recStr = isRef ? (espnRecordCache[recKey]||'') : '';
  const seasonBanner = isRef
    ? `<div class="season-readonly">📅 <b>${activeSeason} actual stats</b>${recStr?` · <b>${recStr}</b> record`:''} — read-only reference. Your ${PROJ_SEASON} working projections are untouched.
       ${canUndo(t)?`<button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="undoTeam('${t}')" title="Undo the last working-set change for ${t}">↶ Undo last copy</button>`:''}
       <button class="btn btn-accent btn-sm" ${canUndo(t)?'':'style="margin-left:auto"'} onclick="copyTeamToWorking('${t}')">⤵ Copy team to ${PROJ_SEASON} working set</button></div>`
    : '';
  const sos = SOS && SOS[t];
  const sosBadge = sos ? `<span class="team-sos">SOS: <b>${ordinal(sos.rank)}</b>${sos.win_total!=null?` · Vegas Win Total: <b>${sos.win_total}</b>`:''}</span>` : '';
  // Head coach (live from ESPN). Kick off the fetch if we haven't yet; the render re-runs
  // when it resolves. Show a compact line under the QBs, flagging offensive-playcaller HCs.
  if(headCoaches[t]===undefined) fetchHeadCoach(t);
  const hc=headCoaches[t];
  const hcCaller = hcIsPlaycaller(t);
  const hcLine = hc ? `<div class="team-hc scheme-open" role="button" tabindex="0" title="Open coaching scheme visualization" onclick="openTeamCoachingScheme('${t}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openTeamCoachingScheme('${t}');}">
      ${hc.headshot?`<img src="${hc.headshot}" class="team-hc-img" onerror="this.style.display='none'">`:''}
      <span class="team-hc-label">HC</span> <b>${hc.name}</b>${hc.experience!=null?` · yr ${hc.experience}`:''}
      ${hcCaller?`<span class="hc-caller" title="This head coach is the team's primary offensive playcaller — the OC is less pivotal for scheme continuity.">🎧 Primary playcaller</span>`:''}
    </div>` : (headCoaches[t]===null?'':`<div class="team-hc team-hc-loading">Loading head coach…</div>`);
  document.getElementById('content').innerHTML=`
    <div class="team-header">
      <img src="${NFL_LOGO(t)}" class="team-logo-lg scheme-open" alt="${t}" title="Open coaching scheme visualization" onclick="openTeamCoachingScheme('${t}')" onerror="this.style.opacity='.25'">
      <div><div class="team-abbr team-fullname scheme-open" role="button" tabindex="0" title="Open coaching scheme visualization" onclick="openTeamCoachingScheme('${t}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openTeamCoachingScheme('${t}');}">${teamDisplayName(t)} ${isRef?`<span class="ref-year">${activeSeason}</span>`:''}</div>
        <div class="team-qb-name">${(state.qbs&&state.qbs.length)?state.qbs.map(q=>q.name).join(' / '):'No projected QB'}${recStr?` · ${recStr}`:''}</div>
        ${hcLine}
        ${sosBadge?`<div class="team-sos-row">${sosBadge}</div>`:''}</div>
      <div class="team-nav">
        <button id="undoBtn" class="btn btn-ghost undo-btn ${canUndo(t)?'':'disabled'}" ${canUndo(t)?'':'disabled'} onclick="undoTeam('${t}')" title="Undo last working-set change to ${t}">↶ ${isRef?'Undo':'Undo'}<span id="undoCount">${canUndo(t)?' '+undoStacks[t].length:''}</span></button>
        ${prev?`<button class="btn btn-ghost" onclick="selectTeam('${prev}')">← ${prev}</button>`:''}
        ${next?`<button class="btn btn-accent" onclick="selectTeam('${next}')">${next} →</button>`:''}
      </div>
    </div>
    ${seasonBanner}
    <div class="phase-tabs">${tabs}</div>${body}
    <div id="schemeOverlayHost"></div>`;
  if(currentPhase==='Passing') initPie(t,'pass');
  else if(currentPhase==='Rushing') initPie(t,'rush');
  initSliders();
  updateUndoButton();
}
function tabBar(){
  const hasSharp = (typeof sharpHasData==='function' ? sharpHasData() : false) || (SOS && Object.keys(SOS).length>0);
  const tabs=[['QB','⚡ QB'],['Passing','🎯 Targets'],['Rushing','💨 Rushing']];
  if(hasSharp) tabs.push(['Advanced','📊 Advanced Stats']);
  // "Roster Changes" appears when the currently-selected team has Spotrac data.
  if(currentTeam && ADDITIONS && ADDITIONS[currentTeam]) tabs.push(['Additions','🔄 Roster Changes']);
  tabs.push(['Rankings','🏆 Rankings']);
  // Treat the league-wide advanced view as the same visual tab as the per-team one.
  const phaseForTab = (currentPhase==='AdvancedLeague') ? 'Advanced' : currentPhase;
  return tabs.map(([p,l])=>`<button class="phase-tab ${phaseForTab===p?'active':''}" onclick="setPhase('${p}')">${l}</button>`).join('');
}
function emptyHTML(){return`<div class="empty"><div class="empty-icon">🏈</div>
  <div class="empty-title">Select a team to begin</div>
  <div class="empty-body">Work through each team's QB output, receiver target &amp; TD share,
  and RB rushing distribution. Click 🏆 Rankings any time to see fantasy scores.</div></div>`;}


// ─────────────────────────────────────────────────────────────────────────────
// QB Phase
// ─────────────────────────────────────────────────────────────────────────────
function renderQB(team,state){
  if(!state.qbs||!state.qbs.length){
    return `<div class="card"><div class="card-title">Passing Attack</div>
      <div class="alert alert-warn"><span class="alert-icon">⚠️</span>
      <div>No projected QB found for ${team} in this dataset. This can happen with historical
      seasons or sparse projections. Switch seasons or pull live ${PROJ_SEASON} projections.</div></div></div>`;
  }
  // Historical week-window active? Render a filtered QB view (totals + gp) without touching the
  // underlying projection state. This lets hurt/partial-season QB stretches be explored like the
  // WR/RB/TE tabs while keeping the working set intact.
  const qbs = (activeSeason!=='proj' && isWeekFilterActive(state) && state.weekFilterQBData)
    ? state.qbs.map(q=>{
        const f=q.player_id && state.weekFilterQBData[q.player_id];
        // Important: a QB can legitimately have ZERO games in the filtered window (injury / bye /
        // benching). In that case we must show a zeroed filtered slice, not fall back to the full-
        // season line, or the UI falsely claims he played his season-long total during the stretch.
        if(!f) return q;
        return Object.assign({}, q, {
          passing_yards:f.pass_yards, passing_tds:f.pass_td, passing_attempts:f.pass_att,
          passing_completions:f.comp, interceptions_thrown:f.pass_int,
          qb_rush_yards:f.rush_yards, qb_rush_tds:f.rush_td, qb_rush_attempts:f.rush_att,
          games_played:(f.games_played||0), games:(f.games_played||0), base_games:(f.games_played||1),
        });
      })
    : state.qbs;
  const isMulti=qbs.length>1;
  const idx=Math.min(state.activeQB||0, qbs.length-1);
  const qb=qbs[idx];
  const seed=getBase(team,'QB').find(q=>q.name===qb.name)||getBase(team,'QB')[0]||{};
  const compPct=qb.passing_attempts>0?(qb.passing_completions/qb.passing_attempts*100).toFixed(1):'0';
  const ypa=qb.passing_attempts>0?(qb.passing_yards/qb.passing_attempts).toFixed(2):'-';
  const teamGames=qbs.reduce((s,q)=>s+(q.games||0),0);
  const overBudget = teamGames > SEASON_GAMES + 0.5;
  const weekSlider=weekRangeSliderHTML(team,state);
  // Workload card: per-QB Games (0–17) slider. Drives pace extrapolation. A QB at 0
  // games contributes nothing to team totals but keeps his per-game pace for later.
  const workloadCard = `
    <div class="card">
      <div class="card-title">QB Workload ${isMulti?'<span class="split-badge">SPLIT SQUAD</span>':''}</div>
      ${qbs.map((q,i)=>{
        const gms=Math.round(q.games||0);
        const active = i===idx;
        return `<div class="snap-row" style="${active?'border:1px solid var(--qb)':''}">
          <span class="clickable-player" onclick="${pcardOnclick(q.player_id||q.name,'QB',currentTeam||'')}">${imgTag(hsURL(q),'player-headshot')}</span>
          <div class="snap-info" style="flex:1">
            <div style="font-size:12px;font-weight:700"><span class="clickable-player" onclick="${pcardOnclick(q.player_id||q.name,'QB',currentTeam||'')}">${q.name}</span>${weekFilterPaceButton(state,q.player_id,'qb')}
              ${q.games_played?`<span style="font-size:9px;color:var(--muted);font-weight:500">· actually played ${Math.round(q.games_played)}</span>`:''}</div>
            <div style="font-size:10px;color:var(--muted)" id="wl-sub-${i}">${gms} games · ${perGame(q,'passing_yards').toFixed(1)} pass yds/gm</div>
          </div>
          ${!active?`<button class="btn btn-ghost btn-sm" onclick="setActiveQB(${i})">edit</button>`:''}
          ${activeSeason!=='proj'&&q.player_id?`<button class="copy-btn" onclick="copyPlayerToWorking('${q.player_id}','QB')" title="Copy to ${PROJ_SEASON} working set">⤵</button>`:''}
        </div>
        ${sRow('games_'+i,'Games Played',gms,Math.round(q.games_played||q.games||0),0,SEASON_GAMES,1,'var(--qb)')}`;
      }).join('')}
      <div class="derived-note" id="qbWorkloadNote" style="${overBudget?'color:var(--warn)':''}">
        Team QB-games: ${teamGames.toFixed(0)} of ${SEASON_GAMES}${overBudget?' ⚠️ over a full season — combined QB workload exceeds 17 games':''}
      </div>
    </div>`;
  const games=Math.round(qb.games||0);
  return `${weekSlider}${workloadCard}<div class="card">
    <div class="card-title">${qb.name} — Passing ${isMulti?`<span style="font-size:9px;color:var(--muted)">(editing QB${idx+1} of ${state.qbs.length})</span>`:''}</div>
    ${isMulti?`<div class="qb-tab-bar">${state.qbs.map((q,i)=>
      `<button class="qb-tab ${i===idx?'active':''}" onclick="setActiveQB(${i})">${q.name.split(' ').pop()}</button>`).join('')}</div>`:''}
    <div class="player-row"><span class="clickable-player" onclick="${pcardOnclick(qb.player_id||qb.name,'QB',currentTeam||'')}">${imgTag(hsURL(qb),'player-headshot')}</span>
      <span class="pos-badge pos-QB">QB${idx+1}</span>
      <div class="player-name-block"><div class="player-name clickable-player" onclick="${pcardOnclick(qb.player_id||qb.name,'QB',currentTeam||'')}">${qb.name}</div>
        ${weekFilterPaceButton(state,qb.player_id,'qb')}
        <div class="player-sub">${(()=>{const e=ecrEntry({name:qb.name});return e&&e.rank_ecr!=null?`ECR ${e.rank_ecr}`:'';})()}${(()=>{const e=ecrEntry({name:qb.name});return e&&e.rank_ecr!=null?' · ':'';})()}<span id="qb-games-sub">${games}</span> games projected</div></div></div>
    <div class="alert alert-info" style="margin-bottom:11px"><span class="alert-icon">📈</span>
      <div>These are this QB's totals across <b>${games} games</b>. Adjust <b>Games Played</b> above to extrapolate a full-season pace (e.g. an 8-game stint scaled to 17), and the stats below scale with it.</div></div>
    ${sRow('py','Passing Yards',Math.round(qb.passing_yards),Math.round(seed.passing_yards||4000),0,7500,50)}
    ${sRow('ptd','Passing TDs',Math.round(qb.passing_tds),Math.round(seed.passing_tds||25),0,65,1)}
    ${sRow('patt','Pass Attempts',Math.round(qb.passing_attempts),Math.round(seed.passing_attempts||560),0,800,5)}
    ${sRow('pcomp','Completions',Math.round(qb.passing_completions),Math.round(seed.passing_completions||360),0,680,5)}
    ${sRow('int','Interceptions',Math.round(qb.interceptions_thrown),Math.round(seed.interceptions_thrown||10),0,40,1,'var(--danger)',true)}
    <div class="derived-note" id="qbDerived">Comp%: ${compPct}% · YPA: ${ypa} · Yds/TD: ${qb.passing_tds>0?Math.round(qb.passing_yards/qb.passing_tds):'-'} · per game: ${perGame(qb,'passing_yards').toFixed(1)} yds</div>
    <div style="margin-top:13px;padding-top:11px;border-top:1px solid var(--border)">
      <div class="card-title">QB Rushing</div>
      ${sRow('qbry','Rush Yards',Math.round(qb.qb_rush_yards),Math.round(seed.rushing_yards||0),0,1400,10,'var(--rb)')}
      ${sRow('qbrtd','Rush TDs',Math.round(qb.qb_rush_tds),Math.round(seed.rushing_tds||0),0,22,1,'var(--rb)')}
      ${sRow('qbratt','Rush Attempts',Math.round(qb.qb_rush_attempts),Math.round(seed.rushing_attempts||0),0,200,5,'var(--rb)')}
    </div>
    ${isMulti?`<div class="derived-note" id="qbTeamTotals" style="margin-top:10px">${qbTotalsText(state)}</div>`:''}
    <div class="stats-grid">
      <div class="stat-box"><div class="stat-box-label">Pass Yds</div><div class="stat-box-val" style="color:var(--qb)" id="sb-py">${Math.round(qb.passing_yards).toLocaleString()}</div></div>
      <div class="stat-box"><div class="stat-box-label">Pass TDs</div><div class="stat-box-val" style="color:var(--qb)" id="sb-ptd">${Math.round(qb.passing_tds)}</div></div>
      <div class="stat-box"><div class="stat-box-label">INTs</div><div class="stat-box-val" style="color:var(--danger)" id="sb-int">${Math.round(qb.interceptions_thrown)}</div></div>
      <div class="stat-box"><div class="stat-box-label">Rush Yds</div><div class="stat-box-val" style="color:var(--rb)" id="sb-ry">${Math.round(qb.qb_rush_yards)}</div></div>
      <div class="stat-box"><div class="stat-box-label">Rush TDs</div><div class="stat-box-val" style="color:var(--rb)" id="sb-rtd">${Math.round(qb.qb_rush_tds)}</div></div>
      <div class="stat-box"><div class="stat-box-label">Attempts</div><div class="stat-box-val" id="sb-att">${Math.round(qb.passing_attempts)}</div></div>
    </div></div>`;
}
function qbTotalsText(state){
  const qbs = state.qbs.filter(q=> (q.games||0) > 0);
  const y=qbs.reduce((s,q)=>s+q.passing_yards,0);
  const t=qbs.reduce((s,q)=>s+q.passing_tds,0);
  const a=qbs.reduce((s,q)=>s+q.passing_attempts,0);
  const i=qbs.reduce((s,q)=>s+q.interceptions_thrown,0);
  return `All QBs combined: ${Math.round(y).toLocaleString()} yds · ${Math.round(t)} TDs · ${Math.round(a)} att · ${Math.round(i)} INTs`;
}
function setActiveQB(idx){userProj[currentTeam].activeQB=idx;saveSession();renderContent();}

// ─────────────────────────────────────────────────────────────────────────────
// Passing Phase
// ─────────────────────────────────────────────────────────────────────────────
function teamPassAtt(state){
  if(isWeekFilterActive(state) && state.weekFilterQBPool) return state.weekFilterQBPool.pass_att;
  return state.qbs.filter(q=> (q.games||0) > 0).reduce((s,q)=>s+q.passing_attempts,0);
}
function teamPassTDs(state){
  if(isWeekFilterActive(state) && state.weekFilterQBPool) return state.weekFilterQBPool.pass_tds;
  return state.qbs.filter(q=> (q.games||0) > 0).reduce((s,q)=>s+q.passing_tds,0);
}

// The team's target pool. Anchored to the ACTUAL sum of receiver targets in the data
// (so historical seasons and untouched projections reproduce real numbers exactly).
// When the user changes QB pass attempts in projection mode, the pool scales from its
// baseline so receiver volume still cascades. Falls back to teamPassAtt×TARGET_RATE.
function teamTargetPool(state){
  const baseTargets = state.team_targets;
  if(!baseTargets){ return Math.round(teamPassAtt(state)*TARGET_RATE); }
  // baseline QB attempts captured the first time shares were built
  if(state.base_pass_att==null){ state.base_pass_att = teamPassAtt(state); }
  const curAtt = teamPassAtt(state);
  if(state.base_pass_att>0 && curAtt>0){
    return Math.round(baseTargets * (curAtt/state.base_pass_att));
  }
  return Math.round(baseTargets);
}

function renderPassing(team,state){
  const totalTgts=teamTargetPool(state);
  const totalTDs=teamPassTDs(state);
  const subTabs=`<div class="sub-tabs">
    <button class="sub-tab ${passingSubTab==='targets'?'active':''}" onclick="setPassSub('targets')">📊 Targets</button>
    <button class="sub-tab ${passingSubTab==='rec'?'active':''}" onclick="setPassSub('rec')">🧤 Receptions</button>
    <button class="sub-tab ${passingSubTab==='recyds'?'active':''}" onclick="setPassSub('recyds')">📏 Rec Yards</button>
    <button class="sub-tab ${passingSubTab==='rec_tds'?'active':''}" onclick="setPassSub('rec_tds')">🎯 TD Share</button></div>`;
  const weekSlider=weekRangeSliderHTML(team,state);
  const body = passingSubTab==='targets' ? renderPassTargets(team,state,totalTgts,totalTDs,subTabs)
    : passingSubTab==='rec' ? renderPassDerived(team,state,subTabs,'rec')
    : passingSubTab==='recyds' ? renderPassDerived(team,state,subTabs,'recyds')
    : renderPassTDs(team,state,totalTDs,subTabs);
  return weekSlider + body;
}
// Dual-handle week-range slider, shown only in reference mode. Lets the user filter the
// Targets/Rushing tabs down to a stretch of weeks (e.g. a player's hot streak before injury).
function weekRangeSliderHTML(team,state){
  if(activeSeason==='proj') return '';
  const [lo,hi]=state.weekFilter||[1,18];
  const active=isWeekFilterActive(state);
  const loPct=(lo-1)/17*100, hiPct=(18-hi)/17*100;
  return `<div class="week-range-card">
    <div class="week-range-label">
      <span>📅 Filter weeks: <b id="wr-lo-${team}">${lo}</b> – <b id="wr-hi-${team}">${hi}</b>${state.weekFilterLoading?' <span class="week-range-loading">loading…</span>':''}</span>
      ${active?`<span class="week-range-reset" onclick="resetWeekRange('${team}')">↺ Reset to full season</span>`:'<span class="week-range-hint">drag either end to zoom into a stretch of games</span>'}
    </div>
    <div class="dual-slider">
      <div class="dual-slider-track"></div>
      <div class="dual-slider-fill" id="wr-fill-${team}" style="left:${loPct}%;right:${hiPct}%"></div>
      <input type="range" min="1" max="18" step="1" value="${lo}" class="dual-range dual-range-lo"
        oninput="weekRangeDrag('${team}','lo',this.value)" onchange="weekRangeCommit('${team}')">
      <input type="range" min="1" max="18" step="1" value="${hi}" class="dual-range dual-range-hi"
        oninput="weekRangeDrag('${team}','hi',this.value)" onchange="weekRangeCommit('${team}')">
    </div>
  </div>`;
}
function setPassSub(t){passingSubTab=t;renderContent();}

// Total receiving yardage available = the QBs' combined passing yards (identity: team
// passing yards == team receiving yards). Used as the rec-yards pool/denominator.
function teamRecYardsPool(state){
  if(isWeekFilterActive(state) && state.weekFilterQBPool) return Math.round(state.weekFilterQBPool.pass_yards);
  return Math.round(state.qbs.filter(q=> (q.games||0) > 0).reduce((s,q)=>s+(q.passing_yards||0),0));
}
// Total receptions available = the QBs' combined completions (identity: completions ==
// receptions at the team level). This is what the receivers' catches should sum to.
function teamRecPool(state){
  if(isWeekFilterActive(state) && state.weekFilterQBPool && state.weekFilterQBPool.comp>0) return Math.round(state.weekFilterQBPool.comp);
  const comp=state.qbs.filter(q=> (q.games||0) > 0).reduce((s,q)=>s+(q.passing_completions||0),0);
  if(comp>0) return Math.round(comp);
  // fall back to targets × league-avg catch rate if completions aren't populated
  return Math.round((state.passing_shares||[]).reduce((s,p)=>{
    const tgts=p.share*teamTargetPool(state); return s+tgts*(p.catch_rate||0.65);
  },0));
}

// Compute production "vacated" by players who were on the team last season but are no
// longer on the current roster (free agency, retirement, trade). Helps see how much
// target/reception/yard/TD volume needs to be absorbed by the remaining roster.
function vacatedProduction(team){
  if(activeSeason!=='proj') return null;       // only meaningful for the upcoming season
  const lastYear = (HISTORY_SEASONS&&HISTORY_SEASONS.length)?HISTORY_SEASONS[0]:String(PROJ_SEASON-1);
  // Build last year's roster for this team. Prefer embedded HISTORY; if that's empty
  // (e.g. running off a live Sleeper pull with no prebuilt seed), fetch it in the
  // background and re-render when it lands so the note appears without a prebuilt seed.
  if(!seasonStatsCache[lastYear]){
    if(HISTORY && Object.keys(HISTORY).length){
      const built=buildSeedFromHistory(lastYear); if(built) seasonStatsCache[lastYear]=built;
    } else {
      ensureSeasonStats(lastYear);   // async; re-renders on arrival
    }
  }
  const prev=seasonStatsCache[lastYear] && seasonStatsCache[lastYear][team];
  if(!prev) return null;
  // Build the set of player_ids CURRENTLY on this team. Use the full Sleeper player DB
  // (not just projected players) so someone still rostered but projected for 0 stats
  // (e.g. Charlie Jones) is NOT counted as vacated.
  const curIds=new Set();
  const ps=projSeed||seasonStatsCache['proj']||{};
  ['QB','RB','WR','TE'].forEach(pos=>(ps[team]&&ps[team][pos]||[]).forEach(p=>p.player_id&&curIds.add(p.player_id)));
  if(sleeperPlayers){
    for(const pid in sleeperPlayers){ if(sleeperPlayers[pid].team===team) curIds.add(pid); }
  }
  let tgt=0,rec=0,yds=0,td=0; const gone=[];
  ['WR','TE','RB'].forEach(pos=>(prev[pos]||[]).forEach(p=>{
    if(p.player_id && !curIds.has(p.player_id) && (p.receiving_targets>0||p.receptions>0)){
      tgt+=p.receiving_targets||0; rec+=p.receptions||0; yds+=p.receiving_yards||0; td+=p.receiving_tds||0;
      gone.push({name:p.name, tgt:p.receiving_targets||0});
    }
  }));
  if(!gone.length) return null;
  // most-targeted (most impactful) players first
  gone.sort((a,b)=>b.tgt-a.tgt);
  return {season:lastYear, tgt:Math.round(tgt), rec:Math.round(rec), yds:Math.round(yds), td:Math.round(td), players:gone.map(g=>g.name)};
}
function vacatedNote(team){
  const v=vacatedProduction(team);
  if(!v) return '';
  const names = v.players.length>3 ? v.players.slice(0,3).join(', ')+` +${v.players.length-3} more` : v.players.join(', ');
  return `<div class="vacated-note">
    <span class="vacated-icon">📤</span>
    <div><b>Vacated from ${v.season}:</b> ${v.tgt} targets · ${v.rec} rec · ${v.yds.toLocaleString()} yds · ${v.td} TD
    <span style="color:var(--muted)"> — left by ${names}.</span>
    <span style="color:var(--muted)">This production is up for grabs among the current roster.</span></div></div>`;
}

// Rushing counterpart of vacatedProduction: carries/rush-yards/rush-TDs left behind by
// players (RB/WR/QB) who were on the team last season but aren't on the current roster.
function vacatedRushing(team){
  if(activeSeason!=='proj') return null;
  const lastYear = (HISTORY_SEASONS&&HISTORY_SEASONS.length)?HISTORY_SEASONS[0]:String(PROJ_SEASON-1);
  if(!seasonStatsCache[lastYear]){
    if(HISTORY && Object.keys(HISTORY).length){
      const built=buildSeedFromHistory(lastYear); if(built) seasonStatsCache[lastYear]=built;
    } else {
      ensureSeasonStats(lastYear);
    }
  }
  const prev=seasonStatsCache[lastYear] && seasonStatsCache[lastYear][team];
  if(!prev) return null;
  const curIds=new Set();
  const ps=projSeed||seasonStatsCache['proj']||{};
  ['QB','RB','WR','TE'].forEach(pos=>(ps[team]&&ps[team][pos]||[]).forEach(p=>p.player_id&&curIds.add(p.player_id)));
  if(sleeperPlayers){
    for(const pid in sleeperPlayers){ if(sleeperPlayers[pid].team===team) curIds.add(pid); }
  }
  let att=0,yds=0,td=0; const gone=[];
  // RBs carry most rushing; include WR/QB rushers too since they leave carries behind as well.
  ['RB','WR','QB'].forEach(pos=>(prev[pos]||[]).forEach(p=>{
    const carries = (p.rushing_attempts||p.qb_rush_attempts||0);
    if(p.player_id && !curIds.has(p.player_id) && carries>0){
      att+=carries;
      yds+=(p.rushing_yards||p.qb_rush_yards||0);
      td+=(p.rushing_tds||p.qb_rush_tds||0);
      gone.push({name:p.name, att:carries});
    }
  }));
  if(!gone.length) return null;
  gone.sort((a,b)=>b.att-a.att);
  return {season:lastYear, att:Math.round(att), yds:Math.round(yds), td:Math.round(td),
          players:gone.map(g=>g.name)};
}
function vacatedRushNote(team){
  const v=vacatedRushing(team);
  if(!v) return '';
  const names = v.players.length>3 ? v.players.slice(0,3).join(', ')+` +${v.players.length-3} more` : v.players.join(', ');
  return `<div class="vacated-note">
    <span class="vacated-icon">📤</span>
    <div><b>Vacated from ${v.season}:</b> ${v.att} carries · ${v.yds.toLocaleString()} yds · ${v.td} TD
    <span style="color:var(--muted)"> — left by ${names}.</span>
    <span style="color:var(--muted)">These carries are up for grabs among the current backfield.</span></div></div>`;
}
// Receptions / Receiving-Yards share view — editable, mirrors the target-share tab.
// Colors are keyed to each player's ORIGINAL index (PCOLORS[i]) so the pie slices and
// the rows always line up. Each player has a rec_share / recyds_share that rebalances the
// others exactly like target share. A discrepancy banner flags when the receivers' summed
// production doesn't match what the QBs are projected to throw for, with a one-click fix.
function renderPassDerived(team,state,subTabs,metric){
  ensureDerivedShares(state,metric);
  const totalTgts=teamTargetPool(state);
  const isYds = metric==='recyds';
  const field=isYds?'recyds_share':'rec_share';
  const key=isYds?'recyds':'rec';
  const label=isYds?'rec yds':'rec';
  // The "available" pool from the QBs vs. what the receivers actually add up to right now.
  const qbPool = isYds ? teamRecYardsPool(state) : teamRecPool(state);
  const receiverSum = state.passing_shares.reduce((s,p)=>{
    const tg=p.share*totalTgts; return s + (isYds ? tg*(p.ypt||9) : tg*(p.catch_rate||0.65));
  },0);
  const diff = Math.round(qbPool - receiverSum);
  const order=state.passing_shares.map((p,i)=>i).sort((a,b)=>(state.passing_shares[b][field]||0)-(state.passing_shares[a][field]||0));
  const rows=order.map(i=>{
    const p=state.passing_shares[i]; const col=PCOLORS[i%PCOLORS.length];
    const sh=p[field]||0; const pct=(sh*100).toFixed(1);
    const v=Math.round(sh*qbPool);
    const projTgts=Math.round(p.share*totalTgts);
    const projRec=Math.round(projTgts*(p.catch_rate||0.65));
    const projYds=Math.round(projTgts*(p.ypt||9));
    return `<div class="share-block" id="pblk-${i}">
      <div class="share-row"><div class="share-dot" style="background:${col}"></div>
        <span class="clickable-player" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${imgSm(hsURL(p))}</span><span class="pos-badge pos-${p.pos}">${p.pos}</span>
        <span class="share-name clickable-player" title="${p.name}" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${p.name}</span>${weekFilterPaceButton(state,p.player_id,'rec')}
        <span class="share-pct" id="dp-${i}">${pct}%</span>
        <span class="share-vol" id="dv-${i}">${v.toLocaleString()} ${label}</span></div>
      <div class="slider-track"><div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="0.5" value="${pct}"
          data-key="${key}_${i}" data-team="${team}" data-col="${col}" style="--col:${col}"></div>
      <div class="share-stats">
        <span class="share-stat">Tgts <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editTargets(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-tgt-${i}">${projTgts}</span></span>
        <span class="share-stat">Rec <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRec(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-rec-${i}">${projRec}</span></span>
        <span class="share-stat">Catch% <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editCatchPct(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="cr-${i}">${(p.catch_rate*100).toFixed(0)}</span>%</span>
        <span class="share-stat">Yds <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRecYds(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="yd-${i}">${projYds}</span></span>
        <span class="share-stat">Y/Tgt <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editYpt(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ypt-${i}">${(p.ypt||9).toFixed(1)}</span></span>
        <span class="share-stat">TDs <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRecTDs(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="rtd-${i}">${(p.td_share*teamPassTDs(state)).toFixed(1)}</span></span>
      </div></div>`;
  }).join('');
  const unit=isYds?'receiving yards':'receptions';
  const title = isYds ? 'Receiving Yardage Share' : 'Receptions Share';
  // Discrepancy banner: only meaningful when the gap is non-trivial (>2% of the pool).
  const threshold = isYds ? Math.max(40, qbPool*0.02) : Math.max(3, qbPool*0.02);
  let banner;
  if(Math.abs(diff) > threshold){
    const sign = diff>0?'short of':'over';
    banner = `<div class="discrepancy-note">
      <span class="vacated-icon">${diff>0?'⚠️':'❗'}</span>
      <div><b>${Math.abs(diff).toLocaleString()} ${unit} ${sign} the QB total.</b>
      The QBs are projected for <b>${qbPool.toLocaleString()} ${unit}</b>, but the receivers currently add up to
      <b>${Math.round(receiverSum).toLocaleString()}</b>. ${diff>0
        ? 'That production is unclaimed — distribute it across the receiving corps.'
        : 'The receivers exceed the QBs\' output — trim it down to reconcile.'}
      <button class="btn btn-accent btn-sm" style="margin-top:6px" onclick="reconcileDerived('${team}','${metric}')">
        ${diff>0?'Distribute':'Reconcile'} the ${diff>0?'difference':'overage'} →</button></div></div>`;
  } else {
    banner = `<div class="reconciled-note">✅ Receivers match the QBs' projected ${unit} (${qbPool.toLocaleString()}).</div>`;
  }
  return `<div class="card"><div class="card-title">${title}</div>${subTabs}
    ${vacatedNote(team)}
    ${banner}
    <div class="pie-section">
      <div class="pie-wrap"><canvas id="derivedPieChart" width="150" height="150"></canvas>
        <div class="pie-sub" id="derivedSub">${Math.round(qbPool).toLocaleString()} ${isYds?'yds':'rec'}</div></div>
      <div class="pie-controls" id="shareControls">${rows}</div></div></div>`;
}

// Distribute (or trim) the gap between the QBs' projected output and the receivers' sum,
// spread proportionally across the existing receiving corps by their current share.
function reconcileDerived(team,metric){
  const state=userProj[team]; if(!state) return;
  pushUndo(team,"reconcileDerived:"+metric); markDirty();
  const isYds=metric==='recyds';
  const totalTgts=Math.max(1,teamTargetPool(state));
  const qbPool=isYds?teamRecYardsPool(state):teamRecPool(state);
  const shares=state.passing_shares;
  const valOf=p=>{const tg=p.share*totalTgts;return isYds?tg*(p.ypt||9):tg*(p.catch_rate||0.65);};
  const receiverSum=shares.reduce((s,p)=>s+valOf(p),0)||1;
  // scale every receiver's rate so their summed production equals the QB pool
  const k=qbPool/receiverSum;
  shares.forEach(p=>{
    if(isYds) p.ypt=Math.max(0,Math.min(40,(p.ypt||9)*k));
    else p.catch_rate=Math.max(0,Math.min(1.5,(p.catch_rate||0.65)*k));
  });
  // refresh derived share fields to reflect the reconciled values
  shares.forEach(p=>{ delete p.rec_share; delete p.recyds_share; });
  ensureDerivedShares(state,metric);
  renderContent();
  toast(`Reconciled ${isYds?'receiving yards':'receptions'} to the QB total ✓`,'ok');
}

// Sort shares descending by the active metric so the leader floats to top
function sortedIdx(shares,field){
  return shares.map((p,i)=>i).sort((a,b)=>shares[b][field]-shares[a][field]);
}

function renderPassTargets(team,state,totalTgts,totalTDs,subTabs){
  const order=sortedIdx(state.passing_shares,'share');
  const rows=order.map(i=>{
    const p=state.passing_shares[i];
    const col=PCOLORS[i%PCOLORS.length];
    const pct=(p.share*100).toFixed(1);
    const projTgts=Math.round(p.share*totalTgts);
    const projRec=Math.round(projTgts*(p.catch_rate||0.65));
    const projYds=Math.round(projTgts*(p.ypt||9));
    const projTDs=(p.td_share*totalTDs).toFixed(1);
    return `<div class="share-block" id="pblk-${i}">
      <div class="share-row">
        <div class="share-dot" style="background:${col}"></div>
        <span class="clickable-player" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${imgSm(hsURL(p))}</span>
        <span class="pos-badge pos-${p.pos}">${p.pos}</span>
        <span class="share-name clickable-player" title="${p.name}" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${p.name}</span>${weekFilterPaceButton(state,p.player_id,'rec')}
        <span class="share-pct" id="pp-${i}">${pct}%</span>
        <span class="share-vol" id="pt-${i}">${projTgts} tgt</span>
        ${activeSeason!=='proj'&&p.player_id?`<button class="copy-btn" onclick="copyPlayerToWorking('${p.player_id}','${p.pos}')" title="Copy to ${PROJ_SEASON} working set">⤵</button>`:''}
      </div>
      <div class="slider-track">
        <div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="0.5" value="${pct}"
          data-key="ps_${i}" data-team="${team}" data-col="${col}" style="--col:${col}">
      </div>
      <div class="share-stats">
        <span class="share-stat">Tgts <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editTargets(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-tgt-${i}">${projTgts}</span></span>
        <span class="share-stat">Rec <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRec(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-rec-${i}">${projRec}</span></span>
        <span class="share-stat">Catch% <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editCatchPct(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="cr-${i}">${(p.catch_rate*100).toFixed(0)}</span>%</span>
        <span class="share-stat">Yds <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRecYds(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="yd-${i}">${projYds}</span></span>
        <span class="share-stat">Y/Tgt <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editYpt(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ypt-${i}">${(p.ypt||9).toFixed(1)}</span></span>
        <span class="share-stat">TDs <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRecTDs(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="rtd-${i}">${projTDs}</span></span>
      </div></div>`;
  }).join('');
  // Discrepancy: the team's pass attempts imply ~att×TARGET_RATE targets, but the
  // receivers' targets sum to state.team_targets. Flag a meaningful gap and offer a fix.
  const expectTgts=Math.round(teamPassAtt(state)*TARGET_RATE);
  const tgtDiff=expectTgts-Math.round(totalTgts);
  const tThresh=Math.max(8, expectTgts*0.03);
  let tgtBanner='';
  if(Math.abs(tgtDiff)>tThresh){
    tgtBanner=`<div class="discrepancy-note"><span class="vacated-icon">${tgtDiff>0?'⚠️':'❗'}</span>
      <div><b>${Math.abs(tgtDiff)} targets ${tgtDiff>0?'unaccounted for':'over the QB total'}.</b>
      The QBs' ${teamPassAtt(state)} attempts imply about <b>${expectTgts} targets</b>, but the receivers add up to <b>${Math.round(totalTgts)}</b>.
      <button class="btn btn-accent btn-sm" style="margin-top:6px" onclick="reconcileTargets('${team}')">${tgtDiff>0?'Distribute':'Reconcile'} the difference →</button></div></div>`;
  }
  return `<div class="card"><div class="card-title">Receiver Target Share</div>${subTabs}
    ${vacatedNote(team)}
    ${tgtBanner}
    <div class="alert alert-info"><span class="alert-icon">ℹ️</span>
      <div>${totalTgts} total targets (${teamPassAtt(state)} att × ${TARGET_RATE}) · ${teamRecYardsPool(state).toLocaleString()} receiving yards available · ${totalTDs} pass TDs.
      Drag a share to 100% and others rebalance. Or edit <b>Tgts</b>/<b>Rec</b> directly — shares recompute.</div></div>
    <div class="pie-section">
      <div class="pie-wrap"><canvas id="pieChart" width="150" height="150"></canvas>
        <div class="pie-sub" id="pieSub">${totalTgts} targets</div></div>
      <div class="pie-controls" id="shareControls">${rows}</div></div></div>`;
}

// Scale the receiver target pool up/down to match the QBs' attempts × target rate, holding
// each receiver's share. Then reanchor team_targets so the per-player targets reflect it.
function reconcileTargets(team){
  const state=userProj[team]; if(!state) return;
  pushUndo(team,"reconcileTargets"); markDirty();
  const expectTgts=Math.round(teamPassAtt(state)*TARGET_RATE);
  // re-anchor: set each player's baseline so share×pool = their new target count
  state.team_targets=expectTgts;
  state.base_pass_att=teamPassAtt(state);
  renderContent();
  toast(`Targets reconciled to ${expectTgts} (QB attempts × ${TARGET_RATE}) ✓`,'ok');
}

function renderPassTDs(team,state,totalTDs,subTabs){
  const order=sortedIdx(state.passing_shares,'td_share');
  const rows=order.map(i=>{
    const p=state.passing_shares[i];
    const col=PCOLORS[i%PCOLORS.length];
    const pct=(p.td_share*100).toFixed(1);
    const projTDs=(p.td_share*totalTDs).toFixed(1);
    return `<div class="share-block" id="pblk-${i}">
      <div class="share-row"><div class="share-dot" style="background:${col}"></div>
        <span class="clickable-player" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${imgSm(hsURL(p))}</span><span class="pos-badge pos-${p.pos}">${p.pos}</span>
        <span class="share-name clickable-player" title="${p.name}" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${p.name}</span>
        <span class="share-pct" id="tdp-${i}">${pct}%</span>
        <span class="share-vol">proj TDs</span></div>
      <div class="slider-track"><div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="1" value="${pct}"
          data-key="tds_${i}" data-team="${team}" data-col="${col}" style="--col:${col}"></div>
      <div class="share-stats">
        <span class="share-stat">Rec TDs <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRecTDsAbs(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="tdt-${i}">${projTDs}</span></span>
      </div></div>`;
  }).join('');
  return `<div class="card"><div class="card-title">Receiving TD Share</div>${subTabs}
    <div class="alert alert-info"><span class="alert-icon">ℹ️</span>
      <div>${totalTDs} total passing TDs (from the QB tab). Each player's projected receiving TDs = share × ${totalTDs}.</div></div>
    <div class="pie-section">
      <div class="pie-wrap"><canvas id="pieChart" width="150" height="150"></canvas>
        <div class="pie-sub">${totalTDs} rec TDs</div></div>
      <div class="pie-controls" id="shareControls">${rows}</div></div></div>`;
}


// ─────────────────────────────────────────────────────────────────────────────
// Rushing Phase
// ─────────────────────────────────────────────────────────────────────────────
function renderRushing(team,state){
  const r=state.rushing;
  const baseAtt=getBase(team,'RB').reduce((s,p)=>s+p.rushing_attempts,0)||200;
  const baseYds=getBase(team,'RB').reduce((s,p)=>s+p.rushing_yards,0)||1600;
  const subTabs=`<div class="sub-tabs">
    <button class="sub-tab ${rushingSubTab==='carries'?'active':''}" onclick="setRushSub('carries')">🏃 Carry Share</button>
    <button class="sub-tab ${rushingSubTab==='rush_tds'?'active':''}" onclick="setRushSub('rush_tds')">🏆 Rush TD Share</button></div>`;
  const weekSlider=weekRangeSliderHTML(team,state);
  const body = rushingSubTab==='carries' ? renderRushCarries(team,state,baseAtt,baseYds,subTabs) : renderRushTDs(team,state,subTabs);
  return weekSlider + body;
}
function setRushSub(t){rushingSubTab=t;renderContent();}

function renderRushCarries(team,state,baseAtt,baseYds,subTabs){
  const r=state.rushing;
  const qbRushAtt=state.qbs.reduce((s,q)=>s+q.qb_rush_attempts,0);
  const totalIncQB=(r.total_attempts||0)+qbRushAtt;
  const totalTDs=teamRushTDs(state);
  const order=sortedIdx(r.shares,'share');
  const rows=order.map(i=>{
    const p=r.shares[i];
    const col=PCOLORS[i%PCOLORS.length];
    const pct=(p.share*100).toFixed(1);
    const att=Math.round(p.share*r.total_attempts);
    const yds=Math.round(att*(p.ypc||r.ypa||4));
    const tds=(p.td_share*totalTDs).toFixed(1);
    return `<div class="share-block" id="rblk-${i}">
      <div class="share-row"><div class="share-dot" style="background:${col}"></div>
        <span class="clickable-player" onclick="${pcardOnclick(p.player_id||p.name, (p.pos||'RB'), (p.team||currentTeam||''))}">${imgSm(hsURL(p))}</span><span class="pos-badge pos-RB">RB</span>
        <span class="share-name clickable-player" title="${p.name}" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${p.name}</span>${weekFilterPaceButton(state,p.player_id,'rush')}
        <span class="share-pct" id="rp-${i}">${pct}%</span>
        <span class="share-vol" id="ra-${i}">${att} att</span>
        ${activeSeason!=='proj'&&p.player_id?`<button class="copy-btn" onclick="copyPlayerToWorking('${p.player_id}','RB')" title="Copy to ${PROJ_SEASON} working set">⤵</button>`:''}
        </div>
      <div class="slider-track"><div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="1" value="${pct}"
          data-key="rs_${i}" data-team="${team}" data-col="${col}" style="--col:${col}"></div>
      <div class="share-stats">
        <span class="share-stat">Att <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editCarries(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-att-${i}">${att}</span></span>
        <span class="share-stat">Y/Carry <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editYpc(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-ypc-${i}">${(p.ypc||r.ypa||4).toFixed(2)}</span></span>
        <span class="share-stat">Yds <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRushYds(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ryd-${i}">${yds}</span></span>
        <span class="share-stat">TDs <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRushTDsCarry(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="rtdv-${i}">${tds}</span></span>
      </div></div>`;
  }).join('');
  return `<div class="card"><div class="card-title">Team Rushing Volume</div>
    <div class="alert alert-info"><span class="alert-icon">ℹ️</span>
      <div>Set total RB carries and total rushing yards. Each RB's yards = their carries × their Y/Carry;
      changing the team total scales every RB's efficiency proportionally.</div></div>
    ${sRow('rush_total_att','RB Carries (excl QB)',r.total_attempts,baseAtt,0,600,5,'var(--rb)')}
    ${sRow('rush_total_yds','Total RB Rush Yards',r.total_yards,baseYds,0,3500,25,'var(--rb)')}
    <div class="derived-note" id="rushDerived">${rushNote(state)}</div></div>
  <div class="card"><div class="card-title">RB Carry Share</div>${subTabs}
    ${vacatedRushNote(team)}
    <div class="pie-section">
      <div class="pie-wrap"><canvas id="rushPieChart" width="150" height="150"></canvas>
        <div class="pie-sub" id="rushTotalLbl">${r.total_attempts} att / ${(r.total_yards||0).toLocaleString()} yds</div></div>
      <div class="pie-controls" id="rushShareControls">${rows}</div></div></div>`;
}

function renderRushTDs(team,state,subTabs){
  const r=state.rushing;
  const totalTDs=teamRushTDs(state);
  const order=sortedIdx(r.shares,'td_share');
  const rows=order.map(i=>{
    const p=r.shares[i];
    const col=PCOLORS[i%PCOLORS.length];
    const pct=(p.td_share*100).toFixed(1);
    const projTDs=(p.td_share*totalTDs).toFixed(1);
    return `<div class="share-block" id="rblk-${i}"><div class="share-row">
        <div class="share-dot" style="background:${col}"></div>
        <span class="clickable-player" onclick="${pcardOnclick(p.player_id||p.name, (p.pos||'RB'), (p.team||currentTeam||''))}">${imgSm(hsURL(p))}</span><span class="pos-badge pos-RB">RB</span>
        <span class="share-name clickable-player" title="${p.name}" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${p.name}</span>${weekFilterPaceButton(state,p.player_id,'rush')}
        <span class="share-pct" id="rtdp-${i}">${pct}%</span>
        <span class="share-vol">proj TDs</span></div>
      <div class="slider-track"><div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="1" value="${pct}"
          data-key="rtds_${i}" data-team="${team}" data-col="${col}" style="--col:${col}"></div>
      <div class="share-stats">
        <span class="share-stat">Rush TDs <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRushTDsAbs(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="rtdt-${i}">${projTDs}</span></span>
      </div></div>`;
  }).join('');
  return `<div class="card"><div class="card-title">Team Rushing TDs</div>
    ${sRow('rush_total_tds','Total RB Rush TDs',totalTDs,Math.round(totalTDs),0,40,1,'var(--rb)')}
    <div class="derived-note">Set the team's total RB rushing TDs; each back's share below splits this total.</div></div>
  <div class="card"><div class="card-title">Rushing TD Share</div>${subTabs}
    <div class="alert alert-info"><span class="alert-icon">ℹ️</span>
      <div>${totalTDs.toFixed(0)} projected RB rushing TDs. QB rushing TDs are set separately on the QB tab.</div></div>
    <div class="pie-section">
      <div class="pie-wrap"><canvas id="rushPieChart" width="150" height="150"></canvas>
        <div class="pie-sub" id="rushTDLbl">${totalTDs.toFixed(0)} rush TDs</div></div>
      <div class="pie-controls" id="rushShareControls">${rows}</div></div></div>`;
}
function rushNote(state){
  const r=state.rushing;
  const qbRushAtt=state.qbs.reduce((s,q)=>s+q.qb_rush_attempts,0);
  const totalIncQB=(r.total_attempts||0)+qbRushAtt;
  return `RB carries: ${r.total_attempts} · team YPA: ${(r.ypa||0).toFixed(2)} · RB yards: ${(r.total_yards||0).toLocaleString()} · incl QB: ~${totalIncQB} carries`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pie charts
// ─────────────────────────────────────────────────────────────────────────────
function initPie(team,kind){
  const state=userProj[team];
  if(kind==='pass'){
    // Receptions / Rec-Yards tabs: a separate canvas. Build pie data in ORIGINAL player
    // order (same index basis as PCOLORS[i] used by the rows) so slice colors line up.
    if(passingSubTab==='rec'||passingSubTab==='recyds'){
      const ctx=document.getElementById('derivedPieChart');if(!ctx)return;
      if(pieChart){pieChart.destroy();pieChart=null;}
      if(!state.passing_shares) return;
      const totalTgts=teamTargetPool(state);
      const isYds=passingSubTab==='recyds';
      const value=p=>{const tgts=p.share*totalTgts;return isYds?tgts*(p.ypt||9):tgts*(p.catch_rate||0.65);};
      const vals=state.passing_shares.map(value);
      const pool=vals.reduce((s,v)=>s+v,0)||1;
      const data=vals.map(v=>v/pool); // original order → matches PCOLORS[i] in the rows
      const labels=state.passing_shares.map(p=>p.name.split(' ').pop());
      pieChart=mkDoughnut(ctx,labels,data);
      return;
    }
    if(!state.passing_shares) return;
    const ctx=document.getElementById('pieChart');if(!ctx)return;
    if(pieChart){pieChart.destroy();pieChart=null;}
    const data=passingSubTab==='targets'?state.passing_shares.map(p=>p.share):state.passing_shares.map(p=>p.td_share);
    pieChart=mkDoughnut(ctx,state.passing_shares.map(p=>p.name.split(' ').pop()),data);
  } else {
    if(!state.rushing.shares) return;
    const ctx=document.getElementById('rushPieChart');if(!ctx)return;
    if(pieChart){pieChart.destroy();pieChart=null;}
    const data=rushingSubTab==='carries'?state.rushing.shares.map(p=>p.share):state.rushing.shares.map(p=>p.td_share);
    pieChart=mkDoughnut(ctx,state.rushing.shares.map(p=>p.name.split(' ').pop()),data);
  }
}
function mkDoughnut(ctx,labels,data){
  return new Chart(ctx,{type:'doughnut',data:{labels,
    datasets:[{data,backgroundColor:PCOLORS.slice(0,data.length),borderWidth:0,hoverOffset:3}]},
    options:{cutout:'55%',plugins:{legend:{display:false},
      tooltip:{callbacks:{label:c=>` ${(c.raw*100).toFixed(1)}%`}}},animation:{duration:150}}});
}
function updatePie(data){ if(pieChart){pieChart.data.datasets[0].data=data;pieChart.update('none');} }

function normalizeShares(shares,idx,field){
  field=field||'share';
  const v=shares[idx][field];
  const rest=shares.filter((_,i)=>i!==idx);
  const restTotal=rest.reduce((s,p)=>s+p[field],0);
  const rem=Math.max(0,1-v);
  if(restTotal>0) rest.forEach(p=>{p[field]=p[field]/restTotal*rem;});
  else rest.forEach(p=>{p[field]=rem/rest.length;});
}


// ─────────────────────────────────────────────────────────────────────────────
// Slider / edit handlers
// ─────────────────────────────────────────────────────────────────────────────
function handleSlider(el){
  // Snapshot once at the start of a drag (coalesced by the slider's key so a continuous
  // drag pushes a single undo step, not one per tick).
  if(!sliderDragging) pushUndo(el.dataset.team, 'slider:'+(el.dataset.key||''));
  sliderDragging=true;
  handleSliderKey(el.dataset.key,parseFloat(el.value),el.dataset.team,false);
}

function handleSliderKey(key,val,team,fromManual){
  const state=userProj[team]; if(!state) return;
  markDirty();
  // mirror numeric into the editable display (unless user is editing it)
  const svEl=document.getElementById(`sv-${key}`);
  if(svEl&&document.activeElement!==svEl) svEl.textContent=(val%1!==0&&val<200)?(+val).toFixed(2):Math.round(val);

  // ── QB stats ──
  const QB_MAP={py:'passing_yards',ptd:'passing_tds',patt:'passing_attempts',
    pcomp:'passing_completions',int:'interceptions_thrown',
    qbry:'qb_rush_yards',qbrtd:'qb_rush_tds',qbratt:'qb_rush_attempts'};
  if(key in QB_MAP){
    const idx=state.activeQB||0;
    state.qbs[idx][QB_MAP[key]]=val;
    liveQB(state,idx,team,key);
    if(key==='patt') livePassDependents(state,team); // attempts drive the target pool
    return;
  }
  // ── QB Games Played (drives pace extrapolation) ──
  if(key.startsWith('games_')){
    const qi=parseInt(key.slice(6));
    const q=state.qbs[qi];
    const newGames=Math.max(0,Math.round(val));
    const STATK=['passing_yards','passing_tds','passing_attempts','passing_completions',
      'interceptions_thrown','qb_rush_yards','qb_rush_tds','qb_rush_attempts'];
    // Capture per-game rates from the CURRENT totals/games before changing games, so the
    // pace survives even a trip to 0 games (totals→0 but rates remembered on q._rate).
    const fromGames = q.games||0;
    if(fromGames>0){
      q._rate = {}; STATK.forEach(k=>{ q._rate[k]=(q[k]||0)/fromGames; });
    } else if(!q._rate){
      // never had recorded games and no stored rate: treat current totals as a 1-game rate
      q._rate = {}; STATK.forEach(k=>{ q._rate[k]=(q[k]||0); });
    }
    // else: coming back from 0 games — keep the previously stored q._rate.
    // Apply rate × newGames (newGames may be 0 → zero contribution, rates kept on q._rate)
    STATK.forEach(k=>{ q[k]=(q._rate[k]||0)*newGames; });
    q.games=newGames;
    q.base_games=newGames||1;
    updateWorkloadUI(state,qi,team);
    liveQB(state,qi,team,null);
    refreshQBStatSliders(state,qi);
    livePassDependents(state,team);
    return;
  }
  // ── Target share ──
  if(key.startsWith('ps_')){
    const i=parseInt(key.slice(3));
    state.passing_shares[i].share=val/100;
    normalizeShares(state.passing_shares,i,'share');
    if(passingSubTab==='targets') updatePie(state.passing_shares.map(p=>p.share));
    livePassTargets(state,team);
    return;
  }
  // ── Rec TD share ──
  if(key.startsWith('tds_')){
    const i=parseInt(key.slice(4));
    state.passing_shares[i].td_share=val/100;
    normalizeShares(state.passing_shares,i,'td_share');
    if(passingSubTab==='rec_tds') updatePie(state.passing_shares.map(p=>p.td_share));
    liveTDRows('tdp','tdt',state.passing_shares,teamPassTDs(state),'tds_',true);
    return;
  }
  // ── Receptions share (edit catch rates so each player hits the new rec share) ──
  if(key.startsWith('recyds_')){
    const i=parseInt(key.slice(7));
    setDerivedShare(state,team,i,val/100,'recyds');
    return;
  }
  if(key.startsWith('rec_')){
    const i=parseInt(key.slice(4));
    setDerivedShare(state,team,i,val/100,'rec');
    return;
  }
  // ── Team rush carries ──
  if(key==='rush_total_att'){
    state.rushing.total_attempts=val;
    recomputeTeamRushYards(state);
    liveRush(state,team);
    // keep the yards slider in sync (carries change → yards recompute)
    const ys=document.querySelector('input.sl[data-key="rush_total_yds"]');
    if(ys){ys.value=state.rushing.total_yards;setFill(ys,'var(--rb)');
      const ysv=document.getElementById('sv-rush_total_yds');if(ysv&&document.activeElement!==ysv)ysv.textContent=state.rushing.total_yards;}
    return;
  }
  // ── Team total rush yards: scale each RB's Y/Carry to hit the target ──
  if(key==='rush_total_yds'){
    scaleTeamRushYards(state,val);
    liveRush(state,team);
    return;
  }
  // ── Team total RB rushing TDs ──
  if(key==='rush_total_tds'){
    state.rushing.total_rush_tds=Math.max(0,val);
    const lbl=document.getElementById('rushTDLbl'); if(lbl) lbl.textContent=`${Math.round(val)} rush TDs`;
    if(rushingSubTab==='rush_tds'){
      liveTDRows('rtdp','rtdt',state.rushing.shares,teamRushTDs(state),'rtds_',true);
    }
    return;
  }
  // ── RB carry share ──
  if(key.startsWith('rs_')){
    const i=parseInt(key.slice(3));
    state.rushing.shares[i].share=val/100;
    normalizeShares(state.rushing.shares,i,'share');
    recomputeTeamRushYards(state);
    if(rushingSubTab==='carries') updatePie(state.rushing.shares.map(p=>p.share));
    liveRushRows(state,team);
    return;
  }
  // ── Rush TD share ──
  if(key.startsWith('rtds_')){
    const i=parseInt(key.slice(5));
    state.rushing.shares[i].td_share=val/100;
    normalizeShares(state.rushing.shares,i,'td_share');
    if(rushingSubTab==='rush_tds') updatePie(state.rushing.shares.map(p=>p.td_share));
    const totalTDs=teamRushTDs(state);
    liveTDRows('rtdp','rtdt',state.rushing.shares,totalTDs,'rtds_',true);
    return;
  }
}

// ── Editable stat fields (targets, receptions, carries, ypc) ──
function editTargets(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){livePassTargets(state,currentTeam);return;}
  markDirty();
  const totalTgts=Math.max(1,teamTargetPool(state));
  state.passing_shares[i].share=Math.max(0,Math.min(1,v/totalTgts));
  normalizeShares(state.passing_shares,i,'share');
  if(passingSubTab==='targets') updatePie(state.passing_shares.map(p=>p.share));
  livePassTargets(state,currentTeam);
}
function editRec(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){livePassTargets(state,currentTeam);return;}
  markDirty();
  const totalTgts=Math.max(1,teamTargetPool(state));
  const projTgts=Math.max(1,Math.round(state.passing_shares[i].share*totalTgts));
  // set catch rate = rec / projected targets
  state.passing_shares[i].catch_rate=Math.max(0,Math.min(1.2,v/projTgts));
  livePassTargets(state,currentTeam);
}
function editCarries(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){liveRushRows(state,currentTeam);return;}
  markDirty();
  const tot=Math.max(1,state.rushing.total_attempts);
  state.rushing.shares[i].share=Math.max(0,Math.min(1,v/tot));
  normalizeShares(state.rushing.shares,i,'share');
  recomputeTeamRushYards(state);
  if(rushingSubTab==='carries') updatePie(state.rushing.shares.map(p=>p.share));
  liveRushRows(state,currentTeam);
  // update the team total label/derived
  const lbl=document.getElementById('rushTotalLbl');
  if(lbl) lbl.textContent=`${state.rushing.total_attempts} att / ${(state.rushing.total_yards||0).toLocaleString()} yds`;
  const d=document.getElementById('rushDerived'); if(d) d.textContent=rushNote(state);
}
function editYpc(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){liveRushRows(state,currentTeam);return;}
  markDirty();
  state.rushing.shares[i].ypc=Math.max(0,Math.min(15,v));
  recomputeTeamRushYards(state);
  liveRushRows(state,currentTeam);
  const lbl=document.getElementById('rushTotalLbl');
  if(lbl) lbl.textContent=`${state.rushing.total_attempts} att / ${(state.rushing.total_yards||0).toLocaleString()} yds`;
  const d=document.getElementById('rushDerived'); if(d) d.textContent=rushNote(state);
  syncRushYdsSlider(state);
}
// Edit a player's absolute rushing yards → back out Y/Carry so att×ypc = entered, feeds team total
function editRushYds(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){liveRushRows(state,currentTeam);return;}
  markDirty();
  const r=state.rushing;
  const att=Math.max(1,Math.round(r.shares[i].share*r.total_attempts));
  r.shares[i].ypc=Math.max(0,Math.min(15,v/att));
  recomputeTeamRushYards(state);
  liveRushRows(state,currentTeam);
  const lbl=document.getElementById('rushTotalLbl');
  if(lbl) lbl.textContent=`${r.total_attempts} att / ${(r.total_yards||0).toLocaleString()} yds`;
  const d=document.getElementById('rushDerived'); if(d) d.textContent=rushNote(state);
  syncRushYdsSlider(state);
}
// Edit a player's absolute rushing TDs from the carry view → grows/shrinks team rush-TD total
function editRushTDsCarry(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw);
  const totalTDs=teamRushTDs(state);
  if(isNaN(v)){liveRushRows(state,currentTeam);return;}
  markDirty();
  const others=state.rushing.shares.filter((_,j)=>j!==i).reduce((s,p)=>s+p.td_share*totalTDs,0);
  const newTotal=Math.max(0.1,others+Math.max(0,v));
  state.rushing.total_rush_tds=newTotal;
  state.rushing.shares.forEach((p,j)=>{ p.td_share=(j===i?Math.max(0,v):p.td_share*totalTDs)/newTotal; });
  liveRushRows(state,currentTeam);
}

// Scale every RB's Y/Carry proportionally so team yards = target.
function scaleTeamRushYards(state,targetYds){
  const r=state.rushing;
  markDirty();
  const cur=r.total_yards||0;
  if(cur>0){
    const factor=targetYds/cur;
    r.shares.forEach(p=>{ p.ypc=Math.max(0,Math.min(15,(p.ypc||r.ypa||4)*factor)); });
  } else if(r.total_attempts>0){
    const flat=targetYds/r.total_attempts;
    r.shares.forEach(p=>{ p.ypc=Math.max(0,Math.min(15,flat)); });
  }
  recomputeTeamRushYards(state);
}
function syncRushYdsSlider(state){
  const ys=document.querySelector('input.sl[data-key="rush_total_yds"]');
  if(ys){ys.value=state.rushing.total_yards;setFill(ys,'var(--rb)');
    const ysv=document.getElementById('sv-rush_total_yds');if(ysv&&document.activeElement!==ysv)ysv.textContent=state.rushing.total_yards;}
}

// ── Passing: editable Catch%, Receiving Yards, Y/Tgt, Receiving TDs ──
function editCatchPct(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){livePassTargets(state,currentTeam);return;}
  markDirty();
  state.passing_shares[i].catch_rate=Math.max(0,Math.min(1.2,v/100));
  livePassTargets(state,currentTeam);
}
function editRecYds(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){livePassTargets(state,currentTeam);return;}
  markDirty();
  const totalTgts=Math.max(1,teamTargetPool(state));
  const projTgts=Math.max(1,Math.round(state.passing_shares[i].share*totalTgts));
  // back out Y/Tgt so projected yards = entered value
  state.passing_shares[i].ypt=Math.max(0,Math.min(25,v/projTgts));
  livePassTargets(state,currentTeam);
}
function editYpt(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){livePassTargets(state,currentTeam);return;}
  markDirty();
  state.passing_shares[i].ypt=Math.max(0,Math.min(25,v));
  livePassTargets(state,currentTeam);
}

// Set player i's share of receptions ('rec') or receiving yards ('recyds'). Works exactly
// like the target-share tab: the dragged player gets the new share, the others rebalance
// proportionally to fill the remainder. The share is stored on its own field (rec_share /
// recyds_share) and the per-player rate (catch_rate / ypt) is back-solved so totals match.
function setDerivedShare(state,team,i,share,metric){
  markDirty();
  const isYds=metric==='recyds';
  const field=isYds?'recyds_share':'rec_share';
  const shares=state.passing_shares;
  ensureDerivedShares(state,metric);            // make sure the share field is populated
  shares[i][field]=Math.max(0,Math.min(1,share));
  normalizeShares(shares,i,field);              // rebalance the others (same as targets)
  // back-solve the per-player rate so the pool distributes by the new shares
  applyDerivedShares(state,metric);
  liveDerivedRows(state,team,metric);
}

// Populate rec_share / recyds_share from the current per-player values if not present.
function ensureDerivedShares(state,metric){
  const isYds=metric==='recyds';
  const field=isYds?'recyds_share':'rec_share';
  const totalTgts=Math.max(1,teamTargetPool(state));
  const shares=state.passing_shares;
  const valOf=p=>{const tg=p.share*totalTgts;return isYds?tg*(p.ypt||9):tg*(p.catch_rate||0.65);};
  const pool=shares.reduce((s,p)=>s+valOf(p),0)||1;
  let needs=false;
  shares.forEach(p=>{ if(typeof p[field]!=='number') needs=true; });
  if(needs) shares.forEach(p=>{ p[field]=valOf(p)/pool; });
}

// Convert rec_share / recyds_share back into per-player catch_rate / ypt against the pool.
function applyDerivedShares(state,metric){
  const isYds=metric==='recyds';
  const field=isYds?'recyds_share':'rec_share';
  const totalTgts=Math.max(1,teamTargetPool(state));
  const shares=state.passing_shares;
  // pool stays anchored to the team's available receptions / receiving yards
  const pool=isYds?teamRecYardsPool(state):teamRecPool(state);
  shares.forEach(p=>{
    const tg=Math.max(1,p.share*totalTgts);
    const target=(p[field]||0)*pool;
    if(isYds) p.ypt=Math.max(0,Math.min(40,target/tg));
    else p.catch_rate=Math.max(0,Math.min(1.5,target/tg));
  });
}

// Update the receptions/rec-yards rows + pie in place after a share edit. Mirrors
// livePassTargets: ALL sibling sliders update live (not gated by sliderDragging).
function liveDerivedRows(state,team,metric){
  const isYds=metric==='recyds';
  const field=isYds?'recyds_share':'rec_share';
  const totalTgts=Math.max(1,teamTargetPool(state));
  const pool=isYds?teamRecYardsPool(state):teamRecPool(state);
  const shares=state.passing_shares;
  shares.forEach((p,i)=>{
    const sh=p[field]||0;
    const v=Math.round(sh*pool);
    const pctEl=document.getElementById(`dp-${i}`); if(pctEl) pctEl.textContent=(sh*100).toFixed(1)+'%';
    const volEl=document.getElementById(`dv-${i}`); if(volEl) volEl.textContent=`${v.toLocaleString()} ${isYds?'rec yds':'rec'}`;
    const projTgts=Math.round(p.share*totalTgts);
    const crEl=document.getElementById(`cr-${i}`); if(crEl&&document.activeElement!==crEl) crEl.textContent=((p.catch_rate||0.65)*100).toFixed(0);
    const ydEl=document.getElementById(`yd-${i}`); if(ydEl&&document.activeElement!==ydEl) ydEl.textContent=Math.round(projTgts*(p.ypt||9));
    const yptEl=document.getElementById(`ypt-${i}`); if(yptEl&&document.activeElement!==yptEl) yptEl.textContent=(p.ypt||9).toFixed(1);
    const recEl=document.getElementById(`ed-rec-${i}`); if(recEl&&document.activeElement!==recEl) recEl.textContent=Math.round(projTgts*(p.catch_rate||0.65));
    // Update ALL sliders' fill/value (including siblings) — but never fight the one being dragged.
    const sl=document.querySelector(`input.sl[data-key="${isYds?'recyds':'rec'}_${i}"]`);
    if(sl && document.activeElement!==sl){ sl.value=(sh*100).toFixed(1); setFill(sl,sl.dataset.col||PCOLORS[i%PCOLORS.length]); }
  });
  if(pieChart) updatePie(shares.map(p=>p[field]||0));
  const sub=document.getElementById('derivedSub');
  if(sub) sub.textContent=isYds?Math.round(pool).toLocaleString()+' yds':Math.round(pool)+' rec';
}
// Edit a player's absolute receiving TDs (from the Targets view) → set td_share of team passing TDs
function editRecTDs(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){livePassTargets(state,currentTeam);return;}
  markDirty();
  const totalTDs=teamPassTDs(state);
  if(totalTDs>0){
    state.passing_shares[i].td_share=Math.max(0,Math.min(1,v/totalTDs));
    normalizeShares(state.passing_shares,i,'td_share');
  }
  livePassTargets(state,currentTeam);
}
// Edit absolute receiving TDs from the TD-share view (same logic, refreshes that view)
function editRecTDsAbs(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){liveTDRows('tdp','tdt',state.passing_shares,teamPassTDs(state),'tds_',true);return;}
  markDirty();
  const totalTDs=teamPassTDs(state);
  if(totalTDs>0){
    state.passing_shares[i].td_share=Math.max(0,Math.min(1,v/totalTDs));
    normalizeShares(state.passing_shares,i,'td_share');
  }
  if(passingSubTab==='rec_tds') updatePie(state.passing_shares.map(p=>p.td_share));
  liveTDRows('tdp','tdt',state.passing_shares,totalTDs,'tds_',true);
}
// Edit absolute rushing TDs → adjusts that player's share AND the team total grows/shrinks
function editRushTDsAbs(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw);
  const totalTDs=teamRushTDs(state);
  if(isNaN(v)){liveTDRows('rtdp','rtdt',state.rushing.shares,totalTDs,'rtds_',true);return;}
  markDirty();
  const others=state.rushing.shares.filter((_,j)=>j!==i)
    .reduce((s,p)=>s+p.td_share*totalTDs,0);
  const newTotal=Math.max(0.1,others+Math.max(0,v));
  state.rushing.total_rush_tds=newTotal;
  state.rushing.shares.forEach((p,j)=>{ p.td_share=(j===i?Math.max(0,v):p.td_share*totalTDs)/newTotal; });
  if(rushingSubTab==='rush_tds') updatePie(state.rushing.shares.map(p=>p.td_share));
  liveTDRows('rtdp','rtdt',state.rushing.shares,newTotal,'rtds_',true);
  // refresh the "X rush TDs" pie subtitle
  const sub=document.querySelector('#rushPieChart')&&document.querySelector('.pie-sub');
}

// ─────────────────────────────────────────────────────────────────────────────
// Live DOM updaters
// ─────────────────────────────────────────────────────────────────────────────
function liveQB(state,idx,team,changedKey){
  const q=state.qbs[idx];
  const cp=q.passing_attempts>0?(q.passing_completions/q.passing_attempts*100).toFixed(1):'0';
  const ypa=q.passing_attempts>0?(q.passing_yards/q.passing_attempts).toFixed(2):'-';
  const ytd=q.passing_tds>0?Math.round(q.passing_yards/q.passing_tds):'-';
  const d=document.getElementById('qbDerived'); if(d) d.textContent=`Comp%: ${cp}% · YPA: ${ypa} · Yds/TD: ${ytd} · per game: ${perGame(q,'passing_yards').toFixed(1)} yds`;
  const m={'sb-py':Math.round(q.passing_yards).toLocaleString(),'sb-ptd':Math.round(q.passing_tds),'sb-int':Math.round(q.interceptions_thrown),
    'sb-ry':Math.round(q.qb_rush_yards),'sb-rtd':Math.round(q.qb_rush_tds),'sb-att':Math.round(q.passing_attempts)};
  Object.entries(m).forEach(([id,v])=>{const e=document.getElementById(id);if(e)e.textContent=v;});
  const seed=getBase(team,'QB').find(qq=>qq.name===q.name)||getBase(team,'QB')[0]||{};
  const bases={py:seed.passing_yards||4000,ptd:seed.passing_tds||25,patt:seed.passing_attempts||560,
    pcomp:seed.passing_completions||360,int:seed.interceptions_thrown||10,
    qbry:seed.rushing_yards||0,qbrtd:seed.rushing_tds||0,qbratt:seed.rushing_attempts||0};
  if(changedKey){const sd=document.getElementById(`sd-${changedKey}`);if(sd)sd.innerHTML=mkDelta(state.qbs[idx][({py:'passing_yards',ptd:'passing_tds',patt:'passing_attempts',pcomp:'passing_completions',int:'interceptions_thrown',qbry:'qb_rush_yards',qbrtd:'qb_rush_tds',qbratt:'qb_rush_attempts'})[changedKey]],bases[changedKey]||0,changedKey==='int');}
  const tot=document.getElementById('qbTeamTotals'); if(tot) tot.textContent=qbTotalsText(state);
}

// Update the workload card text (per-QB sub line, team-games budget, the active QB's
// games/snap sub spans) without a full re-render, so dragging stays smooth.
function updateWorkloadUI(state,qi,team){
  const q=state.qbs[qi];
  const sub=document.getElementById(`wl-sub-${qi}`);
  if(sub) sub.textContent=`${Math.round(q.games||0)} games · ${perGame(q,'passing_yards').toFixed(1)} pass yds/gm`;
  const gv=document.getElementById(`sv-games_${qi}`); if(gv&&document.activeElement!==gv) gv.textContent=Math.round(q.games||0);
  if((state.activeQB||0)===qi){
    const gsub=document.getElementById('qb-games-sub'); if(gsub) gsub.textContent=Math.round(q.games||0);
  }
  const teamGames=state.qbs.reduce((s,x)=>s+(x.games||0),0);
  const over=teamGames>SEASON_GAMES+0.5;
  const note=document.getElementById('qbWorkloadNote');
  if(note){
    note.style.color = over?'var(--warn)':'';
    note.textContent=`Team QB-games: ${teamGames.toFixed(0)} of ${SEASON_GAMES}`+(over?' ⚠️ over a full season — combined QB workload exceeds 17 games':'');
  }
}

// After a games-pace rescale, move the QB stat sliders + value badges to the new totals.
function refreshQBStatSliders(state,qi){
  if((state.activeQB||0)!==qi) return; // only the visible QB has stat sliders rendered
  const q=state.qbs[qi];
  const map={py:'passing_yards',ptd:'passing_tds',patt:'passing_attempts',
    pcomp:'passing_completions',int:'interceptions_thrown',
    qbry:'qb_rush_yards',qbrtd:'qb_rush_tds',qbratt:'qb_rush_attempts'};
  Object.entries(map).forEach(([k,prop])=>{
    const v=Math.round(q[prop]||0);
    const sl=document.querySelector(`input.sl[data-key="${k}"]`);
    if(sl){ sl.value=v; setFill(sl,sl.dataset.col||null); }
    const sv=document.getElementById(`sv-${k}`); if(sv&&document.activeElement!==sv) sv.textContent=v;
  });
}

// Receivers/rushing depend on QB pass attempts (via teamTargetPool). Refresh whatever
// passing/rushing view is currently shown so volume cascades from QB workload changes.
function livePassDependents(state,team){
  if(currentPhase!=='Passing') return;
  if(passingSubTab==='targets') livePassTargets(state,team);
  else liveTDRows('tdp','tdt',state.passing_shares||[],teamPassTDs(state),'tds_',true);
}

function livePassTargets(state,team){
  const totalTgts=teamTargetPool(state);
  const totalTDs=teamPassTDs(state);
  state.passing_shares.forEach((p,i)=>{
    const pct=(p.share*100).toFixed(1);
    const projTgts=Math.round(p.share*totalTgts);
    const projRec=Math.round(projTgts*(p.catch_rate||0.65));
    const projYds=Math.round(projTgts*(p.ypt||9));
    const projTDs=(p.td_share*totalTDs).toFixed(1);
    setTxt(`pp-${i}`,`${pct}%`); setTxt(`pt-${i}`,`${projTgts} tgt`);
    setEditTxt(`yd-${i}`,projYds); setEditTxt(`ypt-${i}`,(p.ypt||9).toFixed(1));
    setEditTxt(`cr-${i}`,((p.catch_rate||0.65)*100).toFixed(0)); setEditTxt(`rtd-${i}`,projTDs);
    setEditTxt(`ed-tgt-${i}`,projTgts); setEditTxt(`ed-rec-${i}`,projRec);
    const sl=document.querySelector(`input.sl[data-key="ps_${i}"]`);
    if(sl){sl.value=pct;setFill(sl,PCOLORS[i%PCOLORS.length]);}
  });
  const sub=document.getElementById('pieSub'); if(sub) sub.textContent=`${totalTgts} targets`;
  reorderShareBlocks('shareControls','pblk-',state.passing_shares,'share');
}

// Reorder share-block DOM nodes so the category leader floats to the top.
// Skipped during an active slider drag — resortAfterRelease() handles that on pointer-up,
// which keeps the drag from feeling glitchy. Manual text edits still reorder immediately.
function reorderShareBlocks(containerId,prefix,shares,field){
  if(sliderDragging) return;
  const host=document.getElementById(containerId); if(!host||!host.children) return;
  const order=shares.map((p,i)=>i).sort((a,b)=>shares[b][field]-shares[a][field]);
  const cur=Array.from(host.children).map(c=>c.id);
  const want=order.map(i=>`${prefix}${i}`);
  if(cur.join(',')===want.join(',')) return;
  order.forEach(i=>{ const el=document.getElementById(`${prefix}${i}`); if(el) host.appendChild(el); });
}

function liveTDRows(pctId,volId,shares,totalTDs,keyPrefix,editable){
  shares.forEach((p,i)=>{
    const pct=(p.td_share*100).toFixed(1);
    const proj=(p.td_share*totalTDs).toFixed(1);
    setTxt(`${pctId}-${i}`,`${pct}%`);
    if(editable) setEditTxt(`${volId}-${i}`,proj);
    else setTxt(`${volId}-${i}`,`${proj} TD`);
    const sl=document.querySelector(`input.sl[data-key="${keyPrefix}${i}"]`);
    if(sl){sl.value=pct;setFill(sl,PCOLORS[i%PCOLORS.length]);}
  });
  // resort by TD share (on release / manual edit, not mid-drag)
  if(keyPrefix==='tds_') reorderShareBlocks('shareControls','pblk-',shares,'td_share');
  else if(keyPrefix==='rtds_') reorderShareBlocks('rushShareControls','rblk-',shares,'td_share');
}

function liveRush(state,team){
  const d=document.getElementById('rushDerived'); if(d) d.textContent=rushNote(state);
  const lbl=document.getElementById('rushTotalLbl');
  if(lbl) lbl.textContent=`${state.rushing.total_attempts} att / ${(state.rushing.total_yards||0).toLocaleString()} yds`;
  liveRushRows(state,team);
}

function liveRushRows(state,team){
  const r=state.rushing;
  const totalTDs=teamRushTDs(state);
  r.shares.forEach((p,i)=>{
    const att=Math.round(p.share*r.total_attempts);
    const yds=Math.round(att*(p.ypc||r.ypa||4));
    const pct=(p.share*100).toFixed(1);
    const tds=(p.td_share*totalTDs).toFixed(1);
    setTxt(`rp-${i}`,`${pct}%`); setTxt(`ra-${i}`,`${att} att`);
    setEditTxt(`ryd-${i}`,yds); setEditTxt(`rtdv-${i}`,tds);
    setEditTxt(`ed-att-${i}`,att); setEditTxt(`ed-ypc-${i}`,(p.ypc||r.ypa||4).toFixed(2));
    const sl=document.querySelector(`input.sl[data-key="rs_${i}"]`);
    if(sl){sl.value=pct;setFill(sl,PCOLORS[i%PCOLORS.length]);}
  });
  const lbl=document.getElementById('rushTotalLbl');
  if(lbl) lbl.textContent=`${r.total_attempts} att / ${(r.total_yards||0).toLocaleString()} yds`;
  if(rushingSubTab==='carries') updatePie(r.shares.map(p=>p.share));
  reorderShareBlocks('rushShareControls','rblk-',r.shares,'share');
  // keep the team total-yards slider in sync (carries/ypc edits change the sum)
  const ys=document.querySelector('input.sl[data-key="rush_total_yds"]');
  if(ys){ys.value=r.total_yards;setFill(ys,'var(--rb)');
    const ysv=document.getElementById('sv-rush_total_yds');if(ysv&&document.activeElement!==ysv)ysv.textContent=r.total_yards;}
}

function setTxt(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
function setEditTxt(id,v){const e=document.getElementById(id);if(e&&document.activeElement!==e)e.textContent=v;}


// ─────────────────────────────────────────────────────────────────────────────
// Rankings
// ─────────────────────────────────────────────────────────────────────────────
function calcFpts(p){
  const sc=scoringSettings;let f=0;
  f+=(p.passing_yards||0)/sc.passing_yards_yardage*sc.passing_yards_points;
  f+=(p.passing_tds||0)*sc.passing_touchdowns;
  f+=(p.interceptions_thrown||0)*sc.interceptions_thrown;
  f+=(p.passing_attempts||0)*sc.passing_attempts;
  f+=(p.passing_completions||0)*sc.passing_completions;
  f+=(p.receiving_yards||0)/sc.receiving_yards_yardage*sc.receiving_yards_points;
  f+=(p.receiving_tds||0)*sc.receiving_touchdowns;
  f+=(p.receptions||0)*sc.receptions;
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
// Reference-season only: available when the rankings page is viewing a completed season that
// SumerSports covers (2022-2025). Never on the projection season, never for seasons w/o data.
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
  // Determine per-position starter demand across the league. Prefer a LINKED draft's real
  // lineup; otherwise fall back to a standard 12-team lineup shaped by the current rankFormat
  // (so switching the format dropdown to Superflex actually changes QB scarcity/VOR).
  const teams = (draftMeta && draftMeta.settings && draftMeta.settings.teams) || 12;
  const base = { QB:1, RB:2, WR:2, TE:1 };
  let flex=0, superflex=0;
  const hasLinkedLineup = draftId && draftLineup && draftLineup.length;
  if(hasLinkedLineup){
    const c={QB:0,RB:0,WR:0,TE:0,FLEX:0,SUPER_FLEX:0};
    draftLineup.forEach(s=>{ if(c[s]!=null) c[s]++; else if(s==='WRRB_FLEX'||s==='REC_FLEX') c.FLEX++; });
    base.QB=c.QB||1; base.RB=c.RB||2; base.WR=c.WR||2; base.TE=c.TE||1;
    flex=c.FLEX; superflex=c.SUPER_FLEX;
  } else {
    // No draft linked → shape demand from the rankings format so VOR reflects it.
    flex=1;  // standard single flex
    if(rankFormat==='superflex' || rankFormat==='dynasty_superflex') superflex=1;
  }
  return { teams, base, flex, superflex };
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
// Adapt the nflverse team tables for SHARP_SEASON into the Sharp-shaped dict the league view
// renders (adds title/category/pct_cols). Returns {} when no nflverse data for that season.
function nflverseSharpTables(){
  const t=(NFLVERSE && NFLVERSE[String(SHARP_SEASON)] && NFLVERSE[String(SHARP_SEASON)].team) || null;
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
// ── Player card modal ───────────────────────────────────────────────────────
// Clicking any player name opens a card showing per-game stats by season, colored
// green/yellow/red relative to positional expectations. QB is implemented first; other
// positions fall back to a generic set until their schemas are added.
//
// Each column: {key, label, get(row,ctx)->number|null, color(v)->'g'|'y'|'r'|'' , fmt}.
// Thresholds are per-GAME (weekly) values tuned to fantasy relevance; users can eyeball
// and we can adjust. Higher-is-better unless the color fn says otherwise (INT is inverted).
function _tri(v, goodAt, okAt){ // higher is better
  if(v==null) return '';
  if(v>=goodAt) return 'g';
  if(v>=okAt) return 'y';
  return 'r';
}
function _triLow(v, goodBelow, okBelow){ // lower is better (e.g. INT)
  if(v==null) return '';
  if(v<=goodBelow) return 'g';
  if(v<=okBelow) return 'y';
  return 'r';
}
// Column keys are unique per column (e.g. p_yd vs ru_yd vs re_yd) so a position can repeat a
// stat label like "YD"/"TD" across PASSING/RUSHING/RECEIVING groups. `label` is what shows.
const _C = {
  fpts: {key:'fpts', label:'FPTS', fmt:v=>v==null?'–':v.toFixed(1), color:v=>_tri(v,18,10)},
  snp:  {key:'snp',  label:'SNP%', fmt:v=>v==null?'–':Math.round(v), color:v=>_tri(v,70,45)},
  rank: {key:'rank', label:'RANK', fmt:v=>v==null?'–':v, color:v=>v==null?'':_triLow(v,12,28)},
};
const PCARD_SCHEMA = {
  QB: {
    group:[['FANTASY',3],['PASSING',10],['RUSHING',4]],
    cols:[
      {..._C.fpts, grp:0}, {..._C.snp, grp:0}, {..._C.rank, grp:0},
      {key:'p_att', label:'ATT', grp:1, color:v=>_tri(v,35,25)},
      {key:'p_cmp', label:'CMP', grp:1, color:v=>_tri(v,24,16)},
      {key:'p_cmp_pct',label:'PCT', grp:1, fmt: v => v == null ? '–':(typeof v === 'string'?(v.endsWith('%')?v:v+'%'):(Number.isFinite(v)&& Number.isInteger(v)?`${v}%`:`${Number(v).toFixed(1)}%`)),color: v => _tri(v,68,58)},
      {key:'p_yd',  label:'YD',  grp:1, color:v=>_tri(v,275,200)},
      {key:'p_air_yd',  label:'AIR',  grp:1, color:v=>_tri(v,150,100)},
      {key:'p_lng', label:'LNG', grp:1, color:v=>_tri(v,40,20)},
      {key:'p_rtg', label:'RTG', grp:1, fmt:v=>v==null?'–':(Number.isInteger(v)?v:v.toFixed(1)), color:v=>_tri(v,100,85)},
      {key:'p_rz_att',label:'RZ',  grp:1, color:v=>_tri(v,4,2)},
      {key:'p_td',  label:'TD',  grp:1, color:v=>_tri(v,2,1)},
      {key:'p_int', label:'INT', grp:1, color:v=>_triLow(v,0,1)},
      {key:'p_sack',label:'SACK',grp:1, color:v=>_triLow(v,1,3)},
      {key:'ru_att',label:'ATT', grp:2, color:()=>''},
      {key:'ru_yd', label:'YD',  grp:2, color:v=>_tri(v,40,15)},
      {key:'ru_ypc',label:'YPC', grp:2, fmt:v=>v==null?'–':(Number.isInteger(v)?v:v.toFixed(2)), color:v=>_tri(v,5,3.5)},
      {key:'ru_rz_att',label:'RZ', grp:2, color:v=>_tri(v,2,1)},
      {key:'ru_td', label:'TD',  grp:2, color:v=>_tri(v,1,0.5)},
    ],
  },
  RB: {
    group:[['FANTASY',3],['RUSHING',6],['RECEIVING',6]],
    cols:[
      {..._C.fpts, grp:0}, {..._C.snp, grp:0}, {..._C.rank, grp:0},
      {key:'ru_att',label:'ATT', grp:1, color:()=>''},
      {key:'ru_yd', label:'YD',  grp:1, color:v=>_tri(v,80,45)},
      {key:'ru_ypc',label:'YPC', grp:1, fmt:v=>v==null?'–':(Number.isInteger(v)?v:v.toFixed(2)), color:v=>_tri(v,4.5,3.5)},
      {key:'ru_lng',label:'LNG', grp:1, color:v=>_tri(v,20,10)},
      {key:'ru_rz_att',label:'RZ', grp:1, color:v=>_tri(v,2,1)},
      {key:'ru_td', label:'TD',  grp:1, color:v=>_tri(v,1,0.5)},
      {key:'re_tar',label:'TAR', grp:2, color:v=>_tri(v,5,3)},
      {key:'re_rec',label:'REC', grp:2, color:v=>_tri(v,4,2)},
      {key:'re_yd', label:'YD',  grp:2, color:v=>_tri(v,40,20)},
      {key:'re_ypt',label:'YPT', grp:2, fmt:v=>v==null?'–':(Number.isInteger(v)?v:v.toFixed(2)), color:v=>_tri(v,8,5)},
      {key:'re_ypc',label:'YPC', grp:2, fmt:v=>v==null?'–':(Number.isInteger(v)?v:v.toFixed(2)), color:v=>_tri(v,9,6)},
      {key:'re_td', label:'TD',  grp:2, color:v=>_tri(v,1,0.5)},
    ],
  },
  WR: {
    group:[['FANTASY',3],['RECEIVING',9],['RUSHING',4]],
    cols:[
      {..._C.fpts, grp:0}, {..._C.snp, grp:0}, {..._C.rank, grp:0},
      {key:'re_tar',label:'TAR', grp:1, color:v=>_tri(v,8,5)},
      {key:'re_rec',label:'REC', grp:1, color:v=>_tri(v,6,4)},
      {key:'re_yd', label:'YD',  grp:1, color:v=>_tri(v,80,50)},
      {key:'re_ypt',label:'YPT', grp:1, fmt:v=>v==null?'–':(Number.isInteger(v)?v:v.toFixed(2)), color:v=>_tri(v,9,6)},
      {key:'re_ypc',label:'YPC', grp:1, fmt:v=>v==null?'–':(Number.isInteger(v)?v:v.toFixed(2)), color:v=>_tri(v,14,10)},
      {key:'re_air',label:'AIR', grp:1, color:v=>_tri(v,80,40)},
      {key:'re_lng',label:'LNG', grp:1, color:v=>_tri(v,25,15)},
      {key:'re_rz_tgt',label:'RZ', grp:1, color:v=>_tri(v,2,1)},
      {key:'re_td', label:'TD',  grp:1, color:v=>_tri(v,1,0.5)},
      {key:'ru_att',label:'ATT', grp:2, color:()=>''},
      {key:'ru_yd', label:'YD',  grp:2, color:v=>_tri(v,20,8)},
      {key:'ru_ypc',label:'YPC', grp:2, fmt:v=>v==null?'–':(Number.isInteger(v)?v:v.toFixed(2)), color:v=>_tri(v,7,4)},
      {key:'ru_td', label:'TD',  grp:2, color:v=>_tri(v,1,0.5)},
    ],
  },
};
// TE uses the same schema as WR for now.
PCARD_SCHEMA.TE = PCARD_SCHEMA.WR;
// Format a Sleeper height (total inches as number/string, or an already-formatted string)
// into feet'inches" (e.g. 76 → 6'4"). Returns '–' if unknown.
function _fmtHeight(h){
  if(h==null||h==='') return '–';
  const s=String(h).trim();
  if(s.includes("'")) return s;                 // already like 6'4"
  const inches=parseInt(s,10);
  if(isNaN(inches)||inches<=0) return '–';
  return `${Math.floor(inches/12)}'${inches%12}"`;
}
// Pick the Sleeper positional-rank field that matches the currently-selected ranking format.
// Sleeper exposes pos_rank_std / pos_rank_half_ppr / pos_rank_ppr; superflex/dynasty formats
// have no dedicated rank, so we map them to their nearest points basis (ppr / half_ppr).
function pcardRankKey(){
  switch(rankFormat){
    case 'std': return 'pos_rank_std';
    case 'ppr': return 'pos_rank_ppr';
    case 'superflex': return 'pos_rank_ppr';       // SF is PPR-based in most leagues
    case 'dynasty': return 'pos_rank_half_ppr';
    case 'dynasty_superflex': return 'pos_rank_ppr';
    case 'half_ppr':
    default: return 'pos_rank_half_ppr';
  }
}
// Pull per-game values for a position from a Sleeper weekly stats row. Keys match the schema.
function pcardRowValues(pos, s, ctx){
  s = s||{};
  const ru_att=s.rush_att||0, ru_yd=s.rush_yd||0, ru_td=s.rush_td||0;
  const re_tar=s.rec_tgt||0, re_rec=s.rec||0, re_yd=s.rec_yd||0, re_td=s.rec_td||0;
  const base = { fpts: ctx.fpts, snp: ctx.snp, rank: ctx.rank };
  const rushing = {
    ru_att, ru_yd, ru_td,
    ru_ypc: ru_att>0 ? Math.round(ru_yd/ru_att*100)/100 : (ru_yd?0:null),
    ru_lng: s.rush_lng!=null ? s.rush_lng : null,
    ru_rz_att: s.rush_rz_att!=null ? s.rush_rz_att : 0,
  };
  const receiving = {
    re_tar, re_rec, re_yd, re_td,
    re_ypt: re_tar>0 ? Math.round(re_yd/re_tar*100)/100 : (re_yd?0:null),
    re_ypc: re_rec>0 ? Math.round(re_yd/re_rec*100)/100 : (re_yd?0:null),
    re_air: s.rec_air_yd!=null ? s.rec_air_yd : null,
    re_lng: s.rec_lng!=null ? s.rec_lng : null,
    re_rz_tgt: s.rec_rz_tgt!=null ? s.rec_rz_tgt : 0,
  };
  if(pos==='QB'){
    const pcmp=s.pass_cmp||0, patt=s.pass_att||0;
    return {...base,
      p_att: patt, p_cmp: pcmp, p_yd: s.pass_yd||0, p_air_yd: s.pass_air_yd||0, p_td: s.pass_td||0, p_int: s.pass_int||0,
      p_cmp_pct: (s.cmp_pct!=null) ? s.cmp_pct : (patt>0 ? Math.round(pcmp/patt*1000)/10 : null),
      p_lng: s.pass_lng!=null ? s.pass_lng : null,
      p_rtg: s.pass_rtg!=null ? s.pass_rtg : null,
      p_rz_att: s.pass_rz_att!=null ? s.pass_rz_att : 0,
      p_sack: s.pass_sack!=null ? s.pass_sack : 0,
      ...rushing };
  }
  if(pos==='RB' || pos==='WR' || pos==='TE'){
    return {...base, ...rushing, ...receiving};
  }
  return base;
}
// Compute a single game's fantasy points from the user's scoring settings.
function pcardFptsFromStats(s){
  s=s||{}; const sc=scoringSettings;
  let pts=0;
  const perYd=(ydPer, yd)=> (ydPer&&ydPer>0)? (yd/ydPer) : 0;
  pts += perYd(sc.passing_yards_yardage, s.pass_yd||0);
  pts += (s.pass_td||0)*(sc.passing_touchdowns||0);
  pts += (s.pass_int||0)*(sc.interceptions_thrown||0);
  pts += perYd(sc.rushing_yards_yardage, s.rush_yd||0);
  pts += (s.rush_td||0)*(sc.rushing_touchdowns||0);
  pts += perYd(sc.receiving_yards_yardage, s.rec_yd||0);
  pts += (s.rec||0)*(sc.receptions||0);
  pts += (s.rec_td||0)*(sc.receiving_touchdowns||0);
  pts += (s.pass_att!=null?(s.pass_att*(sc.passing_attempts||0)):0);
  pts += (s.fum_lost||0)*(sc.fumbles_lost||0);
  return Math.round(pts*100)/100;
}

let pcardOpen=false;
// Player-card image fallback: walk the pipe-separated data-fallbacks (ESPN headshots) when the
// current src 404s, then hide once exhausted.
function pcardImgFallback(img){
  const list=(img.dataset.fallbacks||'').split('|').filter(Boolean);
  if(list.length){ img.dataset.fallbacks=list.slice(1).join('|'); img.onerror=function(){pcardImgFallback(this);}; img.src=list[0]; }
  else { img.onerror=null; img.style.visibility='hidden'; }
}
// Once the ESPN athlete id is known, point the hero photo at that league's ESPN headshot — used
// for rookies whose Sleeper record has no espn_id (so the shell couldn't queue it up front).
function pcardApplyEspnHeadshot(aid, league){
  if(!aid) return;
  const img=document.querySelector('#pcardOverlay .pcard-hero-img'); if(!img) return;
  const other = league==='nfl' ? 'college-football' : 'nfl';
  const urls=[ESPN_HEADSHOT(league,aid), ESPN_HEADSHOT(other,aid)];
  if(img.style.visibility==='hidden'){
    img.style.visibility=''; img.dataset.fallbacks=urls.slice(1).join('|'); img.onerror=function(){pcardImgFallback(this);}; img.src=urls[0];
  } else {
    img.dataset.fallbacks=urls.join('|');   // queue ESPN as the next fallback if the primary later fails
  }
}
// Build a safe attribute string for openPlayerCard(...) — single-quoted JS args so it can sit
// inside a double-quoted onclick="" attribute without breaking it. Escapes quotes/backslashes.
function pcardArg(s){
  return "'" + String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;') + "'";
}
function pcardOnclick(idOrName, pos, team){
  return `openPlayerCard(${pcardArg(idOrName)},${pcardArg(pos)},${pcardArg(team)})`;
}
function openPlayerCard(nameOrId, pos, team){
  // Ensure the Sleeper player map is available (needed for metadata + id resolution).
  if(!sleeperPlayers){
    loadSleeperPlayers(true).then(()=>openPlayerCard(nameOrId,pos,team)).catch(()=>{
      toast('Player data still loading — try again in a moment','err');
    });
    return;
  }
  // Resolve a player_id: accept an id directly, or resolve from name(+pos).
  let pid = null;
  if(nameOrId && /^\d+$/.test(String(nameOrId))) pid = String(nameOrId);
  else pid = resolvePlayerId(nameOrId, pos);
  if(!pid){ toast('No stats available for that player','err'); return; }
  pcardOpen=true;
  renderPlayerCardShell(pid, pos, team);
  loadPlayerCardData(pid, pos, team);
}
function closePlayerCard(){
  pcardOpen=false;
  const el=document.getElementById('pcardOverlay'); if(el) el.remove();
}
function renderPlayerCardShell(pid, pos, team){
  const p = (sleeperPlayers&&sleeperPlayers[pid]) || {};
  const name = p.name || 'Player';
  const posc = pos || p.pos || '';
  const tm = team || p.team || '';
  // Age: show one decimal if the source has one (e.g. 29.5), else whole.
  const age = (p.age!=null) ? (Number.isInteger(p.age)?p.age:(Math.round(p.age*10)/10)) : '–';
  const exp = p.years_exp!=null ? (p.years_exp===0?'R':p.years_exp) : '–';
  // Height: Sleeper stores total inches (e.g. "76") or sometimes a string; render as 6'4".
  const height = _fmtHeight(p.height);
  const weight = p.weight!=null && p.weight!=='' ? `${p.weight} lbs` : '–';
  const college = p.college || '–';
  const jersey = (p.number!=null && p.number!=='') ? `#${p.number}` : '';
  // Photo: Sleeper headshot first, then ESPN (nfl → college) when Sleeper has none. Rookies with
  // no Sleeper espn_id get their ESPN photo filled in after the athlete id is resolved.
  const eid = p.espn_id||null;
  const heroFallbacks = eid ? [ESPN_HEADSHOT('nfl',eid), ESPN_HEADSHOT('college-football',eid)] : [];
  const overlay = document.getElementById('pcardOverlay');
  let tc = teamColor(tm);
  // A few team primaries are light (e.g. PIT gold, NO gold); darken those so the white hero
  // text stays legible while keeping the hue recognizable.
  if(_hexLum(tc) > 0.4) tc = _darken(tc, 0.45);
  const heroStyle = tm ? `background:linear-gradient(135deg, ${tc} 0%, ${tc} 42%, var(--surface) 100%);` : '';
  const metaItem=(label,val)=> (val==null||val==='–'||val==='') ?
    `<div class="pcard-meta-item"><span class="pcard-meta-label">${label}</span><span class="pcard-meta-val pcard-meta-empty">–</span></div>` :
    `<div class="pcard-meta-item"><span class="pcard-meta-label">${label}</span><span class="pcard-meta-val">${val}</span></div>`;
  const contractBand = contractSummaryHTML(name);
  const ktcBand = ktcLinkHTML(name, posc);
  const html = `
    <div class="pcard" onclick="event.stopPropagation()">
      <div class="pcard-hero" style="${heroStyle}">
        <div class="pcard-hero-logo" style="${tm?`background-image:url('${NFL_LOGO(tm)}')`:''}"></div>
        <img src="${hsURL({player_id:pid,pos:posc})}" class="pcard-hero-img" data-fallbacks="${heroFallbacks.join('|')}" onerror="pcardImgFallback(this)">
        <div class="pcard-hero-main">
          <div class="pcard-name">${name}${jersey?`<span class="pcard-jersey">${jersey}</span>`:''}</div>
          <div class="pcard-sub">${posc?`<span class="pos-badge pos-${posc}">${posc}</span>`:''}${tm?`<span class="pcard-team">${teamDisplayName(tm)}</span>`:''}</div>
          <div class="pcard-meta">
            ${metaItem('AGE', age)}
            ${metaItem('HT', height)}
            ${metaItem('WT', weight)}
            ${metaItem('EXP', exp)}
            ${metaItem('COLLEGE', college)}
          </div>
          <div class="pcard-hero-draft" id="pcardHeroDraft"></div>
        </div>
        <button class="pcard-close" onclick="closePlayerCard()" aria-label="Close">✕</button>
        ${ktcBand}
      </div>
      ${contractBand}
      <div class="pcard-tabs" id="pcardTabs"></div>
      <div class="pcard-body" id="pcardBody">
        <div class="pcard-loading">Loading game logs…</div>
      </div>
    </div>`;
  if(overlay){ overlay.innerHTML=html; }
  else {
    const div=document.createElement('div');
    div.id='pcardOverlay'; div.className='pcard-overlay';
    div.onclick=closePlayerCard;
    div.innerHTML=html;
    document.body.appendChild(div);
  }
}
// Player-card stats source: 'pro' (NFL career — Sleeper weekly for skill players, ESPN nfl for
// defense/other) or 'college' (ESPN college gamelog). Rookies default to college (no NFL games
// yet); every player can toggle to see their college production. The college feed is only fetched
// when that tab is opened, so it adds no cost to the default view.
let pcardState = null;        // {pid, posc, team, isSkill}
let pcardStatsMode = 'pro';
let pcardToken = 0;           // bumped on each source switch so a slow in-flight load can't clobber a newer one
async function loadPlayerCardData(pid, pos, team){
  const posc = pos || (sleeperPlayers&&sleeperPlayers[pid]&&sleeperPlayers[pid].pos) || 'QB';
  const isSkill = ['QB','RB','WR','TE'].includes(posc);
  const isOl = ['LT','LG','C','RG','RT','OL','G','T','OT','OG'].includes(posc);
  const isDefense = ['DE','DT','NT','DL','LB','MLB','OLB','ILB','WLB','SLB','DB','CB','S','FS','SS'].includes(posc);
  pcardState = {pid, posc, team, isSkill, isOl, isDefense};
  // Rookies have no NFL game log yet → default to their college stats; everyone else to the pros.
  pcardStatsMode = (isOl && typeof pcardOlAvailable==='function' && pcardOlAvailable(pid))
    ? 'olgrades'
    : (isRookiePlayer(pid) ? 'college' : 'pro');
  pcardRouteSeason = null;        // reset the Routes-tab season for the new player
  pcardQbPassingSeason = null;    // reset the Passing Chart season for the new player
  pcardRbFanSeason = null;        // reset the Rushing Fan season for the new player
  pcardOlSeason = null;           // reset the OL Grades season for the new player
  loadPcardDraft(pid);            // draft summary fills the hero banner (independent of stat source)
  renderPcardStatTabs();
  pcardLoadStats(pcardStatsMode);
}
// Fetch the player's draft summary once and drop it into the hero banner at the top of the card,
// independent of which stats source is showing. Uses the cached ESPN athlete-id + draft lookups.
async function loadPcardDraft(pid){
  try{
    const aid = await resolveEspnAthleteId(pid, (sleeperPlayers[pid]||{}).name, 'nfl');
    const info = aid ? await fetchEspnDraftInfo(aid) : null;
    const el = document.getElementById('pcardHeroDraft');
    if(el && pcardOpen) el.innerHTML = espnDraftHero(info);
  }catch(e){ /* leave the banner blank on failure */ }
}
// Render (or refresh) the NFL / College source toggle above the card body.
function renderPcardStatTabs(){
  const el = document.getElementById('pcardTabs');
  if(!el || !pcardState) return;
  const tab=(mode,label)=>`<button class="pcard-tab ${pcardStatsMode===mode?'active':''}" onclick="setPcardStatsMode('${mode}')">${label}</button>`;
  // The Routes tab only appears for skill players with baked nflverse route data.
  const routesTab = (pcardState.isSkill && typeof pcardRoutesAvailable==='function' && pcardRoutesAvailable(pcardState.pid))
    ? tab('routes','Routes') : '';
  const passingTab = (pcardState.posc==='QB' && typeof pcardQbPassingAvailable==='function' && pcardQbPassingAvailable(pcardState.pid))
    ? tab('passing','Passing Chart') : '';
  const rbFanTab = (pcardState.posc==='RB' && typeof pcardRbFanAvailable==='function' && pcardRbFanAvailable(pcardState.pid))
    ? tab('rbfan','Rushing Fan') : '';
  const olTab = (pcardState.isOl && typeof pcardOlAvailable==='function' && pcardOlAvailable(pcardState.pid))
    ? tab('olgrades','OL Grades') : '';
  el.innerHTML = tab('pro','NFL') + tab('college','College') + passingTab + rbFanTab + olTab + routesTab;
}
// Switch the card's stat source and reload the body from the matching feed.
function setPcardStatsMode(mode){
  if(!pcardState || pcardStatsMode===mode) return;
  pcardStatsMode = mode;
  renderPcardStatTabs();
  pcardLoadStats(mode);
}
// Retry the current card's stat load after a transient ESPN/network failure.
function retryPlayerCardData(){
  if(!pcardState) return;
  const pid = pcardState.pid;
  if(typeof clearEspnCardCaches==='function') clearEspnCardCaches(pid);
  pcardLoadStats(pcardStatsMode);
}
// Dispatch the body render for the chosen source. College always uses the ESPN college gamelog;
// pro uses Sleeper weekly (skill) or the ESPN nfl gamelog (defense / other).
function pcardLoadStats(mode){
  if(!pcardState) return;
  pcardToken++;
  const {pid, posc, isSkill} = pcardState;
  const body = document.getElementById('pcardBody');
  if(!body) return;
  if(mode==='routes'){
    body.innerHTML = renderPcardRoutes(pid);
    return;
  }
  if(mode==='passing'){
    if(typeof renderPcardQbPassing==='function'){
      body.innerHTML = renderPcardQbPassing(pid);
      return;
    }
    body.innerHTML = `<div class="pcard-loading">Passing chart unavailable in this build.</div>`;
    return;
  }
  if(mode==='rbfan'){
    if(typeof renderPcardRbFan==='function'){
      body.innerHTML = renderPcardRbFan(pid);
      return;
    }
    body.innerHTML = `<div class="pcard-loading">Rushing fan unavailable in this build.</div>`;
    return;
  }
  if(mode==='olgrades'){
    if(typeof renderPcardOlGrades==='function'){
      body.innerHTML = renderPcardOlGrades(pid);
      return;
    }
    body.innerHTML = `<div class="pcard-loading">OL grades unavailable in this build.</div>`;
    return;
  }
  if(mode==='defweekly'){
    if(typeof renderPcardDefWeekly==='function'){
      body.innerHTML = renderPcardDefWeekly(pid);
      return;
    }
    body.innerHTML = `<div class="pcard-loading">Defensive weekly data unavailable in this build.</div>`;
    return;
  }
  if(mode==='college'){
    return loadEspnCardData(pid, posc, body, {league:'college-football', def:!isSkill});
  }
  if(mode==='pro' && pcardState.isDefense && typeof pcardDefWeeklyAvailable==='function' && pcardDefWeeklyAvailable(pid) && typeof renderPcardDefWeekly==='function'){
    body.innerHTML = renderPcardDefWeekly(pid);
    return;
  }
  // Defensive weekly logs live in a lazy-loaded nflverse sidecar. If it isn't in memory yet
  // (hosted first-open), fetch it, then re-render this tab. Falls through to the ESPN gamelog
  // only if the sidecar genuinely has no data for this player.
  if(mode==='pro' && pcardState.isDefense && typeof ensureNflverseSection==='function'
     && !nflverseSectionReady('def_weekly')){
    body.innerHTML = `<div class="pcard-loading">Loading defensive weekly stats…</div>`;
    const tok = pcardToken;
    ensureNflverseSection('def_weekly').then(()=>{
      if(tok!==pcardToken || !pcardOpen || !pcardState || pcardState.pid!==pid) return;
      pcardLoadStats(mode);
    });
    return;
  }
  if(!isSkill){
    return loadEspnCardData(pid, posc, body, {league:'nfl', def:true});
  }
  if(!PCARD_SCHEMA[posc]){
    body.innerHTML = `<div class="pcard-loading">Game logs aren't available for ${posc}.</div>`;
    return;
  }
  return loadSleeperCareerStats(pid, posc, body);
}
// NFL career game logs for a skill player, from Sleeper's per-season weekly data.
async function loadSleeperCareerStats(pid, posc, body){
  const tok = pcardToken;
  const seasons = (HISTORY_SEASONS&&HISTORY_SEASONS.length)? HISTORY_SEASONS.slice() : [];
  if(!seasons.length){
    body.innerHTML = `<div class="pcard-loading">No historical seasons loaded. Load a 📦 seed with history to see game logs.</div>`;
    return;
  }
  body.innerHTML = `<div class="pcard-loading">Loading game logs…</div>`;
  try{
    const perSeason = await Promise.all(seasons.map(async s=>({season:s, weekly:await fetchPlayerWeekly(pid, s)})));
    if(!pcardOpen || tok!==pcardToken) return; // closed or switched sources while loading
    let out='';
    for(const {season, weekly} of perSeason){
      const rows = pcardSeasonRows(weekly, posc);
      if(!rows.length) continue;
      out += renderPcardSeason(season, rows, posc);
    }
    if(!out) out = `<div class="pcard-loading">No game data found for this player.</div>`;
    out += `<div class="pcard-src">Per-game stats via Sleeper · FPTS uses your current scoring settings.</div>`;
    if(pcardOpen && tok===pcardToken) body.innerHTML = out;
  }catch(e){
    if(pcardOpen && tok===pcardToken){
      body.innerHTML = `<div class="pcard-loading pcard-loading-retry"><span>Couldn't load game logs. Check your connection and try again.</span><button class="pcard-retry-btn" onclick="retryPlayerCardData()">Refresh</button></div>`;
    }
  }
}
// Build sorted weekly rows for one season from Sleeper weekly data.
function pcardSeasonRows(weekly, pos){
  const rows=[];
  for(const wk in (weekly||{})){
    const wn=parseInt(wk); if(isNaN(wn)) continue;
    const row=weekly[wk]; if(!row||typeof row!=='object') continue;
    const s=row.stats||{};
    const opp=row.opponent||row.opp||null;
    const team=row.team||null;
    // Sleeper marks home/away; if unavailable we just show the opp code.
    // Sleeper's weekly row has an is_away_team boolean; prefer it, with a game_id fallback.
    const isAway = (typeof row.is_away_team==='boolean') ? row.is_away_team
      : ((row.game_id && team && opp) ? (row.game_id.indexOf(team)>row.game_id.indexOf(opp)) : (row.home_or_away==='away'));
    const gp=s.gp||0;
    const snp = (('off_snp' in s)&&('tm_off_snp' in s)&&s.tm_off_snp>0)? Math.round(s.off_snp/s.tm_off_snp*1000)/10 : null;
    const rankKey = pcardRankKey();
    const rank = (gp>0 && s[rankKey]!=null) ? s[rankKey] : null;
    rows.push({wk:wn, opp, isAway, gp, bye:(gp===0 && !opp), stats:s, team,
      fpts: gp>0?pcardFptsFromStats(s):null, snp: gp>0?snp:null, rank});
  }
  rows.sort((a,b)=>a.wk-b.wk);
  return rows;
}
// Compute season totals from the weekly rows. Counting stats sum; "longest" takes the max;
// derived rates (YPC/YPT/CMP%) are recomputed from the summed components; FPTS sums; RANK
// isn't meaningful as a season total, so it's left blank in the totals row.
function pcardSeasonTotals(rows, pos){
  const t={}; // raw summed stats
  const SUM=['pass_cmp','pass_att','pass_yd', 'pass_air_yd','pass_td','pass_int','pass_rz_att','pass_sack',
    'rush_att','rush_yd','rush_td','rush_rz_att','rec_tgt','rec','rec_yd','rec_td',
    'rec_air_yd','rec_rz_tgt'];
  const MAX=['pass_lng','rush_lng','rec_lng'];
  let fptsSum=0, games=0, snpSum=0, snpN=0;
  for(const r of rows){
    if(r.bye || r.gp===0) continue;
    games++;
    const s=r.stats||{};
    for(const k of SUM) t[k]=(t[k]||0)+(s[k]||0);
    for(const k of MAX) t[k]=Math.max(t[k]||0, s[k]||0);
    if(r.fpts!=null) fptsSum+=r.fpts;
    if(r.snp!=null){ snpSum+=r.snp; snpN++; }
  }
  if(!games) return null;
  // Build a synthetic "stats" object and derive a value map via pcardRowValues, then override
  // the rate fields with totals-based recomputes.
  const avgSnp = snpN? Math.round(snpSum/snpN*10)/10 : null;
  const vals = pcardRowValues(pos, t, {fpts: Math.round(fptsSum*10)/10, snp: avgSnp, rank: null});
  // recompute rates from season totals (pcardRowValues already does this since it divides
  // summed components), and set pass rating / cmp% cleanly:
  if(pos==='QB'){
    vals.p_cmp_pct = t.pass_att>0 ? Math.round(t.pass_cmp/t.pass_att*1000)/10 : null;
    vals.p_rtg = _passerRating(t);   // season passer rating from totals
    vals.p_lng = t.pass_lng||null;
  }
  vals._games=games;
  return vals;
}
// NFL passer rating from cumulative pass stats (used for the QB season-totals row).
function _passerRating(t){
  const att=t.pass_att||0; if(!att) return null;
  const cmp=t.pass_cmp||0, yd=t.pass_yd||0, td=t.pass_td||0, intc=t.pass_int||0;
  let a=((cmp/att)-0.3)*5, b=((yd/att)-3)*0.25, c=(td/att)*20, d=2.375-((intc/att)*25);
  const cl=x=>Math.max(0,Math.min(2.375,x));
  a=cl(a);b=cl(b);c=cl(c);d=cl(d);
  return Math.round(((a+b+c+d)/6*100)*10)/10;
}
function renderPcardSeason(season, rows, pos){
  const schema=PCARD_SCHEMA[pos]; if(!schema) return '';
  // group header row
  const grpCells = schema.group.map(([label,span])=>`<th class="pcard-grp" colspan="${span}">${label}</th>`).join('<th></th>');
  const colHead = schema.cols.map((c,i)=>{
    const prev=schema.cols[i-1];
    const sep = (prev && prev.grp!==c.grp) ? '<th></th>' : '';
    return sep+`<th>${c.label}</th>`;
  }).join('');
  const bodyRows = rows.map(r=>{
    if(r.bye){
      const spans = schema.cols.map((c,i)=>{
        const prev=schema.cols[i-1]; const sep=(prev&&prev.grp!==c.grp)?'<td></td>':'';
        return sep+`<td class="pcard-cell bye">–</td>`;
      }).join('');
      return `<tr><td class="pcard-wk">${r.wk}</td><td class="pcard-opp">BYE</td>${spans}</tr>`;
    }
    const ctx={ fpts:r.fpts, snp:r.snp, rank:r.rank };
    const vals=pcardRowValues(pos, r.stats, ctx);
    const cells = schema.cols.map((c,i)=>{
      const prev=schema.cols[i-1]; const sep=(prev&&prev.grp!==c.grp)?'<td></td>':'';
      const v=vals[c.key];
      const cls=c.color?c.color(v):'';
      return sep+`<td class="pcard-cell ${cls}">${c.fmt?c.fmt(v):(v==null?'–':v)}</td>`;
    }).join('');
    const oppTxt = r.opp
      ? `<span class="pcard-opp-inner">${r.isAway?'<span class="pcard-at">@</span>':'<span class="pcard-vs">vs</span>'}<img src="${NFL_LOGO(r.opp)}" class="pcard-opp-logo" onerror="this.style.display='none'"><span>${r.opp}</span></span>`
      : '–';
    return `<tr><td class="pcard-wk">${r.wk}</td><td class="pcard-opp ${r.isAway?'away':'home'}">${oppTxt}</td>${cells}</tr>`;
  }).join('');
  // Season totals row (uncolored, bold) — counting stats summed, rates recomputed, LNG maxed.
  let totalsRow='';
  const tot=pcardSeasonTotals(rows, pos);
  if(tot){
    const tcells = schema.cols.map((c,i)=>{
      const prev=schema.cols[i-1]; const sep=(prev&&prev.grp!==c.grp)?'<td></td>':'';
      // RANK has no meaningful season total; show a dash.
      const v = (c.key==='rank') ? null : tot[c.key];
      return sep+`<td class="pcard-cell pcard-total-cell">${v==null?'–':(c.fmt?c.fmt(v):v)}</td>`;
    }).join('');
    totalsRow = `<tr class="pcard-total-row"><td class="pcard-wk">TOT</td>
      <td class="pcard-opp">${tot._games}g</td>${tcells}</tr>`;
  }
  return `<div class="pcard-season">
    <div class="pcard-season-title">${season}${pcardSeasonTeamTag(rows)}</div>
    <div class="pcard-table-scroll"><table class="pcard-table">
      <thead>
        <tr><th></th><th></th>${grpCells}</tr>
        <tr><th class="pcard-th-wk">WK</th><th>OPP</th>${colHead}</tr>
      </thead>
      <tbody>${bodyRows}${totalsRow}</tbody>
    </table></div>
  </div>`;
}

// Team abbreviation(s) a player logged games for in a season — shown next to the season title
// so a mid-season trade (or offseason move) reads clearly (e.g. "2025 · CLE / CIN").
function pcardSeasonTeamTag(rows){
  const teams=[...new Set((rows||[]).filter(r=>!r.bye && r.team).map(r=>r.team))];
  return teams.length ? ` <span class="pcard-season-team">· ${teams.map(t=>`<img src="${NFL_LOGO(t)}" class="pcard-season-logo" onerror="this.style.display='none'">${t}`).join(' / ')}</span>` : '';
}

// ── Route tree (player-card "Routes" tab) ────────────────────────────────────
// nflverse participation tags each pass play with the route the TARGETED receiver ran, so
// counting those per receiver gives a "routes run when targeted" distribution — exactly what a
// route tree draws. The seed bakes it as NFLVERSE[season].routes[normName] = {pos,total,tree}.
//
// The tree is drawn PFF-style: routes fan out from the receiver at the line of scrimmage, each
// coloured + weighted by how often it was run (a heat map), and labelled with its share. Swing
// and Angle (Texas) routes start from the BACKFIELD, below the LOS, so they read as RB releases
// rather than being forced onto the WR's release point.

// Each route: o=origin ('los' | 'bf'=backfield), p=waypoints in field units (x:+right, y:+downfield
// in yards from the LOS spot), label, anc=text-anchor, dx/dy=label nudge (px) off the endpoint.
const ROUTE_TREE_SHAPES = {
  "GO":                {o:'los', p:[[0,0],[0,14]],                 label:'Go',        anc:'middle', dx:0,  dy:-9},
  "POST":              {o:'los', p:[[0,0],[0,9],[-4,13]],          label:'Post',      anc:'end',    dx:-4, dy:-5},
  "CORNER":            {o:'los', p:[[0,0],[0,9],[4,13]],           label:'Corner',    anc:'start',  dx:4,  dy:-5},
  "DEEP OUT":          {o:'los', p:[[0,0],[0,7.5],[4,7.5]],        label:'Out',       anc:'start',  dx:6,  dy:3},
  "IN/DIG":            {o:'los', p:[[0,0],[0,7],[-5,7]],           label:'Dig',       anc:'end',    dx:-6, dy:3},
  "WHEEL":             {o:'los', p:[[0,0],[2.6,1],[3.4,9]],        label:'Wheel',     anc:'start',  dx:6,  dy:0},
  "HITCH/CURL":        {o:'los', p:[[0,0],[0,5.5],[-1.2,4.6]],     label:'Hitch',     anc:'end',    dx:-7, dy:1},
  "QUICK OUT":         {o:'los', p:[[0,0],[0,3],[3,3]],            label:'Quick Out', anc:'start',  dx:6,  dy:3},
  "SLANT":             {o:'los', p:[[0,0],[0,1.2],[-3,3.4]],       label:'Slant',     anc:'end',    dx:-6, dy:-1},
  "CROSS":             {o:'los', p:[[0,0],[0,7.5],[-6,10.3]],      label:'Cross',     anc:'end',    dx:15, dy:-10},
  "SHALLOW CROSS/DRAG":{o:'los', p:[[0,0],[0,1.2],[-5.5,2]],       label:'Drag',      anc:'end',    dx:-6, dy:4},
  "SCREEN":            {o:'los', p:[[0,0],[0,-0.4],[-3,-0.8]],     label:'Screen',    anc:'end',    dx:-6,  dy:4},
  "SWING":             {o:'bf',  p:[[0,-2.7],[-4,-2.5],[-7,-1.4]], label:'Swing',     anc:'start',  dx:-20,  dy:35},
  "TEXAS/ANGLE":       {o:'bf',  p:[[0,-2.7],[4,-0.7],[1,1.7]],    label:'Texas',     anc:'start',  dx:45, dy:50},
};
// Draw order: least-run underneath, most-run on top (so hot routes read clearly).
const ROUTE_TREE_ORDER = ["GO","POST","CORNER","DEEP OUT","IN/DIG","WHEEL","HITCH/CURL","QUICK OUT",
  "SLANT","CROSS","SHALLOW CROSS/DRAG","SCREEN","SWING","TEXAS/ANGLE"];

// Some nflverse route tags are shorter/raw versions of the compact labels we already show.
// Normalize them onto the existing shapes so the tree stays readable without adding more nodes.
const ROUTE_TREE_ALIASES = {
  "HITCH": "HITCH/CURL",
  "IN": "IN/DIG",
  "OUT": "DEEP OUT",
  "FLAT": "QUICK OUT",
};

function _routeTreeKey(k){
  return ROUTE_TREE_ALIASES[k] || k;
}

let pcardRouteSeason = null;   // selected season in the Routes tab (reset per card)
let pcardRouteMetric = 'td';   // selected metric in Routes tab (td|yds|rec)

const ROUTE_TREE_METRICS = {
  td:  {label:'TD share',      short:'TD',         map:'route_tds', total:'total_tds', digits:0, unit:' TD', summary:'on charted routes'},
  yds: {label:'Yardage share', short:'Yards',      map:'route_yds', total:'total_yds', digits:0, unit:' yd', summary:'charted-route yards'},
  rec: {label:'Reception share',short:'Receptions',map:'route_rec', total:'total_rec', digits:0, unit:' rec',summary:'charted-route receptions'},
};

function _routeMetricKnown(rt, metric){
  const m=ROUTE_TREE_METRICS[metric]||ROUTE_TREE_METRICS.td;
  const map=rt&&rt[m.map];
  if(map && Object.keys(map).length>0) return true;
  if(rt && rt[m.total]!=null) return true;
  return false;
}

function _routeMetricValueByRaw(rt, rawKey, metric){
  const m=ROUTE_TREE_METRICS[metric]||ROUTE_TREE_METRICS.td;
  const map=rt&&rt[m.map];
  if(map && map[rawKey]!=null) return +map[rawKey]||0;
  return null;
}

function _routeMetricTotal(rt, metric, fallbackMap){
  const m=ROUTE_TREE_METRICS[metric]||ROUTE_TREE_METRICS.td;
  if(rt && rt[m.total]!=null) return +rt[m.total]||0;
  const map=rt&&rt[m.map];
  if(map && Object.keys(map).length) return Object.values(map).reduce((a,b)=>a+(+b||0),0);
  if(fallbackMap) return Object.values(fallbackMap).reduce((a,b)=>a+b,0);
  return 0;
}

function _fmtRouteMetricValue(v, metric){
  if(v==null) return '—';
  const m=ROUTE_TREE_METRICS[metric]||ROUTE_TREE_METRICS.td;
  const n=(m.digits>0)?(+v).toFixed(m.digits):String(Math.round(+v||0));
  return `${n}${m.unit}`;
}

// Seasons (desc) for which this player has a baked route tree.
function pcardRouteSeasons(normName){
  if(typeof NFLVERSE==='undefined' || !NFLVERSE) return [];
  return Object.keys(NFLVERSE)
    .filter(s=>{ const r=NFLVERSE[s]&&NFLVERSE[s].routes; return r && r[normName]; })
    .sort((a,b)=>b-a);
}
function _pcardNorm(pid){
  const p=(typeof sleeperPlayers!=='undefined'&&sleeperPlayers&&sleeperPlayers[pid])||{};
  return ecrNormName(p.name||'');
}
// Does the player have any baked route data? (gates the Routes tab).
function pcardRoutesAvailable(pid){
  return pcardRouteSeasons(_pcardNorm(pid)).length>0;
}

// Heat colour for a route by its share of the max route (blue = rare → red = most-run).
function _routeHeat(ratio){
  const hue = Math.round(210 - Math.max(0,Math.min(1,ratio))*198);
  return `hsl(${hue},85%,60%)`;
}

// The SVG route tree for one season's distribution.
function routeTreeSVG(rt, metric){
  metric=ROUTE_TREE_METRICS[metric]?metric:'td';
  const W=360, H=440, cx=180, losY=340, sx=15, sy=20;
  const PX = x => +(cx + x*sx).toFixed(1);
  const PY = y => +(losY - y*sy).toFixed(1);
  const tree=rt.tree||{}, total=rt.total||Object.values(tree).reduce((a,b)=>a+b,0)||1;
  const metricKnown=_routeMetricKnown(rt, metric);
  const rawKeys = Object.keys(tree);
  const presentMap = {};
  for(const rawKey of rawKeys){
    const key=_routeTreeKey(rawKey);
    if(!ROUTE_TREE_SHAPES[key]) continue;
    if(!presentMap[key]) presentMap[key]={count:0, metric:0};
    presentMap[key].count += +tree[rawKey] || 0;
    if(metricKnown){
      const mv=_routeMetricValueByRaw(rt, rawKey, metric);
      if(mv!=null) presentMap[key].metric += mv;
    }
  }
  const present = ROUTE_TREE_ORDER.filter(k=>presentMap[k] && presentMap[k].count>0 && ROUTE_TREE_SHAPES[k]);
  const metricTotal=metricKnown ? _routeMetricTotal(rt, metric, presentMap) : 0;
  const maxN = Math.max(1, ...present.map(k=>presentMap[k].count));
  const hasBf = present.some(k=>ROUTE_TREE_SHAPES[k].o==='bf');
  // Field backdrop + yard lines every 5 yards up to ~15.
  let yard='';
  for(let y=5;y<=15;y+=5){ const py=PY(y); yard+=`<line x1="24" y1="${py}" x2="${W-24}" y2="${py}" class="rt-yard"/>`; }
  // Per-route render geometry.
  const items = present.map(k=>{
    const sh=ROUTE_TREE_SHAPES[k], n=presentMap[k].count;
    const metricV=presentMap[k].metric;
    const pct=100*n/total, ratio=n/maxN;
    const col=_routeHeat(ratio), w=+(2.4+ratio*5).toFixed(2);
    const pts=sh.p.map(([x,y])=>[PX(x),PY(y)]);
    const end=pts[pts.length-1], prev=pts[pts.length-2];
    const ang=Math.atan2(end[1]-prev[1], end[0]-prev[0]);
    const side = sh.anc==='end'?'L' : (sh.anc==='start'?'R':'C');
    return {sh,n,pct,ratio,col,w,pts,end,ang,side,metricV};
  });
  // Draw least-run first so the hot routes sit on top; each route ends in an arrowhead.
  let paths='';
  for(const it of items.slice().sort((a,b)=>a.n-b.n)){
    paths+=`<polyline points="${it.pts.map(p=>p.join(',')).join(' ')}" fill="none" stroke="${it.col}" stroke-width="${it.w}" stroke-linejoin="round" stroke-linecap="round" opacity="0.95"/>`;
    const [ex,ey]=it.end, a=it.ang, aLen=8+it.ratio*3, aW=3.4+it.ratio*1.8;
    const tip=[ex+Math.cos(a)*aLen*0.5, ey+Math.sin(a)*aLen*0.5];
    const back=[ex-Math.cos(a)*aLen*0.5, ey-Math.sin(a)*aLen*0.5];
    const b1=[back[0]+Math.cos(a+Math.PI/2)*aW, back[1]+Math.sin(a+Math.PI/2)*aW];
    const b2=[back[0]+Math.cos(a-Math.PI/2)*aW, back[1]+Math.sin(a-Math.PI/2)*aW];
    paths+=`<polygon points="${tip[0].toFixed(1)},${tip[1].toFixed(1)} ${b1[0].toFixed(1)},${b1[1].toFixed(1)} ${b2[0].toFixed(1)},${b2[1].toFixed(1)}" fill="${it.col}"/>`;
  }
  // Label placement with a vertical de-collision pass per side (left / right / centre), so the
  // lower clusters (Slant/Angle/Drag …) don't stack on top of each other. A thin leader line is
  // drawn to any label that had to be nudged away from its route's endpoint.
  const MINGAP=14;
  const placeCol = list => {
    list.forEach(it=>{ it.lx=+(it.end[0]+it.sh.dx).toFixed(1); it.ly0=it.end[1]+it.sh.dy; it.ly=it.ly0; });
    list.sort((a,b)=>a.ly-b.ly);
    for(let i=1;i<list.length;i++) if(list[i].ly < list[i-1].ly+MINGAP) list[i].ly=list[i-1].ly+MINGAP;
    if(list.length){
      const over=list[list.length-1].ly-(H-10);
      if(over>0) list.forEach(it=>it.ly-=over);
      const under=16-list[0].ly;
      if(under>0) list.forEach(it=>it.ly+=under);
    }
  };
  placeCol(items.filter(i=>i.side==='L'));
  placeCol(items.filter(i=>i.side==='R'));
  placeCol(items.filter(i=>i.side==='C'));
  let labels='';
  for(const it of items){
    if(Math.abs(it.ly-it.ly0)>3)
      labels+=`<line x1="${it.end[0]}" y1="${it.end[1]}" x2="${it.lx}" y2="${(it.ly-3).toFixed(1)}" class="rt-leader"/>`;
    let metricTag='';
    if(metricKnown){
      if(metric==='td' && it.metricV>0) metricTag=` <tspan class="rt-label-td">${Math.round(it.metricV)} TD</tspan>`;
      else if(metric!=='td' && it.metricV>0) metricTag=` <tspan class="rt-label-alt">${_fmtRouteMetricValue(it.metricV, metric)}</tspan>`;
    }
        labels+=`<text x="${it.lx}" y="${it.ly.toFixed(1)}" text-anchor="${it.sh.anc}" class="rt-label">`+
          `<tspan class="rt-label-name">${it.sh.label}</tspan> <tspan class="rt-label-pct" fill="${it.col}">${it.pct.toFixed(1)}%</tspan>${metricTag}</text>`;
  }
  // LOS + origin markers.
  const losLine=`<line x1="20" y1="${losY}" x2="${W-20}" y2="${losY}" class="rt-los"/>`;
  const wrDot=`<circle cx="${PX(0)}" cy="${PY(0)}" r="5.5" class="rt-origin"/>`;
  const bfDot=hasBf?`<circle cx="${PX(0)}" cy="${PY(-2.7)}" r="4" class="rt-origin-bf"/>`+
    `<line x1="${PX(0)}" y1="${PY(-2.7)}" x2="${PX(0)}" y2="${PY(-0.2)}" class="rt-bf-stem"/>`:'';
  const losTag=`<text x="${W-22}" y="${losY-5}" text-anchor="end" class="rt-los-tag">LOS</text>`;
  const bfTag=hasBf?`<text x="${PX(0)}" y="${PY(-2.7)+16}" text-anchor="middle" class="rt-bf-tag">backfield</text>`:'';
  return `<svg viewBox="0 0 ${W} ${H}" class="rt-svg" role="img" aria-label="Route tree">`+
    `<rect x="0" y="0" width="${W}" height="${H}" class="rt-field"/>`+
    yard+losLine+losTag+paths+wrDot+bfDot+bfTag+labels+`</svg>`;
}

// Ranked list beneath the tree — exact counts + share, coloured to match the tree.
function routeTreeList(rt, metric){
  metric=ROUTE_TREE_METRICS[metric]?metric:'td';
  const tree=rt.tree||{}, total=rt.total||1;
  const metricKnown=_routeMetricKnown(rt, metric);
  const rowsMap = {};
  for(const [rawKey, rawCount] of Object.entries(tree)){
    const key=_routeTreeKey(rawKey);
    if(!ROUTE_TREE_SHAPES[key]) continue;
    if(!rowsMap[key]) rowsMap[key]={count:0, metric:0};
    rowsMap[key].count += +rawCount || 0;
    if(metricKnown){
      const mv=_routeMetricValueByRaw(rt, rawKey, metric);
      if(mv!=null) rowsMap[key].metric += mv;
    }
  }
  const valueFor = row => row[1].count;
  const rows=Object.entries(rowsMap).sort((a,b)=>valueFor(b)-valueFor(a));
  const maxN=Math.max(1,...rows.map(valueFor));
  const metricShort=(ROUTE_TREE_METRICS[metric]||ROUTE_TREE_METRICS.td).short;
  const metricClass = metric==='td' ? 'rt-list-td' : 'rt-list-val';
  return `<div class="rt-list">`+rows.map(([k,v])=>{
    const n=v.count;
    const metricV=v.metric;
    const pct=100*n/total;
    const col=_routeHeat(n/maxN);
    const label=(ROUTE_TREE_SHAPES[k]||{}).label||k;
    let metricTxt='—';
    if(metricKnown){
      metricTxt=_fmtRouteMetricValue(metricV, metric);
    }
    return `<div class="rt-list-row">`+
      `<span class="rt-list-name">${label}</span>`+
      `<span class="rt-list-bar"><span class="rt-list-fill" style="width:${(100*n/maxN).toFixed(0)}%;background:${col}"></span></span>`+
      `<span class="rt-list-n">${n}</span><span class="rt-list-pct">${pct.toFixed(1)}%</span><span class="${metricClass}" title="${metricShort}">${metricTxt}</span></div>`;
  }).join('')+`</div>`;
}

// The full Routes-tab body: season selector + tree + list.
function renderPcardRoutes(pid){
  const norm=_pcardNorm(pid);
  const seasons=pcardRouteSeasons(norm);
  if(!seasons.length) return `<div class="pcard-loading">No route data for this player.</div>`;
  if(pcardRouteSeason==null || !seasons.includes(String(pcardRouteSeason))) pcardRouteSeason=seasons[0];
  const rt=NFLVERSE[pcardRouteSeason].routes[norm];
  if(!ROUTE_TREE_METRICS[pcardRouteMetric]) pcardRouteMetric='td';
  const seasonBtns=seasons.map(s=>`<button class="rt-season-btn ${String(s)===String(pcardRouteSeason)?'active':''}" onclick="setPcardRouteSeason('${s}')">${s}</button>`).join('');
  const metricBtns=Object.entries(ROUTE_TREE_METRICS).map(([k,m])=>{
    const known=_routeMetricKnown(rt,k);
    const active=(k===pcardRouteMetric)?'active':'';
    const dis=known?'':'disabled';
    const ttl=known?`Show ${m.label}`:`${m.short} data unavailable for this season`;
    return `<button class="rt-metric-btn ${active}" ${dis} title="${ttl}" onclick="setPcardRouteMetric('${k}')">${m.short}</button>`;
  }).join('');
  const topRoute=Object.entries(rt.tree||{}).sort((a,b)=>b[1]-a[1])[0];
  const topLabel=topRoute?((ROUTE_TREE_SHAPES[topRoute[0]]||{}).label||topRoute[0]):'–';
  const metricCfg=ROUTE_TREE_METRICS[pcardRouteMetric];
  const metricKnown=_routeMetricKnown(rt, pcardRouteMetric);
  const metricTotal=metricKnown ? _routeMetricTotal(rt, pcardRouteMetric) : null;
  const metricSummary = metricKnown
    ? `${_fmtRouteMetricValue(metricTotal, pcardRouteMetric)} ${metricCfg.summary}`
    : `${metricCfg.short} route data unavailable in this seed`;
  return `
    <div class="rt-wrap">
      <div class="rt-head">
        <div class="rt-seasons">${seasonBtns}</div>
        <div class="rt-metrics">${metricBtns}</div>
        <div class="rt-summary">${rt.total} routes charted · ${metricSummary} · most-run <b>${topLabel}</b></div>
      </div>
      ${routeTreeSVG(rt, pcardRouteMetric)}
      ${routeTreeList(rt, pcardRouteMetric)}
      <div class="pcard-src">Route types via nflverse participation charting (route run when targeted, ${pcardRouteSeason} regular season).</div>
    </div>`;
}
// Switch the Routes-tab season and re-render just the body.
function setPcardRouteSeason(s){
  pcardRouteSeason=s;
  const body=document.getElementById('pcardBody');
  if(body && pcardState) body.innerHTML=renderPcardRoutes(pcardState.pid);
}

function setPcardRouteMetric(metric){
  if(!ROUTE_TREE_METRICS[metric]) return;
  pcardRouteMetric=metric;
  const body=document.getElementById('pcardBody');
  if(body && pcardState) body.innerHTML=renderPcardRoutes(pcardState.pid);
}
// ── QB passing chart (player-card "Passing Chart" tab) ─────────────────────
// Seed payload: NFLVERSE[season].qb_passing[normName] = {
//   team, totals:{passer_rating,comp_pct,yards,td,int,attempts},
//   zones:{deep|inter|short|behind:{left|middle|right:{rating,league_avg,attempts}}}
// }

const QB_PASS_ROW_ORDER = ['deep','inter','short','behind'];
const QB_PASS_COL_ORDER = ['left','middle','right'];
const QB_PASS_THRESH = 5.0;

let pcardQbPassingSeason = null;

function _pcardQbNorm(pid){
  const p=(typeof sleeperPlayers!=='undefined'&&sleeperPlayers&&sleeperPlayers[pid])||{};
  return ecrNormName(p.name||'');
}

function pcardQbPassingSeasons(normName){
  if(typeof NFLVERSE==='undefined' || !NFLVERSE) return [];
  return Object.keys(NFLVERSE)
    .filter(s=>{ const q=NFLVERSE[s]&&NFLVERSE[s].qb_passing; return q && q[normName]; })
    .sort((a,b)=>b-a);
}

function pcardQbPassingAvailable(pid){
  return pcardQbPassingSeasons(_pcardQbNorm(pid)).length>0;
}

function _qbCellColor(rating, leagueAvg){
  if(rating==null || leagueAvg==null) return '#3a3e44';
  const d = rating - leagueAvg;
  if(d > QB_PASS_THRESH) return '#2fae4e';
  if(d < -QB_PASS_THRESH) return '#d33b2f';
  return '#d8a51d';
}

function _qbNum(v, dp=1){
  if(v==null || Number.isNaN(v)) return '—';
  return Number(v).toFixed(dp);
}

function _qbPassingSVG(chart, playerName, season){
  const zones = chart.zones || {};
  const W=760, H=600;
  const yTop=60, yBot=560;
  const rowY=[60,176,298,428,560];
  const left=(y)=>170 - 130*(y-yTop)/(yBot-yTop);
  const right=(y)=>590 + 130*(y-yTop)/(yBot-yTop);
  const gap=5;

  const parts=[];
  parts.push(`<svg viewBox="0 0 ${W} ${H}" class="qpc-svg" role="img" aria-label="QB passing chart">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#101214"/>`);
  parts.push(`<text x="24" y="28" fill="#fff" font-size="20" font-weight="800">${playerName.toUpperCase()} <tspan fill="#9aa0a6" font-size="13" font-weight="600">/ ${season} REGULAR SEASON</tspan></text>`);
  parts.push('<text x="24" y="48" fill="#9aa0a6" font-size="12">Passer rating vs. league average by throw zone (nflverse)</text>');

  for(let r=0;r<4;r++){
    const depth=QB_PASS_ROW_ORDER[r];
    const y0=rowY[r], y1=rowY[r+1];
    for(let c=0;c<3;c++){
      const loc=QB_PASS_COL_ORDER[c];
      const z=((zones[depth]||{})[loc])||{};
      const rating=z.rating;
      const lg=z.league_avg;
      const att=+z.attempts||0;
      const l0=left(y0), rt0=right(y0), l1=left(y1), rt1=right(y1);
      const w0=(rt0-l0)/3, w1=(rt1-l1)/3;
      const tl=l0+w0*c, tr=l0+w0*(c+1), bl=l1+w1*c, br=l1+w1*(c+1);
      const cx=(tl+tr+bl+br)/4, cy=(y0+y1)/2;
      const pts=`${(tl+gap).toFixed(0)},${y0+gap} ${(tr-gap).toFixed(0)},${y0+gap} ${(br-gap).toFixed(0)},${y1-gap} ${(bl+gap).toFixed(0)},${y1-gap}`;
      const fill=_qbCellColor(rating, lg);
      parts.push(`<polygon points="${pts}" fill="${fill}" stroke="#0c0d0f" stroke-width="2"/>`);
      parts.push(`<text x="${cx.toFixed(0)}" y="${(cy-4).toFixed(0)}" fill="#fff" font-size="26" font-weight="800" text-anchor="middle">${_qbNum(rating,1)}</text>`);
      parts.push(`<text x="${cx.toFixed(0)}" y="${(cy+14).toFixed(0)}" fill="#0d1b10" font-size="10.5" font-weight="800" text-anchor="middle">LEAGUE AVG: ${_qbNum(lg,1)}</text>`);
      parts.push(`<text x="${cx.toFixed(0)}" y="${(cy+29).toFixed(0)}" fill="#141517" font-size="10" font-weight="800" opacity="0.75" text-anchor="middle">${att} att</text>`);
    }
  }

  for(const [y,lab] of [[rowY[1],'+20'],[rowY[2],'+10']]){
    parts.push(`<text x="${(left(y)-12).toFixed(0)}" y="${y+4}" fill="#c8ccd2" font-size="12" text-anchor="end">${lab}</text>`);
    parts.push(`<text x="${(right(y)+12).toFixed(0)}" y="${y+4}" fill="#c8ccd2" font-size="12">${lab}</text>`);
  }

  const yl=rowY[3];
  parts.push(`<line x1="${(left(yl)-30).toFixed(0)}" y1="${yl}" x2="${(right(yl)+30).toFixed(0)}" y2="${yl}" stroke="#2f6fe4" stroke-width="4"/>`);
  parts.push(`<text x="${(left(yl)-36).toFixed(0)}" y="${yl+4}" fill="#fff" font-size="12" font-weight="800" text-anchor="end">LOS</text>`);
  parts.push(`<text x="${(right(yl)+36).toFixed(0)}" y="${yl+4}" fill="#fff" font-size="12" font-weight="800">LOS</text>`);

  parts.push('</svg>');
  return parts.join('');
}

function renderPcardQbPassing(pid){
  const norm=_pcardQbNorm(pid);
  const seasons=pcardQbPassingSeasons(norm);
  if(!seasons.length) return `<div class="pcard-loading">No passing-chart data for this QB.</div>`;
  if(pcardQbPassingSeason==null || !seasons.includes(String(pcardQbPassingSeason))) pcardQbPassingSeason=seasons[0];
  const season=String(pcardQbPassingSeason);
  const chart=NFLVERSE[season].qb_passing[norm];
  if(!chart) return `<div class="pcard-loading">No passing-chart data for this season.</div>`;

  const p=(sleeperPlayers&&sleeperPlayers[pid])||{};
  const name=p.name||'QB';
  const t=chart.totals||{};
  const seasonBtns=seasons.map(s=>`<button class="rt-season-btn ${String(s)===season?'active':''}" onclick="setPcardQbPassingSeason('${s}')">${s}</button>`).join('');
  const tdInt = `${t.td!=null?t.td:'—'}/${t.int!=null?t.int:'—'}`;

  return `<div class="qpc-wrap">
    <div class="rt-head">
      <div class="rt-seasons">${seasonBtns}</div>
      <div class="rt-summary">${t.attempts||0} located attempts · threshold ±${QB_PASS_THRESH.toFixed(0)} vs league avg</div>
    </div>
    ${_qbPassingSVG(chart, name, season)}
    <div class="qpc-legend">
      <span><i style="background:#2fae4e"></i>Better than average</span>
      <span><i style="background:#d8a51d"></i>Within average</span>
      <span><i style="background:#d33b2f"></i>Worse than average</span>
    </div>
    <div class="qpc-totals">
      <div class="qpc-tile"><label>Passer Rating</label><b>${_qbNum(t.passer_rating,1)}</b></div>
      <div class="qpc-tile"><label>Comp %</label><b>${_qbNum(t.comp_pct,1)}</b></div>
      <div class="qpc-tile"><label>Yards</label><b>${t.yards!=null?Number(t.yards).toLocaleString():'—'}</b></div>
      <div class="qpc-tile"><label>TD/INT</label><b>${tdInt}</b></div>
      <div class="qpc-tile"><label>Attempts*</label><b>${t.attempts!=null?t.attempts:'—'}</b></div>
    </div>
    <div class="pcard-src">*Located pass attempts (excl. sacks, 2-pt) · depth via air yards, location via nflverse charting.</div>
  </div>`;
}

function setPcardQbPassingSeason(season){
  pcardQbPassingSeason=season;
  const body=document.getElementById('pcardBody');
  if(body && pcardState) body.innerHTML=renderPcardQbPassing(pcardState.pid);
}
// ── RB rushing fan (player-card "Rushing Fan" tab) ─────────────────────────
// Seed payload: NFLVERSE[season].rb_fan[normName] = {
//   team, totals:{attempts,yards,ypc,success_rate},
//   lanes:{LE|LT|LG|MID|RG|RT|RE:{attempts,ypc,success_rate,league_ypc,ypc_diff}},
//   line:{LT|LG|C|RG|RT:{name,run_grade,pass_grade,pass_snaps}}
// }

const RB_FAN_LANES = ['LE','LT','LG','MID','RG','RT','RE'];
const RB_FAN_CARD_SLOTS = ['LT','LG','C','RG','RT'];
const RB_FAN_ARROW_X = {LE:60, LT:160, LG:270, MID:380, RG:490, RT:600, RE:700};
const RB_FAN_CARD_X = {LT:160, LG:270, C:380, RG:490, RT:600};

let pcardRbFanSeason = null;

function _pcardRbNorm(pid){
  const p=(typeof sleeperPlayers!=='undefined'&&sleeperPlayers&&sleeperPlayers[pid])||{};
  return ecrNormName(p.name||'');
}

function pcardRbFanSeasons(normName){
  if(typeof NFLVERSE==='undefined' || !NFLVERSE) return [];
  return Object.keys(NFLVERSE)
    .filter(s=>{ const r=NFLVERSE[s]&&NFLVERSE[s].rb_fan; return r && r[normName]; })
    .sort((a,b)=>b-a);
}

function pcardRbFanAvailable(pid){
  return pcardRbFanSeasons(_pcardRbNorm(pid)).length>0;
}

function _rbNum(v, dp=1){
  if(v==null || Number.isNaN(v)) return '—';
  return Number(v).toFixed(dp);
}

function _rbArrowColor(diff){
  if(diff==null || Number.isNaN(diff)) return '#d8a51d';
  if(diff > 0.5) return '#2fae4e';
  if(diff < -0.5) return '#d33b2f';
  return '#d8a51d';
}

function _rbArrowWidth(successRate){
  if(successRate==null || Number.isNaN(successRate)) return 2.8;
  return Math.max(1.8, Math.min(7.4, 2.5 + 0.24 * (Number(successRate) - 34)));
}

function _rbGradeColor(g){
  if(!g) return '#6b7075';
  const ch=String(g).charAt(0).toUpperCase();
  if(ch==='A') return '#2fae4e';
  if(ch==='B') return '#84b93f';
  if(ch==='C') return '#d8a51d';
  if(ch==='D') return '#d97b29';
  return '#d33b2f';
}

function _rbNameParts(name){
  const bits=String(name||'').trim().split(/\s+/).filter(Boolean);
  if(!bits.length) return ['',''];
  if(bits.length===1) return [bits[0],''];
  return [bits[0], bits.slice(1).join(' ')];
}

function _rbFanSVG(chart, playerName, season){
  const lanes=chart.lanes||{};
  const line=chart.line||{};
  const t=chart.totals||{};
  const W=760, H=880;
  const rbx=380, rby=650;

  const parts=[];
  parts.push(`<svg viewBox="0 0 ${W} ${H}" class="rbf-svg" role="img" aria-label="RB rushing fan chart">`);
  parts.push('<rect width="760" height="880" fill="#101214"/>');
  parts.push(`<text x="30" y="34" fill="#fff" font-size="22" font-weight="800">${String(playerName||'RB').toUpperCase()} RUSHING FAN <tspan fill="#9aa0a6" font-size="14" font-weight="600">/ ${season} REGULAR SEASON</tspan></text>`);
  parts.push('<text x="30" y="56" fill="#9aa0a6" font-size="13">Arrow width = lane success rate · arrow color = lane YPC vs league lane average</text>');

  for(const lane of RB_FAN_LANES){
    const d=lanes[lane];
    if(!d || (+d.attempts||0)<3) continue;
    const cx=RB_FAN_ARROW_X[lane];
    const succ = d.success_rate;
    const ypc = d.ypc;
    const att = +d.attempts||0;
    const col = _rbArrowColor(d.ypc_diff);
    const w = _rbArrowWidth(succ).toFixed(2);
    const path = lane==='MID'
      ? 'M380,650 V150'
      : `M380,650 C${(380-(380-cx)*0.55).toFixed(0)},700 ${cx},585 ${cx},150`;
    parts.push(`<path d="${path}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" marker-end="url(#rbf-arrow)"/>`);
    parts.push(`<text x="${cx}" y="106" fill="#fff" font-size="13" font-weight="800" text-anchor="middle">${lane}</text>`);
    parts.push(`<text x="${cx}" y="122" fill="${col}" font-size="12" font-weight="800" text-anchor="middle">${_rbNum(succ,0)}% SUCC</text>`);
    parts.push(`<text x="${cx}" y="137" fill="#9aa0a6" font-size="10" text-anchor="middle">${att} att · ${_rbNum(ypc,1)} YPC</text>`);
  }

  parts.push('<defs><marker id="rbf-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path d="M1 1L8 5L1 9" fill="none" stroke="context-stroke" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>');

  parts.push('<line x1="15" y1="520" x2="745" y2="520" stroke="#2f6fe4" stroke-width="3" stroke-dasharray="10 7"/>');
  parts.push('<text x="18" y="508" fill="#5b83c9" font-size="11" font-weight="800">LOS</text>');

  for(const slot of RB_FAN_CARD_SLOTS){
    const x=RB_FAN_CARD_X[slot];
    const d=line[slot]||{};
    const runG=d.run_grade||null;
    const passG=d.pass_grade||null;
    const col=_rbGradeColor(runG);
    const n=_rbNameParts(d.name||'');
    parts.push(`<rect x="${x-46}" y="462" width="92" height="122" rx="7" fill="#1b1e22" stroke="${col}" stroke-width="2"/>`);
    parts.push(`<text x="${x}" y="483" fill="#fff" font-size="15" font-weight="800" text-anchor="middle">${slot}</text>`);
    parts.push(`<text x="${x}" y="499" fill="#e8eaed" font-size="10" text-anchor="middle">${n[0]||''}</text>`);
    parts.push(`<text x="${x}" y="512" fill="#e8eaed" font-size="10" font-weight="700" text-anchor="middle">${n[1]||''}</text>`);
    parts.push(`<text x="${x}" y="544" fill="${col}" font-size="24" font-weight="800" text-anchor="middle">${runG||'n/a'}</text>`);
    parts.push(`<text x="${x}" y="558" fill="#9aa0a6" font-size="8.5" text-anchor="middle">RUN GRADE</text>`);
    parts.push(`<text x="${x}" y="575" fill="#9aa0a6" font-size="9.5" text-anchor="middle">PASS: <tspan fill="${_rbGradeColor(passG)}" font-weight="800">${passG||'n/a'}</tspan></text>`);
  }

  parts.push(`<circle cx="${rbx}" cy="${rby}" r="13" fill="#e8eaed" stroke="#0c0d0f" stroke-width="2"/>`);
  parts.push(`<text x="${rbx}" y="690" fill="#fff" font-size="13" font-weight="800" text-anchor="middle">${String(playerName||'RB').toUpperCase()}</text>`);
  parts.push(`<text x="${rbx}" y="707" fill="#9aa0a6" font-size="11" text-anchor="middle">${t.attempts||0} carries · ${(t.yards!=null?Number(t.yards).toLocaleString():'—')} yds · ${_rbNum(t.ypc,2)} YPC · ${_rbNum(t.success_rate,1)}% success</text>`);

  parts.push('<text x="30" y="772" fill="#6b7075" font-size="10">OL card grades are from the validated local OL pipeline (run + pass grades, starter slot by pass-snaps).</text>');
  parts.push('<text x="30" y="786" fill="#6b7075" font-size="10">Lanes shown when attempts ≥ 3. Color compares lane YPC to league average for that lane in-season.</text>');
  parts.push('<text x="30" y="800" fill="#6b7075" font-size="10">Data: nflverse play-by-play + local OL grades. Not affiliated with the NFL.</text>');
  parts.push('</svg>');
  return parts.join('');
}

function renderPcardRbFan(pid){
  const norm=_pcardRbNorm(pid);
  const seasons=pcardRbFanSeasons(norm);
  if(!seasons.length) return '<div class="pcard-loading">No rushing-fan data for this RB.</div>';
  if(pcardRbFanSeason==null || !seasons.includes(String(pcardRbFanSeason))) pcardRbFanSeason=seasons[0];
  const season=String(pcardRbFanSeason);
  const chart=NFLVERSE[season].rb_fan[norm];
  if(!chart) return '<div class="pcard-loading">No rushing-fan data for this season.</div>';

  const p=(sleeperPlayers&&sleeperPlayers[pid])||{};
  const name=p.name||'RB';
  const t=chart.totals||{};
  const seasonBtns=seasons.map(s=>`<button class="rt-season-btn ${String(s)===season?'active':''}" onclick="setPcardRbFanSeason('${s}')">${s}</button>`).join('');

  return `<div class="rbf-wrap">
    <div class="rt-head">
      <div class="rt-seasons">${seasonBtns}</div>
      <div class="rt-summary">${t.attempts||0} carries · ${_rbNum(t.ypc,2)} YPC · ${_rbNum(t.success_rate,1)}% success</div>
    </div>
    ${_rbFanSVG(chart, name, season)}
    <div class="rbf-legend">
      <span><i style="background:#2fae4e"></i>Lane YPC above league avg</span>
      <span><i style="background:#d8a51d"></i>Lane YPC near league avg</span>
      <span><i style="background:#d33b2f"></i>Lane YPC below league avg</span>
    </div>
    <div class="pcard-src">Rushing lanes from nflverse run-location/gap charting (regular season).</div>
  </div>`;
}

function setPcardRbFanSeason(season){
  pcardRbFanSeason=season;
  const body=document.getElementById('pcardBody');
  if(body && pcardState) body.innerHTML=renderPcardRbFan(pcardState.pid);
}
// ── OL grades card (player-card "OL Grades" tab) ───────────────────────────
// Seed payload: NFLVERSE[season].ol_players[normName] = {
//   team, slot, pos, pass_grade, pass_pctile, pass_conf, pass_snaps,
//   run_grade, run_pctile, run_conf, poa_carries, shared_credit,
//   penalty_rate, allpro_recent, career_ap1, career_pb, consensus_flag, market_pctile
// }

const OL_CARD_POS = new Set(['LT','LG','C','RG','RT','OL','G','T','OT','OG']);
const OL_TEAM_FIX = {LA:'LAR', OAK:'LV', SD:'LAC', STL:'LAR'};

let pcardOlSeason = null;

function _pcardOlNorm(pid){
  const p=(typeof sleeperPlayers!=='undefined'&&sleeperPlayers&&sleeperPlayers[pid])||{};
  return ecrNormName(p.name||'');
}

function _olTeamCode(team){
  const t=String(team||'').toUpperCase();
  return OL_TEAM_FIX[t] || t;
}

function pcardOlSeasons(normName){
  if(typeof NFLVERSE==='undefined' || !NFLVERSE) return [];
  return Object.keys(NFLVERSE)
    .filter(s=>{ const d=NFLVERSE[s]&&NFLVERSE[s].ol_players; return d && d[normName]; })
    .sort((a,b)=>b-a);
}

function pcardOlAvailable(pid){
  return pcardOlSeasons(_pcardOlNorm(pid)).length>0;
}

function _olGradeClass(g){
  const c=String(g||'').trim().charAt(0).toUpperCase();
  if(c==='A') return 'a';
  if(c==='B') return 'b';
  if(c==='C') return 'c';
  if(c==='D') return 'd';
  return 'f';
}

function _olNum(v, dp=1){
  if(v==null || Number.isNaN(v)) return '—';
  return Number(v).toFixed(dp);
}

function _olPct(v){
  if(v==null || Number.isNaN(v)) return '—';
  return `${Number(v).toFixed(1)}%`;
}

function _olFmtMetric(col, val){
  if(val==null || Number.isNaN(val)) return '—';
  const n=Number(val);
  if(/Rate/.test(col)) return `${n.toFixed(1)}%`;
  if(col==='Time to Throw') return `${n.toFixed(2)}s`;
  if(col==='Yards Before Contact Per RB Rush') return n.toFixed(2);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function renderPcardOlGrades(pid){
  const norm=_pcardOlNorm(pid);
  const seasons=pcardOlSeasons(norm);
  if(!seasons.length) return '<div class="pcard-loading">No OL grades available for this player.</div>';
  if(pcardOlSeason==null || !seasons.includes(String(pcardOlSeason))) pcardOlSeason=seasons[0];
  const season=String(pcardOlSeason);

  const pack=NFLVERSE[season]||{};
  const rec=(pack.ol_players&&pack.ol_players[norm])||null;
  if(!rec) return '<div class="pcard-loading">No OL grades available for this season.</div>';

  const teamCode=_olTeamCode(rec.team);
  const olTable=pack.team&&pack.team.offensive_line;
  const teamRow=olTable&&olTable.teams&&olTable.teams[teamCode];
  const cols=(olTable&&olTable.columns)||[];
  const seasonBtns=seasons.map(s=>`<button class="rt-season-btn ${String(s)===season?'active':''}" onclick="setPcardOlSeason('${s}')">${s}</button>`).join('');

  const metrics = (teamRow && cols.length)
    ? cols.map(c=>{
      const v=teamRow.values ? teamRow.values[c] : null;
      const r=teamRow.ranks ? teamRow.ranks[c] : null;
      return `<div class="olc-metric">
        <label>${c}</label>
        <b>${_olFmtMetric(c, v)}</b>
        <small>${r!=null?`Rank #${r}`:'Rank —'}</small>
      </div>`;
    }).join('')
    : '<div class="pcard-loading">Team OL metrics unavailable for this season.</div>';

  const flagBits=[];
  if(rec.shared_credit) flagBits.push(`Shared credit ${rec.shared_credit}`);
  if(rec.consensus_flag) flagBits.push(String(rec.consensus_flag));
  const flags = flagBits.length ? `<div class="olc-flags">${flagBits.join(' · ')}</div>` : '';

  return `<div class="olc-wrap">
    <div class="rt-head">
      <div class="rt-seasons">${seasonBtns}</div>
      <div class="rt-summary">${teamDisplayName(teamCode)||teamCode||'Team'} · ${rec.slot||rec.pos||'OL'} · validated OL pipeline grades</div>
    </div>

    <div class="olc-grades">
      <div class="olc-grade-tile">
        <label>Pass Grade</label>
        <b class="olc-grade ${_olGradeClass(rec.pass_grade)}">${rec.pass_grade||'—'}</b>
        <small>${_olPct(rec.pass_pctile)} pctile · ${rec.pass_conf||'—'} conf · ${rec.pass_snaps!=null?Number(rec.pass_snaps).toLocaleString():'—'} snaps</small>
      </div>
      <div class="olc-grade-tile">
        <label>Run Grade</label>
        <b class="olc-grade ${_olGradeClass(rec.run_grade)}">${rec.run_grade||'—'}</b>
        <small>${_olPct(rec.run_pctile)} pctile · ${rec.run_conf||'—'} conf · ${rec.poa_carries!=null?Number(rec.poa_carries).toLocaleString():'—'} POA carries</small>
      </div>
      <div class="olc-mini-grid">
        <div><span>Penalty Rate</span><b>${_olNum(rec.penalty_rate,2)}%</b></div>
        <div><span>All-Pro Recent</span><b>${rec.allpro_recent||'—'}</b></div>
        <div><span>Career AP1 / PB</span><b>${rec.career_ap1!=null?rec.career_ap1:'—'} / ${rec.career_pb!=null?rec.career_pb:'—'}</b></div>
        <div><span>Market Percentile</span><b>${rec.market_pctile==null||Number.isNaN(rec.market_pctile)?'—':`${Math.round(Number(rec.market_pctile))}%`}</b></div>
      </div>
    </div>

    ${flags}

    <div class="olc-team-head">${teamDisplayName(teamCode)||teamCode||'Team'} Offensive Line Context (${season})</div>
    <div class="olc-metrics">${metrics}</div>

    <div class="pcard-src">Player grades from local OL pipeline csv; team context from nflverse offensive-line season table.</div>
  </div>`;
}

function setPcardOlSeason(season){
  pcardOlSeason=season;
  const body=document.getElementById('pcardBody');
  if(body && pcardState) body.innerHTML=renderPcardOlGrades(pcardState.pid);
}
// ── Rookie college stats (ESPN) ─────────────────────────────────────────────
// Rookies have no NFL game log yet, so their player card shows their COLLEGE game logs from
// ESPN instead. We resolve the player's global ESPN athlete id (Sleeper's espn_id when present,
// else an ESPN name search — most rookies aren't in Sleeper's espn_id map yet), then pull the
// college-football gamelog per season. The gamelog is data-driven (ESPN returns the right stat
// columns per position), so we render whatever it gives — renaming AVG→YPC to match our NFL
// cards. Opponent logos + the player's team per game come straight from each event, so a
// college transfer shows correctly per season.
const ESPN_SEARCH_URL = q => `https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(q)}&limit=10`;
// ESPN athlete gamelog. league = 'college-football' (rookies) | 'nfl' (defensive veterans).
const ESPN_GAMELOG_URL = (league,aid,season) => `https://site.api.espn.com/apis/common/v3/sports/football/${league}/athletes/${aid}/gamelog${season?`?season=${season}`:''}`;
// ESPN core athlete record — carries draft info ({year, round, selection, team.$ref}).
const ESPN_CORE_ATHLETE_URL = (season,aid) => `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/athletes/${aid}?lang=en&region=us`;
let espnAthleteIdCache = {};   // `${pid}:${league}` -> ESPN athlete id ('' = looked up, none found)
let espnGamelogCache = {};     // `${league}:${aid}:${season}` -> gamelog json
let espnDraftCache = {};       // aid -> {year,round,selection,teamCode} | null
let espnCoreAthleteCache = {}; // nfl aid -> core athlete json | null

function pcardRetryHtml(msg){
  return `<div class="pcard-loading pcard-loading-retry"><span>${msg}</span><button class="pcard-retry-btn" onclick="retryPlayerCardData()">Refresh</button></div>`;
}

// Clear per-player ESPN lookup caches so a retry can recover from transient failures.
function clearEspnCardCaches(pid){
  if(pid==null) return;
  delete espnAthleteIdCache[`${pid}:nfl`];
  delete espnAthleteIdCache[`${pid}:college-football`];
}

function isRookiePlayer(pid){
  const p = sleeperPlayers && sleeperPlayers[pid];
  return !!(p && p.years_exp===0);
}
// Search ESPN for an athlete id by name, preferring the wanted league (uid `~l:<id>~`: 28=NFL,
// 23=college). Returns an exact-league match when found, else the first player id seen (so a
// last-resort lookup still resolves *something*). `null` when the search returns no player.
async function searchEspnAthleteId(nm, wantLeagueId){
  try{
    const s = await sleeperFetch(ESPN_SEARCH_URL(nm));
    const results = (s && s.results) || [];
    let fallbackId = null;
    for(const r of results){
      if(r.type!=='player') continue;
      for(const it of (r.contents||[])){
        const uid = it.uid||'';
        let m = /a:(\d+)/.exec(uid);
        if(!m){ m = /\/id\/(\d+)\//.exec((it.link&&it.link.web)||''); }
        if(!m) continue;
        if(!fallbackId) fallbackId = m[1];
        const lm = /~l:(\d+)~/.exec(uid);
        if(lm && lm[1]===wantLeagueId) return m[1];
      }
    }
    return fallbackId;
  }catch(e){ /* search blocked/failed */ return null; }
}
// Resolve a player's ESPN athlete id for a league. NFL: Sleeper's espn_id, else an NFL name
// search. College: ESPN's IDs differ by sport, and a raw college name search often matches a
// *different* same-named player (or one with no games), so we route through the NFL athlete
// record's authoritative `collegeAthlete` link — resolving the NFL id first (via espn_id OR a
// name search, so players without a Sleeper espn_id still work) — and only fall back to a
// college name search when there's no NFL record to follow.
async function resolveEspnAthleteId(pid, name, league){
  const lg = league || 'nfl';
  const ck = `${pid}:${lg}`;
  if(espnAthleteIdCache[ck]!=null) return espnAthleteIdCache[ck] || null;
  const p = sleeperPlayers && sleeperPlayers[pid];
  const nm = name || (p && p.name) || '';
  if(lg==='college-football'){
    const nflId = await resolveEspnAthleteId(pid, nm, 'nfl');   // espn_id or NFL name search
    if(nflId){
      const core = await fetchEspnCoreAthlete(String(nflId));
      const cref = core && core.collegeAthlete && core.collegeAthlete.$ref;
      const cm = /\/athletes\/(\d+)/.exec(cref||'');
      if(cm){ espnAthleteIdCache[ck]=cm[1]; return cm[1]; }
    }
    // No NFL record / no linked college athlete — last-resort direct college name search.
    const cid = nm ? await searchEspnAthleteId(nm, '23') : null;
    espnAthleteIdCache[ck] = cid || '';
    return cid || null;
  }
  // Sleeper's espn_id is an NFL athlete id.
  if(p && p.espn_id){ espnAthleteIdCache[ck]=p.espn_id; return p.espn_id; }
  if(!nm){ espnAthleteIdCache[ck]=''; return null; }
  const id = await searchEspnAthleteId(nm, '28');
  espnAthleteIdCache[ck] = id || '';
  return id || null;
}
async function fetchEspnGamelog(aid, league, season){
  const key = `${league}:${aid}:${season||'_'}`;
  if(espnGamelogCache[key]) return espnGamelogCache[key];
  const data = await sleeperFetch(ESPN_GAMELOG_URL(league, aid, season));
  espnGamelogCache[key] = data;
  return data;
}
async function fetchEspnCoreAthlete(aid){
  if(espnCoreAthleteCache[aid]!==undefined) return espnCoreAthleteCache[aid];
  try{
    espnCoreAthleteCache[aid] = await sleeperFetch(ESPN_CORE_ATHLETE_URL(PROJ_SEASON, aid));
  }catch(e){ espnCoreAthleteCache[aid] = null; }
  return espnCoreAthleteCache[aid];
}
// Normalize ESPN's core-athlete `draft` object into {year, round, selection, teamCode}, or
// {undrafted:true} when the athlete record loaded but carries no draft (a true UDFA), or null
// when we couldn't load the record at all (network) — so callers can say "Undrafted" vs. nothing.
function normalizeEspnDraft(d){
  if(!d || typeof d!=='object') return null;
  const dr = d.draft;
  if(!(dr && dr.year)) return { undrafted:true };
  let teamCode=null;
  const m=/\/teams\/(\d+)/.exec((dr.team && dr.team.$ref) || '');
  if(m) teamCode = ESPN_ID_TO_CODE[parseInt(m[1])] || null;
  return { year:dr.year, round:dr.round, selection:dr.selection, teamCode };
}
// Draft info for an ESPN athlete. Cached; null only when the lookup failed (shows nothing).
async function fetchEspnDraftInfo(aid){
  if(espnDraftCache[aid]!==undefined) return espnDraftCache[aid];
  try{
    const d = await sleeperFetch(ESPN_CORE_ATHLETE_URL(PROJ_SEASON, aid));
    espnDraftCache[aid] = normalizeEspnDraft(d);
  }catch(e){ espnDraftCache[aid] = null; }
  return espnDraftCache[aid];
}
// Compact draft summary for the card's top banner (hero): "DRAFT 2021 · Rd 1, Pk 5 · CIN" or
// "Undrafted". Returns '' when the draft lookup was unavailable (network) so nothing shows.
function espnDraftHero(info){
  if(!info) return '';
  if(info.undrafted){
    return `<span class="pcard-hero-draft-line"><span class="pcard-draft-lbl">DRAFT</span><span class="muted">Undrafted</span></span>`;
  }
  const logo = info.teamCode ? `<img src="${NFL_LOGO(info.teamCode)}" class="pcard-hero-draft-logo" onerror="this.style.display='none'">` : '';
  const team = info.teamCode ? `<span class="pcard-hero-draft-team">${logo}${info.teamCode}</span>` : '';
  return `<span class="pcard-hero-draft-line"><span class="pcard-draft-lbl">DRAFT</span>
    <span>${info.year} · <span class="muted">Rd</span> ${info.round}, <span class="muted">Pk</span> ${info.selection}</span>${team}</span>`;
}
// Which stat group a gamelog column belongs to (from ESPN's machine `name`). Defensive players
// reuse the same INT/SACK/FUM names as offense but with opposite meaning, so `def` picks the
// right grouping (tackles / sacks+TFL / turnovers / coverage) vs the offensive passing/rushing/rec.
function espnStatGroup(name, def){
  const n=name||'';
  if(def){
    if(['totalTackles','soloTackles','assistTackles'].includes(n)) return 'TACKLES';
    if(['sacks','stuffs','stuffYards','sackYards','tacklesForLoss','QBHits','quarterbackHits'].includes(n)) return 'SACKS/TFL';
    if(/fumble/i.test(n) || n==='kicksBlocked') return 'TURNOVERS';
    if(['interceptions','interceptionYards','avgInterceptionYards','interceptionTouchdowns','longInterception','passesDefended'].includes(n)) return 'COVERAGE';
    return 'DEFENSE';
  }
  if(/^passing/.test(n) || ['completions','passingAttempts','completionPct','interceptions','interceptionPct','longPassing','sacks','sackYardsLost','QBRating','adjQBR','ESPNQBRating'].includes(n)) return 'PASSING';
  if(/^rushing/.test(n) || ['yardsPerRushAttempt','longRushing'].includes(n)) return 'RUSHING';
  if(/^receiving/.test(n) || ['receptions','yardsPerReception','longReception'].includes(n)) return 'RECEIVING';
  if(/fumble/i.test(n)) return 'FUM';
  return 'MISC';
}
// Per-game color for a gamelog cell (green/yellow/red, like the NFL cards). `def` disambiguates
// the INT/SACK stats whose "good" direction flips between offense and defense.
function espnColor(name, v, def){
  if(v==null) return '';
  if(def){
    switch(name){
      case 'totalTackles': return _tri(v,7,4);
      case 'soloTackles': return _tri(v,5,3);
      case 'sacks': return _tri(v,1,0.5);
      case 'stuffs': case 'tacklesForLoss': return _tri(v,1.5,0.5);
      case 'interceptions': return _tri(v,1,0.5);
      case 'passesDefended': return _tri(v,2,1);
      case 'interceptionTouchdowns': return _tri(v,1,0.5);
      case 'fumblesForced': return _tri(v,1,0.5);
      case 'fumblesRecovered': return _tri(v,1,0.5);
      case 'kicksBlocked': return _tri(v,1,0.5);
      case 'fumbles': case 'fumblesLost': return _triLow(v,0,1);
      default: return '';
    }
  }
  switch(name){
    case 'receptions': return _tri(v,6,4);
    case 'receivingYards': return _tri(v,80,50);
    case 'yardsPerReception': return _tri(v,14,10);
    case 'receivingTouchdowns': return _tri(v,1,0.5);
    case 'longReception': return _tri(v,25,15);
    case 'rushingYards': return _tri(v,80,45);
    case 'yardsPerRushAttempt': return _tri(v,5,3.5);
    case 'rushingTouchdowns': return _tri(v,1,0.5);
    case 'longRushing': return _tri(v,20,10);
    case 'passingYards': return _tri(v,275,200);
    case 'completionPct': return _tri(v,68,58);
    case 'passingTouchdowns': return _tri(v,2,1);
    case 'interceptions': return _triLow(v,0,1);   // QB INTs thrown → lower better
    case 'sacks': return _triLow(v,1,3);            // QB sacked → lower better
    case 'fumbles': case 'fumblesLost': return _triLow(v,0,1);
    default: return '';
  }
}
function cfbNum(s){ const n=parseFloat(String(s==null?'':s).replace(/,/g,'')); return isNaN(n)?null:n; }
// Map an ESPN postseason event note to a compact playoff-round abbreviation (NFL). Regular-season
// events have no note (→ null, week number shown). AFC/NFC come straight from the note text, so
// the conference is always correct without needing the team's division.
function playoffAbbr(note){
  const n = note||'';
  if(!n) return null;
  if(/super\s*bowl/i.test(n)) return 'SB';
  if(/wild\s*card/i.test(n)) return 'WC';
  if(/divisional/i.test(n)) return 'DIV';
  if(/afc\s*champ/i.test(n)) return 'AFC';
  if(/nfc\s*champ/i.test(n)) return 'NFC';
  return null;
}
// Load + render a player's ESPN game logs into the card body. Rookies use their college-football
// gamelog; defensive veterans use the nfl gamelog. Both are data-driven — ESPN returns the right
// columns per position, so we render whatever it gives (offense or defense), colored per game.
async function loadEspnCardData(pid, posc, body, opts){
  opts = opts||{};
  const tok = pcardToken;
  const league = opts.league || 'college-football';
  const def = !!opts.def;
  body.innerHTML = `<div class="pcard-loading">Loading ${league==='nfl'?'':'college '}game logs…</div>`;
  const aid = await resolveEspnAthleteId(pid, (sleeperPlayers[pid]||{}).name, league);
  if(!pcardOpen) return;
  if(!aid){
    body.innerHTML = pcardRetryHtml('No ESPN stats found for this player yet.');
    return;
  }
  pcardApplyEspnHeadshot(aid, league);   // fill in an ESPN photo if Sleeper had none
  try{
    const base = await fetchEspnGamelog(aid, league, null);   // default → latest season + season list
    if(!pcardOpen) return;
    let seasons = [];
    for(const f of (base.filters||[])){ if(f.name==='season') seasons=(f.options||[]).map(o=>o.value); }
    if(!seasons.length){
      const m = /\d{4}/.exec((base.seasonTypes&&base.seasonTypes[0]&&base.seasonTypes[0].displayName)||'');
      if(m) seasons=[m[0]];
    }
    seasons.sort((a,b)=>Number(b)-Number(a));   // newest first
    const perSeason = await Promise.all(seasons.map(async s=>{
      try{ return { season:s, gl: await fetchEspnGamelog(aid, league, s) }; }catch(e){ return { season:s, gl:null }; }
    }));
    if(!pcardOpen) return;
    let out='';
    for(const {season, gl} of perSeason){
      if(!gl) continue;
      out += renderEspnSeason(season, gl, {def, league});
    }
    if(!out) out = `<div class="pcard-loading">No game data found for this player.</div>`;
    out += `<div class="pcard-src">${league==='nfl'?'NFL':'College'} per-game stats via ESPN${def?'':' · AVG shown as YPC'}.</div>`;
    if(pcardOpen && tok===pcardToken) body.innerHTML = out;
  }catch(e){
    body.innerHTML = pcardRetryHtml("Couldn't load game logs. Check your connection and try again.");
  }
}
// Render one season table from an ESPN gamelog payload (data-driven, colored per game).
function renderEspnSeason(season, gl, opts){
  opts = opts||{};
  const def = !!opts.def, league = opts.league || 'college-football';
  const labels = gl.labels||[], names = gl.names||[];
  if(!labels.length) return '';
  // The gamelog's per-game stat arrays live under seasonTypes[].categories[].events[] keyed by
  // eventId; the rich event metadata (opponent, team, date) lives under events{}.
  const statsByEvent={};
  (gl.seasonTypes||[]).forEach(st=>(st.categories||[]).forEach(c=>(c.events||[]).forEach(ev=>{ statsByEvent[ev.eventId]=ev.stats; })));
  const events = gl.events||{};
  const teamMap=new Map();   // abbr -> logo url (handles a mid-season/off-season team change)
  const rows=[];
  Object.keys(events).forEach(k=>{
    const e=events[k];
    const stats=statsByEvent[e.id];
    if(!stats) return;
    const opp=e.opponent||{};
    const tm=e.team||{};
    if(tm.abbreviation) teamMap.set(tm.abbreviation, tm.logo||(tm.id?(league==='nfl'?`https://a.espncdn.com/i/teamlogos/nfl/500/${(tm.abbreviation||'').toLowerCase()}.png`:NCAA_LOGO(tm.id)):''));
    rows.push({ week:e.week, date:e.gameDate, atVs:e.atVs||'vs', note:e.eventNote||'',
      oppAbbr:opp.abbreviation||'', oppLogo:opp.logo||(opp.id?NCAA_LOGO(opp.id):''), stats });
  });
  if(!rows.length) return '';
  rows.sort((a,b)=> new Date(a.date||0) - new Date(b.date||0));
  // Rename the offensive per-attempt AVG columns to YPC (match our NFL cards); leave others as-is.
  const dispLabel = i => (names[i]==='yardsPerReception'||names[i]==='yardsPerRushAttempt') ? 'YPC' : labels[i];
  const grpOf = i => espnStatGroup(names[i], def);
  // Grouped header (group row + column row), with a spacer column between groups.
  let grpCells='', colHead='', gi=0;
  while(gi<labels.length){
    const g=grpOf(gi); let span=1;
    while(gi+span<labels.length && grpOf(gi+span)===g) span++;
    grpCells += `<th class="pcard-grp" colspan="${span}">${g==='MISC'?'':g}</th><th></th>`;
    gi+=span;
  }
  grpCells = grpCells.replace(/<th><\/th>$/,'');
  labels.forEach((l,i)=>{ colHead += ((i>0 && grpOf(i)!==grpOf(i-1))?'<th></th>':'')+`<th>${dispLabel(i)}</th>`; });
  const bodyRows = rows.map(r=>{
    const cells = labels.map((l,i)=>{
      const sep=(i>0 && grpOf(i)!==grpOf(i-1))?'<td></td>':'';
      const v=r.stats[i];
      const cls=espnColor(names[i], cfbNum(v), def);
      return sep+`<td class="pcard-cell ${cls}">${(v==null||v==='')?'–':v}</td>`;
    }).join('');
    const oppTxt = r.oppAbbr
      ? `<span class="pcard-opp-inner">${r.atVs==='@'?'<span class="pcard-at">@</span>':'<span class="pcard-vs">vs</span>'}${r.oppLogo?`<img src="${r.oppLogo}" class="pcard-opp-logo" onerror="this.style.display='none'">`:''}<span>${r.oppAbbr}</span></span>`
      : '–';
    // Postseason games show the round (WC/DIV/AFC/NFC/SB) in place of a week number.
    const po = playoffAbbr(r.note);
    const wkCell = po ? `<td class="pcard-wk pcard-wk-po" title="${r.note}">${po}</td>`
                      : `<td class="pcard-wk">${r.week!=null?r.week:''}</td>`;
    return `<tr>${wkCell}<td class="pcard-opp ${r.atVs==='@'?'away':'home'}">${oppTxt}</td>${cells}</tr>`;
  }).join('');
  // Season totals row (uncolored, like the NFL cards).
  const totals = cfbSeasonTotals(rows, names);
  let totalsRow='';
  if(totals){
    const tcells = labels.map((l,i)=>{
      const sep=(i>0 && grpOf(i)!==grpOf(i-1))?'<td></td>':'';
      return sep+`<td class="pcard-cell pcard-total-cell">${totals[i]==null?'–':totals[i]}</td>`;
    }).join('');
    totalsRow = `<tr class="pcard-total-row"><td class="pcard-wk">TOT</td><td class="pcard-opp">${rows.length}g</td>${tcells}</tr>`;
  }
  const teamTag = teamMap.size ? ` <span class="pcard-season-team">· ${[...teamMap].map(([ab,lg])=>`${lg?`<img src="${lg}" class="pcard-season-logo" onerror="this.style.display='none'">`:''}${ab}`).join(' / ')}</span>` : '';
  const collegeTag = league==='college-football' ? ` <span class="pcard-college-tag">COLLEGE</span>` : '';
  return `<div class="pcard-season">
    <div class="pcard-season-title">${season}${collegeTag}${teamTag}</div>
    <div class="pcard-table-scroll"><table class="pcard-table">
      <thead>
        <tr><th></th><th></th>${grpCells}</tr>
        <tr><th class="pcard-th-wk">WK</th><th>OPP</th>${colHead}</tr>
      </thead>
      <tbody>${bodyRows}${totalsRow}</tbody>
    </table></div>
  </div>`;
}
// College season totals: counting stats sum, "long" columns take the max, YPC/AVG & CMP% are
// recomputed from their summed components; other rates (RTG/QBR/INT%…) are left blank.
function cfbSeasonTotals(rows, names){
  if(!rows.length) return null;
  const n=names.length;
  const sum=new Array(n).fill(0), max=new Array(n).fill(null), seen=new Array(n).fill(false);
  const idxByName={}; names.forEach((nm,i)=>{ idxByName[nm]=i; });
  const isLong = nm => /^long/i.test(nm);
  const isRate = nm => /Pct$|yardsPer|Rating|QBR|avgGain|^avg/i.test(nm);
  rows.forEach(r=>{
    names.forEach((nm,i)=>{
      const v=cfbNum(r.stats[i]); if(v==null) return;
      seen[i]=true;
      if(isLong(nm)) max[i]=Math.max(max[i]==null?-Infinity:max[i], v);
      else sum[i]+=v;
    });
  });
  const out=new Array(n).fill(null);
  names.forEach((nm,i)=>{
    if(!seen[i]){ out[i]=null; return; }
    if(isLong(nm)){ out[i]= max[i]==null?null:String(max[i]); return; }
    if(isRate(nm)){ out[i]=null; return; }   // recomputed below where possible
    out[i]= Number.isInteger(sum[i]) ? String(sum[i]) : String(Math.round(sum[i]*10)/10);
  });
  const rec=(rateName, ydName, cntName, dp, mult)=>{
    if(idxByName[rateName]==null) return;
    const yd=idxByName[ydName]!=null?sum[idxByName[ydName]]:null;
    const ct=idxByName[cntName]!=null?sum[idxByName[cntName]]:null;
    if(yd!=null && ct){ out[idxByName[rateName]] = ((yd/ct)*(mult||1)).toFixed(dp); }
  };
  rec('yardsPerReception','receivingYards','receptions',1);
  rec('yardsPerRushAttempt','rushingYards','rushingAttempts',1);
  rec('completionPct','completions','passingAttempts',1,100);
  return out;
}

function fmtMillions(m){
  if(m==null) return '—';
  // Show up to 2 decimals but drop trailing zeros: 60 → $60M, 40.25 → $40.25M, 12.01 → $12.01M.
  const s = Number.isInteger(m) ? String(m) : parseFloat(m.toFixed(2)).toString();
  return '$'+s+'M';
}
// ── Defensive weekly card (DL/LB/DB), ESPN-style table layout ─────────────
// Seed payload: NFLVERSE[season].def_weekly[normName] = {
//   name,team,pos,group,totals:{...},weeks:[{week,opp,tackles,sacks,pressures,...}]
// }

const DEF_CARD_POS = new Set(['DE','DT','NT','DL','LB','MLB','OLB','ILB','WLB','SLB','DB','CB','S','FS','SS']);

function _pcardDefNorm(pid){
  const p=(typeof sleeperPlayers!=='undefined'&&sleeperPlayers&&sleeperPlayers[pid])||{};
  return ecrNormName(p.name||'');
}

function pcardDefWeeklySeasons(normName){
  if(typeof NFLVERSE==='undefined' || !NFLVERSE) return [];
  return Object.keys(NFLVERSE)
    .filter(s=>{ const d=NFLVERSE[s]&&NFLVERSE[s].def_weekly; return d && d[normName]; })
    .sort((a,b)=>b-a);
}

function pcardDefWeeklyAvailable(pid){
  return pcardDefWeeklySeasons(_pcardDefNorm(pid)).length>0;
}

function _dwNum(v, dp=1){
  if(v==null || Number.isNaN(v)) return '–';
  return Number(v).toFixed(dp);
}

function _dwCellClass(key, v){
  if(v==null || Number.isNaN(v)) return '';
  if(key==='tackles') return _tri(v,7,4);
  if(key==='sacks') return _tri(v,1,0.5);
  if(key==='pressures') return _tri(v,4,2);
  if(key==='hurries') return _tri(v,3,1);
  if(key==='qb_hits') return _tri(v,2,1);
  if(key==='blitzes') return _tri(v,4,1);
  if(key==='ints') return _tri(v,1,0.5);
  if(key==='td_allowed') return _triLow(v,0,1);
  if(key==='rating_allowed') return _triLow(v,75,105);
  if(key==='missed_tackle_pct') return _triLow(v,8,16);
  if(key==='cmp_allowed' || key==='yds_allowed' || key==='targets') return _triLow(v,5,8);
  return '';
}

function _dwCols(group){
  if(group==='DL'){
    return [
      {k:'tackles', l:'TKL', d:0}, {k:'sacks', l:'SACK', d:1}, {k:'pressures', l:'PRS', d:1},
      {k:'hurries', l:'HUR', d:1}, {k:'qb_hits', l:'HIT', d:1}, {k:'blitzes', l:'BLZ', d:1},
      {k:'missed_tackle_pct', l:'MISS%', d:1},
    ];
  }
  if(group==='LB'){
    return [
      {k:'tackles', l:'TKL', d:0}, {k:'sacks', l:'SACK', d:1}, {k:'pressures', l:'PRS', d:1},
      {k:'blitzes', l:'BLZ', d:1}, {k:'targets', l:'TGT', d:1}, {k:'cmp_allowed', l:'CMPA', d:1},
      {k:'yds_allowed', l:'YDSA', d:1}, {k:'ints', l:'INT', d:1}, {k:'rating_allowed', l:'RTG A', d:1},
    ];
  }
  return [
    {k:'targets', l:'TGT', d:1}, {k:'cmp_allowed', l:'CMPA', d:1}, {k:'yds_allowed', l:'YDSA', d:1},
    {k:'td_allowed', l:'TDA', d:1}, {k:'ints', l:'INT', d:1}, {k:'rating_allowed', l:'RTG A', d:1},
    {k:'adot', l:'aDOT', d:1}, {k:'yac_allowed', l:'YAC A', d:1}, {k:'tackles', l:'TKL', d:0},
  ];
}

function _dwTitleForSeason(season, rec){
  const tm = rec && rec.team ? rec.team : '';
  const lg = tm ? NFL_LOGO(tm) : '';
  const teamTag = tm ? ` <span class="pcard-season-team">· ${lg?`<img src="${lg}" class="pcard-season-logo" onerror="this.style.display='none'">`:''}${tm}</span>` : '';
  return `<div class="pcard-season-title">${season}${teamTag}</div>`;
}

function renderPcardDefWeekly(pid){
  const norm=_pcardDefNorm(pid);
  const seasons=pcardDefWeeklySeasons(norm);
  if(!seasons.length) return '<div class="pcard-loading">No nflverse defensive weekly data for this player.</div>';
  const seasonBlocks = [];
  for(const season of seasons){
    const rec=NFLVERSE[season]&&NFLVERSE[season].def_weekly&&NFLVERSE[season].def_weekly[norm];
    if(!rec || !Array.isArray(rec.weeks) || !rec.weeks.length) continue;
    const cols=_dwCols(rec.group||'DB');
    const colHead = cols.map(c=>`<th>${c.l}</th>`).join('');
    const bodyRows = rec.weeks.map(w=>{
      const ol = w.opp ? NFL_LOGO(w.opp) : '';
      const opp = w.opp
        ? `<span class="pcard-opp-inner"><span class="pcard-vs">vs</span>${ol?`<img src="${ol}" class="pcard-opp-logo" onerror="this.style.display='none'">`:''}<span>${w.opp}</span></span>`
        : '–';
      const cells = cols.map(c=>{
        const v = w[c.k];
        const cls = _dwCellClass(c.k, v);
        return `<td class="pcard-cell ${cls}">${v==null?'–':_dwNum(v, c.d)}</td>`;
      }).join('');
      return `<tr><td class="pcard-wk">${w.week||''}</td><td class="pcard-opp home">${opp}</td>${cells}</tr>`;
    }).join('');
    const totals = rec.totals||{};
    const totCells = cols.map(c=>{
      const v=totals[c.k];
      return `<td class="pcard-cell pcard-total-cell">${v==null?'–':_dwNum(v,c.d)}</td>`;
    }).join('');
    const totalRow = `<tr class="pcard-total-row"><td class="pcard-wk">TOT</td><td class="pcard-opp">${totals.games||rec.weeks.length}g</td>${totCells}</tr>`;
    seasonBlocks.push(`<div class="pcard-season">
      ${_dwTitleForSeason(season, rec)}
      <div class="pcard-table-scroll"><table class="pcard-table">
        <thead><tr><th class="pcard-th-wk">WK</th><th>OPP</th>${colHead}</tr></thead>
        <tbody>${bodyRows}${totalRow}</tbody>
      </table></div>
    </div>`);
  }
  if(!seasonBlocks.length) return '<div class="pcard-loading">No defensive weekly rows for this player.</div>';
  return `<div class="dw-wrap">${seasonBlocks.join('')}<div class="pcard-src">Defensive weekly stats from nflverse PFR advanced-defense + participation/pbp enrichment.</div></div>`;
}
// ── Depth chart (ESPN) ──────────────────────────────────────────────────────
// The Roster Changes tab shows the team's depth chart from ESPN — granular position slots
// (LDT/RDT, WLB/MLB/SLB, LCB/RCB…) with players ordered starter → backup, every one clickable.
// We fetch the ORDERED depth chart (core API, athletes referenced by id) and the ROSTER (for
// each player's name/photo/jersey/exp), then join them. If the depth chart is unavailable we
// fall back to a flat by-position grouping of the roster.
const ESPN_DEPTHCHART_URL = (season,tid) =>
  `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/teams/${tid}/depthcharts?lang=en&region=us`;
let espnRosters = {};        // team -> [players] | null   (roster meta, also feeds the fallback)
let espnDepth = {};          // team -> [ordered rows] | null
let espnDepthInFlight = {};
// Which unit a depth-chart formation belongs to (for the Offense/Defense/Special headers).
function depthUnitOf(item){
  const keys = Object.keys(item.positions||{});
  if(/special/i.test(item.name||'') || keys.includes('pk') || keys.includes('ls') || keys.includes('pr')) return 'special';
  if(keys.includes('qb') || keys.includes('rb') || keys.includes('wr') || keys.includes('lt')) return 'offense';
  return 'defense';
}
// Row display order: offense (skill → line) → defense (line → LB → secondary) → special teams.
const DEPTH_SLOT_ORDER = ['qb','rb','fb','wr','te','lt','lg','c','rg','rt','ol',
  'lde','ldt','dt','rdt','nt','de','rde','edge','lb','wlb','mlb','slb','ilb','olb',
  'lcb','cb','rcb','nb','db','ss','s','fs','pk','p','ls','pr','kr'];
// Build ordered depth rows by joining the depth-chart formations (slot + rank) with roster meta.
function buildDepthRows(depthRaw, byId){
  const rows=[];
  (depthRaw.items||[]).forEach(item=>{
    const unit=depthUnitOf(item);
    const positions=item.positions||{};
    for(const key in positions){
      if(key==='h') continue;   // "holder" is just the punter — skip the duplicate row
      const p=positions[key];
      const label=(p.position && p.position.abbreviation) || key.toUpperCase();
      const ordered=(p.athletes||[]).slice().sort((a,b)=>(a.rank||a.slot||99)-(b.rank||b.slot||99));
      const players=[]; const seen={};
      ordered.forEach(a=>{
        const m=/athletes\/(\d+)/.exec((a.athlete && a.athlete.$ref) || '');
        if(!m) return;
        const meta=byId[m[1]];
        if(meta && !seen[m[1]]){ seen[m[1]]=1; players.push(Object.assign({depth:a.rank||a.slot}, meta)); }
      });
      if(players.length) rows.push({slot:key, label, unit, players});
    }
  });
  rows.sort((x,y)=>{
    const ix=DEPTH_SLOT_ORDER.indexOf(x.slot), iy=DEPTH_SLOT_ORDER.indexOf(y.slot);
    return (ix<0?99:ix)-(iy<0?99:iy) || x.label.localeCompare(y.label);
  });
  return rows;
}
async function fetchEspnDepth(team){
  if(espnDepth[team]!==undefined) return espnDepth[team];
  if(espnDepthInFlight[team]) return espnDepthInFlight[team];
  const tid = ESPN_TEAM_ID[team];
  if(!tid){ espnDepth[team]=null; espnRosters[team]=null; return null; }
  espnDepthInFlight[team]=(async()=>{
    try{
      const [rosterRaw, depthRaw] = await Promise.all([
        sleeperFetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${tid}/roster`),
        sleeperFetch(ESPN_DEPTHCHART_URL(PROJ_SEASON, tid)).catch(()=>null),
      ]);
      const players=[], byId={};
      (rosterRaw.athletes||[]).forEach(g=>(g.items||[]).forEach(p=>{
        const rec={
          id:String(p.id), name:p.fullName || `${p.firstName||''} ${p.lastName||''}`.trim(),
          pos:(p.position && p.position.abbreviation) || '',
          jersey:(p.jersey!=null && p.jersey!=='') ? p.jersey : null,
          exp:(p.experience && p.experience.years!=null) ? p.experience.years : null,
          headshot:(p.headshot && p.headshot.href) || null,
          unit:g.position || '', status:(p.status && p.status.type) || 'active',
        };
        players.push(rec); byId[rec.id]=rec;
      }));
      espnRosters[team]=players;
      const rows = (depthRaw && depthRaw.items) ? buildDepthRows(depthRaw, byId) : null;
      espnDepth[team] = (rows && rows.length) ? rows : null;
      if(currentTeam===team && currentPhase==='Additions') renderContent();
      return espnDepth[team];
    }catch(e){
      espnDepth[team]=null;
      if(espnRosters[team]===undefined) espnRosters[team]=null;
      if(currentTeam===team && currentPhase==='Additions') renderContent();
      return null;
    }finally{ delete espnDepthInFlight[team]; }
  })();
  return espnDepthInFlight[team];
}
const DEPTH_UNIT_LABEL = {offense:'🏈 Offense', defense:'🛡️ Defense', special:'⭐ Special Teams'};
function renderDepthChart(team){
  const rows = espnDepth[team];
  if(rows===undefined){ fetchEspnDepth(team);
    return `<div class="add-section"><div class="add-section-head">📋 Depth Chart</div>
      <div class="add-empty">Loading depth chart from ESPN…</div></div>`; }
  if(rows===null) return renderDepthChartFallback(team);   // depth chart unavailable → flat roster
  const FANTASY={QB:1,RB:1,WR:1,TE:1};
  let body='', curUnit=null, total=0;
  rows.forEach(row=>{
    if(row.unit!==curUnit){ curUnit=row.unit; body+=`<div class="depth-unit-head">${DEPTH_UNIT_LABEL[curUnit]||''}</div>`; }
    const chips=row.players.map((p,i)=>{
      total++;
      const hs = p.headshot ? `<img src="${p.headshot}" class="depth-hs" onerror="this.style.display='none'">` : '';
      const rk = p.exp===0 ? `<span class="depth-rookie">R</span>` : '';
      const jersey = p.jersey ? `<span class="depth-jersey">#${p.jersey}</span>` : '';
      const starter = i===0 ? ' depth-starter' : '';
      return `<span class="depth-player clickable-player${starter}" title="${ordinal(i+1)} · ${p.pos||row.label}" onclick="${pcardOnclick(p.name, p.pos||row.label, team)}">${hs}<span class="depth-name">${p.name}</span>${jersey}${rk}</span>`;
    }).join('');
    const posBadge = FANTASY[row.label] ? `<span class="pos-badge pos-${row.label}">${row.label}</span>` : `<span class="depth-pos-abbr">${row.label}</span>`;
    body += `<div class="depth-pos"><div class="depth-pos-label">${posBadge}</div><div class="depth-players">${chips}</div></div>`;
  });
  return `<div class="add-section">
    <div class="add-section-head">📋 Depth Chart <span class="add-count">${total}</span></div>
    <div class="depth-sub">ESPN depth chart · starter → backups, left to right · tap any player for their card.</div>
    ${body}</div>`;
}
// Fallback when the ordered depth chart isn't available: flat by-position grouping of the roster.
const DEPTH_POS_ORDER = ['QB','RB','FB','WR','TE','OT','OG','C','G','T','OL',
  'DE','DT','NT','DL','EDGE','LB','ILB','OLB','MLB','CB','S','SS','FS','DB','K','PK','P','LS'];
function renderDepthChartFallback(team){
  const r = espnRosters[team];
  if(!r || !r.length){
    return `<div class="add-section"><div class="add-section-head">📋 Depth Chart</div>
      <div class="add-empty">Roster unavailable right now.</div></div>`; }
  const FANTASY={QB:1,RB:1,WR:1,TE:1};
  const active = r.filter(p=>!p.status || p.status==='active');
  const byPos={};
  active.forEach(p=>{ (byPos[p.pos]=byPos[p.pos]||[]).push(p); });
  const posKeys=Object.keys(byPos).sort((x,y)=>{
    const ix=DEPTH_POS_ORDER.indexOf(x), iy=DEPTH_POS_ORDER.indexOf(y);
    return (ix<0?99:ix)-(iy<0?99:iy) || x.localeCompare(y);
  });
  const groups=posKeys.map(pos=>{
    const chips=byPos[pos].map(p=>{
      const hs = p.headshot ? `<img src="${p.headshot}" class="depth-hs" onerror="this.style.display='none'">` : '';
      const rk = p.exp===0 ? `<span class="depth-rookie">R</span>` : '';
      const jersey = p.jersey ? `<span class="depth-jersey">#${p.jersey}</span>` : '';
      return `<span class="depth-player clickable-player" onclick="${pcardOnclick(p.name, p.pos, team)}">${hs}<span class="depth-name">${p.name}</span>${jersey}${rk}</span>`;
    }).join('');
    const lblCls = FANTASY[pos] ? `pos-${pos}` : '';
    return `<div class="depth-pos"><div class="depth-pos-label">${FANTASY[pos]?`<span class="pos-badge ${lblCls}">${pos}</span>`:`<span class="depth-pos-abbr">${pos}</span>`}</div><div class="depth-players">${chips}</div></div>`;
  }).join('');
  return `<div class="add-section">
    <div class="add-section-head">📋 Depth Chart <span class="add-count">${active.length}</span></div>
    <div class="depth-sub">Active roster via ESPN · tap any player for their card.</div>
    <div class="depth-grid">${groups}</div></div>`;
}
// Readable source lives in src/templates/coaching-template.html; build.py inlines it here
// as a JSON string so the shipped index.html remains a single self-contained file.
const SCHEME_TEMPLATE_INLINE = "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"/>\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/><title>Formation Playsheet</title>\n<style>\n  :root{--paper:#f4efe2;--ink:#1a1a17;--rule:#c9c1ab;--hl-yel:#f5e04b;--hl-grn:#8fd06a;--hl-pnk:#f7a8c4;--red:#a8321f;}\n  *{box-sizing:border-box;}\n  body{margin:0;background:#2a2723;font-family:\"Courier New\",monospace;padding:14px;color:var(--ink);}\n  .sheet{max-width:1040px;margin:0 auto;background:var(--paper);border:2px solid #000;box-shadow:0 8px 40px rgba(0,0,0,.6);}\n  .hdr{background:var(--ink);color:var(--paper);padding:10px 16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;}\n  .hdr h1{font-size:18px;margin:0;letter-spacing:1px;text-transform:uppercase;}\n  .hdr .wk{font-size:12px;color:#c9c1ab;}\n  .controls{display:flex;flex-wrap:wrap;gap:10px;padding:10px 16px;background:#e8e1d0;border-bottom:2px solid #000;align-items:flex-end;}\n  .ctrl{display:flex;flex-direction:column;gap:3px;}\n  .ctrl label{font-size:9px;text-transform:uppercase;letter-spacing:1px;font-weight:bold;color:#5a5545;}\n  select{font-family:\"Courier New\",monospace;background:var(--paper);border:1.5px solid #000;padding:5px 8px;font-size:13px;font-weight:bold;cursor:pointer;}\n  .banner{background:var(--red);color:#fff;text-align:center;font-weight:bold;font-size:13px;padding:4px;letter-spacing:2px;text-transform:uppercase;}\n  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));}\n  .card{border:1px solid #000;border-top:none;border-left:none;padding:8px 12px 12px;position:relative;}\n  .rank{position:absolute;top:6px;left:8px;font-size:10px;font-weight:bold;color:#8a8470;}\n  .plabel{text-align:center;font-weight:bold;font-size:14px;letter-spacing:1px;border-bottom:1.5px solid #000;padding-bottom:3px;margin-bottom:2px;}\n  .plabel .pers{background:var(--hl-yel);padding:1px 6px;}\n  .plabel .fname{font-size:11px;color:#5a5545;}\n  .subttl{text-align:center;font-size:10px;color:#5a5545;margin-bottom:4px;}\n  svg{display:block;margin:0 auto;}\n  .stats{display:grid;grid-template-columns:1fr 1fr;gap:2px 10px;margin-top:6px;font-size:12px;}\n  .stat{display:flex;justify-content:space-between;border-bottom:1px dotted var(--rule);}\n  .rp{height:20px;background:#ddd6c4;border:1px solid #000;position:relative;margin-top:8px;overflow:hidden;font-size:10px;display:flex;cursor:pointer;}\n  .rp .run,.rp .pass{position:relative;display:flex;align-items:center;height:100%;transition:filter .1s;}\n  .rp .run{background:var(--hl-grn);justify-content:flex-start;padding-left:5px;}\n  .rp .pass{background:#4f83cc;color:#fff;justify-content:flex-end;padding-right:5px;}\n  .rp .run:hover,.rp .pass:hover{filter:brightness(1.12);}\n  .rp .seg.active{outline:2px solid #1a1a17;outline-offset:-2px;}\n  .rp b{font-weight:bold;}\n  .hintbar{text-align:center;font-size:9px;color:#8a8470;margin-top:2px;}\n  .dia{margin-top:8px;border-top:2px dashed var(--rule);padding-top:6px;display:none;}\n  .dia.show{display:block;}\n  .diahead{font-size:10px;font-weight:bold;text-transform:uppercase;text-align:center;margin-bottom:3px;}\n  .empty{padding:30px;text-align:center;color:#8a8470;font-size:13px;grid-column:1/-1;}\n  .foot{padding:8px 16px;font-size:9px;color:#6a6455;border-top:2px solid #000;line-height:1.5;}\n  .hint{text-align:center;font-size:10px;color:#8a8470;padding:6px;background:#ece5d3;border-bottom:1px solid #000;}\n  .hl-p{background:var(--hl-pnk);} .hl-g{background:var(--hl-grn);}\n</style></head>\n<body><div class=\"sheet\">\n  <div class=\"hdr\"><h1>Detroit Lions &mdash; Formation &amp; Concept Sheet</h1><span class=\"wk\">2025 \u00b7 Routes mapped to players</span></div>\n  <div class=\"controls\">\n    <div class=\"ctrl\"><label>Down</label><select id=\"down\"><option value=\"all\">All downs</option><option value=\"1\">1st</option><option value=\"2\">2nd</option><option value=\"3\">3rd</option><option value=\"4\">4th</option></select></div>\n    <div class=\"ctrl\"><label>Distance to sticks</label><select id=\"dist\"><option value=\"all\">Any</option><option value=\"short\">Short (1-3)</option><option value=\"med\">Medium (4-7)</option><option value=\"long\">Long (8+)</option></select></div>\n    <div class=\"ctrl\"><label>Play type</label><select id=\"field\"><option value=\"all\">All plays</option><option value=\"pa\">Play-action</option><option value=\"motion\">Pre-snap motion</option><option value=\"nohuddle\">No-huddle</option><option value=\"redzone\">Red zone</option></select></div>\n    <div class=\"ctrl\"><label>&nbsp;</label><span id=\"ctx\" style=\"font-size:12px;font-weight:bold;padding:5px;\"></span></div>\n  </div>\n  <div class=\"hint\">\u25b8 Click the GREEN part of a formation's bar to see its top-3 run lanes \u00b7 click the BLUE part to see each player's most-common route</div>\n  <div class=\"banner\" id=\"banner\">All Situations</div>\n  <div class=\"grid\" id=\"grid\"></div>\n  <div class=\"foot\">Play diagrams: routes are each skill player's single most-common route WHEN TARGETED out of this formation (season pool, all situations, for stable sample), mapped to players by target rank (WR1=St. Brown, WR2=Williams, etc.); the outermost WR is treated as WR1. Run mode shows the 3 most-used gaps, arrow width = frequency, color = EPA. Alignment is authentic; exact pre-snap WR splits are schematic. Data: nflverse pbp + FTN participation, 2025 REG. Not affiliated with the NFL.</div>\n</div>\n__TC_SCRIPT_OPEN____TC_FV_SCRIPT____TC_SCRIPT_CLOSE__\n__TC_SCRIPT_OPEN__\nfunction ec(e){ if(e==null)return\"#999\"; let t=Math.max(-0.4,Math.min(0.4,e))/0.4;\n  if(t>=0)return `rgb(${Math.round(216+(47-216)*t)},${Math.round(165+(174-165)*t)},${Math.round(29+(78-29)*t)})`;\n  let a=-t; return `rgb(${Math.round(216+(211-216)*a)},${Math.round(165+(59-165)*a)},${Math.round(29+(47-29)*a)})`; }\n\n// compute skill-player positions on a tall play diagram; returns {ol:[...], skill:[{role,x,y,side,label}]}\n// full 1-9 route tree (fallback when a player has no route data at all)\nconst FULL_TREE=[['FLAT',null],['SLANT',null],['COMEBACK',null],['HITCH/CURL',null],['OUT',null],['IN/DIG',null],['CORNER',null],['POST',null],['GO',null]];\nconst FULL_TREE_RB=[['FLAT',null],['SWING',null],['SCREEN',null],['TEXAS/ANGLE',null],['WHEEL',null],['SLANT',null],['HITCH/CURL',null]];\n\n// alignment variations for a personnel grouping (schematic \u2014 nflverse gives personnel, not splits)\nfunction variantsFor(g){\n  const wr=g.wr, te=g.te; const out=[];\n  const half=Math.ceil(wr/2);\n  const add=(name,o)=>out.push(Object.assign({name:name,wrR:half,wrBunch:null,teR:Math.ceil(te/2),teBunch:false,rbSide:null},o));\n  add('Base '+half+'x'+(wr-half));\n  if(wr>=2){ add('Trips Rt',{wrR:wr,teR:0}); add('Trips Lt',{wrR:0,teR:te}); }\n  if(wr>=3){ add('Bunch Rt',{wrR:wr,wrBunch:'R',triangle:true,teR:0,rbSide:'L'}); add('Bunch Lt',{wrR:0,wrBunch:'L',triangle:true,teR:te,rbSide:'R'}); }\n  if(wr==2){ add('Doubles Rt',{wrR:2,teR:0}); add('Doubles Lt',{wrR:0,teR:te}); }\n  if(wr>=4){ add('4-Strong Rt',{wrR:4,wrBunch:'R',teR:0}); add('3x1 Rt',{wrR:3,teR:0}); }\n  if(te>=2){ add('TE Bunch Rt',{teR:te,teBunch:true,wrR:half}); add('TE Bunch Lt',{teR:0,teBunch:true,wrR:half}); add('TE Split',{teR:1,wrR:half}); }\n  if(te>=3){ add('TE Trips Rt',{teR:3,teBunch:true,wrR:0}); add('TE Trips Lt',{teR:0,teBunch:true,wrR:wr}); }\n  return out;\n}\nfunction positions(g, av){\n  const cx=165, olY=210, gap=22, sq=15;\n  const olX=[cx-2*gap,cx-gap,cx,cx+gap,cx+2*gap];\n  const skill=[]; const al=g.align, backs=g.backs, te=g.te, wr=g.wr;\n  const vars=variantsFor(g); const v=vars[(av||0)%vars.length]||vars[0];\n  let qbY = al=='uc'?olY+16:(al=='pistol'?olY+34:olY+42);\n  skill.push({role:'QB',x:cx,y:qbY,side:'M',label:'QB'});\n  // RB placement (shotgun/pistol can flip to weak side of a bunch)\n  const rbSide = v.rbSide;\n  if(al=='uc'){\n    if(backs>=3){ // full house: FB/lead back tight, two halfbacks split behind\n      skill.push({role:'RB',x:cx,y:qbY+22,side:'M',label:'FB'});\n      skill.push({role:'RB',x:cx-20,y:qbY+40,side:'L',label:'RB'});\n      skill.push({role:'RB',x:cx+20,y:qbY+40,side:'R',label:'RB'}); }\n    else if(backs>=2){skill.push({role:'RB',x:cx,y:qbY+22,side:'M',label:'FB'});skill.push({role:'RB',x:cx,y:qbY+40,side:'M',label:'RB'});}\n    else if(backs==1)skill.push({role:'RB',x:cx,y:qbY+38,side:'M',label:'RB'}); }\n  else if(al=='pistol'){\n    skill.push({role:'RB',x:cx,y:qbY+20,side:'M',label:'RB'});\n    if(backs>=2)skill.push({role:'RB',x:cx-24,y:qbY+14,side:'L',label:'RB'});\n    if(backs>=3)skill.push({role:'RB',x:cx+24,y:qbY+14,side:'R',label:'RB'}); }\n  else { const rx=rbSide=='L'?cx-22:(rbSide=='R'?cx+22:cx+22);\n    if(backs>=1)skill.push({role:'RB',x:rx,y:qbY,side:rx<cx?'L':'R',label:'RB'});\n    if(backs>=2)skill.push({role:'RB',x:cx-22,y:qbY,side:'L',label:'RB'});\n    if(backs>=3)skill.push({role:'RB',x:cx,y:qbY+20,side:'M',label:'RB'}); }  // 3rd back offset behind QB\n  // TEs: teR on right (attached beyond RT), rest left; bunch = tighter cluster to one side\n  const teRightN=Math.min(v.teR,te), teLeftN=te-teRightN;\n  const rTE=v.teBunch?[olX[4]+16,olX[4]+34,olX[4]+52]:[olX[4]+18,olX[4]+40];\n  const lTE=v.teBunch?[olX[0]-16,olX[0]-34,olX[0]-52]:[olX[0]-18,olX[0]-40];\n  for(let i=0;i<teRightN;i++){ let x=rTE[i]; skill.push({role:'TE',x:x,y:olY-2,side:'R',label:'TE'}); }\n  for(let i=0;i<teLeftN;i++){ let x=lTE[i]; skill.push({role:'TE',x:x,y:olY-2,side:'L',label:'TE'}); }\n  // WRs: wrR on right, rest left; bunch clusters them tight. Triangle bunch staggers depth so they don't overlap.\n  const wrRightN=Math.min(v.wrR,wr), wrLeftN=wr-wrRightN;\n  const losWR=olY-4;\n  if(v.triangle && (wrRightN>=3 || wrLeftN>=3)){\n    // two receivers on the LOS, third backed off behind the middle of them (triangle apex at the back)\n    const onR = wrRightN>=3;\n    const losX1 = onR?306:24, losX2 = onR?262:68;   // two on the line (outside + inside)\n    const backX = onR?284:46;                        // point man off the ball, centered behind the two\n    skill.push({role:'WR',x:losX1,y:losWR,side:onR?'R':'L',label:'WR'});      // #1 on line, outside\n    skill.push({role:'WR',x:losX2,y:losWR,side:onR?'R':'L',label:'WR'});      // #2 on line, inside\n    skill.push({role:'WR',x:backX,y:losWR+16,side:onR?'R':'L',label:'WR'});   // #3 off ball, behind the middle\n    // any extra WRs (4+) split to the opposite side\n    const rest = wr-3;\n    const oppWide = onR?[30,58,84]:[300,272,246];\n    for(let i=0;i<rest;i++){ skill.push({role:'WR',x:oppWide[i],y:losWR,side:onR?'L':'R',label:'WR'}); }\n  } else {\n    const rWide=v.wrBunch=='R'?[300,286,272,258]:[300,272,246,224];\n    const lWide=v.wrBunch=='L'?[30,44,58,72]:[30,58,84,106];\n    for(let i=0;i<wrRightN;i++){ let x=rWide[i]; skill.push({role:'WR',x:x,y:losWR,side:'R',label:'WR'}); }\n    for(let i=0;i<wrLeftN;i++){ let x=lWide[i]; skill.push({role:'WR',x:x,y:losWR,side:'L',label:'WR'}); }\n  }\n  return {olX, olY, sq, cx, skill, variantName:v.name, nVariants:vars.length};\n}\n// arrowhead marker id counter to keep unique\nlet _mk=0;\nfunction arrow(color){ const id='a'+(_mk++); return {def:`<marker id=\"${id}\" viewBox=\"0 0 10 10\" refX=\"7\" refY=\"5\" markerWidth=\"5\" markerHeight=\"5\" orient=\"auto-start-reverse\"><path d=\"M1 1L8 5L1 9\" fill=\"none\" stroke=\"${color}\" stroke-width=\"2\"/></marker>`, url:`url(#${id})`}; }\n\n// route path from (x,y); side L/R. Most RB backfield routes stem up to cross the LOS,\n// but SCREEN/SWING/TEXAS release from the backfield without stemming up first.\nfunction routePath(x,y,side,route,losY){\n  const c=(side=='L')?1:-1;\n  const backfieldRelease = (route=='SCREEN'||route=='SWING'||route=='TEXAS/ANGLE'||route=='FLAT'||route=='WHEEL');\n  let sx=x, sy=y, pre=`M${x},${y} `;\n  // RB below the LOS: for downfield routes, stem up to just past the LOS so short breaks are visible.\n  // Backfield-release routes stay put and work out of the backfield.\n  if(y > losY+6 && !backfieldRelease){ const upTo = losY-8; pre=`M${x},${y} L${x},${upTo} `; sx=x; sy=upTo; }\n  const P={\n    'GO':`V${sy-140}`, 'FADE/GO':`V${sy-140}`,'HITCH/CURL':`V${sy-55} l${-6*c},12`, 'COMEBACK':`V${sy-90} l${-8*c},14`,\n    'SLANT':`l${34*c},-40`, 'QUICK OUT':`V${sy-32} h${-30*c}`, 'SPEED OUT':`V${sy-30} h${-28*c}`, 'OUT':`V${sy-72} h${-32*c}`, 'DEEP OUT':`V${sy-90} h${-32*c}`,\n    'IN/DIG':`V${sy-76} h${54*c}`, 'POST':`V${sy-88} l${40*c},-40`, 'CORNER':`V${sy-88} l${-38*c},-38`,\n    'SHALLOW CROSS/DRAG':`V${sy-15} h${66*c}`, 'SCREEN':`q${-14*c},10 ${-34*c},6`, 'FLAT':`V${sy-12} h${-28*c}`, 'SPEED':`V${sy-12} h${-28*c}`,\n    'SWING':`q${-30*c},18 ${-58*c},2`, 'WHEEL':`h${-14*c} V${sy-84}`,\n    'TEXAS/ANGLE':`l${-60*c},-40 l${60*c},-40`, 'ARROW':`l${-24*c},-18`\n  };\n  const seg=P[route]||`V${sy-46}`;\n  return pre+seg;\n}\nfunction drawPlayDiagram(g, mode, sel, wrRot, av){\n  sel=sel||{}; wrRot=wrRot||0; _mk=0;\n  const W=330,H=290; const pos=positions(g, av); const {olX,olY,sq,cx,skill}=pos; const losY=olY-11;\n  let defs=''; let s=`<svg width=\"${W}\" height=\"${H}\" viewBox=\"0 0 ${W} ${H}\">`;\n  s+=`<line x1=\"10\" y1=\"${losY}\" x2=\"${W-10}\" y2=\"${losY}\" stroke=\"#000\" stroke-dasharray=\"5 3\" opacity=\"0.4\"/>`;\n  s+=`<text x=\"${W-14}\" y=\"${losY-4}\" font-size=\"8\" fill=\"#8a8470\" text-anchor=\"end\">LOS</text>`;\n  if(pos.nVariants>1) s+=`<text x=\"14\" y=\"14\" font-size=\"8.5\" fill=\"#a8321f\" font-weight=\"bold\">\u25b8 ${pos.variantName} <tspan fill=\"#8a8470\" font-weight=\"normal\">(tap label)</tspan></text>`;\n  const olL=[\"LT\",\"LG\",\"C\",\"RG\",\"RT\"];\n  for(let i=0;i<5;i++){s+=`<rect x=\"${olX[i]-sq/2}\" y=\"${olY-sq/2}\" width=\"${sq}\" height=\"${sq}\" fill=\"#1f3a6d\" stroke=\"#000\"/><text x=\"${olX[i]}\" y=\"${olY+3}\" fill=\"#fff\" font-size=\"7\" text-anchor=\"middle\" font-family=\"Arial\" font-weight=\"bold\">${olL[i]}</text>`;}\n  if(g.ol>=6){let x=olX[4]+22;s+=`<rect x=\"${x-sq/2}\" y=\"${olY-sq/2}\" width=\"${sq}\" height=\"${sq}\" fill=\"#2d4f8a\" stroke=\"#000\"/><text x=\"${x}\" y=\"${olY+3}\" fill=\"#fff\" font-size=\"6.5\" text-anchor=\"middle\" font-family=\"Arial\" font-weight=\"bold\">ST</text>`;}\n  const bySlot={}; (g.assigns||[]).forEach(a=>bySlot[a.slot]=a);\n  // rotate WRs: collect WR skill entries in order, rotate their slot assignment\n  const wrPlayers=skill.filter(p=>p.role=='WR');\n  let wrN=0,teN=0,rbN=0;\n  skill.forEach(p=>{ if(p.role=='WR'){p.slot='WR'+(((wrN++)+wrRot)%Math.max(wrPlayers.length,1)+1);} else if(p.role=='TE'){teN++;p.slot='TE'+teN;} else if(p.role=='RB'){rbN++;p.slot='RB'+rbN;} });\n  function routesFor(p){ const a=bySlot[p.slot]; if(a&&a.routes&&a.routes.length) return {name:a.name,list:a.routes,src:a.src};\n    // fallback to full tree\n    if(p.role=='RB') return {name:(a?a.name:''),list:FULL_TREE_RB,src:'tree'};\n    return {name:(a?a.name:''),list:FULL_TREE,src:'tree'}; }\n\n  // ---- RUN MODE: OL blocking \"T\" + RB lanes ----\n  if(mode=='run'){\n    const side=g.run_side||'mid';\n    const dx = side=='right'?12:(side=='left'?-12:0);\n    // OL blocking lines forming a T: each lineman a short line up, drifting toward run side\n    olX.forEach((ox,i)=>{ const tipx=ox+dx, tipy=olY-24;\n      s+=`<path d=\"M${ox},${olY-8} L${tipx},${tipy}\" stroke=\"#1a1a17\" stroke-width=\"2\" fill=\"none\" stroke-linecap=\"round\"/>`;\n      // small cross-cap at the top = the \"T\"\n      s+=`<line x1=\"${tipx-5}\" y1=\"${tipy}\" x2=\"${tipx+5}\" y2=\"${tipy}\" stroke=\"#1a1a17\" stroke-width=\"2\"/>`;\n    });\n    const rb=skill.find(p=>p.role=='RB')||skill.find(p=>p.role=='QB');\n    const laneX={LE:olX[0]-30,LT:olX[0]-6,LG:olX[1]-4,MID:cx,RG:olX[3]+4,RT:olX[4]+6,RE:olX[4]+30};\n    const tot=(g.lanes||[]).reduce((a,l)=>a+l[1],0)||1;\n    (g.lanes||[]).forEach(l=>{ const tx=laneX[l[0]]; if(tx==null)return;\n      const w=1.5+l[1]/tot*7; const ty=olY-52; const ar=arrow(ec(l[2])); defs+=ar.def;\n      s+=`<path d=\"M${rb.x},${rb.y} C${rb.x+(tx-rb.x)*0.4},${rb.y-20} ${tx},${olY+16} ${tx},${ty}\" fill=\"none\" stroke=\"${ec(l[2])}\" stroke-width=\"${w.toFixed(1)}\" stroke-linecap=\"round\" marker-end=\"${ar.url}\"/>`;\n      s+=`<text x=\"${tx}\" y=\"${ty-4}\" font-size=\"8\" fill=\"#1a1a17\" text-anchor=\"middle\" font-weight=\"bold\">${l[0]} ${Math.round(100*l[1]/tot)}%</text>`;\n    });\n  }\n  // ---- PASS MODE: routes per player + TE block T ----\n  if(mode=='pass'){\n    skill.forEach(p=>{ if(!p.slot||p.role=='QB') return; const rf=routesFor(p); if(!rf.list||!rf.list.length) return;\n      const idx=(sel[p.slot]||0)%rf.list.length; const rt=rf.list[idx];\n      const ar=arrow('#a8321f'); defs+=ar.def;\n      s+=`<path d=\"${routePath(p.x,p.y,p.side,rt[0],losY)}\" fill=\"none\" stroke=\"#a8321f\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" marker-end=\"${ar.url}\"/>`;\n    });\n  }\n  // ---- skill circles + labels ----\n  wrN=0;\n  skill.forEach(p=>{\n    let fill=p.role=='WR'?'#cdd2e0':(p.role=='TE'?'#3f6db5':'#1f3a6d'), tc=p.role=='WR'?'#1a1a17':'#fff';\n    const rf=(p.slot&&p.role!='QB')?routesFor(p):null;\n    const tappable=(mode=='pass' && rf && rf.list && rf.list.length);\n    const qbTap=(mode=='pass' && p.role=='QB' && wrPlayers.length>1);\n    if(tappable) s+=`<circle cx=\"${p.x}\" cy=\"${p.y}\" r=\"12.5\" fill=\"none\" stroke=\"#a8321f\" stroke-width=\"1\" stroke-dasharray=\"2 2\" opacity=\"0.5\"/>`;\n    if(qbTap) s+=`<circle cx=\"${p.x}\" cy=\"${p.y}\" r=\"12.5\" fill=\"none\" stroke=\"#4f83cc\" stroke-width=\"1\" stroke-dasharray=\"2 2\" opacity=\"0.6\"/>`;\n    const cls = tappable?`<g class=\"tap\" data-slot=\"${p.slot}\" style=\"cursor:pointer\">`:(qbTap?`<g class=\"qbtap\" style=\"cursor:pointer\">`:'<g>');\n    s+=`${cls}<circle cx=\"${p.x}\" cy=\"${p.y}\" r=\"9\" fill=\"${fill}\" stroke=\"#000\"/><text x=\"${p.x}\" y=\"${p.y+3}\" fill=\"${tc}\" font-size=\"7\" text-anchor=\"middle\" font-family=\"Arial\" font-weight=\"bold\">${p.label}</text></g>`;\n    if(qbTap) s+=`<text x=\"${p.x}\" y=\"${p.y+20}\" font-size=\"5.5\" fill=\"#4f83cc\" text-anchor=\"middle\">tap: rotate WRs</text>`;\n    if(mode=='pass' && rf && rf.name && rf.name!='\\u2014'){\n      const idx=(sel[p.slot]||0)%rf.list.length; const rt=rf.list[idx];\n      const belowLOS = p.y>losY;\n      let ny=belowLOS?p.y+20:p.y+20;\n      s+=`<text x=\"${p.x}\" y=\"${ny}\" font-size=\"7.5\" fill=\"#1a1a17\" text-anchor=\"middle\" font-weight=\"bold\">${rf.name}</text>`;\n      const pctTxt = rt[1]!=null?` ${rt[1]}%`:'';\n      const srcTxt = rf.src=='tree'?' (tree)':(rf.src=='season'?' (szn)':'');\n      s+=`<text x=\"${p.x}\" y=\"${ny+9}\" font-size=\"6\" fill=\"#a8321f\" text-anchor=\"middle\">${rt[0].split('/')[0]}${pctTxt}${srcTxt}</text>`;\n      if(rf.list.length>1) s+=`<text x=\"${p.x}\" y=\"${ny+17}\" font-size=\"5.5\" fill=\"#8a8470\" text-anchor=\"middle\">${idx+1}/${rf.list.length} tap</text>`;\n    }\n  });\n  return s.replace('<svg ',`<svg `).replace(`viewBox=\"0 0 ${W} ${H}\">`,`viewBox=\"0 0 ${W} ${H}\"><defs>${defs}</defs>`)+`</svg>`;\n}\nfunction draw(){\n  const dn=document.getElementById('down').value,ds=document.getElementById('dist').value,fl=document.getElementById('field').value;\n  const node=FORM[dn][ds][fl],grid=document.getElementById('grid');\n  document.getElementById('banner').textContent=({all:'All Downs','1':'1st Down','2':'2nd Down','3':'3rd Down','4':'4th Down'}[dn])+({all:'',short:' & Short',med:' & Medium',long:' & Long'}[ds])+({all:'',pa:' \u00b7 Play-Action',motion:' \u00b7 Motion',nohuddle:' \u00b7 No-Huddle',redzone:' \u00b7 Red Zone'}[fl]);\n  if(!node||!node.groups.length){grid.innerHTML='<div class=\"empty\">No plays match this situation.</div>';document.getElementById('ctx').textContent='';return;}\n  document.getElementById('ctx').textContent=node.total+' plays';\n  window._G=node.groups;\n  let html=\"\";\n  node.groups.forEach((g,i)=>{const noise=g.n<8?' <span class=\"hl-p\" style=\"font-size:9px;padding:0 3px;\">SMALL</span>':'';\n    html+=`<div class=\"card\"><div class=\"rank\">#${i+1}</div>\n      <div class=\"plabel\"><span class=\"pers alt\" data-i=\"${i}\" title=\"tap to change alignment\" style=\"cursor:pointer\">${g.p} PERSONNEL \u21c4</span> <span class=\"fname\">${g.name}</span></div>\n      <div class=\"subttl\">${g.backs} BACK \u00b7 ${g.te} TE \u00b7 ${g.wr} WR \u2014 ${g.share}% of snaps${noise}</div>\n      <div class=\"fieldbox\">${fieldSvg(g,'none',{},0,0)}</div>\n      <div class=\"stats\"><div class=\"stat\"><span id=\"snl${i}\">Snaps</span><b id=\"snv${i}\">${g.n}</b></div><div class=\"stat\"><span>Success</span><b id=\"scv${i}\">${g.succ}%</b></div>\n      <div class=\"stat\"><span>EPA/play</span><b id=\"epv${i}\" class=\"${g.epa>=.05?'hl-g':(g.epa<=-.05?'hl-p':'')}\">${g.epa>=0?'+':''}${g.epa.toFixed(2)}</b></div><div class=\"stat\"><span>Share</span><b>${g.share}%</b></div></div>\n      <div class=\"rp\" data-i=\"${i}\"><div class=\"run seg\" data-mode=\"run\" style=\"width:${(100-Number(g.pass_rate||0)).toFixed(2)}%\"><b>RUN ${(100-Number(g.pass_rate||0)).toFixed(2)}%</b></div><div class=\"pass seg\" data-mode=\"pass\" style=\"width:${Number(g.pass_rate||0).toFixed(2)}%\"><b>PASS ${Number(g.pass_rate||0).toFixed(2)}%</b></div></div>\n      <div class=\"hintbar\" id=\"hint${i}\">tap label \u21c4 change look \u00b7 click bar \u25b8 runs / routes</div></div>`;});\n  grid.innerHTML=html;\n  function setStats(i,mode,g){\n    const snl=document.getElementById('snl'+i),snv=document.getElementById('snv'+i),scv=document.getElementById('scv'+i),epv=document.getElementById('epv'+i);\n    let n=g.n,sc=g.succ,ep=g.epa,lbl='Snaps';\n    if(mode=='run'){ n=g.nr;sc=g.sr;ep=g.er;lbl='Run snaps'; }\n    else if(mode=='pass'){ n=g.np;sc=g.sp;ep=g.ep;lbl='Pass snaps'; }\n    snl.textContent=lbl; snv.textContent=n; scv.textContent=sc+'%';\n    epv.textContent=(ep>=0?'+':'')+ep.toFixed(2);\n    epv.className = ep>=.05?'hl-g':(ep<=-.05?'hl-p':'');\n  }\n  document.querySelectorAll('.seg').forEach(seg=>{\n    seg.onclick=(e)=>{ e.stopPropagation();\n      const card=seg.closest('.card'), i=+seg.closest('.rp').dataset.i, mode=seg.dataset.mode, g=window._G[i];\n      const box=card.querySelector('.fieldbox'), hint=card.querySelector('.hintbar');\n      const cur=box.dataset.mode||'none';\n      card.querySelectorAll('.seg').forEach(x=>x.classList.remove('active'));\n      if(cur==mode){ box.innerHTML=fieldSvg(g,'none',{},0,box._av||0); box.dataset.mode='none';\n        hint.textContent='tap label \u21c4 change look \u00b7 click bar \u25b8 runs / routes'; hint.style.color=''; setStats(i,'none',g); return; }\n      seg.classList.add('active');\n      if(!box._sel) box._sel={};\n      box.innerHTML=fieldSvg(g,mode,box._sel,box._rot||0,box._av||0); box.dataset.mode=mode;\n      if(mode=='pass') wireTaps(box,g);\n      setStats(i,mode,g);\n      hint.textContent = mode=='pass'?'ROUTES \u2014 most common per player when targeted':'RUN LANES \u2014 top 3 gaps (color = EPA)';\n      hint.style.color = mode=='pass'?'#4f83cc':'#4a7f2c';\n    };\n  });\n  // clickable personnel label cycles alignment variant\n  document.querySelectorAll('.pers.alt').forEach(lab=>{\n    lab.onclick=(e)=>{ e.stopPropagation();\n      const i=+lab.dataset.i, g=window._G[i], card=lab.closest('.card'), box=card.querySelector('.fieldbox');\n      box._av=(box._av||0)+1; box._sel={}; box._rot=box._rot||0;\n      const mode=box.dataset.mode||'none';\n      box.innerHTML=fieldSvg(g,mode,box._sel,box._rot,box._av); \n      if(mode=='pass') wireTaps(box,g);\n    };\n  });\n}\n// formation diagram rendered in the card; overlay drawn in-place on click\nfunction fieldSvg(g, mode, sel, wrRot, av){ return drawPlayDiagram(g, mode, sel, wrRot, av); }\nfunction wireTaps(box,g){\n  box.querySelectorAll('.tap').forEach(el=>{\n    el.onclick=(ev)=>{ ev.stopPropagation();\n      const slot=el.getAttribute('data-slot'); if(!box._sel) box._sel={};\n      box._sel[slot]=(box._sel[slot]||0)+1;\n      box.innerHTML=fieldSvg(g,'pass',box._sel,box._rot||0,box._av||0); box.dataset.mode='pass';\n      wireTaps(box,g);\n    };\n  });\n  box.querySelectorAll('.qbtap').forEach(el=>{\n    el.onclick=(ev)=>{ ev.stopPropagation();\n      box._rot=(box._rot||0)+1; box._sel={};\n      box.innerHTML=fieldSvg(g,'pass',{},box._rot,box._av||0); box.dataset.mode='pass';\n      wireTaps(box,g);\n    };\n  });\n}\n\n['down','dist','field'].forEach(id=>document.getElementById(id).onchange=draw); draw();\n__TC_SCRIPT_CLOSE__</body></html>\n";
// ─────────────────────────────────────────────────────────────────────────────
// Team coaching scheme modal (nflverse)
// ─────────────────────────────────────────────────────────────────────────────
let schemeOverlayOpen = false;
let schemeTeam = null;
let schemeSeason = null;
let _schemeEscBound = false;
const _SCHEME_SCRIPT_OPEN = '<scr' + 'ipt>';
const _SCHEME_SCRIPT_CLOSE = '</scr' + 'ipt>';

function _schemeEscHtml(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function _schemeAllSeasons(){
  if(typeof NFLVERSE!=='object' || !NFLVERSE) return [];
  return Object.keys(NFLVERSE).map(x=>parseInt(x,10)).filter(Number.isFinite)
    .sort((a,b)=>b-a).map(String);
}

// Candidate seasons for a team = every season the loaded nflverse block covers. Coaching
// data for each season is lazy-loaded per-season on demand, so this deliberately does NOT
// require the coaching_scheme block to be present yet (that would hide season tabs/links
// before their sidecar is fetched).
function _schemeSeasons(team){
  return _schemeAllSeasons();
}

function _schemePreferredSeason(team){
  const seasons = _schemeAllSeasons();
  if(!seasons.length) return null;
  if(schemeSeason && seasons.includes(String(schemeSeason))) return String(schemeSeason);
  if(activeSeason!=='proj' && seasons.includes(String(activeSeason))) return String(activeSeason);
  if(SHARP_SEASON!=null && seasons.includes(String(SHARP_SEASON))) return String(SHARP_SEASON);
  return seasons[0];
}

function _schemePlaycallerHC(team){
  return !!(HC_PLAYCALLERS && HC_PLAYCALLERS[team]);
}

function _schemeOcSource(team){
  if(!team) return null;
  const hc = HC_HISTORY && HC_HISTORY[team];
  if(_schemePlaycallerHC(team) && hc && hc.is_new && hc.prev_code && hc.prev_code!==team){
    return {
      name: hc.name || HC_PLAYCALLERS[team] || 'Head coach',
      since: hc.since,
      is_new: true,
      prev_code: hc.prev_code,
      prev_role: hc.prev_role || 'head coach',
      prev_years: hc.prev_years,
      _fromHC: true,
    };
  }
  const oc = COORDINATORS && COORDINATORS[team] && COORDINATORS[team].offense;
  if(!oc || !oc.name) return null;
  return {
    name: oc.name,
    since: oc.since,
    is_new: !!(oc.is_new && !oc.internal && oc.prev_code),
    prev_code: oc.prev_code || null,
    prev_role: oc.prev_role || 'coordinator',
    prev_years: oc.prev_years,
    _fromHC: false,
  };
}

function _schemeSeasonsForTeam(team){
  // Candidate seasons (see _schemeSeasons) so prior-team links appear before their
  // per-season coaching sidecar is fetched; clicking a link loads that season on demand.
  return _schemeAllSeasons();
}

function _schemeOcCallout(team){
  const src = _schemeOcSource(team);
  if(!src) return '';
  const roleTag = src._fromHC ? 'Play-calling HC' : 'OC';
  const since = src.since ? ` · since ${src.since}` : '';
  if(!src.is_new || !src.prev_code){
    return `<div class="scheme-oc-callout"><span class="scheme-oc-pill">${roleTag}</span><b>${_schemeEscHtml(src.name)}</b>${since}</div>`;
  }
  const prev = src.prev_code;
  const prevName = teamDisplayName(prev);
  const seasons = _schemeSeasonsForTeam(prev);
  const links = seasons.length
    ? `<div class="scheme-oc-links">${seasons.map(s=>`<button class="scheme-oc-link" onclick="openTeamCoachingScheme('${prev}',{season:'${s}',from:'${team}'})">${prev} ${s}</button>`).join('')}</div>`
    : `<span class="scheme-oc-missing">No prior-team coaching scheme seasons loaded.</span>`;
  return `<div class="scheme-oc-callout">
    <div><span class="scheme-oc-pill new">NEW ${roleTag}</span><b>${_schemeEscHtml(src.name)}</b>${since}
      <span class="scheme-oc-note">from ${prevName}${src.prev_role?` (${_schemeEscHtml(src.prev_role)})`:''}${src.prev_years?` · ${_schemeEscHtml(String(src.prev_years))}`:''}</span>
    </div>
    ${links}
  </div>`;
}

function _schemePayload(team, seasonPref){
  if(!team || !NFLVERSE) return null;
  const seasons = _schemeSeasons(team);
  const keys = Object.keys(NFLVERSE).map(x=>parseInt(x,10)).filter(Number.isFinite).sort((a,b)=>b-a);
  const pref = [];
  if(seasonPref && seasons.includes(String(seasonPref))) pref.push(String(seasonPref));
  if(schemeSeason && seasons.includes(String(schemeSeason))) pref.push(String(schemeSeason));
  if(Number.isFinite(parseInt(SHARP_SEASON,10))) pref.push(String(parseInt(SHARP_SEASON,10)));
  if(activeSeason!=='proj' && Number.isFinite(parseInt(activeSeason,10))) pref.push(String(parseInt(activeSeason,10)));
  const seen = new Set();
  const order = pref.concat(keys.map(String)).filter(s=>{ if(seen.has(s)) return false; seen.add(s); return true; });
  for(const s of order){
    const block = NFLVERSE[s] && NFLVERSE[s].coaching_scheme && NFLVERSE[s].coaching_scheme[team];
    if(block && block.views) return {season:s, data:block};
  }
  return null;
}

function _schemeNumber(v, d){
  return (v==null || Number.isNaN(Number(v))) ? d : Number(v);
}

function _schemeRunSide(lanes){
  if(!lanes || !lanes.length || !lanes[0] || !lanes[0][0]) return 'mid';
  const lane = String(lanes[0][0]);
  if(lane[0]==='L') return 'left';
  if(lane[0]==='R') return 'right';
  return 'mid';
}

function _schemeToGroup(g){
  if(!g) return null;
  const lanes = Array.isArray(g.lanes) ? g.lanes : [];
  const assigns = Array.isArray(g.assigns) ? g.assigns : [];
  return {
    p: String(g.p||''),
    align: String(g.align||'gun'),
    name: String(g.name||g.p||'FORMATION'),
    backs: _schemeNumber(g.backs, 0),
    te: _schemeNumber(g.te, 0),
    wr: _schemeNumber(g.wr, 0),
    ol: _schemeNumber(g.ol, 5),
    n: _schemeNumber(g.n, 0),
    share: _schemeNumber(g.share, 0),
    pass_rate: _schemeNumber(g.pass_rate, 0),
    epa: _schemeNumber(g.epa, 0),
    succ: _schemeNumber(g.succ, 0),
    np: _schemeNumber(g.np, 0),
    sp: _schemeNumber(g.sp, 0),
    ep: _schemeNumber(g.ep, 0),
    nr: _schemeNumber(g.nr, 0),
    sr: _schemeNumber(g.sr, 0),
    er: _schemeNumber(g.er, 0),
    assigns: assigns.map(a=>({
      role: String(((a&&a.slot)||'').replace(/\d+/g,'')||'WR'),
      slot: String((a&&a.slot)||''),
      name: String((a&&a.name)||'—'),
      routes: Array.isArray(a&&a.routes) ? a.routes : [],
      src: 'form',
    })),
    lanes: lanes,
    ltot: lanes.reduce((t,l)=>t+_schemeNumber(l&&l[1],0),0),
    run_side: _schemeRunSide(lanes),
  };
}

function _schemeExpandGroup(g, formations){
  if(!g) return g;
  // New (deduped) schema: groups carry a `sig` referencing the per-team formations table
  // (formation metadata + slot assignments/routes). Merge those back in so downstream
  // rendering sees a self-contained group. Legacy full groups (no sig) pass through unchanged.
  const f = (formations && g.sig && formations[g.sig]) || null;
  return f ? Object.assign({}, f, g) : g;
}

function _schemeNode(view, formations){
  const v = view || {total:0,groups:[]};
  const groups = (Array.isArray(v.groups) ? v.groups : [])
    .map(g => _schemeToGroup(_schemeExpandGroup(g, formations)))
    .filter(Boolean);
  const total = _schemeNumber(v.total, groups.reduce((t,g)=>t+_schemeNumber(g.n,0),0));
  return {total, groups};
}

function _schemeEmptyNode(){ return {total:0, groups:[]}; }

function _schemeBuildFv(p){
  const views = (p && p.data && p.data.views) ? p.data.views : {};
  const formations = (p && p.data && p.data.formations) ? p.data.formations : {};
  const DOWNS = ['all','1','2','3','4'];
  const DISTS = ['all','short','med','long'];
  const TYPES = ['all','pa','motion','nohuddle','redzone'];
  const isNode = x => !!x && (Array.isArray(x.groups) || typeof x.total === 'number');
  // Old flat schema (down/type marginals only) vs new nested down→dist→type schema.
  const legacy = isNode(views.all) || isNode(views.down1);

  const data = {};
  if(legacy){
    // Back-compat: map the old marginal views onto the grid so the primary views still
    // render; combined (down+dist / down+type) filters fall back to empty as they did before.
    const e = _schemeEmptyNode();
    const node = k => _schemeNode(views[k], formations);
    const dblk = (main,pa,mo,nh,rz) => ({
      all:{all:main, pa:pa, motion:mo, nohuddle:nh, redzone:rz},
      short:{all:e, pa:e, motion:e, nohuddle:e, redzone:e},
      med:{all:e, pa:e, motion:e, nohuddle:e, redzone:e},
      long:{all:e, pa:e, motion:e, nohuddle:e, redzone:e},
    });
    data.all = dblk(node('all'), node('pa'), node('motion'), node('nohuddle'), e);
    data['1'] = dblk(node('down1'), e, e, e, e);
    data['2'] = dblk(node('down2'), e, e, e, e);
    data['3'] = dblk(node('down3'), e, e, e, e);
    data['4'] = dblk(node('down4'), e, e, e, e);
  } else {
    // New schema: fill the full down × distance × type grid, defaulting any pruned
    // (empty) combination to an empty node so every filter selection resolves cleanly.
    for(const dn of DOWNS){
      const dv = views[dn] || {};
      data[dn] = {};
      for(const ds of DISTS){
        const sv = dv[ds] || {};
        data[dn][ds] = {};
        for(const fl of TYPES){
          data[dn][ds][fl] = _schemeNode(sv[fl], formations);
        }
      }
    }
  }

  return {
    data: data,
    season: p ? p.season : {},
    names: (p && p.data && p.data.names) ? p.data.names : {},
    jerseys: (p && p.data && p.data.jerseys) ? p.data.jerseys : {},
    slots: (p && p.data && p.data.slots) ? p.data.slots : {},
  };
}

function _schemeCompactLabel(slot, pid, names, jerseys){
  const id = String(pid||'');
  const j = jerseys && jerseys[id];
  if(j!=null && String(j)!=='') return `#${j}`;
  const nm = names && names[id] ? String(names[id]) : '';
  if(nm) return nm.length>6 ? nm.slice(0,6) : nm;
  return String(slot||'').toUpperCase() || '—';
}

function _schemeCompactFvLabels(fv){
  if(!fv || !fv.data) return fv;
  const out = JSON.parse(JSON.stringify(fv));
  const names = out.names || {};
  const jerseys = out.jerseys || {};
  const slots = out.slots || {};
  const data = out.data || {};
  for(const down of Object.keys(data)){
    const distBlock = data[down] || {};
    for(const dist of Object.keys(distBlock)){
      const fieldBlock = distBlock[dist] || {};
      for(const field of Object.keys(fieldBlock)){
        const node = fieldBlock[field];
        const groups = Array.isArray(node&&node.groups) ? node.groups : [];
        groups.forEach(g=>{
          const assigns = Array.isArray(g&&g.assigns) ? g.assigns : [];
          assigns.forEach(a=>{
            const slot = String((a&&a.slot)||'');
            const pid = slots[slot];
            a.name = _schemeCompactLabel(slot, pid, names, jerseys);
          });
        });
      }
    }
  }
  return out;
}

function _schemeRenderTemplate(template, p){
  const fv = _schemeCompactFvLabels(_schemeBuildFv(p));
  const team = schemeTeam || '';
  const season = String((p && p.season) || SHARP_SEASON || '');
  const full = teamDisplayName(team);
  const wr1 = fv.names[(fv.slots||{}).WR1] || 'WR1';
  const wr2 = fv.names[(fv.slots||{}).WR2] || 'WR2';
  const script = `const FV=${JSON.stringify(fv)};\nconst FORM=FV.data;\nconst SEASON=FV.season;\nconst NAMES=FV.names;`;
  return template
    .replace('svg{display:block;margin:0 auto;}', 'svg{display:block;margin:0 auto;max-width:100%;height:auto;}')
    .replace('grid-template-columns:repeat(auto-fill,minmax(330px,1fr));', 'grid-template-columns:repeat(auto-fill,minmax(280px,1fr));')
    .replace('</style>', '@media (max-width:560px){ body{padding:8px;} .sheet{max-width:100%;} .controls{padding:8px 10px;} .grid{grid-template-columns:1fr;} .card{padding:8px 8px 10px;} }</style>')
    .replace(/__TC_SCRIPT_OPEN__/g, _SCHEME_SCRIPT_OPEN)
    .replace(/__TC_SCRIPT_CLOSE__/g, _SCHEME_SCRIPT_CLOSE)
    .replace('__TC_FV_SCRIPT__', script)
    .replace('Detroit Lions &mdash; Formation &amp; Concept Sheet', `${full} &mdash; Formation &amp; Concept Sheet`)
    .replace('2025 · Routes mapped to players', `${season} · Routes mapped to players`)
    .replace('WR1=St. Brown, WR2=Williams', `WR1=${wr1}, WR2=${wr2}`)
    .replace(/const FV=.*?const FORM=FV\.data;\s*const SEASON=FV\.season;\s*const NAMES=FV\.names;/s, script);
}

function _renderTeamCoachingScheme(){
  const host = document.getElementById('schemeOverlayHost');
  if(!host || !schemeTeam){ return; }
  const seasons = _schemeAllSeasons();
  const pick = (schemeSeason && seasons.includes(String(schemeSeason)))
    ? String(schemeSeason) : _schemePreferredSeason(schemeTeam);
  schemeSeason = pick;
  // Ensure the selected season's coaching sidecar is loaded before we read it (per-season lazy).
  if(pick && typeof coachingSeasonReady==='function' && !coachingSeasonReady(pick)){
    _renderSchemeLoadingShell();
    if(typeof ensureNflverseCoachingSeason==='function'){
      ensureNflverseCoachingSeason(pick).then(()=>{
        if(schemeOverlayOpen && schemeTeam) _renderTeamCoachingScheme();
      });
    }
    return;
  }
  const p = _schemePayload(schemeTeam, pick);
  schemeSeason = p ? p.season : pick;
  if(!p){
    host.innerHTML = `<div class="scheme-overlay" onclick="closeTeamCoachingScheme()">
      <div class="scheme-modal" onclick="event.stopPropagation()">
        <button class="scheme-close" onclick="closeTeamCoachingScheme()" aria-label="Close">✕</button>
        <div class="scheme-head">
          <img src="${NFL_LOGO(schemeTeam)}" class="scheme-team-logo" onerror="this.style.display='none'">
          <div><div class="scheme-title">${teamDisplayName(schemeTeam)} Coaching Scheme</div>
          <div class="scheme-subtitle">No nflverse coaching-scheme payload found for this team.</div></div>
        </div>
      </div>
    </div>`;
    return;
  }

  host.innerHTML = `<div class="scheme-overlay" onclick="closeTeamCoachingScheme()">
    <div class="scheme-modal" onclick="event.stopPropagation()">
      <button class="scheme-close" onclick="closeTeamCoachingScheme()" aria-label="Close">✕</button>
      <div class="scheme-head">
        <img src="${NFL_LOGO(schemeTeam)}" class="scheme-team-logo" onerror="this.style.display='none'">
        <div>
          <div class="scheme-title">${teamDisplayName(schemeTeam)} Coaching Scheme</div>
          <div class="scheme-subtitle">Interactive playsheet · nflverse charting · ${p.season} regular season</div>
          ${_schemeOcCallout(schemeTeam)}
        </div>
      </div>
      <div class="scheme-loading">Loading playsheet template…</div>
      ${seasons.length>1?`<div class="scheme-tabs">${seasons.map(s=>`<button class="scheme-tab ${String(s)===String(schemeSeason)?'active':''}" onclick="setTeamCoachingSchemeSeason('${s}')">Season <span>${s}</span></button>`).join('')}</div>`:''}
    </div>
  </div>`;

  try{
    const tpl = (typeof SCHEME_TEMPLATE_INLINE==='string' && SCHEME_TEMPLATE_INLINE)
      ? SCHEME_TEMPLATE_INLINE
      : '';
    if(!tpl) throw new Error('missing inline template');
    const html = _schemeRenderTemplate(tpl, p);
    const frame = `<iframe class="scheme-frame" title="${escAttr(teamDisplayName(schemeTeam))} coaching playsheet" srcdoc="${escAttr(html)}"></iframe>`;
    const modal = host.querySelector('.scheme-modal');
    if(modal) modal.insertAdjacentHTML('beforeend', frame);
    const loading = host.querySelector('.scheme-loading');
    if(loading) loading.remove();
  }catch(e){
    const loading = host.querySelector('.scheme-loading');
    if(loading){
      loading.outerHTML = `<div class="scheme-subtitle">Unable to render inline coaching playsheet template.</div>`;
    }
  }
}

function openTeamCoachingScheme(team, initialView){
  if(!team) return;
  schemeOverlayOpen = true;
  schemeTeam = team;
  if(initialView && typeof initialView==='object' && initialView.season!=null){
    schemeSeason = String(initialView.season);
  }else{
    schemeSeason = _schemePreferredSeason(team);
  }
  // Coaching-scheme payloads are lazy-loaded per season (triplecrown_seed.coaching.<season>.json)
  // so we only fetch the season being viewed. Load it first (showing a loading shell), then render.
  const want = schemeSeason;
  if(want && typeof ensureNflverseCoachingSeason==='function' && !coachingSeasonReady(want)){
    _renderSchemeLoadingShell();
    ensureNflverseCoachingSeason(want).then(()=>{
      if(schemeOverlayOpen && schemeTeam===team) _renderTeamCoachingScheme();
    });
    return;
  }
  _renderTeamCoachingScheme();
}

// Minimal overlay shell shown while the coaching-scheme sidecar is fetched.
function _renderSchemeLoadingShell(){
  const host = document.getElementById('schemeOverlayHost');
  if(!host || !schemeTeam) return;
  host.innerHTML = `<div class="scheme-overlay" onclick="closeTeamCoachingScheme()">
    <div class="scheme-modal" onclick="event.stopPropagation()">
      <button class="scheme-close" onclick="closeTeamCoachingScheme()" aria-label="Close">✕</button>
      <div class="scheme-head">
        <img src="${NFL_LOGO(schemeTeam)}" class="scheme-team-logo" onerror="this.style.display='none'">
        <div>
          <div class="scheme-title">${teamDisplayName(schemeTeam)} Coaching Scheme</div>
          <div class="scheme-subtitle">Loading coaching-scheme data…</div>
        </div>
      </div>
      <div class="scheme-loading">Loading coaching-scheme data…</div>
    </div>
  </div>`;
}

function closeTeamCoachingScheme(){
  schemeOverlayOpen = false;
  schemeTeam = null;
  schemeSeason = null;
  const host = document.getElementById('schemeOverlayHost');
  if(host) host.innerHTML = '';
}

function setTeamCoachingSchemeSeason(season){
  if(!schemeOverlayOpen || !schemeTeam) return;
  const s = String(season||'');
  if(!s) return;
  schemeSeason = s;
  // Load this season's coaching sidecar on demand before re-rendering.
  if(typeof coachingSeasonReady==='function' && !coachingSeasonReady(s)){
    _renderSchemeLoadingShell();
    if(typeof ensureNflverseCoachingSeason==='function'){
      ensureNflverseCoachingSeason(s).then(()=>{
        if(schemeOverlayOpen && String(schemeSeason)===s) _renderTeamCoachingScheme();
      });
    }
    return;
  }
  _renderTeamCoachingScheme();
}

if(document && document.addEventListener && !_schemeEscBound){
  _schemeEscBound = true;
  document.addEventListener('keydown', e=>{
    if(e && e.key==='Escape' && schemeOverlayOpen) closeTeamCoachingScheme();
  });
}
function renderTeamAdditions(team){
  const a = (ADDITIONS && ADDITIONS[team]) || {};
  // Highlight fantasy-relevant offensive positions (QB/RB/WR/TE) with the same Sleeper-style
  // colors as the Rankings page; leave defensive/other positions neutral so skill players pop.
  const FANTASY_POS = {QB:1, RB:1, WR:1, TE:1};
  const posBadge=(p)=>{
    if(!p) return '';
    const up = String(p).toUpperCase().trim();
    // Some players list multiple (e.g. "RB/WR"); color by the first fantasy pos found.
    const first = up.split(/[\/,\s]+/).find(x=>FANTASY_POS[x]) || up;
    if(FANTASY_POS[first]) return `<span class="pos-badge pos-${first}">${p}</span>`;
    return `<span class="add-pos">${p}</span>`;
  };
  // Free agency + draft share a layout (player, pos, years, value).
  const signingTable=(rows, kind)=>{
    if(!rows||!rows.length) return `<div class="add-empty">No ${kind==='draft'?'draft picks':'free-agent signings'} listed.</div>`;
    const body=rows.map(r=>`<tr>
      <td class="add-player clickable-player" onclick="${pcardOnclick(r.player, r.pos, '')}">${r.player}</td>
      <td>${posBadge(r.pos)}</td>
      <td class="add-num">${r.years!=null?r.years+' yr':'—'}</td>
      <td class="add-num add-val">${fmtMillions(r.value_m)}</td>
      <td class="add-num add-aav">${fmtMillions(r.aav_m)}</td>
    </tr>`).join('');
    return `<div class="add-table-scroll"><table class="add-table"><thead><tr>
      <th class="add-th-player">PLAYER</th><th>POS</th><th class="add-num">TERM</th>
      <th class="add-num">TOTAL</th><th class="add-num">AAV</th></tr></thead><tbody>${body}</tbody></table></div>`;
  };
  const tradeTable=(rows)=>{
    if(!rows||!rows.length) return `<div class="add-empty">No trade acquisitions listed.</div>`;
    const body=rows.map(r=>`<tr>
      <td class="add-player clickable-player" onclick="${pcardOnclick(r.player, r.pos, '')}">${r.player}</td>
      <td>${posBadge(r.pos)}</td>
      <td class="add-num add-val">${fmtMillions(r.cap_m)}</td>
      <td class="add-detail">${r.detail||'—'}</td>
    </tr>`).join('');
    return `<div class="add-table-scroll"><table class="add-table add-trade-table"><thead><tr>
      <th class="add-th-player">PLAYER</th><th>POS</th><th class="add-num">CAP ACQ.</th>
      <th>TRADE DETAIL</th></tr></thead><tbody>${body}</tbody></table></div>`;
  };
  const count=(n)=>`<span class="add-count">${n}</span>`;
  // Free Agents Lost — players who left in free agency, with where they went.
  const lossTable=(rows)=>{
    if(!rows||!rows.length) return `<div class="add-empty">No free agents lost.</div>`;
    const body=rows.map(r=>`<tr>
      <td class="add-player clickable-player" onclick="${pcardOnclick(r.player, r.pos, '')}">${r.player}</td>
      <td>${posBadge(r.pos)}</td>
      <td class="add-dest">${r.to_team?`→ <img src="${NFL_LOGO(r.to_team)}" class="add-dest-logo" onerror="this.style.display='none'"><b>${r.to_team}</b>`:'—'}</td>
      <td class="add-num">${r.years!=null?r.years+' yr':'—'}</td>
      <td class="add-num add-val add-loss-val">${fmtMillions(r.value_m)}</td>
      <td class="add-num add-aav">${fmtMillions(r.aav_m)}</td>
    </tr>`).join('');
    return `<div class="add-table-scroll"><table class="add-table"><thead><tr>
      <th class="add-th-player">PLAYER</th><th>POS</th><th>SIGNED WITH</th>
      <th class="add-num">TERM</th><th class="add-num">TOTAL</th><th class="add-num">AAV</th>
      </tr></thead><tbody>${body}</tbody></table></div>`;
  };
  return `<div class="add-wrap">
    <div class="add-note">🔄 <b>${teamDisplayName(team)}</b> ${PROJ_SEASON} roster changes — additions via free agency, the draft, and trades, plus notable departures. Sorted by contract/cap value. Pair this with the ${SHARP_SEASON} Advanced Stats to see how weaknesses were addressed — and where new holes may have opened.</div>

    <div class="add-section">
      <div class="add-section-head">💰 Free Agency ${count((a.free_agents||[]).length)}</div>
      ${signingTable(a.free_agents,'fa')}
    </div>

    <div class="add-section">
      <div class="add-section-head">🎯 Draft ${count((a.draft||[]).length)}</div>
      ${signingTable(a.draft,'draft')}
    </div>

    <div class="add-section">
      <div class="add-section-head">🔄 Trades ${count((a.trades||[]).length)}</div>
      ${tradeTable(a.trades)}
    </div>

    <div class="add-section add-losses-section">
      <div class="add-section-head">📉 Notable Losses ${count((a.free_agents_lost||[]).length)}</div>
      <div class="add-losses-sub">Free agents who signed elsewhere this offseason.</div>
      ${lossTable(a.free_agents_lost)}
    </div>

    ${renderDepthChart(team)}

    <div class="sr-source">${PROJ_SEASON} offseason moves · depth chart via ESPN · for informational use.</div>
  </div>`;
}

// Per-team advanced view: one card per Sharp table, each showing this team's value + rank.
// Coordinator helpers -------------------------------------------------------
function coordFor(team, side){ return COORDINATORS && COORDINATORS[team] && COORDINATORS[team][side]; }
// A coordinator "carries over" another team's scheme when they're brand-new this season
// AND came from another NFL team. Those get the Coordinators tab.
function coordCarriesOver(c){ return !!(c && c.is_new && !c.internal && c.prev_code); }
// Head-coach history entry (former team/role), from the seed.
function hcHistFor(team){ return HC_HISTORY && HC_HISTORY[team]; }
// When the HEAD COACH is the primary playcaller AND is new this season AND came from another
// NFL team, the OFFENSIVE scheme travels with the HC — so the carryover source is the HC's
// former team, not the OC's. Returns a carryover-source object shaped like a coordinator
// (name, prev_code, prev_role, prev_years) or null.
function playcallerHCOffenseSource(team){
  if(!hcIsPlaycaller(team)) return null;
  const h=hcHistFor(team);
  if(!h) return null;
  if(!(h.is_new && h.prev_code)) return null;   // must be new this season, from another team
  // Guard: if the HC's "former team" is this same team (rare data quirk), no carryover.
  if(h.prev_code===team) return null;
  return { name:h.name||(HC_PLAYCALLERS&&HC_PLAYCALLERS[team])||'Head coach', prev_code:h.prev_code,
           prev_role:h.prev_role||'head coach', prev_years:h.prev_years, is_new:true, internal:false,
           _fromHC:true };
}
function teamHasCarryover(team){
  const o=coordFor(team,'offense'), d=coordFor(team,'defense');
  return coordCarriesOver(o) || coordCarriesOver(d);
}
// Short inline label for a coordinator next to a section head.
function coordInlineLabel(a,b,c){
  // Backward-compatible signature: (coord, sideWord) or (team, coord, sideWord)
  let team = (typeof a==='string' && b && typeof b==='object') ? a : (c || currentTeam);
  const coord = (typeof a==='string' && b && typeof b==='object') ? b : a;
  const sideWord = (typeof a==='string' && b && typeof b==='object') ? c : b;
  // Legacy callers may pass only the coordinator object; infer the team by object identity.
  if(!team && coord && COORDINATORS){
    for(const code in COORDINATORS){
      const row = COORDINATORS[code]||{};
      if(row.offense===coord || row.defense===coord){ team = code; break; }
    }
  }
  const attrs = team
    ? `class="coord-inline scheme-open" role="button" tabindex="0" title="Open coaching scheme visualization" onclick="openTeamCoachingScheme('${team}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openTeamCoachingScheme('${team}');}"`
    : `class="coord-inline"`;
  if(!coord) return '';
  if(!coord.name) return '';
  if(coordCarriesOver(coord)){
    const role = coord.prev_role || 'coordinator';
    return `<span ${attrs}>
      ${sideWord==='offensive'?'OC':'DC'}: <b>${coord.name}</b> <span class="coord-new-tag">NEW · from ${teamDisplayName(coord.prev_code)} ${role}</span></span>`;
  }
  // carryover/internal: last season's stats apply directly
  const since = coord.since?` · since ${coord.since}`:'';
  return `<span ${attrs}>${sideWord==='offensive'?'OC':'DC'}: <b>${coord.name}</b>${since}</span>`;
}

function renderTeamAdvanced(team){
  const hasSharp=sharpHasData(), hasSOS=SOS&&Object.keys(SOS).length>0;
  const hasCoord = COORDINATORS && COORDINATORS[team];
  if(!hasSharp && !hasSOS && !hasCoord){
    return `<div class="empty"><div class="empty-icon">📊</div>
      <div class="empty-title">No advanced stats loaded</div>
      <div class="empty-body">Run <code>build_seed.py</code> and load the 📦 seed to populate advanced team stats.</div></div>`;
  }
  const SRC=activeSharp();
  const cardFor=(key, srcTeam)=>{
    const tbl=SRC[key]; if(!tbl) return '';
    const useTeam = srcTeam||team;
    const row=tbl.teams&&tbl.teams[useTeam];
    if(!row) return `<div class="sr-card"><div class="sr-card-title">${tbl.title||key}</div>
      <div class="sr-empty">No data for ${teamDisplayName(useTeam)}</div></div>`;
    const lines = tbl.columns.map(col=>{
      const v=row.values?row.values[col]:null;
      const r=row.ranks?row.ranks[col]:null;
      return `<div class="sr-stat">
        <div class="sr-stat-label">${col}</div>
        <div class="sr-stat-val">${fmtSharpVal(v, sharpColIsPct(tbl,col))}</div>
        <div class="sr-stat-rank">${sharpRankBadge(r)}</div>
      </div>`;
    }).join('');
    return `<div class="sr-card">
      <div class="sr-card-title">${tbl.title||key}</div>
      <div class="sr-stat-grid">${lines}</div>
    </div>`;
  };
  const keys=Object.keys(SRC);
  const offKeys=keys.filter(k=>(SRC[k].category||'offense')==='offense');
  const defKeys=keys.filter(k=>SRC[k].category==='defense');
  const oc=coordFor(team,'offense'), dc=coordFor(team,'defense');
  const section=(label,ks,coordLbl)=> ks.length ? `<div class="sr-section-head">${label} ${coordLbl||''}</div>
    <div class="sr-card-grid">${ks.map(k=>cardFor(k)).join('')}</div>` : '';
  // SOS summary strip
  const sos=SOS && SOS[team];
  const sosStrip = sos ? `<div class="sr-sos-strip">
    <span class="sr-sos-rank ${sharpRankClass(sos.rank)}">${ordinal(sos.rank)}</span>
    <div><div class="sr-sos-label">${PROJ_SEASON} Strength of Schedule</div>
      <div class="sr-sos-sub">${sos.win_total!=null?`Vegas win total <b>${sos.win_total}</b> · `:''}rank ${sos.rank} of 32 (1 = easiest)</div></div>
    <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="showSharpLeague('sos')">See SOS chart →</button>
  </div>` : '';
  // Carryover coordinators → a highlighted section that pulls the former team's scheme stats.
  const carryBlock = renderCoordinatorCarryover(team, cardFor);
  const srcLabel = 'nflverse (computed from play-by-play)';
  return `<div class="sr-team-wrap">
    <div class="sr-note">📊 <b>Advanced team stats</b> · ${srcLabel} · <b>${SHARP_SEASON} season</b> · league rank out of 32 · read-only reference to inform your ${PROJ_SEASON} decisions.
      <button class="btn btn-ghost btn-sm" style="margin-left:6px" onclick="showSharpLeague()">🌐 View league-wide tables →</button></div>
    ${sosStrip}
    ${carryBlock}
    ${section('🏈 Offense', offKeys, coordInlineLabel(team,oc,'offensive'))}
    ${section('🛡️ Defense', defKeys, coordInlineLabel(team,dc,'defensive'))}
    <div class="sr-source">${SHARP_SEASON} season · computed from nflverse play-by-play (nflfastR) — for informational use.</div>
  </div>`;
}

// The Coordinators carryover block: when a NEW coordinator came from another NFL team, show
// their former team's carry-over scheme stats (tendencies + personnel for OC; tendencies +
// coverage for DC — the aspects that travel with a coordinator), clearly labeled.
function renderCoordinatorCarryover(team, cardFor){
  const SRC=activeSharp();
  const oc=coordFor(team,'offense'), dc=coordFor(team,'defense');
  const blocks=[];
  // OFFENSE: when the head coach is the primary playcaller and is new-from-another-team, the
  // scheme travels with the HC → carry over the HC's former team. Otherwise use the OC.
  const hcSrc = playcallerHCOffenseSource(team);
  const offSrc = hcSrc || (coordCarriesOver(oc) ? oc : null);
  if(offSrc){
    // Offensive scheme travels most in tendencies + personnel.
    const wantTitles=['Tendencies','Personnel'];
    const ks=Object.keys(SRC).filter(k=>(SRC[k].category||'offense')==='offense'
      && wantTitles.some(w=>(SRC[k].title||'').toLowerCase().includes(w.toLowerCase())));
    blocks.push(coordCarryCard('offensive', offSrc, ks, cardFor));
  }
  if(coordCarriesOver(dc)){
    // Defensive scheme travels most in tendencies + coverage SCHEMES (not the
    // coverage-by-position table, which is more about personnel matchups than scheme).
    const wantTitles=['Tendencies','Coverage'];
    const ks=Object.keys(SRC).filter(k=>{
      if(SRC[k].category!=='defense') return false;
      const title=(SRC[k].title||'').toLowerCase();
      if(title.includes('by position')) return false;   // exclude Coverage by Position
      return wantTitles.some(w=>title.includes(w.toLowerCase()));
    });
    blocks.push(coordCarryCard('defensive', dc, ks, cardFor));
  }
  if(!blocks.length) return '';
  return `<div class="coord-carry-wrap">
    <div class="coord-carry-head">🔄 New coordinator scheme carryover</div>
    <div class="coord-carry-note">A brand-new coordinator arrived for ${PROJ_SEASON}. Below are their <b>former team's</b> ${SHARP_SEASON} scheme stats — the tendencies &amp; personnel that tend to travel with a coordinator. Use as a forecast for how this unit may shift.</div>
    ${blocks.join('')}
  </div>`;
}
function coordCarryCard(sideWord, c, ks, cardFor){
  const SRC=activeSharp();
  const from = teamDisplayName(c.prev_code);
  const roleNote = c.prev_role
    ? `previously <b>${from} ${c.prev_role}</b>${c.prev_years?` (${c.prev_years})`:''}`
    : `previously with <b>${from}</b>`;
  const cards = ks.length ? ks.map(k=>cardFor(k, c.prev_code)).join('')
    : `<div class="sr-empty">No carry-over tables available for ${from}.</div>`;
  // When the offensive source is a play-calling head coach, label it as such (the scheme
  // follows the HC, not the OC).
  const badge = c._fromHC ? '🎧 New play-calling HC'
    : (sideWord==='offensive' ? '🏈 New OC' : '🛡️ New DC');
  const schemeOwner = c._fromHC ? 'play-calling head coach' : `${sideWord} coordinator`;
  return `<div class="coord-carry-block">
    <div class="coord-carry-title">
      <span class="coord-side">${badge}</span>
      <b>${c.name||'(name unavailable)'}</b> — ${roleNote}
    </div>
    <div class="coord-carry-sub">Showing ${from}'s ${SHARP_SEASON} ${sideWord} scheme (${ks.map(k=>SRC[k].title).join(' · ')||'—'}) — the tendencies &amp; personnel that travel with a ${schemeOwner}:</div>
    <div class="sr-card-grid">${cards}</div>
  </div>`;
}

// League-wide advanced view: pick a table, see all 32 teams, sortable by any column.
async function showSharpLeague(target){
  rankScope='all'; currentPhase='AdvancedLeague';
  if(target==='sos'){ sharpTable='__sos__'; sharpSortCol=null; sharpSortDir=1; }
  // Render immediately. Opponent win totals are baked into the seed; when they aren't (older
  // seed), renderSOSView() itself kicks off the schedule fetch in the background and re-renders
  // on arrival — so we never block the SOS view on a network round-trip.
  renderContent();
}
function setSharpTable(key){ sharpTable=key; sharpSortCol=null; renderSharpLeague(); }
function setSharpCategory(cat){
  sharpCategory=cat;
  // Jump to the first table in the newly selected category.
  const SRC=activeSharp();
  const keys=Object.keys(SRC).filter(k=>(SRC[k].category||'offense')===cat);
  if(keys.length){ sharpTable=keys[0]; sharpSortCol=null; }
  renderSharpLeague();
}
function sortSharpBy(col){
  if(sharpSortCol===col){ sharpSortDir*=-1; } else { sharpSortCol=col; sharpSortDir=1; }
  renderSharpLeague();
}
function renderSharpLeague(){
  const host=document.getElementById('content'); if(!host) return;
  const SRC=activeSharp();
  const hasSharp=sharpHasData(), hasSOS=SOS&&Object.keys(SOS).length>0;
  if(!hasSharp && !hasSOS){
    host.innerHTML=`<div class="phase-tabs">${tabBar()}</div>
      <div class="empty"><div class="empty-icon">📊</div><div class="empty-title">No advanced stats loaded</div>
      <div class="empty-body">Run <code>build_seed.py</code> and load the 📦 seed.</div></div>`;
    return;
  }
  const srcLabel = `nflverse (computed)`;
  const headerBar=`
    <div class="team-header sr-league-header">
      <div><div class="team-abbr">📊 Advanced Stats — League-Wide</div>
        <div class="team-qb-name">${srcLabel} · <b>${SHARP_SEASON} season</b> · click any column to sort (best→worst)</div></div>
      <div class="team-nav">
        ${currentTeam?`<button class="btn btn-ghost" onclick="setPhase('Advanced')">← ${teamDisplayName(currentTeam)} card</button>`:''}
        <button class="btn btn-ghost" onclick="setPhase('Rankings')">🏆 Rankings</button></div>
    </div>
    <div class="phase-tabs">${tabBar()}</div>`;

  // The SOS view is its own "table" selection.
  if(sharpTable==='__sos__' && hasSOS){
    host.innerHTML = headerBar + renderCategoryTabs() + renderSOSView();
    return;
  }

  const keys=Object.keys(SRC).filter(k=>(SRC[k].category||'offense')===sharpCategory);
  if(!sharpTable || sharpTable==='__sos__' || !SRC[sharpTable] || (SRC[sharpTable].category||'offense')!==sharpCategory){
    sharpTable = keys[0];
  }
  if(!sharpTable){ // no tables in this category
    host.innerHTML = headerBar + renderCategoryTabs() + `<div class="sr-desc">No tables in this category.</div>`;
    return;
  }
  const tbl=SRC[sharpTable];
  const cols=tbl.columns;
  let rows=Object.keys(tbl.teams).map(code=>({code, ...tbl.teams[code]}));
  const sortCol = sharpSortCol || cols[0];
  rows.sort((a,b)=>{
    const ra=a.ranks?a.ranks[sortCol]:null, rb=b.ranks?b.ranks[sortCol]:null;
    if(ra==null && rb==null) return 0;
    if(ra==null) return 1;
    if(rb==null) return -1;
    return (ra-rb)*sharpSortDir;
  });
  const tableTabs = keys.map(k=>`<button class="sr-tab ${k===sharpTable?'active':''}" onclick="setSharpTable('${k}')">${SRC[k].title||k}</button>`).join('');
  const head = `<th class="sr-th-team">TEAM</th>`+cols.map(c=>{
    const active = c===sortCol;
    const arrow = active ? (sharpSortDir>0?' ▲':' ▼') : '';
    return `<th class="sr-th ${active?'active':''}" onclick="sortSharpBy('${c.replace(/'/g,"\\'")}')" title="Sort by ${c}">${c}${arrow}</th>`;
  }).join('');
  const body = rows.map(r=>{
    const cells = cols.map(c=>{
      const v=r.values?r.values[c]:null, rk=r.ranks?r.ranks[c]:null;
      return `<td class="sr-td ${sharpRankClass(rk)}"><span class="sr-td-val">${fmtSharpVal(v, sharpColIsPct(tbl,c))}</span><span class="sr-td-rank">${rk!=null?rk:''}</span></td>`;
    }).join('');
    return `<tr><td class="sr-td-team"><span class="sr-td-team-inner"><img src="${NFL_LOGO(r.code)}" class="sr-logo" onerror="this.style.display='none'">${r.code}</span></td>${cells}</tr>`;
  }).join('');
  host.innerHTML = headerBar + renderCategoryTabs() + `
    <div class="sr-league-tabs">${tableTabs}</div>
    <div class="sr-desc">${tbl.title} · <b>${SHARP_SEASON} season</b> — all 32 teams. Cell shows the stat value with its league rank; color = quartile (green best → red worst).</div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table class="sr-league-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </div>
    <div class="sr-source">Computed from nflverse play-by-play (nflfastR).</div>`;
}

// Offense / Defense / SOS category selector row for the league-wide view.
function renderCategoryTabs(){
  const SRC=activeSharp();
  const hasOff=Object.keys(SRC).some(k=>(SRC[k].category||'offense')==='offense');
  const hasDef=Object.keys(SRC).some(k=>SRC[k].category==='defense');
  const hasSOS=SOS&&Object.keys(SOS).length>0;
  const isSOS = sharpTable==='__sos__';
  const btn=(cat,label,active,onclick)=>`<button class="sr-cat ${active?'active':''}" onclick="${onclick}">${label}</button>`;
  let out='<div class="sr-cat-row">';
  if(hasOff) out+=btn('offense','🏈 Offense', !isSOS && sharpCategory==='offense', "setSharpCategory('offense')");
  if(hasDef) out+=btn('defense','🛡️ Defense', !isSOS && sharpCategory==='defense', "setSharpCategory('defense')");
  if(hasSOS) out+=btn('sos','📅 Strength of Schedule', isSOS, "showSharpLeague('sos')");
  out+='</div>';
  return out;
}

// The Strength-of-Schedule view: a recreation of Sharp's descending-diagonal chart
// (easiest at top-left → hardest at bottom-right, split by the league-average line),
// plus the full sortable table beneath it.
function renderSOSView(){
  const entries=Object.keys(SOS).map(code=>({code, ...SOS[code]})).filter(e=>e.rank!=null||SOS[code].opp_win_total!=null);
  const n=entries.length||32;

  // Opponent win-total sum drives OUR ranking. Prefer the value baked into the seed; only when it
  // is absent (older seed) do we fetch each team's schedule live and sum it in the browser.
  const baked = entries.length>0 && entries.every(e=>e.opp_win_total!=null);
  if(!baked && !_sosSchedLoading && !_sosSchedLoaded){
    _sosSchedLoading=true;
    Promise.all(entries.map(e=>fetchTeamSchedule(e.code))).then(()=>{
      _sosSchedLoaded=true; _sosSchedLoading=false;
      if(currentPhase==='AdvancedLeague' && sharpTable==='sos') renderContent();
    }).catch(()=>{ _sosSchedLoading=false; });
  }

  // Attach each team's summed-opponent-win-total (baked, else live).
  let haveOppData=false, minT=Infinity, maxT=-Infinity;
  entries.forEach(e=>{
    if(e.opp_win_total!=null){ e.oppTotal=e.opp_win_total; e.oppGames=e.opp_games||17; }
    else { const o=opponentWinTotal(e.code); e.oppTotal=o?o.total:null; e.oppGames=o?o.games:0; }
    if(e.oppTotal!=null){ haveOppData=true; if(e.oppTotal<minT)minT=e.oppTotal; if(e.oppTotal>maxT)maxT=e.oppTotal; }
  });
  // OUR ranking: sort by summed opponent win total ascending (1 = easiest slate). Overrides any
  // scraped rank once every team has an opponent total; until then the existing order stands.
  if(entries.every(e=>e.oppTotal!=null)){
    entries.slice().sort((a,b)=>a.oppTotal-b.oppTotal).forEach((e,i)=>{ e.rank=i+1; });
  }
  entries.sort((a,b)=>a.rank-b.rank);

  // Chart geometry
  const W=920, H=430, padL=30, padR=30, padT=52, padB=30;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const x=(rank)=> padL + (plotW*(rank-1)/(n-1));
  // Y by rank (fallback, straight diagonal) until opponent sums are in.
  const yByRank=(rank)=> padT + (plotH*(rank-1)/(n-1));
  // Y by summed opponent win total: HIGHEST total (hardest) at the BOTTOM, lowest at top.
  // Falls back to the rank position for any team missing opponent data (keeps it where the
  // straight-line placement would have put it, per design).
  const span = (maxT>minT) ? (maxT-minT) : 1;
  // Y by summed opponent win total: hardest (max total) at the BOTTOM, easiest at top.
  // Teams missing opponent data fall back to their rank-diagonal position (kept in place).
  const yHard=(e)=> (e.oppTotal==null) ? yByRank(e.rank)
                   : padT + plotH*( (e.oppTotal - minT) / span );
  const useArc = haveOppData;
  const y=(e)=> useArc ? yHard(e) : yByRank(e.rank);

  const midY = padT + plotH/2;
  const logos=entries.map(e=>{
    const cx=x(e.rank), cy=y(e);
    const oppNote = e.oppTotal!=null ? ` · opp win total ${e.oppTotal.toFixed(1)}${e.oppGames<17?` (${e.oppGames} tracked)`:''}` : '';
    return `<image href="${NFL_LOGO(e.code)}" x="${cx-13}" y="${cy-13}" width="26" height="26">
      <title>${e.name||e.code} — SOS ${ordinal(e.rank)}, Vegas win total ${e.win_total}${oppNote}</title></image>
      <text x="${cx}" y="${cy+22}" class="sos-rank-lbl" text-anchor="middle">${e.rank}</text>`;
  }).join('');
  const subline = useArc
    ? `Height = sum of opponents' Vegas win totals · easier slate (top) → harder slate (bottom)`
    : (_sosSchedLoading ? `Loading opponent schedules…` : `Based on Vegas Forecasted Win Totals · easiest (1) → hardest (${n})`);
  const chart=`<svg viewBox="0 0 ${W} ${H}" class="sos-chart" preserveAspectRatio="xMidYMid meet">
    <rect x="${padL}" y="${padT}" width="${plotW}" height="${midY-padT}" class="sos-band-easy"/>
    <rect x="${padL}" y="${midY}" width="${plotW}" height="${padT+plotH-midY}" class="sos-band-hard"/>
    <line x1="${padL}" y1="${midY}" x2="${padL+plotW}" y2="${midY}" class="sos-midline"/>
    <text x="${padL+plotW-4}" y="${midY-6}" class="sos-band-lbl" text-anchor="end">EASIER SLATE ▲</text>
    <text x="${padL+plotW-4}" y="${midY+16}" class="sos-band-lbl" text-anchor="end">HARDER SLATE ▼</text>
    <text x="${padL}" y="34" class="sos-title">${PROJ_SEASON} NFL Strength of Schedule</text>
    <text x="${padL}" y="48" class="sos-sub">${subline}</text>
    ${logos}
  </svg>`;
  // Table beneath
  let sortDir=sharpSortDir;
  const sortCol=sharpSortCol||'rank';
  const rows=entries.slice().sort((a,b)=>{
    let av,bv;
    if(sortCol==='win_total'){ av=a.win_total; bv=b.win_total; }
    else if(sortCol==='opp'){ av=a.oppTotal; bv=b.oppTotal; }
    else { av=a.rank; bv=b.rank; }
    if(av==null&&bv==null)return 0; if(av==null)return 1; if(bv==null)return -1;
    return (av-bv)*sortDir;
  });
  const th=(col,label)=>{
    const active=sortCol===col; const arrow=active?(sortDir>0?' ▲':' ▼'):'';
    return `<th class="sr-th ${active?'active':''}" onclick="sortSOSBy('${col}')">${label}${arrow}</th>`;
  };
  const body=rows.map(e=>`<tr>
    <td class="sr-td-team"><span class="sr-td-team-inner"><img src="${NFL_LOGO(e.code)}" class="sr-logo" onerror="this.style.display='none'">${teamDisplayName(e.code)}</span></td>
    <td class="sr-td ${sharpRankClass(e.rank)}"><span class="sr-td-val">${ordinal(e.rank)}</span></td>
    <td class="sr-td"><span class="sr-td-val">${e.oppTotal!=null?e.oppTotal.toFixed(1):'—'}</span></td>
    <td class="sr-td"><span class="sr-td-val">${e.win_total!=null?e.win_total:'—'}</span></td>
  </tr>`).join('');
  return `<div class="sr-desc">${PROJ_SEASON} strength of schedule — our own ranking by the <b>sum of each team's opponents' Vegas win totals</b>. Rank 1 = easiest slate, ${n} = hardest.</div>
    <div class="card sos-card">${chart}</div>
    <div class="card" style="padding:0;overflow-x:auto;margin-top:12px">
      <table class="sr-league-table sos-table"><thead><tr>
        <th class="sr-th-team">TEAM</th>${th('rank',PROJ_SEASON+' SOS RANK')}${th('opp','OPP WIN TOTAL')}${th('win_total','VEGAS WIN TOTAL')}
      </tr></thead><tbody>${body}</tbody></table>
    </div>
    <div class="sr-source">Rank = sum of opponents' ${PROJ_SEASON} Vegas win totals · schedule via nflverse — for informational use.</div>`;
}
function sortSOSBy(col){
  if(sharpSortCol===col){ sharpSortDir*=-1; } else { sharpSortCol=col; sharpSortDir=1; }
  renderSharpLeague();
}


function renderRankings(){
  let all=buildPlayerList();
  // Team-scoped rankings (from a team's Rankings tab) show only that team's players.
  const teamScoped = (rankScope==='team' && currentTeam);
  if(teamScoped) all=all.filter(p=>p.team===currentTeam);
  if(!all.length){document.getElementById('content').innerHTML=
    `<div class="phase-tabs">${tabBar()}</div><div class="empty"><div class="empty-icon">🏆</div>
     <div class="empty-title">No projections yet</div><div class="empty-body">Set at least one team's stats to see rankings.</div></div>`;return;}
  // Overall order is by fantasy points (your projections). ECR/tier come from FantasyPros.
  all.sort((a,b)=>b.fpts-a.fpts);
  all.forEach((p,i)=>{ p.overall=i+1; });
  // live draft: mark drafted players
  const following = !!draftId;
  all.forEach(p=>{ p.drafted = following && !!draftedIds[p.player_id]; });
  let view=rankPosFilter==='ALL'?all
    :rankPosFilter==='FLEX'?all.filter(p=>p.pos!=='QB')
    :all.filter(p=>p.pos===rankPosFilter);
  if(following && hideDrafted) view=view.filter(p=>!p.drafted);
  view=[...view].sort((a,b)=>{
    if(rankSortKey==='ecr'){
      // Unranked players sort to the bottom regardless of direction.
      const av=a.ecr==null?99999:a.ecr, bv=b.ecr==null?99999:b.ecr;
      return (av-bv)*(rankSortDir<0?1:-1);
    }
    if(rankSortKey==='name') return a.name.localeCompare(b.name)*(rankSortDir<0?1:-1);
    if(rankSortKey==='team') return a.team.localeCompare(b.team)*(rankSortDir<0?1:-1);
    if(rankSortKey==='pos') return (({QB:1,RB:2,WR:3,TE:4})[a.pos]-({QB:1,RB:2,WR:3,TE:4})[b.pos])*(rankSortDir<0?1:-1)||b.fpts-a.fpts;
    // Contract columns: players with no contract data always sort to the bottom.
    if(rankSortKey==='age'||rankSortKey==='apy'||rankSortKey==='fa'){
      const av=a[rankSortKey], bv=b[rankSortKey];
      if(av==null && bv==null) return b.fpts-a.fpts;
      if(av==null) return 1;
      if(bv==null) return -1;
      return (av-bv)*(rankSortDir<0?1:-1);
    }
    // SumerSports advanced columns (key "sumer:<label>"): players missing that stat sink.
    if(rankSortKey.startsWith('sumer:')){
      const label=rankSortKey.slice(6);
      const av=sumerValue(a,label), bv=sumerValue(b,label);
      const an=(typeof av==='number'), bn=(typeof bv==='number');
      if(!an && !bn) return b.fpts-a.fpts;
      if(!an) return 1;
      if(!bn) return -1;
      return (bv-av)*(rankSortDir<0?1:-1);   // default high→low
    }
    return ((b[rankSortKey]||0)-(a[rankSortKey]||0))*(rankSortDir<0?1:-1);
  });
  const tierC=['','var(--accent)','var(--info)','var(--warn)','var(--danger)','var(--muted)','#8b7cff','#6ad1c4'];
  const tierColor=t=>t?tierC[Math.min(t,7)]:'var(--border)';
  // Two-line header helper. `grp` adds a left border to mark a stat group's start.
  const th=(k,l1,l2,cls,grp)=>{const a=rankSortKey===k;
    return `<th onclick="rankSort('${k}')" class="${cls||''} ${grp?'grp-start':''}" style="${a?'color:var(--accent)':''}">
      <div class="th-stack">${l1}${l2?`<br>${l2}`:''}${a?(rankSortDir<0?' ↓':' ↑'):''}</div></th>`;};
  // Dynasty tab only: three extra columns (Age / APY / Free-Agency year) right after TM.
  // FA is highlighted red when it's the very next season (contracts expiring soonest).
  const isDynasty = rankFormat==='dynasty' || rankFormat==='dynasty_superflex';
  const nextYear = PROJ_SEASON + 1;
  // Advanced (SumerSports) view: reference-season only. When active, the rush/rec/pass stat
  // columns are replaced by this season's Sumer metrics for the selected position (or the
  // columns common to the positions in view for ALL/FLEX). Falls back to standard silently
  // if there's no usable column set.
  // Situational split is only meaningful on the Adv. Metrics view; drop a stale selection that
  // the current season/position no longer offers so the table + dropdown stay in sync.
  if(rankAdvanced && sumerRefinement && !sumerRefinementsForFilter().includes(sumerRefinement)) sumerRefinement=null;
  const sumerView = (rankAdvanced && sumerAvailable()) ? sumerColumnsForFilter() : null;
  const advActive = !!sumerView;
  const nStatCols = advActive ? sumerView.cols.length : 12;
  // Two-line-ify a Sumer column label so headers stack like the standard ones.
  const sumerHead = (label)=>{ const t=label.split(' '); return t.length>1 ? `${t.slice(0,-1).join(' ')}<br>${t[t.length-1]}` : label; };
  // Adv. Metrics minimum-volume filter: hide small-sample players (below the Plays/Routes/Rushes
  // floor for their position) so rate stats stay meaningful. Applied after sorting.
  if(advActive){
    view = view.filter(p=>{
      const min = sumerMin[sumerBucket(p.pos)]||0;
      if(min<=0) return true;
      const v = sumerValue(p, sumerVolCol(p.pos));
      return typeof v==='number' && v>=min;
    });
  }
  // Projected-pick lines: when following a draft with a known seat and the board is in draft
  // order (sorted by ECR). This is *especially* useful with "hide drafted" on, since the board
  // then shows only available players and the line marks exactly how far down your pick lands.
  const inDraftOrder = rankSortKey==='ecr';
  const showPickLines = following && mySlot!=null && inDraftOrder;
  let pickGaps=[];   // successive counts of players between your turns
  if(showPickLines){
    const { teams, type, reversalRound, rounds } = draftParams();
    const start = currentPickNo();
    const maxPick = teams*rounds;
    // gaps: from now, how many other picks between each of your turns
    let prev=start-1;
    for(let n=start; n<=maxPick; n++){
      if(slotOnClock(n, teams, type, reversalRound)===mySlot){
        pickGaps.push(n-prev-1);   // players taken by others before this, your turn
        prev=n;
        if(pickGaps.length>=rounds) break;
      }
    }
  }
  const totalCols = 7 + (isDynasty?3:0) + nStatCols;  // ecr,tier,fpts,vor,pos,name,tm + stat cols
  const pickLineRow=(round)=>`<tr class="rank-pickline"><td colspan="${totalCols}">
    <span class="rank-pickline-lbl">▸ Your pick ${round==1?'(next up)':`#${round}`} projected here</span></td></tr>`;

  let undraftedSeen=0, nextGapIdx=0, gapRemaining=(pickGaps[0]!=null?pickGaps[0]:-1);
  const rowChunks=[];
  view.forEach(p=>{
    // emit a pick line right before the player who'd fall to your pick
    if(showPickLines && nextGapIdx<pickGaps.length && !p.drafted && undraftedSeen===gapRemaining){
      rowChunks.push(pickLineRow(nextGapIdx+1));
      nextGapIdx++;
      undraftedSeen=0;
      gapRemaining=(pickGaps[nextGapIdx]!=null?pickGaps[nextGapIdx]:-1);
    }
    const ecrTxt = p.ecr!=null ? p.ecr : '—';
    const tier = p.ecr_tier;
    const ypc = p.ypc>0 ? p.ypc.toFixed(1) : '';
    let contractCells='';
    if(isDynasty){
      const ageTxt = p.age!=null ? p.age : '';
      const apyTxt = p.apy!=null ? fmtAPY(p.apy) : '';
      const faTxt = p.fa!=null ? p.fa : '';
      const faSoon = p.fa!=null && p.fa===nextYear;   // hits free agency next season
      contractCells =
        `<td class="c-age">${ageTxt?`<span class="num">${ageTxt}</span>`:''}</td>`+
        `<td class="c-apy">${apyTxt?`<span class="num">${apyTxt}</span>`:''}</td>`+
        `<td class="c-fa ${faSoon?'fa-soon':''}">${faTxt?`<span class="num">${faTxt}</span>`:''}</td>`;
    }
    // Stat cells: standard rush/rec/pass groups, or SumerSports advanced columns when active.
    let statCells;
    if(advActive){
      statCells = sumerView.cols.map((label,ci)=>{
        const v=sumerValue(p,label);
        const isPct=sumerView.pct.has(label);
        return `<td class="grp-adv${ci===0?' grp-start':''}">${v==null?'':`<span class="num">${fmtSumer(v,isPct)}</span>`}</td>`;
      }).join('');
    } else {
      statCells =
        `<td class="grp-rush">${cell(p.rushing_attempts)}</td><td class="grp-rush-mid">${cell(p.rushing_yards)}</td><td class="grp-rush-mid">${ypc?`<span class="num">${ypc}</span>`:''}</td><td class="grp-rush-end">${cell(p.rushing_tds)}</td>`+
        `<td class="grp-rec">${cell(p.receiving_targets)}</td><td class="grp-rec-mid">${cell(p.receptions)}</td><td class="grp-rec-mid">${cell(p.receiving_yards)}</td><td class="grp-rec-end">${cell(p.receiving_tds)}</td>`+
        `<td class="grp-pass">${cell(p.passing_attempts)}</td><td class="grp-pass-mid">${cell(p.passing_yards)}</td><td class="grp-pass-mid">${cell(p.passing_tds)}</td><td class="grp-pass-end">${cell(p.interceptions_thrown)}</td>`;
    }
    rowChunks.push(`<tr class="${p.drafted?'drafted':''}">
    <td class="c-ecr">${ecrTxt}</td>
    <td class="c-tier">${tier!=null?`<span class="tier-pill" style="background:${tierColor(tier)}">${tier}</span>`:''}</td>
    <td class="fpts">${p.fpts.toFixed(1)}</td>
    <td class="c-vor"><span class="vor-val ${p.vor>0?'vor-pos':p.vor<0?'vor-neg':''}">${p.vor>0?'+':''}${p.vor!=null?p.vor.toFixed(1):'—'}</span></td>
    <td><span class="pos-badge pos-${p.pos}">${p.pos}</span></td>
    <td class="c-player"><div class="clickable-player" style="display:flex;align-items:center;gap:6px" onclick="${pcardOnclick(p.player_id||p.name, p.pos, p.team||'')}">${imgTag(hsURL(p),'rank-hs','🏈')}<span class="rank-name">${p.name}</span></div></td>
    <td class="c-team"><img src="${NFL_LOGO(p.team)}" class="rank-logo" onerror="this.style.display='none'"> ${p.team}</td>
    ${contractCells}
    ${statCells}
  </tr>`);
    if(!p.drafted) undraftedSeen++;
  });
  const rows=rowChunks.join('');
  // Two-axis format picker: league TYPE (redraft/dynasty) + SCORING (std/half/full/superflex).
  const curType=leagueTypeOf(rankFormat);
  const curScoring=scoringAxis;   // source of truth for the scoring buttons (independent of rankFormat)
  const typeBtns=[['redraft','Re-Draft'],['dynasty','Dynasty']]
    .map(([t,l])=>`<button class="ltype-btn ${curType===t?'active':''}" onclick="setLeagueType('${t}')">${l}</button>`).join('');
  const scoringList=[['std','Standard'],['half_ppr','Half PPR'],['ppr','Full PPR'],['superflex','Superflex']];
  const fmtBtns=scoringList
    .map(([s,l])=>`<button class="format-btn ${curScoring===s?'active':''}" onclick="setScoringAxis('${s}')">${l}</button>`).join('');
  const posBtns=['ALL','QB','RB','WR','TE','FLEX'].map(pos=>
    `<button class="pos-filter-btn ${rankPosFilter===pos?'active':''}" onclick="setPosFilter('${pos}')">${pos}</button>`).join('');
  // Advanced-metrics toggle — only on a reference season nflverse has player data for
  // (2022-2025). Switches the stat columns to advanced per-player metrics (computed from
  // nflverse play-by-play; SumerSports was retired as a source).
  const sumerOn = sumerAvailable();
  const advToggle = sumerOn
    ? `<span style="font-size:11px;color:var(--muted);font-weight:700;margin-left:8px">STATS</span>
       <div class="format-toggle">
         <button class="format-btn ${!rankAdvanced?'active':''}" onclick="setRankAdvanced(false)">Standard</button>
         <button class="format-btn ${rankAdvanced?'active':''}" onclick="setRankAdvanced(true)" title="nflverse advanced ${sumerSeasonKey()} metrics">Adv. Metrics</button>
       </div>`
    : '';
  const minInputs = advActive ? sumerMinInputs() : '';
  // "Situational" dropdown — Adv. Metrics only. Swaps the stat columns to a game-situation
  // split (Red Zone / When Trailing / vs. Man / per-down / box counts …) for the season.
  const refineOpts = advActive ? sumerRefinementsForFilter() : [];
  const situationalSelect = (advActive && refineOpts.length)
    ? `<span style="font-size:11px;color:var(--muted);font-weight:700;margin-left:8px">SITUATIONAL</span>
       <select class="sumer-situational" onchange="setSumerRefinement(this.value)" title="Filter Adv. Metrics by game situation">
         <option value=""${!sumerRefinement?' selected':''}>Standard</option>
         ${refineOpts.map(r=>`<option value="${r}"${sumerRefinement===r?' selected':''}>${SUMER_REFINE_LABELS[r]||r}</option>`).join('')}
       </select>`
    : '';
  const advNote = advActive
    ? `<span class="ecr-missing" style="color:var(--muted)">📊 nflverse advanced ${sumerSeasonKey()} stats${sumerRefinement?` · ${SUMER_REFINE_LABELS[sumerRefinement]||sumerRefinement}`:''}${sumerView.single?'':' · common columns (pick a position for the full set)'}${((sumerRefinement==='vs_man'||sumerRefinement==='vs_zone'))?' · coverage counts approximate, rates accurate':''}</span>`
    : '';
  const ecrNote = hasECR() ? '' : `<span class="ecr-missing">⚠ No FantasyPros ECR loaded — run build_seed.py and load the 📦 seed to populate ECR/Tier</span>`;
  document.getElementById('content').innerHTML=`
    <div class="phase-tabs">${tabBar()}</div>
    <div class="rankings-scope-bar">
      ${teamScoped
        ? `<span class="scope-title">🏆 ${currentTeam} Rankings</span><span class="scope-sub">this team only</span>
           <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="showFullRankings()">View full league →</button>`
        : `<span class="scope-title">🏆 Full League Rankings</span><span class="scope-sub">all ${all.length} players</span>`}
    </div>
    <div class="card" style="margin-bottom:12px">
      <div class="card-title" style="margin-bottom:10px">Scoring Settings
        <button class="btn btn-accent btn-sm" style="margin-left:auto" onclick="recalcRankings()">Recalculate</button></div>
      <div class="scoring-grid">
        <div class="scoring-field"><label>PASS YDS / POINT</label><input id="sc_pass_yds_ydg" type="number" value="${scoringSettings.passing_yards_yardage}" step="1"></div>
        <div class="scoring-field"><label>PASS TD PTS</label><input id="sc_pass_td" type="number" value="${scoringSettings.passing_touchdowns}" step="0.5"></div>
        <div class="scoring-field"><label>INT PTS</label><input id="sc_int" type="number" value="${scoringSettings.interceptions_thrown}" step="0.5"></div>
        <div class="scoring-field"><label>RUSH YDS / POINT</label><input id="sc_rush_yds_ydg" type="number" value="${scoringSettings.rushing_yards_yardage}" step="1"></div>
        <div class="scoring-field"><label>RUSH TD PTS</label><input id="sc_rush_td" type="number" value="${scoringSettings.rushing_touchdowns}" step="0.5"></div>
        <div class="scoring-field"><label>REC YDS / POINT</label><input id="sc_rec_yds_ydg" type="number" value="${scoringSettings.receiving_yards_yardage}" step="1"></div>
        <div class="scoring-field"><label>REC TD PTS</label><input id="sc_rec_td" type="number" value="${scoringSettings.receiving_touchdowns}" step="0.5"></div>
        <div class="scoring-field"><label>RECEPTION PTS (PPR)</label><input id="sc_rec" type="number" value="${scoringSettings.receptions}" step="0.25"></div>
        <div class="scoring-field"><label>FUMBLE LOST PTS</label><input id="sc_fum" type="number" value="${scoringSettings.fumbles_lost}" step="0.5"></div>
        <div class="scoring-field"><label>PASS ATT PTS</label><input id="sc_pass_att" type="number" value="${scoringSettings.passing_attempts}" step="0.1"></div>
        <div class="scoring-field"><label>PASS COMP PTS</label><input id="sc_pass_comp" type="number" value="${scoringSettings.passing_completions}" step="0.1"></div>
        <div class="scoring-field"><label>RUSH ATT PTS</label><input id="sc_rush_att" type="number" value="${scoringSettings.rushing_attempts}" step="0.1"></div>
      </div>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      ${following ? `<div style="padding:8px 14px;border-bottom:1px solid var(--border)">
        <div class="draft-banner">
          <span class="draft-live">LIVE</span>
          <span>Following draft <b>${draftId}</b> · ${Object.keys(draftedIds).length} picks made</span>
          ${(mySlot!=null)?(()=>{const u=picksUntilMyTurn(mySlot);return u===0?`<span class="draft-onclock">★ YOU'RE ON THE CLOCK</span>`:u!=null?`<span class="draft-upturn">seat ${mySlot} · ${u} pick${u===1?'':'s'} until you're up</span>`:`<span class="draft-upturn">seat ${mySlot}</span>`;})():`<span class="draft-upturn">tap your seat in the bar below ↓</span>`}
          <label style="display:flex;align-items:center;gap:5px;cursor:pointer;margin-left:8px">
            <input type="checkbox" ${hideDrafted?'checked':''} onchange="toggleHideDrafted()"> hide drafted</label>
          <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="stopDraftFollow()">Stop</button>
        </div></div>` : ''}
      ${(!following && leaguePickerState.open) ? renderLeaguePicker() : ''}
      <div style="padding:11px 14px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border);flex-wrap:wrap">
        <span style="font-size:11px;color:var(--muted);font-weight:700">LEAGUE</span>
        <div class="ltype-toggle">${typeBtns}</div>
        <span style="font-size:11px;color:var(--muted);font-weight:700;margin-left:8px">SCORING (ECR)</span>
        <div class="format-toggle">${fmtBtns}</div>
        <span style="font-size:11px;color:var(--muted);font-weight:700;margin-left:8px">POSITION</span>
        <div class="pos-filter">${posBtns}</div>
        ${advToggle}
        ${situationalSelect}
        ${minInputs}
        ${advNote}
        ${ecrNote}
        <span style="font-size:11px;font-weight:700;margin-left:auto">${view.length} players</span>
        ${following?'':`<button class="btn btn-accent btn-sm" onclick="openLeaguePicker()">🔗 Link Sleeper League</button>
        <button class="btn btn-ghost btn-sm" onclick="promptDraftFollow()" title="Follow a live or mock draft by its ID">Paste draft ID</button>`}
        <button class="btn btn-ghost btn-sm" onclick="exportRankingsCSV()">⬇ CSV</button>
      </div>
      <div class="rank-table-wrap" style="max-height:calc(100vh - 320px)">
      <table class="rankings-table grouped"><thead><tr>
        ${th('ecr','ECR','','c-ecr')}${th('ecr_tier','TIER','','c-tier')}${th('fpts','FPTS','')}${th('vor','VOR','','c-vor')}
        ${th('pos','POS','')}${th('name','PLAYER','','c-player')}${th('team','TM','','c-team')}
        ${isDynasty?`${th('age','AGE','','c-age',true)}${th('apy','APY','','c-apy')}${th('fa','FA','','c-fa')}`:''}
        ${advActive
          ? sumerView.cols.map((label,ci)=>{const key='sumer:'+label;const on=rankSortKey===key;
              return `<th onclick="rankSort('sumer:${label.replace(/'/g,"\\'")}')" class="grp-adv${ci===0?' grp-start':''}" style="${on?'color:var(--accent)':''}" title="${label}"><div class="th-stack">${sumerHead(label)}${on?(rankSortDir<0?' ↓':' ↑'):''}</div></th>`;}).join('')
          : `${th('rushing_attempts','RUSH','ATT','grp-rush',true)}${th('rushing_yards','RUSH','YDS','grp-rush-mid')}${th('ypc','YPC','','grp-rush-mid')}${th('rushing_tds','RUSH','TDS','grp-rush-end')}
        ${th('receiving_targets','TGTS','','grp-rec',true)}${th('receptions','REC','','grp-rec-mid')}${th('receiving_yards','REC','YDS','grp-rec-mid')}${th('receiving_tds','REC','TDS','grp-rec-end')}
        ${th('passing_attempts','PASS','ATT','grp-pass',true)}${th('passing_yards','PASS','YDS','grp-pass-mid')}${th('passing_tds','PASS','TDS','grp-pass-mid')}${th('interceptions_thrown','PASS','INTS','grp-pass-end')}`}
      </tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
}
function cell(v){return v&&v>0?`<span class="num">${(+v)%1!==0?(+v).toFixed(1):(+v).toLocaleString()}</span>`:'';}
function rankSort(k){if(rankSortKey===k)rankSortDir*=-1;else{rankSortKey=k;rankSortDir=k==='ecr'?-1:-1;}renderRankings();}
// Scoring presets per format. The reception value is what distinguishes PPR / Half / Standard.
const FORMAT_PRESETS={
  ppr:      {receptions:1.0},
  half_ppr: {receptions:0.5},
  std:      {receptions:0.0},
  superflex:{receptions:0.5},  // half-PPR superflex by default (matches the FantasyPros page we pull)
  dynasty:  {receptions:0.5},  // dynasty half-PPR overall
  dynasty_superflex:{receptions:0.5},  // dynasty + superflex/2QB (QBs valued highest)
};
// Selecting a format applies its scoring and re-sorts by ECR (the FantasyPros rank for that format).
function setRankFormat(f){
  rankFormat=f;
  const preset=FORMAT_PRESETS[f];
  if(preset){ Object.assign(scoringSettings,preset); }
  rankSortKey='ecr'; rankSortDir=-1;
  saveSession();
  renderRankings();
  toast(`${formatLabel(f)} — ECR + scoring applied`,'ok');
}
// ── Two-axis format model ───────────────────────────────────────────────────
// A league is really TWO independent choices: its TYPE (redraft vs dynasty) and its SCORING
// (standard / half / full PPR, plus whether it's superflex). rankFormat encodes the combo;
// these helpers decompose it into the two axes and recombine after a toggle, so the UI can
// offer a clean "Redraft | Dynasty" switch alongside the scoring buttons (and expose
// Dynasty-Superflex naturally as Dynasty + Superflex).
function leagueTypeOf(f){ return (f==='dynasty'||f==='dynasty_superflex') ? 'dynasty' : 'redraft'; }
function scoringAxisOf(f){
  if(f==='superflex'||f==='dynasty_superflex') return 'superflex';
  if(f==='ppr') return 'ppr';
  if(f==='std') return 'std';
  if(f==='dynasty'){
    // dynasty w/o explicit scoring → infer from reception value, default half
    const r=scoringSettings.receptions;
    return r>=1?'ppr':r<=0?'std':'half_ppr';
  }
  return 'half_ppr';
}
// Recombine a (type, scoring) pair into a rankFormat.
function combineFormat(type, scoring){
  if(type==='dynasty'){
    return scoring==='superflex' ? 'dynasty_superflex' : 'dynasty';
  }
  // redraft
  if(scoring==='superflex') return 'superflex';
  if(scoring==='ppr') return 'ppr';
  if(scoring==='std') return 'std';
  return 'half_ppr';
}
function setLeagueType(type){
  applyTwoAxisFormat(type, scoringAxis);
}
function setScoringAxis(scoring){
  applyTwoAxisFormat(leagueTypeOf(rankFormat), scoring);
}
// Apply a (type, scoring) pair. The scoring axis is remembered independently and always drives
// the reception preset, so the scoring buttons + FPTS respond even in Dynasty (whose non-SF ECR
// table is identical for std/half/ppr). rankFormat stays correct for the ECR lookup.
function applyTwoAxisFormat(type, scoring){
  scoringAxis = scoring;
  rankFormat = combineFormat(type, scoring);
  const preset = FORMAT_PRESETS[scoring];   // scoring axis — not rankFormat — drives reception points
  if(preset){ Object.assign(scoringSettings, preset); }
  rankSortKey='ecr'; rankSortDir=-1;
  saveSession();
  renderRankings();
  toast(`${formatLabel(rankFormat)} — ECR + scoring applied`,'ok');
}
// When the user edits the reception value directly, keep the format label in sync so the
// ECR table matches: 1.0→Full PPR, 0.5→Half PPR, 0→Standard. (Superflex/Dynasty are only
// set via their buttons since they change the ranking pool, not just the reception value.)
function syncFormatFromScoring(){
  if(rankFormat==='superflex'||rankFormat==='dynasty_superflex') return; // superflex scoring isn't reception-derived
  const r=scoringSettings.receptions;
  const f = r>=1 ? 'ppr' : r>=0.25 ? 'half_ppr' : 'std';
  scoringAxis=f;   // keep the scoring buttons accurate whether redraft or dynasty
  if(rankFormat==='dynasty') return;  // dynasty ECR table doesn't change with reception value; only the buttons/scoring do
  if(f!==rankFormat){ rankFormat=f;
    toast(`Reception value ${r} → switched to ${({ppr:'Full PPR',half_ppr:'Half PPR',std:'Standard'})[f]} (ECR follows)`,'ok'); }
}
function setPosFilter(p){rankPosFilter=p;renderRankings();}
// Toggle the SumerSports advanced stat columns on the rankings page.
function setRankAdvanced(v){
  rankAdvanced=!!v;
  if(!rankAdvanced) sumerRefinement=null;   // leaving Adv. Metrics clears the situational split
  // Advanced columns sort high→low; reset to the first advanced column (or ECR when leaving).
  if(rankAdvanced){
    const sv=sumerColumnsForFilter();
    rankSortKey = sv ? ('sumer:'+sv.cols[0]) : 'ecr';
    rankSortDir = -1;
  } else if(rankSortKey.startsWith('sumer:')){
    rankSortKey='ecr'; rankSortDir=-1;
  }
  renderRankings();
}
// Select a "Situational" refinement (game-situation split) for the Adv. Metrics view. Empty
// value = Standard (overall). Re-sort onto the first column so the board reflects the split.
function setSumerRefinement(val){
  sumerRefinement = val || null;
  const sv=sumerColumnsForFilter();
  if(sv) { rankSortKey='sumer:'+sv.cols[0]; rankSortDir=-1; }
  renderRankings();
}
// Build the minimum-volume input(s) for the Adv. Metrics view, matched to the position filter:
// QB → Min Plays, WR/TE → Min Routes, RB → Min Rushes. ALL/FLEX show each relevant one.
function sumerMinInputs(){
  const mk=(bucket,label)=>`<label style="font-size:11px;color:var(--muted);font-weight:700;display:inline-flex;align-items:center;gap:4px">${label}
    <input type="number" min="0" step="10" value="${sumerMin[bucket]||0}" onchange="setSumerMin('${bucket}',this.value)"
      style="width:58px;background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:3px 6px;color:var(--text);font-size:12px;font-family:var(--mono)"></label>`;
  const pos=rankPosFilter;
  let items;
  if(pos==='QB') items=[['QB','Min Plays']];
  else if(pos==='RB') items=[['RB','Min Rushes']];
  else if(pos==='WR'||pos==='TE') items=[['WRTE','Min Routes']];
  else if(pos==='FLEX') items=[['WRTE','Min Routes'],['RB','Min Rushes']];
  else items=[['QB','Min Plays'],['WRTE','Min Routes'],['RB','Min Rushes']];  // ALL
  return items.map(([b,l])=>mk(b,l)).join('');
}
function setSumerMin(bucket, val){
  const n=parseInt(val,10);
  sumerMin[bucket] = (isNaN(n)||n<0) ? 0 : n;
  renderRankings();
}
function recalcRankings(){
  const g=(id,d)=>{const v=parseFloat(document.getElementById(id).value);return isNaN(v)?d:v;};
  scoringSettings.passing_yards_yardage=g('sc_pass_yds_ydg',25)||25;
  scoringSettings.passing_touchdowns=g('sc_pass_td',6);
  scoringSettings.interceptions_thrown=g('sc_int',-2);
  scoringSettings.rushing_yards_yardage=g('sc_rush_yds_ydg',10)||10;
  scoringSettings.rushing_touchdowns=g('sc_rush_td',6);
  scoringSettings.receiving_yards_yardage=g('sc_rec_yds_ydg',10)||10;
  scoringSettings.receiving_touchdowns=g('sc_rec_td',6);
  scoringSettings.receptions=g('sc_rec',0.5);
  scoringSettings.fumbles_lost=g('sc_fum',-2);
  scoringSettings.passing_attempts=g('sc_pass_att',0);
  scoringSettings.passing_completions=g('sc_pass_comp',0);
  scoringSettings.rushing_attempts=g('sc_rush_att',0);
  syncFormatFromScoring();  // 1.0/0.5/0 reception value keeps the format label + ECR in sync
  saveSession();
  renderRankings();toast('Rankings recalculated ✓','ok');
}
function exportRankingsCSV(){
  let all=buildPlayerList();all.sort((a,b)=>b.fpts-a.fpts);
  const dyn = rankFormat==='dynasty' || rankFormat==='dynasty_superflex';
  const keys=['ecr','tier','fpts','pos','name','team',
    ...(dyn?['age','apy','fa']:[]),
    'rushing_attempts','rushing_yards','ypc','rushing_tds',
    'receiving_targets','receptions','receiving_yards','receiving_tds',
    'passing_attempts','passing_yards','passing_tds','interceptions_thrown'];
  const csv=[keys.join(','),...all.map(p=>[
    p.ecr!=null?p.ecr:'', p.ecr_tier!=null?p.ecr_tier:'', p.fpts.toFixed(1), p.pos, p.name, p.team,
    ...(dyn?[p.age!=null?p.age:'', p.apy!=null?p.apy:'', p.fa!=null?p.fa:'']:[]),
    p.rushing_attempts, p.rushing_yards, p.ypc>0?p.ypc.toFixed(1):'', p.rushing_tds,
    p.receiving_targets, p.receptions, p.receiving_yards, p.receiving_tds,
    p.passing_attempts, p.passing_yards, p.passing_tds, p.interceptions_thrown
  ].join(','))].join('\n');
  dlFile(csv,'rankings.csv','text/csv');toast('Rankings exported ✓','ok');
}


// ─────────────────────────────────────────────────────────────────────────────
// Import — with corrected multi-analyst averaging
// ─────────────────────────────────────────────────────────────────────────────
function triggerImport(){document.getElementById('importFile').click();}
function handleImport(e){
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const p=JSON.parse(ev.target.result);
      if(!p.projections||!Array.isArray(p.projections)) throw new Error('Expected {projections:[...]}');
      loadProjections(p);
    }catch(err){toast('Import failed: '+err.message,'err');}
  };
  r.readAsText(f); e.target.value='';
}

// Average a group of same-player rows across analysts.
// IMPORTANT: receiving_targets can be a string; parse defensively. Average each
// numeric field independently (true per-field mean) to match expectations.
function averageGroup(group){
  if(group.length===1) return {...group[0]};
  const out={...group[0]};
  const NUM=['passing_yards','passing_touchdowns','passing_completions','passing_attempts',
    'rushing_yards','rushing_touchdowns','rushing_attempts','rushing_yards_per_attempt',
    'receptions','receiving_yards','receiving_touchdowns','receiving_yards_per_reception',
    'receiving_targets','interceptions_thrown','fumbles_lost','risk','upside',
    'adp','adp_ppr','adp_half_ppr','adp_2qb'];
  NUM.forEach(k=>{
    let sum=0,cnt=0;
    group.forEach(p=>{
      let v=p[k];
      if(v===null||v===undefined||v==='') return;
      v=parseFloat(v);
      if(!isNaN(v)){sum+=v;cnt++;}
    });
    out[k]= cnt>0 ? sum/cnt : 0;
  });
  out.analyst_name=[...new Set(group.map(p=>p.analyst_name).filter(Boolean))].join('+');
  return out;
}

function loadProjections(data){
  const players=data.projections;
  // Group by player_id when present, else name+team. Only treat as "same player"
  // when BOTH id matches AND team matches (avoids merging a traded player's two teams).
  const useIds=players.some(p=>p.player_id!==undefined&&p.player_id!==null);
  const groupsMap={};
  players.forEach(p=>{
    const idPart=useIds?(p.player_id!=null?p.player_id:('name:'+p.name)):('name:'+p.name);
    const key=`${idPart}::${p.team||'FA'}::${p.fantasy_position||'?'}`;
    (groupsMap[key]=groupsMap[key]||[]).push(p);
  });
  const groups=Object.values(groupsMap);
  const multiAnalyst=groups.some(g=>g.length>1);
  const analysts=[...new Set(players.map(p=>p.analyst_name).filter(Boolean))];
  const merged=groups.map(averageGroup);

  const sn=multiAnalyst?`Avg: ${analysts.join('+')} ${merged[0]?.season||''}`
    :`${merged[0]?.analyst_name||'Imported'} ${merged[0]?.season||''}`;
  document.getElementById('scenarioName').value=sn.trim();

  const byTeam={};
  merged.forEach(p=>{if(p.team)(byTeam[p.team]=byTeam[p.team]||[]).push(p);});
  userProj={};
  TEAMS.forEach(team=>{
    const tp=byTeam[team]; if(!tp||!tp.length) return;
    const qbs=tp.filter(p=>p.fantasy_position==='QB'
      && (parseFloat(p.passing_attempts)>0 || parseFloat(p.passing_yards)>0 || parseFloat(p.games_played)>0))
      .sort((a,b)=>b.passing_yards-a.passing_yards);
    const wrs=tp.filter(p=>p.fantasy_position==='WR');
    const tes=tp.filter(p=>p.fantasy_position==='TE');
    const rbs=tp.filter(p=>p.fantasy_position==='RB');
    ensureTeam(team,qbs.length?qbs:null);
    const state=userProj[team];
    if(qbs.length){
      state.qbs=qbs.map((qb,i)=>({
        name:qb.name,headshot:qb.headshot||null,slug:qb.slug||null,player_id:qb.player_id||null,
        adp:parseFloat(qb.adp)||999,adp_ppr:parseFloat(qb.adp_ppr)||999,
        adp_half_ppr:parseFloat(qb.adp_half_ppr)||999,adp_2qb:parseFloat(qb.adp_2qb)||999,
        passing_yards:parseFloat(qb.passing_yards)||0,
        passing_tds:parseFloat(qb.passing_touchdowns)||0,
        passing_attempts:parseFloat(qb.passing_attempts)||0,
        passing_completions:parseFloat(qb.passing_completions)||0,
        interceptions_thrown:parseFloat(qb.interceptions_thrown)||0,
        qb_rush_yards:parseFloat(qb.rushing_yards)||0,
        qb_rush_tds:parseFloat(qb.rushing_touchdowns)||0,
        qb_rush_attempts:parseFloat(qb.rushing_attempts)||0,
        // games is what teamPassAtt/teamPassTDs/etc. now check (0-game QBs are excluded
        // from team totals). Imported data rarely carries games_played, so default the
        // primary (first/highest-yardage) QB to a full season — same rule ensureTeam uses.
        games_played:parseFloat(qb.games_played)||0,
        games:parseFloat(qb.games_played)>0?parseFloat(qb.games_played):(i===0?SEASON_GAMES:0),
        base_games:parseFloat(qb.games_played)>0?parseFloat(qb.games_played):(i===0?SEASON_GAMES:1),
        snap_share:1/qbs.length,
      }));
      assignQBSnapShares(state.qbs);
      state.activeQB=0;
    }
    const recv=[...wrs,...tes,...rbs.filter(p=>parseFloat(p.receiving_targets||0)>5)]
      .filter(p=>parseFloat(p.receiving_targets||0)>0)
      .sort((a,b)=>parseFloat(b.receiving_targets||0)-parseFloat(a.receiving_targets||0));
    if(recv.length){
      const tot=recv.reduce((s,p)=>s+parseFloat(p.receiving_targets||0),0)||1;
      const totTDs=recv.reduce((s,p)=>s+(parseFloat(p.receiving_touchdowns)||0),0)||0;
      state.passing_shares=recv.map(p=>{
        const tgts=parseFloat(p.receiving_targets)||0;
        const yds=parseFloat(p.receiving_yards)||0;
        const rec=parseFloat(p.receptions)||0;
        return {name:p.name,pos:p.fantasy_position,headshot:p.headshot||null,slug:p.slug||null,player_id:p.player_id||null,
          baseline_targets:tgts,baseline_yards:yds,baseline_tds:parseFloat(p.receiving_touchdowns)||0,baseline_rec:rec,
          share:tgts/tot, td_share:totTDs>0?(parseFloat(p.receiving_touchdowns)||0)/totTDs:1/recv.length,
          ypt:tgts>0?yds/tgts:9, catch_rate:tgts>0?rec/tgts:0.65,
          adp:parseFloat(p.adp)||999,adp_ppr:parseFloat(p.adp_ppr)||999,adp_half_ppr:parseFloat(p.adp_half_ppr)||999,adp_2qb:parseFloat(p.adp_2qb)||999};
      });
    }
    const rushers=rbs.filter(p=>parseFloat(p.rushing_attempts||0)>0)
      .sort((a,b)=>parseFloat(b.rushing_attempts||0)-parseFloat(a.rushing_attempts||0));
    if(rushers.length){
      const tot=rushers.reduce((s,p)=>s+parseFloat(p.rushing_attempts||0),0)||1;
      const totYds=rushers.reduce((s,p)=>s+parseFloat(p.rushing_yards||0),0)||0;
      const totTDs=rushers.reduce((s,p)=>s+(parseFloat(p.rushing_touchdowns)||0),0)||0;
      state.rushing.total_attempts=tot;
      state.rushing.total_yards=totYds;
      state.rushing.ypa=tot>0?totYds/tot:4.0;
      state.rushing.total_rush_tds=totTDs;
      state.rushing.shares=rushers.map(p=>{
        const att=parseFloat(p.rushing_attempts)||0;
        const yds=parseFloat(p.rushing_yards)||0;
        return {name:p.name,pos:'RB',headshot:p.headshot||null,slug:p.slug||null,player_id:p.player_id||null,
          baseline_att:att,baseline_yards:yds,baseline_tds:parseFloat(p.rushing_touchdowns)||0,
          share:att/tot, td_share:totTDs>0?(parseFloat(p.rushing_touchdowns)||0)/totTDs:1/rushers.length,
          ypc:att>0?yds/att:4.0,
          adp:parseFloat(p.adp)||999,adp_ppr:parseFloat(p.adp_ppr)||999,adp_half_ppr:parseFloat(p.adp_half_ppr)||999,adp_2qb:parseFloat(p.adp_2qb)||999};
      });
    }
  });
  // Snapshot for two-stage reset
  importedSnapshot=deepCopy(userProj);
  dirtySinceImport=false;

  renderSidebar();
  if(multiAnalyst) toast(`⚠️ ${analysts.length} analysts averaged: ${analysts.join(', ')}`,'ok');
  else toast(`Loaded ${merged.length} players · ${Object.keys(byTeam).length} teams`,'ok');
  if(currentTeam&&userProj[currentTeam]) renderContent();
  else{currentTeam=null;document.getElementById('content').innerHTML=`<div class="empty">
    <div class="empty-icon">✅</div><div class="empty-title">Projections loaded${multiAnalyst?' (averaged)':''}</div>
    <div class="empty-body">${merged.length} players · ${analysts.length>1?analysts.join(', ')+' averaged':'analyst: '+(analysts[0]||'n/a')}<br>Select any team to review and edit.</div></div>`;}
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────
function buildOutput(){
  const analyst=document.getElementById('scenarioName').value||'Me';
  const out=[];
  TEAMS.forEach(team=>{
    const state=userProj[team]; if(!state) return;
    const totalTgts=teamTargetPool(state);
    const totalPassTDs=teamPassTDs(state);
    state.qbs.forEach(qb=>{
      const bp=getBase(team,'QB').find(x=>x.name===qb.name)||getBase(team,'QB')[0]||{};
      out.push({season:PROJ_SEASON,analyst_name:analyst,name:qb.name,fantasy_position:'QB',team,
        headshot:qb.headshot||null,slug:qb.slug||null,
        passing_yards:Math.round(qb.passing_yards),passing_touchdowns:Math.round(qb.passing_tds),
        passing_attempts:Math.round(qb.passing_attempts),passing_completions:Math.round(qb.passing_completions),
        interceptions_thrown:Math.round(qb.interceptions_thrown),
        rushing_yards:Math.round(qb.qb_rush_yards),rushing_touchdowns:Math.round(qb.qb_rush_tds),
        rushing_attempts:Math.round(qb.qb_rush_attempts),
        rushing_yards_per_attempt:qb.qb_rush_attempts>0?+(qb.qb_rush_yards/qb.qb_rush_attempts).toFixed(2):0,
        receptions:0,receiving_yards:0,receiving_touchdowns:0,receiving_targets:'0',receiving_yards_per_reception:0,
        fumbles_lost:0,adp:bp.adp||999,adp_ppr:bp.adp_ppr||999,adp_half_ppr:bp.adp_half_ppr||999,adp_2qb:bp.adp_2qb||999,
        bye_week:bp.bye_week||null});
    });
    if(state.passing_shares){
      state.passing_shares.forEach(p=>{
        const projTgts=Math.round(p.share*totalTgts);
        const projRec=Math.round(projTgts*(p.catch_rate||0.65));
        const projYds=Math.round(projTgts*(p.ypt||9));
        const projTDs=+(p.td_share*totalPassTDs).toFixed(1);
        const bp=[...getBase(team,'WR'),...getBase(team,'TE'),...getBase(team,'RB')].find(x=>x.name===p.name)||{};
        const ex=out.findIndex(x=>x.name===p.name&&x.team===team);
        const rec={receptions:projRec,receiving_yards:projYds,receiving_touchdowns:projTDs,
          receiving_targets:projTgts.toString(),receiving_yards_per_reception:projRec>0?+(projYds/projRec).toFixed(2):0};
        if(ex>=0) Object.assign(out[ex],rec);
        else out.push({season:PROJ_SEASON,analyst_name:analyst,name:p.name,fantasy_position:p.pos,team,
          headshot:p.headshot||null,slug:p.slug||null,
          passing_yards:0,passing_touchdowns:0,passing_attempts:0,passing_completions:0,interceptions_thrown:0,
          rushing_yards:bp.rushing_yards||0,rushing_touchdowns:0,rushing_attempts:bp.rushing_attempts||0,rushing_yards_per_attempt:0,
          ...rec,fumbles_lost:0,adp:bp.adp||999,adp_ppr:bp.adp_ppr||999,adp_half_ppr:bp.adp_half_ppr||999,adp_2qb:bp.adp_2qb||999,
          bye_week:bp.bye_week||null});
      });
    }
    if(state.rushing.shares){
      const r=state.rushing;
      const totRushTDs=teamRushTDs(state);
      r.shares.forEach(p=>{
        const att=Math.round(p.share*r.total_attempts);
        const yds=Math.round(att*(p.ypc||r.ypa||4));
        const tds=+(p.td_share*totRushTDs).toFixed(1);
        const bp=getBase(team,'RB').find(x=>x.name===p.name)||{};
        const ex=out.findIndex(x=>x.name===p.name&&x.team===team);
        const rush={rushing_yards:yds,rushing_touchdowns:tds,rushing_attempts:att,
          rushing_yards_per_attempt:att>0?+(yds/att).toFixed(2):0};
        if(ex>=0) Object.assign(out[ex],rush);
        else out.push({season:PROJ_SEASON,analyst_name:analyst,name:p.name,fantasy_position:'RB',team,
          headshot:p.headshot||null,slug:p.slug||null,
          passing_yards:0,passing_touchdowns:0,passing_attempts:0,passing_completions:0,interceptions_thrown:0,
          ...rush,receptions:0,receiving_yards:0,receiving_touchdowns:0,receiving_targets:'0',receiving_yards_per_reception:0,
          fumbles_lost:0,adp:bp.adp||999,adp_ppr:bp.adp_ppr||999,adp_half_ppr:bp.adp_half_ppr||999,adp_2qb:bp.adp_2qb||999,
          bye_week:bp.bye_week||null});
      });
    }
  });
  return {projections:out};
}
function dlFile(content,filename,mime){
  const b64=btoa(unescape(encodeURIComponent(content)));
  const a=document.createElement('a');
  a.href=`data:${mime};charset=utf-8;base64,${b64}`;a.download=filename;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
}
function exportJSON(){
  const d=buildOutput();
  if(!d.projections.length){toast('No projections to export','err');return;}
  const n=(document.getElementById('scenarioName').value||'projections').replace(/[^a-z0-9]/gi,'_');
  dlFile(JSON.stringify(d,null,2),`${n}.json`,'application/json');
  toast(`Exported ${d.projections.length} players ✓`,'ok');
}
function exportCSV(){
  const d=buildOutput();
  if(!d.projections.length){toast('No projections','err');return;}
  const keys=Object.keys(d.projections[0]);
  const csv=[keys.join(','),...d.projections.map(r=>keys.map(k=>{
    const v=r[k];return(v===null||v===undefined)?'':String(v).includes(',')?`"${v}"`:v;}).join(','))].join('\n');
  const n=(document.getElementById('scenarioName').value||'projections').replace(/[^a-z0-9]/gi,'_');
  dlFile(csv,`${n}.csv`,'text/csv');toast('CSV exported ✓','ok');
}

// ─────────────────────────────────────────────────────────────────────────────
// Download format menu (one ⬇ Download button → choose JSON or CSV)
// ─────────────────────────────────────────────────────────────────────────────
function toggleDownloadMenu(e){
  if(e) e.stopPropagation();
  const m=document.getElementById('downloadMenu'); if(!m) return;
  if(m.hasAttribute('hidden')){
    m.removeAttribute('hidden');
    // Close on the next outside click (this handler runs on bubble, so the opening click
    // — which we stopped above — won't immediately re-close it). A menu-item click bubbles
    // here too, so picking a format closes the menu after the export fires.
    setTimeout(()=>document.addEventListener('click', closeDownloadMenu, {once:true}), 0);
  } else {
    closeDownloadMenu();
  }
}
function closeDownloadMenu(){
  const m=document.getElementById('downloadMenu'); if(m) m.setAttribute('hidden','');
}

// ─────────────────────────────────────────────────────────────────────────────
// Reset — clear all edits and re-pull the latest Sleeper projections
// ─────────────────────────────────────────────────────────────────────────────
async function resetAll(){
  if(!confirm('Reset all projections and pull the latest projections from Sleeper?\n\nThis clears your current edits and imported/loaded data.')) return;
  userProj={}; workingProj=userProj; importedSnapshot=null; dirtySinceImport=false;
  currentTeam=null; undoStacks={};
  clearSession();   // wipe the saved session so the fresh pull isn't overwritten on next boot
  // refreshFromSleeper resets the working set to the fresh seed, re-renders, and toasts.
  await refreshFromSleeper();
}

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
seasonStatsCache['proj'] = SEED;
projSeed = SEED;
renderSeasonTabs();
renderSidebar();

// If no seed is embedded (the default now — we pull live from Sleeper), fetch the
// current-season projections automatically on first load. A prebuilt triplecrown_seed.json
// (via the 📦 Seed button) or ↻ Sleeper can refresh/replace it at any time.
//
// On boot we ALSO try to fetch triplecrown_seed.json sitting next to the HTML, so the
// FantasyPros ECR (and any prebuilt projections/history) load automatically without a
// manual 📦 click. This works when the file is served over http(s); on a bare file://
// open the browser blocks it (CORS), and we silently fall back to the live Sleeper pull.
// Close the player card on Escape.
if(document&&document.addEventListener) document.addEventListener('keydown', e=>{ if(e.key==='Escape' && pcardOpen) closePlayerCard(); });
(function boot(){
  const hasEmbeddedProj = SEED && Object.keys(SEED).some(t=>SEED[t] && (SEED[t].QB.length||SEED[t].RB.length||SEED[t].WR.length||SEED[t].TE.length));
  const hasEmbeddedECR  = ECR && Object.keys(ECR).some(f=>ECR[f] && Object.keys(ECR[f]).length);
  // If a seed was baked into this file (bake_seed.py), everything is already in memory —
  // no fetch, so it works when opened directly from a phone (file://) with no CORS issue.
  if(hasEmbeddedProj){
    const restored = restoreSession();
    _persistReady = true;
    renderSeasonTabs(); renderSidebar(); document.getElementById('content').innerHTML=emptyHTML();
    toast(`Loaded embedded seed${hasEmbeddedECR?' · ECR ready':''}${restored?' · session restored':''} ✓`,'ok');
    // Best-effort: pull the Sleeper player DB in the background so roster-membership checks
    // (used by "copy team to working set") have real data. Harmless if it fails (file://).
    loadSleeperPlayers(true).catch(()=>{});
    // Also refresh 2026 ADP live in the background so VONA/VOR stay current without a rebuild.
    backgroundRefreshADP();
    return;
  }
  document.getElementById('content').innerHTML=`<div class="empty">
    <div class="empty-icon">📡</div><div class="empty-title">Loading ${PROJ_SEASON} data…</div>
    <div class="empty-body">Checking for a prebuilt seed, then pulling live from Sleeper if needed.</div></div>`;
  // No embedded projections. Try a local seed file (works when served over http), which at
  // minimum gives us ECR; then fall back to a live Sleeper pull for projections.
  tryAutoLoadSeed().then(loaded=>{
    const hasProj = SEED && Object.keys(SEED).some(t=>SEED[t] && (SEED[t].QB.length||SEED[t].RB.length||SEED[t].WR.length||SEED[t].TE.length));
    if(hasProj){
      const restored = restoreSession();
      _persistReady = true;
      renderSeasonTabs(); renderSidebar(); document.getElementById('content').innerHTML=emptyHTML();
      if(restored) toast('Session restored ✓','ok');
      // Same background load so copy-to-working can verify current rosters.
      loadSleeperPlayers(true).catch(()=>{});
      backgroundRefreshADP();
    }
    else refreshFromSleeper(true);   // ECR (if any) already adopted by tryAutoLoadSeed; restore happens there
  });
})();

// Attempt to fetch triplecrown_seed.json next to the page. Returns true if it loaded anything
// useful (at minimum ECR). Never throws — a file:// open or missing file just returns false.
async function tryAutoLoadSeed(){
  try{
    const res = await fetch('seeds/triplecrown_seed.json', {cache:'no-store'});
    if(!res.ok) return false;
    const j = decodeAnySeed(await res.json());
    let got=false;
    if(j.ecr){ ECR=j.ecr; got=true; }
    if(j.contracts){ CONTRACTS=j.contracts; got=true; }
    if(j.sharp){ SHARP=j.sharp; got=true; }
    if(j.sos){ SOS=j.sos; got=true; }
    if(j.team_names){ TEAM_NAMES=j.team_names; got=true; }
    if(j.coordinators){ COORDINATORS=j.coordinators; got=true; }
    if(j.hc_playcallers){ HC_PLAYCALLERS=j.hc_playcallers; got=true; }
    if(j.hc_history){ HC_HISTORY=j.hc_history; got=true; }
    if(j.additions){ ADDITIONS=j.additions; got=true; }
    if(j.sharp_season){ SHARP_SEASON=j.sharp_season; got=true; }
    if(j.sumer){ SUMER=j.sumer; SUMER_SEASONS=j.sumer_seasons||Object.keys(j.sumer); got=true; }
    if(j.ktc){ KTC=j.ktc; got=true; }   // KeepTradeCut dynasty player-page slugs (player-card links)
    if(j.nflverse){ NFLVERSE=j.nflverse; if(typeof resetNflverseLazy==='function') resetNflverseLazy(); got=true; }   // nflverse advanced metrics (opt-in A/B source; heavy sections lazy-load)
    // Only adopt prebuilt projections/history if present and non-trivial.
    if(j.seed && Object.keys(j.seed).length){
      SEED=j.seed; projSeed=SEED; seasonStatsCache={proj:SEED}; rosterMergedTeams.clear();
      HISTORY=j.history||{}; HISTORY_SEASONS=j.history_seasons||[];
      workingProj={}; userProj=workingProj; activeSeason='proj';
      got=true;
    }
    if(got){
      const n=j.seed?Object.values(j.seed).reduce((s,t)=>s+(t.QB||[]).length+(t.RB||[]).length+(t.WR||[]).length+(t.TE||[]).length,0):0;
      const ecrN=j.ecr?Object.keys(ecrTableFor(rankFormat)||{}).length:0;
      toast(`Auto-loaded seed${ecrN?` · ${ecrN} ECR ranks`:''}${n?` · ${n} players`:''} ✓`,'ok');
    }
    return got;
  }catch(e){
    // CORS (file://) or network error — expected when opened directly; fall back silently.
    return false;
  }
}


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
        <b>1.</b> Serve the file over http (e.g. <code>python -m http.server</code>) so it can reach Sleeper,
        then hit <b>↺ Reset</b> to retry.<br>
        <b>2.</b> Or run <code>python build_seed.py</code> and host the generated <code>triplecrown_seed.json</code>
        next to the app — it auto-loads on open.</div></div>`;
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

// ═════════════════════════════════════════════════════════════════════════════
// ESPN team records (per season) — shown when viewing a reference season
// ═════════════════════════════════════════════════════════════════════════════
const ESPN_TEAM_ID = {ATL:1,BUF:2,CHI:3,CIN:4,CLE:5,DAL:6,DEN:7,DET:8,GB:9,TEN:10,
  IND:11,KC:12,LV:13,LAR:14,MIA:15,MIN:16,NE:17,NO:18,NYG:19,NYJ:20,PHI:21,ARI:22,
  PIT:23,LAC:24,SF:25,SEA:26,TB:27,WAS:28,CAR:29,JAX:30,BAL:33,HOU:34};
const ESPN_RECORD_URL=(season,tid)=>`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/types/2/teams/${tid}/record?lang=en&region=us`;

// ── Team schedule (live from ESPN) → opponents for the projection season ────────
// Used by the SOS chart to sum each team's opponents' Vegas win totals ("how hard is
// this slate?"). The endpoint's top-level `season` can read as the current league phase
// (e.g. off-season 2025), so we key off `requestedSeason` for the year we actually asked
// for. Browser-reachable (site.api.espn.com is CORS-open). Cached per team for the session.
const ESPN_ID_TO_CODE = Object.fromEntries(Object.entries(ESPN_TEAM_ID).map(([c,i])=>[i,c]));
const ESPN_SCHEDULE_URL=(tid,season)=>`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${tid}/schedule?season=${season}`;
let scheduleCache = {};   // team code -> [opponent code, ...]
async function fetchTeamSchedule(team){
  if(scheduleCache[team]) return scheduleCache[team];
  const tid=ESPN_TEAM_ID[team]; if(!tid){ scheduleCache[team]=[]; return []; }
  try{
    const data=await sleeperFetch(ESPN_SCHEDULE_URL(tid, PROJ_SEASON));
    const opps=[];
    const events=(data && data.events)||[];
    for(const ev of events){
      // only regular-season games (seasonType 2); skip preseason/postseason if present
      const st = ev.seasonType && ev.seasonType.type;
      if(st!=null && st!==2) continue;
      const comp = ev.competitions && ev.competitions[0];
      if(!comp || !comp.competitors) continue;
      // the opponent is the competitor whose team id isn't us
      for(const c of comp.competitors){
        const oid = c.team && parseInt(c.team.id);
        if(oid && oid!==tid){
          const code=ESPN_ID_TO_CODE[oid];
          if(code) opps.push(code);
        }
      }
    }
    scheduleCache[team]=opps;
    return opps;
  }catch(e){ scheduleCache[team]=[]; return []; }
}
// Sum a team's opponents' Vegas win totals from the SOS data we already have. Missing
// opponent totals are simply skipped (the team still plots; see games counted). Returns
// {total, games} or null if we couldn't get a schedule at all.
function opponentWinTotal(team){
  const sched = scheduleCache[team];
  if(!sched || !sched.length) return null;
  let total=0, games=0;
  for(const opp of sched){
    const wt = SOS[opp] && SOS[opp].win_total;
    if(wt!=null){ total+=wt; games++; }
  }
  return {total, games};
}

async function fetchTeamRecord(season,team){
  const key=`${season}:${team}`;
  if(espnRecordCache[key]!=null) return espnRecordCache[key];
  const tid=ESPN_TEAM_ID[team]; if(!tid) return null;
  try{
    const data=await sleeperFetch(ESPN_RECORD_URL(season,tid));
    let rec=null;
    if(data && data.items){
      const overall=data.items.find(i=>i.type==='total'||i.name==='overall')||data.items[0];
      rec=overall && (overall.summary||overall.displayValue);
    }
    espnRecordCache[key]=rec||'';
    if(activeSeason===season && currentTeam===team) renderContent();
    return rec;
  }catch(e){ espnRecordCache[key]=''; return null; }
}

// ── Head coach (live from ESPN) ─────────────────────────────────────────────
// Endpoint chain (per team): /seasons/{season}/teams/{id}/coaches → items[].$ref →
// fetch that ref → {firstName,lastName,headshot,experience}. Browser-reachable (ESPN
// core API is CORS-open), so this runs live and shows even without a seed loaded.
const ESPN_COACHES_URL=(season,tid)=>`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/teams/${tid}/coaches?lang=en&region=us`;
function fixEspnRef(u){ return (u||'').replace(/^http:/,'https:'); }
async function fetchHeadCoach(team){
  if(headCoaches[team]!==undefined) return headCoaches[team];
  if(hcInFlight[team]) return hcInFlight[team];
  const tid=ESPN_TEAM_ID[team]; if(!tid){ headCoaches[team]=null; return null; }
  const season=PROJ_SEASON;
  hcInFlight[team]=(async()=>{
    try{
      const list=await sleeperFetch(ESPN_COACHES_URL(season,tid));
      const ref = list && list.items && list.items[0] && list.items[0].$ref;
      if(!ref){ headCoaches[team]=null; return null; }
      const c=await sleeperFetch(fixEspnRef(ref));
      if(!c){ headCoaches[team]=null; return null; }
      const hc={
        name: `${c.firstName||''} ${c.lastName||''}`.trim(),
        headshot: (c.headshot&&c.headshot.href)||null,
        experience: c.experience!=null ? c.experience : null,
      };
      headCoaches[team]=hc;
      if(currentTeam===team) renderContent();
      return hc;
    }catch(e){ headCoaches[team]=null; return null; }
    finally{ delete hcInFlight[team]; }
  })();
  return hcInFlight[team];
}
// Is this team's head coach also the primary offensive playcaller?
function hcIsPlaycaller(team){
  const nm=HC_PLAYCALLERS&&HC_PLAYCALLERS[team];
  if(!nm) return false;
  const hc=headCoaches[team];
  // If we have the live HC name, confirm it matches; otherwise trust the list.
  if(hc&&hc.name) return hc.name.toLowerCase()===String(nm).toLowerCase();
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
// Copy reference-season stats into the working (projection) set
// ═════════════════════════════════════════════════════════════════════════════
// Copy a team's reference-season production into the working set, but ONLY for players
// who are still on that team in the projection season. Players who left (traded, retired,
// signed elsewhere) are skipped; brand-new players keep their existing 2026 projection.
function copyTeamToWorking(team){
  if(activeSeason==='proj') return;
  const refSeason=activeSeason;
  const refSeasonSeed=seasonStatsCache[activeSeason]||{};
  const ref=refSeasonSeed[team]; if(!ref){ toast('Nothing to copy','err'); return; }
  // Snapshot the team's CURRENT working state AND proj-seed roster row before we touch
  // either, so this whole copy can be undone in one step (e.g. you copy 2025 Colts stats
  // onto Michael Pittman's new Steelers slot, don't like it, and want it all back exactly
  // as it was — this must run before any mutation below, not after).
  pushUndo(team);
  const ps=projSeed||seasonStatsCache['proj']||{};
  ps[team]=ps[team]||{QB:[],RB:[],WR:[],TE:[]};
  // Build the set of player_ids currently on this team (projection roster + full Sleeper DB).
  const onTeam=new Set();
  ['QB','RB','WR','TE'].forEach(pos=>(ps[team][pos]||[]).forEach(p=>p.player_id&&onTeam.add(p.player_id)));
  if(sleeperPlayers){ for(const pid in sleeperPlayers){ if(sleeperPlayers[pid].team===team) onTeam.add(pid); } }
  // The "still on the roster?" filter is only meaningful when we actually have a roster to
  // check against. When the app was loaded from a seed with no live Sleeper DB (sleeperPlayers
  // is null) AND this team's projection roster is empty, we have no way to know who's still on
  // the team — so filtering would wrongly skip EVERYONE and the button appears to do nothing.
  // In that case, copy the whole reference roster (that's the intent of "copy last season").
  const canFilter = !!sleeperPlayers || onTeam.size>0;
  let copied=0, skipped=0;
  ['QB','RB','WR','TE'].forEach(pos=>{
    (ref[pos]||[]).forEach(refp=>{
      if(!refp.player_id) return;
      if(canFilter && !onTeam.has(refp.player_id)){ skipped++; return; }   // no longer a member → skip
      const arr=ps[team][pos]||(ps[team][pos]=[]);
      const copy=deepCopy(refp); copy.team=team;
      const ex=arr.findIndex(p=>p.player_id===refp.player_id);
      if(ex>=0) arr[ex]=copy; else arr.push(copy);
      copied++;
    });
  });
  delete workingProj[team];
  activeSeason='proj'; userProj=workingProj; SEED=ps; currentTeam=team;
  dirtySinceImport=true;
  ensureTeam(team);
  saveSession();
  renderSeasonTabs(); renderSidebar(); renderContent();
  const filterNote = (!canFilter) ? ' (roster unverified — copied all; ↻ Sleeper to refine)' : (skipped?` · skipped ${skipped} no longer on roster`:'');
  toast(`Copied ${copied} ${team} player${copied===1?'':'s'} from ${refSeason}${filterNote} ✓`,'ok');
}

// Copy a single player's reference line into the working set, on the team they're
// projected to play for THIS season (falls back to their historical team).
function copyPlayerToWorking(pid,pos){
  if(activeSeason==='proj') return;
  const refSeason=activeSeason;
  const refSeasonSeed=seasonStatsCache[activeSeason]||{};
  let src=null;
  const rt=currentTeam;
  for(const p of ['QB','RB','WR','TE']){
    const e=(refSeasonSeed[rt]&&refSeasonSeed[rt][p]||[]).find(x=>x.player_id===pid);
    if(e){ src=e; break; }
  }
  if(!src){ toast('Could not find that player','err'); return; }
  const ps=projSeed||seasonStatsCache['proj']||{};
  // find where they're projected this season
  let destTeam=rt;
  outer: for(const tm in ps){ for(const p of ['QB','RB','WR','TE']){
    if((ps[tm][p]||[]).some(x=>x.player_id===pid)){ destTeam=tm; break outer; }
  }}
  // Snapshot destTeam's working state AND proj-seed roster row before ANY mutation below
  // (including creating the roster skeleton if this team never had one), so a single undo
  // fully removes this copy.
  pushUndo(destTeam);
  ps[destTeam]=ps[destTeam]||{QB:[],RB:[],WR:[],TE:[]};
  const arr=ps[destTeam][src.pos]||(ps[destTeam][src.pos]=[]);
  const copy=deepCopy(src); copy.team=destTeam;
  const ex=arr.findIndex(p=>p.player_id===pid);
  if(ex>=0) arr[ex]=copy; else arr.push(copy);
  delete workingProj[destTeam];   // rebuild that working team to include the copied line
  activeSeason='proj'; userProj=workingProj; SEED=ps; currentTeam=destTeam;
  dirtySinceImport=true;
  const sameTeam = destTeam===rt;
  ensureTeam(destTeam);
  saveSession();
  renderSeasonTabs(); renderSidebar(); renderContent();
  toast(`Copied ${src.name}'s ${refSeason} line → ${destTeam} working set ✓${sameTeam?' · back on the live build view':` · switched to ${destTeam} ${PROJ_SEASON} view`}`,'ok');
  updateUndoButton();
}

// ═════════════════════════════════════════════════════════════════════════════
// Load a prebuilt seed file (triplecrown_seed.json from build_seed.py)
// This is the no-edit path: run the script, then load the JSON here.
// ═════════════════════════════════════════════════════════════════════════════
function triggerSeedLoad(){ document.getElementById('seedFile').click(); }
function handleSeedLoad(e){
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const j = decodeAnySeed(JSON.parse(ev.target.result));
      // Accept the file if it has EITHER projections or ECR (an ECR-only seed is valid —
      // it still populates the rankings ECR/Tier columns).
      const hasSeed = j.seed && Object.keys(j.seed).length;
      const hasECR  = j.ecr && Object.keys(j.ecr).some(k=>j.ecr[k] && Object.keys(j.ecr[k]).length);
      if(!hasSeed && !hasECR) throw new Error('Not an triplecrown_seed.json (no "seed" projections or "ecr" data found)');
      if(j.ecr) ECR=j.ecr;   // FantasyPros ECR (replaces ADP) — set FIRST so it survives even if seed is empty
      if(j.contracts) CONTRACTS=j.contracts;   // OverTheCap contracts (dynasty Age/APY/FA)
      if(j.sharp) SHARP=j.sharp;   // Warren Sharp advanced offensive stats
      if(j.sos) SOS=j.sos;   // 2026 strength of schedule
      if(j.team_names) TEAM_NAMES=j.team_names;   // full team display names
      if(j.coordinators) COORDINATORS=j.coordinators;   // OC/DC from Wikipedia
      if(j.hc_playcallers) HC_PLAYCALLERS=j.hc_playcallers;   // HC-as-playcaller list
      if(j.hc_history) HC_HISTORY=j.hc_history;   // HC former-team history
      if(j.additions) ADDITIONS=j.additions;   // Spotrac roster changes
      if(j.sharp_season) SHARP_SEASON=j.sharp_season;   // season the Sharp stats describe
      if(j.sumer){ SUMER=j.sumer; SUMER_SEASONS=j.sumer_seasons||Object.keys(j.sumer); }   // SumerSports advanced per-player stats
      if(j.ktc) KTC=j.ktc;   // KeepTradeCut dynasty player-page slugs (player-card links)
      if(j.nflverse){ NFLVERSE=j.nflverse; if(typeof resetNflverseLazy==='function') resetNflverseLazy(); }   // nflverse advanced metrics (opt-in A/B source; heavy sections lazy-load)
      if(hasSeed){
        SEED=j.seed; rosterMergedTeams.clear();
        HISTORY=j.history||{};
        HISTORY_SEASONS=j.history_seasons||[];
        seasonStatsCache={proj:SEED};
        projSeed=SEED;
        workingProj={}; userProj=workingProj; importedSnapshot=null; dirtySinceImport=false; activeSeason='proj';
        currentTeam=null;
      }
      renderSeasonTabs(); renderSidebar();
      // If the rankings page is open, re-render it so ECR/Tier appear immediately.
      if(currentPhase==='Rankings') renderRankings();
      else document.getElementById('content').innerHTML=emptyHTML();
      const n=hasSeed?Object.values(SEED).reduce((s,t)=>s+t.QB.length+t.RB.length+t.WR.length+t.TE.length,0):0;
      const ecrN=hasECR?Object.keys(ecrTableFor(rankFormat)||{}).length:0;
      toast(`Loaded seed${n?`: ${n} players, ${HISTORY_SEASONS.length} prior seasons`:''}${ecrN?` · ${ecrN} ECR ranks`:''} ✓`,'ok');
    }catch(err){ toast('Seed load failed: '+err.message,'err'); }
  };
  r.readAsText(f); e.target.value='';
}

// ═════════════════════════════════════════════════════════════════════════════
// Live draft follow (Sleeper draft picks)
// ═════════════════════════════════════════════════════════════════════════════
// ── Link a Sleeper draft by username (FantasyPros-style) ────────────────────
// Flow: user types their Sleeper username → we resolve their user_id → list their
// leagues for the current season → they pick one → we resolve that league's draft
// and, if it's still open (pre_draft/drafting), start following it. All calls are
// read-only and need no auth. Mock drafts have no league, so those still use the
// manual draft-ID box (promptDraftFollow).
let leaguePickerState = { open:false, loading:false, user:null, season:null, leagues:[], error:null };

// Derive a human scoring label from a league's per-reception value.
function leagueScoringLabel(sc){
  if(!sc) return '';
  const rec = sc.rec;
  if(rec==null) return '';
  if(rec>=1) return 'PPR';
  if(rec>0)  return 'Half-PPR';
  return 'Standard';
}
// Is this a superflex/2-QB league? (roster_positions contains SUPER_FLEX or 2+ QB.)
function leagueIsSuperflex(rp){
  if(!Array.isArray(rp)) return false;
  if(rp.includes('SUPER_FLEX')) return true;
  return rp.filter(x=>x==='QB').length>=2;
}

// Convert a Sleeper `scoring_settings` object (per-stat point values, e.g. pass_yd:0.04)
// onto our scoringSettings model (which uses "yards per point" for the yardage fields).
// Sleeper gives points-per-yard; we invert to yards-per-point. Returns true if applied.
// Only the fields our projection model actually scores are mapped — kicker/DEF/IDP and the
// many bonus lines don't affect skill-player fantasy points here, so they're ignored.
function applySleeperScoring(sc){
  if(!sc || typeof sc!=='object') return false;
  // Sleeper stores some values as imprecise floats (e.g. rec_yd 0.10000000149...), which
  // becomes 9.9999998 after we invert to yards-per-point. `clean` snaps a number to 2
  // decimals and, if it's within a hair of a whole/half, to that — killing the float noise
  // while still allowing genuinely custom scoring.
  const clean=(x)=>{
    const r2=Math.round(x*100)/100;               // 2-decimal precision
    const rHalf=Math.round(x*2)/2;                 // nearest 0.5
    if(Math.abs(x-Math.round(x))<1e-6) return Math.round(x);  // essentially an integer
    if(Math.abs(x-rHalf)<1e-6) return rHalf;       // essentially a half
    return r2;
  };
  const num=(v,d)=>{ const n=Number(v); return isFinite(n)?clean(n):d; };
  const perYardToYdg=(v,fallback)=>{ const n=Number(v); return (isFinite(n)&&n>0) ? clean(1/n) : fallback; };
  const s=scoringSettings;
  // Passing
  if(sc.pass_yd!=null) s.passing_yards_yardage = perYardToYdg(sc.pass_yd, s.passing_yards_yardage);
  if(sc.pass_td!=null) s.passing_touchdowns = num(sc.pass_td, s.passing_touchdowns);
  if(sc.pass_int!=null) s.interceptions_thrown = num(sc.pass_int, s.interceptions_thrown);
  if(sc.pass_att!=null) s.passing_attempts = num(sc.pass_att, s.passing_attempts);
  if(sc.pass_cmp!=null) s.passing_completions = num(sc.pass_cmp, s.passing_completions);
  // Rushing
  if(sc.rush_yd!=null) s.rushing_yards_yardage = perYardToYdg(sc.rush_yd, s.rushing_yards_yardage);
  if(sc.rush_td!=null) s.rushing_touchdowns = num(sc.rush_td, s.rushing_touchdowns);
  if(sc.rush_att!=null) s.rushing_attempts = num(sc.rush_att, s.rushing_attempts);
  // Receiving
  if(sc.rec_yd!=null) s.receiving_yards_yardage = perYardToYdg(sc.rec_yd, s.receiving_yards_yardage);
  if(sc.rec_td!=null) s.receiving_touchdowns = num(sc.rec_td, s.receiving_touchdowns);
  if(sc.rec!=null) s.receptions = num(sc.rec, s.receptions);
  // Fumbles: Sleeper splits fum_lost (offensive player losing it) from fum; use fum_lost.
  if(sc.fum_lost!=null) s.fumbles_lost = num(sc.fum_lost, s.fumbles_lost);
  return true;
}

// Pick the rankings ECR format that best matches a linked league. Superflex/2QB take
// priority (they change the player pool), then the reception value maps to ppr/half/std.
// A dynasty league (draft scoring_type starting "dynasty" OR type===2) prefers the dynasty
// board. `rp` = roster_positions, `draftScoringType` = draft.metadata.scoring_type (optional),
// `leagueType` = league.settings.type (2 = keeper/dynasty on Sleeper).
function detectLeagueFormat(sc, rp, draftScoringType, leagueType){
  const rec = sc && sc.rec!=null ? Number(sc.rec) : 0.5;
  const isSF = leagueIsSuperflex(rp) || (draftScoringType && /2qb|superflex/i.test(draftScoringType));
  const isDynasty = (draftScoringType && /^dynasty/i.test(draftScoringType)) || leagueType===2;
  // A dynasty league that's ALSO superflex/2QB (e.g. Sleeper scoring_type "dynasty_2qb")
  // wants the dynasty-superflex board, which values QBs far higher than 1QB dynasty.
  if(isDynasty && isSF) return 'dynasty_superflex';
  if(isDynasty) return 'dynasty';
  if(isSF)      return 'superflex';
  if(rec>=1)    return 'ppr';
  if(rec>=0.25) return 'half_ppr';
  return 'std';
}
// Human label for a ranking format (used in toasts + the active-format note).
const FORMAT_LABELS={ppr:'Full PPR',half_ppr:'Half PPR',std:'Standard',superflex:'Superflex',dynasty:'Dynasty',dynasty_superflex:'Dynasty Superflex'};
function formatLabel(f){ return FORMAT_LABELS[f]||f; }

async function resolveSleeperUser(username){
  const u = await sleeperFetch(SLEEPER_USER_URL(username.trim()));
  if(!u || !u.user_id) throw new Error('No such Sleeper username');
  return u;   // { user_id, username, display_name, avatar }
}
async function fetchCurrentSeason(){
  try{ const s=await sleeperFetch(SLEEPER_STATE_URL); return (s&&(s.league_season||s.season))||String(PROJ_SEASON); }
  catch(e){ return String(PROJ_SEASON); }
}
// Fetch the user's leagues for `season`; if none come back, fall back one year so
// there's still something to show in the off-season (leagues roll over late).
async function fetchUserLeagues(userId, season){
  let leagues = await sleeperFetch(SLEEPER_LEAGUES_URL(userId, season)) || [];
  let usedSeason = season;
  if(!leagues.length){
    const prev = String(parseInt(season,10)-1);
    const older = await sleeperFetch(SLEEPER_LEAGUES_URL(userId, prev)) || [];
    if(older.length){ leagues = older; usedSeason = prev; }
  }
  return { leagues, usedSeason };
}

// Resolve the best draft_id to follow for a league. The league record already carries
// a top-level draft_id (the current/most-recent draft); for dynasty leagues that may have
// several, /drafts returns them most-recent-first. We take the most recent, then read the
// draft object to learn its status so we can tell "linkable" (pre_draft/drafting) from
// "already done" (complete).
async function resolveLeagueDraft(league){
  let draftId = league.draft_id || null;
  // For leagues that might have multiple drafts (e.g. dynasty), prefer the freshest one.
  try{
    const drafts = await sleeperFetch(SLEEPER_LG_DRAFTS_URL(league.league_id));
    if(Array.isArray(drafts) && drafts.length){
      // Sorted most-recent first per Sleeper docs; prefer an open one if present.
      const open = drafts.find(d=>d.status==='pre_draft'||d.status==='drafting');
      draftId = (open||drafts[0]).draft_id || draftId;
    }
  }catch(e){ /* fall back to league.draft_id */ }
  if(!draftId) return { draftId:null, status:null, scoringType:null };
  let status=null, scoringType=null;
  try{
    const d=await sleeperFetch(SLEEPER_DRAFT_URL(draftId));
    status=d&&d.status;
    scoringType = d&&d.metadata&&d.metadata.scoring_type || null;
  }catch(e){}
  return { draftId, status, scoringType };
}

// UI entry point — open the username prompt / league list.
function openLeaguePicker(){
  leaguePickerState = { open:true, loading:false, user:null, season:null, leagues:[], error:null };
  renderRankings();
}
function closeLeaguePicker(){
  leaguePickerState.open=false;
  renderRankings();
}
async function submitLeagueUsername(){
  const inp=document.getElementById('lpUsername');
  const username=inp?inp.value.trim():'';
  if(!username){ toast('Enter your Sleeper username','err'); return; }
  leaguePickerState.loading=true; leaguePickerState.error=null; renderRankings();
  try{
    const user=await resolveSleeperUser(username);
    const season=await fetchCurrentSeason();
    const { leagues, usedSeason }=await fetchUserLeagues(user.user_id, season);
    leaguePickerState.user=user;
    leaguePickerState.season=usedSeason;
    leaguePickerState.leagues=leagues;
    leaguePickerState.loading=false;
    if(!leagues.length) leaguePickerState.error='No NFL leagues found for this account.';
    renderRankings();
  }catch(e){
    leaguePickerState.loading=false;
    leaguePickerState.error = /No such/.test(e.message)? 'Username not found on Sleeper.' : `Couldn't reach Sleeper (${e.message}).`;
    renderRankings();
  }
}
// User clicked a league in the list → resolve its draft and either follow it or explain
// that its draft is already complete. On success we also adopt the league's full scoring
// settings and switch the rankings to the matching format (PPR/Half/Std/Superflex/Dynasty).
async function pickLeague(idx){
  const lg=leaguePickerState.leagues[idx]; if(!lg) return;
  leaguePickerState.loading=true; renderRankings();
  const { draftId:did, status, scoringType }=await resolveLeagueDraft(lg);
  leaguePickerState.loading=false;
  if(!did){ toast(`No draft found for "${lg.name}"`,'err'); renderRankings(); return; }

  // Adopt the league's scoring + format regardless of whether the draft is followable —
  // even a completed-draft league is useful to score your rankings the way that league does.
  const applied = applySleeperScoring(lg.scoring_settings);
  const fmt = detectLeagueFormat(lg.scoring_settings, lg.roster_positions, scoringType, lg.settings&&lg.settings.type);
  if(fmt){
    rankFormat=fmt;
    const preset=FORMAT_PRESETS[fmt];
    // Superflex/Dynasty presets set a reception default; but the league's real reception
    // value (from applySleeperScoring) is more accurate, so re-assert it after the preset.
    if(preset) Object.assign(scoringSettings,preset);
    if(applied && lg.scoring_settings && lg.scoring_settings.rec!=null){
      scoringSettings.receptions = Number(lg.scoring_settings.rec);
    }
    scoringAxis=scoringAxisOf(fmt);   // sync the scoring buttons (after receptions is finalized so dynasty infers correctly)
  }

  if(status==='complete'){
    // Draft's done — can't follow it, but we DID apply the scoring/format above.
    leaguePickerState.error=`"${lg.name}"'s draft is already complete, so there's nothing live to follow — but I applied its scoring & format to your rankings. For a live or mock draft, use the “Paste draft ID” option.`;
    rankSortKey='ecr'; rankSortDir=-1;
    renderRankings();
    toast(`Applied ${lg.name} scoring (${formatLabel(fmt)}) ✓`,'ok');
    return;
  }
  // pre_draft or drafting (or unknown-but-present) → link it via existing follow machinery.
  draftId=did;
  mySlot=null;   // fresh link → re-detect my seat from this draft's order
  leaguePickerState.open=false;
  rankSortKey='ecr'; rankSortDir=-1;
  startDraftFollow(false);   // league scoring/format already applied above
  toast(`Linked to ${lg.name} · ${formatLabel(fmt)} scoring applied ✓`,'ok');
}

// Render the league-picker panel (username input, then the list of the user's leagues).
function renderLeaguePicker(){
  const st=leaguePickerState;
  const head=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <b style="font-size:13px">🔗 Link a Sleeper league</b>
      <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="closeLeaguePicker()">✕</button>
    </div>`;
  const errRow = st.error?`<div class="lp-error">${st.error}</div>`:'';

  // Stage 1: ask for username (shown until we have a resolved user with leagues).
  if(!st.user){
    return `<div class="lp-panel">${head}
      <div class="lp-row">
        <input id="lpUsername" class="lp-input" type="text" placeholder="Your Sleeper username"
               ${st.loading?'disabled':''} onkeydown="if(event.key==='Enter')submitLeagueUsername()">
        <button class="btn btn-accent btn-sm" ${st.loading?'disabled':''} onclick="submitLeagueUsername()">
          ${st.loading?'Looking…':'Find my leagues'}</button>
      </div>
      ${errRow}
      <div class="lp-hint">We only read your public league list — no password or login needed.</div>
    </div>`;
  }

  // Stage 2: show the user's leagues to pick from.
  const who = st.user.display_name||st.user.username||'';
  const avatar = st.user.avatar?`<img src="${SLEEPER_AVATAR_THUMB(st.user.avatar)}" class="lp-avatar" onerror="this.style.display='none'">`:'';
  const rows = (st.leagues||[]).map((lg,i)=>{
    const size = lg.total_rosters||(lg.settings&&lg.settings.num_teams)||'?';
    const scoring = leagueScoringLabel(lg.scoring_settings);
    const sf = leagueIsSuperflex(lg.roster_positions)?' · SF':'';
    const lgAv = lg.avatar?`<img src="${SLEEPER_AVATAR_THUMB(lg.avatar)}" class="lp-lg-avatar" onerror="this.style.display='none'">`:'<div class="lp-lg-avatar lp-lg-blank">🏈</div>';
    return `<button class="lp-league" ${st.loading?'disabled':''} onclick="pickLeague(${i})">
      ${lgAv}
      <div class="lp-lg-main">
        <div class="lp-lg-name">${lg.name||'Unnamed league'}</div>
        <div class="lp-lg-meta">${size} teams${scoring?' · '+scoring:''}${sf} · ${lg.season||''}</div>
      </div>
      <span class="lp-lg-go">Link →</span>
    </button>`;
  }).join('');
  return `<div class="lp-panel">${head}
    <div class="lp-user">${avatar}<span>Signed in as <b>${who}</b></span>
      <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="openLeaguePicker()">Change</button></div>
    ${errRow}
    ${st.loading?'<div class="lp-hint">Resolving draft…</div>':''}
    <div class="lp-league-list">${rows||'<div class="lp-hint">No leagues found.</div>'}</div>
    <div class="lp-hint">Following a mock draft? Use “Paste draft ID” instead — mocks aren’t tied to a league.</div>
  </div>`;
}

function promptDraftFollow(){
  const raw=prompt('Paste a Sleeper draft ID or draft URL to follow live:\n(e.g. 1234567890 or https://sleeper.com/draft/nfl/1234567890)');
  if(!raw) return;
  const m=String(raw).match(/(\d{6,})/);
  if(!m){ toast('Could not find a draft ID in that input','err'); return; }
  draftId=m[1];
  mySlot=null;   // pasted draft: forget any prior seat; we'll auto-detect or ask
  startDraftFollow(true);   // adopt this draft's own scoring/format (don't inherit a stale league)
}
// ── Roster tracker: data ────────────────────────────────────────────────────
const SLEEPER_LG_USERS_URL = (lid)=>`https://api.sleeper.app/v1/league/${lid}/users`;
// Translate a Sleeper league's roster_positions (e.g. ["QB","RB","RB","WR","WR","TE","FLEX",
// "K","DEF","BN","BN","BN"]) into our starter lineup + bench count. Unknown/IDP slots map
// through as-is so they still show. Falls back to DEFAULT_LINEUP if none provided.
function lineupFromRosterPositions(positions){
  if(!Array.isArray(positions) || !positions.length) return { lineup: DEFAULT_LINEUP.slice(), bench: 0 };
  const SLOT_MAP = { QB:'QB', RB:'RB', WR:'WR', TE:'TE', K:'K', DEF:'DEF',
    FLEX:'FLEX', WRRB_FLEX:'WRRB_FLEX', REC_FLEX:'REC_FLEX', SUPER_FLEX:'SUPER_FLEX', SUPERFLEX:'SUPER_FLEX' };
  const lineup=[]; let bench=0;
  positions.forEach(p=>{
    if(p==='BN'){ bench++; return; }
    if(p==='IR' || p==='TAXI') return;   // don't show IR/taxi slots in the draft lineup
    lineup.push(SLOT_MAP[p] || p);
  });
  if(!lineup.length) return { lineup: DEFAULT_LINEUP.slice(), bench };
  return { lineup, bench };
}
// Build a lineup from a draft's slot COUNTS (mock-draft settings: slots_qb, slots_rb, …,
// slots_flex, slots_super_flex, plus `rounds`). Bench = rounds − total starters. Ordered
// QB → RB → WR → TE → FLEX → SUPER_FLEX → K → DEF so it reads like a normal lineup card.
function lineupFromSlotCounts(s){
  if(!s) return null;
  const n=(k)=> (s[k]!=null ? (parseInt(s[k])||0) : 0);
  const spec=[
    ['slots_qb','QB'],['slots_rb','RB'],['slots_wr','WR'],['slots_te','TE'],
    ['slots_flex','FLEX'],['slots_wr_rb_flex','WRRB_FLEX'],['slots_rec_flex','REC_FLEX'],
    ['slots_super_flex','SUPER_FLEX'],['slots_k','K'],['slots_def','DEF'],
    ['slots_dl','DL'],['slots_lb','LB'],['slots_db','DB'],['slots_idp_flex','IDP_FLEX'],
  ];
  const lineup=[];
  spec.forEach(([key,slot])=>{ for(let i=0;i<n(key);i++) lineup.push(slot); });
  if(!lineup.length) return null;   // no recognizable starter slots → let caller fall back
  const rounds = n('rounds');
  const bench = rounds>lineup.length ? (rounds-lineup.length) : 0;
  return { lineup, bench };
}
// Fetch the Sleeper draft object (draft_order, slot_to_roster_id, settings, metadata) and,
// if it's tied to a league, that league's users (for usernames) + roster settings.
// `applyScoring` = also adopt the draft's own scoring type + format (used for pasted mock
// drafts so a previously-linked league's format doesn't stick).
async function loadDraftMeta(applyScoring){
  if(!draftId) return;
  try{
    const d=await sleeperFetch(SLEEPER_DRAFT_URL(draftId));
    if(!d) return;
    draftMeta=d;
    let gotLineup=false;
    // 1) Explicit roster_positions (league drafts) → use the exact ordered slot list.
    if(Array.isArray(d.metadata && d.metadata.roster_positions)){
      const { lineup, bench }=lineupFromRosterPositions(d.metadata.roster_positions);
      draftLineup=lineup; draftBenchCount=bench; gotLineup=true;
    }
    // 2) Slot COUNTS in settings (mock drafts expose slots_qb/rb/wr/te/flex/k/def + rounds).
    else if(d.settings && (d.settings.rounds || d.settings.slots_qb!=null)){
      const built=lineupFromSlotCounts(d.settings);
      if(built){ draftLineup=built.lineup; draftBenchCount=built.bench; gotLineup=true; }
    }
    // 3) League-linked draft with no inline roster → pull the league's roster_positions.
    if(!gotLineup && d.league_id){
      try{
        const lg=await sleeperFetch(`https://api.sleeper.app/v1/league/${d.league_id}`);
        if(lg && Array.isArray(lg.roster_positions)){
          const { lineup, bench }=lineupFromRosterPositions(lg.roster_positions);
          draftLineup=lineup; draftBenchCount=bench; gotLineup=true;
        }
      }catch(e){}
    }
    // Usernames: pull league users when the draft is tied to a league (for the switcher).
    if(d.league_id){
      try{
        const users=await sleeperFetch(SLEEPER_LG_USERS_URL(d.league_id));
        if(Array.isArray(users)) users.forEach(u=>{ if(u.user_id) draftUsers[u.user_id]=u.display_name||u.username||('User '+u.user_id); });
      }catch(e){}
    }
    // If we still couldn't get a real roster shape, fall back to the generic default.
    if(!gotLineup){ draftLineup=DEFAULT_LINEUP.slice(); draftBenchCount=DEFAULT_BENCH; }
    // Adopt the draft's own scoring + format so a pasted mock doesn't inherit a stale league.
    if(applyScoring){ applyDraftScoring(d); }
    // Auto-detect my slot from draft_order (user_id → slot) when we know who I am.
    const myId = leaguePickerState && leaguePickerState.user && leaguePickerState.user.user_id;
    if(myId && d.draft_order && d.draft_order[myId]!=null){
      mySlot = d.draft_order[myId];
      _trackerNeedsSlotPick=false;
    } else if(mySlot==null){
      // pasted mock (or league where we couldn't match) → ask the user to tap their seat
      _trackerNeedsSlotPick=true;
    }
  }catch(e){ /* leave draftMeta null; tracker still works with slot buckets */ }
}
// Map a Sleeper draft's scoring_type → our rankFormat + reception value, and apply it.
// scoring_type examples: "ppr","half_ppr","std","2qb","dynasty","dynasty_ppr","dynasty_2qb".
function applyDraftScoring(d){
  const st = (d && d.metadata && d.metadata.scoring_type || '').toLowerCase();
  if(!st) return;
  const isSF = st.includes('2qb') || st.includes('superflex') || st.includes('sf');
  const isDyn = st.includes('dynasty') || st.includes('keeper');
  let rec = 0.5;                       // half by default
  if(st.includes('half')) rec = 0.5;
  else if(st.includes('ppr')) rec = 1.0;
  else if(st.includes('std') || st.includes('standard')) rec = 0.0;
  let fmt;
  if(isDyn && isSF) fmt='dynasty_superflex';
  else if(isDyn) fmt='dynasty';
  else if(isSF) fmt='superflex';
  else fmt = rec>=1 ? 'ppr' : rec<=0 ? 'std' : 'half_ppr';
  rankFormat = fmt;
  const preset=FORMAT_PRESETS[fmt];
  if(preset) Object.assign(scoringSettings,preset);
  // Respect an explicit reception value the scoring_type implies (e.g. dynasty_ppr → 1.0).
  if(st.includes('ppr') && !st.includes('half')) scoringSettings.receptions=1.0;
  else if(st.includes('half')) scoringSettings.receptions=0.5;
  else if(st.includes('std')||st.includes('standard')) scoringSettings.receptions=0.0;
  scoringAxis=scoringAxisOf(fmt);   // sync the scoring buttons with the adopted draft format
  rankSortKey='ecr'; rankSortDir=-1;
  saveSession();
}
// Bucket every pick by draft slot. Each Sleeper pick has: draft_slot, player_id, picked_by,
// pick_no, and metadata {first_name,last_name,position,team}. Also record usernames from
// picked_by when we don't already have them (covers mocks where users weren't preloaded).
function bucketPicksBySlot(picks){
  const bySlot={};
  (picks||[]).forEach(p=>{
    const slot=p.draft_slot;
    if(slot==null) return;
    (bySlot[slot]=bySlot[slot]||[]).push({
      player_id: p.player_id!=null ? String(p.player_id) : null,
      name: p.metadata ? `${p.metadata.first_name||''} ${p.metadata.last_name||''}`.trim() : '',
      pos: p.metadata && (p.metadata.position||'').toUpperCase() || '',
      team: p.metadata && (p.metadata.team||'').toUpperCase() || '',
      pick_no: p.pick_no||0,
    });
  });
  Object.keys(bySlot).forEach(s=>bySlot[s].sort((a,b)=>a.pick_no-b.pick_no));
  return bySlot;
}
// Slot a team's picks into the lineup: each player fills the first open matching starter
// slot, overflowing to bench. Returns { slots:[{slot,player}], bench:[player], needs:[slot] }.
function fillLineup(picks){
  const lineup=draftLineup.slice();
  const filled=lineup.map(slot=>({slot, player:null}));
  const bench=[];
  const canPlay=(pos, slot)=>{
    if(slot===pos) return true;
    const elig=FLEX_ELIGIBLE[slot];
    return elig ? elig.includes(pos) : false;
  };
  (picks||[]).forEach(pk=>{
    // find first open slot this player fits (exact position first, then flex)
    let idx=filled.findIndex(f=>!f.player && f.slot===pk.pos);
    if(idx<0) idx=filled.findIndex(f=>!f.player && canPlay(pk.pos, f.slot));
    if(idx>=0) filled[idx].player=pk;
    else bench.push(pk);
  });
  const needs=filled.filter(f=>!f.player).map(f=>f.slot);
  return { slots:filled, bench, needs };
}

async function startDraftFollow(applyScoring){
  if(draftTimer) clearInterval(draftTimer);
  _lastPickCount = -1;   // force the first poll to render
  await loadDraftMeta(applyScoring);   // draft_order, lineup, usernames, my-slot detection, (opt) scoring
  rosterBarVisible=true;
  await pollDraft();
  draftTimer=setInterval(pollDraft, 2500); // poll every 2.5s for lower latency on the board
  toast(`Following draft ${draftId} ✓`,'ok');
  if(currentPhase==='Rankings') renderRankings();
  renderRosterBar();
}
function stopDraftFollow(){
  if(draftTimer){clearInterval(draftTimer);draftTimer=null;}
  draftId=null; draftedIds={};
  draftMeta=null; draftPicksBySlot={}; draftUsers={}; mySlot=null;
  draftLineup=DEFAULT_LINEUP.slice(); draftBenchCount=DEFAULT_BENCH;
  rosterBarVisible=false; trackerOpen=false; trackerViewSlot=null; _trackerNeedsSlotPick=false;
  toast('Stopped following draft','ok');
  renderRosterBar();
  if(currentPhase==='Rankings') renderRankings();
}
async function pollDraft(){
  if(!draftId) return;
  try{
    const picks=await sleeperFetch(SLEEPER_PICKS_URL(draftId));
    const next={};
    (picks||[]).forEach(p=>{ if(p.player_id) next[String(p.player_id)]=true; });
    const pickCount = (picks||[]).length;
    const changed = pickCount !== _lastPickCount;
    _lastPickCount = pickCount;
    draftedIds=next;
    // Roster tracker: rebucket picks. Only RE-RENDER the bar when the pick set actually
    // changed — Sleeper's API doesn't update between most polls, so re-rendering every 2.5s
    // needlessly rebuilds the bar and resets the seat-picker's scroll (making seat selection
    // near-impossible on mobile when your slot is scrolled off-screen).
    if(changed){
      draftPicksBySlot = bucketPicksBySlot(picks);
      (picks||[]).forEach(p=>{ if(p.picked_by && !draftUsers[p.picked_by]) draftUsers[p.picked_by]=null; });
      renderRosterBar();
      if(currentPhase==='Rankings') renderRankings();
    }
  }catch(e){ /* keep polling quietly */ }
}
function toggleHideDrafted(){ hideDrafted=!hideDrafted; renderRankings(); }

// ── Roster tracker: UI ──────────────────────────────────────────────────────
// A slot label for display (flex variants get friendly names).
function slotLabel(slot){
  return ({FLEX:'FLEX', WRRB_FLEX:'W/R', REC_FLEX:'W/T', SUPER_FLEX:'SFLX'})[slot] || slot;
}
function slotClass(posOrSlot){
  const v=(posOrSlot||'').toUpperCase();
  // Flex/slot names → a shared lavender class; real positions → their color class.
  if(v==='FLEX'||v==='WRRB_FLEX'||v==='REC_FLEX'||v==='SUPER_FLEX'||v==='W/R'||v==='W/T'||v==='SFLX') return 'rt-pos-flex';
  if(v==='QB') return 'rt-pos-qb';
  if(v==='RB') return 'rt-pos-rb';
  if(v==='WR') return 'rt-pos-wr';
  if(v==='TE') return 'rt-pos-te';
  if(v==='K') return 'rt-pos-k';
  if(v==='DEF'||v==='DST') return 'rt-pos-def';
  if(v==='BN') return 'rt-pos-bn';
  return 'rt-pos-flex';
}
// Name for a slot's owner (username if known, else "Team N").
function slotOwnerName(slot){
  if(draftMeta && draftMeta.draft_order){
    for(const uid in draftMeta.draft_order){
      if(draftMeta.draft_order[uid]===slot){
        return draftUsers[uid] || ('Team '+slot);
      }
    }
  }
  return 'Team '+slot;
}
function draftSlotCount(){
  if(draftMeta && draftMeta.settings && draftMeta.settings.teams) return draftMeta.settings.teams;
  const slots=Object.keys(draftPicksBySlot).map(Number);
  return slots.length ? Math.max(...slots) : DEFAULT_LINEUP.length && 12;
}
// The pinned bar at the bottom. Collapsed: your lineup as position chips + a count.
// Tap to expand into the full panel. Hidden entirely when not following a draft.
function renderRosterBar(){
  let host=document.getElementById('rosterBar');
  if(!host){
    host=document.createElement('div'); host.id='rosterBar'; host.className='rt-bar-host';
    document.body.appendChild(host);
  }
  if(!rosterBarVisible){ host.innerHTML=''; host.style.display='none'; return; }
  host.style.display='block';

  // Preserve the expanded panel's scroll position across re-renders (the 2.5s poll rebuilds
  // this element; without this the user gets bounced to the top mid-scroll).
  const prevPanel = host.querySelector('.rt-panel');
  const prevScroll = prevPanel ? prevPanel.scrollTop : 0;
  // Also preserve the seat-picker's HORIZONTAL scroll (mobile: slots 8-12 are scrolled off to
  // the right, and a reset makes them impossible to tap).
  const prevSeats = host.querySelector('.rt-seats');
  const prevSeatScroll = prevSeats ? prevSeats.scrollLeft : 0;

  // Which slot are we showing? default = mine; in the panel you can switch teams.
  const viewSlot = (trackerViewSlot!=null) ? trackerViewSlot : mySlot;

  // Need-to-pick-your-seat state (mock drafts): show a claim prompt in the bar.
  if(_trackerNeedsSlotPick && mySlot==null){
    const n=draftSlotCount()||12;
    let seats='';
    for(let s=1;s<=n;s++){
      const owner=slotOwnerName(s);
      seats+=`<button class="rt-seat" onclick="claimSlot(${s})">${s} <span class="rt-seat-own">${owner}</span></button>`;
    }
    host.innerHTML=`<div class="rt-bar">
      <div class="rt-claim">
        <b>Which seat is yours?</b>
        <div class="rt-seats">${seats}</div>
      </div>
    </div>`;
    // restore horizontal scroll so the user's spot doesn't jump back to seat 1
    if(prevSeatScroll){ const ns=host.querySelector('.rt-seats'); if(ns) ns.scrollLeft=prevSeatScroll; }
    return;
  }

  const picks = (viewSlot!=null && draftPicksBySlot[viewSlot]) || [];
  const { slots, bench, needs } = fillLineup(picks);
  const filledCount = slots.filter(s=>s.player).length;
  const totalStarters = slots.length;
  const totalWithBench = totalStarters + draftBenchCount;
  const totalRostered = picks.length;

  // Collapsed bar: position chips
  const chips = slots.map(s=>{
    const p=s.player;
    const cls = p ? `rt-chip filled ${slotClass(s.slot)}` : 'rt-chip empty';
    const label = p ? (p.name.split(' ').slice(-1)[0] || slotLabel(s.slot)) : slotLabel(s.slot);
    return `<span class="${cls}" title="${p?`${p.name} (${p.pos} · ${p.team})`:slotLabel(s.slot)+' — open'}">${p?`<b>${slotLabel(s.slot)}</b> ${label}`:slotLabel(s.slot)}</span>`;
  }).join('');

  const whoseLabel = (viewSlot===mySlot) ? 'My roster' : `${slotOwnerName(viewSlot)}`;
  const bar=`<div class="rt-bar">
    <button class="rt-toggle" onclick="toggleTracker()" aria-expanded="${trackerOpen}">
      <span class="rt-caret">${trackerOpen?'▾':'▴'}</span>
      <span class="rt-title">${whoseLabel}</span>
      <span class="rt-count">${filledCount}/${totalStarters} starters${totalRostered>totalStarters?` · ${totalRostered} total`:''}</span>
    </button>
    <div class="rt-chips">${chips}</div>
  </div>`;
  const panel = trackerOpen ? renderTrackerPanel(viewSlot) : '';
  host.innerHTML = bar + panel;
  // restore scroll on the freshly-rendered panel
  if(trackerOpen && prevScroll){
    const np = host.querySelector('.rt-panel');
    if(np) np.scrollTop = prevScroll;
  }
}
// The expanded panel: full lineup with drafted players, remaining needs, a team switcher.
function renderTrackerPanel(viewSlot){
  const picks = (viewSlot!=null && draftPicksBySlot[viewSlot]) || [];
  const { slots, bench, needs } = fillLineup(picks);
  const rows = slots.map(s=>{
    const p=s.player;
    return `<div class="rt-row ${p?'':'open'}">
      <span class="rt-slot ${slotClass(s.slot)}">${slotLabel(s.slot)}</span>
      ${p ? `<span class="rt-pname">${p.name}</span><span class="rt-pmeta">${p.pos} · ${p.team}</span>`
          : `<span class="rt-empty-lbl">— open —</span>`}
    </div>`;
  }).join('');
  // Bench: show ALL bench slots (filled first, then empty "— open —" up to draftBenchCount).
  let benchRows='';
  if(draftBenchCount>0 || bench.length>0){
    const totalBench=Math.max(draftBenchCount, bench.length);
    benchRows=`<div class="rt-bench-head">Bench (${bench.length}/${totalBench})</div>`;
    for(let i=0;i<totalBench;i++){
      const p=bench[i];
      benchRows += p
        ? `<div class="rt-row bench"><span class="rt-slot rt-pos-bn">BN</span><span class="rt-pname">${p.name}</span><span class="rt-pmeta">${p.pos} · ${p.team}</span></div>`
        : `<div class="rt-row bench open"><span class="rt-slot rt-pos-bn">BN</span><span class="rt-empty-lbl">— open —</span></div>`;
    }
  }
  const needsLine = needs.length
    ? `<div class="rt-needs">Still needs: ${needs.map(nS=>`<span class="rt-need ${slotClass(nS)}">${slotLabel(nS)}</span>`).join('')}</div>`
    : `<div class="rt-needs rt-complete">✓ Starting lineup complete</div>`;

  // Team switcher: chips for every slot in the draft, current highlighted.
  const n=draftSlotCount()||12;
  let switcher='';
  for(let s=1;s<=n;s++){
    const active = s===viewSlot ? 'active' : '';
    const mine = s===mySlot ? ' rt-mine' : '';
    switcher+=`<button class="rt-teamchip ${active}${mine}" onclick="viewTrackerSlot(${s})" title="${slotOwnerName(s)}">${s===mySlot?'★ ':''}${s}</button>`;
  }
  // VONA advisory — only for MY roster, only while a live draft is running.
  let advisory='';
  if(viewSlot===mySlot && draftId){
    const v=computeVONA();
    if(v && v.rows.length){
      const fmtP=(p)=> p ? `${p.name.split(' ').slice(-1)[0]} (${p.pos})` : '—';
      const chips=v.rows.slice(0,4).map((r,i)=>{
        const cls = r.adjDrop>=25?'vona-hot':r.adjDrop>=12?'vona-warm':'vona-cool';
        const star = (i===0 && r.need) ? '★ ' : '';
        const tag = r.filled ? (r.studBackup?`<span class="vona-tag stud">stud backup</span>`:`<span class="vona-tag">filled</span>`) : '';
        // show raw drop, but note it's discounted for filled spots
        const dropTxt = r.filled ? `−${r.dropoff} <span class="vona-adj">(adj −${r.adjDrop})</span>` : `−${r.dropoff}`;
        return `<div class="vona-row ${r.need?'':'vona-filled'} ${cls}">
          <span class="rt-slot ${slotClass(r.pos)}">${r.pos}</span>
          <span class="vona-best">${fmtP(r.bestNow)}${tag}</span>
          <span class="vona-drop" title="VOR drop-off before your next pick">${star}${dropTxt}</span>
        </div>`;
      }).join('');
      // headline = biggest drop among positions I still NEED; fall back to top row
      const needRows=v.rows.filter(r=>r.need);
      const rec = needRows[0] || v.rows[0];
      const alsoBig = v.rows.find(r=>r!==rec && r.dropoff>=12);
      let recTxt='';
      if(rec){
        recTxt = `Take a <b>${rec.pos}</b> — biggest need-value cliff (−${rec.dropoff})`;
        if(rec.filled) recTxt = `Best value: <b>${rec.pos}</b> (−${rec.dropoff}) — but your starters are set`;
      }
      const noteTxt = (rec && !rec.need && needRows.length===0)
        ? `All starters filled — now drafting for value/depth.`
        : (alsoBig ? `Also watch <b>${alsoBig.pos}</b> (−${alsoBig.dropoff}).` : '');
      advisory=`<div class="vona-box">
        <div class="vona-head">📊 On-the-clock advice ${v.onClock?'· <b style="color:var(--accent)">YOU\u2019RE UP</b>':`· next pick in ${v.gap}`}</div>
        <div class="vona-sub">${recTxt}${noteTxt?` · ${noteTxt}`:''}</div>
        <div class="vona-rows">${chips}</div>
        <div class="vona-legend">Accounts for who your opponents still need before your next pick, and the spots you\u2019ve already filled.</div>
      </div>`;
    }
  }
  return `<div class="rt-panel">
    <div class="rt-panel-head">
      <span class="rt-panel-title">${viewSlot===mySlot?'★ My roster':slotOwnerName(viewSlot)} <span class="rt-panel-slot">· seat ${viewSlot}</span></span>
    </div>
    <div class="rt-switch-head">Jump to a team</div>
    <div class="rt-switcher">${switcher}</div>
    ${advisory}
    ${needsLine}
    <div class="rt-lineup">${rows}${benchRows}</div>
  </div>`;
}
function toggleTracker(){ trackerOpen=!trackerOpen; renderRosterBar(); }
function viewTrackerSlot(slot){ trackerViewSlot = (slot===trackerViewSlot? null : slot); renderRosterBar(); }
function claimSlot(slot){ mySlot=slot; _trackerNeedsSlotPick=false; trackerViewSlot=null; toast(`Seat ${slot} is yours ★`,'ok'); renderRosterBar(); if(currentPhase==='Rankings') renderRankings(); }

// ── "You're on the clock next" projection ───────────────────────────────────
// Which draft SLOT is on the clock at a given global pick number (1-based), accounting
// for draft type (snake/linear) and Sleeper's optional third-round reversal.
//   • linear: every round runs slot 1 → teams.
//   • snake: odd rounds 1→teams, even rounds teams→1 (alternating).
//   • reversal_round R: from round R onward the direction FLIPS relative to normal snake,
//     i.e. round R continues the same direction as round R-1 (the "3rd round reversal"),
//     and the alternation carries on shifted from there.
function slotOnClock(pickNo, teams, type, reversalRound){
  if(!teams || teams<1) return null;
  const round = Math.ceil(pickNo/teams);
  const idxInRound = ((pickNo-1) % teams) + 1;
  if(type==='linear') return idxInRound;
  let reversed = (round % 2 === 0);
  if(reversalRound && round >= reversalRound) reversed = !reversed;
  return reversed ? (teams - idxInRound + 1) : idxInRound;
}
// The current draft's parameters (falls back to sane defaults when meta is absent).
function draftParams(){
  const s = draftMeta && draftMeta.settings || {};
  const teams = (s.teams) || draftSlotCount() || 12;
  const type = (draftMeta && draftMeta.type) || 'snake';
  const reversalRound = s.reversal_round || 0;
  const rounds = s.rounds || draftLineup.length + draftBenchCount || 15;
  return { teams, type, reversalRound, rounds };
}
// The global pick number currently ON THE CLOCK = picks made so far + 1.
function currentPickNo(){
  let made=0;
  for(const slot in draftPicksBySlot) made += draftPicksBySlot[slot].length;
  return made + 1;
}
// The list of global pick numbers that belong to `slot` from the current pick onward
// (up to the end of the draft). Used to draw "you pick here" lines in the rankings.
function myUpcomingPickNumbers(slot){
  if(slot==null) return [];
  const { teams, type, reversalRound, rounds } = draftParams();
  const start = currentPickNo();
  const maxPick = teams*rounds;
  const out=[];
  for(let n=start; n<=maxPick; n++){
    if(slotOnClock(n, teams, type, reversalRound)===slot) out.push(n);
  }
  return out;
}
// How many picks until my NEXT turn (inclusive count from the current pick). 0 = I'm on the
// clock right now. Returns null if I have no slot or the draft's over.
function picksUntilMyTurn(slot){
  if(slot==null) return null;
  const { teams, type, reversalRound, rounds } = draftParams();
  const start = currentPickNo();
  const maxPick = teams*rounds;
  for(let n=start; n<=maxPick; n++){
    if(slotOnClock(n, teams, type, reversalRound)===slot) return n-start;
  }
  return null;
}
// ── VONA: Value Over Next Available ─────────────────────────────────────────
// The on-the-clock advisory. For each position, compares the best player available NOW
// (by your VOR) against the best you're PROJECTED to have at your next pick — modeling that
// the picks between now and then take the top undrafted players by market ADP. A big drop
// means that position's value is about to evaporate: draft it now. Small drop means you can
// safely wait and address it on the way back.
//   dropoff[pos] = bestNowVOR - bestAtNextTurnVOR
// Returns a sorted array (biggest drop first) of { pos, bestNow, bestNext, dropoff, need }.
function computeVONA(){
  if(mySlot==null) return null;
  let gap = picksUntilMyTurn(mySlot);              // picks between now and my next turn
  if(gap==null) return null;
  const onClock = (gap===0);
  const { teams, type, reversalRound, rounds } = draftParams();
  const startPick = currentPickNo();
  // The exact sequence of SLOTS picking between now and my next turn (so we can read each of
  // those teams' rosters and model what they actually need).
  const upcomingSlots=[];
  {
    const myUps = myUpcomingPickNumbers(mySlot);
    // window = from the current pick up to (but not including) my next relevant pick
    const endPick = onClock ? (myUps[1]!=null?myUps[1]:startPick) : (myUps[0]!=null?myUps[0]:startPick);
    const from = onClock ? startPick+1 : startPick;   // on the clock: picks AFTER mine
    for(let n=from; n<endPick; n++){
      upcomingSlots.push(slotOnClock(n, teams, type, reversalRound));
    }
    gap = upcomingSlots.length;
  }
  const list = buildPlayerList();
  const avail = list.filter(p=>!draftedIds[p.player_id]);
  if(!avail.length) return null;
  const realAdpCount = avail.filter(p=>adpFor(p)<999).length;
  const useAdp = realAdpCount >= Math.max(5, Math.min(gap,8));

  // ── Demand-aware depletion ────────────────────────────────────────────────
  // Instead of removing the top `gap` players by ADP (which wrongly predicts a QB run when
  // most teams already have their QB), we simulate each upcoming pick taking the best player
  // at a position THAT team still needs. This makes one-off positions (QB/TE in 1-QB/1-TE)
  // deplete slowly once demand is satisfied, and keeps them scarce in superflex.
  const posNeedsForSlot=(slot)=>{
    const picks=(draftPicksBySlot[slot])||[];
    const { needs }=fillLineup(picks);
    const set=new Set();
    needs.forEach(s=>{
      if(s==='QB'||s==='RB'||s==='WR'||s==='TE') set.add(s);
      else if(s==='FLEX'||s==='WRRB_FLEX'||s==='REC_FLEX'){ set.add('RB'); set.add('WR'); set.add('TE'); }
      else if(s==='SUPER_FLEX'){ set.add('QB'); set.add('RB'); set.add('WR'); set.add('TE'); }
    });
    return set;
  };
  // working pools per position, best-first by VOR (what a value-drafter reaches for)
  const pools={QB:[],RB:[],WR:[],TE:[]};
  avail.forEach(p=>{ if(pools[p.pos]) pools[p.pos].push(p); });
  Object.keys(pools).forEach(k=>pools[k].sort((a,b)=>(b.vor||0)-(a.vor||0)));
  const idx={QB:0,RB:0,WR:0,TE:0};
  const goneSet=new Set();
  // snapshot "best available now" BEFORE depletion
  const bestNow={};
  ['QB','RB','WR','TE'].forEach(pos=>{ bestNow[pos]=pools[pos][0]||null; });
  // simulate each upcoming pick
  upcomingSlots.forEach(slot=>{
    const need=posNeedsForSlot(slot);
    // candidate positions this team would draft: their needs; if none (full starters), they
    // take best-player-available regardless (bench/upside) — model as any position.
    const cands = need.size ? [...need] : ['QB','RB','WR','TE'];
    // pick the position whose next-best available player has the highest VOR (value-based),
    // but only among positions this team needs — this is the demand filter.
    let bestPos=null, bestVal=-Infinity;
    cands.forEach(pos=>{
      const nx=pools[pos][idx[pos]];
      if(nx && (nx.vor||0)>bestVal){ bestVal=nx.vor||0; bestPos=pos; }
    });
    if(bestPos){
      const taken=pools[bestPos][idx[bestPos]];
      goneSet.add(taken.player_id||taken.name);
      idx[bestPos]++;
    }
  });
  // best available at MY next pick = the next in each pool after depletion
  const bestNext={};
  ['QB','RB','WR','TE'].forEach(pos=>{ bestNext[pos]=pools[pos][idx[pos]]||null; });

  // ── My own remaining needs (for the discount) ─────────────────────────────
  const myPicks=(draftPicksBySlot[mySlot])||[];
  const { needs: myNeeds }=fillLineup(myPicks);
  // Dedicated-slot needs: a position is a TRUE need only if I have an unfilled slot that names
  // that position directly (QB/RB/WR/TE). FLEX/superflex eligibility is a SOFT need — it keeps
  // a position relevant, but a filled one-off (already have my TE) shouldn't read as "needed"
  // just because TE can fill a flex. This is what makes the QB/TE "already have a stud" logic work.
  const dedicatedNeed=new Set();
  const flexNeed=new Set();
  myNeeds.forEach(s=>{
    if(s==='QB'||s==='RB'||s==='WR'||s==='TE') dedicatedNeed.add(s);
    else if(s==='FLEX'||s==='WRRB_FLEX'||s==='REC_FLEX'){ flexNeed.add('RB'); flexNeed.add('WR'); flexNeed.add('TE'); }
    else if(s==='SUPER_FLEX'){ flexNeed.add('QB'); flexNeed.add('RB'); flexNeed.add('WR'); flexNeed.add('TE'); }
  });

  const WORTH_A_BACKUP=20;   // VOR above which a 2nd QB/TE is worth taking even if slot filled
  const out=[];
  ['QB','RB','WR','TE'].forEach(pos=>{
    const now=bestNow[pos];
    if(!now) return;
    const next=bestNext[pos];
    const rawDrop=+((now.vor||0) - (next?(next.vor||0):0)).toFixed(1);
    const isDedicated = dedicatedNeed.has(pos);   // unfilled one-off/dedicated slot for this pos
    const isFlexElig  = flexNeed.has(pos);        // can still fill a flex, but starter is set
    const needed = isDedicated;
    // Discount weighting:
    //  • dedicated need (no starter yet) → full weight
    //  • flex-eligible only (starter filled, could go flex) → moderate weight
    //  • filled & not flex-relevant → low, unless a genuine stud worth a backup
    let weight;
    if(isDedicated) weight=1;
    else if(isFlexElig) weight=0.6;
    else weight=((now.vor||0)>=WORTH_A_BACKUP ? 0.5 : 0.15);
    out.push({
      pos, bestNow: now, bestNext: next,
      dropoff: rawDrop,
      adjDrop: +(rawDrop*weight).toFixed(1),
      need: needed,
      filled: !isDedicated,
      flexEligible: isFlexElig,
      studBackup: !isDedicated && (now.vor||0)>=WORTH_A_BACKUP,
    });
  });
  // Rank by adjusted drop (need-weighted) so a filled position won't outrank a real need
  // unless it's a stud-backup situation.
  out.sort((a,b)=> b.adjDrop-a.adjDrop);
  return { gap, rows: out, usedAdp: useAdp, onClock };
}





















































