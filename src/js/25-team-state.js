// ─────────────────────────────────────────────────────────────────────────────
// State init
// ─────────────────────────────────────────────────────────────────────────────
function ensureTeam(team,qbsFromData){
  if(userProj[team]) return userProj[team];
  mergeRosterPlayers(team);   // add zero-stat rostered players so they're selectable
  const seedQBs=getBase(team,'QB');
  const src=qbsFromData||seedQBs;
  userProj[team]={
    qbs:src.map((qb,i)=>{
      const gp=parseFloat(qb.games_played)||0;
      // Prefer the seed's projected `games` (set by projectQBGames from yard share);
      // fall back to real gp, then to a sensible default (starter full season, backups 0).
      let games;
      if(qb.games!=null) games=parseFloat(qb.games)||0;
      else if(gp>0 && gp<=SEASON_GAMES) games=gp;  // real historical gp (≤17)
      else games = (i===0?SEASON_GAMES:0);
      const baseStats = (games>0?games:1);
      const o={
        name:qb.name,headshot:qb.headshot||null,slug:qb.slug||null,player_id:qb.player_id||null,
        adp:parseFloat(qb.adp)||999,adp_ppr:parseFloat(qb.adp_ppr)||999,
        adp_half_ppr:parseFloat(qb.adp_half_ppr)||999,adp_2qb:parseFloat(qb.adp_2qb)||999,
        passing_yards:parseFloat(qb.passing_yards)||0,
        passing_tds:parseFloat(qb.passing_touchdowns||qb.passing_tds)||0,
        passing_attempts:parseFloat(qb.passing_attempts)||0,
        passing_completions:parseFloat(qb.passing_completions)||0,
        interceptions_thrown:parseFloat(qb.interceptions_thrown)||0,
        qb_rush_yards:parseFloat(qb.rushing_yards)||0,
        qb_rush_tds:parseFloat(qb.rushing_touchdowns||qb.rushing_tds)||0,
        qb_rush_attempts:parseFloat(qb.rushing_attempts)||0,
        games_played:(gp<=SEASON_GAMES?gp:0),
        games:games,
        base_games:baseStats,
        snap_pct:(qb.snap_pct!=null)?qb.snap_pct:100,
        snap_share:(typeof qb.snap_share==='number')?qb.snap_share:1/src.length,
      };
      return o;
    }),
    activeQB:0, passing_shares:null,
    rushing:{mode:'carries',total_attempts:null,total_yards:null,ypa:null,shares:null}
  };
  return userProj[team];
}

// Per-game rate for a QB stat. Prefers the stored rate snapshot (survives 0 games),
// else derives from current totals / base_games.
function perGame(qb,key){
  if(qb._rate && qb._rate[key]!=null) return qb._rate[key];
  const bg=qb.base_games||1; return (qb[key]||0)/bg;
}
// Stat projected to the QB's current `games` setting (pace × games).
function pace(qb,key){ return perGame(qb,key)*(qb.games||0); }

