// ═════════════════════════════════════════════════════════════════════════════
// BAFL matchups — the ../bafl matchup card, brought into the League Analyzer.
// ═════════════════════════════════════════════════════════════════════════════
// BAFL isn't scored on points: a matchup is five categories (passing yards −20 per INT,
// rushing yards, receiving yards, touchdowns, kicking = XPM + 3×FGM + 2×two-point) and the
// team taking more of them wins, level counts broken on total yards. The BAFL app we built
// renders that as one card: score–name vs name–score, a win-probability bar, a PROJECTED
// line naming the categories still in play, then the five categories with a tick beside the
// side that holds each one, projected finishes under the live numbers, and total yards last.
// This module is that card, fed by the same Sleeper feeds (week stats, week projections, the
// schedule for game state, ESPN for the clock), so the analyzer's Matchup pane reads exactly
// like the app when BAFL Mode is on. The model is 59-winprob.js / 58-projections.js there.
var _laBafl = { byWeek:{}, ref:'' };
const LA_BAFL_MC_CATS = [
  { key:'passing',   label:'Passing',    short:'PASS' },
  { key:'receiving', label:'Receiving',  short:'REC'  },
  { key:'rushing',   label:'Rushing',    short:'RUSH' },
  { key:'tds',       label:'Touchdowns', short:'TD'   },
  { key:'kicking',   label:'Kicking',    short:'KICK' },
];
const LA_BAFL_YARD_CATS = ['passing','rushing','receiving'];
const LA_BAFL_POS = ['QB','RB','WR','TE','K'];
const LA_BAFL_PROJ_TTL = 30*60*1000;   // Sleeper revises projections through the week
const LA_BAFL_LIVE_TTL = 40*1000;      // stats + game state ride the 45s score poll
const LA_BAFL_PROJ_URL = (season, week)=>`https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=regular`+LA_BAFL_POS.map(p=>`&position[]=${p}`).join('');
const LA_BAFL_SCHED_URL = (season)=>`https://api.sleeper.app/schedule/nfl/regular/${season}`;
const LA_BAFL_ESPN_URL = (season, week)=>`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`;
const LA_BAFL_ESPN_TEAM = { WSH:'WAS' };
// How far a full-game projection typically misses, as a share of itself (yardage) — TDs are
// Poisson-like, variance = mean. The unplayed share of a game carries that share of variance.
const LA_BAFL_PROJ_CV = { passing:0.32, rushing:0.55, receiving:0.6, kicking:0.5 };
const LA_BAFL_SWING_PCT = 0.08, LA_BAFL_SWING_MAX = 3;

function laBaflActive(){ return typeof scoringSettings!=='undefined' && !!scoringSettings.baflMode; }

// One Sleeper stat line → its BAFL category contribution (weekly feed and projection rows
// share field names, so projections run through the same math as actuals).
function laBaflCatsOf(ps){
  ps = ps || {};
  return {
    passing:   (ps.pass_yd||0) - (ps.pass_int||0)*20,
    rushing:   (ps.rush_yd||0),
    receiving: (ps.rec_yd||0),
    tds:       (ps.pass_td||0) + (ps.rec_td||0) + (ps.rush_td||0),
    kicking:   (ps.xpm||0) + (ps.fgm||0)*3 + ((ps.pass_2pt||0)+(ps.rec_2pt||0)+(ps.rush_2pt||0))*2,
  };
}
function laBaflTotalYards(c){ return (c.passing||0)+(c.rushing||0)+(c.receiving||0); }

