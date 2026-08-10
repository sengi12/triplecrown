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
const RB_TEAM_FIX = {LA:'LAR', OAK:'LV', SD:'LAC', STL:'LAR'};
const RB_PROJ_SEASON = String((typeof PROJ_SEASON!=='undefined' && PROJ_SEASON) ? PROJ_SEASON : new Date().getFullYear());

let pcardRbFanSeason = null;

function _rbProjSeed(){
  return projSeed || (seasonStatsCache && seasonStatsCache['proj']) || null;
}

function _rbIsProjSeason(season){
  return String(season)===RB_PROJ_SEASON;
}

function _rbProjectedTeamAndRow(pid, normName){
  const proj=_rbProjSeed();
  const olProj=(typeof _olProjectedTeam2026==='function') ? _olProjectedTeam2026() : {};
  const player=(typeof sleeperPlayers!=='undefined'&&sleeperPlayers&&sleeperPlayers[pid])||{};
  const directTeam=_rbTeamCode(player.team||'');
  const matchesRow=(row)=> !!row && ((pid && row.player_id && String(row.player_id)===String(pid)) || _rbNormName(row.name)===normName);
  if(directTeam && proj && proj[directTeam] && Array.isArray(proj[directTeam].RB)){
    const row=proj[directTeam].RB.find(matchesRow) || null;
    if(row) return {team:directTeam, row};
  }
  if(proj){
    for(const tm in proj){
      const rows=(proj[tm]&&proj[tm].RB)||[];
      const row=rows.find(matchesRow);
      if(row && olProj[_rbTeamCode(tm)]) return {team:_rbTeamCode(tm), row};
    }
  }
  return {team:(directTeam&&olProj[directTeam])?directTeam:'', row:null};
}

function _rbProjectedShareRow(teamCode, pid, normName){
  const st=(typeof workingProj==='object' && workingProj) ? workingProj[teamCode] : null;
  const shares=st && st.rushing && Array.isArray(st.rushing.shares) ? st.rushing.shares : null;
  if(!shares) return {state:st, row:null};
  const row=shares.find(p=>((pid && p.player_id && String(p.player_id)===String(pid)) || _rbNormName(p.name)===normName)) || null;
  return {state:st, row};
}

function _rbLaneSlot(lane){
  if(lane==='LE' || lane==='LT') return 'LT';
  if(lane==='LG') return 'LG';
  if(lane==='MID') return 'C';
  if(lane==='RG') return 'RG';
  if(lane==='RT' || lane==='RE') return 'RT';
  return 'C';
}

function _rbRunPctile(rec){
  if(!rec) return null;
  if(rec.run_pctile!=null && !Number.isNaN(Number(rec.run_pctile))) return Number(rec.run_pctile);
  if(typeof _olGradeToPct==='function') return _olGradeToPct(rec.run_grade);
  return null;
}

function _rbProjectedLanes(baseChart, projLine, totals){
  const lanes=(baseChart&&baseChart.lanes)||{};
  const out={};
  const baseTotals=(baseChart&&baseChart.totals)||{};
  const baseAtt=Math.max(1, Number(baseTotals.attempts)||0);
  const projAtt=Math.max(0, Number((totals&&totals.attempts)||0));
  const attScale=baseAtt>0 ? (projAtt/baseAtt) : 1;
  const baseYpc=(baseTotals.ypc!=null && !Number.isNaN(Number(baseTotals.ypc))) ? Number(baseTotals.ypc) : null;
  const projYpc=(totals&&totals.ypc!=null && !Number.isNaN(Number(totals.ypc))) ? Number(totals.ypc) : baseYpc;
  const ypcDelta=(baseYpc!=null && projYpc!=null) ? (projYpc-baseYpc) : 0;
  for(const lane of RB_FAN_LANES){
    const d=lanes[lane]||{};
    const slot=_rbLaneSlot(lane);
    const projPct=_rbRunPctile(projLine&&projLine[slot]);
    const basePct=_rbRunPctile(baseChart&&baseChart.line&&baseChart.line[slot]);
    const laneBoost=(projPct!=null && basePct!=null) ? ((projPct-basePct)/100) : 0;
    const attempts=Math.max(0, Math.round((Number(d.attempts)||0)*attScale));
    const ypc=(d.ypc!=null && !Number.isNaN(Number(d.ypc)))
      ? Math.max(0, Number((Number(d.ypc) + ypcDelta + (laneBoost*0.9)).toFixed(2)))
      : null;
    const success=(d.success_rate!=null && !Number.isNaN(Number(d.success_rate)))
      ? Math.max(15, Math.min(80, Number((Number(d.success_rate) + (ypcDelta*3.5) + (laneBoost*9)).toFixed(1))))
      : null;
    const leagueYpc=(d.league_ypc!=null && !Number.isNaN(Number(d.league_ypc))) ? Number(d.league_ypc) : null;
    out[lane]={
      attempts,
      ypc,
      success_rate:success,
      league_ypc:leagueYpc,
      ypc_diff:(ypc!=null && leagueYpc!=null) ? Number((ypc-leagueYpc).toFixed(2)) : null,
      yards:(ypc!=null) ? Math.round(attempts*ypc) : null,
      td:(d.td!=null) ? Number((((Number(d.td)||0)*attScale)).toFixed(1)) : null,
    };
  }
  return out;
}

