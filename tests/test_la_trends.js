// Trends overhaul: team tendencies from the weekly pack (pass↔run lean + EPA heat), real
// red-zone chances feeding TD regression, the remaining-schedule multiplier behind the ROS
// outlook, injury tags from the (now-kept) Sleeper injury fields, and the Season-tab panes.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){},visibilityState:'visible'};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){}};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  TC_SEASON, laState, laActivePane, laSeasonView, laTabViewHTML,
  _laTeamTrends, _laRzOpp, _laRosSched, tcInjuryInfo, tcInjuryTag, tcInjuryAbsenceWeeks, laDvpTable,
  setNflverse:(n)=>{NFLVERSE=n;}, setInseason:(x)=>{TC_INSEASON=x;},
  setHistory:(h)=>{HISTORY=h;}, setPlayers:(p)=>{sleeperPlayers=p;},
  setSnapshot:(s)=>{leagueSnapshot=s;}, setPhaseVar:(p)=>{currentPhase=p;},
  setSleeperFetch:(f)=>{sleeperFetch=f;} };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

app.TC_SEASON.year=2026; app.TC_SEASON.phase='regular'; app.TC_SEASON.week=6;
app.setPhaseVar('League');
app.setSleeperFetch(async()=>{ throw new Error('no net'); });

console.log('=== Season tab panes ===');
const SNAP={provider:'sleeper', leagueId:'L1', season:'2026', myUserId:'u1',
  rosterPositions:['QB','BN'], teamList:[{rosterId:1, ownerId:'u1', teamName:'Me', players:[]}]};
app.setSnapshot(SNAP);
app.laState.laTab='season'; app.laState.seasonPane='dvp';
chk(app.laActivePane()==='dvp','laActivePane reads the Season pane');
app.laState.laTab='matchup';
chk(app.laActivePane()==='matchup','legacy tab keys map onto their pane');
app.laState.laTab='myteam';
chk(app.laActivePane()===null,'classic tabs report no pane');
const sv=app.laSeasonView(SNAP,'trends');
chk(sv.includes('la-pane-tabs') && sv.includes('pane-tab'),'Season view carries the icon pane bar');
chk((sv.match(/pane-tab /g)||[]).length>=4,'all four panes offered');
chk(app.laTabViewHTML('lineup',SNAP).includes('la-pane-tabs'),'legacy dispatch renders pane chrome too');

console.log('=== team tendencies from the weekly pack ===');
// 5 weeks; team AAA throws a lot more in the last 3, team BBB turns run-heavy and goes cold.
const cols=['off_pass_plays','off_run_plays','off_plays','off_epa'];
const wkRow=(p,r,epa)=>[p,r,p+r,epa];
app.setNflverse({'2026':{adv_weekly:{weeks:[1,2,3,4,5], cols, teams:{
  AAA:[wkRow(20,20,0),wkRow(20,20,0),wkRow(30,10,4),wkRow(30,10,4),wkRow(30,10,4)],
  BBB:[wkRow(25,15,2),wkRow(25,15,2),wkRow(15,25,-2),wkRow(15,25,-2),wkRow(15,25,-2)],
}}}});
const T=app._laTeamTrends();
chk(!!T && T.length===2,'trends computed for both teams');
const A=T.find(t=>t.tm==='AAA'), B=T.find(t=>t.tm==='BBB');
chk(A.dRate>0 && Math.round(A.rate3)===75,'AAA passing more (75% last 3)');
chk(B.dRate<0,'BBB leaning run');
chk(A.dEpa>0 && B.dEpa<0,'EPA heat: AAA hot, BBB cold');

console.log('=== real red-zone chances ===');
app.setHistory({'p9':{'2026':[{team:'CIN',pos:'WR',games_played:5,stats:{rec_rz_tgt:9,rush_rz_att:2,receiving_yards:400}}]}});
chk(app._laRzOpp('p9')===11,'RZ chances = rec RZ targets + rush RZ carries');
chk(app._laRzOpp('nobody')===null,'unknown player → null (not 0)');

console.log('=== remaining-schedule multiplier ===');
const COLS=["tgt","rec","rec_yd","rec_td","carry","rush_yd","rush_td","pass_att","pass_yd","pass_td","pass_int"];
const wr=(t,r,y,td)=>{ const a=new Array(COLS.length).fill(0); a[0]=t;a[1]=r;a[2]=y;a[3]=td; return a; };
app.setInseason({v:1, season:2026, weeks:[1,2], asof:'x',
  schedule:{CIN:{'6':'EASY','7':'EASY','8':'HARD'}},
  def_vs_pos:{cols:COLS, teams:{
    EASY:{WR:{'1':wr(30,24,230,2),'2':wr(28,22,210,2)}, QB:{}, RB:{}, TE:{}},
    HARD:{WR:{'1':wr(18,10,90,0),'2':wr(16,9,80,0)}, QB:{}, RB:{}, TE:{}},
  }}});
const dvp=app.laDvpTable();
const sched=app._laRosSched('CIN','WR',dvp);
chk(!!sched && sched.games===3,'covers the remaining scheduled games');
chk(sched.mult>1,'two easy matchups out of three → multiplier above 1');
chk(app._laRosSched('CIN','WR',null)===null,'no DvP table → declared degradation (null)');

console.log('=== injury knowledge book ===');
app.setPlayers({'p9':{player_id:'p9',name:'Test',pos:'QB',team:'CIN',injury_status:'IR',injury_body_part:'Foot',injury_note:'surgery on his foot'}});
const irFoot=app.tcInjuryInfo('p9');
chk(app.tcInjuryAbsenceWeeks(irFoot)>=6,'IR + foot surgery → type estimate beats the 4-week IR floor');
app.setPlayers({'p9':{player_id:'p9',name:'Test',pos:'WR',team:'CIN',injury_status:'IR',injury_body_part:'Knee',injury_note:'torn ACL'}});
chk(app.tcInjuryAbsenceWeeks(app.tcInjuryInfo('p9'))===18,'ACL → season');
app.setPlayers({'p9':{player_id:'p9',name:'Test',pos:'WR',team:'CIN',injury_status:'Questionable',injury_body_part:'Hamstring'}});
chk(app.tcInjuryAbsenceWeeks(app.tcInjuryInfo('p9'))===0,'Questionable never assumes multi-week absence');
app.setPlayers({'p9':{player_id:'p9',name:'Test',pos:'OL',team:'WAS',injury_status:'IR',injury_body_part:'Knee',injury_note:'placed on season-ending injured reserve'}});
const so=app.tcInjuryInfo('p9');
chk(so.seasonOut===true && app.tcInjuryAbsenceWeeks(so)===18,'note saying season-ending → flagged and discounted as the full year');

console.log('=== injury designations ===');
app.setPlayers({'p9':{player_id:'p9',name:'Test',pos:'WR',team:'CIN',injury_status:'Questionable',injury_note:'hamstring'}});
const info=app.tcInjuryInfo('p9');
chk(info && info.code==='Q' && info.sev==='q','Questionable → Q, amber severity');
chk(/inj-tag inj-q/.test(app.tcInjuryTag('p9')),'badge carries the severity class');
app.setPlayers({'p9':{player_id:'p9',name:'Test',pos:'WR',team:'CIN',injury_status:'IR'}});
chk(app.tcInjuryInfo('p9').sev==='o','IR → red severity');
app.setPlayers({'p9':{player_id:'p9',name:'Test',pos:'WR',team:'CIN'}});
chk(app.tcInjuryTag('p9')==='','healthy → no badge');

console.log(`\n${pass}/${total}`);
if(pass!==total) process.exit(1);