function initPassingShares(team){
  const state=ensureTeam(team);
  if(state.passing_shares) return;
  // Include ALL WR/TE on the roster (even zero-stat, so upside picks like a buried TE are
  // selectable), plus RBs with meaningful receiving work.
  // An RB qualifies on EITHER the current row (proj, or copied reference stats) OR their
  // projection-season role — so copying a season where a featured back barely caught passes
  // (or hadn't debuted) can't knock him out of the receiving options. Roster membership is
  // decided by the projected roster; the copied stats only set his baseline (possibly 0).
  const projRbQualifies = p => {
    const r=p._proj_role;   // projected role snapshotted before a reference copy overwrote the row
    return !!(r && ((r.tgt>5)||(r.rec>5)));
  };
  let all=[...getBase(team,'WR'),...getBase(team,'TE'),
    ...getBase(team,'RB').filter(p=>(p.receiving_targets>5)||(p.receptions>5)||projRbQualifies(p))];
  // Reference-season week-range filter active? Overlay windowed totals onto the roster
  // before computing shares — everything downstream (pies, edits) just works on it.
  if(isWeekFilterActive(state) && state.weekFilterData) all=applyWeekFilterOverrides(all, state.weekFilterData);
  // If targets are missing entirely, fall back to receptions for the share denominator.
  const hasTargets = all.some(p=>p.receiving_targets>0);
  const weightOf = p => hasTargets ? (p.receiving_targets||0) : (p.receptions||0);
  const total=all.reduce((s,p)=>s+weightOf(p),0)||1;
  const totalTDs=all.reduce((s,p)=>s+(p.receiving_tds||0),0)||0;
  // Anchor the team target pool to the ACTUAL sum of receiver targets in the data,
  // so share×pool reproduces each player's real targets exactly (no inflation).
  // teamPassAtt×TARGET_RATE is only used as a fallback if no receiver data exists.
  state.team_targets = total;
  state.base_pass_att = teamPassAtt(state); // QB attempts at the moment shares were built
  state.passing_shares=all.map(p=>{
    // If targets are missing, estimate them from receptions so per-player math works.
    const cr = p.pos==='TE' ? 0.68 : 0.65;
    const tgts = p.receiving_targets>0 ? p.receiving_targets
               : (p.receptions>0 ? Math.round(p.receptions/cr) : 0);
    return {
      name:p.name,pos:p.pos,headshot:p.headshot||null,slug:p.slug||null,player_id:p.player_id||null,
      baseline_targets:tgts,baseline_yards:p.receiving_yards,
      baseline_tds:p.receiving_tds||0,baseline_rec:p.receptions,
      share:weightOf(p)/total,
      td_share:totalTDs>0?(p.receiving_tds||0)/totalTDs:1/all.length,
      ypt:tgts>0?p.receiving_yards/tgts:9,
      catch_rate:tgts>0?p.receptions/tgts:cr,
      adp:parseFloat(p.adp)||999,adp_ppr:parseFloat(p.adp_ppr)||999,adp_half_ppr:parseFloat(p.adp_half_ppr)||999,adp_2qb:parseFloat(p.adp_2qb)||999,
    };
  });
  // team_targets should reflect derived targets when actuals are missing
  state.team_targets = state.passing_shares.reduce((s,p)=>s+p.baseline_targets,0)||total;
}

function initRushingShares(team){
  const state=ensureTeam(team);
  if(state.rushing.shares) return;
  let rbs=getBase(team,'RB');
  if(isWeekFilterActive(state) && state.weekFilterData) rbs=applyWeekFilterOverrides(rbs, state.weekFilterData);
  const elig=rbs.filter(p=>p.rushing_attempts>0||p.adp<300);
  const src=elig.length?elig:rbs.slice(0,2);
  const totalAtt=src.reduce((s,p)=>s+p.rushing_attempts,0)||200;
  const totalYds=src.reduce((s,p)=>s+p.rushing_yards,0)||1600;
  const totalTDs=src.reduce((s,p)=>s+(p.rushing_tds||0),0)||0;
  state.rushing.total_attempts=totalAtt;
  state.rushing.total_yards=totalYds;
  state.rushing.ypa=totalAtt>0?totalYds/totalAtt:4.0;
  state.rushing.total_rush_tds=totalTDs;
  state.rushing.shares=src.map(p=>({
    name:p.name,pos:'RB',headshot:p.headshot||null,slug:p.slug||null,player_id:p.player_id||null,
    baseline_att:p.rushing_attempts,baseline_yards:p.rushing_yards,baseline_tds:p.rushing_tds||0,
    share:totalAtt>0?p.rushing_attempts/totalAtt:1/src.length,
    td_share:totalTDs>0?(p.rushing_tds||0)/totalTDs:1/src.length,
    ypc:p.rushing_attempts>0?p.rushing_yards/p.rushing_attempts:4.0,
    adp:parseFloat(p.adp)||999,adp_ppr:parseFloat(p.adp_ppr)||999,adp_half_ppr:parseFloat(p.adp_half_ppr)||999,adp_2qb:parseFloat(p.adp_2qb)||999,
  }));
  recomputeTeamRushYards(state); // sync total yards to sum of per-player (att×ypc)
}

// Team rush TD total — held in state so editing a player's absolute TDs can grow/shrink it.
function teamRushTDs(state){
  const r=state.rushing;
  if(r&&typeof r.total_rush_tds==='number') return r.total_rush_tds;
  return r&&r.shares ? r.shares.reduce((s,p)=>s+(p.baseline_tds||0),0)||0 : 0;
}

// Team rush yards = sum of each RB's (carries × their ypc). Keeps pie + total in sync.
function recomputeTeamRushYards(state){
  const r=state.rushing;
  if(!r.shares) return;
  let total=0;
  r.shares.forEach(p=>{ total += Math.round(p.share*r.total_attempts)*(p.ypc||r.ypa||4); });
  r.total_yards=Math.round(total);
  if(r.total_attempts>0) r.ypa=r.total_yards/r.total_attempts;
}

