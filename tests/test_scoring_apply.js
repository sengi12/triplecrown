const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={};}abort(){}};global.setInterval=()=>0;global.clearInterval=()=>{};

// Real Queen City Kings scoring_settings (2qb, rec 1.0, pass_yd 0.05, pass_td 6)
const QCK_SCORING={"rec":1.0,"pass_yd":0.05000000074505806,"pass_td":6.0,"pass_int":-2.0,"rush_yd":0.10000000149011612,"rush_td":6.0,"rec_yd":0.10000000149011612,"rec_td":6.0,"fum_lost":-1.0,"pass_att":0.0,"rush_att":0.0};
const QCK_RP=["QB","RB","RB","WR","WR","WR","TE","FLEX","SUPER_FLEX","DEF","BN"];
// Dynasty league (half ppr): rec 0.5, pass_yd 0.04, pass_td 4
const DYN_SCORING={"rec":0.5,"pass_yd":0.04,"pass_td":4.0,"pass_int":-2.0,"rush_yd":0.1,"rush_td":6.0,"rec_yd":0.1,"rec_td":6.0,"fum_lost":-1.0};
const DYN_RP=["QB","RB","RB","WR","WR","WR","TE","FLEX","FLEX","BN"];

const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  applySleeperScoring, detectLeagueFormat, calcFpts, leagueIsSuperflex,
  getScoring:()=>scoringSettings, getFormat:()=>rankFormat,
  setFormat:(f)=>{rankFormat=f;}, resetScoring:()=>{scoringSettings={passing_yards_points:1,passing_yards_yardage:25,passing_touchdowns:6,interceptions_thrown:-2,passing_attempts:0,passing_completions:0,receiving_yards_points:1,receiving_yards_yardage:10,receiving_touchdowns:6,receptions:0.5,rushing_yards_points:1,rushing_yards_yardage:10,rushing_touchdowns:6,rushing_attempts:0,fumbles_lost:-2};} };
`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const near=(a,b)=>Math.abs(a-b)<0.001;

console.log('=== TEST 1: Queen City Kings scoring conversion ===');
app.resetScoring();
app.applySleeperScoring(QCK_SCORING);
const s=app.getScoring();
chk(near(s.passing_yards_yardage,20),`pass_yd 0.05 → 20 yds/pt (got ${s.passing_yards_yardage.toFixed(2)})`);
chk(near(s.passing_touchdowns,6),'pass_td → 6');
chk(near(s.receptions,1.0),'rec → 1.0 (full PPR)');
chk(near(s.rushing_yards_yardage,10),'rush_yd 0.1 → 10 yds/pt');
chk(near(s.receiving_yards_yardage,10),'rec_yd 0.1 → 10 yds/pt');
chk(near(s.interceptions_thrown,-2),'pass_int → -2');
chk(near(s.fumbles_lost,-1),'fum_lost → -1');

console.log('\n=== TEST 2: format detection ===');
chk(app.detectLeagueFormat(QCK_SCORING,QCK_RP,'2qb',0)==='superflex','QCK (2qb + SUPER_FLEX) → superflex');
chk(app.detectLeagueFormat(DYN_SCORING,DYN_RP,'dynasty_half_ppr',2)==='dynasty','dynasty_half_ppr → dynasty');
chk(app.detectLeagueFormat({rec:1.0},["QB","RB","WR"],'ppr',0)==='ppr','plain PPR → ppr');
chk(app.detectLeagueFormat({rec:0.5},["QB","RB","WR"],'half_ppr',0)==='half_ppr','half → half_ppr');
chk(app.detectLeagueFormat({rec:0},["QB","RB","WR"],'std',0)==='std','standard → std');

console.log('\n=== TEST 3: converted scoring produces correct fantasy points ===');
app.resetScoring();
app.applySleeperScoring(QCK_SCORING);
// A QB: 5000 pass yds, 40 pass td, 10 int in QCK (0.05/yd=1pt/20yd, 6/td, -2/int)
const qbPts=app.calcFpts({passing_yards:5000,passing_tds:40,interceptions_thrown:10});
const expected = 5000/20 + 40*6 - 2*10;  // 250 + 240 - 20 = 470
chk(near(qbPts,expected),`QB 5000yd/40td/10int → ${expected} pts (got ${qbPts.toFixed(1)})`);

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
