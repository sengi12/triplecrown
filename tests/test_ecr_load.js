const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');

// Simulate handleSeedLoad by invoking its inner logic via a FileReader mock
function makeApp(){
  return new Function(code+`
    return {
      loadSeedJSON:(j)=>{
        // mirror handleSeedLoad's body
        const hasSeed = j.seed && Object.keys(j.seed).length;
        const hasECR  = j.ecr && Object.keys(j.ecr).some(k=>j.ecr[k] && Object.keys(j.ecr[k]).length);
        if(!hasSeed && !hasECR) throw new Error('no seed or ecr');
        if(j.ecr) ECR=j.ecr;
        if(hasSeed){ SEED=j.seed; projSeed=SEED; seasonStatsCache={proj:SEED}; workingProj={}; userProj=workingProj; activeSeason='proj'; }
        return {hasSeed:!!hasSeed, hasECR:!!hasECR};
      },
      getECR:()=>ECR, hasECR, ecrFor, setFormat:(f)=>{rankFormat=f;} };
  `)();
}

console.log('=== TEST 1: seed WITH projections + ECR ===');
let app=makeApp();
app.setFormat('half_ppr');
const r1=app.loadSeedJSON({seed:{CIN:{QB:[{name:'Burrow',player_id:'b',pos:'QB',team:'CIN'}],WR:[],RB:[],TE:[]}},
  ecr:{half_ppr:{'jamarr chase':{rank_ecr:1,tier:1}}}});
console.log('hasSeed:',r1.hasSeed,'hasECR:',r1.hasECR,'| app.hasECR():',app.hasECR());
console.log('RESULT:', app.hasECR()?'PASS':'FAIL');

console.log('\n=== TEST 2: ECR-ONLY seed (no projections) — the likely bug ===');
app=makeApp();
app.setFormat('half_ppr');
let err=null, r2=null;
try{ r2=app.loadSeedJSON({ecr:{half_ppr:{'jamarr chase':{rank_ecr:1,tier:1},'joe burrow':{rank_ecr:40,tier:5}}}}); }
catch(e){ err=e.message; }
if(err){ console.log('THREW:', err, '→ FAIL (ECR-only should load)'); }
else { console.log('Loaded ECR-only ok · hasECR():', app.hasECR(), '· Chase ECR:', app.ecrFor({name:"Ja'Marr Chase"})); }
console.log('RESULT:', (!err && app.hasECR() && app.ecrFor({name:"Ja'Marr Chase"})===1)?'PASS (ECR-only seed loads)':'FAIL');

console.log('\n=== TEST 3: empty file rejected ===');
app=makeApp();
let err3=null;
try{ app.loadSeedJSON({foo:'bar'}); }catch(e){ err3=e.message; }
console.log('Rejected empty:', !!err3);
console.log('RESULT:', err3?'PASS (rejects junk)':'FAIL');
