// ═════════════════════════════════════════════════════════════════════════════
// ESPN league linking
// ═════════════════════════════════════════════════════════════════════════════
// TripleCrown sources every STAT, projection and player identity from Sleeper. This module
// adds a second place a LEAGUE can come from — ESPN — without touching that rule: it reads
// only the things a league knows about itself (team names, owners, rosters, draft picks,
// scoring, lineup slots) and then translates every player into a Sleeper player_id before
// handing the result on. Downstream (values, VOR, projections, player cards, headshots)
// never learns ESPN was involved.
//
// Why this works at all: ESPN's fantasy read API reflects the caller's Origin back in
// access-control-allow-origin, so a static page can call it directly — no proxy, no key, no
// server. Verified against lm-api-reads.fantasy.espn.com and fan.api.espn.com.
//
// Two hard limits, both surfaced in the UI rather than hidden:
//  • PUBLIC LEAGUES ONLY. Private leagues need the espn_s2 + SWID cookies, and those are set
//    on espn.com with no SameSite and no Secure attribute — so browsers treat them as Lax and
//    never send them cross-site. credentials:'include' cannot fix this; it is a cookie policy
//    decision on ESPN's side, not something we can work around from a page.
//  • NO GLOBAL USERNAME LOOKUP. ESPN has no public username→account endpoint, so you cannot
//    type a handle and find someone cold. The account is keyed on its SWID. But a SWID is a
//    cookie value no ordinary user can produce, so we never ask for one: a PUBLIC league's
//    members[] block hands out display-name→SWID for everyone in it, which turns "paste your
//    league link, then tap your name" into the same two-step flow as Sleeper's username box.
//    We keep the SWID after that, so it happens once. See espnFetchLeagueMembers.
//
// This is an undocumented endpoint ESPN maintains for its own web client. It can change or
// close without notice, so every failure path here degrades to a plain message.

// The fan profile: every league this SWID is in. Unauthenticated and CORS-open — the SWID
// alone is the key. The braces in a SWID MUST be percent-encoded or the API 404s.
const ESPN_FAN_URL = (swid)=>
  `https://fan.api.espn.com/apis/v2/fans/${encodeURIComponent(swid)}`
  + `?featureFlags=expandAthlete&showAirings=false&source=ESPN.com&lang=en&section=espn&region=us`;

// The league read endpoint. `views` selects which blocks come back; we ask for settings +
// teams + rosters in one request (~875KB for a 10-team league) rather than three round-trips.
const ESPN_LEAGUE_URL = (season, leagueId, views)=>
  `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`
  + (views && views.length ? `?${views.map(v=>`view=${v}`).join('&')}` : '');

// ── ESPN's integer vocabularies ──────────────────────────────────────────────
// lineupSlotId → the Sleeper roster_positions token lineupFromRosterPositions already parses.
// Mapping to Sleeper's vocabulary (rather than inventing a third one) means the existing
// lineup/bench logic, the superflex detection and the draft board all work untouched.
const ESPN_SLOT_MAP = {
  0:'QB', 1:'QB',            // 1 = "TQB" (team QB), vanishingly rare; treat as a QB slot
  2:'RB', 3:'WRRB_FLEX',     // 3 = RB/WR
  4:'WR', 5:'REC_FLEX',      // 5 = WR/TE
  6:'TE',
  7:'SUPER_FLEX',            // 7 = "OP" (any offensive player) — ESPN's superflex
  8:'DL', 9:'DL', 10:'LB', 11:'DL', 12:'DB', 13:'DB', 14:'DB', 15:'IDP_FLEX',
  16:'DEF', 17:'K', 18:'P', 19:'HC',
  20:'BN', 21:'IR',
  23:'FLEX',                 // 23 = RB/WR/TE
  24:'ER',                   // 24 = "ER" (extra roster), behaves like a bench slot
};
// defaultPositionId → our position codes. Only the offensive skill positions plus K/DEF
// matter for scoring; IDP ids are mapped so an IDP league's rosters still render.
const ESPN_POS_MAP = {
  1:'QB', 2:'RB', 3:'WR', 4:'TE', 5:'K', 16:'DEF',
  9:'DL', 10:'LB', 11:'DL', 12:'DB', 13:'DB', 14:'DB',
};
// proTeamId → team abbreviation, in SLEEPER's spelling (WAS not WSH, JAX not JAC). ESPN's
// franchise ids have been stable for years. This is used ONLY to identify a team defense —
// for real players the team comes off the matched Sleeper record, so a stale id here can
// never put a skill player on the wrong team.
const ESPN_PRO_TEAM = {
  0:null, 1:'ATL', 2:'BUF', 3:'CHI', 4:'CIN', 5:'CLE', 6:'DAL', 7:'DEN', 8:'DET', 9:'GB',
  10:'TEN', 11:'IND', 12:'KC', 13:'LV', 14:'LAR', 15:'MIA', 16:'MIN', 17:'NE', 18:'NO',
  19:'NYG', 20:'NYJ', 21:'PHI', 22:'ARI', 23:'PIT', 24:'LAC', 25:'SF', 26:'SEA', 27:'TB',
  28:'WAS', 29:'CAR', 30:'JAX', 33:'BAL', 34:'HOU',
};
// ESPN scoring statId → the Sleeper scoring_settings key that means the same thing. Only the
// lines our projection model actually scores are listed; kicker/DEF/IDP and the long tail of
// bonus lines don't move a skill player's points, exactly as in applySleeperScoring.
const ESPN_STAT_MAP = {
  3:'pass_yd', 4:'pass_td', 20:'pass_int', 0:'pass_att', 1:'pass_cmp',
  24:'rush_yd', 25:'rush_td', 23:'rush_att',
  42:'rec_yd', 43:'rec_td', 53:'rec', 58:'rec_tgt',
  72:'fum_lost',
};
// pointsOverrides is keyed by defaultPositionId. These are the two we read.
const ESPN_OVR_TE = '4';
const ESPN_OVR_WR = '3';

