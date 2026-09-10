// Player tabs (the dock): every card opened this session stays reachable across
// the top of the card. Pinned: one card = no strip; a drill-down adds a tab and
// keeps the first; switching restores the view the tab was on; closing a tab
// lands on the left neighbour; closing the last tab closes the card; the card's
// ✕ clears everything; the strip is bounded.
const els={};
function mkEl(id){
  if(!els[id]) els[id]={id,innerHTML:'',style:{},dataset:{},children:[],
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},
    remove(){},insertAdjacentHTML(){},getBoundingClientRect:()=>({}),setAttribute(){},scrollIntoView(){}};
  return els[id];
}
// The overlay/card pair the dock renders into: a tiny DOM that supports insertBefore + querySelector.
let overlay=null;
function mkCard(){
  const dock={className:'',innerHTML:'',remove(){card.dock=null;},setAttribute(){},querySelector:()=>null};
  const card={dock:null,firstChild:{},querySelector(sel){ return sel==='.pcard-dock'?card.dock:null; },
    insertBefore(node){ card.dock=node; }, addEventListener(){}, style:{}};
  return card;
}
global.document={
  getElementById:(id)=>{ if(id==='pcardOverlay') return overlay; return mkEl(id); },
  querySelector:(sel)=>{ if(sel==='#pcardOverlay .pcard') return overlay&&overlay.card; return null; },
  querySelectorAll:()=>[],
  createElement:(tag)=>({tagName:tag,className:'',innerHTML:'',setAttribute(){},querySelector:()=>null,
    remove(){ if(overlay&&overlay.card&&overlay.card.dock===this) overlay.card.dock=null; },
    appendChild(){},style:{},onclick:null,set id(v){ this._id=v; if(v==='pcardOverlay'){ overlay=this; this.card=mkCard(); } }, get id(){ return this._id; }}),
  body:{appendChild(){},classList:{add(){},remove(){}},style:{}},
  documentElement:{style:{},classList:{add(){},remove(){}}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),scrollY:0,scrollTo(){}};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;
global.FileReader=function(){};global.Range=function(){};
global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
global.fetch=()=>Promise.reject(new Error('offline in test'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  sleeperPlayers={
    '1':{player_id:'1',name:'Rhamondre Stevenson',pos:'RB',team:'NE'},
    '2':{player_id:'2',name:'Mike Onwenu',pos:'OL',team:'NE'},
    '3':{player_id:'3',name:'Drake Maye',pos:'QB',team:'NE'},
    '4':{player_id:'4',name:'Puka Nacua',pos:'WR',team:'LAR'},
  };
  // Keep the shell/data loaders out of it: the dock only needs openPlayerCard's bookkeeping.
  renderPlayerCardShell=function(pid,pos,team){ pcardState={pid:String(pid),posc:pos||'',team:team||''}; if(!document.getElementById('pcardOverlay')){ const d=document.createElement('div'); d.id='pcardOverlay'; } };
  loadPlayerCardData=function(){};
  pcardCaptureNavState=function(){ return pcardState ? {pid:pcardState.pid,pos:pcardState.posc,team:pcardState.team,mode:pcardStatsMode,rbFanSeason:pcardRbFanSeason} : null; };
  return {
    open:openPlayerCard, openFrom:openPlayerCardFromCard, close:closePlayerCard,
    go:pcardDockGo, closeTab:pcardDockClose,
    dock:()=>_pcardDock.map(t=>t.pid), active:()=>_pcardDockActive,
    strip:()=>{ const c=document.querySelector('#pcardOverlay .pcard'); return c&&c.dock ? c.dock.innerHTML : ''; },
    isOpen:()=>pcardOpen, restore:()=>pcardRestoreState, nav:()=>pcardNavStack.length,
    setMode:(m)=>{ pcardStatsMode=m; }, setRb:(s)=>{ pcardRbFanSeason=s; },
    max:PCARD_DOCK_MAX,
  };
`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== one card: no strip ===');
app.open('1','RB','NE');
chk(app.dock().join(',')==='1' && app.active()==='1', 'the first card is the first tab');
chk(app.strip()==='', 'a single tab draws no strip');

console.log('=== drill-down from an RB fan to a lineman ===');
app.openFrom('2','OL','NE');
chk(app.dock().join(',')==='1,2' && app.active()==='2', 'the lineman is a second tab; the RB stays');
chk(/R\. Stevenson/.test(app.strip()) && /M\. Onwenu/.test(app.strip()), 'tabs read "R. Stevenson" / "M. Onwenu"');
chk(/RB · NE/.test(app.strip()), 'position and team ride under the name');
chk(app.nav()===1, 'the back stack still works alongside the tabs');

console.log('=== switching restores the view you left ===');
app.go('1');
chk(app.active()==='1' && app.dock().join(',')==='1,2', 'switching does not reorder or duplicate');
app.setMode('college'); app.setRb('2025');
app.go('2');
app.go('1');
const r=app.restore();
chk(r && r.mode==='college' && r.rbFanSeason==='2025', 'the RB tab remembers stats mode + chart season');
chk(app.nav()===1, 'tab switches never push back-stack entries');

console.log('=== re-opening an open player just activates its tab ===');
app.open('2','OL','NE');
chk(app.dock().join(',')==='1,2' && app.active()==='2', 'no duplicate tab');

console.log('=== closing tabs ===');
app.open('3','QB','NE');
app.closeTab('3');
chk(app.dock().join(',')==='1,2' && app.active()==='2', 'closing the active tab lands on its left neighbour');
app.closeTab('1');
chk(app.dock().join(',')==='2' && app.active()==='2', 'closing a background tab keeps the active one');
chk(app.strip()==='', 'back to one tab: the strip is gone');
app.closeTab('2');
chk(!app.isOpen() && app.dock().length===0, 'closing the last tab closes the card');

console.log('=== the card ✕ clears every tab ===');
app.open('1','RB','NE'); app.openFrom('2','OL','NE'); app.openFrom('4','WR','LAR');
chk(app.dock().length===3, 'three open');
app.close();
chk(app.dock().length===0 && app.active()===null, '✕ closes all tabs');

console.log('=== bounded ===');
for(let i=1;i<=app.max+3;i++){ sleeperPlayersAdd=null; app.open(String(i),'WR','LAR'); }
chk(app.dock().length===app.max, `never more than ${app.max} tabs`);
chk(app.active()===String(app.max+3) && app.dock().includes(String(app.max+3)), 'the newest tab always survives');
app.close();

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
