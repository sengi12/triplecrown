// ── Route tree (player-card "Routes" tab) ────────────────────────────────────
// nflverse participation tags each pass play with the route the TARGETED receiver ran, so
// counting those per receiver gives a "routes run when targeted" distribution — exactly what a
// route tree draws. The seed bakes it as NFLVERSE[season].routes[normName] = {pos,total,tree}.
//
// The tree is drawn PFF-style: routes fan out from the receiver at the line of scrimmage, each
// coloured + weighted by how often it was run (a heat map), and labelled with its share. Swing
// and Angle (Texas) routes start from the BACKFIELD, below the LOS, so they read as RB releases
// rather than being forced onto the WR's release point.

// Each route: o=origin ('los' | 'bf'=backfield), p=waypoints in field units (x:+right, y:+downfield
// in yards from the LOS spot), label, anc=text-anchor, dx/dy=label nudge (px) off the endpoint.
const ROUTE_TREE_SHAPES = {
  "GO":                {o:'los', p:[[0,0],[0,14]],                 label:'Go',        anc:'middle', dx:0,  dy:-9},
  "POST":              {o:'los', p:[[0,0],[0,9],[-4,13]],          label:'Post',      anc:'end',    dx:-4, dy:-5},
  "CORNER":            {o:'los', p:[[0,0],[0,9],[4,13]],           label:'Corner',    anc:'start',  dx:4,  dy:-5},
  "DEEP OUT":          {o:'los', p:[[0,0],[0,7.5],[4,7.5]],        label:'Out',       anc:'start',  dx:6,  dy:3},
  "IN/DIG":            {o:'los', p:[[0,0],[0,7],[-5,7]],           label:'Dig',       anc:'end',    dx:-6, dy:3},
  "WHEEL":             {o:'los', p:[[0,0],[2.6,1],[3.4,9]],        label:'Wheel',     anc:'start',  dx:6,  dy:0},
  "HITCH/CURL":        {o:'los', p:[[0,0],[0,5.5],[-1.2,4.6]],     label:'Hitch',     anc:'end',    dx:-7, dy:1},
  "QUICK OUT":         {o:'los', p:[[0,0],[0,3],[3,3]],            label:'Quick Out', anc:'start',  dx:6,  dy:3},
  "SLANT":             {o:'los', p:[[0,0],[0,1.2],[-3,3.4]],       label:'Slant',     anc:'end',    dx:-6, dy:-1},
  "CROSS":             {o:'los', p:[[0,0],[0,7.5],[-6,10.3]],      label:'Cross',     anc:'end',    dx:15, dy:-10},
  "SHALLOW CROSS/DRAG":{o:'los', p:[[0,0],[0,1.2],[-5.5,2]],       label:'Drag',      anc:'end',    dx:-6, dy:4},
  "SCREEN":            {o:'los', p:[[0,0],[0,-0.4],[-3,-0.8]],     label:'Screen',    anc:'end',    dx:-6,  dy:4},
  "SWING":             {o:'bf',  p:[[0,-2.7],[-4,-2.5],[-7,-1.4]], label:'Swing',     anc:'start',  dx:-20,  dy:35},
  "TEXAS/ANGLE":       {o:'bf',  p:[[0,-2.7],[4,-0.7],[1,1.7]],    label:'Texas',     anc:'start',  dx:45, dy:50},
};
// Draw order: least-run underneath, most-run on top (so hot routes read clearly).
const ROUTE_TREE_ORDER = ["GO","POST","CORNER","DEEP OUT","IN/DIG","WHEEL","HITCH/CURL","QUICK OUT",
  "SLANT","CROSS","SHALLOW CROSS/DRAG","SCREEN","SWING","TEXAS/ANGLE"];

// Some nflverse route tags are shorter/raw versions of the compact labels we already show.
// Normalize them onto the existing shapes so the tree stays readable without adding more nodes.
const ROUTE_TREE_ALIASES = {
  "HITCH": "HITCH/CURL",
  "IN": "IN/DIG",
  "OUT": "DEEP OUT",
  "FLAT": "QUICK OUT",
};

