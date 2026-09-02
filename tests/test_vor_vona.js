// ═══════════════════════════════════════════════════════════════════════════
// VOR / VONA structural review fixes:
//   • restricted flexes (WRRB/REC) only hand demand to their eligible positions
//   • flex demand goes to the position with the better next player
//   • superflex QB floor engages (and only in superflex)
//   • lineupGain uses a value-optimal fill — displacing a weaker flex occupant counts
//   • keeper picks (pre-populated feed) are recognized as spent
//   • slot profiles count K/DEF demand + dedicated-need counts for the sim
//   • replacement-line boundary only fires on monotone startable→rest ordering
//   • availability % display capped for players the ADP universe can't see
//   • League Analyzer resolves defenses to team codes (waiver rows get icons)
//   • market drift: the survival model reads the room instead of trusting ADP
// ═══════════════════════════════════════════════════════════════════════════

const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},textContent:'',value:'',dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){},remove(){}};return elStore[id];}
global.document={getElementById:id=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],
  createElement:()=>({style:{},appendChild(){},click(){},classList:{add(){},remove(){},toggle(){}}}),
  body:{appendChild(){},removeChild(){}},addEventListener(){},visibilityState:'visible',
  documentElement:{scrollTop:0,scrollHeight:5000,style:{setProperty(){}},classList:{toggle(){}}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){},
  requestAnimationFrame:fn=>setTimeout(fn,0),innerWidth:1366,innerHeight:900,scrollTo(){},matchMedia:()=>({matches:false})};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){},length:0,key:()=>null};
global.Chart=function(){return{destroy(){},update(){}}};
global.confirm=()=>true; global.btoa=s=>s; global.FileReader=function(){}; global.Range=function(){};
global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.fetch=()=>Promise.reject(new Error('offline in test'));

