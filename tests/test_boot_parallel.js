// ═══════════════════════════════════════════════════════════════════════════
// Boot network shape.
//
// boot() used to `await syncProjSeasonFromSleeper()` BEFORE issuing the seed
// request, so every cold load paid two sequential round-trips to two different
// hosts when neither depends on the other's result. The seed download (~1.5MB
// gzipped) now starts in the same tick as the season probe.
//
// Guards three things:
//   1. the seed request is in flight while the Sleeper season probe is still pending
//   2. exactly ONE seed request is made (the prefetched payload is handed to
//      tryAutoLoadSeed rather than re-fetched)
//   3. seed requests do not use cache:'no-store', which forbade the browser from
//      caching a 1.5MB file it had already downloaded on every previous visit
// ═══════════════════════════════════════════════════════════════════════════

const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){},focus(){},blur(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){}};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true; global.btoa=s=>Buffer.from(s,'binary').toString('base64');
global.FileReader=function(){}; global.Range=function(){};
global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
// Force the plain-.json branch of fetchSeedJson so the mock can stay a simple object.
global.DecompressionStream = undefined;

const SEED_PAYLOAD = {
  seed:{CIN:{QB:[{name:'Joe Burrow',player_id:'6770',pos:'QB',team:'CIN',passing_yards:4800,games_played:17}],WR:[],RB:[],TE:[]}},
  ecr:{half_ppr:{'joe burrow':{rank_ecr:40,tier:5}}},
  history:{}, history_seasons:[],
};

const calls=[];
let sleeperSettled=false, releaseSleeper=null;
global.fetch=(url,opts)=>{
  const u=String(url);
  calls.push({url:u, cache:(opts&&opts.cache)||'(default)', sleeperSettledAtRequest:sleeperSettled});
  if(u.indexOf('/state/nfl')>=0){
    return new Promise(res=>{ releaseSleeper=()=>{ sleeperSettled=true; res({ok:true,json:()=>Promise.resolve({league_season:'2026'})}); }; });
  }
  if(/triplecrown_seed\.json$/.test(u)){
    return Promise.resolve({ok:true, text:()=>Promise.resolve(JSON.stringify(SEED_PAYLOAD))});
  }
  return Promise.reject(new Error('offline in test'));
};

const fs=require('fs'), path=require('path');
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
new Function(code+'return {};')();   // evaluating the bundle runs the boot() IIFE

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const seedCalls=()=>calls.filter(c=>/triplecrown_seed\.json/.test(c.url));

console.log('=== the seed download overlaps the Sleeper season probe ===');
const early=seedCalls();
chk(calls.some(c=>c.url.indexOf('/state/nfl')>=0), 'the Sleeper season probe was issued');
chk(early.length>=1, 'the seed request was issued in the same tick');
chk(early.length>=1 && early[0].sleeperSettledAtRequest===false,
    'the seed request went out while the season probe was still pending (not after it)');

// Let the season probe resolve and drain the microtask/timer queue so the rest of boot runs.
if(releaseSleeper) releaseSleeper();
setTimeout(()=>{
  console.log('=== the prefetched payload is reused, not re-requested ===');
  const all=seedCalls();
  chk(all.length===1, 'exactly one seed request over the whole boot (got '+all.length+')');

  console.log('=== seed requests are cacheable ===');
  chk(all.length>0 && all.every(c=>c.cache!=='no-store'),
      "no seed request uses cache:'no-store' (got: "+all.map(c=>c.cache).join(', ')+')');
  console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
  process.exit(pass===total?0:1);
}, 120);
