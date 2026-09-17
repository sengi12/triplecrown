// ═════════════════════════════════════════════════════════════════════════════
// League Analyzer — My Team overview cards
// ═════════════════════════════════════════════════════════════════════════════
// The landing page's second row. Every card here is pure derivation from what laMyTeamView
// already computed ONCE for the render — the per-team engine rows (`eng`), the team on
// screen (`mineEng`), the starting-slot labels and the per-slot league values — so nothing
// below touches the board, the seed or the network again. The cards answer the question the
// advice line already poses ("upgrade at your weakest starting slot") with names and numbers:
//
//   This week      the live matchup and the playoff picture in one strip (in season only)
//   Upgrade path   the weakest starting slot, its gap to the league, who has a spare there
//   Trade fit      the rosters that mirror yours — strong where you're weak, weak where
//                  you're strong — ranked by how much there is to trade
//   Heat map       every team × every position, the whole trade market in one glance
//   Bye exposure   starters on bye per week, the doubled-up weeks flagged
//   Age timeline   dynasty value by age bucket with the cliff players named (dynasty only)
//   Construction   roster count by position against the league average
//
// Lens-aware: `_v` on every player is whatever the page's lens says (dynasty value or
// projected points), so the units follow the toggle without the cards knowing which it is.

// One rank per team per column, computed once and shared by the cards below.
// Columns follow the Positional Rankings card: the four positions, then starters and bench.
function laPosRankTable(eng){
  const defs=[['QB',e=>e.pos.QB],['RB',e=>e.pos.RB],['WR',e=>e.pos.WR],['TE',e=>e.pos.TE],
              ['STARTERS',e=>e.startersAdj],['BENCH',e=>e.benchAdj]];
  const cols=defs.filter(([k,g])=>k==='STARTERS'||k==='BENCH'||eng.some(e=>g(e)>0));
  const rank={}; eng.forEach(e=>{ rank[e.t.rosterId]={}; });
  cols.forEach(([k,g])=>{ const all=eng.map(g); eng.forEach((e,i)=>{ rank[e.t.rosterId][k]=laRankOf(all[i],all); }); });
  return { cols:cols.map(c=>c[0]), rank, n:eng.length };
}
// The lens's unit, for the numbers that need one.
function _laLensFmt(lens){
  return lens==='proj' ? {unit:'pts', fmt:v=>Number(v||0).toFixed(1)} : {unit:'value', fmt:v=>String(Math.round(v||0))};
}
function _laMedian(vals){
  const s=[...vals].sort((a,b)=>a-b); const n=s.length; if(!n) return 0;
  return n%2 ? s[(n-1)/2] : (s[n/2-1]+s[n/2])/2;
}
function _laTeamLink(t, cls){
  return `<span class="la-clickteam ${cls||''}" onclick="laViewTeam(${t.rosterId})" title="View ${escAttr(t.teamName)}’s analysis">${laTeamIcon(t,'la-tm-av-sm')}${escHtml(t.teamName)}</span>`;
}
// My best bench piece at a position: the asset I could actually send. Ties between two
// strengths (same league rank) break toward the one with a spare behind it.
function _laSpare(mineEng,pos){ return mineEng.bench.filter(p=>p.pos===pos).sort((a,b)=>b._v-a._v)[0]||null; }
function _laSpareVal(mineEng,pos){ const p=_laSpare(mineEng,pos); return p?p._v:0; }
function _laPlayerLink(p){
  return `<span class="clickable-player la-mc-p" title="${escAttr(p.name)}" onclick="${pcardOnclick(p.id||p.name,p.pos,p.team||'')}">${escHtml(abbrevName(p.name))}</span>`;
}

