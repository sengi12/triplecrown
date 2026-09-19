// FAAB as a tradeable asset: the dollars→value curve read off the league's own wire, the
// inverse the evener asks for, and the verdict arithmetic that keeps money out of the stud
// premium. The curve is stubbed here so the math is tested without standing up the whole
// week-hub; test_week_hub covers the chop market that feeds it for real.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){},getBoundingClientRect:()=>({top:0})};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;
global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};
global.fetch=()=>Promise.reject(new Error('offline in test'));

const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');

let pass=0, fail=0;
const ok=(cond,msg)=>{ if(cond){pass++;console.log('  PASS:',msg);} else {fail++;console.log('  FAIL:',msg);} };
const near=(a,b,eps,msg)=>ok(Math.abs(a-b)<=eps, `${msg} (got ${a}, want ~${b})`);

const app=new Function(code+`
  toast=function(){};
  // A three-rung wire: $10 buys a 100, $30 a 300, $60 a 450.
  const RUNGS=[{price:10,v:100,label:'a flier'},{price:30,v:300,label:'an RB2'},{price:60,v:450,label:'a top-12 RB'}];
  laFaabCurve=function(){ return RUNGS; };
  return {laFaabValueOf, laFaabCostOf, laFaabBuys, laFaabOn, laFaabLeft, laTcVerdict, laTcAdjusted,
          laTradeSetFaab, laState, setSnap:(s)=>{ leagueSnapshot=s; }, RUNGS};
`)();

console.log("=== what a dollar buys, on the league's own rungs ===");
ok(app.laFaabValueOf(null,0)===0, 'no money is worth nothing');
near(app.laFaabValueOf(null,10),100,0.05,'a rung is worth exactly its rung');
near(app.laFaabValueOf(null,5),50,0.05,'below the cheapest rung it scales from zero');
near(app.laFaabValueOf(null,20),200,0.05,'between rungs it interpolates');
near(app.laFaabValueOf(null,30),300,0.05,'the second rung');
near(app.laFaabValueOf(null,45),375,0.05,'between the second and third');
near(app.laFaabValueOf(null,60),450,0.05,'the dearest rung');

console.log('=== and it is concave: more money never buys proportionally more ===');
const v30=app.laFaabValueOf(null,30), v60=app.laFaabValueOf(null,60), v120=app.laFaabValueOf(null,120);
ok(v60>v30, 'more money is worth more');
ok(v120>v60, 'still more above the dearest rung');
ok(v60 < 2*v30, 'doubling to the top rung does not double the value');
ok(v120 < 2*v60, 'and past the top rung it flattens further — there is nothing better to buy');
let mono=true, prev=-1;
for(let d=0; d<=200; d+=7){ const x=app.laFaabValueOf(null,d); if(x<prev-1e-9) mono=false; prev=x; }
ok(mono, 'the curve never goes backwards as dollars rise');

console.log('=== the inverse: the dollars that cover a gap ===');
near(app.laFaabCostOf(null,300,999),30,1.01,'a 300 gap costs about the second rung');
near(app.laFaabCostOf(null,100,999),10,1.01,'a 100 gap costs about the first');
ok(app.laFaabCostOf(null,0,999)===null, 'no gap needs no money');
ok(app.laFaabCostOf(null,300,5)===null, 'a budget that cannot cover the gap answers null, not a bid it cannot make');
const need=app.laFaabCostOf(null,250,999);
ok(app.laFaabValueOf(null,need) >= 250-0.5, 'the dollars it names really do cover the gap');

console.log('=== money counts, but is never the stud ===');
const base=app.laTcVerdict([100],[100],0,0);
const withMoney=app.laTcVerdict([100],[100],50,0);
near(withMoney.adjA-base.adjA,50,0.05,'FAAB value lands in the adjusted total');
ok(base.adjB===withMoney.adjB, 'and only on the side that sent it');
const lopsided=app.laTcVerdict([100],[100],5000,0);
near(lopsided.effA-lopsided.adjA,0,0.05,'a pile of money earns no stud premium — it is not a best player');
const studded=app.laTcVerdict([900],[100,100],0,0);
ok(studded.effA>studded.adjA, 'a real stud still does');

console.log('=== a team can only send what it still has ===');
const snap={leagueId:'L', waiverType:2, waiverBudget:100, leagueType:3,
  teamList:[{rosterId:1, faabUsed:70, players:[]},{rosterId:2, faabUsed:0, players:[]}]};
app.setSnap(snap);
ok(app.laFaabOn(snap)===true, 'a waiver_type 2 league with a budget is a FAAB league');
ok(app.laFaabOn({waiverType:0, waiverBudget:100})===false, 'a non-FAAB league is not');
ok(app.laFaabOn({waiverType:2, waiverBudget:0})===false, 'nor is a FAAB league with no budget');
ok(app.laFaabLeft(snap,1)===30, 'left = budget minus what has already been bid away');
ok(app.laFaabLeft(snap,2)===100, 'an untouched budget is all there');
app.laState.trade={a:1,b:2,giveA:[],giveB:[],faabA:0,faabB:0};
app.laTradeSetFaab('a', 999);
ok(app.laState.trade.faabA===30, 'asking for more than the team has clamps to what is left');
app.laTradeSetFaab('a', -5);
ok(app.laState.trade.faabA===0, 'and it never goes negative');
app.laTradeSetFaab('a', 12.7);
ok(app.laState.trade.faabA===13, 'dollars are whole');

console.log(`\nRESULT: ${pass}/${pass+fail} ${fail?'FAILURES':'ALL PASS'}`);
process.exit(fail?1:0);
