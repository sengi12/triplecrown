// Mock localStorage
const _store={};
global.localStorage={
  getItem:k=>k in _store?_store[k]:null,
  setItem:(k,v)=>{_store[k]=String(v);},
  removeItem:k=>{delete _store[k];},
};
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},value:'',dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){},focus(){},blur(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){},click(){}}),body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};global.Chart=function(){return{destroy(){},update(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.fetch=()=>Promise.reject(new Error('no net'));global.setTimeout=(fn)=>{fn();return 0;};global.clearTimeout=()=>{};

const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  saveSession, loadSession, clearSession, restoreSession, persistAvailable,
  setReady:(b)=>{_persistReady=b;}, getReady:()=>_persistReady,
  setWorking:(w)=>{workingProj=w; userProj=w;}, getWorking:()=>workingProj,
  setScoring:(s)=>{Object.assign(scoringSettings,s);}, getScoring:()=>scoringSettings,
  setFormat:(f)=>{rankFormat=f;}, getFormat:()=>rankFormat,
  setUndo:(u)=>{undoStacks=u;}, getUndo:()=>undoStacks,
  getStoreKey:()=>TC_STORE_KEY, PROJ:PROJ_SEASON,
  rawStore:()=>Object.assign({},_storeRef||{}) };
`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== persistAvailable works with mock ===');
chk(app.persistAvailable()===true,'localStorage detected');

console.log('=== save + load round-trip ===');
app.setReady(true);
app.setWorking({CIN:{qbs:[{name:"Burrow",games:17,passing_yards:4800}]}});
app.setScoring({receptions:1.0});
app.setFormat('ppr');
app.saveSession();
const loaded=app.loadSession();
chk(loaded!==null,'session saved and loads back');
chk(loaded.season===app.PROJ,'season stamped');
chk(loaded.workingProj.CIN.qbs[0].name==='Burrow','working projections saved');
chk(loaded.scoringSettings.receptions===1.0,'scoring saved');
chk(loaded.rankFormat==='ppr','format saved');

console.log('=== restore applies saved state over fresh seed ===');
app.setWorking({});         // simulate fresh seed load
app.setScoring({receptions:0.5});
app.setFormat('half_ppr');
app.setReady(false);
const didRestore=app.restoreSession();
chk(didRestore===true,'restoreSession returns true');
chk(app.getWorking().CIN.qbs[0].name==='Burrow','working set restored');
chk(app.getScoring().receptions===1.0,'scoring restored');
chk(app.getFormat()==='ppr','format restored');

console.log('=== season guard: 2025 edits do NOT restore onto 2026 seed ===');
// Manually write a session stamped with a different season
global.localStorage.setItem(app.getStoreKey(), JSON.stringify({
  v:1, season: app.PROJ-1, workingProj:{DAL:{qbs:[{name:'Old'}]}}, scoringSettings:{receptions:0.5}, rankFormat:'std'
}));
app.setWorking({}); app.setReady(false);
const r2=app.restoreSession();
chk(!app.getWorking().DAL,'stale-season working set NOT restored');
chk(app.getFormat()==='std','but format still restores (harmless)');

console.log('=== clearSession wipes it ===');
app.saveSession(); app.setReady(true); app.saveSession();
app.clearSession();
chk(app.loadSession()===null,'session cleared');

console.log('=== not-ready guard: no save before boot completes ===');
app.clearSession();
app.setReady(false);
app.setWorking({NEW:{qbs:[]}});
app.saveSession();  // should be a no-op because _persistReady=false
chk(app.loadSession()===null,'no save while _persistReady=false');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