function _routeTreeKey(k){
  return ROUTE_TREE_ALIASES[k] || k;
}

let pcardRouteSeason = null;   // selected season in the Routes tab (reset per card)
let pcardRouteMetric = 'td';   // selected metric in Routes tab (td|yds|rec)

const ROUTE_TREE_METRICS = {
  td:  {label:'TD share',      short:'TD',         map:'route_tds', total:'total_tds', digits:0, unit:' TD', summary:'on charted routes'},
  yds: {label:'Yardage share', short:'Yards',      map:'route_yds', total:'total_yds', digits:0, unit:' yd', summary:'charted-route yards'},
  rec: {label:'Reception share',short:'Receptions',map:'route_rec', total:'total_rec', digits:0, unit:' rec',summary:'charted-route receptions'},
};

function _routeMetricKnown(rt, metric){
  const m=ROUTE_TREE_METRICS[metric]||ROUTE_TREE_METRICS.td;
  const map=rt&&rt[m.map];
  if(map && Object.keys(map).length>0) return true;
  if(rt && rt[m.total]!=null) return true;
  return false;
}

function _routeMetricValueByRaw(rt, rawKey, metric){
  const m=ROUTE_TREE_METRICS[metric]||ROUTE_TREE_METRICS.td;
  const map=rt&&rt[m.map];
  if(map && map[rawKey]!=null) return +map[rawKey]||0;
  return null;
}

function _routeMetricTotal(rt, metric, fallbackMap){
  const m=ROUTE_TREE_METRICS[metric]||ROUTE_TREE_METRICS.td;
  if(rt && rt[m.total]!=null) return +rt[m.total]||0;
  const map=rt&&rt[m.map];
  if(map && Object.keys(map).length) return Object.values(map).reduce((a,b)=>a+(+b||0),0);
  if(fallbackMap) return Object.values(fallbackMap).reduce((a,b)=>a+b,0);
  return 0;
}

function _fmtRouteMetricValue(v, metric){
  if(v==null) return '—';
  const m=ROUTE_TREE_METRICS[metric]||ROUTE_TREE_METRICS.td;
  const n=(m.digits>0)?(+v).toFixed(m.digits):String(Math.round(+v||0));
  return `${n}${m.unit}`;
}

// Seasons (desc) for which this player has a baked route tree.
function pcardRouteSeasons(normName){
  if(typeof NFLVERSE==='undefined' || !NFLVERSE) return [];
  return Object.keys(NFLVERSE)
    .filter(s=>{ const r=NFLVERSE[s]&&NFLVERSE[s].routes; return r && r[normName]; })
    .sort((a,b)=>b-a);
}
function _pcardNorm(pid){
  const p=(typeof sleeperPlayers!=='undefined'&&sleeperPlayers&&sleeperPlayers[pid])||{};
  return ecrNormName(p.name||'');
}
// Does the player have any baked route data? (gates the Routes tab).
function pcardRoutesAvailable(pid){
  return pcardRouteSeasons(_pcardNorm(pid)).length>0;
}

// Heat colour for a route by its share of the max route (blue = rare → red = most-run).
function _routeHeat(ratio){
  const hue = Math.round(210 - Math.max(0,Math.min(1,ratio))*198);
  return `hsl(${hue},85%,60%)`;
}