const fs=require('fs');
const path=require('path');
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  computeVOR, leagueStarterCounts,
  setShape:(v)=>{leagueShape=v;}, setFormat:(f)=>{rankFormat=f;},
  baseline:()=>VOR_BASELINE,
  vonaLineupGain, _vonaOptimalLineupVor,
  setDraftLineup:(l)=>{draftLineup=l;},
  _draftFeedPickNos, setPicksBySlot:(v)=>{draftPicksBySlot=v;},
  _vonaSlotProfile,
  _rankReplacementBoundary,
  _vonaPctDisp,
  laDefTeamCode,
  adpFor,
  _vonaCandScore, _vonaBudget,
  vonaMarketDrift, vonaSimulate, _vonaRankInPos,
  _cheatSimulate, toggleDraftStar, isDraftStar, clearDraftStars, starsRef:()=>draftStars,
  _rtSnapScroll, _rtRestoreScroll, _RT_SCROLLERS, _vonaInvNorm, _vonaNormCdf,
  _vonaMixParams, setMarketModel:(v)=>{MARKET_MODEL=v;},
  _roomHistSummarize, _roomHistAggregate, _roomHistPrior, setRoomHistory:(v)=>{roomHistory=v;},
  vonaLiveTeamRanks, setBPL:(f)=>{buildPlayerList=f;}, setDraftId:(v)=>{draftId=v;},
  setMySlot:(v)=>{mySlot=v;}, setDraftMeta:(m)=>{draftMeta=m;},
  setDraftedIds:(v)=>{draftedIds=v;},
};`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

// Synthetic pool: 2-team league keeps the numbers hand-checkable.
const mk=(pos,fpts,i)=>({name:`${pos}${i}`, pos, team:'KC', fpts, player_id:`${pos}${i}`});
const pool=[];
[380,350,320,300,290,280].forEach((f,i)=>pool.push(mk('QB',f,i+1)));
[300,280,260,240,220,200,180,160].forEach((f,i)=>pool.push(mk('RB',f,i+1)));
[250,245,240,235,230,225,220,215].forEach((f,i)=>pool.push(mk('WR',f,i+1)));
[200,150,140,130,120,110].forEach((f,i)=>pool.push(mk('TE',f,i+1)));

console.log('=== restricted flexes only feed their eligible positions ===');
// 2 teams, lineup QB/RB/WR/TE + one REC_FLEX (WR/TE only).
app.setFormat('half_ppr');
app.setShape({teams:2, lineup:['QB','RB','WR','TE','REC_FLEX']});
let list=pool.map(p=>({...p, vor:0}));
app.computeVOR(list);
// dedicated: QB2 RB2 WR2 TE2. REC_FLEX×2 must land on WR (WR3 240, WR4 235 beat TE3 140).
// RB baseline must stay RB2 (260) — a generic-flex bug would push it deeper.
chk(app.baseline().RB===280, `RB baseline stays at the last DEDICATED starter (RB2=280, got ${app.baseline().RB})`);
chk(app.baseline().WR===235, `both REC_FLEX slots went to WR (baseline WR4=235, got ${app.baseline().WR})`);
chk(app.baseline().TE===150, `TE baseline untouched by the WR-favored flex (TE2=150, got ${app.baseline().TE})`);

console.log('=== generic flex picks the position with the better next player ===');
app.setShape({teams:2, lineup:['QB','RB','WR','TE','FLEX']});
list=pool.map(p=>({...p, vor:0}));
app.computeVOR(list);
// Next-best after dedicated: RB3 260 beats WR3 240 → flex 1 = RB3. Flex 2: RB4 240 ties
// WR3 240 and RB is evaluated first with a strict >, so RB4 takes it → RB baseline RB4=240,
// WR baseline stays the dedicated WR2=245.
chk(app.baseline().RB===240 && app.baseline().WR===245, `flex went best-first across RB/WR (got RB=${app.baseline().RB} WR=${app.baseline().WR})`);

console.log('=== superflex floor engages only in superflex ===');
app.setShape({teams:2, lineup:['QB','RB','WR','TE','SUPER_FLEX']});
list=pool.map(p=>({...p, vor:0}));
app.computeVOR(list);
// greedy SF: QB3 (320) + QB4 (300) beat RB3 (260) → used.QB=4; floor ceil(2*2.3)=5 → QB5=290
chk(app.baseline().QB===290, `SF floor (2.3/team → 5 QBs) sets the QB baseline (QB5=290, got ${app.baseline().QB})`);
app.setShape({teams:2, lineup:['QB','RB','WR','TE','FLEX']});
list=pool.map(p=>({...p, vor:0}));
app.computeVOR(list);
chk(app.baseline().QB===350, `no floor outside superflex (QB2=350, got ${app.baseline().QB})`);

console.log('=== lineupGain: a candidate that displaces a weaker flex occupant counts ===');
app.setDraftLineup(['QB','RB','RB','WR','WR','TE','FLEX']);
const vorMap={QB1:60, RB1:80, RB2:50, RB3:40, WR1:55, WR2:35, WR3:10, TE1:30};
const vorOf=(pk)=>vorMap[pk.player_id||pk.name]||0;
// Roster: both RB slots + both WR slots filled, WR3 (vor 10) sits in FLEX.
const myPicks=[{pos:'RB',name:'RB1',player_id:'RB1'},{pos:'RB',name:'RB2',player_id:'RB2'},
  {pos:'WR',name:'WR1',player_id:'WR1'},{pos:'WR',name:'WR2',player_id:'WR2'},
  {pos:'WR',name:'WR3',player_id:'WR3'}];
const gain=app.vonaLineupGain(myPicks, {pos:'RB',name:'RB3',player_id:'RB3'}, vorOf);
chk(gain===30, `RB3 (40) displaces WR3 (10) from FLEX: gain 30 (got ${gain}) — was 0 under the order-greedy fill`);
const gain2=app.vonaLineupGain(myPicks, {pos:'WR',name:'WRlow',player_id:'WRX'}, vorOf);
chk(gain2===0, 'a 0-VOR bench candidate adds nothing');

console.log('=== pick budget: must-fill, last call, caps (sim-validated guards) ===');
const dedC={QB:1,RB:1,WR:2,TE:1};
// 4 live picks, 2 owed to K/DEF → 2 skill picks; only QB unmet → no must-fill,
// but the QB starter is on last call (1 pick after this one).
let bud=app._vonaBudget(4, 2, {QB:0,RB:3,WR:4,TE:1}, dedC, 0, new Set(['QB']));
chk(bud.skillLeft===2, `skillLeft reserves K/DEF picks (got ${bud.skillLeft})`);
chk(bud.unmetTotal===1 && !bud.mustFill, `one unmet minimum, budget still has slack (unmet=${bud.unmetTotal})`);
chk(bud.lastCall.QB===true, 'QB starter on last call with 1 pick to spare');
// Early-ish roster with the budget exhausted: unmet (QB1+TE1+RB2+WR2=6) ≥ 5 picks → must-fill.
bud=app._vonaBudget(5, 0, {QB:0,RB:1,WR:2,TE:0}, dedC, 0, new Set(['QB','TE']));
chk(bud.mustFill===true && bud.unmet.RB===2 && bud.unmet.WR===2, `must-fill engages when minimums claim every pick (unmet=${bud.unmetTotal}/${bud.skillLeft})`);
chk(bud.posCap.QB===2 && bud.posCap.TE===2, '1-QB league caps QB/TE headlines at 2');
// Superflex: the QB minimum and cap both grow with the extra QB-eligible slot.
bud=app._vonaBudget(10, 0, {QB:1,RB:1,WR:2,TE:1}, dedC, 1, new Set());
chk(bud.minTargets.QB===2 && bud.unmet.QB===1, `superflex wants a 2nd QB body (target ${bud.minTargets.QB})`);
chk(bud.posCap.QB===3, `superflex raises the QB cap (got ${bud.posCap.QB})`);

console.log('=== candidate score: lineup gain when he starts, bench value when he rides ===');
app.setDraftLineup(['QB','RB','WR','FLEX']);
// Empty roster: a 170-VOR RB is pure starting-lineup gain → 10 pts/wk.
let cs=app._vonaCandScore([], {QB:0,RB:0,WR:0,TE:0}, dedC, 'RB', 170, ()=>0);
chk(cs===10, `starter path: 170 season VOR → 10/wk lineup gain (got ${cs})`);
// RB slot + FLEX already hold better RBs: a 51-VOR RB is a bench pick →
// (0.30 depth weight + 0.04 tiebreak) × 3/wk = 1.02.
const benchVor={RB1:100,RB2:80};
const benchPicks=[{pos:'RB',name:'RB1',player_id:'RB1'},{pos:'RB',name:'RB2',player_id:'RB2'}];
cs=app._vonaCandScore(benchPicks, {QB:0,RB:2,WR:0,TE:0}, dedC, 'RB', 51, pk=>benchVor[pk.player_id]||0);
chk(Math.abs(cs-1.02)<1e-9, `bench path: depth-weighted insurance value (got ${cs})`);
// A 3rd QB (same 51 VOR) is worth far less than the bench RB: the QB insurance
// weight is smaller and the thin-roster kicker is gone once the slot is doubled.
const qbVor={QB1:120,QB2:90};
cs=app._vonaCandScore([{pos:'QB',name:'QB1',player_id:'QB1'},{pos:'QB',name:'QB2',player_id:'QB2'}],
  {QB:2,RB:0,WR:0,TE:0}, dedC, 'QB', 51, pk=>qbVor[pk.player_id]||0);
chk(Math.abs(cs-(0.19*3))<1e-9, `3rd-QB bench value uses the bare QB weight (got ${cs})`);

console.log('=== keeper picks are recognized as spent ===');
app.setPicksBySlot({1:[{player_id:'a',pick_no:1,pos:'RB',name:'A'},{player_id:'b',pick_no:7,pos:'WR',name:'B'}],
                    2:[{player_id:'c',pick_no:2,pos:'QB',name:'C'}]});
const feed=app._draftFeedPickNos();
chk(feed.has(1)&&feed.has(2)&&feed.has(7)&&!feed.has(3), 'feed set carries exactly the pre-populated pick numbers (incl. the future keeper at 7)');

console.log('=== slot profiles: K/DEF demand + dedicated counts ===');
app.setDraftLineup(['QB','RB','RB','WR','WR','TE','FLEX','K','DEF']);
app.setPicksBySlot({3:[{pos:'RB',name:'x',player_id:'x',pick_no:3},{pos:'RB',name:'y',player_id:'y',pick_no:4}]});
const prof=app._vonaSlotProfile(3);
chk(prof.kdOpen===2, `open K+DEF counted (${prof.kdOpen})`);
chk(prof.ded.QB===1 && prof.ded.RB===0, `dedicated counts: QB 1, RB 0 after two RBs (got QB=${prof.ded.QB} RB=${prof.ded.RB})`);
chk(prof.flexSet.has('RB') && prof.flexSet.has('WR') && !prof.flexSet.has('QB'), 'flex eligibility set is RB/WR/TE');
chk(prof.set.has('QB') && prof.set.has('RB'), 'RB still usable via FLEX even with dedicated slots full');

console.log('=== replacement-line boundary requires monotone ordering ===');
const B=app._rankReplacementBoundary;
chk(B([true,true,false,false])===2, 'clean boundary found');
chk(B([true,false,true,false])===-1, 'interleaved (ECR sort disagreeing) → no line');
chk(B([true,true,true])===-1, 'all startable → no line');
chk(B([false,false])===-1, 'no startables → no line');

console.log('=== availability display: no-ADP players never read as a guarantee ===');
chk(app._vonaPctDisp({adp_ppr:12}, 1)===100, 'a real-ADP player can show 100%');
chk(app._vonaPctDisp({name:'Deep Sleeper'}, 1)===99, 'no ADP → capped at 99%');
chk(app._vonaPctDisp({name:'Deep Sleeper'}, 0.4)===40, 'cap only touches the top end');

console.log('=== defenses resolve to team codes (waiver-row icons) ===');
chk(app.laDefTeamCode('PHI')==='PHI', 'bare code passes through');
chk(app.laDefTeamCode('Philadelphia Eagles D/ST')==='PHI', 'full club name resolves');
chk(app.laDefTeamCode('philadelphia eagles dst')==='PHI', 'normalized VOR-map key resolves');
chk(app.laDefTeamCode('Totally Fake Team')==='', 'unknown names return empty, not garbage');

console.log('=== market drift: the survival model learns from the room ===');
// A 12-team room, 12 picks in. The board (adpFor) says the first 12 off the
// board are 3 QB / 4 RB / 5 WR; this room has taken 8 QBs instead. The 9th QB
// on the board is due at pick 40, so the room is running ~28 picks early there
// — clamped to 24, then damped by k/(k+4).
const driftList=[];
let adpN=0;
const addP=(pos,n,startAdp,step)=>{ for(let i=0;i<n;i++) driftList.push(
  {name:`${pos}${i+1}`, pos, player_id:`${pos}${i+1}`, adp_ppr:startAdp+i*step,
   adp_half_ppr:startAdp+i*step, adp_2qb:startAdp+i*step, adp_std:startAdp+i*step, fpts:300-i}); };
addP('QB',20,4,4);      // QBs at 4, 8, 12, ... (3 inside the first 12)
addP('RB',20,2,3);
addP('WR',20,1,2.4);
addP('TE',20,20,6);
app.setFormat('ppr');
app.setShape({teams:12, lineup:['QB','RB','RB','WR','WR','WR','TE','FLEX','SUPER_FLEX','DEF']});
app.setDraftMeta({settings:{teams:12, rounds:16}});
app.setMySlot(1);

// Nobody has picked yet → no evidence, no correction.
app.setPicksBySlot({});
let d0 = app.vonaMarketDrift(driftList);
chk(d0.QB===0 && d0.RB===0 && d0.WR===0 && d0.TE===0, 'an empty board produces no drift');

// 11 other seats, 12 picks made, 8 of them quarterbacks.
const picksBySlot={};
let made=0;
const push=(slot,pos)=>{ made++; (picksBySlot[slot]=picksBySlot[slot]||[]).push(
  {player_id:`${pos}${picksBySlot[slot].filter?0:0}`, pos, pick_no:made}); };
for(let i=0;i<8;i++) push(i+2,'QB');
for(let i=0;i<4;i++) push(i+2,'RB');
app.setPicksBySlot(picksBySlot);
const d1 = app.vonaMarketDrift(driftList);
chk(d1.QB>0, 'a QB-hungry room reads as QBs going early');
chk(d1.QB>6, `the correction is material, not cosmetic (${d1.QB})`);
chk(d1.QB<=24, 'the correction is clamped');
chk(d1.WR<0, `a position the room is ignoring reads as falling (${d1.WR})`);
chk(Math.abs(d1.TE)<=Math.abs(d1.QB), 'an untouched position drifts less than a hoarded one');

// Damping: the same imbalance one pick in must not move the board as far as
// the same imbalance twelve picks in.
const early={}; early[2]=[{player_id:'QB1', pos:'QB', pick_no:1}];
app.setPicksBySlot(early);
const dEarly = app.vonaMarketDrift(driftList);
app.setPicksBySlot(picksBySlot);
chk(dEarly.QB < d1.QB, 'one pick of evidence moves the board less than twelve');

// My own picks are evidence about me, not about the room.
const mine={}; mine[1]=[]; for(let i=0;i<6;i++) mine[1].push({player_id:`TE${i}`, pos:'TE', pick_no:i+1});
app.setPicksBySlot(mine);
chk(app.vonaMarketDrift(driftList).TE===0, 'my own picks never teach the model about the room');

// And it reaches the survival numbers: the same player, same window, is less
// likely to come back once the room has shown it wants his position.
app.setPicksBySlot(picksBySlot);
app.setDraftedIds({});
const avail = driftList.slice();
const pools = {QB:[],RB:[],WR:[],TE:[]};
avail.forEach(p=>{ if(pools[p.pos]) pools[p.pos].push(p); });
const upcoming=[2,3,4,5,6,7,8,9,10,11,12];
const noDrift = app.vonaSimulate(avail, upcoming, pools, null);
const withDrift = app.vonaSimulate(avail, upcoming, pools, d1);
const qbId='QB5';
const pNo = noDrift.pAvail.get(qbId)||0, pYes = withDrift.pAvail.get(qbId)||0;
chk(pYes < pNo, `reading the room lowers a hoarded QB's survival odds (${pNo.toFixed(2)} → ${pYes.toFixed(2)})`);
const wrId='WR12';
chk((withDrift.pAvail.get(wrId)||0) >= (noDrift.pAvail.get(wrId)||0) - 0.02,
    'a position the room is skipping does not get harder to wait for');

