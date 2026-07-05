const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){}}),body:{appendChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  fetchTeamSchedule, opponentWinTotal, renderSOSView, ESPN_ID_TO_CODE,
  setSOS:(s)=>{SOS=s;}, setSched:(t,arr)=>{scheduleCache[t]=arr;},
  setSchedLoaded:()=>{_sosSchedLoaded=true;},
  setPhase:(p,tab)=>{currentPhase=p;sharpTable=tab;} };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== ESPN id→code reverse map ===');
chk(app.ESPN_ID_TO_CODE[4]==='CIN','id 4 → CIN');
chk(app.ESPN_ID_TO_CODE[33]==='BAL','id 33 → BAL');
chk(app.ESPN_ID_TO_CODE[30]==='JAX','id 30 → JAX');

console.log('=== opponentWinTotal sums from SOS ===');
app.setSOS({TB:{win_total:9.5,rank:20},HOU:{win_total:9.5,rank:19},PIT:{win_total:8.5,rank:15},JAX:{win_total:7.5,rank:10},MIA:{win_total:8.5,rank:14},BAL:{win_total:11.5,rank:30},TEN:{win_total:5.5,rank:2},CIN:{win_total:8.5,rank:16}});
app.setSched('CIN',['TB','HOU','PIT','JAX','MIA','BAL','TEN']);
const o=app.opponentWinTotal('CIN');
chk(o!==null,'CIN opponent total computed');
chk(Math.abs(o.total-60.5)<0.01,'CIN opp total = 60.5');
chk(o.games===7,'7 games counted');

console.log('=== missing opponent win total is skipped ===');
app.setSOS({TB:{win_total:9.5},HOU:{win_total:9.5},PIT:{win_total:null},CIN:{}});
app.setSched('CIN',['TB','HOU','PIT']);
const o2=app.opponentWinTotal('CIN');
chk(Math.abs(o2.total-19.0)<0.01,'skips PIT (null) → 19.0');
chk(o2.games===2,'only 2 games counted');

console.log('=== no schedule → null (team still plots at rank) ===');
app.setSched('DAL',[]);
chk(app.opponentWinTotal('DAL')===null,'empty schedule → null');

console.log('=== SOS render produces arc when opp data present ===');
app.setSOS({TB:{win_total:9.5,rank:1,name:'Bucs'},HOU:{win_total:5.5,rank:2,name:'Texans'},PIT:{win_total:11.5,rank:3,name:'Steelers'}});
app.setSched('TB',['HOU']); app.setSched('HOU',['PIT']); app.setSched('PIT',['TB']);
app.setSchedLoaded();
app.setPhase('AdvancedLeague','sos');
const html=app.renderSOSView();
chk(html.includes('HARDER SLATE'),'arc mode label present');
chk(html.includes('sum of opponents'),'subline explains opponent-sum');
chk(html.includes('opp win total'),'tooltip shows opp total');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