// The SVG route tree for one season's distribution.
function routeTreeSVG(rt, metric){
  metric=ROUTE_TREE_METRICS[metric]?metric:'td';
  const W=360, H=440, cx=180, losY=340, sx=15, sy=20;
  const PX = x => +(cx + x*sx).toFixed(1);
  const PY = y => +(losY - y*sy).toFixed(1);
  const tree=rt.tree||{}, total=rt.total||Object.values(tree).reduce((a,b)=>a+b,0)||1;
  const metricKnown=_routeMetricKnown(rt, metric);
  const rawKeys = Object.keys(tree);
  const presentMap = {};
  for(const rawKey of rawKeys){
    const key=_routeTreeKey(rawKey);
    if(!ROUTE_TREE_SHAPES[key]) continue;
    if(!presentMap[key]) presentMap[key]={count:0, metric:0};
    presentMap[key].count += +tree[rawKey] || 0;
    if(metricKnown){
      const mv=_routeMetricValueByRaw(rt, rawKey, metric);
      if(mv!=null) presentMap[key].metric += mv;
    }
  }
  const present = ROUTE_TREE_ORDER.filter(k=>presentMap[k] && presentMap[k].count>0 && ROUTE_TREE_SHAPES[k]);
  const metricTotal=metricKnown ? _routeMetricTotal(rt, metric, presentMap) : 0;
  const maxN = Math.max(1, ...present.map(k=>presentMap[k].count));
  const hasBf = present.some(k=>ROUTE_TREE_SHAPES[k].o==='bf');
  // Field backdrop + yard lines every 5 yards up to ~15.
  let yard='';
  for(let y=5;y<=15;y+=5){ const py=PY(y); yard+=`<line x1="24" y1="${py}" x2="${W-24}" y2="${py}" class="rt-yard"/>`; }
  // Per-route render geometry.
  const items = present.map(k=>{
    const sh=ROUTE_TREE_SHAPES[k], n=presentMap[k].count;
    const metricV=presentMap[k].metric;
    const pct=100*n/total, ratio=n/maxN;
    const col=_routeHeat(ratio), w=+(2.4+ratio*5).toFixed(2);
    const pts=sh.p.map(([x,y])=>[PX(x),PY(y)]);
    const end=pts[pts.length-1], prev=pts[pts.length-2];
    const ang=Math.atan2(end[1]-prev[1], end[0]-prev[0]);
    const side = sh.anc==='end'?'L' : (sh.anc==='start'?'R':'C');
    return {sh,n,pct,ratio,col,w,pts,end,ang,side,metricV};
  });
  // Draw least-run first so the hot routes sit on top; each route ends in an arrowhead.
  let paths='';
  for(const it of items.slice().sort((a,b)=>a.n-b.n)){
    paths+=`<polyline points="${it.pts.map(p=>p.join(',')).join(' ')}" fill="none" stroke="${it.col}" stroke-width="${it.w}" stroke-linejoin="round" stroke-linecap="round" opacity="0.95"/>`;
    const [ex,ey]=it.end, a=it.ang, aLen=8+it.ratio*3, aW=3.4+it.ratio*1.8;
    const tip=[ex+Math.cos(a)*aLen*0.5, ey+Math.sin(a)*aLen*0.5];
    const back=[ex-Math.cos(a)*aLen*0.5, ey-Math.sin(a)*aLen*0.5];
    const b1=[back[0]+Math.cos(a+Math.PI/2)*aW, back[1]+Math.sin(a+Math.PI/2)*aW];
    const b2=[back[0]+Math.cos(a-Math.PI/2)*aW, back[1]+Math.sin(a-Math.PI/2)*aW];
    paths+=`<polygon points="${tip[0].toFixed(1)},${tip[1].toFixed(1)} ${b1[0].toFixed(1)},${b1[1].toFixed(1)} ${b2[0].toFixed(1)},${b2[1].toFixed(1)}" fill="${it.col}"/>`;
  }
  // Label placement with a vertical de-collision pass per side (left / right / centre), so the
  // lower clusters (Slant/Angle/Drag …) don't stack on top of each other. A thin leader line is
  // drawn to any label that had to be nudged away from its route's endpoint.
  const MINGAP=14;
  const placeCol = list => {
    list.forEach(it=>{ it.lx=+(it.end[0]+it.sh.dx).toFixed(1); it.ly0=it.end[1]+it.sh.dy; it.ly=it.ly0; });
    list.sort((a,b)=>a.ly-b.ly);
    for(let i=1;i<list.length;i++) if(list[i].ly < list[i-1].ly+MINGAP) list[i].ly=list[i-1].ly+MINGAP;
    if(list.length){
      const over=list[list.length-1].ly-(H-10);
      if(over>0) list.forEach(it=>it.ly-=over);
      const under=16-list[0].ly;
      if(under>0) list.forEach(it=>it.ly+=under);
    }
  };
  placeCol(items.filter(i=>i.side==='L'));
  placeCol(items.filter(i=>i.side==='R'));
  placeCol(items.filter(i=>i.side==='C'));
  let labels='';
  for(const it of items){
    if(Math.abs(it.ly-it.ly0)>3)
      labels+=`<line x1="${it.end[0]}" y1="${it.end[1]}" x2="${it.lx}" y2="${(it.ly-3).toFixed(1)}" class="rt-leader"/>`;
    let metricTag='';
    if(metricKnown){
      if(metric==='td' && it.metricV>0) metricTag=` <tspan class="rt-label-td">${Math.round(it.metricV)} TD</tspan>`;
      else if(metric!=='td' && it.metricV>0) metricTag=` <tspan class="rt-label-alt">${_fmtRouteMetricValue(it.metricV, metric)}</tspan>`;
    }
        labels+=`<text x="${it.lx}" y="${it.ly.toFixed(1)}" text-anchor="${it.sh.anc}" class="rt-label">`+
          `<tspan class="rt-label-name">${it.sh.label}</tspan> <tspan class="rt-label-pct" fill="${it.col}">${it.pct.toFixed(1)}%</tspan>${metricTag}</text>`;
  }
  // LOS + origin markers.
  const losLine=`<line x1="20" y1="${losY}" x2="${W-20}" y2="${losY}" class="rt-los"/>`;
  const wrDot=`<circle cx="${PX(0)}" cy="${PY(0)}" r="5.5" class="rt-origin"/>`;
  const bfDot=hasBf?`<circle cx="${PX(0)}" cy="${PY(-2.7)}" r="4" class="rt-origin-bf"/>`+
    `<line x1="${PX(0)}" y1="${PY(-2.7)}" x2="${PX(0)}" y2="${PY(-0.2)}" class="rt-bf-stem"/>`:'';
  const losTag=`<text x="${W-22}" y="${losY-5}" text-anchor="end" class="rt-los-tag">LOS</text>`;
  const bfTag=hasBf?`<text x="${PX(0)}" y="${PY(-2.7)+16}" text-anchor="middle" class="rt-bf-tag">backfield</text>`:'';
  return `<svg viewBox="0 0 ${W} ${H}" class="rt-svg" role="img" aria-label="Route tree">`+
    `<rect x="0" y="0" width="${W}" height="${H}" class="rt-field"/>`+
    yard+losLine+losTag+paths+wrDot+bfDot+bfTag+labels+`</svg>`;
}

