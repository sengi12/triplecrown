// Validation/sanitization coverage for cloud-save payloads (tcSanitizeSavePayload).
// Ensures prototype-pollution keys, oversized strings, out-of-range numbers, NaN/Infinity,
// unknown fields, and oversized payloads are all neutralized before hitting the server.
const fs = require('fs');
const path = require('path');

const elStore = {};
function mkEl(id){
  if(!elStore[id]){
    elStore[id] = {
      id, innerHTML:'', textContent:'', value:'', style:{},
      classList:{ add(){}, remove(){}, toggle(){}, contains(){return false;} },
      setAttribute(){}, removeAttribute(){}, hasAttribute(){return false;},
      querySelector:()=>null, querySelectorAll:()=>[], appendChild(){}, addEventListener(){},
      remove(){ delete elStore[id]; }, focus(){}, select(){},
      getBoundingClientRect:()=>({left:0,top:0,bottom:0,width:0,height:0}),
    };
  }
  return elStore[id];
}
global.document = {
  getElementById:(id)=>mkEl(id),
  querySelector:()=>null, querySelectorAll:()=>[],
  createElement:(t)=>({ tagName:t, style:{}, className:'', id:'', innerHTML:'',
    classList:{ add(){}, remove(){}, toggle(){}, contains(){return false;} },
    setAttribute(){}, removeAttribute(){}, appendChild(){}, addEventListener(){}, remove(){},
    querySelector:()=>null, querySelectorAll:()=>[], focus(){}, select(){},
    getBoundingClientRect:()=>({left:0,top:0,bottom:0,width:0,height:0}) }),
  body:{ appendChild:(e)=>{ if(e&&e.id) elStore[e.id]=e; }, removeChild(){} },
  addEventListener(){},
};
global.window = { innerWidth:1200, innerHeight:800, addEventListener(){}, location:{href:'', split:()=>['']} };
global.Chart = function(){ return { destroy(){} }; };
global.toast = () => {};
global.confirm = () => 1;
global.btoa = s => s;
global.fetch = () => Promise.resolve({ ok:true, json:()=>Promise.resolve({}), text:()=>Promise.resolve('') });
global.TextEncoder = global.TextEncoder || require('util').TextEncoder;
global.NFL_LOGO = (tm) => `logo_${tm||''}`;

const code = fs.readFileSync(path.join(__dirname, 'check.js'), 'utf8');
const app = new Function(code + `return { tcSanitizeSavePayload };`)();
const { tcSanitizeSavePayload } = app;

let pass = 0, total = 0;
const chk = (cond, label) => { total++; if (cond) { pass++; console.log('  PASS:', label); } else console.log('  FAIL:', label); };

// 1. Happy path — a normal payload survives with fields intact.
let r = tcSanitizeSavePayload({
  projections: [{ season:'2026', name:'Joe Burrow', fantasy_position:'QB', team:'CIN',
    player_id:'6770', passing_yards:4800, passing_touchdowns:38, adp:12 }],
  playerNotes: { 'pid:6770': { key:'pid:6770', pid:'6770', name:'Joe Burrow', pos:'QB', team:'CIN',
    text:'sleeper pick', tags:[{ id:'t1', label:'EPA', value:'0.2', source:'adv', statKey:'epa' }], updatedAt: 1700000000000 } },
});
chk(r.ok === true, 'valid payload passes');
chk(r.cleaned.projections[0].passing_yards === 4800, 'numeric stat preserved');
chk(r.cleaned.projections[0].name === 'Joe Burrow', 'name preserved');
chk(r.cleaned.playerNotes['pid:6770'].tags[0].label === 'EPA', 'note tag preserved');

// 2. Prototype pollution keys are stripped.
const evil = { projections: [], playerNotes: {} };
evil.playerNotes['__proto__'] = { text: 'polluted' };
evil.playerNotes['constructor'] = { text: 'polluted' };
evil.playerNotes['legit'] = { key:'legit', name:'X', tags:[] };
r = tcSanitizeSavePayload(evil);
chk(r.ok === true, 'payload with __proto__ key still validates');
chk(!('__proto__' in r.cleaned.playerNotes) || Object.keys(r.cleaned.playerNotes).indexOf('__proto__') === -1, '__proto__ note key dropped');
chk(({}).text === undefined, 'Object.prototype not polluted');
chk(r.cleaned.playerNotes.legit && r.cleaned.playerNotes.legit.name === 'X', 'legit note kept alongside dropped bad keys');

// 3. NaN / Infinity / huge numbers are clamped to finite bounds.
r = tcSanitizeSavePayload({ projections: [{ name:'A', team:'CIN', fantasy_position:'RB',
  passing_yards: Infinity, rushing_yards: NaN, receiving_yards: 1e308, adp: -5 }], playerNotes:{} });