// === the reach guard: which PLAYER at the position ===========================
// Mirrors test_reach_guard_picks_the_man_who_will_not_be_back in
// tests/test_draft_sim.py — the two implementations must agree.
console.log('=== reach guard: take the man who will not be back ===');
{
  app.setDraftLineup(['QB','RB','WR','WR','TE','FLEX','K','DEF']);
  const wr=(id,vor)=>({name:id, pos:'WR', team:'KC', player_id:id, vor});
  const leader=wr('leader',60), goesNow=wr('goesNow',55);
  const vorOf=(pk)=>({leader:60, goesNow:55})[pk.player_id]||0;
  const counts={QB:0,RB:0,WR:0,TE:0}, ded={QB:1,RB:1,WR:2,TE:1};
  // Board leader is better but survives; the runner-up is about to go.
  let surv=(q)=> q.player_id==='leader' ? 0.92 : 0.05;
  let r=app._vonaRankInPos([leader,goesNow], [], counts, ded, vorOf, surv, 0);
  chk(r[0].p.player_id==='goesNow', "takes the man who won't survive, not the board leader");
  // Flip the market and the answer flips back.
  surv=(q)=> q.player_id==='leader' ? 0.05 : 0.92;
  r=app._vonaRankInPos([leader,goesNow], [], counts, ded, vorOf, surv, 0);
  chk(r[0].p.player_id==='leader', 'and takes the board leader when HE is the one going');
  // Both certain to survive: value decides, so the board leader wins.
  surv=()=>0.95;
  r=app._vonaRankInPos([leader,goesNow], [], counts, ded, vorOf, surv, 0);
  chk(r[0].p.player_id==='leader', 'when both will last, the better player wins');
  // A lone candidate comes back untouched.
  r=app._vonaRankInPos([leader], [], counts, ded, vorOf, ()=>0.5, 0);
  chk(r.length===1 && r[0].p.player_id==='leader', 'a single candidate is returned unchanged');
  chk(app._vonaRankInPos([], [], counts, ded, vorOf, ()=>0.5, 0).length===0,
      'an empty position produces no suggestions');
}