// Per-roster category totals from the week's matchup rows + the week's stats dict.
function laBaflCatStats(rows, stats){
  const cs={}; LA_BAFL_MC_CATS.forEach(c=>{ cs[c.key]={}; });
  rows.forEach(m=>{ LA_BAFL_MC_CATS.forEach(c=>{ cs[c.key][m.roster_id]=0; }); });
  rows.forEach(m=>{
    const rid=m.roster_id, pp=m.players_points||{};
    (m.starters||[]).forEach(pid=>{
      if(!pid || pid==='0' || !(pid in pp)) return;    // did not participate
      const c=laBaflCatsOf((stats||{})[pid]);
      LA_BAFL_MC_CATS.forEach(k=>{ cs[k.key][rid]+=c[k.key]; });
    });
  });
  return cs;
}
function _laBaflCmp(a,b){ return a>b?0:b>a?1:2; }   // 0 = rid1, 1 = rid2, 2 = level
function laBaflResult(cs, r1, r2){
  const v=(k,r)=>(cs[k]&&cs[k][r])||0;
  const cats={};
  LA_BAFL_MC_CATS.forEach(c=>{ cats[c.label]=_laBaflCmp(v(c.key,r1), v(c.key,r2)); });
  let s1=0, s2=0; Object.values(cats).forEach(x=>{ if(x===0) s1++; else if(x===1) s2++; });
  const ty1=LA_BAFL_YARD_CATS.reduce((s,k)=>s+v(k,r1),0), ty2=LA_BAFL_YARD_CATS.reduce((s,k)=>s+v(k,r2),0);
  const tie=s1===s2, tb1=tie&&ty1>ty2, tb2=tie&&ty2>ty1;
  return { cats, s1, s2, s1dec:s1+(tb1?.5:0), s2dec:s2+(tb2?.5:0), ty1, ty2, tb1, tb2 };
}

// ── Projections: what has happened plus what is still to come ───────────────
function _laBaflEspnRem(st){
  const state=st&&st.type&&st.type.state;
  if(state==='post') return 0;
  if(state!=='in') return 1;
  const period=Number(st.period||1), clock=Number(st.clock||0);
  if(period>=5) return Math.max(0.02, Math.min(0.15, clock/3600));
  return Math.max(0.02, Math.min(1, ((4-period)*900+clock)/3600));
}
// Game state for one week: game_id → share still unplayed (+ by team as a fallback).
function laBaflGameProgress(sched, board, week){
  const espn={};
  ((board&&Array.isArray(board.events))?board.events:[]).forEach(ev=>{
    const comp=ev.competitions&&ev.competitions[0]; if(!comp) return;
    const side=ha=>(comp.competitors||[]).find(x=>x.homeAway===ha);
    const code=ha=>{ const s=side(ha); const a=s&&s.team&&s.team.abbreviation; return a?(LA_BAFL_ESPN_TEAM[a]||a):''; };
    const home=code('home'), away=code('away'); if(!home) return;
    espn[home]={ rem:_laBaflEspnRem(comp.status||ev.status), away };
  });
  const rem={}, byTeam={}, seen=new Set(); let games=0, done=0;
  (Array.isArray(sched)?sched:[]).forEach(g=>{
    if(Number(g.week)!==Number(week) || !g.game_id) return;
    const st=String(g.status||'').toLowerCase(), e=espn[g.home];
    const r = st==='complete' ? 0 : e ? e.rem : st.startsWith('in') ? 0.5 : 1;
    rem[String(g.game_id)]=r; if(g.home) byTeam[g.home]=r; if(g.away) byTeam[g.away]=r; seen.add(g.home);
    games++; if(r===0) done++;
  });
  Object.keys(espn).forEach(home=>{ if(seen.has(home)) return; const e=espn[home]; byTeam[home]=e.rem; if(e.away) byTeam[e.away]=e.rem; games++; if(e.rem===0) done++; });
  return { rem, byTeam, weekDone: games>0 && done===games };
}
function _laBaflGameRem(prog, gameId, team){
  if(!prog) return 1;
  if(gameId!=null && prog.rem[String(gameId)]!=null) return prog.rem[String(gameId)];
  if(team && prog.byTeam[team]!=null) return prog.byTeam[team];
  return prog.weekDone ? 0 : 1;
}
function _laBaflVar(key, proj, rem){
  if(rem<=0 || !proj) return 0;
  const m=Math.abs(proj);
  return key==='tds' ? rem*m : rem*Math.pow(LA_BAFL_PROJ_CV[key]*m, 2);
}
// Blended per-roster category totals in the cs shape, plus var (unplayed variance) and rem
// (starter-games still unplayed; 0 = that lineup is finished).
function laBaflBlend(rows, stats, proj, prog){
  const out={ var:{}, rem:{} };
  LA_BAFL_MC_CATS.forEach(c=>{ out[c.key]={}; out.var[c.key]={}; });
  rows.forEach(m=>{
    const rid=m.roster_id; out.rem[rid]=0;
    LA_BAFL_MC_CATS.forEach(c=>{ out[c.key][rid]=0; out.var[c.key][rid]=0; });
    (m.starters||[]).forEach(pid=>{
      if(!pid || pid==='0') return;
      const act=laBaflCatsOf((stats||{})[pid]);
      const prow=proj.stats[pid], pc=laBaflCatsOf(prow);
      const r=prow ? _laBaflGameRem(prog, proj.game[pid], proj.team[pid]) : 0;
      out.rem[rid]+=r;
      LA_BAFL_MC_CATS.forEach(c=>{ out[c.key][rid]+=act[c.key]+r*pc[c.key]; out.var[c.key][rid]+=_laBaflVar(c.key, pc[c.key], r); });
    });
  });
  return out;
}