// ── Upgrade path ─────────────────────────────────────────────────────────────
// The weakest starting slot by league rank (ties: the bigger gap to the league median), how
// far it sits from the median and from the next rank up, and the league-mates whose BENCH
// holds a player who would start over yours there — with what each of them is short of, so
// the list reads as partners, not just owners.
function laUpgradePathHTML(s, eng, mineEng, slotLabels, slotVals, lens, pr){
  const n=eng.length; if(!n || !slotLabels.length) return '';
  const {unit, fmt}=_laLensFmt(lens);
  const rows=slotLabels.map((lbl,i)=>{
    const f=mineEng.starters[i]||{slot:lbl,player:null}; const p=f.player||null; const v=p?p._v:0;
    const vals=slotVals[i]; const rank=laRankOf(v,vals); const median=_laMedian(vals);
    const above=vals.filter(x=>x>v+1e-9); const next=above.length?Math.min(...above):null;
    return {lbl, slot:f.slot, p, v, rank, gapMed:Math.max(0,median-v), gapNext:next!=null?next-v:0};
  });
  rows.sort((a,b)=>(b.rank-a.rank)||(b.gapMed-a.gapMed));
  const weak=rows[0];
  const elig=FLEX_ELIGIBLE[weak.slot]||[weak.slot];
  // The position to hunt: a dedicated slot names itself; a flex slot means the eligible
  // position where my room ranks worst.
  const myR=pr.rank[mineEng.t.rosterId]||{};
  const huntPos=elig.length===1 ? elig[0]
    : [...elig].filter(p=>myR[p]!=null).sort((a,b)=>(myR[b]||0)-(myR[a]||0))[0] || elig[0];
  // My surplus: the position where I rank best (for the "send" side of the story).
  const POS=['QB','RB','WR','TE'].filter(p=>myR[p]!=null && p!==huntPos);
  const surplusPos=POS.sort((a,b)=>(myR[a]-myR[b])||(_laSpareVal(mineEng,b)-_laSpareVal(mineEng,a)))[0]||null;
  const spare=surplusPos ? _laSpare(mineEng,surplusPos) : null;
  // Partners: the best bench piece around the league that beats my starter at this slot.
  const partners=eng.filter(e=>e!==mineEng).map(e=>{
    const cand=e.bench.filter(p=>elig.includes(p.pos)&&p._v>weak.v+1e-9).sort((a,b)=>b._v-a._v)[0];
    if(!cand) return null;
    const tr=pr.rank[e.t.rosterId]||{};
    // What they're short of: the position where I out-rank them by the most.
    const need=['QB','RB','WR','TE'].filter(p=>tr[p]!=null&&myR[p]!=null&&p!==cand.pos)
      .map(p=>({p, d:tr[p]-myR[p]})).sort((a,b)=>(b.d-a.d)||(_laSpareVal(mineEng,b.p)-_laSpareVal(mineEng,a.p)))[0];
    return {e, cand, need:(need&&need.d>0)?need:null};
  }).filter(Boolean).sort((a,b)=>b.cand._v-a.cand._v).slice(0,3);
  const hero = weak.p
    ? `<span class="la-up-slot">${escHtml(weak.lbl)}</span> ${_laPlayerLink(weak.p)} ranks <b class="${laQuartile(weak.rank,n)}">${ordinal(weak.rank)}</b> of ${n}`
    : `<span class="la-up-slot">${escHtml(weak.lbl)}</span> is <b class="la-q4">empty</b> — every other team starts someone there`;
  const gaps=[];
  if(weak.gapMed>0) gaps.push(`<b>${fmt(weak.gapMed)}</b> ${unit} below the league median`);
  else gaps.push(`at or above the league median`);
  if(weak.gapNext>0) gaps.push(`<b>${fmt(weak.gapNext)}</b> to move up a spot`);
  const list = partners.length
    ? `<div class="la-up-list">${partners.map(x=>`<div class="la-up-row">
        ${_laTeamLink(x.e.t,'la-up-team')}
        <span class="la-up-cand">${_laPlayerLink(x.cand)} <span class="la-up-pos la-pos-${escAttr(x.cand.pos)}">${escHtml(x.cand.pos)}</span> <b class="la-up-val">${fmt(x.cand._v)}</b> <span class="la-up-on">on their bench</span></span>
        <span class="la-up-need">${x.need?`needs ${escHtml(x.need.p)} <span class="la-up-need-rk">(their ${ordinal((pr.rank[x.e.t.rosterId]||{})[x.need.p])}, your ${ordinal(myR[x.need.p])})</span>`:'no obvious hole'}</span>
      </div>`).join('')}</div>`
    : `<div class="la-up-none">No bench in the league holds a ${escHtml(huntPos)} who would start over yours — the upgrade has to come from someone’s starting lineup, or the wire.</div>`;
  return `<div class="la-my-card la-mc-up"><div class="la-my-title">Upgrade Path <span class="la-my-title-sub">weakest starting slot</span></div>
    <div class="la-up-hero">${hero}</div>
    <div class="la-up-gaps">${gaps.join(' · ')}</div>
    <div class="la-up-sub">Spare ${escHtml(huntPos)}${elig.length>1?` (or ${elig.filter(p=>p!==huntPos).join('/')})`:''} around the league that would start over yours:</div>
    ${list}
    <div class="la-up-foot">
      <button class="btn btn-sm btn-accent" onclick="laState.fndPos='${escAttr(huntPos)}';laSetTab('trade')">Find a trade at ${escHtml(huntPos)}</button>
      ${surplusPos?`<span class="la-up-surplus">Your surplus: <b>${escHtml(surplusPos)}</b> (${ordinal(myR[surplusPos])})${spare?` · best spare ${_laPlayerLink(spare)} <b>${fmt(spare._v)}</b>`:''}</span>`:''}
    </div></div>`;
}

