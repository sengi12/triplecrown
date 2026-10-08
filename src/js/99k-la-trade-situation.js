// ═════════════════════════════════════════════════════════════════════════════
// Trade situations — what each team WANTS, and whether a deal works in both chairs
// ═════════════════════════════════════════════════════════════════════════════
// A trade that balances on the chart is not a trade anyone makes unless both sides come out
// ahead by their OWN lights. A rebuild wants youth and picks and has no use for a 29-year-old
// receiver however good; a contender wants the receiver and would rather not hold a pick that
// scores nothing this year. The persona engine (laTrajectories) already reads every roster's
// clock; this file turns that into a MODE per team — contend / retool / rebuild (swing in
// redraft) — prices every asset as that team would price it, and judges a proposal from each
// side's chair. The finder then leads with deals both sides should want, and says why.
//
// The league's own ledger (99j) adds the one thing a model cannot: whether this manager
// actually deals, and whether they buy or sell picks. That rides along as a tendency tag and
// as the difference between "plausible" and "likely".

var _laSitu = { sig:null, by:null };
function _laSituSig(s){
  return [String(s.leagueId||''), String(s.takenAt||''), (typeof laValSource==='function')?laValSource():'', (typeof laValMode==='function')?laValMode():''].join('|');
}
const LA_SITU_LABEL = { contend:'Contending', retool:'Retooling', rebuild:'Rebuilding', swing:'Swinging' };
const LA_SITU_WANTS = { contend:'proven starters now', retool:'value either way', rebuild:'youth and draft picks', swing:'ceiling over floor' };
// Mode per roster, from the persona plus the standings once there are games to read.
function laTeamSituations(s){
  if(!s || !Array.isArray(s.teamList)) return {};
  const sig=_laSituSig(s);
  if(_laSitu.by && _laSitu.sig===sig) return _laSitu.by;
  const pm=(typeof laProjMap==='function') ? laProjMap() : new Map();
  let traj={}; try{ traj=laTrajectories(s, pm)||{}; }catch(e){ traj={}; }
  const n=s.teamList.length;
  const redraft=(typeof laIsRedraft==='function') && laIsRedraft();
  const byRec=[...s.teamList].sort((a,b)=>((b.wins||0)-(b.losses||0))-((a.wins||0)-(a.losses||0)) || ((b.fpts||0)-(a.fpts||0)));
  const by={};
  s.teamList.forEach(t=>{
    const r=traj[t.rosterId]||{};
    const games=(t.wins||0)+(t.losses||0)+(t.ties||0);
    const winPct=games?((t.wins||0)+(t.ties||0)*0.5)/games:null;
    const recRank=byRec.indexOf(t)+1;
    const title=String(r.title||'');
    let mode;
    if(redraft){ mode=/Contender|One Piece|In the Hunt/.test(title) ? 'contend' : 'swing'; }
    else {
      if(/Hard Rebuild|Multi-Yr Rebuild/.test(title)) mode='rebuild';
      else if(/Contender|One Piece Away/.test(title)) mode='contend';
      else if(/Edge of the Cliff/.test(title)) mode=(winPct!=null && games>=4) ? (winPct>=0.5?'contend':'rebuild') : 'contend';
      else mode='retool';   // Ascending, 1-Yr Reload, or no persona at all
      // The standings talk once a third of the season is in: a persona contender sitting
      // near the bottom is retooling whether it likes it or not, and a "rebuild" in the top
      // third with a live lineup is in the hunt.
      if(games>=4 && winPct!=null){
        if(mode==='contend' && recRank>Math.ceil(n*0.6)) mode='retool';
        if(mode==='rebuild' && recRank<=Math.ceil(n*0.34) && (r.now||0)>=0.7) mode='retool';
      }
    }
    const reasons=[];
    if(r.rank) reasons.push(`#${r.rank} of ${n} on the blend`);
    if(games) reasons.push(`${t.wins||0}-${t.losses||0}${t.ties?'-'+t.ties:''}`);
    if(r.coreAge!=null) reasons.push(`core age ${(+r.coreAge).toFixed(1)}`);
    if(r.youth!=null) reasons.push(`${Math.round(r.youth*100)}% of value is 25 or under`);
    if(r.pickStr!=null && !redraft) reasons.push(`picks at ${Math.round(r.pickStr*100)}% of the league's best`);
    if(r.cliffShare!=null && r.cliffShare>=0.25) reasons.push(`${Math.round(r.cliffShare*100)}% of value near the cliff`);
    by[t.rosterId]={ rid:t.rosterId, mode, label:LA_SITU_LABEL[mode], wants:LA_SITU_WANTS[mode], title, cls:String(r.cls||''), rank:r.rank||null, n,
      winPct, recRank, games, coreAge:r.coreAge!=null?r.coreAge:null, youth:r.youth!=null?r.youth:null, pickStr:r.pickStr!=null?r.pickStr:null,
      cliffShare:r.cliffShare!=null?r.cliffShare:null, now:r.now||0, fut:r.fut||0, advice:String(r.advice||''), reasons, redraft };
  });
  _laSitu={sig, by};
  return by;
}
function laTeamSituation(s, rid){ return laTeamSituations(s)[rid]||null; }
function laSituReset(){ _laSitu={sig:null, by:null}; }