// ── Win probability: five normal draws, combined exactly, level → total yards ──
function _laBaflCatOutcome(mu, variance){
  if(!(variance>0)) return mu>0?{w1:1,w2:0,tie:0}:mu<0?{w1:0,w2:1,tie:0}:{w1:0,w2:0,tie:1};
  const sd=Math.sqrt(variance);
  const w1=1-_laNormCdf((0.5-mu)/sd), w2=_laNormCdf((-0.5-mu)/sd);
  return { w1, w2, tie:Math.max(0,1-w1-w2) };
}
function laBaflWinProb(pcs, r1, r2){
  const v=pcs.var||{};
  const gap=k=>(pcs[k][r1]||0)-(pcs[k][r2]||0);
  const vsum=k=>((v[k]||{})[r1]||0)+((v[k]||{})[r2]||0);
  let dist=new Map([['0,0',1]]);
  LA_BAFL_MC_CATS.forEach(c=>{
    const o=_laBaflCatOutcome(gap(c.key), vsum(c.key)); const next=new Map();
    const add=(k,p)=>{ if(p>0) next.set(k,(next.get(k)||0)+p); };
    dist.forEach((p,k)=>{ const [a,b]=k.split(',').map(Number); add(`${a+1},${b}`,p*o.w1); add(`${a},${b+1}`,p*o.w2); add(`${a},${b}`,p*o.tie); });
    dist=next;
  });
  const ty=_laBaflCatOutcome(LA_BAFL_YARD_CATS.reduce((s,k)=>s+gap(k),0), LA_BAFL_YARD_CATS.reduce((s,k)=>s+vsum(k),0));
  let p1=0, p2=0;
  dist.forEach((p,k)=>{ const [a,b]=k.split(',').map(Number); if(a>b) p1+=p; else if(b>a) p2+=p; else { p1+=p*(ty.w1+ty.tie/2); p2+=p*(ty.w2+ty.tie/2); } });
  return { p1, p2 };
}
function laBaflDecidedWP(r){ return r.s1dec>r.s2dec?{p1:1,p2:0}:r.s2dec>r.s1dec?{p1:0,p2:1}:{p1:.5,p2:.5}; }
function laBaflWinBarHTML(wp, decided){
  let a=Math.round(wp.p1*100); if(!decided) a=Math.min(99, Math.max(1, a));
  const b=100-a;
  const tip=decided?'Final':'Chance to win — live totals plus the unplayed share of every starter\'s projection';
  // Colour says who leads: green for the side with the better chance, red for the other,
  // grey when it is dead level.
  const side=a>b?' lead1':b>a?' lead2':' even';
  return `<div class="la-mc-wp${decided?' decided':''}${side}" title="${escAttr(tip)}" role="img" aria-label="${escAttr(`Win chance ${a}% to ${b}%`)}">
    <span class="la-mc-wp-pct${a>=b?' lead':''}">${a}%</span>
    <div class="la-mc-wp-track"><div class="la-mc-wp-fill" style="width:${a}%"></div></div>
    <span class="la-mc-wp-pct la-mc-wp-pct-r${b>=a?' lead':''}">${b}%</span>
  </div>`;
}
function laBaflSwing(pcs, r1, r2){
  const close=[];
  LA_BAFL_MC_CATS.forEach(c=>{ const a=pcs[c.key][r1]||0, b=pcs[c.key][r2]||0, hi=Math.max(a,b); if(hi<=0) return; const gap=Math.abs(a-b)/hi; if(gap<=LA_BAFL_SWING_PCT) close.push({label:c.label, gap}); });
  close.sort((x,y)=>x.gap-y.gap);
  return { list:close.slice(0,LA_BAFL_SWING_MAX).map(c=>c.label), all:close.length===LA_BAFL_MC_CATS.length };
}
function laBaflProjBarHTML(pcs, r1, r2){
  const r=laBaflResult(pcs, r1, r2), sw=laBaflSwing(pcs, r1, r2);
  const tip=`Projected gap under ${Math.round(LA_BAFL_SWING_PCT*100)}% — still winnable`;
  const swing = sw.all ? `<span class="la-proj-swing" title="${escAttr(tip)}">every category in play</span>`
    : sw.list.length ? `<span class="la-proj-swing" title="${escAttr(tip)}">${escHtml(sw.list.join(' · '))} in play</span>` : '';
  return `<div class="la-proj-bar"><span class="la-proj-lbl">PROJECTED</span><span class="la-proj-score">${r.s1}<span class="la-proj-dash">–</span>${r.s2}</span>${swing}</div>`;
}