// ── Trade fit ────────────────────────────────────────────────────────────────
// For every other roster: how much they can help me (positions where they out-rank me,
// summed rank gap) and how much I can help them (the reverse). The fit is the geometric
// mean of the two — zero unless BOTH sides have something the other wants — so a team that
// is simply better everywhere never tops the list.
function laTradeFitHTML(s, eng, mineEng, pr){
  const POS=['QB','RB','WR','TE'].filter(p=>pr.cols.includes(p));
  if(!POS.length || eng.length<2) return '';
  const my=pr.rank[mineEng.t.rosterId]||{};
  const rows=eng.filter(e=>e!==mineEng).map(e=>{
    const th=pr.rank[e.t.rosterId]||{};
    let need=0, give=0, needPos=null, givePos=null, nd=0, gd=0;
    POS.forEach(p=>{ const d=(my[p]||0)-(th[p]||0);
      if(d>0){ need+=d; if(d>nd){ nd=d; needPos=p; } }
      else if(d<0){ give-=d;
        // the "send" side: the biggest rank gap in my favour; equal gaps go to the position
        // where I have a spare on the bench, since that is what I could actually part with
        if(-d>gd || (-d===gd && givePos && _laSpareVal(mineEng,p)>_laSpareVal(mineEng,givePos))){ gd=-d; givePos=p; } } });
    return {e, th, need, give, needPos, givePos, fit:Math.sqrt(need*give)};
  }).filter(r=>r.fit>0).sort((a,b)=>b.fit-a.fit).slice(0,3);
  const mx=rows.length?rows[0].fit:1;
  const body = rows.length
    ? rows.map(r=>`<div class="la-fit-row">
        ${_laTeamLink(r.e.t,'la-fit-team')}
        <div class="la-fit-body">
          <div class="la-fit-line"><span class="la-fit-get">get <b>${escHtml(r.needPos)}</b> <span class="la-fit-rk">their ${ordinal(r.th[r.needPos])} · your ${ordinal(my[r.needPos])}</span></span>
            <span class="la-fit-send">send <b>${escHtml(r.givePos)}</b> <span class="la-fit-rk">your ${ordinal(my[r.givePos])} · their ${ordinal(r.th[r.givePos])}</span></span></div>
          <div class="la-fit-track"><div class="la-fit-bar" style="width:${Math.max(6,100*r.fit/mx).toFixed(0)}%"></div></div>
        </div>
        <button class="btn btn-sm btn-ghost la-fit-go" onclick="laState.fndPos='${escAttr(r.needPos)}';laSetTab('trade')" title="Open the trade finder targeting ${escAttr(r.needPos)}">trade ›</button>
      </div>`).join('')
    : `<div class="la-fit-none">No roster mirrors yours — every team is stronger or weaker than you across the board, so there is no natural two-way deal. Try the trade finder for one-sided upgrades.</div>`;
  return `<div class="la-my-card la-mc-fit"><div class="la-my-title">Trade Fit <span class="la-my-title-sub">rosters that mirror yours</span></div>${body}</div>`;
}

// ── League heat map ──────────────────────────────────────────────────────────
// Teams (in power order) × the Positional Rankings columns; each cell is the team's league
// rank there, coloured by quartile. Rich and poor at every position, on one screen.
function laHeatGridHTML(s, eng, mineEng, pr){
  const n=pr.n; if(!n) return '';
  const order=[...eng].sort((a,b)=>b.score-a.score);
  const short={STARTERS:'STRT', BENCH:'BN'};
  return `<div class="la-my-card la-mc-heat"><div class="la-my-title">League Heat Map <span class="la-my-title-sub">rank at every position · 1 = best</span></div>
    <div class="la-heat-wrap"><table class="la-heat"><thead><tr><th class="la-heat-th-team">TEAM</th>${pr.cols.map(c=>`<th title="${escAttr(c)}">${escHtml(short[c]||c)}</th>`).join('')}</tr></thead><tbody>
    ${order.map(e=>{ const r=pr.rank[e.t.rosterId]||{};
      return `<tr class="${e===mineEng?'mine':''}"><td class="la-heat-team">${_laTeamLink(e.t,'la-heat-name')}</td>
        ${pr.cols.map(c=>`<td class="la-heat-c ${laQuartile(r[c]||n,n)}" title="${escAttr(e.t.teamName)} · ${c}: ${ordinal(r[c]||n)} of ${n}">${r[c]||n}</td>`).join('')}</tr>`; }).join('')}
    </tbody></table></div>
    <div class="la-heat-key"><i class="la-q1"></i>top quarter <i class="la-q2"></i>upper half <i class="la-q3"></i>lower half <i class="la-q4"></i>bottom quarter</div></div>`;
}

