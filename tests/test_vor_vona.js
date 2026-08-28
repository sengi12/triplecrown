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

console.log(`\n${pass}/${total} checks passed`);
process.exit(pass===total?0:1);
