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
