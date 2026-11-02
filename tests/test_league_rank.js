// League-rank badges (src/js/64-pcard-rank.js): correctness + the stale-distribution
// regression. The badge distributions cache on buildPlayerList's epoch; if that epoch is
// read BEFORE buildPlayerList runs, a badge rendered right after a season switch ranks the
// new season's value against the PREVIOUS season's cached pool — which pinned every lead
// back at "1st" (a 2025 323-carry back ranked against 2026's max ~66).
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],appendChild(){},addEventListener(){},remove(){delete elStore[id];}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:(t)=>({tagName:t,style:{},className:'',id:'',innerHTML:'',appendChild(){},set onclick(f){},remove(){}}),body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.toast=()=>{};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
const code=require('fs').readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  chip: leagueRankChip, shareChip: leagueShareRankChip, teamChip: leagueTeamRankChip,
  setBPL:(fn)=>{ buildPlayerList=fn; }, setCacheList:(l)=>{ if(typeof _buildPlayerCache!=='undefined' && _buildPlayerCache) _buildPlayerCache.list=l; },
  window:_lgWindow, ensure:ensureLeagueWindowPool, pool:_lgPool,
  setView:(team,season)=>{ currentTeam=team; activeSeason=season; TC_SEASON.year=Number(season); TC_SEASON.phase='regular'; TC_SEASON.week=7; },
  setRange:(team,season,lo,hi)=>setSharedWeekRange(team,season,lo,hi), pick:(team,wk,season)=>{ setSharedWeekPicks(team,season,[wk]); setSharedWeekRange(team,season,wk,wk); },
  clearWin:(team,season)=>{ setSharedWeekRange(team,season,1,18); setSharedWeekPicks(team,season,null); },
  stubWeeks:(byWeek)=>{ sleeperFetch=async()=>{ throw new Error('no net'); }; fetchWeekStats=async(season,wk,pos)=>((byWeek[wk]||[]).filter(r=>r.position===pos)); }
};`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const ord=s=>(String(s).match(/>(\d+\w+)</)||[])[1]||null;

// A buildPlayerList stub that swaps its cached list reference when its data version changes —
// exactly what the real one does on a rebuild (_buildPlayerCache.list = a fresh array). Tests
// drive `pool`/`ver`; the only thing that can refresh the distribution cache is that identity
// changing, so a badge rendered after a swap must re-rank against the new pool.
let pool=[], ver=0, lastVer=-1;
app.setBPL(function(){ if(lastVer!==ver){ app.setCacheList(pool.slice()); lastVer=ver; } return pool.map(p=>Object.assign({},p)); });

console.log('=== raw stat ranks are distinct, not all 1st ===');
pool=[{pos:'RB',team:'A',rushing_attempts:323},{pos:'RB',team:'B',rushing_attempts:311},{pos:'RB',team:'C',rushing_attempts:309},{pos:'RB',team:'D',rushing_attempts:307}]; ver=1;
chk(ord(app.chip('RB','rushing_attempts',323,'hi'))==='1st','323 carries → 1st');
chk(ord(app.chip('RB','rushing_attempts',309,'hi'))==='3rd','309 carries → 3rd (behind 323, 311)');
chk(ord(app.chip('RB','rushing_attempts',307,'hi'))==='4th','307 carries → 4th');

console.log('=== the stale-distribution regression across a "season switch" ===');
pool=[{pos:'RB',team:'A',rushing_attempts:66},{pos:'RB',team:'B',rushing_attempts:50}]; ver=2;
chk(ord(app.chip('RB','rushing_attempts',66,'hi'))==='1st','a small (live-scale) pool primes the cache: 66 → 1st');
// Swap to a big (season-total) pool WITHOUT touching the epoch ourselves — the badge must
// still refresh, because it calls buildPlayerList first.
pool=[{pos:'RB',team:'A',rushing_attempts:323},{pos:'RB',team:'B',rushing_attempts:311},{pos:'RB',team:'C',rushing_attempts:309}]; ver=3;
chk(ord(app.chip('RB','rushing_attempts',309,'hi'))==='3rd','after the pool swaps under it, 309 → 3rd (was the "everyone 1st" bug)');

console.log('=== carry-share denominator excludes QB carries ===');
// Team A: QB 40 + RB 160 (share vs RB-only = 160/160 = 1.00). Team B: RBs 120 + 40 (0.75 / 0.25).
pool=[{pos:'QB',team:'A',rushing_attempts:40},{pos:'RB',team:'A',rushing_attempts:160},
      {pos:'RB',team:'B',rushing_attempts:120},{pos:'RB',team:'B',rushing_attempts:40}]; ver=4;
chk(ord(app.shareChip('RB','rushing_attempts',1.0,'RBs',['RB']))==='1st','a back with 100% of RB carries → 1st');
chk(ord(app.shareChip('RB','rushing_attempts',0.75,'RBs',['RB']))==='2nd','0.75 RB carry share → 2nd');

console.log('=== fewer-is-better ranks (interceptions) ===');
pool=[{pos:'QB',team:'A',interceptions_thrown:1},{pos:'QB',team:'B',interceptions_thrown:5},{pos:'QB',team:'C',interceptions_thrown:9}]; ver=5;
chk(ord(app.chip('QB','interceptions_thrown',1,'lo'))==='1st','1 INT → 1st (fewer is better)');
chk(ord(app.chip('QB','interceptions_thrown',9,'lo'))==='3rd','9 INT → 3rd');

(async()=>{
console.log('=== a week filter ranks against the league over the SAME weeks ===');
// the season pool says a 14-carry back is last; the window pool (weeks 2–3) says he is 2nd of 3
pool=[{pos:'RB',team:'NYG',rushing_attempts:81},{pos:'RB',team:'A',rushing_attempts:140},{pos:'RB',team:'B',rushing_attempts:120},{pos:'RB',team:'C',rushing_attempts:100}]; ver=6;
const R=(id,team,pos,att,yd)=>({player_id:id, team, position:pos, player:{first_name:'P',last_name:id}, stats:{rush_att:att, rush_yd:yd, gp:1}});
app.stubWeeks({ 2:[R('g','NYG','RB',8,30), R('a','A','RB',20,90), R('b','B','RB',6,20), R('q','A','QB',3,10)],
                3:[R('g','NYG','RB',6,24), R('a','A','RB',18,70), R('b','B','RB',5,15)] });
app.setView('NYG','2026');
chk(app.window()===null, 'no filter: no window, the season pool as before');
chk(ord(app.chip('RB','rushing_attempts',14,'hi'))==='5th', 'against the season pool, 14 carries reads last (5th of 4 backs) — the bug');
app.setRange('NYG','2026',2,3);
const w=app.window();
chk(w && w.season==='2026' && w.weeks.join()==='2,3' && w.key==='2026:2,3', 'weeks 2–3 on the team in view is the window');
chk(app.pool().length===0 && app.chip('RB','rushing_attempts',14,'hi')==='', 'before the window pool lands the chips are blank, never ranked against the season');
const wp=await app.ensure('2026',[2,3]);
chk(Array.isArray(wp) && wp.length===4 && wp.find(x=>x.player_id==='g').rushing_attempts===14 && wp.find(x=>x.player_id==='a').rushing_attempts===38 && wp.find(x=>x.player_id==='q').pos==='QB', 'the window pool sums every skill player’s Sleeper week rows over weeks 2 and 3 (NYG back 8+6=14, A 20+18=38, the QB kept)');
chk(ord(app.chip('RB','rushing_attempts',14,'hi'))==='2nd', 'now 14 carries ranks 2nd of the 3 backs over those weeks');
chk(ord(app.teamChip(['RB'],'rushing_attempts',14,'hi'))==='2nd', 'the team total ranks against the other teams’ RB carries over the same weeks (38, 14, 11)');
chk(ord(app.shareChip('RB','rushing_attempts',1.0,'RBs',['RB']))==='1st', 'a share ranks within the window pool too');
app.pick('NYG',3,'2026');
chk(app.window().key==='2026:3' && app.chip('RB','rushing_attempts',6,'hi')==='', 'a pick is a different window: its own key, blank until its pool lands');
await app.ensure('2026',[3]);
chk(ord(app.chip('RB','rushing_attempts',6,'hi'))==='1st' || ord(app.chip('RB','rushing_attempts',6,'hi'))==='2nd', `week 3 alone ranks 6 carries among 18, 6, 5 (${ord(app.chip('RB','rushing_attempts',6,'hi'))})`);
app.clearWin('NYG','2026');
chk(app.window()===null && ord(app.chip('RB','rushing_attempts',81,'hi'))==='4th', 'the filter cleared: back to the season pool (81 of 140/120/100/81 → 4th)');
console.log('\nRESULT:', pass+'/'+total, pass===total?'ALL PASS':'SOME FAILED');
process.exit(pass===total?0:1);
})();
