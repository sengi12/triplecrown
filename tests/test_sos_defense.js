const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={};}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  renderTeamAdvanced, renderSharpLeague, setSharpCategory, setSharpTable, showSharpLeague,
  sortSOSBy, fmtSharpVal, sharpColIsPct, teamDisplayName, ordinal, tabBar,
  setSharp:(s)=>{SHARP=s;}, setSOS:(s)=>{SOS=s;}, setNames:(n)=>{TEAM_NAMES=n;},
  setTeam:(t)=>{currentTeam=t;}, setPhaseVar:(p)=>{currentPhase=p;},
  getContent:()=>document.getElementById('content').innerHTML,
  getSharpTable:()=>sharpTable, getCategory:()=>sharpCategory };
`)();

// Offense + Defense tables + SOS + names
const SHARP={
  offense:{title:'Offensive Metrics',category:'offense',pct_cols:['Explosive Play Rate'],columns:['EPA/Play','Explosive Play Rate'],teams:{
    CIN:{values:{'EPA/Play':0.1,'Explosive Play Rate':6.5},ranks:{'EPA/Play':10,'Explosive Play Rate':8}},
    CHI:{values:{'EPA/Play':-0.05,'Explosive Play Rate':5.0},ranks:{'EPA/Play':22,'Explosive Play Rate':20}},
  }},
  defensive_line:{title:'Defensive Line',category:'defense',pct_cols:['Pressure Rate'],columns:['Pressure Rate','Sacks'],teams:{
    CIN:{values:{'Pressure Rate':22.0,'Sacks':40},ranks:{'Pressure Rate':15,'Sacks':12}},
    CHI:{values:{'Pressure Rate':25.0,'Sacks':48},ranks:{'Pressure Rate':5,'Sacks':4}},
  }},
};
const SOS={
  CIN:{rank:3,win_total:9.5,name:'Cincinnati Bengals'},
  CHI:{rank:27,win_total:9.5,name:'Chicago Bears'},
  DET:{rank:1,win_total:10.5,name:'Detroit Lions'},
};
const NAMES={CIN:'Cincinnati Bengals',CHI:'Chicago Bears',DET:'Detroit Lions'};

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== TEST 1: % on rate columns, plain otherwise ===');
chk(app.fmtSharpVal(6.5,true)==='6.5%','rate value gets %');
chk(app.fmtSharpVal(40,false)==='40','non-rate value no %');
chk(app.sharpColIsPct(SHARP.defensive_line,'Pressure Rate')===true,'Pressure Rate flagged as pct');
chk(app.sharpColIsPct(SHARP.defensive_line,'Sacks')===false,'Sacks not pct');

console.log('\n=== TEST 2: full team name + ordinal ===');
app.setNames(NAMES);
chk(app.teamDisplayName('CIN')==='Cincinnati Bengals','full name lookup');
chk(app.teamDisplayName('XXX')==='XXX','falls back to code');
chk(app.ordinal(27)==='27th' && app.ordinal(1)==='1st' && app.ordinal(3)==='3rd','ordinals');

console.log('\n=== TEST 3: per-team header shows full name + SOS ===');
app.setSharp(SHARP); app.setSOS(SOS); app.setTeam('CHI'); app.setPhaseVar('QB');
// renderContent path builds the header; call renderTeamAdvanced to check SOS strip + sections
app.setNames({CIN:'Cincinnati Bengals',CHI:'Chicago Bears',DET:'Detroit Lions',DAL:'Dallas Cowboys'});
const advMissing=app.renderTeamAdvanced('DAL');
const adv=app.renderTeamAdvanced('CHI');
chk(advMissing.includes('No data for Dallas Cowboys'),'missing-team card uses full name');
chk(adv.includes('2026 Strength of Schedule'),'SOS strip present');
chk(adv.includes('27th'),'SOS rank shown as 27th');
chk(adv.includes('🏈 Offense'),'Offense section head');
chk(adv.includes('🛡️ Defense'),'Defense section head');
chk(adv.includes('%'),'percentage rendered somewhere (rate col)');

console.log('\n=== TEST 4: league-wide Offense/Defense category toggle ===');
app.setPhaseVar('AdvancedLeague'); app.setSharp(SHARP); app.setSOS(SOS);
app.setSharpCategory('offense');
let html=app.getContent();
chk(html.includes('Offensive Metrics'),'offense category shows offense table');
chk(!html.includes('Defensive Line')||html.indexOf('Defensive Line')>html.indexOf('Offensive Metrics'),'defense table not in offense tab body');
app.setSharpCategory('defense');
html=app.getContent();
chk(app.getCategory()==='defense','switched to defense');
chk(html.includes('Defensive Line'),'defense table shown');
chk(html.includes('Pressure Rate'),'defensive columns shown');
chk(html.includes('%'),'defensive rate col shows %');

console.log('\n=== TEST 5: SOS chart + table view ===');
app.showSharpLeague('sos');
html=app.getContent();
chk(app.getSharpTable()==='__sos__','SOS table selected');
chk(html.includes('sos-chart'),'SVG chart rendered');
chk(html.includes('2026 NFL Strength of Schedule'),'chart title');
chk(html.includes('sos-band-easy')&&html.includes('sos-band-hard'),'easy/hard bands');
chk(html.includes('Detroit Lions'),'SOS table shows full names');
chk(html.includes('VEGAS WIN TOTAL'),'win total column');
// Detroit rank 1 should appear before Chicago rank 27 in the table (default sort by rank)
const tb=html.slice(html.indexOf('<tbody>'));
console.log('  [dbg] tbody order:',['Detroit','Cincinnati','Chicago'].map(n=>[n,tb.indexOf(n)]).filter(x=>x[1]>=0).sort((a,b)=>a[1]-b[1]).map(x=>x[0]).join(' → '));
chk(tb.indexOf('Detroit')<tb.indexOf('Chicago'),'SOS table default-sorted by rank');

console.log('\n=== TEST 6: SOS sort by win total ===');
app.sortSOSBy('win_total');
html=app.getContent();
chk(html.includes('win_total')||html.includes('VEGAS WIN TOTAL'),'still shows table after sort');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
