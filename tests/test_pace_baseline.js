// Kickoff snapshot: freeze-once semantics, wrong-year and reference-mode guards, quota
// degradation (in-memory survives a full localStorage), and honest late-freeze labeling.
const store={};
global.localStorage={
  getItem:(k)=>store[k]!=null?store[k]:null,
  setItem:(k,v)=>{ if(global.localStorage._throw) throw new Error('QuotaExceeded'); store[k]=String(v); },
  removeItem:(k)=>{ delete store[k]; },
  _throw:false,
};
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){}};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  TC_SEASON, maybeFreezePaceBaseline, getPaceBaseline, loadPaceBaseline, resetPaceBaseline,
  setBuildPlayerList:(f)=>{buildPlayerList=f;},
  setProj:(y)=>{PROJ_SEASON=y;}, setActiveSeason:(s)=>{activeSeason=s;} };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const LIST=[{name:'Test Receiver', team:'CIN', pos:'WR', player_id:'1',
  passing_yards:0,passing_tds:0,passing_attempts:0,passing_completions:0,interceptions_thrown:0,
  rushing_yards:40,rushing_tds:0,rushing_attempts:8,
  receiving_yards:1200,receiving_tds:9,receptions:85,receiving_targets:120,fumbles_lost:1,fpts:200}];
app.setBuildPlayerList(()=>LIST.map(p=>Object.assign({},p)));

console.log('=== guards before kickoff ===');
app.TC_SEASON.year=2026; app.TC_SEASON.phase='pre'; app.TC_SEASON.week=1; app.setProj(2026); app.setActiveSeason('proj');
chk(app.maybeFreezePaceBaseline()===false,'no freeze pre-season');
app.TC_SEASON.phase='regular';
app.setProj(2025);
chk(app.maybeFreezePaceBaseline()===false,'no freeze when PROJ_SEASON !== current year (stale seed)');
app.setProj(2026); app.setActiveSeason('2025');
chk(app.maybeFreezePaceBaseline()===false,'no freeze while viewing a reference season');
app.setActiveSeason('proj');

console.log('=== freeze once ===');
chk(app.maybeFreezePaceBaseline()===true,'freezes at week 1 of the regular season');
chk(store['triplecrown.paceBaseline.v1']!=null,'persisted under its own key (outside the session)');
const row=app.getPaceBaseline('1');
chk(row && row.receiving_yards===1200 && row.pos==='WR','frozen line readable by player_id');
chk(app.maybeFreezePaceBaseline()===false,'second call is a no-op');
app.TC_SEASON.week=9;
chk(app.maybeFreezePaceBaseline()===false,'re-entering later weeks never re-freezes');

console.log('=== late first open ===');
app.resetPaceBaseline();
app.TC_SEASON.week=8;
chk(app.maybeFreezePaceBaseline()===true,'late first open still freezes');
chk(app.loadPaceBaseline().frozenWeek===8,'frozenWeek recorded honestly (8)');

console.log('=== quota degradation ===');
app.resetPaceBaseline();
global.localStorage._throw=true;
chk(app.maybeFreezePaceBaseline()===true,'freeze succeeds in-memory when setItem throws');
chk(app.getPaceBaseline('1')!=null,'in-memory baseline still serves lookups');
chk(store['triplecrown.paceBaseline.v1']==null,'nothing half-written to storage');
global.localStorage._throw=false;

console.log(`\n${pass}/${total}`);
if(pass!==total) process.exit(1);
