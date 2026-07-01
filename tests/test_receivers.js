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
  initPassingShares, ensureTeam, selectTeam:t=>{currentTeam=t;ensureTeam(t);}, getProj:()=>userProj };
`)();

console.log('=== TEST: 2026 projection feed WITHOUT targets (only receptions) ===');
const players={
  qb:{player_id:'qb',name:'QB1',pos:'QB',team:'KC'},
  wr1:{player_id:'wr1',name:'Tyreek Type',pos:'WR',team:'KC'},
  wr2:{player_id:'wr2',name:'Slot Guy',pos:'WR',team:'KC'},
  te:{player_id:'te',name:'Big TE',pos:'TE',team:'KC'},
};
// Projections with NO rec_tgt — this is what broke it
const idx={
  qb:app.normalizeSleeperRow({player_id:'qb',team:'KC',position:'QB',stats:{pass_yd:4600,pass_att:570,pass_td:36,gp:17}}),
  wr1:app.normalizeSleeperRow({player_id:'wr1',team:'KC',position:'WR',stats:{rec:95,rec_yd:1300,rec_td:10,gp:17}}),  // no rec_tgt!
  wr2:app.normalizeSleeperRow({player_id:'wr2',team:'KC',position:'WR',stats:{rec:70,rec_yd:780,rec_td:5,gp:17}}),
  te:app.normalizeSleeperRow({player_id:'te',team:'KC',position:'TE',stats:{rec:60,rec_yd:650,rec_td:6,gp:17}}),
};
const seed=app.assembleSeed(players,idx);
console.log('KC WRs in seed:', seed.KC.WR.map(p=>`${p.name} (${p.receiving_targets}tgt, ${p.receptions}rec)`).join(', '));
console.log('KC TE in seed:', seed.KC.TE.map(p=>`${p.name} (${p.receiving_targets}tgt)`).join(', '));

app.setSEED(seed);
app.selectTeam('KC');
app.initPassingShares('KC');
const st=app.getProj()['KC'];
const shares=st.passing_shares||[];
console.log('\nPassing shares (receivers on Targets tab):', shares.length);
shares.forEach(p=>console.log(`  ${p.name}: ${(p.share*100).toFixed(1)}% share, ${p.baseline_targets} tgt, ${p.baseline_rec} rec`));
console.log('\nRESULT:', shares.length===3?'PASS (all 3 receivers show)':'FAIL ('+shares.length+' receivers)');

// Verify derived targets are sensible (95 rec / 0.65 ≈ 146)
const wr1=shares.find(p=>p.name==='Tyreek Type');
console.log('WR1 derived targets:', wr1?wr1.baseline_targets:'N/A', '(expect ~146 from 95 rec)');
console.log('Derivation correct:', wr1 && Math.abs(wr1.baseline_targets-146)<5?'PASS':'CHECK');
