// ── Keep Trade Cut mini-game (rankings personalization loop) ───────────────
// Lightweight preference game layered on top of Full Rankings. Each round presents
// three closely-ranked players; KEEP/TRADE/CUT ordering nudges underlying projections so
// ranking order aligns with user preference over time.

const KTC_ROLE_LABELS = ['KEEP', 'TRADE', 'CUT'];
const KTC_ROLE_CLASS = ['keep', 'trade', 'cut'];
const KTC_MIN_GAP = 0.45; // target fpts gap between KEEP>TRADE and TRADE>CUT
const KTC_SOFT_CORRECTION = 0.42; // balanced per-round fraction of ordering deficit to correct
const KTC_MIN_ROUND_BUDGET = 1.0; // balanced minimum total fpts movement budget per player/round
const KTC_MAX_ROUND_BUDGET = 2.1; // hard ceiling to avoid drastic projection swings
// Lower numeric tier is better (Tier 1 is elite). Keep KTC mostly in top tiers.
const KTC_TARGET_TIER_MIN = 4;
const KTC_TARGET_TIER_MAX = 6;
const KTC_SIGNAL_MAX_SPREAD = {
  ADP: 10,
  ECR: 10,
  VOR: 10,
};
const KTC_POS_CYCLE = ['QB', 'RB', 'WR', 'TE'];
const KTC_INTENSITY = {
  conservative: {
    label: 'Conservative',
    softCorrection: 0.34,
    budgetScale: 0.27,
    minBudget: 0.8,
    maxBudget: 1.6,
    microCap: 0.08,
    topoff1Scale: 0.24,
    topoff1Cap: 0.34,
    topoff2Scale: 0.22,
    topoff2Cap: 0.3,
  },
  balanced: {
    label: 'Balanced',
    softCorrection: KTC_SOFT_CORRECTION,
    budgetScale: 0.34,
    minBudget: KTC_MIN_ROUND_BUDGET,
    maxBudget: KTC_MAX_ROUND_BUDGET,
    microCap: 0.12,
    topoff1Scale: 0.36,
    topoff1Cap: 0.5,
    topoff2Scale: 0.34,
    topoff2Cap: 0.45,
  },
  aggressive: {
    label: 'Aggressive',
    softCorrection: 0.52,
    budgetScale: 0.4,
    minBudget: 1.15,
    maxBudget: 2.55,
    microCap: 0.16,
    topoff1Scale: 0.48,
    topoff1Cap: 0.74,
    topoff2Scale: 0.44,
    topoff2Cap: 0.66,
  }
};

let ktcGameState = {
  active: false,
  trio: [],
  trioTag: 'ECR',
  trioWhy: 'ecr-cluster',
  selection: [],
  cursor: 0,
  posCursor: 0,
  lastSig: '',
  rounds: 0,
  skips: 0,
  intensity: 'balanced',
  samePosStreak: 0,
  seenCounts: {},
  recentKeys: [],
  recentTrioSigs: [],
  recentTags: [],
};

function ktcPlayerKey(p){
  if(!p) return '';
  const pid = p.player_id ? String(p.player_id) : ecrNormName(p.name||'');
  return `${String(p.team||'').toUpperCase()}|${String(p.pos||'').toUpperCase()}|${pid}`;
}

function ktcPlayerByKey(trio, key){
  if(!Array.isArray(trio)) return null;
  return trio.find(p=>ktcPlayerKey(p)===String(key||'')) || null;
}

function ktcIntensityCfg(level){
  return KTC_INTENSITY[String(level||'').toLowerCase()] || KTC_INTENSITY.balanced;
}

function ktcIntensityKey(){
  const key = String(ktcGameState.intensity||'balanced').toLowerCase();
  return KTC_INTENSITY[key] ? key : 'balanced';
}

function ktcSetIntensity(level){
  const key = String(level||'').toLowerCase();
  if(!KTC_INTENSITY[key]) return;
  ktcGameState.intensity = key;
  if(ktcGameState.active) renderKtcOverlay();
}

function ktcEcrTierVal(p){
  if(!p) return null;
  const raw = p.ecr_tier!=null ? p.ecr_tier : (typeof ecrTierFor==='function' ? ecrTierFor(p) : null);
  const v = Number(raw);
  return Number.isFinite(v) && v>0 ? v : null;
}

function ktcEcrRankVal(p){
  if(!p) return 9999;
  const raw = p.ecr!=null ? p.ecr : (typeof ecrFor==='function' ? ecrFor(p) : null);
  const v = Number(raw);
  return Number.isFinite(v) && v>0 ? v : 9999;
}

function ktcTopTierCutoff(board){
  if(!Array.isArray(board) || !board.length) return KTC_TARGET_TIER_MAX;
  const tiers = board.map(ktcEcrTierVal).filter(v=>v!=null).sort((a,b)=>a-b);
  if(!tiers.length) return KTC_TARGET_TIER_MAX;
  // Use roughly the top half, then clamp to a strict top-tier window.
  const p55 = tiers[Math.min(tiers.length-1, Math.floor(tiers.length*0.55))];
  return ktcClamp(Math.round(p55), KTC_TARGET_TIER_MIN, KTC_TARGET_TIER_MAX);
}

function ktcRoundBudget(trio, level){
  const cfg = ktcIntensityCfg(level||ktcIntensityKey());
  if(!Array.isArray(trio) || trio.length!==3) return cfg.minBudget;
  const samePos = new Set(trio.map(p=>String((p&&p.pos)||''))).size===1;
  const vals = trio.map(p=>samePos?(+p.fpts||0):(+p.vor||0));
  const spread = Math.max(...vals) - Math.min(...vals);
  // Mixed-position rounds run on VOR-space; allow a bit more budget than raw-FPTS rounds.
  const scale = samePos ? 1 : 0.16;
  const maxBudget = samePos ? cfg.maxBudget : (cfg.maxBudget*1.45);
  return ktcClamp(spread*cfg.budgetScale*scale, cfg.minBudget, maxBudget);
}

function ktcSignalMode(trio){
  if(!Array.isArray(trio) || !trio.length) return 'same_pos';
  return new Set(trio.map(p=>String((p&&p.pos)||''))).size===1 ? 'same_pos' : 'cross_pos';
}

