// While games are being played, the Live view keeps up: the season aggregate refreshes
// every minute (Sleeper's endpoint updates play by play) instead of every five, the Live
// tab wears a pulsing dot with "updated 4:32 PM", and the repaint keeps the scroll.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){},classList:{add(){},remove(){}}}),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){},visibilityState:'visible'};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),innerWidth:1200,scrollTo(){},scrollX:0,scrollY:0};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));global.requestAnimationFrame=(f)=>setTimeout(f,0);
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  let fetches=0; sleeperFetch=async(url)=>{ if(/scoreboard/.test(url)) throw new Error('no board here'); if(/stats\\/nfl\\/2026\\?/.test(url)){ fetches++; return [{player_id:'1',team:'SEA',position:'QB',player:{first_name:'Sam',last_name:'Darnold'},stats:{pass_yd:200,gp:1}}]; } throw new Error('x'); };
  hasSeasonStarted=()=>true; TC_SEASON.year=2026; TC_SEASON.phase='regular'; TC_SEASON.week=1; activeSeason='2026';
  return { setBoard:(live,age)=>{ _tcBoard={season:'2026',week:1,at:Date.now()-(age||0),teams:{SEA:{state:live?'in':'post',rec:'1-0'}},busy:false,live:!!live}; },
    gamesLive:tcGamesLive, ttl:liveSeasonTtl, refresh:refreshLiveSeasonStats, fetches:()=>fetches, at:()=>_liveSeasonAt, setAt:(v)=>{ _liveSeasonAt=v; _liveSeasonWeek=completedWeeks(); },
    tabs:()=>{ renderSeasonTabs(); return document.getElementById('seasonTabs').innerHTML; }, updated:tcLiveUpdatedText };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
(async()=>{
  console.log('=== the cadence follows the board ===');
  app.setBoard(false);
  chk(app.gamesLive()===false && app.ttl()===5*60*1000, 'no game on: the five-minute TTL');
  app.setBoard(true);
  chk(app.gamesLive()===true && app.ttl()===50*1000, 'a game in progress: refresh every minute');
  app.setBoard(true, 11*60*1000);
  chk(app.gamesLive()===false, 'a stale board (older than 10 min) is not trusted as "games on"');

  console.log('=== the refresh honours it ===');
  app.setBoard(true);
  app.setAt(Date.now()-2*60*1000);           // fetched two minutes ago
  const f0=app.fetches();
  const r=await app.refresh();
  chk(r===true && app.fetches()===f0+1, 'two minutes old during a game → refetched (would have waited under the five-minute TTL)');
  app.setAt(Date.now()-20*1000);
  chk((await app.refresh())===false && app.fetches()===f0+1, 'twenty seconds old → not yet');
  app.setBoard(false); app.setAt(Date.now()-2*60*1000);
  chk((await app.refresh())===false && app.fetches()===f0+1, 'no game on and two minutes old → the five-minute TTL holds');

  console.log('=== the Live tab says so ===');
  app.setBoard(true); app.setAt(Date.now());
  let h=app.tabs();
  chk(/mode-tab active live-on|mode-tab  live-on|live-on/.test(h) && /class="live-dot"/.test(h) && /games in progress · stats refresh every minute · updated /.test(h), 'a pulsing dot on the Live tab and the update time in its tooltip');
  app.setBoard(false); h=app.tabs();
  chk(!/live-dot/.test(h) && /season to date · live from Sleeper/.test(h), 'no game on: the plain Live tab');
  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
