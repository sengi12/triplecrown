const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  ecrNormName, ecrTableFor, ecrEntry, ecrFor, ecrTierFor, hasECR,
  setECR:(e)=>{ECR=e;}, setFormat:(f)=>{rankFormat=f;},
  getFormat:()=>rankFormat, getScoring:()=>scoringSettings,
  setRankFormat, syncFormatFromScoring, FORMAT_PRESETS,
  setReceptions:(v)=>{scoringSettings.receptions=v;},
  getSortKey:()=>rankSortKey };
`)();

console.log('=== TEST 1: ECR name normalization ===');
console.log("'Ja'Marr Chase Jr.' →", app.ecrNormName("Ja'Marr Chase Jr."));
console.log("'A.J. Brown' →", app.ecrNormName("A.J. Brown"));
const ok1 = app.ecrNormName("Ja'Marr Chase Jr.")==='jamarr chase' && app.ecrNormName("A.J. Brown")==='aj brown';
console.log('RESULT:', ok1?'PASS':'FAIL');

console.log('\n=== TEST 2: ECR lookup by format ===');
app.setECR({
  half_ppr:{'jamarr chase':{rank_ecr:3,tier:1,age:25}},
  ppr:{'jamarr chase':{rank_ecr:2,tier:1,age:25}},
  std:{'jamarr chase':{rank_ecr:8,tier:2,age:25}},
});
app.setFormat('half_ppr');
console.log('Half PPR ECR:', app.ecrFor({name:'Ja\'Marr Chase'}), '(expect 3)');
app.setFormat('ppr');
console.log('Full PPR ECR:', app.ecrFor({name:'Ja\'Marr Chase'}), '(expect 2)');
app.setFormat('std');
console.log('Standard ECR:', app.ecrFor({name:'Ja\'Marr Chase'}), 'tier:', app.ecrTierFor({name:'Ja\'Marr Chase'}), '(expect 8, tier 2)');
const ok2 = app.ecrFor({name:'JaMarr Chase'})===8;
console.log('RESULT:', ok2?'PASS (format switches ECR table)':'FAIL');

console.log('\n=== TEST 3: format → scoring sync ===');
app.setRankFormat('ppr');
console.log('Full PPR reception value:', app.getScoring().receptions, '(expect 1.0)');
app.setRankFormat('half_ppr');
console.log('Half PPR reception value:', app.getScoring().receptions, '(expect 0.5)');
app.setRankFormat('std');
console.log('Standard reception value:', app.getScoring().receptions, '(expect 0)');
const ok3 = app.getScoring().receptions===0;
console.log('RESULT:', ok3?'PASS (format sets reception value)':'FAIL');

console.log('\n=== TEST 4: scoring → format reverse sync ===');
app.setFormat('half_ppr');
app.setReceptions(1.0); app.syncFormatFromScoring();
console.log('Set rec=1.0 → format:', app.getFormat(), '(expect ppr)');
app.setReceptions(0); app.syncFormatFromScoring();
console.log('Set rec=0 → format:', app.getFormat(), '(expect std)');
app.setReceptions(0.5); app.syncFormatFromScoring();
console.log('Set rec=0.5 → format:', app.getFormat(), '(expect half_ppr)');
const ok4 = app.getFormat()==='half_ppr';
console.log('RESULT:', ok4?'PASS (reception value drives format label)':'FAIL');

console.log('\n=== TEST 5: default sort is ecr ===');
console.log('Default sort key:', app.getSortKey(), '(expect ecr)');
console.log('RESULT:', app.getSortKey()==='ecr'?'PASS':'FAIL');