function ktcSignalDeltaToFpts(player, delta, mode){
  const d = +delta||0;
  if(!Number.isFinite(d) || Math.abs(d)<0.0001) return 0;
  if(mode==='same_pos') return d;
  // Cross-position rounds are judged in VOR-space; convert to a small projection nudge.
  const pos = String((player&&player.pos)||'');
  const scale = (pos==='QB') ? 0.18 : 0.24;
  return d*scale;
}

function ktcScoreSummary(p){
  const n = v=>Math.round(+v||0).toLocaleString();
  const d = v=>((+v||0)%1!==0 ? (+v).toFixed(1) : String(Math.round(+v||0)));
  if(!p) return ['No projection data'];
  if(p.pos==='QB'){
    return [
      `${n(p.passing_yards)} pass yds · ${d(p.passing_tds)} pass TD · ${n(p.interceptions_thrown)} INT`,
      `${n(p.rushing_yards)} rush yds · ${d(p.rushing_tds)} rush TD`
    ];
  }
  if(p.pos==='RB'){
    return [
      `${n(p.rushing_attempts)} att · ${n(p.rushing_yards)} rush yds · ${d(p.rushing_tds)} rush TD`,
      `${d(p.fpts)} FPTS`
    ];
  }
  return [
    `${n(p.receiving_targets)} tgt · ${n(p.receptions)} rec · ${n(p.receiving_yards)} rec yds`,
    `${d(p.receiving_tds)} rec TD · ${d(p.fpts)} FPTS`
  ];
}

function ktcEligibleBoard(){
  const all = buildPlayerList()
    .filter(p=>p && (p.pos==='QB' || p.pos==='RB' || p.pos==='WR' || p.pos==='TE') && (p.fpts||0)>0)
    .sort((a,b)=>b.fpts-a.fpts);
  all.forEach((p,i)=>{ p._ktcRank = i+1; });
  return all;
}

function ktcAdpVal(p){
  const v = adpFor(p);
  return Number.isFinite(+v) ? +v : 999;
}

function ktcFormatKey(){
  return String(typeof rankFormat==='string' ? rankFormat : '').toLowerCase();
}

function ktcFormatProfile(){
  const f = ktcFormatKey();
  if(f==='superflex' || f==='dynasty_superflex'){
    return { adpW: 0.46, ecrW: 0.26, fptsW: 0.2, tdsW: 0.08, adpTarget: 16, fptsTarget: 8.5 };
  }
  if(f==='std'){
    return { adpW: 0.33, ecrW: 0.27, fptsW: 0.24, tdsW: 0.16, adpTarget: 20, fptsTarget: 8.2 };
  }
  if(f==='half_ppr'){
    return { adpW: 0.35, ecrW: 0.29, fptsW: 0.24, tdsW: 0.12, adpTarget: 19, fptsTarget: 8.0 };
  }
  // ppr + dynasty default profile: use ADP/ECR as anchors, then projections.
  return { adpW: 0.37, ecrW: 0.31, fptsW: 0.24, tdsW: 0.08, adpTarget: 18, fptsTarget: 7.8 };
}

function ktcTdPoints(p){
  if(!p) return 0;
  const sc = scoringSettings || {};
  const passTd = (+p.passing_tds||0) * (+sc.passing_touchdowns||0);
  const rushTd = (+p.rushing_tds||0) * (+sc.rushing_touchdowns||0);
  const recTd = (+p.receiving_tds||0) * (+sc.receiving_touchdowns||0);
  return passTd + rushTd + recTd;
}

function ktcBuildMixedBoard(pool){
  const list = Array.isArray(pool) ? pool.slice() : [];
  if(!list.length) return [];
  const profile = ktcFormatProfile();
  const fptsRanks = list.slice().sort((a,b)=>(+b.fpts||0)-(+a.fpts||0));
  const adpRanks = list.slice().sort((a,b)=>ktcAdpVal(a)-ktcAdpVal(b));
  const ecrRanks = list.slice().sort((a,b)=>ktcEcrRankVal(a)-ktcEcrRankVal(b));
  const idx = new Map();
  const keyOf = p=>ktcPlayerKey(p);
  fptsRanks.forEach((p,i)=>{ const k=keyOf(p); const x=idx.get(k)||{}; x.f=i+1; idx.set(k,x); });
  adpRanks.forEach((p,i)=>{ const k=keyOf(p); const x=idx.get(k)||{}; x.a=i+1; idx.set(k,x); });
  ecrRanks.forEach((p,i)=>{ const k=keyOf(p); const x=idx.get(k)||{}; x.e=i+1; idx.set(k,x); });
  const n=Math.max(1,list.length);
  return list.map(p=>{
    const r=idx.get(keyOf(p))||{};
    const fn=(Number.isFinite(r.f)?r.f:n)/n;
    const an=(Number.isFinite(r.a)?r.a:n)/n;
    const en=(Number.isFinite(r.e)?r.e:n)/n;
    const mix = (fn*profile.fptsW) + (an*profile.adpW) + (en*profile.ecrW);
    return Object.assign({}, p, { _ktcMix: mix });
  }).sort((a,b)=>(+a._ktcMix||0)-(+b._ktcMix||0));
}

function ktcPushRecent(key){
  const k = String(key||'');
  if(!k) return;
  ktcGameState.recentKeys.push(k);
  if(ktcGameState.recentKeys.length>30) ktcGameState.recentKeys.shift();
}

function ktcTrioSig(trio){
  if(!Array.isArray(trio) || trio.length!==3) return '';
  return trio.map(ktcPlayerKey).sort().join('~');
}

function ktcPushRecentTrioSig(sig){
  const s = String(sig||'');
  if(!s) return;
  ktcGameState.recentTrioSigs.push(s);
  if(ktcGameState.recentTrioSigs.length>28) ktcGameState.recentTrioSigs.shift();
}

function ktcPushRecentTag(tag){
  const t = String(tag||'').toUpperCase();
  if(!t) return;
  ktcGameState.recentTags.push(t);
  if(ktcGameState.recentTags.length>16) ktcGameState.recentTags.shift();
}

