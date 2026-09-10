// Keyboard shortcuts: the binding table, the combo grammar, and the guards —
// nothing fires while typing (Esc excepted), bindings respect their WHEN, the
// card's arrow keys step the dock, Esc peels the top layer first.
const elStore={};const clicked=[];
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},dataset:{},hidden:false,classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){},click(){clicked.push(id);},getClientRects:()=>[1],offsetWidth:1};return elStore[id];}
let overlays=[];
global.document={getElementById:mkEl,querySelector:(s)=>null,querySelectorAll:(s)=>overlays.filter(o=>o.match(s)),createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.navigator={platform:'MacIntel',userAgent:'Mac OS'};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  const calls=[];
  openPlayerSearch=function(){ calls.push('search'); }; openTcChat=function(){ calls.push('chat'); }; tcSaveClick=function(){ calls.push('save'); };
  tcOpenManager=function(){ calls.push('manager'); }; triggerImport=function(){ calls.push('import'); }; showFullRankings=function(){ calls.push('rankings'); };
  pcardDockAddOpen=function(){ calls.push('alongside'); }; pcardDockGo=function(pid){ calls.push('go:'+pid); }; closePlayerCard=function(){ calls.push('closecard'); };
  return { handle:tcKeyHandle, combo:tcKeyCombo, match:tcKeyMatch, keys:TC_KEYS, calls, label:tcKeysLabel, mod:TC_MOD_LABEL,
    setCard:(open)=>{ pcardOpen=open; pcardState=open?{pid:'1',posc:'RB',team:'NE'}:null; },
    setDock:(ids,active)=>{ _pcardDock=ids.map(id=>({pid:id})); _pcardDockActive=active; },
    setPhase:(p)=>{ currentPhase=p; } };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const ev=(key,o)=>Object.assign({key,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,target:{tagName:'BODY'},preventDefault(){this.pd=true;},stopPropagation(){}},o||{});

console.log('=== grammar ===');
chk(app.combo(ev('f',{metaKey:true}))==='Mod+F' && app.combo(ev('f',{ctrlKey:true}))==='Mod+F', '⌘ and Ctrl both read as Mod');
chk(app.combo(ev('ArrowLeft',{shiftKey:true}))==='Shift+ArrowLeft', 'named keys keep their names');
chk(app.match(ev('/',{shiftKey:true}),'?') && app.match(ev('?',{shiftKey:true}),'?'), '"?" matches however the layout sends it');
chk(app.mod==='⌘' && app.label('Mod+S')==='⌘+S', 'the sheet labels Mod as ⌘ on a Mac');
chk(app.keys.every(b=>b.combo && b.label && b.group), 'every binding has a combo, a label and a group for the sheet');

console.log('=== guards ===');
app.setCard(false); app.setPhase('Rankings');
chk(app.handle(ev('f',{metaKey:true})) && app.calls.pop()==='search', '⌘F opens the player search');
chk(!app.handle(ev('f',{metaKey:true,target:{tagName:'INPUT'}})), 'but not while typing in a field');
chk(app.handle(ev('k',{metaKey:true})) && app.calls.pop()==='chat', '⌘K asks TripleCrown');
chk(app.handle(ev('s',{metaKey:true})) && app.calls.pop()==='save', '⌘S saves');
chk(app.handle(ev('o',{metaKey:true})) && app.calls.pop()==='manager', '⌘O opens the Manager');
chk(app.handle(ev('2',{metaKey:true})) && app.calls.pop()==='rankings', '⌘2 jumps to Rankings');
chk(!app.handle(ev('ArrowRight')), 'card keys do nothing without a card');
chk(!app.handle(ev('x')), 'unbound keys fall through to the browser');

console.log('=== the card ===');
app.setCard(true); app.setDock(['1','2','3'],'2');
chk(app.handle(ev('ArrowRight')) && app.calls.pop()==='go:3', '→ steps to the next player tab');
chk(app.handle(ev('ArrowLeft')) && app.calls.pop()==='go:1', '← steps back');
app.setDock(['3','1'],'1');
chk(app.handle(ev('ArrowRight')) && app.calls.pop()==='go:3', 'and wraps around');
chk(app.handle(ev('f',{metaKey:true})) && app.calls.pop()==='alongside', 'inside a card ⌘F opens "alongside" instead of the global search');
chk(app.handle(ev('t',{metaKey:true})) && app.calls.pop()==='alongside', 'so does ⌘T');
app.setDock(['1'],'1');
chk(app.handle(ev('w',{metaKey:true})) && app.calls.pop()==='closecard', '⌘W on the last tab closes the card');

console.log('=== escape peels the top layer ===');
overlays=[{match:(s)=>/overlay/.test(s), offsetWidth:1, getClientRects:()=>[1], classList:{contains:()=>false}, querySelector:(s)=>({click(){ app.calls.push('close-top'); }}), remove(){}}];
chk(app.handle(ev('Escape',{target:{tagName:'INPUT'}})) && app.calls.pop()==='close-top', 'Esc works even from a field and clicks the top layer\'s ✕');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
