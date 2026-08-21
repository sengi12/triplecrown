// Seed loaders finally adopt the seed's own season + state block: a 2030 seed must label
// itself 2030 (not the boot-time guess) and its state block must drive phase gating.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){}};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  TC_SEASON, tryAutoLoadSeed, hasSeasonStarted,
  getProj:()=>PROJ_SEASON, getSharp:()=>SHARP_SEASON };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

(async()=>{
  const payload={
    season:2030,
    state:{season:2030, season_type:'regular', week:7, asof:'2030-10-20T09:00:00Z'},
    ecr:{half_ppr:{'test player':{rank_ecr:1,tier:1}}},
  };
  const got=await app.tryAutoLoadSeed(payload);
  chk(got===true,'seed with ECR accepted');
  chk(app.getProj()===2030,'PROJ_SEASON follows the seed (2030)');
  chk(app.getSharp()===2029,'SHARP_SEASON re-derived (2029)');
  chk(app.TC_SEASON.year===2030 && app.TC_SEASON.phase==='regular' && app.TC_SEASON.week===7,
    'seed state block adopted (year/phase/week)');
  chk(app.hasSeasonStarted()===true,'phase gating live off the adopted state');
  console.log(`\n${pass}/${total}`);
  if(pass!==total) process.exit(1);
})().catch(e=>{ console.log('  FAIL: unhandled', e.message); process.exit(1); });