function ktcTagSeenCount(tag){
  const t = String(tag||'').toUpperCase();
  if(!t) return 0;
  return (ktcGameState.recentTags||[]).reduce((n,x)=>n + (String(x||'').toUpperCase()===t ? 1 : 0), 0);
}

function ktcTrioRepeatPenalty(sig){
  const recent = ktcGameState.recentTrioSigs||[];
  if(!recent.length || !sig) return 0;
  let pen = 0;
  for(let i=recent.length-1, age=1;i>=0;i--,age++){
    if(recent[i]!==sig) continue;
    // Strongly penalize exact-repeat trios, especially if they appeared recently.
    pen += Math.max(4, 32 - age*2.4);
  }
  return pen;
}

function ktcMarkShown(trio){
  if(!Array.isArray(trio)) return;
  trio.forEach(p=>{
    const k = ktcPlayerKey(p);
    ktcGameState.seenCounts[k] = (ktcGameState.seenCounts[k]||0) + 1;
    ktcPushRecent(k);
  });
  ktcPushRecentTrioSig(ktcTrioSig(trio));
  ktcPushRecentTag(ktcGameState.trioTag||'FPTS');
}

function ktcRecentPenalty(trio){
  const recent = new Set(ktcGameState.recentKeys||[]);
  return trio.reduce((s,p)=> s + (recent.has(ktcPlayerKey(p)) ? 1 : 0), 0);
}

function ktcSeenPenalty(trio){
  return trio.reduce((s,p)=> s + (ktcGameState.seenCounts[ktcPlayerKey(p)]||0), 0);
}

function ktcPreferredPos(){
  return KTC_POS_CYCLE[ktcGameState.posCursor % KTC_POS_CYCLE.length];
}

function ktcTrioDetail(trio, targetPos){
  if(!Array.isArray(trio) || trio.length!==3) return {score:-1e9, tag:'ECR', why:'ecr-cluster'};
  const profile = ktcFormatProfile();
  const signalMode = ktcSignalMode(trio);
  const samePos = signalMode==='same_pos';
  const sorted = trio.slice().sort((a,b)=> (samePos?((+b.fpts||0)-(+a.fpts||0)):((+b.vor||0)-(+a.vor||0))));
  const fptsSpread = samePos ? ((+sorted[0].fpts||0) - (+sorted[2].fpts||0)) : 0;
  const rankSpread = (+sorted[2]._ktcRank||0) - (+sorted[0]._ktcRank||0);
  const adps = sorted.map(ktcAdpVal).filter(v=>v<900);
  const adpSpread = adps.length>1 ? (Math.max(...adps)-Math.min(...adps)) : 90;
  const ecrs = sorted.map(ktcEcrRankVal).filter(v=>v<9000);
  const ecrSpread = ecrs.length>1 ? (Math.max(...ecrs)-Math.min(...ecrs)) : 220;
  const tdVals = sorted.map(ktcTdPoints);
  const tdSpread = (Math.max(...tdVals)-Math.min(...tdVals));
  const tierVals = sorted.map(p=>ktcEcrTierVal(p)).filter(v=>v!=null);
  const tierSpread = tierVals.length>1 ? (Math.max(...tierVals)-Math.min(...tierVals)) : 8;
  const tierAligned = (tierVals.length===3 && tierSpread<=0.0001);
  const tierCutoff = ktcGameState.tierCutoff || KTC_TARGET_TIER_MAX;
  const tierTopAligned = tierAligned && tierVals.length===3 && Math.max(...tierVals) <= tierCutoff;
  const vorVals = sorted.map(p=>+p.vor||0);
  const vorSpread = Math.max(...vorVals)-Math.min(...vorVals);
  const mixVals = sorted.map(p=>+p._ktcMix||0);
  const mixSpread = Math.max(...mixVals)-Math.min(...mixVals);
  const samePosCt = sorted.filter(p=>p.pos===targetPos).length;
  const uniqueTeams = new Set(sorted.map(p=>p.team)).size;
  const recentPenalty = ktcRecentPenalty(sorted);
  const seenPenalty = ktcSeenPenalty(sorted);
  const trioSig = ktcTrioSig(sorted);
  const trioRepeatPenalty = ktcTrioRepeatPenalty(trioSig);
  const tierBonus = sorted.reduce((s,p)=>{
    const t = ktcEcrTierVal(p);
    if(t==null) return s - 4;
    if(t<=tierCutoff-1) return s + 8;
    if(t<=tierCutoff) return s + 5;
    if(t<=tierCutoff+2) return s + 1;
    return s - 8;
  }, 0);
  const ecrBonus = sorted.reduce((s,p)=>{
    const r = ktcEcrRankVal(p);
    if(r<=72) return s + 4;
    if(r<=120) return s + 2;
    if(r<=180) return s + 0.5;
    return s - 3;
  }, 0);

  const fptsFit = Math.max(-18, 12 - Math.abs(fptsSpread - profile.fptsTarget));
  const adpFit = Math.max(-12, 8 - Math.abs(adpSpread - profile.adpTarget)*0.24);
  const ecrFit = Math.max(-10, 7 - Math.abs(ecrSpread - 22)*0.18);
  const tdFit = Math.max(-7, 4 - Math.abs(tdSpread - 3.6)*0.32);
  const tierFit = Math.max(-8, 5 - Math.abs(tierSpread - 1.8)*1.25);
  const vorFit = Math.max(-8, 5 - Math.abs(vorSpread - 34)*0.09);
  const mixFit = Math.max(-10, 7 - Math.abs(mixSpread - 0.14)*26);

  // Keep rounds non-obvious: trio members should be reasonably close to each other.
  const closeRule = {
    fpts: samePos ? (fptsSpread <= Math.max(profile.fptsTarget + 7, 14)) : true,
    rank: rankSpread <= 22,
    adp: adps.length<2 || adpSpread <= 12,
    ecr: ecrs.length<2 || ecrSpread <= 12,
    tier: tierVals.length<2 || tierSpread <= 3.2,
    vor: vorSpread <= 18,
  };
  const closeHits = Object.values(closeRule).reduce((n,x)=>n + (x?1:0), 0);
  const closeOk = !!(closeRule.fpts && closeRule.rank && closeHits>=4);

  // Signal-specific guardrails: if we label a trio as ADP/ECR/VOR, it must be tightly clustered
  // on that exact signal using valid values for all 3 players.
  const signalClose = {
    ADP: adps.length===3 && adpSpread <= KTC_SIGNAL_MAX_SPREAD.ADP,
    ECR: ecrs.length===3 && ecrSpread <= KTC_SIGNAL_MAX_SPREAD.ECR,
    VOR: vorSpread <= KTC_SIGNAL_MAX_SPREAD.VOR,
  };
  const hasMixedSignal = signalClose.ADP || signalClose.ECR || signalClose.VOR || tierTopAligned;

  let score = 0;
  // Keep position coherence as a preference, but avoid hard-locking to all-same-position trios.
  score += (samePosCt===3 ? 8 : samePosCt===2 ? 12 : 3);
  if(samePos) score += fptsFit * (0.8 + profile.fptsW);
  score += Math.max(-12, 7 - Math.abs(rankSpread - 14));
  score += adpFit * (1.0 + profile.adpW);
  score += ecrFit * (0.9 + profile.ecrW);
  score += tdFit * (0.7 + profile.tdsW);
  score += tierFit * 0.95;
  score += vorFit * 0.9;
  score += mixFit;
  score += tierBonus;
  score += ecrBonus;
  score += (uniqueTeams===3 ? 3 : -2);
  score -= recentPenalty * 9;
  score -= seenPenalty * 2.4;
  score -= trioRepeatPenalty;
  if(!closeOk) score -= 22;
  score += Math.random()*0.7;

  // One-word reason tag for why this trio is clustered.
  const tagScores = {
    ADP: signalClose.ADP ? (adpFit*(1+profile.adpW) - (ktcTagSeenCount('ADP')*1.55)) : -1e9,
    ECR: signalClose.ECR ? (ecrFit*(1+profile.ecrW) - (ktcTagSeenCount('ECR')*1.55)) : -1e9,
    FPTS: samePos ? (fptsFit*(1+profile.fptsW) - (ktcTagSeenCount('FPTS')*1.55)) : -1e9,
    TIER: tierTopAligned ? (tierFit*1.1 - (ktcTagSeenCount('TIER')*1.55)) : -1e9,
    VOR: signalClose.VOR ? (vorFit*1.05 - (ktcTagSeenCount('VOR')*1.55)) : -1e9,
  };
  let tag=samePos?'FPTS':'ECR';
  let best=Number.NEGATIVE_INFINITY;
  Object.keys(tagScores).forEach(k=>{ if(tagScores[k]>best){ best=tagScores[k]; tag=k; } });
  const whyMap = {
    ADP:'adp-cluster',
    ECR:'ecr-cluster',
    FPTS:'fpts-cluster',
    TIER:'tier-cluster',
    VOR:'vor-cluster',
  };
  return {score, tag, why: whyMap[tag] || (samePos?'fpts-cluster':'ecr-cluster'), sig: trioSig, closeOk, closeHits, signalMode, hasMixedSignal};
}

