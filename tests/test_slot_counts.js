const elStore={};function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],addEventListener(){},appendChild(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('_n'+Math.random()),body:{appendChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
const code=require('fs').readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+'return { lineupFromSlotCounts };')();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const settings={reversal_round:3,rounds:15,slots_def:1,slots_flex:2,slots_k:1,slots_qb:1,slots_rb:2,slots_te:1,slots_wr:2,teams:12};
const r=app.lineupFromSlotCounts(settings);
chk(r.lineup.length===10,'10 starters from slots_*');
chk(r.bench===5,'5 bench (rounds 15 - 10 starters)');
chk(r.lineup.filter(x=>x==='FLEX').length===2,'2 FLEX slots');
chk(r.lineup.filter(x=>x==='K').length===1 && r.lineup.filter(x=>x==='DEF').length===1,'K + DEF present');
chk(r.lineup[0]==='QB','ordered QB first');
// superflex mock
const sf=app.lineupFromSlotCounts({rounds:16,slots_qb:1,slots_rb:2,slots_wr:2,slots_te:1,slots_super_flex:1,slots_flex:1,slots_k:1,slots_def:1});
chk(sf.lineup.includes('SUPER_FLEX'),'superflex slot from slots_super_flex');
// empty → null (caller falls back to default)
chk(app.lineupFromSlotCounts({rounds:15})===null,'no slots → null (fallback to default)');
console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
