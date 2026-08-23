// Pace view math + mode plumbing: stint summing (with the *_touchdowns → *_tds translation),
// badge thresholds, the pace index against a frozen baseline, and the rankings render cache
// key varying by mode + live epoch (so pace boards never serve stale HTML).
const store={};
global.localStorage={getItem:(k)=>store[k]!=null?store[k]:null,setItem:(k,v)=>{store[k]=String(v);},removeItem:(k)=>{delete store[k];}};
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){},matchMedia:()=>({matches:false})};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  TC_SEASON, _paceSumStints, paceBadgeCls, buildPaceIndex, paceForPlayer, paceChipHTML,
  currentProjViewMode, rankingsRenderCacheKey,
  setBaseline:(b)=>{PACE_BASELINE=b;}, setHistory:(h)=>{HISTORY=h;},
  setLiveWeek:(w)=>{_liveSeasonWeek=w;},
  setLiveDelta:(v)=>{rankLiveDelta=v;}, setActiveSeason:(s)=>{activeSeason=s;} };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== stint summing ===');
const sum=app._paceSumStints([
  {team:'LV', pos:'WR', games_played:3, stats:{receiving_yards:200, receiving_touchdowns:2, receptions:12}},
  {team:'NYJ', pos:'WR', games_played:2, stats:{receiving_yards:150, receiving_touchdowns:1, receptions:9}},
]);
chk(sum.receiving_yards===350 && sum.receiving_tds===3 && sum.games_played===5,
  'traded player sums across stints; *_touchdowns translated to *_tds');

console.log('=== badge thresholds ===');
chk(app.paceBadgeCls(0.5,2)==='pace-thin','under 3 games → thin, whatever the delta');
chk(app.paceBadgeCls(0.15,5)==='pace-ahead','+15% at 5 games → ahead');
chk(app.paceBadgeCls(-0.15,5)==='pace-behind','−15% → behind');
chk(app.paceBadgeCls(0.05,5)==='pace-on','+5% → on pace');

console.log('=== pace index vs frozen baseline ===');
app.TC_SEASON.year=2026; app.TC_SEASON.phase='regular'; app.TC_SEASON.week=5;
app.setBaseline({v:1, season:2026, frozenAt:123, frozenWeek:1, players:{
  '1':{name:'Test Receiver', team:'CIN', pos:'WR', player_id:'1',
    passing_yards:0,passing_tds:0,passing_attempts:0,passing_completions:0,interceptions_thrown:0,
    rushing_yards:0,rushing_tds:0,rushing_attempts:0,
    receiving_yards:1190,receiving_tds:7,receptions:85,receiving_targets:119,fumbles_lost:0}}});
app.setHistory({'1':{'2026':[{team:'CIN',pos:'WR',games_played:4,
  stats:{receiving_yards:400,receiving_touchdowns:3,receptions:30,receiving_targets:40}}]}});
app.setLiveWeek(4);
const idx=app.buildPaceIndex();
chk(!!idx,'index builds once season started with a matching-season baseline');
const e=app.paceForPlayer('Test Receiver','WR','1');
chk(e && e.gp===4,'actuals found through HISTORY by player_id');
chk(e && Math.abs(e.pace17-(e.act/4*17))<1e-9,'pace = per-game × 17');
chk(e && e.base>0 && e.pct===(e.pace17-e.base)/e.base,'delta measured against the FROZEN baseline');
const chip=app.paceChipHTML('Test Receiver','WR','1');
chk(/pace-chip/.test(chip),'chip renders for a baselined player');
chk(app.paceChipHTML('Nobody','TE',null)==='','no chip without baseline data');

console.log('=== mode + cache key ===');
app.setActiveSeason('proj');
chk(app.currentProjViewMode()==='proj','proj mode reported');
chk(app.currentProjViewMode()!=='pace','pace is no longer a mode — it folded into Live');
app.setActiveSeason('2026');
chk(app.currentProjViewMode()==='live','current-year reference reads as live');
app.setLiveDelta(false); const k1=app.rankingsRenderCacheKey(false);
app.setLiveDelta(true);  const k2=app.rankingsRenderCacheKey(false);
chk(k1!==k2,'render cache key varies with the Δ-proj toggle');
app.setLiveWeek(5); const k3=app.rankingsRenderCacheKey(false);
chk(k2!==k3,'render cache key varies with the live epoch');
app.setLiveDelta(false); app.setActiveSeason('proj');

console.log(`\n${pass}/${total}`);
if(pass!==total) process.exit(1);
