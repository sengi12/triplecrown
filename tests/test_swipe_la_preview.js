// Swipe seam for the League Analyzer: tsTabPhase parses BOTH setPhase and laSetTab, the
// preview whitelist opens for LA tabs (before the currentTeam guard), previews are strictly
// cache-only for the in-season tabs (cold data → '' — never a fetch from a gesture), and
// the per-gesture preview cache keys League entries on the snapshot.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){},visibilityState:'visible'};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){}};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};
let fetchCount=0;
global.fetch=()=>{ fetchCount++; return Promise.reject(new Error('no net')); };
global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  TC_SEASON, tsTabPhase, tsCanPreviewPhase, tsRenderPhasePreview, laState, TS_AXIS_RATIO,
  setSnapshot:(s)=>{leagueSnapshot=s;}, setPhaseVar:(p)=>{currentPhase=p;},
  setTeam:(t)=>{currentTeam=t;},
  setSleeperFetch:(f)=>{sleeperFetch=f;} };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== tsTabPhase parses both tab flavors ===');
const btn=(oc)=>({getAttribute:()=>oc});
chk(app.tsTabPhase(btn("setPhase('Passing')"))==='Passing','builder tabs still parse');
chk(app.tsTabPhase(btn("laSetTab('dvp')"))==='dvp','League Analyzer tabs parse');
chk(app.tsTabPhase(btn("somethingElse('x')"))===null,'unknown onclick → null');

console.log('=== preview whitelist ===');
app.setPhaseVar('League'); app.setTeam(null);
app.setSnapshot(null);
chk(app.tsCanPreviewPhase('myteam')===false,'no snapshot → no LA preview');
app.setSnapshot({provider:'sleeper', leagueId:'L9', season:'2026', myUserId:'u1',
  rosterPositions:['QB','BN'], teamList:[{rosterId:1, ownerId:'u1', teamName:'Me', players:[]}]});
chk(app.tsCanPreviewPhase('myteam')===true,'LA preview allowed with a snapshot and NO currentTeam');
chk(app.tsCanPreviewPhase('matchup')===true,'in-season keys whitelisted');
chk(app.tsCanPreviewPhase('Passing')===false,'builder phases not previewable from the League view');
app.setPhaseVar('Passing');
chk(app.tsCanPreviewPhase('Passing')===false,'outside League: currentTeam guard still applies');

console.log('=== cache-only previews (no fetches from a gesture) ===');
app.setPhaseVar('League');
app.TC_SEASON.year=2026; app.TC_SEASON.phase='regular'; app.TC_SEASON.week=2;
app.setSleeperFetch(async()=>{ fetchCount++; throw new Error('no net'); });
const before=fetchCount;
chk(app.tsRenderPhasePreview('matchup')==='','cold matchup preview → blank underlay');
chk(app.tsRenderPhasePreview('lineup')==='','cold lineup preview → blank underlay');
chk(app.tsRenderPhasePreview('dvp')==='','cold dvp preview → blank underlay');
chk(app.tsRenderPhasePreview('trends')==='','cold trends preview → blank underlay');
chk(fetchCount===before,'no network calls issued from the preview path');


console.log('=== every in-season pane and the Multi-League hub swipe with a preview ===');
app.setSnapshot({teamList:[]});
chk(['chop','standings','hub'].every(k=>app.tsCanPreviewPhase(k)===true), 'Chop, Standings and Multi-League are previewable panes');

console.log('=== the axis lock is forgiving of a scroll that drifts sideways a little ===');
// A long flick down a tall page (Advanced's stat cards run tallest) drifts a few px
// sideways; the swipe must not claim it as a tab change and eat the scroll.
const isHorizontal=(dx,dy)=>Math.abs(dx) > Math.abs(dy)*app.TS_AXIS_RATIO;
chk(!isHorizontal(11,10),'11px sideways against 10px down still reads as a scroll, not a swipe');
chk(isHorizontal(30,10),'a genuinely horizontal drag still claims the gesture');

console.log(`\n${pass}/${total}`);
if(pass!==total) process.exit(1);
