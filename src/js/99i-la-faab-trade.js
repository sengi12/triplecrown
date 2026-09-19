// ── FAAB as a tradeable asset ────────────────────────────────────────────────
// A dollar is worth whatever the wire sells. In a Chopped league the best players in the sport
// are released every week, so a dollar buys a real starter and FAAB is the hardest currency on
// the board; in any other FAAB league the wire is replacement level and the same dollar is a
// sweetener. Both answers come out of ONE source — the chop market that already prices the
// Lineup pane's bids (hubChopFaab) — read as a PRICE LIST rather than as a bid.
//
// The trade calculator sums laVal units, so everything here converts dollars into those. Never
// add raw dollars to a verdict: the pick-value warning in laAssetPools is the same mistake, and
// it once made "your whole pick chest for my WR3" look fair.

// The bands hubChopBand sorts a release into, best first, each with a rank that stands for it.
const LA_FAAB_BANDS = [
  {pos:'RB', band:'top12', rank:6,  label:'a top-12 RB'},
  {pos:'WR', band:'top12', rank:6,  label:'a top-12 WR'},
  {pos:'QB', band:'top6',  rank:3,  label:'a top-6 QB'},
  {pos:'TE', band:'top6',  rank:3,  label:'a top-6 TE'},
  {pos:'RB', band:'b24',   rank:18, label:'an RB2'},
  {pos:'WR', band:'b24',   rank:18, label:'a WR2'},
  {pos:'QB', band:'b12',   rank:9,  label:'a QB2'},
  {pos:'TE', band:'b12',   rank:9,  label:'a TE2'},
  {pos:'RB', band:'b36',   rank:30, label:'an RB3'},
  {pos:'WR', band:'b36',   rank:30, label:'a WR3'},
];

// Is this a league where FAAB is a thing at all? Sleeper waiver_type 2 is FAAB.
function laFaabOn(s){ return !!(s && +s.waiverType===2 && +s.waiverBudget>0); }
function laFaabIsChop(s){ return !!(s && +s.leagueType===3); }
// What a team still has to spend. You cannot trade away money you have already bid.
function laFaabLeft(s, rosterId){
  if(!laFaabOn(s)) return 0;
  const t=(s.teamList||[]).find(x=>x.rosterId===rosterId);
  return Math.max(0, (+s.waiverBudget||0) - ((t&&+t.faabUsed)||0));
}

// What a player of each caliber is WORTH, in the calculator's own units. Read off the league's
// own rosters: the players sitting at those positional ranks are the ones who get chopped.
function laFaabBandValues(s){
  const buckets={};
  (s.teamList||[]).forEach(t=>(t.players||[]).forEach(p=>{
    const rank=laPosRankOf(s, p.name, p.pos); const band=hubChopBand(p.pos, rank);
    if(!band) return;
    const v=laVal(p.name, p.pos, p.team)||0; if(!(v>0)) return;
    (buckets[p.pos+'|'+band]=buckets[p.pos+'|'+band]||[]).push(v);
  }));
  const out={};
  Object.keys(buckets).forEach(k=>{ const a=buckets[k].sort((x,y)=>x-y); out[k]=a[Math.floor(a.length/2)]; });
  return out;
}