// ── Bye exposure ─────────────────────────────────────────────────────────────
// Starters on bye per week from the in-season sidecar's schedule: the next four weeks in
// season, every bye week of the year before it starts. Two or more starters out in the same
// week is the row that matters — it's flagged. No schedule (no sidecar yet) → no card.
function laByeExposureHTML(s, mineEng, slotLabels){
  const ins=(typeof TC_INSEASON!=='undefined'&&TC_INSEASON)||null;
  const sched=ins&&ins.schedule; if(!sched) return '';
  const started=(typeof hasSeasonStarted==='function')&&hasSeasonStarted();
  const cur=(typeof laCurrentWeek==='function')?laCurrentWeek():1;
  const last=(typeof laStdRegularWeeks==='function')?Math.max(cur,laStdRegularWeeks(s)):18;
  // In season the card looks at the rest of the regular season, not a fixed four weeks: the
  // first byes land in week 5 or later, and four rows of "all starters play" say nothing.
  // The next four weeks still get a line of their own when they are clear.
  const from=started?cur:1, to=Math.min(18,last);
  const starters=mineEng.starters.map((f,i)=>({lbl:slotLabels[i]||f.slot, p:f.player})).filter(x=>x.p);
  const byeOf=(p,wk)=>{ const tm=String(p.team||'').toUpperCase(); return !!(tm&&sched[tm]&&!sched[tm][String(wk)]); };
  // A week the schedule has no game for at all (past its end, or a partial sidecar) is not a
  // league-wide bye — it's unknown, and unknown means "assume they play".
  const teams=Object.keys(sched);
  const weekKnown=wk=>teams.some(tm=>sched[tm]&&sched[tm][String(wk)]);
  const rows=[]; let worst=null;
  for(let wk=from; wk<=to; wk++){
    const out=weekKnown(wk)?starters.filter(x=>byeOf(x.p,wk)):[];
    if(!out.length) continue;
    rows.push({wk,out});
    if(!worst || out.length>worst.out.length) worst={wk,out};
  }
  if(!rows.length && !started) return '';
  const nearClear = started && !rows.some(r=>r.wk<=Math.min(to,cur+3));
  const near = nearClear ? `<div class="la-bye-row la-bye-clear"><span class="la-bye-wk">Wk ${cur}\u2013${Math.min(to,cur+3)}</span><span class="la-bye-n">0</span><span class="la-bye-names"><span class="la-bye-none">all starters play</span></span></div>` : '';
  const body = near + (rows.length ? rows.map(r=>`<div class="la-bye-row ${r.out.length>=2?'la-bye-hot':r.out.length?'':'la-bye-clear'}">
      <span class="la-bye-wk">Wk ${r.wk}</span>
      <span class="la-bye-n" title="${r.out.length} starter${r.out.length===1?'':'s'} on bye">${r.out.length}</span>
      <span class="la-bye-names">${r.out.length?r.out.map(x=>`<span class="la-bye-chip"><span class="la-bye-slot">${escHtml(x.lbl)}</span>${_laPlayerLink(x.p)}</span>`).join(''):'<span class="la-bye-none">all starters play</span>'}</span>
    </div>`).join('') : `<div class="la-bye-none">No starter has a bye left this season.</div>`);
  const foot = worst && worst.out.length>=2
    ? `<div class="la-bye-foot la-bye-hot-txt">Week ${worst.wk} costs you ${worst.out.length} starters at once — line up cover from the bench or the wire before then.</div>`
    : (worst ? `<div class="la-bye-foot">Never more than one starter out in the same week.</div>` : '');
  return `<div class="la-my-card la-mc-bye"><div class="la-my-title">Bye Exposure <span class="la-my-title-sub">${started?`weeks ${from}–${to}`:'the season’s bye weeks'}</span></div>${body}${foot}</div>`;
}