function ktcTrioScore(trio, targetPos){
  return ktcTrioDetail(trio, targetPos).score;
}

function ktcFallbackTrio(board, requireMixed){
  const n = board.length;
  const base = Math.max(1, Math.min(n-2, ktcGameState.cursor || Math.floor(n*0.35)));
  let trio = [board[base-1], board[base], board[base+1]];
  if(requireMixed){
    const from = Math.max(0, base-12);
    const to = Math.min(n-1, base+12);
    const cand = board.slice(from, to+1);
    outer:
    for(let i=0;i<cand.length-2;i++){
      for(let j=i+1;j<cand.length-1;j++){
        for(let k=j+1;k<cand.length;k++){
          const pset = new Set([cand[i].pos, cand[j].pos, cand[k].pos]);
          if(pset.size>=2){ trio = [cand[i], cand[j], cand[k]]; break outer; }
        }
      }
    }
  }
  ktcGameState.cursor = (base + 6) % Math.max(3, n-1);
  return trio;
}

function ktcPickNextTrio(preBoard){
  const board = (Array.isArray(preBoard) && preBoard.length) ? preBoard : ktcEligibleBoard();
  if(board.length<3){
    stopKtcGame('Not enough projected players for Keep Trade Cut.');
    return false;
  }
  const tierKnownBoard = board.filter(p=>ktcEcrTierVal(p)!=null);
  if(tierKnownBoard.length<3){
    stopKtcGame('KTC needs FantasyPros tiers. Rebuild seed/load ECR tier data and try again.');
    return false;
  }
  const tierCutoff = ktcTopTierCutoff(tierKnownBoard);
  ktcGameState.tierCutoff = tierCutoff;
  const tierPool = tierKnownBoard.filter(p=>{
    const t = ktcEcrTierVal(p);
    return t!=null && t<=tierCutoff;
  });
  const tierPlayablePool = tierKnownBoard.filter(p=>{
    const t = ktcEcrTierVal(p);
    return t!=null && t<=Math.max(tierCutoff+2, KTC_TARGET_TIER_MAX+1);
  });
  const ecrPool = tierKnownBoard.filter(p=>ktcEcrRankVal(p)<=170);
  const targetPos = ktcPreferredPos();
  const preferredBoard =
    tierPool.length>=18 ? tierPool
    : (tierPlayablePool.length>=18 ? tierPlayablePool
    : (ecrPool.length>=18 ? ecrPool : tierPlayablePool.length ? tierPlayablePool : tierKnownBoard));
  const posPool = preferredBoard.filter(p=>p.pos===targetPos);
  const poolRaw = posPool.length>=10 ? posPool : preferredBoard;
  const pool = ktcBuildMixedBoard(poolRaw);
  const n = pool.length;
  const base = Math.max(1, Math.min(n-2, ktcGameState.cursor||Math.floor(n*0.35)));
  const from = Math.max(0, base-16);
  const to = Math.min(n-1, base+16);
  const cand = pool.slice(from, to+1);
  const requireMixed = (ktcGameState.samePosStreak||0) >= 1;

  let best = null;
  let bestDetail = null;
  let bestScore = -1e9;
  let bestAny = null;
  let bestAnyDetail = null;
  let bestAnyScore = -1e9;
  const spanCap = 13;
  for(let i=0;i<cand.length-2;i++){
    for(let j=i+1;j<cand.length-1;j++){
      for(let k=j+1;k<cand.length;k++){
        if((k-i)>spanCap) continue;
        const trio = [cand[i], cand[j], cand[k]];
        if(requireMixed){
          const posSet = new Set([trio[0].pos, trio[1].pos, trio[2].pos]);
          if(posSet.size<2) continue;
        }
        const sig = trio.map(ktcPlayerKey).sort().join('~');
        if(sig===ktcGameState.lastSig) continue;
        // Avoid exact-repeat trios from the recent window whenever alternatives exist.
        if((ktcGameState.recentTrioSigs||[]).includes(sig)) continue;
        const detail = ktcTrioDetail(trio, targetPos);
        if(detail.score>bestAnyScore){
          bestAnyScore = detail.score;
          bestAny = trio;
          bestAnyDetail = detail;
        }
        if(!detail.closeOk) continue;
        if(detail.signalMode==='cross_pos' && !detail.hasMixedSignal) continue;
        if(detail.score>bestScore){
          bestScore = detail.score;
          best = trio;
          bestDetail = detail;
        }
      }
    }
  }
  if(!best && !requireMixed && bestAny){
    best = bestAny;
    bestDetail = bestAnyDetail;
  }
  if(!best) best = ktcFallbackTrio(preferredBoard, false);
  if(!bestDetail) bestDetail = ktcTrioDetail(best, targetPos);
  ktcGameState.trio = best;
  ktcGameState.lastSig = bestDetail.sig || ktcTrioSig(best);
  ktcGameState.trioTag = bestDetail.tag || 'FPTS';
  ktcGameState.trioWhy = bestDetail.why || 'fpts-cluster';
  ktcGameState.selection = [];
  const posSet = new Set(best.map(p=>p.pos));
  ktcGameState.samePosStreak = (posSet.size===1) ? ((ktcGameState.samePosStreak||0)+1) : 0;
  ktcMarkShown(best);
  ktcGameState.posCursor += 1;
  ktcGameState.cursor = (ktcGameState.cursor + 5 + Math.floor(Math.random()*7)) % Math.max(5, n-1);
  return true;
}

