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
  setBPL:(fn)=>{ buildPlayerList=fn; }, setCacheList:(l)=>{ if(typeof _buildPlayerCache!=='undefined' && _buildPlayerCache) _buildPlayerCache.list=l; }
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

console.log('\nRESULT:', pass+'/'+total, pass===total?'ALL PASS':'SOME FAILED');
process.exit(pass===total?0:1);