// ── Age timeline (dynasty) ───────────────────────────────────────────────────
// Where the roster's dynasty value sits by age. Bars are the share of value in each age
// bucket; the cliff chips underneath name the players at or past their positional cliff.
// A redraft roster is spent at the end of the year, so the card is dynasty-only.
const LA_AGE_BUCKETS=[['≤23',0,23.999],['24–25',24,25.999],['26–27',26,27.999],['28–29',28,29.999],['30+',30,99]];
function laAgeTimelineHTML(s, mineEng){
  if(typeof laIsRedraft==='function' && laIsRedraft()) return '';
  const ps=(mineEng.t.players||[]).map(p=>({p, v:laDynVal(p.name,p.pos), age:laDynAge(p.name)})).filter(x=>x.v>0);
  const aged=ps.filter(x=>x.age!=null);
  if(aged.length<3) return '';
  const total=aged.reduce((a,x)=>a+x.v,0)||1;
  const buckets=LA_AGE_BUCKETS.map(([lbl,lo,hi],i)=>{
    const inb=aged.filter(x=>x.age>=lo&&x.age<=hi).sort((a,b)=>b.v-a.v);
    return {lbl, share:inb.reduce((a,x)=>a+x.v,0)/total, top:inb.slice(0,2), n:inb.length, cls:['la-q1','la-q1','la-q2','la-q3','la-q4'][i]};
  });
  const mx=Math.max(...buckets.map(b=>b.share))||1;
  const coreAge=aged.reduce((a,x)=>a+x.v*x.age,0)/aged.reduce((a,x)=>a+x.v,0);
  const cliff=aged.map(x=>({...x, c:laCliffInfo(x.p.name,x.p.pos)})).filter(x=>x.c&&x.c.state!=='ok').sort((a,b)=>b.v-a.v).slice(0,4);
  const cliffShare=aged.filter(x=>{ const c=laCliffInfo(x.p.name,x.p.pos); return c&&c.state!=='ok'; }).reduce((a,x)=>a+x.v,0)/total;
  return `<div class="la-my-card la-mc-age"><div class="la-my-title">Age Timeline <span class="la-my-title-sub">share of dynasty value by age</span></div>
    <div class="la-age-chart">${buckets.map(b=>`<div class="la-age-col" title="${escAttr(b.lbl)}: ${Math.round(100*b.share)}% of value across ${b.n} player${b.n===1?'':'s'}">
        <span class="la-age-pct">${b.share>0?Math.round(100*b.share)+'%':''}</span>
        <div class="la-age-bar ${b.cls}" style="height:${Math.max(3,100*b.share/mx).toFixed(0)}%"></div>
        <span class="la-age-lbl">${escHtml(b.lbl)}</span>
        <span class="la-age-top">${b.top.map(x=>_laPlayerLink(x.p)).join('')||'—'}</span>
      </div>`).join('')}</div>
    <div class="la-age-foot">core age <b>${coreAge.toFixed(1)}</b> · <b class="${cliffShare>=LA_TRAJ_CLIFFSHARE?'la-cliff-hot':''}">${Math.round(100*cliffShare)}%</b> of value at or near a cliff
      ${cliff.length?`<div class="la-age-cliffs">${cliff.map(x=>`<span class="la-age-cliff la-age-${x.c.state}" title="${escAttr(x.p.pos)} cliff at ${x.c.cliff}">${x.c.state==='defier'?'🛡':'⚠'} ${_laPlayerLink(x.p)} <i>${x.age.toFixed(1)}</i></span>`).join('')}</div>`:''}
    </div></div>`;
}

