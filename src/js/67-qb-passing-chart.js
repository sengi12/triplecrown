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
// Map (every attempt drawn — the default) or Zones (the rating / volume matrix).
let pcardQbView='map';
function setPcardQbView(v){
  if(v!=='map' && v!=='zones') return;
  pcardQbView=v;
  const body=document.getElementById('pcardBody');
  if(body && typeof pcardState!=='undefined' && pcardState) body.innerHTML=renderPcardQbPassing(pcardState.pid);
}
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
  parts.push(`<text x="24" y="28" fill="#fff" font-size="20" font-weight="800">${playerName.toUpperCase()} <tspan fill="#9aa0a6" font-size="13" font-weight="600">/ ${(typeof tcIsLiveSeason==='function'&&tcIsLiveSeason(season))?season+' THRU WEEK '+completedWeeks():season+' REGULAR SEASON'}</tspan></text>`);
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
  let chart=NFLVERSE[season].qb_passing[norm];
  if(!chart) return `<div class="pcard-loading">No passing-chart data for this season.</div>`;
  _pcardGameReset(norm);
  const _games=pcardWeeklyGames('qb_passing_weekly', norm, season);
  const _selWk=_games ? pcardChartGame.qbpass : null;
  const _game=_games && _selWk!=null ? _games.find(g=>g.wk===_selWk) : null;
  if(_game){
    // One game, season-shaped: each cell borrows the SEASON league average —
    // a single game is read against the stable baseline, not against itself.
    const zones={};
    for(const depth in (chart.zones||{})){
      zones[depth]={};
      for(const loc in chart.zones[depth]){
        const wkCell=(_game.zones[depth]||{})[loc];
        zones[depth][loc]=Object.assign({rating:null,attempts:0,yards:0,td:0},
          wkCell||{}, {league_avg:(chart.zones[depth][loc]||{}).league_avg});
      }
    }
    chart={ team:chart.team, totals:_game.totals, zones };
  }

  const p=(sleeperPlayers&&sleeperPlayers[pid])||{};
  const name=p.name||'QB';
  const notePlayer = noteTargetFromArgs(pid, 'QB', p.team||chart.team||'');
  const t=chart.totals||{};
  const seasonBtns=seasons.map(s=>`<button class="rt-season-btn ${String(s)===season?'active':''}" onclick="setPcardQbPassingSeason('${s}')">${typeof tcSeasonLabel==='function'?tcSeasonLabel(s):s}</button>`).join('')
    + (_games ? _pcardGameChips('qbpass', _games, _selWk, chart.team) : '');
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
  const _rk=(k)=>(typeof pcardRankTag==='function') ? pcardRankTag(t.rk||{}, k, 'QB') : '';
  // The pass map (66b): every attempt of the game or season, when the weekly block
  // carries per-attempt rows. Map first; the zone matrix a tap away. The view toggle
  // owns a row so switching never moves it; the zone metrics take the row beneath.
  const _wnode=(NFLVERSE[season].qb_passing_weekly||{})[norm]||null;
  const hasMap=!!(_wnode && typeof qbPassMapBlock==='function' && typeof _tmHasPlays==='function' && _tmHasPlays(_wnode));
  const mapOn=hasMap && pcardQbView==='map';
  const live=(typeof tcIsLiveSeason==='function') && tcIsLiveSeason(season);
  const mapLabel=_game ? `Week ${_game.wk}${_game.opp?` · ${_game.opp}`:''}` : (live?'Season to date':'Season');
  const mapTag=(typeof noteTagAttrs==='function') ? (meta)=>noteTagAttrs(Object.assign({source:'qb_passing_chart', context:`${season} passing chart${_selWk!=null?` · week ${_selWk}`:''}`, player:notePlayer, team:notePlayer.team, relevance:'QB'}, meta)) : null;
  const viewBtns=hasMap ? `<span class="tm-view"><button class="rt-metric-btn ${mapOn?'active':''}" title="Every attempt drawn at its depth and side" onclick="setPcardQbView('map')">Map</button><button class="rt-metric-btn ${mapOn?'':'active'}" title="Attempts binned by zone, rated against the league" onclick="setPcardQbView('zones')">Zones</button></span>` : '';
  const summary=`<div class="rt-summary">${noteWrapHtml(`${t.attempts||0} located attempts`, { label:'Located Attempts', value:String(t.attempts||0), source:'qb_passing_chart', statKey:'attempts', context:`${season} passing chart`, player:notePlayer, team:notePlayer.team }, 'note-tag-hit')}${mapOn?'':` · threshold ±${QB_PASS_THRESH.toFixed(0)} vs league avg`}</div>`;

  return `<div class="qpc-wrap">
    <div class="rt-head">
      <div class="rt-seasons">${seasonBtns}</div>
      ${hasMap?'':`<div class="rt-metrics">${metricBtns}</div>${summary}`}
    </div>
    ${hasMap?`<div class="rt-head rt-viewrow"><div class="rt-metrics">${viewBtns}</div>${summary}</div>`:''}
    ${(hasMap && !mapOn)?`<div class="rt-head rt-metricrow"><div class="rt-metrics">${metricBtns}</div></div>`:''}
    ${mapOn ? qbPassMapBlock(name, _wnode, season, _selWk, mapLabel, mapTag) : _qbPassingSVG(chart, name, season, metric, notePlayer)}
    ${mapOn ? '' : (metric==='rating' ? `<div class="qpc-legend">
      <span><i style="background:#2fae4e"></i>Better than average</span>
      <span><i style="background:#d8a51d"></i>Within average</span>
      <span><i style="background:#d33b2f"></i>Worse than average</span>
    </div>` : `<div class="qpc-legend"><span class="qpc-heat-key"></span>lighter = more ${QB_ZONE_METRICS[metric].short.toLowerCase()} from that zone</div>`)}
    <div class="qpc-totals">
      <div class="qpc-tile"><label>Passer Rating</label><b>${noteWrapHtml(escHtml(_qbNum(t.passer_rating,1)), { label:'Passer Rating', value:_qbNum(t.passer_rating,1), source:'qb_passing_chart', statKey:'passer_rating', context:`${season} passing chart`, player:notePlayer, team:notePlayer.team }, 'note-tag-hit')}</b>${_rk('passer_rating')}</div>
      <div class="qpc-tile"><label>Comp %</label><b>${noteWrapHtml(escHtml(_qbNum(t.comp_pct,1)), { label:'Completion Percentage', value:_qbNum(t.comp_pct,1), source:'qb_passing_chart', statKey:'comp_pct', context:`${season} passing chart`, player:notePlayer, team:notePlayer.team }, 'note-tag-hit')}</b>${_rk('comp_pct')}</div>
      <div class="qpc-tile"><label>Yards</label><b>${noteWrapHtml(escHtml(t.yards!=null?Number(t.yards).toLocaleString():'—'), { label:'Passing Yards', value:t.yards!=null?Number(t.yards).toLocaleString():'—', source:'qb_passing_chart', statKey:'yards', context:`${season} passing chart`, player:notePlayer, team:notePlayer.team }, 'note-tag-hit')}</b>${_rk('yards')}</div>
      <div class="qpc-tile"><label>TD/INT</label><b>${noteWrapHtml(escHtml(tdInt), { label:'TD/INT', value:tdInt, source:'qb_passing_chart', statKey:'td_int', context:`${season} passing chart`, player:notePlayer, team:notePlayer.team }, 'note-tag-hit')}</b>${_rk('td')}</div>
      ${t.scramble_rate!=null ? `<div class="qpc-tile" title="Scrambles per dropback (${t.scrambles||0} of ${t.dropbacks||0})"><label>Scramble %</label><b>${noteWrapHtml(escHtml(_qbNum(t.scramble_rate,1)+'%'), { label:'Scramble Rate', value:_qbNum(t.scramble_rate,1)+'%', source:'qb_passing_chart', statKey:'scramble_rate', context:`${season} passing chart`, player:notePlayer, team:notePlayer.team }, 'note-tag-hit')}</b>${_rk('scramble_rate')}</div>` : ''}
      <div class="qpc-tile"><label>Attempts*</label><b>${noteWrapHtml(escHtml(t.attempts!=null?t.attempts:'—'), { label:'Located Attempts', value:t.attempts!=null?t.attempts:'—', source:'qb_passing_chart', statKey:'attempts', context:`${season} passing chart`, player:notePlayer, team:notePlayer.team }, 'note-tag-hit')}</b></div>
    </div>
    ${pcardQbDuressHTML(_game, _games, season, notePlayer)}
    ${(typeof pcardNgsStrip==='function') ? pcardNgsStrip('qb', norm, season, _selWk) : ''}
    ${pcardQbChartingBand(norm, season, notePlayer)}
    <div class="pcard-src">*Located pass attempts (excl. sacks, 2-pt) · depth via air yards, location via nflverse charting.${(typeof ngsChartLink==='function' && _wnode) ? ngsChartLink(_wnode, name, season, _selWk) : ''}</div>
  </div>`;
}

