const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  assembleSeed, normalizeSleeperRow, buildPlayerList, calcFpts,
  setProj:(s)=>{SEED=s;projSeed=s;seasonStatsCache.proj=s;workingProj={};userProj=workingProj;activeSeason='proj';},
  setRefCache:(season,seed)=>{seasonStatsCache[season]=seed;HISTORY_SEASONS=[season];},
  setFmt:(f)=>{rankFormat=f;const p=FORMAT_PRESETS[f];if(p)Object.assign(scoringSettings,p);},
  getScoring:()=>scoringSettings, vacatedProduction,
  selectTeam:t=>{currentTeam=t;ensureTeam(t);}, ensureTeam,
  setScope:(s)=>{rankScope=s;}, getRankFormat:()=>rankFormat };
`)();

console.log('=== TEST 1: format presets change reception scoring ===');
app.setFmt('ppr'); console.log('PPR receptions:', app.getScoring().receptions);
app.setFmt('half_ppr'); console.log('Half PPR receptions:', app.getScoring().receptions);
app.setFmt('std'); console.log('Standard receptions:', app.getScoring().receptions);
const ok1=app.getScoring().receptions===0;
app.setFmt('ppr'); const ok1b=app.getScoring().receptions===1.0;
console.log('RESULT:', ok1&&ok1b?'PASS (presets apply)':'FAIL');

console.log('\n=== TEST 2: scoring actually changes fantasy points ===');
const players={'1':{player_id:'1',name:'WR Test',pos:'WR',team:'KC'},'q':{player_id:'q',name:'KC QB',pos:'QB',team:'KC'}};
const idx={'1':app.normalizeSleeperRow({player_id:'1',team:'KC',position:'WR',stats:{rec:100,rec_yd:1300,rec_td:10,gp:17}}),'q':app.normalizeSleeperRow({player_id:'q',team:'KC',position:'QB',stats:{pass_yd:4500,pass_att:560,pass_td:30,gp:17}})};
app.setProj(app.assembleSeed(players,idx));
app.selectTeam('KC');
app.setFmt('ppr');
const pprList=app.buildPlayerList();
const pprPts=pprList.find(p=>p.name==='WR Test').fpts;
app.setFmt('std');
const stdList=app.buildPlayerList();
const stdPts=stdList.find(p=>p.name==='WR Test').fpts;
console.log(`WR with 100 rec: PPR=${pprPts.toFixed(1)} pts, Standard=${stdPts.toFixed(1)} pts`);
console.log(`Difference: ${(pprPts-stdPts).toFixed(1)} (should be ~100 = 100 rec × 1 pt)`);
console.log('RESULT:', Math.abs((pprPts-stdPts)-100)<1?'PASS (PPR adds reception points)':'FAIL');

console.log('\n=== TEST 3: vacated production (Bears lose DJ Moore) ===');
// 2026 Bears roster: no DJ Moore. 2025 Bears: had DJ Moore.
const proj2026={CHI:{QB:[{player_id:'qb',name:'Caleb',pos:'QB',team:'CHI'}],WR:[{player_id:'wr2',name:'Rome',pos:'WR',team:'CHI',receiving_targets:120,receptions:80,receiving_yards:1000,receiving_tds:7}],RB:[],TE:[]}};
['ATL','BUF','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS','ARI','BAL','CAR'].forEach(t=>proj2026[t]={QB:[],RB:[],WR:[],TE:[]});
app.setProj(proj2026);
const ref2025={CHI:{QB:[],WR:[
  {player_id:'moore',name:'DJ Moore',pos:'WR',team:'CHI',receiving_targets:140,receptions:98,receiving_yards:1364,receiving_tds:8},
  {player_id:'wr2',name:'Rome',pos:'WR',team:'CHI',receiving_targets:90,receptions:60,receiving_yards:700,receiving_tds:4}
],RB:[],TE:[]}};
['ATL','BUF','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS','ARI','BAL','CAR'].forEach(t=>ref2025[t]={QB:[],RB:[],WR:[],TE:[]});
app.setRefCache('2025',ref2025);
const vac=app.vacatedProduction('CHI');
console.log('Vacated:', vac?`${vac.tgt} tgt, ${vac.rec} rec, ${vac.yds} yds, ${vac.td} TD by ${vac.players.join(',')}`:'none');
console.log('RESULT:', vac&&vac.tgt===140&&vac.players.includes('DJ Moore')&&!vac.players.includes('Rome')?'PASS (DJ Moore vacated, Rome retained)':'FAIL');

console.log('\n=== TEST 4: team-scoped rankings ===');
app.setProj(app.assembleSeed({'1':{player_id:'1',name:'KC WR',pos:'WR',team:'KC'},'2':{player_id:'2',name:'SF WR',pos:'WR',team:'SF'}},
  {'1':app.normalizeSleeperRow({player_id:'1',team:'KC',position:'WR',stats:{rec:90,rec_yd:1200,rec_td:8,gp:17}}),
   '2':app.normalizeSleeperRow({player_id:'2',team:'SF',position:'WR',stats:{rec:85,rec_yd:1100,rec_td:7,gp:17}})}));
app.selectTeam('KC');
const allList=app.buildPlayerList();
console.log('Full list has both teams:', allList.length>=2?'yes':'no');
console.log('RESULT:', allList.some(p=>p.team==='KC')&&allList.some(p=>p.team==='SF')?'PASS (buildPlayerList has all)':'FAIL');
