// Stacking: same-team QB↔pass-catcher correlation as a bounded, TD-scaled
// tie-breaker in the advisory — plus the ⚡ badge helper. Mirrors stack_bonus
// in tools/draft_sim.py (the coupled decision core).
const elStore={};let contentHTML='';
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{display:''},dataset:{},value:'',checked:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},querySelectorAll:()=>[],addEventListener(){},appendChild(){}};if(id==='content'){Object.defineProperty(elStore[id],'innerHTML',{get:()=>contentHTML,set:v=>{contentHTML=v;},configurable:true});}return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('_n'+Math.random()),body:{appendChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
const _store={};
global.localStorage={getItem:k=>(_store[k]!=null?_store[k]:null),setItem(k,v){_store[k]=String(v);},removeItem(k){delete _store[k];}};

const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  return { draftStackPartner, vonaStackBonus, _vonaRankInPos, STACK_CAP:STACK_CAP, STACK_TD_W:STACK_TD_W };
`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== the partner finder ===');
const myPicks=[
  {player_id:'q1', name:'Joe Burrow', pos:'QB', team:'CIN'},
  {player_id:'r1', name:'Some Back', pos:'RB', team:'CIN'},
  {player_id:'w9', name:'Other Wideout', pos:'WR', team:'SEA'},
];
const statById=new Map([
  ['q1',{receiving_tds:0}], ['r1',{receiving_tds:2}], ['w9',{receiving_tds:9}],
]);
const chase={player_id:'w1', name:"Ja'Marr Chase", pos:'WR', team:'CIN', receiving_tds:10};
const slotGuy={player_id:'w2', name:'Possession Slot', pos:'WR', team:'CIN', receiving_tds:2};
const otherWR={player_id:'w3', name:'Elsewhere WR', pos:'WR', team:'DAL', receiving_tds:10};
const rb={player_id:'r2', name:'A Back', pos:'RB', team:'CIN', receiving_tds:3};

chk(app.draftStackPartner(chase, myPicks, statById).name==='Joe Burrow',
    'a WR candidate finds my same-team QB');
chk(app.draftStackPartner(otherWR, myPicks, statById)===null,
    'a different-team WR is no stack');
chk(app.draftStackPartner(rb, myPicks, statById)===null,
    'RBs never stack (same-team RB is anti-correlated if anything)');
const seaQB={player_id:'q2', name:'Sea QB', pos:'QB', team:'SEA'};
const st=app.draftStackPartner(seaQB, myPicks, statById);
chk(st && st.name==='Other Wideout' && st.tds===9,
    'a QB candidate finds my receiver, valued by THE RECEIVER’s TDs');

console.log('\n=== TDs are king: the bonus scales and is capped ===');
const bChase=app.vonaStackBonus(chase, myPicks, statById);
const bSlot=app.vonaStackBonus(slotGuy, myPicks, statById);
chk(bChase===10 && bSlot===2, `bonus = 1pt per projected connected TD (Chase ${bChase} vs slot guy ${bSlot})`);
const monster={...chase, receiving_tds:20};
chk(app.vonaStackBonus(monster, myPicks, statById)===app.STACK_CAP,
    'capped: a stack can leapfrog near-ties, never beat a real VOR gap');
chk(app.vonaStackBonus(chase, [], statById)===0, 'no roster yet, no bonus');

console.log('\n=== the bonus reorders a within-position near-tie ===');
const vorOf=(pk)=>({w1:60, w2:62, w3:61}[pk.player_id]||0);
const cands=[{...slotGuy, vor:62},{...otherWR, vor:61},{...chase, vor:60}];
const survOf=()=>0.5;
const noStack=app._vonaRankInPos(cands, myPicks, {QB:1,RB:1,WR:1,TE:0}, {QB:1,RB:2,WR:2,TE:1},
                                 (pk)=>vorOf(pk), survOf, 0);
const withStack=app._vonaRankInPos(cands, myPicks, {QB:1,RB:1,WR:1,TE:0}, {QB:1,RB:2,WR:2,TE:1},
                                   (pk)=>vorOf(pk), survOf, 0,
                                   (p)=>app.vonaStackBonus(p, myPicks, statById));
chk(noStack[0].p.player_id!=='w1', 'without the bonus, the tiny VOR edge wins');
chk(withStack[0].p.player_id==='w1', 'with it, Chase leapfrogs the 2-point near-tie to complete Burrow’s stack');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
