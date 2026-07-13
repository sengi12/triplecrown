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

function _qbPassingSVG(chart, playerName, season){
  const zones = chart.zones || {};
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
  parts.push('<text x="24" y="48" fill="#9aa0a6" font-size="12">Passer rating vs. league average by throw zone (nflverse)</text>');

  for(let r=0;r<4;r++){
    const depth=QB_PASS_ROW_ORDER[r];
    const y0=rowY[r], y1=rowY[r+1];
    for(let c=0;c<3;c++){
      const loc=QB_PASS_COL_ORDER[c];
      const z=((zones[depth]||{})[loc])||{};
      const rating=z.rating;
      const lg=z.league_avg;
      const att=+z.attempts||0;
      const l0=left(y0), rt0=right(y0), l1=left(y1), rt1=right(y1);
      const w0=(rt0-l0)/3, w1=(rt1-l1)/3;
      const tl=l0+w0*c, tr=l0+w0*(c+1), bl=l1+w1*c, br=l1+w1*(c+1);
      const cx=(tl+tr+bl+br)/4, cy=(y0+y1)/2;
      const pts=`${(tl+gap).toFixed(0)},${y0+gap} ${(tr-gap).toFixed(0)},${y0+gap} ${(br-gap).toFixed(0)},${y1-gap} ${(bl+gap).toFixed(0)},${y1-gap}`;
      const fill=_qbCellColor(rating, lg);
      parts.push(`<polygon points="${pts}" fill="${fill}" stroke="#0c0d0f" stroke-width="2"/>`);
      parts.push(`<text x="${cx.toFixed(0)}" y="${(cy-4).toFixed(0)}" fill="#fff" font-size="26" font-weight="800" text-anchor="middle">${_qbNum(rating,1)}</text>`);
      parts.push(`<text x="${cx.toFixed(0)}" y="${(cy+14).toFixed(0)}" fill="#0d1b10" font-size="10.5" font-weight="800" text-anchor="middle">LEAGUE AVG: ${_qbNum(lg,1)}</text>`);
      parts.push(`<text x="${cx.toFixed(0)}" y="${(cy+29).toFixed(0)}" fill="#141517" font-size="10" font-weight="800" opacity="0.75" text-anchor="middle">${att} att</text>`);
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
  const t=chart.totals||{};
  const seasonBtns=seasons.map(s=>`<button class="rt-season-btn ${String(s)===season?'active':''}" onclick="setPcardQbPassingSeason('${s}')">${s}</button>`).join('');
  const tdInt = `${t.td!=null?t.td:'—'}/${t.int!=null?t.int:'—'}`;

  return `<div class="qpc-wrap">
    <div class="rt-head">
      <div class="rt-seasons">${seasonBtns}</div>
      <div class="rt-summary">${t.attempts||0} located attempts · threshold ±${QB_PASS_THRESH.toFixed(0)} vs league avg</div>
    </div>
    ${_qbPassingSVG(chart, name, season)}
    <div class="qpc-legend">
      <span><i style="background:#2fae4e"></i>Better than average</span>
      <span><i style="background:#d8a51d"></i>Within average</span>
      <span><i style="background:#d33b2f"></i>Worse than average</span>
    </div>
    <div class="qpc-totals">
      <div class="qpc-tile"><label>Passer Rating</label><b>${_qbNum(t.passer_rating,1)}</b></div>
      <div class="qpc-tile"><label>Comp %</label><b>${_qbNum(t.comp_pct,1)}</b></div>
      <div class="qpc-tile"><label>Yards</label><b>${t.yards!=null?Number(t.yards).toLocaleString():'—'}</b></div>
      <div class="qpc-tile"><label>TD/INT</label><b>${tdInt}</b></div>
      <div class="qpc-tile"><label>Attempts*</label><b>${t.attempts!=null?t.attempts:'—'}</b></div>
    </div>
    <div class="pcard-src">*Located pass attempts (excl. sacks, 2-pt) · depth via air yards, location via nflverse charting.</div>
  </div>`;
}

function setPcardQbPassingSeason(season){
  pcardQbPassingSeason=season;
  const body=document.getElementById('pcardBody');
  if(body && pcardState) body.innerHTML=renderPcardQbPassing(pcardState.pid);
}
