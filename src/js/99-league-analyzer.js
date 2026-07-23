// ═══ League Analyzer (dynasty) ═══════════════════════════════════════════════
// Sync a Sleeper league → take a point-in-time SNAPSHOT of every roster, owner, and future
// pick, then analyze it against the FantasyPros dynasty trade values baked into the seed
// (DYNASTY_VALUES). Phase 1 ships: sync flow, the snapshot, and the Rosters view.
// Compare / Best Available / Trade Calculator hang off the same snapshot in later phases.
//
// Design decisions:
//  • Snapshot is EXPLICIT — a "Re-sync" button with a visible "taken <date>" stamp, never an
//    auto-refresh. Dynasty rosters move slowly, and stable numbers matter mid-negotiation.
//  • Values are FORMAT-AWARE from the SNAPSHOT's own settings (not the builder page's):
//    superflex leagues price QBs off the SF column, TE-premium leagues price TEs off TEP.
//  • The whole feature reads one global (leagueSnapshot, persisted with the session) so every
//    future tab — compare, trade calc, best-available — shares a single source of truth.

const LA_ROSTERS_URL = (lid)=>`https://api.sleeper.app/v1/league/${lid}/rosters`;
const LA_TRADED_PICKS_URL = (lid)=>`https://api.sleeper.app/v1/league/${lid}/traded_picks`;
const LA_LEAGUE_URL = (lid)=>`https://api.sleeper.app/v1/league/${lid}`;

// Transient UI state for the analyzer's own league picker (mirrors leaguePickerState but is
// kept separate so the rankings-page picker and this one can't clobber each other).
let laState = { step: leagueSnapshot? 'view':'start', busy:false, error:null,
                user:null, leagues:[], laTab:'myteam',
                lens:'value',      // Compare lens: 'value' (dynasty chart) | 'proj' (our projections)
                baPos:'ALL',       // Best Available position filter
                myLens:'value',    // My Team lens: 'value' (dynasty) | 'proj' (redraft, our projections)
                myPicks:true,      // My Team: include draft picks in power scores
                myStarters:false,  // My Team: starters only (ignore bench capital)
                fndSeed:0,         // Trade Finder shuffle seed — 🔄 bumps it for new variations
                // Team view: which roster is on screen (null = the synced user's own team).
                // Clicking any team in Power Rankings / Compare / Rosters swaps the whole
                // analysis to them — same charts, same lenses, their roster.
                viewTeam:null,
                fndPos:'AUTO',     // Trade Finder target position (AUTO = my weakest by rank)
                cmpPicks:true,     // Compare: include pick capital in the value lens
                cmpStarters:false, // Compare: rank on starting lineups only (mirrors My Team)
                cmpSort:{col:'total',dir:-1} };  // Compare column sort (click a header)

// Called whenever DYNASTY_VALUES is (re)assigned by an async seed load. The analyzer's value
// caches are built lazily and, on a cold boot or resume, the League view can render once
// BEFORE the dynasty-values JSON has finished fetching — showing every value/rank/persona as
// 0. When the values finally land we must drop the stale caches and repaint the view, or it
// stays stuck at 0 until the user manually re-syncs. This is the hook that closes that gap.
function laOnValuesLoaded(){
  _laTierVals = null;
  _laPosRankCache = null;
  try{
    if(typeof currentPhase!=='undefined' && currentPhase==='League'
       && typeof leagueSnapshot!=='undefined' && leagueSnapshot
       && typeof renderLeagueAnalyzer==='function'){
      renderLeagueAnalyzer();
    }
  }catch(e){}
}

// ── Value lookups ────────────────────────────────────────────────────────────
// Every dynasty number in this file is (chart points x LA_VAL_SCALE). Keep it that way:
// players, superflex QBs, TEP tight ends and PICKS must share one scale or the trade math,
// the tier multipliers and the power scores all quietly disagree with each other.
const LA_VAL_SCALE = 100;
// Dynasty value for one player under the SNAPSHOT league's format. Returns null when the
// player is off the chart (deep depth pieces) — callers render those as unvalued, not 0,
// because "not charted" and "worthless" are different claims.
function dynastyValueFor(name, pos){
  const dv = DYNASTY_VALUES && DYNASTY_VALUES.players;
  if(!dv || !name) return null;
  const e = dv[ecrNormName(name)];
  if(!e || (pos && e.pos && e.pos !== pos)) return null;
  const snap = leagueSnapshot || {};
  // ONE scale for every asset. The seed stores raw 0-100 chart points; LA_VAL_SCALE lifts
  // them into the working range the tier multipliers and trade math operate in.
  // The SF/TEP branches used to return the raw column while the base branch scaled — so in a
  // superflex league Josh Allen priced at 100 against Ja'Marr Chase's 8900, i.e. ~1% of his
  // real worth. Every return here now goes through the same multiplier.
  if(e.pos==='QB' && snap.superflex && e.sf!=null) return e.sf*LA_VAL_SCALE;
  if(e.pos==='TE' && snap.tep && e.tep!=null) return e.tep*LA_VAL_SCALE;
  return e.v!=null ? e.v*LA_VAL_SCALE : null;
}
// Value for a future rookie pick. Exact rows exist for the chart's listed seasons; later
// seasons reuse the year-out table (dynasty convention: value the unknown like next year's).
function dynastyPickValue(season, round){
  const pk = DYNASTY_VALUES && DYNASTY_VALUES.picks;
  if(!pk) return null;
  const rows = pk[String(season)] || pk[String(Math.max(...Object.keys(pk).map(Number)))] || null;
  if(!rows) return null;
  const col = leagueSnapshot && leagueSnapshot.superflex ? 2 : 1;
  // Round → representative row: match "1." labels for R1, "2nd"/"3rd"… tiers otherwise.
  const rx = round===1 ? /^1\.|1st/i : new RegExp(`${round}(nd|rd|th)`, 'i');
  const hits = rows.filter(r=>rx.test(r[0]));
  if(!hits.length) return round>=5 ? (rows[rows.length-1] ? rows[rows.length-1][col] : null) : null;
  // Use the MIDDLE row of the matching tier (mid-1st for an unknown future 1st, mid-2nd, …).
  return hits[Math.floor(hits.length/2)][col]*LA_VAL_SCALE;
}

// ── Pick tiering ─────────────────────────────────────────────────────────────
// Players get a tier multiplier (LA_TIER_MULT); picks got nothing, so every pick was
// implicitly priced at a tier-4 "1.0" while the players around it were boosted or faded.
// Rather than invent a tier for a pick, we DERIVE one from what it's worth: build a
// tier -> median-player-value table from the actual chart, then a pick takes the multiplier
// of the tier whose players are worth about the same. A 1.01 that trades like a tier-1 WR
// gets tier-1 treatment; a late 4th gets the same fade as the fringe players it competes with.
let _laTierVals = null;
function laTierValueTable(){
  if(_laTierVals) return _laTierVals;
  const buckets={};
  const dv=(DYNASTY_VALUES&&DYNASTY_VALUES.players)||{};
  for(const k in dv){
    const e=dv[k];
    const t=laDynTier(e.n||k);
    if(t==null) continue;
    const v=dynastyValueFor(e.n||k, e.pos);
    if(v==null||v<=0) continue;
    (buckets[t]=buckets[t]||[]).push(v);
  }
  const table=Object.keys(buckets).map(t=>{
    const a=buckets[t].sort((x,y)=>x-y);
    return {tier:+t, med:a[Math.floor(a.length/2)]};
  }).sort((a,b)=>a.tier-b.tier);
  // Do NOT cache an empty result: on a resume the analyzer can render before the async seed
  // reload has repopulated DYNASTY_VALUES. Caching [] here would poison every value/rank/
  // persona to 0 permanently (they only recompute on re-sync). Returning without caching
  // means the next render — after values land — builds the real table.
  if(!table.length) return table;
  _laTierVals=table;
  return _laTierVals;
}
// Tier multiplier appropriate to a raw asset value (used for picks).
function laTierMultForValue(v){
  const tbl=laTierValueTable();
  if(!tbl.length || v==null) return 1;
  let best=tbl[0], bd=Infinity;
  tbl.forEach(x=>{ const d=Math.abs(x.med-v); if(d<bd){ bd=d; best=x; } });
  return LA_TIER_MULT[best.tier] || 1;
}
// The pick equivalent of laDynVal(): chart value with its value-equivalent tier boost.
// Every ranking view should use THIS for picks, never the raw dynastyPickValue().
function laPickVal(season, round){
  const v=dynastyPickValue(season, round);
  if(v==null) return 0;
  return v * laTierMultForValue(v);
}

// ── Tier-weighted valuation ──────────────────────────────────────────────────
// THE "CHASE + JSN" FIX. Raw per-position value sums reward depth hoarding: eight mid WRs
// summing 300 outrank two tier-1 studs at 174, which is nonsense in dynasty — you start two.
// Two corrections, applied wherever teams are ranked:
//   1. TIER MULTIPLIER — the dynasty ECR tiers (the same tiers the rankings page shows) boost
//      elite players: tier 1 ×1.15, tier 2 ×1.08, tier 3 ×1.03. Tiers encode the cliffs that
//      a flat 0-100 value understates.
//   2. CONSOLIDATION — position strength is laTcAdjusted() of those values (1/.75/.55/.40/…),
//      the exact same math the trade calculator trusts. Best players dominate; depth decays.
const LA_TIER_MULT = {1:1.15, 2:1.08, 3:1.03, 4:1.0, 5:0.99, 6:0.97, 7:0.95, 8:0.93, 9:0.91, 10:0.89, 11:0.87, 12:0.85, 13:0.83, 14:0.81, 15:0.79, 16:0.77, 17:0.75, 18:0.75, 19:0.75, 20:0.75};
function laDynTier(name){
  const fmt = (leagueSnapshot&&leagueSnapshot.superflex) ? 'dynasty_superflex' : 'dynasty';
  const t = ECR && ECR[fmt] && ECR[fmt][ecrNormName(name)];
  return t && t.tier!=null ? t.tier : null;
}
// A player's dynasty value with the tier boost applied. This is the number every ranking
// view uses;
function laDynVal(name,pos){
  const v = dynastyValueFor(name,pos);
  if(v==null) return 0;
  const t = laDynTier(name);
  return Math.round(v * (LA_TIER_MULT[t]||1));
}

// League / team icons — real Sleeper avatars with emoji fallback (older persisted snapshots
// predate avatar capture, and orphan rosters have none; both degrade gracefully).
function laLeagueIcon(s,cls){ return s&&s.avatar?`<img src="${s.avatar}" class="${cls}" onerror="this.outerHTML='\ud83c\udfdf'">`:'\ud83c\udfdf'; }
function laTeamIcon(t,cls){ return t&&t.avatar?`<img src="${t.avatar}" class="${cls}" onerror="this.outerHTML='\ud83c\udfc8'">`:'<span class="'+cls+' la-av-blank">\ud83c\udfc8</span>'; }

// ── Entry + navigation ───────────────────────────────────────────────────────
function openLeagueAnalyzer(){
  laState.step = leagueSnapshot ? 'view' : 'start';
  currentPhase='League';
  renderContent();
  refreshLeagueSyncBtn();
}
function leaveLeagueAnalyzer(){ showProjectionsView(); }
// Header button reflects state: plain sync CTA before a snapshot, league name after.
function refreshLeagueSyncBtn(){
  // The League entry point lives in the ☰ menu now; show the synced league's icon + name
  // there so the menu doubles as the sync indicator the old header button used to be.
  const label = leagueSnapshot
    ? `${laLeagueIcon(leagueSnapshot,'la-btn-av')} ${leagueSnapshot.name}`
    : '\ud83c\udfdf League Analyzer';
  const m=document.getElementById('menuLeagueView');
  if(m) m.innerHTML = label;
  // Kept for any build that still renders the old header button.
  const b=document.getElementById('leagueSyncBtn');
  if(b){ b.innerHTML = leagueSnapshot ? label : '\ud83d\udd17 My League';
         b.classList.toggle('synced', !!leagueSnapshot); }
}

// ── Remembered Sleeper profile (leagues for quick switching) ─────────────────
// Kept in its own localStorage key rather than the projection session, deliberately: the
// session payload is season-guarded (restoreSession refuses a payload whose season doesn't
// match PROJ_SEASON), so folding the league list in there would silently lose it every
// season rollover. It's also tiny and unrelated to projections, so clearing your working
// set shouldn't forget which leagues you're in.
// Shape: {username, user:{user_id,display_name,avatar}, leagues:[...], fetchedAt}
const TC_SLEEPER_KEY = 'triplecrown.sleeper.v1';
function laSaveSleeperProfile(username, user, leagues){
  if(!persistAvailable()) return;
  try{
    localStorage.setItem(TC_SLEEPER_KEY, JSON.stringify({
      username: username || '',
      user: user ? {user_id:user.user_id, display_name:user.display_name, avatar:user.avatar||null} : null,
      // Store only what the switcher renders — a full league object carries roster_positions,
      // scoring settings and metadata we'd never read here.
      leagues: (leagues||[]).map(lg=>({
        league_id: lg.league_id, name: lg.name, total_rosters: lg.total_rosters,
        type: (lg.settings&&lg.settings.type)||0,
        sf: (lg.roster_positions||[]).includes('SUPER_FLEX'),
        avatar: lg.avatar||null,
      })),
      fetchedAt: Date.now(),
    }));
  }catch(e){ /* quota / serialization — the switcher just won't have history */ }
}
function laLoadSleeperProfile(){
  if(!persistAvailable()) return null;
  try{
    const raw = localStorage.getItem(TC_SLEEPER_KEY);
    if(!raw) return null;
    const p = JSON.parse(raw);
    return (p && Array.isArray(p.leagues)) ? p : null;
  }catch(e){ return null; }
}
// Sync a remembered league straight from the switcher (by id — the saved list is independent
// of laState.leagues, so index-based laPickLeague isn't safe here).
async function laSyncSavedLeague(leagueId){
  if(!leagueId || laState.busy) return;
  await laTakeSnapshot(leagueId);
}

