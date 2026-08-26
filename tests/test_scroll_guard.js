// The floating-surface scroll guard: while a popup/modal is up, scroll gestures outside it
// (or inside it but not in a scrollable region) are cancelled, so the page behind never moves.
// Scrollable regions inside the surface — vertical or horizontal — keep working.
let floaters=[];
const styles=new Map();   // element → {overflowY, overflowX}
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){}},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
function node(opts){
  return Object.assign({nodeType:1,scrollHeight:0,clientHeight:100,scrollWidth:0,clientWidth:100,
    offsetWidth:300,offsetHeight:200,
    parentElement:null,contains(t){let n=t;while(n){if(n===this)return true;n=n.parentElement;}return false;}},opts);
}
global.document={
  documentElement:{style:{setProperty(){}}},
  getElementById:mkEl,
  querySelector:()=>null,
  querySelectorAll:(sel)=> String(sel).includes('pcard-overlay') ? floaters : [],
  createElement:()=>mkEl('_n'+Math.random()),
  body:{appendChild(){}},
  addEventListener(){},removeEventListener(){}
};
global.window={addEventListener(){}};
global.getComputedStyle=(el)=> styles.get(el)||{overflowY:'visible',overflowX:'visible'};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};

const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { _tcScrollGuard };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const fire=(target)=>{ const e={target,cancelable:true,prevented:false,preventDefault(){this.prevented=true;}}; app._tcScrollGuard(e); return e.prevented; };

console.log('=== no floating surface → the page scrolls as normal ===');
floaters=[];
chk(fire(node({}))===false,'nothing up → gesture untouched');

console.log('=== a surface is up ===');
const overlay=node({});                                        // e.g. the player-card overlay
const scrollList=node({parentElement:overlay,scrollHeight:400,clientHeight:100});
styles.set(scrollList,{overflowY:'auto',overflowX:'visible'});
const deadZone=node({parentElement:overlay});                  // hero / backdrop: nothing scrolls here
const wideTable=node({parentElement:overlay,scrollWidth:900,clientWidth:300});
styles.set(wideTable,{overflowY:'visible',overflowX:'auto'});
floaters=[overlay];
const pageEl=node({});                                         // rankings behind the overlay
chk(fire(pageEl)===true,'gesture outside the surface is cancelled — the page behind stays put');
chk(fire(scrollList)===false,'a scrollable list inside the surface still scrolls');
chk(fire(deadZone)===true,'a non-scrollable part of the surface moves nothing');
chk(fire(wideTable)===false,'a horizontally-scrolling table inside a card still pans');

console.log('=== stacked surfaces: the popup over the card ===');
const pop=node({});                                            // e.g. the injury popup over a card
const popList=node({parentElement:pop,scrollHeight:300,clientHeight:100});
styles.set(popList,{overflowY:'auto',overflowX:'visible'});
floaters=[overlay,pop];
chk(fire(popList)===false,'the topmost popup scrolls its own list');
chk(fire(scrollList)===false,'the card behind it keeps its scroll region usable');
chk(fire(pageEl)===true,'…but the page behind both is still frozen');

console.log('=== a hidden overlay must never freeze the page ===');
const ghost=node({offsetWidth:0,offsetHeight:0});   // display:none leftover from some close path
floaters=[ghost];
chk(fire(pageEl)===false,'invisible floater is ignored — the page scrolls normally');

console.log(`\n${pass}/${total}`);
process.exit(pass===total?0:1);
