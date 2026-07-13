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
  setSharpSeasonVar:(y)=>{SHARP_SEASON=y;},
  setTeam:(t)=>{currentTeam=t;},
  setPhaseVar:(p)=>{currentPhase=p;},
  getContent:()=>document.getElementById('content').innerHTML,
  getSharpTable:()=>sharpTable };
`)();

const NFLV={'2024':{team:{
  offense:{title:'Offensive Metrics',category:'offense',columns:['EPA/Play','Yards Per Play','Points Per Drive'],teams:{
    LAR:{values:{'EPA/Play':0.13,'Yards Per Play':6.2,'Points Per Drive':2.8},ranks:{'EPA/Play':1,'Yards Per Play':1,'Points Per Drive':1}},
    CIN:{values:{'EPA/Play':0.0,'Yards Per Play':5.3,'Points Per Drive':2.2},ranks:{'EPA/Play':16,'Yards Per Play':14,'Points Per Drive':18}},
    CLE:{values:{'EPA/Play':-0.19,'Yards Per Play':4.3,'Points Per Drive':1.3},ranks:{'EPA/Play':32,'Yards Per Play':31,'Points Per Drive':30}},
  }},
  pace:{title:'Pace',category:'offense',columns:['Sec/Play','Off Plays/G'],teams:{
    LAR:{values:{'Sec/Play':28.1,'Off Plays/G':64},ranks:{'Sec/Play':20,'Off Plays/G':10}},
    CIN:{values:{'Sec/Play':26.5,'Off Plays/G':67},ranks:{'Sec/Play':8,'Off Plays/G':4}},
    CLE:{values:{'Sec/Play':30.2,'Off Plays/G':60},ranks:{'Sec/Play':30,'Off Plays/G':28}},
  }},
  personnel:{title:'Personnel',category:'offense',columns:['11 Personnel','12 Personnel','13 Personnel'],teams:{
    LAR:{values:{'11 Personnel':61.2,'12 Personnel':18.3,'13 Personnel':3.1},ranks:{'11 Personnel':8,'12 Personnel':16,'13 Personnel':21}},
    CIN:{values:{'11 Personnel':67.1,'12 Personnel':15.0,'13 Personnel':1.2},ranks:{'11 Personnel':4,'12 Personnel':20,'13 Personnel':30}},
    CLE:{values:{'11 Personnel':45.1,'12 Personnel':24.6,'13 Personnel':6.5},ranks:{'11 Personnel':23,'12 Personnel':7,'13 Personnel':8}},
  }},
}}};

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== TEST 1: tab bar includes Advanced when nflverse data present ===');
app.setSharpSeasonVar(2024);
app.setNflverse(NFLV);
chk(app.tabBar().includes('Advanced Stats'),'Advanced Stats tab shown');
app.setNflverse({});
chk(!app.tabBar().includes('Advanced Stats'),'Advanced Stats tab hidden when no nflverse data');

console.log('\n=== TEST 2: per-team advanced card (nflverse-only) ===');
app.setNflverse(NFLV);
const teamHtml=app.renderTeamAdvanced('CIN');
chk(teamHtml.includes('Offensive Metrics'),'shows Offensive Metrics card');
chk(teamHtml.includes('Pace'),'shows Pace card');
chk(teamHtml.includes('EPA/Play'),'shows stat labels');
chk(teamHtml.includes('16th')||teamHtml.includes('16'),'shows CIN EPA rank (16)');
chk(teamHtml.includes('nflverse (computed from play-by-play)'),'shows nflverse-only source label');
chk(!teamHtml.includes('Curated'),'does not show curated toggle text');

console.log('\n=== TEST 3: rank badge suffixes ===');
chk(app.sharpRankBadge(1).includes('1st'),'rank 1 → 1st');
chk(app.sharpRankBadge(2).includes('2nd'),'rank 2 → 2nd');
chk(app.sharpRankBadge(3).includes('3rd'),'rank 3 → 3rd');
chk(app.sharpRankBadge(11).includes('11th'),'rank 11 → 11th');
chk(app.sharpRankBadge(22).includes('22nd'),'rank 22 → 22nd');

console.log('\n=== TEST 4: league-wide table renders + sorts ===');
app.setPhaseVar('AdvancedLeague');
app.renderSharpLeague();
let html=app.getContent();
chk(html.includes('League-Wide'),'league-wide header');
chk(app.getSharpTable()==='offense','defaults to first table');
chk(html.includes('sr-league-table'),'renders the table');
const iLAR=html.indexOf('>LAR<'), iCIN=html.indexOf('>CIN<'), iCLE=html.indexOf('>CLE<');
chk(iLAR<iCIN && iCIN<iCLE,'default sort = best-first by first column (LAR<CIN<CLE)');

console.log('\n=== TEST 5: switching tables + sorting by a column ===');
app.setSharpTable('pace');
chk(app.getSharpTable()==='pace','switched to pace table');
html=app.getContent();
chk(html.includes('Sec/Play'),'pace columns shown');
app.sortSharpBy('Off Plays/G');
html=app.getContent();
const j_CIN=html.indexOf('>CIN<'), j_LAR=html.indexOf('>LAR<'), j_CLE=html.indexOf('>CLE<');
chk(j_CIN<j_LAR && j_LAR<j_CLE,'sorted by Off Plays/G rank (CIN<LAR<CLE)');

console.log('\n=== TEST 6: personnel table includes 13 personnel ===');
app.setSharpTable('personnel');
html=app.getContent();
chk(html.includes('13 Personnel'),'league table shows 13 Personnel column');
const t6=app.renderTeamAdvanced('CIN');
chk(t6.includes('13 Personnel'),'team card includes 13 Personnel stat');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
