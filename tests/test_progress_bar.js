// Owner pills everywhere a player name appears once a league is synced:
//   projections (passing / receiving / rushing rows), the rankings table (OWNER column) and
//   the search bar (pill on the right of the row, next to the name). Nothing at all when no
//   league is linked.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},textContent:'',value:'',dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},children:[],appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),matchMedia:()=>({matches:false})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
global.AbortController=class{constructor(){this.signal={};}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){}; saveSession=function(){};
  return {
  assembleSeed, normalizeSleeperRow, setSEED:(s)=>{SEED=s;seasonStatsCache.proj=s;projSeed=s;},
  ensureTeam, initPassingShares, initRushingShares, renderSidebar, buildPlayerList,
  selectTeam:t=>{currentTeam=t;ensureTeam(t);}, setPlayers:(p)=>{sleeperPlayers=p;},
  slide:(team,key,val)=>handleSliderKey(key,val,team,true),
  progress:()=>document.getElementById('progressText').textContent,
  dots:()=>{ const h=document.getElementById('sidebar').innerHTML; return {done:(h.match(/team-dot done/g)||[]).length, partial:(h.match(/team-dot partial/g)||[]).length}; },
  viewReference:()=>{ referenceProj={}; userProj=referenceProj; activeSeason='2025'; },
  viewWorking:()=>{ userProj=workingProj; activeSeason='proj'; },
  undo:(t)=>undoTeam(t), pushUndo:(t)=>pushUndo(t), teamEdited,
  importOne:(team)=>{ ensureTeam(team); userProj[team].edited=true; },
};`)();
// The sidebar needs a 'progressText'/'progressFill'/'sidebar' element — mkEl fakes any id.

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const players={}, idx={};
const TM=['KC','DET','BUF','PHI'];
TM.forEach((t,i)=>{
  players[`qb${i}`]={player_id:`qb${i}`,name:`QB ${t}`,pos:'QB',team:t};
  players[`wr${i}`]={player_id:`wr${i}`,name:`WR ${t}`,pos:'WR',team:t};
  players[`rb${i}`]={player_id:`rb${i}`,name:`RB ${t}`,pos:'RB',team:t};
  idx[`qb${i}`]=app.normalizeSleeperRow({player_id:`qb${i}`,team:t,position:'QB',stats:{pass_yd:4000,pass_att:550,pass_td:30,gp:17}});
  idx[`wr${i}`]=app.normalizeSleeperRow({player_id:`wr${i}`,team:t,position:'WR',stats:{rec:80,rec_tgt:120,rec_yd:1100,rec_td:8,gp:17}});
  idx[`rb${i}`]=app.normalizeSleeperRow({player_id:`rb${i}`,team:t,position:'RB',stats:{rush_att:240,rush_yd:1050,rush_td:7,gp:17}});
});
app.setPlayers(players);
app.setSEED(app.assembleSeed(players,idx));

console.log('=== progress counts EDITED teams, not materialised ones ===');
app.renderSidebar();
chk(app.progress()==='0/32 teams','fresh session: 0/32');
app.selectTeam('KC'); app.initPassingShares('KC'); app.initRushingShares('KC'); app.renderSidebar();
chk(app.progress()==='0/32 teams' && app.dots().partial===1,'opening every tab of a team: still 0/32, team dot is "partial" (was: counted as done)');
app.buildPlayerList(); app.renderSidebar();
chk(app.progress()==='0/32 teams','opening Rankings (materialises all 32) does not move the bar (was: jumped to 32/32)');
app.slide('KC','passing_yards',4500); app.renderSidebar();
chk(app.progress()==='1/32 teams' && app.dots().done===1,'one slider edit on KC → 1/32, KC dot is done');
chk(app.teamEdited('KC') && !app.teamEdited('DET'),'only the edited team is flagged');

console.log('=== the bar is about the WORKING set ===');
app.viewReference(); app.renderSidebar();
chk(app.progress()==='1/32 teams','viewing a reference season: count unchanged (was: dropped to the reference\'s materialised teams)');
app.slide('KC','passing_yards',1);   // userProj is the reference now; there is no KC state there
app.viewWorking(); app.renderSidebar();
chk(app.progress()==='1/32 teams','touching a reference season never flags a working team');

console.log('=== undo and import ===');
app.pushUndo('DET'); app.selectTeam('DET'); app.slide('DET','passing_yards',4200); app.renderSidebar();
chk(app.progress()==='2/32 teams','second team edited → 2/32');
app.undo('DET'); app.renderSidebar();
chk(app.progress()==='1/32 teams','undoing DET back to "never touched" → 1/32');
app.importOne('BUF'); app.renderSidebar();
chk(app.progress()==='2/32 teams','an imported projection counts as worked-on');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