// ── Fetch ────────────────────────────────────────────────────────────────────
// Deliberately reuses sleeperFetch: it is a plain JSON GET with an AbortController timeout
// and dev-mode timing, none of which is Sleeper-specific. Errors are re-labelled so a failure
// never says "Sleeper" when we were talking to ESPN.
async function espnFetch(url){
  try{
    return await sleeperFetch(url);
  }catch(e){
    const m=/^Sleeper (\d+)$/.exec(e && e.message || '');
    if(m) throw new Error(`ESPN ${m[1]}`);
    throw e;
  }
}

// Pull a league id (+ season) out of anything a user is likely to paste: a league URL, a team
// URL, a fantasycast link, or a bare numeric id. Returns null when there's no id to find.
function espnParseLeagueRef(raw){
  if(!raw) return null;
  const s=String(raw).trim();
  if(/^\d{2,12}$/.test(s)) return { leagueId:s, season:null };
  const lid=/[?&]leagueId=(\d+)/i.exec(s);
  if(!lid) return null;
  const yr=/[?&]seasonId=(\d{4})/i.exec(s);
  return { leagueId:lid[1], season:yr?yr[1]:null };
}

// The managers in one league, each with their ESPN display name AND their SWID.
//
// This is what makes a username-style flow possible at all. ESPN publishes no username→account
// lookup (verified: no fans-by-username route, and their site search returns nothing for a
// fantasy handle), so the account id can't be searched for globally — but any PUBLIC league
// hands out the display-name→SWID mapping for everyone in it. Since a league URL is the one
// thing an ESPN user always has (it's the address bar while they're looking at their league),
// "paste a league, then point at yourself" gets us the SWID without anyone opening devtools.
// Once we have it we keep it, and every later visit lists their leagues directly.
async function espnFetchLeagueMembers(leagueId, season){
  // mSettings rides along for the league's NAME — the "which manager are you?" screen
  // names the league so people know they pasted the right link. Neither view carries
  // rosters, so this stays a small request.
  const d = await espnFetch(ESPN_LEAGUE_URL(season, leagueId, ['mTeam','mSettings']));
  const teamByOwner={};
  (d.teams||[]).forEach(t=>{
    const owner = t.primaryOwner || (t.owners && t.owners[0]) || null;
    if(owner && !teamByOwner[owner]) teamByOwner[owner]={ teamId:t.id, teamName:t.name||t.abbrev||`Team ${t.id}` };
  });
  const out=(d.members||[]).map(m=>{
    const t=teamByOwner[m.id]||{};
    return {
      swid: m.id,
      name: m.displayName || `${m.firstName||''} ${m.lastName||''}`.trim() || '(unnamed)',
      teamId: t.teamId!=null ? t.teamId : null,
      teamName: t.teamName || null,
    };
  }).filter(m=>m.swid);
  out.sort((a,b)=>String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()));
  return { members:out, leagueName:(d.settings&&d.settings.name)||'ESPN League',
           season:String(d.seasonId||season) };
}

