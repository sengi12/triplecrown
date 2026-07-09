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

