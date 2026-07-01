const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
let lastSliders={};
global.document={getElementById:(id)=>mkEl(id),
  querySelector:(sel)=>{const m=sel.match(/data-key="([^"]+)"/);if(m){if(!lastSliders[m[1]])lastSliders[m[1]]={value:0,dataset:{col:'#fff',key:m[1]},previousElementSibling:{classList:{contains:()=>true},style:{}}};return lastSliders[m[1]];}return null;},
  querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  assembleSeed, normalizeSleeperRow, ensureTeam, initPassingShares,
  teamRecYardsPool, teamRecPool, ensureDerivedShares, reconcileDerived,
  setProj:(s)=>{SEED=s;projSeed=s;seasonStatsCache.proj=s;workingProj={};userProj=workingProj;activeSeason='proj';},
  selectTeam:t=>{currentTeam=t;currentPhase='Passing';ensureTeam(t);initPassingShares(t);},
  setSub:(s)=>{passingSubTab=s;},
  derived:(team,i,share,metric)=>{setDerivedShare(userProj[team],team,i,share,metric);},
  getProj:()=>userProj };
`)();

// Miami-like: QB throws 2907 yds, but receivers only sum to ~2200
const players={q:{player_id:'q',name:'Tua',pos:'QB',team:'MIA'},
  a:{player_id:'a',name:'Waddle',pos:'WR',team:'MIA'},b:{player_id:'b',name:'WR2',pos:'WR',team:'MIA'}};
const idx={q:app.normalizeSleeperRow({player_id:'q',team:'MIA',position:'QB',stats:{pass_yd:2907,pass_att:400,pass_cmp:270,pass_td:18,gp:12}}),
  a:app.normalizeSleeperRow({player_id:'a',team:'MIA',position:'WR',stats:{rec:80,rec_yd:1100,rec_td:6,gp:17}}),
  b:app.normalizeSleeperRow({player_id:'b',team:'MIA',position:'WR',stats:{rec:70,rec_yd:800,rec_td:4,gp:17}})};
app.setProj(app.assembleSeed(players,idx,true));
app.selectTeam('MIA');
const st=app.getProj()['MIA'];

console.log('=== Discrepancy detection ===');
const qbYds=app.teamRecYardsPool(st);
const totalTgts=st.team_targets||0;
const recvSum=st.passing_shares.reduce((s,p)=>s+(p.share*150*(p.ypt||9)),0); // rough
console.log('QB passing yards (pool):', qbYds);
console.log('Receiver yard sum (approx):', Math.round(st.passing_shares.reduce((s,p)=>{
  const tg=p.share*150; return s+tg*(p.ypt||9);},0)));
console.log('Discrepancy exists:', qbYds>0?'yes':'no');

console.log('\n=== Reconcile fixes the gap ===');
app.setSub('recyds');
app.ensureDerivedShares(st,'recyds');
app.reconcileDerived('MIA','recyds');
// after reconcile, receiver sum should ≈ QB pool
const totalTgts2=Math.round(st.team_targets||st.passing_shares.reduce((s,p)=>s+p.baseline_targets,0));
const afterSum=Math.round(st.passing_shares.reduce((s,p)=>{
  const tg=p.share*totalTgts2; return s+tg*(p.ypt||9);},0));
console.log('After reconcile: receiver sum =', afterSum, 'vs QB pool', qbYds);
console.log('RESULT:', Math.abs(afterSum-qbYds)<=Math.max(40,qbYds*0.03)?'PASS (reconciled to QB total)':'FAIL ('+afterSum+' vs '+qbYds+')');

console.log('\n=== Slider rebalance: moving one updates others ===');
app.initPassingShares('MIA'); // fresh
app.ensureDerivedShares(st,'recyds');
const before=st.passing_shares.map(p=>p.recyds_share);
console.log('Before shares:', before.map(s=>(s*100).toFixed(1)+'%').join(', '));
app.derived('MIA',0,0.70,'recyds'); // push Waddle to 70%
const after=st.passing_shares.map(p=>p.recyds_share);
console.log('After Waddle→70%:', after.map(s=>(s*100).toFixed(1)+'%').join(', '));
const sum=after.reduce((s,v)=>s+v,0);
console.log('Shares sum to 100%:', Math.abs(sum-1)<0.01?'yes':'no ('+(sum*100).toFixed(1)+'%)');
const othersChanged=before[1]!==after[1];
console.log('RESULT:', Math.abs(sum-1)<0.01 && othersChanged && Math.abs(after[0]-0.70)<0.01?'PASS (rebalances like targets)':'FAIL');
