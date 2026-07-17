const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  assembleSeed, normalizeSleeperRow, ensureTeam, initPassingShares, hsURL,
  buildSleeperNameIndex, resolvePlayerId, vacatedProduction, reconcileTargets, teamTargetPool, teamPassAtt,
  setProj:(s)=>{SEED=s;projSeed=s;seasonStatsCache.proj=s;workingProj={};userProj=workingProj;activeSeason='proj';},
  setRefCache:(season,seed)=>{seasonStatsCache[season]=seed;HISTORY_SEASONS=[season];},
  setSleeper:(p)=>{sleeperPlayers=p;buildSleeperNameIndex();},
  selectTeam:t=>{currentTeam=t;currentPhase='Receiving';ensureTeam(t);initPassingShares(t);},
  getProj:()=>userProj, getSEED:()=>SEED };
`)();

console.log('=== TEST 1: headshot resolves by name when no player_id ===');
app.setSleeper({'4046':{player_id:'4046',name:'Patrick Mahomes',pos:'QB',team:'KC'}});
const url=app.hsURL({name:'Patrick Mahomes',pos:'QB'});  // no player_id
console.log('Resolved URL:', url);
console.log('RESULT:', url.includes('4046')?'PASS (matched to Sleeper id)':'FAIL');

console.log('\n=== TEST 2: zero-stat rostered player included (Erick All) ===');
const players={'b':{player_id:'b',name:'Burrow',pos:'QB',team:'CIN'},'c':{player_id:'c',name:'Chase',pos:'WR',team:'CIN'}};
const idx={'b':app.normalizeSleeperRow({player_id:'b',team:'CIN',position:'QB',stats:{pass_yd:4500,pass_att:600,pass_cmp:430,pass_td:35,gp:17}}),
  'c':app.normalizeSleeperRow({player_id:'c',team:'CIN',position:'WR',stats:{rec:120,rec_yd:1600,rec_td:14,rec_tgt:170,gp:17}})};
app.setProj(app.assembleSeed(players,idx,true));
// Sleeper roster has Erick All (TE) with no stats
app.setSleeper({b:{player_id:'b',name:'Burrow',pos:'QB',team:'CIN'},c:{player_id:'c',name:'Chase',pos:'WR',team:'CIN'},
  eall:{player_id:'eall',name:'Erick All',pos:'TE',team:'CIN'}});
app.selectTeam('CIN');
const st=app.getProj()['CIN'];
const names=st.passing_shares.map(p=>p.name);
console.log('Receiving options:', names.join(', '));
console.log('RESULT:', names.includes('Erick All')?'PASS (zero-stat player included)':'FAIL');

console.log('\n=== TEST 3: vacated sorted by targets desc ===');
const proj={CIN:{QB:[{player_id:'b',name:'Burrow',pos:'QB',team:'CIN',passing_yards:4800,games:17}],WR:[{player_id:'c',name:'Chase',pos:'WR',team:'CIN',receiving_targets:170,receptions:120,receiving_yards:1600,receiving_tds:14}],RB:[],TE:[]}};
['ATL','BUF','CHI','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS','ARI','BAL','CAR'].forEach(t=>proj[t]={QB:[],RB:[],WR:[],TE:[]});
app.setProj(proj);
const ref={CIN:{QB:[],WR:[
  {player_id:'small',name:'Small Guy',pos:'WR',team:'CIN',receiving_targets:30,receptions:20,receiving_yards:200,receiving_tds:1},
  {player_id:'big',name:'Big Departed',pos:'WR',team:'CIN',receiving_targets:140,receptions:95,receiving_yards:1200,receiving_tds:9}
],RB:[],TE:[]}};
['ATL','BUF','CHI','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS','ARI','BAL','CAR'].forEach(t=>ref[t]={QB:[],RB:[],WR:[],TE:[]});
app.setRefCache('2024',ref);
app.setSleeper({c:{team:'CIN'},b:{team:'CIN'},small:{team:'FA'},big:{team:'FA'}});
const vac=app.vacatedProduction('CIN');
console.log('Vacated order:', vac.players.join(', '));
console.log('RESULT:', vac.players[0]==='Big Departed'?'PASS (most-targeted first)':'FAIL');

console.log('\n=== TEST 4: target reconcile to att×rate ===');
app.setProj(app.assembleSeed(players,idx,true));
app.selectTeam('CIN');
const st2=app.getProj()['CIN'];
const before=app.teamTargetPool(st2);
const expect=Math.round(app.teamPassAtt(st2)*0.95);
console.log('Pool before:', before, '| expected (att×0.95):', expect);
app.reconcileTargets('CIN');
const after=app.teamTargetPool(st2);
console.log('Pool after reconcile:', after);
console.log('RESULT:', Math.abs(after-expect)<=2?'PASS (targets reconciled)':'FAIL');
