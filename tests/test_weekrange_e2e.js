const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};
global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  assembleSeed, normalizeSleeperRow, ensureTeam, initPassingShares, teamTargetPool, teamRecYardsPool,
  setSEED:(s)=>{SEED=s;projSeed=s;seasonStatsCache.proj=s;workingProj={};userProj=workingProj;activeSeason='2025';referenceProj=workingProj;},
  selectTeam:t=>{currentTeam=t;ensureTeam(t);},
  setWeekFilterDirect:(team,lo,hi,skillData,qbPool)=>{
    const st=userProj[team];
    st.weekFilter=[lo,hi]; st.weekFilterData=skillData; st.weekFilterQBPool=qbPool;
    st.passing_shares=null; initPassingShares(team);
  },
  getProj:()=>userProj };
`)();

const players={q:{player_id:'q',name:'QB',pos:'QB',team:'GB'},
  '9484':{player_id:'9484',name:'Tucker Kraft',pos:'TE',team:'GB'},
  wr2:{player_id:'wr2',name:'WR2',pos:'WR',team:'GB'}};
const idx={q:app.normalizeSleeperRow({player_id:'q',team:'GB',position:'QB',stats:{pass_yd:4000,pass_att:550,pass_cmp:380,pass_td:28,gp:17}}),
  9484:app.normalizeSleeperRow({player_id:'9484',team:'GB',position:'TE',stats:{rec:60,rec_tgt:90,rec_yd:800,rec_td:7,gp:17}}),
  wr2:app.normalizeSleeperRow({player_id:'wr2',team:'GB',position:'WR',stats:{rec:70,rec_tgt:100,rec_yd:900,rec_td:6,gp:17}})};
app.setSEED(app.assembleSeed(players,idx));
app.selectTeam('GB');
app.initPassingShares('GB');

console.log('=== Full season (no filter) ===');
const st=app.getProj()['GB'];
console.log('Pool (rec yds available):', app.teamRecYardsPool(st));
const kraftFull=st.passing_shares.find(p=>p.name==='Tucker Kraft');
console.log('Kraft full-season targets:', kraftFull.baseline_targets, 'yards:', kraftFull.baseline_yards);

console.log('\n=== Apply week 1-9 filter (Kraft hot stretch, QB also windowed) ===');
const skillData={'9484':{receiving_targets:44,receptions:32,receiving_yards:489,receiving_tds:6,rushing_attempts:1,rushing_yards:3,rushing_tds:0,games_played:8}};
// QB pool for weeks 1-9 only (smaller subset of season)
const qbPoolFiltered={pass_yards:2100, pass_att:290, pass_tds:15, comp:200};
app.setWeekFilterDirect('GB',1,9,skillData,qbPoolFiltered);

const kraftFiltered=st.passing_shares.find(p=>p.name==='Tucker Kraft');
console.log('Kraft windowed targets:', kraftFiltered.baseline_targets, '(expect 44)');
console.log('Kraft windowed yards:', kraftFiltered.baseline_yards, '(expect 489)');
console.log('Pool (rec yds available) now:', app.teamRecYardsPool(st), '(expect 2100, the QB windowed total)');
console.log('Kraft share of windowed pool:', (kraftFiltered.share*100).toFixed(1)+'%');

const ok = kraftFiltered.baseline_targets===44 && kraftFiltered.baseline_yards===489 && app.teamRecYardsPool(st)===2100;
console.log('\nRESULT:', ok?'PASS (week filter flows through pools + shares correctly)':'FAIL');
