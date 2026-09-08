// BAFL Mode: the category-league lens for the whole advisory. One scoring core
// (calcFpts) branches to category leverage, so VOR/VONA/tracker inherit it; the
// toggle lives in the scoring panel; linking the BAFL league flips it on, and
// linking any other league flips it back off.
const elStore={};let contentHTML='';
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{display:''},dataset:{},value:'',checked:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},querySelectorAll:()=>[],addEventListener(){},appendChild(){}};if(id==='content'){Object.defineProperty(elStore[id],'innerHTML',{get:()=>contentHTML,set:v=>{contentHTML=v;},configurable:true});}return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('_n'+Math.random()),body:{appendChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
const _store={};
global.localStorage={getItem:k=>(_store[k]!=null?_store[k]:null),setItem(k,v){_store[k]=String(v);},removeItem(k){delete _store[k];}};

const USER={user_id:"318054040384589824"};
const BAFL_LG={draft_id:"9002",league_id:"9001",name:"BAFL",total_rosters:10,
  scoring_settings:{rec:0.0},roster_positions:["QB","QB","RB","RB","WR","WR","TE","K","K","BN"]};
const OTHER_LG={draft_id:"9102",league_id:"9101",name:"Queen City Kings",total_rosters:12,
  scoring_settings:{rec:1.0},roster_positions:["QB","RB","WR","SUPER_FLEX","BN"]};
global.fetch=(u)=>{
  const J=(o)=>Promise.resolve({ok:true,json:()=>Promise.resolve(o)});
  if(u.match(/league\/9001\/drafts/)) return J([{draft_id:"9002",status:"pre_draft"}]);
  if(u.match(/league\/9101\/drafts/)) return J([{draft_id:"9102",status:"pre_draft"}]);
  if(u.match(/draft\/9002$/)) return J({draft_id:"9002",status:"pre_draft",league_id:"9001",settings:{teams:10,rounds:25}});
  if(u.match(/draft\/9102$/)) return J({draft_id:"9102",status:"pre_draft",league_id:"9101",settings:{teams:12,rounds:15}});
  if(u.match(/draft\/\d+\/picks/)) return J([]);
  if(u.match(/league\/9001\/users|league\/9101\/users/)) return J([]);
  return Promise.reject(new Error('unmocked '+u));
};
let toasts=[];
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(m,t){toasts.push({m,t});};
  return { calcFpts, scoringSettings, linkLeagueObject, scoringSummary, recalcRankings,
    setPickerLeagues:(ls)=>{leaguePickerState={open:true,loading:false,user:${JSON.stringify(USER)},leagues:ls,error:null};},
    getToasts:()=>toasts };
`)();
global.toasts=toasts;

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

(async()=>{
  console.log('=== category scoring flips the value lens ===');
  const lamar={pos:'QB',passing_yards:4200,passing_tds:28,interceptions_thrown:8,rushing_yards:800,rushing_tds:4,receptions:0,receiving_yards:0};
  const ppRec={pos:'WR',receiving_yards:850,receiving_tds:10,receptions:110,rushing_yards:0};   // TD/catch machine
  const ydRec={pos:'WR',receiving_yards:1150,receiving_tds:4,receptions:70,rushing_yards:0};    // yardage machine
  app.scoringSettings.baflMode=false;
  const pointsPP=app.calcFpts(ppRec), pointsYD=app.calcFpts(ydRec);
  chk(pointsPP>pointsYD, 'points lens (PPR): the TD/catch receiver scores higher');
  app.scoringSettings.baflMode=true;
  const catPP=app.calcFpts(ppRec), catYD=app.calcFpts(ydRec), catQB=app.calcFpts(lamar);
  chk(catYD>catPP, 'category lens: the YARDAGE receiver flips ahead (no catches category)');
  chk(catQB>catYD*1.5, 'a rushing QB reads as the three-category player he is');
  const noInt={...lamar, interceptions_thrown:0};
  chk(app.calcFpts(noInt)>catQB, 'interceptions bite the passing category (-20 yds each)');
  chk(/BAFL categories/.test(app.scoringSummary()), 'the scoring summary announces the mode');
  app.scoringSettings.baflMode=false;

  console.log('\n=== linking BAFL turns it on; linking anything else turns it off ===');
  await app.linkLeagueObject(BAFL_LG);
  chk(app.scoringSettings.baflMode===true, 'linking the BAFL league auto-enables BAFL Mode');
  chk(app.getToasts().some(t=>/BAFL Mode/.test(t.m)), 'and says so');
  await app.linkLeagueObject(OTHER_LG);
  chk(app.scoringSettings.baflMode===false, 'linking a different league turns it back off');

  console.log('\n=== the panel toggle round-trips through recalc ===');
  mkEl('sc_bafl').checked=true;
  // recalc reads every numeric field; give them sane values so parseFloat works
  ['sc_pass_yds_ydg','sc_pass_td','sc_int','sc_rush_yds_ydg','sc_rush_td','sc_rec_yds_ydg',
   'sc_rec_td','sc_rec','sc_rec_te','sc_fum','sc_pass_att','sc_pass_comp','sc_rush_att']
    .forEach((id,i)=>{ mkEl(id).value=['25','6','-2','10','6','10','6','0.5','0','-2','0','0','0'][i]; });
  app.recalcRankings();
  chk(app.scoringSettings.baflMode===true, 'checking the box flips the mode on recalc');
  mkEl('sc_bafl').checked=false;
  app.recalcRankings();
  chk(app.scoringSettings.baflMode===false, 'unchecking flips it back');

  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