// The price list: what each caliber costs and what it is worth, as a monotone frontier sorted
// by price. "Best thing $X can buy" is a lookup on this, and it is concave by construction —
// the next band up always costs more than it adds.
var _laFaabCurveMemo={sig:'', curve:null};
function laFaabCurve(s){
  if(!laFaabOn(s)) return null;
  const res=(typeof hubSnapshotResult==='function') ? hubSnapshotResult(s) : null;
  if(!res || !res.faab) return null;
  const budget=+res.faab.budget||0; if(!(budget>0)) return null;
  const chop=res.faab.chop||null;
  const sig=`${s.leagueId}~${budget}~${chop?chop.f+'|'+chop.n:'wire'}~${(res.faab.wire||[]).length}~${typeof laValMode==='function'?laValMode():''}`;
  if(_laFaabCurveMemo.sig===sig) return _laFaabCurveMemo.curve;
  let pts=[];
  if(chop && Array.isArray(chop.market)){
    // A Chopped league: price the caliber bands off the chop market. This is forward-looking on
    // purpose — the elite players are not on the wire yet, they are on rosters waiting to be
    // released, and the market says what they have gone for when they were.
    const bv=laFaabBandValues(s);
    LA_FAAB_BANDS.forEach(b=>{
      const fb=(typeof hubChopFaab==='function') ? hubChopFaab(b.pos, b.rank, chop.f, chop.market, budget, budget) : null;
      const v=bv[b.pos+'|'+b.band];
      if(fb && fb.market>0 && v>0) pts.push({price:fb.market, v, label:b.label});
    });
  } else if(Array.isArray(res.faab.wire)){
    // Every other FAAB league: what is actually on the wire today, which is why a dollar comes
    // out worth so little — nothing on it is worth a roster spot.
    res.faab.wire.forEach(r=>{
      const v=laVal(r.name, r.pos, r.team)||0; const price=+(r.faab&&r.faab.market)||0;
      if(v>0 && price>0) pts.push({price, v, label:r.name});
    });
  }
  // Monotone frontier: sorted by price, keeping only a point that buys more than everything
  // cheaper than it.
  pts.sort((a,b)=>a.price-b.price || b.v-a.v);
  const curve=[]; let best=0;
  pts.forEach(p=>{ if(p.v>best){ best=p.v; curve.push(p); } });
  _laFaabCurveMemo={sig, curve:curve.length?curve:null};
  return _laFaabCurveMemo.curve;
}

// What $X is worth in trade units. Interpolated between the rungs so that adding ten dollars
// always shows up somewhere, and damped above the dearest rung — there is nothing better than
// the best player on the board to spend the rest on.
function laFaabValueOf(s, dollars){
  const d=Math.max(0, +dollars||0); if(!d) return 0;
  const c=laFaabCurve(s); if(!c || !c.length) return 0;
  if(d<=c[0].price) return +( (c[0].v*(d/c[0].price)).toFixed(1) );
  for(let i=1;i<c.length;i++){
    if(d<=c[i].price){
      const a=c[i-1], b=c[i];
      return +( (a.v + (b.v-a.v)*((d-a.price)/Math.max(1,(b.price-a.price)))).toFixed(1) );
    }
  }
  const top=c[c.length-1];
  return +( (top.v + (d-top.price)*(top.v/Math.max(1,top.price))*0.35).toFixed(1) );
}

// The inverse, and the one the evener asks for: the dollars that cover a gap of `gap` value.
// Answered on the same curve, so the line it produces is always true of this league's wire —
// "$34, what a top-12 RB has gone for with nine teams alive".
function laFaabCostOf(s, gap, cap){
  const g=+gap||0; if(g<=0) return null;
  const c=laFaabCurve(s); if(!c || !c.length) return null;
  const ceiling=(cap==null?Infinity:Math.max(0,+cap||0));
  let lo=0, hi=Math.min(ceiling, c[c.length-1].price*2.5);
  if(laFaabValueOf(s, hi) < g) return null;             // the whole budget cannot cover it
  for(let i=0;i<40;i++){ const mid=(lo+hi)/2; if(laFaabValueOf(s, mid) < g) lo=mid; else hi=mid; }
  const d=Math.ceil(hi);
  return d>ceiling ? null : d;
}

// What the dollars buy, in words, for the chip's tooltip.
function laFaabBuys(s, dollars){
  const d=Math.max(0,+dollars||0); const c=laFaabCurve(s); if(!d || !c || !c.length) return '';
  let best=null; c.forEach(p=>{ if(p.price<=d) best=p; });
  if(!best) return `not enough for anything on the wire — the cheapest rung is $${c[0].price}`;
  return `enough for ${best.label} at $${best.price}`;
}