// ── Roster construction ──────────────────────────────────────────────────────
// How many of each position the roster carries against the league average, and how many
// the league starts — "six WR where the league carries eight" as a number, not a feeling.
function laRosterConstructionHTML(s, eng, mineEng){
  const norm=p=>{ const x=String(p||'').toUpperCase(); return x==='DST'?'DEF':x; };
  const POS=['QB','RB','WR','TE','K','DEF'];
  const counts=eng.map(e=>{ const c={}; (e.t.players||[]).forEach(p=>{ const k=norm(p.pos); c[k]=(c[k]||0)+1; }); return c; });
  const mineC=counts[eng.indexOf(mineEng)]||{};
  const n=eng.length||1;
  const slots=(s.rosterPositions||[]).filter(x=>x!=='BN'&&x!=='IR'&&x!=='TAXI');
  const startsAt=pos=>slots.filter(x=>x===pos).length;
  const rows=POS.filter(pos=>counts.some(c=>c[pos])).map(pos=>{
    const mine=mineC[pos]||0, avg=counts.reduce((a,c)=>a+(c[pos]||0),0)/n, mx=Math.max(...counts.map(c=>c[pos]||0),1);
    return {pos, mine, avg, mx, d:mine-avg, starts:startsAt(pos)};
  });
  if(!rows.length) return '';
  const total=(mineEng.t.players||[]).length, avgTotal=eng.reduce((a,e)=>a+(e.t.players||[]).length,0)/n;
  return `<div class="la-my-card la-mc-build"><div class="la-my-title">Roster Construction <span class="la-my-title-sub">count by position vs league average</span></div>
    ${rows.map(r=>`<div class="la-bld-row">
      <span class="la-bld-pos la-pos-${escAttr(r.pos)}">${escHtml(r.pos)}</span>
      <span class="la-bld-n" title="${escAttr(r.pos)}: you carry ${r.mine}, the league averages ${r.avg.toFixed(1)}">${r.mine}</span>
      <div class="la-bld-track"><div class="la-bld-bar" style="width:${(100*r.mine/r.mx).toFixed(0)}%"></div><i class="la-bld-avg" style="left:${(100*r.avg/r.mx).toFixed(0)}%" title="league average ${r.avg.toFixed(1)}"></i></div>
      <span class="la-bld-d ${r.d>=0.75?'la-bld-more':r.d<=-0.75?'la-bld-less':''}">${r.d>0?'+':''}${r.d.toFixed(1)}</span>
      <span class="la-bld-starts">${r.starts?`starts ${r.starts}`:''}</span>
    </div>`).join('')}
    <div class="la-bld-foot">${total} rostered · league average ${avgTotal.toFixed(1)} · <i class="la-bld-avg-key"></i> = league average</div></div>`;
}

// ── This week ────────────────────────────────────────────────────────────────
// One strip under the summary in season: the matchup (opponent, both projected totals,
// win probability from the same engine as the Matchup tab) and the playoff picture
// (seed, status, games back). Reads the matchup cache; kicks one silent fetch when the
// current week isn't in it yet and shows a loading line until the re-render.
function laThisWeekStripHTML(s, mineEng){
  if(!s || s.provider!=='sleeper') return '';
  if(typeof hasSeasonStarted!=='function' || !hasSeasonStarted()) return '';
  if(typeof _laMu==='undefined' || typeof laFetchMatchups!=='function' || typeof laAdjWeekProj!=='function') return '';
  const wk=laCurrentWeek();
  const data=_laMu.byWeek[wk];
  if(!data){ laFetchMatchups(wk, true); return `<div class="la-tw la-tw-empty"><span class="la-tw-wk">Week ${wk}</span><span class="la-tw-load">loading this week’s matchup…</span></div>`; }
  const myRow=(data.rows||[]).find(r=>r.roster_id===mineEng.t.rosterId);
  if(!myRow) return '';
  // A chopped league has no opponent: every team plays the field and the lowest total is out.
  // The strip is then the Chopping Block's own read — projected finish among the survivors,
  // Safe %, and where the chop line sits — from the block's engine (99e-la-chop.js).
  if(typeof laIsChopped==='function' && laIsChopped(s) && typeof laChopSummarize==='function') return _laThisWeekChopHTML(s, mineEng, wk, data);
  const oppRow=(data.rows||[]).find(r=>r.matchup_id===myRow.matchup_id && r.roster_id!==myRow.roster_id)||null;
  const teamBy={}; (s.teamList||[]).forEach(t=>{ teamBy[t.rosterId]=t; });
  const meta=_laRosterMeta(s), pm=laProjMap();
  const dvp=(typeof laDvpTable==='function')?laDvpTable():null;
  const cur=laCurrentWeek();
  const side=(row)=>{
    const t=teamBy[row.roster_id]||{}; const starters=row.starters||[], pts=row.starters_points||[];
    let proj=0, rem=0, ytp=0;
    starters.forEach((pid,i)=>{ if(!pid||pid==='0') return;
      const p=_laPidMeta(meta,pid); const pr=laAdjWeekProj(p,wk,pm,dvp).adj||0; proj+=pr;
      const started=(typeof laGameStarted==='function')?laGameStarted(p.team, wk):null;
      const played = started===true || (started===null && (pts[i]||0)>0) || wk<cur;
      if(!played){ rem+=pr; ytp++; } });
    return {t, pts:Number(row.points||0), proj, rem, ytp, rec:`${t.wins!=null?t.wins:'–'}-${t.losses!=null?t.losses:'–'}`};
  };
  const A=side(myRow), B=oppRow?side(oppRow):null;
  const live=A.pts>0 || (B&&B.pts>0);
  const p1=B ? laWinProb(A.pts,A.rem,B.pts,B.rem) : null;
  const pct=p1!=null?Math.round(100*p1):null;
  // Standings: the playoff picture's row for this team.
  let std='';
  if(typeof laPlayoffPicture==='function'){
    try{ const pic=laPlayoffPicture(s); const r=pic.rows.find(x=>x.t.rosterId===mineEng.t.rosterId);
      if(r && r.played>0){ const st=(typeof LA_STD_STATUS!=='undefined'&&LA_STD_STATUS[r.status])||[r.status,''];
        std=`<span class="la-tw-std"><span class="la-tw-seed">Seed ${r.seed}</span><span class="la-tw-status ${st[1]}">${escHtml(st[0])}</span>${r.gb>0?`<span class="la-tw-gb">${r.gb} GB</span>`:''}</span>`; } }catch(e){}
  }
  const num=(S)=> live ? `<b>${S.pts.toFixed(1)}</b><i>proj ${(S.pts+S.rem).toFixed(1)}</i>` : `<b>${S.proj.toFixed(1)}</b><i>proj</i>`;
  return `<div class="la-tw">
    <span class="la-tw-wk">Week ${wk}</span>
    <span class="la-tw-me">${laTeamIcon(A.t,'la-tm-av-sm')}<b>${escHtml(A.t.teamName||'')}</b><span class="la-tw-rec">${A.rec}</span></span>
    <span class="la-tw-score">${num(A)}<span class="la-tw-dash">–</span>${B?num(B):'<b>—</b>'}</span>
    ${B?`<span class="la-tw-opp la-clickteam" onclick="laViewTeam(${B.t.rosterId})" title="View ${escAttr(B.t.teamName||'')}’s analysis">${laTeamIcon(B.t,'la-tm-av-sm')}<b>${escHtml(B.t.teamName||'')}</b><span class="la-tw-rec">${B.rec}</span></span>`:`<span class="la-tw-opp la-tw-bye">no opponent this week</span>`}
    ${pct!=null?`<span class="la-tw-prob" title="Win probability: margin now plus what is left to play, spread by what is still on the field"><span class="la-tw-track"><i style="width:${pct}%"></i></span><b>${pct}%</b> to win${A.ytp?` · ${A.ytp} yet to play`:''}</span>`:''}
    ${std}
    <button class="btn btn-sm btn-ghost la-tw-go" onclick="laSetTab('season')">matchup ›</button>
  </div>`;
}

