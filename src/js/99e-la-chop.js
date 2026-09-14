// ═════════════════════════════════════════════════════════════════════════════
// Chopped leagues — the Chopping Block (Sleeper type 3: the lowest score each week is out)
// ═════════════════════════════════════════════════════════════════════════════
// No head-to-head: every team plays the field, and the week's lowest total is chopped. So
// the in-season pane is the block, the way Sleeper draws it — every surviving team ranked
// by its projected finish, a Safe % (the chance it is NOT the week's lowest), how many
// starters have played, the points banked with the projection under them — in three bands:
// CHOP ZONE (the lowest projection), DANGER (the next few), SAFE (the rest). Teams already
// chopped sit at the bottom with the week they went.
//
// Safe % is a Monte Carlo over the survivors: each team's final ~ Normal(points banked +
// projection left, spread from what is left to play — the Matchup pane's own model), and a
// team's danger is the share of draws in which it finishes lowest. A team whose starters
// have all played has no spread left; three locked lower scores make it 100% safe.
const LA_CHOP_SIMS = 4000;
const LA_CHOP_DANGER = 3;      // rows shown as DANGER behind the chop zone

function laIsChopped(s){ return !!(s && Number(s.leagueType)===3); }

// A team's week, from its matchup row: points banked, projection left, starters yet to play.
function laChopSummarize(s, row, wk, ctx){
  const t=ctx.teamBy[row.roster_id]||{};
  const starters=(row.starters||[]).filter(x=>x&&x!=='0'), pts=row.starters_points||[];
  let rem=0, ytp=0;
  (row.starters||[]).forEach((pid,i)=>{
    if(!pid||pid==='0') return;
    const p=_laPidMeta(ctx.meta,pid); const a=laAdjWeekProj(p,wk,ctx.pm,ctx.dvp);
    const started=laGameStarted(p.team, wk);
    const played = started===true || (started===null && (pts[i]||0)>0) || wk<ctx.cur;
    if(!played){ rem+=a.adj; ytp++; }
  });
  return { rosterId:row.roster_id, t, name:t.teamName||`Roster ${row.roster_id}`, pts:Number(row.points||0), rem, ytp, n:starters.length, proj:Number(row.points||0)+rem };
}