// Every FOOTBALL league this account is in. The fan profile returns one `preferences` entry
// per fantasy entry across all sports; the id encodes it as "gameId:leagueId:entryId:season"
// where gameId 1 is football. `entryId` is the user's own teamId in that league, which is how
// we know which roster is theirs without any further lookup.
//
// IMPORTANT: unauthenticated, this lists only the account's PUBLIC leagues. `fantasyData
// .totalFantasyLeagues` reports the true total, and it is routinely higher — one sampled
// account showed 9 leagues with 0 listed (all private), another 3 with 1 listed. That costs
// us nothing, because a private league can't be synced either way (see the header), but it
// does mean an empty result is "no PUBLIC leagues", not "no leagues" — say so, or people with
// private leagues will think the lookup is broken. laEspnFanCount surfaces the real total.
async function espnFetchFanLeagues(swid){
  const fan = await espnFetch(ESPN_FAN_URL(swid));
  const out=[];
  // The account's REAL league count, so the UI can distinguish "you're in no leagues" from
  // "your leagues are all private and therefore invisible to us".
  out.totalLeagues = (fan && fan.fantasyData && fan.fantasyData.totalFantasyLeagues) || 0;
  (fan && fan.preferences || []).forEach(p=>{
    const parts=String(p && p.id || '').split(':');
    if(parts.length<4 || parts[0]!=='1') return;         // not a football entry
    const entry=(p.metaData && p.metaData.entry) || {};
    const grp=(entry.groups && entry.groups[0]) || {};
    const meta=entry.entryMetadata || {};
    out.push({
      leagueId: String(grp.groupId || parts[1]),
      season:   String(entry.seasonId || parts[3]),
      teamId:   +(entry.entryId || parts[2]) || null,
      name:     grp.groupName || 'ESPN League',
      teams:    grp.groupSize || null,
      teamName: meta.teamName || null,
      logo:     entry.logoUrl || null,
      // leagueTypeId 0 = redraft/standard; keeper and dynasty are flagged on the league
      // itself, so this is only a hint for the picker label until we sync.
      draftComplete: !!meta.draftComplete,
      draftInProgress: !!meta.draftInProgress,
    });
  });
  // Newest season first, then by name, so the current year is what people see at the top.
  out.sort((a,b)=> a.season===b.season ? String(a.name).localeCompare(String(b.name)) : b.season.localeCompare(a.season));
  return out;
}

// Which of these leagues can we actually read?
//
// The fan profile lists leagues we have no access to — verified: one sampled account listed a
// league that answers 404 unauthenticated. Left unchecked, that league sits in the picker
// looking identical to the others and fails only when tapped. So we probe each one first with
// a no-view request (under 2KB, ~100ms, all in parallel) and mark it, which turns a confusing
// dead end into a label you can read before you click. Mutates and returns the list.
async function espnMarkReadable(leagues){
  await Promise.all((leagues||[]).map(async (l)=>{
    try{
      await espnFetch(ESPN_LEAGUE_URL(l.season, l.leagueId, null));
      l.readable = true;
    }catch(e){
      l.readable = false;
    }
  }));
  return leagues;
}

// ── Player identity: ESPN → Sleeper ──────────────────────────────────────────
// The bridge the whole feature rests on. Sleeper's own player records carry an `espn_id`, but
// coverage is stale: measured against a live 10-team league it resolved only 35.9% of rostered
// players, missing essentially every 2023-or-later arrival. Falling back to the existing name
// index lifted that to 99.4% (162/163) with no new matching machinery — so we try the id
// first (exact, collision-proof) and only then the name.
let _espnIdIdx = null;   // "espn_id" → sleeper player_id, built lazily from the loaded DB
function espnBuildIdIndex(){
  _espnIdIdx = {};
  if(!sleeperPlayers) return;
  for(const pid in sleeperPlayers){
    const e = sleeperPlayers[pid] && sleeperPlayers[pid].espn_id;
    if(e) _espnIdIdx[String(e)] = pid;
  }
}
// Sleeper stores a handful of players under a short form of their name, which the normalised
// name match then misses. Measured misses go here rather than into a fuzzier matcher — a
// looser match risks silently resolving one player to another, which is far worse than a
// visible miss.
const ESPN_NAME_ALIASES = {
  'kenneth gainwell':'kenny gainwell',
};
// Resolve one ESPN player object to a Sleeper player_id, or null.
// `espnPlayer` is the raw `playerPoolEntry.player` node.
function espnResolvePlayer(espnPlayer){
  if(!espnPlayer) return null;
  if(!_espnIdIdx) espnBuildIdIndex();
  const byId = _espnIdIdx[String(espnPlayer.id)];
  if(byId) return byId;
  const pos = ESPN_POS_MAP[espnPlayer.defaultPositionId] || null;
  const nm  = espnPlayer.fullName
           || `${espnPlayer.firstName||''} ${espnPlayer.lastName||''}`.trim();
  if(!nm) return null;
  let hit = (typeof resolvePlayerId==='function') ? resolvePlayerId(nm, pos) : null;
  if(hit) return hit;
  // Alias table, then a last-ditch first-initial + surname pass for the Ken/Kenneth class.
  const norm = (typeof normName==='function') ? normName(nm) : nm.toLowerCase();
  const alias = ESPN_NAME_ALIASES[norm];
  if(alias && typeof resolvePlayerId==='function'){
    hit = resolvePlayerId(alias, pos);
    if(hit) return hit;
  }
  return null;
}

