// ═══════════════════════════════════════════════════════════════════════════
// Mobile hardening (iOS/Android audit):
//   • viewport-fit=cover + safe-area insets + dvh fallbacks actually in the build
//   • fixed popups position against the visualViewport (keyboard-aware)
//   • per-gesture caching in the document-level scroll guard machinery
//   • player-card sticky headers bind per BODY element (they died after the first card)
//   • pushUndo: no re-stringify of the stack top per grab + a global snapshot budget
//   • bounded fetch caches (_tcCachePut) evict oldest-first
//   • player-search haystacks precomputed at index build
// ═══════════════════════════════════════════════════════════════════════════

const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',dataset:{},value:'',childElementCount:1,classList:{add(){},remove(){},toggle(){},contains(){return false;}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},focus(){},blur(){}};return elStore[id];}
let qsAllCalls=0;
global.document={getElementById:id=>mkEl(id),
  querySelector:()=>null,
  querySelectorAll:sel=>{qsAllCalls++;return [];},
  createElement:()=>({style:{},appendChild(){},click(){}}),body:{appendChild(){},removeChild(){}},
  addEventListener(){}, visibilityState:'visible',
  documentElement:{scrollTop:0,scrollHeight:5000,style:{setProperty(){}},classList:{toggle(){}}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){},
  requestAnimationFrame:fn=>setTimeout(fn,0), innerWidth:412, innerHeight:915,
  scrollTo(){}, matchMedia:()=>({matches:false})};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){},length:0,key:()=>null};
global.Chart=function(){return{destroy(){},update(){}}};
global.confirm=()=>true; global.btoa=s=>s; global.FileReader=function(){}; global.Range=function(){};
global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.fetch=()=>Promise.reject(new Error('offline in test'));