// Safe % per roster id. Deterministic (a fixed-seed generator) so a re-render never
// flickers and the tests can pin it.
function laChopSafePct(sums){
  const alive=sums.filter(x=>x.n>0);
  const out={};
  if(alive.length<2){ alive.forEach(x=>{ out[x.rosterId]=100; }); return out; }
  let seed=0x2F6E2B1;
  const rnd=()=>{ seed=(seed*1664525+1013904223)>>>0; return (seed+0.5)/4294967296; };
  const gauss=()=>{ const u=rnd(), v=rnd(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };
  const sd=alive.map(x=>x.rem>0 ? 0.45*x.rem+1.5 : 0.01);
  const low=new Array(alive.length).fill(0);
  for(let k=0;k<LA_CHOP_SIMS;k++){
    let mi=0, mv=Infinity;
    for(let i=0;i<alive.length;i++){ const v=alive[i].proj+sd[i]*gauss(); if(v<mv){ mv=v; mi=i; } }
    low[mi]++;
  }
  alive.forEach((x,i)=>{ out[x.rosterId]=Math.round((1-low[i]/LA_CHOP_SIMS)*1000)/10; });
  return out;
}

// Who is already out: for each completed week since the start, the lowest total among the
// teams still alive was chopped (Sleeper keeps the roster; the week's rows say who scored
// least). Weeks not yet fetched are asked for; until they land the team is listed as alive.
function laChopEliminated(s, wk){
  const out={}; let alive=new Set((s.teamList||[]).map(t=>t.rosterId));
  const start=Math.max(1, Number((s.chop&&s.chop.startWeek)||1));
  for(let w=start; w<wk; w++){
    const d=_laMu.byWeek[w];
    if(!d){ if(typeof laFetchMatchups==='function') laFetchMatchups(w, true); continue; }
    const rows=(d.rows||[]).filter(r=>alive.has(r.roster_id) && (r.starters||[]).some(x=>x&&x!=='0'));
    if(rows.length<2 || !rows.some(r=>Number(r.points||0)>0)) continue;
    const lowest=rows.slice().sort((a,b)=>Number(a.points||0)-Number(b.points||0))[0];
    out[lowest.roster_id]=w; alive.delete(lowest.roster_id);
  }
  return out;
}

function laChopView(s){
  if(s.provider==='espn') return _laEspnInseasonNote();
  const wk=laMuWeek(), cur=laCurrentWeek();
  const weekSel = `<select class="la-tc-sel la-wk-sel" onchange="laSetMuWeek(this.value)">
    ${Array.from({length:cur},(_,i)=>cur-i).map(w=>`<option value="${w}" ${w===wk?'selected':''}>Week ${w}${w===cur?' · current':''}</option>`).join('')}</select>`;
  const head=`<div class="la-ins-bar"><span class="la-ins-lbl">CHOPPING BLOCK</span>${weekSel}${wk===cur?`<span class="draft-live">LIVE</span>`:''}</div>`;
  const data=_laMu.byWeek[wk];
  if(!data){ laFetchMatchups(wk); return `${head}<div class="card la-ins-empty"><div class="empty-body">Loading week ${wk}…</div></div>`; }
  if(!data.rows.length) return `${head}<div class="card la-ins-empty"><div class="empty-body">No scores for week ${wk} yet.</div></div>`;
  const ctx={ meta:_laRosterMeta(s), pm:laProjMap(), dvp:laDvpTable(), cur, teamBy:{} };
  if(!ctx.dvp) _laSidecarKick();
  (s.teamList||[]).forEach(t=>{ ctx.teamBy[t.rosterId]=t; });
  const gone=laChopEliminated(s, wk);
  const my=_laMyTeamRow(s);
  const all=data.rows.map(r=>laChopSummarize(s, r, wk, ctx));
  const alive=all.filter(x=>!(x.rosterId in gone) && x.n>0).sort((a,b)=>a.proj-b.proj || a.pts-b.pts);
  const chopped=all.filter(x=>x.rosterId in gone).sort((a,b)=>gone[a.rosterId]-gone[b.rosterId]);
  const safe=laChopSafePct(alive);
  const lastLeg=Number((s.chop&&s.chop.lastLeg)||0);
  const done = alive.length && alive.every(x=>x.ytp===0);
  const row=(x, rankFromBottom, band)=>{
    const mine = my && x.rosterId===my.rosterId;
    const sp=safe[x.rosterId]; const pct=sp==null?null:sp;
    const played=x.n-x.ytp;
    const barCls = pct==null?'' : pct>=90?'la-chop-ok' : pct>=50?'la-chop-warn' : 'la-chop-bad';
    return `<div class="la-chop-row la-chop-${band} ${mine?'la-chop-mine':''}">
      <span class="la-chop-rank">${rankFromBottom}</span>
      ${laTeamAvatar(x.t,'la-mu-av-sm')}
      <span class="la-chop-team"><span class="la-chop-name">${escHtml(x.name)}</span><span class="la-chop-owner">${laOwnerHandle(x.t)}${mine?' · you':''}</span></span>
      <span class="la-chop-sp" title="${escAttr(`Chance of NOT being this week's lowest score — ${x.ytp?`${x.ytp} starter${x.ytp===1?'':'s'} still to play, ${x.rem.toFixed(1)} projected left`:'all starters done'}`)}">
        <span class="la-chop-bar"><span class="la-chop-fill ${barCls}" style="width:${pct==null?0:Math.max(2,pct)}%"></span></span>
        <span class="la-chop-pct ${barCls}">${pct==null?'—':(done ? (pct>=50?'safe':'chopped') : (pct>=99.95?'100%':pct<0.05?'<0.1%':pct.toFixed(pct<1||pct>99?1:0)+'%'))}</span></span>
      <span class="la-chop-played">${played}/${x.n}</span>
      <span class="la-chop-pts"><b>${x.pts.toFixed(2)}</b><small>${x.ytp?x.proj.toFixed(2):'final'}</small></span>
    </div>`;
  };
  const n=alive.length;
  const bands=[];
  if(n){
    bands.push(`<div class="la-chop-band la-chop-band-chop"><span>CHOP ZONE</span></div>`+row(alive[0], n, 'chop'));
    const danger=alive.slice(1, 1+LA_CHOP_DANGER);
    if(danger.length) bands.push(`<div class="la-chop-band la-chop-band-danger"><span>DANGER</span></div>`+danger.map((x,i)=>row(x, n-1-i, 'danger')).join(''));
    const safeRows=alive.slice(1+LA_CHOP_DANGER);
    if(safeRows.length) bands.push(`<div class="la-chop-band la-chop-band-safe"><span>SAFE</span></div>`+safeRows.map((x,i)=>row(x, n-1-LA_CHOP_DANGER-i, 'safe')).join(''));
  }
  if(chopped.length) bands.push(`<div class="la-chop-band la-chop-band-gone"><span>CHOPPED</span></div>`+chopped.map(x=>`<div class="la-chop-row la-chop-gone ${my&&x.rosterId===my.rosterId?'la-chop-mine':''}"><span class="la-chop-rank">✕</span>${laTeamAvatar(x.t,'la-mu-av-sm')}<span class="la-chop-team"><span class="la-chop-name">${escHtml(x.name)}</span><span class="la-chop-owner">${laOwnerHandle(x.t)} · chopped week ${gone[x.rosterId]}</span></span><span class="la-chop-pts"><b>${x.pts.toFixed(2)}</b><small>wk ${wk}</small></span></div>`).join(''));
  const mineSum = my ? alive.find(x=>x.rosterId===my.rosterId) : null;
  const mineNote = mineSum ? `<div class="la-chop-me">You: <b>${(safe[mineSum.rosterId]!=null?safe[mineSum.rosterId].toFixed(0):'—')}% safe</b> · ${ordinal(n-alive.indexOf(mineSum))} of ${n} by projection · ${mineSum.ytp?`${mineSum.ytp} to play, ${mineSum.rem.toFixed(1)} projected left`:'all done'}</div>`
    : (my && gone[my.rosterId] ? `<div class="la-chop-me">You were chopped in week ${gone[my.rosterId]}.</div>` : '');
  return `${head}
    <div class="card la-chop">
      <div class="la-chop-head"><span class="la-ins-sub">${n} alive · ${chopped.length} chopped${lastLeg?` · chops through week ${lastLeg}`:''}</span><span class="la-ins-sub">safe % · played · points / projected</span></div>
      ${mineNote}
      <div class="la-chop-cols"><span></span><span></span><span>team</span><span>safe %</span><span>played</span><span>pts</span></div>
      ${bands.join('')}
    </div>
    <div class="la-note la-note-min">${(typeof tcInfoBtn==='function')?tcInfoBtn('lachop','How safe % works'):''}</div>`;
}

if(typeof TC_INFO_BOOK!=='undefined'){
  TC_INFO_BOOK.lachop={title:'The chopping block', body:`
    A Chopped league has no matchups: every team plays the field and the week's lowest total
    is out. Teams are ranked by their projected finish — points banked plus the same
    week-adjusted projection the Lineup pane uses for every starter still to play. <b>Safe %</b>
    is the chance a team is NOT the week's lowest: a few thousand draws of every survivor's
    finish around its projection, the spread from what it has left to play, so a team whose
    starters are all done has no spread and a locked lower score makes it 100%. Chopped
    teams are read off the finished weeks: the lowest total among those still alive.`};
}