// Quick-switch list shown under the username field: the leagues we already know this
// account is in. Excludes the league you're currently synced to (you'd be re-syncing what
// you already have — that's what ↻ Resync is for) and the draft-page linked league (already
// offered as its own button right above, so listing it twice would be noise).
// Returns '' when there's nothing worth showing, so first-run stays clean.
function laSavedLeaguesHTML(){
  const p = laLoadSleeperProfile();
  if(!p || !p.leagues.length) return '';
  const currentId = leagueSnapshot ? String(leagueSnapshot.leagueId) : null;
  const linkedId  = (window._laLinkedLeague && String(window._laLinkedLeague.id)) || null;
  const others = p.leagues.filter(lg=>{
    const id=String(lg.league_id);
    return id!==currentId && id!==linkedId;
  });
  if(!others.length) return '';
  const who = p.user && p.user.display_name ? p.user.display_name : (p.username||'your account');
  return `<div class="la-saved">
    <div class="la-saved-title">Your other leagues <span class="la-saved-who">— ${escAttr(who)}</span></div>
    <div class="la-league-list">
      ${others.map(lg=>`
        <button class="la-league" ${laState.busy?'disabled':''}
                onclick="laSyncSavedLeague('${escAttr(lg.league_id)}')">
          <b>${escAttr(lg.name||'League')}</b>
          <span>${lg.total_rosters||'?'}-team · ${lg.type===2?'dynasty':lg.type===1?'keeper':'redraft'}${lg.sf?' · SF':''}</span>
        </button>`).join('')}
    </div>
    <div class="la-saved-note">or enter a different username above to search another account</div>
  </div>`;
}

// ── Sync flow ────────────────────────────────────────────────────────────────
async function laSubmitUsername(){
  const inp=document.getElementById('laUsername');
  const username=inp?inp.value.trim():'';
  if(!username){ toast('Enter your Sleeper username','err'); return; }
  laState.busy=true; laState.error=null; renderLeagueAnalyzer();
  try{
    const user=await resolveSleeperUser(username);
    const season=await fetchCurrentSeason();
    const { leagues }=await fetchUserLeagues(user.user_id, season);
    laState.user=user; laState.leagues=leagues;
    laState.step='pick'; laState.busy=false;
    // Remember this account's leagues so "change league" can offer them directly next time
    // (including after a reload — laState itself is in-memory only).
    laSaveSleeperProfile(username, user, leagues);
    if(!leagues.length) laState.error='No NFL leagues found for this account.';
  }catch(e){
    laState.busy=false;
    laState.error=/No such/.test(e.message)?'Username not found on Sleeper.':`Couldn't reach Sleeper (${e.message}).`;
  }
  renderLeagueAnalyzer();
}
async function laPickLeague(idx){
  const lg=laState.leagues[idx]; if(!lg) return;
  await laTakeSnapshot(lg.league_id);
}
async function laResync(){
  if(!leagueSnapshot) return;
  await laTakeSnapshot(leagueSnapshot.leagueId);
}
function laChangeLeague(){
  laState.step='start'; laState.error=null; renderLeagueAnalyzer();
}
// Same, but reachable from the ☰ menu while you're in the Projections view: switch into the
// analyzer and land on its setup screen rather than re-rendering a view that isn't on screen.
function laMenuChangeLeague(){
  laState.step='start'; laState.error=null;
  currentPhase='League';
  renderContent();
}

// The snapshot itself: league + users + rosters + traded picks + the Sleeper player DB
// (for id→name/pos), assembled into one persisted object. This is the only network moment
// in the whole analyzer — everything downstream reads the snapshot.
async function laTakeSnapshot(leagueId){
  laState.busy=true; laState.error=null; renderLeagueAnalyzer();
  try{
    const [lg, users, rosters, traded] = await Promise.all([
      sleeperFetch(LA_LEAGUE_URL(leagueId)),
      sleeperFetch(SLEEPER_LG_USERS_URL(leagueId)),
      sleeperFetch(LA_ROSTERS_URL(leagueId)),
      sleeperFetch(LA_TRADED_PICKS_URL(leagueId)).catch(()=>[]),
    ]);
    await loadSleeperPlayers(true);
    const uById={}; (users||[]).forEach(u=>uById[u.user_id]=u);
    const rp=lg.roster_positions||[];
    const superflex = rp.includes('SUPER_FLEX');
    const tep = +((lg.scoring_settings||{}).bonus_rec_te||0) > 0;

    // Future pick ownership. Default: every roster owns its own R1-R4 for the horizon
    // seasons; traded_picks rows then reassign {season, round, roster_id(original)} → owner.
    const horizon=[1,2,3].map(n=>String(+lg.season+n));
    const rounds=Math.min(4, +( (lg.settings||{}).draft_rounds )||4);
    const own={};   // "season|round|origRosterId" → current owner roster_id
    (rosters||[]).forEach(r=>{ horizon.forEach(s=>{ for(let rd=1;rd<=rounds;rd++) own[`${s}|${rd}|${r.roster_id}`]=r.roster_id; }); });
    (traded||[]).forEach(t=>{
      const k=`${t.season}|${t.round}|${t.roster_id}`;
      if(k in own) own[k]=t.owner_id;   // Sleeper's traded_picks owner_id is a ROSTER id
    });

    const teams=(rosters||[]).map(r=>{
      const u=uById[r.owner_id]||{};
      const players=(r.players||[]).map(pid=>{
        // sleeperPlayers is the SLIMMED map from loadSleeperPlayers: {name, pos, team, ...} —
        // not the raw Sleeper API shape (full_name/position). Read the slim keys.
        const sp=(sleeperPlayers||{})[pid]||{};
        return { id:pid, name:sp.name||pid, pos:sp.pos||'?', team:sp.team||'FA' };
      });
      const picks=[];
      for(const k in own){ if(own[k]!==r.roster_id) continue;
        const [s,rd,orig]=k.split('|');
        picks.push({season:s, round:+rd, origRosterId:+orig});
      }
      picks.sort((a,b)=> a.season===b.season ? a.round-b.round : a.season.localeCompare(b.season));
      return { rosterId:r.roster_id, ownerId:r.owner_id||null,
               owner:u.display_name||'(orphan)',
               // Team icon: Sleeper's per-league team avatar (metadata.avatar, a full URL)
               // beats the account avatar (an id we turn into a CDN thumb). Null → emoji.
               avatar:(u.metadata&&u.metadata.avatar)||(u.avatar?SLEEPER_AVATAR_THUMB(u.avatar):null),
               teamName:(u.metadata&&u.metadata.team_name)||u.display_name||`Roster ${r.roster_id}`,
               wins:(r.settings&&r.settings.wins)||0, losses:(r.settings&&r.settings.losses)||0,
               players, picks };
    });
    leagueSnapshot = {
      leagueId, name:lg.name||'League', season:lg.season,
      avatar: lg.avatar ? SLEEPER_AVATAR_THUMB(lg.avatar) : null,
      teams:lg.total_rosters||teams.length, superflex, tep,
      rosterPositions:rp, takenAt:Date.now(),
      myUserId:(laState.user&&laState.user.user_id)||((leagueSnapshot&&leagueSnapshot.leagueId===leagueId)?leagueSnapshot.myUserId:null),
      teamList:teams,
    };
    // Tie to the draft-page sync: adopt this league's scoring + roster shape exactly like
    // pickLeague does, so projections (the Compare 'proj' lens, PROJ in Best Available, and
    // the rankings page itself) are scored under THIS league's rules — one league, one truth.
    try{
      if(typeof applySleeperScoring==='function') applySleeperScoring(lg.scoring_settings);
      if(typeof lineupFromRosterPositions==='function' && Array.isArray(lg.roster_positions) && lg.roster_positions.length){
        const shape=lineupFromRosterPositions(lg.roster_positions);
        leagueShape={ teams: lg.total_rosters||teams.length, lineup: shape.lineup, bench: shape.bench };
        draftLineup=shape.lineup; draftBenchCount=shape.bench;
      }
      window._laLinkedLeague = { id: leagueId, name: lg.name||'League' };
    }catch(e){}
    _laTierVals=null;   // format (SF/TEP) may have changed → rebuild the pick-tier table
    _laPosRankCache=null;   // roster set changed → positional ranks are stale
    laState.step='view'; laState.busy=false;
    saveSession();
    toast(`Snapshot of ${leagueSnapshot.name} taken`,'ok');
  }catch(e){
    laState.busy=false; laState.error=`Sync failed: ${e.message}`;
  }
  renderLeagueAnalyzer();
  // Taking a snapshot doesn't go through renderContent(), so sync the chrome explicitly —
  // this is what reveals the League actions (Re-sync / Change league) in the ☰ menu.
  if(typeof syncAppChrome==='function') syncAppChrome(); else refreshLeagueSyncBtn();
}

// ── Rendering ────────────────────────────────────────────────────────────────
function renderLeagueAnalyzer(){
  const host=document.getElementById('content'); if(!host) return;
  if(currentPhase!=='League') return;
  const back=`<button class="btn btn-ghost" onclick="leaveLeagueAnalyzer()">← Projections</button>`;
  if(laState.step!=='view' || !leagueSnapshot){
    host.innerHTML=`
      <div class="team-header"><div><div class="team-abbr">🏟 League Analyzer</div>
        <div class="team-qb-name">dynasty rosters · values · trades — powered by your league snapshot</div></div>
        <div class="team-nav">${back}</div></div>
      <div class="la-setup card">
        ${laState.step==='start'?`
          <div class="la-setup-title">Sync your Sleeper league</div>
          <div class="la-setup-body">Takes a snapshot of every roster, owner, and future pick — then values them with the
            FantasyPros dynasty trade chart${DYNASTY_VALUES&&DYNASTY_VALUES.asof?` (<b>${DYNASTY_VALUES.asof}</b> update)`:''}.
            Nothing auto-refreshes; you control when the snapshot updates.</div>
          <div class="la-row">
            <input id="laUsername" placeholder="Sleeper username" value="${escAttr((laLoadSleeperProfile()||{}).username||'')}"
                   onkeydown="if(event.key==='Enter')laSubmitUsername()">
            <button class="btn btn-accent" ${laState.busy?'disabled':''} onclick="laSubmitUsername()">${laState.busy?'Looking up…':'Find my leagues'}</button>
          </div>
          ${window._laLinkedLeague?`<div class="la-linked">or <button class="btn btn-sm btn-accent" ${laState.busy?'disabled':''}
            onclick="laTakeSnapshot(window._laLinkedLeague.id)">\u26a1 Sync ${window._laLinkedLeague.name}</button>
            <span class="la-linked-note">(the league linked on your draft/rankings page)</span></div>`:''}
          ${laSavedLeaguesHTML()}`
        :`
          <div class="la-setup-title">Pick a league</div>
          <div class="la-league-list">
            ${laState.leagues.map((lg,i)=>`
              <button class="la-league" ${laState.busy?'disabled':''} onclick="laPickLeague(${i})">
                <b>${lg.name}</b>
                <span>${lg.total_rosters}-team · ${(lg.settings&&lg.settings.type)===2?'dynasty':(lg.settings&&lg.settings.type)===1?'keeper':'redraft'}
                  ${ (lg.roster_positions||[]).includes('SUPER_FLEX')?' · SF':'' }</span>
              </button>`).join('')}
          </div>
          <button class="btn btn-ghost btn-sm" onclick="laChangeLeague()">← different username</button>`}
        ${laState.busy&&laState.step==='pick'?`<div class="la-busy">Taking snapshot…</div>`:''}
        ${laState.error?`<div class="la-error">${laState.error}</div>`:''}
      </div>`;
    return;
  }
  const s=leagueSnapshot;
  const taken=new Date(s.takenAt);
  const stamp=`${taken.toLocaleDateString(undefined,{month:'short',day:'numeric'})} ${taken.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`;
  const fmt=[`${s.teams}-team`, s.superflex?'Superflex':'1QB', s.tep?'TEP':null].filter(Boolean).join(' · ');
  host.innerHTML=`
    <div class="team-header"><div><div class="team-abbr la-hdr">${laLeagueIcon(s,'la-lg-av')}<span class="la-hdr-name">${s.name}</span></div>
      <div class="team-qb-name">${fmt} · snapshot taken <b>${stamp}</b>
        ${DYNASTY_VALUES&&DYNASTY_VALUES.asof?` · values: FantasyPros dynasty chart <b>${DYNASTY_VALUES.asof}</b>`:''}</div></div>
      </div>
    <div class="phase-tabs">
      ${[['myteam','My Team'],['rosters','Rosters'],['compare','Compare'],['best','Waiver Wire'],['trade','Trade Center']]
        .map(([k,l])=>`<button class="phase-tab ${laState.laTab===k?'active':''}" onclick="laSetTab('${k}')">${l}</button>`).join('')}
    </div>
    ${laState.laTab==='compare' ? laCompareView(s) : laState.laTab==='best' ? laBestAvailView(s) : laState.laTab==='trade' ? laTradeView(s) : laState.laTab==='rosters' ? laRostersView(s) : laMyTeamView(s)}`;
}

