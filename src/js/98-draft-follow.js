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
  return `<span class="rt-thumb">${pid
    ? `<img src="${SLEEPER_HEADSHOT(pid)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : ''}</span>`;
}
// A roster row's player cell: photo + full name (with an abbreviated variant CSS swaps in when
// the panel is too narrow) + position/team.
function playerCell(p){
  return `${playerThumb(p)}<span class="rt-pname" title="${p.name}">` +
    `<span class="rt-nm-full">${p.name}</span>` +
    `<span class="rt-nm-abbr">${abbrevName(p.name)}</span></span>` +
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
      const nm=(p)=> p ? p.name.split(' ').slice(-1)[0] : '\u2014';
      const pct=(x)=> Math.round((x||0)*100);
      // Colour the availability % like a traffic light: green = safe to wait, red = he's gone.
      const pcls=(x)=> x>=0.6 ? 'vp-hi' : (x>=0.3 ? 'vp-mid' : 'vp-lo');
      const chips=v.rows.slice(0,4).map((r,i)=>{
        const cls = r.adjDrop>=25?'vona-hot':r.adjDrop>=12?'vona-warm':'vona-cool';
        const star = (i===0 && r.need) ? '\u2605 ' : '';
        const tag = r.filled ? (r.studBackup?`<span class="vona-tag stud">stud backup</span>`:`<span class="vona-tag">filled</span>`) : '';
        const dropTxt = r.filled ? `\u2212${r.dropoff} <span class="vona-adj">(adj \u2212${r.adjDrop})</span>` : `\u2212${r.dropoff}`;
        // Line 1: the guy you'd take right now, and the market's odds he lasts to your next pick.
        // Line 2: who you'd most likely settle for instead — the concrete cost of waiting.
        const waitLine = r.bestNext && r.bestNext!==r.bestNow
          ? `<div class="vona-wait">wait \u2192 <b>${nm(r.bestNext)}</b>
               <span class="vona-vor">${(r.bestNext.vor||0)>0?'+':''}${(r.bestNext.vor||0).toFixed(0)}</span>
               <span class="vona-pct ${pcls(r.nextShare)}">${pct(r.nextShare)}% likely available</span></div>`
          : `<div class="vona-wait vona-wait-safe">wait \u2192 <b>${nm(r.bestNow)}</b> likely still available</div>`;
        return `<div class="vona-row ${r.need?'':'vona-filled'} ${cls}">
          <span class="rt-slot ${slotClass(r.pos)}">${r.pos}</span>
          <div class="vona-main">
            <div class="vona-now"><b>${nm(r.bestNow)}</b>
              <span class="vona-vor">${(r.bestNow.vor||0)>0?'+':''}${(r.bestNow.vor||0).toFixed(0)}</span>
              <span class="vona-pct ${pcls(r.pHold)}" title="Chance they make it back to your next pick, per market ADP">${pct(r.pHold)}% chance they make it back</span>${tag}</div>
            ${waitLine}
          </div>
          <span class="vona-drop" title="Your VOR now minus the VOR you'd expect to settle for">${star}${dropTxt}</span>
        </div>`;
      }).join('');
      // headline = biggest drop among positions I still NEED; fall back to top row
      const needRows=v.rows.filter(r=>r.need);
      const rec = needRows[0] || v.rows[0];
      const alsoBig = v.rows.find(r=>r!==rec && r.dropoff>=12);
      let recTxt='';
      if(rec){
        recTxt = `Take a <b>${rec.pos}</b> \u2014 biggest need-value cliff (\u2212${rec.dropoff})`;
        if(rec.filled) recTxt = `Best value: <b>${rec.pos}</b> (\u2212${rec.dropoff}) \u2014 but your starters are set`;
      }
      const noteTxt = (rec && !rec.need && needRows.length===0)
        ? `All starters filled \u2014 now drafting for value/depth.`
        : (alsoBig ? `Also watch <b>${alsoBig.pos}</b> (\u2212${alsoBig.dropoff}).` : '');
      advisory=`<div class="vona-box">
        <div class="vona-head">\ud83d\udcca On-the-clock advice ${v.onClock?'\u00b7 <b style="color:var(--accent)">YOU\u2019RE UP</b>':`\u00b7 next pick in ${v.gap}`}</div>
        <div class="vona-sub">${recTxt}${noteTxt?` \u00b7 ${noteTxt}`:''}</div>
        <div class="vona-rows">${chips}</div>
        <div class="vona-legend">Value from your VOR board \u00b7 availability from Sleeper ${formatLabel(rankFormat)} ADP, simulated over the ${v.gap} pick${v.gap===1?'':'s'} before you\u2019re up.</div>
      </div>`;
    }
  }
  return `<div class="rt-panel">
    <div class="rt-panel-head">
      <span class="rt-panel-title">${viewSlot===mySlot?'\u2605 My roster':slotOwnerName(viewSlot)} <span class="rt-panel-slot">\u00b7 seat ${viewSlot}</span></span>
      <button class="rt-reseat" onclick="reclaimSeat()" title="Wrong seat? Pick it again">\u21bb change seat</button>
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
const VONA_SIMS = 240;          // sims per advisory (stable via the seeded RNG)
const VONA_MKT_DEPTH = 40;      // per position, hard cap on who the market can realistically take
let _vonaCache = { key:null, val:null };

// The positions a given draft slot still needs (from that team's actual filled lineup).
function vonaPosNeedsForSlot(slot){
  const picks = (draftPicksBySlot[slot]) || [];
  const { needs } = fillLineup(picks);
  const set = new Set();
  needs.forEach(s=>{
    if(s==='QB'||s==='RB'||s==='WR'||s==='TE') set.add(s);
    else {
      const elig = FLEX_ELIGIBLE[s];
      if(elig) elig.forEach(p=>set.add(p));
    }
  });
  return set;
}

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
function vonaSimulate(avail, upcomingSlots, pools){
  const POSL=['QB','RB','WR','TE'];
  const pidOf = (p)=> p.player_id || p.name;
  const nUp = upcomingSlots.length;
  const needsBySlot = upcomingSlots.map(s=>vonaPosNeedsForSlot(s));
  // At most `nUp` players come off the board, so we never need more than nUp+10 deep.
  const depth = Math.min(VONA_MKT_DEPTH, nUp + 10);

  // Dense integer ids make the hot loop array-indexed instead of Map/Set-keyed.
  const idOf = new Map();
  avail.forEach((p,i)=>idOf.set(pidOf(p), i));

  // MARKET pools: ordered by ADP, capped. These are who opponents actually consider.
  const mkt={}, mktIds={}, mktAdp={}, mktSig={};
  POSL.forEach(pos=>{
    const arr = avail.filter(p=>p.pos===pos && adpFor(p)<999).sort((a,b)=>adpFor(a)-adpFor(b)).slice(0,depth);
    mkt[pos]=arr;
    mktIds[pos]=Int32Array.from(arr.map(p=>idOf.get(pidOf(p))));
    mktAdp[pos]=Float64Array.from(arr.map(p=>adpFor(p)));
    mktSig[pos]=Float64Array.from(arr.map(p=>adpSigma(adpFor(p))));
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
  POSL.forEach(pos=>{ order[pos]=new Int32Array(mkt[pos].length); noisy[pos]=new Float64Array(mkt[pos].length); });

  for(let s=0; s<VONA_SIMS; s++){
    taken.fill(0);
    // Draw one noisy market position per candidate, then sort that position by it.
    POSL.forEach(pos=>{
      const n=mkt[pos].length, no=noisy[pos], od=order[pos], ad=mktAdp[pos], sg=mktSig[pos];
      for(let i=0;i<n;i++){ no[i] = ad[i] + _VONA_NORMALS[(rnd()*4096)|0]*sg[i]; od[i]=i; }
      // small n (<=50) — a plain sort on the index array is fine
      const idx=Array.prototype.slice.call(od).sort((a,b)=>no[a]-no[b]);
      for(let i=0;i<n;i++) od[i]=idx[i];
      ptr[pos]=0;
    });
    // Walk the window: each team takes its lowest noisy-ADP player among positions it needs.
    for(let i=0;i<nUp;i++){
      const need=needsBySlot[i];
      let bestPos=null, best=Infinity;
      for(let c=0;c<POSL.length;c++){
        const pos=POSL[c];
        if(need.size && !need.has(pos)) continue;
        const k=ptr[pos];
        if(k>=mkt[pos].length) continue;
        const v=noisy[pos][order[pos][k]];
        if(v<best){ best=v; bestPos=pos; }
      }
      if(bestPos!=null){
        taken[ mktIds[bestPos][ order[bestPos][ ptr[bestPos] ] ] ] = 1;
        ptr[bestPos]++;
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
  POSL.forEach(pos=>{ expVor[pos] = vorSum[pos]/VONA_SIMS; });
  return { pAvail, bestCount, expVor, pidOf };
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
    for(let n=from; n<endPick; n++) upcomingSlots.push(slotOnClock(n, teams, type, reversalRound));
    gap = upcomingSlots.length;
  }
  // Cache: the sim is deterministic for a given draft state, so only redo it when that changes.
  const cacheKey = `${Object.keys(draftedIds).length}|${mySlot}|${gap}|${rankFormat}|${startPick}`;
  if(_vonaCache.key===cacheKey && _vonaCache.val) return _vonaCache.val;

  const list = buildPlayerList();
  const avail = list.filter(p=>!draftedIds[p.player_id]);
  if(!avail.length) return null;

  // YOUR board: pools per position, best-first by VOR.
  const pools={QB:[],RB:[],WR:[],TE:[]};
  avail.forEach(p=>{ if(pools[p.pos]) pools[p.pos].push(p); });
  Object.keys(pools).forEach(k=>pools[k].sort((a,b)=>(b.vor||0)-(a.vor||0)));
  const bestNow={};
  ['QB','RB','WR','TE'].forEach(pos=>{ bestNow[pos]=pools[pos][0]||null; });

  const sim = vonaSimulate(avail, upcomingSlots, pools);
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
    let weight;
    if(isDedicated) weight=1;
    else if(isFlexElig) weight=0.6;
    else weight=((now.vor||0)>=WORTH_A_BACKUP ? 0.5 : 0.15);
    out.push({
      pos,
      bestNow: now,
      pHold: sim.pAvail.get(sim.pidOf(now)) || 0,          // P(the guy you'd take now is still there)
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
    });
  });
  out.sort((a,b)=> b.adjDrop-a.adjDrop);
  const res = { gap, rows: out, onClock };
  _vonaCache = { key:cacheKey, val:res };
  return res;
}





















