// How much an asset is worth TO a team in a given situation, as a multiple of its market
// value. The multiples are deliberately modest: a situation bends a price, it does not
// rewrite it. Picks are the currency of a rebuild and dead weight to a contender; youth fits
// a long timeline; a player at the age cliff is a contender's starter and a rebuild's problem.
function laSituMult(x, sit){
  if(!x || !sit || sit.redraft) return {m:1, why:''};
  const mode=sit.mode;
  if(x.type==='k'){
    const thisYear=Number((leagueSnapshot&&leagueSnapshot.season)||0);
    const soon = !thisYear || Number(x.season)<=thisYear+1;
    if(mode==='rebuild') return {m: x.round===1 ? 1.25 : 1.15, why:'picks are the currency of a rebuild'};
    if(mode==='contend') return {m: soon ? 0.85 : 0.78, why:'a pick scores nothing this year'};
    return {m:1.05, why:''};
  }
  const age=(x.age!=null)?x.age:((typeof laDynAge==='function')?laDynAge(x.name):null);
  const cliff=(typeof LA_AGE_CLIFF!=='undefined' && LA_AGE_CLIFF[x.pos]!=null)?LA_AGE_CLIFF[x.pos]:null;
  const past = age!=null && cliff!=null && age>=cliff;
  const nearCliff = !past && age!=null && cliff!=null && age>=cliff-1;
  const young = age!=null && age<=24.5;
  // a starter by this league's own shape: the top (teams × slots at the position) at his
  // position among rostered players, capped at twelve
  const nT=(leagueSnapshot && Array.isArray(leagueSnapshot.teamList)) ? leagueSnapshot.teamList.length : 12;
  const slots={QB:1, RB:2, WR:2, TE:1}[x.pos]||1;
  const starter = x.posRank!=null && x.posRank<=Math.min(12, nT*slots);
  const label=x.name||'';
  if(mode==='rebuild'){
    if(past) return {m:0.6, why:`${label} is past the ${x.pos} age cliff`};
    if(nearCliff) return {m:0.75, why:`${label} is a year from the cliff`};
    if(young) return {m:1.12, why:`${label} fits a long timeline`};
    if(age!=null && age<=26) return {m:1.04, why:''};
    return {m:0.95, why:''};
  }
  if(mode==='contend'){
    // a contender buys this season: a starter is a starter whatever his birthday says, a
    // prospect it cannot start is a luxury, and an aging reserve is nothing to it
    if(starter) return {m:1.08, why:`${label} starts and scores now`};
    if(young) return {m:0.85, why:`${label} is upside they cannot start yet`};
    if(past) return {m:0.9, why:''};
    return {m:1, why:''};
  }
  // retool: light touches either way
  if(past) return {m:0.88, why:`${label} is aging`};
  if(young) return {m:1.04, why:''};
  return {m:1, why:''};
}
// The deal from one side's chair: what they receive against what they send, each priced by
// their situation, through the same consolidation curve the verdict uses. `ok` allows a hair
// of slack — nobody turns down a deal over three percent.
function laSituFit(sit, getAssets, giveAssets){
  const scaled=(arr)=>(arr||[]).map(x=>(+x.v||0)*laSituMult(x,sit).m);
  const inV=laTcAdjusted(scaled(getAssets)), outV=laTcAdjusted(scaled(giveAssets));
  const gain=inV-outV, base=Math.max(outV, inV, 1), pct=gain/base;
  const why=[];
  (getAssets||[]).forEach(x=>{ const r=laSituMult(x,sit); if(r.why && r.m>1) why.push(r.why); });
  (giveAssets||[]).forEach(x=>{ const r=laSituMult(x,sit); if(r.why && r.m<1) why.push(`sends out: ${r.why}`); });
  return { inV:Math.round(inV), outV:Math.round(outV), gain:Math.round(gain), pct, ok: inV >= outV*0.97, why:why.slice(0,3) };
}
// What this manager actually does, from the league's own ledger (loaded by the trade-history
// section; null until it has). Counts this season's deals and whether picks flow in or out.
function laPartnerTendency(s, rid){
  if(!s) return null;
  const st=(typeof _laTh!=='undefined' && _laTh && _laTh[String(s.leagueId)]) ? _laTh[String(s.leagueId)] : null;
  const rows=(st && Array.isArray(st.rows)) ? st.rows : null;
  if(!rows) return null;
  const season=String(s.season||'');
  let n=0, picksIn=0, picksOut=0, last=0; const partners={};
  rows.forEach(r=>{
    if(season && String(r.season)!==season) return;
    const me=(r.teams||[]).find(x=>x.rid===rid); if(!me) return;
    n++; last=Math.max(last, r.at||0);
    (r.teams||[]).filter(x=>x.rid!==rid).forEach(o=>{ partners[o.rid]=(partners[o.rid]||0)+1; picksOut+=(o.picks||[]).length; });
    picksIn+=(me.picks||[]).length;
  });
  const buysPicks=picksIn>picksOut, sellsPicks=picksOut>picksIn;
  return { n, active:n>=3, quiet:n===0, picksIn, picksOut, buysPicks, sellsPicks, last, partners,
    label: n===0 ? 'no trades this season' : `${n} trade${n===1?'':'s'} this season${buysPicks?' · buys picks':sellsPicks?' · sells picks':''}` };
}
// Both chairs at once, plus how likely the partner is to say yes.
function laSituFitFor(s, myRid, theirRid, myGive, myGet){
  const sits=laTeamSituations(s);
  const mine=laSituFit(sits[myRid], myGet, myGive);
  const theirs=laSituFit(sits[theirRid], myGive, myGet);
  const tend=laPartnerTendency(s, theirRid);
  // Likelihood reads the partner's chair first, then how often they deal, then how much is
  // on the table: a three-for-three that balances to the point is still a blockbuster that
  // most managers never pull the trigger on.
  const LADDER=['unlikely','long shot','possible','plausible','likely'];
  let step;
  if(theirs.ok && mine.ok) step = (tend && tend.active) ? 4 : 3;
  else if(theirs.ok) step = 2;                      // they would, you should not
  else if(theirs.pct>=-0.06) step = 1;              // close in their chair
  else step = 0;
  if(tend && tend.quiet && step===4) step=3;
  const pieces=(myGive||[]).length+(myGet||[]).length;
  if(pieces>=5) step=Math.max(0, step-1);
  if(pieces>=6) step=Math.max(0, step-1);
  let likely=LADDER[step];
  if(theirs.ok && !mine.ok) likely='their favour';
  return { mine, theirs, mutual: mine.ok && theirs.ok, likely, tend, sitMine:sits[myRid]||null, sitTheirs:sits[theirRid]||null };
}