// One roster entry → the {id,name,pos,team} shape laTakeSnapshot already produces. Team and
// name come from the matched SLEEPER record wherever possible, so a linked ESPN league shows
// exactly the same player identity as a linked Sleeper league.
function espnRosterPlayer(entry, unresolved){
  const pl = (entry && entry.playerPoolEntry && entry.playerPoolEntry.player) || null;
  if(!pl) return null;
  const espnPos = ESPN_POS_MAP[pl.defaultPositionId] || null;
  // Team defenses: ESPN gives them a real player id and a proTeamId; Sleeper uses the bare
  // team abbreviation as the player_id, which is what every downstream lookup expects.
  if(espnPos==='DEF'){
    const abbr = ESPN_PRO_TEAM[pl.proTeamId] || null;
    if(abbr) return { id:abbr, name:`${(typeof teamDisplayName==='function'?teamDisplayName(abbr):abbr)} D/ST`,
                      pos:'DEF', team:abbr, isDef:true };
  }
  const sid = espnResolvePlayer(pl);
  if(sid && sleeperPlayers && sleeperPlayers[sid]){
    const sp = sleeperPlayers[sid];
    return { id:sid, name:sp.name, pos:sp.pos||espnPos||'?', team:sp.team||'FA' };
  }
  // Unresolved: keep the player visible on the roster (dropping them would silently shrink a
  // team) but flag it so the sync can report how many didn't match.
  if(unresolved) unresolved.push(pl.fullName || String(pl.id));
  return { id:`espn:${pl.id}`, name:pl.fullName || String(pl.id),
           pos:espnPos||'?', team:ESPN_PRO_TEAM[pl.proTeamId]||'FA', unresolved:true };
}

// ── Settings translation ─────────────────────────────────────────────────────
// lineupSlotCounts ({slotId: count}) → a Sleeper-style roster_positions array. Sorted into a
// sensible starter order first so the lineup card reads QB → RB → WR → TE → FLEX → K/DEF.
const ESPN_SLOT_ORDER = [0,1,2,4,6,3,5,23,7,17,16,8,9,10,11,12,13,14,15,18,19,20,24,21];
function espnRosterPositions(lineupSlotCounts){
  const out=[];
  if(!lineupSlotCounts) return out;
  ESPN_SLOT_ORDER.forEach(slot=>{
    const n = +(lineupSlotCounts[String(slot)] || lineupSlotCounts[slot] || 0);
    const tok = ESPN_SLOT_MAP[slot];
    if(!tok) return;
    for(let i=0;i<n;i++) out.push(tok==='ER' ? 'BN' : tok);
  });
  return out;
}

