// The advisory's reasoning layers shipped 2026-09-08: tier-break urgency, the
// BAFL derivative category weighting, and the local app-data tools for the AI
// loops. Pure-function tests — the heavy VONA machinery is exercised elsewhere.
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
  return { _vonaTierBreak, _vonaTierUrgency, _baflCatSums, _baflCatWeights, _vonaBaflCatAdj,
    scoringSettings, tcLocalToolCall, tcLocalToolDefs, tcMcpTools,
    setSlot:(s)=>{mySlot=s;}, setPicks:(o)=>{draftPicksBySlot=o;},
    setSnapshot:(sn)=>{leagueSnapshot=sn;} };
`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

(async()=>{
console.log('=== tier break: how much of the current tier survives ===');
const mk=(id,tier,surv)=>({player_id:id, name:id, pos:'RB', ecr_tier:tier, _s:surv});
const pool=[mk('a',2,0.9), mk('b',2,0.3), mk('c',3,0.8), mk('d',3,0.7)];
const survOf=(q)=>q._s;
const t=app._vonaTierBreak(pool, pool[0], survOf);
chk(t && t.n===2 && t.left===2, 'counts only the CURRENT tier’s survivors-in-waiting');
chk(Math.abs(t.pHold-(1-(1-0.9)*(1-0.3)))<0.01, 'pHold = P(at least one of them survives)');
chk(app._vonaTierBreak(pool, {ecr_tier:null}, survOf)===null, 'no tier data, no signal');

console.log('\n=== tier urgency: bounded, and only when the cliff is real ===');
chk(app._vonaTierUrgency({n:2,left:2,pHold:0.2}, 10)>1.1, 'a closing tier above a real drop nudges the score');
chk(app._vonaTierUrgency({n:2,left:2,pHold:0.2}, 0)===1, 'no VOR cliff behind it, no nudge (tiers lean, VOR decides)');
chk(app._vonaTierUrgency({n:2,left:6,pHold:0.2}, 10)===1, 'a deep tier is not closing');
chk(app._vonaTierUrgency({n:2,left:2,pHold:0.9}, 10)===1, 'a tier that will still be there is not urgent');
chk(app._vonaTierUrgency({n:2,left:1,pHold:0.01}, 10)<=1.2, 'the nudge is capped at +20%');

console.log('\n=== BAFL derivative: contested categories are worth more ===');
const W=app._baflCatWeights({pass:3000,rush:900,rec:1500,td:20},{pass:3000,rush:1800,rec:1500,td:20});
chk(Math.abs(W.pass-1)<1e-9 && Math.abs(W.rec-1)<1e-9, 'dead-even categories keep full weight');
chk(W.rush<0.6, 'a category I trail badly loses weight (its density has moved off my margin)');
const stat=new Map([['q',{passing_yards:4000,interceptions_thrown:10,passing_tds:28}],
                    ['r',{rushing_yards:1200,rushing_tds:8}]]);
const sums=app._baflCatSums([{player_id:'q'},{player_id:'r'}], stat);
chk(sums.pass===3800 && sums.rush===1200 && sums.td===36, 'sums follow the BAFL formulas (pass −20/INT, all TDs)');
app.scoringSettings.baflMode=true; app.setSlot(1);
app.setPicks({1:[{player_id:'q'}], 2:[{player_id:'r'}], 3:[{player_id:'r'}]});
const adj=app._vonaBaflCatAdj(stat);
chk(typeof adj==='function', 'live draft + BAFL Mode yields a candidate adjuster');
const rusher={rushing_yards:1000,rushing_tds:5};
const equal={receiving_yards:0,rushing_yards:0};
chk(adj(rusher)<adj(equal)+0.01 && adj(rusher)<0, 'stats in a category I’ve lost ground in are DISCOUNTED vs the static lens');
app.scoringSettings.baflMode=false;
chk(app._vonaBaflCatAdj(stat)===null, 'off outside BAFL Mode');

console.log('\n=== local app-data tools: on-device, quarantined, never throwing ===');
const defs=app.tcLocalToolDefs();
chk(defs.length===5 && defs.every(d=>d.name && d.inputSchema), 'five tools, each with a schema');
chk(await app.tcLocalToolCall('rankings',{})===null, 'non-local names fall through to the worker');
const noLeague=await app.tcLocalToolCall('league_team',{name:'Bob'});
chk(/sync/i.test(noLeague), 'no synced league answers with guidance, not a throw');
app.setSnapshot({name:'Test League', teamList:[
  {rosterId:1, teamName:'The Ja’Mazing', owner:'Sengi12', ownerId:'u1', wins:3, losses:1, players:[]},
  {rosterId:2, teamName:'Congrats Kid', owner:'kclark75', ownerId:'u2', players:[{name:'Some Guy', pos:'QB'}]},
]});
const found=await app.tcLocalToolCall('league_team',{name:'congrats'});
chk(/Congrats Kid/.test(found) && /QB/.test(found), 'fuzzy team name finds the roster');
const miss=await app.tcLocalToolCall('league_team',{name:'zzz'});
chk(/teams:/i.test(miss), 'a miss lists the real team names to retry with');
chk(/team code/i.test(await app.tcLocalToolCall('adv_team',{})), 'adv_team without a team asks for one');
const tools=await app.tcMcpTools('half_ppr').catch(()=>null);
chk(Array.isArray(tools) && tools.some(x=>x.name==='league_team'),
    'tool-capable models see the local tools even when the worker is unreachable');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
})();