// === draft plan: a BUILD, not a list of the best players left ================
console.log('=== draft plan: rounds build a roster ===');
{
  const mkPool=()=>{
    const mk=(pos,i,adp,vor)=>({name:`${pos}${i}`, pos, team:'KC',
      player_id:`${pos}${i}`, adp_ppr:adp, adp_2qb:adp, adp:adp, vor});
    const out=[]; let a=1;
    // QBs are the most valuable thing on the board — the superflex shape that
    // made the old plan recommend a quarterback in every single round.
    for(let i=1;i<=16;i++) out.push(mk('QB',i,a++,200-i*6));
    for(let i=1;i<=30;i++) out.push(mk('RB',i,a++,120-i*3));
    for(let i=1;i<=30;i++) out.push(mk('WR',i,a++,115-i*3));
    for(let i=1;i<=12;i++) out.push(mk('TE',i,a++,60-i*3));
    return out.sort((x,y)=>x.adp-y.adp);
  };
  const run=(lineup, ded, sfN, flexN)=>{
    app.setDraftLineup(lineup);
    app.setDraftMeta({teams:12, rounds:9, type:'snake', reversal_round:0});
    return app._cheatSimulate(mkPool(), {teams:12, rounds:9, type:'snake', reversalRound:0,
      startPick:1, myPicks:[3,22,27,46,51,70,75,94,99], mySlot:3, feed:new Set(),
      ded, sfN, flexN, kd:2, sims:80, seed:2468});
  };
  // ── Superflex: two QBs are worth having; nine are not ──────────────────────
  const sf=run(['QB','RB','RB','WR','WR','TE','FLEX','SUPER_FLEX','K','DEF'],
               {QB:1,RB:2,WR:2,TE:1}, 1, 1);
  const sfShape=sf.picks.map(x=>x.likelyPos);
  const sfQB=sfShape.filter(x=>x==='QB').length;
  chk(sfQB>=1, `superflex still values QBs early (${sfQB} QB rounds)`);
  chk(sfQB<=3, `superflex does NOT draft a QB every round (${sfQB} of ${sfShape.length})`);
  chk(new Set(sfShape).size>=3, `the superflex build spans positions (${sfShape.join('/')})`);
  // ── One-QB: the cap is two, so at most two rounds go to QB ─────────────────
  const one=run(['QB','RB','RB','WR','WR','TE','FLEX','K','DEF'],
                {QB:1,RB:2,WR:2,TE:1}, 0, 1);
  const oneShape=one.picks.map(x=>x.likelyPos);
  chk(oneShape.filter(x=>x==='QB').length<=2,
      `a 1QB build never spends three rounds on QBs (${oneShape.join('/')})`);
  chk(oneShape.filter(x=>x==='RB'||x==='WR').length>=4,
      'a 1QB build is mostly RB/WR, as it should be');
  // ── Each round names players, and both numbers are probabilities ───────────
  chk(sf.picks.length===9, 'a plan row per pick I own');
  chk(sf.picks[0].round===1 && sf.picks[8].round===9, 'rounds line up with the snake');
  // K/DEF rounds name nobody by design — those picks are reserved, not chosen.
  chk(sf.picks.filter(x=>x.likelyPos!=='KD').every(x=>x.rows.length>0),
      'every skill round names players you can get');
  chk(sf.picks.some(x=>x.likelyPos==='KD'), 'and the last picks are reserved for K/DEF');
  const all=sf.picks.flatMap(x=>x.rows);
  chk(all.every(r=>r.pTake>0 && r.pTake<=1), 'take-rate is a probability');
  chk(all.every(r=>r.pAvail>=0 && r.pAvail<=1), 'availability is a probability');
  // Later picks can't have better odds than earlier ones for the same player.
  const at=(j,id)=>{ const r=sf.picks[j].rows.find(x=>x.p.player_id===id); return r?r.pAvail:null; };
  const early=at(0,'QB1'), late=at(4,'QB1');
  chk(early===null || late===null || late<=early+1e-9,
      "a player's odds only fall as the draft moves on");
}