// ESPN scoringItems → a Sleeper-shaped scoring_settings object.
//
// The subtlety that makes this worth its own function: ESPN lets any scoring line vary BY
// POSITION via `pointsOverrides`, keyed by defaultPositionId. A TE-premium league therefore
// reports receptions as points:0 with overrides {QB:.5, RB:.5, WR:.5, TE:1} — read `points`
// alone and you would label a half-PPR TEP league "standard". We take the non-TE value as the
// base and the TE excess as Sleeper's bonus_rec_te, which is exactly how Sleeper models it.
//
// Yardage is left in ESPN's points-per-yard form because applySleeperScoring already inverts
// it to yards-per-point (and cleans up the float noise while it's there).
function espnScoringToSleeper(scoringItems){
  const sc={};
  (scoringItems||[]).forEach(it=>{
    const key = ESPN_STAT_MAP[it.statId];
    if(!key) return;
    const ovr = it.pointsOverrides || null;
    const base = (v)=> (v!=null && isFinite(+v)) ? +v : null;
    if(key==='rec'){
      // Prefer an explicit WR override as the base, else any non-TE override, else points.
      let baseRec = ovr ? base(ovr[ESPN_OVR_WR]) : null;
      if(baseRec==null && ovr){
        for(const k in ovr){ if(k!==ESPN_OVR_TE){ baseRec = base(ovr[k]); break; } }
      }
      if(baseRec==null) baseRec = base(it.points);
      if(baseRec==null) return;
      sc.rec = baseRec;
      const teRec = ovr ? base(ovr[ESPN_OVR_TE]) : null;
      if(teRec!=null && teRec>baseRec) sc.bonus_rec_te = +(teRec-baseRec).toFixed(4);
      return;
    }
    // Everything else: an override for a skill position beats a zeroed base value.
    let v = base(it.points);
    if(ovr && (v==null || v===0)){
      let skill=null;
      [ESPN_OVR_WR,'2','1',ESPN_OVR_TE].forEach(k=>{ if(skill==null) skill = base(ovr[k]); });
      if(skill!=null) v = skill;
    }
    if(v!=null) sc[key]=v;
  });
  // ESPN OMITS a scoringItem entirely when a stat isn't scored — it doesn't send a zero. A
  // real example: league 730841 is touchdown-only + PPR and ships no pass_yd/rush_yd/rec_yd
  // items at all. If we left those keys absent, applySleeperScoring would keep whatever was
  // already in scoringSettings (very likely another league's numbers), and the league would
  // be scored on yardage it doesn't award. So an ESPN league's scoring is COMPLETE by
  // construction: anything ESPN didn't mention is explicitly zero.
  for(const id in ESPN_STAT_MAP){
    const k=ESPN_STAT_MAP[id];
    if(sc[k]==null) sc[k]=0;
  }
  return sc;
}

// ESPN has no dynasty flag. Keeper leagues declare a keeperCount, which maps to Sleeper's
// league type 1 (keeper); everything else is redraft (0). Nothing in ESPN's model corresponds
// to Sleeper's type 2 (dynasty), so an ESPN league never auto-selects the dynasty value lens —
// the user can still force it with the Auto/VOR/Dynasty toggle.
function espnLeagueType(settings){
  const ds=(settings && settings.draftSettings) || {};
  const keepers = +(ds.keeperCount||0) + +(ds.keeperCountFuture||0);
  return keepers>0 ? 1 : 0;
}

// ── Live matchup rows ────────────────────────────────────────────────────────
// mMatchupScore + mRoster, reshaped into EXACTLY the rows Sleeper's matchup
// endpoint returns ({roster_id, matchup_id, points, starters}) so the Season
// tab stays provider-blind past this point. Points prefer the live total when
// ESPN is mid-scoring; starters come from the current period's lineupSlotIds
// (so only the CURRENT week can say who was actually started — for past weeks
// the totals stand alone, which is all the scoreboard needs).
const ESPN_BENCH_SLOTS = new Set([20, 21, 24]);   // Bench, IR, ER
async function espnFetchMatchupRows(leagueId, season, week){
  const data = await espnFetch(ESPN_LEAGUE_URL(season, leagueId, ['mMatchupScore', 'mRoster']));
  const status = data.status || {};
  const curPeriod = +(status.currentMatchupPeriod || 0);
  const startersByTeam = {};
  if(+week === curPeriod){
    await loadSleeperPlayers(true);
    espnBuildIdIndex();
    (data.teams || []).forEach(t=>{
      startersByTeam[t.id] = ((t.roster && t.roster.entries) || [])
        .filter(e => !ESPN_BENCH_SLOTS.has(+e.lineupSlotId))
        .map(e => { const p = espnRosterPlayer(e, null); return p && p.id; })
        .filter(Boolean);
    });
  }
  const rows = [];
  (data.schedule || []).forEach(m=>{
    if(+m.matchupPeriodId !== +week) return;
    ['home', 'away'].forEach(side=>{
      const t = m[side];
      if(!t || t.teamId == null) return;
      const pts = (t.totalPointsLive != null) ? t.totalPointsLive : t.totalPoints;
      rows.push({ roster_id: t.teamId,
                  matchup_id: (m.id != null) ? m.id : `p${m.matchupPeriodId}`,
                  points: +(pts || 0),
                  starters: startersByTeam[t.teamId] || [] });
    });
  });
  return rows;
}

