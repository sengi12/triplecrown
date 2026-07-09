const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const path=require('path');
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  assembleSeed, normalizeSleeperRow, ensureTeam, initPassingShares, buildPlayerList,
  contractEntry, hasContracts, fmtAPY, ecrNormName, contractSummaryHTML,
  setSEED:(s)=>{SEED=s;projSeed=s;seasonStatsCache.proj=s;workingProj={};userProj=workingProj;activeSeason='proj';},
  setContracts:(c)=>{CONTRACTS=c;},
  setFormat:(f)=>{rankFormat=f;},
  getProjSeason:()=>PROJ_SEASON,
  renderRankings, getContentHTML:()=>document.getElementById('content').innerHTML };
`)();

console.log('=== TEST 1: fmtAPY formatting ===');
console.log('40250000 →', app.fmtAPY(40250000), '(expect $40.3M)');
console.log('23333333 →', app.fmtAPY(23333333), '(expect $23.3M)');
console.log('900000 →', app.fmtAPY(900000), '(expect $900K)');
const ok1=app.fmtAPY(40250000)==='$40.3M' && app.fmtAPY(900000)==='$900K';
console.log('RESULT:', ok1?'PASS':'FAIL');

console.log('\n=== TEST 2: contract data attaches to players ===');
const players={cmc:{player_id:'cmc',name:'Christian McCaffrey',pos:'RB',team:'SF'},
  pit:{player_id:'pit',name:'Michael Pittman',pos:'WR',team:'IND'}};
const idx={cmc:app.normalizeSleeperRow({player_id:'cmc',team:'SF',position:'RB',stats:{rush_att:250,rush_yd:1400,rush_td:14,rec:60,rec_yd:500,rec_tgt:80,gp:17}}),
  pit:app.normalizeSleeperRow({player_id:'pit',team:'IND',position:'WR',stats:{rec:90,rec_yd:1000,rec_td:6,rec_tgt:130,gp:17}})};
app.setSEED(app.assembleSeed(players,idx));
app.setContracts({
  'christian mccaffrey':{age:28,apy:19000000,fa:2028,pos:'RB'},
  'michael pittman':{age:27,apy:23333333,fa:2027,pos:'WR'}
});
app.setFormat('dynasty');
const list=app.buildPlayerList();
const cmc=list.find(p=>p.name==='Christian McCaffrey');
const pit=list.find(p=>p.name==='Michael Pittman');
console.log('CMC: age='+cmc.age+', apy='+cmc.apy+', fa='+cmc.fa);
console.log('Pittman: age='+pit.age+', apy='+pit.apy+', fa='+pit.fa);
const ok2=cmc.age===28 && cmc.fa===2028 && pit.fa===2027 && pit.apy===23333333;
console.log('RESULT:', ok2?'PASS (contract data attached)':'FAIL');

console.log('\n=== TEST 3: FA red highlight only for next year (2027) ===');
app.renderRankings();
const html=app.getContentHTML();
const projSeason=app.getProjSeason();
console.log('PROJ_SEASON:', projSeason, '→ next year:', projSeason+1);
const hasFaSoon = html.includes('fa-soon');
const pittmanSoon = /c-fa fa-soon[^>]*>[^<]*<span[^>]*>2027/.test(html);
console.log('Has fa-soon class in table:', hasFaSoon);
console.log('2027 (Pittman) flagged fa-soon:', pittmanSoon);
console.log('RESULT:', hasFaSoon && pittmanSoon?'PASS (only next-year FA highlighted red)':'FAIL');

console.log('\n=== TEST 4: contract columns ONLY in dynasty mode ===');
app.setFormat('half_ppr');
app.renderRankings();
const htmlHalf=app.getContentHTML();
const hasAgeHeader_dyn = (()=>{app.setFormat('dynasty');app.renderRankings();return app.getContentHTML().includes('>AGE');})();
const hasAgeHeader_half = htmlHalf.includes('>AGE');
console.log('AGE header in half_ppr:', hasAgeHeader_half, '(expect false)');
console.log('AGE header in dynasty:', hasAgeHeader_dyn, '(expect true)');
console.log('RESULT:', !hasAgeHeader_half && hasAgeHeader_dyn?'PASS (columns dynasty-only)':'FAIL');

console.log('\n=== TEST 5: contract summary band (player-card top section) ===');
app.setContracts({
  'patrick mahomes':{age:31,apy:64000000,fa:2034,total:448000000,gtd:182800000,pos:'QB'},
  'no deal guy':{age:25,apy:null,fa:null,total:null,gtd:null,pos:'WR'}
});
const band=app.contractSummaryHTML('Patrick Mahomes');
console.log(band);
const ok5main = band.includes('$64M') && band.includes('7 yrs') && band.includes('$448M total')
  && band.includes('$182.8M gtd') && band.includes('FA') && band.includes('2034');
const ok5none = app.contractSummaryHTML('Unknown Player')==='';   // no contract on file → no band
const ok5null = app.contractSummaryHTML('No Deal Guy')==='';       // all-null contract → no band
const ok5derive = app.contractSummaryHTML('Patrick Mahomes').includes('7 yrs'); // 448M/64M → 7
console.log('band renders APY/len/total/gtd/FA:', ok5main);
console.log('missing & all-null → empty:', ok5none && ok5null);
console.log('RESULT:', ok5main && ok5none && ok5null && ok5derive?'PASS (contract band)':'FAIL');