function ktcSolveDeltas(trio, orderedKeys, minGap, level){
  const out = {};
  if(!Array.isArray(trio) || trio.length!==3 || !Array.isArray(orderedKeys) || orderedKeys.length!==3){
    out._signalMode = 'same_pos';
    return out;
  }
  const cfg = ktcIntensityCfg(level||ktcIntensityKey());
  const ranked = orderedKeys.map(k=>ktcPlayerByKey(trio, k));
  if(ranked.some(p=>!p)){
    out._signalMode = 'same_pos';
    return out;
  }

  const signalMode = ktcSignalMode(trio);
  const samePos = signalMode==='same_pos';

  const gap = samePos
    ? (Number.isFinite(+minGap) ? +minGap : KTC_MIN_GAP)
    : Math.max(2.4, (Number.isFinite(+minGap) ? +minGap : KTC_MIN_GAP) * 5.2);
  const budget = ktcRoundBudget(trio, level);
  const cur = ranked.map(p=>samePos ? (+p.fpts||0) : (+p.vor||0));
  const d = [0,0,0];

  // Treat KTC as a strict 1/2/3 ranking. Enforce all pairwise constraints so the
  // middle (TRADE) slot is adjusted both upward and downward when needed.
  const pairs = [
    // [higherRankIdx, lowerRankIdx, upWeight, downWeight, scale]
    [0,1,0.70,0.30,1.00],
    [1,2,0.68,0.32,1.00],
    [0,2,0.34,0.66,0.72],
  ];
  pairs.forEach(([hi, lo, upW, downW, scale])=>{
    const need = (cur[lo] + gap) - cur[hi];
    if(need<=0) return;
    const step = Math.min(need*cfg.softCorrection*scale, budget);
    d[hi] += step*upW;
    d[lo] -= step*downW;
    cur[hi] += step*upW;
    cur[lo] -= step*downW;
  });

  // Hard cap each player's one-round movement to keep edits explainable and non-drastic.
  d[0] = ktcClamp(d[0], -budget, budget);
  d[1] = ktcClamp(d[1], -budget, budget);
  d[2] = ktcClamp(d[2], -budget, budget);

  // Normalize drift so one round doesn't inflate total points; keeps team edits balanced.
  const drift = (d[0]+d[1]+d[2])/3;
  d[0] -= drift; d[1] -= drift; d[2] -= drift;

  out[orderedKeys[0]] = d[0];
  out[orderedKeys[1]] = d[1];
  out[orderedKeys[2]] = d[2];
  out._signalMode = signalMode;
  return out;
}

function ktcFindInTeam(state, player){
  if(!state || !player) return {qb:null, rec:null, rush:null};
  const byMatch = row => !!row && (
    (player.player_id && row.player_id && String(row.player_id)===String(player.player_id)) ||
    (String(row.name||'').toLowerCase()===String(player.name||'').toLowerCase())
  );
  const qb = Array.isArray(state.qbs) ? state.qbs.find(byMatch) : null;
  const rec = (state.passing_shares && Array.isArray(state.passing_shares)) ? state.passing_shares.find(byMatch) : null;
  const rush = (state.rushing && Array.isArray(state.rushing.shares)) ? state.rushing.shares.find(byMatch) : null;
  return {qb, rec, rush};
}

function ktcClamp(v, lo, hi){
  return Math.max(lo, Math.min(hi, v));
}

