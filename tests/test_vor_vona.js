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
  vonaMarketDrift, vonaSimulate,
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

console.log(`\n${pass}/${total} checks passed`);
process.exit(pass===total?0:1);
