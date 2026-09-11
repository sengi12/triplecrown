// ── This Week: every league, one action list ────────────────────────────────
// The lineup and waiver helpers the user ran as scripts (../Live-Draft-Analyzer
// lineup.py / waivers.py: Footballers projections × Sleeper leagues), rebuilt on
// the app's own data — the season projection, the sidecar's weekly usage lines,
// defense-vs-position, the schedule, injuries — and run for EVERY synced league
// at once. Output is not a table per league; it is the short list of things to
// do before kickoff: start X over Y, add A (why), drop B, bid this much.
//
// Everything here is scored under EACH league's own scoring (a league context is
// built per league and never touches the global settings), so the same player
// reads differently in a PPR league and in BAFL — as he should.
//
// Layout: pure engine (hubWeekProj, hubFill, hubCallouts, hubWaivers, hubFaab*)
// → fetch layer (hubLoadLeague) → view (renderWeekHub). The engine takes a
// context object so the Node tests drive it with fixtures.

const HUB_CLOSE = 3;        // lineup.py --close: a swap under this many points is "close"
const HUB_RANK_CLOSE = 6;   // lineup.py --rank-close: a bench player this close in rank is a call
const HUB_TOP_ADDS = 6;
const HUB_TOP_DROPS = 3;
const HUB_ADD_MIN = 1.0;    // points per game over replacement a pickup must add, net of the drop
const HUB_LAST_WEEK = 18;   // Sleeper regular season (17 games, 18 weeks)
const HUB_OUT = { Out:1, IR:1, PUP:1, Sus:1, NA:1, COV:1, DNR:1, Doubtful:1 };

let hubState = { busy:false, error:null, week:null, leagues:[], results:{}, openLeague:null, loadedAt:0 };

// ── Scoring under a league's own settings (no global mutation survives) ────────
function hubScoringFor(lg){
  const base = JSON.parse(JSON.stringify(scoringSettings));
  base.baflMode = /\bbafl\b/i.test(String(lg && lg.name || ''));
  const prev = scoringSettings;
  scoringSettings = base;
  try{ if(typeof applySleeperScoring==='function') applySleeperScoring(lg && lg.scoring_settings); }
  finally{ scoringSettings = prev; }
  return base;
}
function calcFptsUnder(row, sc){
  if(!sc) return calcFpts(row);
  const prev = scoringSettings;
  scoringSettings = sc;
  try{ return calcFpts(row); }
  finally{ scoringSettings = prev; }
}

// ── The week-projection primitive ────────────────────────────────────────────
// ctx: { sc, wk, dvp, form (pid → {gp, fppg, f3, weeks:[{wk,pts,tgt,teamTgt,carry}]}),
//        sched (TEAM → {wk: OPP}), now }
// row: a projection row (buildPlayerList shape: stats + player_id + pos + team + proj_games)
function hubWeekProj(row, ctx){
  const wk = ctx.wk;
  const projG = Number(row.proj_games)>0 ? Number(row.proj_games) : 17;
  const base = calcFptsUnder(row, ctx.sc)/projG;
  const avail = (typeof laWeekAvailability==='function') ? laWeekAvailability({id:row.player_id, team:row.team}, wk)
                : {bye:false, out:false, status:''};
  const sched = ctx.sched || null;
  const team = String(row.team||'').toUpperCase();
  const opp = (sched && sched[team]) ? (sched[team][String(wk)]||null) : null;
  const zero = {adj:0, base, seas:null, rec3:null, gp:0, defMult:1, opp, oppRank:null, bye:avail.bye, out:avail.out, status:avail.status, thin:false};
  if(avail.bye || avail.out) return zero;
  const fe = ctx.form ? ctx.form.get(String(row.player_id)) : null;
  const gp = fe ? fe.gp : 0;
  const seas = (fe && gp>0) ? fe.fppg : null;
  const rec3 = fe ? fe.f3 : null;
  let exp;
  if(!(base>0) && seas==null && rec3==null) return zero;
  if(seas!=null && rec3!=null && gp>=2)      exp = 0.35*base + 0.30*seas + 0.35*rec3;
  else if(seas!=null)                        exp = 0.55*base + 0.45*seas;
  else                                       exp = base;
  let defMult = 1, oppRank = null;
  if(ctx.dvp && opp && ctx.dvp.ranks[opp] && ctx.dvp.ranks[opp][row.pos]){
    const r = ctx.dvp.ranks[opp][row.pos], n = ctx.dvp.codes.length||32;
    oppRank = r;
    defMult = 1.10 - 0.20*((r-1)/Math.max(1, n-1));   // rank 1 = most generous → +10%
  }
  return {adj: exp*defMult, base, seas, rec3, gp, defMult, opp, oppRank, bye:false, out:false, status:avail.status, thin: gp>0 && gp<3};
}

// Per-player weekly lines under a league's scoring, from the sidecar's usage lines.
function hubFormMap(sc){
  const pw = (typeof TC_INSEASON!=='undefined' && TC_INSEASON && TC_INSEASON.player_weekly) || null;
  const m = new Map();
  if(!pw) return m;
  const ci = {}; (pw.cols||[]).forEach((c,i)=>ci[c]=i);
  for(const g in pw.players){
    const pl = pw.players[g];
    const weeks = Object.keys(pl.w||{}).map(Number).sort((a,b)=>a-b);
    if(!weeks.length) continue;
    const lines = weeks.map(w=>{
      const r = pl.w[String(w)]||[];
      const pts = calcFptsUnder({pos:pl.p, receptions:r[ci.rec]||0, receiving_yards:r[ci.rec_yd]||0,
        receiving_tds:r[ci.rec_td]||0, receiving_targets:r[ci.tgt]||0,
        rushing_yards:r[ci.rush_yd]||0, rushing_tds:r[ci.rush_td]||0, rushing_attempts:r[ci.carry]||0,
        passing_yards:r[ci.pass_yd]||0, passing_tds:r[ci.pass_td]||0, passing_attempts:r[ci.pass_att]||0,
        interceptions_thrown:r[ci.pass_int]||0, fumbles_lost:0}, sc);
      return {wk:w, pts, tgt:r[ci.tgt]||0, teamTgt:r[ci.team_tgt]||0, carry:r[ci.carry]||0, touches:(r[ci.tgt]||0)+(r[ci.carry]||0),
              tds:(r[ci.rec_td]||0)+(r[ci.rush_td]||0)+(r[ci.pass_td]||0)};
    });
    const last3 = lines.slice(-3);
    const entry = { gp:lines.length, fppg: lines.reduce((a,l)=>a+l.pts,0)/lines.length,
                    f3: last3.reduce((a,l)=>a+l.pts,0)/last3.length, weeks:lines, pos:pl.p, team:pl.t, name:pl.n };
    const pid = (typeof laPidFromGsis==='function') ? laPidFromGsis(g) : null;
    if(pid) m.set(String(pid), entry);
    m.set(ecrNormName(pl.n||'')+'|'+(pl.p||''), entry);
  }
  return m;
}

// ── Lineup: fill, then say what changes ──────────────────────────────────────
// players: [{id, pos, name, team, value, locked, unavailable}] best-first.
// current: {slotIndex → player} (the set lineup). Locked starters keep their slot.
function hubFill(slots, players, current){
  const filled = slots.map((slot,i)=>({slot, i, player:null}));
  const used = new Set();
  // locked starters stay where they are
  Object.keys(current||{}).forEach(i=>{ const p=current[i]; if(p && p.locked && filled[i]){ filled[i].player=p; used.add(p.id); } });
  const pool = players.filter(p=>!used.has(p.id) && !p.lockedOut && !p.unavailable && p.value>0);
  filled.forEach(f=>{ if(f.player || FLEX_ELIGIBLE[f.slot]) return;
    const p = pool.find(x=>!used.has(x.id) && x.pos===f.slot); if(p){ f.player=p; used.add(p.id); } });
  filled.forEach(f=>{ if(f.player || !FLEX_ELIGIBLE[f.slot]) return;
    const elig = FLEX_ELIGIBLE[f.slot];
    const p = pool.find(x=>!used.has(x.id) && elig.includes(x.pos)); if(p){ f.player=p; used.add(p.id); } });
  return filled;
}
function hubEligible(p, slot){ return p.pos===slot || !!(FLEX_ELIGIBLE[slot] && FLEX_ELIGIBLE[slot].includes(p.pos)); }

