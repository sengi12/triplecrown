// ── QB passing chart (player-card "Passing Chart" tab) ─────────────────────
// Seed payload: NFLVERSE[season].qb_passing[normName] = {
//   team, totals:{passer_rating,comp_pct,yards,td,int,attempts},
//   zones:{deep|inter|short|behind:{left|middle|right:{rating,league_avg,attempts}}}
// }

const QB_PASS_ROW_ORDER = ['deep','inter','short','behind'];
const QB_PASS_COL_ORDER = ['left','middle','right'];
const QB_PASS_THRESH = 5.0;

let pcardQbPassingSeason = null;

function _pcardQbNorm(pid){
  const p=(typeof sleeperPlayers!=='undefined'&&sleeperPlayers&&sleeperPlayers[pid])||{};
  return ecrNormName(p.name||'');
}

function pcardQbPassingSeasons(normName){
  if(typeof NFLVERSE==='undefined' || !NFLVERSE) return [];
  return Object.keys(NFLVERSE)
    .filter(s=>{ const q=NFLVERSE[s]&&NFLVERSE[s].qb_passing; return q && q[normName]; })
    .sort((a,b)=>b-a);
}

function pcardQbPassingAvailable(pid){
  return pcardQbPassingSeasons(_pcardQbNorm(pid)).length>0;
}

