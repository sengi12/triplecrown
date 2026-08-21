// Live current-season stats layer: raw Sleeper stat keys must survive into HISTORY (the
// red-zone/air-yard readers depend on them), the merge must never touch the working
// projections, and the once-per-completed-week guard must hold.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){}};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  TC_SEASON, liveSeasonRecordsFromRows, refreshLiveSeasonStats, liveSeasonEpoch,
  setSleeperFetch:(f)=>{sleeperFetch=f;},
  getHistory:()=>HISTORY, getHistSeasons:()=>HISTORY_SEASONS,
  getWorking:()=>workingProj, setWorking:(w)=>{workingProj=w;} };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const ROWS=[
  {player_id:'123', team:'CIN', position:'WR', player:{first_name:'Test', last_name:'Receiver'},
   stats:{gp:2, gs:2, rec:15, rec_yd:230, rec_td:3, rec_tgt:20, rec_rz_tgt:5, rec_air_yd:200, off_snp:100, tm_off_snp:120}},
  {player_id:'456', team:'CIN', position:'QB', player:{first_name:'Test', last_name:'Passer'},
   stats:{gp:2, pass_att:70, pass_cmp:45, pass_yd:520, pass_td:4, pass_int:1}},
  {player_id:'999', team:'CIN', position:'K', stats:{gp:2}},           // non-fantasy pos dropped
  {player_id:'888', team:'CIN', position:'WR', stats:{}},              // uninvolved dropped
];

(async()=>{
  console.log('=== pure record shaping ===');
  const recs=app.liveSeasonRecordsFromRows(ROWS);
  chk(recs.length===2,'K and uninvolved rows filtered out');
  const wr=recs.find(r=>r.pid==='123');
  chk(wr && wr.stats.rec_rz_tgt===5 && wr.stats.rec_air_yd===200,'RAW Sleeper keys preserved (rec_rz_tgt, rec_air_yd)');
  chk(wr.stats.receiving_yards===230 && wr.stats.games_played===2,'mapped names overlaid for the seed assembler');
  chk(Math.abs(wr.snap_pct-100/120)<1e-9,'snap_pct derived from off_snp/tm_off_snp');

  console.log('=== gating ===');
  app.TC_SEASON.phase='off'; app.TC_SEASON.week=0;
  chk(await app.refreshLiveSeasonStats()===false,'no-op before the season starts');

  console.log('=== merge + isolation ===');
  app.TC_SEASON.year=2026; app.TC_SEASON.phase='regular'; app.TC_SEASON.week=3;
  app.setWorking({CIN:{marker:'untouched'}});
  const workingBefore=JSON.stringify(app.getWorking());
  // Count ONLY the season-stats endpoint — the boot IIFE's background chain also goes
  // through sleeperFetch and would otherwise pollute the counter.
  let fetches=0;
  app.setSleeperFetch(async(url)=>{
    if(String(url).includes('stats/nfl/2026')){ fetches++; return ROWS; }
    throw new Error('unexpected url in test: '+url);
  });
  chk(await app.refreshLiveSeasonStats()===true,'first in-season refresh runs');
  const h=app.getHistory();
  chk(!!(h['123'] && h['123']['2026']),'HISTORY gains the current season');
  chk(h['123']['2026'][0].stats.rec_rz_tgt===5,'raw keys survive the HISTORY merge');
  chk(app.getHistSeasons()[0]==='2026','current season prepended to HISTORY_SEASONS');
  chk(JSON.stringify(app.getWorking())===workingBefore,'workingProj untouched (deep-equal before/after)');
  chk(app.liveSeasonEpoch()===2,'epoch = completed weeks fetched');

  console.log('=== once-per-completed-week ===');
  chk(await app.refreshLiveSeasonStats()===false && fetches===1,'same completed week → no refetch');
  chk(await app.refreshLiveSeasonStats(true)===true && fetches===2,'force refetches');
  app.TC_SEASON.week=4;
  chk(await app.refreshLiveSeasonStats()===true && fetches===3,'week advance refetches');

  console.log(`\n${pass}/${total}`);
  if(pass!==total) process.exit(1);
})().catch(e=>{ console.log('  FAIL: unhandled', e.message); process.exit(1); });
