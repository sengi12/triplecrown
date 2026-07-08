// Advanced (SumerSports) rankings integration: season gating, name-matched lookup,
// data-driven columns (single position + ALL/FLEX intersection), value read, formatting.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  ecrNormName, fmtSumer,
  sumerSeasonKey, sumerAvailable, sumerTableFor, sumerEntry, sumerColumnsForFilter, sumerValue,
  sumerBucket, sumerVolCol,
  setSumer:(s)=>{SUMER=s;}, setSeason:(s)=>{activeSeason=s;}, setPos:(p)=>{rankPosFilter=p;},
};`)();

// A tiny two-season, multi-position SUMER fixture in the seed's shape.
const SUMER={
  "2025":{
    WR:{columns:["Routes Run","Target Share","Total EPA","YPRR"], pct_cols:["Target Share"],
        players:{ "jaxon smithnjigba":{values:[497,35.82,141.85,3.61],team:"",rank:1} }},
    TE:{columns:["Routes Run","Target Share","Total EPA","YPRR"], pct_cols:["Target Share"],
        players:{ "trey mcbride":{values:[430,24.1,88.2,2.1],team:"",rank:1} }},
    RB:{columns:["Rushes","Total EPA","YAC","Target Share"], pct_cols:["Target Share"],
        players:{ "bijan robinson":{values:[300,55.0,900,12.0],team:"",rank:1} }},
    QB:{columns:["Plays","Total EPA","ADoT","Comp %"], pct_cols:["Comp %"],
        players:{ "josh allen":{values:[650,120.0,8.1,63.5],team:"",rank:1} }},
  },
  "2024":{
    WR:{columns:["Routes Run","Target Share","Total EPA","YPRR"], pct_cols:["Target Share"],
        players:{ "jaxon smithnjigba":{values:[500,25.0,80.0,2.0],team:"",rank:9} }},
  },
};
app.setSumer(SUMER);

let pass=0,fail=0;
function chk(name,cond){ if(cond){pass++;console.log('  PASS',name);} else {fail++;console.log('  FAIL',name);} }

console.log('=== TEST 1: season gating (reference-season driven) ===');
app.setSeason('proj');   chk('proj → unavailable',      app.sumerAvailable()===false);
app.setSeason('2019');   chk('2019 (no data) → unavailable', app.sumerAvailable()===false);
app.setSeason('2025');   chk('2025 → available',         app.sumerAvailable()===true);
chk('sumerSeasonKey=2025', app.sumerSeasonKey()==='2025');
app.setSeason('2024');   chk('2024 (partial data) → available', app.sumerAvailable()===true);

console.log('\n=== TEST 2: name-matched player lookup ===');
app.setSeason('2025');
const e=app.sumerEntry({name:"Ja'Marr"}); // no such -> null
chk('unknown player → null', e===null);
const jsn=app.sumerEntry({name:"Jaxon Smith-Njigba", pos:"WR"});
chk('JSN row found by normalized name', !!jsn && jsn.values[3]===3.61);
// 2024 has a different JSN line — season drives which table is read
app.setSeason('2024');
chk('2024 JSN reads 2024 table', app.sumerEntry({name:"Jaxon Smith-Njigba", pos:"WR"}).values[0]===500);

console.log('\n=== TEST 3: data-driven columns per position filter ===');
app.setSeason('2025');
app.setPos('WR');
let cols=app.sumerColumnsForFilter();
chk('WR → WR columns', cols && cols.single==='WR' && cols.cols.join(',')==="Routes Run,Target Share,Total EPA,YPRR");
chk('WR pct set has Target Share', cols.pct.has('Target Share') && !cols.pct.has('YPRR'));
app.setPos('QB');
chk('QB → QB columns', app.sumerColumnsForFilter().cols.join(',')==="Plays,Total EPA,ADoT,Comp %");

console.log('\n=== TEST 4: ALL/FLEX use the common (intersection) columns ===');
app.setPos('ALL');
let allCols=app.sumerColumnsForFilter();
// Only "Total EPA" is common to QB, RB, WR, TE.
chk('ALL → intersection {Total EPA}', allCols && allCols.single===null && allCols.cols.join(',')==="Total EPA");
app.setPos('FLEX');
let flexCols=app.sumerColumnsForFilter();
// FLEX excludes QB; RB+WR+TE share Total EPA + Target Share (RB has both).
chk('FLEX → shares Total EPA', flexCols.cols.includes('Total EPA'));
chk('FLEX → shares Target Share', flexCols.cols.includes('Target Share'));
chk('FLEX → excludes WR-only YPRR? (RB lacks it)', !flexCols.cols.includes('YPRR'));

console.log('\n=== TEST 5: value read by label + across positions ===');
app.setSeason('2025');
chk('sumerValue JSN YPRR', app.sumerValue({name:"Jaxon Smith-Njigba",pos:"WR"},"YPRR")===3.61);
chk('sumerValue Allen Total EPA', app.sumerValue({name:"Josh Allen",pos:"QB"},"Total EPA")===120.0);
chk('sumerValue missing player → null', app.sumerValue({name:"Nobody",pos:"WR"},"YPRR")===null);
chk('sumerValue missing label → null', app.sumerValue({name:"Josh Allen",pos:"QB"},"YPRR")===null);

console.log('\n=== TEST 6: formatting ===');
chk('percent formatting', app.fmtSumer(35.82,true)==='35.8%');
chk('integer formatting', app.fmtSumer(1793,false)==='1,793');
chk('small decimal (non-pct) 2dp', app.fmtSumer(0.33,false)==='0.33');
chk('null → dash', app.fmtSumer(null,false)==='—');

console.log('\n=== TEST 7: no data for a season → no columns ===');
app.setSeason('2024'); app.setPos('QB');   // 2024 fixture only has WR
chk('2024 QB (no table) → null columns', app.sumerColumnsForFilter()===null);

console.log('\n=== TEST 8: min-volume filter mapping (Plays/Routes/Rushes) ===');
chk('QB → QB bucket',  app.sumerBucket('QB')==='QB');
chk('RB → RB bucket',  app.sumerBucket('RB')==='RB');
chk('WR → WRTE bucket',app.sumerBucket('WR')==='WRTE');
chk('TE → WRTE bucket',app.sumerBucket('TE')==='WRTE');
chk('QB volume col = Plays',      app.sumerVolCol('QB')==='Plays');
chk('RB volume col = Rushes',     app.sumerVolCol('RB')==='Rushes');
chk('WR volume col = Routes Run', app.sumerVolCol('WR')==='Routes Run');
chk('TE volume col = Routes Run', app.sumerVolCol('TE')==='Routes Run');

console.log('\nRESULT:', fail===0 ? `PASS (${pass} checks)` : `FAIL (${fail}/${pass+fail})`);
process.exit(fail===0?0:1);
