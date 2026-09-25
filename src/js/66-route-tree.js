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
  "CROSS":             {o:'los', p:[[0,0],[0,7.5],[-7,11]], label:'Cross',anc:'end',    dx:15, dy:-10},
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

// Seasons (desc) for which this player has a baked route tree — plus the live
// season when the sidecar carries his TARGET tree (route labels are FTN's
// commercial product and only reach the open data post-season; the target tree
// is the free in-season view of where his targets actually went).
function pcardRouteSeasons(normName){
  if(typeof NFLVERSE==='undefined' || !NFLVERSE) return [];
  // A season with his charted route tree, or with his target map (the live season's
  // sidecar; the offseason bakes the season just played the same way).
  return Object.keys(NFLVERSE)
    .filter(s=>{ const b=NFLVERSE[s]||{}; return (b.routes && b.routes[normName]) || !!_pcardTargetNode(normName, s); })
    .sort((a,b)=>b-a);
}
function _pcardTargetNode(normName, season){
  const blk=(typeof NFLVERSE!=='undefined' && NFLVERSE[String(season)] && NFLVERSE[String(season)].target_trees)||null;
  return (blk && blk.players && blk.players[normName]) || null;
}
function _pcardTargetLg(season){
  const blk=(typeof NFLVERSE!=='undefined' && NFLVERSE[String(season)] && NFLVERSE[String(season)].target_trees)||null;
  return (blk && blk.lg) || {};
}
// ── The target tree, drawn in the QB chart's visual language ────────────────
const _TT_DEPTHS=[['deep','DEEP 20+'],['inter','INTERMEDIATE 10–19'],['short','SHORT 0–9'],['behind','BEHIND LOS']];
const _TT_LOCS=[['left','LEFT'],['middle','MIDDLE'],['right','RIGHT']];
function _ttView(node, selWk){
  if(selWk!=null){
    const g=(node.games||[]).find(x=>x.wk===selWk);
    if(g) return { zones:g.zones||{}, tgt:g.tgt, rec:g.rec, yds:g.yds, td:g.td, yac:g.yac, epa:g.epa, fd:g.fd, rk:g.rk||{},
                   label:`Week ${g.wk}${g.opp?` · ${g.opp}`:''}` };
  }
  const se=node.season||{};
  return { zones:se.zones||{}, tgt:se.tgt, rec:se.rec, yds:se.yds, td:se.td, yac:se.yac, epa:se.epa, fd:se.fd, rk:se.rk||{}, label:'Season to date' };
}
// Metrics for the target chart — volume, like the route tree (heat by the player's own busiest zone).
const TT_METRICS = {
  catch:{short:'Catches', key:null,  unit:''},        // rec / tgt, yards + TD under it
  yac:  {short:'YAC',     key:'yac', unit:' YAC'},    // yards after the catch
  epa:  {short:'EPA',     key:'epa', unit:' EPA', dp:1},
  fd:   {short:'1st Downs',key:'fd', unit:' 1D'},
};
let pcardTargetMetric='catch';
function setPcardTargetMetric(m){
  if(!TT_METRICS[m]) return;
  pcardTargetMetric=m;
  const body=document.getElementById('pcardBody');
  if(body && pcardState) body.innerHTML=renderPcardRoutes(pcardState.pid);
}
// The map is a per-game view — a season of targets drawn one by one is a hairball, and
// the zone chart is the season's summary — so Map is offered only with a game picked.
function _pcardRouteViewBtns(active, hasTree, mapOk){
  if(typeof targetMapBlock!=='function') return '';
  const b=(k,label,tip,off)=>`<button class="rt-metric-btn ${active===k?'active':''}" title="${off?'Pick a game — the map is drawn one game at a time; Season is the zone view':tip}" ${off?'disabled':''} onclick="setPcardTargetView('${k}')">${label}</button>`;
  return `<span class="tm-view">${b('map','Map','Every target drawn at its depth and side', mapOk===false)}${b('zones','Zones','Targets binned by zone')}${hasTree?b('tree','Tree','His route tree — every route he ran when targeted'):''}</span>`;
}
function _renderTargetTree(pid, node, season, seasonBtns, hasTree){
  const norm=_pcardNorm(pid);
  const games=(node.games||[]).length ? node.games : null;
  _pcardDefaultGame('routes', games, season);
  const selWk=games ? (pcardChartGame.routes!=null?pcardChartGame.routes:null) : null;
  const v=_ttView(node, selWk);
  const live=(typeof tcIsLiveSeason==='function') && tcIsLiveSeason(season);
  if(selWk==null && !live) v.label='Season';
  const MET=TT_METRICS[pcardTargetMetric]||TT_METRICS.catch;
  // Map (every target drawn — the default, in 66b), Zones (the binned chart), and Tree
  // when the season has his charted route tree (the classic route tree in this file).
  const mapOn=(selWk!=null && pcardTargetView!=='zones' && typeof targetMapBlock==='function');
  const viewBtns=_pcardRouteViewBtns(mapOn?'map':'zones', hasTree, selWk!=null);
  const notePlayer=(typeof noteTargetFromArgs==='function') ? noteTargetFromArgs(pid, pcardState&&pcardState.posc, pcardState&&pcardState.team) : null;
  const team=(notePlayer&&notePlayer.team)||node.team||'';
  const ctx=`${season} target chart${selWk!=null?` · week ${selWk}`:''}`;
  const tag=(meta)=>(typeof noteTagAttrs==='function') ? noteTagAttrs(Object.assign({source:'target_chart', context:ctx, player:notePlayer, team, relevance:'WR,TE,RB,QB'}, meta)) : '';
  const wrap=(html, meta)=>(typeof noteWrapHtml==='function') ? noteWrapHtml(html, Object.assign({source:'target_chart', context:ctx, player:notePlayer, team}, meta), 'note-tag-hit') : html;
  // The QB chart's field: trapezoid rows deep / intermediate / short / behind, +20 / +10 / LOS.
  const W=760, H=600, yTop=60, yBot=560, rowY=[60,176,298,428,560], gap=5;
  const left=(y)=>170 - 130*(y-yTop)/(yBot-yTop);
  const right=(y)=>590 + 130*(y-yTop)/(yBot-yTop);
  const depths=['deep','inter','short','behind'], locs=['left','middle','right'];
  let MAXV=0;
  const heatKey=MET.key||'tgt';
  for(const d of depths) for(const l of locs){ const z=(v.zones[d]||{})[l]; const mv=z?(+z[heatKey]||0):0; if(mv>MAXV) MAXV=mv; }
  const fmt=(x)=> x==null ? '—' : (MET.dp ? (+x).toFixed(MET.dp) : String(Math.round(+x)));
  const pname=(typeof sleeperPlayers!=='undefined' && sleeperPlayers && sleeperPlayers[pid] && sleeperPlayers[pid].name) || norm || 'Receiver';
  const parts=[];
  parts.push(`<svg viewBox="0 0 ${W} ${H}" class="qpc-svg" role="img" aria-label="Target chart">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#101214"/>`);
  parts.push(`<text x="24" y="28" fill="#fff" font-size="20" font-weight="800">${escHtml(String(pname).toUpperCase())} TARGETS <tspan fill="#9aa0a6" font-size="13" font-weight="600">/ ${escHtml(String(v.label).toUpperCase())}</tspan></text>`);
  parts.push(`<text x="24" y="48" fill="#9aa0a6" font-size="12">${MET.key ? MET.short+' by target zone' : 'Catches / targets by zone'} · brighter = more ${MET.key?MET.short.toLowerCase():'targets'}</text>`);
  for(let r=0;r<4;r++){
    const depth=depths[r], y0=rowY[r], y1=rowY[r+1];
    for(let c=0;c<3;c++){
      const loc=locs[c];
      const z=(v.zones[depth]||{})[loc]||null;
      const mv=z ? (+z[heatKey]||0) : null;
      const l0=left(y0), rt0=right(y0), l1=left(y1), rt1=right(y1);
      const w0=(rt0-l0)/3, w1=(rt1-l1)/3;
      const tl=l0+w0*c, tr=l0+w0*(c+1), bl=l1+w1*c, br=l1+w1*(c+1);
      const cx=(tl+tr+bl+br)/4, cy=(y0+y1)/2;
      const pts=`${(tl+gap).toFixed(0)},${y0+gap} ${(tr-gap).toFixed(0)},${y0+gap} ${(br-gap).toFixed(0)},${y1-gap} ${(bl+gap).toFixed(0)},${y1-gap}`;
      const fill=(typeof _qbHeat==='function') ? _qbHeat(mv, MAXV) : '#3a3e44';
      const zoneName=`${depth} ${loc}`;
      const big = !z ? '' : (MET.key ? fmt(mv) : `${z.rec||0} / ${z.tgt||0}`);
      const line2 = !z ? '' : (MET.key ? `${z.rec||0} / ${z.tgt||0}` : `${z.yds||0} yds${z.td?` · ${z.td} TD`:''}`);
      const attrs = z ? tag({label:`${MET.short} (${zoneName})`, value:`${MET.key?fmt(mv)+MET.unit+' · ':''}${z.rec||0}/${z.tgt||0} · ${z.yds||0} yds${z.td?` · ${z.td} TD`:''}`, statKey:`zone_${MET.key||'catch'}`}) : '';
      parts.push(`<g ${attrs}><polygon points="${pts}" fill="${fill}" stroke="#0c0d0f" stroke-width="2"/>`);
      if(z){
        parts.push(`<text x="${cx.toFixed(0)}" y="${(cy-2).toFixed(0)}" fill="#fff" font-size="${MET.key?26:24}" font-weight="800" text-anchor="middle">${big}</text>`);
        parts.push(`<text x="${cx.toFixed(0)}" y="${(cy+16).toFixed(0)}" fill="#141517" font-size="10.5" font-weight="800" opacity="0.8" text-anchor="middle">${line2}</text>`);
      } else {
        parts.push(`<text x="${cx.toFixed(0)}" y="${(cy+5).toFixed(0)}" fill="#6b7178" font-size="14" text-anchor="middle">—</text>`);
      }
      parts.push('</g>');
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
  const metricBtns=Object.entries(TT_METRICS).map(([k,m])=>`<button class="rt-metric-btn ${k===pcardTargetMetric?'active':''}" title="Show ${m.short}" onclick="setPcardTargetMetric('${k}')">${m.short}</button>`).join('');
  const cr=v.tgt ? Math.round((v.rec||0)/v.tgt*100) : null;
  const rk=v.rk||{};
  const tile=(label, val, key, rkKey)=>`<div class="qpc-tile"><label>${label}</label><b>${wrap(escHtml(val), {label, value:String(val), statKey:key})}</b>${(typeof pcardRankTag==='function' && rkKey)?pcardRankTag(rk, rkKey, (pcardState&&pcardState.posc)||node.pos):''}</div>`;
  return `<div class="rt-wrap">
    <div class="rt-head">
      <div class="rt-seasons">${seasonBtns||''}${games?_pcardGameChips('routes', games, selWk, team):''}</div>
    </div>
    <div class="rt-head rt-viewrow">
      <div class="rt-metrics">${viewBtns}</div>
      <div class="rt-summary">${wrap(`${v.tgt||0} targets`, {label:'Targets', value:String(v.tgt||0), statKey:'targets'})}${live?` <span class="tt-badge" title="Where his targets went, from nightly play-by-play. The routes he ran are FTN charting and publish after the season — the map draws them in then.">◉ live</span>`:''}</div>
    </div>
    ${mapOn?'':`<div class="rt-head rt-metricrow"><div class="rt-metrics">${metricBtns}</div></div>`}
    ${mapOn ? targetMapBlock(pname, node, season, selWk, v, tag) : parts.join('')}
    <div class="qpc-totals">
      ${tile('Targets', v.tgt!=null?v.tgt:'—', 'targets', 'tgt')}
      ${tile('Receptions', v.rec!=null?v.rec:'—', 'receptions', 'rec')}
      ${tile('Yards', v.yds!=null?v.yds:'—', 'yards', 'yds')}
      ${tile('TD', v.td!=null?v.td:'—', 'td', 'td')}
      ${tile('YAC', v.yac!=null?v.yac:'—', 'yac', 'yac')}
      ${tile('EPA', v.epa!=null?(+v.epa).toFixed(1):'—', 'epa', 'epa')}
      ${tile('Catch %', cr!=null?`${cr}%`:'—', 'catch_pct')}
    </div>
    ${(typeof _qtrShareSplits==='function') ? _qtrShareSplits(node, selWk, 'Target share by quarter', "· his cut of the team's throws", 'targeted throws') : ''}
    ${(typeof pcardNgsStrip==='function') ? pcardNgsStrip('rec', norm, season, selWk) : ''}
    <div class="pcard-src">Targets via nflverse play-by-play${live?', nightly':''}${(typeof _tmRouteLegend==='function' && _tmRouteLegend(season))?'; routes via nflverse participation charting':''}.${(typeof ngsChartLink==='function') ? ngsChartLink(node, pname, season, selWk) : ''}</div>
  </div>`;
}
// The nflverse blocks are keyed by nflverse's display name, Sleeper by its own — and the two
// disagree on first names ("Joshua Palmer" vs "josh palmer", "Matthew Stafford" vs "matt").
// Resolve a Sleeper player to the name the seed actually uses: the exact normalised name,
// then the same surname under a nickname/full-name alias, then the one player on his team
// with that surname (and position) in the target trees. Falls back to the plain name.
const TC_FIRST_ALIASES=[['joshua','josh'],['matthew','matt'],['michael','mike'],['christopher','chris'],
  ['nathaniel','nate'],['jonathan','jon'],['benjamin','ben'],['william','will'],['joseph','joe'],
  ['zachary','zach'],['samuel','sam'],['daniel','dan'],['alexander','alex'],['anthony','tony'],
  ['kenneth','ken'],['robert','rob'],['cameron','cam'],['nicholas','nick'],['timothy','tim'],
  ['patrick','pat'],['maxwell','max'],['mitchell','mitch'],['gabriel','gabe'],['jacob','jake'],
  ['thomas','tom'],['edward','ed'],['jeffrey','jeff'],['gregory','greg'],['andrew','drew'],
  ['steven','steve'],['stephen','steve'],['james','jimmy'],['charles','charlie'],['richard','rich'],
  ['raymond','ray'],['theodore','theo'],['lawrence','larry'],['ronald','ron'],['donald','don'],
  ['douglas','doug'],['bradley','brad'],['tyler','ty'],['dominic','dom'],['vincent','vince'],
  ['frederick','fred'],['calvin','cal'],['isaiah','zay'],['demario','mario']];
function _tcFirstAliases(first){
  const out=new Set();
  TC_FIRST_ALIASES.forEach(([a,b])=>{ if(first===a) out.add(b); if(first===b) out.add(a); });
  return [...out];
}
// Every name-keyed block a card reads, per season.
function _tcSeedNameBlocks(season){
  const b=(typeof NFLVERSE!=='undefined'&&NFLVERSE&&NFLVERSE[String(season)])||null;
  if(!b) return [];
  return [b.target_trees&&b.target_trees.players, b.routes, b.qb_passing, b.rb_fan].filter(Boolean);
}
function _tcSeedHasName(norm){
  if(typeof NFLVERSE==='undefined'||!NFLVERSE) return false;
  return Object.keys(NFLVERSE).some(s=>_tcSeedNameBlocks(s).some(blk=>!!blk[norm]));
}
const _tcSeedNameMemo={};
function tcSeedNameFor(pid){
  const p=(typeof sleeperPlayers!=='undefined'&&sleeperPlayers&&sleeperPlayers[pid])||{};
  const norm=ecrNormName(p.name||'');
  if(!norm) return norm;
  const ck=`${pid}|${norm}|${p.team||''}`;
  if(_tcSeedNameMemo[ck]&&_tcSeedHasName(_tcSeedNameMemo[ck])) return _tcSeedNameMemo[ck];
  if(_tcSeedHasName(norm)) return norm;
  const sp=norm.indexOf(' ');
  if(sp<0) return norm;
  const first=norm.slice(0,sp), rest=norm.slice(sp+1);
  // 1) Same surname, first name under an alias.
  const alias=_tcFirstAliases(first).map(a=>`${a} ${rest}`).find(_tcSeedHasName);
  if(alias){ _tcSeedNameMemo[ck]=alias; return alias; }
  // 2) One player on his team with that surname (and position) in the target trees.
  const team=String(p.team||'').toUpperCase(), pos=String(p.position||p.pos||'').toUpperCase();
  if(team && typeof NFLVERSE!=='undefined' && NFLVERSE){
    const hits=new Set();
    Object.keys(NFLVERSE).forEach(s=>{
      const blk=NFLVERSE[s]&&NFLVERSE[s].target_trees&&NFLVERSE[s].target_trees.players;
      if(!blk) return;
      Object.keys(blk).forEach(k=>{
        const n=blk[k]||{};
        if(!k.endsWith(' '+rest)) return;
        if(String(n.team||'').toUpperCase()!==team) return;
        if(pos && n.pos && String(n.pos).toUpperCase()!==pos) return;
        hits.add(k);
      });
    });
    if(hits.size===1){ const k=[...hits][0]; _tcSeedNameMemo[ck]=k; return k; }
  }
  return norm;
}
function _pcardNorm(pid){ return tcSeedNameFor(pid); }
// Does the player have any baked route data — true trees OR the live target
// tree? (gates the Routes tab; rookies qualify from their first game).
function pcardRoutesAvailable(pid){
  return pcardRouteSeasons(_pcardNorm(pid)).length>0;
}

// Heat colour for a route by its share of the max route (blue = rare → red = most-run).
function _routeHeat(ratio){
  const hue = Math.round(210 - Math.max(0,Math.min(1,ratio))*198);
  return `hsl(${hue},85%,60%)`;
}

// The SVG route tree for one season's distribution.
function routeTreeSVG(rt, metric, notePlayer){
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
    const metricTag = metricKnown ? _fmtRouteMetricValue(metricV, metric) : '—';
    const noteValue = `${sh.label} · ${pct.toFixed(1)}% · ${n} routes${metricKnown?` · ${metricTag}`:''}`;
    const noteAttrs = noteTagAttrs({
      label:`${sh.label} route tendency`,
      value:noteValue,
      source:'route_tree',
      statKey:metric,
      context:`${pcardRouteSeason} route tree`,
      player:notePlayer,
      team:notePlayer&&notePlayer.team,
      relevance:'WR,TE,RB,QB',
    });
    return {sh,n,pct,ratio,col,w,pts,end,ang,side,metricV,metricTag,noteAttrs};
  });
  // Draw least-run first so the hot routes sit on top; each route ends in an arrowhead.
  let paths='';
  for(const it of items.slice().sort((a,b)=>a.n-b.n)){
    // Arrowhead geometry is derived FROM the stroke width, not from `ratio` independently.
    // Previously a hot route drew a 7.4px-wide line behind a head only ~10px across, so the
    // head stopped reading as a head on exactly the routes that matter most. Keeping a fixed
    // head:line ratio makes every arrow look deliberate at any thickness.
    const [ex,ey]=it.end, a=it.ang;
    const ca=Math.cos(a), sa=Math.sin(a);
    const aW  = Math.max(3.2, it.w*1.55);         // half-width of the head's base
    const aLen= Math.max(7.5, it.w*2.5);          // base → tip
    // Pull the line back so it ENDS UNDER the head's base. The polyline uses a round linecap,
    // which extends half a stroke-width beyond its last point — on a thick route that bulge
    // poked out around (and through) the triangle, which is the "wonky tip" artifact. Ending
    // the line beneath the base hides the cap completely. Clamped to a fraction of the final
    // segment so a short last leg can't invert.
    const prev=it.pts[it.pts.length-2] || it.end;
    const segLen=Math.hypot(ex-prev[0], ey-prev[1]) || 1;
    // The head's base sits exactly here, so this IS the head's length — use aLen directly
    // (a 0.75 factor here left the arrow wider than it was long, which reads as a blob).
    const trim=Math.min(aLen, segLen*0.55);
    const linePts=it.pts.slice();
    linePts[linePts.length-1]=[+(ex-ca*trim).toFixed(2), +(ey-sa*trim).toFixed(2)];
    paths+=`<g${it.noteAttrs}>`;
    paths+=`<polyline points="${linePts.map(p=>p.join(',')).join(' ')}" fill="none" stroke="${it.col}" stroke-width="${it.w}" stroke-linejoin="round" stroke-linecap="round" opacity="0.95"/>`;
    // Base sits at the (trimmed) line end; the tip reaches the route's true endpoint, so the
    // arrow still terminates exactly where the route does.
    const baseX=ex-ca*trim, baseY=ey-sa*trim;
    const tip=[ex, ey];
    const b1=[baseX+Math.cos(a+Math.PI/2)*aW, baseY+Math.sin(a+Math.PI/2)*aW];
    const b2=[baseX+Math.cos(a-Math.PI/2)*aW, baseY+Math.sin(a-Math.PI/2)*aW];
    paths+=`<polygon points="${tip[0].toFixed(1)},${tip[1].toFixed(1)} ${b1[0].toFixed(1)},${b1[1].toFixed(1)} ${b2[0].toFixed(1)},${b2[1].toFixed(1)}" fill="${it.col}" stroke="${it.col}" stroke-width="0.6" stroke-linejoin="round"/>`;
    paths+=`</g>`;
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
        labels+=`<text x="${it.lx}" y="${it.ly.toFixed(1)}" text-anchor="${it.sh.anc}" class="rt-label"${it.noteAttrs}>`+
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
  const notePlayer = pcardNoteTarget();
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
      `<span class="rt-list-n">${noteWrapHtml(String(n), { label:`${label} routes`, value:String(n), source:'route_tree', statKey:'route_count', context:`${pcardRouteSeason} route tree`, player:notePlayer, team:notePlayer&&notePlayer.team }, 'note-tag-hit')}</span><span class="rt-list-pct">${noteWrapHtml(`${pct.toFixed(1)}%`, { label:`${label} route share`, value:`${pct.toFixed(1)}%`, source:'route_tree', statKey:'route_share', context:`${pcardRouteSeason} route tree`, player:notePlayer, team:notePlayer&&notePlayer.team }, 'note-tag-hit')}</span><span class="${metricClass}" title="${metricShort}">${metricTxt==='—'?metricTxt:noteWrapHtml(metricTxt, { label:`${label} ${metricShort}`, value:metricTxt, source:'route_tree', statKey:metric, context:`${pcardRouteSeason} route tree`, player:notePlayer, team:notePlayer&&notePlayer.team }, 'note-tag-hit')}</span></div>`;
  }).join('')+`</div>`;
}

