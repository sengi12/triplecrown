const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  assembleSeed, normalizeSleeperRow, setSEED:(s)=>{SEED=s;seasonStatsCache.proj=s;},
  initPassingShares, teamTargetPool, ensureTeam, selectTeam:t=>{currentTeam=t;ensureTeam(t);},
  getProj:()=>userProj };
`)();
const players={ wr1:{player_id:'wr1',name:'WR1',pos:'WR',team:'KC'}, qb:{player_id:'qb',name:'QB1',pos:'QB',team:'KC'} };
const idx={
  wr1:app.normalizeSleeperRow({player_id:'wr1',team:'KC',position:'WR',stats:{rec_tgt:140,rec:100,rec_yd:1400,rec_td:10,gp:17}}),
  qb:app.normalizeSleeperRow({player_id:'qb',team:'KC',position:'QB',stats:{pass_yd:4500,pass_att:560,gp:17}}),
};
app.setSEED(app.assembleSeed(players,idx));
app.selectTeam('KC');
app.initPassingShares('KC');
const st=app.getProj()['KC'];
const pool0=app.teamTargetPool(st);
console.log('Initial pool (= actual 140):', pool0);
// Now simulate a QB-attempt edit: bump attempts from 560 to 700 (+25%)
st.qbs[0].passing_attempts=700;
const pool1=app.teamTargetPool(st);
console.log('After bumping QB att 560→700, pool scales to:', pool1, '(expect ~175 = 140*700/560)');
console.log('RESULT:', Math.abs(pool1-175)<=2?'PASS (cascades in projection mode)':'FAIL');
