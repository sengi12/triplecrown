const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},value:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){}}),body:{}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  renderTeamAdditions, tabBar, fmtMillions,
  setAdd:(a)=>{ADDITIONS=a;}, setNames:(n)=>{TEAM_NAMES=n;}, setTeam:(t)=>{currentTeam=t;} };`)();

// Real parsed Bengals additions (from the pull output)
const ADD={CIN:{
  free_agents:[
    {player:'Boye Mafe',pos:'OLB',years:3,value_m:60.0,aav_m:20.0,signed:'Mar 09, 2026'},
    {player:'Bryan Cook',pos:'S',years:3,value_m:40.25,aav_m:13.42,signed:'Mar 10, 2026'},
    {player:'Jonathan Allen',pos:'DT',years:2,value_m:25.0,aav_m:12.5,signed:'Mar 11, 2026'},
  ],
  draft:[
    {player:'Cashius Howell',pos:'ED',years:4,value_m:12.01,aav_m:3.0,signed:'Jun 09, 2026'},
    {player:'Tacario Davis',pos:'CB',years:4,value_m:7.24,aav_m:1.81,signed:'Jun 10, 2026'},
  ],
  trades:[
    {player:'Dexter Lawrence',pos:'DT',cap_m:20.0,date:'Apr 18, 2026',detail:'Traded to Cincinnati (CIN) from New York (NYG) for a 2026 1st round pick'},
  ],
}};

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
app.setAdd(ADD); app.setNames({CIN:'Cincinnati Bengals'});

console.log('=== TEST 1: tab appears only when team has additions ===');
app.setTeam('CIN'); chk(app.tabBar().includes('Roster'),'CIN shows Roster Changes tab');
app.setTeam('DAL'); chk(!app.tabBar().includes('Roster'),'DAL (no data) hides tab');
app.setTeam(null); chk(!app.tabBar().includes('Roster'),'no team → no tab');

console.log('\n=== TEST 2: money formatting ===');
chk(app.fmtMillions(60.0)==='$60M','60.0 → $60M');
chk(app.fmtMillions(40.25)==='$40.25M','40.25 → $40.25M');
chk(app.fmtMillions(null)==='—','null → —');

console.log('\n=== TEST 3: renders all three categories ===');
app.setTeam('CIN');
const html=app.renderTeamAdditions('CIN');
chk(html.includes('Free Agency'),'Free Agency section');
chk(html.includes('Draft'),'Draft section');
chk(html.includes('Trades'),'Trades section');
chk(html.includes('Cincinnati Bengals'),'full team name in note');

console.log('\n=== TEST 4: check-players in right categories ===');
const faIdx=html.indexOf('Free Agency'), drIdx=html.indexOf('Draft'), trIdx=html.indexOf('Trades');
const faSec=html.slice(faIdx,drIdx), drSec=html.slice(drIdx,trIdx), trSec=html.slice(trIdx);
chk(faSec.includes('Boye Mafe')&&faSec.includes('$60M'),'Mafe in Free Agency at $60M');
chk(drSec.includes('Cashius Howell'),'Howell in Draft');
chk(trSec.includes('Dexter Lawrence')&&trSec.includes('$20M'),'Lawrence in Trades at $20M cap');
chk(trSec.includes('Traded to Cincinnati'),'trade detail shown');

console.log('\n=== TEST 5: FA sorted by value (Mafe > Cook > Allen) ===');
const mafeI=faSec.indexOf('Mafe'),cookI=faSec.indexOf('Cook'),allenI=faSec.indexOf('Allen');
chk(mafeI<cookI&&cookI<allenI,'FA sorted by descending value');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