// One card per team: players sorted by dynasty value, unvalued depth collapsed to a count,
// future picks listed with their tier values. "My" team (the syncing user) sorts first.
function laRostersView(s){
  const teams=[...s.teamList].sort((a,b)=>{
    if(s.myUserId){ if(a.ownerId===s.myUserId) return -1; if(b.ownerId===s.myUserId) return 1; }
    return laTeamValue(b)-laTeamValue(a);
  });
  return `<div class="la-grid">${teams.map(t=>laTeamCard(t,s)).join('')}</div>`;
}
function laTeamValue(t){
  // Consolidated + tier-weighted (see laDynVal): a roster's worth is its stars first, its
  // depth at a steep discount — matching the trade calculator's worldview so the Rosters
  // totals, Compare ranks and Trade verdicts can never disagree about who's loaded.
  return Math.round(
    laTcAdjusted(t.players.map(p=>laDynVal(p.name,p.pos)).filter(v=>v>0)) +
    laTcAdjusted(t.picks.map(pk=>laPickVal(pk.season,pk.round)).filter(v=>v>0)));
}
function laTeamCard(t,s){
  const valued=[], depth=[];
  t.players.forEach(p=>{
    const v=laDynVal(p.name,p.pos);
    (v!=null?valued:depth).push({...p,v:v||0});
  });
  valued.sort((a,b)=>b.v-a.v);
  const mine=s.myUserId && t.ownerId===s.myUserId;
  const total=laTeamValue(t);
  const pickChips=t.picks.map(pk=>{
    // laPickVal, not the raw chart value: players on this card are tier-boosted and scaled,
    // so a raw pick number here would be ~1% of a comparable player and read as worthless.
    const v=Math.round(laPickVal(pk.season,pk.round))||null;
    const label=`${pk.season} ${pk.round}${['','st','nd','rd','th'][pk.round]||'th'}`;
    const orig=pk.origRosterId!==t.rosterId?` (via ${laRosterName(s,pk.origRosterId)})`:'';
    return `<span class="la-pick" title="${label}${orig}${v!=null?` · value ${v}`:''}">${label}${orig?'*':''}${v!=null?` <b>${v}</b>`:''}</span>`;
  }).join('');
  return `<div class="la-card ${mine?'mine':''}">
    <div class="la-card-head">
      ${laTeamIcon(t,'la-tm-av-sm')}
      <div class="la-team la-clickteam" onclick="laViewTeam(${t.rosterId})" title="View this team\u2019s analysis">${mine?'\u2605 ':''}${t.teamName}</div>
      <div class="la-owner">@${t.owner} · ${t.wins}-${t.losses}</div>
      <div class="la-total" title="Sum of player + pick dynasty values">${total}</div>
    </div>
    <div class="la-players">
      ${valued.map(p=>`<div class="la-p">
        <span class="rt-slot ${slotClass(p.pos)}">${p.pos}</span>
        <span class="clickable-player" onclick="${pcardOnclick(p.player_id||p.name,p.pos,p.team||'')}">${imgTag(hsURL(p),'player-headshot')}</span>
        <span class="share-name clickable-player" title="${p.name}" onclick="${pcardOnclick(p.player_id||p.name, p.pos, p.team||'')}">${p.name}</span>${laCliffMark(p.name,p.pos)}
        <span class="team-header"><img src="${NFL_LOGO(p.team)}" class="team-logo-sm" alt="${p.team}"</span>
        <span class="la-pval">${p.v}</span></div>`).join('')}
      ${depth.length?`<div class="la-depth">+ ${depth.length} unvalued depth</div>`:''}
    </div>
    ${pickChips?`<div class="la-picks">${pickChips}</div>`:''}
  </div>`;
}
function laRosterName(s,rosterId){
  const t=s.teamList.find(x=>x.rosterId===rosterId);
  return t?t.teamName:('R'+rosterId);
}

// Boot: reflect a session-restored snapshot on the header button. Scripts run after the DOM
// exists (end of body), and session restore has already run by 90-sleeper's boot path — but
// guard with a microtask so we never race it.
setTimeout(refreshLeagueSyncBtn, 0);

// ═══ Phase 2: Compare + Best Available ═══════════════════════════════════════

// name|pos → projected fantasy points under the CURRENT scoring settings, straight from the
// builder's own projection engine (buildPlayerList). This is the analyzer's second lens: the
// dynasty chart says what the market thinks a player is WORTH; this says what our projections
// think his roster will actually SCORE. Both on the same screen is the whole point.
function laProjMap(){
  const m=new Map();
  try{
    buildPlayerList().forEach(p=>{ m.set(ecrNormName(p.name)+'|'+p.pos, p.fpts||0); });
  }catch(e){ /* seed not loaded yet → empty map; views render 0s rather than crashing */ }
  return m;
}

// Greedy starting-lineup fill for the SNAPSHOT league's roster slots. `players` must arrive
// sorted best-first (by whatever metric the caller cares about); dedicated slots fill before
// flex so a WR3 doesn't steal the FLEX from a better RB2. BN/IR/TAXI are not starting slots.
function laFillStarters(players, rosterPositions){
  const slots=(rosterPositions||[]).filter(x=>x!=='BN'&&x!=='IR'&&x!=='TAXI');
  const filled=slots.map(slot=>({slot,player:null}));
  const used=new Set();
  filled.forEach(f=>{
    if(FLEX_ELIGIBLE[f.slot]) return;                       // dedicated pass first
    const p=players.find(x=>!used.has(x.id)&&x.pos===f.slot);
    if(p){ f.player=p; used.add(p.id); }
  });
  filled.forEach(f=>{
    if(!FLEX_ELIGIBLE[f.slot]||f.player) return;            // then flex
    const elig=FLEX_ELIGIBLE[f.slot];
    const p=players.find(x=>!used.has(x.id)&&elig.includes(x.pos));
    if(p){ f.player=p; used.add(p.id); }
  });
  return filled;
}

// Rank → quartile class for cell coloring (1 = best). Green top quartile → red bottom.
function laQuartile(rank,n){
  if(rank<=Math.max(1,Math.ceil(n/4))) return 'la-q1';
  if(rank<=Math.ceil(n/2)) return 'la-q2';
  if(rank<=Math.ceil(3*n/4)) return 'la-q3';
  return 'la-q4';
}

