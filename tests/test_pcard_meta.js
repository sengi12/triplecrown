const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],appendChild(){},addEventListener(){},remove(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:(t)=>({tagName:t,style:{},className:'',id:'',innerHTML:'',appendChild(){},set onclick(f){},remove(){}}),body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.toast=()=>{};
const code=require('fs').readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+'return { _fmtHeight, renderPlayerCardShell, pcardSeasonRows, renderPcardSeason, setPlayers:(p)=>{sleeperPlayers=p;}, setFormat:(f)=>{rankFormat=f;}, setScoring:(s)=>{scoringSettings=s;}, getOverlay:()=>{const o=document.getElementById("pcardOverlay");return o?o.innerHTML:"";} };')();
app.setScoring({passing_yards_yardage:25,passing_touchdowns:6,interceptions_thrown:-2,rushing_yards_yardage:10,rushing_touchdowns:6,receiving_yards_yardage:10,receptions:0.5,receiving_touchdowns:6,passing_attempts:0,fumbles_lost:-2});
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const SIX_FOUR = "6'"+'4"';
const SIX_ZERO = "6'"+'0"';
console.log('=== height formatting ===');
chk(app._fmtHeight('76')===SIX_FOUR,'76 inches -> 6 4');
chk(app._fmtHeight('72')===SIX_ZERO,'72 -> 6 0');
chk(app._fmtHeight(SIX_FOUR)===SIX_FOUR,'already formatted passes through');
chk(app._fmtHeight(null)==='\u2013','null -> dash');

console.log('=== hero metadata ===');
app.setPlayers({'6770':{player_id:'6770',name:'Joe Burrow',pos:'QB',team:'CIN',age:29.5,years_exp:6,height:'76',weight:'215',college:'LSU',number:9}});
app.renderPlayerCardShell('6770','QB','CIN');
const h=app.getOverlay();
chk(h.includes('29.5'),'age decimal 29.5');
chk(h.includes(SIX_FOUR),'height 6 4');
chk(h.includes('215 lbs'),'weight 215 lbs');
chk(h.includes('LSU'),'college LSU');
chk(h.includes('#9'),'jersey #9');
const iAge=h.indexOf('AGE'),iHt=h.indexOf('>HT<'),iWt=h.indexOf('>WT<'),iExp=h.indexOf('>EXP<'),iCol=h.indexOf('COLLEGE');
chk(iAge<iHt&&iHt<iWt&&iWt<iExp&&iExp<iCol,'order AGE|HT|WT|EXP|COLLEGE');

console.log('=== integer age no decimal ===');
app.setPlayers({'1':{player_id:'1',name:'X',pos:'QB',team:'CIN',age:28,years_exp:3,height:'74',weight:'200',college:'Ohio State',number:5}});
app.renderPlayerCardShell('1','QB','CIN');
chk(app.getOverlay().includes('>28<'),'integer age 28');

console.log('=== opponent home/away + logo ===');
app.setFormat('half_ppr');
const weekly={
  '1':{team:'CIN',opponent:'NE',is_away_team:false,stats:{gp:1,pass_yd:200,pass_td:1,pass_int:0,off_snp:70,tm_off_snp:70}},
  '2':{team:'CIN',opponent:'KC',is_away_team:true,stats:{gp:1,pass_yd:250,pass_td:2,pass_int:0,off_snp:70,tm_off_snp:70}},
};
const rows=app.pcardSeasonRows(weekly,'QB');
chk(rows[0].isAway===false,'wk1 home');
chk(rows[1].isAway===true,'wk2 away');
const html=app.renderPcardSeason(2024,rows,'QB');
chk(html.includes('pcard-opp-logo'),'opponent logo');
chk(html.includes('pcard-at'),'@ marker present');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
