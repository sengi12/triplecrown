const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={};}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  renderTeamAdvanced, renderSharpLeague, setSharpTable, sortSharpBy, tabBar, sharpRankBadge, fmtSharpVal,
  setSharp:(s)=>{SHARP=s;},
  setNflverse:(n)=>{NFLVERSE=n;},
  setAdvSourceVar:(s)=>{advSource=s;},
  setSharpSeasonVar:(y)=>{SHARP_SEASON=y;},
  setTeam:(t)=>{currentTeam=t;},
  setPhaseVar:(p)=>{currentPhase=p;},
  getContent:()=>document.getElementById('content').innerHTML,
  getSharpTable:()=>sharpTable };
`)();

// Realistic SHARP seed (2 tables, a few teams) matching build_seed's output shape
const SHARP={
  offense:{title:'Offensive Metrics',columns:['EPA/Play','Yards Per Play','Points Per Drive'],teams:{
    LAR:{values:{'EPA/Play':0.13,'Yards Per Play':6.2,'Points Per Drive':2.8},ranks:{'EPA/Play':1,'Yards Per Play':1,'Points Per Drive':1}},
    CIN:{values:{'EPA/Play':0.0,'Yards Per Play':5.3,'Points Per Drive':2.2},ranks:{'EPA/Play':16,'Yards Per Play':14,'Points Per Drive':18}},
    CLE:{values:{'EPA/Play':-0.19,'Yards Per Play':4.3,'Points Per Drive':1.3},ranks:{'EPA/Play':32,'Yards Per Play':31,'Points Per Drive':30}},
  }},
  pace:{title:'Pace',columns:['Sec/Play','Off Plays/G'],teams:{
    LAR:{values:{'Sec/Play':28.1,'Off Plays/G':64},ranks:{'Sec/Play':20,'Off Plays/G':10}},
    CIN:{values:{'Sec/Play':26.5,'Off Plays/G':67},ranks:{'Sec/Play':8,'Off Plays/G':4}},
    CLE:{values:{'Sec/Play':30.2,'Off Plays/G':60},ranks:{'Sec/Play':30,'Off Plays/G':28}},
  }},
};

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== TEST 1: tab bar includes Advanced when SHARP present ===');
app.setSharp(SHARP);
chk(app.tabBar().includes('Advanced Stats'),'Advanced Stats tab shown');
app.setSharp({});
chk(!app.tabBar().includes('Advanced Stats'),'Advanced Stats tab hidden when no data');

console.log('\n=== TEST 2: per-team advanced card ===');
app.setSharp(SHARP);
const teamHtml=app.renderTeamAdvanced('CIN');
chk(teamHtml.includes('Offensive Metrics'),'shows Offensive Metrics card');
chk(teamHtml.includes('Pace'),'shows Pace card');
chk(teamHtml.includes('EPA/Play'),'shows stat labels');
chk(teamHtml.includes('16th')||teamHtml.includes('16'),'shows CIN EPA rank (16)');
chk(teamHtml.includes('View league-wide'),'has league-wide toggle button');

console.log('\n=== TEST 3: rank badge suffixes ===');
chk(app.sharpRankBadge(1).includes('1st'),'rank 1 → 1st');
chk(app.sharpRankBadge(2).includes('2nd'),'rank 2 → 2nd');
chk(app.sharpRankBadge(3).includes('3rd'),'rank 3 → 3rd');
chk(app.sharpRankBadge(11).includes('11th'),'rank 11 → 11th');
chk(app.sharpRankBadge(22).includes('22nd'),'rank 22 → 22nd');

console.log('\n=== TEST 4: league-wide table renders + sorts ===');
app.setSharp(SHARP);
app.setPhaseVar('AdvancedLeague');
app.renderSharpLeague();
let html=app.getContent();
chk(html.includes('League-Wide'),'league-wide header');
chk(app.getSharpTable()==='offense','defaults to first table');
chk(html.includes('sr-league-table'),'renders the table');
// Rows should default-sort by first column rank (best first): LAR(1) before CIN(16) before CLE(32)
const iLAR=html.indexOf('>LAR<'), iCIN=html.indexOf('>CIN<'), iCLE=html.indexOf('>CLE<');
chk(iLAR<iCIN && iCIN<iCLE,'default sort = best-first by first column (LAR<CIN<CLE)');

console.log('\n=== TEST 5: switching tables + sorting by a column ===');
app.setSharpTable('pace');
chk(app.getSharpTable()==='pace','switched to pace table');
html=app.getContent();
chk(html.includes('Sec/Play'),'pace columns shown');
// Sort by Off Plays/G — CIN rank 4 best, so CIN first
app.sortSharpBy('Off Plays/G');
html=app.getContent();
const j_CIN=html.indexOf('>CIN<'), j_LAR=html.indexOf('>LAR<'), j_CLE=html.indexOf('>CLE<');
chk(j_CIN<j_LAR && j_LAR<j_CLE,'sorted by Off Plays/G rank (CIN<LAR<CLE)');

console.log('\n=== TEST 6: per-team curated/nflverse source toggle ===');
app.setSharp(SHARP);
app.setSharpSeasonVar(2024);
app.setNflverse({'2024':{team:{
  tendencies:{columns:['Motion Rate'],teams:{CIN:{values:{'Motion Rate':50.1},ranks:{'Motion Rate':5}}}},
}}});
app.setAdvSourceVar('scraped');
let t6=app.renderTeamAdvanced('CIN');
chk(t6.includes("setAdvSource('nflverse')"),'team view shows curated/nflverse toggle when nflverse data present');
chk(t6.includes('Offensive Metrics'),'curated source still shows Sharp tables');
app.setAdvSourceVar('nflverse');
t6=app.renderTeamAdvanced('CIN');
chk(t6.includes('Motion Rate'),'toggling to nflverse swaps in nflverse team tables');
app.setAdvSourceVar('scraped');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
