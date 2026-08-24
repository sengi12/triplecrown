// SOS schedule strip: week-by-week opponents with Vegas win totals, difficulty buckets,
// BYE handling, the collapsed→expanded bar chart, and the logo jumps (team projections from
// the SOS surfaces, team-defense player card from the in-season DvP table).
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){},toggle(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){},matchMedia:()=>({matches:false})};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  renderTeamScheduleStrip, sosDiffCls, toggleSosStrip, tcGotoTeamProjections, laDvpView,
  setSOS:(s)=>{SOS=s;}, setSched:(m)=>{_weeklyOppBySeason=m;}, setProjSeason:(y)=>{PROJ_SEASON=y;},
  setInseason:(x)=>{TC_INSEASON=x;}, TC_SEASON,
  setPhaseVar:(p)=>{currentPhase=p;}, getPhase:()=>currentPhase, getTeam:()=>currentTeam,
  stubSelect:()=>{ selectTeam=(t)=>{ currentTeam=t; }; },
  isOpen:()=>_sosStripOpen };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== difficulty buckets ===');
chk(app.sosDiffCls(5.6)==='sos-easy','5.6 wins → easy (green)');
chk(app.sosDiffCls(8.5)==='sos-mid','8.5 → neutral');
chk(app.sosDiffCls(11.7)==='sos-hard','11.7 → hard (red)');
chk(app.sosDiffCls(null)==='sos-na','no win total → n/a');

console.log('=== strip rendering ===');
app.setProjSeason(2026);
app.setSOS({ARI:{rank:32,win_total:8.5}, KC:{win_total:11.7}, NYJ:{win_total:5.6}, SEA:{win_total:10.6}});
// Weeks 1-3 played, week 4 is the bye (absent from the map).
app.setSched({'2026':{ARI:{1:{opp:'KC',home:false}, 2:{opp:'NYJ',home:true}, 3:{opp:'SEA',home:true}}}});
const html=app.renderTeamScheduleStrip('ARI');
chk(!!html && html.includes('sos-sched-rail'),'rail renders');
chk(html.includes('11.7') && html.includes('5.6'),'opponent win totals shown');
chk(/sos-wk sos-hard[\s\S]*11\.7/.test(html),'tough opponent colored hard');
chk(/sos-wk sos-easy[\s\S]*5\.6/.test(html),'weak opponent colored easy');
chk((html.match(/sos-wk-bye/g)||[]).length>=2,'missing weeks render as BYE');
chk(html.includes('@') && html.includes('vs'),'home/away marked');
chk(html.includes("tcGotoTeamProjections('KC')"),'opponent logo jumps to that team');
chk(!html.includes('sos-sched-chart'),'collapsed by default — no bar chart');

console.log('=== expand ===');
app.toggleSosStrip();
chk(app.isOpen()===true,'toggle opens');
const open=app.renderTeamScheduleStrip('ARI');
chk(open.includes('sos-sched-chart') && open.includes('sos-bar-grid'),'expanded shows the bar chart');
chk(/sos-bar sos-hard" style="height:8[0-9]/.test(open) || /sos-bar sos-hard" style="height:\d/.test(open),'bars are height-scaled by win total');
chk(open.includes('opponent average'),'expanded footer reports the opponent average');
app.toggleSosStrip();
chk(app.isOpen()===false,'toggle closes again');

console.log('=== no schedule → nothing (never a broken block) ===');
app.setSched({});
chk(app.renderTeamScheduleStrip('ARI')==='','no schedule data → empty string');

console.log('=== logo jumps ===');
app.stubSelect();
app.setPhaseVar('AdvancedLeague');
app.tcGotoTeamProjections('SEA');
chk(app.getTeam()==='SEA','jump selects the team');
chk(app.getPhase()==='Receiving','from a league-wide view it lands on the projections tab');
app.setPhaseVar('Passing');
app.tcGotoTeamProjections('KC');
chk(app.getPhase()==='Passing','from a team view it keeps the tab you were on');

console.log('=== DvP logo opens the team defense card ===');
app.TC_SEASON.year=2026; app.TC_SEASON.phase='regular'; app.TC_SEASON.week=6;
const COLS=["tgt","rec","rec_yd","rec_td","carry","rush_yd","rush_td","pass_att","pass_yd","pass_td","pass_int"];
const row=(t,r,y,td)=>{const a=new Array(COLS.length).fill(0);a[0]=t;a[1]=r;a[2]=y;a[3]=td;return a;};
app.setInseason({v:1,season:2026,weeks:[1,2],asof:'x',schedule:{},def_vs_pos:{cols:COLS,teams:{
  CIN:{WR:{'1':row(20,12,110,1),'2':row(18,10,95,0)},QB:{},RB:{},TE:{}},
  KC:{WR:{'1':row(28,20,210,2),'2':row(26,19,200,1)},QB:{},RB:{},TE:{}}}}});
const dvp=app.laDvpView({});
chk(dvp.includes("openPlayerCard('CIN','DEF','CIN')"),'defense logo opens that team\'s DEF card');
chk((dvp.match(/la-dvp-open/g)||[]).length>=2,'both the logo and the code are clickable');

console.log(`\n${pass}/${total}`);
if(pass!==total) process.exit(1);
