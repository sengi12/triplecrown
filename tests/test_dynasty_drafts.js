const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={};}abort(){}};

// The user's REAL /league/{id}/drafts response — a dynasty league returning ONE draft, complete.
const REAL_DRAFTS=[{"created":1735831032085,"draft_id":"1180564550988939265","league_id":"1180564550988939264","metadata":{"scoring_type":"dynasty_half_ppr","name":"Originally from Ohio Dynasty League"},"season":"2025","status":"complete","type":"linear","settings":{"rounds":5,"teams":12}}];
const LEAGUE={draft_id:"1180564550988939265",league_id:"1180564550988939264",name:"Originally from Ohio Dynasty League",scoring_settings:{rec:0.5}};

global.fetch=(u)=>{
  const J=(o)=>Promise.resolve({ok:true,json:()=>Promise.resolve(o)});
  if(u.match(/league\/1180564550988939264\/drafts/)) return J(REAL_DRAFTS);
  if(u.match(/draft\/1180564550988939265$/)) return J(REAL_DRAFTS[0]);
  return Promise.reject(new Error('unmocked '+u));
};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { resolveLeagueDraft };`)();

(async()=>{
  let pass=0,total=0;
  const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
  console.log('=== Dynasty league /drafts resolution (real data) ===');
  const {draftId,status}=await app.resolveLeagueDraft(LEAGUE);
  chk(draftId==='1180564550988939265','resolved the correct draft_id from /drafts');
  chk(status==='complete','read status=complete from the draft object');
  console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'FAIL'));
})();