// The full Routes-tab body: season selector + tree + list.
// ── Per-game view (current season) ──────────────────────────────────────────
// The sidecar bakes *_weekly blocks for the season in progress; a game chip
// strip appears under the season buttons and the selected game re-renders the
// SAME chart through a shape adapter, so the renderers never learn about weeks.
let pcardChartGame = {};   // chartKey -> selected wk (null = full season); reset per player
let _pcardChartGameNorm = null;
let _pcardGameCarry=null;   // set by the dock's "open alongside": the next player inherits the selected game
function _pcardGameReset(norm){
  if(_pcardChartGameNorm!==norm){
    pcardChartGame = _pcardGameCarry ? Object.assign({}, _pcardGameCarry) : {};
    _pcardGameCarry=null; _pcardChartGameNorm=norm;
  }
}
// Per-game chart data: the live season's sidecar, and — for the season just played — the
// frozen block the offseason bakes (target and pass maps ride it game by game).
function pcardWeeklyGames(section, norm, season){
  const blk=(typeof NFLVERSE!=='undefined' && NFLVERSE[String(season)] && NFLVERSE[String(season)][section])||null;
  const node=blk && blk[norm];
  return (node && Array.isArray(node.games) && node.games.length) ? node.games : null;
}
// In season a chart opens on the latest game — the map is readable one game at a time
// (a season of dots and lines is a hairball) — and "Season" is a tap away, where the map
// becomes the binned summary. A finished season opens on its summary. `undefined` is
// "not chosen yet"; null is an explicit Season.
// The season chip beside a game picker is the bare year: the picker names the week (the
// "2026 · wk N" form counts completed weeks and lags a Thursday game).
function _pcardSeasonChipText(s, hasPicker){
  return hasPicker ? String(s) : ((typeof tcSeasonLabel==='function') ? tcSeasonLabel(s) : String(s));
}
function _pcardDefaultGame(chartKey, games, season){
  if(pcardChartGame[chartKey]!==undefined || !games || !games.length) return;
  if(typeof tcIsLiveSeason==='function' && tcIsLiveSeason(season)) pcardChartGame[chartKey]=games[games.length-1].wk;
}
// The playoff rounds after week 18, the way nflverse numbers them.
const _PCARD_POST_ROUNDS={19:'WC', 20:'DIV', 21:'CONF', 22:'SB'};
function _pcardGameIsPost(g){ return !!(g && (g.post || g.wk>18)); }
function setPcardChartGame(chartKey, wk){
  pcardChartGame[chartKey] = (wk==='' || wk==null) ? null : Number(wk);
  // Same re-render pattern as the season buttons: paint the owning chart back
  // into the card body (each chart file defines its renderer; call-time is fine
  // across the concatenated bundle).
  const body=document.getElementById('pcardBody');
  if(!body || typeof pcardState==='undefined' || !pcardState) return;
  if(chartKey==='routes') body.innerHTML=renderPcardRoutes(pcardState.pid);
  else if(chartKey==='qbpass') body.innerHTML=renderPcardQbPassing(pcardState.pid);
  else if(chartKey==='rbfan') body.innerHTML=renderPcardRbFan(pcardState.pid);
}
// The game picker: "Season" by default, then "WK 1 @ SEA" with the opponent's logo.
// Home/away comes from the in-season schedule when the chart knows the team.
function _pcardGameLabel(g, team){
  const meta=(typeof TC_INSEASON!=='undefined' && TC_INSEASON && TC_INSEASON.schedule_meta && team
    && TC_INSEASON.schedule_meta[team] && TC_INSEASON.schedule_meta[team][String(g.wk)])||null;
  const home = meta ? !!meta[1] : null;
  const opp = g.opp || (meta && meta[0]) || '';
  const at = home==null ? '' : (home ? 'vs' : '@');
  const wk = _pcardGameIsPost(g) ? (_PCARD_POST_ROUNDS[g.wk]||`WK ${g.wk}`) : `WK ${g.wk}`;
  return {opp, text:`${wk}${opp?` ${at} ${opp}`.replace('  ',' '):''}`};
}
function _pcardGameChips(chartKey, games, selWk, team){
  const logo = o => (o && typeof NFL_LOGO==='function') ? `<img class="rt-gp-logo" src="${NFL_LOGO(o)}" alt="" onerror="this.remove()">` : '';
  const cur = selWk==null ? {text:'Season', opp:''} : _pcardGameLabel(games.find(g=>g.wk===selWk)||{wk:selWk}, team);
  let postHdr=false;
  const opts = [`<div class="rt-gp-opt ${selWk==null?'active':''}" onclick="setPcardChartGame('${chartKey}','')">Season</div>`]
    .concat(games.map(g=>{ const L=_pcardGameLabel(g, team);
      const hdr=(!postHdr && _pcardGameIsPost(g)) ? (postHdr=true, `<div class="rt-gp-hdr">Playoffs</div>`) : '';
      return `${hdr}<div class="rt-gp-opt ${selWk===g.wk?'active':''}" onclick="setPcardChartGame('${chartKey}',${g.wk})">${escHtml(L.text)}${logo(L.opp)}</div>`; }));
  return `<div class="rt-gamepick"><button class="rt-gp-btn" onclick="this.parentNode.classList.toggle('open');event.stopPropagation()">${escHtml(cur.text)}${logo(cur.opp)}<span class="rt-gp-caret">▾</span></button><div class="rt-gp-menu">${opts.join('')}</div></div>`;
}
// One weekly route game → the season-shaped object the renderer already reads.
function _routeGameAsSeason(g){
  const tree={}, rec={}, yds={}, tds={};
  let trec=0, tyds=0, ttds=0;
  for(const r in (g.tree||{})){
    const c=g.tree[r]||{};
    tree[r]=c.tgt||0; rec[r]=c.rec||0; yds[r]=c.yds||0; tds[r]=c.td||0;
    trec+=c.rec||0; tyds+=c.yds||0; ttds+=c.td||0;
  }
  return { tree, route_rec:rec, route_yds:yds, route_tds:tds,
           total:g.total||0, total_rec:trec, total_yds:tyds, total_tds:ttds };
}
function renderPcardRoutes(pid){
  const norm=_pcardNorm(pid);
  const seasons=pcardRouteSeasons(norm);
  if(!seasons.length) return `<div class="pcard-loading">No route data for this player.</div>`;
  if(pcardRouteSeason==null || !seasons.includes(String(pcardRouteSeason))) pcardRouteSeason=seasons[0];
  _pcardGameReset(norm);
  // The target map is the Routes tab's first view wherever a season has one (the live
  // season's sidecar; the offseason bakes the season just played). The charted route
  // tree stays a view beside it — and the only view for older seasons.
  const _seasonBlk=NFLVERSE[pcardRouteSeason]||{};
  const _hasTree=!!(_seasonBlk.routes && _seasonBlk.routes[norm]);
  const _tn=_pcardTargetNode(norm, pcardRouteSeason);
  if(_tn && !(_hasTree && pcardTargetView==='tree')){
    const seasonBtns0=seasons.map(s=>`<button class="rt-season-btn ${String(s)===String(pcardRouteSeason)?'active':''}" onclick="setPcardRouteSeason('${s}')">${_pcardSeasonChipText(s, !!(_tn.games||[]).length)}</button>`).join('');
    return _renderTargetTree(pid, _tn, pcardRouteSeason, seasonBtns0, _hasTree);
  }
  if(!_hasTree) return `<div class="pcard-loading">No route data for this season.</div>`;
  const _games=pcardWeeklyGames('routes_weekly', norm, pcardRouteSeason);
  _pcardDefaultGame('routes', _games, pcardRouteSeason);
  const _selWk=_games ? (pcardChartGame.routes!=null?pcardChartGame.routes:null) : null;
  const _game=_games && _selWk!=null ? _games.find(g=>g.wk===_selWk) : null;
  const rt=_game ? _routeGameAsSeason(_game) : NFLVERSE[pcardRouteSeason].routes[norm];
  if(!ROUTE_TREE_METRICS[pcardRouteMetric]) pcardRouteMetric='td';
  const seasonBtns=seasons.map(s=>`<button class="rt-season-btn ${String(s)===String(pcardRouteSeason)?'active':''}" onclick="setPcardRouteSeason('${s}')">${_pcardSeasonChipText(s, !!_games)}</button>`).join('')
    + (_games ? _pcardGameChips('routes', _games, _selWk) : '');
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
  const notePlayer = noteTargetFromArgs(pid, pcardState&&pcardState.posc, pcardState&&pcardState.team);
  const _treeSummary=`<div class="rt-summary">${noteWrapHtml(`${rt.total} routes charted`, { label:'Routes Charted', value:String(rt.total), source:'route_tree', statKey:'routes', context:`${pcardRouteSeason} route tree`, player:notePlayer, team:notePlayer&&notePlayer.team }, 'note-tag-hit')} · ${metricKnown?noteWrapHtml(metricSummary, { label:metricCfg.label, value:_fmtRouteMetricValue(metricTotal, pcardRouteMetric), source:'route_tree', statKey:pcardRouteMetric, context:`${pcardRouteSeason} route tree`, player:notePlayer, team:notePlayer&&notePlayer.team }, 'note-tag-hit'):metricSummary} · most-run <b>${noteWrapHtml(escHtml(topLabel), { label:'Most-run route', value:topLabel, source:'route_tree', statKey:'top_route', context:`${pcardRouteSeason} route tree`, player:notePlayer, team:notePlayer&&notePlayer.team }, 'note-tag-hit')}</b></div>`;
  return `
    <div class="rt-wrap">
      <div class="rt-head">
        <div class="rt-seasons">${seasonBtns}</div>
        ${_tn?'':`<div class="rt-metrics">${metricBtns}</div>`}
        ${_tn?'':_treeSummary}
      </div>
      ${_tn?`<div class="rt-head rt-viewrow"><div class="rt-metrics">${_pcardRouteViewBtns('tree', true, !!(_games && _selWk!=null))}</div>${_treeSummary}</div><div class="rt-head rt-metricrow"><div class="rt-metrics">${metricBtns}</div></div>`:''}
      ${routeTreeSVG(rt, pcardRouteMetric, notePlayer)}
      ${routeTreeList(rt, pcardRouteMetric)}
      <div class="pcard-src">Route types via nflverse participation charting (route run when targeted, ${typeof tcSeasonLabel==='function'?tcSeasonLabel(pcardRouteSeason):pcardRouteSeason} ${(typeof tcIsLiveSeason==='function'&&tcIsLiveSeason(pcardRouteSeason))?'season to date, rebuilt weekly':'regular season'}).</div>
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