// Ranked list beneath the tree — exact counts + share, coloured to match the tree.
function routeTreeList(rt, metric){
  metric=ROUTE_TREE_METRICS[metric]?metric:'td';
  const tree=rt.tree||{}, total=rt.total||1;
  const metricKnown=_routeMetricKnown(rt, metric);
  const rowsMap = {};
  for(const [rawKey, rawCount] of Object.entries(tree)){
    const key=_routeTreeKey(rawKey);
    if(!ROUTE_TREE_SHAPES[key]) continue;
    if(!rowsMap[key]) rowsMap[key]={count:0, metric:0};
    rowsMap[key].count += +rawCount || 0;
    if(metricKnown){
      const mv=_routeMetricValueByRaw(rt, rawKey, metric);
      if(mv!=null) rowsMap[key].metric += mv;
    }
  }
  const valueFor = row => row[1].count;
  const rows=Object.entries(rowsMap).sort((a,b)=>valueFor(b)-valueFor(a));
  const maxN=Math.max(1,...rows.map(valueFor));
  const metricShort=(ROUTE_TREE_METRICS[metric]||ROUTE_TREE_METRICS.td).short;
  const metricClass = metric==='td' ? 'rt-list-td' : 'rt-list-val';
  return `<div class="rt-list">`+rows.map(([k,v])=>{
    const n=v.count;
    const metricV=v.metric;
    const pct=100*n/total;
    const col=_routeHeat(n/maxN);
    const label=(ROUTE_TREE_SHAPES[k]||{}).label||k;
    let metricTxt='—';
    if(metricKnown){
      metricTxt=_fmtRouteMetricValue(metricV, metric);
    }
    return `<div class="rt-list-row">`+
      `<span class="rt-list-name">${label}</span>`+
      `<span class="rt-list-bar"><span class="rt-list-fill" style="width:${(100*n/maxN).toFixed(0)}%;background:${col}"></span></span>`+
      `<span class="rt-list-n">${n}</span><span class="rt-list-pct">${pct.toFixed(1)}%</span><span class="${metricClass}" title="${metricShort}">${metricTxt}</span></div>`;
  }).join('')+`</div>`;
}

