// League Analyzer in-season tabs: season gating of the dispatch, matchup pairing by
// matchup_id with the featured my-matchup card, ESPN empty state, and the score-poll
// gating (tab + week + phase + visibility + provider — all must hold).
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){},visibilityState:'visible'};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){}};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  TC_SEASON, laState, laTabViewHTML, laMatchupView, laLivePollSync, laMuWeek,
  getMu:()=>_laMu, setSnapshot:(s)=>{leagueSnapshot=s;}, setPhaseVar:(p)=>{currentPhase=p;},
  setSleeperFetch:(f)=>{sleeperFetch=f;} };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const SNAP={provider:'sleeper', leagueId:'L1', season:'2026', myUserId:'u1',
  rosterPositions:['QB','RB','WR','TE','FLEX','BN','BN'],
  teamList:[
    {rosterId:1, ownerId:'u1', teamName:'My Squad', wins:3, losses:1, players:[
      {id:'p1',name:'Alpha Quarterback',pos:'QB',team:'CIN'},
      {id:'p2',name:'Beta Back',pos:'RB',team:'DET'},
      {id:'p3',name:'Gamma Wideout',pos:'WR',team:'MIA'},
      {id:'p4',name:'Delta End',pos:'TE',team:'SF'},
      {id:'p5',name:'Epsilon Wideout',pos:'WR',team:'BUF'}]},
    {rosterId:2, ownerId:'u2', teamName:'Rival Club', wins:1, losses:3, players:[
      {id:'q1',name:'Zeta Quarterback',pos:'QB',team:'DAL'}]},
  ]};
app.setSnapshot(SNAP);
app.setPhaseVar('League');
app.setSleeperFetch(async()=>{ throw new Error('no net in tests'); });

console.log('=== season gating ===');
app.TC_SEASON.year=2026; app.TC_SEASON.phase='off'; app.TC_SEASON.week=0;
chk(app.laTabViewHTML('matchup', SNAP)===null,'in-season dispatch returns null pre-season (falls back to My Team)');
app.TC_SEASON.phase='regular'; app.TC_SEASON.week=2;
chk(typeof app.laTabViewHTML('lineup', SNAP)==='string','lineup renders in-season');
chk(typeof app.laTabViewHTML('dvp', SNAP)==='string','dvp renders in-season (empty state without sidecar)');
chk(typeof app.laTabViewHTML('trends', SNAP)==='string','trends renders in-season');
chk(app.laTabViewHTML('myteam', SNAP)===null,'classic tabs still dispatch through 99 (null here)');

console.log('=== matchup pairing + featured card ===');
app.getMu().byWeek[2]={fetchedAt:Date.now(), sig:'s', rows:[
  {roster_id:1, matchup_id:7, points:88.2, starters:['p1','p2','p3','p4'], starters_points:[20.4,12.2,31.5,9.1]},
  {roster_id:2, matchup_id:7, points:70.1, starters:['q1'], starters_points:[18.8]},
]};
const html=app.laMatchupView(SNAP);
chk(html.includes('MY MATCHUP'),'my matchup featured');
chk(html.includes('88.2') && html.includes('70.1'),'both totals shown');
chk(html.includes('My Squad') && html.includes('Rival Club'),'teams resolved from the snapshot');
chk(html.includes('Alpha Quarterback'),'starters listed by name');
chk((html.match(/la-mu-game/g)||[]).length===1,'scoreboard shows the one pairing');

console.log('=== ESPN empty state ===');
const espn=Object.assign({}, SNAP, {provider:'espn'});
chk(app.laMatchupView(espn).includes('ESPN leagues is coming'),'ESPN gets the explicit empty state');

console.log('=== poll gating ===');
app.laState.laTab='matchup'; app.laState.muWeek=null;
app.laLivePollSync();
chk(!!app.getMu().pollTimer,'poll starts: League + matchup tab + current week + visible + regular season');
app.laState.muWeek=1;   // viewing a past week
app.laLivePollSync();
chk(!app.getMu().pollTimer,'poll stops on a past week');
app.laState.muWeek=null; app.laLivePollSync();
chk(!!app.getMu().pollTimer,'poll resumes on the current week');
global.document.visibilityState='hidden'; app.laLivePollSync();
chk(!app.getMu().pollTimer,'poll stops when the tab is hidden');
global.document.visibilityState='visible';
app.laState.laTab='dvp'; app.laLivePollSync();
chk(!app.getMu().pollTimer,'poll stops off the matchup tab');

console.log(`\n${pass}/${total}`);
if(pass!==total) process.exit(1);
