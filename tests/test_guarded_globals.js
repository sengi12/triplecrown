// ═══════════════════════════════════════════════════════════════════════════
// Every `typeof foo === 'function'` guard must guard something that EXISTS.
//
// The app ships as 45 src/js partials concatenated into one shared scope, so a
// cross-file call is only checked at runtime — and the codebase's idiom for
// "this may not be loaded yet" is `if(typeof foo==='function') foo()`. That
// guard is doing its job when foo is a real function defined in another
// partial, or a browser API that older browsers lack. But when the name was
// never written at all, the guard turns a crash into permanent silence: the
// feature just never happens and nothing anywhere says so.
//
// That is exactly how _thsReco() (89-team-swipe.js) shipped calling
// calcTeamWinsLosses() — a function that exists nowhere in the project. The
// team record silently never rendered on the swipe-preview header, while the
// real header rendered it fine.
//
// Anything genuinely optional at runtime belongs in BROWSER_APIS below.
// ═══════════════════════════════════════════════════════════════════════════

const fs=require('fs'), path=require('path');
const src=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');

// Browser APIs the app legitimately feature-detects. Not defined by us on purpose.
const BROWSER_APIS = new Set([
  'DecompressionStream',   // gz seed fast path; absent on older browsers
  'IntersectionObserver',  // lazy headshot hydration; has a synchronous fallback
  'requestIdleCallback',   // deferred work; falls back to setTimeout
  'ResizeObserver',        // sticky stat headers; optional
]);

const guarded=new Set();
for(const m of src.matchAll(/typeof\s+([A-Za-z_$][\w$]*)\s*[=!]==\s*['"]function['"]/g)) guarded.add(m[1]);

const defined=new Set();
for(const m of src.matchAll(/(?:^|[\s;{}()])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
for(const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
for(const m of src.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== guarded identifiers resolve ===');
console.log('  scanned '+guarded.size+' `typeof x === "function"` guards');
chk(guarded.size>50, 'the scan found the guards (got '+guarded.size+')');

const orphans=[...guarded].filter(n=>!defined.has(n)&&!BROWSER_APIS.has(n));
chk(orphans.length===0,
    orphans.length ? 'guarded but defined NOWHERE: '+orphans.join(', ')
                   : 'every guarded name is defined in the bundle or a known browser API');

console.log('=== the allowlist stays honest ===');
const stale=[...BROWSER_APIS].filter(n=>!guarded.has(n));
chk(stale.length===0, stale.length ? 'allowlisted but no longer guarded anywhere: '+stale.join(', ')
                                   : 'no stale entries in BROWSER_APIS');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
process.exit(pass===total?0:1);
