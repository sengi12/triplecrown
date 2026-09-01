// The roster-follow revamp: computeVONA exports the per-position pools + availability map,
// vonaOptionsPop renders a scrollable "next viable options" popover (with working toggle-close),
// and the league picker offers the League Analyzer's synced league + carries its username over.
const reg={};                       // elements registered via body.appendChild, by id
const POPUP_IDS=new Set(['vonaOptPop','vonaWaitPop','tcInfoPop']);
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},value:'',dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},offsetHeight:40};return elStore[id];}
global.document={
  documentElement:{style:{setProperty(){}}},
  // Popovers ask "am I already open?" — a real DOM answers null when they aren't,
  // and mkEl's always-truthy stub would make them try to .remove() a phantom.
  getElementById:(id)=> reg[id]!==undefined ? reg[id]
    : (POPUP_IDS.has(id) ? null : mkEl(id)),
  querySelector:()=>null,querySelectorAll:()=>[],
  createElement:(tag)=>{
    const el={tag,id:'',className:'',innerHTML:'',style:{},dataset:{},offsetWidth:300,offsetHeight:200,
      appendChild(){},contains:()=>false,
      remove(){ if(el.id && reg[el.id]===el) delete reg[el.id]; }};
    return el;
  },
  body:{appendChild:(el)=>{ if(el.id) reg[el.id]=el; }},
  addEventListener(){},removeEventListener(){}
};
global.window={innerWidth:390,innerHeight:800,addEventListener(){}};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};

const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(m,t){ toasts.push({m,t}); };
  return {
    computeVONA, vonaOptionsPop, vonaWaitOpen, vonaWaitPop, renderLeaguePicker,
    setMySlot:(s)=>{mySlot=s;}, setPicks:(p)=>{draftPicksBySlot=p;}, setMeta:(m)=>{draftMeta=m;},
    setBPL:(f)=>{buildPlayerList=f;}, setDrafted:(d)=>{draftedIds=d;},
    setSnapshot:(s)=>{leagueSnapshot=s;}, getPickerState:()=>leaguePickerState };