function ktcRebalanceShares(list, player, field, nextVal){
  if(!Array.isArray(list) || !player || !field) return false;
  const idx = list.findIndex(p=>ktcPlayerKey(p)===ktcPlayerKey(player)
    || ((player.player_id && p.player_id && String(player.player_id)===String(p.player_id)) || String(p.name||'').toLowerCase()===String(player.name||'').toLowerCase()));
  if(idx<0) return false;
  const target = list[idx];
  const old = +target[field]||0;
  const desired = ktcClamp(nextVal, 0.01, 0.95);
  if(Math.abs(desired-old)<0.0005) return false;
  const others = list.filter((_,i)=>i!==idx);
  const otherOld = others.reduce((s,p)=>s+(+p[field]||0),0);
  const otherNew = Math.max(0.01, 1-desired);
  target[field] = desired;
  if(otherOld<=0){
    const even = otherNew/Math.max(1, others.length);
    others.forEach(p=>{ p[field]=even; });
  } else {
    others.forEach(p=>{
      const cur = +p[field]||0;
      p[field] = Math.max(0.001, cur * (otherNew/otherOld));
    });
  }
  const total = list.reduce((s,p)=>s+(+p[field]||0),0) || 1;
  list.forEach(p=>{ p[field]=(+p[field]||0)/total; });
  return true;
}

function ktcRefreshReceivingBaselines(state){
  if(!state || !Array.isArray(state.passing_shares)) return;
  const totalTgts = teamTargetPool(state);
  const totalPassTDs = teamPassTDs(state);
  state.passing_shares.forEach(p=>{
    const tgts = Math.max(0, Math.round((+p.share||0) * totalTgts));
    p.baseline_targets = tgts;
    p.baseline_rec = Math.max(0, Math.round(tgts * (+p.catch_rate||0.65)));
    p.baseline_yards = Math.max(0, Math.round(tgts * (+p.ypt||9)));
    p.baseline_tds = Math.max(0, +((+p.td_share||0) * totalPassTDs).toFixed(1));
  });
}

function ktcRefreshRushingBaselines(state){
  if(!state || !state.rushing || !Array.isArray(state.rushing.shares)) return;
  const totalAtt = +state.rushing.total_attempts || 0;
  const totalRushTDs = teamRushTDs(state);
  state.rushing.shares.forEach(p=>{
    const att = Math.max(0, Math.round((+p.share||0) * totalAtt));
    p.baseline_att = att;
    p.baseline_yards = Math.max(0, Math.round(att * (+p.ypc||4)));
    p.baseline_tds = Math.max(0, +((+p.td_share||0) * totalRushTDs).toFixed(1));
  });
  recomputeTeamRushYards(state);
}

function ktcApplyPlayerDelta(player, deltaFpts){
  if(!player || !Number.isFinite(+deltaFpts) || Math.abs(+deltaFpts)<0.01) return false;
  const team = String(player.team||'').toUpperCase();
  if(!team) return false;
  const state = ensureTeam(team);
  const {qb, rec, rush} = ktcFindInTeam(state, player);
  const sc = scoringSettings || {};
  const d = +deltaFpts;
  let touched = false;

  if(qb){
    const passPtsPerYd = (sc.passing_yards_points||1) / (sc.passing_yards_yardage||25);
    const rushPtsPerYd = (sc.rushing_yards_points||1) / (sc.rushing_yards_yardage||10);
    const passTdPts = (sc.passing_touchdowns||0) || 0;
    const rushTdPts = (sc.rushing_touchdowns||0) || 0;
    const intPts = (sc.interceptions_thrown||0) || 0;

    const passYdDelta = passPtsPerYd!==0 ? ((d*0.58) / passPtsPerYd) : 0;
    const rushYdDelta = rushPtsPerYd!==0 ? ((d*0.10) / rushPtsPerYd) : 0;
    const passTdDelta = passTdPts!==0 ? ((d*0.22) / passTdPts) : 0;
    const rushTdDelta = rushTdPts!==0 ? ((d*0.06) / rushTdPts) : 0;
    const intDelta = intPts!==0 ? ((-d*0.04) / intPts) : 0;

    qb.passing_yards = Math.max(0, (+qb.passing_yards||0) + passYdDelta);
    qb.rushing_yards = Math.max(0, (+qb.rushing_yards||+qb.qb_rush_yards||0) + rushYdDelta);
    qb.qb_rush_yards = qb.rushing_yards;
    qb.passing_tds = Math.max(0, (+qb.passing_tds||0) + passTdDelta);
    qb.qb_rush_tds = Math.max(0, (+qb.qb_rush_tds||0) + rushTdDelta);
    qb.interceptions_thrown = Math.max(0, (+qb.interceptions_thrown||0) + intDelta);

    const ypa = Math.max(5.5, ((+qb.passing_yards||0) / Math.max(1, (+qb.passing_attempts||1))));
    const cmpPct = ktcClamp(((+qb.passing_completions||0) / Math.max(1, (+qb.passing_attempts||1))), 0.52, 0.78);
    qb.passing_attempts = Math.max(0, (+qb.passing_attempts||0) + passYdDelta/ypa);
    qb.passing_completions = Math.max(0, qb.passing_attempts*cmpPct);
    touched = true;
  }

  if(rush){
    const shareShift = ktcClamp(d/120, -0.12, 0.12);
    const tdShift = ktcClamp(d/58, -0.09, 0.09);
    const ypcShift = ktcClamp(d/70, -0.5, 0.5);
    ktcRebalanceShares(state.rushing.shares, player, 'share', (+rush.share||0)+shareShift);
    ktcRebalanceShares(state.rushing.shares, player, 'td_share', (+rush.td_share||0)+tdShift);
    rush.ypc = ktcClamp((+rush.ypc||4)+ypcShift, 2.1, 8.9);
    ktcRefreshRushingBaselines(state);
    touched = true;
  }

  if(rec){
    const shareShift = ktcClamp(d/145, -0.11, 0.11);
    const tdShift = ktcClamp(d/75, -0.08, 0.08);
    const yptShift = ktcClamp(d/92, -0.55, 0.55);
    const catchShift = ktcClamp(d/500, -0.025, 0.025);
    ktcRebalanceShares(state.passing_shares, player, 'share', (+rec.share||0)+shareShift);
    ktcRebalanceShares(state.passing_shares, player, 'td_share', (+rec.td_share||0)+tdShift);
    rec.ypt = ktcClamp((+rec.ypt||9)+yptShift, 4.5, 18.5);
    rec.catch_rate = ktcClamp((+rec.catch_rate||0.65)+catchShift, 0.48, 0.86);
    ktcRefreshReceivingBaselines(state);
    touched = true;
  }

  return touched;
}

