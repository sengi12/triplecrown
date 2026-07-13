const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={};}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  renderTeamAdvanced, renderSharpLeague, setPhase, tabBar,
  setNflverse:(n)=>{NFLVERSE=n;}, setSharpSeasonVar:(y)=>{SHARP_SEASON=y;},
  setTeam:(t)=>{currentTeam=t;}, setPhaseVar:(p)=>{currentPhase=p;},
  getPhase:()=>currentPhase, getContent:()=>document.getElementById('content').innerHTML };
`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== Edge 1: empty SHARP → per-team view shows helpful empty state ===');
app.setNflverse({});
const h=app.renderTeamAdvanced('CIN');
chk(h.includes('No advanced stats loaded'),'empty per-team state');
chk(h.includes('build_seed.py'),'tells user how to populate');

console.log('\n=== Edge 2: team missing from a table → graceful per-card note ===');
app.setSharpSeasonVar(2024);
app.setNflverse({'2024':{team:{offense:{columns:['EPA/Play'],teams:{LAR:{values:{'EPA/Play':0.1},ranks:{'EPA/Play':1}}}}}}});
const h2=app.renderTeamAdvanced('CIN');  // CIN not in this table
chk(h2.includes('No data for CIN'),'per-card missing-team note');

console.log('\n=== Edge 3: Advanced tab with no current team → routes to league-wide ===');
app.setNflverse({'2024':{team:{offense:{columns:['EPA/Play'],teams:{LAR:{values:{'EPA/Play':0.1},ranks:{'EPA/Play':1}}}}}}});
app.setTeam(null);
app.setPhase('Advanced');
chk(app.getPhase()==='AdvancedLeague','falls back to league-wide when no team selected');

console.log('\n=== Edge 4: empty SHARP → league-wide view shows empty state, no crash ===');
app.setNflverse({});
app.setPhaseVar('AdvancedLeague');
app.renderSharpLeague();
chk(app.getContent().includes('No advanced stats loaded'),'league-wide empty state');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