`)();
global.toasts=[];

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

// A tiny 2-team, 3-round snake draft, me in seat 1, nothing picked yet (I'm on the clock).
app.setMeta({type:'snake',settings:{teams:2,rounds:3},draft_order:{}});
app.setPicks({});
app.setDrafted({});
app.setMySlot(1);
const P=(id,name,pos,vor,adp)=>({player_id:id,name,pos,team:'CIN',vor,ecr:Math.round(adp),adp_ppr:adp,adp});
app.setBPL(()=>[
  P('q1','Alpha Quarterback','QB',40,20), P('q2','Beta Quarterback','QB',22,35),
  P('r1','Alpha Runner','RB',60,1), P('r2','Beta Runner','RB',50,3), P('r3','Gamma Runner','RB',30,9),
  P('w1','Alpha Wideout','WR',55,2), P('w2','Beta Wideout','WR',35,6),
]);

console.log('=== computeVONA exports pools + availability ===');
const v=app.computeVONA();
chk(!!v && !!v.pools,'result carries the per-position pools');
chk(v.pools.RB.length===3 && v.pools.RB[0].player_id==='r1' && v.pools.RB[2].player_id==='r3','RB pool sorted best-VOR-first');
chk(v.pAvail && typeof v.pAvail.get==='function','pAvail is a Map');
chk(v.pAvail.get('r1')!=null,'availability simulated for pool players');

console.log('=== options popover renders the shelf behind the advisory ===');
app.vonaOptionsPop({target:null,stopPropagation(){}},'RB');
let pop=reg['vonaOptPop'];
chk(!!pop,'popover appended to the body');
chk((pop.innerHTML.match(/vona-opt /g)||[]).length===3,'one row per available RB');
chk(pop.innerHTML.includes('Next up at RB'),'headed by the position');
chk(pop.innerHTML.includes('rt-thumb'),'rows carry headshots');
chk(pop.innerHTML.includes('vona-vor') && pop.innerHTML.includes('+60'),'VOR chip shown, best first');
chk(/vona-pct[^>]*>\d+%/.test(pop.innerHTML),'availability % pill rendered from the sim');
chk(pop.innerHTML.includes('ECR'),'market rank shown in the sub-line');
chk(parseInt(pop.style.left)>=8 && parseInt(pop.style.top)>=8,'positioned inside the viewport');

console.log('=== toggle + switch ===');
app.vonaOptionsPop({target:null,stopPropagation(){}},'RB');   // same button again
chk(reg['vonaOptPop']===undefined || reg['vonaOptPop']===null,'same position again = closes (toggle)');
app.vonaOptionsPop({target:null,stopPropagation(){}},'QB');
pop=reg['vonaOptPop'];
chk(!!pop && pop.innerHTML.includes('Next up at QB'),'different position = replaces');
pop.remove();

console.log('=== empty pool degrades to a toast, not a blank popover ===');
toasts.length=0;
app.vonaOptionsPop({target:null,stopPropagation(){}},'TE');
chk(!reg['vonaOptPop'] && toasts.length===1 && /TE/.test(toasts[0].m),'no TEs left → toast, no popup');

console.log('=== league picker correlates with the League Analyzer sync ===');
app.setSnapshot({provider:'sleeper',leagueId:'L1',name:'Queen City Kings',username:'sengi12',avatar:null});
let html=app.renderLeaguePicker();
chk(html.includes('lp-synced') && html.includes('Queen City Kings'),'synced league offered as a one-tap row');
chk(html.includes('linkSnapshotLeagueDraft'),'…that links its draft directly');
chk(html.includes('value="sengi12"'),'username carried over into the input');
app.setSnapshot({provider:'espn',leagueId:'E1',name:'ESPN League',username:'x'});
html=app.renderLeaguePicker();
chk(!html.includes('lp-synced') && html.includes('value=""'),'ESPN sync → no quick row, no prefill (Sleeper drafts only)');
app.setSnapshot(null);
html=app.renderLeaguePicker();
chk(!html.includes('lp-synced') && html.includes('value=""'),'no sync → the picker looks exactly as before');


console.log('=== "wait" opens the right thing for the screen ===');
{
  const clean=()=>{ ['vonaOptPop','vonaWaitPop'].forEach(k=>{ if(reg[k]&&reg[k].remove) reg[k].remove(); delete reg[k]; }); };
  // Phone: the compact "next up at this position" list, not a four-column board
  // popped over the card it came from.
  clean();
  global.window.matchMedia=(q)=>({matches:/max-width:\s*640px/.test(q)});
  app.vonaWaitOpen({target:null,currentTarget:null,stopPropagation(){}},'RB');
  chk(!!reg['vonaOptPop'], 'narrow screens get the compact position list');
  chk(!reg['vonaWaitPop'], 'and not the full wait board');
  chk(reg['vonaOptPop'].innerHTML.includes('Next up at RB'), 'for the position that was clicked');
  // Desktop: the full board, where there is room for it.
  clean();
  global.window.matchMedia=()=>({matches:false});
  app.vonaWaitOpen({target:null,currentTarget:null,stopPropagation(){}},'RB');
  chk(!!reg['vonaWaitPop'], 'wide screens get the whole board');
  chk(!reg['vonaOptPop'], 'and not the compact list');
  const h=reg['vonaWaitPop'].innerHTML;
  chk(h.includes('If you wait'), 'headed by what waiting buys you');
  chk(/vwp-nm/.test(h), 'and it actually carries player names');
  chk((h.match(/vwp-col/g)||[]).length>=2, 'laid out as position columns');
  clean();
}

console.log(`\n${pass}/${total}`);
process.exit(pass===total?0:1);
