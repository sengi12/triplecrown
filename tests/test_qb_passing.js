const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],appendChild(){},addEventListener(){},remove(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:(t)=>({tagName:t,style:{},className:'',id:'',innerHTML:'',appendChild(){},set onclick(f){},remove(){}}),body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.toast=()=>{};
const code=require('fs').readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+'return { PCARD_SCHEMA, pcardRowValues, pcardSeasonTotals, pcardSeasonRows, renderPcardSeason, setScoring:(s)=>{scoringSettings=s;}, setFormat:(f)=>{rankFormat=f;} };')();
app.setScoring({passing_yards_yardage:25,passing_touchdowns:6,interceptions_thrown:-2,rushing_yards_yardage:10,rushing_touchdowns:6,receiving_yards_yardage:10,receptions:0.5,receiving_touchdowns:6,passing_attempts:0,fumbles_lost:-2});
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== QB PASSING group order: ATT|CMP|PCT|YD|AIR|LNG|RTG|RZ|TD (+INT,SACK) ===');
const passingCols=app.PCARD_SCHEMA.QB.cols.filter(c=>c.grp===1).map(c=>c.label);
console.log('  order:', passingCols.join(' | '));
chk(passingCols.slice(0,9).join(',')==='ATT,CMP,PCT,YD,AIR,LNG,RTG,RZ,TD','first 9 match requested order');
chk(app.PCARD_SCHEMA.QB.group.filter(g=>g[0]==='PASSING').length===1,'single PASSING group');
chk(!app.PCARD_SCHEMA.QB.group.some(g=>g[0]==='ADV PASSING'),'no separate ADV PASSING group');

console.log('\n=== all passing stats populate (incl ATT that was missing) ===');
const s={pass_att:39,pass_cmp:30,pass_yd:392,pass_td:5,pass_int:1,pass_lng:55,pass_rtg:135.2,pass_rz_att:6,pass_sack:2,cmp_pct:76.9};
const v=app.pcardRowValues('QB',s,{fpts:43,snp:100,rank:2});
chk(v.p_att===39,'ATT = 39 (restored)');
chk(v.p_cmp===30,'CMP = 30');
chk(Math.abs(v.p_cmp_pct-76.9)<0.1,'PCT = 76.9');
chk(v.p_yd===392,'YD = 392');
chk(v.p_lng===55,'LNG = 55');
chk(v.p_rtg===135.2,'RTG');
chk(v.p_rz_att===6,'RZ = 6');
chk(v.p_td===5,'TD = 5');
chk(v.p_int===1,'INT = 1');
chk(v.p_sack===2,'SACK = 2');

console.log('\n=== totals row includes ATT and PCT ===');
app.setFormat('half_ppr');
const weekly={
  '1':{team:'CIN',opponent:'NE',is_away_team:false,stats:{gp:1,pass_att:29,pass_cmp:21,pass_yd:164,pass_td:0,pass_int:0,off_snp:70,tm_off_snp:70}},
  '2':{team:'CIN',opponent:'KC',is_away_team:true,stats:{gp:1,pass_att:36,pass_cmp:23,pass_yd:258,pass_td:2,pass_int:0,off_snp:70,tm_off_snp:70}},
};
const rows=app.pcardSeasonRows(weekly,'QB');
const tot=app.pcardSeasonTotals(rows,'QB');
chk(tot.p_att===65,'ATT summed = 65');
chk(tot.p_cmp===44,'CMP summed = 44');
chk(Math.abs(tot.p_cmp_pct-(44/65*100))<0.1,'PCT recomputed from totals');
const html=app.renderPcardSeason(2024,rows,'QB');
chk(html.split('ATT').length-1>=1,'ATT header present in render');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
