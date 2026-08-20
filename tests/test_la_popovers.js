// ═══════════════════════════════════════════════════════════════════════════
// League Analyzer popovers: radar-axis detail + value-cliff badges.
//
// laCloseRadarPops() was called twice (99-league-analyzer.js) and defined
// nowhere, so both call sites threw a ReferenceError:
//   • laShowRadarPop() threw BEFORE creating the popover — tapping a radar dot
//     produced nothing at all.
//   • the document-level click listener threw on EVERY click anywhere in the
//     app, which also meant open radar popovers never closed.
// Unlike calcTeamWinsLosses this one was an unguarded bare call, so no static
// "typeof" audit catches it — it needs the code path actually exercised.
// ═══════════════════════════════════════════════════════════════════════════

// Minimal DOM good enough for popover create/remove + querySelectorAll.
function mkNode(cls){
  const n={ className:cls||'', dataset:{}, children:[], parentNode:null, style:{},
    innerHTML:'', onclick:null,
    classList:{ add(){}, remove(){}, contains(){return false;} },
    appendChild(c){ c.parentNode=n; n.children.push(c); return c; },
    remove(){ if(n.parentNode){ const i=n.parentNode.children.indexOf(n); if(i>=0) n.parentNode.children.splice(i,1);} },
    querySelector(sel){ return n.children.find(c=>matches(c,sel))||null; },
    querySelectorAll(sel){ return collect(n).filter(c=>matches(c,sel)); },
    getBoundingClientRect(){ return {left:0,top:0,width:100,height:40,right:100,bottom:40}; },
    closest(){ return null; },
  };
  return n;
}
function matches(el,sel){ return String(sel||'').split(',').some(s=>{ s=s.trim(); return s.startsWith('.') && (' '+el.className+' ').indexOf(' '+s.slice(1)+' ')>=0; }); }
function collect(root){ const out=[]; (function walk(n){ n.children.forEach(c=>{out.push(c); walk(c);}); })(root); return out; }

const docRoot = mkNode('root');
const listeners = {};
const byId = {};
global.document = {
  createElement: ()=>mkNode(''),
  // Detached scratch nodes: enough for the app's boot-time renders to run without
  // touching the docRoot tree the popover assertions inspect.
  getElementById: id=>(byId[id] = byId[id] || mkNode('')),
  querySelector: sel=>docRoot.querySelector(sel),
  querySelectorAll: sel=>docRoot.querySelectorAll(sel),
  addEventListener: (ev,fn)=>{ (listeners[ev]=listeners[ev]||[]).push(fn); },
  body: docRoot,
};
global.window={addEventListener(){},getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){},length:0,key:()=>null};
global.Chart=function(){return{destroy(){},update(){}}};
global.confirm=()=>true; global.btoa=s=>s; global.FileReader=function(){}; global.Range=function(){};
global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.fetch=()=>Promise.reject(new Error('offline in test'));

const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

// Evaluating the bundle must not blow up. When laCloseRadarPops was missing, the
// `return {...}` below threw a ReferenceError and this file died with a bare stack
// trace — which the runner scores as "no assertions" rather than a failure. Catch it
// so a regression reports as a real FAIL instead of quietly vanishing.
let app=null, loadErr=null;
try{ app=new Function(code+'return { laShowRadarPop, laCloseRadarPops, laCloseCliffPops };')(); }
catch(e){ loadErr=e; }
if(loadErr){
  console.log('  FAIL: the app bundle could not be evaluated —', loadErr.message);
  console.log('\nRESULT: 0/1 SOME FAILED');
  process.exit(1);
}

console.log('=== the closer exists at all ===');
chk(typeof app.laCloseRadarPops==='function', 'laCloseRadarPops is defined');
chk(typeof app.laCloseCliffPops==='function', 'laCloseCliffPops is defined (its sibling, which always was)');

console.log('=== tapping a radar dot opens a popover ===');
const wrap = docRoot.appendChild(mkNode('la-radar-wrap'));
const btn  = wrap.appendChild(mkNode('la-rd-dot'));
let threw=null;
try{ app.laShowRadarPop(btn, 'Depth', 'Rank #3 of 12'); }catch(e){ threw=e; }
chk(!threw, 'laShowRadarPop does not throw'+(threw?(' ('+threw.message+')'):''));
chk(docRoot.querySelectorAll('.la-radar-pop').length===1, 'exactly one popover was created');

console.log('=== opening a second one replaces the first ===');
try{ app.laShowRadarPop(btn, 'Youth', 'Rank #7 of 12'); }catch(e){ threw=e; }
chk(docRoot.querySelectorAll('.la-radar-pop').length===1, 'still exactly one popover, not two');

console.log('=== clicking elsewhere closes it, and does not throw ===');
const handlers = listeners['click']||[];
chk(handlers.length>0, 'a document click listener is registered');
let clickThrew=null;
try{ handlers.forEach(fn=>fn({target:{closest:()=>null}})); }catch(e){ clickThrew=e; }
chk(!clickThrew, 'the document click handler runs clean'+(clickThrew?(' ('+clickThrew.message+')'):''));
chk(docRoot.querySelectorAll('.la-radar-pop').length===0, 'the popover was closed by the outside click');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
process.exit(pass===total?0:1);
