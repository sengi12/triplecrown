const elStore={};function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],addEventListener(){},appendChild(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('_n'+Math.random()),body:{appendChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
const code=require('fs').readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+'return { applyDraftScoring, slotClass, lineupFromRosterPositions, getFmt:()=>rankFormat, getRec:()=>scoringSettings.receptions, DEFAULT_BENCH:()=>DEFAULT_BENCH };')();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
app.applyDraftScoring({metadata:{scoring_type:'ppr'}}); chk(app.getFmt()==='ppr'&&app.getRec()===1.0,'ppr → full PPR');
app.applyDraftScoring({metadata:{scoring_type:'half_ppr'}}); chk(app.getFmt()==='half_ppr'&&app.getRec()===0.5,'half_ppr → half');
app.applyDraftScoring({metadata:{scoring_type:'std'}}); chk(app.getFmt()==='std'&&app.getRec()===0.0,'std → standard');
app.applyDraftScoring({metadata:{scoring_type:'2qb'}}); chk(app.getFmt()==='superflex','2qb → superflex');
app.applyDraftScoring({metadata:{scoring_type:'dynasty_ppr'}}); chk(app.getFmt()==='dynasty'&&app.getRec()===1.0,'dynasty_ppr → dynasty+PPR');
app.applyDraftScoring({metadata:{scoring_type:'dynasty_2qb'}}); chk(app.getFmt()==='dynasty_superflex','dynasty_2qb → dyn SF');
chk(app.DEFAULT_BENCH()===5,'default bench = 5');
chk(app.slotClass('K')==='rt-pos-k'&&app.slotClass('DEF')==='rt-pos-def','K purple / DEF brown classes');
console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
