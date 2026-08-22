// Progress bar + team dots re-baseline on a Projections Manager load.
//   default:  edits are counted against the Sleeper seed (file import flags every team).
//   baseline: after setProjBaseline(name) (what tcLoadProjection calls) every team starts
//             clean and only teams changed SINCE the load light up; the bar reads "vs saved".
//   Reset All / refresh / a fresh file import drop the baseline again.
const elStore={};
function mkEl(id){ global.__mkEl=mkEl;if(!elStore[id])elStore[id]={id,remove(){},innerHTML:'',style:{},textContent:'',value:'',title:'',dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},children:[],appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),matchMedia:()=>({matches:false})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
global.AbortController=class{constructor(){this.signal={};}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
let stored=null;
const app=new Function('mkEl',code+`
  toast=function(){};
  return {
  assembleSeed, normalizeSleeperRow, setSEED:(s)=>{SEED=s;seasonStatsCache.proj=s;projSeed=s;},
  ensureTeam, renderSidebar, setPlayers:(p)=>{sleeperPlayers=p;},
  slide:(team,key,val)=>handleSliderKey(key,val,team,true),
  progress:()=>document.getElementById('progressText').textContent,
  progressTitle:()=>document.getElementById('progressText').title,
  sidebarHtml:()=>document.getElementById('sidebar').innerHTML,
  dots:()=>{ const h=document.getElementById('sidebar').innerHTML; return (h.match(/team-dot done/g)||[]).length; },
  teamEdited, setProjBaseline, clearProjBaseline, projBaselineActive,
  baseline:()=>projBaseline,
  importAll:(teams)=>{ teams.forEach(t=>{ ensureTeam(t); userProj[t].edited=true; }); importedSnapshot=deepCopy(userProj); projBaseline=null; },
  mobile:(on)=>{ window.matchMedia=()=>({matches:!!on}); },
  select:(t)=>{ currentTeam=t; ensureTeam(t); },
  undo:(t)=>undoTeam(t), pushUndo:(t)=>pushUndo(t),
  // session round-trip (saveSession is debounced; drive the same payload shape directly)
  snapshot:()=>JSON.parse(JSON.stringify({v:2,season:PROJ_SEASON,workingProj,projBaseline,playerNotes:{},scoringSettings,rankFormat})),
  restoreFrom:(p)=>{ global.localStorage={getItem:()=>JSON.stringify(p),setItem(){},removeItem(){}}; projBaseline=null; workingProj={}; userProj=workingProj; return restoreSession(); },
  resetLike:()=>{ userProj={}; workingProj=userProj; importedSnapshot=null; projBaseline=null; undoStacks={}; },
  canUndo:(t)=>canUndo(t),
  fakeCloud:(name)=>{
    _tcUser={id:'u1'};
    const rows=[]; const q=()=>({ select:()=>q(), eq:()=>q(), limit:()=>Promise.resolve({data:[],error:null}),
      update:()=>({ eq:()=>({ eq:()=>Promise.resolve({error:null}) }) }), insert:(r)=>{ rows.push(r); return Promise.resolve({error:null}); } });
    _tcClient={ from:()=>q() };
    mkEl('tcSaveName').value=name; return rows;
  },
  doSave:async()=>{ try{ await tcDoSave(); }catch(e){ return 'ERR '+e.message; } return mkEl('tcSaveErr').textContent; },
};`)(mkEl);

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

console.log('=== default mode: an import flags every team ===');
app.importAll(TM); app.renderSidebar();
chk(app.progress()==='4/32 teams' && app.dots()===4,'file import of 4 teams → 4/32 teams, 4 dots (unchanged behaviour)');
chk(!app.projBaselineActive(),'no baseline after a plain import');

console.log('=== Projections Manager load re-baselines ===');
app.setProjBaseline('My Week 1 set'); app.renderSidebar();
chk(app.projBaselineActive() && app.baseline().name==='My Week 1 set','baseline recorded with the saved set name');
chk(app.progress()==='0/32 vs saved' && app.dots()===0,'right after load: 0/32 vs saved, no dots');
chk(/My Week 1 set/.test(app.progressTitle()),'tooltip names the loaded set');
chk(TM.every(t=>!app.teamEdited(t)),'every loaded team is clean');
app.pushUndo('KC'); app.select('KC'); app.slide('KC','passing_yards',4500); app.renderSidebar();
chk(app.progress()==='1/32 vs saved' && app.dots()===1 && app.teamEdited('KC'),'one edit after load → 1/32 vs saved, KC lit');
app.undo('KC'); app.renderSidebar();
chk(app.progress()==='0/32 vs saved' && !app.teamEdited('KC'),'undoing that edit returns KC to clean (undo stack was reset at load)');
app.select('DET'); app.slide('DET','passing_yards',4100); app.select('KC'); app.slide('KC','passing_yards',4300); app.renderSidebar();
chk(app.progress()==='2/32 vs saved','two teams changed → 2/32 vs saved');

console.log('=== mobile markers ===');
app.mobile(true); app.select('KC'); app.renderSidebar();
let h=app.sidebarHtml();
chk(/team-picker-dot/.test(h),'mobile toggle shows a dot when the selected team has edits');
chk(/team-picker-count[^>]*>2</.test(h),'mobile toggle shows the edited-team count (2)');
app.select('BUF'); app.renderSidebar(); h=app.sidebarHtml();
chk(!/team-picker-dot/.test(h) && /team-picker-count[^>]*>2</.test(h),'clean selected team: no dot, count still 2');
app.mobile(false);

console.log('=== baseline survives a session round-trip with the working set ===');
const snap=app.snapshot();
app.resetLike();
chk(app.restoreFrom(snap)===true && app.projBaselineActive() && app.baseline().name==='My Week 1 set','restoreSession brings the baseline back');
app.renderSidebar();
chk(app.progress()==='2/32 vs saved','restored session keeps 2/32 vs saved');
const snapNoBase=Object.assign({},snap,{projBaseline:null});
app.resetLike(); app.restoreFrom(snapNoBase); app.renderSidebar();
chk(!app.projBaselineActive() && app.progress()==='2/32 teams','a session saved without a baseline restores to default mode');

console.log('=== reset / re-import drop the baseline ===');
app.setProjBaseline('X'); app.clearProjBaseline(); app.renderSidebar();
chk(!app.projBaselineActive() && /teams$/.test(app.progress()),'clearProjBaseline → back to "N/32 teams"');
app.setProjBaseline('X'); app.importAll(TM); app.renderSidebar();
chk(!app.projBaselineActive() && app.progress()==='4/32 teams','a fresh file import after a Manager load returns to default counting');

(async()=>{
  console.log('=== a cloud Save re-baselines to that save and keeps undo history ===');
  app.resetLike(); app.importAll(TM); app.setProjBaseline('Old load');
  app.pushUndo('KC'); app.select('KC'); app.slide('KC','passing_yards',4600);
  app.pushUndo('DET'); app.select('DET'); app.slide('DET','passing_yards',4200); app.renderSidebar();
  chk(app.progress()==='2/32 vs saved','two teams changed since the load');
  const rows=app.fakeCloud('Week 2 build');
  const saveRes=await app.doSave(); console.log('    save:',saveRes);
  app.renderSidebar();
  chk(rows.length===1 && rows[0].name==='Week 2 build','save reached the (fake) cloud');
  chk(app.baseline() && app.baseline().name==='Week 2 build','baseline is now the save name');
  chk(app.progress()==='0/32 vs saved','bar restarts at 0/32 vs saved after the save');
  chk(/Week 2 build/.test(app.progressTitle()),'tooltip names the saved set');
  chk(app.canUndo('KC') && app.canUndo('DET'),'undo history survives the save');
  app.undo('KC'); app.renderSidebar();
  chk(!app.teamEdited('KC') && app.progress()==='0/32 vs saved','undoing a pre-save edit does not re-light the team');
  app.select('DET'); app.slide('DET','passing_yards',4300); app.renderSidebar();
  chk(app.progress()==='1/32 vs saved','a new edit after the save counts against it');
  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
