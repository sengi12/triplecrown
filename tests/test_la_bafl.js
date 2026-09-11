// BAFL Mode in the League Analyzer: the matchup is best-3-of-5 categories. The
// card sums each side's starters — projected per-game rates, and the live lines
// once games are in — and says how many tracked categories you project to win.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  const ROWS=[
    {player_id:'8',name:'Drake Maye',pos:'QB',team:'NE',passing_yards:4250,passing_tds:34,interceptions_thrown:8.5,proj_games:17},
    {player_id:'1',name:'Rhamondre Stevenson',pos:'RB',team:'NE',rushing_yards:1020,rushing_tds:8.5,receiving_yards:340,proj_games:17},
    {player_id:'6',name:'Jaxon Smith-Njigba',pos:'WR',team:'SEA',receiving_yards:1275,receiving_tds:8.5,proj_games:17},
    {player_id:'9',name:'Drew Lock',pos:'QB',team:'SEA',passing_yards:3400,passing_tds:17,interceptions_thrown:17,proj_games:17},
    {player_id:'2',name:'Antonio Gibson',pos:'RB',team:'NE',rushing_yards:510,rushing_tds:1.7,receiving_yards:170,proj_games:17},
    {player_id:'5',name:'Puka Nacua',pos:'WR',team:'LAR',receiving_yards:1445,receiving_tds:8.5,proj_games:17},
  ];
  buildProjectionList=function(){ return ROWS.map(r=>Object.assign({},r)); };
  TC_INSEASON={season:2026, weeks:[1], player_weekly:{cols:['tgt','rec','rec_yd','rec_td','air_yd','carry','rush_yd','rush_td','pass_att','pass_yd','pass_td','pass_int','epa_touch','team_tgt'],
    players:{ g6:{n:'Jaxon Smith-Njigba',p:'WR',t:'SEA',w:{'1':[11,8,122,1,80,0,0,0,0,0,0,0,7,30]}}, g9:{n:'Drew Lock',p:'QB',t:'SEA',w:{'1':[0,0,0,0,0,1,4,0,22,187,1,0,2,0]}} }}};
  laPidFromGsis=function(g){ return {g6:'6',g9:'9'}[g]||null; };
  scoringSettings.baflMode=true;
  const s={leagueId:'B', name:'BAFL', teams:2, myUserId:'me', rosterPositions:['QB','RB','WR','BN'],
    teamList:[{rosterId:1, ownerId:'me', teamName:'Sengi', players:[]},{rosterId:2, ownerId:'them', teamName:'Rivals', players:[]}]};
  const pair=[{roster_id:1, matchup_id:1, starters:['8','1','6']},{roster_id:2, matchup_id:1, starters:['9','2','5']}];
  return { card:()=>laBaflCatCardHTML(s, pair, 1), off:()=>{ scoringSettings.baflMode=false; }, side:()=>laBaflSideCats(pair[0],1,new Map(buildProjectionList().map(r=>[String(r.player_id),r]))), cat:calcBaflCat };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const A=app.side();
chk(Math.abs(A.proj.pass-240)<0.6 && Math.abs(A.proj.rush-60)<0.1 && Math.abs(A.proj.rec-95)<0.1 && Math.abs(A.proj.td-3)<0.05, `my starters' projected categories: pass ${A.proj.pass.toFixed(0)} (−20/INT) · rush ${A.proj.rush.toFixed(0)} · rec ${A.proj.rec.toFixed(0)} · TD ${A.proj.td.toFixed(1)}`);
chk(A.played===1 && A.live.rec===122 && A.live.td===1, 'live lines fold in for the starters who have played (JSN: 122 rec yds, 1 TD)');
const h=app.card();
chk(/BAFL · BEST 3 OF 5/.test(h) && (h.match(/la-bafl-row/g)||[]).length===6, 'the card renders the five categories (+ header row)');
chk(/projected <b>3 of 4<\/b>/.test(h), 'and says how many tracked categories I project to win (kicking is not tracked)');
chk(/Kicking<small>not tracked here/.test(h) && /la-bafl-off/.test(h), 'kicking is shown as not tracked, not as a zero');
chk(/live 122/.test(h) && /live 187/.test(h), 'live sub-values show on both sides (JSN 122 rec on mine, Lock 187 pass on theirs)');
chk(/>Sengi</.test(h) && /Rivals/.test(h), 'both team names head the columns');
app.off();
chk(app.card()==='', 'without BAFL Mode the card does not exist');
chk(Math.round(app.cat({passing_yards:1547})*10)/10===60 && Math.round(app.cat({rushing_yards:833})*10)/10===60, 'the category lens is unchanged: one category-season of yards = 60');
console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
