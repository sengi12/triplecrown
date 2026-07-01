const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  assembleSeedFromRecords, ensureTeam, perGame, pace,
  setSEED:(s)=>{SEED=s;seasonStatsCache.proj=s;},
  selectTeam:t=>{currentTeam=t;currentPhase='QB';ensureTeam(t);},
  handleKey:(k,v,t)=>handleSliderKey(k,v,t,false),
  getProj:()=>userProj };
`)();

console.log('=== TEST 1: Flacco 2025 split into CLE + CIN via records ===');
const meta={'19':{player_id:'19',name:'Joe Flacco',pos:'QB',team:'CIN'}};
const records=[
  {pid:'19',team:'CLE',pos:'QB',name:'Joe Flacco',games_played:4,games_started:4,snap_pct:77,
   stats:{passing_yards:815,passing_attempts:160,passing_touchdowns:2,games_played:4}},
  {pid:'19',team:'CIN',pos:'QB',name:'Joe Flacco',games_played:8,games_started:8,snap_pct:67,
   stats:{passing_yards:1664,passing_attempts:256,passing_touchdowns:13,games_played:8}},
];
const seed=app.assembleSeedFromRecords(meta,records);
const cle=seed.CLE.QB.find(q=>q.name==='Joe Flacco');
const cin=seed.CIN.QB.find(q=>q.name==='Joe Flacco');
console.log('CLE Flacco:', cle?`${cle.passing_yards}yds ${cle.games_played}gp ${cle.snap_pct}%`:'MISSING');
console.log('CIN Flacco:', cin?`${cin.passing_yards}yds ${cin.games_played}gp ${cin.snap_pct}%`:'MISSING');
console.log('RESULT:', cle&&cin&&cle.passing_yards===815&&cin.passing_yards===1664?'PASS (both teams, correct splits)':'FAIL');

console.log('\n=== TEST 2: pace extrapolation 8 games → 17 ===');
app.setSEED(seed);
app.selectTeam('CIN');
const st=app.getProj()['CIN'];
const flacco=st.qbs.find(q=>q.name==='Joe Flacco');
const qi=st.qbs.indexOf(flacco);
console.log(`Flacco starts: ${Math.round(flacco.passing_yards)}yds over ${flacco.games} games (${flacco.passing_yards/flacco.games} yds/game)`);
// scroll games up to 17
app.handleKey('games_'+qi, 17, 'CIN');
console.log(`After games→17: ${Math.round(flacco.passing_yards)}yds, ${Math.round(flacco.passing_attempts)}att, ${flacco.passing_tds.toFixed(1)}td`);
// 1664 yds over 8 games = 208/game; ×17 = 3536
const expected=Math.round(1664/8*17);
console.log(`Expected ~${expected} yds (208/game × 17)`);
console.log('RESULT:', Math.abs(flacco.passing_yards-expected)<5?'PASS (pace extrapolated)':'FAIL');

console.log('\n=== TEST 3: scroll back down to 4 games ===');
app.handleKey('games_'+qi, 4, 'CIN');
const expected4=Math.round(1664/8*4); // 832
console.log(`After games→4: ${Math.round(flacco.passing_yards)}yds (expect ~${expected4})`);
console.log('RESULT:', Math.abs(flacco.passing_yards-expected4)<5?'PASS (pace holds both directions)':'FAIL');

console.log('\n=== TEST 4: per-game rate stable across changes ===');
const rate=app.perGame(flacco,'passing_yards');
console.log(`Per-game rate: ${rate.toFixed(1)} (should stay ~208 regardless of games setting)`);
console.log('RESULT:', Math.abs(rate-208)<2?'PASS (rate invariant)':'FAIL');
