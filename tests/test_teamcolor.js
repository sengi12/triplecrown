const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],appendChild(){},addEventListener(){},remove(){delete elStore[id];}};return elStore[id];}
global.document={getElementById:(id)=>elStore[id]||(id==='pcardOverlay'?null:mkEl(id)),querySelector:()=>null,querySelectorAll:()=>[],createElement:(t)=>({tagName:t,style:{},className:'',id:'',innerHTML:'',appendChild(){},set onclick(f){},remove(){}}),body:{appendChild:(e)=>{if(e.id)elStore[e.id]=e;},removeChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.toast=()=>{};global.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve({})});
const code=require('fs').readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { teamColor, _hexLum, _darken, renderPlayerCardShell,
  setPlayers:(p)=>{sleeperPlayers=p;}, getOverlayHTML:()=>{const o=document.getElementById('pcardOverlay');return o?o.innerHTML:'';} };`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== team colors present ===');
chk(app.teamColor('CIN')==='#FB4F14','CIN = Bengals orange');
chk(app.teamColor('KC')==='#E31837','KC = Chiefs red');
chk(app.teamColor('ZZZ')==='#2b2f3a','unknown team → neutral fallback');

console.log('=== luminance detects light colors ===');
chk(app._hexLum('#FFB612')>0.4,'PIT gold is light');
chk(app._hexLum('#241773')<0.4,'BAL purple is dark');
chk(app._darken('#FFB612',0.45)!=='#FFB612','light color gets darkened');

console.log('=== hero renders with team gradient ===');
app.setPlayers({'6770':{player_id:'6770',name:'Joe Burrow',pos:'QB',team:'CIN',age:29,years_exp:6}});
app.renderPlayerCardShell('6770','QB','CIN');
const h=app.getOverlayHTML();
chk(h.includes('#FB4F14'),'Bengals color in hero gradient');
chk(h.includes('pcard-hero-logo'),'watermark logo element');
chk(h.includes('linear-gradient'),'gradient applied');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
