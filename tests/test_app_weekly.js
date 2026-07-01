const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { aggregateWeeksByTeam };`)();
const weekly=JSON.parse(fs.readFileSync(require('path').join(__dirname,'flacco_real.json'),'utf8'));
const split=app.aggregateWeeksByTeam(weekly);
console.log('App-side aggregateWeeksByTeam result:');
split.forEach(r=>console.log(`  ${r.team}: games_played=${r.games_played}, snap%=${r.snap_pct}, pass_yd=${r.stats.passing_yards}`));
const cle=split.find(r=>r.team==='CLE'), cin=split.find(r=>r.team==='CIN');
console.log('RESULT:', cle&&cin&&cle.games_played===4&&cin.games_played===7&&cin.stats.passing_yards===1664?'PASS (matches Python)':'FAIL');