function _rbProjectedChart(pid, normName){
  const pr=_rbProjectedTeamAndRow(pid, normName);
  const teamCode=_rbTeamCode(pr.team||'');
  const olProj=(typeof _olProjectedTeam2026==='function') ? _olProjectedTeam2026()[teamCode] : null;
  if(!teamCode || !olProj) return null;
  const histSeasons=Object.keys(NFLVERSE||{})
    .filter(s=>String(s)!==RB_PROJ_SEASON && NFLVERSE[s] && NFLVERSE[s].rb_fan && NFLVERSE[s].rb_fan[normName])
    .sort((a,b)=>Number(b)-Number(a));
  const baseChart=histSeasons.length ? NFLVERSE[histSeasons[0]].rb_fan[normName] : null;
  const share=_rbProjectedShareRow(teamCode, pid, normName);
  const st=share.state;
  const shareRow=share.row;
  const baseRow=pr.row||{};
  const attempts=shareRow && st && st.rushing
    ? Math.round(Number(shareRow.share||0) * Number(st.rushing.total_attempts||0))
    : Math.round(Number(baseRow.rushing_attempts||0));
  const ypc=shareRow
    ? Number(shareRow.ypc || (st&&st.rushing&&st.rushing.ypa) || ((baseRow.rushing_attempts||0)>0 ? (Number(baseRow.rushing_yards||0)/Number(baseRow.rushing_attempts||1)) : 4))
    : ((Number(baseRow.rushing_attempts||0)>0) ? (Number(baseRow.rushing_yards||0)/Number(baseRow.rushing_attempts||1)) : 4);
  const yards=shareRow ? Math.round(attempts*ypc) : Math.round(Number(baseRow.rushing_yards||0));
  const teamTds=(shareRow && st && typeof teamRushTDs==='function') ? teamRushTDs(st) : Number((st&&st.rushing&&st.rushing.total_rush_tds)||0);
  const tds=shareRow ? Number((Number(shareRow.td_share||0)*teamTds).toFixed(1)) : Number(baseRow.rushing_tds||0);
  const baseSuccess=(baseChart&&baseChart.totals&&baseChart.totals.success_rate!=null && !Number.isNaN(Number(baseChart.totals.success_rate))) ? Number(baseChart.totals.success_rate) : null;
  const baseYpc=(baseChart&&baseChart.totals&&baseChart.totals.ypc!=null && !Number.isNaN(Number(baseChart.totals.ypc))) ? Number(baseChart.totals.ypc) : null;
  const success=(baseSuccess!=null && baseYpc!=null)
    ? Math.max(15, Math.min(80, Number((baseSuccess + ((ypc-baseYpc)*4)).toFixed(1))))
    : null;
  return {
    is_projection:true,
    baselineSeason:olProj.baselineSeason,
    run_score:olProj.projRunScore,
    run_rank:(olProj.baselineRunRank!=null && !Number.isNaN(Number(olProj.baselineRunRank)))
      ? Number(olProj.baselineRunRank)
      : olProj.runRank,
    team:teamCode,
    totals:{attempts, yards, ypc:Number(ypc.toFixed(2)), success_rate:success, td:tds},
    lanes:_rbProjectedLanes(baseChart, olProj.line||{}, {attempts, ypc}),
    line:olProj.line||{},
  };
}

function _pcardRbNorm(pid){
  const p=(typeof sleeperPlayers!=='undefined'&&sleeperPlayers&&sleeperPlayers[pid])||{};
  return ecrNormName(p.name||'');
}

function _rbTeamCode(team){
  const t=String(team||'').toUpperCase();
  return RB_TEAM_FIX[t] || t;
}

function pcardRbFanSeasons(normName){
  if(typeof NFLVERSE==='undefined' || !NFLVERSE) return [];
  return Object.keys(NFLVERSE)
    .filter(s=>{ const r=NFLVERSE[s]&&NFLVERSE[s].rb_fan; return r && r[normName]; })
    .sort((a,b)=>b-a);
}

function pcardRbFanAvailable(pid){
  const norm=_pcardRbNorm(pid);
  return pcardRbFanSeasons(norm).length>0 || !!_rbProjectedChart(pid, norm);
}

function _rbNum(v, dp=1){
  if(v==null || Number.isNaN(v)) return '—';
  return Number(v).toFixed(dp);
}

function _rbRankClass(rank){
  if(typeof sharpRankClass==='function') return sharpRankClass(rank)||'';
  if(rank==null) return '';
  if(rank<=8) return 'sr-good';
  if(rank<=16) return 'sr-okhi';
  if(rank<=24) return 'sr-oklo';
  return 'sr-bad';
}

function _rbRankBadge(rank){
  if(rank==null || Number.isNaN(rank)) return '<span class="olc-rank-muted">Rank —</span>';
  const rk=Number(rank);
  return `<span class="sr-badge ${_rbRankClass(rk)} olc-rank-badge">Rank #${rk}</span>`;
}