const fs=require('fs');
const path=require('path');
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const app=new Function(code+`return {
  tcViewportSize,
  _tcCachePut,
  pushUndo, undoStacks:()=>undoStacks, setWorking:(t,v)=>{workingProj[t]=v;},
  UNDO_TOTAL_LIMIT, UNDO_LIMIT,
  psBuildIndex, setSleeper:(v)=>{sleeperPlayers=v;},
  pcardEnableStickyStatHeaders,
  closeWeekFilterPacePops, laCloseCliffPops, laCloseRadarPops,
  contentProbe:null,
};`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== the build carries the iOS viewport/safe-area/dvh fixes ===');
chk(html.includes('viewport-fit=cover'), 'viewport meta declares viewport-fit=cover (env(safe-area-inset-*) is 0 without it)');
chk(html.includes('padding-top:calc(9px + env(safe-area-inset-top'), 'sticky header pads past the notch in installed-PWA mode');
chk(/\.rt-bar-host\{[^}]*env\(safe-area-inset-bottom/.test(html), 'roster tracker clears the home indicator');
chk(html.includes('height:calc(100dvh - 50px)'), '.main has the dvh fallback (URL-bar-aware viewport)');
chk(/\.ktc-modal\{[^}]*100dvh/.test(html) && /\.ktc-modal\{[^}]*overscroll-behavior:contain/.test(html), 'KTC modal: dvh + overscroll containment');
chk(/\.tc-mgr-list\{[^}]*overscroll-behavior:contain/.test(html), 'projections-manager list: overscroll containment');
chk(html.includes('@media (pointer:coarse)') && /pointer:coarse\)\{[^@]*font-size:16px/.test(html), 'text controls hit 16px on touch devices (kills the iOS focus auto-zoom)');
chk(!code.includes("style=\"max-height:calc(100vh - 320px)\""), 'rankings scroller max-height moved out of the inline style (dvh fallback possible)');
chk(/\.rank-table-wrap\{[^}]*100dvh/.test(html), '…and the CSS class carries the dvh fallback');

console.log('=== tcViewportSize: keyboard-aware popup positioning ===');
let vp=app.tcViewportSize();
chk(vp.vw===412 && vp.vh===915, 'no visualViewport → window.innerWidth/innerHeight');
global.window.visualViewport={width:412, height:520};   // keyboard up
vp=app.tcViewportSize();
chk(vp.vw===412 && vp.vh===520, 'visualViewport present → its (keyboard-shrunk) height wins');
delete global.window.visualViewport;

console.log('=== _tcCachePut: plain-object fetch caches are bounded, oldest evicted ===');
const c={};
for(let i=0;i<5;i++) app._tcCachePut(c,'k'+i,i,4);
chk(Object.keys(c).length===4, 'stays at the cap');
chk(!('k0' in c) && c.k4===4, 'oldest key evicted, newest retained');
app._tcCachePut(c,'k4',99,4);
chk(c.k4===99 && Object.keys(c).length===4, 'overwriting an existing key does not evict');

console.log('=== pushUndo: sig-based dedup + global snapshot budget ===');
app.setWorking('KC',{qbs:[{name:'Mahomes',passing_yards:4800}]});
app.pushUndo('KC', null, 'a');
app.pushUndo('KC', null, 'b');          // identical state → must dedup
chk(app.undoStacks()['KC'].length===1, 'identical state pushed twice stacks once');
chk(app.undoStacks()['KC'][0]._sig!=null, 'snapshot carries its serialization (no re-stringify per grab)');
// fill many teams past the global budget
const TEAMS8=['BUF','MIA','NE','NYJ','BAL','CIN','CLE','PIT'];
TEAMS8.forEach(t=>{
  for(let i=0;i<30;i++){ app.setWorking(t,{qbs:[{name:t+i,passing_yards:i}]}); app.pushUndo(t, null, 'x'); }
});
const totalSnaps=Object.values(app.undoStacks()).reduce((a,s)=>a+s.length,0);
chk(totalSnaps<=app.UNDO_TOTAL_LIMIT, `global budget holds (${totalSnaps} <= ${app.UNDO_TOTAL_LIMIT})`);
chk(app.undoStacks()['PIT'].length===30 || app.undoStacks()['PIT'].length===app.UNDO_LIMIT, 'the team being edited keeps its depth');

console.log('=== popover closers no-op until something opened ===');
qsAllCalls=0;
app.closeWeekFilterPacePops(); app.closeWeekFilterPacePops();
app.laCloseCliffPops(); app.laCloseRadarPops();
chk(qsAllCalls===0, 'no app-wide querySelectorAll when nothing is open (runs on every tap/scroll)');

console.log('=== player search: haystacks precomputed at index build ===');
app.setSleeper({'1':{name:'Patrick Mahomes',pos:'QB',team:'KC'},'2':{name:'Josh Allen',pos:'QB',team:'BUF'}});
const idx=app.psBuildIndex();
const pm=idx.find(e=>e.name==='Patrick Mahomes');
chk(!!pm && typeof pm.hay==='string' && pm.hay.includes('kc'), 'entry carries a normalized haystack incl. team');
chk(typeof pm.hayC==='string' && !/\s/.test(pm.hayC), '…and its space-free form for compact matching');

console.log('=== player-card sticky headers bind per body element ===');
const mkBody=()=>{ const b={listeners:{}, addEventListener(ev){ this.listeners[ev]=(this.listeners[ev]||0)+1; }, getBoundingClientRect:()=>({top:0}), querySelectorAll:()=>[] }; return b; };
const b1=mkBody();
elStore['pcardBody']=b1;
app.pcardEnableStickyStatHeaders();
chk(b1.listeners.scroll===1, 'first card body gets the scroll listener');
app.pcardEnableStickyStatHeaders();
chk(b1.listeners.scroll===1, 'same body is not double-bound');
const b2=mkBody();
elStore['pcardBody']=b2;                 // a NEW card open replaces #pcardBody
app.pcardEnableStickyStatHeaders();
chk(b2.listeners.scroll===1, 'a rebuilt body gets its own listener (this used to silently never happen)');

console.log(`\n${pass}/${total} checks passed`);
process.exit(pass===total?0:1);
