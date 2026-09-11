// buildProjectionList: the projection board whatever season tab is active. The
// field report: with Live as the in-season default, the analyzer's lineup read one
// game's points as the projection ("proj 1.3" under a WR1). Pinned: on any other
// tab the working projection set is swapped in for the build and every global is
// restored; on the proj tab it is buildPlayerList itself; the analyzer's maps and
// the hub read through it.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  const seen=[];
  buildPlayerList=function(){ seen.push({activeSeason, userProj, SEED});
    return activeSeason==='proj' ? [{player_id:'6',name:'Jaxon Smith-Njigba',pos:'WR',team:'SEA',fpts:250,vor:80}]
                                 : [{player_id:'6',name:'Jaxon Smith-Njigba',pos:'WR',team:'SEA',fpts:22,vor:1}]; };
  return { seen, proj:buildProjectionList, pm:laProjMap, vor:laVorMap,
    set:(o)=>{ Object.assign(globalThis,{}); if(o.activeSeason!==undefined) activeSeason=o.activeSeason; if(o.userProj!==undefined) userProj=o.userProj; if(o.workingProj!==undefined) workingProj=o.workingProj; if(o.SEED!==undefined) SEED=o.SEED; if(o.projSeed!==undefined) projSeed=o.projSeed; },
    get:()=>({activeSeason, userProj, workingProj, SEED, projSeed}), bump:()=>{ if(typeof invalidateBuildPlayerCache==='function') invalidateBuildPlayerCache(); } };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const WORK={NE:{work:1}}, LIVE={NE:{live:1}}, PSEED={NE:{ps:1}}, LSEED={NE:{ls:1}};
app.set({activeSeason:'2026', userProj:LIVE, workingProj:WORK, SEED:LSEED, projSeed:PSEED});
let rows=app.proj();
chk(rows.length===1 && rows[0].fpts===250, 'on the Live tab the projection board is still the projection (250, not 22)');
const call=app.seen[app.seen.length-1];
chk(call.activeSeason==='proj' && call.userProj===WORK && call.SEED===PSEED, 'the build ran with activeSeason=proj, the working set and the projection seed');
const g=app.get();
chk(g.activeSeason==='2026' && g.userProj===LIVE && g.SEED===LSEED && g.workingProj===WORK, 'every global is restored afterwards');
const n=app.seen.length; app.proj();
chk(app.seen.length===n, 'the second call within the same epoch is served from its own cache');
app.bump(); app.proj();
chk(app.seen.length===n+1, 'an edit (epoch bump) rebuilds it');
app.set({activeSeason:'proj', userProj:WORK});
rows=app.proj();
chk(rows[0].fpts===250 && app.seen[app.seen.length-1].activeSeason==='proj', 'on the proj tab it is buildPlayerList itself');
app.set({activeSeason:'2026', userProj:LIVE});
chk(app.pm().get('jaxon smithnjigba|WR')===250, 'laProjMap (the Lineup/Matchup projection) reads 250 on the Live tab');
chk(app.vor().get('jaxon smithnjigba|WR')===80, 'laVorMap reads the projection VOR on the Live tab');
console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
