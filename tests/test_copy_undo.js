const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  assembleSeed, normalizeSleeperRow, ensureTeam, initPassingShares, copyTeamToWorking, copyPlayerToWorking,
  canUndo, undoTeam, pushUndo,
  setProjSeed:(s)=>{SEED=s;projSeed=s;seasonStatsCache.proj=s;workingProj={};userProj=workingProj;activeSeason='proj';},
  setRefSeason:(season,seed)=>{seasonStatsCache[season]=seed;activeSeason=season;referenceProj={};userProj=referenceProj;},
  backToProj:()=>{activeSeason='proj';userProj=workingProj;},   // mirrors clicking the "Proj" season tab
  setCurrentTeam:(t)=>{currentTeam=t;},
  setSleeper:(p)=>{sleeperPlayers=p;},
  getWorkingProj:()=>workingProj, getActiveSeason:()=>activeSeason,
  getUndoStackLen:(t)=>(undoStacks[t]||[]).length };
`)();

console.log('=== SETUP: 2026 proj — Pittman is now ROSTERED on PIT (zero-stat, just traded) ===');
const proj2026={
  IND:{QB:[{player_id:'ind_qb',name:'IND QB',pos:'QB',team:'IND',passing_yards:3800,passing_attempts:520,passing_touchdowns:22,games:17}],
       WR:[{player_id:'ind_wr',name:'Other Colt WR',pos:'WR',team:'IND',receiving_targets:90,receptions:60,receiving_yards:700,receiving_tds:4,games_played:17}],RB:[],TE:[]},
  PIT:{QB:[{player_id:'pit_qb',name:'PIT QB',pos:'QB',team:'PIT',passing_yards:3600,passing_attempts:500,passing_touchdowns:20,games:17}],
       WR:[{player_id:'pittman',name:'Michael Pittman',pos:'WR',team:'PIT',receiving_targets:0,receptions:0,receiving_yards:0,receiving_tds:0,games_played:0}],RB:[],TE:[]},
};
['ATL','ARI','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','JAX','KC',
 'LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','SEA','SF','TB','TEN','WAS'].forEach(t=>proj2026[t]={QB:[],RB:[],WR:[],TE:[]});
app.setProjSeed(proj2026);
app.setSleeper({pittman:{team:'PIT'},ind_qb:{team:'IND'},ind_wr:{team:'IND'},pit_qb:{team:'PIT'}});

const ref2025={IND:{QB:[],WR:[{player_id:'pittman',name:'Michael Pittman',pos:'WR',team:'IND',receiving_targets:110,receptions:78,receiving_yards:970,receiving_tds:5,games_played:17}],RB:[],TE:[]}};
['ATL','ARI','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','JAX','KC',
 'LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS'].forEach(t=>ref2025[t]={QB:[],RB:[],WR:[],TE:[]});

console.log('\n=== TEST 1: copy Pittman from IND 2025 ref → lands on PIT working set (cross-team) ===');
app.setRefSeason('2025', ref2025);
app.setCurrentTeam('IND');  // user is VIEWING the Colts reference page
console.log('Before copy — PIT undo stack:', app.getUndoStackLen('PIT'), '| workingProj.PIT exists:', !!app.getWorkingProj()['PIT']);
app.copyPlayerToWorking('pittman','WR');
console.log('PIT undo stack depth right after copy (expect 1, even though we were viewing IND):', app.getUndoStackLen('PIT'));
console.log('IND undo stack depth (expect 0 — IND working set untouched):', app.getUndoStackLen('IND'));
// Now simulate the user clicking back to the "2026 Proj" tab and opening PIT (real UI flow)
app.backToProj();
app.ensureTeam('PIT'); app.initPassingShares('PIT');
const pitWorking=app.getWorkingProj()['PIT'];
const pittmanOnPit = pitWorking.passing_shares.find(p=>p.name==='Michael Pittman');
console.log('Pittman on PIT working set with real stats:', pittmanOnPit?`${pittmanOnPit.baseline_targets} tgt (expect >0)`:'MISSING');
console.log('RESULT:', app.canUndo('PIT') && !app.canUndo('IND') && pittmanOnPit && pittmanOnPit.baseline_targets>0 ? 'PASS (undo tracked on destination team, data copied correctly)' : 'FAIL');

console.log('\n=== TEST 2: undo reverts BOTH the working set AND the underlying seed roster row ===');
app.setCurrentTeam('PIT');  // realistic: undo button only ever fires for the currently-displayed team
app.undoTeam('PIT');
// undoTeam safety-rebuilds a valid state via ensureTeam (so the view doesn't crash), but the
// meaningful check is whether the SEED-level mutation (Pittman's real 2025 line) was reverted
// too — force a fresh passing_shares build and confirm Pittman is back to his pre-copy (0-stat) line.
app.initPassingShares('PIT');
const pitRebuilt = app.getWorkingProj()['PIT'];
const pittmanAfterUndo = pitRebuilt.passing_shares.find(p=>p.name==='Michael Pittman');
console.log('Pittman targets after undo+rebuild (expect 0 — reverted to pre-copy placeholder):', pittmanAfterUndo?pittmanAfterUndo.baseline_targets:'MISSING');
console.log('RESULT:', pittmanAfterUndo && pittmanAfterUndo.baseline_targets===0 ?'PASS (seed roster row fully reverted, not just working set)':'FAIL');

console.log('\n=== TEST 3: copyTeamToWorking full undo (wholesale team overwrite) ===');
app.setProjSeed(proj2026);  // reset
app.setSleeper({pittman:{team:'IND'},ind_qb:{team:'IND'},ind_wr:{team:'IND'}});  // hypothetical: Pittman still IND
app.ensureTeam('IND'); app.initPassingShares('IND');
const indBefore = app.getWorkingProj()['IND'];
const beforeWRs = indBefore.passing_shares.map(p=>p.name).sort();
console.log('IND working WRs before copy:', beforeWRs.join(', '));
app.setRefSeason('2025', ref2025);
app.setCurrentTeam('IND');
app.copyTeamToWorking('IND');   // this one DOES switch back to proj internally
app.initPassingShares('IND');
const indAfter = app.getWorkingProj()['IND'];
const afterWRs = indAfter.passing_shares.map(p=>p.name).sort();
console.log('IND working WRs after copy:', afterWRs.join(', '));
console.log('Auto-switched to proj view:', app.getActiveSeason()==='proj');
app.undoTeam('IND');
app.initPassingShares('IND');
const indRestored = app.getWorkingProj()['IND'];
const restoredWRs = indRestored.passing_shares.map(p=>p.name).sort();
console.log('IND working WRs after undo:', restoredWRs.join(', '));
console.log('RESULT:', JSON.stringify(restoredWRs)===JSON.stringify(beforeWRs)?'PASS (whole-team copy fully undone)':'FAIL');
