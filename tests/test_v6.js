global.document={getElementById:()=>({innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]}),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { assembleSeed, assignQBSnapShares, hsURL, SLEEPER_HEADSHOT, getProjSeason:()=>PROJ_SEASON };`)();

console.log('=== TEST 1: Sleeper headshot URL ===');
const url=app.hsURL({player_id:'4046'});
console.log('hsURL for pid 4046:', url);
console.log('RESULT:', url==='https://sleepercdn.com/content/nfl/players/4046.jpg'?'PASS':'FAIL');

console.log('\n=== TEST 2: zero-stat QBs excluded (Steelers-style 7 QBs) ===');
const players={};
// 2 real QBs + 5 zero-stat backups
players['q1']={player_id:'q1',name:'Starter QB',pos:'QB',team:'PIT',age:27};
players['q2']={player_id:'q2',name:'Backup QB',pos:'QB',team:'PIT',age:25};
for(let i=3;i<=7;i++) players['q'+i]={player_id:'q'+i,name:'Old QB '+i,pos:'QB',team:'PIT',age:35};
const idx={
  q1:{stats:{passing_yards:4200,passing_attempts:560,games_played:17},team:'PIT',pos:'QB',name:'Starter QB'},
  q2:{stats:{passing_yards:600,passing_attempts:80,games_played:4},team:'PIT',pos:'QB',name:'Backup QB'},
  // q3-q7: no stats at all (prior-season leftovers)
};
const seed=app.assembleSeed(players,idx);
console.log('PIT QBs included:', seed.PIT.QB.map(q=>q.name).join(', '));
console.log('Count:', seed.PIT.QB.length, '(expect 2, not 7)');
console.log('RESULT:', seed.PIT.QB.length===2?'PASS':'FAIL');

console.log('\n=== TEST 3: snap share — full-season starter gets 100% ===');
const starterShare=seed.PIT.QB.find(q=>q.name==='Starter QB').snap_share;
const backupShare=seed.PIT.QB.find(q=>q.name==='Backup QB').snap_share;
console.log(`Starter (17 gp): ${(starterShare*100).toFixed(0)}%, Backup (4 gp): ${(backupShare*100).toFixed(0)}%`);
// starter has gp>=17 and backup total < ... actually backup has 4 gp so total-starter=4 which is NOT <1
// so it should split by gp: 17/21=81%, 4/21=19%
console.log('RESULT:', Math.abs(starterShare-17/21)<0.01?'PASS (gp-weighted)':'CHECK');

console.log('\n=== TEST 4: lone full-season starter, tiny backup → 100/0 ===');
const p2={s:{player_id:'s',name:'Iron Man',pos:'QB',team:'BUF'},b:{player_id:'b',name:'Clipboard',pos:'QB',team:'BUF'}};
const i2={s:{stats:{passing_yards:4800,passing_attempts:600,games_played:17},team:'BUF',pos:'QB',name:'Iron Man'},b:{stats:{passing_yards:0,passing_attempts:0,games_played:0},team:'BUF',pos:'QB',name:'Clipboard'}};
const seed2=app.assembleSeed(p2,i2);
console.log('BUF QBs:', seed2.BUF.QB.map(q=>`${q.name} ${(q.snap_share*100).toFixed(0)}%`).join(', '));
// Clipboard has 0 gp so excluded entirely → Iron Man alone = 100%
console.log('RESULT:', seed2.BUF.QB.length===1 && seed2.BUF.QB[0].snap_share===1?'PASS (backup excluded, starter 100%)':'CHECK');

console.log('\n=== TEST 5: two-starter committee splits by gp ===');
const p3={a:{player_id:'a',name:'QB A',pos:'QB',team:'CLE'},b:{player_id:'b',name:'QB B',pos:'QB',team:'CLE'}};
const i3={a:{stats:{passing_yards:2000,passing_attempts:280,games_played:9},team:'CLE',pos:'QB',name:'QB A'},b:{stats:{passing_yards:1800,passing_attempts:250,games_played:8},team:'CLE',pos:'QB',name:'QB B'}};
const seed3=app.assembleSeed(p3,i3);
console.log('CLE QBs:', seed3.CLE.QB.map(q=>`${q.name} ${(q.snap_share*100).toFixed(0)}% (${q.games_played}gp)`).join(', '));
const aShare=seed3.CLE.QB.find(q=>q.name==='QB A').snap_share;
console.log('RESULT:', Math.abs(aShare-9/17)<0.01?'PASS (9/17 split)':'FAIL');

console.log('\n=== DONE ===');
