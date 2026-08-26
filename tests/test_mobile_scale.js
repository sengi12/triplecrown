// Mobile slider scale + the ⓘ system. On a phone the slider range compresses to realistic
// headroom (a 30% target share reads nearly full); desktop keeps the full domain; typed
// values above the cap stay legal (the number field clamps to the TRUE max, not the visual
// one). The ⓘ buttons put methodology prose in viewport-clamped popups that toggle-close.
let mobile=false;
const reg={};
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){}},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={
  documentElement:{style:{setProperty(){}}},
  getElementById:(id)=> reg[id]!==undefined ? reg[id] : (id==='tcInfoPop' ? null : mkEl(id)),
  querySelector:()=>null,querySelectorAll:()=>[],
  createElement:()=>{const el={id:'',className:'',innerHTML:'',style:{},dataset:{},offsetWidth:280,offsetHeight:120,contains:()=>false,appendChild(){},remove(){ if(el.id && reg[el.id]===el) delete reg[el.id]; }};return el;},
  body:{appendChild:(el)=>{ if(el.id) reg[el.id]=el; }},
  addEventListener(){},removeEventListener(){}
};
global.window={innerWidth:390,innerHeight:800,addEventListener(){},matchMedia:(q)=>({matches:mobile})};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};

const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  tcNiceCeil, tcSliderScaleMax, sRow, tcInfoBtn, tcInfoPop, TC_INFO_BOOK,
  setTeam:(t)=>{currentTeam=t;} };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== nice ceilings ===');
chk(app.tcNiceCeil(31)===40,'31 → 40');
chk(app.tcNiceCeil(168)===200,'168 → 200');
chk(app.tcNiceCeil(6440)===8000,'6440 → 8000');
chk(app.tcNiceCeil(0)===0,'0 → 0');

console.log('=== scale: desktop untouched, mobile compressed ===');
mobile=false;
chk(app.tcSliderScaleMax(28,25,100,40)===100,'desktop: full 0–100 domain');
mobile=true;
chk(app.tcSliderScaleMax(28,25,100,40)===40,'mobile: a 28% share rides a 0–40 track (~70% full)');
chk(app.tcSliderScaleMax(3,2,100,40)===40,'small values never shrink below the floor cap');
chk(app.tcSliderScaleMax(65,60,100,40)===100,'a 65% share needs headroom → 1.35× → capped at the true max');
chk(app.tcSliderScaleMax(55,10,100,85)===85,'floor caps above the value win (rush share style)');
chk(app.tcSliderScaleMax(120,100,7500,0)===900,'QB backup yards: 0–7500 becomes a usable 0–900');
chk(app.tcSliderScaleMax(4600,4000,7500,0)===7500,'starter volume ≈ full domain — barely changes');

console.log('=== sRow wires the compressed scale in, keeps the true max for typing ===');
app.setTeam('CIN');
mobile=true;
const row=app.sRow('py','Passing Yards',600,500,0,7500,50,undefined,false,{});
chk(/max="1000"/.test(row) || /max="900"/.test(row),'slider element carries the compressed max');
chk(row.includes("manualEdit('py',this.textContent,0,7500)"),'the number field still clamps to the TRUE 7500');
chk(/<span>0<\/span><span>(900|1000)<\/span>/.test(row),'scale labels show the compressed domain');
mobile=false;
const rowD=app.sRow('py','Passing Yards',600,500,0,7500,50,undefined,false,{});
chk(/max="7500"/.test(rowD),'desktop slider keeps the full domain');

console.log('=== the ⓘ system ===');
chk(Object.keys(app.TC_INFO_BOOK).length>=10,'info book carries the moved prose (10+ entries)');
chk(['sos','advteam','advleague','shares','rushmodel','qbgames','vona','olgrades','rbfan','latrade',
     'vac_rec','vac_rush','discrep_tgt','discrep_rec','discrep_recyds','rushtds','carry_off','carry_def','additions']
  .every(k=>!!app.TC_INFO_BOOK[k]),'all the de-texted sections are registered');
chk(app.tcInfoBtn('nope')==='','unregistered key renders nothing');
chk(app.tcInfoBtn('sos').includes("tcInfoPop(event,'sos')"),'button wires to its popup');
app.tcInfoPop({target:null,stopPropagation(){}},'sos');
let pop=reg['tcInfoPop'];
chk(!!pop && pop.innerHTML.includes('Vegas win total'),'popup opens with the methodology prose');
chk(parseInt(pop.style.left)>=8,'clamped inside the viewport');
app.tcInfoPop({target:null,stopPropagation(){}},'sos');
chk(!reg['tcInfoPop'],'same button again = toggle closed');
app.tcInfoPop({target:null,stopPropagation(){}},'advteam');
pop=reg['tcInfoPop'];
chk(!!pop && pop.dataset.key==='advteam','a different ⓘ replaces the popup');
chk(pop.innerHTML.includes('league rank out of 32'),'dynamic (function) bodies render');
pop.remove();

console.log(`\n${pass}/${total}`);
process.exit(pass===total?0:1);
