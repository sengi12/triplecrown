const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};global.Chart=function(){return{destroy(){},update(){}};};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={};}abort(){}};
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  renderTeamAdvanced, _carryPopBody, setTeamVar:(t)=>{currentTeam=t;},
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
// The card is gone: a yellow ! on the Defense head opens the popup with the detail.
chk(html.includes("tcInfoPop(event,'carry_def')"),'yellow ! flag wired on the Defense head');
app.setTeamVar('TEN');
const popBody=app._carryPopBody('defense');
chk(popBody.includes('New DC'),'popup shows the (compact) DC badge');
chk(popBody.includes('assistant head coach'),'shows former role "assistant head coach" (not collapsed to head coach)');
chk(popBody.includes('San Francisco 49ers'),'shows former team');
chk(popBody.includes("advJumpToTeam('SF')"),'popup chip links to the former-team advanced view');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
