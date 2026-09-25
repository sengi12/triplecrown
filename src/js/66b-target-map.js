// ── Target map (Routes tab · the default view of a receiver's targets) ──────
// Every target is a dot at its depth (air yards) and side of the field (pass
// location); a caught ball grows a green tail as long as its yards after the
// catch; a touchdown gets the ring and the TD tag, a pick the red cross. It is
// the in-season cousin of Next Gen Stats' route chart: NGS draws the route from
// player tracking (not public); nightly play-by-play knows where every ball went,
// so that is what we draw. Once a season's charting labels arrive (the post-season
// participation drop) each target also gets its route, drawn as the route tree's
// schematic shape scaled from the line of scrimmage to the catch point — so a
// finished season shows the route leading up to every catch.
// Rows: NFLVERSE[season].target_trees.players[norm].games[i].plays
//   = [[air_yards, side 0 L/1 M/2 R, result 0 inc/1 catch/2 TD/3 INT, yac, yardline_100, qtr, route?,
//       formation, out_of_pocket, out_of_bounds], …]
//   route = index into NFLVERSE[season].target_trees.routes (present only when charted).
let pcardTargetView = 'map';   // 'map' (default) | 'zones' | 'tree' (seasons with a charted route tree)
function setPcardTargetView(v){
  if(v!=='map' && v!=='zones' && v!=='tree') return;
  pcardTargetView=v;
  const body=document.getElementById('pcardBody');
  if(body && typeof pcardState!=='undefined' && pcardState) body.innerHTML=renderPcardRoutes(pcardState.pid);
}
function _tmRouteLegend(season){
  const blk=(typeof NFLVERSE!=='undefined' && NFLVERSE && NFLVERSE[String(season)] && NFLVERSE[String(season)].target_trees)||null;
  return (blk && Array.isArray(blk.routes) && blk.routes.length) ? blk.routes : null;
}
// The targets for the chart's selected game, or every game to date (in play order).
function _tmPlays(node, selWk, legend){
  const out=[];
  for(const g of (node.games||[])){
    if(selWk!=null ? g.wk!==Number(selWk) : _tmIsPost(g)) continue;
    for(const p of (g.plays||[])){
      const ri=(p.length>6 && p[6]!=null) ? +p[6] : null;
      out.push({wk:g.wk, opp:g.opp||'', ay:Math.round(+p[0]||0), side:(p[1]==null?1:+p[1]), res:+p[2]||0,
                yac:Math.round(+p[3]||0), yl:(p[4]==null?null:+p[4]), q:(p[5]==null?null:+p[5]),
                route:(legend && ri!=null && legend[ri]) ? String(legend[ri]) : null,
                sg:(p.length>7 && p[7]!=null)?+p[7]:null, oop:(p.length>8 && p[8]!=null)?+p[8]:null,
                ob:(p.length>9 && p[9]!=null)?!!+p[9]:false});
    }
  }
  return out;
}
// A playoff game (the builder flags it; older sidecars only have the week number).
function _tmIsPost(g){ return !!(g && (g.post || g.wk>18)); }
// Does the sidecar carry per-target rows for this player at all? (older bakes don't)
function _tmHasPlays(node){ return (node.games||[]).some(g=>Array.isArray(g.plays) && g.plays.length); }
// Volume share by quarter (Q1–Q4): a player's slice of his team's opportunities in each
// quarter, from per-game qc (his carries/targets) and qt (the team's), summed across the
// scope in view — the picked game, else the regular season. Blank until the quarter data
// ships with the map. Shared by the carry map (68) and the target map (66).
function _qtrShareSplits(node, selWk, heading, sub, noun, unit){
  if(!node || !Array.isArray(node.games)) return '';
  const pl=[0,0,0,0], tm=[0,0,0,0], cp=[0,0,0,0]; let any=false, hasComp=false;
  for(const g of node.games){
    if(selWk!=null ? g.wk!==Number(selWk) : !!(g.post || g.wk>18)) continue;
    if(!Array.isArray(g.qc) || !Array.isArray(g.qt)) continue;
    any=true;
    for(let q=0;q<4;q++){ pl[q]+=(+g.qc[q]||0); tm[q]+=(+g.qt[q]||0); }
    if(Array.isArray(g.qk)){ hasComp=true; for(let q=0;q<4;q++) cp[q]+=(+g.qk[q]||0); }
  }
  if(!any) return '';
  // the marker's tint = the share of that quarter's team opportunities that came with the game
  // still in reach (garbage time reads red, a live game green — weight the greener quarters)
  const compCls=(q)=>{ if(!hasComp || !tm[q]) return ''; const f=cp[q]/tm[q];
    return f>=0.75?'qk-hi':f>=0.5?'qk-md':f>=0.25?'qk-lo':'qk-gt'; };
  const compTip=(q)=>(hasComp && tm[q]) ? ` \u00b7 ${Math.round(cp[q]/tm[q]*100)}% with the game within reach` : '';
  const tiles=[0,1,2,3].map(q=>{
    const share = tm[q] ? Math.round(pl[q]/tm[q]*100) : null, cc=compCls(q);
    return `<div class="qpc-tile" title="${pl[q]} of the team's ${tm[q]} ${noun} in Q${q+1}${compTip(q)}"><label${cc?` class="${cc}"`:''}>Q${q+1}</label><b>${share==null?'—':share+'%'}<span class="qpc-ct">${pl[q]} ${escHtml(unit||'')}</span></b></div>`;
  }).join('');
  const legend = hasComp ? `<span class="qpc-legend-c" title="The quarter label is tinted by how competitive the game was while those chances came — green in a game still in reach, red in garbage time. Lean on the greener quarters when you read a player's role going forward."> \u00b7 <i class="qk-hi"></i>competitive <i class="qk-gt"></i>garbage</span>` : '';
  return `<div class="qpc-sub">${heading} <span>${sub}${legend}</span></div><div class="qpc-totals rbf-splits">${tiles}</div>`;
}
const _TM_SIDES=['Left','Middle','Right'];
const _TM_RES=['Incomplete','Catch','Touchdown','Intercepted'];
function _tmRouteLabel(route){
  const key=(typeof ROUTE_TREE_ALIASES!=='undefined' && ROUTE_TREE_ALIASES[route])||route;
  const shp=(typeof ROUTE_TREE_SHAPES!=='undefined') ? ROUTE_TREE_SHAPES[key] : null;
  return shp ? shp.label : String(route).toLowerCase().replace(/\b\w/g, c=>c.toUpperCase());
}
// The charted route as a path from the receiver's release to the catch point: the route
// tree's schematic waypoints, mapped so the shape's start sits on the line of scrimmage
// (a backfield release starts behind it) and its end lands on the target. Lateral breaks
// keep their yardage; a left-side target mirrors the shape (the tree draws inward as left).
function _tmRoutePath(route, side, x0, losY, x1, y1, pxPerYd){
  const key=(typeof ROUTE_TREE_ALIASES!=='undefined' && ROUTE_TREE_ALIASES[route])||route;
  const shp=(typeof ROUTE_TREE_SHAPES!=='undefined') ? ROUTE_TREE_SHAPES[key] : null;
  if(!shp || !Array.isArray(shp.p) || shp.p.length<2) return null;
  const pts=shp.p, S=pts[0], E=pts[pts.length-1];
  const mirror = side===0 ? -1 : 1;
  const ey=E[1]-S[1], ex=E[0]-S[0];
  const sx=x0, sy=losY - S[1]*pxPerYd;
  const out=[];
  for(const [px,py] of pts){
    const u = Math.abs(ey)>0.05 ? (py-S[1])/ey : 0;
    const bx=sx+(x1-sx)*u, by=sy+(y1-sy)*u;
    const lat=(px-S[0]) - ex*u;
    out.push([bx+mirror*lat*pxPerYd, by]);
  }
  out[out.length-1]=[x1,y1];
  return 'M'+out.map(p=>`${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L');
}
// The run after the catch, the way NGS draws it: nobody runs a straight line. From the catch
// the path leans, settles and finishes on the spot the play ended — a seeded drift (the same
// generator the carry map uses, so a map never moves under the pointer), with the wobble in
// the first two thirds and the last stretch straight-ish, because that is where he is running
// away or being brought down. A run that ended out of bounds leans toward that sideline the
// whole way instead of turning for it at the end.
// One play, one seed. The same throw is drawn twice — once in the receiver's target map,
// once in the passer's pass map — and the two lists it sits in are different lengths, so
// anything decided by chance has to come from the play's own numbers (identical in both
// sidecars) and never from where it happens to fall in a list: the after-catch wobble, the
// stem's lean, and which boundary an out-of-bounds catch runs out to. Seeding from the
// list index made one catch leave by the left sideline on the receiver's chart and the
// right one on the passer's. It also keeps a play drawn the same when the week picker
// changes what else is on the chart.
function _tmPlaySeed(p){
  return ((p.wk||0)*7919 + (p.ay+60)*104729 + (p.yac+60)*1301
        + ((p.yl==null?99:p.yl)+1)*31 + (p.q||0)*17 + (p.side+1)*5 + (p.res+1)*3) >>> 0;
}
function _tmYacPath(x1, y1, x2, y2, seed, obSide){
  const dx=x2-x1, dy=y2-y1, len=Math.hypot(dx,dy);
  const f=v=>(+v).toFixed(1);
  if(len<14) return `M${f(x1)},${f(y1)} L${f(x2)},${f(y2)}`;   // a yard or two: nothing to draw
  const rnd=_cmRand(seed), j=a=>(rnd()-0.5)*2*a;
  // unit vectors along the run and across it
  const ux=dx/len, uy=dy/len, nx=-uy, ny=ux;
  const lean=(obSide ? obSide*Math.min(18, len*0.16) : 0) + j(Math.min(14, len*0.13));
  const pts=[[x1,y1]];
  // one bend a third of the way, a softer counter-bend two thirds along on a long run
  const at=(t,off)=>[x1+dx*t+nx*off, y1+dy*t+ny*off];
  pts.push(at(0.34+j(0.05), lean));
  if(len>90) pts.push(at(0.66+j(0.04), lean*(obSide?0.72:-0.42)+j(5)));
  pts.push(at(0.86, lean*0.22));
  pts.push([x2,y2]);
  return _cmSmooth(pts);
}
function targetMapSVG(plays, title, sub, tag){
  // Same canvas and perspective as the zone chart, so the two views swap in place.
  const W=760, H=600, yTop=60, yBot=560, YMAX=40, YMIN=-10;
  const yOf = yd => yBot - (Math.max(YMIN, Math.min(YMAX, yd)) - YMIN) * (yBot-yTop)/(YMAX-YMIN);
  const left = y => 170 - 130*(y-yTop)/(yBot-yTop);
  const right= y => 590 + 130*(y-yTop)/(yBot-yTop);
  const laneX=(y, side, frac)=>{ const lw=(right(y)-left(y))/3; return left(y)+lw*(side+0.5)+frac*lw*0.72; };
  const losY=yOf(0);
  const pxPerYd=(right(losY)-left(losY))/53.3;
  const f1=x=>(+x).toFixed(1);
  const parts=[];
  parts.push(`<svg viewBox="0 0 ${W} ${H}" class="qpc-svg" role="img" aria-label="Target map">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#101214"/>`);
  parts.push(`<text x="24" y="28" fill="#fff" font-size="20" font-weight="800">${title}</text>`);
  parts.push(`<text x="24" y="48" fill="#9aa0a6" font-size="12">${sub}</text>`);
  parts.push(`<polygon points="${f1(left(yTop))},${yTop} ${f1(right(yTop))},${yTop} ${f1(right(yBot))},${yBot} ${f1(left(yBot))},${yBot}" fill="#22262c" stroke="#0c0d0f" stroke-width="2"/>`);
  for(let yd=YMIN+5; yd<=YMAX-5; yd+=5){
    if(yd===0) continue;
    const y=yOf(yd), major=(yd%10===0);
    parts.push(`<line x1="${f1(left(y))}" y1="${f1(y)}" x2="${f1(right(y))}" y2="${f1(y)}" stroke="${major?'#4c525b':'#353a42'}" stroke-width="${major?1.5:1}"/>`);
    if(major){
      const lab=(yd>0?'+':'')+yd;
      parts.push(`<text x="${f1(left(y)-12)}" y="${f1(y+4)}" fill="#c8ccd2" font-size="12" text-anchor="end">${lab}</text>`);
      parts.push(`<text x="${f1(right(y)+12)}" y="${f1(y+4)}" fill="#c8ccd2" font-size="12">${lab}</text>`);
    }
  }
  // Hash marks: the field's own texture, and the three throw lanes read against them.
  for(const fr of [1/3, 2/3]){
    parts.push(`<line x1="${f1(left(yTop)+(right(yTop)-left(yTop))*fr)}" y1="${yTop}" x2="${f1(left(yBot)+(right(yBot)-left(yBot))*fr)}" y2="${yBot}" stroke="#353a42" stroke-width="1" stroke-dasharray="2 6"/>`);
  }
  parts.push(`<line x1="${f1(left(losY)-30)}" y1="${f1(losY)}" x2="${f1(right(losY)+30)}" y2="${f1(losY)}" stroke="#2f6fe4" stroke-width="4"/>`);
  parts.push(`<text x="${f1(left(losY)-36)}" y="${f1(losY+4)}" fill="#fff" font-size="12" font-weight="800" text-anchor="end">LOS</text>`);
  parts.push(`<text x="${f1(right(losY)+36)}" y="${f1(losY+4)}" fill="#fff" font-size="12" font-weight="800">LOS</text>`);
  if(!plays.length){
    parts.push(`<text x="${W/2}" y="${(yTop+yBot)/2}" fill="#9aa0a6" font-size="16" text-anchor="middle">No targets</text></svg>`);
    return parts.join('');
  }
  const labels=[];   // the tags beside marks (TD, +N off the top): laid out last so none overlap
  // Marks: least eventful underneath (incompletions), catches, then scores on top.
  const order=plays.map((p,i)=>i).sort((a,b)=>{ const w=r=>(r===2?3:(r===1?2:(r===3?1:0))); return w(plays[a].res)-w(plays[b].res); });
  // A season's worth of targets is a hairball if every route is drawn at game weight:
  // thinner and fainter lines let the dots and scores stay readable over them.
  const many=plays.length>30, r0=many?6:7, tailW=many?4:5, routeW=many?1.8:3.2, routeOp=many?0.5:0.92;
  const laneN=[0,0,0], PHI=0.618033988749895, fracOf={};
  for(let i=0;i<plays.length;i++){ const s=plays[i].side; fracOf[i]=((laneN[s]++)*PHI+0.5)%1-0.5; }   // first in a lane sits on its centre
  for(const i of order){
    const p=plays[i], frac=fracOf[i], seed=_tmPlaySeed(p);
    const caught=(p.res===1||p.res===2);
    const y1=yOf(p.ay), x1=laneX(y1, p.side, frac);
    const x0=laneX(losY, p.side, frac);
    const endYd = caught ? p.ay+p.yac : p.ay;
    const endCap = (p.yl!=null) ? Math.min(endYd, p.yl) : endYd;     // the goal line ends every tail
    const y2=yOf(endCap);
    // A catch that ended out of bounds finishes ON the sideline, the way the carry map draws
    // a run that was pushed out: play-by-play flags the play, and the side it was thrown to
    // says which boundary. A ball charted down the middle is the one case the data cannot
    // answer — pbp buckets location into left/middle/right and carries no coordinate — so
    // the play's own seed calls it, which is a guess but the same guess on every chart.
    const obSide = (caught && p.ob) ? (p.side===0 ? -1 : (p.side===2 ? 1 : ((seed&1) ? -1 : 1))) : 0;
    const x2 = obSide ? (obSide<0 ? left(y2)+3 : right(y2)-3) : laneX(y2, p.side, frac);
    const col = caught ? '#ffffff' : (p.res===3 ? '#d33b2f' : '#9aa0a6');
    const tip=`WK ${p.wk}${p.opp?' · '+p.opp:''}${p.q?` · Q${p.q}`:''} · ${_TM_SIDES[p.side]||'Middle'}, ${p.ay>=0?'+':''}${p.ay} air${p.route?` · ${_tmRouteLabel(p.route)}`:''} · ${_TM_RES[p.res]||'Target'}${p.to?` → ${p.to}`:''}${caught?` · ${p.yac} YAC (${p.ay+p.yac} yds)`:''}${(caught&&p.ob)?' · out of bounds':''}${p.oop===1?' · out of the pocket':''}`;
    const attrs=tag?tag({label:`Target · WK ${p.wk}`, value:tip, statKey:'target'}):'';
    parts.push(`<g ${attrs}><title>${escHtml(tip)}</title>`);
    const routeD = p.route ? _tmRoutePath(p.route, p.side, x0, losY, x1, y1, pxPerYd) : null;
    // Only a CHARTED route is drawn. An uncharted target used to get a faint dotted stem from
    // the line of scrimmage to the mark, which drew a line we do not have: the route is unknown,
    // and the stem said nothing the mark had not already said while adding clutter to a chart
    // that is a hairball at a season's worth of targets. The mark alone now.
    if(routeD) parts.push(`<path d="${routeD}" fill="none" stroke="${col}" stroke-width="${routeW}" stroke-linejoin="round" stroke-linecap="round" opacity="${caught?routeOp:routeOp*0.75}"/>`);
    if(p.res===2){
      // The scoring throw, drawn NGS-style: the ball leaves the passer's spot and comes
      // down onto the recorded catch point — a lob whose height grows with the distance.
      // The spot is what the data knows: centred behind the line, a touch deeper from
      // shotgun (FTN's formation, pbp's flag before FTN lands), and pulled toward the
      // side he threw to when FTN charted him out of the pocket. Not tracked.
      const fw=right(losY)-left(losY);
      const qx=(left(losY)+right(losY))/2 + (p.oop===1 ? (x1<W/2?-1:1)*fw*0.22 : 0);
      const qy=yOf(p.sg===1 ? -6.5 : (p.sg===2 ? -6 : -5.5));
      // One clean arc from the passer's spot to the catch dot, NGS-style: a quadratic whose
      // control sits at the chord's midpoint pushed out PERPENDICULAR to the throw — so the
      // curve bows to one side and lands on the dot, never hooking past it (a control lifted
      // straight up hooks a deep, near-vertical throw). The bow grows with the distance; it
      // bows upfield where the throw has a sideways component, toward the nearer sideline
      // on a straight-downfield throw, and the control is kept inside the field so the
      // crown (¼·start + ½·control + ¼·end) stays in the drawing.
      const vx=x1-qx, vy=y1-qy, dist=Math.hypot(vx,vy)||1;
      const bulge=Math.min(130, Math.max(34, dist*0.38));
      let nx=-vy/dist, ny=vx/dist;                       // one unit normal…
      if(ny>0.02 || (Math.abs(ny)<=0.02 && (x1>=W/2 ? nx<0 : nx>0))){ nx=-nx; ny=-ny; }   // …flipped so it points upfield (or out to the near sideline)
      let cx=(qx+x1)/2+nx*bulge, cy=(qy+y1)/2+ny*bulge;
      cy=Math.max(cy, 2*(yTop+10)-0.5*(qy+y1));
      cx=Math.min(Math.max(cx, left(cy)+4), right(cy)-4);
      parts.push(`<path d="M${f1(qx)},${f1(qy)} Q${f1(cx)},${f1(cy)} ${f1(x1)},${f1(y1)}" fill="none" stroke="#2f6fe4" stroke-width="${many?3:4}" stroke-linecap="round" opacity="0.9"/>`);
    }
    if(caught && p.yac>0){
      const yacSeed=(seed^0x9e3779b9)>>>0;
      parts.push(`<path d="${_tmYacPath(x1, y1, x2, y2, yacSeed, obSide)}" fill="none" stroke="#39c15a" stroke-width="${tailW}" stroke-linecap="round" stroke-linejoin="round"/>`);
      parts.push(`<circle cx="${f1(x2)}" cy="${f1(y2)}" r="${r0-3}" fill="#39c15a"/>`);
      if(endYd>YMAX && p.res!==2) labels.push({x:x2+16, y:y2+4, mx:x2, my:y2, text:`+${endYd}`, fill:'#39c15a', td:false});
    }
    if(p.res===2){
      // The score, said twice: the ring at the end of the play and the tag beside it (a
      // play that runs off the top of the drawing carries its total in the same tag).
      parts.push(`<circle cx="${f1(x2)}" cy="${f1(y2)}" r="${r0+5}" fill="none" stroke="#2f6fe4" stroke-width="3.5"/>`);
      labels.push({x:x2+r0+9, y:y2+4.5, mx:x2, my:y2, text:`TD${endYd>YMAX?` +${endYd}`:''}`, fill:'#ffffff', td:true});
    }
    if(caught) parts.push(`<circle cx="${f1(x1)}" cy="${f1(y1)}" r="${r0}" fill="#ffffff" stroke="#101214" stroke-width="1.5"/>`);
    else if(p.res===3){
      parts.push(`<circle cx="${f1(x1)}" cy="${f1(y1)}" r="${r0}" fill="#101214" stroke="#d33b2f" stroke-width="2.5"/>`);
      parts.push(`<path d="M${f1(x1-3)},${f1(y1-3)} L${f1(x1+3)},${f1(y1+3)} M${f1(x1+3)},${f1(y1-3)} L${f1(x1-3)},${f1(y1+3)}" stroke="#d33b2f" stroke-width="2"/>`);
    } else parts.push(`<circle cx="${f1(x1)}" cy="${f1(y1)}" r="${r0}" fill="#101214" stroke="#9aa0a6" stroke-width="2.5"/>`);
    // a ball that runs off the top with nothing after the catch (or no catch) is tagged at its dot
    if(p.res!==2 && p.ay>YMAX && !(caught && p.yac>0)) labels.push({x:x1+12, y:y1+4, mx:x1, my:y1, text:`+${p.ay}`, fill:caught?'#ffffff':'#9aa0a6', td:false});
    parts.push('</g>');
  }
  parts.push(_tmLayoutLabels(labels));
  parts.push('</svg>');
  return parts.join('');
}
// Tags beside marks, placed so they never sit on each other: left to right, a tag that
// would overlap one already placed steps down a line (the deep balls that all run off the
// top of the drawing land in a tidy column instead of a pile).
function _tmLayoutLabels(labels){
  const f1=x=>(+x).toFixed(1);
  // every tagged mark is an obstacle too, so a tag never rides a neighbour's ring
  const placed=labels.map(L=>({x:L.mx-13, w:26, y:L.my+13, h:26, own:L})), out=[];
  labels.sort((a,b)=>a.x-b.x || a.y-b.y);
  for(const L of labels){
    const w=L.text.length*(L.td?7.6:6.6)+4, h=13;
    let y=L.y, guard=0;
    const hits=()=>placed.some(b=>b.own!==L && !(L.x+w<b.x || L.x>b.x+b.w || y-h>b.y || y<b.y-b.h));
    while(hits() && guard++<12) y+=14;
    placed.push({x:L.x, w, y, h});
    out.push(L.td
      ? `<text class="tm-td" x="${f1(L.x)}" y="${f1(y)}" fill="${L.fill}" stroke="#101214" stroke-width="3.5" paint-order="stroke" font-size="12" font-weight="900" letter-spacing=".04em">${L.text}</text>`
      : `<text x="${f1(L.x)}" y="${f1(y)}" fill="${L.fill}" stroke="#101214" stroke-width="3" paint-order="stroke" font-size="11" font-weight="800">${L.text}</text>`);
  }
  return out.join('');
}
function targetMapLegend(charted, kind){
  return `<div class="tm-legend">
    ${charted?`<span><i class="tm-l-route"></i>Charted route</span>`:''}
    <span><i class="tm-l-inc"></i>Incomplete</span><span><i class="tm-l-catch"></i>${kind==='qb'?'Complete':'Catch'}</span>
    <span><i class="tm-l-yac"></i>After catch</span><span><i class="tm-l-arc"></i>Scoring throw</span><span><i class="tm-l-td"></i>Touchdown</span>
    <span><i class="tm-l-int"></i>Interception</span><span><i class="tm-l-los"></i>Line of scrimmage</span>
  </div>`;
}
// The whole map block for the Routes tab: SVG + legend. `v` is the view the zone
// chart already computed (label, totals) so the header reads the same in both.
function targetMapBlock(pname, node, season, selWk, v, tag){
  if(!_tmHasPlays(node)) return `<div class="pcard-loading">Per-target rows arrive with the next weekly bake.</div>`;
  const legend=_tmRouteLegend(season);
  const plays=_tmPlays(node, selWk, legend);
  const charted=plays.some(p=>p.route);
  const title=`${escHtml(String(pname).toUpperCase())} TARGETS <tspan fill="#9aa0a6" font-size="13" font-weight="600">/ ${escHtml(String(v.label).toUpperCase())}</tspan>`;
  const sub= charted
    ? `Every target with the route he ran · green = after the catch · ring + TD = touchdown`
    : `Every target by depth and side · green = after the catch · ring + TD = touchdown · routes come with the charting`;
  return targetMapSVG(plays, title, sub, tag) + targetMapLegend(charted);
}
// ── The QB's pass map: the same field, every located attempt, the receiver on the mark ──
// Rows: NFLVERSE[season].qb_passing_weekly[norm].games[i].plays
//   = [[air_yards, side, result 0 inc/1 comp/2 TD/3 INT, yac, yardline_100, qtr, receiver], …]
//   receiver = index into the node's `rcv` legend (pbp's short names).
function _qbMapPlays(node, selWk){
  const out=[], rcv=Array.isArray(node.rcv)?node.rcv:[];
  for(const g of (node.games||[])){
    if(selWk!=null ? g.wk!==Number(selWk) : _tmIsPost(g)) continue;
    for(const p of (g.plays||[])){
      const ri=(p.length>6 && p[6]!=null) ? +p[6] : null;
      out.push({wk:g.wk, opp:g.opp||'', ay:Math.round(+p[0]||0), side:(p[1]==null?1:+p[1]), res:+p[2]||0,
                yac:Math.round(+p[3]||0), yl:(p[4]==null?null:+p[4]), q:(p[5]==null?null:+p[5]),
                route:null, to:(ri!=null && rcv[ri]) ? String(rcv[ri]) : null,
                sg:(p.length>7 && p[7]!=null)?+p[7]:null, oop:(p.length>8 && p[8]!=null)?+p[8]:null,
                ob:(p.length>9 && p[9]!=null)?!!+p[9]:false});
    }
  }
  return out;
}
function qbPassMapBlock(pname, node, season, selWk, label, tag){
  if(!_tmHasPlays(node)) return `<div class="pcard-loading">Per-attempt rows arrive with the next weekly bake.</div>`;
  const plays=_qbMapPlays(node, selWk);
  const title=`${escHtml(String(pname).toUpperCase())} PASSES <tspan fill="#9aa0a6" font-size="13" font-weight="600">/ ${escHtml(String(label).toUpperCase())}</tspan>`;
  const sub=`Every located attempt at its depth and side · hover for the receiver · green = after the catch · ring + TD = touchdown`;
  return targetMapSVG(plays, title, sub, tag) + targetMapLegend(false, 'qb');
}
// The real thing, one tap away: NGS keys its chart pages by the player's ESB id
// (nflverse rosters carry it). Season → every chart that season; a game → that week.
function ngsChartUrl(node, name, season, selWk){
  if(!node || !node.esb) return '';
  const slug=String(name||'').toLowerCase().replace(/['’.]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'player';
  return `https://nextgenstats.nfl.com/charts/single/all/team/${season}/${selWk!=null?selWk:'week'}/${slug}/${encodeURIComponent(node.esb)}`;
}
function ngsChartLink(node, name, season, selWk){
  const u=ngsChartUrl(node, name, season, selWk);
  return u ? `<a class="tm-ngs-link" href="${u}" target="_blank" rel="noopener" title="Open this player's Next Gen Stats charts (route charts from player tracking) in a new tab">Next Gen Stats charts ↗</a>` : '';
}

