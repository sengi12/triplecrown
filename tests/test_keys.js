// Keyboard shortcuts: the binding table, the combo grammar, and the guards —
// nothing fires while typing (Esc excepted), bindings respect their WHEN, the
// card's arrow keys step the dock, Esc peels the top layer first. The Game Center,
// Rankings and Leagues groups drive their views; every key with a `run` can be
// rebound from the sheet, the change persists, and a collision frees the old owner.
const elStore={};const clicked=[];
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},dataset:{},hidden:false,classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){},click(){clicked.push(id);},getClientRects:()=>[1],offsetWidth:1};return elStore[id];}
let overlays=[];
global.document={getElementById:mkEl,querySelector:(s)=>null,querySelectorAll:(s)=>overlays.filter(o=>o.match(s)),createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.navigator={platform:'MacIntel',userAgent:'Mac OS'};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
const store={};
global.localStorage={getItem:(k)=>Object.prototype.hasOwnProperty.call(store,k)?store[k]:null,setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  const calls=[];
  openPlayerSearch=function(){ calls.push('search'); }; openTcChat=function(){ calls.push('chat'); }; tcSaveClick=function(){ calls.push('save'); };
  tcOpenManager=function(){ calls.push('manager'); }; triggerImport=function(){ calls.push('import'); }; showFullRankings=function(){ calls.push('rankings'); };
  pcardDockAddOpen=function(){ calls.push('alongside'); }; pcardDockGo=function(pid){ calls.push('go:'+pid); }; closePlayerCard=function(){ calls.push('closecard'); };
  // the Game Center: a desktop sidebar with three games this week
  ldOn=()=>true; isMobileTeamPickerLayout=()=>false;
  gcSetMode=function(m){ _gc.mode=m; calls.push('mode:'+m); }; gcSetView=function(v){ _gc.view=v; calls.push('view:'+v); };
  gcPick=function(id){ _gc.game=id; calls.push('pick:'+id); }; gcSetWeek=function(w){ _gc.week=w; calls.push('week:'+w); }; gcdSetTab=function(t){ calls.push('tab:'+t); };
  gcBoard=()=>({x:1}); gcGames=()=>[{id:'DET@BUF'},{id:'KC@LAC'},{id:'SEA@NE'}]; gcWeek=()=>(_gc.week==='current'?3:_gc.week); gcLastWeek=()=>22;
  setPosFilter=function(p){ rankPosFilter=p; calls.push('pos:'+p); };
  return { handle:tcKeyHandle, combo:tcKeyCombo, match:tcKeyMatch, keys:TC_KEYS, calls, label:tcKeysLabel, mod:TC_MOD_LABEL,
    set:tcKeysSet, reset:tcKeysReset, capture:tcKeysCapture, keyFor:tcKeyFor, byId:tcKeysById, sheet:_keysSheetHTML, editable:tcKeysEditable,
    gc:()=>_gc, capturing:()=>_keysCapturing,
    setCard:(open)=>{ pcardOpen=open; pcardState=open?{pid:'1',posc:'RB',team:'NE'}:null; },
    setDock:(ids,active)=>{ _pcardDock=ids.map(id=>({pid:id})); _pcardDockActive=active; },
    setPhase:(p)=>{ currentPhase=p; }, setPos:(p)=>{ rankPosFilter=p; } };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const ev=(key,o)=>Object.assign({key,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,target:{tagName:'BODY'},preventDefault(){this.pd=true;},stopPropagation(){}},o||{});
const last=()=>app.calls[app.calls.length-1];

console.log('=== grammar ===');
chk(app.combo(ev('f',{metaKey:true}))==='Mod+F' && app.combo(ev('f',{ctrlKey:true}))==='Mod+F', '⌘ and Ctrl both read as Mod');
chk(app.combo(ev('ArrowLeft',{shiftKey:true}))==='Shift+ArrowLeft', 'named keys keep their names');
chk(app.combo(ev('<',{shiftKey:true}))==='<' && app.combo(ev('{',{shiftKey:true}))==='{' && app.combo(ev('?',{shiftKey:true}))==='?', 'a shifted punctuation key is written as the character alone');
chk(app.combo(ev('p',{shiftKey:true}))==='Shift+P', 'but a shifted letter keeps its Shift');
chk(app.match(ev('/',{shiftKey:true}),'?') && app.match(ev('?',{shiftKey:true}),'?'), '"?" matches however the layout sends it');
// CI runs Node 22, where `navigator` is a getter-only global and the stub is a no-op — assert the mapping, not the platform
chk((app.mod==='⌘'||app.mod==='Ctrl') && app.label('Mod+S')===app.mod+'+S', `the sheet labels Mod as the platform's key (${app.mod})`);
chk(app.keys.every(b=>b.id && b.combo && b.label && b.group), 'every binding has an id, a combo, a label and a group for the sheet');
chk(new Set(app.keys.map(b=>b.id)).size===app.keys.length, 'ids are unique');
{ const dup=[]; app.keys.forEach(a=>app.keys.forEach(b=>{ if(a!==b && a.run && b.run && a.combo===b.combo && (a.group===b.group||a.group==='Everywhere'||b.group==='Everywhere')) dup.push(a.id+'/'+b.id); }));
  chk(!dup.length, 'no two defaults that can apply at once share a key'+(dup.length?' — '+dup.join(', '):'')); }

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
chk(!app.handle(ev('g')), 'the Game Center keys stay quiet while a card is open');

console.log('=== the game center ===');
app.setCard(false); app.setPhase('Passing'); app.gc().mode='normal'; app.gc().view='games'; app.gc().game=null; app.gc().week='current';
chk(app.handle(ev('g')) && last()==='mode:max', 'G opens the Game Center (the sidebar at its widest)');
chk(app.handle(ev('g')) && last()==='mode:normal', 'G again puts the sidebar back where it was');
chk(!app.handle(ev('>')), 'game keys need the Game Center open');
app.gc().mode='min';
chk(app.handle(ev('v',{})) && app.calls.slice(-2).join(' ')==='mode:max view:feed', 'V from a closed sidebar opens the Game Center on the Live feed');
chk(app.handle(ev('g')) && last()==='mode:min', 'and G returns to the size it had before');
app.gc().mode='max'; app.gc().view='games';
chk(app.handle(ev('>',{shiftKey:true})) && last()==='pick:KC@LAC', '> with no game picked steps past the first game');
chk(app.handle(ev('>',{shiftKey:true})) && last()==='pick:SEA@NE' && app.handle(ev('>',{shiftKey:true})) && last()==='pick:DET@BUF', 'and wraps around the week');
chk(app.handle(ev('<',{shiftKey:true})) && last()==='pick:SEA@NE', '< steps back');
chk(app.handle(ev('}',{shiftKey:true})) && last()==='week:4', '} moves to the next week');
app.gc().week=22;
chk(!app.handle(ev('}',{shiftKey:true})), 'but never past the Super Bowl');
app.gc().week=1;
chk(!app.handle(ev('{',{shiftKey:true})), 'nor before week 1');
app.gc().week=5;
chk(app.handle(ev('{',{shiftKey:true})) && last()==='week:4', '{ moves to the previous week');
chk(app.handle(ev('f')) && last()==='tab:feed' && app.handle(ev('s')) && last()==='tab:stats', 'F and S pick the game\'s Feed and Stats tabs');
app.gc().view='feed';
chk(!app.handle(ev('>',{shiftKey:true})) && !app.handle(ev('f')), 'the game keys sleep on the Live feed view');
chk(app.handle(ev('v')) && last()==='view:games', 'V flips back to Games');
chk(!app.handle(ev('s',{target:{tagName:'INPUT'}})), 'S while typing stays a letter');
chk(!app.handle(ev('s',{metaKey:true})) || last()!=='tab:stats', '⌘S is still Save, not the Stats tab');

console.log('=== rankings ===');
app.gc().mode='normal'; app.setPhase('Rankings'); app.setPos('ALL');
chk(app.handle(ev('p')) && last()==='pos:QB', 'P steps to the next position filter');
chk(app.handle(ev('p',{shiftKey:true})) && last()==='pos:ALL', '⇧P steps back');
chk(app.handle(ev('p',{shiftKey:true})) && last()==='pos:FLEX', 'and wraps to FLEX');
chk(app.handle(ev('3')) && last()==='pos:RB', '3 jumps to RB');
chk(!app.handle(ev('7')), '7 is beyond the filter row');
app.setPhase('Passing');
chk(!app.handle(ev('p')), 'P means nothing outside the rankings');

console.log('=== leagues ===');
app.setPhase('League');
const laTabs=['myteam','rosters','compare','best','trade'].map((k,i)=>({k, active:i===2, match:(s)=>/phase-tab/.test(s), classList:{contains:(c)=>c==='active' && i===2}, click(){ app.calls.push('la:'+k); }}));
overlays=laTabs;
chk(app.handle(ev(']')) && last()==='la:best', '] steps to the analyzer\'s next tab');
chk(app.handle(ev('[')) && last()==='la:rosters', '[ steps back');
chk(app.handle(ev('5')) && last()==='la:trade', '5 jumps to the fifth tab');
chk(!app.handle(ev('6')), 'and a tab that is not there does nothing');
overlays=[];
app.setPhase('Passing');

console.log('=== your own keys ===');
app.gc().mode='normal';
chk(app.editable(app.byId('gc-toggle')) && !app.editable(app.byId('escape')) && !app.editable(app.byId('undo')) && !app.editable(app.byId('card-stat-n')), 'keys with a run are editable; Esc, ⌘Z and the digit ranges are fixed');
chk(app.set('gc-toggle','H') && app.keyFor(app.byId('gc-toggle'))==='H', 'a binding takes a new key');
chk(app.handle(ev('h')) && last()==='mode:max' && !app.handle(ev('g')), 'the new key works and the old one is free');
chk(JSON.parse(store.tc_keys_v1)['gc-toggle']==='H', 'and it is remembered on this device');
chk(app.set('gc-view','H') && app.keyFor(app.byId('gc-view'))==='H' && app.keyFor(app.byId('gc-toggle'))==='', 'giving the same key to another binding in the group frees the first (it shows no key)');
chk(app.handle(ev('h')) && last()==='view:feed', 'and the key now does the new thing');
chk(app.set('gc-next-week','Mod+Shift+C') && app.keyFor(app.byId('compare'))==='', 'taking an Everywhere key frees it too');
chk(!app.set('escape','Q') && app.keyFor(app.byId('escape'))==='Escape', 'a fixed key cannot be rebound');
app.reset('gc-toggle');
chk(app.keyFor(app.byId('gc-toggle'))==='G' && JSON.parse(store.tc_keys_v1)['gc-toggle']===undefined, 'one binding goes back to its default');
app.reset();
chk(app.keyFor(app.byId('gc-view'))==='V' && app.keyFor(app.byId('compare'))==='Mod+Shift+C' && store.tc_keys_v1===undefined, 'Reset all clears every change and the storage key');
chk(app.set('gc-toggle','G') && store.tc_keys_v1===undefined, 'setting a key to its own default stores nothing');

console.log('=== pressing the new key in the sheet ===');
app.gc().mode='normal'; app.capture('gc-toggle');
chk(app.capturing()==='gc-toggle', 'clicking a key in the sheet waits for the next press');
chk(app.handle(ev('Shift',{shiftKey:true})) && app.capturing()==='gc-toggle', 'a modifier alone keeps waiting');
chk(app.handle(ev('j')) && app.capturing()===null && app.keyFor(app.byId('gc-toggle'))==='J', 'the next key becomes the binding');
chk(app.handle(ev('j')) && last()==='mode:max', 'and it fires from then on');
app.capture('gc-toggle'); app.handle(ev('Escape'));
chk(app.capturing()===null && app.keyFor(app.byId('gc-toggle'))==='J', 'Esc cancels without changing anything');
app.capture('gc-toggle'); app.handle(ev('Backspace'));
chk(app.keyFor(app.byId('gc-toggle'))==='G', '⌫ restores the default');
app.capture('view-rank'); app.handle(ev('r',{metaKey:true}));
chk(app.keyFor(app.byId('view-rank'))==='Mod+R' && app.handle(ev('r',{metaKey:true})) && app.calls.pop()==='rankings', 'a modifier combo is captured as one chord');
app.reset();

console.log('=== the sheet ===');
app.set('gc-toggle','H');
const html=app.sheet();
chk(/Game Center/.test(html) && /Rankings/.test(html) && /Leagues/.test(html), 'the sheet lists the Game Center, Rankings and Leagues groups');
chk(/data-id="gc-toggle"[^>]*>\s*<button[^>]*tcKeysCapture\('gc-toggle'\)/.test(html) && /class="tc-keys-row custom" data-id="gc-toggle"/.test(html), 'an edited key is a button marked custom');
chk(/tcKeysReset\('gc-toggle'\)/.test(html) && /tcKeysReset\(\)/.test(html), 'with its own reset and a Reset all');
chk(/class="tc-keys-row fixed" data-id="escape">\s*<span/.test(html), 'a fixed key is not a button');
app.reset();
chk(!/tcKeysReset\(\)/.test(app.sheet()), 'no Reset all when nothing was changed');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