// ── Accuracy & decision charting band ───────────────────────────────────────
// Seed payload: NFLVERSE[season].qb_charting = { players:{norm:{...}}, lg:{medians} }
// (PFR advanced passing + FTN per-play charting; see qb_charting in
// src/nflverse/nflverse.py). Rendered under the zone totals: six tiles, each
// colored against the LEAGUE MEDIAN for that season — no hardcoded notion of
// good. Directions differ per stat (on-target high = good, bad-throw high =
// bad), so each tile declares its own.
const QB_CHARTING_TILES = [
  ['on_tgt_pct',    'On-Target %',  'hi', 'Throws charted on target (PFR) — accuracy independent of drops and YAC'],
  ['bad_throw_pct', 'Bad Throw %',  'lo', 'Uncatchable throws excluding throwaways/spikes (PFR)'],
  ['catchable_pct', 'Catchable %',  'hi', 'Charted catchable balls per attempt (FTN)'],
  ['intw_pct',      'INT-Worthy %', 'lo', 'Interception-worthy throws per attempt (FTN) — the true turnover risk, luck removed'],
  ['pressure_pct',  'Pressured %',  'lo', 'Dropbacks under pressure (PFR) — much of this is the line, not the QB'],
  ['batted',        'Batted',       null, 'Passes batted at the line (PFR)'],
];
function pcardQbChartingBand(norm, season, notePlayer){
  const blk=(typeof NFLVERSE!=='undefined' && NFLVERSE && NFLVERSE[season]
             && NFLVERSE[season].qb_charting) || null;
  const q=blk && blk.players && blk.players[norm];
  if(!q) return '';
  const lg=blk.lg||{};
  const tiles=QB_CHARTING_TILES.map(([k,label,dir,tip])=>{
    if(q[k]==null) return '';
    const v=q[k];
    const med=lg[k];
    let cls='';
    if(dir && med!=null){
      const edge=Math.abs(med)*0.08 + 0.4;         // a real gap, not decimal jitter
      const better = dir==='hi' ? v>med+edge : v<med-edge;
      const worse  = dir==='hi' ? v<med-edge : v>med+edge;
      cls = better?'qpc-good':(worse?'qpc-bad':'');
    }
    const disp = (k==='batted') ? String(v) : `${Number(v).toFixed(1)}%`;
    const medTxt = med!=null ? ` · league median ${med}%` : '';
    return `<div class="qpc-tile ${cls}" title="${escAttr(tip+medTxt)}"><label>${label}</label>
      <b>${noteWrapHtml(escHtml(disp), { label, value:disp, source:'qb_charting',
        statKey:k, context:`${season} QB charting`, player:notePlayer,
        team:notePlayer&&notePlayer.team }, 'note-tag-hit')}</b>
      ${med!=null && k!=='batted' ? `<span class="qpc-med">lg ${med}%</span>` : ''}</div>`;
  }).join('');
  if(!tiles) return '';
  return `<div class="qpc-charting">
    <div class="qpc-charting-h">Accuracy &amp; decisions <span class="qpc-charting-sub">PFR + FTN charting · colored vs the league median</span></div>
    <div class="qpc-totals">${tiles}</div>
  </div>`;
}