// lineup.py's callouts: newcomers paired with who they displace (same position first,
// then anyone they could replace through the slot, then the weakest), graded OBVIOUS /
// CLOSE / EMPTY; then CLOSE CALLs — a bench player within reach of the weakest starter
// he could replace.
function hubCallouts(slots, optimal, current, bench){
  const out = [];
  const curIds = new Set(Object.values(current).map(p=>p.id));
  const optIds = new Set(optimal.filter(f=>f.player).map(f=>f.player.id));
  const optSlot = {}; optimal.forEach(f=>{ if(f.player) optSlot[f.player.id]=f.slot; });
  const curSlot = {}; Object.keys(current).forEach(i=>{ curSlot[current[i].id]=slots[i]; });
  const newcomers = optimal.filter(f=>f.player && !curIds.has(f.player.id)).map(f=>f.player).sort((a,b)=>b.value-a.value);
  let dropped = Object.values(current).filter(p=>!optIds.has(p.id)).sort((a,b)=>a.value-b.value);
  for(const nc of newcomers){
    const pick = dropped.find(d=>d.pos===nc.pos) || dropped.find(d=>hubEligible(nc, curSlot[d.id])) || dropped[0] || null;
    if(pick) dropped = dropped.filter(d=>d!==pick);
    const delta = nc.value - (pick ? pick.value : 0);
    const kind = !pick ? 'EMPTY' : (pick.unavailable ? 'OBVIOUS' : (delta>=HUB_CLOSE ? 'OBVIOUS' : 'CLOSE'));
    out.push({kind, slot:optSlot[nc.id], start:nc, sit:pick, delta:+delta.toFixed(1)});
  }
  for(const d of dropped) out.push({kind:'SIT', slot:curSlot[d.id], start:null, sit:d, delta:0});
  for(const b of bench.slice().sort((a,b)=>b.value-a.value)){
    if(optIds.has(b.id) || b.unavailable || b.lockedOut || !(b.value>0)) continue;
    const targets = optimal.filter(f=>f.player && !f.player.locked && hubEligible(b, f.slot));
    if(!targets.length) continue;
    const t = targets.reduce((m,f)=>(!m || f.player.value<m.player.value) ? f : m, null);
    const gap = t.player.value - b.value;
    let rankGap = null;
    const samePos = targets.filter(f=>f.player.pos===b.pos);
    if(b.rank!=null && samePos.length){
      const weak = samePos.reduce((m,f)=>(!m || f.player.value<m.player.value) ? f : m, null).player;
      if(weak.rank!=null) rankGap = b.rank - weak.rank;
    }
    if(gap<=HUB_CLOSE || (rankGap!=null && rankGap<=HUB_RANK_CLOSE)) out.push({kind:'CALL', slot:t.slot, start:t.player, sit:b, delta:+gap.toFixed(1)});
  }
  const seen = new Set();
  return out.filter(c=>{ const k=`${c.start?c.start.id:''}|${c.sit?c.sit.id:''}`; if(seen.has(k)) return false; seen.add(k); return true; });
}

// ── Waivers: opportunity first ───────────────────────────────────────────────
// Each candidate carries WHY, from data the sidecar already bakes:
//   vacancy  — a teammate ahead of him at the position is out (role is predictable)
//   spike    — last week's usage far above his season / projection standing
//   schedule — the next three opponents are soft for his position
//   efficiency — his per-target / per-carry rank backs the volume
// plus "starts over X" from the league's own optimal lineup.
function hubNextOpps(team, wk, sched, n){
  const out=[]; if(!sched || !sched[team]) return out;
  for(let w=wk+1; w<=HUB_LAST_WEEK && out.length<(n||3); w++){ const o=sched[team][String(w)]; if(o) out.push({wk:w, opp:o}); }
  return out;
}
function hubWaiverReasons(row, wp, ctx, teammates){
  const reasons = [];
  const pos = row.pos, team = String(row.team||'').toUpperCase();
  // vacancy: a teammate at the same position, projected ahead of him, who is out
  (teammates||[]).forEach(t=>{
    if(t.pos!==pos || t.player_id===row.player_id) return;
    const st = (typeof sleeperPlayers!=='undefined' && sleeperPlayers && sleeperPlayers[t.player_id]) ? sleeperPlayers[t.player_id].injury_status : '';
    if(st && HUB_OUT[st] && calcFptsUnder(t, ctx.sc) > calcFptsUnder(row, ctx.sc)) reasons.push({k:'vacancy', w:3, text:`${t.name} ${st}`});
  });
  // usage spike: last week's touches vs his own earlier weeks, or (week 1) vs projection standing
  const fe = ctx.form ? ctx.form.get(String(row.player_id)) : null;
  if(fe && fe.weeks.length){
    const last = fe.weeks[fe.weeks.length-1];
    const prior = fe.weeks.slice(0,-1);
    if(prior.length){
      const avg = prior.reduce((a,l)=>a+l.touches,0)/prior.length;
      if(last.touches>=8 && last.touches>=1.6*Math.max(1,avg)) reasons.push({k:'spike', w:2, text:`${last.touches} touches wk ${last.wk} (avg ${avg.toFixed(0)})`});
    } else if(ctx.usageRank && ctx.projRank){
      const ur = ctx.usageRank.get(String(row.player_id)), pr = ctx.projRank.get(String(row.player_id));
      if(ur!=null && pr!=null && pr-ur>=12 && last.touches>=8) reasons.push({k:'spike', w:2, text:`${pos}${ur} in touches wk ${last.wk}, projected ${pos}${pr}`});
    }
  }
  // soft schedule: next three opponents' DvP rank (1 = most generous)
  const nx = hubNextOpps(team, ctx.wk, ctx.sched, 3);
  if(ctx.dvp && nx.length===3){
    const rks = nx.map(o=>(ctx.dvp.ranks[o.opp]||{})[pos]).filter(r=>r!=null);
    if(rks.length===3){ const mean=rks.reduce((a,b)=>a+b,0)/3; if(mean<=10) reasons.push({k:'schedule', w:1, text:`next 3: ${nx.map(o=>o.opp).join(' · ')} (avg #${mean.toFixed(0)} vs ${pos})`}); }
  }
  // efficiency backing the volume: live chart ranks (target chart EPA, rushing fan YPC)
  const live = (typeof TC_SEASON!=='undefined' && typeof NFLVERSE!=='undefined' && NFLVERSE) ? NFLVERSE[String(TC_SEASON.year)] : null;
  if(live){
    const norm = ecrNormName(row.name||'');
    const tt = live.target_trees && live.target_trees.players && live.target_trees.players[norm];
    const rk = tt && tt.season && tt.season.rk;
    if(rk && rk.epa && rk.epa[1]>=4 && rk.epa[0]<=Math.ceil(rk.epa[1]/4)) reasons.push({k:'efficiency', w:1, text:`EPA/target #${rk.epa[0]} of ${rk.epa[1]} ${pos}s`});
    const rf = live.rb_fan && live.rb_fan[norm];
    const rrk = rf && rf.totals && rf.totals.rk;
    if(rrk && rrk.ypc && rrk.ypc[1]>=4 && rrk.ypc[0]<=Math.ceil(rrk.ypc[1]/4)) reasons.push({k:'efficiency', w:1, text:`YPC #${rrk.ypc[0]} of ${rrk.ypc[1]} RBs`});
  }
  return reasons;
}

