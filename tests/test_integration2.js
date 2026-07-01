global.document = {
  getElementById: (id) => ({ innerHTML:'', style:{}, textContent:'', value: id==='scenarioName'?'Test':'', classList:{add(){},remove(){}} }),
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ click(){}, style:{}, appendChild(){} }),
  activeElement: null, body:{appendChild(){},removeChild(){}},
};
global.window = { getSelection:()=>({removeAllRanges(){},addRange(){}}) };
global.Chart = function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true; global.btoa=s=>Buffer.from(s,'binary').toString('base64');
global.FileReader=function(){}; global.Range=function(){};

const fs=require('fs');
// Wrap code in a function that returns the internals we want to inspect
const code = fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const wrapped = new Function(code + `
  return { loadProjections, buildPlayerList, ecrFor, setECR:(e)=>{ECR=e;},
    getProj: ()=>userProj, getSnapshot: ()=>importedSnapshot, getDirty: ()=>dirtySinceImport,
    setFormat: f=>{rankFormat=f;} };
`);
const app = wrapped();

const data = JSON.parse(fs.readFileSync('/mnt/user-data/uploads/season_projections.json','utf8'));
console.log('Loading', data.projections.length, 'rows...');
app.loadProjections(data);

const userProj = app.getProj();
console.log('Teams loaded:', Object.keys(userProj).length);

const lv = userProj['LV'];
console.log('\nLV QBs:', lv.qbs.map(q=>`${q.name} (${Math.round(q.passing_yards)}yds)`).join(', '));
console.log('  multi-QB:', lv.qbs.length===2?'PASS':'CHECK ('+lv.qbs.length+')');
const lvNames = lv.passing_shares?lv.passing_shares.map(p=>p.name):[];
const lvDupes = lvNames.filter((n,i)=>lvNames.indexOf(n)!==i);
console.log('  receiver dupes:', lvDupes.length===0?'PASS (deduped)':'FAIL: '+lvDupes.join(','));

const lar = userProj['LAR'];
const adams = lar.passing_shares?lar.passing_shares.find(p=>p.name==='Davante Adams'):null;
if(adams){
  console.log('\nDavante Adams (LAR): targets='+adams.baseline_targets.toFixed(1)+' (exp ~119), yards='+adams.baseline_yards.toFixed(0)+' (exp ~898)');
  console.log('  RESULT:', Math.abs(adams.baseline_targets-119)<1&&Math.abs(adams.baseline_yards-898)<2?'PASS':'CHECK');
}

const list = app.buildPlayerList();
list.sort((a,b)=>b.fpts-a.fpts);
console.log('\nTop 8 by fantasy points:');
list.slice(0,8).forEach((p,i)=>console.log(`  ${i+1}. ${p.name} (${p.pos} ${p.team}) — ${p.fpts.toFixed(1)}`));

const cmc=list.find(p=>p.name==='Christian McCaffrey');
if(cmc){
  app.setECR({ppr:{'christian mccaffrey':{rank_ecr:1,tier:1}},std:{'christian mccaffrey':{rank_ecr:5,tier:1}}});
  app.setFormat('ppr');
  const ppr=app.ecrFor(cmc);
  app.setFormat('std');
  const std=app.ecrFor(cmc);
  console.log('\nCMC ECR: PPR='+ppr+', Standard='+std, (ppr!==std&&ppr===1)?'PASS (format switches ECR)':'CHECK');
}

console.log('\nSnapshot saved:', app.getSnapshot()?'PASS':'FAIL');
console.log('Dirty flag false after import:', app.getDirty()===false?'PASS':'FAIL');

// Count total players, check for any NaN fpts
const nanCount = list.filter(p=>isNaN(p.fpts)).length;
console.log('\nPlayers with NaN fpts:', nanCount, nanCount===0?'PASS':'FAIL');
console.log('Total players in rankings:', list.length);

console.log('\n=== INTEGRATION COMPLETE ===');