// ── Deals shaped by the situations themselves ────────────────────────────────
//   SELL     a rebuild moves the value it discounts (age) to a team that can use it, for the
//            picks and youth it wants
//   WIN NOW  a contender spends picks and prospects on a rebuilder's proven starters
// Every candidate must be fair-or-near on the market AND ahead in both chairs.
function laSituProposals(s, myRid){
  const sits=laTeamSituations(s); const me=sits[myRid];
  if(!me || me.redraft) return [];
  const myPool=laAssetPools(s, myRid); const out=[];
  const combos=(arr,max)=>{ const o=[]; const a=arr.slice(0,max); for(let i=0;i<a.length;i++){ o.push([a[i]]); for(let j=i+1;j<a.length;j++) o.push([a[i],a[j]]); } return o; };
  const push=(lane, partner, give, get)=>{
    if(!give.length || !get.length) return;
    const v=laTcVerdict(give.map(x=>x.v), get.map(x=>x.v));
    if(!(v.fair || Math.abs(v.diff)<=v.band*1.35)) return;
    const fit=laSituFitFor(s, myRid, partner.rosterId, give, get);
    if(!fit.mutual) return;
    out.push({ give, get, b:partner, v, near:!v.fair, lane, fit, mutual:true, likely:fit.likely, shape:`${give.length}for${get.length}` });
  };
  if(me.mode==='rebuild' || me.mode==='retool'){
    const sell=myPool.players.filter(x=>x.v>0 && laSituMult(x,me).m<1).sort((a,b)=>b.v-a.v);
    s.teamList.forEach(t=>{
      if(t.rosterId===myRid) return; const st=sits[t.rosterId]; if(!st || st.mode==='rebuild') return;
      const pool=laAssetPools(s, t.rosterId);
      const want=[...pool.picks.filter(x=>x.v>0), ...pool.players.filter(x=>x.v>0 && laSituMult(x,me).m>1).slice(0,6)].sort((a,b)=>b.v-a.v).slice(0,8);
      combos(sell,4).forEach(g=>combos(want,8).forEach(gt=>push('sell', t, g, gt)));
    });
  }
  if(me.mode==='contend' || me.mode==='retool'){
    const pay=[...myPool.picks.filter(x=>x.v>0), ...myPool.players.filter(x=>x.v>0 && laSituMult(x,me).m<1)].sort((a,b)=>b.v-a.v);
    s.teamList.forEach(t=>{
      if(t.rosterId===myRid) return; const st=sits[t.rosterId]; if(!st || st.mode==='contend') return;
      const pool=laAssetPools(s, t.rosterId);
      const buy=pool.players.filter(x=>x.v>0 && laSituMult(x,me).m>1 && laSituMult(x,st).m<1).sort((a,b)=>b.v-a.v);
      combos(pay,6).forEach(g=>combos(buy,5).forEach(gt=>push('now', t, g, gt)));
    });
  }
  const seen=new Set();
  return out.filter(p=>{ const k=p.b.rosterId+'|'+p.give.map(x=>x.key).sort().join(',')+'>'+p.get.map(x=>x.key).sort().join(','); if(seen.has(k)) return false; seen.add(k); return true; });
}

