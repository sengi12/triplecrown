const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  assembleSeed, assembleSeedFromRecords, ensureTeam, normalizeSleeperRow,
  setProj:(s)=>{SEED=s;projSeed=s;seasonStatsCache.proj=s;workingProj={};userProj=workingProj;activeSeason='proj';},
  setRefCache:(season,seed)=>{seasonStatsCache[season]=seed;},
  enterRef:(season)=>{ if(activeSeason==='proj')workingProj=userProj; activeSeason=season; SEED=seasonStatsCache[season]; referenceProj={}; userProj=referenceProj; },
  backToProj:()=>{ activeSeason='proj'; SEED=projSeed; userProj=workingProj; },
  selectTeam:t=>{currentTeam=t;ensureTeam(t);},
  getUser:()=>userProj, getWorking:()=>workingProj, getActiveSeason:()=>activeSeason };
`)();

// Build 2026 proj seed
const players={'1':{player_id:'1',name:'QB One',pos:'QB',team:'KC'},'2':{player_id:'2',name:'WR One',pos:'WR',team:'KC'}};
const projIdx={'1':app.normalizeSleeperRow({player_id:'1',team:'KC',position:'QB',stats:{pass_yd:4800,pass_att:580,gp:17}}),
  '2':app.normalizeSleeperRow({player_id:'2',team:'KC',position:'WR',stats:{rec:100,rec_yd:1400,rec_td:10,gp:17}})};
app.setProj(app.assembleSeed(players,projIdx));
app.selectTeam('KC');

// Edit the working set: bump QB pass yards
const w=app.getWorking()['KC'];
w.qbs[0].passing_yards=5500;
console.log('Working set KC QB pass yds set to:', w.qbs[0].passing_yards);

// Build a 2024 reference seed (different numbers)
const ref2024=app.assembleSeed(players,{'1':app.normalizeSleeperRow({player_id:'1',team:'KC',position:'QB',stats:{pass_yd:4200,pass_att:560,gp:17}})});
app.setRefCache('2024',ref2024);

// Switch to 2024 reference
app.enterRef('2024');
app.selectTeam('KC');
console.log('In 2024 reference mode, activeSeason:', app.getActiveSeason());
const refKC=app.getUser()['KC'];
console.log('Reference KC QB pass yds:', refKC.qbs[0].passing_yards, '(should be 4200, the actual 2024)');

// Switch back to proj
app.backToProj();
app.selectTeam('KC');
const back=app.getWorking()['KC'];
console.log('Back in proj, working KC QB pass yds:', back.qbs[0].passing_yards, '(should STILL be 5500)');
console.log('RESULT:', back.qbs[0].passing_yards===5500 && refKC.qbs[0].passing_yards===4200 ? 'PASS (working set preserved through reference view)':'FAIL');