// === draft plan: your shortlist gets slotted into a round ====================
console.log('=== draft plan: bookmarks become targets ===');
{
  const mk=(pos,i,adp,vor)=>({name:`${pos}${i}`, pos, team:'KC',
    player_id:`${pos}${i}`, adp_ppr:adp, adp_2qb:adp, adp:adp, vor});
  const pool=[]; let a=1;
  for(let i=1;i<=30;i++) pool.push(mk('RB',i,a++,120-i*3));
  for(let i=1;i<=30;i++) pool.push(mk('WR',i,a++,115-i*3));
  for(let i=1;i<=12;i++) pool.push(mk('QB',i,a++,60-i*3));
  for(let i=1;i<=12;i++) pool.push(mk('TE',i,a++,55-i*3));
  pool.sort((x,y)=>x.adp-y.adp);
  app.setDraftLineup(['QB','RB','RB','WR','WR','TE','FLEX','K','DEF']);
  app.setDraftMeta({teams:12, rounds:6, type:'snake', reversal_round:0});
  const cfg={teams:12, rounds:6, type:'snake', reversalRound:0, startPick:1,
    myPicks:[3,22,27,46,51,70], mySlot:3, feed:new Set(),
    ded:{QB:1,RB:2,WR:2,TE:1}, sfN:0, flexN:1, kd:2, sims:80, seed:777};
  // A late-ADP receiver: you should be told to wait, not to reach in round 1.
  app.toggleDraftStar('WR20');
  const cs=app._cheatSimulate(pool, cfg);
  const tgt=cs.starred.find(t=>t.p.player_id==='WR20');
  chk(!!tgt, 'a starred player becomes a target');
  chk(tgt.target>0, `a late-ADP star is targeted after round 1 (round ${tgt.target+1})`);
  chk(cs.picks[tgt.target].targets.some(t=>t.p.player_id==='WR20'),
      'and he is pinned to that round in the plan');
  chk(tgt.kind==='wait' && tgt.pAvailAt>=0.55,
      'the target round is one where he is still comfortably there');
  app.toggleDraftStar('WR20');
  // An elite name you cannot get: say so rather than pretending.
  app.toggleDraftStar('RB1');
  const cs2=app._cheatSimulate(pool, {...cfg, myPicks:[46,51,70], startPick:1});
  const t2=cs2.starred.find(t=>t.p.player_id==='RB1');
  chk(!!t2 && t2.target<0, 'a player who never reaches you is reported unreachable');
  chk(cs2.unreachable.some(t=>t.p.player_id==='RB1'), 'and is listed as such');
  app.toggleDraftStar('RB1');
}

