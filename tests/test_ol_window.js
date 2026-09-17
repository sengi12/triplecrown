// Offensive line by week window (74-team-tabs): the recompute behind the team card's
// week slider and the rushing fan's per-game run-blocking banner. Pinned: a PFR field
// the source has not published for any selected week stays MISSING (null value, null
// rank) instead of summing to 0 — a 0 would rank every line 32nd on yards before contact
// and 1st on pressure rate — while pbp-derived fields keep their real zeros; a published
// week computes normally; the rushing fan's rank-average score skips the missing fields.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  return { range:_advComputeOlRangeTables, score:_rbRunScoreAndRankFromTable, setNV:(n)=>{NFLVERSE=n;}, clear:()=>{_advOlRangeCache={};} };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const pass_cols=['dropbacks','designed_rushes','sacks','times_pressured','times_hit','times_hurried','times_blitzed','non_qb_sacks','no_blitz_pressures','pocket_time_w','pocket_time_att'];
const run_cols=['designed_rushes','stuffed','explosive','rush_yards','ybc','yac','broken_tackles','rush_first_downs','ngs_att','roe_w','box8_w','tlos_w','rush_successes','rush_rb_att'];
// Week 1: PFR not published (nulls). Week 2: published. Three teams so ranks are meaningful.
const mk=(db,ra,st,ry,ybc,yac,bt,pr)=>({
  pass:[[db,ra,2,null,null,null,null,1,3,60,25],[db,ra,1,pr,3,4,8,1,2,60,25]],
  run: [[ra,st,3,ry,null,null,null,6,ra,10,300,60,10,ra],[ra,st,3,ry,ybc,yac,bt,6,ra,10,300,60,10,ra]],
});
const pack={weeks:[1,2], pass_cols, run_cols, teams:{ KC:mk(30,30,3,180,60,90,4,8), DEN:mk(30,30,6,120,40,50,2,12), SEA:mk(30,30,9,90,30,30,1,15) }};
app.setNV({'2026':{ol_weekly:pack, team:{}}});
app.clear();

console.log('=== week 1 alone: PFR unpublished ===');
const w1=app.range('2026',1,1);
const kc1=w1.runTbl.teams.KC;
chk(kc1.values['YBC/Rush']===null && kc1.ranks['YBC/Rush']===null && kc1.values['Broken Tackle Rate']===null, 'yards before contact / broken tackles stay missing, not 0 and not ranked 32nd');
chk(kc1.values['Stuff Rate']===10 && kc1.ranks['Stuff Rate']===1 && kc1.values['Yards/Rush']===6, 'pbp-derived stuff rate and yards per rush compute and rank as before');
const kp1=w1.passTbl.teams.KC;
chk(kp1.values['Pressure Rate']===null && kp1.ranks['Pressure Rate']===null && Math.abs(kp1.values['Sack Rate']-6.7)<0.01, 'pressure rate (PFR) stays missing while sack rate (pbp) computes');
const s1=app.score(w1.runTbl,'KC');
chk(s1.score!=null && s1.rank===1, 'the run-blocking score averages only the fields that exist — KC leads on what is known');

console.log('=== week 2: published ===');
const w2=app.range('2026',2,2);
chk(w2.runTbl.teams.KC.values['YBC/Rush']===2 && w2.runTbl.teams.KC.ranks['YBC/Rush']===1 && w2.passTbl.teams.KC.values['Pressure Rate']!=null, 'a published week computes yards before contact and pressure rate');
console.log('=== weeks 1-2: the window sums only what was published ===');
const w12=app.range('2026',1,2);
chk(w12.runTbl.teams.KC.values['YBC/Rush']===1 && w12.runTbl.teams.KC.values['Yards/Rush']===6, 'over both weeks YBC divides week-2 yards by BOTH weeks\' carries (the honest denominator) and pbp fields sum across both');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