// The full Routes-tab body: season selector + tree + list.
function renderPcardRoutes(pid){
  const norm=_pcardNorm(pid);
  const seasons=pcardRouteSeasons(norm);
  if(!seasons.length) return `<div class="pcard-loading">No route data for this player.</div>`;
  if(pcardRouteSeason==null || !seasons.includes(String(pcardRouteSeason))) pcardRouteSeason=seasons[0];
  const rt=NFLVERSE[pcardRouteSeason].routes[norm];
  if(!ROUTE_TREE_METRICS[pcardRouteMetric]) pcardRouteMetric='td';
  const seasonBtns=seasons.map(s=>`<button class="rt-season-btn ${String(s)===String(pcardRouteSeason)?'active':''}" onclick="setPcardRouteSeason('${s}')">${s}</button>`).join('');
  const metricBtns=Object.entries(ROUTE_TREE_METRICS).map(([k,m])=>{
    const known=_routeMetricKnown(rt,k);
    const active=(k===pcardRouteMetric)?'active':'';
    const dis=known?'':'disabled';
    const ttl=known?`Show ${m.label}`:`${m.short} data unavailable for this season`;
    return `<button class="rt-metric-btn ${active}" ${dis} title="${ttl}" onclick="setPcardRouteMetric('${k}')">${m.short}</button>`;
  }).join('');
  const topRoute=Object.entries(rt.tree||{}).sort((a,b)=>b[1]-a[1])[0];
  const topLabel=topRoute?((ROUTE_TREE_SHAPES[topRoute[0]]||{}).label||topRoute[0]):'–';
  const metricCfg=ROUTE_TREE_METRICS[pcardRouteMetric];
  const metricKnown=_routeMetricKnown(rt, pcardRouteMetric);
  const metricTotal=metricKnown ? _routeMetricTotal(rt, pcardRouteMetric) : null;
  const metricSummary = metricKnown
    ? `${_fmtRouteMetricValue(metricTotal, pcardRouteMetric)} ${metricCfg.summary}`
    : `${metricCfg.short} route data unavailable in this seed`;
  return `
    <div class="rt-wrap">
      <div class="rt-head">
        <div class="rt-seasons">${seasonBtns}</div>
        <div class="rt-metrics">${metricBtns}</div>
        <div class="rt-summary">${rt.total} routes charted · ${metricSummary} · most-run <b>${topLabel}</b></div>
      </div>
      ${routeTreeSVG(rt, pcardRouteMetric)}
      ${routeTreeList(rt, pcardRouteMetric)}
      <div class="pcard-src">Route types via nflverse participation charting (route run when targeted, ${pcardRouteSeason} regular season).</div>
    </div>`;
}
// Switch the Routes-tab season and re-render just the body.
function setPcardRouteSeason(s){
  pcardRouteSeason=s;
  const body=document.getElementById('pcardBody');
  if(body && pcardState) body.innerHTML=renderPcardRoutes(pcardState.pid);
}

function setPcardRouteMetric(metric){
  if(!ROUTE_TREE_METRICS[metric]) return;
  pcardRouteMetric=metric;
  const body=document.getElementById('pcardBody');
  if(body && pcardState) body.innerHTML=renderPcardRoutes(pcardState.pid);
}