// ── Durability: is a surge sticky or fleeting? ──────────────────────────────
// The wire is full of one-week wonders. Before a pickup's upside counts, weigh
// what we already bake: is the USAGE real and sustained (target / carry share
// over the played weeks), is it backed by EFFICIENCY (target-chart EPA, NGS
// separation, rushing RYOE / YPC ranks), is the production TD-driven (regresses),
// is YAC over expectation extreme (luck), did the opportunity come from a long
// absence (IR/PUP: sticky) or a one-week one (Out/Doubtful: fleeting), is the
// schedule the reason (soft only for a while). Returns 0..1 (0.5 = no lean) and
// the chips that explain it. Used both ways: a pickup's rest-of-season upside
// scales with it; a roster player's drop-ability rises as his falls.
function hubDurability(row, ctx, teammates){
  const out={score:0.5, sticky:[], fleeting:[]};
  const pos=row.pos;
  const fe=ctx.form ? ctx.form.get(String(row.player_id)) : null;
  const weeks=(fe&&fe.weeks)||[];
  let d=0;
  // usage: share of team targets (receivers) or carries (backs), sustained or one-off
  if(weeks.length){
    const last=weeks[weeks.length-1];
    const shareOf=(w)=> (pos==='RB') ? w.carry : (w.teamTgt ? w.tgt/w.teamTgt : 0);
    const big=(v)=> (pos==='RB') ? v>=12 : v>=0.18;
    const lastShare=shareOf(last);
    if(big(lastShare)){
      const prior=weeks.slice(0,-1);
      const sustained = prior.length>=1 && prior.slice(-2).every(w=>big(shareOf(w)*0.85));
      const label = pos==='RB' ? `${last.carry} carries` : `${Math.round(lastShare*100)}% target share`;
      if(sustained){ d+=0.25; out.sticky.push(`${label} · ${Math.min(3,weeks.length)} wks running`); }
      else { d+=0.10; out.sticky.push(`${label} (one week)`); }
    } else if(weeks.length>=2){
      const prev=shareOf(weeks[weeks.length-2]);
      if(big(prev) && lastShare < prev*0.6){ d-=0.15; out.fleeting.push(pos==='RB'?`carries fell ${weeks[weeks.length-2].carry} → ${last.carry}`:`target share fell to ${Math.round(lastShare*100)}%`); }
    }
    // TD-driven points: touchdowns carrying most of his fantasy points on modest volume
    const tdPts=weeks.reduce((a,w)=>a+(w.tds||0)*6,0), allPts=weeks.reduce((a,w)=>a+(w.pts||0),0);
    const touches=weeks.reduce((a,w)=>a+(w.touches||0),0);
    if(allPts>0 && tdPts/allPts>=0.5 && touches/weeks.length<=8){ d-=0.2; out.fleeting.push(`TD-driven (${weeks.reduce((a,w)=>a+(w.tds||0),0)} TD on ${touches} touches)`); }
  }
  // efficiency behind the volume — the live chart ranks (per position)
  const live=(typeof TC_SEASON!=='undefined' && typeof NFLVERSE!=='undefined' && NFLVERSE) ? NFLVERSE[String(TC_SEASON.year)] : null;
  if(live){
    const norm=ecrNormName(row.name||'');
    const q=(rk)=> rk && rk[1]>=4 ? (rk[0]-1)/(rk[1]-1) : null;   // 0 = best
    const tt=live.target_trees && live.target_trees.players && live.target_trees.players[norm];
    const trk=tt && tt.season && tt.season.rk;
    if(trk && trk.epa && (tt.season.tgt||0)>=6){ const p=q(trk.epa); if(p!=null){ if(p<=0.25){ d+=0.15; out.sticky.push(`EPA/target #${trk.epa[0]} of ${trk.epa[1]}`); } else if(p>=0.75){ d-=0.10; out.fleeting.push(`EPA/target #${trk.epa[0]} of ${trk.epa[1]} — volume without efficiency`); } } }
    const ng=live.ngs_weekly && live.ngs_weekly.players && live.ngs_weekly.players[norm];
    const nrk=ng && ng.season && ng.season.rk;
    if(nrk && nrk.sep){ const p=q(nrk.sep); if(p!=null && p<=0.25){ d+=0.10; out.sticky.push(`separation #${nrk.sep[0]} of ${nrk.sep[1]}`); } }
    if(ng && ng.season && ng.season.yac_oe!=null && ng.season.yac_oe>=3){ d-=0.08; out.fleeting.push(`YAC +${ng.season.yac_oe.toFixed(1)} over expected — regresses`); }
    if(nrk && nrk.ryoe){ const p=q(nrk.ryoe); if(p!=null){ if(p<=0.25){ d+=0.12; out.sticky.push(`RYOE #${nrk.ryoe[0]} of ${nrk.ryoe[1]}`); } else if(p>=0.75){ d-=0.08; out.fleeting.push(`RYOE #${nrk.ryoe[0]} of ${nrk.ryoe[1]}`); } } }
    const rf=live.rb_fan && live.rb_fan[norm];
    const rrk=rf && rf.totals && rf.totals.rk;
    if(rrk && rrk.rz && (rf.totals.attempts||0)>=8){ const p=q(rrk.rz); if(p!=null && p<=0.25){ d+=0.08; out.sticky.push(`RZ carries #${rrk.rz[0]} of ${rrk.rz[1]}`); } }
  }
  // where the opportunity came from
  (teammates||[]).forEach(t=>{
    if(t.pos!==pos || String(t.player_id)===String(row.player_id)) return;
    const st=(typeof sleeperPlayers!=='undefined' && sleeperPlayers && sleeperPlayers[t.player_id]) ? sleeperPlayers[t.player_id].injury_status : '';
    if(!st || !HUB_OUT[st]) return;
    if(calcFptsUnder(t, ctx.sc) <= calcFptsUnder(row, ctx.sc)) return;
    if(/^(IR|PUP|Sus|NA|COV|DNR)$/.test(st)){ d+=0.2; out.sticky.push(`${t.name} on ${st} — the role is his for a while`); }
    else { d-=0.05; out.fleeting.push(`${t.name} ${st} — a short absence`); }
  });
  // schedule: soft is a reason for now, not for the season
  const nx=hubNextOpps(String(row.team||'').toUpperCase(), ctx.wk, ctx.sched, 3);
  if(ctx.dvp && nx.length===3){
    const rks=nx.map(o=>(ctx.dvp.ranks[o.opp]||{})[pos]).filter(r=>r!=null);
    if(rks.length===3){ const mean=rks.reduce((a,b)=>a+b,0)/3;
      if(mean<=10) out.fleeting.push(`soft schedule only through wk ${nx[2].wk}`);
      else if(mean>=24){ d-=0.05; out.fleeting.push(`next 3 are stingy (avg #${mean.toFixed(0)} vs ${pos})`); } }
  }
  // league trend: everyone is reaching for him — urgency, not durability
  const tr=ctx.trending && ctx.trending[String(row.player_id)];
  if(tr && tr.count>=1000) out.trend=`${tr.count>=1000?Math.round(tr.count/1000)+'k':tr.count} adds league-wide (24h)`;
  out.score=Math.max(0.05, Math.min(0.95, 0.5+d));
  return out;
}
// Sleeper's league-wide trending adds (24h). Cached half an hour; fail-soft.
let _hubTrend={at:0, map:null, loading:null};
async function hubTrending(){
  if(_hubTrend.map && Date.now()-_hubTrend.at<30*60*1000) return _hubTrend.map;
  if(_hubTrend.loading) return _hubTrend.loading;
  _hubTrend.loading=(async()=>{
    const map={};
    try{ const rows=await sleeperFetch('https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=100');
      (rows||[]).forEach(r=>{ if(r && r.player_id!=null) map[String(r.player_id)]={count:+r.count||0}; }); }catch(e){}
    _hubTrend={at:Date.now(), map, loading:null};
    return map;
  })();
  return _hubTrend.loading;
}

