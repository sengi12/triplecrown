const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};
// A baked file may attempt a NON-BLOCKING background fetch for the Sleeper roster DB
// (so copy-to-working can verify rosters). On file:// that fetch fails harmlessly. The
// guarantee we test: embedded data loads regardless of whether that fetch succeeds.
let fetchWasCalled=false;
global.fetch=()=>{fetchWasCalled=true;return Promise.reject(new Error('simulated file:// CORS block'));};
const fs=require('fs');
const path=require('path');
let code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
// Support both the old FFForge marker and the new TripleCrown marker.
const START = code.includes('TRIPLECROWN_SEED_START') ? '// ═══ TRIPLECROWN_SEED_START ═══' : '// ═══ FFFORGE_SEED_START ═══';
const END   = code.includes('TRIPLECROWN_SEED_END')   ? '// ═══ TRIPLECROWN_SEED_END ═══'   : '// ═══ FFFORGE_SEED_END ═══';
const embed=`${START}
const SEED_SEASON=2026;
const SEED_DATA={"CIN":{"QB":[{"name":"Joe Burrow","player_id":"6770","pos":"QB","team":"CIN","passing_yards":4800,"passing_attempts":620,"passing_touchdowns":38,"games_played":17}],"WR":[],"RB":[],"TE":[]}};
const SEED_HISTORY={};
const SEED_HISTORY_SEASONS=["2025"];
const SEED_ECR={"half_ppr":{"joe burrow":{"rank_ecr":40,"tier":5,"age":29}}};
const SEED_CONTRACTS={};
${END}`;
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const re=new RegExp(esc(START)+'[\\s\\S]*?'+esc(END));
code=code.replace(re,embed);

const app=new Function(code+`return { getSEED:()=>SEED, getECR:()=>ECR, ecrFor, setFormat:(f)=>{rankFormat=f;} };`)();
setTimeout(()=>{
  const seed=app.getSEED(), ecr=app.getECR();
  app.setFormat('half_ppr');
  const burrowECR=app.ecrFor({name:'Joe Burrow'});
  console.log('Embedded SEED has CIN/Burrow:', !!(seed.CIN&&seed.CIN.QB[0]));
  console.log('Embedded ECR Burrow rank:', burrowECR, '(expect 40)');
  console.log('Background fetch attempted (allowed, non-blocking):', fetchWasCalled);
  // The key guarantee: embedded projections + ECR are present in memory, even though the
  // background roster fetch was rejected (simulating phone file-protocol).
  const ok=seed.CIN&&seed.CIN.QB[0].passing_yards===4800&&burrowECR===40;
  console.log('RESULT:', ok?'PASS (baked data self-contained; boot survives blocked background fetch)':'FAIL');
},50);
