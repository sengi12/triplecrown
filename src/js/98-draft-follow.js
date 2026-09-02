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
  const s=scoringSettings;
  // A yardage rate of EXACTLY ZERO means the league awards no points for those yards, which
  // "yards per point" cannot express (there is no divisor that yields 0). The model already
  // carries a separate multiplier for this — *_yards_points — so zero the multiplier instead
  // and leave the divisor alone. Sleeper always sends a non-zero rate, so this only fires for
  // providers that can express "not scored" (ESPN omits the stat entirely; see
  // espnScoringToSleeper, which turns an omission into an explicit 0).
  const setYdg=(v, ydgKey, ptsKey)=>{
    const n=Number(v);
    if(!isFinite(n)) return;
    if(n>0){ s[ydgKey]=clean(1/n); s[ptsKey]=1; }
    else   { s[ptsKey]=0; }
  };
  // Passing
  if(sc.pass_yd!=null) setYdg(sc.pass_yd, 'passing_yards_yardage', 'passing_yards_points');
  if(sc.pass_td!=null) s.passing_touchdowns = num(sc.pass_td, s.passing_touchdowns);
  if(sc.pass_int!=null) s.interceptions_thrown = num(sc.pass_int, s.interceptions_thrown);
  if(sc.pass_att!=null) s.passing_attempts = num(sc.pass_att, s.passing_attempts);
  if(sc.pass_cmp!=null) s.passing_completions = num(sc.pass_cmp, s.passing_completions);
  // Rushing
  if(sc.rush_yd!=null) setYdg(sc.rush_yd, 'rushing_yards_yardage', 'rushing_yards_points');
  if(sc.rush_td!=null) s.rushing_touchdowns = num(sc.rush_td, s.rushing_touchdowns);
  if(sc.rush_att!=null) s.rushing_attempts = num(sc.rush_att, s.rushing_attempts);
  // Receiving
  if(sc.rec_yd!=null) setYdg(sc.rec_yd, 'receiving_yards_yardage', 'receiving_yards_points');
  if(sc.rec_td!=null) s.receiving_touchdowns = num(sc.rec_td, s.receiving_touchdowns);
  if(sc.rec!=null) s.receptions = num(sc.rec, s.receptions);
  // TE Premium. Sleeper models this as a BONUS per TE reception (bonus_rec_te), not a
  // replacement value — a 1.5-PPR-TE league arrives as rec:1 + bonus_rec_te:0.5.
  if(sc.bonus_rec_te!=null) s.receptions_te_bonus = num(sc.bonus_rec_te, s.receptions_te_bonus);
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
  // One /state/nfl probe app-wide: delegate to the shared TC_SEASON sync (deduped + TTL'd).
  try{ await syncProjSeasonFromSleeper(); }catch(e){}
  return String(TC_SEASON.year);
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
  return linkLeagueObject(lg);
}
// One-tap path from the League Analyzer's synced league: fetch the league object by id and
// run it through the exact same link flow the picker uses.
async function linkSnapshotLeagueDraft(){
  const snap=(typeof leagueSnapshot!=='undefined')?leagueSnapshot:null;
  if(!snap || snap.provider==='espn' || !snap.leagueId){ toast('No synced Sleeper league to link','err'); return; }
  leaguePickerState.loading=true; renderRankings();
  try{
    const lg=await sleeperFetch(LA_LEAGUE_URL(snap.leagueId));
    if(!lg || !lg.league_id){ leaguePickerState.loading=false; toast('Could not load the synced league','err'); renderRankings(); return; }
    return linkLeagueObject(lg);
  }catch(e){ leaguePickerState.loading=false; toast('Could not load the synced league','err'); renderRankings(); }
}
async function linkLeagueObject(lg){
  leaguePickerState.loading=true; renderRankings();
  const { draftId:did, status, scoringType }=await resolveLeagueDraft(lg);
  leaguePickerState.loading=false;
  if(!did){ toast(`No draft found for "${lg.name}"`,'err'); renderRankings(); return; }

  // Adopt the league's SHAPE (roster slots + size) up front, before any early return.
  // This is what VOR baselines read, and it must survive the "draft already complete" path —
  // a finished league still tells us it starts 3 WRs in a 10-team league.
  if(Array.isArray(lg.roster_positions) && lg.roster_positions.length){
    const { lineup, bench } = lineupFromRosterPositions(lg.roster_positions);
    leagueShape = {
      teams: lg.total_rosters || (lg.settings && lg.settings.num_teams) || 12,
      lineup, bench,
    };
    draftLineup = lineup; draftBenchCount = bench;
  }

  // Adopt the league's scoring + format regardless of whether the draft is followable —
  // even a completed-draft league is useful to score your rankings the way that league does.
  // Remember the league for the League Analyzer: its setup screen offers a one-click
  // "sync the league you linked here" instead of asking for the username again.
  window._laLinkedLeague = { id: lg.league_id, name: lg.name };
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
  hideDrafted=true;          // fresh follow: a clean board by default — untick to see everyone
  startDraftFollow(false);   // league scoring/format already applied above
  toast(`Linked to ${lg.name} · ${formatLabel(fmt)} scoring applied ✓`,'ok');
}