// === shortlist ===============================================================
console.log('=== shortlist: star, persist, un-star ===');
{
  const p={player_id:'RB7', name:'RB7', pos:'RB'};
  chk(!app.isDraftStar(p), 'nothing is starred to begin with');
  app.toggleDraftStar('RB7');
  chk(app.isDraftStar(p), 'a star sticks');
  chk(app.starsRef()['RB7']===1, 'and is recorded for persistence');
  app.toggleDraftStar('RB7');
  chk(!app.isDraftStar(p), 'and toggles back off');
  app.toggleDraftStar('');
  chk(!app.isDraftStar({player_id:''}), 'an empty id is ignored');
  // Reset: one action, everything unstarred, persistence included.
  app.toggleDraftStar('RB7'); app.toggleDraftStar('WR3'); app.toggleDraftStar('QB1');
  chk(Object.keys(app.starsRef()).length===3, 'three stars set for the reset');
  global.confirm=()=>true;
  app.clearDraftStars();
  chk(Object.keys(app.starsRef()).length===0, 'clear-all empties the shortlist');
  chk(!app.isDraftStar({player_id:'RB7'}), 'and every player reads unstarred');
  // Declining the confirm must not clear.
  app.toggleDraftStar('RB7');
  global.confirm=()=>false;
  app.clearDraftStars();
  chk(app.isDraftStar({player_id:'RB7'}), 'declining the confirm keeps the list');
  global.confirm=()=>true;
  app.clearDraftStars();
}

// === the drawer keeps your place across a re-render =========================
// The tracker rebuilds itself every 2.5s during a live draft, and again on every
// star. Without this, scrolling a position board or the plan is impossible —
// you're thrown back to the top before you can read it.
console.log('=== drawer scroll survives a re-render ===');
{
  const mkHost=(vals)=>({
    _els:vals,
    querySelector(sel){ return this._els[sel] || null; },
  });
  const el=(top,left)=>({scrollTop:top, scrollLeft:left});
  const els={'.rt-panel':el(120,0), '.vsg-board':el(340,0), '.vsg-cheat':el(75,0),
             '.rt-col-main':el(60,0), '.rt-col-side':el(15,0),
             '.rt-seats':el(0,88), '.vsg-tabs':el(0,42)};
  const host=mkHost(els);
  const snap=app._rtSnapScroll(host);
  chk(snap['.vsg-board']===340, 'a scrolled position board is captured');
  chk(snap['.vsg-cheat']===75, 'so is the draft plan');
  chk(snap['.rt-seats|x']===88, 'and the horizontal seat rail');
  chk(snap['.vsg-tabs|x']===42, 'and the tab rail');
  // Re-render: fresh elements, all at zero.
  const fresh={}; Object.keys(els).forEach(k=>fresh[k]=el(0,0));
  const host2=mkHost(fresh);
  app._rtRestoreScroll(host2, snap);
  chk(fresh['.vsg-board'].scrollTop===340, 'the board comes back where you left it');
  chk(fresh['.rt-panel'].scrollTop===120, 'so does the panel');
  chk(fresh['.rt-seats'].scrollLeft===88, 'and the rails restore horizontally');
  chk(fresh['.vsg-tabs'].scrollLeft===42, 'both of them');
  // A region that no longer exists must not throw.
  const host3=mkHost({'.rt-panel':el(0,0)});
  let threw=false;
  try{ app._rtRestoreScroll(host3, snap); }catch(e){ threw=true; }
  chk(!threw, 'a region that vanished between renders is skipped, not fatal');
  chk(host3._els['.rt-panel'].scrollTop===120, 'and the ones still there still restore');
  // Every scrollable region in the drawer must be listed, or it silently resets.
  chk(app._RT_SCROLLERS.includes('.vsg-board') && app._RT_SCROLLERS.includes('.vsg-cheat')
      && app._RT_SCROLLERS.includes('.rt-col-main') && app._RT_SCROLLERS.includes('.rt-col-side'),
      'every scrollable region of the drawer is registered');
}

