// TC_SEASON source of truth: month-aware fallback, full /state/nfl parsing (phase + week,
// not just the year), seed-state adoption precedence, and the two derived gates
// (hasSeasonStarted / completedWeeks) every in-season feature keys on.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){}};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  TC_SEASON, _tcMonthAwareYear, _tcApplySleeperState, _tcApplySeedState,
  hasSeasonStarted, completedWeeks,
  getProj:()=>PROJ_SEASON, setProj:(y)=>{PROJ_SEASON=y;},
  reset:()=>{TC_SEASON.phase='off';TC_SEASON.week=0;TC_SEASON.source='fallback';TC_SEASON.fetchedAt=0;} };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== month-aware league year ===');
chk(app._tcMonthAwareYear(new Date(2028,0,15))===2027,'Jan 15 2028 → league year 2027');
chk(app._tcMonthAwareYear(new Date(2028,1,28))===2027,'Feb 28 2028 → league year 2027');
chk(app._tcMonthAwareYear(new Date(2028,2,1))===2028,'Mar 1 2028 → league year 2028');
chk(app._tcMonthAwareYear(new Date(2028,8,10))===2028,'Sep 2028 → league year 2028');

console.log('=== full state parsing ===');
app.reset();
app._tcApplySleeperState({league_season:'2026', season_type:'regular', week:9});
chk(app.TC_SEASON.year===2026 && app.getProj()===2026,'season adopted into TC_SEASON + PROJ_SEASON');
chk(app.TC_SEASON.phase==='regular' && app.TC_SEASON.week===9,'phase + week no longer discarded');
chk(app.TC_SEASON.source==='sleeper','source stamped');
app._tcApplySleeperState({league_season:'2026', season_type:'nonsense', week:'x'});
chk(app.TC_SEASON.phase==='regular' && app.TC_SEASON.week===9,'garbage phase/week ignored, prior kept');
app.reset();
app._tcApplySleeperState({season:'2026', season_type:'off', display_week:3});
chk(app.TC_SEASON.week===3,'display_week fallback honored');

console.log('=== seed-state adoption + precedence ===');
app.reset();
app._tcApplySeedState({season:2026, season_type:'pre', week:2});
chk(app.TC_SEASON.phase==='pre' && app.TC_SEASON.source==='seed','seed state adopted when no live probe');
app._tcApplySleeperState({league_season:'2026', season_type:'regular', week:5});
app._tcApplySeedState({season:2026, season_type:'off', week:0});
chk(app.TC_SEASON.phase==='regular' && app.TC_SEASON.week===5,'live truth wins over a stale seed state');

console.log('=== hasSeasonStarted / completedWeeks truth table ===');
const cases=[[{phase:'off',week:0},false,0],[{phase:'pre',week:2},false,0],
  [{phase:'regular',week:0},false,0],[{phase:'regular',week:1},true,0],
  [{phase:'regular',week:5},true,4],[{phase:'post',week:19},true,18]];
cases.forEach(([st,started,weeks])=>{
  app.TC_SEASON.phase=st.phase; app.TC_SEASON.week=st.week;
  chk(app.hasSeasonStarted()===started && app.completedWeeks()===weeks,
    `${st.phase} wk${st.week} → started=${started}, completed=${weeks}`);
});

console.log(`\n${pass}/${total}`);
if(pass!==total) process.exit(1);
