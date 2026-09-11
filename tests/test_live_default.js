// In-season the Projections view opens on Live once a game has been played; a
// tap on either segment is remembered; a restored past-season tab or a
// Rankings/League boot is left alone; it happens once per session.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  Object.assign(TC_SEASON,{year:2026,phase:'regular',week:1});
  let started=true; hasSeasonStarted=function(){return started;};
  completedWeeks=function(){return 1;};
  const loads=[]; loadSeason=async function(s){ loads.push(s); activeSeason=s; }; renderSeasonTabs=function(){};
  return { dflt:liveSeasonDefaultView, pick:tcPickSeasonTab, setMode:setProjViewMode, pref:tcViewPrefGet, loads,
    reset:()=>{ _liveDefaultApplied=false; loads.length=0; localStorage.removeItem('tc_proj_view_pref'); activeSeason='proj'; currentPhase='Passing'; },
    setActive:(s)=>{ activeSeason=s; }, setPhase:(p)=>{ currentPhase=p; }, stop:()=>{ started=false; } };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

app.reset();
chk(app.dflt()===true && app.loads[0]==='2026', 'a game played + no preference → the view lands on Live (the current season)');
chk(app.dflt()===false && app.loads.length===1, 'once per session');
app.reset(); app.pick('proj');
chk(app.pref()==='proj', 'tapping the projection tab is remembered');
app.reset(); localStorage.setItem('tc_proj_view_pref','proj');
chk(app.dflt()===false && app.loads.length===0, 'someone who chose the projection keeps landing on it');
app.reset(); app.setMode('live', true);
chk(app.pref()==='live', 'and the Live segment is remembered the same way');
app.reset(); app.setActive('2025');
chk(app.dflt()===false, 'a restored past-season tab is left alone');
app.reset(); app.setPhase('Rankings');
chk(app.dflt()===false, 'booting into Rankings does not switch the season under it');
app.reset(); app.stop();
chk(app.dflt()===false, 'offseason: nothing happens');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