// ── The card ─────────────────────────────────────────────────────────────────
// cs = live category totals (null while the week's stats are still loading); pcs = blended
// projections, only while either side still has football to play. opts: {mine, focus, onclick}.
function laBaflMatchupCard(r1, r2, cs, pcs, nameOf, opts){
  opts=opts||{};
  const name=rid=>escHtml(nameOf(rid));
  const cls=['la-mc', opts.mine?'la-mc-mine':'', opts.focus?'la-mc-focus':'', opts.onclick?'la-mc-pick':''].filter(Boolean).join(' ');
  const attrs=opts.onclick?` onclick="${opts.onclick}" title="Show this matchup up top"`:'';
  if(!cs){
    return `<div class="${cls}"${attrs}>
      <div class="la-mc-head"><div class="la-mc-side"><span class="la-mc-score tie">–</span><span class="la-mc-team">${name(r1)}</span></div><span class="la-mc-vs">vs</span><div class="la-mc-side la-mc-side-r"><span class="la-mc-team">${name(r2)}</span><span class="la-mc-score tie">–</span></div></div>
      <div class="la-mc-loading">loading the week's stat lines…</div></div>`;
  }
  const r=laBaflResult(cs, r1, r2);
  const live=!!(pcs && ((pcs.rem[r1]||0)>0 || (pcs.rem[r2]||0)>0));
  const wp = live ? laBaflWinProb(pcs, r1, r2) : laBaflDecidedWP(r);
  if(!live) pcs=null;
  const s1s=r.tb1?`${r.s1}*`:String(r.s1), s2s=r.tb2?`${r.s2}*`:String(r.s2);
  const c1=r.s1dec>r.s2dec?'win':r.s1dec<r.s2dec?'loss':'tie', c2=r.s2dec>r.s1dec?'win':r.s2dec<r.s1dec?'loss':'tie';
  const tbTip='Category tie broken on total yards';
  const rows=LA_BAFL_MC_CATS.map(c=>{
    const cr=r.cats[c.label], v1=cs[c.key][r1]||0, v2=cs[c.key][r2]||0;
    let p1='', p2='', pchk1='', pchk2='';
    if(pcs){
      const pv1=pcs[c.key][r1]||0, pv2=pcs[c.key][r2]||0;
      p1=`<span class="la-mc-proj">→${Math.round(pv1)}</span>`; p2=`<span class="la-mc-proj">→${Math.round(pv2)}</span>`;
      const pwin=pv1>pv2?0:pv2>pv1?1:2;
      if(pwin===0 && cr!==0) pchk1='<span class="la-mc-pchk" title="Projected to win this category">○</span>';
      if(pwin===1 && cr!==1) pchk2='<span class="la-mc-pchk" title="Projected to win this category">○</span>';
    }
    const chk='<span class="la-mc-tick">✔</span>';
    return `<tr><td class="la-mc-chk">${cr===0?chk:pchk1}</td><td class="la-mc-val">${Math.round(v1)}${p1}</td><td class="la-mc-cat">${c.label}</td><td class="la-mc-val la-mc-val-r">${Math.round(v2)}${p2}</td><td class="la-mc-chk la-mc-chk-r">${cr===1?chk:pchk2}</td></tr>`;
  }).join('');
  let pt1='', pt2='';
  if(pcs){ const pr=laBaflResult(pcs, r1, r2); pt1=`<span class="la-mc-proj">→${Math.round(pr.ty1)}</span>`; pt2=`<span class="la-mc-proj">→${Math.round(pr.ty2)}</span>`; }
  return `<div class="${cls}"${attrs}>
    <div class="la-mc-head">
      <div class="la-mc-side"><span class="la-mc-score ${c1}"${r.tb1?` title="${escAttr(tbTip)}"`:''}>${s1s}</span><span class="la-mc-team">${name(r1)}</span></div>
      <span class="la-mc-vs">vs</span>
      <div class="la-mc-side la-mc-side-r"><span class="la-mc-team">${name(r2)}</span><span class="la-mc-score ${c2}"${r.tb2?` title="${escAttr(tbTip)}"`:''}>${s2s}</span></div>
    </div>
    ${laBaflWinBarHTML(wp, !live)}
    ${pcs?laBaflProjBarHTML(pcs, r1, r2):''}
    <div class="la-mc-table-scroll"><table class="la-mc-tbl"><tbody>
      ${rows}
      <tr class="la-mc-total"><td></td><td class="la-mc-val">${Math.round(r.ty1)}${pt1}</td><td class="la-mc-cat">Total Yards</td><td class="la-mc-val la-mc-val-r">${Math.round(r.ty2)}${pt2}</td><td></td></tr>
    </tbody></table></div>
  </div>`;
}

