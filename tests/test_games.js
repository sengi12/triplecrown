const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { assembleSeed, normalizeSleeperRow };`)();

// ATL: Tua 2141 yds (57%), Penix 1567 (42%) — committee. gp=18 for both (useless)
console.log('=== ATL committee ===');
const atl=app.assembleSeed(
  {tua:{player_id:'tua',name:'Tua',pos:'QB',team:'ATL'},penix:{player_id:'penix',name:'Penix',pos:'QB',team:'ATL'}},
  {tua:app.normalizeSleeperRow({player_id:'tua',team:'ATL',position:'QB',stats:{pass_yd:2141,pass_att:300,gp:18}}),
   penix:app.normalizeSleeperRow({player_id:'penix',team:'ATL',position:'QB',stats:{pass_yd:1567,pass_att:230,gp:18}})}, true);
atl.ATL.QB.forEach(q=>console.log(`  ${q.name}: ${q.games} games (${q.passing_yards} yds)`));
const atlQbs=atl.ATL.QB.slice().sort((a,b)=>(b.passing_yards||0)-(a.passing_yards||0));
const lead=atlQbs[0], second=atlQbs[1];
// 57/42 split should remain a committee regardless of display-name changes.
console.log('RESULT:', atlQbs.length>=2 && lead.games>=9&&lead.games<=11&&second.games>=7&&second.games<=9?'PASS (committee split)':'FAIL');

console.log('\n=== CIN clear starter (Burrow dominant, Flacco padding) ===');
const cin=app.assembleSeed(
  {bur:{player_id:'bur',name:'Burrow',pos:'QB',team:'CIN'},fla:{player_id:'fla',name:'Flacco',pos:'QB',team:'CIN'}},
  {bur:app.normalizeSleeperRow({player_id:'bur',team:'CIN',position:'QB',stats:{pass_yd:4200,pass_att:580,gp:18}}),
   fla:app.normalizeSleeperRow({player_id:'fla',team:'CIN',position:'QB',stats:{pass_yd:400,pass_att:60,gp:18}})}, true);
cin.CIN.QB.forEach(q=>console.log(`  ${q.name}: ${q.games} games (${q.passing_yards} yds)`));
const cinQbs=cin.CIN.QB.slice().sort((a,b)=>(b.passing_yards||0)-(a.passing_yards||0));
const starter=cinQbs[0], backup=cinQbs[1];
console.log('RESULT:', cinQbs.length>=2 && starter.games===17&&backup.games===0?'PASS (starter 17, backup 0)':'FAIL');
