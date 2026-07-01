const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};
// Mock fetch to return a seed with ECR
let fetchMode='success';
global.fetch=(url)=>{
  if(fetchMode==='fail') return Promise.reject(new Error('CORS'));
  if(fetchMode==='404') return Promise.resolve({ok:false});
  return Promise.resolve({ok:true, json:()=>Promise.resolve({
    season:2026, ecr:{half_ppr:{'jamarr chase':{rank_ecr:1,tier:1}}}, seed:{}, history:{}, history_seasons:[]
  })});
};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
// Suppress the auto-boot IIFE side effects by checking tryAutoLoadSeed directly
const app=new Function(code+`return { tryAutoLoadSeed, getECR:()=>ECR, ecrTableFor };`)();

(async()=>{
  console.log('=== TEST: auto-load seed with ECR (http success) ===');
  fetchMode='success';
  const loaded=await app.tryAutoLoadSeed();
  const ecr=app.getECR();
  console.log('Loaded:', loaded, '| ECR half_ppr keys:', Object.keys(ecr.half_ppr||{}).length);
  console.log('RESULT:', loaded===true && ecr.half_ppr && ecr.half_ppr['jamarr chase']?'PASS (ECR auto-loaded)':'FAIL');

  console.log('\n=== TEST: graceful CORS reject on file:// (CORS reject) ===');
  fetchMode='fail';
  const loaded2=await app.tryAutoLoadSeed();
  console.log('Loaded (expect false):', loaded2);
  console.log('RESULT:', loaded2===false?'PASS (graceful CORS fallback)':'FAIL');

  console.log('\n=== TEST: graceful handling of 404 ===');
  fetchMode='404';
  const loaded3=await app.tryAutoLoadSeed();
  console.log('Loaded (expect false):', loaded3);
  console.log('RESULT:', loaded3===false?'PASS (404 handled)':'FAIL');
})();