// ── FAAB: the clock on the waiver wire ───────────────────────────────────────
// A pickup is worth his rest-of-season points above replacement; the pool of
// "missed in the draft, obvious now" players drains through the season. So the
// share of the remaining budget a player deserves is his rest-of-season value
// over (his value + the value of the top pickups still ahead, split across the
// league). The curve of "top pickup value by week" comes from the league's own
// transaction history (hubFaabCurve); with none, a linear decay stands in.
// Fallback, in the same units as the history curve (rest-of-season points of a top
// pickup that week): a top pickup is ~9 points a game in week 1 and the "obvious"
// ones thin out — quality decays to ~5 by the end — times the games left after the claim.
function hubFaabFallbackCurve(){
  const c={}; for(let w=1; w<HUB_LAST_WEEK; w++){ const ppg=9-4*((w-1)/16); c[w]=ppg*Math.max(0, 17-w); } return c;
}
function hubFaabAdvice(rosValue, wk, curve, teams, budget, left){
  const cur = curve || hubFaabFallbackCurve();
  let future = 0; for(let w=wk+1; w<HUB_LAST_WEEK; w++) future += (cur[w]||0);
  const perTeam = 3/Math.max(1, teams||12);        // ~three real pickups a week, split across the league
  const expectedFuture = future * perTeam;
  const share = rosValue>0 ? rosValue/(rosValue + expectedFuture) : 0;
  const bid = Math.round(Math.min(left||0, share*(left||0)));
  // pace: how much of the season's pickup value has already come and gone
  let total=0, past=0; for(let w=1; w<HUB_LAST_WEEK; w++){ total+=(cur[w]||0); if(w<=wk) past+=(cur[w]||0); }
  const spentShould = total>0 ? past/total : 0;
  return {bid, share, expectedFuture, spentShould, budget, left};
}
// curve from history: for each week, the mean rest-of-season value of that week's top-3
// waiver pickups (values under THIS league's scoring), averaged over the seasons available.
function hubFaabCurveFromHistory(adds, sc){
  // adds: [{season, week, pid, bid}] — completed waiver/free-agent adds from past seasons
  const byWk = {};
  const bySeasonWk = {};
  adds.forEach(a=>{
    const rec = (typeof HISTORY!=='undefined' && HISTORY[a.pid]) ? HISTORY[a.pid][String(a.season)] : null;
    if(!rec) return;
    const act = (typeof _paceSumStints==='function') ? _paceSumStints(rec) : (Array.isArray(rec)?rec[0]:rec);
    if(!act) return;
    const gp = Number(act.games_played||0); if(!(gp>0)) return;
    const pg = calcFptsUnder(Object.assign({pos:act.pos||''}, act.stats||act), sc)/gp;
    const ros = pg * Math.max(0, 17 - a.week);   // games left after the claim week
    (bySeasonWk[`${a.season}|${a.week}`] = bySeasonWk[`${a.season}|${a.week}`]||[]).push(ros);
  });
  for(const k in bySeasonWk){
    const w = +k.split('|')[1];
    const top = bySeasonWk[k].sort((a,b)=>b-a).slice(0,3);
    (byWk[w] = byWk[w]||[]).push(top.reduce((a,b)=>a+b,0)/top.length);
  }
  const curve={}; let n=0;
  for(const w in byWk){ curve[w]=byWk[w].reduce((a,b)=>a+b,0)/byWk[w].length; n++; }
  return n>=6 ? curve : null;    // too thin a history is worse than the fallback
}
async function hubFaabCurve(lg, sc){
  const key = `tc_faab_curve_${lg.league_id}`;
  try{ const raw=localStorage.getItem(key); if(raw){ const c=JSON.parse(raw); if(c && c.season===String(lg.season)) return c.curve; } }catch(e){}
  const adds=[]; let prev=lg.previous_league_id, hops=0;
  while(prev && hops<3){
    let plg=null; try{ plg = await sleeperFetch(LA_LEAGUE_URL(prev)); }catch(e){ break; }
    if(!plg) break;
    const season=+plg.season;
    const rounds=[]; for(let w=1; w<HUB_LAST_WEEK; w++) rounds.push(w);
    const txs = await Promise.all(rounds.map(w=>sleeperFetch(`${LA_LEAGUE_URL(prev)}/transactions/${w}`).catch(()=>[])));
    txs.forEach((list,i)=>(list||[]).forEach(t=>{
      if(t.status!=='complete' || !(t.type==='waiver'||t.type==='free_agent') || !t.adds) return;
      const bid = t.settings && t.settings.waiver_bid!=null ? +t.settings.waiver_bid : null;
      Object.keys(t.adds).forEach(pid=>adds.push({season, week:i+1, pid, bid}));
    }));
    prev = plg.previous_league_id; hops++;
  }
  const curve = hubFaabCurveFromHistory(adds, sc);
  try{ localStorage.setItem(key, JSON.stringify({season:String(lg.season), curve, n:adds.length, at:Date.now()})); }catch(e){}
  return curve;
}

