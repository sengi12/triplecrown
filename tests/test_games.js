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
const tua=atl.ATL.QB.find(q=>q.name==='Tua'), penix=atl.ATL.QB.find(q=>q.name==='Penix');
// Tua 57% → ceil(.577*17)=10; Penix 42% → ceil(.423*17)=8
console.log('RESULT:', tua.games>=9&&tua.games<=11&&penix.games>=7&&penix.games<=9?'PASS (committee split)':'FAIL');

console.log('\n=== CIN clear starter (Burrow dominant, Flacco padding) ===');
const cin=app.assembleSeed(
  {bur:{player_id:'bur',name:'Burrow',pos:'QB',team:'CIN'},fla:{player_id:'fla',name:'Flacco',pos:'QB',team:'CIN'}},
  {bur:app.normalizeSleeperRow({player_id:'bur',team:'CIN',position:'QB',stats:{pass_yd:4200,pass_att:580,gp:18}}),
   fla:app.normalizeSleeperRow({player_id:'fla',team:'CIN',position:'QB',stats:{pass_yd:400,pass_att:60,gp:18}})}, true);
cin.CIN.QB.forEach(q=>console.log(`  ${q.name}: ${q.games} games (${q.passing_yards} yds)`));
const bur=cin.CIN.QB.find(q=>q.name==='Burrow'), fla=cin.CIN.QB.find(q=>q.name==='Flacco');
console.log('RESULT:', bur.games===17&&fla.games===0?'PASS (Burrow 17, Flacco 0)':'FAIL');
