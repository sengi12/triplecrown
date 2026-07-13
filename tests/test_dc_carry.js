const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};global.Chart=function(){return{destroy(){},update(){}};};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={};}abort(){}};
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  renderTeamAdvanced,
  setNflverse:(n)=>{NFLVERSE=n;}, setCoord:(c)=>{COORDINATORS=c;}, setNames:(n)=>{TEAM_NAMES=n;}, setSharpSeason:(y)=>{SHARP_SEASON=y;}, setHC:(t,v)=>{headCoaches[t]=v;} };`)();

// Defensive Sharp tables incl BOTH coverage tables
const NFLV={'2025':{team:{
  def_tendencies:{columns:['Blitz Rate'],teams:{SF:{values:{'Blitz Rate':28},ranks:{'Blitz Rate':6}},TEN:{values:{'Blitz Rate':20},ranks:{'Blitz Rate':22}}}},
  coverage:{columns:['Man Rate'],teams:{SF:{values:{'Man Rate':35},ranks:{'Man Rate':9}},TEN:{values:{'Man Rate':30},ranks:{'Man Rate':15}}}},
}}};
// Titans have a NEW DC from the 49ers (was assistant head coach)
const COORD={ TEN:{ defense:{name:'Some Coordinator',since:2026,is_new:true,internal:false,carryover:false,prev_code:'SF',prev_role:'assistant head coach',prev_years:'2024-2025'} } };

let pass=0,total=0; const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
app.setNflverse(NFLV); app.setCoord(COORD); app.setNames({TEN:'Tennessee Titans',SF:'San Francisco 49ers'}); app.setSharpSeason(2025); app.setHC('TEN',null);
const html=app.renderTeamAdvanced('TEN');

console.log('=== Defensive carryover: tendencies + coverage schemes, NOT coverage-by-position ===');
chk(html.includes('Defensive Tendencies'),'includes Defensive Tendencies');
chk(html.includes('Coverage (man/zone)'),'includes Coverage table');
// The carryover block is between 'scheme carryover' and the first section head.
const carryStart=html.indexOf('scheme carryover');
const carryEnd=html.indexOf('sr-section-head', carryStart>=0?carryStart:0);
const carryBlock=(carryStart>=0)?html.slice(carryStart, carryEnd>=0?carryEnd:html.length):'';
chk(!/Coverage by Position/.test(carryBlock),'carryover block EXCLUDES Coverage by Position');
chk(/Coverage \(man\/zone\)/.test(carryBlock),'carryover block INCLUDES Coverage table');
chk(html.includes('assistant head coach'),'shows former role "assistant head coach" (not collapsed to head coach)');
chk(html.includes('San Francisco 49ers'),'shows former team');
// Should pull SF values (28 blitz, 35 man), not Tennessee's
chk(html.includes('28')||html.includes('28%'),'pulls 49ers blitz rate');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