// ── One league, end to end ───────────────────────────────────────────────────
function hubKickoff(team, wk){
  const meta=(typeof TC_INSEASON!=='undefined' && TC_INSEASON && TC_INSEASON.schedule_meta && TC_INSEASON.schedule_meta[team] && TC_INSEASON.schedule_meta[team][String(wk)])||null;
  if(!meta || !meta[4] || !meta[3]) return null;
  // [opp, home, weekday, "1:00 PM", "2026-09-14"] — kickoffs are Eastern
  const m=/^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(meta[3]); if(!m) return null;
  let h=+m[1]%12; if(m[3]==='PM') h+=12;
  const d=new Date(`${meta[4]}T${String(h).padStart(2,'0')}:${m[2]}:00-04:00`);
  return isNaN(d) ? null : d;
}
function hubAnalyzeLeague(lg, rosters, users, matchups, ctxBase){
  const sc = ctxBase.sc, wk = ctxBase.wk, now = ctxBase.now || Date.now();
  const byId = ctxBase.byId;                       // pid → projection row
  const myId = ctxBase.myUserId;
  const mine = rosters.find(r=>r.owner_id===myId || (Array.isArray(r.co_owners)&&r.co_owners.includes(myId))) || null;
  const slots = (lg.roster_positions||[]).filter(s=>s!=='BN'&&s!=='IR'&&s!=='TAXI');
  const teams = lg.total_rosters || rosters.length;
  const evalPid = (pid)=>{
    const row = byId.get(String(pid));
    const sp = (typeof sleeperPlayers!=='undefined' && sleeperPlayers && sleeperPlayers[pid]) || null;
    const pos = (row&&row.pos) || (sp&&sp.pos) || (/^[A-Z]{2,4}$/.test(pid)?'DEF':'?');
    const team = String((row&&row.team) || (sp&&sp.team) || (pos==='DEF'?pid:'') || '').toUpperCase();
    const name = (row&&row.name) || (sp&&sp.name) || (pos==='DEF' ? `${typeof teamDisplayName==='function'?teamDisplayName(pid):pid} D/ST` : String(pid));
    let wp;
    if(row) wp = hubWeekProj(row, ctxBase);
    else {
      // no projection row (K / DEF / deep bench): the sidecar's own weekly line, else 0
      const fe = ctxBase.form ? ctxBase.form.get(String(pid)) : null;
      const av = (typeof laWeekAvailability==='function') ? laWeekAvailability({id:pid, team}, wk) : {bye:false,out:false,status:''};
      wp = {adj:(fe && !av.bye && !av.out)?fe.f3:0, base:0, seas:fe?fe.fppg:null, rec3:fe?fe.f3:null, gp:fe?fe.gp:0, defMult:1,
            opp:(ctxBase.sched&&ctxBase.sched[team])?ctxBase.sched[team][String(wk)]||null:null, oppRank:null, bye:av.bye, out:av.out, status:av.status, thin:true, noProj:true};
    }
    const ko = hubKickoff(team, wk);
    const locked = !!(ko && ko.getTime() < now);
    return {id:String(pid), name, pos, team, value:+(wp.adj||0), wp, locked,
            unavailable: wp.bye ? 'BYE' : (wp.out ? wp.status : ''), rank: ctxBase.projRank ? ctxBase.projRank.get(String(pid)) : null,
            noProj: !!wp.noProj, fpts: row ? calcFptsUnder(row, sc) : 0};
  };
  let lineup = null;
  if(mine){
    const muRow = (matchups||[]).find(m=>m.roster_id===mine.roster_id) || null;
    const starters = (muRow && muRow.starters) || mine.starters || [];
    const reserve = new Set(mine.reserve||[]), taxi = new Set(mine.taxi||[]);
    const evals = {};
    (mine.players||[]).forEach(pid=>{ evals[pid]=evalPid(pid); });
    const current = {};
    starters.slice(0, slots.length).forEach((pid,i)=>{ if(pid && pid!=='0'){ if(!evals[pid]) evals[pid]=evalPid(pid); current[i]=evals[pid]; } });
    const starterSet = new Set(starters);
    const bench = (mine.players||[]).filter(p=>!starterSet.has(p) && !reserve.has(p) && !taxi.has(p)).map(p=>evals[p]);
    bench.forEach(b=>{ b.lockedOut = b.locked; });
    // K / DEF without a projection: keep whoever is set (no basis to swap)
    Object.values(current).forEach(p=>{ if(p.noProj && (p.pos==='K'||p.pos==='DEF')) p.locked=true; });
    const all = Object.values(current).concat(bench).sort((a,b)=>b.value-a.value);
    const optimal = hubFill(slots, all, current);
    const callouts = hubCallouts(slots, optimal, current, bench);
    const curTotal = Object.values(current).reduce((a,p)=>a+p.value,0);
    const optTotal = optimal.reduce((a,f)=>a+(f.player?f.player.value:0),0);
    lineup = {slots, current, optimal, bench, callouts, curTotal:+curTotal.toFixed(1), optTotal:+optTotal.toFixed(1),
              opponent: (()=>{ if(!muRow) return null; const o=(matchups||[]).find(m=>m.matchup_id===muRow.matchup_id && m.roster_id!==muRow.roster_id); if(!o) return null;
                const r=rosters.find(x=>x.roster_id===o.roster_id); const u=r && (users||[]).find(x=>x.user_id===r.owner_id); return u ? ((u.metadata&&u.metadata.team_name)||u.display_name) : `Roster ${o.roster_id}`; })()};
  }
  // ── Waivers, the VOR way ────────────────────────────────────────────────────
  // A pickup is only worth making when his rest-of-season value OVER REPLACEMENT
  // beats the rest-of-season value of the player he would push off the roster —
  // in this league's scoring, for this roster's shape. Raw points would put a QB3
  // at the top of every 1-QB league; replacement level (what is freely available
  // at the position) is what makes the comparison honest, and the protected set
  // (this week's optimal lineup + the rest-of-season optimal lineup) is what keeps
  // the helper from dropping the only healthy TE while the TE1 sits on IR.
  const rostered = new Set(); rosters.forEach(r=>(r.players||[]).forEach(p=>rostered.add(String(p))));
  const superflex = (typeof leagueIsSuperflex==='function') ? leagueIsSuperflex(lg.roster_positions||[]) : (lg.roster_positions||[]).includes('SUPER_FLEX');
  const weeksLeft = Math.max(1, 17 - wk + 1);
  const LONG_OUT = {IR:1, PUP:1, Sus:1, NA:1, COV:1, DNR:1};
  // rest-of-season per-game value: the same blend as this week, without the one-opponent multiplier
  const rosPg = (row)=>{
    const w = hubWeekProj(row, ctxBase);
    let v = (w.bye || w.out) ? (w.seas!=null && w.gp>=2 ? 0.55*w.base+0.45*w.seas : w.base) : w.adj/(w.defMult||1);
    if(w.out && LONG_OUT[w.status]) v *= 0.5;     // a long-term absence is half a season, roughly
    return v;
  };
  // Dynasty (and keeper) leagues price the wire on the dynasty chart — a 22-year-old's
  // value is years, not this week; every other format (redraft, chopped) on rest-of-season
  // projection. Same engine, different unit.
  const dynasty = [1,2].includes(+((lg.settings||{}).type));
  const dynOf = (row)=>{
    const dv=(typeof DYNASTY_VALUES!=='undefined' && DYNASTY_VALUES && DYNASTY_VALUES.players)||null; if(!dv) return 0;
    const e=dv[ecrNormName(row.name||'')]; if(!e || (e.pos && e.pos!==row.pos)) return 0;
    return +((superflex && e.sf!=null) ? e.sf : e.v)||0;
  };
  const valOf = dynasty ? dynOf : rosPg;
  const pool = {QB:[], RB:[], WR:[], TE:[]};
  byId.forEach(row=>{ if(!rostered.has(String(row.player_id)) && pool[row.pos]) pool[row.pos].push({row, pg:valOf(row)}); });
  const baseline = {};
  Object.keys(pool).forEach(pos=>{
    pool[pos].sort((a,b)=>b.pg-a.pg);
    const k = (pos==='RB'||pos==='WR'||(pos==='QB'&&superflex)) ? 2 : 1;   // the replacement you can actually get
    // fewer than k+1 available → nobody is freely available after him: replacement is 0
    baseline[pos] = pool[pos][k] ? pool[pos][k].pg : 0;
  });
  const vorOf = (pos, pg)=> pg - (baseline[pos]||0);
  const topAvail = Math.max(0, ...Object.keys(pool).map(pos=>pool[pos][0] ? pool[pos][0].pg : 0));
  const teammatesByTeam = {};
  byId.forEach(row=>{ const t=String(row.team||'').toUpperCase(); (teammatesByTeam[t]=teammatesByTeam[t]||[]).push(row); });
  let adds = [], drops = [], droppable = [];
  if(lineup){
    // roster players with a rest-of-season value; the protected set is both optimal lineups
    const rosterEvals = Object.values(lineup.current).concat(lineup.bench);
    rosterEvals.forEach(p=>{ const row=byId.get(p.id); p.rosPg = row ? valOf(row) : (dynasty ? 0 : (p.wp && p.wp.seas!=null ? p.wp.seas : p.value)); p.vor = vorOf(p.pos, p.rosPg);
      // a roster player whose production looks fleeting is the easier drop
      p.dur = row ? hubDurability(row, ctxBase, teammatesByTeam[String(row.team||'').toUpperCase()]) : {score:0.5, sticky:[], fleeting:[]};
      p.dropKey = p.vor * (0.5 + p.dur.score); });
    const rosSorted = rosterEvals.map(p=>Object.assign({}, p, {value:(dynasty ? (byId.get(p.id)?rosPg(byId.get(p.id)):p.value) : p.rosPg), locked:false, lockedOut:false, unavailable:(p.unavailable && LONG_OUT[p.unavailable]) ? p.unavailable : ''}))
      .sort((a,b)=>b.value-a.value);
    const rosOptimal = hubFill(slots, rosSorted, {});
    const protectedIds = new Set(lineup.optimal.filter(f=>f.player).map(f=>f.player.id).concat(rosOptimal.filter(f=>f.player).map(f=>f.player.id)));
    droppable = rosterEvals.filter(p=>!protectedIds.has(p.id)).sort((a,b)=>a.dropKey-b.dropKey);
    drops = droppable.slice(0, HUB_TOP_DROPS).map(b=>{
      const reasons=[];
      if(b.unavailable) reasons.push(b.unavailable);
      reasons.push(`${b.vor>=0?'+':''}${b.vor.toFixed(dynasty?0:1)}${dynasty?' dynasty':'/gm'} over replacement`);
      (b.dur&&b.dur.fleeting||[]).slice(0,1).forEach(f=>reasons.push('fleeting: '+f));
      if(b.rank!=null) reasons.push(`${b.pos}${b.rank} projected`);
      return {p:b, reasons};
    });
    // candidates: skill positions; QBs only where the roster actually needs one
    const healthyQB = rosterEvals.filter(p=>p.pos==='QB' && !p.unavailable).length;
    const qbSlots = slots.filter(x=>x==='QB').length + (superflex ? 1 : 0);
    Object.keys(pool).forEach(pos=>{
      if(pos==='QB' && healthyQB>=qbSlots && !superflex) return;
      pool[pos].forEach(({row, pg})=>{
        if(!(pg>0.5)) return;
        const wp = hubWeekProj(row, ctxBase);
        const mates=teammatesByTeam[String(row.team||'').toUpperCase()];
        const reasons = hubWaiverReasons(row, wp, ctxBase, mates);
        // upside: an opened role or a usage spike is a bigger rest-of-season role than the
        // projection knows about — scaled by how DURABLE the surge looks (sticky role and
        // efficiency behind it → most of the upside counts; TD-driven, luck, a one-week
        // absence → little of it does)
        const dur = hubDurability(row, ctxBase, mates);
        const raw = reasons.reduce((a,r)=>a+({vacancy:0.25, spike:0.15, schedule:0.05, efficiency:0.05}[r.k]||0), 0);
        // dynasty already prices the long run: a surge moves the chart, not the season
        const mult = Math.pow(Math.min(1.5, 1 + raw*(0.4 + 1.2*dur.score)), dynasty ? 0.5 : 1);
        const vor = vorOf(pos, pg*mult);
        // the drop: the weakest roster player — a same-position one when he is about as weak
        const weakest = droppable[0]||null;
        const samePos = droppable.find(d=>d.pos===pos);
        const drop = (samePos && weakest && samePos.vor <= weakest.vor+0.5) ? samePos : weakest;
        const net = vor - (drop ? drop.vor : 0);
        // this week: would he beat the weakest starter he could replace?
        let startsOver = null;
        const targets = lineup.optimal.filter(f=>f.player && hubEligible({pos}, f.slot));
        const empty = lineup.optimal.find(f=>!f.player && hubEligible({pos}, f.slot));
        if(empty) startsOver = {name:'(empty slot)', slot:empty.slot, delta:+wp.adj.toFixed(1)};
        else if(targets.length){ const weak=targets.reduce((m,f)=>(!m||f.player.value<m.player.value)?f:m,null); if(wp.adj>weak.player.value) startsOver={name:weak.player.name, slot:weak.slot, delta:+(wp.adj-weak.player.value).toFixed(1)}; }
        const addMin = dynasty ? 0.03*Math.max(1, topAvail) : HUB_ADD_MIN;
        const worth = net >= addMin || (startsOver && startsOver.delta>=2 && net>=0);
        if(!worth || !drop) return;
        adds.push({id:String(row.player_id), name:row.name, pos, team:row.team, wp, perGame:pg, vor, ros:dynasty ? Math.max(0, vor) : Math.max(0, vor)*weeksLeft, net, mult, reasons, startsOver, drop, dur, dynasty,
                   score: net*weeksLeft + (startsOver ? startsOver.delta : 0) + (dur.trend ? 2 : 0)});
      });
    });
    adds.sort((a,b)=>b.score-a.score);
    adds = adds.slice(0, HUB_TOP_ADDS);
  }
  // FAAB
  const st = lg.settings||{};
  let faab = null;
  if(+st.waiver_type===2){
    const budget = +st.waiver_budget||0;
    const used = mine && mine.settings ? +(mine.settings.waiver_budget_used||0) : 0;
    faab = {budget, left:budget-used, curve:ctxBase.faabCurve||null};
    let curve=faab.curve;
    if(dynasty){ const flat={}; const top=Math.max(1, topAvail - (baseline[Object.keys(baseline).sort((a,b)=>(pool[b][0]?pool[b][0].pg:0)-(pool[a][0]?pool[a][0].pg:0))[0]]||0)); for(let w=1; w<HUB_LAST_WEEK; w++) flat[w]=top; curve=flat; }
    adds.forEach(c=>{ c.faab = hubFaabAdvice(c.ros, wk, curve, teams, budget, faab.left); });
  }
  return {league:lg, teams, mine:!!mine, lineup, adds, drops, faab, wk, dynasty};
}

