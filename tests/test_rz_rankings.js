const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},value:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){},click(){}}),body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  playerSeasonOpportunity,
  setHistory:(h)=>{HISTORY=h;}, setActiveSeason:(s)=>{activeSeason=s;} };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

// HISTORY: player 100 = WR with RZ targets + air yards in 2025; player 200 = RB with RZ carries
const HIST={
  '100':{'2025':{team:'CIN',pos:'WR',name:'Ja\'Marr Chase',stats:{rec_tgt:175,rec:127,rec_yd:1700,rec_td:17,rec_rz_tgt:28,rec_air_yd:1400}}},
  '200':{'2025':{team:'CIN',pos:'RB',name:'Chase Brown',stats:{rush_att:220,rush_yd:990,rush_td:8,rush_rz_att:42}}},
  '300':{'2025':[  // multi-stint player (traded mid-season) — should sum
    {team:'LV',pos:'WR',stats:{rec_rz_tgt:5,rec_air_yd:300}},
    {team:'NYJ',pos:'WR',stats:{rec_rz_tgt:7,rec_air_yd:250}},
  ]},
};
app.setHistory(HIST);

console.log('=== playerSeasonOpportunity sums correctly ===');
const chase=app.playerSeasonOpportunity('100','2025');
chk(chase.rec_rz_tgt===28,'WR RZ targets = 28');
chk(chase.rec_air_yd===1400,'WR air yards = 1400');
chk(chase.rush_rz_att===0 || chase.rush_rz_att===null,'WR has no RZ carries');
const brown=app.playerSeasonOpportunity('200','2025');
chk(brown.rush_rz_att===42,'RB RZ carries = 42');

console.log('=== multi-stint player sums across teams ===');
const traded=app.playerSeasonOpportunity('300','2025');
chk(traded.rec_rz_tgt===12,'traded WR RZ targets summed (5+7=12)');
chk(traded.rec_air_yd===550,'traded WR air yards summed (300+250=550)');

console.log('=== missing player/season → null (shows dash, not 0) ===');
const none=app.playerSeasonOpportunity('999','2025');
chk(none.rec_rz_tgt===null,'unknown player → null RZ tgt');
const noSeason=app.playerSeasonOpportunity('100','2020');
chk(noSeason.rec_rz_tgt===null,'player with no 2020 record → null');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
