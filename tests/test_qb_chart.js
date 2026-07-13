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
  pcardQbPassingAvailable, renderPcardQbPassing, renderPcardStatTabs, setPcardStatsMode,
  setPlayers:(p)=>{sleeperPlayers=p;},
  setNflverse:(n)=>{NFLVERSE=n;},
  setPcardState:(s)=>{pcardState=s;},
  setMode:(m)=>{pcardStatsMode=m;},
  getTabs:()=>document.getElementById('pcardTabs').innerHTML,
  getBody:()=>document.getElementById('pcardBody').innerHTML,
};`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== TEST: QB passing chart tab wiring ===');
app.setPlayers({'1':{name:'Joe Burrow',pos:'QB'}});
app.setNflverse({'2025':{qb_passing:{'joe burrow':{
  totals:{passer_rating:100.7,comp_pct:66.8,yards:1809,td:17,int:5,attempts:259},
  zones:{
    deep:{left:{rating:84.5,league_avg:88.0,attempts:11},middle:{rating:135.4,league_avg:102.2,attempts:4},right:{rating:103.8,league_avg:81.2,attempts:13}},
    inter:{left:{rating:122.9,league_avg:84.9,attempts:22},middle:{rating:113.2,league_avg:98.2,attempts:15},right:{rating:114.6,league_avg:83.8,attempts:19}},
    short:{left:{rating:96.4,league_avg:93.7,attempts:42},middle:{rating:80.9,league_avg:95.9,attempts:27},right:{rating:115.6,league_avg:96.4,attempts:56}},
    behind:{left:{rating:76.9,league_avg:88.1,attempts:28},middle:{rating:97.2,league_avg:72.3,attempts:3},right:{rating:49.7,league_avg:88.1,attempts:19}},
  }
}}}});
chk(app.pcardQbPassingAvailable('1'),'QB passing chart available for player');

app.setPcardState({pid:'1',posc:'QB',isSkill:true});
app.setMode('pro');
app.renderPcardStatTabs();
const tabs=app.getTabs();
chk(tabs.includes('Passing Chart'),'player card tabs include Passing Chart');

app.setPcardStatsMode('passing');
const body=app.getBody();
chk(body.includes('qpc-svg'),'passing tab renders SVG chart');
chk(body.includes('Passer Rating'),'passing tab renders totals tiles');
chk(body.includes('BETTER THAN AVG') || body.includes('Better than average'),'passing tab renders legend');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
