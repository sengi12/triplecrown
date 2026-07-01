const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  buildSeedFromHistory, assembleSeedFromRecords,
  setHistory:(h,seasons,base)=>{HISTORY=h;HISTORY_SEASONS=seasons;SEED=base;seasonStatsCache.proj=base;projSeed=base;},
  };`)();

// Simulate the prebuilt HISTORY for 2025 with Flacco split CLE(4)/CIN(6), Burrow, Browning
const base={CIN:{QB:[{player_id:'burrow',name:'Joe Burrow',pos:'QB',team:'CIN'}],RB:[],WR:[],TE:[]},
  CLE:{QB:[{player_id:'flacco',name:'Joe Flacco',pos:'QB',team:'CLE'}],RB:[],WR:[],TE:[]}};
['ATL','BUF','CHI','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS','ARI','BAL','CAR'].forEach(t=>base[t]={QB:[],RB:[],WR:[],TE:[]});

const HISTORY={
  flacco:{'2025':[
    {team:'CLE',pos:'QB',name:'Joe Flacco',games_played:4,games_started:4,snap_pct:96.5,stats:{passing_yards:815,passing_attempts:160,passing_touchdowns:2,games_played:4}},
    {team:'CIN',pos:'QB',name:'Joe Flacco',games_played:6,games_started:6,snap_pct:99.7,stats:{passing_yards:1664,passing_attempts:256,passing_touchdowns:13,games_played:6}}
  ]},
  burrow:{'2025':[{team:'CIN',pos:'QB',name:'Joe Burrow',games_played:8,games_started:8,snap_pct:99,stats:{passing_yards:2400,passing_attempts:320,passing_touchdowns:18,games_played:8}}]},
  browning:{'2025':[{team:'CIN',pos:'QB',name:'Jake Browning',games_played:4,games_started:4,snap_pct:98,stats:{passing_yards:900,passing_attempts:130,passing_touchdowns:6,games_played:4}}]},
};
app.setHistory(HISTORY,['2025'],base);
const seed=app.buildSeedFromHistory('2025');

console.log('=== 2025 reference seed (snap-based splits) ===');
console.log('CLE QBs:', seed.CLE.QB.map(q=>`${q.name} (${q.games_played}g, ${q.passing_yards}yd)`).join(', '));
console.log('CIN QBs:', seed.CIN.QB.map(q=>`${q.name} (${q.games_played}g, ${q.passing_yards}yd)`).join(', '));

const cinNames=seed.CIN.QB.map(q=>q.name).sort();
const flaccoCLE=seed.CLE.QB.find(q=>q.name==='Joe Flacco');
const flaccoCIN=seed.CIN.QB.find(q=>q.name==='Joe Flacco');
const burrow=seed.CIN.QB.find(q=>q.name==='Joe Burrow');
const browning=seed.CIN.QB.find(q=>q.name==='Jake Browning');

console.log('\nFlacco on CLE (4 games):', flaccoCLE?flaccoCLE.games_played:'MISSING');
console.log('Flacco on CIN (6 games):', flaccoCIN?flaccoCIN.games_played:'MISSING');
console.log('Burrow on CIN (8 games):', burrow?burrow.games_played:'MISSING');
console.log('Browning on CIN (4 games):', browning?browning.games_played:'MISSING');
// Flacco's CLE stats should NOT be in CIN totals
const cinFlaccoYds=flaccoCIN?flaccoCIN.passing_yards:0;
console.log('Flacco CIN yards (should be 1664, NOT 2479):', cinFlaccoYds);

const ok = flaccoCLE&&flaccoCLE.games_played===4 && flaccoCIN&&flaccoCIN.games_played===6
  && burrow&&burrow.games_played===8 && browning&&browning.games_played===4
  && cinFlaccoYds===1664;
console.log('\nRESULT:', ok?'PASS (Flacco on both teams, snap-based games, no cross-team stat bleed)':'FAIL');
