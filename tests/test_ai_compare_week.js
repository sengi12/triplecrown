// Compare, in-season: the packet carries each player's THIS-WEEK line (week
// projection under the league's scoring, opponent + defense-vs-position rank,
// last-3 form, live ranks) and the prompt asks the start/sit question — the
// same grounding path, one more section. Off-season it stays a draft audit.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  sleeperPlayers={'1':{name:'Star Back',pos:'RB',team:'NE',injury_status:''},'9':{name:'Free Back',pos:'RB',team:'SEA',injury_status:''}};
  Object.assign(TC_SEASON,{year:2026,phase:'regular',week:2});
  let started=true; hasSeasonStarted=function(){return started;};
  TC_INSEASON={season:2026, weeks:[1], schedule:{NE:{'2':'MIA'}, SEA:{'2':'ARI'}},
    player_weekly:{cols:['tgt','rec','rec_yd','rec_td','air_yd','carry','rush_yd','rush_td','pass_att','pass_yd','pass_td','pass_int','epa_touch','team_tgt'],
      players:{ g1:{n:'Star Back',p:'RB',t:'NE',w:{'1':[3,3,20,0,5,18,80,1,0,0,0,0,2,30]}}, g9:{n:'Free Back',p:'RB',t:'SEA',w:{'1':[4,4,30,0,3,14,70,0,0,0,0,0,1,28]}} }},
    def_vs_pos:{cols:['tgt','rec','rec_yd','rec_td','carry','rush_yd','rush_td','pass_att','pass_yd','pass_td','pass_int'],
      teams:{MIA:{RB:{'1':[5,4,30,0,25,140,2,0,0,0,0]}}, ARI:{RB:{'1':[3,3,10,0,20,60,0,0,0,0,0]}}}}};
  laPidFromGsis=function(g){ return {g1:'1',g9:'9'}[g]||null; };
  NFLVERSE['2026']=Object.assign(NFLVERSE['2026']||{}, {rb_fan:{'star back':{totals:{attempts:18, rk:{attempts:[1,6], rz:[2,6], ypc:[4,6]}}}}});
  const A={player_id:'1',name:'Star Back',pos:'RB',team:'NE',rushing_attempts:250,rushing_yards:1100,rushing_tds:9,receptions:40,receiving_yards:300,receiving_tds:1,proj_games:17,fpts:230,vor:60};
  const B={player_id:'9',name:'Free Back',pos:'RB',team:'SEA',rushing_attempts:80,rushing_yards:340,rushing_tds:2,receptions:20,receiving_yards:150,proj_games:17,fpts:90,vor:5};
  return { ctx:tcAiPlayerContext, line:tcAiWeekLine, msgs:tcAiCompareMessages, A, B, off:()=>{started=false;} };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== in-season: the packet knows what week it is ===');
const w=app.line(app.A);
chk(w && w.wk===2 && w.opp==='MIA' && w.adj>0, `Star Back's week line: ${w&&w.adj.toFixed(1)} vs ${w&&w.opp}`);
chk(w.oppRank===1, 'the most generous run defense ranks #1');
chk(w.ranks.some(r=>/RZ carries #2\/6/.test(r)) && w.ranks.some(r=>/carries #1\/6 RBs/.test(r)), 'live ranks ride along');
const c=app.ctx(app.A);
chk(/week 2: projects [\d.]+ pts vs MIA \(defense ranks #1 of \d+ most generous to RBs\)/.test(c), 'the context prints the week line');
chk(/last 1 gm [\d.]+ FPPG/.test(c) && /last game 21 touches/.test(c), 'with last-game usage');
const m=app.msgs(app.A, app.B, '');
chk(/START\/SIT call for THIS WEEK/.test(m[0].content) && /Answer in exactly this shape/.test(m[0].content), 'the prompt asks the start/sit question and keeps the answer shape');
chk(/THIS WEEK \(wk 2\): Star Back by [\d.]+ projected pts \(matchups: Star Back vs MIA #1, Free Back vs ARI #2/.test(m[1].content), 'the computed differences lead with this week');
chk(/week 2 start\/sit/.test(m[1].content), 'the league line says which week');

console.log('=== off-season: a draft audit, untouched ===');
app.off();
chk(app.line(app.A)===null, 'no week line without a season');
const m2=app.msgs(app.A, app.B, '');
chk(/auditing a draft board/.test(m2[0].content) && !/THIS WEEK/.test(m2[1].content), 'the draft prompt and packet are unchanged');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
