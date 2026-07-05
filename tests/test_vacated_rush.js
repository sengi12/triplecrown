const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},value:'',dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){},focus(){},blur(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){},click(){}}),body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};global.Chart=function(){return{destroy(){},update(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  vacatedRushing, vacatedRushNote, vacatedProduction, vacatedNote,
  setActive:(s)=>{activeSeason=s;}, setHistSeasons:(h)=>{HISTORY_SEASONS=h;},
  setCache:(c)=>{seasonStatsCache=c;}, setProjSeed:(p)=>{projSeed=p;}, setSleeper:(s)=>{sleeperPlayers=s;},
  PROJ:PROJ_SEASON };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

// Last year's CIN roster: Joe Mixon (gone, big carries+RZ), Chase Brown (stays)
const prev2025={CIN:{
  RB:[
    {player_id:'mixon',name:'Joe Mixon',rushing_attempts:210,rushing_yards:1000,rushing_tds:9,rush_rz_att:38,receiving_targets:40,receptions:30,receiving_yards:250,receiving_tds:2,rec_rz_tgt:8},
    {player_id:'brown',name:'Chase Brown',rushing_attempts:100,rushing_yards:450,rushing_tds:4,rush_rz_att:12},
  ],
  WR:[{player_id:'higgins',name:'Tee Higgins',receiving_targets:100,receptions:70,receiving_yards:900,receiving_tds:9,rec_rz_tgt:18}],
  TE:[],QB:[{player_id:'burrow',name:'Joe Burrow',qb_rush_attempts:30,qb_rush_yards:120,qb_rush_tds:2}],
}};
// Current roster: Brown + Burrow stay; Mixon and Higgins gone
app.setActive('proj');
app.setHistSeasons(['2025']);
app.setCache({'2025':prev2025});
app.setProjSeed({CIN:{QB:[{player_id:'burrow'}],RB:[{player_id:'brown'}],WR:[],TE:[]}});
app.setSleeper({burrow:{team:'CIN'},brown:{team:'CIN'}});

console.log('=== Vacated rushing (carries) ===');
const vr=app.vacatedRushing('CIN');
chk(vr!==null,'vacated rushing computed');
chk(vr.att===210,'Mixon 210 carries vacated (Brown/Burrow stay)');
chk(vr.players[0]==='Joe Mixon','Mixon listed first (most carries)');
const vrNote=app.vacatedRushNote('CIN');
chk(vrNote.includes('210 carries'),'note shows 210 carries');
chk(vrNote.includes('Joe Mixon'),'note names Mixon');

console.log('=== Vacated receiving ===');
const vp=app.vacatedProduction('CIN');
chk(vp!==null,'vacated receiving computed');
// Higgins (gone) 100 tgt 18 rz; Mixon (gone) 40 tgt 8 rz → 140 tgt, 26 rz
chk(vp.tgt===140,'140 targets vacated (Higgins+Mixon)');
const vNote=app.vacatedNote('CIN');

console.log('=== Non-proj season → no note ===');
app.setActive('2025');
chk(app.vacatedRushing('CIN')===null,'no vacated rushing off-projection');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
