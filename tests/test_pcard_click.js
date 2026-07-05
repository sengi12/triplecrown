const path=require('path');
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],appendChild(){},addEventListener(){},remove(){delete elStore[id];}};return elStore[id];}
global.document={getElementById:(id)=>elStore[id]||(id==='pcardOverlay'?null:mkEl(id)),querySelector:()=>null,querySelectorAll:()=>[],createElement:(t)=>({tagName:t,style:{},className:'',id:'',innerHTML:'',appendChild(){},set onclick(f){},remove(){}}),body:{appendChild:(e)=>{if(e.id)elStore[e.id]=e;},removeChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
let toasts=[];global.toast=(m,t)=>{toasts.push([m,t]);};
global.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve({})});
const code=require('fs').readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { pcardOnclick, pcardArg, openPlayerCard,
  setPlayers:(p)=>{sleeperPlayers=p; buildSleeperNameIndex();}, setSeasons:(s)=>{HISTORY_SEASONS=s;},
  hasOverlay:()=>!!document.getElementById('pcardOverlay') };`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== onclick uses SINGLE quotes (valid inside double-quoted attr) ===');
const oc=app.pcardOnclick('6770','QB','CIN');
chk(oc==="openPlayerCard('6770','QB','CIN')",'single-quoted args: '+oc);
chk(!oc.includes('"'),'no double quotes that would break the attribute');

console.log('\n=== names with apostrophes are escaped ===');
const oc2=app.pcardOnclick("Ja'Marr Chase",'WR','CIN');
chk(oc2.includes("Ja\\'Marr"),'apostrophe escaped: '+oc2);

console.log('\n=== clicking actually opens overlay ===');
app.setPlayers({'6770':{player_id:'6770',name:'Joe Burrow',pos:'QB',team:'CIN',age:29,years_exp:6}});
app.setSeasons([2024]);
app.openPlayerCard('6770','QB','CIN');
chk(app.hasOverlay(),'overlay created');
chk(toasts.length===0,'no error toast');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