const row = r.cleaned.projections[0];
chk(Number.isFinite(row.passing_yards), 'Infinity stat coerced to finite');
chk(Number.isFinite(row.rushing_yards), 'NaN stat coerced to finite');
chk(row.receiving_yards <= 2000000, 'absurd stat clamped to max');
chk(row.adp >= 0, 'negative adp clamped to >= 0');

// 4. Unknown/extra fields are dropped (whitelist).
r = tcSanitizeSavePayload({ projections:[{ name:'A', team:'CIN', fantasy_position:'WR',
  evilField:'<script>alert(1)</script>', hacker:{deeply:{nested:true}} }], playerNotes:{} });
chk(!('evilField' in r.cleaned.projections[0]), 'unknown field dropped');
chk(!('hacker' in r.cleaned.projections[0]), 'nested unknown object dropped');

// 5. Oversized strings are truncated.
r = tcSanitizeSavePayload({ projections:[{ name:'x'.repeat(5000), team:'CIN', fantasy_position:'WR' }], playerNotes:{} });
chk(r.cleaned.projections[0].name.length <= 120, 'oversized name truncated to cap');

// 6. Invalid position falls back to WR.
r = tcSanitizeSavePayload({ projections:[{ name:'A', team:'CIN', fantasy_position:'WIZARD' }], playerNotes:{} });
chk(r.cleaned.projections[0].fantasy_position === 'WR', 'invalid position falls back to WR');

// 7. Too many projections rejected.
r = tcSanitizeSavePayload({ projections: new Array(5000).fill({ name:'A', team:'CIN', fantasy_position:'WR' }), playerNotes:{} });
chk(r.ok === false && /Too many players/.test(r.error), 'too many projections rejected');

// 8. Malformed top-level rejected.
chk(tcSanitizeSavePayload(null).ok === false, 'null payload rejected');
chk(tcSanitizeSavePayload({ playerNotes:{} }).ok === false, 'missing projections list rejected');
chk(tcSanitizeSavePayload([]).ok === false, 'array payload rejected');

// 9. Tag nav is shallow-cleaned (nested objects/functions dropped).
r = tcSanitizeSavePayload({ projections:[], playerNotes:{ k:{ key:'k', name:'N', tags:[
  { id:'t', label:'L', value:'V', nav:{ type:'coaching', team:'CIN', season:'2025', tab:'insights',
    nested:{ bad:true }, __proto__:{ p:1 } } } ] } } });
const nav = r.cleaned.playerNotes.k.tags[0].nav;
chk(nav && nav.type === 'coaching' && nav.team === 'CIN', 'nav primitives preserved');
chk(nav && !('nested' in nav), 'nav nested object dropped');

// ── draftStars: the shortlist crosses the trust boundary like everything else ──
console.log('=== draftStars sanitization ===');
{
  const base=()=>({ projections:[{ season:'2026', name:'Joe Burrow', fantasy_position:'QB',
    team:'CIN', player_id:'6770', passing_yards:4800 }], playerNotes:{} });
  const chkFn=tcSanitizeSavePayload;
  let r=chkFn({ ...base(), draftStars:{ '4046':1, '9221':1 } });
  chk(r.ok && r.cleaned.draftStars && r.cleaned.draftStars['4046']===1
      && r.cleaned.draftStars['9221']===1, 'star ids pass through as pid->1');
  r=chkFn({ ...base(), draftStars:{ '4046':'yes-truthy', 'x':0, 'y':'' } });
  chk(r.ok && r.cleaned.draftStars['4046']===1, 'truthy values normalize to 1');
  chk(r.ok && !('x' in r.cleaned.draftStars) && !('y' in r.cleaned.draftStars),
      'falsy entries are dropped, not stored');
  r=chkFn({ ...base(), draftStars: JSON.parse('{"__proto__":1,"constructor":1,"ok":1}') });
  chk(r.ok && Object.keys(r.cleaned.draftStars).length===1 && r.cleaned.draftStars.ok===1,
      'prototype-pollution keys are stripped');
  r=chkFn({ ...base(), draftStars:{ ['k'.repeat(500)]:1 } });
  chk(r.ok && Object.keys(r.cleaned.draftStars)[0].length<=40, 'ids are length-capped');
  const many={}; for(let i=0;i<301;i++) many['p'+i]=1;
  r=chkFn({ ...base(), draftStars:many });
  chk(!r.ok && /Too many bookmarked/.test(r.error||''), 'a 301-star payload is refused');
  r=chkFn({ ...base(), draftStars:[1,2,3] });
  chk(r.ok && Object.keys(r.cleaned.draftStars||{}).length===0, 'an array is not a shortlist');
  r=chkFn(base());
  chk(r.ok && r.cleaned.draftStars && Object.keys(r.cleaned.draftStars).length===0,
      'absent shortlist saves as empty, never undefined');
}

console.log(`\nRESULT: ${pass}/${total} ${pass === total ? 'ALL PASS' : 'FAILURES'}`);
process.exit(pass === total ? 0 : 1);