function ktcSelectionIndex(key){
  return ktcGameState.selection.indexOf(String(key||''));
}

function ktcTogglePick(key){
  if(!ktcGameState.active) return;
  const k = String(key||'');
  const i = ktcSelectionIndex(k);
  if(i>=0){
    ktcGameState.selection.splice(i,1);
    renderKtcOverlay();
    return;
  }
  if(ktcGameState.selection.length>=3) return;
  ktcGameState.selection.push(k);
  renderKtcOverlay();
}

function ktcResetSelection(){
  if(!ktcGameState.active) return;
  ktcGameState.selection = [];
  renderKtcOverlay();
}

function ktcSelectionBadge(key){
  const i = ktcSelectionIndex(key);
  if(i<0) return '';
  return `<div class="ktc-role-badge ${KTC_ROLE_CLASS[i]}">${KTC_ROLE_LABELS[i]}</div>`;
}

function ktcFmtSignalVal(v, digits){
  if(!Number.isFinite(+v)) return '—';
  const n = +v;
  if(Number.isInteger(n)) return String(n);
  return n.toFixed(Number.isFinite(+digits) ? +digits : 1);
}

function ktcPlayerSignalBundle(p, trioTag){
  const tag = String(trioTag||'').toUpperCase();
  const tier = ktcEcrTierVal(p);
  const ecr = ktcEcrRankVal(p);
  const adp = ktcAdpVal(p);
  const fpts = +p.fpts||0;
  const vor = +p.vor||0;
  const mix = Number.isFinite(+p._ktcMix) ? +p._ktcMix : null;

  let signalRaw = null;
  if(tag==='TIER') signalRaw = tier;
  else if(tag==='ECR') signalRaw = ecr;
  else if(tag==='ADP') signalRaw = adp;
  else if(tag==='FPTS') signalRaw = fpts;
  else if(tag==='VOR') signalRaw = vor;
  else signalRaw = mix;

  const signalVal = ktcFmtSignalVal(signalRaw, tag==='MIX' ? 3 : 1);
  const facts = [
    `TIER ${ktcFmtSignalVal(tier, 0)}`,
    `ECR ${ktcFmtSignalVal(ecr, 0)}`,
    `ADP ${ktcFmtSignalVal(adp, 1)}`,
    `FPTS ${ktcFmtSignalVal(fpts, 1)}`,
    `VOR ${ktcFmtSignalVal(vor, 1)}`,
  ];
  if(mix!=null) facts.push(`MIX ${ktcFmtSignalVal(mix, 3)}`);

  return {
    tag,
    signalVal,
    factsText: facts.join(' · '),
  };
}

function ktcSubmitSelection(){
  if(!ktcGameState.active || ktcGameState.selection.length!==3) return;
  const trio = ktcGameState.trio.slice();
  const ordered = ktcGameState.selection.slice();
  const level = ktcIntensityKey();
  const cfg = ktcIntensityCfg(level);
  const deltas = ktcSolveDeltas(trio, ktcGameState.selection, KTC_MIN_GAP, level) || {};
  const signalMode = deltas._signalMode || 'same_pos';
  let changed = false;
  trio.forEach(p=>{
    const d = deltas[ktcPlayerKey(p)] || 0;
    const fptsDelta = ktcSignalDeltaToFpts(p, d, signalMode);
    if(Math.abs(fptsDelta)<0.01) return;
    if(ktcApplyPlayerDelta(p, fptsDelta)) changed = true;
  });

  // Second-pass correction only for same-position rounds; mixed rounds are VOR-ranked.
  if(changed && signalMode==='same_pos'){
    const board = ktcEligibleBoard();
    const map = {};
    board.forEach(p=>{ map[ktcPlayerKey(p)] = +p.fpts||0; });
    const keepP = ktcPlayerByKey(trio, ordered[0]);
    const tradeP = ktcPlayerByKey(trio, ordered[1]);
    const cutP = ktcPlayerByKey(trio, ordered[2]);
    if(keepP && tradeP && cutP){
      const players=[keepP, tradeP, cutP];
      const vals=[map[ordered[0]], map[ordered[1]], map[ordered[2]]].map(v=>Number.isFinite(v)?v:0);
      const add=[0,0,0];
      const tops=[
        [0,1,cfg.topoff1Scale,cfg.topoff1Cap,0.72,0.28],
        [1,2,cfg.topoff1Scale,cfg.topoff1Cap,0.70,0.30],
        [0,2,cfg.topoff2Scale,cfg.topoff2Cap,0.30,0.70],
      ];
      tops.forEach(([hi,lo,scale,cap,upW,downW])=>{
        const need = vals[lo]-vals[hi];
        if(!Number.isFinite(need) || need<0) return;
        const top = Math.min(need*scale, cap);
        add[hi] += top*upW;
        add[lo] -= top*downW;
      });
      for(let i=0;i<3;i++){
        if(Math.abs(add[i])<0.01) continue;
        ktcApplyPlayerDelta(players[i], add[i]);
      }
    }
  }

  if(changed){
    markDirty();
    ktcGameState.rounds += 1;
    renderRankings();
  }
  if(!ktcPickNextTrio()) return;
  renderKtcOverlay();
}

function ktcSkipTrio(){
  if(!ktcGameState.active) return;
  ktcGameState.skips += 1;
  ktcGameState.selection = [];
  if(!ktcPickNextTrio()) return;
  renderKtcOverlay();
}

