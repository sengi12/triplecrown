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
  pcardState = {pid, posc, team, isSkill};
  // Rookies have no NFL game log yet → default to their college stats; everyone else to the pros.
  pcardStatsMode = isRookiePlayer(pid) ? 'college' : 'pro';
  loadPcardDraft(pid);            // draft summary fills the hero banner (independent of stat source)
  renderPcardStatTabs();
  pcardLoadStats(pcardStatsMode);
}
// Fetch the player's draft summary once and drop it into the hero banner at the top of the card,
// independent of which stats source is showing. Uses the cached ESPN athlete-id + draft lookups.
async function loadPcardDraft(pid){
  try{
    const aid = await resolveEspnAthleteId(pid, (sleeperPlayers[pid]||{}).name);
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
  el.innerHTML = tab('pro','NFL') + tab('college','College');
}
// Switch the card's stat source and reload the body from the matching feed.
function setPcardStatsMode(mode){
  if(!pcardState || pcardStatsMode===mode) return;
  pcardStatsMode = mode;
  renderPcardStatTabs();
  pcardLoadStats(mode);
}
// Dispatch the body render for the chosen source. College always uses the ESPN college gamelog;
// pro uses Sleeper weekly (skill) or the ESPN nfl gamelog (defense / other).
function pcardLoadStats(mode){
  if(!pcardState) return;
  pcardToken++;
  const {pid, posc, isSkill} = pcardState;
  const body = document.getElementById('pcardBody');
  if(!body) return;
  if(mode==='college'){
    return loadEspnCardData(pid, posc, body, {league:'college-football', def:!isSkill});
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
    if(pcardOpen && tok===pcardToken) body.innerHTML = `<div class="pcard-loading">Couldn't load game logs. Check your connection and try again.</div>`;
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

