// The week board: one ESPN scoreboard request → game state + overall record for every team.
// In the Live view the sidebar shows a dot on the logo (green = final, red = playing, none
// before kickoff or on a bye) and the record beside the name; the team header carries the
// record big and bold. Off the Live view none of it renders.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){},classList:{add(){},remove(){}}}),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),innerWidth:1200};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  const calls=[]; let reply=null;
  sleeperFetch=async(url)=>{ calls.push(url); if(!reply) throw new Error('no board'); return reply; };
  hasSeasonStarted=()=>true;
  return { parse:tcParseBoard, board:tcWeekBoard, state:tcTeamGameState, dot:tcGameDotHTML, recHTML:tcTeamRecordHTML,
    sidebar:()=>{ renderSidebar(); return document.getElementById('sidebar').innerHTML; },
    header:_thsHeaderPreviewHtml,
    setReply:(r)=>{ reply=r; }, calls, TC_SEASON, setSeason:(s)=>{ activeSeason=s; }, setTeam:(t)=>{ currentTeam=t; },
    recCache:()=>espnRecordCache, raw:()=>_tcBoard, order:tcStandingsOrder, parseRec:tcParseRecord, setStarted:(v)=>{ hasSeasonStarted=()=>v; } };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const comp=(home,away,state,detail,hs,as,hr,ar)=>({competitions:[{status:{type:{state,shortDetail:detail}},competitors:[
  {homeAway:'home',team:{abbreviation:home},score:String(hs),records:[{type:'total',summary:hr}]},
  {homeAway:'away',team:{abbreviation:away},score:String(as),records:[{type:'total',summary:ar}]}]}]});
const BOARD={events:[ comp('SEA','NE','post','Final',13,10,'1-0','0-1'), comp('LAR','SF','in','3rd 8:12',7,20,'0-0','0-0'), comp('WSH','PHI','pre','Sun 4:25 PM',0,0,'0-0','0-0') ]};

console.log('=== parsing ===');
const b=app.parse(BOARD);
chk(b.SEA.state==='post' && b.SEA.rec==='1-0' && b.SEA.opp==='NE' && b.SEA.home===true && b.SEA.score===13 && b.SEA.oppScore===10, 'a final: state, record, opponent, home, both scores');
chk(b.NE.state==='post' && b.NE.rec==='0-1' && b.NE.home===false, 'the other side of the same game');
chk(b.SF.state==='in' && b.SF.detail==='3rd 8:12', 'a game in progress carries its clock');
chk(b.WAS && b.WAS.state==='pre' && !b.WSH, 'ESPN\'s WSH is the seed\'s WAS');
chk(!b.KC, 'a team not on the board (bye) is absent');

console.log('=== the board, fetched once and shared ===');
app.TC_SEASON.year=2026; app.TC_SEASON.phase='regular'; app.TC_SEASON.week=1;
app.setSeason('2026');
app.setReply(BOARD);
let t=app.board();
const boardCalls=()=>app.calls.filter(u=>/scoreboard/.test(u)).length;
chk(t!==null && boardCalls()===1 && /week=1&dates=2026/.test(app.calls.find(u=>/scoreboard/.test(u))), 'the first look asks ESPN for this week');
(async()=>{
  await new Promise(r=>setTimeout(r,5));
  chk(app.state('SEA') && app.state('SEA').state==='post' && boardCalls()===1, 'landed: SEA is final; a second look does not refetch (TTL)');
  chk(app.raw().live===true, 'a game in progress flags the board live (45s refresh)');
  chk(app.recCache()['2026:SEA']==='1-0' && app.recCache()['2026:NE']==='0-1', 'records fill the header cache for every team on the board');

  console.log('=== the Live view ===');
  chk(/team-gs team-gs-post/.test(app.dot('SEA')) && /Final: vs NE 13–10/.test(app.dot('SEA')), 'a green dot with the final in its title');
  chk(/team-gs-in/.test(app.dot('LAR')) && /Live: vs SF 7–20 · 3rd 8:12/.test(app.dot('LAR')), 'a red dot with the live score and clock');
  chk(app.dot('WAS')==='' && app.dot('KC')==='', 'no dot before kickoff or on a bye');
  chk(/team-rec-hero" data-team="SEA"[^>]*>1-0</.test(app.recHTML('SEA','')), 'the header record span, big and bold, from the board');
  chk(/team-rec-hero" data-team="KC"[^>]*><\/span>/.test(app.recHTML('KC','')), 'a bye team keeps an empty span to be patched later');
  app.setTeam('SEA');
  const sb=app.sidebar();
  chk((sb.match(/team-gs-post/g)||[]).length===2 && (sb.match(/team-gs-in/g)||[]).length===2, 'sidebar: two finals, two live dots');
  chk(/team-rec">1-0</.test(sb) && /team-logo-wrap/.test(sb), 'the record rides the sidebar row; the logo is wrapped for the dot');
  const hd=app.header('SEA');
  chk(/team-rec-hero/.test(hd) && !/· 1-0/.test(hd), 'the swipe-preview header shows the big record and drops the small one');

  console.log('=== divisions list as the standings ===');
  const pr=app.parseRec('3-1-1');
  chk(pr.w===3 && pr.l===1 && pr.t===1 && Math.abs(pr.pct-0.7)<1e-9 && app.parseRec('')===null, 'records parse; a tie counts half');
  chk(app.order(['LAR','SF','SEA','ARI']).join(',')==='SEA,LAR,SF,ARI', 'NFC West: SEA (1-0) leads; the 0-0s and the bye keep their fixed order behind');
  chk(app.order(['BUF','NE','MIA','NYJ']).join(',')==='NE,BUF,MIA,NYJ', 'AFC East: the one known record (NE 0-1) lists first; teams whose record is still unknown keep their order below');
  chk(app.order(['KC','LAC','LV','DEN']).join(',')==='KC,LAC,LV,DEN', 'a division with no records yet keeps its fixed order');
  const sbo=app.sidebar();
  chk(sbo.indexOf('alt="SEA"')<sbo.indexOf('alt="LAR"') && sbo.indexOf('alt="NE"')<sbo.indexOf('alt="BUF"'), 'the sidebar renders in that order');

  console.log('=== off the Live view ===');
  app.setSeason('proj');
  chk(app.dot('SEA')==='' && app.recHTML('SEA','1-0')==='', 'projections: no dots, no big record');
  chk(!/team-gs/.test(app.sidebar()) && !/team-rec"/.test(app.sidebar()), 'the sidebar is untouched');
  chk(app.order(['LAR','SF','SEA','ARI']).join(',')==='SEA,LAR,SF,ARI', 'but the standings order holds on the projections tab too — it is an in-season feature, not a Live-tab one');
  app.setStarted(false);
  chk(app.order(['LAR','SF','SEA','ARI']).join(',')==='LAR,SF,SEA,ARI', 'off-season: the fixed division order');
  app.setStarted(true);
  app.setSeason('2025');
  chk(app.recHTML('SEA','14-3')==='', 'a past season keeps its small record line');

  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
