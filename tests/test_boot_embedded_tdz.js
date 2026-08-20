// ═══════════════════════════════════════════════════════════════════════════
// The embedded-seed boot path must not touch a not-yet-initialised binding.
//
// The app is 45 partials concatenated into ONE script, so a `let`/`const` in a
// later partial is in the temporal dead zone while an earlier partial's top-level
// code runs. boot() lives in 85-import-export.js and, when a seed is baked in,
// synchronously calls backgroundRefreshADP() — which is declared in 90-sleeper.js
// and read `let _bgAdpRefreshed`. Result on every baked/offline file:
//   "Cannot access '_bgAdpRefreshed' before initialization"
// and the background ADP refresh silently never ran. The hosted build hid it,
// because there the same call happens from an async continuation, long after the
// whole bundle has finished executing.
//
// This test reproduces the baked configuration and fails on ANY error raised
// while the bundle is executing.
// ═══════════════════════════════════════════════════════════════════════════

const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){},focus(){},blur(){}};return elStore[id];}
global.document={getElementById:id=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){},visibilityState:'visible'};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){}};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true; global.btoa=s=>Buffer.from(s,'binary').toString('base64');
global.FileReader=function(){}; global.Range=function(){};
global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){},length:0,key:()=>null};
global.fetch=()=>Promise.reject(new Error('offline (baked file)'));

// Anything that escapes as an unhandled rejection is a failure too — backgroundRefreshADP is
// `async`, so its TDZ throw surfaced there rather than as a synchronous exception.
const rejections=[];
process.on('unhandledRejection', e=>rejections.push(e && e.message ? e.message : String(e)));

const fs=require('fs'), path=require('path');
let code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const START='// ═══ TRIPLECROWN_SEED_START ═══', END='// ═══ TRIPLECROWN_SEED_END ═══';
const embed=`${START}
const SEED_SEASON=2026;
const SEED_DATA={"CIN":{"QB":[{"name":"Joe Burrow","player_id":"6770","pos":"QB","team":"CIN","passing_yards":4800,"passing_attempts":620,"passing_touchdowns":38,"games_played":17}],"WR":[],"RB":[],"TE":[]}};
const SEED_HISTORY={};
const SEED_HISTORY_SEASONS=["2025"];
const SEED_ECR={"half_ppr":{"joe burrow":{"rank_ecr":40,"tier":5,"age":29}}};
const SEED_CONTRACTS={};
${END}`;
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
code=code.replace(new RegExp(esc(START)+'[\\s\\S]*?'+esc(END)), embed);

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== a baked bundle executes clean ===');
let bootErr=null, app=null;
try{ app=new Function(code+'return { getSEED:()=>SEED, bgFlag:()=>_bgAdpRefreshed };')(); }
catch(e){ bootErr=e; }
chk(!bootErr, 'the bundle evaluates without throwing'+(bootErr?(' ('+bootErr.message+')'):''));
chk(!!(app && app.getSEED().CIN), 'the embedded seed is in memory');

setTimeout(()=>{
  console.log('=== no error escaped as an unhandled rejection ===');
  const tdz = rejections.filter(m=>/before initialization|is not defined/i.test(m));
  chk(tdz.length===0, tdz.length ? 'temporal-dead-zone error during boot: '+tdz[0]
                                 : 'no TDZ / undefined-binding error reached the promise handlers');
  // Anything else rejecting is expected here (the fake fetch always rejects), so only TDZ counts.
  console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
  process.exit(pass===total?0:1);
}, 300);
