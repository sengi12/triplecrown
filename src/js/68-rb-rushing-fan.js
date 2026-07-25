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

function _rbFanSVG(chart, playerName, season, metric){
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

  const MET = RB_LANE_METRICS[metric] || RB_LANE_METRICS.eff;
  let MAXV=0;
  if(MET.key){ for(const k in lanes){ const v=lanes[k]&&lanes[k][MET.key]; if(v!=null && +v>MAXV) MAXV=+v; } }
  for(const lane of RB_FAN_LANES){
    const d=lanes[lane];
    if(!d || (+d.attempts||0)<3) continue;
    const cx=RB_FAN_ARROW_X[lane];
    const succ = d.success_rate;
    const ypc = d.ypc;
    const att = +d.attempts||0;
    const mv = MET.key ? (d[MET.key]!=null ? +d[MET.key] : null) : null;
    // Efficiency keeps the vs-league diverging colour; production metrics heat by the back's
    // own best gap so the busiest/most productive lane stands out.
    const col = MET.key ? _rbHeat(mv, MAXV) : _rbArrowColor(d.ypc_diff);
    const w = _rbArrowWidth(succ).toFixed(2);
    const path = lane==='MID'
      ? 'M380,650 V150'
      : `M380,650 C${(380-(380-cx)*0.55).toFixed(0)},700 ${cx},585 ${cx},150`;
    parts.push(`<path d="${path}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" marker-end="url(#rbf-arrow)"/>`);
    parts.push(`<text x="${cx}" y="106" fill="#fff" font-size="13" font-weight="800" text-anchor="middle">${lane}</text>`);
    const headline = MET.key==='yards' ? `${mv!=null?Math.round(mv):'—'} YDS`
      : (MET.key==='td' ? `${mv!=null?Math.round(mv):0} TD` : `${_rbNum(succ,0)}% SUCC`);
    parts.push(`<text x="${cx}" y="122" fill="${col}" font-size="12" font-weight="800" text-anchor="middle">${headline}</text>`);
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
  parts.push(`<text x="30" y="786" fill="#6b7075" font-size="10">Lanes shown when attempts \u2265 3. ${MET.key? 'Color scales to this back\u2019s best gap.' : 'Color compares lane YPC to league average for that lane in-season.'}</text>`);
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
      <div class="rt-summary">${t.attempts||0} carries · ${_rbNum(t.ypc,2)} YPC · ${_rbNum(t.success_rate,1)}% success</div>
    </div>
    ${_rbFanSVG(chart, name, season, metric)}
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
