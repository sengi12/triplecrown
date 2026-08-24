// Games-only mode: the advanced escape hatch for committee/injury situations — changing
// Games Played shifts games WITHOUT rescaling season totals (rates re-derive), while the
// normal mode keeps its scale-by-pace behavior. Floor of 1 game while totals are kept.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){},remove(){},innerHTML:'',contains:()=>false}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){},removeEventListener(){}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){},innerWidth:800,innerHeight:600};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  handleSliderKey, toggleQbGamesOnly,
  setUserProj:(u)=>{userProj=u;}, setTeamVar:(t)=>{currentTeam=t;},
  noopLive:()=>{ liveQB=()=>{}; livePassDependents=()=>{}; updateWorkloadUI=()=>{}; refreshQBStatSliders=()=>{}; markDirty=()=>{}; renderContent=()=>{}; } };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

app.noopLive();
const mkState=()=>({activeQB:0, qbs:[{name:'Test QB', player_id:'q1', games:12, games_played:12,
  passing_yards:3600, passing_tds:24, passing_attempts:480, passing_completions:312,
  interceptions_thrown:9, qb_rush_yards:120, qb_rush_tds:2, qb_rush_attempts:36}]});

console.log('=== normal mode still scales by pace ===');
let state=mkState();
app.setUserProj({CIN:state}); app.setTeamVar('CIN');
app.handleSliderKey('games_0', 6, 'CIN');
chk(state.qbs[0].games===6,'games moved to 6');
chk(state.qbs[0].passing_yards===1800,'totals scale with games (3600 → 1800)');

console.log('=== games-only mode keeps totals fixed ===');
state=mkState(); state._qbGamesOnly=true;
app.setUserProj({CIN:state});
app.handleSliderKey('games_0', 6, 'CIN');
chk(state.qbs[0].games===6,'games moved to 6');
chk(state.qbs[0].passing_yards===3600,'season totals untouched');
chk(Math.abs(state.qbs[0]._rate.passing_yards-600)<1e-9,'per-game rate re-derived (600/gm)');
app.handleSliderKey('games_0', 17, 'CIN');
chk(state.qbs[0].passing_yards===3600 && state.qbs[0].games===17,'moving back up still leaves totals alone');
app.handleSliderKey('games_0', 0, 'CIN');
chk(state.qbs[0].games===1,'floor of 1 game while totals are kept');

console.log('=== toggle lives on the team state ===');
state=mkState();
app.setUserProj({CIN:state});
app.toggleQbGamesOnly('CIN');
chk(state._qbGamesOnly===true,'toggle on');
app.toggleQbGamesOnly('CIN');
chk(state._qbGamesOnly===false,'toggle off');

console.log(`\n${pass}/${total}`);
if(pass!==total) process.exit(1);
