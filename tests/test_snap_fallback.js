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
console.log('Flacco split (with snap fallback):');
split.forEach(r=>console.log(`  ${r.team}: games=${r.games_played}, snap%=${r.snap_pct}, pass_yd=${r.stats.passing_yards}`));
const cle=split.find(r=>r.team==='CLE'), cin=split.find(r=>r.team==='CIN');
// Week 18 has gp:1 but NO off_snp/tm_off_snp — with fallback it SHOULD count as a game
// Flacco week 18: CIN, gp=1, rush_att=1, rush_yd=2 (no passing, no snaps)
// With fallback: CIN should now be 7 games (6 starts + 1 no-snap week 18)
// WITHOUT fallback it was 6
console.log('CIN games (expect 7 with snap fallback for wk18):', cin.games_played);
console.log('CLE games (expect 4):', cle.games_played);
// Weeks 16-17 still excluded (they HAVE snap data showing <50%)
console.log('RESULT:', cle.games_played===4&&cin.games_played===7?'PASS':'CHECK ('+cin.games_played+' CIN games)');
