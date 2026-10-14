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
  qtrSplits:_qtrShareSplits,
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
const NV0={'2025':{rb_fan:{'joe mixon':{
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
}}}};
app.setNflverse(NV0);
chk(app.pcardRbFanAvailable('2'),'RB rushing fan available for player');

app.setPcardState({pid:'2',posc:'RB',isSkill:true});
app.setMode('pro');
app.renderPcardStatTabs();
const tabs=app.getTabs();
chk(tabs.includes('Rushing Fan'),'player card tabs include Rushing Fan');

app.setPcardStatsMode('rbfan');
const body=app.getBody();
chk(body.includes('rbf-svg'),'rb fan tab renders SVG chart');
// Assert on the data that must appear, not on a header string. The previous check looked
// for a literal 'RUN GRADE' label that the chart rework dropped; because this suite was
// never registered in run_tests.sh, the assertion rotted unnoticed while the feature worked.
chk(['Tunsil','Green','Patterson','Mason','Howard'].every(n=>body.includes(n)),
    'rb fan tab renders an OL card for all five line slots');
chk(body.includes('Lane YPC'),'rb fan tab renders lane legend text');

console.log('=== quarter volume splits (shared by the carry map and the target map) ===');
const _qnode={games:[ {wk:1, qc:[6,2,4,0], qt:[8,4,8,0]}, {wk:2, qc:[3,3,1,2], qt:[6,6,4,4]} ]};
const _sAll=app.qtrSplits(_qnode, null, 'Carry share by quarter', '· cut', 'designed rushes', 'CAR');
chk(/Q1<\/label><b>64%/.test(_sAll) && /Q2<\/label><b>50%/.test(_sAll) && /Q3<\/label><b>42%/.test(_sAll) && /Q4<\/label><b>50%/.test(_sAll) && /Carry share by quarter/.test(_sAll),
    'the season splits sum his carries over the team\'s per quarter (9/14, 5/10, 5/12, 2/4)');
chk(/Q1<\/label><b>64%<span class="qpc-ct">9 CAR<\/span>/.test(_sAll) && /Q4<\/label><b>50%<span class="qpc-ct">2 CAR<\/span>/.test(_sAll), 'each tile shows his own count and unit small beside the share (9 CAR in Q1, 2 CAR in Q4)');
const _sWk=app.qtrSplits(_qnode, 1, 'Carry share by quarter', '· cut', 'designed rushes');
chk(/Q1<\/label><b>75%/.test(_sWk) && /Q4<\/label><b>—/.test(_sWk), 'a picked week uses just that game; a quarter the team never ran reads —');
chk(app.qtrSplits({games:[{wk:1, plays:[]}]}, null, 'x','y','z')==='' && app.qtrSplits(null, null, 'x','y','z')==='', 'no quarter data on the node → nothing renders');
const _cnode={games:[ {wk:1, qc:[6,2,4,0], qt:[8,4,8,0], qk:[8,4,8,0]}, {wk:2, qc:[3,3,1,2], qt:[6,6,4,4], qk:[6,6,0,0]} ]};
const _sc=app.qtrSplits(_cnode, null, 'Carry share by quarter', '· cut', 'designed rushes', 'CAR');
chk(/<label class="qk-hi">Q1<\/label>/.test(_sc) && /<label class="qk-gt">Q4<\/label>/.test(_sc) && /qpc-legend-c/.test(_sc), 'the quarter marker is tinted by competitiveness — Q1 all in reach → green, Q4 garbage time → red — with a small legend');
chk(!/qk-hi|qk-gt|qpc-legend-c/.test(_sAll), 'a node without competitiveness data → plain markers, no legend');


console.log('=== the banner reads the one scorer: the weekly recompute, not the builder\'s season table ===');
(function(){
  const pass_cols=['dropbacks','designed_rushes','sacks','times_pressured','times_hit','times_hurried','times_blitzed','non_qb_sacks','no_blitz_pressures','pocket_time_w','pocket_time_att'];
  const run_cols=['designed_rushes','stuffed','explosive','rush_yards','ybc','yac','broken_tackles','rush_first_downs','ngs_att','roe_w','box8_w','tlos_w','rush_successes','rush_rb_att'];
  const mk=(st,ry,succ)=>({pass:[[30,30,2,8,3,4,8,1,2,60,25]], run:[[30,st,3,ry,60,90,4,6,30,10,300,60,succ,30]]});
  const pack={weeks:[1], pass_cols, run_cols, teams:{HOU:mk(2,180,16), KC:mk(6,120,12), DEN:mk(9,90,8)}};
  const nv=JSON.parse(JSON.stringify(NV0));
  nv['2025'].ol_weekly=pack;
  nv['2025'].team={offensive_line_run:{columns:['Run Score'], teams:{HOU:{values:{'Run Score':99}, ranks:{'Run Score':32}}}}};
  app.setNflverse(nv);
  const html=app.renderPcardRbFan('2');
  const m=/Cumulative Run Blocking Score[^:]*: ([\d.]+)<\/b>/.exec(html);
  chk(m && Number(m[1])!==99 && Number(m[1])>50, `with the weekly sidecar loaded the banner is the recompute's number (${m&&m[1]}), not the season table's 99`);
  chk(/run-block grades/.test(html) && /same number as the team page/.test(html), 'the banner says the letters are run-block grades and that the number is the team page\'s');
  delete nv['2025'].ol_weekly; app.setNflverse(nv);
  const h2=app.renderPcardRbFan('2');
  chk(/Cumulative Run Blocking Score: 99\.0<\/b>/.test(h2), 'without the weekly sidecar the season table stands in');
})();
console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