// ── Feeds: week stats (every position BAFL starts), week projections, game state ──
// Live results render first and projections patch in; a feed that fails leaves the card
// exactly as correct as it was. Returns {stats, pcsFor(rows)} synchronously from the cache
// and kicks off whatever is stale; landings re-render the pane if it is still in view.
function laBaflWeekData(wk){
  const s=(typeof leagueSnapshot!=='undefined')&&leagueSnapshot; if(!s) return {stats:null, proj:null, prog:null};
  const ref=(typeof laSnapshotRef==='function')?laSnapshotRef(s):s.leagueId;
  if(_laBafl.ref!==ref){ _laBafl.byWeek={}; _laBafl.ref=ref; }
  const season=s.season||(typeof TC_SEASON!=='undefined'&&TC_SEASON.year);
  const d=_laBafl.byWeek[wk]=_laBafl.byWeek[wk]||{ stats:null, statsAt:0, proj:null, projAt:0, prog:null, progAt:0, busy:{} };
  const now=Date.now(), current=(typeof laCurrentWeek==='function')&&wk===laCurrentWeek();
  const stillHere=()=>(typeof laSnapshotRef!=='function'||laSnapshotRef()===ref) && (typeof laActivePane!=='function'||['matchup','lineup'].includes(laActivePane())) && laMuWeek()===wk;
  const land=(what)=>{ if(stillHere() && typeof _laInsRerender==='function') _laInsRerender(); };
  // Stats: completed weeks are immutable (fetchWeekStats caches them for good); the current
  // week is re-read on the poll's cadence, straight from Sleeper.
  if(!d.busy.stats && (!d.stats || (current && now-d.statsAt>LA_BAFL_LIVE_TTL))){
    d.busy.stats=true;
    const tasks=LA_BAFL_POS.map(pos=>()=> (current||typeof fetchWeekStats!=='function') ? sleeperFetch(SLEEPER_WEEK_STATS_URL(season, wk, pos)) : fetchWeekStats(season, wk, pos));
    ((typeof _tcPool==='function')?_tcPool(tasks,3):Promise.all(tasks.map(t=>t().catch(()=>null)))).then(parts=>{
      const stats={}; let n=0;
      (parts||[]).forEach(rows=>(rows||[]).forEach(r=>{ const pid=r.player_id||(r.player&&r.player.player_id); if(pid&&r.stats){ stats[String(pid)]=r.stats; n++; } }));
      if(n){ const sig=JSON.stringify(Object.keys(stats).length)+':'+n; const changed=sig!==d.statsSig || !d.stats; d.stats=stats; d.statsSig=sig; d.statsAt=Date.now(); if(changed||current) land('stats'); }
    }).catch(()=>{}).finally(()=>{ d.busy.stats=false; });
  }
  // Projections + game state only matter for the current week — a past week's actuals ARE the finish.
  if(current){
    if(!d.busy.proj && (!d.proj || now-d.projAt>LA_BAFL_PROJ_TTL)){
      d.busy.proj=true;
      sleeperFetch(LA_BAFL_PROJ_URL(season, wk)).then(rows=>{
        const stats={}, game={}, team={};
        (rows||[]).forEach(r=>{ const pid=r.player_id||(r.player&&r.player.player_id); if(!pid||!r.stats) return; stats[String(pid)]=r.stats; if(r.game_id) game[String(pid)]=String(r.game_id); if(r.team) team[String(pid)]=String(r.team); });
        if(Object.keys(stats).length){ d.proj={stats, game, team}; d.projAt=Date.now(); land('proj'); }
      }).catch(()=>{}).finally(()=>{ d.busy.proj=false; });
    }
    if(!d.busy.prog && (!d.prog || now-d.progAt>LA_BAFL_LIVE_TTL)){
      d.busy.prog=true;
      const soft=u=>sleeperFetch(u).catch(()=>null);
      Promise.all([soft(LA_BAFL_SCHED_URL(season)), soft(LA_BAFL_ESPN_URL(season, wk))]).then(([sched, board])=>{
        d.prog=laBaflGameProgress(sched, board, wk); d.progAt=Date.now();
        if(d.proj) land('prog');
      }).catch(()=>{}).finally(()=>{ d.busy.prog=false; });
    }
  }
  return { stats:d.stats, proj:current?d.proj:null, prog:current?d.prog:null };
}
// Blended projections for the rows in view, or null when they don't apply / haven't landed.
function laBaflProjFor(rows, wd){
  if(!wd || !wd.proj || !wd.stats) return null;
  return laBaflBlend(rows, wd.stats, wd.proj, wd.prog);
}

