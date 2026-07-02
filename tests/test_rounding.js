const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={};}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  applySleeperScoring, calcFpts,
  getScoring:()=>scoringSettings,
  resetScoring:()=>{scoringSettings={passing_yards_points:1,passing_yards_yardage:25,passing_touchdowns:6,interceptions_thrown:-2,passing_attempts:0,passing_completions:0,receiving_yards_points:1,receiving_yards_yardage:10,receiving_touchdowns:6,receptions:0.5,rushing_yards_points:1,rushing_yards_yardage:10,rushing_touchdowns:6,rushing_attempts:0,fumbles_lost:-2};} };
`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== Originally From Ohio (half PPR dynasty) — the reported bug ===');
// EXACT values from the user\'s league scoring_settings
const OHIO={"rec":0.5,"pass_yd":0.03999999910593033,"pass_td":4.0,"pass_int":-2.0,"rush_yd":0.10000000149011612,"rush_td":6.0,"rec_yd":0.10000000149011612,"rec_td":6.0,"fum_lost":-1.0};
app.resetScoring();
app.applySleeperScoring(OHIO);
const s=app.getScoring();
console.log('  Rush yds/pt:', s.rushing_yards_yardage);
console.log('  Rec yds/pt:', s.receiving_yards_yardage);
console.log('  Pass yds/pt:', s.passing_yards_yardage);
chk(s.rushing_yards_yardage===10,'rush_yd 0.10000000149 → 10 (was 9.99999985)');
chk(s.receiving_yards_yardage===10,'rec_yd → 10 (clean)');
chk(s.passing_yards_yardage===25,'pass_yd 0.03999999 → 25 (was 25.00000055)');
chk(s.receptions===0.5,'rec 0.5 preserved exactly');
chk(s.passing_touchdowns===4,'pass_td 4 clean');
chk(s.interceptions_thrown===-2,'pass_int -2 clean');
chk(s.fumbles_lost===-1,'fum_lost -1 clean');

console.log('\n=== Queen City Kings (pass_yd 0.05 → should be 20) ===');
const QCK={"rec":1.0,"pass_yd":0.05000000074505806,"pass_td":6.0,"rush_yd":0.10000000149011612,"rec_yd":0.10000000149011612};
app.resetScoring(); app.applySleeperScoring(QCK);
const s2=app.getScoring();
console.log('  Pass yds/pt:', s2.passing_yards_yardage);
chk(s2.passing_yards_yardage===20,'pass_yd 0.05 → 20 (was 19.9999997)');

console.log('\n=== Preserve genuinely custom values (not everything is round) ===');
// A hypothetical league: 1 pt per 15 rushing yards, 6-pt pass TD, 0.75 PPR (fractional but real)
const CUSTOM={"rush_yd":1/15,"rec":0.75,"pass_yd":1/18};
app.resetScoring(); app.applySleeperScoring(CUSTOM);
const s3=app.getScoring();
console.log('  rush 1/15 → yds/pt:', s3.rushing_yards_yardage, '(expect 15)');
console.log('  rec 0.75 →', s3.receptions, '(expect 0.75)');
console.log('  pass 1/18 → yds/pt:', s3.passing_yards_yardage, '(expect ~18)');
chk(s3.rushing_yards_yardage===15,'1/15 → 15 preserved');
chk(s3.receptions===0.75,'0.75 PPR preserved (not snapped to 0.5 or 1)');
chk(Math.abs(s3.passing_yards_yardage-18)<0.01,'1/18 → 18 preserved');

console.log('\n=== Fantasy points now compute to clean values ===');
app.resetScoring(); app.applySleeperScoring(OHIO);
// RB with exactly 1000 rush yds → 100 pts at 10 yds/pt (would be 100.0000015 before fix)
const rbPts=app.calcFpts({rushing_yards:1000});
console.log('  1000 rush yds →', rbPts, 'pts');
chk(rbPts===100,'1000 rush yds → exactly 100.0 (was 100.0000015)');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