// Zone metrics. Rating answers "how well did he throw here" (diverging vs the league average
// for that same zone); yards and TDs answer "how much did it produce" — so those use a
// sequential heat scaled to the QB's own best zone, since there's no meaningful league
// baseline for raw volume in a single cell.
const QB_ZONE_METRICS = {
  rating: {short:'Rating', label:'Passer rating vs league average', key:'rating', digits:1, sub:'lg'},
  yards:  {short:'Yards',  label:'Passing yards by zone',           key:'yards',  digits:0, sub:'ypa'},
  td:     {short:'TD',     label:'Touchdowns by zone',              key:'td',     digits:0, sub:'none'},
};
let pcardQbMetric='rating';
function setPcardQbMetric(m){
  if(!QB_ZONE_METRICS[m]) return;
  pcardQbMetric=m;
  // Re-render ONLY the chart body — the same thing the season buttons do. Calling
  // loadPlayerCardData here would rebuild the whole card and bounce you back to its default
  // tab, losing your place every time you switched metric.
  const body=document.getElementById('pcardBody');
  if(body && pcardState) body.innerHTML=renderPcardQbPassing(pcardState.pid);
}
// True when this season's chart actually carries the metric (older seeds predate yards/TD).
function _qbMetricKnown(chart, m){
  if(m==='rating') return true;
  const z=chart&&chart.zones;
  if(!z) return false;
  for(const d in z) for(const l in z[d]) if(z[d][l] && z[d][l][m]!=null) return true;
  return false;
}
// Sequential heat for volume metrics, scaled to the QB's own peak zone.
function _qbHeat(v, max){
  if(v==null || !max) return '#3a3e44';
  const t=Math.max(0, Math.min(1, v/max));
  if(t<=0.02) return '#3a3e44';
  // Monotonic green ramp — brightness rises with volume the whole way. (An earlier ramp
  // ended in gold, which made the highest cell read yellow while mid cells read green.)
  const stops=[[56,60,66],[34,84,62],[40,124,72],[58,168,80],[110,214,92]];
  const i=Math.min(stops.length-2, Math.floor(t*(stops.length-1)));
  const f=(t*(stops.length-1))-i;
  const c=stops[i].map((a,k)=>Math.round(a+(stops[i+1][k]-a)*f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function _qbCellColor(rating, leagueAvg){
  if(rating==null || leagueAvg==null) return '#3a3e44';
  const d = rating - leagueAvg;
  if(d > QB_PASS_THRESH) return '#2fae4e';
  if(d < -QB_PASS_THRESH) return '#d33b2f';
  return '#d8a51d';
}

function _qbNum(v, dp=1){
  if(v==null || Number.isNaN(v)) return '—';
  return Number(v).toFixed(dp);
}

function _qbZoneTagAttrs(meta){
  const attrs=[];
  const put=(k,v)=>{ if(v!=null && v!=='') attrs.push(`${k}="${escAttr(String(v))}"`); };
  put('data-noteable','1');
  put('data-note-label', meta.label || 'Passing zone');
  put('data-note-value', meta.value || '');
  put('data-note-source','qb_passing_chart');
  put('data-note-stat-key', meta.statKey || 'zone');
  put('data-note-context', meta.context || '');
  put('data-note-team', meta.team || '');
  put('data-note-relevance','QB,WR,TE,RB');
  if(meta.player){
    put('data-note-player-id', meta.player.player_id || '');
    put('data-note-player-name', meta.player.name || '');
    put('data-note-player-pos', meta.player.pos || 'QB');
    put('data-note-player-team', meta.player.team || meta.team || '');
  }
  return attrs.join(' ');
}

function _qbPassingSVG(chart, playerName, season, metric, notePlayer){
  const zones = chart.zones || {};
  const MET = QB_ZONE_METRICS[metric] || QB_ZONE_METRICS.rating;
  // Peak zone value drives the heat scale for volume metrics.
  let MAXV=0;
  if(MET.key!=='rating'){
    for(const d in zones) for(const l in zones[d]){
      const v=zones[d][l] && zones[d][l][MET.key];
      if(v!=null && +v>MAXV) MAXV=+v;
    }
  }
  const W=760, H=600;
  const yTop=60, yBot=560;
  const rowY=[60,176,298,428,560];
  const left=(y)=>170 - 130*(y-yTop)/(yBot-yTop);
  const right=(y)=>590 + 130*(y-yTop)/(yBot-yTop);
  const gap=5;

  const parts=[];
  parts.push(`<svg viewBox="0 0 ${W} ${H}" class="qpc-svg" role="img" aria-label="QB passing chart">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#101214"/>`);
  parts.push(`<text x="24" y="28" fill="#fff" font-size="20" font-weight="800">${playerName.toUpperCase()} <tspan fill="#9aa0a6" font-size="13" font-weight="600">/ ${season} REGULAR SEASON</tspan></text>`);
  parts.push(`<text x="24" y="48" fill="#9aa0a6" font-size="12">${MET.label} by throw zone (nflverse)</text>`);

  for(let r=0;r<4;r++){
    const depth=QB_PASS_ROW_ORDER[r];
    const y0=rowY[r], y1=rowY[r+1];
    for(let c=0;c<3;c++){
      const loc=QB_PASS_COL_ORDER[c];
      const z=((zones[depth]||{})[loc])||{};
      const rating=z.rating;
      const lg=z.league_avg;
      const att=+z.attempts||0;
      const mv = (MET.key==='rating') ? rating : (z[MET.key]!=null ? +z[MET.key] : null);
      const l0=left(y0), rt0=right(y0), l1=left(y1), rt1=right(y1);
      const w0=(rt0-l0)/3, w1=(rt1-l1)/3;
      const tl=l0+w0*c, tr=l0+w0*(c+1), bl=l1+w1*c, br=l1+w1*(c+1);
      const cx=(tl+tr+bl+br)/4, cy=(y0+y1)/2;
      const pts=`${(tl+gap).toFixed(0)},${y0+gap} ${(tr-gap).toFixed(0)},${y0+gap} ${(br-gap).toFixed(0)},${y1-gap} ${(bl+gap).toFixed(0)},${y1-gap}`;
      // Rating keeps the diverging vs-league scale; volume metrics use the sequential heat.
      const fill = (MET.key==='rating') ? _qbCellColor(rating, lg) : _qbHeat(mv, MAXV);
      const zoneName = `${depth} ${loc}`;
      const subTxt = MET.sub==='lg' ? `LEAGUE AVG: ${_qbNum(lg,1)}`
        : (MET.sub==='ypa' && att ? `${(mv!=null? mv/att : 0).toFixed(1)} yds/att` : '');
      const noteVal = `${MET.short} ${_qbNum(mv, MET.digits)}${subTxt?` · ${subTxt}`:''} · ${att} att`;
      const tagAttrs = _qbZoneTagAttrs({
        label:`${MET.short} (${zoneName})`,
        value:noteVal,
        statKey:`zone_${MET.key||'rating'}`,
        context:`${season} passing chart · ${zoneName}`,
        team:(notePlayer&&notePlayer.team)||chart.team||'',
        player:notePlayer,
      });
      parts.push(`<g ${tagAttrs}><polygon points="${pts}" fill="${fill}" stroke="#0c0d0f" stroke-width="2"/>`);
      parts.push(`<text x="${cx.toFixed(0)}" y="${(cy-4).toFixed(0)}" fill="#fff" font-size="26" font-weight="800" text-anchor="middle">${_qbNum(mv, MET.digits)}</text>`);
      // Second line depends on the metric: the league baseline for rating, yards-per-attempt
      // for yards (context a raw total can't give), nothing for TDs.
      if(subTxt) parts.push(`<text x="${cx.toFixed(0)}" y="${(cy+14).toFixed(0)}" fill="#0d1b10" font-size="10.5" font-weight="800" text-anchor="middle">${subTxt}</text>`);
      parts.push(`<text x="${cx.toFixed(0)}" y="${(cy+(subTxt?29:16)).toFixed(0)}" fill="#141517" font-size="10" font-weight="800" opacity="0.75" text-anchor="middle">${att} att</text>`);
      parts.push(`</g>`);
    }
  }

  for(const [y,lab] of [[rowY[1],'+20'],[rowY[2],'+10']]){
    parts.push(`<text x="${(left(y)-12).toFixed(0)}" y="${y+4}" fill="#c8ccd2" font-size="12" text-anchor="end">${lab}</text>`);
    parts.push(`<text x="${(right(y)+12).toFixed(0)}" y="${y+4}" fill="#c8ccd2" font-size="12">${lab}</text>`);
  }

  const yl=rowY[3];
  parts.push(`<line x1="${(left(yl)-30).toFixed(0)}" y1="${yl}" x2="${(right(yl)+30).toFixed(0)}" y2="${yl}" stroke="#2f6fe4" stroke-width="4"/>`);
  parts.push(`<text x="${(left(yl)-36).toFixed(0)}" y="${yl+4}" fill="#fff" font-size="12" font-weight="800" text-anchor="end">LOS</text>`);
  parts.push(`<text x="${(right(yl)+36).toFixed(0)}" y="${yl+4}" fill="#fff" font-size="12" font-weight="800">LOS</text>`);

  parts.push('</svg>');
  return parts.join('');
}

function renderPcardQbPassing(pid){
  const norm=_pcardQbNorm(pid);
  const seasons=pcardQbPassingSeasons(norm);
  if(!seasons.length) return `<div class="pcard-loading">No passing-chart data for this QB.</div>`;
  if(pcardQbPassingSeason==null || !seasons.includes(String(pcardQbPassingSeason))) pcardQbPassingSeason=seasons[0];
  const season=String(pcardQbPassingSeason);
  const chart=NFLVERSE[season].qb_passing[norm];
  if(!chart) return `<div class="pcard-loading">No passing-chart data for this season.</div>`;

  const p=(sleeperPlayers&&sleeperPlayers[pid])||{};
  const name=p.name||'QB';
  const notePlayer = noteTargetFromArgs(pid, 'QB', p.team||chart.team||'');
  const t=chart.totals||{};
  const seasonBtns=seasons.map(s=>`<button class="rt-season-btn ${String(s)===season?'active':''}" onclick="setPcardQbPassingSeason('${s}')">${s}</button>`).join('');
  if(!QB_ZONE_METRICS[pcardQbMetric]) pcardQbMetric='rating';
  let metric=pcardQbMetric;
  if(!_qbMetricKnown(chart, metric)) metric='rating';   // older seed without yards/TD
  const metricBtns=Object.entries(QB_ZONE_METRICS).map(([k,m])=>{
    const known=_qbMetricKnown(chart,k);
    return `<button class="rt-metric-btn ${k===metric?'active':''}" ${known?'':'disabled'}
      title="${known?('Show '+m.label):(m.short+' unavailable for this season — rebuild the seed to add it')}"
      onclick="setPcardQbMetric('${k}')">${m.short}</button>`;
  }).join('');
  const tdInt = `${t.td!=null?t.td:'—'}/${t.int!=null?t.int:'—'}`;

  return `<div class="qpc-wrap">
    <div class="rt-head">
      <div class="rt-seasons">${seasonBtns}</div>
      <div class="rt-metrics">${metricBtns}</div>
      <div class="rt-summary">${noteWrapHtml(`${t.attempts||0} located attempts`, { label:'Located Attempts', value:String(t.attempts||0), source:'qb_passing_chart', statKey:'attempts', context:`${season} passing chart`, player:notePlayer, team:notePlayer.team }, 'note-tag-hit')} · threshold ±${QB_PASS_THRESH.toFixed(0)} vs league avg</div>
    </div>
    ${_qbPassingSVG(chart, name, season, metric, notePlayer)}
    ${metric==='rating' ? `<div class="qpc-legend">
      <span><i style="background:#2fae4e"></i>Better than average</span>
      <span><i style="background:#d8a51d"></i>Within average</span>
      <span><i style="background:#d33b2f"></i>Worse than average</span>
    </div>` : `<div class="qpc-legend"><span class="qpc-heat-key"></span>lighter = more ${QB_ZONE_METRICS[metric].short.toLowerCase()} from that zone</div>`}
    <div class="qpc-totals">
      <div class="qpc-tile"><label>Passer Rating</label><b>${noteWrapHtml(escHtml(_qbNum(t.passer_rating,1)), { label:'Passer Rating', value:_qbNum(t.passer_rating,1), source:'qb_passing_chart', statKey:'passer_rating', context:`${season} passing chart`, player:notePlayer, team:notePlayer.team }, 'note-tag-hit')}</b></div>
      <div class="qpc-tile"><label>Comp %</label><b>${noteWrapHtml(escHtml(_qbNum(t.comp_pct,1)), { label:'Completion Percentage', value:_qbNum(t.comp_pct,1), source:'qb_passing_chart', statKey:'comp_pct', context:`${season} passing chart`, player:notePlayer, team:notePlayer.team }, 'note-tag-hit')}</b></div>
      <div class="qpc-tile"><label>Yards</label><b>${noteWrapHtml(escHtml(t.yards!=null?Number(t.yards).toLocaleString():'—'), { label:'Passing Yards', value:t.yards!=null?Number(t.yards).toLocaleString():'—', source:'qb_passing_chart', statKey:'yards', context:`${season} passing chart`, player:notePlayer, team:notePlayer.team }, 'note-tag-hit')}</b></div>
      <div class="qpc-tile"><label>TD/INT</label><b>${noteWrapHtml(escHtml(tdInt), { label:'TD/INT', value:tdInt, source:'qb_passing_chart', statKey:'td_int', context:`${season} passing chart`, player:notePlayer, team:notePlayer.team }, 'note-tag-hit')}</b></div>
      <div class="qpc-tile"><label>Attempts*</label><b>${noteWrapHtml(escHtml(t.attempts!=null?t.attempts:'—'), { label:'Located Attempts', value:t.attempts!=null?t.attempts:'—', source:'qb_passing_chart', statKey:'attempts', context:`${season} passing chart`, player:notePlayer, team:notePlayer.team }, 'note-tag-hit')}</b></div>
    </div>
    <div class="pcard-src">*Located pass attempts (excl. sacks, 2-pt) · depth via air yards, location via nflverse charting.</div>
  </div>`;
}

function setPcardQbPassingSeason(season){
  pcardQbPassingSeason=season;
  const body=document.getElementById('pcardBody');
  if(body && pcardState) body.innerHTML=renderPcardQbPassing(pcardState.pid);
}