function _laThisWeekChopHTML(s, mineEng, wk, data){
  const ctx={ meta:_laRosterMeta(s), pm:laProjMap(), dvp:(typeof laDvpTable==='function')?laDvpTable():null, cur:laCurrentWeek(), teamBy:{} };
  (s.teamList||[]).forEach(t=>{ ctx.teamBy[t.rosterId]=t; });
  const gone=laChopEliminated(s, wk);
  const all=(data.rows||[]).map(r=>laChopSummarize(s, r, wk, ctx));
  const alive=all.filter(x=>!(x.rosterId in gone) && x.n>0).sort((a,b)=>a.proj-b.proj || a.pts-b.pts);
  const me=all.find(x=>x.rosterId===mineEng.t.rosterId);
  const head=`<span class="la-tw-wk">Week ${wk}</span><span class="la-tw-me">${laTeamIcon(mineEng.t,'la-tm-av-sm')}<b>${escHtml(mineEng.t.teamName||'')}</b></span>`;
  const go=`<button class="btn btn-sm btn-ghost la-tw-go" onclick="laSetTab('season')">chopping block \u203a</button>`;
  if(!me) return '';
  if(me.rosterId in gone) return `<div class="la-tw">${head}<span class="la-tw-chopped">chopped in week ${gone[me.rosterId]}</span>${go}</div>`;
  if(!alive.length || me.n===0) return `<div class="la-tw">${head}<span class="la-tw-bye">no lineup set for this week</span>${go}</div>`;
  const safe=laChopSafePct(alive)[me.rosterId];
  const fromTop=alive.length-alive.indexOf(me);
  const line=alive[0];
  const live=all.some(x=>x.pts>0);
  const num = live ? `<b>${me.pts.toFixed(1)}</b><i>proj ${me.proj.toFixed(1)}</i>` : `<b>${me.proj.toFixed(1)}</b><i>proj</i>`;
  const cls = safe==null?'' : safe>=90?'la-tw-safe-ok' : safe>=50?'la-tw-safe-warn' : 'la-tw-safe-bad';
  return `<div class="la-tw">${head}
    <span class="la-tw-score">${num}</span>
    <span class="la-tw-rank"><b>#${fromTop}</b> of ${alive.length} alive</span>
    ${safe!=null?`<span class="la-tw-prob ${cls}" title="Chance of NOT being the week\u2019s lowest score (Monte Carlo over the survivors)"><span class="la-tw-track"><i style="width:${Math.round(safe)}%"></i></span><b>${Math.round(safe)}%</b> safe${me.ytp?` \u00b7 ${me.ytp} yet to play`:''}</span>`:''}
    ${line&&line.rosterId!==me.rosterId?`<span class="la-tw-line" title="The team on the block right now">chop line: <span class="la-clickteam" onclick="laViewTeam(${line.rosterId})">${escHtml(line.name)}</span> <b>${line.proj.toFixed(1)}</b></span>`:`<span class="la-tw-line la-tw-chopped">you are on the block</span>`}
    ${go}</div>`;
}

