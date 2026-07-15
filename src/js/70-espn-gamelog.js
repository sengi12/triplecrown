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
  // Kicking / punting: these reach here because K and P are non-skill, non-defensive, so they
  // fall through the schema tables to the raw ESPN gamelog. Without these they'd all land in
  // 'MISC'. ESPN's machine names are stable across kickers and punters.
  if(/^fieldGoal/i.test(n) || /^extraPoint/i.test(n) || ['longFieldGoalMade','totalKickingPoints','kickExtraPoints','fieldGoalsMade19','fieldGoalsMade29','fieldGoalsMade39','fieldGoalsMade49','fieldGoalsMade50'].includes(n)) return 'KICKING';
  if(/^punt/i.test(n) || ['grossAvgPuntYards','netAvgPuntYards','longPunt','touchbacks','puntsInside20','puntsBlocked','fairCatches'].includes(n)) return 'PUNTING';
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