// ── Compare: every team side by side, league-relative ranks per column ───────
// Two lenses, deliberately different aggregation:
//   value: DYNASTY worth per position = sum over ALL rostered players (depth is an asset in
//          dynasty), plus a Picks column, plus Total. This is "who owns the most capital".
//   proj:  next-season POINTS per position = starters only (bench points don't play), filled
//          greedily from our projections. This is "who actually wins games this year".
// A team ranked 2nd in value but 9th in projection is rebuilding; the reverse is win-now.
function laCompareView(s){
  const lens=laState.lens||'value';
  const POS=['QB','RB','WR','TE'];
  const pm=laProjMap();
  const withPicks = lens==='value' && laState.cmpPicks;
  const rows=s.teamList.map(t=>{
    const by={QB:0,RB:0,WR:0,TE:0};
    let picks=0;
    if(lens==='value'){
      // Position strength = consolidation-adjusted, tier-boosted (elite duos outrank depth
      // piles — the Chase+JSN fix). Picks consolidate the same way, toggleable.
      const byPos={QB:[],RB:[],WR:[],TE:[]};
      // starters-only mirrors the My Team filter: per-position strength from the starting
      // lineup alone, so a deep-but-benchy position stops flattering the rank.
      const srcP = laState.cmpStarters
        ? laTeamEngine(s,t,'value',pm,{picks:false,startersOnly:true}).starters.filter(f=>f.player).map(f=>f.player)
        : t.players;
      srcP.forEach(p=>{ const v=laDynVal(p.name,p.pos); if(byPos[p.pos]&&v>0) byPos[p.pos].push(v); });
      POS.forEach(pos=>{ by[pos]=+laTcAdjusted(byPos[pos]).toFixed(0); });
      picks=+laTcAdjusted(t.picks.map(pk=>laPickVal(pk.season,pk.round)).filter(v=>v>0)).toFixed(0);
    }else{
      const withF=t.players.map(p=>({...p, fpts:pm.get(ecrNormName(p.name)+'|'+p.pos)||0}))
                           .sort((a,b)=>b.fpts-a.fpts);
      laFillStarters(withF, s.rosterPositions).forEach(f=>{
        if(f.player && by[f.player.pos]!=null) by[f.player.pos]+=f.player.fpts;
      });
    }
    // TOTAL = the SAME power score as the My Team page (starters + 35% bench + 50% picks),
    // so the two tabs can never rank the league differently when their settings agree.
    const total=+laTeamEngine(s,t,lens,pm,{picks:withPicks,startersOnly:laState.cmpStarters}).score.toFixed(0);
    return {t, by, picks, total};
  });
  const cols=[...POS, ...(withPicks?['picks']:[]), 'total'];
  const ranks={};
  cols.forEach(c=>{
    const vals=rows.map(r=> c==='total'?r.total : c==='picks'?r.picks : r.by[c]);
    const sorted=[...vals].sort((a,b)=>b-a);
    ranks[c]=vals.map(v=>sorted.indexOf(v)+1);
  });
  const n=rows.length;
  const fmtV=(v)=> lens==='value' ? Math.round(v) : v.toFixed(0);
  // Sortable: click a header to rank the table by that column (repeated click flips).
  const sc=laState.cmpSort||{col:'total',dir:-1};
  if(!cols.includes(sc.col) && sc.col!=='team') sc.col='total';
  const colVal=(r,c)=> c==='total'?r.total : c==='picks'?r.picks : r.by[c];
  const order=rows.map((r,i)=>({r,i})).sort((a,b)=>{
    if(sc.col==='team') return sc.dir*a.r.t.teamName.localeCompare(b.r.t.teamName);
    return sc.dir*(colVal(a.r,sc.col)-colVal(b.r,sc.col));
  });
  const arrow=c=> sc.col===c ? (sc.dir<0?' \u2193':' \u2191') : '';
  const th=(c,label)=>`<th onclick="laCmpSort('${c}')" class="la-cmp-sortable" title="Sort by ${label}">${label}${arrow(c)}</th>`;
  return `
    <div class="la-lens">
      <span class="la-lens-lbl">Lens:</span>
      <button class="format-btn ${lens==='value'?'active':''}" onclick="laState.lens='value';renderLeagueAnalyzer()" title="Dynasty capital: tier-boosted values, consolidation-adjusted">Dynasty value</button>
      <button class="format-btn ${lens==='proj'?'active':''}" onclick="laState.lens='proj';renderLeagueAnalyzer()" title="Projected points from YOUR projections: best starting lineup under this league's slots">Projected starters</button>
      ${lens==='value'?`<label class="la-chk" title="Count owned rookie-pick capital (PICKS column + inside TOTAL)">
        <input type="checkbox" ${laState.cmpPicks?'checked':''} onchange="laState.cmpPicks=this.checked;renderLeagueAnalyzer()"> incl. picks</label>`:''}
      <label class="la-chk" title="Rank on starting lineups only — same filter as the My Team page">
        <input type="checkbox" ${laState.cmpStarters?'checked':''} onchange="laState.cmpStarters=this.checked;renderLeagueAnalyzer()"> starters only</label>
    </div>
    <div class="la-cmp-wrap"><table class="la-cmp">
      <thead><tr><th onclick="laCmpSort('team')" class="la-cmp-team la-cmp-sortable">TEAM${arrow('team')}</th>
        ${POS.map(p=>th(p,p)).join('')}
        ${withPicks?th('picks','PICKS'):''}
        ${th('total','TOTAL')}</tr></thead>
      <tbody>
      ${order.map(({r,i})=>{
        const mine=s.myUserId && r.t.ownerId===s.myUserId;
        const cell=(c,v)=>`<td class="${laQuartile(ranks[c][i],n)}"><b>${fmtV(v)}</b><span class="la-rk">#${ranks[c][i]}</span></td>`;
        return `<tr class="${mine?'mine':''}">
          <td class="la-cmp-team la-clickteam" onclick="laViewTeam(${r.t.rosterId})" title="View ${r.t.teamName}\u2019s analysis">${laTeamIcon(r.t,'la-tm-av-sm')}${mine?'\u2605 ':''}${r.t.teamName}<span class="la-cmp-own">@${r.t.owner}</span></td>
          ${POS.map(p=>cell(p,r.by[p])).join('')}
          ${withPicks?cell('picks',r.picks):''}
          ${cell('total',r.total)}</tr>`;
      }).join('')}
      </tbody></table></div>
    <div class="la-note">${lens==='value'
      ?'Dynasty strength = consolidation-adjusted (stars count full, depth at 75/55/40/30/25%), boosted by dynasty-ECR tier (T1 \u00d715%). TOTAL is the same power score as the My Team page: starters + 35% bench'+(withPicks?' + 50% picks':'')+'. Click any column to sort.'
      :'Projected points = your projection engine, best legal starting lineup per team under this league\u2019s roster slots. TOTAL matches the My Team redraft power score. Click any column to sort.'}</div>`;
}
function laCmpSort(col){
  const sc=laState.cmpSort||(laState.cmpSort={col:'total',dir:-1});
  if(sc.col===col) sc.dir=-sc.dir;
  else { sc.col=col; sc.dir = col==='team'?1:-1; }
  renderLeagueAnalyzer();
}

// ── Best Available: the valued free agents ───────────────────────────────────
// Everyone on the FP chart minus everyone rostered in the snapshot. Sorted by format-aware
// dynasty value, with our projected points alongside so you can spot the "worth little,
// scores plenty" waiver adds that dynasty charts systematically underrate.
function laBestAvailView(s){
  const rostered=new Set();
  s.teamList.forEach(t=>t.players.forEach(p=>rostered.add(ecrNormName(p.name))));
  const pm=laProjMap();
  const dv=(DYNASTY_VALUES&&DYNASTY_VALUES.players)||{};
  const posF=laState.baPos||'ALL';
  const rows=[];
  for(const k in dv){
    if(rostered.has(k)) continue;
    const e=dv[k];
    if(posF!=='ALL' && e.pos!==posF) continue;
    const v=(e.pos==='QB'&&s.superflex&&e.sf!=null)?e.sf
           :(e.pos==='TE'&&s.tep&&e.tep!=null)?e.tep
           :laDynVal(e.n||k, e.pos);
    // e.n = display name (added to the seed builder); older seeds fall back to the norm key.
    rows.push({name:e.n||k, pos:e.pos, team:e.team||'', v:v||0, fpts:pm.get(k+'|'+e.pos)||0});
  }
  rows.sort((a,b)=>b.v-a.v);
  const top=rows.slice(0,60);
  const chips=['ALL','QB','RB','WR','TE'].map(p=>
    `<button class="format-btn ${posF===p?'active':''}" onclick="laState.baPos='${p}';renderLeagueAnalyzer()">${p}</button>`).join('');
  if(!top.length) return `<div class="la-lens">${chips}</div><div class="la-note">No unrostered players on the value chart${posF!=='ALL'?` at ${posF}`:''} — deep league!</div>`;
  return `
    <div class="la-lens"><span class="la-lens-lbl">Position:</span>${chips}</div>
    <div class="la-ba">
      <div class="la-ba-row la-ba-head"><span class="la-ba-rk">#</span><span class="rt-slot" style="visibility:hidden">POS</span>
        <span class="la-ba-name">PLAYER</span><span class="la-ba-team">TM</span>
        <span class="la-ba-val" title="FantasyPros dynasty value (format-aware)">VALUE</span>
        <span class="la-ba-fpts" title="Projected fantasy points from your projections">PROJ</span></div>
      ${top.map((r,i)=>`<div class="la-ba-row">
        <span class="la-ba-rk">${i+1}</span>
        <span class="rt-slot ${slotClass(r.pos)}">${r.pos}</span>
        <span class="clickable-player" onclick="${pcardOnclick(r.name,r.pos,r.team||'')}">${imgTag(hsURL({name:r.name,pos:r.pos}),'player-headshot')}</span>
        <span class="la-ba-name clickable-player" onclick="${pcardOnclick(r.name,r.pos,r.team||'')}">${r.name}</span>
        <span class="la-ba-team">${r.team}</span>
        <span class="la-ba-val">${r.v}</span>
        <span class="la-ba-fpts">${r.fpts?r.fpts.toFixed(0):'–'}</span></div>`).join('')}
    </div>
    <div class="la-note">Free agents = FP value chart minus every rostered player in the snapshot. PROJ is your projection engine under current scoring — a high PROJ on a cheap value is the classic dynasty waiver add.</div>`;
}

// ═══ Phase 3: Trade Calculator + Finder ═══════════════════════════════════════
//
// THE FAIRNESS MODEL — raw sums never decide a trade. Two adjustments:
//
//  1. CONSOLIDATION DISCOUNT. Within a side, assets are sorted best-first and each additional
//     asset counts less: weights 1 / .75 / .55 / .40 / .30, then .25 for everything deeper.
//     Roster spots are scarce and depth is replaceable, so five 18-value players are NOT worth
//     90 — they're worth ~54 here, and they can never buy an 89 no matter how many you stack.
//
//  2. STUD PREMIUM. The side with the single best player gets a bonus of 25% of the gap
//     between the two sides' best assets. Elite players are irreplaceable in a way their
//     value number understates — this is why "Nabers + a real piece ≈ Chase" while
//     "Nabers + scraps" is not, and why a 2-for-1 must overpay a little.
//
//  A trade is FAIR when the effective totals land within max(4 points, 5% of the bigger side).
//  Tune LA_TC_* below to taste — every verdict in the UI flows from these four numbers.
const LA_TC_W    = [1, .75, .55, .40, .30]; // per-asset weights, best-first
const LA_TC_TAIL = .25;                     // weight for the 6th asset onward
const LA_TC_STUD = .55;                     // stud premium: fraction of the best-asset gap
const LA_TC_BAND = (a,b)=>Math.max(4, .05*Math.max(a,b));   // fair window

function laTcAdjusted(vals){
  const s=[...vals].sort((x,y)=>y-x);
  return s.reduce((a,v,i)=>a+v*(LA_TC_W[i]!=null?LA_TC_W[i]:LA_TC_TAIL),0);
}
// Verdict for two sides of raw values. diff>0 → side A gives more (B is winning the trade).
function laTcVerdict(valsA, valsB){
  const adjA=laTcAdjusted(valsA), adjB=laTcAdjusted(valsB);
  const bestA=valsA.length?Math.max(...valsA):0, bestB=valsB.length?Math.max(...valsB):0;
  const effA=adjA + (bestA>bestB ? (bestA-bestB)*LA_TC_STUD : 0);
  const effB=adjB + (bestB>bestA ? (bestB-bestA)*LA_TC_STUD : 0);
  const band=LA_TC_BAND(effA,effB);
  const diff=effA-effB;
  return { adjA:+adjA.toFixed(1), adjB:+adjB.toFixed(1),
           effA:+effA.toFixed(1), effB:+effB.toFixed(1),
           diff:+diff.toFixed(1), band:+band.toFixed(1), fair:Math.abs(diff)<=band };
}

// ── Tradeable assets for one roster: players + owned picks, with stable keys ─
function laAssetPools(s, rosterId){
  const t=s.teamList.find(x=>x.rosterId===rosterId);
  if(!t) return {players:[],picks:[],team:null};
  const players=t.players.map(p=>({
    key:'p|'+ecrNormName(p.name), type:'p', id:p.id, name:p.name, pos:p.pos, team:p.team,
    v:laDynVal(p.name,p.pos)||0,
    age:laDynAge(p.name), posRank:laPosRankOf(s,p.name,p.pos),
  })).sort((a,b)=>b.v-a.v);
  const picks=t.picks.map(pk=>({
    key:`k|${pk.season}|${pk.round}|${pk.origRosterId}`, type:'k',
    season:pk.season, round:pk.round, orig:pk.origRosterId,
    label:`${pk.season} ${pk.round}${['','st','nd','rd','th'][pk.round]||'th'}${pk.origRosterId!==t.rosterId?'*':''}`,
    // MUST match how players are priced two lines up (laDynVal = scaled + tier-boosted).
    // Mixing a raw pick value in here made every pick ~1% of a player's worth, so the
    // calculator happily called "your whole pick chest for my WR3" a fair trade.
    v:Math.round(laPickVal(pk.season,pk.round)),
  }));
  return {players,picks,team:t};
}
function laTradeInit(s){
  if(laState.trade && s.teamList.some(t=>t.rosterId===laState.trade.a)
                   && s.teamList.some(t=>t.rosterId===laState.trade.b)) return;
  const mine=(s.myUserId && s.teamList.find(t=>t.ownerId===s.myUserId)) || s.teamList[0];
  const other=[...s.teamList].filter(t=>t!==mine).sort((a,b)=>laTeamValue(b)-laTeamValue(a))[0];
  laState.trade={ a:mine.rosterId, b:other?other.rosterId:mine.rosterId, giveA:[], giveB:[] };
}
function laTradeSetTeam(side, rosterId){
  laState.trade[side]=+rosterId;
  laState.trade[side==='a'?'giveA':'giveB']=[];   // new team → its give list resets
  renderLeagueAnalyzer();
}
function laTradeToggle(side, key){
  const arr=laState.trade[side==='a'?'giveA':'giveB'];
  const i=arr.indexOf(key);
  if(i>=0) arr.splice(i,1); else arr.push(key);
  renderLeagueAnalyzer();
}
function laTradeClear(){ laState.trade.giveA=[]; laState.trade.giveB=[]; renderLeagueAnalyzer(); }
function laLoadProposal(aId,bId,giveA,giveB){
  laState.trade={a:aId,b:bId,giveA:giveA.slice(),giveB:giveB.slice()};
  renderLeagueAnalyzer();
  const el=document.querySelector('.la-tc-grid'); if(el) el.scrollIntoView({behavior:'smooth',block:'start'});
}

// ── "Even this trade" — smallest additions that land inside the fair window ──
// Candidates come from the SHORT side's remaining assets. Singles first; if no single can
// reach fair, best pairs from that side's top remaining assets. Never suggests scraps-for-a-
// stud: the stud premium is inside laTcVerdict, so a pile of smalls simply won't verdict fair.
function laTcSuggestions(s, pools, give, vals, otherVals, side){
  const inTrade=new Set(give);
  const remaining=[...pools.players,...pools.picks].filter(x=>!inTrade.has(x.key)&&x.v>0);
  const test=(adds)=>{
    const v=laTcVerdict(side==='a'?[...vals,...adds.map(x=>x.v)]:otherVals,
                        side==='a'?otherVals:[...vals,...adds.map(x=>x.v)]);
    return v;
  };
  const singles=remaining.map(x=>({adds:[x], v:test([x])}))
    .sort((p,q)=>Math.abs(p.v.diff)-Math.abs(q.v.diff));
  const out=singles.slice(0,6);
  if(!singles.some(x=>x.v.fair)){
    const top=remaining.slice(0,12), pairs=[];
    for(let i=0;i<top.length;i++) for(let j=i+1;j<top.length;j++){
      pairs.push({adds:[top[i],top[j]], v:test([top[i],top[j]])});
    }
    pairs.sort((p,q)=>Math.abs(p.v.diff)-Math.abs(q.v.diff));
    out.push(...pairs.slice(0,3));
  }
  const fairFirst=out.sort((p,q)=>(q.v.fair-p.v.fair)||(Math.abs(p.v.diff)-Math.abs(q.v.diff)));
  return fairFirst.filter(x=>x.v.fair).slice(0,4);
}

// ── Trade Finder — proposals from MY weaknesses × THEIR strengths ────────────
// Positional capital per team (dynasty values, same aggregation as the Compare tab) ranks me
// at QB/RB/WR/TE. My worst rank = the weakness to fix; my best = the surplus to spend. For
// every league-mate STRONGER than me at my weakness, try my top surplus assets against their
// top assets at my weak position — 1-for-1 first, then my-two-for-their-one (consolidating UP
// pays the stud premium honestly). Only proposals whose verdict is already fair (or one
// suggested add away from fair) survive.
const LA_LANE_LABEL={big:'BIG FISH', mid:'UPGRADE', value:'VALUE', buy:'BREAKOUT'};
const LA_LANE_TIP={
  big:'A top-tier player at your weak spot — the biggest single upgrade, but it costs real assets.',
  mid:'A solid mid-priced starter — moves the needle without gutting another position.',
  value:'A cheap contributor — low cost, low risk; useful depth in a deeper league.',
  buy:'A young player entering their breakout window, priced before the leap.'};
function laTradeFinder(s){
  const POS=['QB','RB','WR','TE'];
  const totals=s.teamList.map(t=>{
    const by={QB:0,RB:0,WR:0,TE:0};
    t.players.forEach(p=>{ const v=laDynVal(p.name,p.pos)||0; if(by[p.pos]!=null) by[p.pos]+=v; });
    return {t,by};
  });
  const mine=totals.find(x=>s.myUserId && x.t.ownerId===s.myUserId) || totals[0];
  const rankAt=(pos,row)=>totals.filter(x=>x.by[pos]>row.by[pos]).length+1;
  const myRanks=POS.map(pos=>({pos, rank:rankAt(pos,mine)}));
  // TARGETING: AUTO derives the target from my weakest league rank; a chip pins it to a
  // position the user chose. When pinned we relax two AUTO-mode rules: partners no longer
  // need to be stronger than me there (maybe I'm hunting an upgrade at a strength), and my
  // give pool widens to my best assets at every OTHER position, not just my single surplus.
  const target = (laState.fndPos && laState.fndPos!=='AUTO') ? laState.fndPos : null;
  const weak = target ? {pos:target, rank:rankAt(target,mine)} : [...myRanks].sort((a,b)=>b.rank-a.rank)[0];
  const strong=[...myRanks].filter(r=>r.pos!==weak.pos).sort((a,b)=>a.rank-b.rank)[0] || weak;
  if(weak.pos===strong.pos) return {weak,strong,proposals:[],targeted:!!target};
  const myPool=laAssetPools(s, mine.t.rosterId);
  const myGive = target
    ? myPool.players.filter(p=>p.pos!==target&&p.v>0).slice(0,6)
    : myPool.players.filter(p=>p.pos===strong.pos).slice(0,4);

  // ── League size shapes the whole strategy ─────────────────────────────────
  // In a shallow league (8-10 teams) the talent pool is concentrated, so the only upgrade
  // that matters is a big fish — starters are already good league-wide. In a deep league
  // (12-14+) the waiver/bench tier is thin, so a cheap ascending player is a real edge and
  // a blockbuster that guts another position is often a net loss. `deep` tilts the mix toward
  // cheaper, roster-friendly gets; `shallow` keeps the big-fish bias.
  const nTeams=s.teamList.length;
  const deep = nTeams>=12, shallow = nTeams<=10;

  // What I'd give up hurts more if it drops me at a position where I'm already thin. Net
  // roster impact = value gained at the weak spot MINUS a penalty for how much the pieces I
  // send weaken their positions relative to the league. A fair-value blockbuster that leaves
  // me WR-poor can score WORSE than a cheap add that costs me nothing I start.
  const posDepth={};   // how many startable-ish bodies I have per position (for cost weighting)
  POS.forEach(pos=>{ posDepth[pos]=myPool.players.filter(p=>p.pos===pos && p.v>0).length; });
  const costPenalty=(giveArr)=>{
    let pen=0;
    giveArr.forEach(g=>{
      if(g.type!=='p') return;                 // picks cost you nothing on the field
      const depth=posDepth[g.pos]||0;
      // giving from a thin position (≤2 bodies) hurts; from a stacked one barely stings
      const scarcity = depth<=2 ? 1.0 : depth===3 ? 0.55 : 0.25;
      pen += g.v * scarcity;
    });
    return pen;
  };
  // A proposal's worth to ME: value in at the weak spot, minus the scarcity-weighted cost of
  // what leaves. Deep leagues weight the cost more (depth is precious); shallow leagues less.
  const impact=(getArr,giveArr)=>{
    const gained=getArr.reduce((a,g)=>a+(g.v||0),0);
    const costW = deep ? 0.55 : shallow ? 0.30 : 0.42;
    return gained - costW*costPenalty(giveArr);
  };

  const proposals=[];
  totals.forEach(row=>{
    if(row===mine) return;
    if(!target && row.by[weak.pos]<=mine.by[weak.pos]) return;  // AUTO: they must be STRONGER where I'm weak
    const theirPool=laAssetPools(s,row.t.rosterId);
    // Their targets at the weak position, split into value tiers so the finder can't fixate
    // only on the big fish: take the top few AND some mid/cheap ones. Deep leagues get more
    // of the cheaper lane; shallow leagues lean big.
    const atPos=theirPool.players.filter(p=>p.pos===weak.pos&&p.v>0).sort((a,b)=>b.v-a.v);
    const bigN = shallow?4:deep?2:3, midN = shallow?1:deep?4:3;
    const gets=[...atPos.slice(0,bigN), ...atPos.slice(bigN, bigN+midN)]
      .filter((x,i,arr)=>arr.indexOf(x)===i);
    gets.forEach(get=>{
      myGive.forEach(g1=>{
        const v1=laTcVerdict([g1.v],[get.v]);
        if(v1.fair){ proposals.push({give:[g1],get:[get],b:row.t,v:v1}); return; }
        if(v1.diff<0){                                    // I'm short → add a second piece of MINE
          myPool.players.concat(myPool.picks).filter(x=>x.key!==g1.key&&x.v>0).slice(0,10).forEach(g2=>{
            const v2=laTcVerdict([g1.v,g2.v],[get.v]);
            if(v2.fair) proposals.push({give:[g1,g2],get:[get],b:row.t,v:v2});
          });
        } else {                                          // I'm overpaying → THEY sweeten instead
          // (this is the "Allen for Bowers + a 2nd" shape: my stud outweighs their piece, so the
          //  fair completion is a sweetener from THEIR remaining assets, not less from me)
          theirPool.players.concat(theirPool.picks).filter(x=>x.key!==get.key&&x.v>0).slice(0,10).forEach(x2=>{
            const v2=laTcVerdict([g1.v],[get.v,x2.v]);
            if(v2.fair) proposals.push({give:[g1],get:[get,x2],b:row.t,v:v2});
          });
        }
      });
    });
  });
  // ── BREAKOUT BUYS — not every trade is a big swing ──────────────────────────
  // The classic dynasty edge: buy players entering their breakout window BEFORE the price
  // moves — 2nd-year TEs/QBs, 3rd-year WRs, young RBs. Candidates: modestly-priced (8-42)
  // players at the target position in that age window, bought with one small asset of mine.
  const LA_BREAKOUT_AGE = {QB:[22,25.5], RB:[21,24.5], WR:[23,26], TE:[22,25.5]};
  const bw=LA_BREAKOUT_AGE[weak.pos];
  const buys=[];
  if(bw){
    // Everything I could part with cheaply, in scale-space (values are chart×100). "Cheap
    // breakout" targets are the low-to-mid of the position — priced BELOW the league median
    // at the spot — who are still in their breakout age window.
    const myAssets=[...myPool.players.filter(x=>x.pos!==weak.pos&&x.v>0),...myPool.picks.filter(x=>x.v>0)]
      .sort((a,b)=>a.v-b.v);
    const medAtPos=(()=>{ const vs=[]; totals.forEach(r=>{ if(r===mine)return;
      laAssetPools(s,r.t.rosterId).players.filter(p=>p.pos===weak.pos&&p.v>0).forEach(p=>vs.push(p.v)); });
      vs.sort((a,b)=>a-b); return vs.length?vs[Math.floor(vs.length/2)]:0; })();
    totals.forEach(row=>{
      if(row===mine) return;
      laAssetPools(s,row.t.rosterId).players
        .filter(c=>c.pos===weak.pos && c.v>0 && c.v<=Math.max(medAtPos, 1))   // below the positional median
        .filter(c=>{ const a=laDynAge(c.name); return a!=null && a>=bw[0] && a<=bw[1]; })
        .slice(0,3)
        .forEach(c=>{
          // Try a single cheap asset first; if my smallest still overpays, look for a fair
          // combo of my two cheapest — a young buy shouldn't require shipping a real player.
          let g=myAssets.find(g1=>laTcVerdict([g1.v],[c.v]).fair);
          if(g){ buys.push({give:[g],get:[c],b:row.t,v:laTcVerdict([g.v],[c.v]),buy:true}); return; }
          for(let i=0;i<Math.min(4,myAssets.length);i++) for(let j=i+1;j<Math.min(6,myAssets.length);j++){
            const vv=laTcVerdict([myAssets[i].v,myAssets[j].v],[c.v]);
            if(vv.fair){ buys.push({give:[myAssets[i],myAssets[j]],get:[c],b:row.t,v:vv,buy:true}); return; }
          }
          // Still can't reach fair with my cheap stuff? Offer my single closest asset anyway —
          // a near-miss breakout buy is worth showing so the reader can adjust it themselves.
          const near=myAssets.map(a=>({a,vv:laTcVerdict([a.v],[c.v])})).sort((x,y)=>Math.abs(x.vv.diff)-Math.abs(y.vv.diff))[0];
          if(near && Math.abs(near.vv.diff) <= c.v*0.35) buys.push({give:[near.a],get:[c],b:row.t,v:near.vv,buy:true});
        });
    });
  }
  proposals.push(...buys);
  const seen=new Set();
  const uniq=proposals.filter(p=>{
    const k=p.b.rosterId+'|'+p.give.map(x=>x.key).sort().join(',')+'>'+p.get.map(x=>x.key).sort().join(',');
    if(seen.has(k)) return false; seen.add(k); return true;
  }).map(p=>({...p, impact:impact(p.get, p.give)}))
    // Best NET improvement first — a cheap add that costs nothing you start can outrank a
    // blockbuster that guts another position. Ties broken by fairness.
    .sort((a,b)=>(b.impact-a.impact)||(Math.abs(a.v.diff)-Math.abs(b.v.diff)));
  // 🔄 variations: instead of always the same top-6, deal a seeded shuffle biased toward the
  // front of the sorted list and toward partner diversity — every press of refresh reseeds.
  let seed=(laState.fndSeed*2654435761)>>>0 || 1;
  const rnd=()=>{ seed^=seed<<13; seed>>>=0; seed^=seed>>17; seed^=seed<<5; seed>>>=0; return seed/4294967296; };
  // Breakout buys ride a separate lane so big swings can't crowd them out entirely:
  // up to 2 guaranteed seats (seed-rotated), the rest sampled from everything.
  // Classify every proposal by the COST of the headline get, so the six shown always span
  // price points instead of all being blockbusters: a "big fish" (top-tier get), a "value"
  // add (mid), and breakout buys. The reader sees a menu, not six versions of the same swing.
  const laneOf=(p)=> p.buy ? 'buy' : (p.get[0].v>=6000 ? 'big' : p.get[0].v>=3000 ? 'mid' : 'value');
  uniq.forEach(p=>{ p.lane=laneOf(p); });
  const buyPool=uniq.filter(x=>x.lane==='buy'), mainPool=uniq.filter(x=>x.lane!=='buy');
  const pool=[...mainPool];
  const picksOut=[]; const usedPartner={}; const usedLane={};
  // Guarantee spread: up to 2 breakout buys and at least one non-"big" (value/mid) seat, so a
  // stack of fair blockbusters can't monopolise the list — the exact thing you flagged.
  for(let k=0;k<Math.min(deep?2:1,buyPool.length);k++){
    picksOut.push(buyPool[(laState.fndSeed+k)%buyPool.length]);
  }
  const cheap=mainPool.filter(p=>p.lane!=='big');
  if(cheap.length){ const c=cheap[laState.fndSeed%cheap.length];
    if(!picksOut.includes(c)){ picksOut.push(c); const i=pool.indexOf(c); if(i>=0) pool.splice(i,1); } }
  while(picksOut.length<6 && pool.length){
    // exponential bias to the front keeps quality high while still rotating variety
    let i=Math.min(pool.length-1, Math.floor(-Math.log(1-rnd())*2.2));
    // light partner-diversity pressure: skip a partner already shown twice if others remain
    let guard=0;
    while(guard++<8 && (usedPartner[pool[i].b.rosterId]||0)>=2 && pool.some(p=>(usedPartner[p.b.rosterId]||0)<2)){
      i=Math.min(pool.length-1, Math.floor(-Math.log(1-rnd())*2.2));
    }
    // Soft cap on blockbusters: once 3 "big" gets are shown, prefer variety if any remains.
    let g2=0;
    while(g2++<8 && pool[i] && pool[i].lane==='big' && (usedLane['big']||0)>=3
          && pool.some(p=>p.lane!=='big')){
      i=Math.min(pool.length-1, Math.floor(-Math.log(1-rnd())*2.2));
    }
    const pr=pool.splice(i,1)[0];
    usedPartner[pr.b.rosterId]=(usedPartner[pr.b.rosterId]||0)+1;
    usedLane[pr.lane]=(usedLane[pr.lane]||0)+1;
    picksOut.push(pr);
  }
  return {weak,strong,proposals:picksOut, total:uniq.length, targeted:!!target,
          deep, shallow, nTeams, myRosterId:mine.t.rosterId};
}

// League-wide positional value ranks, computed live from the snapshot: every rostered player
// at a position, sorted by dynasty value, so "WR14" means 14th-most-valuable WR IN THIS LEAGUE.
// Cached per snapshot (invalidated on re-sync alongside the pick-tier table).
let _laPosRankCache = null;
function laPosRanks(s){
  if(_laPosRankCache) return _laPosRankCache;
  const byPos={};
  s.teamList.forEach(t=>t.players.forEach(p=>{
    const v=laDynVal(p.name,p.pos)||0;
    (byPos[p.pos]=byPos[p.pos]||[]).push({key:ecrNormName(p.name), v});
  }));
  const rank={};
  Object.keys(byPos).forEach(pos=>{
    byPos[pos].sort((a,b)=>b.v-a.v).forEach((x,i)=>{ rank[pos+'|'+x.key]=i+1; });
  });
  const built={rank, counts:Object.fromEntries(Object.keys(byPos).map(k=>[k,byPos[k].length]))};
  // Don't cache an all-zero table (values not loaded yet) — see laTierValueTable.
  if(!Object.keys(rank).length) return built;
  _laPosRankCache=built;
  return _laPosRankCache;
}
// Age tint for the trade rows: amber within a year of the positional cliff, red past it.
// Works straight off the age we already have (LA_AGE_CLIFF is the same table laCliffInfo uses).
function laAgeCliffClass(pos,age){
  const cliff=LA_AGE_CLIFF[pos];
  if(cliff==null || age==null) return 'la-tc-age';
  if(age>=cliff) return 'la-tc-age la-tc-age-past';
  if(age>=cliff-1) return 'la-tc-age la-tc-age-edge';
  return 'la-tc-age';
}
function laPosRankOf(s, name, pos){
  const r=laPosRanks(s); return r.rank[pos+'|'+ecrNormName(name)] || null;
}

// ── Rendering ────────────────────────────────────────────────────────────────
function laAssetRow(x, side, inTrade){
  const btn=`<button class="la-tc-btn ${inTrade?'rm':''}" onclick="laTradeToggle('${side}','${x.key}')">${inTrade?'\u2715':'+'}</button>`;
  if(x.type==='k')
    return `<div class="la-tc-row"><span class="la-pick">${x.label}${x.v?` <b>${x.v}</b>`:''}</span><span class="la-tc-fill"></span>${btn}</div>`;
  return `<div class="la-tc-row">
    <span class="rt-slot ${slotClass(x.pos)}">${x.pos}</span>
    <span class="clickable-player" onclick="${pcardOnclick(x.id||x.name,x.pos,x.team||'')}">${imgTag(hsURL({player_id:x.id,name:x.name,pos:x.pos}),'player-headshot')}</span>
    <span class="la-tc-nmwrap"><span class="share-name clickable-player la-tc-nm" title="${x.name}" onclick="${pcardOnclick(x.id||x.name,x.pos,x.team||'')}">${x.name}</span>
      <span class="la-tc-meta">${x.posRank?`${x.pos}${x.posRank}`:''}${x.age!=null?`${x.posRank?' \u00b7 ':''}<span class="${laAgeCliffClass(x.pos,x.age)}">${x.age.toFixed(0)}yo</span>`:''}</span></span>
    <span class="la-pval">${x.v||'\u2013'}</span>${btn}</div>`;
}
function laTradeView(s){
  laTradeInit(s);
  const tr=laState.trade;
  const poolA=laAssetPools(s,tr.a), poolB=laAssetPools(s,tr.b);
  const all=(p)=>[...p.players,...p.picks];
  const givenA=all(poolA).filter(x=>tr.giveA.includes(x.key));
  const givenB=all(poolB).filter(x=>tr.giveB.includes(x.key));
  const v=laTcVerdict(givenA.map(x=>x.v), givenB.map(x=>x.v));
  const started=givenA.length||givenB.length;
  const sel=(side,cur)=>`<select class="la-tc-sel" onchange="laTradeSetTeam('${side}',this.value)">
    ${s.teamList.map(t=>`<option value="${t.rosterId}" ${t.rosterId===cur?'selected':''}>${s.myUserId&&t.ownerId===s.myUserId?'\u2605 ':''}${t.teamName}</option>`).join('')}</select>`;
  // verdict bar: 50/50 = dead even; the fill leans toward whichever side gives MORE.
  const lean=started ? Math.max(8,Math.min(92, 50 - (v.diff/(v.effA+v.effB||1))*100 )) : 50;
  let verdictTxt='Add assets to both sides';
  if(started){
    const nameA=poolA.team.teamName, nameB=poolB.team.teamName;
    verdictTxt = v.fair ? `\u2696\ufe0f Fair trade <span class="la-vd-sub">(within \u00b1${v.band})</span>`
      : (v.diff>0 ? `<b>${nameB}</b> wins by ${Math.abs(v.diff).toFixed(0)}`
                  : `<b>${nameA}</b> wins by ${Math.abs(v.diff).toFixed(0)}`);
  }
  // even-the-trade suggestions for whichever side is short
  let sugHtml='';
  if(started && !v.fair){
    const shortSide = v.diff>0 ? 'b' : 'a';
    const sugs=laTcSuggestions(s, shortSide==='a'?poolA:poolB, shortSide==='a'?tr.giveA:tr.giveB,
                               (shortSide==='a'?givenA:givenB).map(x=>x.v),
                               (shortSide==='a'?givenB:givenA).map(x=>x.v), shortSide);
    if(sugs.length){
      sugHtml=`<div class="la-sug"><span class="la-sug-lbl">${(shortSide==='a'?poolA:poolB).team.teamName} evens it with:</span>
        ${sugs.map(x=>`<button class="la-sug-chip" onclick="${x.adds.map(a=>`laTradeToggle('${shortSide}','${a.key}')`).join(';')}">
          + ${x.adds.map(a=>a.type==='k'?a.label:a.name).join(' + ')} <b>${x.adds.reduce((t,a)=>t+a.v,0)}</b></button>`).join('')}</div>`;
    } else {
      sugHtml=`<div class="la-sug la-sug-none">No single addition gets this fair \u2014 the gap needs a real piece, not scraps.</div>`;
    }
  }
  // trade finder
  const fnd=laTradeFinder(s);
  const fndHtml = fnd.proposals.length ? fnd.proposals.map(p=>`
    <div class="la-fnd-row">
      <span class="la-fnd-lane la-lane-${p.lane}" title="${LA_LANE_TIP[p.lane]}">${LA_LANE_LABEL[p.lane]}</span>
      <span class="la-fnd-deal">${p.buy?'<span class="la-fnd-gem" title="Breakout-window buy: young player (2nd-yr TE/QB, 3rd-yr WR window) priced before the leap \u2014 small cost, big compounding upside">\ud83d\udc8e</span> ':''}Send <b>${p.give.map(x=>x.type==='k'?x.label:x.name).join(' + ')}</b>
        \u2192 <b>${p.b.teamName}</b> for <b>${p.get.map(x=>x.type==='k'?x.label:x.name).join(' + ')}</b></span>
      <span class="la-fnd-v ${p.v.fair?'ok':''}">${p.v.fair?'fair':(p.v.diff>0?'-':'+')+Math.abs(p.v.diff).toFixed(0)}</span>
      <button class="btn btn-sm btn-ghost" onclick="laLoadProposal(${fnd.myRosterId},${p.b.rosterId},[${p.give.map(x=>`'${x.key}'`).join(',')}],[${p.get.map(x=>`'${x.key}'`).join(',')}])">Load</button>
    </div>`).join('')
    : `<div class="la-note">No fair upgrades found at ${fnd.weak.pos} right now \u2014 nobody stronger there has a piece your surplus can buy evenly.</div>`;
  return `
    <div class="la-tc-grid">
      <div class="la-tc-side">
        <div class="la-tc-head">${sel('a',tr.a)} <span class="la-tc-gives">gives</span></div>
        <div class="la-tc-box">${givenA.length?givenA.map(x=>laAssetRow(x,'a',true)).join(''):'<div class="la-tc-empty">click + below to add</div>'}
          <div class="la-tc-tot">adjusted <b>${started?v.adjA:0}</b>${v.effA!==v.adjA&&started?` \u00b7 with stud premium <b>${v.effA}</b>`:''}</div></div>
        <div class="la-tc-pool">${all(poolA).map(x=>tr.giveA.includes(x.key)?'':laAssetRow(x,'a',false)).join('')}</div>
      </div>
      <div class="la-tc-mid">
        <div class="la-vd-txt">${verdictTxt}</div>
        <div class="la-bar"><div class="la-bar-fill" style="width:${lean}%"></div><div class="la-bar-mid"></div></div>
        <div class="la-tc-mid-lbls"><span>${poolA.team.teamName}</span><span>${poolB.team.teamName}</span></div>
        ${sugHtml}
        ${started?`<button class="btn btn-sm btn-ghost la-tc-clear" onclick="laTradeClear()">clear trade</button>`:''}
      </div>
      <div class="la-tc-side">
        <div class="la-tc-head">${sel('b',tr.b)} <span class="la-tc-gives">gives</span></div>
        <div class="la-tc-box">${givenB.length?givenB.map(x=>laAssetRow(x,'b',true)).join(''):'<div class="la-tc-empty">click + below to add</div>'}
          <div class="la-tc-tot">adjusted <b>${started?v.adjB:0}</b>${v.effB!==v.adjB&&started?` \u00b7 with stud premium <b>${v.effB}</b>`:''}</div></div>
        <div class="la-tc-pool">${all(poolB).map(x=>tr.giveB.includes(x.key)?'':laAssetRow(x,'b',false)).join('')}</div>
      </div>
    </div>
    <div class="la-fnd">
      <div class="la-fnd-title">\ud83d\udd0e Suggested trades for you
        <span class="la-fnd-sub">${fnd.targeted?`targeting <b>${fnd.weak.pos}</b> (you rank #${fnd.weak.rank})`:`weakest: <b>${fnd.weak.pos}</b> (#${fnd.weak.rank} in league)`} \u00b7 paying from: <b>${fnd.targeted?'any position':fnd.strong.pos+' (#'+fnd.strong.rank+')'}</b>${fnd.total?` \u00b7 ${fnd.total} fair deals`:''}
          <span class="la-fnd-size">${fnd.nTeams}-team \u00b7 ${fnd.deep?'deep league \u2014 favouring cheaper, roster-friendly adds':fnd.shallow?'shallow league \u2014 big fish matter most':'balanced mix'}</span></span>
        <span class="la-fnd-chips">${['AUTO','QB','RB','WR','TE'].map(x=>`<button class="format-btn ${laState.fndPos===x?'active':''}" onclick="laState.fndPos='${x}';renderLeagueAnalyzer()" title="${x==='AUTO'?'Target my weakest position automatically':'Hunt deals at '+x}">${x}</button>`).join('')}</span>
        <button class="btn btn-sm btn-ghost la-fnd-refresh" onclick="laState.fndSeed++;renderLeagueAnalyzer()" title="Deal me different variations">\ud83d\udd04 refresh</button></div>
      ${fndHtml}
    </div>
    <div class="la-note">Verdicts use consolidation-adjusted values: extra assets on a side count at 75/55/40/30/25%, and the side holding the single best player gets a premium worth 25% of the best-asset gap \u2014 so a stack of depth can\u2019t buy a stud, but star + real piece can. Fair = within \u00b1max(4, 5%).</div>`;
}

// Switch analyzer tabs. Also scrolls back to the tab bar: these views differ wildly in
// length (a 12-team Rosters grid vs. a short summary), so switching while scrolled down
// otherwise drops you into the middle of the new view with no context.
function laSetTab(k){
  laState.laTab=k;
  renderLeagueAnalyzer();
  const t=document.querySelector('.phase-tabs');
  if(t && t.getBoundingClientRect().top < 0) t.scrollIntoView({block:'start', behavior:'smooth'});
}
// Switch the Team view to any roster ('' → back to my own) and land on that tab.
function laViewTeam(rosterId){
  laState.viewTeam = (rosterId===''||rosterId==null) ? null : +rosterId;
  laState.laTab='myteam';
  renderLeagueAnalyzer();
  const c=document.getElementById('content'); if(c) c.scrollTop=0;
}

// ═══ My Team — the landing view: how MY roster stacks up ═════════════════════
// FantasyPros-Playbook-style analysis of the syncing user's roster: league power rankings,
// per-position and per-starting-slot ranks, a starting-lineup chart, and a strength radar.
// Two lenses (laState.myLens): 'value' = tier-boosted dynasty capital; 'proj' = REDRAFT, i.e.
// this season's points from our own projection engine. Filters: include picks (value lens
// only — picks don't score points), and starters-only (ignore bench capital entirely).

// Per-team engine room: starters (greedy lineup fill under the league's slots), bench, and
// the power score = starters full weight + bench at 35% + picks at 50% (all consolidation-
// adjusted). Tune the LA_PW_* weights; the UI normalizes the league best to 100 like FP.
const LA_PW_BENCH = .35;
const LA_PW_PICKS = .50;
// opts: {picks, startersOnly} — callers outside the My Team page (Compare totals, the
// trajectory engine) pass their own; when omitted we follow the My Team page's checkboxes.
function laTeamEngine(s, t, lens, pm, opts){
  const o = opts || {picks: laState.myPicks, startersOnly: laState.myStarters};
  const val = p => lens==='proj' ? (pm.get(ecrNormName(p.name)+'|'+p.pos)||0) : laDynVal(p.name,p.pos);
  const ranked = t.players.map(p=>({...p, _v:val(p)})).sort((a,b)=>b._v-a._v);
  const filled = laFillStarters(ranked, s.rosterPositions);
  const starterIds = new Set(filled.filter(f=>f.player).map(f=>f.player.id));
  const starters = filled;
  const bench = ranked.filter(p=>!starterIds.has(p.id));
  const pickVals = t.picks.map(pk=>laPickVal(pk.season,pk.round)).filter(v=>v>0);
  const sVals = starters.filter(f=>f.player).map(f=>f.player._v);
  let score = laTcAdjusted(sVals);
  if(!o.startersOnly) score += laTcAdjusted(bench.map(p=>p._v)) * LA_PW_BENCH;
  if(o.picks && lens==='value') score += laTcAdjusted(pickVals) * LA_PW_PICKS;
  const byPos={QB:[],RB:[],WR:[],TE:[]};
  (o.startersOnly ? starters.filter(f=>f.player).map(f=>f.player) : ranked)
    .forEach(p=>{ if(byPos[p.pos]&&p._v>0) byPos[p.pos].push(p._v); });
  // FLEX strength = the players actually starting in flex-type slots (FLEX/SFLX/W-R/W-T) —
  // a real axis of its own: two teams with identical RB/WR rooms can differ a lot in what
  // they can afford to flex after the dedicated slots are filled.
  const flexVals = starters.filter(f=>f.player && FLEX_ELIGIBLE[f.slot]).map(f=>f.player._v);
  return { t, starters, bench, score,
           pos:{QB:laTcAdjusted(byPos.QB), RB:laTcAdjusted(byPos.RB),
                WR:laTcAdjusted(byPos.WR), TE:laTcAdjusted(byPos.TE)},
           flex:laTcAdjusted(flexVals),
           startersAdj:laTcAdjusted(sVals),
           benchAdj:laTcAdjusted(bench.map(p=>p._v)) };
}
// Slot labels with per-position numbering: QB, RB1, RB2, WR1… FLX, SFLX.
function laSlotLabels(rosterPositions){
  const slots=(rosterPositions||[]).filter(x=>x!=='BN'&&x!=='IR'&&x!=='TAXI');
  const seen={}, out=[];
  const short={FLEX:'FLX',SUPER_FLEX:'SFLX',WRRB_FLEX:'W/R',REC_FLEX:'W/T'};
  const counts={};
  slots.forEach(x=>counts[x]=(counts[x]||0)+1);
  slots.forEach(x=>{
    const base=short[x]||x;
    if(counts[x]>1){ seen[x]=(seen[x]||0)+1; out.push(base+seen[x]); }
    else out.push(base);
  });
  return out;
}
function laRankOf(v, all){ return all.filter(x=>x>v+1e-9).length+1; }
function laOrd(n){ return n+(['','st','nd','rd'][(n%100>>3^1)&&n%10]||'th'); }

// Strength radar: two polygons (starters solid, bench faint) over the position axes,
// each axis scaled to the league max so the shape reads "where am I elite vs empty".
function laRadarSVG(axes, mine, benchVals){
  const W=210, cx=W/2, cy=W/2, R=72, N=axes.length;
  const pt=(i,r)=>{ const a=-Math.PI/2+i*2*Math.PI/N; return [(cx+Math.cos(a)*r*R).toFixed(1), (cy+Math.sin(a)*r*R).toFixed(1)]; };
  const ring=r=>`<polygon points="${axes.map((_,i)=>pt(i,r).join(',')).join(' ')}" class="la-rd-ring"/>`;
  const poly=(vals,cls)=>`<polygon points="${vals.map((v,i)=>pt(i,Math.max(.04,v)).join(',')).join(' ')}" class="${cls}"/>`;
  const labels=axes.map((a,i)=>{ const [x,y]=pt(i,1.22); return `<text x="${x}" y="${y}" class="la-rd-lbl">${a}</text>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${W}" class="la-radar">${[.25,.5,.75,1].map(ring).join('')}
    ${axes.map((_,i)=>`<line x1="${cx}" y1="${cy}" x2="${pt(i,1)[0]}" y2="${pt(i,1)[1]}" class="la-rd-ring"/>`).join('')}
    ${poly(benchVals,'la-rd-bench')}${poly(mine,'la-rd-me')}${labels}</svg>`;
}

// ── Team personas ────────────────────────────────────────────────────────────
// Every dynasty roster is somewhere on the contend/rebuild arc, and knowing where is half
// the job. The ladder (rank = power score, value lens, picks included):
//   CONTENDER        top ~25% — win-now moves; picks are for banners.
//   ONE PIECE AWAY   middle, young core, upper half — one real add tips it.
//   ASCENDING        middle + young — risers; buy breakout-window players early.
//   EDGE OF THE CLIFF middle with ≥35% of value on/near positional age-cliffs — push all-in
//                    NOW or sell the vets at peak; waiting is the only wrong answer.
//   1-YR RELOAD      middle/upper, aging but capital-rich — flip vets at peak, reload fast.
//   MULTI-YR REBUILD aging + thinning, or bottom with bones — proper teardown.
//   HARD REBUILD     bottom, old, asset-poor — everything must go.
const LA_TRAJ_TOP = .25, LA_TRAJ_BOT = .25;
const LA_TRAJ_YOUNG = 25.5;
// ── Positional age cliffs — the dynasty concept that drives the personas ────
// Most players fall off hard past these ages (RB yr 6-7, WR yr 7-8, TE 31+, QB 35). A team
// whose value is concentrated in at/near-cliff vets is living on borrowed time no matter what
// its power rank says. EXCEPT: some players are so far past the cliff and still elite (the
// Henry / Kelce / Evans class) that selling at a discount is wrong — those are DEFIERS: still
// valued ≥ LA_CLIFF_DEFIER_V (or tier ≤2) despite being past the line. Advice: just hold.
const LA_AGE_CLIFF = {RB:27.5, WR:29.5, TE:31, QB:35};
const LA_CLIFF_EDGE = 1.0;          // within this many years of the cliff = "on the edge"
const LA_CLIFF_DEFIER_V = 55;       // past-cliff but still worth this much → defier, hold
const LA_TRAJ_CLIFFSHARE = .35;     // % of team value on/past the cliff → "Edge of the Cliff"
// Cliff state for one player: null (no age / no cliff), 'edge', 'past', or 'defier'.
function laCliffInfo(name,pos){
  const cliff=LA_AGE_CLIFF[pos]; if(!cliff) return null;
  const age=laDynAge(name); if(age==null) return null;
  if(age>=cliff){
    const v=laDynVal(name,pos), t=laDynTier(name);
    return {age, cliff, state:(v>=LA_CLIFF_DEFIER_V||(t!=null&&t<=2))?'defier':'past'};
  }
  if(age>=cliff-LA_CLIFF_EDGE) return {age, cliff, state:'edge'};
  return {age, cliff, state:'ok'};
}
// Marker span for player rows: ⚠ near/past the cliff (amber/red), 🛡 defier (hold).
function laCliffMark(name,pos){
  const c=laCliffInfo(name,pos);
  if(!c||c.state==='ok') return '';
  if(c.state==='defier') return `<span class="la-cliff la-cliff-defy" title="Age ${c.age} \u2014 past the ${pos} cliff (~${c.cliff}) yet still elite: a true cliff-defier (Henry/Kelce class). Hold; selling at a discount is the mistake.">\ud83d\udee1</span>`;
  if(c.state==='past')   return `<span class="la-cliff la-cliff-past" title="Age ${c.age} \u2014 at/past the ${pos} age-cliff (~${c.cliff}). Value decays fast from here; the sell window is closing.">\u26a0</span>`;
  return `<span class="la-cliff la-cliff-warn" title="Age ${c.age} \u2014 within a year of the ${pos} age-cliff (~${c.cliff}). Peak sell window is NOW.">\u26a0</span>`;
}
function laDynAge(name){
  const fmt=(leagueSnapshot&&leagueSnapshot.superflex)?'dynasty_superflex':'dynasty';
  const e=ECR&&ECR[fmt]&&ECR[fmt][ecrNormName(name)];
  const a=e&&e.age!=null?parseFloat(e.age):NaN;
  return isNaN(a)?null:a;
}
// Contention is a THIS-YEAR question. A roster of proven-but-aging starters (Henry, Higgins)
// can be a genuine title threat while its dynasty capital — which prices future years — reads
// mid-pack. Ranking personas off capital alone therefore called real contenders "rebuilds".
// So the ladder ranks on a BLEND, weighted toward the season in front of you:
//   nowScore = projected points from the best legal starting lineup under league scoring
//   futScore = dynasty capital (tier-boosted, consolidation-adjusted, incl. picks)
// Both are normalised to the league best (0-1) before blending so the two very different
// units — fantasy points vs chart value — can be compared at all.
const LA_CONTEND_NOW = 0.70;   // weight on this season; the remainder is dynasty capital
function laTrajectories(s, pm){
  const eng=s.teamList.map(t=>laTeamEngine(s,t,'value',pm,{picks:true,startersOnly:false}));
  const engNow=s.teamList.map(t=>laTeamEngine(s,t,'proj',pm,{picks:false,startersOnly:true}));
  const nowById={}; engNow.forEach(e=>nowById[e.t.rosterId]=e.score);
  const maxNow=Math.max(...engNow.map(e=>e.score))||1;
  const maxFut=Math.max(...eng.map(e=>e.score))||1;
  const n=eng.length;
  const maxPick=Math.max(...s.teamList.map(t=>laTcAdjusted(t.picks.map(pk=>laPickVal(pk.season,pk.round)).filter(v=>v>0))))||1;
  const rows=eng.map(e=>{
    const vals=e.t.players.map(p=>({v:laDynVal(p.name,p.pos), age:laDynAge(p.name)})).filter(x=>x.v>0);
    const tot=vals.reduce((a,x)=>a+x.v,0)||1;
    const aged=vals.filter(x=>x.age!=null);
    const coreAge=aged.length?aged.reduce((a,x)=>a+x.v*x.age,0)/aged.reduce((a,x)=>a+x.v,0):null;
    const youth=vals.filter(x=>x.age!=null&&x.age<=25).reduce((a,x)=>a+x.v,0)/tot;
    const pickStr=laTcAdjusted(e.t.picks.map(pk=>laPickVal(pk.season,pk.round)).filter(v=>v>0))/maxPick;
    // Cliff exposure: how much of this roster's VALUE sits on players at/near their
    // positional age-cliff (defiers included — they're still mortal), and how many defiers.
    let cliffVal=0, defiers=0;
    e.t.players.forEach(p=>{ const c=laCliffInfo(p.name,p.pos); if(!c) return;
      if(c.state!=='ok') cliffVal+=laDynVal(p.name,p.pos);
      if(c.state==='defier') defiers++; });
    const cliffShare=cliffVal/tot;
    // now/fut normalised 0-1 vs the league best, then blended. contendScore is the ONLY
    // thing the top/bottom bands rank on.
    const now=(nowById[e.t.rosterId]||0)/maxNow;
    const fut=e.score/maxFut;
    const contendScore=LA_CONTEND_NOW*now + (1-LA_CONTEND_NOW)*fut;
    return {t:e.t, score:e.score, coreAge, youth, pickStr, cliffShare, defiers,
            startersAdj:e.startersAdj, now, fut, contendScore};
  });
  rows.sort((a,b)=>b.contendScore-a.contendScore);
  rows.forEach((r,i)=>{
    const rk=i+1;
    const top = rk<=Math.max(1,Math.round(n*LA_TRAJ_TOP));
    const bot = rk> n-Math.max(1,Math.round(n*LA_TRAJ_BOT));
    const old = (r.coreAge!=null && r.coreAge>=28.0) || r.cliffShare>=LA_TRAJ_CLIFFSHARE;
    const young = r.coreAge!=null && r.coreAge<=LA_TRAJ_YOUNG;
    let title, cls, advice;
    const cliffy = r.cliffShare>=LA_TRAJ_CLIFFSHARE;
    // How this roster splits: strong THIS year vs strong for LATER. The gap is the story —
    // now >> fut is a closing window; fut >> now is a rebuild that's working.
    const nowStrong = r.now>=0.80, nowWeak = r.now<0.60;
    if(top){ title='Contender'; cls='traj-cont';
      advice='You\u2019re built \u2014 capital is for banners now. Push future picks for win-now pieces, buy proven vets on value dips'+(cliffy?' \u2014 but note your cliff exposure: this window is short, so go all-in THIS year.':'.'); }
    else if(bot){
      if(!young && (old || (r.youth<.35 && r.pickStr<.5))){ title='Hard Rebuild'; cls='traj-hard';
        advice='Old and asset-poor at the bottom \u2014 everything movable should move, ESPECIALLY anyone near an age-cliff. Sell for picks and breakout-window youth; the timeline restarts today.'; }
      else { title='Multi-Yr Rebuild'; cls='traj-multi';
        advice='Bottom of the league but the rebuild has bones \u2014 keep stacking picks and sub-25 talent. Do NOT buy aging vets, even cheap ones: a rebuild has no use for players near their cliff.'; }
    }
    else if(cliffy){ title='Edge of the Cliff'; cls='traj-cliff';
      advice=Math.round(100*r.cliffShare)+'% of your value sits on players at or near their positional age-cliff. Either commit to one last all-in push NOW, or sell those vets at peak before the market does it for you \u2014 the one wrong answer is waiting.'; }
    else if(nowStrong){ title='One Piece Away'; cls='traj-1pc';
      advice='Your starters already project like a contender \u2014 you are one real add from the top tier, not a rebuild. Spend a pick or bench depth on the weakest starting slot; do not sell win-now pieces.'; }
    // A young team can rank high on the BLEND purely on future capital — that isn't "one
    // piece away", that's a rebuild working. Require a live lineup this year as well.
    else if(young && !nowWeak && rk<=Math.ceil(n*0.5)){ title='One Piece Away'; cls='traj-1pc';
      advice='Young core already competing \u2014 you\u2019re one real win-now add from the top tier. This is the moment to spend a pick or depth on the missing piece; don\u2019t over-save.'; }
    else if(young){ title='Ascending'; cls='traj-asc';
      advice='Up-and-coming: young vets about to level up. Hold your risers, and buy OTHER teams\u2019 breakout-window players (2nd-yr TE/QB, 3rd-yr WR) before their price moves. A couple of key adds here compound fast.'; }
    else if(rk<=Math.ceil(n*0.5)){ title='1-Yr Reload'; cls='traj-1yr';
      advice='Aging core but real capital \u2014 flip veterans at peak value NOW and one aggressive offseason puts you right back in it.'; }
    else if(!nowWeak){ title='1-Yr Reload'; cls='traj-1yr';
      advice='Middling on both clocks but your lineup is live \u2014 one aggressive move at your worst starting slot swings the season. Sell the aging depth, not the starters.'; }
    else { title='Multi-Yr Rebuild'; cls='traj-multi';
      advice='Aging core and thinning capital \u2014 a proper teardown beats treading water. Move the vets (mind the cliffs), hoard picks, get young.'; }
    r.rank=rk; r.title=title; r.cls=cls; r.advice=advice;
  });
  const byId={}; rows.forEach(r=>byId[r.t.rosterId]=r);
  return byId;
}

function laMyTeamView(s){
  const lens=laState.myLens||'value';
  const pm=laProjMap();
  const eng=s.teamList.map(t=>laTeamEngine(s,t,lens,pm));
  // The team on screen: laState.viewTeam when set, else my own, else the first roster. Every
  // chart below reads mineEng, so this one line is what makes the whole view switchable.
  const ownEng=eng.find(e=>s.myUserId && e.t.ownerId===s.myUserId) || eng[0];
  const mineEng=(laState.viewTeam!=null && eng.find(e=>e.t.rosterId===laState.viewTeam)) || ownEng;
  const isOwn = mineEng===ownEng;
  const traj=laTrajectories(s,pm);
  const myTraj=traj[mineEng.t.rosterId];
  const maxScore=Math.max(...eng.map(e=>e.score))||1;
  const power=[...eng].sort((a,b)=>b.score-a.score);
  const POS=['QB','RB','WR','TE'];
  // Per-slot values across the league → my rank at every starting slot.
  const slotLabels=laSlotLabels(s.rosterPositions);
  const slotVals=slotLabels.map((_,i)=>eng.map(e=>(e.starters[i]&&e.starters[i].player)?e.starters[i].player._v:0));
  const switcher=`
    <div class="la-switch">
      <select class="la-tc-sel la-switch-sel" onchange="laViewTeam(this.value)">
        ${[...s.teamList].sort((a,b)=>{
            if(s.myUserId){ if(a.ownerId===s.myUserId) return -1; if(b.ownerId===s.myUserId) return 1; }
            return a.teamName.localeCompare(b.teamName);
          }).map(t=>`<option value="${t.rosterId}" ${t.rosterId===mineEng.t.rosterId?'selected':''}>${s.myUserId&&t.ownerId===s.myUserId?'\u2605 ':''}${t.teamName}</option>`).join('')}
      </select>
      ${!isOwn?`<button class="btn btn-sm btn-ghost" onclick="laViewTeam('')" title="Back to your own team">\u21a9 my team</button>`:''}
    </div>`;
  const controls=`
    <div class="la-lens">
      <span class="la-lens-lbl">Lens:</span>
      <button class="format-btn ${lens==='value'?'active':''}" onclick="laState.myLens='value';renderLeagueAnalyzer()" title="Dynasty capital: tier-boosted FantasyPros values, consolidation-adjusted">Dynasty value</button>
      <button class="format-btn ${lens==='proj'?'active':''}" onclick="laState.myLens='proj';renderLeagueAnalyzer()" title="Redraft: this season's projected points from YOUR projections">Redraft (proj)</button>
      <label class="la-chk ${lens==='proj'?'la-chk-off':''}" title="Count owned rookie picks toward power scores (dynasty lens only — picks don't score points)">
        <input type="checkbox" ${laState.myPicks?'checked':''} ${lens==='proj'?'disabled':''} onchange="laState.myPicks=this.checked;renderLeagueAnalyzer()"> incl. picks</label>
      <label class="la-chk" title="Rank on starting lineups only — ignore bench capital">
        <input type="checkbox" ${laState.myStarters?'checked':''} onchange="laState.myStarters=this.checked;renderLeagueAnalyzer()"> starters only</label>
    </div>`;
  const powerTbl=`
    <div class="la-my-card"><div class="la-my-title">Power Rankings</div>
      <table class="la-pw"><thead><tr><th>RK</th><th>TEAM</th><th>SCORE</th></tr></thead><tbody>
      ${power.map((e,i)=>`<tr class="${e===mineEng?'mine':''}">
        <td class="la-pw-rk">${i+1}.</td>
        <td class="la-pw-team la-clickteam" onclick="laViewTeam(${e.t.rosterId})" title="View ${e.t.teamName}\u2019s analysis">${laTeamIcon(e.t,'la-tm-av-sm')}${e.t.teamName}
          <span class="la-traj ${traj[e.t.rosterId].cls}" title="${traj[e.t.rosterId].advice}">${traj[e.t.rosterId].title}</span>
          <span class="la-cmp-own">@${e.t.owner}</span></td>
        <td class="la-pw-score"><div class="la-pw-bar" style="width:${(100*e.score/maxScore).toFixed(0)}%"></div><b>${Math.round(100*e.score/maxScore)}</b></td></tr>`).join('')}
      </tbody></table></div>`;
  const posRows=[...POS.map(pos=>({lbl:pos, mine:mineEng.pos[pos], all:eng.map(e=>e.pos[pos])})),
    {lbl:'STARTERS', mine:mineEng.startersAdj, all:eng.map(e=>e.startersAdj)},
    {lbl:'BENCH', mine:mineEng.benchAdj, all:eng.map(e=>e.benchAdj)}];
  const posTbl=`
    <div class="la-my-card"><div class="la-my-title">Positional Rankings</div>
      ${posRows.map(r=>{ const rank=laRankOf(r.mine,r.all), n=eng.length, mx=Math.max(...r.all)||1;
        return `<div class="la-pr-row"><span class="la-pr-lbl">${r.lbl}</span>
          <div class="la-pr-track"><div class="la-pr-bar ${laQuartile(rank,n)}" style="width:${Math.max(4,100*r.mine/mx).toFixed(0)}%"></div></div>
          <span class="la-pr-rank">${laOrd(rank)}</span></div>`; }).join('')}
    </div>`;
  const slotTbl=`
    <div class="la-my-card"><div class="la-my-title">Starter Rankings</div>
      ${slotLabels.map((lbl,i)=>{ const vals=slotVals[i];
        const mp=(mineEng.starters[i]&&mineEng.starters[i].player)||null;
        const mineV=mp?mp._v:0;
        const rank=laRankOf(mineV,vals), n=eng.length, mx=Math.max(...vals)||1;
        return `<div class="la-pr-row"><span class="la-pr-lbl">${lbl}</span>
          ${mp?`<span class="la-pr-nm clickable-player" title="${mp.name}" onclick="${pcardOnclick(mp.id||mp.name,mp.pos,mp.team||'')}">${abbrevName(mp.name)}</span>`:`<span class="la-pr-nm la-pr-empty">\u2014</span>`}
          <div class="la-pr-track"><div class="la-pr-bar ${laQuartile(rank,n)}" style="width:${Math.max(4,100*mineV/mx).toFixed(0)}%"></div></div>
          <span class="la-pr-rank">${laOrd(rank)}</span></div>`; }).join('')}
    </div>`;
  // Starting-lineup chart: my starters as columns, height = my slot value vs league max.
  const lineup=`
    <div class="la-my-card la-my-wide"><div class="la-my-title">Starting Lineup</div>
      <div class="la-lu">
      ${slotLabels.map((lbl,i)=>{ const f=mineEng.starters[i]; const p=f&&f.player;
        const vals=slotVals[i]; const mx=Math.max(...vals)||1;
        const v=p?p._v:0; const rank=laRankOf(v,vals);
        // Height encodes the league RANK at this slot (1st = full, last = stub) — a #1 WR2
        // reads tall even in a league where WR2 values are globally modest.
        const h=Math.max(12, 100*(eng.length-rank+1)/eng.length);
        return `<div class="la-lu-col">
          <span class="la-lu-rk">#${rank}</span>
          <div class="la-lu-bar ${laQuartile(rank,eng.length)}" style="height:${h.toFixed(0)}%"></div>
          ${p?`<span class="clickable-player" onclick="${pcardOnclick(p.id||p.name,p.pos,p.team||'')}">${imgTag(hsURL({player_id:p.id,name:p.name,pos:p.pos}),'la-lu-hs')}</span>`
             :`<span class="la-lu-hs la-lu-empty">\u2014</span>`}
          <span class="la-lu-lbl" title="${p?p.name:'empty'}">${lbl}</span></div>`; }).join('')}
      </div></div>`;
  // Radar: starters vs bench strength per position, scaled to league max per axis. FLEX is
  // its own axis when the league starts flex slots: starters = who's actually IN the flex
  // slots; bench = flex-eligible reserves (best RB/WR/TE depth that could step into flex).
  const posAxes=POS.filter(p=>eng.some(e=>e.pos[p]>0));
  const hasFlex=eng.some(e=>e.flex>0);
  const axes=hasFlex ? [...posAxes,'FLEX'] : posAxes;
  const flexElig=(()=>{ const set=new Set();
    (s.rosterPositions||[]).forEach(sl=>{ (FLEX_ELIGIBLE[sl]||[]).forEach(pp=>set.add(pp)); });
    return set.size?set:new Set(['RB','WR','TE']); })();
  const maxPos={}; posAxes.forEach(p=>maxPos[p]=Math.max(...eng.map(e=>e.pos[p]))||1);
  if(hasFlex) maxPos.FLEX=Math.max(...eng.map(e=>e.flex))||1;
  const meAx=axes.map(p=>{
    if(p==='FLEX') return Math.min(1, mineEng.flex/maxPos.FLEX);
    const st=laTcAdjusted(mineEng.starters.filter(f=>f.player&&f.player.pos===p).map(f=>f.player._v));
    return Math.min(1, st/maxPos[p]); });
  const bnAx=axes.map(p=>{
    if(p==='FLEX'){ const bn=laTcAdjusted(mineEng.bench.filter(x=>flexElig.has(x.pos)).map(x=>x._v));
      return Math.min(1, bn/maxPos.FLEX); }
    const bn=laTcAdjusted(mineEng.bench.filter(x=>x.pos===p).map(x=>x._v));
    return Math.min(1, bn/maxPos[p]); });
  const radar=`
    <div class="la-my-card"><div class="la-my-title">Position Strength <span class="la-rd-key"><i class="la-rd-k-me"></i>starters <i class="la-rd-k-bn"></i>bench</span></div>
      ${laRadarSVG(axes, meAx, bnAx)}</div>`;
  const summary=`
    <div class="la-my-sum">
      ${laTeamIcon(mineEng.t,'la-tm-av')}
      <div class="la-my-sum-body">
        <div class="la-my-sum-head">${mineEng.t.teamName} \u00b7 <span class="la-traj ${myTraj.cls}">${myTraj.title}</span></div>
        <div class="la-my-sum-line">#${myTraj.rank} in dynasty capital${myTraj.coreAge?` \u00b7 core age <b>${myTraj.coreAge.toFixed(1)}</b>`:''}
          \u00b7 <b>${Math.round(100*myTraj.youth)}%</b> of value age \u226425
          \u00b7 <b class="${myTraj.cliffShare>=LA_TRAJ_CLIFFSHARE?'la-cliff-hot':''}">${Math.round(100*myTraj.cliffShare)}%</b> on the age-cliff${myTraj.defiers?` (${myTraj.defiers} defier${myTraj.defiers>1?'s':''} \ud83d\udee1)`:''}
          \u00b7 pick chest <b>${Math.round(100*myTraj.pickStr)}%</b> of league best</div>
        <div class="la-my-sum-adv">${myTraj.advice}</div>
      </div></div>`;
  return switcher + controls + summary
    + `<div class="la-my-grid">${powerTbl}${posTbl}${slotTbl}${radar}${lineup}</div>`
    + `<div class="la-note">${lens==='value'
        ? 'Dynasty lens: tier-boosted FantasyPros values (T1 \u00d71.15), consolidation-adjusted \u2014 stars carry, depth decays. Power score = starters + 35% bench'+(laState.myPicks?' + 50% picks':'')+', league best = 100.'
        : 'Redraft lens: this season\u2019s projected points from your own projection engine under this league\u2019s scoring. Picks excluded (they don\u2019t score).'}</div>`;
}