// ── Packing the cards ────────────────────────────────────────────────────────
// The stylesheet's CSS columns are the no-script fallback; the browser balances those by
// content height and can leave one column a whole card short. This packs by MEASURED
// height instead — every card goes to the shortest column so far, in page order — which is
// what fills a wide screen edge to edge. Runs once after each render and again on resize
// (debounced); it moves nodes, never re-renders, so open popovers and inline handlers hold.
const LA_MY_COL_MIN = 600, LA_MY_GAP = 12;
function laPackMyGrid(host){
  const root=host||document;
  const grid=root.querySelector && root.querySelector('.la-my-grid');
  if(!grid || !grid.getBoundingClientRect) return;
  const items = grid._laItems || Array.from(grid.children);
  grid._laItems = items;
  const w=grid.clientWidth||0; if(!w) return;
  const n=Math.max(1, Math.floor((w+LA_MY_GAP)/(LA_MY_COL_MIN+LA_MY_GAP)));
  if(grid._laCols===n && grid.classList.contains('la-packed')) return;
  grid._laCols=n;
  grid.classList.add('la-packed');
  const cols=[]; grid.innerHTML='';
  for(let i=0;i<n;i++){ const c=document.createElement('div'); c.className='la-my-col'; grid.appendChild(c); cols.push(c); }
  // Measure at the column width, then place: shortest column first, ties to the leftmost.
  items.forEach(el=>cols[0].appendChild(el));
  const hs=items.map(el=>el.offsetHeight||0);
  const order=laPackOrder(hs, n);
  const tall=new Array(n).fill(0);
  order.forEach(i=>{ let k=0; for(let j=1;j<n;j++) if(tall[j]<tall[k]-1) k=j; cols[k].appendChild(items[i]); tall[k]+=hs[i]+LA_MY_GAP; });
}
// The order to place cards in. The first two (Power Rankings and the rankings stack) stay
// where the page put them; the rest may be reordered when that makes the columns end
// closer together. Greedy placement in page order is the baseline; every
// permutation of the tail is tried (there are at most eight cards, so a few thousand
// cheap sums) and the one with the lowest tallest column wins, ties to page order.
function laPackOrder(hs, n){
  const N=hs.length; const idx=hs.map((_,i)=>i);
  if(n<2 || N<=n) return idx;
  const fixed=idx.slice(0, Math.min(2, N)), tail=idx.slice(fixed.length);
  const score=(ord)=>{ const t=new Array(n).fill(0); ord.forEach(i=>{ let k=0; for(let j=1;j<n;j++) if(t[j]<t[k]-1) k=j; t[k]+=hs[i]+LA_MY_GAP; }); return Math.max(...t); };
  let best=fixed.concat(tail), bestS=score(best);
  const perm=(arr, m)=>{
    if(m===arr.length){ const o=fixed.concat(arr); const sc=score(o); if(sc<bestS-1){ bestS=sc; best=o.slice(); } return; }
    for(let i=m;i<arr.length;i++){ [arr[m],arr[i]]=[arr[i],arr[m]]; perm(arr,m+1); [arr[m],arr[i]]=[arr[i],arr[m]]; }
  };
  if(tail.length<=8) perm(tail.slice(), 0);
  return best;
}
if(typeof window!=='undefined' && window.addEventListener){
  let _laPackT=null;
  window.addEventListener('resize', ()=>{ if(_laPackT) clearTimeout(_laPackT);
    _laPackT=setTimeout(()=>{ const g=document.querySelector('.la-my-grid'); if(g){ g._laCols=null; laPackMyGrid(document); } }, 150); }, {passive:true});
}
