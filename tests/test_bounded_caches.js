// ═══════════════════════════════════════════════════════════════════════════
// Caches that used to grow without bound.
//
// 1. The rankings rendered-HTML LRU was capped at 8 ENTRIES. One entry measured
//    ~1.4M chars, and V8 stores these two-byte — so eight of them was ~23MB on a
//    phone / ~60MB on desktop, duplicating what was already in the DOM. It is now
//    capped by total characters, which self-adjusts: many small phone-capped
//    boards, or one or two huge desktop ones.
//
// 2. Each decoded coaching-scheme season is ~15MB of heap and the modal shows one
//    at a time, but nothing was ever released — browsing all five permanently
//    added ~70MB. Now LRU-bounded, and trimmed to one on tab-hide.
// ═══════════════════════════════════════════════════════════════════════════

const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){},focus(){},blur(){}};return elStore[id];}
const docListeners={};
global.document={getElementById:id=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],
  createElement:()=>({style:{},appendChild(){},click(){}}),body:{appendChild(){},removeChild(){}},
  addEventListener:(ev,fn)=>{(docListeners[ev]=docListeners[ev]||[]).push(fn);},
  visibilityState:'visible'};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){},length:0,key:()=>null};
global.Chart=function(){return{destroy(){},update(){}}};
global.confirm=()=>true; global.btoa=s=>s; global.FileReader=function(){}; global.Range=function(){};
global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.fetch=()=>Promise.reject(new Error('offline in test'));

const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  rankingsRenderCacheSet, rankingsRenderCacheGet, rankingsRenderCacheBytes,
  invalidateRankingsRenderCache,
  cacheSize:()=>_rankingsRenderCache.size,
  maxChars:_RANKINGS_RENDER_CACHE_MAX_CHARS, maxEntries:_RANKINGS_RENDER_CACHE_MAX,
  setNflverse:(v)=>{NFLVERSE=v;}, getNflverse:()=>NFLVERSE,
  markCoaching:(s)=>{ (NFLVERSE[s]=NFLVERSE[s]||{}).coaching_scheme={fake:s}; _coachingSeasonLoaded[s]=true; _coachingTouch(s); },
  lru:()=>_coachingLru.slice(), keep:_COACHING_KEEP,
};`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== rankings HTML cache is bounded by size, not entry count ===');
app.invalidateRankingsRenderCache();
chk(app.rankingsRenderCacheBytes()===0, 'starts empty');

// Eight entries that are individually large: entry-count alone would keep all 8.
const big = 'x'.repeat(Math.floor(app.maxChars/3));
for(let i=0;i<8;i++) app.rankingsRenderCacheSet('big'+i, big);
chk(app.cacheSize()<8, 'large entries evict on the byte budget before hitting the entry cap (kept '+app.cacheSize()+' of 8)');
chk(app.rankingsRenderCacheBytes()<=app.maxChars, 'total held stays within the char budget ('+app.rankingsRenderCacheBytes()+' <= '+app.maxChars+')');

console.log('=== small entries still get the full entry allowance ===');
app.invalidateRankingsRenderCache();
const small='y'.repeat(1000);
for(let i=0;i<12;i++) app.rankingsRenderCacheSet('sm'+i, small);
chk(app.cacheSize()===app.maxEntries, 'entry cap still applies to small entries (kept '+app.cacheSize()+', cap '+app.maxEntries+')');
chk(app.rankingsRenderCacheGet('sm11')===small, 'the newest small entry is retrievable');
chk(app.rankingsRenderCacheGet('sm0')==='', 'the oldest was evicted');

console.log('=== accounting stays in step ===');
app.invalidateRankingsRenderCache();
chk(app.rankingsRenderCacheBytes()===0, 'invalidate resets the byte counter, not just the map');
app.rankingsRenderCacheSet('k', small);
app.rankingsRenderCacheSet('k', small+small);      // overwrite same key
chk(app.rankingsRenderCacheBytes()===small.length*2, 'overwriting a key replaces its byte count rather than double-counting');
const huge='z'.repeat(app.maxChars+10);
app.invalidateRankingsRenderCache();
app.rankingsRenderCacheSet('huge', huge);
chk(app.cacheSize()===0, 'a single render larger than the whole budget is not cached at all');

console.log('=== coaching seasons are LRU-bounded ===');
app.setNflverse({});
['2021','2022','2023','2024','2025'].forEach(s=>app.markCoaching(s));
const nv=app.getNflverse();
const held=['2021','2022','2023','2024','2025'].filter(s=>nv[s]&&nv[s].coaching_scheme);
chk(held.length===app.keep, 'only '+app.keep+' seasons stay decoded after browsing 5 (held: '+held.join(',')+')');
chk(held.includes('2025'), 'the most recently viewed season is one of them');
chk(!held.includes('2021'), 'the least recently viewed season was released');

console.log('=== hiding the tab trims to one ===');
app.markCoaching('2024');
app.markCoaching('2023');
global.document.visibilityState='hidden';
(docListeners['visibilitychange']||[]).forEach(fn=>fn());
const after=['2021','2022','2023','2024','2025'].filter(s=>app.getNflverse()[s]&&app.getNflverse()[s].coaching_scheme);
chk(after.length<=1, 'at most one season retained once the tab is hidden (held: '+(after.join(',')||'none')+')');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
process.exit(pass===total?0:1);