// === conditional survival: a faller is not "gone" =============================
// Measured on 116 real 2026 drafts (tools/draft_corpus.py score): pretending the
// draft hasn't started prices a past-due player at 3% back when reality is ~45%,
// and conditioning on "he's still here" removes a third of the model's error.
console.log('=== conditional survival: the board you can SEE is evidence ===');
{
  let inv_ok=true;
  for(const z of [-2.5,-1,-0.3,0,0.7,1.9]){
    if(Math.abs(app._vonaInvNorm(app._vonaNormCdf(z))-z)>2e-4) inv_ok=false;
  }
  chk(inv_ok, 'invNorm inverts normCdf across the range');
  app.setDraftLineup(['QB','RB','WR','WR','TE','FLEX','K','DEF']);
  app.setDraftMeta({teams:12, rounds:14, type:'snake', reversal_round:0});
  // One RB long past his price (ADP 5, we are at pick 30) plus fillers.
  const mk=(id,pos,vor,adp)=>({player_id:id,name:id,pos,team:'KC',vor,adp_ppr:adp,adp});
  const avail=[mk('faller','RB',60,5)];
  for(let i=1;i<=8;i++) avail.push(mk('rb'+i,'RB',40-i,28+i*3));
  for(let i=1;i<=8;i++) avail.push(mk('wr'+i,'WR',38-i,30+i*3));
  const pools={QB:[],RB:avail.filter(p=>p.pos==='RB'),WR:avail.filter(p=>p.pos==='WR'),TE:[]};
  pools.RB.sort((a,b)=>b.vor-a.vor); pools.WR.sort((a,b)=>b.vor-a.vor);
  app.setPicksBySlot({}); app.setDraftedIds({}); app.setMySlot(1);
  const up=[2,3,4,5,6,7,8,9,10,11,12];
  const unc=app.vonaSimulate(avail, up, pools, null);          // no nowPick: old model
  const cond=app.vonaSimulate(avail, up, pools, null, 30);     // conditioned at pick 30
  const pu=unc.pAvail.get('faller')||0, pc=cond.pAvail.get('faller')||0;
  chk(pu<0.05, `unconditioned, the faller reads as gone (${(pu*100).toFixed(0)}%)`);
  // 25 picks past his price and 12 to survive: mostly the contamination arm —
  // (1-eps)*~0 + eps*exp(-12/120) ≈ 0.22. He is a live wait, not a ghost.
  chk(pc>0.12 && pc<0.35, `conditioned+mixed, he has real odds of lasting (${(pc*100).toFixed(0)}%)`);
  const closed=0.25*Math.exp(-12/120);
  chk(Math.abs(pc-closed)<0.08, `and roughly matches the closed form (${pc.toFixed(2)} vs ${closed.toFixed(2)})`);
  // A player nowhere near due is untouched by the conditioning.
  // Freeing the faller shifts demand onto everyone else, so a not-yet-due
  // player's odds legitimately MOVE — they just must not swing wildly.
  const farU=unc.pAvail.get('wr8')||0, farC=cond.pAvail.get('wr8')||0;
  chk(Math.abs(farC-farU)<0.25, `a not-yet-due player moves modestly, not wildly (${farU.toFixed(2)} -> ${farC.toFixed(2)})`);
  chk(pc<farC, 'the 25-picks-past-due man is still riskier than the not-yet-due one');
}

// === the market model trains itself — and the app trusts it only so far =======
console.log('=== fitted calibration: seed overrides, bounds protect ===');
{
  app.setMarketModel({});
  let m=app._vonaMixParams();
  chk(m.eps===0.25 && m.tau===120, 'no blob -> shipped defaults');
  app.setMarketModel({eps:0.35, tau:100, season:'2026'});
  m=app._vonaMixParams();
  chk(m.eps===0.35 && m.tau===100, "this season's fit overrides the defaults");
  app.setMarketModel({eps:0.9, tau:100});
  chk(app._vonaMixParams().eps===0.25, 'an eps outside bounds falls back');
  app.setMarketModel({eps:0.3, tau:5000});
  chk(app._vonaMixParams().tau===120, 'a tau outside bounds falls back');
  app.setMarketModel({eps:'0.35', tau:null});
  m=app._vonaMixParams();
  chk(m.eps===0.25 && m.tau===120, 'non-numeric junk falls back entirely');
  app.setMarketModel({});
}