// ── Rendering ────────────────────────────────────────────────────────────────
function laSituBadge(sit){
  if(!sit) return '';
  return `<span class="la-situ la-situ-${escAttr(sit.mode)}" title="${escAttr(sit.title||'')}">${escHtml(sit.label||sit.mode)}</span>`;
}
// The card under a team's name on the calculator: mode, persona, record, what it wants, and
// the facts behind the read.
function laSituCardHTML(s, rid){
  const sit=laTeamSituation(s, rid); const t=s.teamList.find(x=>x.rosterId===rid);
  if(!sit || !t) return '';
  const tend=laPartnerTendency(s, rid);
  return `<div class="la-situ-card la-situ-card-${escAttr(sit.mode)}">
    <div class="la-situ-row">${laSituBadge(sit)}${sit.title?`<span class="la-situ-title">${escHtml(sit.title)}</span>`:''}${sit.games?`<span class="la-situ-rec">${t.wins||0}-${t.losses||0}${t.ties?'-'+t.ties:''}</span>`:''}</div>
    <div class="la-situ-wants">wants <b>${escHtml(sit.wants)}</b></div>
    <div class="la-situ-facts">${sit.reasons.map(r=>`<span>${escHtml(r)}</span>`).join('')}${tend?`<span class="la-situ-tend">${escHtml(tend.label)}</span>`:''}</div>
  </div>`;
}
// The verdict's second opinion: the same deal from each chair.
function laSituFitHTML(s, aRid, bRid, givenA, givenB){
  if(!((givenA&&givenA.length)||(givenB&&givenB.length))) return '';
  const sits=laTeamSituations(s);
  const a=s.teamList.find(x=>x.rosterId===aRid), b=s.teamList.find(x=>x.rosterId===bRid);
  if(!a || !b || !sits[aRid] || !sits[bRid] || sits[aRid].redraft) return '';
  const fa=laSituFit(sits[aRid], givenB, givenA), fb=laSituFit(sits[bRid], givenA, givenB);
  const line=(t,f,sit)=>`<div class="la-fit-line ${f.ok?'ok':'no'}"><span class="la-fit-who">${escHtml(t.teamName)}</span>${laSituBadge(sit)}<span class="la-fit-pct">${f.gain>=0?'+':''}${Math.round(f.pct*100)}%</span><span class="la-fit-why">${escHtml(f.why.length?f.why[0]:(f.ok?'comes out ahead in its own chair':'gives up more than it wants'))}</span></div>`;
  const both=fa.ok&&fb.ok;
  return `<div class="la-fit"><div class="la-fit-lbl">${both?'Works in both chairs':(fa.ok||fb.ok?'Works for one side':'Works for neither side')}</div>${line(a,fa,sits[aRid])}${line(b,fb,sits[bRid])}</div>`;
}
// One suggested deal as a card: who, what goes each way, the market verdict, both chairs.
function laFndCardHTML(p, fnd){
  const asset=(x)=>x.type==='k'
    ? `<span class="la-fc-pick"><span class="la-fc-nm">${escHtml(x.label)}</span><span class="la-fc-meta">rookie pick</span><b>${x.v||''}</b></span>`
    : `<span class="la-fc-pl">${(typeof laPlayerImg==='function')?laPlayerImg(x,'la-fc-hs'):''}<span class="la-fc-nm">${escHtml(x.name)}</span><span class="la-fc-meta"><span class="la-fc-pos ${slotClass(x.pos)}">${escHtml(x.pos)}${x.posRank||''}</span>${x.age!=null?` · ${x.age.toFixed(0)}yo`:''}</span><b>${x.v||''}</b></span>`;
  const sum=(arr)=>arr.reduce((a,x)=>a+(+x.v||0),0);
  const lk=String(p.likely||'');
  const lane=p.lane||'mid';
  const sitB=p.fit&&p.fit.sitTheirs;
  const fitTag=(f,who)=>f?`<span class="la-fc-fit ${f.ok?'ok':'no'}" title="${escAttr(who+' in their own chair: what comes in against what goes out, priced by their situation')}">${escHtml(who)} ${f.gain>=0?'+':''}${Math.round(f.pct*100)}%</span>`:'';
  return `<div class="la-fc la-fc-${escAttr(lane)}">
    <div class="la-fc-head"><span class="la-fnd-lane la-lane-${escAttr(lane)}" title="${escAttr((typeof LA_LANE_TIP!=='undefined'&&LA_LANE_TIP[lane])||'')}">${escHtml((typeof LA_LANE_LABEL!=='undefined'&&LA_LANE_LABEL[lane])||lane)}</span>
      <span class="la-fc-partner">with <b>${escHtml(p.b.teamName)}</b>${sitB?laSituBadge(sitB):''}</span>
      ${lk?`<span class="la-fc-like la-like-${escAttr(lk.replace(/\s+/g,'-'))}">${escHtml(lk)}</span>`:''}</div>
    <div class="la-fc-body">
      <div class="la-fc-col"><div class="la-fc-lbl">You send <b>${sum(p.give)}</b></div>${p.give.map(asset).join('')}</div>
      <div class="la-fc-arrow">⇄</div>
      <div class="la-fc-col"><div class="la-fc-lbl">You get <b>${sum(p.get)}</b></div>${p.get.map(asset).join('')}</div>
    </div>
    <div class="la-fc-foot">
      <span class="la-fnd-v ${p.v.fair?'ok':''}">${p.v.fair?'fair on the market':(p.v.diff>0?'you overpay by ':'you win by ')+Math.abs(p.v.diff).toFixed(0)}</span>
      ${p.fit?fitTag(p.fit.mine,'you')+fitTag(p.fit.theirs,'them'):''}
      ${p.fit&&p.fit.theirs.why.length?`<span class="la-fc-why">${escHtml(p.fit.theirs.why[0])}</span>`:''}
      ${p.fit&&p.fit.tend?`<span class="la-fc-tend">${escHtml(p.fit.tend.label)}</span>`:''}
      <button class="btn btn-sm btn-ghost la-fc-load" onclick="laLoadProposal(${fnd.myRosterId},${p.b.rosterId},[${p.give.map(x=>`'${escJsSingle(x.key)}'`).join(',')}],[${p.get.map(x=>`'${escJsSingle(x.key)}'`).join(',')}])">Load</button>
    </div>
  </div>`;
}
