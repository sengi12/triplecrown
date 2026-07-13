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
  pcardRbFanAvailable, renderPcardRbFan, renderPcardStatTabs, setPcardStatsMode,
  setPlayers:(p)=>{sleeperPlayers=p;},
  setNflverse:(n)=>{NFLVERSE=n;},
  setPcardState:(s)=>{pcardState=s;},
  setMode:(m)=>{pcardStatsMode=m;},
  getTabs:()=>document.getElementById('pcardTabs').innerHTML,
  getBody:()=>document.getElementById('pcardBody').innerHTML,
};`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== TEST: RB rushing fan tab wiring ===');
app.setPlayers({'2':{name:'Joe Mixon',pos:'RB'}});
app.setNflverse({'2025':{rb_fan:{'joe mixon':{
  team:'HOU',
  totals:{attempts:244,yards:1016,ypc:4.16,success_rate:44.3},
  lanes:{
    LE:{attempts:18,ypc:4.2,success_rate:45.1,league_ypc:4.0,ypc_diff:0.2},
    LT:{attempts:41,ypc:4.5,success_rate:46.3,league_ypc:4.2,ypc_diff:0.3},
    LG:{attempts:39,ypc:3.9,success_rate:41.0,league_ypc:4.1,ypc_diff:-0.2},
    MID:{attempts:52,ypc:4.0,success_rate:43.1,league_ypc:3.8,ypc_diff:0.2},
    RG:{attempts:37,ypc:4.3,success_rate:44.9,league_ypc:4.1,ypc_diff:0.2},
    RT:{attempts:34,ypc:4.1,success_rate:43.0,league_ypc:4.0,ypc_diff:0.1},
    RE:{attempts:23,ypc:4.0,success_rate:43.4,league_ypc:4.2,ypc_diff:-0.2},
  },
  line:{
    LT:{name:'Laremy Tunsil',run_grade:'B',pass_grade:'A',pass_snaps:600},
    LG:{name:'Kenyon Green',run_grade:'C',pass_grade:'C',pass_snaps:550},
    C:{name:'Jarrett Patterson',run_grade:'C-',pass_grade:'C-',pass_snaps:500},
    RG:{name:'Shaq Mason',run_grade:'B-',pass_grade:'B',pass_snaps:620},
    RT:{name:'Tytus Howard',run_grade:'B',pass_grade:'B-',pass_snaps:610},
  }
}}}});
chk(app.pcardRbFanAvailable('2'),'RB rushing fan available for player');

app.setPcardState({pid:'2',posc:'RB',isSkill:true});
app.setMode('pro');
app.renderPcardStatTabs();
const tabs=app.getTabs();
chk(tabs.includes('Rushing Fan'),'player card tabs include Rushing Fan');

app.setPcardStatsMode('rbfan');
const body=app.getBody();
chk(body.includes('rbf-svg'),'rb fan tab renders SVG chart');
chk(body.includes('RUN GRADE'),'rb fan tab renders OL run-grade cards');
chk(body.includes('Lane YPC'),'rb fan tab renders lane legend text');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
