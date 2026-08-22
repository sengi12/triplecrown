// Roster fills + live progress bar.
//   Camp bodies merged in from the Sleeper player DB (mergeRosterPlayers) are selectable in the
//   editors but stay OFF the rankings board and OUT of the export until someone dials them up.
//   Before: whether a team's zero-point WR/TEs appeared depended on whether its state was built
//   before or after the player DB loaded (564 players at boot, 841 after reset / import).
//   The progress bar / team dots repaint on the edit itself, not on the next team switch.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},textContent:'',value:'',title:'',dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},children:[],appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),matchMedia:()=>({matches:false})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
global.AbortController=class{constructor(){this.signal={};}abort(){}};
let rafQueue=[]; global.requestAnimationFrame=(fn)=>{ rafQueue.push(fn); return rafQueue.length; }; global.window.requestAnimationFrame=global.requestAnimationFrame;
const flushRaf=()=>{ const q=rafQueue; rafQueue=[]; q.forEach(f=>f()); };
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){}; saveSession=function(){}; renderContent=function(){};
  return {
  assembleSeed, normalizeSleeperRow, setSEED:(s)=>{SEED=s;seasonStatsCache.proj=s;projSeed=s;},
  setPlayers:(p)=>{sleeperPlayers=p; rosterMergedTeams.clear();},
  ensureTeam, initPassingShares, initRushingShares, buildPlayerList, buildOutput, loadProjections,
  getProj:()=>userProj, reset:()=>{userProj={};workingProj=userProj;invalidateBuildPlayerCache();},
  invalidate:()=>invalidateBuildPlayerCache(),
  select:(t)=>{currentTeam=t;ensureTeam(t);},
  slide:(team,key,val)=>handleSliderKey(key,val,team,true),
  pushUndo:(t)=>pushUndo(t), undo:(t)=>undoTeam(t),
  progress:()=>document.getElementById('progressText').textContent,
  renderSidebar,
};`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

// Seed: KC with a projected QB / WR / TE / RB. Sleeper DB adds two camp-body WRs and a TE.
const players={
  qb:{player_id:'qb',name:'Patrick Mahomes',pos:'QB',team:'KC'},
  wr1:{player_id:'wr1',name:'Rashee Rice',pos:'WR',team:'KC'},
  te:{player_id:'te',name:'Travis Kelce',pos:'TE',team:'KC'},
  rb1:{player_id:'rb1',name:'Isiah Pacheco',pos:'RB',team:'KC'},
};
const idx={
  qb:app.normalizeSleeperRow({player_id:'qb',team:'KC',position:'QB',stats:{pass_yd:4600,pass_att:570,pass_td:36,gp:17}}),
  wr1:app.normalizeSleeperRow({player_id:'wr1',team:'KC',position:'WR',stats:{rec:95,rec_tgt:140,rec_yd:1300,rec_td:10,gp:17}}),
  te:app.normalizeSleeperRow({player_id:'te',team:'KC',position:'TE',stats:{rec:60,rec_tgt:90,rec_yd:650,rec_td:6,gp:17}}),
  rb1:app.normalizeSleeperRow({player_id:'rb1',team:'KC',position:'RB',stats:{rush_att:250,rush_yd:1100,rush_td:8,gp:17}}),
};
app.setSEED(app.assembleSeed(players,idx));
const db=Object.assign({}, players, {
  camp1:{player_id:'camp1',name:'Camp Body One',pos:'WR',team:'KC',status:'Active',years_exp:0},
  camp2:{player_id:'camp2',name:'Camp Body Two',pos:'WR',team:'KC',status:'Active',years_exp:1},
  camp3:{player_id:'camp3',name:'Camp Tight End',pos:'TE',team:'KC',status:'Active',years_exp:0},
  camp4:{player_id:'camp4',name:'Camp Back',pos:'RB',team:'KC',status:'Active',years_exp:0},
});
Object.values(db).forEach(p=>{ p.status=p.status||'Active'; p.dcp=p.dcp||1; if(p.years_exp==null) p.years_exp=5; });

console.log('=== state built BEFORE the player DB: no fills ===');
app.reset(); app.ensureTeam('KC');
const before=app.buildPlayerList().filter(p=>p.team==='KC');
chk(before.length===4,`4 projected players on the board (${before.length})`);

console.log('=== state built AFTER the player DB: fills exist but stay off the board ===');
app.setPlayers(db); app.reset(); app.ensureTeam('KC'); app.initPassingShares('KC'); app.initRushingShares('KC');
const st=app.getProj().KC;
const fills=(st.passing_shares||[]).filter(p=>p.fill);
chk(fills.length>=1,`merged camp bodies are in passing_shares as fills (${fills.length}) — still selectable in the editor`);
chk(fills.every(p=>!(p.share>0)),'fills start at a zero share');
const after=app.buildPlayerList().filter(p=>p.team==='KC');
chk(after.length===4,`rankings still show 4 for KC, not ${4+fills.length} (got ${after.length})`);
chk(!after.some(p=>/Camp/.test(p.name)),'no camp body on the board');

console.log('=== dialing a fill up puts it on the board; back to zero takes it off ===');
const camp=fills[0]; camp.share=0.05; app.invalidate();
chk(app.buildPlayerList().some(p=>p.name===camp.name),'fill with a 5% target share appears');
camp.share=0; app.invalidate();
chk(!app.buildPlayerList().some(p=>p.name===camp.name),'back at zero it leaves the board');

console.log('=== export/import round trip keeps the pool steady ===');
const out=app.buildOutput();
chk(!out.projections.some(p=>/Camp/.test(p.name)),'untouched fills are not exported');
const n0=app.buildPlayerList().length;
app.loadProjections(out);
const n1=app.buildPlayerList().length;
chk(n1===n0,`re-import keeps the board at ${n0} (got ${n1})`);
chk((app.getProj().KC.passing_shares||[]).some(p=>p.fill),'fills are recreated from the roster on import (still selectable)');
const kc=app.buildPlayerList().find(p=>p.name==='Rashee Rice');
chk(kc && kc.receiving_targets===140,'imported starter keeps his 140 targets');

console.log('=== progress bar repaints on the edit itself ===');
app.setPlayers(null); app.reset(); app.select('KC'); app.renderSidebar();
chk(app.progress()==='0/32 teams','starts clean');
app.pushUndo('KC'); app.slide('KC','passing_yards',4900);
chk(app.progress()==='0/32 teams','synchronously unchanged (repaint is coalesced to the next frame)');
flushRaf();
chk(app.progress()==='1/32 teams','bar shows 1/32 after the frame — no team switch needed');
app.undo('KC'); flushRaf();
chk(app.progress()==='0/32 teams','undo takes the team back off the bar immediately');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