// === the room's history seeds the drift =======================================
console.log('=== room history: what this league has done before, as a prior ===');
{
  // One past draft: QBs fly (every 3rd pick), TEs crawl.
  const mkPicks=(qbEvery)=>{
    const picks=[]; let q=1;
    for(let no=1;no<=96;no++){
      picks.push({no, pos: no%qbEvery===0 ? 'QB' : (no%4===1?'RB':no%4===2?'WR':no%4===3?'WR':'TE')});
    }
    return picks;
  };
  const s1=app._roomHistSummarize(mkPicks(3), 12);
  chk(!!s1 && s1.sched.QB.length>0, 'a past draft summarizes');
  chk(s1.byR3.QB===12, 'and counts the QBs its first three rounds took');
  chk(app._roomHistSummarize([{no:1,pos:'RB'}], 12)===null,
      'a fragment of a draft summarizes to nothing');
  const agg=app._roomHistAggregate([s1, app._roomHistSummarize(mkPicks(3), 12), null]);
  chk(agg.drafts===2, 'aggregation counts only real summaries');
  chk(Math.abs(agg.sched.QB[0]-3)<1e-9, "the room's first QB historically goes 3rd overall");
  // Prior: the current board prices QB1 at pick 12; this room takes him 3rd.
  const board={QB:[12,18,24,30,36,42,48,54], RB:[1,2,3,4,5,6,7,8],
               WR:[1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5], TE:[10,20,30,40,50,60,70,80]};
  const pr=app._roomHistPrior(agg.sched, board, 12);
  chk(pr.QB>4, `a QB-hungry room reads as a positive QB prior (${pr.QB})`);
  chk(pr.RB<0, `a position the room historically waits on reads negative (${pr.RB})`);
  chk(pr.QB<=24, 'the prior is capped like the live drift');
  chk(app._roomHistPrior(null, board, 12).QB===0, 'no history, no prior');

  // And the drift model actually LISTENS at pick one, before any live evidence.
  app.setDraftLineup(['QB','RB','WR','WR','TE','FLEX','K','DEF']);
  app.setDraftMeta({teams:12, rounds:14, type:'snake', reversal_round:0});
  app.setPicksBySlot({}); app.setDraftedIds({}); app.setMySlot(1);
  const mk=(id,pos,vor,adp)=>({player_id:id,name:id,pos,team:'KC',vor,adp_ppr:adp,adp});
  const list=[];
  for(let i=1;i<=8;i++){ list.push(mk('q'+i,'QB',40-i,12+6*i)); list.push(mk('r'+i,'RB',50-i,i));
    list.push(mk('w'+i,'WR',45-i,i+0.5)); list.push(mk('t'+i,'TE',30-i,10*i)); }
  app.setRoomHistory(null);
  const cold=app.vonaMarketDrift(list);
  app.setRoomHistory({drafts:2, teams:12, sched:agg.sched, byR3:agg.byR3, kdFirst:12});
  const warm=app.vonaMarketDrift(list);
  chk(Math.abs(cold.QB)<1e-9, 'with no history and no picks, the model stays silent');
  chk(warm.QB>0, `with history it speaks at pick one (${cold.QB} -> ${warm.QB})`);
  // A few live picks that CONTRADICT the history (zero QBs taken) pull it back.
  app.setPicksBySlot({2:[{pos:'RB',player_id:'x1',pick_no:1,name:'x1'},
                         {pos:'RB',player_id:'x2',pick_no:2,name:'x2'},
                         {pos:'WR',player_id:'x3',pick_no:3,name:'x3'},
                         {pos:'WR',player_id:'x4',pick_no:4,name:'x4'}]});
  app.setDraftedIds({x1:1,x2:1,x3:1,x4:1});
  const live=app.vonaMarketDrift(list);
  chk(live.QB<=warm.QB+1e-9, `live evidence outvotes the prior as picks land (${warm.QB} -> ${live.QB})`);
  app.setRoomHistory(null); app.setPicksBySlot({}); app.setDraftedIds({});
}

// === a dedicated 2-QB lineup gets QB depth ====================================
// BAFL-shaped rooms (QB, QB, ... with no SUPER_FLEX slot): the cap must leave
// room for a spare behind two starters, not gate the row at them.
console.log('=== dedicated 2QB lineups are not choked at their starters ===');
{
  const b=app._vonaBudget(10, 2, {QB:2,RB:1,WR:1,TE:0}, {QB:2,RB:2,WR:2,TE:1}, 0, new Set(['TE']));
  chk(b.posCap.QB===3, `two dedicated QB slots allow a third QB (cap ${b.posCap.QB})`);
  const one=app._vonaBudget(10, 2, {QB:1,RB:1,WR:1,TE:0}, {QB:1,RB:2,WR:2,TE:1}, 0, new Set(['TE']));
  chk(one.posCap.QB===2, 'a normal 1QB league still caps at two');
  const sf=app._vonaBudget(10, 2, {QB:1,RB:1,WR:1,TE:0}, {QB:1,RB:2,WR:2,TE:1}, 1, new Set(['TE']));
  chk(sf.posCap.QB===3, 'and superflex still gets its usual room');
}

// === live league rank while drafting =========================================
console.log('=== live rank: the room, priced by the advisory\'s own yardstick ===');
{
  app.setDraftLineup(['QB','RB','WR','TE','K']);
  app.setDraftMeta({teams:3, rounds:5, type:'snake', reversal_round:0});
  const P=(id,pos,vor)=>({player_id:id,name:id,pos,team:'KC',vor});
  app.setBPL(()=>[P('r1','RB',60),P('r2','RB',30),P('r3','RB',30),P('w1','WR',20),
                  P('q1','QB',15),P('k1','K',99)]);
  app.setPicksBySlot({
    1:[{player_id:'r1',pos:'RB',name:'r1',pick_no:1}],
    2:[{player_id:'r2',pos:'RB',name:'r2',pick_no:2},
       {player_id:'k1',pos:'K',name:'k1',pick_no:5}],
    3:[{player_id:'r3',pos:'RB',name:'r3',pick_no:3},
       {player_id:'w1',pos:'WR',name:'w1',pick_no:4}],
  });
  const lr=app.vonaLiveTeamRanks();
  chk(lr && lr.rows.length===3, 'one row per seat');
  chk(lr.of(1).rank===1, 'the stud roster ranks first');
  chk(lr.of(3).rank===2, 'lineup + real depth beats lineup alone');
  chk(lr.of(2).rank===3, 'a kicker adds nothing to the skill yardstick');
  chk(lr.of(2).picked===1, 'and does not count as a skill pick');
  // Ties share a rank rather than inventing an order.
  app.setPicksBySlot({
    1:[{player_id:'r2',pos:'RB',name:'r2',pick_no:1}],
    2:[{player_id:'r3',pos:'RB',name:'r3',pick_no:2}],
    3:[],
  });
  const t=app.vonaLiveTeamRanks();
  chk(t.of(1).rank===1 && t.of(2).rank===1, 'equal rosters share first');
  chk(t.of(3).rank===3, 'an empty roster is last, not missing');
  app.setPicksBySlot({}); app.setBPL(null);
}

console.log(`\n${pass}/${total} checks passed`);
process.exit(pass===total?0:1);
