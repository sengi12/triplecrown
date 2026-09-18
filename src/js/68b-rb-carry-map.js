// ── Carry map (rushing fan · the per-carry view) ────────────────────────────
// Every carry drawn up its lane from the line of scrimmage, as long as the run:
// red when it lost yards, gold for 0–4, green for 5+; the ring + TD tag on a score,
// the red ring + FUM tag on a fumble lost, a white cap on a first down. The
// cousin of NGS's carry chart — NGS draws the runner's actual path from tracking
// (not public); play-by-play knows the gap he hit and where the run ended, so
// that is what we draw. Same field as the target and pass maps (66b).
// Rows: NFLVERSE[season].rb_fan_weekly[norm].games[i].plays
//   = [[lane 0-6 (LE LT LG MID RG RT RE), yards, flags 1 TD / 2 fumble lost / 4 first down / 8 TFL / 16 out of bounds (+32 right sideline, +64 left), yardline_100, qtr], …]
let pcardRbView = 'map';   // 'map' (default) | 'fan'
function setPcardRbView(v){
  if(v!=='map' && v!=='fan') return;
  pcardRbView=v;
  const body=document.getElementById('pcardBody');
  if(body && typeof pcardState!=='undefined' && pcardState) body.innerHTML=renderPcardRbFan(pcardState.pid);
}
const _CM_LANE_NAMES=['Left end','Left tackle','Left guard','Middle','Right guard','Right tackle','Right end'];
function _rbMapPlays(node, selWk){
  const out=[];
  for(const g of (node.games||[])){
    if(selWk!=null ? g.wk!==Number(selWk) : !!(g.post || g.wk>18)) continue;   // the season is the regular season
    for(const p of (g.plays||[])){
      const f=+p[2]||0;
      out.push({wk:g.wk, opp:g.opp||'', lane:Math.max(0,Math.min(6,+p[0]||0)), yds:Math.round(+p[1]||0),
                td:!!(f&1), fum:!!(f&2), fd:!!(f&4), tfl:!!(f&8), yl:(p[3]==null?null:+p[3]), q:(p[4]==null?null:+p[4]),
                ob:(f&16) ? ((f&32)?1:((f&64)?-1:0)) : null});   // out of bounds: +1 right sideline, -1 left, 0 the play didn't say
    }
  }
  return out;
}
function _cmColor(yds){ return yds<0 ? '#d33b2f' : (yds<5 ? '#d8a51d' : '#39c15a'); }
// A seeded generator (mulberry32): the wobble on a run is the same on every render, so
// nothing flickers or moves under the pointer — it is drawn, not tracked, and says so.
function _cmRand(seed){ let t=(seed>>>0)||1; return ()=>{ t+=0x6D2B79F5; let r=Math.imul(t^(t>>>15), 1|t); r^=r+Math.imul(r^(r>>>7), 61|r); return ((r^(r>>>14))>>>0)/4294967296; }; }
// A smooth path through the points (Catmull-Rom → cubic Béziers).
function _cmSmooth(pts){
  const f=v=>(+v).toFixed(1);
  if(pts.length<2) return '';
  let d=`M${f(pts[0][0])},${f(pts[0][1])}`;
  for(let i=0;i<pts.length-1;i++){
    const p0=pts[Math.max(0,i-1)], p1=pts[i], p2=pts[i+1], p3=pts[Math.min(pts.length-1,i+2)];
    d+=` C${f(p1[0]+(p2[0]-p0[0])/6)},${f(p1[1]+(p2[1]-p0[1])/6)} ${f(p2[0]-(p3[0]-p1[0])/6)},${f(p2[1]-(p3[1]-p1[1])/6)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}
// The run as a person might have run it: a start in the backfield that varies a little,
// a sweep to the gap, then a drifting line up the field that still ends exactly where
// the run ended. The drift is seeded per play (see _cmRand) — a look, not a measurement.
// Shaped on NGS's carry charts: one wide, smooth sweep out of the backfield, a long
// gentle drift once he is through the gap (one bend every ~12 yards, not a wiggle), and
// a small hook at the end of a short run where the tackle turned him.
// `ob`: the run ended out of bounds, so (x1, y1) is the sideline at its yardage — the
// run goes through its gap and then angles out to the boundary, the way a back
// bounces a run outside and gets pushed out.
function _cmRunPath(sx, sy, x0, losY, x1, y1, laneW, seed, reachedLine, ob){
  const rnd=_cmRand(seed), j=(a)=>(rnd()-0.5)*2*a, sgn=()=>(rnd()<0.5?-1:1);
  const pts=[[sx+j(8), sy+j(4)]];
  if(reachedLine){
    // the sweep: sideways first, still deep, then bending upfield into the gap
    const side=Math.sign(x0-sx)||sgn();
    pts.push([sx+(x0-sx)*(0.6+j(0.1))+side*laneW*0.12, sy-(sy-losY)*(0.18+j(0.06))]);
    pts.push([x0+j(laneW*0.12), losY]);
    if(ob){
      // through the gap, then out: a couple of yards upfield first, a lean toward the
      // sideline, and a straight angle to the spot he stepped out
      const run=losY-y1;
      if(run>40){
        pts.push([x0+(x1-x0)*(0.08+j(0.04)), losY-run*(0.22+j(0.05))]);
        pts.push([x0+(x1-x0)*(0.55+j(0.08)), losY-run*(0.62+j(0.05))]);
        return _cmSmooth(pts.concat([[x1, y1]])).replace(/ C[^C]*$/, '') + ` L${(+x1).toFixed(1)},${(+y1).toFixed(1)}`;
      }
      pts.push([x1, y1]);
      return _cmSmooth(pts);
    }
    // Upfield, what tracking shows: the cut comes early — a lean in the first third of the
    // run, a counter-lean on a long one — and the last stretch is straight, because that
    // is where he is running away or getting tackled. Not every run bends: a good share
    // go straight once they are through the gap.
    const run=losY-y1;
    const bends = run>60 && rnd()<0.6;
    let x=x0;
    if(bends){
      const lean=sgn()*laneW*(0.3+rnd()*0.4);
      x=x0+lean;                     pts.push([x, losY-run*(0.25+j(0.06))]);
      if(run>230 && rnd()<0.6){ x=x-lean*(0.5+rnd()*0.4); pts.push([x, losY-run*(0.5+j(0.06))]); }
    }
    // the finish is a straight run: smooth up to the last bend, then a straight line home
    if(run>40){
      const tail=[x1+(x-x1)*0.15, losY-run*0.78];
      pts.push(tail);
      return _cmSmooth(pts.concat([[x1, y1]])).replace(/ C[^C]*$/, '') + ` L${(+x1).toFixed(1)},${(+y1).toFixed(1)}`;
    }
  } else {
    pts.push([sx+(x1-sx)*(0.5+j(0.15))+j(6), sy+(y1-sy)*(0.35+j(0.1))]);
  }
  pts.push([x1, y1]);
  return _cmSmooth(pts);
}
function carryMapSVG(plays, title, sub, tag){
  const W=760, H=600, yTop=60, yBot=560, YMAX=40, YMIN=-10;
  const yOf = yd => yBot - (Math.max(YMIN, Math.min(YMAX, yd)) - YMIN) * (yBot-yTop)/(YMAX-YMIN);
  const left = y => 170 - 130*(y-yTop)/(yBot-yTop);
  const right= y => 590 + 130*(y-yTop)/(yBot-yTop);
  const laneX=(y, lane, frac)=>{ const lw=(right(y)-left(y))/7; return left(y)+lw*(lane+0.5)+frac*lw*0.7; };
  const losY=yOf(0);
  const f1=x=>(+x).toFixed(1);
  const parts=[];
  parts.push(`<svg viewBox="0 0 ${W} ${H}" class="qpc-svg" role="img" aria-label="Carry map">`);
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
  // The seven lanes the fan already names, as faint dividers with their tags on the line.
  const tags=['LE','LT','LG','MID','RG','RT','RE'];
  for(let i=1;i<7;i++){
    parts.push(`<line x1="${f1(left(yTop)+(right(yTop)-left(yTop))*i/7)}" y1="${yTop}" x2="${f1(left(yBot)+(right(yBot)-left(yBot))*i/7)}" y2="${yBot}" stroke="#353a42" stroke-width="1" stroke-dasharray="2 6"/>`);
  }
  for(let i=0;i<7;i++) parts.push(`<text x="${f1(laneX(yTop+14, i, 0))}" y="${f1(yTop+14)}" fill="#8a9096" font-size="10" font-weight="800" text-anchor="middle">${tags[i]}</text>`);
  parts.push(`<line x1="${f1(left(losY)-30)}" y1="${f1(losY)}" x2="${f1(right(losY)+30)}" y2="${f1(losY)}" stroke="#2f6fe4" stroke-width="4"/>`);
  // The line sits low on this field (runs rarely go 40 deep), so its tags ride just above it, inside the edges.
  parts.push(`<text x="${f1(left(losY)+8)}" y="${f1(losY-9)}" fill="#fff" font-size="12" font-weight="800">LOS</text>`);
  parts.push(`<text x="${f1(right(losY)-8)}" y="${f1(losY-9)}" fill="#fff" font-size="12" font-weight="800" text-anchor="end">LOS</text>`);
  if(!plays.length){
    parts.push(`<text x="${W/2}" y="${(yTop+yBot)/2}" fill="#9aa0a6" font-size="16" text-anchor="middle">No carries</text></svg>`);
    return parts.join('');
  }
  // Short runs underneath, long runs and scores on top; the first carry in a lane sits on its centre.
  const order=plays.map((p,i)=>i).sort((a,b)=>(plays[a].td?100:plays[a].yds)-(plays[b].td?100:plays[b].yds));
  const many=plays.length>40, w=many?2.5:3.5, op=many?0.75:0.9;
  const laneN=[0,0,0,0,0,0,0], PHI=0.618033988749895, fracOf={};
  for(let i=0;i<plays.length;i++){ const l=plays[i].lane; fracOf[i]=((laneN[l]++)*PHI+0.5)%1-0.5; }
  for(const i of order){
    const p=plays[i], frac=fracOf[i];
    const endYd=(p.yl!=null) ? Math.min(p.yds, p.yl) : p.yds;      // the goal line ends every run
    const seed=(p.wk*7919 + i*104729 + p.lane*1301 + (p.yds+50)*31 + (p.q||0)*17)>>>0;
    const x0=laneX(losY, p.lane, frac), y1=yOf(endYd);
    // Out of bounds: the run ends ON the sideline at its yardage. The play says which
    // side when the run went left or right; a middle run that got out picks the side
    // its lane leans to (the seed decides for a dead-centre run).
    const ob=(p.ob!=null && endYd>=0) ? (p.ob || (p.lane<3?-1:(p.lane>3?1:((seed&1)?-1:1)))) : 0;
    const x1=ob ? (ob<0 ? left(y1)+3 : right(y1)-3) : laneX(y1, p.lane, frac);
    const col=_cmColor(p.yds);
    const what=p.td?'Touchdown':(p.fum?'Fumble lost':(p.fd?'First down':(p.tfl||p.yds<0?'Tackled for loss':'')));
    const tip=`WK ${p.wk}${p.opp?' · '+p.opp:''}${p.q?` · Q${p.q}`:''} · ${_CM_LANE_NAMES[p.lane]} · ${p.yds>=0?'+':''}${p.yds} yds${what?` · ${what}`:''}${ob?' · out of bounds':''}`;
    const attrs=tag?tag({label:`Carry · WK ${p.wk}`, value:tip, statKey:'carry'}):'';
    parts.push(`<g ${attrs}><title>${escHtml(tip)}</title>`);
    // The run, NGS-style: from where a back lines up (centred, seven yards deep) it sweeps
    // to the gap the charting recorded, enters it at the line and drifts up the field to
    // exactly where the run ended (_cmRunPath). A loss never reaches the line.
    const sx=(left(losY)+right(losY))/2, sy=yOf(-7);
    const laneW=(right(losY)-left(losY))/7;
    const d=_cmRunPath(sx, sy, x0, losY, x1, y1, laneW, seed, endYd>=0, !!ob);
    parts.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"/>`);
    // the step out of bounds: a short bar on the sideline where the run ended
    if(ob) parts.push(`<line class="cm-ob" x1="${f1(x1+(ob<0?-4:4))}" y1="${f1(y1-7)}" x2="${f1(x1+(ob<0?-4:4))}" y2="${f1(y1+7)}" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>`);
    if(p.fd && !p.td) parts.push(`<circle cx="${f1(x1)}" cy="${f1(y1)}" r="${many?3:3.5}" fill="#ffffff"/>`);
    if(p.td){
      parts.push(`<circle cx="${f1(x1)}" cy="${f1(y1)}" r="${many?9:11}" fill="none" stroke="#2f6fe4" stroke-width="3.5"/>`);
      parts.push(`<circle cx="${f1(x1)}" cy="${f1(y1)}" r="${many?3:3.5}" fill="#ffffff"/>`);
      parts.push(`<text class="tm-td" x="${f1(x1+(many?9:11)+5)}" y="${f1(y1+4.5)}" fill="#ffffff" stroke="#101214" stroke-width="3.5" paint-order="stroke" font-size="12" font-weight="900" letter-spacing=".04em">TD${p.yds>YMAX?` +${p.yds}`:''}</text>`);
    } else if(p.fum){
      parts.push(`<circle cx="${f1(x1)}" cy="${f1(y1)}" r="${many?9:11}" fill="none" stroke="#d33b2f" stroke-width="3.5"/>`);
      parts.push(`<text class="tm-fum" x="${f1(x1+(many?9:11)+5)}" y="${f1(y1+4.5)}" fill="#ffffff" stroke="#101214" stroke-width="3.5" paint-order="stroke" font-size="12" font-weight="900" letter-spacing=".04em">FUM</text>`);
    } else if(p.yds>YMAX) parts.push(`<text x="${f1(x1+10)}" y="${f1(y1+4)}" fill="${col}" font-size="11" font-weight="800">+${p.yds}</text>`);
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('');
}
function carryMapLegend(){
  return `<div class="tm-legend">
    <span><i class="tm-l-loss"></i>Tackled for loss</span><span><i class="tm-l-short"></i>0–4 yds</span><span><i class="tm-l-gain"></i>5+ yds</span>
    <span><i class="tm-l-fd"></i>First down</span><span><i class="tm-l-td"></i>Touchdown</span><span><i class="tm-l-fum"></i>Fumble lost</span><span><i class="tm-l-ob"></i>Out of bounds</span><span><i class="tm-l-los"></i>Line of scrimmage</span>
  </div>`;
}
// The season summary (66b's binned field): seven lanes × five-yard bands of where the
// runs ended, a bubble per spot sized by carries and coloured like the runs themselves
// (red lost yards, gold 0–4, green 5+), scores ringed and tagged.
function carrySummarySVG(plays, title, sub, tag){
  const parts=[];
  const F=_tmFieldParts(parts, 7, ['LE','LT','LG','MID','RG','RT','RE'], 'Carry map, season summary', title, sub);
  if(!plays.length){ parts.push(`<text x="${_TM_GRID.W/2}" y="${(_TM_GRID.yTop+_TM_GRID.yBot)/2}" fill="#9aa0a6" font-size="16" text-anchor="middle">No carries</text></svg>`); return parts.join(''); }
  const bins={};
  for(const p of plays){
    const b=_tmBand(p.yds), k=`${p.lane}:${b}`;
    const c=bins[k]||(bins[k]={lane:p.lane, band:b, n:0, yds:0, td:0, fd:0, fum:0});
    c.n++; c.yds+=p.yds; if(p.td) c.td++; if(p.fd) c.fd++; if(p.fum) c.fum++;
  }
  const bandColor=b=>{ const lo=_TM_GRID.YMIN+b*_TM_GRID.BAND; return lo<0 ? '#d33b2f' : (lo<5 ? '#d8a51d' : '#39c15a'); };
  const cells=Object.values(bins).map(c=>({lane:c.lane, band:c.band, n:c.n, td:c.td, color:bandColor(c.band),
    tip:`${_CM_LANE_NAMES[c.lane]} · ${_tmBandLabel(c.band)}: ${c.n} ${c.n===1?'carry':'carries'} (${Math.round(c.n/plays.length*100)}%) · ${c.yds} yds${c.fd?` · ${c.fd} first down${c.fd>1?'s':''}`:''}${c.td?` · ${c.td} TD`:''}${c.fum?` · ${c.fum} fumble${c.fum>1?'s':''} lost`:''}`}));
  _tmBubbleParts(parts, F, 7, cells, tag, 'Carry map · season');
  parts.push('</svg>');
  return parts.join('');
}
function carrySummaryLegend(){
  return `<div class="tm-legend">
    <span><i class="tm-l-bub-sm"></i><i class="tm-l-bub"></i>Carries ending there</span>
    <span><i class="tm-l-loss"></i>Lost yards</span><span><i class="tm-l-short"></i>0–4 yds</span><span><i class="tm-l-gain"></i>5+ yds</span>
    <span><i class="tm-l-td"></i>Touchdowns</span><span><i class="tm-l-los"></i>Line of scrimmage</span>
  </div>`;
}
function rbCarryMapBlock(pname, node, season, selWk, label, tag){
  if(!(node.games||[]).some(g=>Array.isArray(g.plays) && g.plays.length)) return `<div class="pcard-loading">Per-carry rows arrive with the next weekly bake.</div>`;
  const plays=_rbMapPlays(node, selWk);
  const title=`${escHtml(String(pname).toUpperCase())} CARRIES <tspan fill="#9aa0a6" font-size="13" font-weight="600">/ ${escHtml(String(label).toUpperCase())}</tspan>`;
  if(selWk==null) return carrySummarySVG(plays, title, `Where his runs end · bubble = carries through that gap to that distance · ring = touchdowns · pick a game for every run`, tag) + carrySummaryLegend();
  const sub=`Every carry up the gap he hit, as long as the run · red lost yards · gold 0–4 · green 5+ · ring + TD = score`;
  return carryMapSVG(plays, title, sub, tag) + carryMapLegend();
}
