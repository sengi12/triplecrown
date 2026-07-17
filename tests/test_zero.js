const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { assembleSeedFromRecords, ensureTeam, perGame,
  setSEED:(s)=>{SEED=s;seasonStatsCache.proj=s;}, selectTeam:t=>{currentTeam=t;currentPhase='Passing';ensureTeam(t);},
  handleKey:(k,v,t)=>handleSliderKey(k,v,t,false), getProj:()=>userProj };`)();
const meta={'1':{player_id:'1',name:'Backup QB',pos:'QB',team:'KC'},'2':{player_id:'2',name:'Starter',pos:'QB',team:'KC'}};
const records=[
  {pid:'2',team:'KC',pos:'QB',name:'Starter',games_played:14,stats:{passing_yards:3500,passing_attempts:480,passing_touchdowns:28,games_played:14}},
  {pid:'1',team:'KC',pos:'QB',name:'Backup QB',games_played:5,stats:{passing_yards:1000,passing_attempts:150,passing_touchdowns:6,games_played:5}},
];
app.setSEED(app.assembleSeedFromRecords(meta,records));
app.selectTeam('KC');
const st=app.getProj()['KC'];
const bk=st.qbs.find(q=>q.name==='Backup QB'); const bi=st.qbs.indexOf(bk);
console.log('Backup starts: 1000 yds /', bk.games, 'games, rate=', app.perGame(bk,'passing_yards').toFixed(1));
app.handleKey('games_'+bi, 0, 'KC');
console.log('At 0 games: yards=', Math.round(bk.passing_yards), 'rate STILL=', app.perGame(bk,'passing_yards').toFixed(1));
app.handleKey('games_'+bi, 10, 'KC');
console.log('Back to 10 games: yards=', Math.round(bk.passing_yards), '(expect 2000 = 200×10)');
console.log('RESULT:', bk.passing_yards===2000?'PASS (pace survived 0)':'FAIL');