function setPcardQbPassingSeason(season){
  pcardQbPassingSeason=season;
  const body=document.getElementById('pcardBody');
  if(body && pcardState) body.innerHTML=renderPcardQbPassing(pcardState.pid);
}

// ── Under duress: the game's dropbacks by what the defense did ───────────────
// Public play-by-play flags a pressure only when the passer is hit or sacked (the
// participation file adds hurries after the season); FTN charts the rushers, so "vs blitz"
// is five or more; PFR's weekly line carries the pressures pbp cannot see (hurries) — as
// COUNTS, without outcomes. So: outcome lines for the clean pocket, hit-or-sacked and vs
// blitz, then PFR's pressure line. One game when one is picked; season to date otherwise.
function _qbRatingOf(att, cmp, yds, td, int_){
  if(!att) return null;
  const a=Math.max(0,Math.min(2.375,(cmp/att-0.3)*5)), b=Math.max(0,Math.min(2.375,(yds/att-3)*0.25));
  const c=Math.min(2.375, td/att*20), d=Math.max(0, 2.375-int_/att*25);
  return Math.round((a+b+c+d)/6*1000)/10;
}
function _qbDuressSum(games, key){
  const s={db:0,att:0,cmp:0,yds:0,td:0,int:0,sk:0}; let n=0;
  (games||[]).forEach(g=>{ const x=g.duress&&g.duress[key]; if(!x) return; n++; for(const k in s) s[k]+=x[k]||0; });
  if(!n) return null;
  s.rating=_qbRatingOf(s.att,s.cmp,s.yds,s.td,s.int);
  return s;
}
function _qbPfrSum(games){
  const keys=['pressured','blitzed','hurried','hit','sacked','bad_throws','drops'];
  const s={}; let n=0;
  (games||[]).forEach(g=>{ const p=g.duress&&g.duress.pfr; if(!p) return; n++; keys.forEach(k=>{ if(p[k]!=null) s[k]=(s[k]||0)+p[k]; }); });
  return n?s:null;
}
function pcardQbDuressHTML(game, games, season, notePlayer){
  const src = game ? game.duress : null;
  if(game ? !src : !(games||[]).some(g=>g.duress)) return '';
  const pick=(k)=> game ? (src[k]||null) : _qbDuressSum(games, k);
  const clean=pick('clean'), pressured=pick('pressured'), blitzed=pick('blitzed');
  const pfr = game ? (src.pfr||null) : _qbPfrSum(games);
  const dbAll=(clean?clean.db:0)+(pressured?pressured.db:0);
  const row=(label, x, tip)=> x
    ? `<tr><th title="${escAttr(tip)}">${label}</th><td>${x.cmp}/${x.att}</td><td class="dz-pct">${x.att?Math.round(x.cmp/x.att*100)+'%':'—'}</td><td>${x.yds}</td><td>${x.td}</td><td>${x.int}</td><td>${x.sk}</td><td><b>${x.rating!=null?Number(x.rating).toFixed(1):'—'}</b></td></tr>`
    : `<tr class="qpc-dz-none"><th title="${escAttr(tip)}">${label}</th><td colspan="7">none</td></tr>`;
  const pct = pfr && pfr.pressured!=null ? (game && pfr.pressured_pct!=null ? pfr.pressured_pct : (dbAll ? Math.round(pfr.pressured/dbAll*1000)/10 : null)) : null;
  const pfrLine = pfr
    ? `PFR pressures <b>${pfr.pressured!=null?pfr.pressured:'—'}</b>${pct!=null?` <span class="qpc-dz-pct">(${pct}% of dropbacks)</span>`:''} · blitzed <b>${pfr.blitzed!=null?pfr.blitzed:'—'}</b> · hurried <b>${pfr.hurried!=null?pfr.hurried:'—'}</b> · hit <b>${pfr.hit!=null?pfr.hit:'—'}</b> · sacked <b>${pfr.sacked!=null?pfr.sacked:'—'}</b> · bad throws <b>${pfr.bad_throws!=null?pfr.bad_throws:'—'}</b> · drops <b>${pfr.drops!=null?pfr.drops:'—'}</b>`
    : `<span class="qpc-dz-muted">PFR's pressure counts (hurries included) post within a day of the game</span>`;
  return `<div class="qpc-duress">
    <div class="qpc-dz-head"><span class="la-ins-lbl">UNDER DURESS${game?` · WK ${game.wk}${game.opp?' vs '+escHtml(game.opp):''}`:' · SEASON TO DATE'}</span><span class="qpc-dz-sub">${dbAll} dropbacks by what the defense did${(typeof tcInfoBtn==='function')?' '+tcInfoBtn('qbduress','About these splits'):''}</span></div>
    <div class="qpc-dz-scroll"><table class="qpc-dz"><thead><tr><th></th><th>Cmp/Att</th><th class="dz-pct">Cmp%</th><th>Yds</th><th>TD</th><th>INT</th><th>Sk</th><th>Rtg</th></tr></thead><tbody>
      ${row('Clean pocket', clean, 'Dropbacks with no hit and no sack')}
      ${row('Under pressure', pressured, 'Pressured dropbacks — in public play-by-play a pressure is one that ends in a hit or a sack (a hurry leaves no trace until PFR\'s count below). Cmp/Att counts throws only; a sack is in the Sk column')}
      ${blitzed ? row('vs Blitz (5+)', blitzed, 'Five or more pass rushers, per FTN charting') : `<tr class="qpc-dz-none"><th title="Five or more pass rushers, per FTN charting">vs Blitz (5+)</th><td colspan="7">FTN charting not posted yet</td></tr>`}
    </tbody></table></div>
    <div class="qpc-dz-pfr">${pfrLine}</div>
  </div>`;
}
if(typeof TC_INFO_BOOK!=='undefined'){
  TC_INFO_BOOK.qbduress={title:'Under duress', body:`
    The quarterback's dropbacks split by what the defense did, with the passer rating for
    each. <b>Under pressure</b> is what public play-by-play can see of pressure: a dropback
    that ends in a hit or a sack. A hurry that never lands leaves no trace there, so it is
    not in that line's outcomes. Cmp/Att counts throws only; sacks are the Sk column.
    <b>PFR pressures</b> is the count that includes hurries — pressures, blitzes, hurries,
    hits, sacks, bad throws, drops — published as counts, not what happened on them. <b>vs Blitz</b> is five or more
    rushers per FTN's charting. Broadcast "under pressure" completion lines come from private
    charting (PFF, Next Gen Stats); this is the closest the public data gets.`};
}