function ktcCardHtml(p, trioTag){
  const key = ktcPlayerKey(p);
  const lines = ktcScoreSummary(p);
  const showSignalDebug = (typeof TC_DEV_MODE!=='undefined' && !!TC_DEV_MODE);
  const sig = showSignalDebug ? ktcPlayerSignalBundle(p, trioTag) : null;
  const color = teamColor(p.team||'');
  const shade = (_hexLum(color)>0.62) ? _darken(color, 0.38) : color;
  const sel = ktcSelectionIndex(key);
  const cardOpen = pcardOnclick(p.player_id||p.name, p.pos||'', p.team||'');
  return `<button class="ktc-mini-card ${sel>=0?'selected':''}" onclick="ktcTogglePick('${escJsSingle(key)}')" style="--ktc-team:${shade}">
    ${ktcSelectionBadge(key)}
    <img class="ktc-team-mark" src="${NFL_LOGO(p.team)}" alt="${escAttr(p.team||'')}" loading="lazy" decoding="async" onerror="this.style.display='none'">
    <div class="ktc-hs-wrap clickable-player" onclick="event.stopPropagation();${cardOpen}">${imgTag(hsPack(p), 'ktc-hs')}</div>
    <div class="ktc-name clickable-player" onclick="event.stopPropagation();${cardOpen}">${escHtml(p.name||'')}</div>
    <div class="ktc-meta"><span class="pos-badge pos-${escAttr(p.pos||'WR')}">${escHtml(p.pos||'')}</span> ${escHtml(p.team||'')} · rank #${p._ktcRank||'—'}</div>
    ${showSignalDebug ? `<div class="ktc-signalvals">
      <div class="ktc-signal-main">Signal ${escHtml(sig.tag||'—')}: ${escHtml(sig.signalVal)}</div>
      <div class="ktc-signal-facts">${escHtml(sig.factsText)}</div>
    </div>` : ''}
    <div class="ktc-stats">${lines.map(t=>`<div>${escHtml(t)}</div>`).join('')}</div>
  </button>`;
}

function renderKtcOverlay(){
  const old = document.getElementById('ktcOverlay');
  if(!ktcGameState.active || currentPhase!=='Rankings' || rankScope!=='all'){
    if(old) old.remove();
    return;
  }
  if(!ktcGameState.trio || ktcGameState.trio.length!==3){
    if(!ktcPickNextTrio()) return;
  }
  const trioTag = String(ktcGameState.trioTag||'FPTS');
  const submitOn = ktcGameState.selection.length===3;
  const cards = ktcGameState.trio.map(p=>ktcCardHtml(p, trioTag)).join('');
  const rounds = ktcGameState.rounds;
  const intensity = ktcIntensityKey();
  const cfg = ktcIntensityCfg(intensity);
  const showSignalDebug = (typeof TC_DEV_MODE!=='undefined' && !!TC_DEV_MODE);
  const trioMode = ktcSignalMode(ktcGameState.trio||[]);
  const modeHint = trioMode==='same_pos'
    ? 'Same-position rounds may use projection/FPTS proximity.'
    : 'Mixed-position rounds compare ADP, ECR, TIER, and VOR (not raw FPTS).';
  const intensityOptions = ['conservative','balanced','aggressive'].map(k=>
    `<button class="ktc-intensity-opt ${k===intensity?'on':''}" onclick="ktcSetIntensity('${k}')">${escHtml((KTC_INTENSITY[k]&&KTC_INTENSITY[k].label)||k)}</button>`
  ).join('');
  const tierText = `top ECR tiers 1-${ktcGameState.tierCutoff||KTC_TARGET_TIER_MAX}`;
  const html = `<div class="ktc-backdrop" onclick="ktcBackdropStop(event)">
    <div class="ktc-modal" onclick="event.stopPropagation()">
      <div class="ktc-head">
        <div class="ktc-title">Keep Trade Cut</div>
        <button class="ktc-x" onclick="stopKtcGame()" aria-label="Close">✕</button>
      </div>
      <div class="ktc-sub">Rank the trio <b>1</b>, <b>2</b>, <b>3</b> as <b>KEEP</b>, <b>TRADE</b>, <b>CUT</b>. Rankings adjust after each submit. ${showSignalDebug ? `<span class="ktc-signal">signal <b class="ktc-signal-tag">${escHtml(trioTag)}</b></span>` : ''} <span class="ktc-mode-hint">${escHtml(modeHint)}</span></div>
      <div class="ktc-intensity-row"><span>Nudge intensity</span><div class="ktc-intensity">${intensityOptions}</div></div>
      <div class="ktc-cards">${cards}</div>
      <div class="ktc-actions">
        <button class="btn btn-ghost ktc-action-btn" onclick="ktcResetSelection()">RESET</button>
        <button class="btn btn-ghost ktc-action-btn" onclick="ktcSkipTrio()">SKIP</button>
        <button class="btn btn-accent ktc-action-btn ${submitOn?'':'disabled'}" ${submitOn?'':'disabled'} onclick="ktcSubmitSelection()">SUBMIT</button>
      </div>
      <div class="ktc-foot">Round ${rounds+1} · ${ktcPreferredPos()} focus · ${tierText} · ${cfg.label} nudges · ${ktcGameState.skips||0} skipped · tap outside this panel to pause</div>
    </div>
  </div>`;

  if(old) old.innerHTML = html;
  else {
    const wrap = document.createElement('div');
    wrap.id = 'ktcOverlay';
    wrap.className = 'ktc-overlay';
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
  }
}

function ktcBackdropStop(e){
  if(e && e.target===e.currentTarget) stopKtcGame();
}

function stopKtcGame(msg){
  const wasActive = !!ktcGameState.active;
  ktcGameState.active = false;
  const old = document.getElementById('ktcOverlay');
  if(old) old.remove();
  if(wasActive) toast(msg||'Keep Trade Cut paused. Re-open it from the menu anytime.','ok');
}

async function startKtcGame(){
  const needsProjSeason = activeSeason!=='proj';
  const needsRankingsView = (currentPhase!=='Rankings' || rankScope!=='all');
  if(currentPhase==='League') showProjectionsView();
  if(needsProjSeason) await loadSeason('proj');
  rankScope='all';
  currentPhase='Rankings';
  // Opening KTC from an already-rendered Full Rankings view should not rebuild the
  // whole page every time; that expensive render is a major source of click latency.
  if(needsProjSeason || needsRankingsView) renderContent();
  // Fresh session variety: clear short-term trio/tag memory each time the game starts.
  ktcGameState.recentTrioSigs = [];
  ktcGameState.recentTags = [];
  ktcGameState.active = true;
  const bootBoard = ktcEligibleBoard();
  if(!ktcGameState.cursor) ktcGameState.cursor = Math.floor(Math.max(3, bootBoard.length*0.12));
  if(!ktcPickNextTrio(bootBoard)) return;
  renderKtcOverlay();
  toast('Keep Trade Cut started — submit picks to personalize rankings.','ok');
}
