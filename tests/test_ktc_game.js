const elStore={};
function mkEl(id){ if(!elStore[id]) elStore[id]={innerHTML:'',style:{},textContent:'',classList:{add(){},remove(){}},appendChild(){},querySelectorAll:()=>[]}; return elStore[id]; }

global.document={
  getElementById:(id)=>mkEl(id),
  querySelector:()=>null,
  querySelectorAll:()=>[],
  createElement:()=>({style:{},appendChild(){},remove(){}}),
  body:{appendChild(){},removeChild(){}},
  addEventListener(){},
};
global.window={scrollY:0,innerHeight:900,scrollTo(){}};
global.fetch=()=>Promise.reject(new Error('no net'));
global.confirm=()=>true;
global.btoa=s=>Buffer.from(s,'binary').toString('base64');
global.FileReader=function(){};
global.Range=function(){};

global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};

const fs=require('fs');
const path=require('path');
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { ktcPlayerKey, ktcSolveDeltas, ktcTopTierCutoff };`)();

let pass=0,total=0;
const chk=(cond,label)=>{ total++; if(cond){ pass++; console.log('  PASS:',label);} else console.log('  FAIL:',label); };

console.log('=== Keep Trade Cut delta solver (wide gap: bounded correction) ===');
const trio=[
  {name:'Joe Burrow',team:'CIN',pos:'QB',player_id:'1',fpts:304.1},
  {name:'Josh Allen',team:'BUF',pos:'QB',player_id:'2',fpts:361.2},
  {name:'Lamar Jackson',team:'BAL',pos:'QB',player_id:'3',fpts:349.9},
];
const keep=app.ktcPlayerKey(trio[0]);
const trade=app.ktcPlayerKey(trio[1]);
const cut=app.ktcPlayerKey(trio[2]);
const deltas=app.ktcSolveDeltas(trio,[keep,trade,cut],0.45);

chk(Number.isFinite(deltas[keep]),'returns finite keep delta');
chk(Number.isFinite(deltas[trade]),'returns finite trade delta');
chk(Number.isFinite(deltas[cut]),'returns finite cut delta');
chk(deltas[keep]>0,'keep gets positive push');
chk(deltas[cut]<0,'cut gets negative push');
chk(Math.abs(deltas[keep])<=2.1 && Math.abs(deltas[trade])<=2.1 && Math.abs(deltas[cut])<=2.1,'per-player correction is bounded (no drastic one-round jump)');

const k=(trio[0].fpts||0)+(deltas[keep]||0);
const t=(trio[1].fpts||0)+(deltas[trade]||0);
const c=(trio[2].fpts||0)+(deltas[cut]||0);
const beforeGap = (trio[1].fpts||0) - (trio[0].fpts||0);
const afterGap = t-k;
chk(afterGap < beforeGap,'wide-gap ordering deficit shrinks without full overcorrection');

console.log('\n=== Keep Trade Cut delta solver (close trio: can fully reorder) ===');
const trioClose=[
  {name:'Player A',team:'CIN',pos:'WR',player_id:'11',fpts:247.1},
  {name:'Player B',team:'BUF',pos:'WR',player_id:'12',fpts:248.0},
  {name:'Player C',team:'BAL',pos:'WR',player_id:'13',fpts:247.4},
];
const keep2=app.ktcPlayerKey(trioClose[0]);
const trade2=app.ktcPlayerKey(trioClose[1]);
const cut2=app.ktcPlayerKey(trioClose[2]);
const d2=app.ktcSolveDeltas(trioClose,[keep2,trade2,cut2],0.45);
const k2=(trioClose[0].fpts||0)+(d2[keep2]||0);
const t2=(trioClose[1].fpts||0)+(d2[trade2]||0);
const c2=(trioClose[2].fpts||0)+(d2[cut2]||0);
const beforeNeed1=(trioClose[1].fpts+0.45)-trioClose[0].fpts;
const afterNeed1=(t2+0.45)-k2;
chk(afterNeed1 < beforeNeed1,'close trios reduce KEEP-vs-TRADE deficit significantly');
chk(k2>c2,'close trios still push KEEP ahead of CUT without a drastic leap');

console.log('\n=== Keep Trade Cut intensity profiles ===');
const dCon=app.ktcSolveDeltas(trioClose,[keep2,trade2,cut2],0.45,'conservative');
const dBal=app.ktcSolveDeltas(trioClose,[keep2,trade2,cut2],0.45,'balanced');
const dAgg=app.ktcSolveDeltas(trioClose,[keep2,trade2,cut2],0.45,'aggressive');
chk(Math.abs(dCon[keep2]||0) < Math.abs(dBal[keep2]||0),'conservative intensity nudges less than balanced');
chk(Math.abs(dAgg[keep2]||0) > Math.abs(dBal[keep2]||0),'aggressive intensity nudges more than balanced');

console.log('\n=== Keep Trade Cut top-tier cutoff target ===');
const boardTiers=[];
for(let i=1;i<=14;i++) boardTiers.push({ name:`P${i}`, ecr_tier:i });
const cutoff=app.ktcTopTierCutoff(boardTiers);
chk(cutoff>=8 && cutoff<=9,'tier cutoff stays focused on top 8-9 ECR tiers');

console.log('\nRESULT:', pass===total ? `PASS (${pass} checks)` : `FAIL (${pass}/${total} checks)`);
process.exit(pass===total?0:1);