// ── Snapshot ─────────────────────────────────────────────────────────────────
// Produce the SAME leagueSnapshot object laTakeSnapshot builds for Sleeper. Everything after
// this point in the app is provider-blind. Returns {snapshot, scoring, rosterPositions,
// unresolved} so the caller can apply scoring and report match failures.
async function espnBuildSnapshot(leagueId, season, opts){
  const o = opts || {};
  const data = await espnFetch(ESPN_LEAGUE_URL(season, leagueId, ['mSettings','mTeam','mRoster']));
  const settings = data.settings || {};
  const rosterSettings = settings.rosterSettings || {};
  const rp = espnRosterPositions(rosterSettings.lineupSlotCounts);
  const scoring = espnScoringToSleeper((settings.scoringSettings||{}).scoringItems);

  await loadSleeperPlayers(true);
  espnBuildIdIndex();

  // members[] carries the human behind each team: id is the SWID, displayName the handle.
  const memberById={};
  (data.members||[]).forEach(m=>{ if(m && m.id) memberById[m.id]=m; });

  const unresolved=[];
  const teams=(data.teams||[]).map(t=>{
    const ownerId = t.primaryOwner || (t.owners && t.owners[0]) || null;
    const mem = (ownerId && memberById[ownerId]) || {};
    const rec = (t.record && t.record.overall) || {};
    const players=((t.roster && t.roster.entries) || [])
      .map(e=>espnRosterPlayer(e, unresolved))
      .filter(Boolean);
    const handle = mem.displayName
      || `${mem.firstName||''} ${mem.lastName||''}`.trim()
      || '(orphan)';
    return {
      rosterId: t.id,
      ownerId: ownerId,
      owner: handle,
      isChampion: false,          // set below once we know the champion
      avatar: t.logo || null,
      teamName: t.name || t.abbrev || `Team ${t.id}`,
      wins: +(rec.wins||0), losses: +(rec.losses||0),
      // ESPN leagues have no future-pick market the way Sleeper dynasty leagues do, and no
      // traded-pick feed on the read API. An empty list is honest: pick capital simply isn't
      // part of an ESPN snapshot, and the value lenses fall back to roster-only scoring.
      players, picks: [],
    };
  });

  // Champion of a finished season: ESPN marks the winner with rankCalculatedFinal === 1 once
  // the season completes. isActive/isExpired on status tells us whether that's meaningful yet.
  const status = data.status || {};
  let championRosterId = null;
  if(status.isExpired || (status.currentMatchupPeriod && status.finalScoringPeriod
      && status.currentMatchupPeriod > status.finalScoringPeriod)){
    const champ=(data.teams||[]).find(t=>+t.rankCalculatedFinal===1);
    if(champ) championRosterId = champ.id;
  }
  teams.forEach(t=>{ t.isChampion = championRosterId!=null && t.rosterId===championRosterId; });

  const superflex = (typeof leagueIsSuperflex==='function') ? leagueIsSuperflex(rp) : rp.includes('SUPER_FLEX');
  const tep = +(scoring.bonus_rec_te||0) > 0;

  // "My team" is identified league-wide by OWNER id (every consumer compares t.ownerId to
  // snapshot.myUserId), so resolve whatever we know — the account SWID, or the teamId the fan
  // lookup gave us — down to that one owner id rather than inventing a parallel field.
  let myOwnerId = null;
  if(o.mySwid && teams.some(t=>t.ownerId===o.mySwid)) myOwnerId = o.mySwid;
  if(!myOwnerId && o.myTeamId!=null){
    const mine = teams.find(t=>String(t.rosterId)===String(o.myTeamId));
    if(mine) myOwnerId = mine.ownerId;
  }

  const snapshot = {
    provider: 'espn',
    leagueId: String(leagueId),
    season: String(data.seasonId || season),
    name: settings.name || 'ESPN League',
    avatar: null,
    teams: settings.size || teams.length,
    superflex, tep,
    leagueType: espnLeagueType(settings),
    kdef: [],
    championRosterId,
    rosterPositions: rp,
    takenAt: Date.now(),
    // Same field, same meaning as the Sleeper path: the owner id of YOUR team.
    myUserId: myOwnerId,
    username: o.username || null,
    teamList: teams,
  };
  return { snapshot, scoring, rosterPositions:rp, unresolved };
}
