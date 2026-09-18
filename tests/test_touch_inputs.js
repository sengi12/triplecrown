// ═══════════════════════════════════════════════════════════════════════════
// Phone text entry must never zoom the page.
//
// iOS Safari zooms the whole document when a focused control's computed
// font-size is under 16px, and it does NOT zoom back out — the layout is left
// cropped until the user pinches. The app therefore bumps every text-entry
// control to 16px under @media (pointer:coarse).
//
// Two things this pins, both learned the hard way (2026-09-18, walking every
// view at 390px):
//   1. every text-entry selector the app renders is covered by the rule;
//   2. the rule lives in the LAST stylesheet. It used to sit in
//      60-responsive.css, and 70-widgets.css / 12-pcard-dock.css come after it
//      in filename order — so at equal specificity those files won, and the
//      compare box, the chat box and the card dock's add box kept their 13px
//      and kept zooming the page.
// ═══════════════════════════════════════════════════════════════════════════
const fs=require('fs'), path=require('path');
const dir=path.join(__dirname,'..','src','css');
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.css')).sort();
let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

// the coarse-pointer block, wherever it is
let holder=null, block='';
for(const f of files){
  const s=fs.readFileSync(path.join(dir,f),'utf8');
  const i=s.indexOf('@media (pointer:coarse)');
  if(i<0) continue;
  // take the balanced block
  let d=0, j=s.indexOf('{', i), k=j;
  for(;k<s.length;k++){ if(s[k]==='{')d++; else if(s[k]==='}'){d--; if(!d){k++;break;}} }
  holder=f; block=s.slice(i,k);
}
console.log('=== the rule exists and sits last in the cascade ===');
chk(!!holder, 'a @media (pointer:coarse) block exists'+(holder?` (in ${holder})`:''));
chk(holder===files[files.length-1], `it lives in the last stylesheet so nothing later overrides it (last is ${files[files.length-1]}, rule is in ${holder})`);

console.log('=== every text-entry control the app renders is covered ===');
// each entry: [selector the rule must carry, a file that renders it]
const NEED=[
  ['.ai-cmp-in',      'the compare box, the chat box and the MCP url field'],
  ['#laUsername',     "the analyzer's Sleeper username field"],
  ['#laEspnLeague',   "the analyzer's ESPN league field"],
  ['.pcard-add-in',   "the player card dock's add box"],
  ['.ld-sel',         'the draft week / position selects'],
  ['.tc-input',       'the sign-in email and password fields'],
  ['.rank-search-input','the rankings search box'],
  ['.scenario-name',  'the scenario name field'],
];
for(const [sel,what] of NEED) chk(block.includes(sel), `${sel} — ${what}`);
chk(/input\[type=text\]/.test(block) && /textarea/.test(block) && /select\{font-size:16px/.test(block.replace(/\s/g,'')),
    'a catch-all for input[type=text]/search/email/password/number, textarea and select, so a new field is covered the day it is added');
chk(/font-size:\s*16px/.test(block), 'the rule sets 16px');

console.log('=== no text-entry control is left under 16px by a later file ===');
// crude but effective: any rule that sets a font-size under 16px on a KNOWN entry selector
// must itself be inside a coarse-pointer block, or come before the holder file.
const bad=[];
for(const f of files){
  if(f===holder) continue;
  const s=fs.readFileSync(path.join(dir,f),'utf8');
  for(const [sel] of NEED){
    const re=new RegExp(sel.replace(/[.#*+?^${}()|[\]\\]/g,'\\$&')+'[^{}]*\\{[^}]*font-size:\\s*([\\d.]+)px','g');
    let m; while((m=re.exec(s))){ if(parseFloat(m[1])<16 && files.indexOf(f)>files.indexOf(holder)) bad.push(`${f}: ${sel} → ${m[1]}px`); }
  }
}
chk(bad.length===0, bad.length ? 'a later file still shrinks a text input: '+bad.join(', ') : 'no stylesheet after the rule shrinks a covered control');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