function _rbOverallScoreFromRow(row){
  if(!row || !row.values) return null;
  const keys=['Overall Score','Overall','Score'];
  for(const k of keys){
    if(row.values[k]!=null && !Number.isNaN(Number(row.values[k]))) return Number(row.values[k]);
  }
  return null;
}

function _rbOverallRankFromRow(row){
  if(!row || !row.ranks) return null;
  const keys=['Overall Score','Overall','Score'];
  for(const k of keys){
    if(row.ranks[k]!=null && !Number.isNaN(Number(row.ranks[k]))) return Number(row.ranks[k]);
  }
  return null;
}

function _rbScoreFromRank(rank){
  if(rank==null || Number.isNaN(rank)) return null;
  const r=Math.max(1, Math.min(32, Number(rank)));
  return ((32-r)/31)*100;
}

function _rbRunScoreAndRankFromTable(runTbl, teamCode){
  const teams=(runTbl&&runTbl.teams)||{};
  const row=teams[teamCode]||null;
  if(!row) return {score:null, rank:null};

  const directScore=(row.values&&row.values['Run Score']!=null && !Number.isNaN(Number(row.values['Run Score'])))
    ? Number(row.values['Run Score'])
    : null;
  const directRank=(row.ranks&&row.ranks['Run Score']!=null && !Number.isNaN(Number(row.ranks['Run Score'])))
    ? Number(row.ranks['Run Score'])
    : null;
  if(directScore!=null && directRank!=null) return {score:directScore, rank:directRank};

  const runKeys=[
    'Stuff Rate','Explosive Run Rate','Yards/Rush','YBC/Rush','YAC/Rush',
    'Rush 1D Rate','Broken Tackle Rate','ROE/Att','8+ Box Rate','Time to LOS',
  ];
  const byTeam={};
  for(const tm in teams){
    const rk=(teams[tm]&&teams[tm].ranks)||{};
    const scores=[];
    for(const k of runKeys){
      const s=_rbScoreFromRank(rk[k]);
      if(s!=null) scores.push(s);
    }
    if(scores.length) byTeam[tm]=scores.reduce((a,b)=>a+b,0)/scores.length;
  }
  const score=byTeam[teamCode];
  if(score==null) return {score:null, rank:null};
  const sorted=Object.entries(byTeam).sort((a,b)=>b[1]-a[1]);
  let rank=null;
  for(let i=0;i<sorted.length;i++){
    if(sorted[i][0]===teamCode){ rank=i+1; break; }
  }
  return {score, rank};
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

function _rbOlHeadshot(name, slot, teamCode){
  if(!name) return '';
  const tm=_rbTeamCode(teamCode||'');
  const depthSrc = (tm && typeof _olDepthHeadshot==='function') ? String(_olDepthHeadshot(tm, name)||'') : '';

  let rid='';
  if(typeof resolvePlayerId==='function'){
    const rawPos=String(slot||'').toUpperCase();
    rid = resolvePlayerId(name, rawPos) || resolvePlayerId(name, 'OL') || resolvePlayerId(name) || '';
  }

  let espnSrc='';
  if(rid && typeof sleeperPlayers!=='undefined' && sleeperPlayers && sleeperPlayers[rid] && sleeperPlayers[rid].espn_id && typeof ESPN_HEADSHOT==='function'){
    const aid=String(sleeperPlayers[rid].espn_id||'');
    if(aid) espnSrc = ESPN_HEADSHOT('nfl', aid) || ESPN_HEADSHOT('college-football', aid) || '';
  }

  const sleeperSrc = (rid && typeof SLEEPER_HEADSHOT==='function')
    ? String(SLEEPER_HEADSHOT(rid)||'')
    : ((typeof hsURL==='function') ? String(hsURL({name, pos:slot})||'') : '');

  // SVG <image> has no reliable inline fallback chain here, so choose the most stable source first.
  return depthSrc || espnSrc || sleeperSrc || '';
}

function _rbNormName(n){ return ecrNormName(String(n||'')); }

let _rbLatestExplicitSlotCache = null;
function _rbLatestExplicitSlotByName(){
  if(_rbLatestExplicitSlotCache) return _rbLatestExplicitSlotCache;
  const out={};
  if(!(typeof NFLVERSE==='object' && NFLVERSE)) return out;
  const allSeasons=Object.keys(NFLVERSE);
  const seasons=[];
  if(allSeasons.includes(RB_PROJ_SEASON)) seasons.push(RB_PROJ_SEASON);
  seasons.push(...allSeasons
    .filter(s=>s!==RB_PROJ_SEASON)
    .sort((a,b)=>Number(b)-Number(a)));
  for(const s of seasons){
    const rosters=(NFLVERSE[s]&&NFLVERSE[s].rosters)||{};
    for(const tm in rosters){
      const rows=rosters[tm]||[];
      for(const r of rows){
        const nm=_rbNormName(r&&r[0]);
        const pos=String((r&&r[1])||'').toUpperCase();
        if(!nm || out[nm]) continue;
        if(pos==='LT' || pos==='LG' || pos==='C' || pos==='RG' || pos==='RT') out[nm]=pos;
      }
    }
  }
  _rbLatestExplicitSlotCache = out;
  return out;
}

let _rbGradesSlotHintsCache = null;
function _rbGradesSlotHints(){
  if(_rbGradesSlotHintsCache) return _rbGradesSlotHintsCache;
  const byTeam={};
  const global={};
  if(!(typeof NFLVERSE==='object' && NFLVERSE)) return {byTeam, global};
  const allSeasons=Object.keys(NFLVERSE).sort((a,b)=>Number(b)-Number(a));
  for(const s of allSeasons){
    const pack=NFLVERSE[s]||{};
    const pl=pack.ol_players||{};
    for(const k in pl){
      const r=pl[k]||{};
      const nm=_rbNormName(r.name||k);
      const tm=_rbTeamCode(r.team||'');
      const sl=String(r.slot||'').toUpperCase();
      if(!nm || !tm) continue;
      if(!(sl==='LT'||sl==='LG'||sl==='C'||sl==='RG'||sl==='RT')) continue;
      const tkey=`${tm}|${nm}`;
      if(!byTeam[tkey]) byTeam[tkey]=sl;
      if(!global[nm]) global[nm]=sl;
    }
  }
  _rbGradesSlotHintsCache = {byTeam, global};
  return _rbGradesSlotHintsCache;
}
function _rbPosFamily(pos){
  const p=String(pos||'').toUpperCase();
  if(p==='C') return 'C';
  if(p==='LG' || p==='RG' || p==='G' || p==='OG') return 'G';
  if(p==='LT' || p==='RT' || p==='T' || p==='OT') return 'T';
  return 'OL';
}
function _rbSlotFamily(slot){
  if(slot==='C') return 'C';
  if(slot==='LG' || slot==='RG') return 'G';
  if(slot==='LT' || slot==='RT') return 'T';
  return 'OL';
}

function _rbRosterLine(season, teamCode, fallbackLine){
  const pack=(NFLVERSE&&NFLVERSE[String(season)])||{};
  const rows=(pack.rosters&&pack.rosters[teamCode])||[];
  if(!rows.length) return fallbackLine||{};
  const olPos = new Set(['LT','LG','C','RG','RT','T','G','OT','OG','OL']);
  const sNum=Number(season);
  const prevSeason=Number.isFinite(sNum)?String(sNum-1):'';
  const prevPack=(NFLVERSE&&NFLVERSE[prevSeason])||{};
  const prevRows=(prevPack.rosters&&prevPack.rosters[teamCode])||[];
  const prevSnapsByName={};
  for(const r of prevRows){
    const nm=_rbNormName(r&&r[0]);
    const pos=String((r&&r[1])||'').toUpperCase();
    if(!nm || !olPos.has(pos)) continue;
    const snaps=Number((r&&r[7])||0);
    if(prevSnapsByName[nm]==null || snaps>prevSnapsByName[nm]) prevSnapsByName[nm]=snaps;
  }
  const latestKnown=_rbLatestExplicitSlotByName();
  const slotHints=_rbGradesSlotHints();
  const preferredByName={};
  for(const sl of RB_FAN_CARD_SLOTS){
    const r=(fallbackLine&&fallbackLine[sl])||null;
    if(r&&r.name) preferredByName[_rbNormName(r.name)] = sl;
  }
  const cand = rows
    .map(r=>{
      const name=String((r&&r[0])||'').trim();
      const pos=String((r&&r[1])||'').toUpperCase();
      const nkey=_rbNormName(name);
      const teamHint=slotHints.byTeam[`${teamCode}|${nkey}`]||null;
      const globalHint=slotHints.global[nkey]||null;
      const preferred=preferredByName[nkey] || teamHint || latestKnown[nkey] || globalHint || null;
      const lockFamily=_rbSlotFamily(preferred);
      return {
        name,
        pos,
        snaps:Number((r&&r[7])||0),
        prevSnaps:Number(prevSnapsByName[nkey]||0),
        explicit:(pos==='LT'||pos==='LG'||pos==='C'||pos==='RG'||pos==='RT')?pos:null,
        preferred,
        lockFamily,
      };
    })
    .filter(r=>r.name && olPos.has(r.pos))
    .sort((a,b)=>
      (b.snaps-a.snaps)
      || (b.prevSnaps-a.prevSnaps)
      || String(a.name).localeCompare(String(b.name))
    );
  if(!cand.length) return fallbackLine||{};
  const rosterSlots={LT:null,LG:null,C:null,RG:null,RT:null};
  const used=new Set();
  const fits=(c, slot)=>{
    let fam=_rbPosFamily(c.pos);
    if(fam==='OL' && c.lockFamily && c.lockFamily!=='OL') fam=c.lockFamily;
    const sf=_rbSlotFamily(slot);
    if(sf==='C') return fam==='C' || fam==='OL';
    if(sf==='G') return fam==='G' || fam==='OL';
    if(sf==='T') return fam==='T' || fam==='OL';
    return true;
  };
  const claim=(slot, pred)=>{
    if(rosterSlots[slot]) return;
    const hit=cand.find(c=>!used.has(c.name) && fits(c,slot) && (!pred || pred(c)));
    if(!hit) return;
    used.add(hit.name);
    rosterSlots[slot]=hit;
  };
  for(const sl of RB_FAN_CARD_SLOTS) claim(sl, c=>c.explicit===sl);
  for(const sl of RB_FAN_CARD_SLOTS) claim(sl, c=>c.preferred===sl);
  claim('C', c=>_rbPosFamily(c.pos)==='C');
  claim('LT', c=>_rbPosFamily(c.pos)==='T');
  claim('RT', c=>_rbPosFamily(c.pos)==='T');
  claim('LG', c=>_rbPosFamily(c.pos)==='G');
  claim('RG', c=>_rbPosFamily(c.pos)==='G');
  for(const sl of RB_FAN_CARD_SLOTS) claim(sl, c=>_rbPosFamily(c.pos)==='OL');

  const byName={};
  for(const sl of RB_FAN_CARD_SLOTS){
    const r=(fallbackLine&&fallbackLine[sl])||null;
    if(r&&r.name) byName[_rbNormName(r.name)] = r;
  }
  const out={};
  for(const sl of RB_FAN_CARD_SLOTS){
    const rr=rosterSlots[sl];
    if(!rr || !rr.name){ out[sl]=(fallbackLine&&fallbackLine[sl])||{}; continue; }
    const g=byName[_rbNormName(rr.name)]||{};
    out[sl]={
      name:rr.name,
      run_grade:g.run_grade||null,
      pass_grade:g.pass_grade||null,
      pass_snaps:g.pass_snaps!=null?Number(g.pass_snaps):null,
    };
  }
  return out;
}

// Lane metrics. Efficiency (the default) colours each gap by YPC vs the league average for
// that same gap; yards and TDs are production, so those colour by the back's own best lane —
// a gap can be wildly efficient on four carries, or be the one he actually scores through.
const RB_LANE_METRICS = {
  eff:   {short:'Efficiency', label:'YPC vs league average by gap', key:null},
  yards: {short:'Yards',      label:'Rushing yards by gap',         key:'yards'},
  td:    {short:'TD',         label:'Rushing touchdowns by gap',    key:'td'},
};
let pcardRbMetric='eff';
function setPcardRbMetric(m){
  if(!RB_LANE_METRICS[m]) return;
  pcardRbMetric=m;
  // Body-only re-render (see setPcardQbMetric) so switching metric keeps you on this chart.
  const body=document.getElementById('pcardBody');
  if(body && pcardState) body.innerHTML=renderPcardRbFan(pcardState.pid);
}
function _rbMetricKnown(chart, m){
  if(m==='eff') return true;
  const L=chart&&chart.lanes; if(!L) return false;
  for(const k in L) if(L[k] && L[k][m]!=null) return true;
  return false;
}
function _rbHeat(v, max){
  if(v==null || !max) return '#4a4f57';
  const t=Math.max(0, Math.min(1, v/max));
  // Same monotonic green ramp as the QB chart (see _qbHeat) so both read identically.
  const stops=[[74,79,87],[38,92,66],[44,132,74],[62,176,82],[118,220,96]];
  const i=Math.min(stops.length-2, Math.floor(t*(stops.length-1)));
  const f=(t*(stops.length-1))-i;
  const c=stops[i].map((a,k)=>Math.round(a+(stops[i+1][k]-a)*f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function _rbFanSVG(chart, playerName, season, metric, notePlayer){
  const lanes=chart.lanes||{};
  const line=_rbRosterLine(season, _rbTeamCode(chart.team||''), chart.line||{});
  const t=chart.totals||{};
  const mobileNarrow = !!(typeof window!=='undefined' && window.matchMedia && window.matchMedia('(max-width: 560px)').matches);
  const G = mobileNarrow
    ? {
        W:620, H:920,
        centerX:310,
        arrowX:{LE:50, LT:120, LG:205, MID:310, RG:415, RT:500, RE:570},
        cardX:{LT:102, LG:206, C:310, RG:414, RT:518},
        arrowTopY:248,
        laneLblY:128, laneHeadY:148, laneSubY:166,
        losY:560, losLabelY:547,
        cardY:490, cardW:84, cardH:142,
        slotY:513,
        hsXOff:22, hsY:518, hsSize:44, hsClipY:540, hsClipR:21,
        name1Y:569, name2Y:583, gradeY:616,
        rbY:700, rbNameY:739, rbMetaY:758,
        footY1:818, footY2:836, footY3:854,
        titleY:38, titleSize:26, subtitleSize:16,
        subcopyY:64, subcopySize:14,
        laneLblSize:20, laneHeadSize:20, laneSubSize:16,
        tipLabelGap:44, tipHeadGap:28, tipSubGap:12,
        edgeDetailInset:8,
      }
    : {
        W:760, H:920,
        centerX:380,
        arrowX:RB_FAN_ARROW_X,
        cardX:RB_FAN_CARD_X,
        arrowTopY:248,
        laneLblY:106, laneHeadY:122, laneSubY:137,
        losY:560, losLabelY:547,
        cardY:490, cardW:94, cardH:142,
        slotY:513,
        hsXOff:22, hsY:518, hsSize:44, hsClipY:540, hsClipR:21,
        name1Y:569, name2Y:583, gradeY:616,
        rbY:700, rbNameY:739, rbMetaY:758,
        footY1:818, footY2:836, footY3:854,
        titleY:38, titleSize:34, subtitleSize:18,
        subcopyY:64, subcopySize:16,
        laneLblSize:25, laneHeadSize:25, laneSubSize:20,
        tipLabelGap:54, tipHeadGap:34, tipSubGap:14,
        edgeDetailInset:14,
      };
  const W=G.W, H=G.H;
  const rbx=G.centerX, rby=G.rbY;

  const parts=[];
  parts.push(`<svg viewBox="0 0 ${W} ${H}" class="rbf-svg" role="img" aria-label="RB rushing fan chart">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#101214"/>`);
  parts.push(`<text x="30" y="${G.titleY}" fill="#fff" font-size="${G.titleSize}" font-weight="800">${String(playerName||'RB').toUpperCase()} RUSHING FAN <tspan fill="#9aa0a6" font-size="${G.subtitleSize}" font-weight="600">/ ${season} ${chart.is_projection?'PROJECTION':'REGULAR SEASON'}</tspan></text>`);
  parts.push(`<text x="30" y="${G.subcopyY}" fill="#9aa0a6" font-size="${G.subcopySize}">Arrow width = lane success rate · arrow color = ${chart.is_projection?'projected lane YPC vs league lane average':'lane YPC vs league lane average'}</text>`);

  const MET = RB_LANE_METRICS[metric] || RB_LANE_METRICS.eff;
  let MAXV=0;
  if(MET.key){ for(const k in lanes){ const v=lanes[k]&&lanes[k][MET.key]; if(v!=null && +v>MAXV) MAXV=+v; } }
  const laneOffsetMap = mobileNarrow
    ? { LE:0, LT:80, LG:0, MID:80, RG:0, RT:80, RE:0 }
    : { LE:0, LT:80, LG:0, MID:80, RG:0, RT:80, RE:0 };
  for(let li=0; li<RB_FAN_LANES.length; li++){
    const lane = RB_FAN_LANES[li];
    const d=lanes[lane];
    if(!d || (+d.attempts||0)<3) continue;
    const cx=G.arrowX[lane];
    const laneOffset = laneOffsetMap[lane] || 0;
    const tipY = G.arrowTopY + laneOffset;
    const succ = d.success_rate;
    const ypc = d.ypc;
    const att = +d.attempts||0;
    const mv = MET.key ? (d[MET.key]!=null ? +d[MET.key] : null) : null;
    // Efficiency keeps the vs-league diverging colour; production metrics heat by the back's
    // own best gap so the busiest/most productive lane stands out.
    const col = MET.key ? _rbHeat(mv, MAXV) : _rbArrowColor(d.ypc_diff);
    const w = _rbArrowWidth(succ).toFixed(2);
    const path = lane==='MID'
      ? `M${G.centerX},${G.rbY} V${tipY}`
      : `M${G.centerX},${G.rbY} C${(G.centerX-(G.centerX-cx)*0.52).toFixed(0)},${G.rbY+48} ${cx},${G.rbY-70} ${cx},${tipY}`;
    const laneValue = MET.key==='yards' ? `${mv!=null?Math.round(mv):'—'} yds`
      : (MET.key==='td' ? `${mv!=null?Math.round(mv):0} TD` : `${_rbNum(succ,0)}% success`);
    const laneTag = noteTagAttrs({
      label:`${lane} lane ${MET.short}`,
      value:`${laneValue} · ${att} att · ${_rbNum(ypc,1)} YPC`,
      source:'rb_rushing_fan',
      statKey:`lane_${MET.key||'eff'}`,
      context:`${season} rushing fan · ${lane} lane`,
      player:notePlayer,
      team:(notePlayer&&notePlayer.team)||chart.team||'',
      relevance:'RB,QB',
    });
    // Keep text tied to the arrow tip so line-length staggering and label staggering always match.
    const labelY = tipY - G.tipLabelGap;
    const headlineY = tipY - G.tipHeadGap;
    const sublineY = tipY - G.tipSubGap;
    const headline = MET.key==='yards' ? `${mv!=null?Math.round(mv):'—'} YDS`
      : (MET.key==='td' ? `${mv!=null?Math.round(mv):0} TD` : `${_rbNum(succ,0)}% SUCC`);
    const subline = `${att} att · ${_rbNum(ypc,1)} YPC`;

    const labelX = cx;
    let detailX = cx;
    let detailAnchor = 'middle';
    if(lane==='LE' || lane==='RE'){
      // Keep detail lines near the frame edge while lane labels stay on arrow endpoints.
      detailX = lane==='LE' ? G.edgeDetailInset : (W - G.edgeDetailInset);
      detailAnchor = lane==='LE' ? 'start' : 'end';
    }
    parts.push(`<g${laneTag}><path d="${path}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" marker-end="url(#rbf-arrow)"/>`);
    parts.push(`<text x="${labelX}" y="${labelY}" fill="#fff" font-size="${G.laneLblSize}" font-weight="800" text-anchor="middle">${lane}</text>`);
    parts.push(`<text x="${detailX}" y="${headlineY}" fill="${col}" font-size="${G.laneHeadSize}" font-weight="800" text-anchor="${detailAnchor}">${headline}</text>`);
    parts.push(`<text x="${detailX}" y="${sublineY}" fill="#9aa0a6" font-size="${G.laneSubSize}" text-anchor="${detailAnchor}">${subline}</text>`);
    parts.push(`</g>`);
  }

  const clipDefs = RB_FAN_CARD_SLOTS.map(slot=>`<clipPath id="rbf-hs-${slot}"><circle cx="${G.cardX[slot]}" cy="${G.hsClipY}" r="${G.hsClipR}"/></clipPath>`).join('');
  parts.push(`<defs><marker id="rbf-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path d="M1 1L8 5L1 9" fill="none" stroke="context-stroke" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></marker>${clipDefs}</defs>`);

  parts.push(`<line x1="15" y1="${G.losY}" x2="${W-15}" y2="${G.losY}" stroke="#2f6fe4" stroke-width="3" stroke-dasharray="10 7"/>`);
  parts.push(`<text x="18" y="${G.losLabelY}" fill="#5b83c9" font-size="11" font-weight="800">LOS</text>`);

  for(const slot of RB_FAN_CARD_SLOTS){
    const x=G.cardX[slot];
    const d=line[slot]||{};
    const runG=d.run_grade||null;
    const col=_rbGradeColor(runG);
    const n=_rbNameParts(d.name||'');
    const hs=_rbOlHeadshot(d.name||'', slot, chart.team||'');
    const click = d.name
      ? `openPlayerCardFromCard(${pcardArg(d.name)},${pcardArg(slot)},${pcardArg(chart.team||'')})`
      : '';
    parts.push(`<g class="rbf-ol-card${d.name?' clickable-player':''}" ${d.name?`onclick="${click}" role="button" tabindex="0"`:''}>
      <rect x="${x-(G.cardW/2)}" y="${G.cardY}" width="${G.cardW}" height="${G.cardH}" rx="7" fill="#1b1e22" stroke="${col}" stroke-width="2"/>
      <text x="${x}" y="${G.slotY}" fill="#fff" font-size="${mobileNarrow?17:15}" font-weight="800" text-anchor="middle">${slot}</text>
      ${hs?`<image href="${hs}" x="${x-G.hsXOff}" y="${G.hsY}" width="${G.hsSize}" height="${G.hsSize}" clip-path="url(#rbf-hs-${slot})" preserveAspectRatio="xMidYMid slice"/>`:''}
      <text x="${x}" y="${G.name1Y}" fill="#e8eaed" font-size="${mobileNarrow?11:9.5}" text-anchor="middle">${n[0]||''}</text>
      <text x="${x}" y="${G.name2Y}" fill="#e8eaed" font-size="${mobileNarrow?11:9.5}" font-weight="700" text-anchor="middle">${n[1]||''}</text>
      <text x="${x}" y="${G.gradeY}" fill="${col}" font-size="${mobileNarrow?30:27}" font-weight="900" text-anchor="middle">${runG||'n/a'}</text>
    </g>`);
  }

  parts.push(`<circle cx="${rbx}" cy="${rby}" r="13" fill="#e8eaed" stroke="#0c0d0f" stroke-width="2"/>`);
  parts.push(`<text x="${rbx}" y="${G.rbNameY}" fill="#fff" font-size="${mobileNarrow?15:13}" font-weight="800" text-anchor="middle">${String(playerName||'RB').toUpperCase()}</text>`);
  parts.push(`<text x="${rbx}" y="${G.rbMetaY}" fill="#9aa0a6" font-size="${mobileNarrow?12:11}" text-anchor="middle">${t.attempts||0} carries · ${(t.yards!=null?Number(t.yards).toLocaleString():'—')} yds · ${_rbNum(t.ypc,2)} YPC · ${_rbNum(t.success_rate,1)}% success</text>`);

  parts.push(`<text x="30" y="${G.footY1}" fill="#6b7075" font-size="10">OL card grades are from the validated local OL pipeline (${chart.is_projection?`projected ${RB_PROJ_SEASON} run grades`:'historical rushing grades'}, slot by pass-snaps).</text>`);
  parts.push(`<text x="30" y="${G.footY2}" fill="#6b7075" font-size="10">Lanes shown when attempts >= 3. ${chart.is_projection?'Projected lanes keep the back\u2019s last known directional profile and scale it to projected volume/efficiency.' : (MET.key? 'Color scales to this back\u2019s best gap.' : 'Color compares lane YPC to league average for that lane in-season.')}</text>`);
  parts.push(`<text x="30" y="${G.footY3}" fill="#6b7075" font-size="10">Data: nflverse play-by-play + local OL grades. Not affiliated with the NFL.</text>`);
  parts.push('</svg>');
  return parts.join('');
}

function renderPcardRbFan(pid){
  const norm=_pcardRbNorm(pid);
  const seasons=pcardRbFanSeasons(norm);
  const projChart=_rbProjectedChart(pid, norm);
  const seasonOpts=seasons.slice();
  if(projChart && !seasonOpts.includes(RB_PROJ_SEASON)) seasonOpts.unshift(RB_PROJ_SEASON);
  if(!seasonOpts.length) return '<div class="pcard-loading">No rushing-fan data for this RB.</div>';
  if(pcardRbFanSeason==null || !seasonOpts.includes(String(pcardRbFanSeason))) pcardRbFanSeason=seasonOpts[0];
  const season=String(pcardRbFanSeason);
  const chart=(_rbIsProjSeason(season) && projChart) ? projChart : (NFLVERSE[season]&&NFLVERSE[season].rb_fan&&NFLVERSE[season].rb_fan[norm]);
  if(!chart) return '<div class="pcard-loading">No rushing-fan data for this season.</div>';
  const pack=NFLVERSE[season]||{};
  const teamCode=_rbTeamCode(chart.team||'');
  const runTbl=pack.team&&pack.team.offensive_line_run;
  const runSc=(_rbIsProjSeason(season) && chart.is_projection)
    ? {score:chart.run_score, rank:chart.run_rank}
    : _rbRunScoreAndRankFromTable(runTbl, teamCode);
  const overallRunHtml = (runSc.score!=null || runSc.rank!=null)
    ? `<div class="olc-overview"><b>Cumulative Run Blocking Score: ${runSc.score!=null?runSc.score.toFixed(1):'—'}</b> ${_rbRankBadge(runSc.rank)}</div>`
    : '';

  const p=(sleeperPlayers&&sleeperPlayers[pid])||{};
  const name=p.name||'RB';
  const notePlayer = noteTargetFromArgs(pid, 'RB', p.team||chart.team||'');
  const noteCtx = (_rbIsProjSeason(season) && chart.is_projection) ? `${season} projection rushing fan` : `${season} rushing fan`;
  const t=chart.totals||{};
  const seasonBtns=seasonOpts.map(s=>`<button class="rt-season-btn ${String(s)===season?'active':''}" onclick="setPcardRbFanSeason('${s}')">${s}</button>`).join('');
  if(!RB_LANE_METRICS[pcardRbMetric]) pcardRbMetric='eff';
  let metric=pcardRbMetric;
  if(!_rbMetricKnown(chart, metric)) metric='eff';   // older seed without per-gap yards/TD
  const metricBtns=Object.entries(RB_LANE_METRICS).map(([k,m])=>{
    const known=_rbMetricKnown(chart,k);
    return `<button class="rt-metric-btn ${k===metric?'active':''}" ${known?'':'disabled'}
      title="${known?('Show '+m.label):(m.short+' unavailable for this season — rebuild the seed to add it')}"
      onclick="setPcardRbMetric('${k}')">${m.short}</button>`;
  }).join('');

  return `<div class="rbf-wrap">
    <div class="rt-head">
      <div class="rt-seasons">${seasonBtns}</div>
      <div class="rt-metrics">${metricBtns}</div>
      <div class="rt-summary">${noteWrapHtml(`${t.attempts||0} carries`, { label:'Carries', value:String(t.attempts||0), source:'rb_rushing_fan', statKey:'attempts', context:noteCtx, player:notePlayer, team:notePlayer.team }, 'note-tag-hit')} · ${noteWrapHtml(`${_rbNum(t.ypc,2)} YPC`, { label:'Yards Per Carry', value:_rbNum(t.ypc,2), source:'rb_rushing_fan', statKey:'ypc', context:noteCtx, player:notePlayer, team:notePlayer.team }, 'note-tag-hit')} · ${noteWrapHtml(`${_rbNum(t.success_rate,1)}% success`, { label:'Success Rate', value:`${_rbNum(t.success_rate,1)}%`, source:'rb_rushing_fan', statKey:'success_rate', context:noteCtx, player:notePlayer, team:notePlayer.team }, 'note-tag-hit')}</div>
    </div>
    ${runSc.score!=null || runSc.rank!=null ? `<div class="olc-overview">${noteWrapHtml(`<b>Cumulative Run Blocking Score: ${runSc.score!=null?runSc.score.toFixed(1):'—'}</b> ${_rbRankBadge(runSc.rank)}`, { label:'Cumulative Run Blocking Score', value:runSc.score!=null?runSc.score.toFixed(1):'—', source:'rb_offensive_line', statKey:'run_blocking_score', context:`${chart.team||notePlayer.team} offensive line · ${(_rbIsProjSeason(season) && chart.is_projection)?`${season} projections`:`${season}`}`, team:chart.team||notePlayer.team, relevance:'RB' }, 'note-tag-hit')}</div>` : ''}
    ${chart.is_projection?`<div class="olc-overview"><b>${RB_PROJ_SEASON} Projection:</b> projected depth-chart starters' run grades drive the line cards and cumulative run score. Lane arrows preserve the back's latest directional profile and scale it to projected efficiency/volume.</div>`:''}
    ${_rbFanSVG(chart, name, season, metric, notePlayer)}
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

function _rbRefreshOpenProjectedFanForTeam(team){
  if(typeof pcardState==='undefined' || !pcardState) return;
  if(typeof pcardStatsMode==='undefined' || pcardStatsMode!=='rbfan') return;
  if(!_rbIsProjSeason(pcardRbFanSeason)) return;
  const body=document.getElementById('pcardBody');
  if(!body) return;
  try{
    const norm=_pcardRbNorm(pcardState.pid);
    const proj=_rbProjectedChart(pcardState.pid, norm);
    if(!proj || _rbTeamCode(proj.team)!==_rbTeamCode(team)) return;
  }catch(e){ /* refresh anyway on lookup failure */ }
  body.innerHTML=renderPcardRbFan(pcardState.pid);
}