// ── Fetch layer ──────────────────────────────────────────────────────────────
// In-season only leagues in play: a league carried over from last year, or one that
// never drafted / already finished, is not a place you set a lineup this week.
function tcLeagueInPlay(lg){
  if(!lg || lg.stale) return false;
  const started=(typeof hasSeasonStarted==='function' && hasSeasonStarted());
  if(!started) return true;
  if(lg.season!=null && typeof TC_SEASON!=='undefined' && String(lg.season)!==String(TC_SEASON.year)) return false;
  if(lg.status) return lg.status==='in_season' || lg.status==='drafting';
  return true;   // an older saved profile without a status: decided at fetch time
}
function hubLeagueList(){
  const prof = (typeof laLoadSleeperProfile==='function') ? laLoadSleeperProfile() : null;
  const list = (prof && prof.leagues) ? prof.leagues.filter(tcLeagueInPlay) : [];
  return {prof, list};
}
async function hubLoadLeague(ref, prof, wk, shared){
  const lg = await sleeperFetch(LA_LEAGUE_URL(ref.league_id));
  if(!tcLeagueInPlay({status:lg.status, season:lg.season})) return {league:lg, inactive:true};
  const [rosters, users, matchups] = await Promise.all([
    sleeperFetch(LA_ROSTERS_URL(ref.league_id)),
    sleeperFetch(SLEEPER_LG_USERS_URL(ref.league_id)).catch(()=>[]),
    sleeperFetch(LA_MATCHUPS_URL(ref.league_id, wk)).catch(()=>[]),
  ]);
  const sc = hubScoringFor(lg);
  const form = hubFormMap(sc);
  let myUserId = prof && prof.user ? prof.user.user_id : null;
  if(!myUserId && prof && prof.username){ const u=(users||[]).find(x=>(x.display_name||'').toLowerCase()===String(prof.username).toLowerCase()); if(u) myUserId=u.user_id; }
  const ctx = Object.assign({}, shared, {sc, form, myUserId, wk});
  // projection rank within position under this scoring (for CLOSE CALL rank gaps + spike test)
  const projRank = new Map(); const usageRank = new Map();
  ['QB','RB','WR','TE'].forEach(pos=>{
    const rows=[]; ctx.byId.forEach(r=>{ if(r.pos===pos) rows.push(r); });
    rows.map(r=>({id:String(r.player_id), v:calcFptsUnder(r, sc)})).sort((a,b)=>b.v-a.v).forEach((r,i)=>projRank.set(r.id, i+1));
    const us=[]; form.forEach((fe,k)=>{ if(/^\d+$/.test(k) && fe.pos===pos && fe.weeks.length) us.push({id:k, t:fe.weeks[fe.weeks.length-1].touches}); });
    us.sort((a,b)=>b.t-a.t).forEach((r,i)=>usageRank.set(r.id, i+1));
  });
  ctx.projRank = projRank; ctx.usageRank = usageRank;
  if(+((lg.settings||{}).waiver_type)===2){ try{ ctx.faabCurve = await hubFaabCurve(lg, sc); }catch(e){ ctx.faabCurve=null; } }
  return hubAnalyzeLeague(lg, rosters||[], users||[], matchups||[], ctx);
}
async function hubLoadAll(force){
  if(hubState.busy) return;
  const {prof, list} = hubLeagueList();
  hubState.leagues = list;
  if(!list.length){ hubState.error='Sync a Sleeper league first (League → Sync).'; renderWeekHub(); return; }
  if(!force && hubState.loadedAt && Date.now()-hubState.loadedAt < 5*60*1000) { renderWeekHub(); return; }
  hubState.busy=true; hubState.error=null; renderWeekHub();
  try{
    if(typeof ensureInseasonSidecar==='function') await ensureInseasonSidecar();
    if(typeof loadSleeperPlayers==='function') await loadSleeperPlayers(true);
    const wk = (typeof laCurrentWeek==='function') ? laCurrentWeek() : 1;
    const byId = new Map(); buildProjectionList().forEach(p=>{ if(p.player_id!=null) byId.set(String(p.player_id), p); });
    let trending=null; try{ trending=await hubTrending(); }catch(e){ trending=null; }
    const shared = { byId, wk, now:Date.now(), dvp:(typeof laDvpTable==='function')?laDvpTable():null,
                     sched:(typeof TC_INSEASON!=='undefined' && TC_INSEASON && TC_INSEASON.schedule)||null, trending };
    hubState.week = wk;
    for(const ref of list){
      try{ hubState.results[ref.league_id] = await hubLoadLeague(ref, prof, wk, shared); }
      catch(e){ hubState.results[ref.league_id] = {league:ref, error:e.message||'failed'}; }
      renderWeekHub();
    }
    hubState.loadedAt = Date.now();
  }catch(e){ hubState.error = e.message||'failed'; }
  hubState.busy=false;
  renderWeekHub();
}

