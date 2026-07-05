const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],appendChild(){},addEventListener(){},remove(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:(t)=>({tagName:t,style:{},className:'',id:'',innerHTML:'',appendChild(){},set onclick(f){},remove(){}}),body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.toast=()=>{};
const code=require('fs').readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+'return { PCARD_SCHEMA, pcardSeasonRows, renderPcardSeason, setScoring:(s)=>{scoringSettings=s;}, setFormat:(f)=>{rankFormat=f;} };')();
app.setScoring({passing_yards_yardage:25,passing_touchdowns:6,interceptions_thrown:-2,rushing_yards_yardage:10,rushing_touchdowns:6,receiving_yards_yardage:10,receptions:0.5,receiving_touchdowns:6,passing_attempts:0,fumbles_lost:-2});
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== ATT/CMP/RZ now colored ===');
const attCol=app.PCARD_SCHEMA.QB.cols.find(c=>c.key==='p_att');
const cmpCol=app.PCARD_SCHEMA.QB.cols.find(c=>c.key==='p_cmp');
const rzCol=app.PCARD_SCHEMA.QB.cols.find(c=>c.key==='p_rz_att');
chk(attCol.color(40)==='g'&&attCol.color(30)==='y'&&attCol.color(20)==='r','ATT g/y/r by volume');
chk(cmpCol.color(26)==='g'&&cmpCol.color(20)==='y'&&cmpCol.color(12)==='r','CMP g/y/r');
chk(rzCol.color(5)==='g'&&rzCol.color(2)==='y'&&rzCol.color(1)==='r','RZ g/y/r');

console.log('\n=== vs prefix for home, @ for away ===');
app.setFormat('half_ppr');
const weekly={
  '1':{team:'CIN',opponent:'NE',is_away_team:false,stats:{gp:1,pass_att:35,pass_cmp:24,pass_yd:250,pass_td:2,pass_int:0,pass_rz_att:4,off_snp:70,tm_off_snp:70}},
  '2':{team:'CIN',opponent:'KC',is_away_team:true,stats:{gp:1,pass_att:20,pass_cmp:12,pass_yd:150,pass_td:0,pass_int:1,pass_rz_att:1,off_snp:70,tm_off_snp:70}},
};
const rows=app.pcardSeasonRows(weekly,'QB');
const html=app.renderPcardSeason(2024,rows,'QB');
chk(html.includes('pcard-vs')&&html.includes('>vs<'),'vs marker present');
chk(html.includes('pcard-at')&&html.includes('>@<'),'@ marker present');
// home NE row should have vs, away KC should have @
const neIdx=html.indexOf('>NE<'), keIdx=html.indexOf('>KC<');
chk(html.slice(0,neIdx).lastIndexOf('pcard-vs')>html.slice(0,neIdx).lastIndexOf('pcard-at'),'NE (home) uses vs');
chk(html.slice(0,keIdx).lastIndexOf('pcard-at')>html.slice(0,keIdx).lastIndexOf('pcard-vs'),'KC (away) uses @');

console.log('\n=== wk1 (35att/24cmp/4rz) greens, wk2 (20att/12cmp/1rz) reds ===');
// verify color classes applied in the rendered cells
chk(html.includes('pcard-cell g'),'has green cells');
chk(html.includes('pcard-cell r'),'has red cells');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
