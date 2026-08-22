// Projected-season OL ranks must come from the PROJECTED STARTERS' grades, not last
// season's team result — and must not pretend to while the ESPN depth charts are still
// loading. Runs the real app code against the shipped seed.
const elStore={};
function mkEl(id){
  if(!elStore[id]) elStore[id]={
    innerHTML:'',style:{},textContent:'',value:'',disabled:false,dataset:{},
    classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},
    appendChild(){},querySelectorAll:()=>[],addEventListener(){}
  };
  return elStore[id];
}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={};}abort(){}};

const fs=require('fs'), path=require('path');
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  proj:()=>_olProjectedTeamNext(), cov:()=>_olProjCoverage(),
  setNflverse:(n)=>{NFLVERSE=n; _olProjCache=null;},
  setDepth:(d,r)=>{espnDepth=d; espnRosters=r||{}; _olProjCache=null;},
  stopFetch:()=>{fetchEspnDepth=async()=>null;},
  line:(s,t)=>_olLineByTeamSeason(s,t),
  projSeason:()=>OL_PROJ_SEASON,
  rbChart:(pid,norm)=>_rbProjectedChart(pid,norm),
  setPlayers:(p)=>{sleeperPlayers=p;},
};`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const seedPath=path.join(__dirname,'..','seeds','triplecrown_seed.json');
if(!fs.existsSync(seedPath)){ console.log('  SKIP: no seed'); process.exit(0); }
const raw=JSON.parse(fs.readFileSync(seedPath,'utf8'));
const {decodeAnySeed}=require('../src/js/15b-nflverse-lazy.js');
const j=decodeAnySeed(raw);
app.setNflverse(j.nflverse.years||j.nflverse);
app.stopFetch();
const PS=app.projSeason();
const base=String(Number(PS)-1);
const teams=Object.keys(app.proj());
console.log(`=== TEST: OL projection (${PS}, baseline ${base}, ${teams.length} teams) ===`);
chk(teams.length>=30,'projection covers the league from the seed alone');

// 1) Nothing loaded from ESPN yet: the unloaded-line object is truthy but empty.
app.setDepth({}, {});
const l=app.line(PS,'LAC');
chk(l && !['LT','LG','C','RG','RT'].some(s=>l[s]&&l[s].name),'projection-season line is empty before ESPN loads');
let p=app.proj();
chk(p.LAC && p.LAC.ranksStable===false && p.LAC.depthCovered===0,'ranks flagged unstable with zero depth-chart coverage');
chk(teams.every(t=>p[t].passRank===p[t].baselinePassRank),'unstable → pass rank falls back to baseline rank for every team');
chk(teams.every(t=>p[t].runRank===p[t].baselineRunRank),'unstable → run rank falls back to baseline rank for every team');
chk(p.LAC.passTbl.teams.LAC.ranks['Pass Score']===p.LAC.baselinePassRank,'QB-tab table rank also shows baseline while unstable');
chk(app.cov().stable===false && app.cov().covered===0,'_olProjCoverage reports 0 covered');

// 2) Depth charts for only 5 teams: the 5 must NOT sweep the top ranks.
const bestByTeam=(tm)=>{
  // build a depth chart from the baseline line so the names resolve to graded players
  const bl=app.line(base,tm);
  return ['lt','lg','c','rg','rt'].map(k=>({slot:k,label:k.toUpperCase(),unit:'offense',
    players: bl[k.toUpperCase()]&&bl[k.toUpperCase()].name ? [{name:bl[k.toUpperCase()].name,pos:k.toUpperCase()}] : []}));
};
const partial={};
['LAC','DET','GB','PIT','KC'].forEach(t=>{ partial[t]=bestByTeam(t); });
app.setDepth(partial, {});
p=app.proj();
chk(p.LAC.depthCovered===5 && p.LAC.ranksStable===false,'5/32 coverage is still unstable');
chk(p.LAC.depthKnown===true && p.NE.depthKnown===false,'depthKnown is per team');
chk(p.LAC.passRank===p.LAC.baselinePassRank,'partially-hydrated league keeps baseline ranks');

// 3) Full coverage: ranks come from the projected starters.
const full={};
teams.forEach(t=>{ full[t]=bestByTeam(t); });
// Give LAC its healthy tackles back: the two best-graded tackles in the seed.
const pl=(app.proj().LAC, (j.nflverse.years||j.nflverse)[base].ol_players);
const tackles=Object.values(pl).filter(r=>/T/.test(String(r.pos||'')) && r.pass_pctile!=null).sort((a,b)=>b.pass_pctile-a.pass_pctile);
full.LAC=full.LAC.map(r=>{
  if(r.slot==='lt') return Object.assign({},r,{players:[{name:tackles[0].name,pos:'LT'}]});
  if(r.slot==='rt') return Object.assign({},r,{players:[{name:tackles[1].name,pos:'RT'}]});
  return r;
});
app.setDepth(full, {});
p=app.proj();
chk(p.LAC.ranksStable===true && p.LAC.depthCovered===teams.length,'full coverage → ranks stable');
chk(p.LAC.passRank < p.LAC.baselinePassRank,`LAC with elite tackles projects better than baseline (#${p.LAC.passRank} vs #${p.LAC.baselinePassRank})`);
chk(p.LAC.passTbl.teams.LAC.ranks['Pass Score']===p.LAC.passRank,'QB-tab table rank equals projected rank when stable');
const moved=teams.filter(t=>p[t].passRank!==p[t].baselinePassRank).length;
chk(moved>0,`projected ranks move off baseline for ${moved} teams`);
chk(app.cov().stable===true,'_olProjCoverage reports stable');

// 4) ESPN returned a roster but no depth chart → talent-first roster fallback.
const rosterOnly={};
teams.forEach(t=>{ rosterOnly[t]=full[t]; });
rosterOnly.LAC=null;
const lacRoster=[
  {name:tackles[0].name,pos:'OT',exp:5,status:'active'},
  {name:tackles[1].name,pos:'OT',exp:4,status:'active'},
  {name:'Some Backup',pos:'OT',exp:1,status:'active'},
  {name:'Zion Johnson',pos:'G',exp:4,status:'active'},
  {name:'Mekhi Becton',pos:'G',exp:6,status:'active'},
  {name:'Bradley Bozeman',pos:'C',exp:8,status:'active'},
];
app.setDepth(rosterOnly, {LAC:lacRoster});
p=app.proj();
const fl=p.LAC.line;
chk(p.LAC.depthKnown===true,'roster-only team still counts as covered');
chk(fl.LT && fl.RT && [fl.LT.name,fl.RT.name].includes(tackles[0].name) && [fl.LT.name,fl.RT.name].includes(tackles[1].name),'roster fallback picks the best-graded tackles, not the backup');
chk(fl.C && fl.C.name==='Bradley Bozeman','roster fallback respects position family');

// 5) RB rushing fan uses the projected rank, not the baseline rank.
app.setDepth(full, {});
app.setPlayers({'rb1':{name:'Omarion Hampton',pos:'RB',position:'RB',team:'LAC'}});
const ch=app.rbChart('rb1','omarion hampton');
chk(!!ch && ch.run_rank===app.proj().LAC.runRank,'RB fan run_rank is the projected rank');
chk(!!ch && ch.baseline_run_rank===app.proj().LAC.baselineRunRank,'RB fan carries the baseline rank separately');

console.log(`\n${pass}/${total} passed`);
process.exit(pass===total?0:1);
