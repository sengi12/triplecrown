// ═══════════════════════════════════════════════════════════════════════════
// Note metadata split across cell + row scope.
//
// The rankings board used to stamp all ~11 data-note-* fields onto EVERY tagged
// cell. Measured on a phone-width board that was 21,857 attributes / 848KB —
// 58% of the table's entire HTML — with the nav JSON re-serialised once per cell
// for ~32 distinct values.
//
// Now the row carries what is constant for the row (player, team, context, nav,
// source) via [data-note-scope], and each cell carries only what varies (label,
// stat key; the value is read back from the cell's own text). noteInfoFromElement
// reassembles the two. This test locks in BOTH halves: the size win, and the fact
// that a resolved note is byte-identical to what the old inline form produced.
// ═══════════════════════════════════════════════════════════════════════════

const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){},focus(){},blur(){}};return elStore[id];}
global.document={getElementById:id=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){},click(){}}),body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){},length:0,key:()=>null};
global.Chart=function(){return{destroy(){},update(){}}};
global.confirm=()=>true; global.btoa=s=>s; global.FileReader=function(){}; global.Range=function(){};
global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.fetch=()=>Promise.reject(new Error('offline in test'));

const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+'return { noteScopeAttrs, noteCellHtml, noteTagAttrs, noteInfoFromElement };')();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const META = {
  label:'Fantasy Points', value:'300.5', source:'rankings', statKey:'fpts',
  context:'2026 projections · full rankings', team:'DET',
  player:{player_id:'9221', name:'Jahmyr Gibbs', pos:'RB', team:'DET'},
  nav:{type:'rankings', season:'proj', scope:'all', team:'DET', advanced:false, refinement:'', posFilter:'ALL'},
};

// Parse `data-x="y"` attribute strings into a dataset-like object (camelCase keys).
function parseAttrs(str){
  const ds={};
  for(const m of String(str).matchAll(/\s([a-z-]+)="([^"]*)"/g)){
    const key=m[1].replace(/^data-/,'').replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
    ds[key]=m[2].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  }
  return ds;
}
// Fake element pair: a cell whose closest('[data-note-scope]') is the row.
function mkPair(cellHtml, scopeAttrs, text){
  const rowDs=parseAttrs(scopeAttrs);
  const row={dataset:rowDs};
  const cellDs=parseAttrs(cellHtml.slice(cellHtml.indexOf(' '), cellHtml.indexOf('>')));
  return { dataset:cellDs, textContent:text,
           closest:sel=>sel==='[data-note-scope]'?row:null };
}

console.log('=== the split reassembles into the same note ===');
const inlineDs = parseAttrs(app.noteTagAttrs(META));               // the old all-on-one-cell form
const inlineEl = { dataset:inlineDs, textContent:'300.5', closest:()=>null };
const inlineInfo = app.noteInfoFromElement(inlineEl);

const scopeAttrs = app.noteScopeAttrs(META);
const cellHtml   = app.noteCellHtml('<span class="num">300.5</span>', {label:META.label, statKey:META.statKey}, 'note-tag-hit');
const splitInfo  = app.noteInfoFromElement(mkPair(cellHtml, scopeAttrs, '300.5'));

for(const k of ['label','value','source','statKey','team']){
  chk(splitInfo[k]===inlineInfo[k], `${k} matches the inline form (${JSON.stringify(splitInfo[k])})`);
}
chk(JSON.stringify(splitInfo.player)===JSON.stringify(inlineInfo.player), 'player identity matches');
chk(JSON.stringify(splitInfo.nav)===JSON.stringify(inlineInfo.nav), 'nav payload matches');
chk(splitInfo.context===inlineInfo.context, 'context matches');

console.log('=== the cell really is small now ===');
const cellAttrNames=Object.keys(parseAttrs(cellHtml.slice(cellHtml.indexOf(' '), cellHtml.indexOf('>'))))
  .filter(n=>n!=='class');
chk(cellAttrNames.length<=3, 'cell carries at most 3 data attributes (got '+cellAttrNames.length+': '+cellAttrNames.join(',')+')');
chk(!cellAttrNames.includes('noteNav'), 'the nav JSON is NOT repeated on the cell');
chk(!cellAttrNames.includes('notePlayerName'), 'player identity is NOT repeated on the cell');
chk(!cellAttrNames.includes('noteValue'), 'the value is NOT repeated on the cell (read from its text)');
chk(app.noteCellHtml('x',{label:'L',statKey:'k'},'c').length < app.noteTagAttrs(META).length,
    'a split cell is smaller than the old inline attribute blob');

console.log('=== an unset source falls through instead of defaulting on the cell ===');
// Regression: noteCellHtml used to write data-note-source="app", which shadowed the row's
// real source and made every rankings tag claim it came from 'app'.
chk(!/data-note-source/.test(cellHtml), 'no data-note-source written on the cell');
chk(splitInfo.source==='rankings', 'source resolves from the row scope, not the "app" default');

console.log('=== callers that still inline everything keep working ===');
chk(inlineInfo.label==='Fantasy Points' && inlineInfo.player.name==='Jahmyr Gibbs',
    'a lone element with no scope ancestor resolves exactly as before');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
process.exit(pass===total?0:1);
