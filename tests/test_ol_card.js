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
  pcardOlAvailable, renderPcardOlGrades, renderPcardStatTabs, setPcardStatsMode,
  setPlayers:(p)=>{sleeperPlayers=p;},
  setNflverse:(n)=>{NFLVERSE=n;},
  setPcardState:(s)=>{pcardState=s;},
  setMode:(m)=>{pcardStatsMode=m;},
  getTabs:()=>document.getElementById('pcardTabs').innerHTML,
  getBody:()=>document.getElementById('pcardBody').innerHTML,
};`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== TEST: OL grades card tab wiring ===');
app.setPlayers({'3':{name:'Laremy Tunsil',pos:'LT'}});
app.setNflverse({'2025':{
  ol_players:{'laremy tunsil':{
    name:'Laremy Tunsil',team:'HOU',slot:'LT',pos:'T',
    pass_grade:'A',pass_pctile:98.2,pass_conf:'HIGH',pass_snaps:2100,
    run_grade:'B',run_pctile:84.3,run_conf:'MED',poa_carries:355,
    shared_credit:'',penalty_rate:0.44,allpro_recent:'',career_ap1:0,career_pb:0,
    consensus_flag:'',market_pctile:95
  }},
  team:{
    offensive_line:{
      columns:['Pressure Rate Allowed','Time to Throw','Yards Before Contact Per RB Rush','Rush Stuff Rate'],
      teams:{
        HOU:{
          values:{'Pressure Rate Allowed':29.1,'Time to Throw':2.72,'Yards Before Contact Per RB Rush':1.44,'Rush Stuff Rate':17.2},
          ranks:{'Pressure Rate Allowed':10,'Time to Throw':13,'Yards Before Contact Per RB Rush':15,'Rush Stuff Rate':8}
        }
      }
    }
  }
}});
chk(app.pcardOlAvailable('3'),'OL grades available for lineman');

app.setPcardState({pid:'3',posc:'LT',isSkill:false,isOl:true});
app.setMode('pro');
app.renderPcardStatTabs();
const tabs=app.getTabs();
chk(tabs.includes('OL Grades'),'player card tabs include OL Grades');

app.setPcardStatsMode('olgrades');
const body=app.getBody();
chk(body.includes('Pass Grade'),'OL grades tab renders pass-grade section');
chk(body.includes('Run Grade'),'OL grades tab renders run-grade section');
chk(body.includes('Pressure Rate Allowed'),'OL grades tab renders team OL metric names');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
