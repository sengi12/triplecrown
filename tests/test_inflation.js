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
  initPassingShares, teamTargetPool, teamPassAtt, ensureTeam, selectTeam:t=>{currentTeam=t;ensureTeam(t);},
  getProj:()=>userProj };
`)();

console.log('=== TEST: Chase 2025 actuals not inflated ===');
// Simulate 2025 Bengals: Burrow hurt, played ~9 games. Chase had (hypothetically) realistic 2025 line.
// Real-ish 2025: Chase ~120 targets, ~1100 yds. Plus other receivers.
const players={
  chase:{player_id:'chase',name:"Ja'Marr Chase",pos:'WR',team:'CIN'},
  higgins:{player_id:'higgins',name:'Tee Higgins',pos:'WR',team:'CIN'},
  burrow:{player_id:'burrow',name:'Joe Burrow',pos:'QB',team:'CIN'},
  browning:{player_id:'browning',name:'Jake Browning',pos:'QB',team:'CIN'},
};
const idx={
  chase:app.normalizeSleeperRow({player_id:'chase',team:'CIN',position:'WR',stats:{rec_tgt:120,rec:85,rec_yd:1100,rec_td:9,gp:16}}),
  higgins:app.normalizeSleeperRow({player_id:'higgins',team:'CIN',position:'WR',stats:{rec_tgt:90,rec:60,rec_yd:820,rec_td:6,gp:14}}),
  burrow:app.normalizeSleeperRow({player_id:'burrow',team:'CIN',position:'QB',stats:{pass_yd:2400,pass_att:330,gp:9}}),
  browning:app.normalizeSleeperRow({player_id:'browning',team:'CIN',position:'QB',stats:{pass_yd:1900,pass_att:260,gp:8}}),
};
const seed=app.assembleSeed(players,idx);
app.setSEED(seed);
app.selectTeam('CIN');
app.initPassingShares('CIN');
const state=app.getProj()['CIN'];
const pool=app.teamTargetPool(state);
console.log('Team pass att (Burrow+Browning):', app.teamPassAtt(state));
console.log('Target pool (should ≈ sum of receiver targets = 210):', pool);
// Chase projected targets = share * pool
const chase=state.passing_shares.find(p=>p.name==="Ja'Marr Chase");
const projTgts=Math.round(chase.share*pool);
const projYds=Math.round(projTgts*chase.ypt);
console.log(`Chase: ${projTgts} targets, ${projYds} yards (actual was 120 tgt / 1100 yds)`);
console.log('RESULT:', Math.abs(projTgts-120)<=2 && Math.abs(projYds-1100)<=20 ? 'PASS (matches actuals)' : 'FAIL (inflated)');

console.log('\n=== TEST: old bug would have inflated via pass-att*0.95 ===');
const oldPool=Math.round(app.teamPassAtt(state)*0.95);
const oldProjTgts=Math.round(chase.share*oldPool);
console.log(`Old formula pool: ${oldPool}, Chase old projTgts: ${oldProjTgts} (inflated)`);
console.log('Confirms old bug:', oldProjTgts>140?'YES (old=inflated, new=correct)':'n/a');
