const elStore={};
function mkEl(id){
  if(!elStore[id]) elStore[id]={
    innerHTML:'',style:{},textContent:'',value:'',disabled:false,
    classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},
    appendChild(){},querySelectorAll:()=>[],addEventListener(){}
  };
  return elStore[id];
}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={};}abort(){}};

const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  pcardDefWeeklyAvailable, renderPcardDefWeekly, renderPcardStatTabs, setPcardStatsMode,
  setPlayers:(p)=>{sleeperPlayers=p;},
  setNflverse:(n)=>{NFLVERSE=n;},
  setPcardState:(s)=>{pcardState=s;},
  setMode:(m)=>{pcardStatsMode=m;},
  getTabs:()=>document.getElementById('pcardTabs').innerHTML,
  getBody:()=>document.getElementById('pcardBody').innerHTML,
};`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== TEST: Defensive weekly tab wiring ===');
app.setPlayers({'4':{name:'Trey Hendrickson',pos:'DE'}});
app.setNflverse({'2025':{def_weekly:{'trey hendrickson':{
  name:'Trey Hendrickson',team:'CIN',pos:'DE',group:'DL',
  totals:{games:3,tackles:11,sacks:3.5,pressures:14,hurries:7,qb_hits:5,blitzes:2,missed_tackle_pct:6.2},
  weeks:[
    {week:1,opp:'CLE',tackles:3,sacks:1,pressures:4,hurries:2,qb_hits:1,blitzes:0,missed_tackle_pct:0.0},
    {week:2,opp:'BAL',tackles:4,sacks:1.5,pressures:6,hurries:3,qb_hits:2,blitzes:1,missed_tackle_pct:8.5},
    {week:3,opp:'PIT',tackles:4,sacks:1,pressures:4,hurries:2,qb_hits:2,blitzes:1,missed_tackle_pct:10.0},
  ]
}}}});
chk(app.pcardDefWeeklyAvailable('4'),'def weekly available for defensive player');

app.setPcardState({pid:'4',posc:'DE',isSkill:false,isOl:false,isDefense:true});
app.setMode('pro');
app.renderPcardStatTabs();
const tabs=app.getTabs();
chk(!tabs.includes('Def Weekly'),'no separate Def Weekly tab when NFL is replaced');

app.setMode('college');
app.setPcardStatsMode('pro');
const body=app.getBody();
chk(body.includes('PRS'),'def weekly tab renders pressure column');
chk(body.includes('SACK'),'def weekly tab renders sacks column');
chk(body.includes('pcard-opp-logo'),'pro defensive view renders opponent logos (ESPN-style)');
chk(body.includes('Defensive weekly stats from nflverse'),'def weekly tab renders source note');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