// ── Per-player lines: what he is projected for, in the categories the matchup is decided on ──
// A points league prints one number per player; BAFL is decided on yards, touchdowns and
// kicks, so every per-player slot in the analyzer prints the stat line instead — the BAFL
// app's roster-modal style ("284yd · 2TD · 1INT", "88rush · 24rec · 1TD", "2/2XP · 1/2FG").
// The projected line is Sleeper's full-week line per starter, blended exactly as the card
// blends it (what has happened plus the unplayed share of the rest); before Sleeper's line
// lands it falls back to the projection board's per-game rates times the Lineup pane's
// matchup/form multiplier, so the line is never blank for a skill player.
const LA_BAFL_LINE_FIELDS=['pass_att','pass_yd','pass_td','pass_int','rush_att','rush_yd','rush_td','rec','rec_tgt','rec_yd','rec_td','xpm','xpa','fgm','fga','pass_2pt','rush_2pt','rec_2pt'];
function laBaflStatLine(ps, pos, projected){
  if(!ps) return '';
  const n=v=>String(Math.round(+v||0));
  const d1=v=>{ v=+v||0; return Math.abs(v-Math.round(v))<0.05?String(Math.round(v)):v.toFixed(1); };
  const tds=(ps.pass_td||0)+(ps.rush_td||0)+(ps.rec_td||0);
  const P=String(pos||'').toUpperCase(), parts=[];
  const passing=(ps.pass_att||0)>0||(ps.pass_yd||0)>0, rushing=(ps.rush_att||0)>0||(ps.rush_yd||0)>0, receiving=(ps.rec_tgt||0)>0||(ps.rec_yd||0)>0||(ps.rec||0)>0, kicking=(ps.xpa||0)>0||(ps.fga||0)>0||(ps.xpm||0)>0||(ps.fgm||0)>0;
  if(P==='QB' || (passing && P!=='RB' && P!=='WR' && P!=='TE' && P!=='K')){
    if(!passing && !rushing) return '';
    parts.push(`${n(ps.pass_yd)}yd`);
    if(tds) parts.push(`${d1(tds)}TD`);
    if(ps.pass_int) parts.push(`${d1(ps.pass_int)}INT`);
    if((ps.rush_yd||0)>0) parts.push(`${n(ps.rush_yd)}rush`);
  } else if(P==='K'){
    if(!kicking) return '';
    parts.push(projected ? `${d1(ps.xpm)}XP` : `${n(ps.xpm)}/${n(ps.xpa)}XP`);
    parts.push(projected ? `${d1(ps.fgm)}FG` : `${n(ps.fgm)}/${n(ps.fga)}FG`);
  } else if(P==='RB' || (rushing && !receiving)){
    if(!rushing && !receiving) return '';
    parts.push(`${n(ps.rush_yd)}rush`);
    if(receiving) parts.push(projected ? `${n(ps.rec_yd)}rec` : `${n(ps.rec)}/${n(ps.rec_tgt)} ${n(ps.rec_yd)}rec`);
    if(tds) parts.push(`${d1(tds)}TD`);
  } else {
    if(!receiving && !rushing) return '';
    parts.push(projected ? `${n(ps.rec_yd)}yd` : `${n(ps.rec)}/${n(ps.rec_tgt)} ${n(ps.rec_yd)}yd`);
    if(tds) parts.push(`${d1(tds)}TD`);
    if((ps.rush_yd||0)>0) parts.push(`${n(ps.rush_yd)}rush`);
  }
  return parts.join(' · ');
}
// The projection board, keyed by Sleeper id and by name|pos, for the pre-Sleeper fallback.
function _laBaflBoard(){
  const now=Date.now();
  if(_laBafl.board && now-_laBafl.boardAt<60000) return _laBafl.board;
  const byId=new Map(), byName=new Map();
  try{ (typeof buildProjectionList==='function'?buildProjectionList():[]).forEach(r=>{ if(r.player_id!=null) byId.set(String(r.player_id), r); byName.set((typeof ecrNormName==='function'?ecrNormName(r.name):String(r.name||'').toLowerCase())+'|'+r.pos, r); }); }catch(e){}
  _laBafl.board={byId, byName}; _laBafl.boardAt=now;
  return _laBafl.board;
}
function _laBaflBoardWeekLine(p, a){
  if(a && (a.bye || a.out)) return null;
  const b=_laBaflBoard();
  const row=b.byId.get(String(p.id||'')) || b.byName.get((typeof ecrNormName==='function'?ecrNormName(p.name||''):String(p.name||'').toLowerCase())+'|'+p.pos);
  if(!row) return null;
  const g=Number(row.proj_games)>0?Number(row.proj_games):17;
  const mult=(a && a.baseRate>0 && a.adj>0) ? a.adj/a.baseRate : 1;
  const f=v=>((+v||0)/g)*mult;
  return { pass_att:f(row.passing_attempts), pass_yd:f(row.passing_yards), pass_td:f(row.passing_tds), pass_int:f(row.interceptions_thrown),
           rush_att:f(row.rushing_attempts), rush_yd:f(row.rushing_yards), rush_td:f(row.rushing_tds),
           rec:f(row.receptions), rec_tgt:f(row.targets), rec_yd:f(row.receiving_yards), rec_td:f(row.receiving_tds) };
}
// {live, proj (blended), rem, src, liveLine, projLine} for one player this week.
function laBaflPlayerLines(p, wk, a){
  const d=_laBafl.byWeek[wk]||null, pid=String(p.id||'');
  const live=(d&&d.stats&&d.stats[pid])||null;
  let prow=(d&&d.proj&&d.proj.stats[pid])||null, src='sleeper', rem;
  if(prow){ rem=d.prog ? _laBaflGameRem(d.prog, d.proj.game[pid], d.proj.team[pid]) : ((typeof laGameStarted==='function'&&laGameStarted(p.team,wk)===true)?0:1); }
  else { prow=_laBaflBoardWeekLine(p, a); src=prow?'board':'none'; rem=prow ? ((typeof laGameStarted==='function'&&laGameStarted(p.team,wk)===true)?0:1) : 0; }
  const proj={};
  LA_BAFL_LINE_FIELDS.forEach(k=>{ const v=(live&&+live[k]||0)+rem*((prow&&+prow[k])||0); if(v) proj[k]=v; });
  return { live, proj, rem, src, liveLine:laBaflStatLine(live,p.pos,false), projLine:laBaflStatLine(proj,p.pos,true) };
}
// The two-line block for a matchup starter: live line over the projected finish.
function laBaflLinesHTML(p, wk, a, opts){
  opts=opts||{};
  const L=laBaflPlayerLines(p, wk, a);
  const tip=L.src==='sleeper'?'Sleeper\'s week projection for him — what has happened plus the unplayed share of the rest':L.src==='board'?'Per-game rates from the projection board, adjusted for matchup and form (Sleeper\'s week line not loaded yet)':'';
  const liveTxt = L.liveLine || (L.rem<1 && L.live ? '0' : '–');
  const projTxt = (a && a.bye) ? 'BYE' : (a && a.out) ? 'OUT' : (L.projLine ? `→ ${L.projLine}` : '');
  return `<div class="la-bafl-sl${opts.cls?' '+opts.cls:''}" title="${escAttr(tip)}">${opts.projOnly?'':`<span class="la-bafl-live">${escHtml(liveTxt)}</span>`}${projTxt?`<span class="la-bafl-projl">${escHtml(projTxt)}</span>`:''}</div>`;
}
// The Lineup pane's hero: the five numbers the matchup is decided on, projected for the
// lineup shown (the BAFL app's lineup-cat-summary), instead of one points total.
function laBaflLineupSummaryHTML(players, wk){
  const tot={passing:0,rushing:0,receiving:0,tds:0,kicking:0};
  players.forEach(p=>{ if(!p) return; const L=laBaflPlayerLines(p, wk, p._a); const c=laBaflCatsOf(L.proj); for(const k in tot) tot[k]+=c[k]; });
  const chip=(lbl,v,cls)=>`<div class="la-lcs-chip${cls?' '+cls:''}"><span class="la-lcs-lbl">${lbl}</span><span class="la-lcs-val">${Math.round(v)}</span></div>`;
  return `<div class="la-lcs">${LA_BAFL_MC_CATS.map(c=>chip(c.label, tot[c.key])).join('')}${chip('Total Yds', laBaflTotalYards(tot), 'la-lcs-total')}</div>`;
}

if(typeof TC_INFO_BOOK!=='undefined'){
  TC_INFO_BOOK.labaflwp={title:'BAFL win %', body:`
    Best three of five categories: passing yards (−20 per INT), rushing yards, receiving
    yards, touchdowns, kicking (XPM + 3×FGM + 2×two-point). A level count falls to total yards.
    Each category's finish is a normal draw around its projection — Sleeper's full-week line
    per starter, taken as what has happened plus the unplayed share of the rest — whose spread
    shrinks as games finish. The five are combined exactly, so three locked wins read as 100%
    whatever the remaining games do. Same model as the BAFL app.`};
}
