const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  assembleSeed, normalizeSleeperRow, ensureTeam, initPassingShares, initRushingShares, buildPlayerList,
  setSEED:(s)=>{SEED=s;projSeed=s;seasonStatsCache.proj=s;workingProj={};userProj=workingProj;activeSeason='proj';},
  setECR:(e)=>{ECR=e;rankFormat='half_ppr';},
  getProj:()=>userProj };
`)();

const players={cmc:{player_id:'cmc',name:'Christian McCaffrey',pos:'RB',team:'SF'},q:{player_id:'q',name:'Brock Purdy',pos:'QB',team:'SF'}};
const idx={cmc:app.normalizeSleeperRow({player_id:'cmc',team:'SF',position:'RB',stats:{rush_att:250,rush_yd:1400,rush_td:14,rec:60,rec_yd:500,rec_tgt:80,gp:17}}),
  q:app.normalizeSleeperRow({player_id:'q',team:'SF',position:'QB',stats:{pass_yd:4200,pass_att:550,pass_cmp:380,pass_td:30,gp:17}})};
app.setSEED(app.assembleSeed(players,idx));
app.setECR({half_ppr:{'christian mccaffrey':{rank_ecr:1,tier:1,age:28},'brock purdy':{rank_ecr:45,tier:6,age:25}}});

const list=app.buildPlayerList();
const cmc=list.find(p=>p.name==='Christian McCaffrey');
console.log('=== YPC + ECR on player list ===');
console.log('CMC rushing:', cmc.rushing_attempts, 'att,', cmc.rushing_yards, 'yds');
console.log('CMC YPC:', cmc.ypc.toFixed(2), '(expect ~'+(cmc.rushing_yards/cmc.rushing_attempts).toFixed(2)+')');
console.log('CMC ECR:', cmc.ecr, 'tier:', cmc.ecr_tier, '(expect 1, tier 1)');
const ok = Math.abs(cmc.ypc - cmc.rushing_yards/cmc.rushing_attempts)<0.01 && cmc.ecr===1 && cmc.ecr_tier===1;
console.log('RESULT:', ok?'PASS (YPC computed, ECR attached)':'FAIL');