// Render the league-picker panel (username input, then the list of the user's leagues).
function renderLeaguePicker(){
  const st=leaguePickerState;
  const head=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <b style="font-size:13px">${TC_ICON("link")} Link a Sleeper league</b>
      <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="closeLeaguePicker()">✕</button>
    </div>`;
  const errRow = st.error?`<div class="lp-error">${st.error}</div>`:'';

  // Stage 1: ask for username (shown until we have a resolved user with leagues).
  if(!st.user){
    // The League Analyzer already knows this user's league — offer it first, and at minimum
    // carry the username over so nobody types it twice.
    const snap=(typeof leagueSnapshot!=='undefined')?leagueSnapshot:null;
    const syncedRow=(snap && snap.provider!=='espn' && snap.leagueId)
      ? `<button class="lp-league lp-synced" ${st.loading?'disabled':''} onclick="linkSnapshotLeagueDraft()">
           ${typeof laLeagueIcon==='function'?laLeagueIcon(snap,'lp-lg-avatar'):''}
           <div class="lp-lg-main">
             <div class="lp-lg-name">★ ${escHtml(snap.name||'Your synced league')}</div>
             <div class="lp-lg-meta">synced in the League Analyzer · link its draft</div>
           </div>
           <span class="lp-lg-go">Link →</span>
         </button>`
      : '';
    const prefill=(snap && snap.provider!=='espn' && snap.username) ? escAttr(snap.username) : '';
    return `<div class="lp-panel">${head}
      ${syncedRow}
      <div class="lp-row">
        <input id="lpUsername" class="lp-input" type="text" placeholder="Your Sleeper username" value="${prefill}"
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
  hideDrafted=true;         // fresh follow: a clean board by default
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
    if(!d || !d.draft_id){ toast('That draft ID returned nothing — double-check it','err'); return; }
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
    // Mirror the draft's shape onto leagueShape so VOR keeps a correct board even after
    // the follow stops (draftId clears, but the league's shape is still the truth).
    if(gotLineup){
      leagueShape = {
        teams: (d.settings && d.settings.teams) || (leagueShape && leagueShape.teams) || 12,
        lineup: draftLineup.slice(), bench: draftBenchCount,
      };
    }
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
  // Who OWNS the pick, not which column it sits in. In a dynasty rookie draft a traded pick
  // keeps its original draft_slot, so the player was credited to the team that traded it
  // away. Sleeper stamps roster_id on the pick; map it back through slot_to_roster_id
  // (roster → the slot that owner drafts from) and fall back to the column for mocks.
  const rosterToSlot={};
  const s2r=(typeof draftMeta!=='undefined' && draftMeta && draftMeta.slot_to_roster_id) || null;
  if(s2r){ for(const sl in s2r){ if(s2r[sl]!=null) rosterToSlot[String(s2r[sl])]=Number(sl); } }
  (picks||[]).forEach(p=>{
    let slot=p.draft_slot;
    if(p.roster_id!=null && rosterToSlot[String(p.roster_id)]!=null) slot=rosterToSlot[String(p.roster_id)];
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

var _draftFollowGen = 0;   // bumped by every start AND stop — stale async starts abort
async function startDraftFollow(applyScoring){
  const gen = ++_draftFollowGen;
  if(draftTimer){ clearInterval(draftTimer); draftTimer=null; }
  // A draft is drafted off the PROJECTION board. Following one from a reference season
  // left the LIVE bar over last year's actual-stat rankings, with no pick ever marked.
  if(activeSeason!=='proj' && typeof loadSeason==='function'){
    try{ await loadSeason('proj'); }catch(e){}
  }
  _lastPickCount = -1;   // force the first poll to render
  await loadDraftMeta(applyScoring);   // draft_order, lineup, usernames, my-slot detection, (opt) scoring
  // Another start superseded us, or Stop was clicked while we awaited — do not resurrect.
  if(gen!==_draftFollowGen || !draftId) return;
  // The room's past drafts, loaded behind the follow (never blocking it): they
  // seed the drift prior and the plan header. Summaries cache locally, so this
  // is one cheap fetch per league after the first time.
  roomHistory=null;
  if(draftMeta && draftMeta.league_id) loadRoomHistory(draftMeta.league_id);
  rosterBarVisible=true;
  await pollDraft();
  if(gen!==_draftFollowGen || !draftId) return;
  _draftDone=false; _pollFails=0;
  draftTimer=setInterval(pollDraft, 2500); // poll every 2.5s for lower latency on the board
  if(typeof saveSession==='function') saveSession();   // survive a mid-draft reload
  toast(`Following draft ${draftId} ✓`,'ok');
  if(currentPhase==='Rankings') renderRankings();
  renderRosterBar();
}
function stopDraftFollow(){
  _draftFollowGen++;
  if(draftTimer){clearInterval(draftTimer);draftTimer=null;}
  draftId=null; draftedIds={}; _draftDone=false; roomHistory=null;
  hideDrafted=false;               // don't resurface pre-checked on the next follow
  _vonaCache={key:null,val:null};
  draftMeta=null; draftPicksBySlot={}; draftUsers={}; mySlot=null;
  draftLineup=DEFAULT_LINEUP.slice(); draftBenchCount=DEFAULT_BENCH;
  rosterBarVisible=false; trackerOpen=false; trackerMax=false; trackerViewSlot=null; _trackerNeedsSlotPick=false;
  draftBannerOpen=false;
  toast('Stopped following draft','ok');
  renderRosterBar();
  if(currentPhase==='Rankings') renderRankings();
}
var _draftDone=false, _pollFails=0, _pollInFlight=false;
// A backgrounded phone kept polling Sleeper every 2.5s for the tab's whole lifetime.
// Pause while hidden, poll immediately + resume on return (mirrors laLivePollSync).
if(typeof document!=='undefined' && document.addEventListener){
  document.addEventListener('visibilitychange', ()=>{
    if(!draftId || _draftDone) return;
    if(document.visibilityState==='hidden'){
      if(draftTimer){ clearInterval(draftTimer); draftTimer=null; }
    } else if(!draftTimer){
      pollDraft();
      draftTimer=setInterval(pollDraft, 2500);
    }
  });
}
async function pollDraft(){
  if(!draftId || _pollInFlight) return;
  _pollInFlight=true;
  try{
    const picks=await sleeperFetch(SLEEPER_PICKS_URL(draftId));
    _pollFails=0;
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
    // Draft complete: every slot of every round is in. Stop hammering the API (the banner
    // used to say LIVE forever and poll for the tab's whole lifetime), keep the tracker and
    // drafted marks for review.
    if(!_draftDone){
      const dp=draftParams();
      if(dp && dp.teams>0 && dp.rounds>0 && pickCount >= dp.teams*dp.rounds){
        _draftDone=true;
        if(draftTimer){ clearInterval(draftTimer); draftTimer=null; }
        toast('Draft complete ✓ — board and rosters kept for review','ok');
        if(currentPhase==='Rankings') renderRankings();
        renderRosterBar();
      }
    }
  }catch(e){
    if(typeof TC_DEV_MODE!=='undefined' && TC_DEV_MODE)
      try{ console.warn('[pollDraft]', e); }catch(_e){}
    // Surface a persistent outage ONCE (a typo'd id or lost connection used to poll a 404
    // silently forever), then keep trying quietly — drafts outlive brief outages.
    if(++_pollFails===8) toast('Draft feed unreachable — check the draft ID / connection. Still retrying…','err');
  }
  finally{ _pollInFlight=false; }
}
// Per-position "who else is out there" popover — the advisory names ONE guy; this shows the
// shelf behind him so the pick is a choice, not a leap of faith.
var _vonaPopOff=null;
function vonaOptionsPop(ev, pos){
  try{ ev.stopPropagation(); }catch(e){}
  const old=document.getElementById('vonaOptPop');
  if(old){
    old.remove();
    if(_vonaPopOff){ try{ document.removeEventListener('click',_vonaPopOff,true); }catch(e){} _vonaPopOff=null; }
    if(old.dataset && old.dataset.pos===pos) return;   // same button again = toggle closed
  }
  const v=(typeof activeSeason==='undefined' || activeSeason==='proj') ? computeVONA() : null;
  if(!v || !v.pools || !v.pools[pos] || !v.pools[pos].length){ toast('No available players left at '+pos,'err'); return; }
  const pidOf=(p)=>p.player_id||p.name;
  const pct=(x)=>Math.round((x||0)*100);
  const pcls=(x)=> x>=0.6 ? 'vp-hi' : (x>=0.3 ? 'vp-mid' : 'vp-lo');
  const rows=v.pools[pos].slice(0,12).map((p,i)=>{
    const pa=v.pAvail && v.pAvail.get ? v.pAvail.get(pidOf(p)) : null;
    const noAdp = typeof adpFor==='function' && adpFor(p)>=999;
    const open=(typeof pcardOnclick==='function')?`onclick="event.stopPropagation();${pcardOnclick(p.player_id||p.name,p.pos,p.team||'')}"`:'';
    return `<div class="vona-opt clickable-player" ${open} title="${escAttr(p.name)} — open player card">
      <span class="vona-opt-rank">${i+1}</span>
      ${playerThumb(p)}
      <div class="vona-opt-main">
        <div class="vona-opt-name">${escHtml(p.name)}${typeof tcInjuryTag==='function'?tcInjuryTag(p.player_id):''}</div>
        <div class="vona-opt-sub">${escHtml(p.team||'FA')}${p.ecr!=null?` · ECR ${p.ecr}`:''}</div>
      </div>
      <span class="vona-vor">${(p.vor||0)>0?'+':''}${(p.vor||0).toFixed(0)}</span>
      ${pa!=null?`<span class="vona-pct ${pcls(pa)}" title="${noAdp?'No market ADP for this player \u2014 the availability model can\u2019t see him':'Chance they\u2019re still on the board at your next pick'}">${_vonaPctDisp(p,pa)}%</span>`:''}
    </div>`;
  }).join('');
  const div=document.createElement('div');
  div.id='vonaOptPop'; div.className='vona-opt-pop';
  if(div.dataset) div.dataset.pos=pos;
  div.innerHTML=`<div class="vona-opt-head"><span class="rt-slot ${slotClass(pos)}">${pos}</span>
      <span class="vona-opt-title">Next up at ${pos}</span>
      <span class="vona-opt-key">VOR · % still there at your pick</span>
      <button class="vona-opt-close" onclick="this.closest('.vona-opt-pop').remove()" aria-label="Close">✕</button></div>
    <div class="vona-opt-list">${rows}</div>`;
  document.body.appendChild(div);
  const r=(ev.target&&ev.target.getBoundingClientRect)?ev.target.getBoundingClientRect():{left:20,right:320,top:100,bottom:120};
  const pw=div.offsetWidth||300, ph=div.offsetHeight||200;
  const {vw, vh}=tcViewportSize();
  div.style.left=Math.max(8, Math.min(vw-pw-8, r.right-pw))+'px';
  div.style.top=(r.top-ph-8>8 ? r.top-ph-8 : Math.max(8, Math.min(vh-ph-8, r.bottom+8)))+'px';
  setTimeout(()=>{ const off=(e)=>{
      if(e.target && e.target.closest && e.target.closest('.vona-more')) return;  // the buttons manage their own toggle
      if(e.target && e.target.closest && e.target.closest('.pcard-overlay')) return;  // browsing a card (incl. closing it) keeps the list
      if(!div.contains(e.target)){ div.remove(); document.removeEventListener('click',off,true); if(_vonaPopOff===off) _vonaPopOff=null; } };
    _vonaPopOff=off; document.addEventListener('click',off,true); },0);
}
// The follow banner starts as a lone glowing LIVE pill; tapping it expands the detail
// (draft id, picks made, your seat, hide-drafted, Stop) and tapping again re-collapses.
let draftBannerOpen=false;
function toggleDraftBanner(){
  draftBannerOpen=!draftBannerOpen;
  if(typeof renderRankings==='function' && currentPhase==='Rankings') renderRankings();
}
function toggleHideDrafted(){ hideDrafted=!hideDrafted; renderRankings(); }

// ── Roster tracker: UI ──────────────────────────────────────────────────────
// "Amon-Ra St. Brown" → "A. St. Brown". Compound surnames (St., Van, De, Mc…) and suffixes
// ride along with the last name, so we only ever initialise the FIRST token.
function abbrevName(full){
  const parts=(full||'').trim().split(/\s+/);
  if(parts.length<2) return full||'';
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}
// Sleeper headshot in a fixed circle. The wrapper keeps its shape if the image 404s (rookies
// and practice-squad guys often have none), so rows never jump.
function playerThumb(p){
  const pid = p && p.player_id;
  const hp = (typeof hsPack==='function') ? hsPack({player_id:pid, name:(p&&p.name)||'', pos:(p&&p.pos)||'', team:(p&&p.team)||''}) : {src:(pid?SLEEPER_HEADSHOT(pid):''), fallbacks:[]};
  return `<span class="rt-thumb">${pid
    ? `<img src="${hp.src||''}" alt="" loading="lazy" data-fallbacks="${(hp.fallbacks||[]).join('|')}" onerror="const l=(this.dataset.fallbacks||'').split('|').filter(Boolean);if(l.length){this.dataset.fallbacks=l.slice(1).join('|');this.src=l[0];}else{this.style.display='none';}">`
    : ''}</span>`;
}
// A roster row's player cell: photo + full name (with an abbreviated variant CSS swaps in when
// the panel is too narrow) + position/team.
function playerCell(p){
  // The thumbnail + name open the player card. During a live draft this is the natural place
  // to check a rostered player (yours or a rival's) without leaving the tracker, and it's the
  // same pcardOnclick every other surface uses — team defenses included, since openPlayerCard
  // accepts a team code for DEF.
  const open = (typeof pcardOnclick==='function')
    ? `onclick="event.stopPropagation();${pcardOnclick(p.player_id||p.name, p.pos, p.team||'')}"` : '';
  const cls = open ? 'rt-pname clickable-player' : 'rt-pname';
  return `<span class="rt-pcell" ${open} title="${escAttr(p.name)}\u2002\u2014\u2002open player card">` +
    `${playerThumb(p)}<span class="${cls}">` +
    `<span class="rt-nm-full">${p.name}</span>` +
    `<span class="rt-nm-abbr">${abbrevName(p.name)}</span></span></span>` +
    `<span class="rt-pmeta">${p.pos} \u00b7 ${p.team}</span>`;
}
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
    // The tracker is position:fixed over the page, so without compensating padding the last
    // stretch of the rankings sits permanently underneath it and can't be scrolled to. Publish
    // the drawer's live height as --rt-h and let the page reserve exactly that much space —
    // measured rather than hard-coded, since the panel grows and shrinks as it opens/closes.
    const _rtPublishH = ()=>{
      const h = (host.style.display==='none') ? 0 : host.offsetHeight;
      document.documentElement.style.setProperty('--rt-h', h+'px');
    };
    if(typeof ResizeObserver==='function'){
      new ResizeObserver(_rtPublishH).observe(host);
    } else {
      // No ResizeObserver (old WebKit): publish after each render + on resize so the fixed
      // drawer never permanently occludes the last rankings rows.
      host._rtPublishH = _rtPublishH;
      if(typeof window!=='undefined' && window.addEventListener) window.addEventListener('resize', _rtPublishH, {passive:true});
    }
    // Drag on the band (the bar, or the panel's header): the panel's height FOLLOWS the
    // finger — no repaint mid-gesture, the markup is already in the DOM — then settles to
    // the nearest of closed / default / maximized on release (a quick flick always advances
    // one state in its direction; flicking down closes, from maximized too). The panel body
    // keeps its own scroll — gestures never start there.
    let _rtDrag=null;
    const _rtHeights=()=>{
      const p=host.querySelector('.rt-panel'); if(!p) return null;
      const vh=window.innerHeight||640;
      const narrow=(typeof _rankingsMobileNarrow==='function') ? _rankingsMobileNarrow() : !!(window.matchMedia && window.matchMedia('(max-width:760px)').matches);
      const defH=Math.min(p.scrollHeight+30, Math.round(vh*(narrow?0.42:0.5)));
      const maxH=Math.max(defH, vh-(narrow?96:120));
      return {p, defH, maxH};
    };
    // A touch that starts inside the drawer must never scroll the rankings behind it:
    // the horizontal rails and a genuinely-scrollable roster list handle themselves
    // (overscroll contained); everything else is the drawer's, so the page stays put.
    host.addEventListener('touchmove',(e)=>{
      const t=e.target;
      if(t && t.closest && t.closest('.rt-chips,.rt-seats,.vsg-tabs,.vsg-board,.vsg-cheat,.rt-col-main,.rt-col-side')) return;
      const p=t && t.closest && t.closest('.rt-panel');
      if(p && !_rtDrag && p.scrollHeight>p.clientHeight+1) return;
      if(e.cancelable) e.preventDefault();
    },{passive:false});
    host.addEventListener('touchstart',(e)=>{
      const band=e.target && e.target.closest && e.target.closest('.rt-bar,.rt-panel-head');
      const t=e.touches && e.touches[0];
      if(!band || !t){ _rtDrag=null; return; }
      const H=_rtHeights(); if(!H){ _rtDrag=null; return; }
      _rtDrag={y:t.clientY, x:t.clientX, h0:H.p.offsetHeight, defH:H.defH, maxH:H.maxH,
        t0:Date.now(), moved:false};
    },{passive:true});
    host.addEventListener('touchmove',(e)=>{
      if(!_rtDrag) return;
      const t=e.touches && e.touches[0]; if(!t) return;
      const dy=t.clientY-_rtDrag.y, dx=t.clientX-_rtDrag.x;
      if(!_rtDrag.moved){
        if(Math.abs(dy)<6) return;                       // ignore jitter
        if(Math.abs(dy)<=Math.abs(dx)){ _rtDrag=null; return; }   // horizontal — the chips rail
        _rtDrag.moved=true;
      }
      const p=host.querySelector('.rt-panel'); if(!p){ _rtDrag=null; return; }
      p.classList.add('rt-dragging');
      const h=Math.max(0, Math.min(_rtDrag.maxH, _rtDrag.h0-dy));
      p.style.maxHeight=h+'px';
    },{passive:true});
    host.addEventListener('touchend',(e)=>{
      const d=_rtDrag; _rtDrag=null;
      if(!d || !d.moved) return;
      const p=host.querySelector('.rt-panel'); if(!p) return;
      const t=e.changedTouches && e.changedTouches[0];
      const dy=t ? t.clientY-d.y : 0;
      const h=Math.max(0, Math.min(d.maxH, d.h0-dy));
      let target;
      const flick = (Date.now()-d.t0)<280 && Math.abs(dy)>30;
      if(flick){
        target = dy<0 ? (d.h0<d.defH*0.5 ? d.defH : d.maxH)   // up: closed→default, else →max
                      : 0;                                     // down: close, from anywhere
      } else {
        target = h<d.defH*0.5 ? 0 : (h<(d.defH+d.maxH)/2 ? d.defH : d.maxH);
      }
      p.classList.remove('rt-dragging');                       // transition back on
      p.style.maxHeight=target+'px';
      setTimeout(()=>{
        trackerOpen = target>0;
        trackerMax = target>0 && target===d.maxH && d.maxH>d.defH;
        const np=host.querySelector('.rt-panel');
        if(np) np.style.maxHeight='';
        renderRosterBar();
      },240);
    },{passive:true});
  }
  if(!rosterBarVisible){
    host.innerHTML=''; host.style.display='none';
    document.documentElement.style.setProperty('--rt-h','0px');
    return;
  }
  host.style.display='block';

  // Preserve scroll across re-renders. The 2.5s poll rebuilds this element wholesale,
  // and so does starring a player — without this you are bounced to the top of
  // whatever you were reading, every time. Every independently-scrollable region
  // in the drawer is listed here; missing one is invisible until someone scrolls it.
  const prevScrolls = _rtSnapScroll(host);

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
    _rtRestoreScroll(host, prevScrolls);
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
    const label = p ? (((typeof tcLastName==='function')?tcLastName(p.name):(String(p.name||'').trim().split(/\s+/).slice(-1)[0])) || slotLabel(s.slot)) : slotLabel(s.slot);
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
  const panel = renderTrackerPanel(viewSlot);   // always in the DOM; .rt-closed collapses it
  host.innerHTML = bar + panel;
  if(host._rtPublishH) host._rtPublishH();   // no-ResizeObserver fallback (see creation above)
  _rtRestoreScroll(host, prevScrolls);
}
// Vertical scrollers keyed by selector; '|x' marks the horizontal rails.
const _RT_SCROLLERS = ['.rt-panel','.rt-col-main','.rt-col-side','.vsg-board','.vsg-cheat',
                       '.rt-seats|x','.rt-chips|x','.vsg-tabs|x'];
function _rtSnapScroll(host){
  const m={};
  if(!host) return m;
  _RT_SCROLLERS.forEach(k=>{
    const x=k.endsWith('|x'), sel=x?k.slice(0,-2):k;
    const el=host.querySelector(sel); if(!el) return;
    const v = x ? el.scrollLeft : el.scrollTop;
    if(v) m[k]=v;
  });
  return m;
}
function _rtRestoreScroll(host, m){
  if(!host || !m) return;
  Object.keys(m).forEach(k=>{
    const x=k.endsWith('|x'), sel=x?k.slice(0,-2):k;
    const el=host.querySelector(sel); if(!el) return;
    if(x) el.scrollLeft=m[k]; else el.scrollTop=m[k];
  });
}
function setVonaSugFilter(pos){ vonaSugFilter = (vonaSugFilter===pos && pos!=='ALL') ? 'ALL' : pos; renderRosterBar(); }
// ── Live league-relative rank ───────────────────────────────────────────────
// "Your team ranks Nth of M, as drafted so far" — every slot's roster priced by
// the same optimal-lineup VOR the advisory itself drafts to maximize, so the
// rank and the advice can never disagree about what a good team is. A light
// bench term keeps two teams with equal lineups from tying when one's bench is
// real and the other's is air. Mid-round, teams that have picked more rank
// higher — that is the truth of the moment, not a bug.
const LIVE_RANK_BENCH_W = 0.15;
function vonaLiveTeamRanks(){
  const { teams } = draftParams();
  if(!teams) return null;
  const list = buildPlayerList();
  const vorById = new Map();
  list.forEach(p=>{ vorById.set(p.player_id||p.name, p.vor||0); });
  const vorOf = pk => vorById.get(pk.player_id || pk.name) || 0;
  const rows=[];
  for(let slot=1; slot<=teams; slot++){
    const picks=(draftPicksBySlot[slot]||[]).filter(pk=>pk && pk.pos!=='K' && pk.pos!=='DEF');
    const lineup=_vonaOptimalLineupVor(picks, vorOf);
    const total=picks.reduce((a,pk)=>a+Math.max(0,vorOf(pk)),0);
    rows.push({ slot, val: lineup + LIVE_RANK_BENCH_W*Math.max(0,total-lineup),
                picked: picks.length });
  }
  const sorted=[...rows].sort((a,b)=>b.val-a.val);
  rows.forEach(r=>{ r.rank = sorted.findIndex(x=>x.val<=r.val+1e-9)+1; });
  return { rows, teams, of:(slot)=>rows.find(r=>r.slot===slot)||null };
}

// ── Shortlist ───────────────────────────────────────────────────────────────
// Click a star anywhere on the board and the player joins your list. It survives
// a reload, highlights him wherever he shows up, and — the point of it — the
// advisory reminds you he's still there when your pick comes round.
function toggleDraftStar(pid){
  if(!pid) return;
  const on = !draftStars[pid];
  if(on) draftStars[pid]=1; else delete draftStars[pid];
  try{ localStorage.setItem('tc_draft_stars', JSON.stringify(draftStars)); }catch(e){}
  // Repaint exactly what changed. Re-rendering the rankings table for a star was
  // a full rebuild of hundreds of rows that looked, correctly, like nothing had
  // happened — and it threw away your scroll position.
  try{
    const sel=(typeof CSS!=='undefined' && CSS.escape) ? CSS.escape(pid) : pid.replace(/"/g,'\\"');
    document.querySelectorAll(`[data-star-row="${sel}"]`).forEach(tr=>{
      tr.classList.toggle('rank-starred', on);
    });
    document.querySelectorAll(`[data-starid="${sel}"]`).forEach(b=>{
      b.classList.toggle('on', on);
      b.textContent = on ? '\u2605' : '\u2606';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }catch(e){}
  // The advisory's shortlist strip and the plan's targets do change — but the
  // VONA maths doesn't, so the cache stands.
  _cheatCache={key:null,val:null};
  renderRosterBar();
}
// Star control for a rankings row (the draft board is where you spot the ones
// you'd otherwise forget).
function rankStarBtn(p){
  const pid=escAttr(String(p.player_id||p.name));
  const on=isDraftStar(p);
  return `<button class="vsg-star rank-star${on?' on':''}" data-starid="${pid}"
    title="${on?'Remove from your shortlist':'Add to your shortlist'}" aria-pressed="${on}"
    aria-label="${on?'Remove from shortlist':'Add to shortlist'}"
    onclick="event.stopPropagation();toggleDraftStar('${pid}')">${on?'\u2605':'\u2606'}</button>`;
}
function isDraftStar(p){ return !!(p && draftStars[p.player_id||p.name]); }
function clearDraftStars(){
  const ids=Object.keys(draftStars||{});
  if(!ids.length) return;
  if(!confirm(`Clear all ${ids.length} bookmarked player${ids.length===1?'':'s'}?`)) return;
  draftStars={};
  try{ localStorage.setItem('tc_draft_stars','{}'); }catch(e){}
  // Same surgical repaint as a single toggle, for every row that carried a star.
  try{
    ids.forEach(pid=>{
      const sel=(typeof CSS!=='undefined' && CSS.escape) ? CSS.escape(pid) : pid.replace(/"/g,'\\"');
      document.querySelectorAll(`[data-star-row="${sel}"]`).forEach(tr=>tr.classList.toggle('rank-starred', false));
      document.querySelectorAll(`[data-starid="${sel}"]`).forEach(b=>{
        b.classList.toggle('on', false); b.textContent='\u2606'; b.setAttribute('aria-pressed','false');
      });
    });
  }catch(e){}
  _cheatCache={key:null,val:null};
  renderRosterBar();
  if(typeof toast==='function') toast('Shortlist cleared','ok');
}
function _starBtn(p){
  const pid=escAttr(String(p.player_id||p.name));
  const on=isDraftStar(p);
  return `<button class="vsg-star${on?' on':''}" data-starid="${pid}" title="${on?'Remove from your shortlist':'Add to your shortlist'}"
    aria-label="${on?'Remove from shortlist':'Add to shortlist'}" aria-pressed="${on}"
    onclick="event.stopPropagation();toggleDraftStar('${pid}')">${on?'\u2605':'\u2606'}</button>`;
}
// ── Draft plan: mock drafts from YOUR seat ──────────────────────────────────
// The advisory answers "what now?". This answers the question you have the night
// before: from seat N in THIS league, who actually reaches me in each round?
// It runs full mock drafts on your own board — opponents buying by noisy ADP,
// the same market model the availability odds use — and reports, per pick of
// yours, how often each player is still there. Aim at the ones that survive;
// there is no point planning round 2 around a man who is gone 92% of the time.
//
// Deliberately NOT a projection of who you'd take: that's the live advisory's
// job with the board in front of it. This is the shape of the opportunity.
// Standard normal CDF (Abramowitz & Stegun 7.1.26 on erf) — the closed-form
// survival curve the plan uses where the drawn-sample MC would be overkill.
// Matches norm_cdf in tools/draft_sim.py.
// Inverse standard normal CDF (Acklam's rational approximation, |err|<1.2e-9)
// — lets the availability MC sample a player's market position CONDITIONED on
// him still being on the board, instead of pretending the draft hasn't started.
function _vonaInvNorm(p){
  const a=[-3.969683028665376e+01,2.209460984245205e+02,-2.759285104469687e+02,
           1.383577518672690e+02,-3.066479806614716e+01,2.506628277459239e+00];
  const b=[-5.447609879822406e+01,1.615858368580409e+02,-1.556989798598866e+02,
           6.680131188771972e+01,-1.328068155288572e+01];
  const c=[-7.784894002430293e-03,-3.223964580411365e-01,-2.400758277161838e+00,
           -2.549732539343734e+00,4.374664141464968e+00,2.938163982698783e+00];
  const d=[7.784695709041462e-03,3.224671290700398e-01,2.445134137142996e+00,
           3.754408661907416e+00];
  const pl=0.02425;
  if(p<pl){ const q=Math.sqrt(-2*Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  if(p>1-pl){ const q=Math.sqrt(-2*Math.log(1-p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  const q=p-0.5, r=q*q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}
function _vonaNormCdf(z){
  const s=z<0?-1:1, x=Math.abs(z)/Math.SQRT2;
  const t=1/(1+0.3275911*x);
  const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t
            +0.254829592)*t*Math.exp(-x*x);
  return 0.5*(1+s*y);
}
const CHEAT_SIMS = 150;
const CHEAT_MKT_DEPTH = 260;
let _cheatCache = {key:null, val:null};
function buildDraftCheatSheet(){
  if(mySlot==null) return null;
  const { teams, type, reversalRound, rounds } = draftParams();
  if(!teams || !rounds) return null;
  const list = buildPlayerList();
  const avail = list.filter(p=>!draftedIds[p.player_id]);
  const startPick = currentPickNo() || 1;
  const feed = _draftFeedPickNos();
  const myPicks = myUpcomingPickNumbers(mySlot).filter(n=>!feed.has(n));
  if(!myPicks.length) return null;
  const starSig = Object.keys(draftStars||{}).sort().join(',');
  const key = `${Object.keys(draftedIds).length}|${mySlot}|${startPick}|${rankFormat}|${buildPlayerScoringSig()}|${_buildPlayerCacheEpoch}|${starSig}`;
  if(_cheatCache.key===key && _cheatCache.val) return _cheatCache.val;
  // Only players the market prices can be modelled as going anywhere. adpFor()
  // already reads the board for THIS format — the 2QB column in superflex — which
  // is the whole reason a superflex plan looks different from a 1QB one.
  const mkt = avail.filter(p=>adpFor(p)<999)
                   .sort((a,b)=>adpFor(a)-adpFor(b)).slice(0, CHEAT_MKT_DEPTH);
  if(mkt.length<20) return null;
  const ded={QB:0,RB:0,WR:0,TE:0}; let sfN=0, flexN=0, kd=0;
  draftLineup.forEach(sl=>{
    if(ded[sl]!=null) ded[sl]++;
    else if(sl==='SUPER_FLEX') sfN++;
    else if(sl==='K'||sl==='DEF') kd++;
    else flexN++;
  });
  // The plan's opponents draft the way the drift model currently believes THIS
  // room drafts — live evidence blended with the room's own history.
  const drift = vonaMarketDrift(list);
  const val=_cheatSimulate(mkt, { teams, rounds, type, reversalRound, startPick, myPicks,
    mySlot, feed, ded, sfN, flexN, kd, sims:CHEAT_SIMS, drift,
    seed:((Object.keys(draftedIds).length*7919) ^ (mySlot*104729) ^ 0x9e3779b9)>>>0 });
  _cheatCache={key, val};
  return val;
}
// Optimal-lineup VOR for a hypothetical roster held as per-position VOR arrays —
// the plan's inner loop, so it works on numbers rather than player objects.
// Same fill as _vonaOptimalLineupVor: dedicated slots, then flex, then superflex.
function _planLineup(vors, ded, flexN, sfN){
  let total=0; const left=[], qbLeft=[];
  ['QB','RB','WR','TE'].forEach(q=>{
    const v=vors[q].slice().sort((x,y)=>y-x);
    for(let i=0;i<ded[q] && i<v.length;i++) total+=Math.max(0,v[i]);
    const rest=v.slice(ded[q]);
    if(q==='QB') qbLeft.push(...rest); else left.push(...rest);
  });
  left.sort((x,y)=>y-x);
  for(let i=0;i<flexN && i<left.length;i++) total+=Math.max(0,left[i]);
  const sfPool=left.slice(flexN).concat(qbLeft).sort((x,y)=>y-x);
  for(let i=0;i<sfN && i<sfPool.length;i++) total+=Math.max(0,sfPool[i]);
  return total;
}
// What one more player at `pos` worth `vor` does for this roster, per week.
function _planCand(vors, cnt, ded, flexN, sfN, pos, vor, before){
  const v2={QB:vors.QB,RB:vors.RB,WR:vors.WR,TE:vors.TE};
  v2[pos]=vors[pos].concat([vor]);
  const gain=(_planLineup(v2, ded, flexN, sfN)-before)/17;
  if(gain>0.05) return gain;
  const over=Math.max(0,vor)/17;
  const thin=(cnt[pos]<=ded[pos])?0.15:0;
  const w=(pos==='QB'?0.15:pos==='TE'?0.12:0.30)+thin;
  return w*over + 0.04*over;
}
// The simulation, with every input passed in so it can be tested without a live
// draft. `mkt` is ADP-ordered; each entry needs {pos, vor} and an adp via adpFor().
function _cheatSimulate(mkt, cfg){
  const POSL=['QB','RB','WR','TE'];
  const {eps:mixEps, tau:mixTau}=_vonaMixParams();
  const { teams, rounds, type, reversalRound, startPick, myPicks, mySlot, feed,
          ded, sfN, flexN, kd } = cfg;
  const sims=cfg.sims||CHEAT_SIMS;
  const n=mkt.length;
  const dr=cfg.drift||{};
  const adp=Float64Array.from(mkt.map(p=>adpFor(p)-(dr[p.pos]||0)));
  const sig=Float64Array.from(mkt.map(p=>adpSigma(adpFor(p))));
  const vor=Float64Array.from(mkt.map(p=>p.vor||0));
  const byPos={}; POSL.forEach(q=>byPos[q]=[]);
  mkt.forEach((p,i)=>{ if(byPos[p.pos]) byPos[p.pos].push(i); });
  // Opponent ceilings — how many of a position a team takes before it stops caring.
  const cap={QB:(sfN?ded.QB+sfN+1:2), TE:Math.max(2,ded.TE+1),
             RB:ded.RB+flexN+2, WR:ded.WR+flexN+2};
  // MY ceilings are the advisory's, which is why the plan stops at two quarterbacks
  // in a 1QB league and doesn't spend six straight rounds on them in superflex.
  const myCap={QB:(sfN?ded.QB+sfN+1:2), TE:Math.max(2,ded.TE+1), RB:8, WR:9};
  const minTargets={QB:ded.QB+sfN, TE:ded.TE, RB:ded.RB+2, WR:ded.WR+2};

  const availCount=myPicks.map(()=>new Int32Array(n));
  const tookCount=myPicks.map(()=>new Int32Array(n));
  const tookPos=myPicks.map(()=>({QB:0,RB:0,WR:0,TE:0,KD:0}));
  const lastPick=teams*rounds;
  const taken=new Uint8Array(n);
  const ptr={}, ord={}, noisy=new Float64Array(n);
  let seed=(cfg.seed||1)>>>0;
  const rnd=()=>{ seed+=0x6D2B79F5; let t=Math.imul(seed^(seed>>>15),1|seed);
                  t^=t+Math.imul(t^(t>>>7),61|t); return ((t^(t>>>14))>>>0)/4294967296; };

  // Mid-draft, a survivor's market position is conditioned on him surviving
  // this far — same truncation as vonaSimulate, same reason.
  const u0=new Float64Array(n);
  for(let i=0;i<n;i++) u0[i]=(startPick>1)
    ? Math.min(0.999999, _vonaNormCdf((startPick-0.5-adp[i])/sig[i])) : 0;
  for(let s=0;s<sims;s++){
    taken.fill(0);
    for(let i=0;i<n;i++){
      if(startPick>1 && rnd()<mixEps){
        noisy[i]=startPick - Math.log(1-rnd())*mixTau;
      } else {
        noisy[i]=(u0[i]<0.02)
          ? adp[i]+_VONA_NORMALS[(rnd()*4096)|0]*sig[i]
          : adp[i]+_vonaInvNorm(Math.min(0.999999, u0[i]+(1-u0[i])*rnd()))*sig[i];
      }
    }
    POSL.forEach(q=>{ ord[q]=byPos[q].slice().sort((x,y)=>noisy[x]-noisy[y]); ptr[q]=0; });
    const cnt={}; for(let t=1;t<=teams;t++) cnt[t]={QB:0,RB:0,WR:0,TE:0,KD:0};
    const myVors={QB:[],RB:[],WR:[],TE:[]};
    let mi=0;
    for(let pk=startPick; pk<=lastPick; pk++){
      if(feed && feed.has && feed.has(pk)) continue;
      const slot=slotOnClock(pk, teams, type, reversalRound);
      const c=cnt[slot]||{QB:0,RB:0,WR:0,TE:0,KD:0};
      const atMine=(slot===mySlot && mi<myPicks.length && pk===myPicks[mi]);
      if(atMine){ const ac=availCount[mi]; for(let i=0;i<n;i++) if(!taken[i]) ac[i]++; }
      const picksLeftForTeam=Math.max(1, Math.ceil((lastPick-pk+1)/teams));
      let pick=-1, pickPos=null;
      if(slot===mySlot){
        // ── My seat drafts a ROSTER, not a list of the best players left ──────
        const myLeft=myPicks.length-mi;                 // picks I have from here
        const kdOpen=kd-c.KD;
        if(kdOpen>0 && myLeft<=kdOpen){                 // the last picks are spoken for
          c.KD++;
          if(atMine){ tookPos[mi].KD++; mi++; }
          continue;
        }
        const skillLeft=Math.max(0, myLeft-kdOpen);
        const unmet={}; let unmetTotal=0;
        POSL.forEach(q=>{ unmet[q]=Math.max(0,minTargets[q]-c[q]); unmetTotal+=unmet[q]; });
        const mustFill = unmetTotal>0 && unmetTotal>=skillLeft;
        const before=_planLineup(myVors, ded, flexN, sfN);
        const nextMine=myPicks[mi+1]||null;
        let bestScore=-Infinity;
        POSL.forEach(q=>{
          if(c[q]>=myCap[q]) return;
          if(mustFill && !unmet[q]) return;
          // best available at this position on MY board
          let top=-1, topV=-Infinity;
          for(let k=0;k<byPos[q].length;k++){
            const i=byPos[q][k];
            if(taken[i]) continue;
            if(vor[i]>topV){ topV=vor[i]; top=i; }
          }
          if(top<0) return;
          const vNow=_planCand(myVors, c, ded, flexN, sfN, q, topV, before);
          // What this position is expected to hand me next time round — the
          // regret of waiting, which is what stops the plan hoarding one spot.
          let vNext=vNow*0.8;
          if(nextMine){
            let ev=0, pNone=1;
            for(let k=0;k<byPos[q].length;k++){
              const i=byPos[q][k];
              if(taken[i]) continue;
              const su=Math.min(0.995, _vonaNormCdf((adp[i]-(nextMine-0.5))/sig[i]));
              ev += pNone*su*vor[i]; pNone *= (1-su);
              if(pNone<1e-3) break;
            }
            vNext=_planCand(myVors, c, ded, flexN, sfN, q, Math.max(0,ev), before);
          }
          const sc=Math.max(0, vNow-vNext) + VONA_NOW_WEIGHT*vNow;
          if(sc>bestScore){ bestScore=sc; pick=top; pickPos=q; }
        });
      } else {
        let want=POSL.filter(q=>c[q]<ded[q]);
        if(!want.length) want=POSL.filter(q=>c[q]<cap[q]);
        if(!want.length) want=POSL.slice();
        const kdOpen=kd-c.KD;
        if(kdOpen>0 && rnd() < Math.min(0.95, kdOpen/picksLeftForTeam)){ c.KD++; continue; }
        let best=Infinity;
        want.forEach(q=>{
          let k=ptr[q];
          while(k<ord[q].length && taken[ord[q][k]]) k++;
          ptr[q]=k;
          if(k>=ord[q].length) return;
          const v=noisy[ord[q][k]];
          if(v<best){ best=v; pick=ord[q][k]; pickPos=q; }
        });
      }
      if(pick<0) continue;
      taken[pick]=1; c[pickPos]++;
      if(slot===mySlot) myVors[pickPos].push(vor[pick]);
      if(atMine){ tookCount[mi][pick]++; tookPos[mi][pickPos]++; mi++; }
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  // Per pick: what the plan actually TAKES there (roster-aware, so it reads like
  // a build), each with how often he's even available — the gap between the two
  // is the edge. Availability alone would just list whoever the market ignores.
  const picks=myPicks.map((pkNo,j)=>{
    const tc=tookCount[j], ac=availCount[j];
    const rows=[];
    for(let i=0;i<n;i++){
      if(tc[i]/sims >= 0.04) rows.push({p:mkt[i], pTake:tc[i]/sims, pAvail:ac[i]/sims, vor:vor[i]});
    }
    rows.sort((x,y)=>y.pTake-x.pTake);
    const tp=tookPos[j];
    const bestPos=Object.keys(tp).reduce((x,y)=>tp[y]>tp[x]?y:x,'RB');
    return { pickNo:pkNo, round:Math.ceil(pkNo/teams), rows:rows.slice(0,5),
             tookPos:tp, likelyPos:bestPos, likelyShare:tp[bestPos]/sims, targets:[] };
  });

  // ── Your shortlist, slotted into the round where you can actually get him ──
  // The edge is timing: don't spend an early pick on a man the market leaves
  // alone. Target the LAST of your picks where he's still comfortably there;
  // if he never is, the first where he's even plausible; otherwise say so.
  const starred=[];
  for(let i=0;i<n;i++){
    const pid=mkt[i].player_id||mkt[i].name;
    if(!draftStars || !draftStars[pid]) continue;
    let target=-1, kind='wait';
    for(let j=0;j<myPicks.length;j++) if(availCount[j][i]/sims>=0.55) target=j;
    if(target<0){
      for(let j=0;j<myPicks.length;j++){ if(availCount[j][i]/sims>=0.15){ target=j; kind='now'; break; } }
    }
    const rec={ p:mkt[i], vor:vor[i], adp:adp[i],
                pAvailAt: target>=0 ? availCount[target][i]/sims : 0,
                pAvailFirst: availCount[0][i]/sims, kind, target };
    starred.push(rec);
    if(target>=0) picks[target].targets.push(rec);
  }
  picks.forEach(pk=>pk.targets.sort((a,b)=>b.vor-a.vor));
  return { picks, sims, slot:mySlot, starred, unreachable:starred.filter(x=>x.target<0) };
}
function vonaCheatPanel(){
  const cs=buildDraftCheatSheet();
  if(!cs) return '<div class="vsg-empty">No plan available \u2014 the draft has no picks left for you.</div>';
  const shape=cs.picks.map(pk=>pk.likelyPos==='KD'?'K/D':pk.likelyPos).join(' \u00b7 ');
  // What this room has actually done, when we know it.
  let roomLine='';
  if(typeof roomHistory!=='undefined' && roomHistory && roomHistory.drafts){
    const h=roomHistory;
    const hot=['QB','RB','WR','TE'].map(p=>[p,h.byR3[p]]).sort((a,b)=>b[1]-a[1]);
    roomLine=`<div class="vsg-room">\u25c9 This room, last ${h.drafts} draft${h.drafts===1?'':'s'}:
      takes <b>${hot[0][1]} ${hot[0][0]}s</b> and <b>${hot[1][1]} ${hot[1][0]}s</b> in the first
      three rounds${h.kdFirst?`, first K/DEF in <b>round ${h.kdFirst}</b>`:''} \u2014 the mock
      opponents below draft with this habit until the live room shows otherwise.</div>`;
  }
  const blocks=cs.picks.map(pk=>{
    // Your starred men first, flagged as targets for THIS pick.
    const tgt=pk.targets.map(t=>{
      const open=(typeof pcardOnclick==='function')
        ? `onclick="${pcardOnclick(t.p.player_id||t.p.name, t.p.pos, t.p.team||'')}"` : '';
      // Why he sits in THIS round: it's the last one you can count on him in.
      const note = t.kind==='now'
        ? `last chance \u2014 ${Math.round(t.pAvailAt*100)}% here`
        : `your last safe round \u2014 ${Math.round(t.pAvailAt*100)}% here`;
      return `<div class="vsg-crow tgt">
        ${_starBtn(t.p)}
        <span class="rt-slot ${slotClass(t.p.pos)}">${t.p.pos}</span>
        <span class="vsg-cname clickable-player" ${open}>${escHtml(t.p.name)}</span>
        <span class="vsg-tnote ${t.kind==='now'?'urgent':''}">${note}</span>
        <span class="vsg-bnum">ADP ${Math.round(t.adp)}</span>
        <span class="vsg-bnum ${t.pAvailAt<0.35?'vsg-now':(t.pAvailAt<0.7?'vsg-close':'vsg-wait')}">${Math.round(t.pAvailAt*100)}%</span>
      </div>`;
    }).join('');
    // A starred target is already rendered above — don't list him again.
    const shown=new Set(pk.targets.map(t=>t.p.player_id||t.p.name));
    const rows=pk.rows.filter(r=>!shown.has(r.p.player_id||r.p.name)).map(r=>{
      const open=(typeof pcardOnclick==='function')
        ? `onclick="${pcardOnclick(r.p.player_id||r.p.name, r.p.pos, r.p.team||'')}"` : '';
      const ac = r.pAvail<0.35 ? 'vsg-now' : (r.pAvail<0.7 ? 'vsg-close' : 'vsg-wait');
      return `<div class="vsg-crow${isDraftStar(r.p)?' starred':''}">
        ${_starBtn(r.p)}
        <span class="rt-slot ${slotClass(r.p.pos)}">${r.p.pos}</span>
        <span class="vsg-cname clickable-player" ${open}>${escHtml(r.p.name)}</span>
        <span class="vsg-take" title="How often the plan takes him here">${Math.round(r.pTake*100)}% taken</span>
        <span class="vsg-bnum">${(r.vor||0)>0?'+':''}${(r.vor||0).toFixed(0)}</span>
        <span class="vsg-bnum ${ac}" title="How often he is still on the board at this pick">${Math.round(r.pAvail*100)}%</span>
      </div>`;
    }).join('');
    return `<div class="vsg-cblock">
      <div class="vsg-chead"><b>Round ${pk.round}</b> \u00b7 pick ${pk.pickNo}
        <span class="vsg-cpos">usually <span class="rt-slot ${slotClass(pk.likelyPos)}">${pk.likelyPos==='KD'?'K/DEF':pk.likelyPos}</span>
          ${Math.round(pk.likelyShare*100)}%</span></div>
      <div class="vsg-clist">${tgt}${rows||(tgt?'':'<div class="vsg-empty">Reserved \u2014 no skill pick here.</div>')}</div>
    </div>`;
  }).join('');
  const miss=(cs.unreachable||[]).length
    ? `<div class="vsg-cmiss">\u2605 ${cs.unreachable.map(t=>escHtml(t.p.name)).join(', ')}
        \u2014 gone before your first pick in almost every simulation. Taking one means reaching past his market price.</div>`
    : '';
  // On a phone the explanation is seven lines of prose above the thing you came
  // to read. It lives behind the \u2139 instead; the build line is the one part
  // worth its space, so that stays.
  return `<div class="vsg-cheat">
    ${roomLine}
    <div class="vsg-cnote">
      <div class="vsg-cnote-txt">${cs.sims} mock drafts from seat ${cs.slot}: opponents buy at
        <b>${typeof formatLabel==='function'?formatLabel(rankFormat):''} ADP</b>, you draft with the
        advisory's own rules. <b>% taken</b> is how often the plan spends this pick on him;
        <b>%</b> on the right is how often he's even there. A player who's always available and
        rarely taken is one you can wait on \u2014 that gap is the edge.</div>
      <div class="vsg-shape"><span class="vsg-shape-l">Typical build</span>
        ${(typeof tcInfoBtn==='function')?tcInfoBtn('vonaplan','How the draft plan works'):''}
        <b>${shape}</b></div>
      <div class="vsg-ckey">% taken \u00b7 % still there</div></div>
    ${miss}
    ${blocks}</div>`;
}
// ── "If I wait, what does the board look like?" ──────────────────────────────
// The row shows the one man you'd most often settle for. This opens the rest of
// it: every position's realistic survivors at your next pick, so "wait" is a
// board you can look at rather than a single name you have to trust.
// A phone doesn't want a four-column board popped over the card it came from.
// The \u25be "next up at this position" list already answers "who'll be there?"
// well enough there, so narrow screens get that instead.
function vonaWaitOpen(ev, pos){
  const narrow = (typeof window!=='undefined' && window.matchMedia)
    ? window.matchMedia('(max-width:640px)').matches : false;
  return narrow ? vonaOptionsPop(ev, pos) : vonaWaitPop(ev);
}
function vonaWaitPop(ev){
  const old=document.getElementById('vonaWaitPop'); if(old) old.remove();
  const v=computeVONA(); if(!v) return;
  const ups=myUpcomingPickNumbers(mySlot)||[];
  const nxt = v.onClock ? (ups[1]!=null?ups[1]:null) : (ups[0]!=null?ups[0]:null);
  const availOf=(p)=> (v.pAvail && v.pAvail.get(p.player_id||p.name)) || 0;
  const cols=['QB','RB','WR','TE'].map(pos=>{
    const pool=((v.pools&&v.pools[pos])||[]).filter(p=>!_vonaSeasonOut(p));
    // Realistic survivors only — a 3% name is not "what waiting buys you".
    const live=pool.filter(p=>availOf(p)>=0.25).slice(0,5);
    const use=live.length?live:pool.slice(0,2);
    if(!use.length) return '';
    const rows=use.map((p,i)=>{
      const a=availOf(p);
      const cl = a<0.35 ? 'vsg-now' : (a<0.7 ? 'vsg-close' : 'vsg-wait');
      const open=(typeof pcardOnclick==='function')
        ? `onclick="event.stopPropagation();${pcardOnclick(p.player_id||p.name,p.pos,p.team||'')}"` : '';
      return `<div class="vwp-row${i===0?' best':''} clickable-player" ${open}
          title="${escAttr(p.name)} \u2014 open player card">
        <span class="vwp-nm">${escHtml(p.name)}</span>
        <span class="vwp-team">${escHtml(p.team||'FA')}</span>
        <span class="vwp-vor">${(p.vor||0)>0?'+':''}${(p.vor||0).toFixed(0)}</span>
        <span class="vwp-pct ${cl}">${_vonaPctDisp(p,a)}%</span></div>`;
    }).join('');
    const top=use[0];
    return `<div class="vwp-col">
      <div class="vwp-h"><span class="rt-slot ${slotClass(pos)}">${pos}</span>
        <span class="vwp-hnote">likely yours: <b>${escHtml(((typeof tcLastName==='function')?tcLastName(top.name):top.name))}</b></span></div>
      ${rows}</div>`;
  }).filter(Boolean).join('');
  const div=document.createElement('div');
  div.id='vonaWaitPop'; div.className='vona-opt-pop vwp';
  div.innerHTML=`<div class="vona-opt-head">
      <span class="vona-opt-title">If you wait${nxt?` \u2014 the board at pick ${nxt}`:''}</span>
      <button class="vona-opt-close" onclick="this.closest('.vona-opt-pop').remove()" aria-label="Close">\u2715</button>
    </div>
    <div class="vwp-key"><span>Player</span><span class="vwp-kr">Value \u00b7 chance he lasts</span></div>
    <div class="vwp-grid">${cols}</div>
    <div class="vwp-foot">The highlighted name in each column is who you'd most likely end up with.</div>`;
  document.body.appendChild(div);
  const r=(ev&&ev.currentTarget&&ev.currentTarget.getBoundingClientRect)
    ? ev.currentTarget.getBoundingClientRect() : {left:40, bottom:80};
  const w=div.offsetWidth, h=div.offsetHeight;
  div.style.left=Math.max(8, Math.min(window.innerWidth-w-8, r.left-40))+'px';
  // Prefer below; flip above when it would run off the bottom.
  div.style.top=(r.bottom+6+h > window.innerHeight-8 && r.top-h-6 > 8)
    ? (r.top-h-6)+'px' : Math.max(8, Math.min(window.innerHeight-h-8, r.bottom+6))+'px';
  setTimeout(()=>{
    const off=(e)=>{ if(!div.contains(e.target)){ div.remove(); document.removeEventListener('click',off,true); } };
    document.addEventListener('click',off,true);
  },0);
}
// ── Suggestions panel (desktop) ─────────────────────────────────────────────
// The drawer's four position rows pack a lot into very little width, which is
// fine on a phone and wasteful on a monitor. On desktop the same advice is a
// scannable list of PLAYERS — the thing you actually have to decide on — beside
// your own roster, with a position tab for browsing the rest of a board.
// Content is the same computeVONA result; nothing here re-ranks anything.
function vonaSuggestPanel(v){
  const POSL=['QB','RB','WR','TE'];
  const has={}; (v.picks||[]).forEach(r=>has[r.pos]=true);
  const tabNames=['ALL'].concat(POSL.filter(p=>has[p])).concat(['PLAN']);
  const tabs=tabNames.map(t=>{
    const on = (vonaSugFilter===t) || (t==='ALL' && !tabNames.slice(1).includes(vonaSugFilter));
    const lbl = t==='ALL' ? 'All' : (t==='PLAN' ? 'Draft plan' : t);
    return `<button class="vsg-tab${on?' active':''}${t==='PLAN'?' vsg-tab-plan':''}" onclick="event.stopPropagation();setVonaSugFilter('${t}')">${lbl}</button>`;
  }).join('');
  const myNext=(function(){
    const ups=myUpcomingPickNumbers(mySlot)||[];
    return v.onClock ? (ups[1]!=null?ups[1]:null) : (ups[0]!=null?ups[0]:null);
  })();
  const availOf=(p)=> (v.pAvail && v.pAvail.get(p.player_id||p.name)) || 0;
  const pcls=(x)=> x<0.35 ? 'vsg-now' : (x<0.7 ? 'vsg-close' : 'vsg-wait');
  const openAttr=(p)=> (typeof pcardOnclick==='function')
    ? `onclick="${pcardOnclick(p.player_id||p.name, p.pos, p.team||'')}"` : '';
  const adpOf=(p)=> (typeof adpFor==='function') ? adpFor(p) : 999;

  // ── Planning: what reaches this seat, round by round ──────────────────────
  if(vonaSugFilter==='PLAN'){
    return `<div class="vsg">
      <div class="vsg-tabs">${tabs}<span class="vsg-spacer"></span>
        <span class="vsg-hint">mock drafts from your seat</span></div>
      ${vonaCheatPanel()}
    </div>`;
  }
  // ── Browsing one position: the whole board, with the numbers you'd want ────
  if(POSL.includes(vonaSugFilter)){
    const pos=vonaSugFilter;
    const row=(v.picks||[]).find(r=>r.pos===pos);
    const takeId=row && row.p ? (row.p.player_id||row.p.name) : null;
    const list=(v.pools && v.pools[pos]) || [];
    const rows=list.slice(0, VONA_BOARD_DEPTH).map((p,i)=>{
      const a=availOf(p), adp=adpOf(p);
      const mine=(p.player_id||p.name)===takeId;
      return `<div class="vsg-brow${mine?' pick':''}${isDraftStar(p)?' starred':''} clickable-player" ${openAttr(p)}>
        ${_starBtn(p)}
        <span class="vsg-bi">${i+1}</span>
        <span class="vsg-bname">${escHtml(p.name)}${typeof tcInjuryTag==='function'?tcInjuryTag(p.player_id):''}</span>
        <span class="vsg-bteam">${escHtml(p.team||'FA')}</span>
        <span class="vsg-bnum">${p.fpts!=null?Math.round(p.fpts):'\u2013'}</span>
        <span class="vsg-bnum">${(p.vor||0)>0?'+':''}${(p.vor||0).toFixed(0)}</span>
        <span class="vsg-bnum">${adp<999?Math.round(adp):'\u2013'}</span>
        <span class="vsg-bnum ${pcls(a)}">${_vonaPctDisp(p,a)}%</span>
      </div>`;
    }).join('');
    return `<div class="vsg">
      <div class="vsg-tabs">${tabs}<span class="vsg-spacer"></span>
        <span class="vsg-hint">${list.length} ${pos}s left \u00b7 \u2606 to shortlist</span></div>
      <div class="vsg-bhead"><span></span><span></span><span>Player</span><span>Team</span>
        <span>Proj</span><span>Value</span><span>ADP</span><span>${myNext?`Back at ${myNext}`:'Back'}</span></div>
      <div class="vsg-board">${rows||'<div class="vsg-empty">Nobody left here.</div>'}</div>
    </div>`;
  }

  // ── Deciding: one card per position, in engine order ───────────────────────
  const items=(v.picks||[]).slice(0,4);
  if(!items.length) return '';
  const cards=items.map(r=>{
    const p=r.p; if(!p) return '';
    const pct=Math.round((r.pHold||0)*100);
    let vcls='vsg-wait', vtxt='can wait';
    if(r.lastCall){ vcls='vsg-now'; vtxt='last call'; }
    else if(r.gated){ vcls='vsg-off'; vtxt='parked'; }
    else if(pct<35){ vcls='vsg-now'; vtxt='take now'; }
    else if(pct<70){ vcls='vsg-close'; vtxt='toss-up'; }
    const adp=adpOf(p);
    const adpTxt=(adp!=null && adp<999) ? `ADP ${Math.round(adp)}` : 'no ADP';
    const edge=(adp!=null && adp<999 && v.pickNo) ? Math.round(adp-v.pickNo) : null;
    const edgeTxt = edge==null ? ''
      : edge>=8 ? `<span class="vsg-edge reach">${edge} picks early</span>`
      : edge<=-6 ? `<span class="vsg-edge value">${-edge} picks of value</span>` : '';
    // What waiting actually costs: the man you'd most often settle for instead.
    const nx=r.bestNext;
    const waitLine = (nx && nx!==p)
      ? `<div class="vsg-next act" onclick="event.stopPropagation();vonaWaitOpen(event,'${p.pos}')" title="See the board if you wait">wait \u2192 <b>${escHtml(nx.name)}</b>
           <span class="vsg-nvor">${(nx.vor||0)>0?'+':''}${(nx.vor||0).toFixed(0)}</span>
           <span class="vsg-nshare">${Math.round((r.nextShare||0)*100)}% likely</span></div>`
      : `<div class="vsg-next safe act" onclick="event.stopPropagation();vonaWaitOpen(event,'${p.pos}')" title="See the board if you wait">wait \u2192 <b>${escHtml(p.name)}</b> likely still there</div>`;
    return `<div class="vsg-card${r.gated?' gated':''}${r.rank===1&&!r.gated?' lead':''}${isDraftStar(p)?' starred':''}">
      <span class="vsg-rank">${r.rank}</span>
      <span class="vsg-hs clickable-player" ${openAttr(p)}>${playerThumb(p)}</span>
      <div class="vsg-main clickable-player" ${openAttr(p)}>
        <div class="vsg-name">${_starBtn(p)}<span class="vsg-nm">${escHtml(p.name)}</span>${typeof tcInjuryTag==='function'?tcInjuryTag(p.player_id):''}</div>
        <div class="vsg-meta"><span class="rt-slot ${slotClass(p.pos)}">${p.pos}</span>
          <span class="vsg-team">${escHtml(p.team||'FA')}</span>
          <span class="vsg-vor">${(p.vor||0)>0?'+':''}${(p.vor||0).toFixed(0)} value</span>
          <span class="vsg-adp">${adpTxt}</span>${edgeTxt}</div>
        ${waitLine}
        ${r.why?`<div class="vsg-why">${r.why}</div>`:''}
      </div>
      <div class="vsg-verdict">
        <span class="vsg-pct ${vcls}">${_vonaPctDisp(p,r.pHold)}%</span>
        <span class="vsg-lbl">${myNext?`back at ${myNext}`:'still there'}</span>
        <span class="vsg-chip ${vcls}">${vtxt}</span>
        <button class="vona-more vsg-more" onclick="event.stopPropagation();vonaOptionsPop(event,'${r.pos}')"
          title="Next viable ${r.pos}s on the board" aria-label="More ${r.pos} options">\u25be</button>
      </div>
    </div>`;
  }).join('');
  return `<div class="vsg">
    <div class="vsg-tabs">${tabs}<span class="vsg-spacer"></span>
      <span class="vsg-hint">value now vs what comes back to you</span></div>
    <div class="vsg-list">${cards}</div>
    ${vonaStarStrip(v, myNext)}
  </div>`;
}
// Your shortlist, filtered to who's actually still on the board, nearest-to-gone
// first. This is the reminder: you starred him three rounds ago, he's still here.
function vonaStarStrip(v, myNext){
  const ids=Object.keys(draftStars||{});
  if(!ids.length) return '';
  const live=[];
  ['QB','RB','WR','TE'].forEach(pos=>{
    ((v.pools&&v.pools[pos])||[]).forEach(p=>{ if(isDraftStar(p)) live.push(p); });
  });
  if(!live.length) return '';
  const availOf=(p)=> (v.pAvail && v.pAvail.get(p.player_id||p.name)) || 0;
  live.sort((a,b)=>availOf(a)-availOf(b));
  const chips=live.slice(0,6).map(p=>{
    const a=availOf(p);
    const cls = a<0.35 ? 'vsg-now' : (a<0.7 ? 'vsg-close' : 'vsg-wait');
    const open=(typeof pcardOnclick==='function')
      ? `onclick="${pcardOnclick(p.player_id||p.name, p.pos, p.team||'')}"` : '';
    return `<span class="vsg-schip clickable-player" ${open}>
      <span class="rt-slot ${slotClass(p.pos)}">${p.pos}</span>${escHtml(p.name)}
      <b class="${cls}">${_vonaPctDisp(p,a)}%</b></span>`;
  }).join('');
  const gone=live.length-Math.min(6,live.length);
  return `<div class="vsg-strip"><span class="vsg-strip-lbl">
      <span class="vsg-lbl-long">\u2605 Your list \u2014 still on the board${myNext?`, odds they reach pick ${myNext}`:''}</span>
      <span class="vsg-lbl-short">\u2605 Your list${myNext?` \u00b7 odds at ${myNext}`:''}</span></span>
    <button class="vsg-strip-clear" onclick="event.stopPropagation();clearDraftStars()"
      title="Clear every bookmarked player">clear</button>
    <div class="vsg-strip-row">${chips}${gone>0?`<span class="vsg-schip more">+${gone} more</span>`:''}</div></div>`;
}
// The expanded panel: full lineup with drafted players, remaining needs, a team switcher.
function renderTrackerPanel(viewSlot){
  const picks = (viewSlot!=null && draftPicksBySlot[viewSlot]) || [];
  const { slots, bench, needs } = fillLineup(picks);
  const rows = slots.map(s=>{
    const p=s.player;
    return `<div class="rt-row ${p?'':'open'}">
      <span class="rt-slot ${slotClass(s.slot)}">${slotLabel(s.slot)}</span>
      ${p ? playerCell(p)
          : `<span class="rt-empty-lbl">\u2014 open \u2014</span>`}
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
        ? `<div class="rt-row bench"><span class="rt-slot rt-pos-bn">BN</span>${playerCell(p)}</div>`
        : `<div class="rt-row bench open"><span class="rt-slot rt-pos-bn">BN</span><span class="rt-empty-lbl">— open —</span></div>`;
    }
  }
  const needsLine = needs.length
    ? `<div class="rt-needs">Still needs: ${needs.map(nS=>`<span class="rt-need ${slotClass(nS)}">${slotLabel(nS)}</span>`).join('')}</div>`
    : `<div class="rt-needs rt-complete">✓ Starting lineup complete</div>`;

  // Team switcher: chips for every slot in the draft, current highlighted.
  const n=draftSlotCount()||12;
  // Live standings: only while a draft is running and something has been picked.
  const lr = (draftId && Object.keys(draftedIds).length>0) ? vonaLiveTeamRanks() : null;
  let switcher='';
  for(let s=1;s<=n;s++){
    const active = s===viewSlot ? 'active' : '';
    const mine = s===mySlot ? ' rt-mine' : '';
    const rr = lr && lr.of(s);
    const badge = (rr && rr.picked>0) ? `<span class="rt-chip-rank">${ordinal(rr.rank)}</span>` : '';
    switcher+=`<button class="rt-teamchip ${active}${mine}" onclick="viewTrackerSlot(${s})"
      title="${slotOwnerName(s)}${rr&&rr.picked>0?` — drafted value ranks ${ordinal(rr.rank)} of ${n}`:''}">${s===mySlot?'★ ':''}${s}${badge}</button>`;
  }
  // VONA advisory — only for MY roster, only while a live draft is running.
  let advisory='';
  if(viewSlot===mySlot && draftId){
    // The advisory prices picks off buildPlayerList(), which follows activeSeason — on a
    // reference season it would advise from LAST YEAR'S actual points. Projection board only.
    const v=(typeof activeSeason==='undefined' || activeSeason==='proj') ? computeVONA() : null;
    if(v && v.rows.length){
      // Surname only (space is tight), but clickable — opens the full player card so you can
      // check a name before spending a pick on it. Falls back to plain text if the card
      // helper isn't loaded for any reason.
      const nm=(p)=>{
        if(!p) return '\u2014';
        const short = ((typeof tcLastName==='function')?tcLastName(p.name):(String(p.name||'').trim().split(/\s+/).slice(-1)[0])) || p.name;
        if(typeof pcardOnclick!=='function') return short;
        return `<span class="vona-name clickable-player" title="${escAttr(p.name)} \u2014 open player card"
          onclick="event.stopPropagation();${pcardOnclick(p.player_id||p.name, p.pos, p.team||'')}">${short}</span>`;
      };
      const pct=(x)=> Math.round((x||0)*100);
      // Colour the availability % like a traffic light: green = safe to wait, red = he's gone.
      const pcls=(x)=> x>=0.6 ? 'vp-hi' : (x>=0.3 ? 'vp-mid' : 'vp-lo');
      // headline = the top row of the ranking (gated rows are already sorted last; a
      // last-call starter is already sorted first) — the score itself now carries need,
      // budget, and lineup impact, so no second re-ranking here.
      const needRows=v.rows.filter(r=>r.need);
      const rec = v.rows.find(r=>!r.gated) || v.rows[0];
      const alsoBig = v.rows.find(r=>r!==rec && !r.gated && r.dropoff>=12);
      let recTxt='';
      if(v.kdNow){
        recTxt = `Take your <b>K / DEF</b> — every remaining pick is spoken for`;
      } else if(rec){
        // Lead with the ACTION and the player, not a raw cliff number — "(\u22121.6)" reads like
        // an error on a phone and means nothing without the board in front of you.
        const who = rec.bestNow ? (((typeof tcLastName==='function')?tcLastName(rec.bestNow.name):(String(rec.bestNow.name||'').trim().split(/\s+/).slice(-1)[0])) || '') : '';
        recTxt = `Take a <b>${rec.pos}</b>${who?` \u2014 ${who}`:''}`;
        if(rec.why) recTxt += ` <span class="vona-sub-why">(${rec.why})</span>`;
        else if(rec.filled) recTxt = `Best value: <b>${rec.pos}</b>${who?` \u2014 ${who}`:''} \u2014 starters are set`;
      }
      const noteTxt = (rec && !rec.need && needRows.length===0)
        ? `All starters filled \u2014 now drafting for value/depth.`
        : (alsoBig ? `Also watch <b>${alsoBig.pos}</b> (\u2212${alsoBig.dropoff}).` : '');
      const kdefLine = v.kdefAlert
        ? `<div class="vona-kdef">${TC_ICON('warning')} <b>${v.kdefAlert.picksLeft} pick${v.kdefAlert.picksLeft===1?'':'s'} left</b> \u00b7 ${v.kdefAlert.open.join(' + ')} still open \u2014 save room</div>`
        : '';
      advisory=`<div class="vona-box">
        <div class="vona-head">${TC_ICON('chart')} On-the-clock advice ${v.onClock?'\u00b7 <b style="color:var(--accent)">YOU\u2019RE UP</b>':`\u00b7 next pick in ${v.gap}`} ${(typeof tcInfoBtn==='function')?tcInfoBtn('vona','How this advice works'):''}</div>
        <div class="vona-sub">${recTxt}${noteTxt?` \u00b7 ${noteTxt}`:''}</div>
        ${kdefLine}
        ${vonaSuggestPanel(v)}
      </div>`;
    }
  }
  return `<div class="rt-panel${trackerOpen?'':' rt-closed'}${trackerMax?' rt-max':''}">
    <div class="rt-panel-head">
      <span class="rt-panel-title">${viewSlot===mySlot?'\u2605 My roster':slotOwnerName(viewSlot)} <span class="rt-panel-slot">\u00b7 seat ${viewSlot}</span>${
        (()=>{ const rr=lr && lr.of(viewSlot);
          if(!rr || !rr.picked) return '';
          const cls = rr.rank<=Math.ceil(n/3) ? 'good' : (rr.rank>n-Math.ceil(n/3) ? 'bad' : '');
          return ` <span class="rt-rank ${cls}" title="This roster's drafted starting-lineup value, ranked against the room — the same yardstick the advisory drafts by">${ordinal(rr.rank)} of ${n}</span>`; })()
      }</span>
      <button class="rt-reseat" onclick="reclaimSeat()" title="Wrong seat? Pick it again">\u21bb change seat</button>
    </div>
    <div class="rt-switch-head">Jump to a team</div>
    <div class="rt-switcher">${switcher}</div>
    <div class="rt-cols">
      <div class="rt-col-main">${advisory}</div>
      <div class="rt-col-side">
        ${needsLine}
        <div class="rt-lineup">${rows}${benchRows}</div>
      </div>
    </div>
  </div>`;
}
function toggleTracker(){ trackerOpen=!trackerOpen; if(!trackerOpen) trackerMax=false; renderRosterBar(); }
function trackerSwipe(dy){
  if(dy<0){ if(!trackerOpen) trackerOpen=true; else trackerMax=true; }
  else { trackerOpen=false; trackerMax=false; }
  renderRosterBar();
}
function viewTrackerSlot(slot){ trackerViewSlot = (slot===trackerViewSlot? null : slot); renderRosterBar(); }
// Re-open the seat picker. Needed when auto-detection picked the wrong seat (pasted draft
// IDs can't be matched to your user), or you simply mis-tapped.
function reclaimSeat(){
  mySlot=null; _trackerNeedsSlotPick=true; trackerViewSlot=null;
  _vonaCache={key:null,val:null};
  renderRosterBar();
  if(currentPhase==='Rankings') renderRankings();
  toast('Pick your seat','ok');
}
function claimSlot(slot){ mySlot=slot; _trackerNeedsSlotPick=false; trackerViewSlot=null; _vonaCache={key:null,val:null}; toast(`Seat ${slot} is yours ★`,'ok'); renderRosterBar(); if(currentPhase==='Rankings') renderRankings(); }

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
  // NOT count+1: keeper drafts pre-populate future picks in the feed from the start, which
  // inflated the count and shifted the clock/pick-lines early. The pick on the clock is the
  // smallest positive pick number missing from the feed.
  const taken=new Set();
  let made=0;
  for(const slot in draftPicksBySlot){
    draftPicksBySlot[slot].forEach(pk=>{ made++; if(pk && pk.pick_no>0) taken.add(pk.pick_no); });
  }
  if(taken.size){
    for(let n=1; n<=made+1; n++){ if(!taken.has(n)) return n; }
    return made+1;
  }
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
// Pick numbers already present in the feed (keeper drafts pre-populate future picks).
// currentPickNo() already skips these when finding the clock; the pick WINDOWS must skip
// them too — a keeper pick is not a live market pick, so counting it made every VONA
// survival probability read low and drifted the board's pick lines in keeper leagues.
function _draftFeedPickNos(){
  const s=new Set();
  for(const slot in draftPicksBySlot){
    draftPicksBySlot[slot].forEach(pk=>{ if(pk && pk.pick_no>0) s.add(pk.pick_no); });
  }
  return s;
}
// ── VONA: Value Over Next Available ─────────────────────────────────────────
// The on-the-clock advisory. Two different sources of truth, deliberately:
//   • VALUE comes from YOUR board (VOR) — what a player is worth to you.
//   • AVAILABILITY comes from the MARKET (Sleeper ADP for this league's format) — what your
//     opponents will actually do, which has nothing to do with your board.
// We Monte-Carlo the picks between now and your next turn: each upcoming team drafts by noisy
// market ADP, restricted to positions IT still needs (so QBs stop flying off once everyone has
// one, but stay scarce in superflex). From those sims we get, per player, the probability he
// survives to your next pick — and per position, the player you'd most likely actually land
// if you wait, plus the expected VOR you'd settle for.
//   dropoff[pos] = bestNowVOR − E[best available VOR at my next pick]
// Returns { gap, onClock, rows:[{pos,bestNow,pHold,bestNext,pNext,expVor,dropoff,adjDrop,need,…}] }

// Mulberry32 — a tiny seeded PRNG. Seeding on the draft state keeps the percentages STABLE
// between 2.5s polls (they only move when a pick is actually made), instead of jittering.
function _vonaRng(seed){
  let t = seed >>> 0;
  return function(){
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
// A precomputed table of standard normals. Drawing Box-Muller inside the sim loop (tens of
// thousands of log/sqrt/cos calls) dominated the runtime; a LUT + cheap index is ~10x faster
// and statistically identical for our purposes.
const _VONA_NORMALS = (function(){
  const N=4096, a=new Float64Array(N);
  let s=0x9e3779b9;
  const r=()=>{ s+=0x6D2B79F5; let t=Math.imul(s^(s>>>15),1|s); t^=t+Math.imul(t^(t>>>7),61|t); return ((t^(t>>>14))>>>0)/4294967296; };
  for(let i=0;i<N;i++){
    let u=0,v=0; while(u===0)u=r(); while(v===0)v=r();
    a[i]=Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
  }
  return a;
})();
// How much a player's real draft slot scatters around his ADP. Uncertainty grows with ADP:
// a 1.02 ADP goes ~1.02, but ADP-90 guys routinely swing +/-20 picks. Floor/cap keep it sane.
function adpSigma(adp){
  if(adp == null || adp >= 999) return 999;   // no market data -> effectively undraftable by ADP
  return Math.min(24, Math.max(3.5, adp * 0.18));
}
const VONA_SIMS = 500;          // sims per advisory (stable via the seeded RNG; SE ≈ ±2.2% at p=0.5)
const VONA_MKT_DEPTH = 40;      // per position, hard cap on who the market can realistically take
let _vonaCache = { key:null, val:null };

// What a draft slot still needs, in enough detail for the sim to reason with:
//   set     — skill positions it can still use (dedicated + flex-eligible)
//   ded     — COUNT of unfilled dedicated slots per position (a slot with one open QB slot
//             must not draft two QBs inside one simulated window)
//   flexSet — positions usable only via a flex slot
//   kdOpen  — unfilled K/DEF starter slots (real late-round demand the skill-only market
//             model used to ignore entirely)
//   remaining — picks this slot has left in the whole draft
function _vonaSlotProfile(slot){
  const picks = (draftPicksBySlot[slot]) || [];
  const { needs } = fillLineup(picks);
  const set = new Set(); const ded = {QB:0,RB:0,WR:0,TE:0}; const flexSet = new Set();
  let kdOpen = 0;
  needs.forEach(s=>{
    if(s==='QB'||s==='RB'||s==='WR'||s==='TE'){ set.add(s); ded[s]++; }
    else if(s==='K'||s==='DEF'){ kdOpen++; }
    else {
      const elig = FLEX_ELIGIBLE[s];
      if(elig) elig.forEach(p=>{ set.add(p); flexSet.add(p); });
    }
  });
  const { rounds } = draftParams();
  const remaining = Math.max(1, rounds - picks.length);
  return { set, ded, flexSet, kdOpen, remaining };
}
function vonaPosNeedsForSlot(slot){ return _vonaSlotProfile(slot).set; }

// Monte-Carlo the pick window. Returns per-player survival probability and, per position,
// how often each player ends up being the best-VOR guy left on YOUR board.
//   pAvail:   Map(pid -> P(still available at my next pick))
//   bestCount:{pos: Map(pid -> times he was the best survivor)}
//   expVor:   {pos: E[VOR of the best survivor]}
//
// Perf notes (this runs on every 2.5s draft poll, so it has to stay cheap):
//   • only the top (gap+10) by ADP per position can plausibly go in a window of `gap` picks
//   • each sim sorts each position ONCE by noisy ADP, then walks a pointer per position —
//     since a team always takes the lowest noisy-ADP player it needs, picks come off the head
//     of a position's list in order, so pointers advance monotonically. O(4) per pick.
// ── Reading the room ────────────────────────────────────────────────────────
// ADP is a national average; the room in front of you is not. In this sample's
// superflex leagues 5.8 quarterbacks go in round one where the 2QB board says
// three — so a survival model that trusts the board tells you a QB is coming
// back to you when he is already gone. Every pick that has happened is evidence
// about THIS room: measure how far ahead of the board each position is running
// and price the rest of that position as if its ADP were that much earlier.
//
// Measured in mock drafts (tools/draft_sim.py): in a room calibrated to how
// these leagues really draft, this cuts the survival model's error at the
// hoarded position from +10.4pp to −0.5pp (1QB, RB-hungry room) and from +6.2pp
// to −4.2pp (superflex QB), improving overall Brier by ~6%. Keep it in sync with
// market_drift() in tools/draft_sim.py.
// Survival-belief contamination, fitted on 116 real 2026 drafts (see
// tools/draft_corpus.py score): with probability EPS a still-available player's
// ADP anchor is simply WRONG for this room — news, a fade — and his hazard is a
// slow exp(-picks/TAU) decay rather than a normal tail. With the truncated
// conditioning this takes the survival model from Brier .18-.20 to .11-.13 on
// held-out real drafts (bias -0.19 -> -0.02). Keep in step with MIX_EPS/MIX_TAU
// in tools/draft_sim.py.
// Defaults only — the LIVE values come from the seed's market_model block,
// which the weekly corpus refresh re-fits from real completed drafts (this
// year's rooms, not last year's). Bounds are enforced here so a bad blob can
// never reach a draft: outside them, the defaults stand.
const VONA_MIX_EPS = 0.25;
const VONA_MIX_TAU = 120;
function _vonaMixParams(){
  const mm=(typeof MARKET_MODEL!=='undefined' && MARKET_MODEL) || null;
  const eps=(mm && typeof mm.eps==='number' && mm.eps>=0 && mm.eps<=0.5) ? mm.eps : VONA_MIX_EPS;
  const tau=(mm && typeof mm.tau==='number' && mm.tau>=20 && mm.tau<=300) ? mm.tau : VONA_MIX_TAU;
  return {eps, tau};
}
// ── What this room has done before ──────────────────────────────────────────
// The drift correction below learns the room from its live picks — but it
// starts every draft knowing nothing. A league's PAST drafts are free evidence:
// if this room has taken its 6th QB by pick 30 three years running, that is
// worth knowing at pick one, not at pick forty. loadRoomHistory walks the
// previous_league_id chain when a follow starts, summarizes each completed
// draft (immutable, so summaries cache in localStorage forever), and the
// summary seeds the drift as a PRIOR that live evidence then overrides.
let roomHistory = null;          // {seasons:[summary], sched:{pos:[...]}, champs:[...]}
const ROOM_HIST_SEASONS = 4;     // how far back to walk
const ROOM_HIST_W = 6;           // pseudo-picks of evidence the prior is worth

// Pure: one past draft's picks -> this room's positional schedule and habits.
// picks: [{no, pos}]. Returns null when the data can't describe a snake room.
function _roomHistSummarize(picks, teams){
  if(!Array.isArray(picks) || !teams || picks.length < teams*4) return null;
  const sched={QB:[],RB:[],WR:[],TE:[]};
  let kdFirst=null;
  [...picks].sort((a,b)=>a.no-b.no).forEach(p=>{
    if(sched[p.pos]) sched[p.pos].push(p.no);
    else if((p.pos==='K'||p.pos==='DEF') && kdFirst==null) kdFirst=Math.ceil(p.no/teams);
  });
  const byR3={}, byR6={};
  Object.keys(sched).forEach(pos=>{
    byR3[pos]=sched[pos].filter(n=>n<=teams*3).length;
    byR6[pos]=sched[pos].filter(n=>n<=teams*6).length;
  });
  return { teams, sched, kdFirst, byR3, byR6 };
}

// Pure: average the per-draft schedules into one "this room" schedule.
function _roomHistAggregate(summaries){
  const use=summaries.filter(Boolean);
  if(!use.length) return null;
  const sched={QB:[],RB:[],WR:[],TE:[]};
  Object.keys(sched).forEach(pos=>{
    const maxK=Math.min(...use.map(s=>s.sched[pos].length));
    for(let k=0;k<maxK;k++)
      sched[pos].push(use.reduce((a,s)=>a+s.sched[pos][k],0)/use.length);
  });
  const mean=(f)=>use.reduce((a,s)=>a+f(s),0)/use.length;
  return { drafts:use.length, teams:use[0].teams, sched,
           kdFirst: use.some(s=>s.kdFirst!=null)
             ? Math.round(mean(s=>s.kdFirst!=null?s.kdFirst:20)) : null,
           byR3:{QB:+mean(s=>s.byR3.QB).toFixed(1), RB:+mean(s=>s.byR3.RB).toFixed(1),
                 WR:+mean(s=>s.byR3.WR).toFixed(1), TE:+mean(s=>s.byR3.TE).toFixed(1)} };
}

// Pure: how many picks EARLY this room historically runs at a position, judged
// against the current board's schedule. Positive = they take them sooner than
// the market prices them. Compared rank-by-rank ("their 4th QB vs the board's
// 4th QB"), which survives the year-to-year change in player names — it is the
// room's structure being measured, not any player.
function _roomHistPrior(histSched, boardSched, teams){
  const out={QB:0,RB:0,WR:0,TE:0};
  if(!histSched) return out;
  Object.keys(out).forEach(pos=>{
    const hs=histSched[pos]||[], sc=boardSched[pos]||[];
    // Judge over the early board — where the habit actually bites.
    const K=Math.min(hs.length, sc.length, Math.max(4, Math.round((teams||12)*0.75)));
    if(K<2) return;
    let d=0;
    for(let k=0;k<K;k++) d += sc[k]-hs[k];
    out[pos]=+(Math.max(-VONA_DRIFT_CAP, Math.min(VONA_DRIFT_CAP, d/K))).toFixed(2);
  });
  return out;
}

async function loadRoomHistory(leagueId){
  if(!leagueId){ roomHistory=null; return; }
  try{
    const { teams } = draftParams();
    const sums=[], champs=[];
    let lid=leagueId;
    for(let i=0;i<ROOM_HIST_SEASONS && lid;i++){
      const lg=await sleeperFetch(`https://api.sleeper.app/v1/league/${lid}`);
      if(!lg) break;
      if(i>0){                                     // past seasons only — this one is live
        for(const d of (await sleeperFetch(`https://api.sleeper.app/v1/league/${lid}/drafts`))||[]){
          if(d.status!=='complete' || d.type!=='snake') continue;
          const dTeams=(d.settings&&d.settings.teams)||lg.total_rosters;
          if(teams && dTeams!==teams) continue;    // an 18-team habit says nothing about a 12
          const ck=`tc_room_hist_${d.draft_id}`;
          let sum=null;
          try{ sum=JSON.parse(localStorage.getItem(ck)||'null'); }catch(e){}
          if(!sum){
            const picks=await sleeperFetch(`https://api.sleeper.app/v1/draft/${d.draft_id}/picks`);
            sum=_roomHistSummarize((picks||[]).map(p=>({no:p.pick_no,
              pos:((p.metadata||{}).position)||''})), dTeams);
            if(sum){ sum.season=lg.season;
              try{ localStorage.setItem(ck, JSON.stringify(sum)); }catch(e){} }
          }
          if(sum) sums.push(sum);
        }
      }
      lid=lg.previous_league_id;
    }
    roomHistory = _roomHistAggregate(sums);
    if(roomHistory){
      _vonaCache={key:null,val:null};
      _cheatCache={key:null,val:null};
      renderRosterBar();
    }
  }catch(e){ roomHistory=null; }
}
const VONA_DRIFT_CAP = 24;    // picks — one strange run must not rewrite the board
const VONA_DRIFT_PRIOR = 4;   // pseudo-picks of "the board is right", damping early noise
const VONA_DRIFT_DEADZONE = 2; // picks — below this the "signal" is just a normal room
function vonaMarketDrift(list){
  const out={QB:0,RB:0,WR:0,TE:0};
  const pickNo = currentPickNo();
  // Before any pick there is no LIVE evidence — but a room with a known history
  // has a prior, and pick one is precisely when it is most of what we know.
  const hasHist = (typeof roomHistory!=='undefined' && !!roomHistory);
  if(!pickNo || (pickNo < 2 && !hasHist)) return out;
  const { teams } = draftParams();
  // What the ROOM has taken, excluding my own picks — my seat must not teach the
  // model that everyone else shares my habits (and that feedback loop compounds).
  const gone={QB:0,RB:0,WR:0,TE:0};
  for(const slot in draftPicksBySlot){
    if(mySlot!=null && Number(slot)===Number(mySlot)) continue;
    (draftPicksBySlot[slot]||[]).forEach(pk=>{ if(pk && gone[pk.pos]!=null) gone[pk.pos]++; });
  }
  const scale = (mySlot!=null && teams>1) ? teams/(teams-1) : 1;
  // The board's own schedule per position: the ADP of its 1st, 2nd, … player.
  const sched={QB:[],RB:[],WR:[],TE:[]};
  (list||[]).forEach(p=>{
    if(!sched[p.pos]) return;
    const a=adpFor(p);
    if(a!=null && a<999) sched[p.pos].push(a);
  });
  // The room's own past, as a prior: worth ROOM_HIST_W picks of evidence at the
  // start, outvoted by the live room as real picks arrive.
  Object.keys(sched).forEach(pos=>sched[pos].sort((a,b)=>a-b));
  const prior = hasHist ? _roomHistPrior(roomHistory.sched, sched, teams)
                        : {QB:0,RB:0,WR:0,TE:0};
  Object.keys(sched).forEach(pos=>{
    const sc=sched[pos];
    if(!sc.length) return;
    const k = gone[pos]*scale;
    // If the room's kth player here was due at pick `due` and it is only pickNo,
    // the room is running (due − pickNo) picks early at this position. With none
    // gone, the signal is that the position's BEST player is still sitting there.
    const due = k>=1 ? sc[Math.min(Math.round(k), sc.length) - 1] : sc[0];
    // Evidence is the larger of what happened and what the board predicted would
    // have happened: "five receivers should be gone and none are" is as strong a
    // statement as five going early, and neither is worth much on pick two.
    let expected=0;
    for(let i=0;i<sc.length && sc[i]<=pickNo;i++) expected++;
    const m = Math.max(k, expected);
    const pw = prior[pos] ? ROOM_HIST_W : 0;
    if(m + pw < 1) return;
    const raw = Math.max(-VONA_DRIFT_CAP, Math.min(VONA_DRIFT_CAP, m>=1 ? due - pickNo : 0));
    // Evidence-weighted blend of what THIS draft shows and what this room has
    // done before, then the same damping and dead zone as ever. By the middle
    // rounds the live term dominates; at pick one the prior is all there is.
    const mixed = (m*raw + pw*prior[pos]) / Math.max(1, m + pw);
    const val = mixed * ((m+pw)/(m+pw+VONA_DRIFT_PRIOR));
    // Every room wobbles a few picks around the board by chance; correcting for
    // that is fitting noise. Move only once the gap is real, and only by the
    // part of it that exceeds the wobble.
    if(Math.abs(val) <= VONA_DRIFT_DEADZONE) return;
    out[pos] = +(val - Math.sign(val)*VONA_DRIFT_DEADZONE).toFixed(2);
  });
  return out;
}

function vonaSimulate(avail, upcomingSlots, pools, drift, nowPick){
  const POSL=['QB','RB','WR','TE'];
  const {eps:mixEps, tau:mixTau}=_vonaMixParams();
  const pidOf = (p)=> p.player_id || p.name;
  const nUp = upcomingSlots.length;
  const profiles = upcomingSlots.map(s=>_vonaSlotProfile(s));
  // A slot's PREVIOUS appearance in this window (snake turns give every other team two picks
  // in my widest windows) — used to stop one team double-drafting a single dedicated need.
  const prevOcc = upcomingSlots.map((s,i)=> upcomingSlots.slice(0,i).lastIndexOf(s));
  // At most `nUp` players come off the board, so we never need more than nUp+10 deep.
  const depth = Math.min(VONA_MKT_DEPTH, nUp + 10);

  // Dense integer ids make the hot loop array-indexed instead of Map/Set-keyed.
  const idOf = new Map();
  avail.forEach((p,i)=>idOf.set(pidOf(p), i));

  // MARKET pools: ordered by ADP, capped. These are who opponents actually consider.
  const mkt={}, mktIds={}, mktAdp={}, mktSig={}, mktU0={};
  POSL.forEach(pos=>{
    const arr = avail.filter(p=>p.pos===pos && adpFor(p)<999).sort((a,b)=>adpFor(a)-adpFor(b)).slice(0,depth);
    mkt[pos]=arr;
    mktIds[pos]=Int32Array.from(arr.map(p=>idOf.get(pidOf(p))));
    // Shift the whole position by the room's drift; sigma still comes from the
    // player's own ADP, since how uncertain his price is hasn't changed.
    const sh=(drift && drift[pos]) || 0;
    mktAdp[pos]=Float64Array.from(arr.map(p=>adpFor(p)-sh));
    mktSig[pos]=Float64Array.from(arr.map(p=>adpSigma(adpFor(p))));
    // A player still on the board at pick N cannot have a market position before
    // N — but the unconditioned draw says he does, prices every faller as "gone
    // immediately", and that is worth a third of the model's error against real
    // drafts (Brier 0.18-0.20 -> 0.11-0.14; when it said 3% back, reality was
    // ~45%). u0 = P(market position <= now); each sim then draws from the
    // truncated remainder. See tools/draft_corpus.py score.
    mktU0[pos]=Float64Array.from(arr.map((p,i)=>{
      if(!(nowPick>1)) return 0;
      return Math.min(0.999999, _vonaNormCdf((nowPick-0.5-mktAdp[pos][i])/mktSig[pos][i]));
    }));
  });
  const inMarket = new Uint8Array(avail.length);
  POSL.forEach(pos=>{ for(const id of mktIds[pos]) inMarket[id]=1; });

  // Your board, as dense ids, best-VOR first.
  const poolIds={}; POSL.forEach(pos=>{ poolIds[pos]=Int32Array.from(pools[pos].map(p=>idOf.get(pidOf(p)))); });

  const survCount = new Int32Array(avail.length);
  const bestCount = {}; POSL.forEach(p=>bestCount[p]=new Map());
  const vorSum = {QB:0,RB:0,WR:0,TE:0};
  const taken = new Uint8Array(avail.length);

  // Seed on the draft state so numbers hold still until a pick actually happens.
  let seed = ((Object.keys(draftedIds).length*7919) ^ ((mySlot||0)*104729) ^ (nUp*31) ^ 0x5f3759df)>>>0;
  const rnd = ()=>{ seed+=0x6D2B79F5; let t=Math.imul(seed^(seed>>>15),1|seed); t^=t+Math.imul(t^(t>>>7),61|t); return ((t^(t>>>14))>>>0)/4294967296; };

  // Scratch reused across sims.
  const order={}, noisy={}, ptr={};
  const pickedPos = new Array(nUp);   // what each window pick took this sim ('KD' | pos | undefined)
  POSL.forEach(pos=>{ order[pos]=new Int32Array(mkt[pos].length); noisy[pos]=new Float64Array(mkt[pos].length); });

  for(let s=0; s<VONA_SIMS; s++){
    taken.fill(0);
    pickedPos.fill(null);
    // Draw one noisy market position per candidate, then sort that position by it.
    POSL.forEach(pos=>{
      const n=mkt[pos].length, no=noisy[pos], od=order[pos], ad=mktAdp[pos], sg=mktSig[pos], u0=mktU0[pos];
      for(let i=0;i<n;i++){
        if(nowPick>1 && rnd()<mixEps){
          // The anchor-is-wrong arm: he goes when this room feels like it,
          // memorylessly, not when national ADP said he would.
          no[i] = nowPick - Math.log(1-rnd())*mixTau;
        } else {
          // Fast path for players nowhere near due; the truncated inverse-CDF
          // draw only where the conditioning actually moves the answer.
          no[i] = (u0[i]<0.02)
            ? ad[i] + _VONA_NORMALS[(rnd()*4096)|0]*sg[i]
            : ad[i] + _vonaInvNorm(Math.min(0.999999, u0[i]+(1-u0[i])*rnd()))*sg[i];
        }
        od[i]=i;
      }
      // small n (<=50) — a plain sort on the index array is fine
      const idx=Array.prototype.slice.call(od).sort((a,b)=>no[a]-no[b]);
      for(let i=0;i<n;i++) od[i]=idx[i];
      ptr[pos]=0;
    });
    // Walk the window: each team takes its lowest noisy-ADP player among positions it needs.
    for(let i=0;i<nUp;i++){
      const prof=profiles[i];
      const need=prof.set;
      const prev=prevOcc[i];
      const prevPick = prev>=0 ? pickedPos[prev] : null;
      // K/DEF exodus: a team with open K/DEF starter slots spends SOME late picks on them —
      // the skill-only model both starved those picks (pessimistic survival) and treated a
      // team whose ONLY remaining needs were K/DEF as an unconstrained skill drafter (the
      // opposite of reality). Hazard = open K/DEF slots over picks remaining, so it ramps to
      // certainty as the draft runs out of room. A K/DEF pick removes no skill player.
      let kdOpen = prof.kdOpen - (prevPick==='KD' ? 1 : 0);
      if(kdOpen>0){
        const pKd = Math.min(0.95, kdOpen / prof.remaining);
        if(rnd() < pKd){ pickedPos[i]='KD'; continue; }
      }
      let bestPos=null, best=Infinity;
      for(let c=0;c<POSL.length;c++){
        const pos=POSL[c];
        if(need.size && !need.has(pos)) continue;
        // This slot already took its single dedicated `pos` earlier in the window and has no
        // flex route to another one — a second is off the table for THIS sim.
        if(prevPick===pos && prof.ded[pos]<=1 && !prof.flexSet.has(pos)) continue;
        const k=ptr[pos];
        if(k>=mkt[pos].length) continue;
        const v=noisy[pos][order[pos][k]];
        if(v<best){ best=v; bestPos=pos; }
      }
      if(bestPos!=null){
        taken[ mktIds[bestPos][ order[bestPos][ ptr[bestPos] ] ] ] = 1;
        ptr[bestPos]++;
        pickedPos[i]=bestPos;
      }
    }
    // Tally survival + who's the best VOR left at each position.
    for(let i=0;i<avail.length;i++){ if(inMarket[i] && !taken[i]) survCount[i]++; }
    POSL.forEach(pos=>{
      const ids=poolIds[pos];
      for(let j=0;j<ids.length;j++){
        if(!taken[ids[j]]){
          const p=pools[pos][j], k=pidOf(p);
          bestCount[pos].set(k,(bestCount[pos].get(k)||0)+1);
          vorSum[pos]+=(p.vor||0);
          break;
        }
      }
    });
  }
  const pAvail = new Map();
  avail.forEach((p,i)=>{
    // Outside the modeled market (no ADP / too deep) -> nobody's taking him.
    pAvail.set(pidOf(p), inMarket[i] ? survCount[i]/VONA_SIMS : 1);
  });
  const expVor = {};
  // Divided by SIMS, not by survivor count, on purpose: a sim where the position emptied
  // means waiting got you nothing — that zero belongs in the expectation.
  POSL.forEach(pos=>{ expVor[pos] = vorSum[pos]/VONA_SIMS; });
  return { pAvail, bestCount, expVor, pidOf };
}

// ── Positional structure: scarcity, cliffs, and lineup impact ────────────────
// Plain VONA answers "what do I lose by waiting ONE pick window?" — which is why it could
// recommend a mid TE over a 3rd RB: the TE happened to have a bigger gap to the next TE right
// now. Three structural signals fix that, each answering a question VONA alone can't:
//
//   1. PRESSURE  — will this position's startable players actually run out? There are only 32
//      NFL starting RBs, so a 12-team league needing ~30 of them is nearly a 1:1 market; a
//      1QB league needs 12 of 32 QBs and will never run dry. Demand is counted from every
//      team's real unfilled slots, so it shrinks as the league fills up.
//   2. FLATNESS  — are the remaining players at this position meaningfully different from each
//      other? This is the punt gate: punting TE is only correct once the top tier is gone AND
//      what's left is interchangeable. Measured as VOR spread per remaining startable player,
//      so it fires on evidence rather than on "I don't have one yet".
//   3. LINEUPGAIN — how many points does this player actually add to MY starting lineup? A 3rd
//      RB that fills an empty FLEX is worth real points; a 2nd TE that rides the bench is
//      worth zero, however big its positional gap looks.
const VONA_STARTABLE = 0;        // VOR > this = a startable (above-replacement) player

// League-wide unfilled starter demand per position, counting flex slots toward every
// position that can fill them (a flex is genuine demand for RB *or* WR *or* TE).
function vonaLeagueDemand(){
  const { teams } = draftParams();
  const dem={QB:0,RB:0,WR:0,TE:0};
  for(let slot=1; slot<=teams; slot++){
    const picks=(draftPicksBySlot[slot])||[];
    const { needs }=fillLineup(picks);
    needs.forEach(sl=>{
      if(dem[sl]!=null){ dem[sl]++; return; }
      const elig=FLEX_ELIGIBLE[sl];
      if(elig) elig.forEach(p=>{ if(dem[p]!=null) dem[p]+=1/elig.length; });
    });
  }
  return dem;
}

// Per-position structure over the AVAILABLE pool (pools are pre-sorted best-VOR-first).
function vonaPosStructure(pools){
  const demand=vonaLeagueDemand();
  const out={};
  let maxStep=0;
  ['QB','RB','WR','TE'].forEach(pos=>{
    const pool=pools[pos]||[];
    const startable=pool.filter(p=>(p.vor||0)>VONA_STARTABLE);
    const supply=startable.length;
    const best=(pool[0] && pool[0].vor) || 0;
    const worst=supply? (startable[supply-1].vor||0) : 0;
    const spread=Math.max(0, best-worst);
    // Average VOR step between consecutive startable players — "how different are they?".
    const step = supply>1 ? spread/(supply-1) : spread;
    if(step>maxStep) maxStep=step;
    out[pos]={ demand:demand[pos]||0, supply, spread:+spread.toFixed(1), step:+step.toFixed(2),
               pressure: supply>0 ? (demand[pos]||0)/supply : (demand[pos]>0?3:0) };
  });
  // Flat = "the value has dropped off and the rest aren't really different from each other",
  // measured on evidence rather than roster counts. Two conditions, both required —
  // INTERCHANGEABLE and SUPPLY — where interchangeable is itself an either/or:
  //   • the remaining startable tier is interchangeable: its total span is small (<14 VOR ≈
  //     one point per game top to bottom) OR its per-player step is tiny (<1.5 VOR — a wide
  //     but gently-sloped pool punts just as safely), and
  //   • supply comfortably outruns what the league still needs, so waiting still lands you one.
  // Deliberately NOT relative to the steepest position: late in a draft the other positions
  // exhaust and their step collapses to 0, which made a relative test stop firing exactly when
  // punting became most correct. This is what keeps a punt honest — TE goes flat early and
  // often, RB almost never does, and a superflex QB market can't (24 of 32 are needed).
  ['QB','RB','WR','TE'].forEach(pos=>{
    const o=out[pos];
    const interchangeable = o.spread < 14 || o.step < 1.5;
    o.flat = o.supply >= Math.ceil(o.demand)+2 && interchangeable;
  });
  return out;
}

// Marginal starting-lineup VALUE from adding one player to my roster. This is the
// cross-positional comparison plain VONA lacks: it prices a pick by what it does to the
// lineup that actually scores, so a FLEX-filling RB beats a bench-riding TE automatically.
// Measured in VOR, not raw points, on purpose: an empty slot will eventually be filled by
// SOMEONE, so a player's true marginal worth is his value over the replacement who'd
// otherwise occupy that slot. Using raw points instead would hand every QB a ~350-point
// "gain" in a 1QB league purely because quarterbacks score more, which is not an edge.
// Value-optimal starters for a hypothetical roster: best-VOR-first, dedicated slots before
// flex (mirrors laFillStarters). The ORDER-greedy fillLineup is right for rendering what you
// actually drafted, but for pricing a candidate it benched any RB whose flex spot was already
// occupied by a weaker WR — scoring a real lineup upgrade as zero gain.
function _vonaOptimalLineupVor(picks, vorOf){
  const slots=draftLineup.map(s=>({slot:s, player:null}));
  const sorted=[...picks].sort((a,b)=>(vorOf(b)||0)-(vorOf(a)||0));
  sorted.forEach(pk=>{
    let idx=slots.findIndex(f=>!f.player && f.slot===pk.pos);
    if(idx<0) idx=slots.findIndex(f=>!f.player && (FLEX_ELIGIBLE[f.slot]||[]).includes(pk.pos));
    if(idx>=0) slots[idx].player=pk;
  });
  return slots.reduce((sum,f)=> sum + (f.player ? Math.max(0, vorOf(f.player)||0) : 0), 0);
}
function vonaLineupGain(myPicks, cand, vorOf){
  const before = _vonaOptimalLineupVor(myPicks, vorOf);
  const after  = _vonaOptimalLineupVor(myPicks.concat([{ pos:cand.pos, name:cand.name, player_id:cand.player_id }]), vorOf);
  return Math.max(0, +(after-before).toFixed(1));
}

// Definitely-out-for-the-year players (IR season-enders) shouldn't headline "take him NOW" —
// they stay in the pools and the options popup (with their tag), they just can't be bestNow.
function _vonaSeasonOut(p){
  if(!p || typeof tcInjuryInfo!=='function') return false;
  try{ const inj=tcInjuryInfo(p.player_id); return !!(inj && inj.seasonOut); }catch(e){ return false; }
}
// Displayed availability %: players outside the ADP universe are "100% available" only in the
// sense that the market model can't see them — cap the display at 99 so it never reads as a
// guarantee for a hyped name the ADP source simply lacks.
function _vonaPctDisp(p, x){
  const v=Math.round((x||0)*100);
  if(v>=100 && p && typeof adpFor==='function' && adpFor(p)>=999) return 99;
  return v;
}
// ── Decision core (ported from tools/draft_sim.py) ──────────────────────────
// The advisory's ranking used to be "biggest positional value drop this window",
// which follows value right off a roster cliff: Monte-Carlo mock drafts against
// this logic finished RB-thin in up to a quarter of drafts and spent picks on a
// 3rd TE in half of them. The sim's agent — scored on actual weekly lineups —
// prices every pick as: weekly value it adds to MY roster now, vs what the same
// position is expected to hand me at my NEXT pick. That core, plus hard budget
// guards (below), eliminated the holes and beat the old advisory by ~4 lineup
// points/wk of composite team quality across seats. See tools/draft_sim.py.

// Weekly value a candidate with season VOR `vor` adds to my roster (the sim's
// candidate_score in the app's units): his optimal-lineup VOR gain when he
// cracks the starting lineup, else bench value — insurance weighted by position
// (RB/WR injuries cash a bench pick in far more often than a backup QB does)
// with a thin-roster kicker until the dedicated slots are doubled. /17 turns
// season VOR into per-week points.
function _vonaCandScore(myPicks, myCounts, dedBase, pos, vor, vorOf, before){
  const PSEUDO='__vona_cand__';
  const vf=(pk)=> (pk.player_id===PSEUDO ? vor : vorOf(pk));
  if(before==null) before=_vonaOptimalLineupVor(myPicks, vf);
  const after=_vonaOptimalLineupVor(myPicks.concat([{pos, name:PSEUDO, player_id:PSEUDO}]), vf);
  const gain=(after-before)/17;
  if(gain>0.05) return gain;
  const over=Math.max(0, vor)/17;
  const thin = myCounts[pos] <= (dedBase[pos]||0) ? 0.15 : 0;
  const w=(pos==='QB'?0.15:pos==='TE'?0.12:0.30)+thin;
  return w*over + 0.04*over;
}

// The pick budget: how many LIVE picks I have left, which of those the roster
// minimums already claim, and the guards that fall out of that arithmetic.
//   skillLeft — remaining live picks minus my open K/DEF starters (those picks
//               are spoken for; the sim harness proves teams that don't reserve
//               them punt a starter instead)
//   minTargets— every dedicated starter, plus flex/bye/injury depth at RB and
//               WR (+2 each), plus a QB body per superflex slot
//   mustFill  — unmet minimums need every remaining pick: anything else is a
//               pick the roster can't afford (gates those rows)
//   lastCall  — a QB/TE starter slot that must be filled within the next pick
//               or two (forces that row to the top)
//   posCap    — headline caps: 2 QB / 2 TE in 1-QB leagues (superflex raises
//               the QB room) — a 3rd is a wasted pick the sim punishes hard
function _vonaBudget(myLivePicks, kdOpenMine, myCounts, dedBase, sfSlots, dedicatedNeed){
  const skillLeft=Math.max(0, myLivePicks - kdOpenMine);
  const minTargets={ QB:dedBase.QB+sfSlots, TE:dedBase.TE, RB:dedBase.RB+2, WR:dedBase.WR+2 };
  const unmet={}; let unmetTotal=0;
  Object.keys(minTargets).forEach(pos=>{
    unmet[pos]=Math.max(0, minTargets[pos]-myCounts[pos]); unmetTotal+=unmet[pos];
  });
  const mustFill = unmetTotal>0 && unmetTotal >= skillLeft;
  const picksAfter = skillLeft-1;
  const lastCall={};
  [['QB',2],['TE',1]].forEach(([pos,room])=>{
    if(dedicatedNeed.has(pos) && picksAfter<=room) lastCall[pos]=true;
  });
  // QB room: one spare behind the startable slots wherever the lineup starts
  // more than one QB — dedicated 2-QB lineups (BAFL) count exactly like a
  // superflex here. The old `sfSlots ? … : 2` capped a 2-QB league at its bare
  // starters and gated the row forever, in rooms whose winners carry five.
  const qbSlots=dedBase.QB+sfSlots;
  const posCap={ QB: qbSlots>=2 ? qbSlots+1 : 2, TE: Math.max(2, dedBase.TE+1), RB:8, WR:9 };
  return { skillLeft, minTargets, unmet, unmetTotal, mustFill, picksAfter, lastCall, posCap };
}

// ── Which PLAYER at that position — the reach guard ────────────────────────
// The core above answers "which POSITION?" and then names that position's top
// player on YOUR board. That is where reaching comes from: a player your
// projections love and the market does not stays the top of his position every
// pick until you spend one on him, and nothing notices he would still be sitting
// there two rounds later.
//
// So decide between the men at that position over two picks:
//
//   total(p) = what p adds to my lineup now
//            + what the best of the OTHERS is worth if he survives to my next pick
//
// Restricted to one position this is well posed, and it says the obvious thing:
// if your #1 will last and your #2 will not, take #2 now and let #1 come back.
// The cost of reaching is just the value you forfeit at your next pick — no
// hand-tuned "reach penalty" needed.
//
// Applying the same two-ply ACROSS positions was measured and is worse (1QB
// -0.07, superflex -1.25 over 12 seats): a one-pick horizon always promises a
// good player is still coming, so the agent waits on scarce positions until they
// are gone. Cross-positional judgement stays with the scarcity/need scoring
// above. Keep in sync with _best_in_pos in tools/draft_sim.py.
// How hard raw board value pulls against the regret of waiting. Swept over
// 0/.10/.15/.25/.40/.60 across 12 seats x 2 formats: 0 is much worse (when two
// players will both last you should still take the better one) and 0.25 — what
// this shipped before — reaches. 0.15 measured best. Keep in step with
// V5_NOW_WEIGHT in tools/draft_sim.py.
const VONA_NOW_WEIGHT = 0.15;
// How deep the position tab lets you browse. Deeper than anyone drafts from, but
// bounded so the scroll list stays a list and not the whole player universe.
const VONA_BOARD_DEPTH = 40;
const VONA_CAND_PER_POS = 4;    // players per position considered
const VONA_TAIL = 0.9;          // residual when none of the others survive
const VONA_SURV_CAP = 0.995;
function _vonaRankInPos(cands, myPicks, myCounts, dedBase, vorOf, survOf, before0){
  const top=cands.slice(0, VONA_CAND_PER_POS);
  if(!top.length) return [];
  const surv=top.map(q=>Math.min(VONA_SURV_CAP, survOf(q)));
  const out=[];
  top.forEach((p,i)=>{
    const vNow=_vonaCandScore(myPicks, myCounts, dedBase, p.pos, (p.vor||0), vorOf, before0);
    const picks2=myPicks.concat([{pos:p.pos, name:p.name, player_id:p.player_id}]);
    const counts2=Object.assign({}, myCounts); counts2[p.pos]=(counts2[p.pos]||0)+1;
    const before2=_vonaOptimalLineupVor(picks2, (pk)=>vorOf(pk));
    let ev=0, pNone=1;
    top.forEach((q,j)=>{
      if(j===i) return;
      const sc=_vonaCandScore(picks2, counts2, dedBase, q.pos, (q.vor||0), vorOf, before2);
      ev += pNone*surv[j]*sc;
      pNone *= (1-surv[j]);
    });
    const last=top[top.length-1];
    ev += pNone*_vonaCandScore(picks2, counts2, dedBase, last.pos, (last.vor||0), vorOf, before2)*VONA_TAIL;
    out.push({ p, pos:p.pos, vNow:+vNow.toFixed(3), vNext:+ev.toFixed(3),
               total:+(vNow+ev).toFixed(3), pHold:surv[i] });
  });
  out.sort((a,b)=> (b.total-a.total) || (b.vNow-a.vNow));
  return out;
}

function computeVONA(){
  if(mySlot==null) return null;
  let gap = picksUntilMyTurn(mySlot);              // picks between now and my next turn
  if(gap==null) return null;
  const onClock = (gap===0);
  const { teams, type, reversalRound, rounds } = draftParams();
  const startPick = currentPickNo();
  // The exact sequence of SLOTS picking between now and my next turn.
  const upcomingSlots=[];
  {
    const myUps = myUpcomingPickNumbers(mySlot);
    const endPick = onClock ? (myUps[1]!=null?myUps[1]:startPick) : (myUps[0]!=null?myUps[0]:startPick);
    const from = onClock ? startPick+1 : startPick;   // on the clock: picks AFTER mine
    const feed = _draftFeedPickNos();                 // keeper picks are already spent
    for(let n=from; n<endPick; n++){
      if(feed.has(n)) continue;
      upcomingSlots.push(slotOnClock(n, teams, type, reversalRound));
    }
    gap = upcomingSlots.length;
  }
  // Cache: the sim is deterministic for a given draft state, so only redo it when that changes.
  // ...and when the board itself changes: scoring edits, projection edits (epoch), league shape.
  const cacheKey = `${Object.keys(draftedIds).length}|${mySlot}|${gap}|${rankFormat}|${startPick}|${buildPlayerScoringSig()}|${_buildPlayerCacheEpoch}|${typeof buildPlayerShapeSig==='function'?buildPlayerShapeSig():''}`;
  if(_vonaCache.key===cacheKey && _vonaCache.val) return _vonaCache.val;

  const list = buildPlayerList();
  const avail = list.filter(p=>!draftedIds[p.player_id]);
  if(!avail.length) return null;

  // YOUR board: pools per position, best-first by VOR.
  const pools={QB:[],RB:[],WR:[],TE:[]};
  avail.forEach(p=>{ if(pools[p.pos]) pools[p.pos].push(p); });
  Object.keys(pools).forEach(k=>pools[k].sort((a,b)=>(b.vor||0)-(a.vor||0)));
  const bestNow={};
  ['QB','RB','WR','TE'].forEach(pos=>{ bestNow[pos]=pools[pos].find(p=>!_vonaSeasonOut(p)) || pools[pos][0] || null; });

  const drift = vonaMarketDrift(list);
  const sim = vonaSimulate(avail, upcomingSlots, pools, drift, startPick);
  const byId = new Map(avail.map(p=>[sim.pidOf(p), p]));

  // ── My own remaining needs (for the discount) ─────────────────────────────
  const myPicks=(draftPicksBySlot[mySlot])||[];
  const { needs: myNeeds }=fillLineup(myPicks);
  const dedicatedNeed=new Set();
  const flexNeed=new Set();
  myNeeds.forEach(s=>{
    if(s==='QB'||s==='RB'||s==='WR'||s==='TE') dedicatedNeed.add(s);
    else { const elig=FLEX_ELIGIBLE[s]; if(elig) elig.forEach(p=>flexNeed.add(p)); }
  });

  const WORTH_A_BACKUP=20;   // VOR above which a 2nd QB/TE is worth taking even if slot filled
  // Structural context + a points lookup for lineup math (needs drafted players too, so it's
  // built from the full list rather than the available pool).
  const struct = vonaPosStructure(pools);
  const vorById = new Map();
  list.forEach(p=>{ vorById.set(p.player_id||p.name, p.vor||0); });
  const vorOf = pk => vorById.get(pk.player_id || pk.name) || 0;

  // ── Pick budget + roster-minimum guards (see _vonaBudget) ─────────────────
  const feedNos=_draftFeedPickNos();
  const myLivePicks=myUpcomingPickNumbers(mySlot).filter(n=>!feedNos.has(n)).length;
  const kdOpenMine=myNeeds.filter(s=>s==='K'||s==='DEF').length;
  const myCounts={QB:0,RB:0,WR:0,TE:0};
  myPicks.forEach(pk=>{ if(myCounts[pk.pos]!=null) myCounts[pk.pos]++; });
  const dedBase={QB:0,RB:0,WR:0,TE:0}; let sfSlots=0;
  draftLineup.forEach(s=>{
    if(dedBase[s]!=null) dedBase[s]++;
    else if(s==='SUPER_FLEX') sfSlots++;
  });
  const budget=_vonaBudget(myLivePicks, kdOpenMine, myCounts, dedBase, sfSlots, dedicatedNeed);
  // Reach guard: at each position, decide WHICH player to take over a two-pick
  // horizon (see _vonaRankInPos). rankedByPos also feeds the position filter in
  // the suggestions panel, so the list you can browse is ranked the same way the
  // headline is chosen.
  const survOf=(q)=> sim.pAvail.get(sim.pidOf(q)) || 0;
  const before0=_vonaOptimalLineupVor(myPicks, vorOf);
  const rankedByPos={};
  ['QB','RB','WR','TE'].forEach(pos=>{
    const live=(pools[pos]||[]).filter(q=>!_vonaSeasonOut(q));
    rankedByPos[pos]=_vonaRankInPos(live.length?live:(pools[pos]||[]), myPicks, myCounts,
                                    dedBase, vorOf, survOf, before0);
  });
  const out=[];
  ['QB','RB','WR','TE'].forEach(pos=>{
    const now=bestNow[pos];
    if(!now) return;
    // The player you'd MOST LIKELY actually land at this position if you wait — i.e. the guy
    // who most often ends up as the best survivor on your board. This is the concrete
    // "here's what waiting looks like" answer.
    let bestNextId=null, bestNextHits=-1;
    sim.bestCount[pos].forEach((cnt,k)=>{ if(cnt>bestNextHits){ bestNextHits=cnt; bestNextId=k; } });
    const bestNext = bestNextId ? byId.get(bestNextId) : null;
    const expVor = sim.expVor[pos];
    const rawDrop = +((now.vor||0) - expVor).toFixed(1);
    const isDedicated = dedicatedNeed.has(pos);
    const isFlexElig  = flexNeed.has(pos);
    const st = struct[pos] || {pressure:0, flat:false, supply:0, step:0};
    // Base need weight, as before: an unfilled dedicated slot matters most.
    let weight;
    if(isDedicated) weight=1;
    else if(isFlexElig) weight=0.6;
    else weight=((now.vor||0)>=WORTH_A_BACKUP ? 0.5 : 0.15);
    // SCARCITY: when league-wide demand approaches or exceeds the startable supply, waiting
    // stops being a choice — those players simply won't exist later. Ramps in above ~0.8
    // demand-per-supply and tops out at +80%, so a tight RB/superflex-QB market gets pushed
    // up without letting one signal run away with the recommendation.
    const scarcity = 1 + Math.min(0.8, Math.max(0, st.pressure-0.8)*0.9);
    // PUNT GATE: only discount a position once the evidence says the rest are interchangeable
    // AND supply comfortably covers demand. This is what stops "I have no TE" from
    // out-shouting "startable RBs are nearly gone" in the middle rounds.
    const puntable = st.flat && !(isDedicated && st.pressure>=1);
    const puntMult = puntable ? 0.45 : 1;
    weight = weight * scarcity * puntMult;
    const lineupGain = vonaLineupGain(myPicks, now, vorOf);
    // Decision core: value added now vs value expected at my next pick, priced
    // on MY roster (expVor comes from the availability MC above). The gates:
    // a position past its cap, or one the must-fill budget can't spare a pick
    // for, ranks below every live option no matter its score.
    const gNow = _vonaCandScore(myPicks, myCounts, dedBase, pos, (now.vor||0), vorOf);
    const gNext = _vonaCandScore(myPicks, myCounts, dedBase, pos, Math.max(0, expVor), vorOf);
    const gated = (myCounts[pos] >= budget.posCap[pos]) || (budget.mustFill && !budget.unmet[pos]);
    // WHO to take here: the reach guard's winner, not automatically the top of
    // your board. The position's SCORE below is still computed from `now` (the
    // board leader) — that is the ranking the mock drafts validated; the guard
    // only changes which man at the position it names.
    const take=(rankedByPos[pos] && rankedByPos[pos][0] && rankedByPos[pos][0].p) || now;
    const reached=(take!==now);
    out.push({
      pos,
      struct: st, scarcity:+scarcity.toFixed(2), puntable, lineupGain,
      bestNow: take,
      boardTop: now,
      reached,
      ranked: rankedByPos[pos]||[],
      pHold: sim.pAvail.get(sim.pidOf(take)) || 0,         // P(the guy you'd take now is still there)
      bestNext,
      pNext: bestNext ? (sim.pAvail.get(bestNextId)||0) : 0,
      nextShare: bestNextHits>0 ? bestNextHits/VONA_SIMS : 0,  // how often he IS the fallback
      expVor: +expVor.toFixed(1),
      dropoff: rawDrop,
      adjDrop: +(rawDrop*weight).toFixed(1),
      need: isDedicated,
      filled: !isDedicated,
      flexEligible: isFlexElig,
      studBackup: !isDedicated && (now.vor||0)>=WORTH_A_BACKUP,
      gated,
      drift: +(((drift && drift[pos]) || 0).toFixed(1)),
      lastCall: !!budget.lastCall[pos],
      score: +(Math.max(0, gNow-gNext) + VONA_NOW_WEIGHT*gNow).toFixed(2),
    });
  });
  // lineupFactor stays as display metadata; the row score already prices lineup impact
  // directly through _vonaCandScore's optimal-lineup gain.
  const maxGain = Math.max(1, ...out.map(r=>r.lineupGain||0));
  out.forEach(r=>{
    r.lineupFactor = +(0.35 + 0.65*((r.lineupGain||0)/maxGain)).toFixed(2);
    // Short human reason for why this row sits where it does — shown under the pick.
    const st=r.struct||{};
    // Keep this SHORT and rare. A sentence on every row buries the recommendation and, on a
    // phone, squeezes the player's name into an ellipsis. Only genuinely decision-changing
    // signals earn a line: a starter is about to become unfillable, the budget can't spare
    // the pick, the pool is flat enough to punt, or supply is so tight that waiting risks
    // not getting one at all.
    const dr = (drift && drift[r.pos]) || 0;
    r.why = r.lastCall ? 'last call \u2014 starter still open'
          : r.gated ? (myCounts[r.pos]>=budget.posCap[r.pos]
              ? 'roster full here'
              : `${budget.skillLeft} pick${budget.skillLeft===1?'':'s'} left \u2014 needs elsewhere`)
          : r.puntable ? 'flat \u2014 safe to wait'
          // The room outrunning the board is decision-changing on its own: it is
          // why the odds below moved without the player's ranking moving.
          : (dr>=6 ? `room ${Math.round(dr)} picks ahead here`
          : (st.pressure>=1.15 ? `${st.supply} left \u00b7 ${Math.round(st.demand)} slots` : ''));
  });
  // Gated rows sink below every live option; a last-call starter overrides everything.
  out.sort((a,b)=> ((a.gated?1:0)-(b.gated?1:0))
    || ((b.lastCall?1:0)-(a.lastCall?1:0))
    || (b.score-a.score));
  // My own K/DEF endgame: when my remaining LIVE picks barely cover my open K/DEF starter
  // slots, say so — the four skill rows above will happily spend every last pick otherwise.
  let kdefAlert=null;
  if(kdOpenMine>0 && myLivePicks>0 && myLivePicks <= kdOpenMine+1){
    kdefAlert={ open:myNeeds.filter(s=>s==='K'||s==='DEF'), picksLeft:myLivePicks };
  }
  // Every remaining live pick belongs to K/DEF: the skill rows are moot and the headline
  // should say so instead of naming a player there's no pick left for.
  const kdNow = kdOpenMine>0 && myLivePicks>0 && myLivePicks <= kdOpenMine;
  // The suggestions panel reads PLAYERS, not positions: the rows are already in
  // engine order (gated last, last-call first), so the top of each row is the
  // nth-best thing to do right now.
  const picks = out.filter(r=>r.bestNow).map((r,i)=>({
    rank:i+1, pos:r.pos, p:r.bestNow, pHold:r.pHold, why:r.why, gated:r.gated,
    lastCall:r.lastCall, need:r.need, reached:r.reached, boardTop:r.boardTop,
    ranked:r.ranked, score:r.score,
    bestNext:r.bestNext, nextShare:r.nextShare, pNext:r.pNext,
  }));
  const res = { gap, rows: out, picks, onClock, struct, pools, pAvail: sim.pAvail, kdefAlert,
                kdNow, budget, drift, pickNo: startPick };
  _vonaCache = { key:cacheKey, val:res };
  return res;
}






















































if(typeof TC_INFO_BOOK!=='undefined'){
  TC_INFO_BOOK['vonaplan']={title:'The draft plan', body:`
    Full mock drafts run from <b>your seat</b>, on <b>your board</b>: the other teams buy at market
    ADP for this format, and you draft with the advisory's own rules \u2014 so it builds a roster
    rather than listing whoever has the highest projection left.
    <b>% taken</b> is how often the plan spends that pick on him. The <b>%</b> beside it is how often
    he is even still on the board there. A player who is nearly always available and rarely taken is
    one you can afford to wait on, and that gap is the edge worth having.
    \u2605 anyone and he is pinned to the last round you can still count on getting him \u2014 or
    flagged as unreachable from this seat, rather than dangled as a target you can't have.`};
  TC_INFO_BOOK.vona={title:'On-the-clock advice', body:()=>`
    Value comes from <b>your VOR board</b> \u2014 what a player is worth to you. Availability comes
    from the market: Sleeper ${typeof formatLabel==='function'?formatLabel(rankFormat):''} ADP,
    Monte-Carlo simulated over the picks before you're up, with each opposing team drafting by
    noisy ADP restricted to positions it still needs \u2014 and when this league has past drafts,
    the room model starts from <b>what this room has actually done before</b> (its own draft
    history, cached locally) and lets the live picks outvote that prior as they land. Positions
    are ranked by what the pick does
    for <b>your weekly starting lineup</b>: value added now vs what the same position is expected
    to hand you at your next pick \u2014 so a FLEX-filling RB outranks a bench TE automatically.
    A pick <b>budget</b> guards your roster: every remaining pick is weighed against unfilled
    starters, RB/WR depth, and your K/DEF slots, so following the headline never strands a hole.
    Dimmed rows are parked by that budget; \u201clast call\u201d means a starter must be taken now.
    Within a position the named player is chosen over <b>two picks</b>, not just by your board:
    if your #1 there would still be sitting at your next pick and your #2 would not, it names
    the #2 and lets the other come back to you \u2014 so following it never spends a pick on a
    player the market was going to leave you anyway.
    The %-pill is the chance a player makes it back to your next pick; \u25be lists the next
    viable options at that position.`};
}