// ── View (rendered inside the League Analyzer's chrome, as the "Week" tab) ────
function openWeekHub(){
  if(typeof setPhase==='function' && currentPhase!=='League') setPhase('League');
  laState.laTab='hub';
  renderLeagueAnalyzer();
  hubLoadAll(false);
}
function renderWeekHub(){ if(typeof laState!=='undefined' && laState.laTab==='hub' && typeof renderLeagueAnalyzer==='function') renderLeagueAnalyzer(); }
function hubToggleLeague(id){ hubState.openLeague = (hubState.openLeague===id) ? null : id; renderWeekHub(); }
function _hubPlayer(p, showProj){
  const opp = p.wp && p.wp.opp ? `${p.wp.opp}${p.wp.oppRank?` <span class="hub-dvp">#${p.wp.oppRank}</span>`:''}` : '';
  return `<span class="clickable-player hub-p" onclick="${pcardOnclick(p.id, p.pos, p.team||'')}"><b>${escHtml(p.name)}</b> <span class="hub-pos la-pos-${escAttr(p.pos)}">${escHtml(p.pos)}</span>${opp?` <span class="hub-opp">${opp}</span>`:''}${showProj?` <span class="hub-val">${p.value.toFixed(1)}</span>`:''}${p.unavailable?` <span class="la-lh-flag la-lh-sit">${escHtml(String(p.unavailable).toUpperCase())}</span>`:''}</span>`;
}
function _hubCallout(c){
  const kind = {OBVIOUS:['hub-k-obv','START'], CLOSE:['hub-k-close','CLOSE'], EMPTY:['hub-k-obv','EMPTY SLOT'], SIT:['hub-k-sit','SIT'], CALL:['hub-k-call','CLOSE CALL']}[c.kind]||['',c.kind];
  const body = c.kind==='CALL'
    ? `${_hubPlayer(c.start,true)} <span class="hub-arrow">holds</span> ${_hubPlayer(c.sit,true)}`
    : c.kind==='SIT' ? `${_hubPlayer(c.sit,true)}`
    : `${_hubPlayer(c.start,true)}${c.sit?` <span class="hub-arrow">over</span> ${_hubPlayer(c.sit,true)}`:''}`;
  return `<div class="hub-row"><span class="hub-kind ${kind[0]}">${kind[1]}</span><span class="hub-slot">${escHtml(c.slot||'')}</span><div class="hub-body">${body}</div><span class="hub-delta ${c.delta>0?'up':''}">${c.kind==='CALL'?`−${Math.abs(c.delta).toFixed(1)}`:(c.delta?`+${c.delta.toFixed(1)}`:'')}</span></div>`;
}
function _hubReason(r){ return `<span class="hub-why hub-why-${r.k}" title="${escAttr(r.text)}">${{vacancy:'role opened',spike:'usage spike',schedule:'soft schedule',efficiency:'efficient',sticky:'sticky',fleeting:'fleeting',trend:'trending'}[r.k]||r.k}</span>`; }
function _hubDurChips(c){
  const out=[]; if(!c.dur) return out;
  if(c.dur.score>=0.65) out.push({k:'sticky', text:c.dur.sticky.join(' · ')||'usage and efficiency both back it'});
  else if(c.dur.score<=0.35) out.push({k:'fleeting', text:c.dur.fleeting.join(' · ')||'one-week production'});
  if(c.dur.trend) out.push({k:'trend', text:c.dur.trend+' — expect competition'});
  return out;
}
function _hubLeagueCard(res){
  const lg=res.league;
  const open = hubState.openLeague===String(lg.league_id);
  if(res.inactive) return '';
  if(res.error) return `<div class="card hub-league"><div class="hub-lg-head"><b>${escHtml(lg.name||'League')}</b><span class="hub-err">${escHtml(res.error)}</span></div></div>`;
  const L=res.lineup;
  const acts = L ? L.callouts.filter(c=>c.kind!=='CALL') : [];
  const calls = L ? L.callouts.filter(c=>c.kind==='CALL') : [];
  const gain = L ? (L.optTotal-L.curTotal) : 0;
  const summary = !L ? 'no roster of yours here'
    : acts.length ? `${acts.length} lineup change${acts.length>1?'s':''} · +${gain.toFixed(1)}`
    : 'lineup set';
  return `<div class="card hub-league ${open?'open':''}">
    <div class="hub-lg-head" onclick="hubToggleLeague('${escAttr(String(lg.league_id))}')">
      <b>${escHtml(lg.name||'League')}</b>
      <span class="hub-lg-sum">${escHtml(summary)}${L&&L.opponent?` · vs ${escHtml(L.opponent)}`:''}</span>
      ${res.faab ? `<div class="hub-faab" title="FAAB left · ${res.faab.curve?'this league\'s past seasons':'no league history yet (linear decay)'} say about ${(hubFaabAdvice(1,res.wk,res.faab.curve,res.teams,res.faab.budget,res.faab.left).spentShould*100).toFixed(0)}% of the season\'s pickup value is behind you by week ${res.wk}">FAAB $${res.faab.left}<span class="hub-faab-of">/ $${res.faab.budget}</span></div>` : ''}
      <span class="hub-caret">${open?'▴':'▾'}</span>
    </div>
    ${_hubActionsHTML(res, open)}
    ${open && L ? `<div class="hub-foot">optimal ${L.optTotal.toFixed(1)} · set ${L.curTotal.toFixed(1)}</div>` : ''}
  </div>`;
}
// The action sections (lineup callouts, adds, drops) for one league — the hub card's body,
// and the Team tab's "This week" card for the league on screen.
function _hubActionsHTML(res, open){
  const L=res.lineup;
  const acts = L ? L.callouts.filter(c=>c.kind!=='CALL') : [];
  const calls = L ? L.callouts.filter(c=>c.kind==='CALL') : [];
  const adds = res.adds.slice(0, open?HUB_TOP_ADDS:3).map(c=>`<div class="hub-row">
      <span class="hub-kind hub-k-add">ADD</span>
      <div class="hub-body">${_hubPlayer({id:c.id,name:c.name,pos:c.pos,team:c.team,value:c.wp.adj,wp:c.wp,unavailable:c.wp.bye?'BYE':''},true)}${c.drop?` <span class="hub-arrow">for</span> ${_hubPlayer(Object.assign({},c.drop,{value:c.drop.rosPg}),true)}`:''}
        <div class="hub-whys"><span class="hub-why hub-why-net" title="${c.dynasty?'Dynasty chart value over replacement, net of the player he replaces':'Rest-of-season value over replacement, net of the player he replaces, per game'}">+${c.net.toFixed(c.dynasty?0:1)}${c.dynasty?' dyn':'/gm'}</span>${c.reasons.concat(_hubDurChips(c)).map(_hubReason).join('')}${c.startsOver?`<span class="hub-why hub-why-starts" title="Beats the weakest starter he could replace in your optimal lineup this week">starts over ${escHtml(c.startsOver.name)} (${escHtml(c.startsOver.slot)}) +${c.startsOver.delta}</span>`:''}</div></div>
      ${c.faab?`<span class="hub-bid" title="Suggested bid: his rest-of-season value against the top pickups still ahead, split across the league (${(c.faab.share*100).toFixed(0)}% of your $${c.faab.left} left)">$${c.faab.bid}</span>`:''}
    </div>`).join('');
  const drops = open ? res.drops.map(d=>`<div class="hub-row"><span class="hub-kind hub-k-drop">DROP</span><div class="hub-body">${_hubPlayer(d.p,true)}<div class="hub-whys">${d.reasons.map(r=>`<span class="hub-why">${escHtml(r)}</span>`).join('')}</div></div></div>`).join('') : '';
  return `${acts.length?`<div class="hub-sec">${acts.map(_hubCallout).join('')}</div>`:''}
    ${open && calls.length?`<div class="hub-sec hub-sec-calls">${calls.map(_hubCallout).join('')}</div>`:''}
    ${adds?`<div class="hub-sec">${adds}</div>`:''}
    ${drops?`<div class="hub-sec">${drops}</div>`:''}
    ${!acts.length && !adds && L ? '<div class="hub-sec hub-empty">Lineup set · nothing on the wire beats what you have</div>' : ''}`;
}
// ── One league from the analyzer's snapshot (the Team tab) ──────────────────
// The snapshot's league is already applied globally (scoring, shape), so the
// context scores under the global settings; rosters/starters come from the
// snapshot + this week's matchup rows. Memoized per snapshot + week + matchups.
let _hubSnapMemo={sig:'', res:null};
function hubSnapshotResult(s){
  if(!s || !s.teamList || typeof hubAnalyzeLeague!=='function') return null;
  const wk=(typeof laCurrentWeek==='function')?laCurrentWeek():1;
  const mu=(typeof _laMu!=='undefined' && _laMu.byWeek && _laMu.byWeek[wk])||null;
  const ref=(typeof laSnapshotRef==='function')?String(laSnapshotRef(s)):String(s.leagueId);
  const sig=`${ref}~${wk}~${mu?mu.sig:''}~${(typeof TC_INSEASON!=='undefined'&&TC_INSEASON&&TC_INSEASON.asof)||''}~${(typeof buildPlayerScoringSig==='function')?buildPlayerScoringSig():''}`;
  if(_hubSnapMemo.sig===sig) return _hubSnapMemo.res;
  const lg={league_id:s.leagueId, name:s.name, season:s.season, total_rosters:s.teams||s.teamList.length, roster_positions:s.rosterPositions||[], settings:{}};
  const rows=(mu&&mu.rows)||[];
  const rosters=s.teamList.map(t=>{ const r=rows.find(x=>x.roster_id===t.rosterId); return {roster_id:t.rosterId, owner_id:t.ownerId, co_owners:t.coOwners||[], players:(t.players||[]).map(p=>String(p.id)), starters:(r&&r.starters)||[], reserve:[], taxi:[], settings:{}}; });
  const users=s.teamList.map(t=>({user_id:t.ownerId, display_name:t.owner, metadata:{team_name:t.teamName}}));
  const byId=new Map(); try{ buildProjectionList().forEach(p=>{ if(p.player_id!=null) byId.set(String(p.player_id), p); }); }catch(e){}
  const form=(typeof hubFormMap==='function')?hubFormMap(null):new Map();
  const ctx={sc:null, wk, now:Date.now(), byId, form, myUserId:s.myUserId,
    dvp:(typeof laDvpTable==='function')?laDvpTable():null, sched:(typeof TC_INSEASON!=='undefined'&&TC_INSEASON&&TC_INSEASON.schedule)||null, faabCurve:null};
  const projRank=new Map(), usageRank=new Map();
  ['QB','RB','WR','TE'].forEach(pos=>{
    const rs=[]; byId.forEach(r=>{ if(r.pos===pos) rs.push(r); });
    rs.map(r=>({id:String(r.player_id), v:calcFptsUnder(r, null)})).sort((a,b)=>b.v-a.v).forEach((r,i)=>projRank.set(r.id, i+1));
    const us=[]; form.forEach((fe,k)=>{ if(/^\d+$/.test(k) && fe.pos===pos && fe.weeks.length) us.push({id:k, t:fe.weeks[fe.weeks.length-1].touches}); });
    us.sort((a,b)=>b.t-a.t).forEach((r,i)=>usageRank.set(r.id, i+1));
  });
  ctx.projRank=projRank; ctx.usageRank=usageRank;
  let res=null; try{ res=hubAnalyzeLeague(lg, rosters, users, rows, ctx); }catch(e){ res=null; }
  _hubSnapMemo={sig, res};
  return res;
}
// ── The Lineup pane's waiver section — in the pane's own row language ────────
// The pane already says START / SIT in its lineup rows; what it lacked was the
// wire. Each ADD names the DROP it beats (value over replacement, this league's
// scoring), with the game line, the reason chips and the bid, in the same row
// component as the lineup above it — one design, desktop and phone alike.
const LA_WHY_LABEL={vacancy:'role opened', spike:'usage spike', schedule:'soft schedule', efficiency:'efficient'};
function laWaiverSectionHTML(s){
  if(typeof hasSeasonStarted!=='function' || !hasSeasonStarted()) return '';
  const wk=(typeof laCurrentWeek==='function')?laCurrentWeek():1;
  if(typeof _laMu!=='undefined' && !(_laMu.byWeek&&_laMu.byWeek[wk]) && typeof laFetchMatchups==='function') laFetchMatchups(wk, true);
  const res=hubSnapshotResult(s);
  if(!res || !res.mine) return '';
  const dvp=(typeof laDvpTable==='function')?laDvpTable():null;
  const row=(p, kind, m)=>{
    const l3=(m.whys||[]).map(w=>`<span class="la-lh-flag la-lh-why la-lh-why-${w.k}" title="${escAttr(w.text||'')}">${escHtml(w.label)}</span>`).join('');
    const posc=(typeof _laPosOf==='function')?_laPosOf(p):p.pos;
    return `<div class="la-tm-row la-wv-row la-wv-${kind}">
      <span class="la-slot la-slot-${kind==='add'?'ADD':'DROP'}">${kind==='add'?'ADD':'DROP'}</span>
      <span class="clickable-player la-tm-hs" onclick="${pcardOnclick(p.id,p.pos,p.team||'')}">${(typeof laPlayerImg==='function')?laPlayerImg(p,'la-tm-hsimg'):''}</span>
      <div class="la-tm-main">
        <div class="la-tm-l1">${(typeof laNameHTML==='function')?laNameHTML(p,'la-tm-nm'):escHtml(p.name)} <span class="la-tm-pos la-pos-${escAttr(posc)}">${escHtml(posc)}</span><span class="la-tm-team">· ${escHtml(p.team||'FA')}</span></div>
        <div class="la-tm-l2">${(typeof laGameLineHTML==='function' && laGameLineHTML(p, wk, dvp))||'<span class="la-gm la-gm-none">schedule pending</span>'}</div>
        ${l3?`<div class="la-tm-l3">${l3}</div>`:''}
      </div>
      <div class="la-tm-proj"><b title="This week's projection under this league's scoring">${(+m.adj||0).toFixed(1)}</b>${m.net!=null?`<span class="la-wv-net" title="${m.dyn?'Dynasty chart value over replacement, net of the player he replaces':'Rest-of-season value over replacement, net of the player he replaces, per game'}">${m.net>=0?'+':''}${m.net.toFixed(m.dyn?0:1)}${m.dyn?' dyn':'/gm'}</span>`:''}${m.bid!=null?`<span class="la-wv-bid" title="Suggested bid: his rest-of-season value against the top pickups still ahead, split across the league, as a share of what you have left">$${m.bid}</span>`:''}</div>
    </div>`;
  };
  const pairs=res.adds.map(c=>{
    const whys=c.reasons.map(r=>({k:r.k, label:LA_WHY_LABEL[r.k]||r.k, text:r.text}));
    if(c.dur){
      if(c.dur.score>=0.65) whys.push({k:'sticky', label:'sticky', text:c.dur.sticky.join(' · ')||'usage and efficiency both back it'});
      else if(c.dur.score<=0.35) whys.push({k:'fleeting', label:'fleeting', text:c.dur.fleeting.join(' · ')||'one-week production'});
      if(c.dur.trend) whys.push({k:'trend', label:'trending', text:c.dur.trend+' — expect competition for him'});
    }
    if(c.startsOver) whys.push({k:'starts', label:`starts over ${c.startsOver.name}`, text:`Beats your weakest eligible starter (${c.startsOver.slot}) by ${c.startsOver.delta} this week`});
    const add=row({id:c.id,name:c.name,pos:c.pos,team:c.team}, 'add', {adj:c.wp.adj, net:c.net, dyn:!!c.dynasty, bid:c.faab?c.faab.bid:null, whys});
    const drop=c.drop ? row({id:c.drop.id,name:c.drop.name,pos:c.drop.pos,team:c.drop.team}, 'drop',
      {adj:c.drop.value||0, net:null, bid:null, whys:[{k:'drop', label:`${c.drop.vor>=0?'+':''}${(c.drop.vor||0).toFixed(c.dynasty?0:1)}${c.dynasty?' dyn':'/gm'} over replacement`, text:c.dynasty?'Dynasty chart value over what is freely available at his position — the least you would miss':'Rest-of-season value over what is freely available at his position — the least you would miss'}]}) : '';
    return `<div class="la-wv-pair">${add}${drop}</div>`;
  }).join('');
  const faab=res.faab ? `<span class="la-wv-faab" title="FAAB left · ${res.faab.curve?'this league\'s past seasons':'no league history yet (linear decay)'} say about ${(hubFaabAdvice(1,res.wk,res.faab.curve,res.teams,res.faab.budget,res.faab.left).spentShould*100).toFixed(0)}% of the season\'s pickup value is behind you by week ${res.wk}">FAAB <b>$${res.faab.left}</b> / $${res.faab.budget}</span>` : '';
  const body = pairs ? `<div class="card la-tm-card">${pairs}</div>` : `<div class="card la-tm-card"><div class="la-wv-none">Nothing on the wire beats what you have.</div></div>`;
  return `<div class="la-ins-bar"><span class="la-ins-lbl">WAIVER WIRE · WEEK ${wk}</span>
      <span class="la-ins-sub">each add names the drop it beats</span>${faab}
      <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="laSetTab('hub')" title="Every league at once">Multi-League →</button></div>
    ${body}`;
}
function laThisWeekCardHTML(s){ return laWaiverSectionHTML(s); }
function hubViewHTML(s){
  const wk = hubState.week || ((typeof laCurrentWeek==='function')?laCurrentWeek():1);
  if(!hubState.leagues.length && !hubState.busy && !hubState.loadedAt && !hubState.error) setTimeout(()=>hubLoadAll(false), 0);
  const cards = hubState.leagues.map(l=>hubState.results[l.league_id] ? _hubLeagueCard(hubState.results[l.league_id]) : `<div class="card hub-league"><div class="hub-lg-head"><b>${escHtml(l.name||'League')}</b><span class="hub-lg-sum">${hubState.busy?'…':''}</span></div></div>`).join('');
  return `<div class="hub-head"><div class="team-qb-name">week ${wk} · every synced league ${(typeof tcInfoBtn==='function')?tcInfoBtn('weekhub','What this is'):''}</div>
      <button class="btn btn-ghost btn-sm" onclick="hubLoadAll(true)" ${hubState.busy?'disabled':''}>${hubState.busy?'Loading…':'Refresh'}</button></div>
    ${hubState.error?`<div class="alert alert-warn">${escHtml(hubState.error)}</div>`:''}
    ${cards || (hubState.busy?'':'<div class="empty"><div class="empty-title">No leagues yet</div><div class="empty-body">Sync a Sleeper league; every league on that account shows up here.</div></div>')}`;
}
TC_INFO_BOOK.weekhub={title:'This Week', body:()=>`
<p>Every synced league at once, scored under each league's own settings.</p>
<p><b>Lineup.</b> This week's projection blends the season projection, season points per game and the last three weeks, then adjusts for the opponent's defense against the position (the small #). The optimal lineup is diffed against what you have set: <b>START</b> is a clear swap (${HUB_CLOSE}+ points or the starter can't play), <b>CLOSE</b> is under that, <b>CLOSE CALL</b> means you have the right player in but a bench player is within reach. Players whose game has kicked off stay put.</p>
<p><b>Adds.</b> Only a pickup that beats the roster player he pushes off — his rest-of-season value <i>over replacement</i> (in a dynasty or keeper league, his dynasty-chart value over replacement instead; a chopped league is this season only) (what is freely available at the position in this league) net of the drop's, at least ${HUB_ADD_MIN}/game or a start this week. Starters in this week's optimal lineup and in the rest-of-season optimal lineup are never the drop. The reason: <b>role opened</b> (a teammate ahead of him is out), <b>usage spike</b> (touches far above his own baseline), <b>soft schedule</b> (next three opponents generous to his position), <b>efficient</b> (his per-target or per-carry rank backs the volume). "Starts over" says he'd beat your weakest starter now.</p>
<p><b>Sticky or fleeting.</b> Before a surge's upside counts, it is weighed: a target or carry share sustained across weeks and efficiency behind it (EPA per target, separation, RYOE, red-zone carries) make it <b>sticky</b>; TD-driven points on light volume, extreme YAC over expectation, a one-week absence upstream or a soft stretch of schedule make it <b>fleeting</b>. Sticky surges keep most of their upside; fleeting ones keep little — and a roster player whose production looks fleeting is the easier drop. <b>Trending</b> marks a player the whole league is reaching for this week.</p>
<p><b>FAAB.</b> The waiver wire is worth most early: a pickup is his rest-of-season value, and the pool of obvious pickups drains as the season goes. The suggested bid is his value against the top pickups still ahead (split across the league), as a share of what you have left. The curve comes from this league's own past seasons when it has them.</p>`};
