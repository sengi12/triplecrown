const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  assembleSeed, normalizeSleeperRow, ensureTeam, initPassingShares,
  setProj:(s)=>{SEED=s;projSeed=s;seasonStatsCache.proj=s;workingProj={};userProj=workingProj;activeSeason='proj';},
  setRefCache:(season,seed)=>{seasonStatsCache[season]=seed;HISTORY_SEASONS=[season];},
  setSleeper:(p)=>{sleeperPlayers=p;},
  selectTeam:t=>{currentTeam=t;currentPhase='Passing';ensureTeam(t);initPassingShares(t);},
  setSub:(s)=>{passingSubTab=s;},
  derivedShare:(team,i,share,metric)=>{setDerivedShare(userProj[team],team,i,share,metric);},
  vacatedProduction, getProj:()=>userProj };
`)();

console.log('=== TEST 1: editable receptions share rescales others ===');
const players={q:{player_id:'q',name:'QB',pos:'QB',team:'KC'},
  a:{player_id:'a',name:'WR A',pos:'WR',team:'KC'},b:{player_id:'b',name:'WR B',pos:'WR',team:'KC'}};
const idx={q:app.normalizeSleeperRow({player_id:'q',team:'KC',position:'QB',stats:{pass_yd:4500,pass_att:600,pass_td:30,gp:17}}),
  a:app.normalizeSleeperRow({player_id:'a',team:'KC',position:'WR',stats:{rec:100,rec_yd:1300,rec_td:10,gp:17}}),
  b:app.normalizeSleeperRow({player_id:'b',team:'KC',position:'WR',stats:{rec:60,rec_yd:700,rec_td:5,gp:17}})};
app.setProj(app.assembleSeed(players,idx,true));
app.selectTeam('KC'); app.setSub('rec');
const st=app.getProj()['KC'];
const before=st.passing_shares.map(p=>({n:p.name,cr:p.catch_rate}));
console.log('Before:', before.map(x=>`${x.n}:cr=${x.cr.toFixed(2)}`).join(', '));
// bump WR A's reception share to 60%
app.derivedShare('KC',0,0.60,'rec');
const after=st.passing_shares.map(p=>({n:p.name,cr:p.catch_rate}));
console.log('After A→60% rec share:', after.map(x=>`${x.n}:cr=${x.cr.toFixed(2)}`).join(', '));
// catch rates changed = the slider had an effect
const changed=before[0].cr!==after[0].cr;
console.log('RESULT:', changed?'PASS (reception share editable, affects catch rates)':'FAIL');

console.log('\n=== TEST 2: vacated respects current roster (Charlie Jones still Bengal) ===');
// 2026 CIN proj: Chase only (Charlie Jones has 0 projected stats, filtered from seed)
const proj={CIN:{QB:[{player_id:'burrow',name:'Burrow',pos:'QB',team:'CIN',passing_yards:4800,passing_attempts:600,games:17}],
  WR:[{player_id:'chase',name:'Chase',pos:'WR',team:'CIN',receiving_targets:170,receptions:120,receiving_yards:1600,receiving_tds:14}],RB:[],TE:[]}};
['ATL','BUF','CHI','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS','ARI','BAL','CAR'].forEach(t=>proj[t]={QB:[],RB:[],WR:[],TE:[]});
app.setProj(proj);
// 2024 CIN ref: Chase, Charlie Jones (real targets), Tee Higgins (left in this hypothetical)
const ref={CIN:{QB:[],WR:[
  {player_id:'chase',name:'Chase',pos:'WR',team:'CIN',receiving_targets:175,receptions:127,receiving_yards:1708,receiving_tds:17},
  {player_id:'cjones',name:'Charlie Jones',pos:'WR',team:'CIN',receiving_targets:40,receptions:28,receiving_yards:300,receiving_tds:1},
  {player_id:'higgins',name:'Tee Higgins',pos:'WR',team:'CIN',receiving_targets:100,receptions:73,receiving_yards:900,receiving_tds:10}
],RB:[],TE:[]}};
['ATL','BUF','CHI','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS','ARI','BAL','CAR'].forEach(t=>ref[t]={QB:[],RB:[],WR:[],TE:[]});
app.setRefCache('2024',ref);
// Sleeper DB: Charlie Jones is STILL a Bengal (team=CIN), Tee Higgins moved to TEN
app.setSleeper({chase:{team:'CIN'},cjones:{team:'CIN'},higgins:{team:'TEN'},burrow:{team:'CIN'}});
const vac=app.vacatedProduction('CIN');
console.log('Vacated:', vac?vac.players.join(', '):'none');
const ok2 = vac && vac.players.includes('Tee Higgins') && !vac.players.includes('Charlie Jones');
console.log('RESULT:', ok2?'PASS (Higgins vacated, Charlie Jones retained despite 0 proj)':'FAIL');
