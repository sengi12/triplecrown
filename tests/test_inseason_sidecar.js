// In-season sidecar wiring on the app side: adoption merges adv_weekly under NFLVERSE for
// the existing decoders, the embedded (baked) path adopts without a fetch, reset clears it,
// and the gz-URL builder keeps a cache-busting query AFTER the .gz extension.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){}};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};
const fetched=[];
global.fetch=(url)=>{ fetched.push(String(url)); return Promise.reject(new Error('no net')); };
global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  _adoptInseason, ensureInseasonSidecar, resetNflverseLazy, fetchSeedJson,
  getInseason:()=>TC_INSEASON, getNflverse:()=>NFLVERSE,
  embedInseason:(p)=>{Object.assign(SEED_NFLVERSE_INSEASON,p);} };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

(async()=>{
  console.log('=== adoption + NFLVERSE merge ===');
  const payload={v:1, season:2026, weeks:[1,2], asof:'2026-09-22T09:00:00Z',
    adv_weekly:{'2026':{CIN:{off_plays:[1,2]}}},
    player_weekly:{cols:['tgt'], players:{}},
    def_vs_pos:{cols:['tgt'], teams:{}},
    schedule:{CIN:{'3':'PIT'}}};
  chk(app._adoptInseason(payload)===true,'payload adopted');
  chk(app.getInseason().weeks.length===2,'TC_INSEASON carries the weeks stamp');
  chk(!!(app.getNflverse()['2026'] && app.getNflverse()['2026'].adv_weekly),'adv_weekly merged under NFLVERSE[season]');
  chk(app._adoptInseason({})===false,'season-less payload rejected');

  console.log('=== reset ===');
  app.resetNflverseLazy();
  chk(app.getInseason()===null,'reset clears TC_INSEASON');

  console.log('=== embedded (baked) path ===');
  app.embedInseason(payload);
  const ok=await app.ensureInseasonSidecar();
  chk(ok===true,'embedded payload adopted without any fetch');
  chk(fetched.filter(u=>u.includes('inseason')).length===0,'no network hit on the baked path');

  console.log('=== gz URL with query ===');
  await app.fetchSeedJson('seeds/triplecrown_seed.inseason.json?wk=5').catch(()=>{});
  const gz=fetched.find(u=>u.includes('inseason') && u.includes('.gz'));
  chk(!!gz && gz.endsWith('.json.gz?wk=5'),'query rides AFTER the .gz extension');

  console.log(`\n${pass}/${total}`);
  if(pass!==total) process.exit(1);
})().catch(e=>{ console.log('  FAIL: unhandled', e.message); process.exit(1); });
