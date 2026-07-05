const elStore={};function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],addEventListener(){},appendChild(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('_n'+Math.random()),body:{appendChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
const code=require('fs').readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  slotOnClock, myUpcomingPickNumbers, picksUntilMyTurn,
  setMeta:(m)=>{draftMeta=m;}, setPicks:(p)=>{draftPicksBySlot=p;}, setMySlot:(s)=>{mySlot=s;},
  setLineup:(l,b)=>{draftLineup=l;draftBenchCount=b;} };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== slotOnClock: snake ===');
chk(app.slotOnClock(1,12,'snake',0)===1,'pick 1 → slot 1');
chk(app.slotOnClock(12,12,'snake',0)===12,'pick 12 → slot 12');
chk(app.slotOnClock(13,12,'snake',0)===12,'pick 13 → slot 12 (snake turn)');
chk(app.slotOnClock(24,12,'snake',0)===1,'pick 24 → slot 1');
chk(app.slotOnClock(25,12,'snake',0)===1,'pick 25 → slot 1 (R3 back to normal)');

console.log('=== slotOnClock: linear ===');
chk(app.slotOnClock(13,12,'linear',0)===1,'linear pick 13 → slot 1');
chk(app.slotOnClock(16,12,'linear',0)===4,'linear pick 16 → slot 4');

console.log('=== slotOnClock: 3rd round reversal ===');
chk(app.slotOnClock(25,12,'snake',3)===12,'3RR: R3 pick 25 → slot 12 (continues R2 dir)');
chk(app.slotOnClock(21,12,'snake',3)===4,'3RR: pick 21 → slot 4');
chk(app.slotOnClock(37,12,'snake',3)===1,'3RR: R4 pick 37 → slot 1');

console.log('=== picksUntilMyTurn matches the 3 examples ===');
// EX1: snake slot4, 12 teams, waiting pick 10 → 9 picks made
app.setMeta({type:'snake',settings:{teams:12,rounds:15,reversal_round:0}});
app.setMySlot(4);
// simulate 9 picks made across slots (just need the count = 9)
const nine={}; for(let s=1;s<=9;s++) nine[s]=[{}]; app.setPicks(nine);  // 9 picks → current pick 10
chk(app.picksUntilMyTurn(4)===11,'EX1 snake slot4: 11 others then me (12th) = pick 21');
const up1=app.myUpcomingPickNumbers(4);
chk(up1[0]===21,'EX1 my next pick is global #21');

// EX2: linear slot4, waiting pick 10
app.setMeta({type:'linear',settings:{teams:12,rounds:15,reversal_round:0}});
chk(app.picksUntilMyTurn(4)===6,'EX2 linear slot4: 6 others then me (7th) = pick 16');
chk(app.myUpcomingPickNumbers(4)[0]===16,'EX2 my next pick is global #16');

// EX3: 3RR snake slot10, waiting global pick 21 (20 picks made)
app.setMeta({type:'snake',settings:{teams:12,rounds:15,reversal_round:3}});
app.setMySlot(10);
const twenty={}; let c=0; const pk={}; for(let s=1;s<=12;s++){pk[s]=[];}
// 20 picks made total
let made=0,slot=1; const picks={}; for(let s=1;s<=12;s++)picks[s]=[];
for(let n=1;n<=20;n++){ const sl=app.slotOnClock(n,12,'snake',3); picks[sl].push({}); }
app.setPicks(picks);
chk(app.picksUntilMyTurn(10)===6,'EX3 3RR slot10: 6 others then me (7th) = pick 27');
chk(app.myUpcomingPickNumbers(10)[0]===27,'EX3 my next pick is global #27');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
