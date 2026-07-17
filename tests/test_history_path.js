const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  buildSeedFromHistory, ensureTeam, renderPassing,
  setAll:(s,h,hs)=>{SEED=s;projSeed=s;seasonStatsCache.proj=s;workingProj={};userProj=workingProj;activeSeason='proj';HISTORY=h;HISTORY_SEASONS=hs;},
  setSeasonCache:(s,seed)=>{seasonStatsCache[s]=seed;},
  enterRef:(s)=>{if(activeSeason==='proj')workingProj=userProj;activeSeason=s;SEED=seasonStatsCache[s];referenceProj={};userProj=referenceProj;},
  getActiveSeason:()=>activeSeason, getSEED:()=>SEED, getProj:()=>userProj };
`)();

// Simulate a prebuilt seed with HISTORY containing Flacco's per-team split
const base={};
['ATL','ARI','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC',
 'LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS'].forEach(t=>base[t]={QB:[],RB:[],WR:[],TE:[]});
const HISTORY={
  '19':{'2025':[
    {team:'CLE',pos:'QB',name:'Joe Flacco',games_played:4,snap_pct:96.5,stats:{passing_yards:815,passing_attempts:160,passing_touchdowns:2,games_played:4}},
    {team:'CIN',pos:'QB',name:'Joe Flacco',games_played:6,snap_pct:99.7,stats:{passing_yards:1664,passing_attempts:256,passing_touchdowns:13,games_played:6}}
  ]},
  '6770':{'2025':[{team:'CIN',pos:'QB',name:'Joe Burrow',games_played:8,snap_pct:99,stats:{passing_yards:1809,passing_attempts:242,passing_touchdowns:14,games_played:8}}]},
};
app.setAll(base, HISTORY, ['2025']);

console.log('=== Prebuilt seed path (HISTORY loaded) ===');
const built=app.buildSeedFromHistory('2025');
console.log('buildSeedFromHistory result:', built?'OK':'NULL');
if(built){
  console.log('CLE QBs:', built.CLE.QB.map(q=>`${q.name}(${q.games_played}g)`).join(', ')||'none');
  console.log('CIN QBs:', built.CIN.QB.map(q=>`${q.name}(${q.games_played}g)`).join(', ')||'none');
  const flCLE=built.CLE.QB.find(q=>q.name==='Joe Flacco');
  const flCIN=built.CIN.QB.find(q=>q.name==='Joe Flacco');
  console.log('Flacco CLE games:', flCLE?flCLE.games_played:'MISSING');
  console.log('Flacco CIN games:', flCIN?flCIN.games_played:'MISSING');
  console.log('RESULT:', flCLE&&flCLE.games_played===4&&flCIN&&flCIN.games_played===6?'PASS':'FAIL');
}else{
  console.log('RESULT: FAIL (buildSeedFromHistory returned null)');
}
