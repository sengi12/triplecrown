const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],appendChild(){},addEventListener(){},remove(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:(t)=>({tagName:t,style:{},className:'',id:'',innerHTML:'',appendChild(){},set onclick(f){},remove(){}}),body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.toast=()=>{};
const code=require('fs').readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { PCARD_SCHEMA, pcardRowValues, pcardRankKey, pcardSeasonTotals, _passerRating, renderPcardSeason, pcardSeasonRows,
  setScoring:(s)=>{scoringSettings=s;}, setFormat:(f)=>{rankFormat=f;} };`)();
app.setScoring({passing_yards_yardage:25,passing_touchdowns:6,interceptions_thrown:-2,rushing_yards_yardage:10,rushing_touchdowns:6,receiving_yards_yardage:10,receptions:0.5,receiving_touchdowns:6,passing_attempts:0,fumbles_lost:-2});
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== RANK key follows scoring format ===');
app.setFormat('ppr'); chk(app.pcardRankKey()==='pos_rank_ppr','ppr → pos_rank_ppr');
app.setFormat('std'); chk(app.pcardRankKey()==='pos_rank_std','std → pos_rank_std');
app.setFormat('half_ppr'); chk(app.pcardRankKey()==='pos_rank_half_ppr','half → pos_rank_half_ppr');

console.log('\n=== QB advanced passing stats ===');
const qbS={pass_cmp:30,pass_att:39,pass_yd:392,pass_td:5,pass_int:0,pass_lng:55,pass_rtg:135.2,pass_rz_att:6,pass_sack:2,cmp_pct:76.9};
const qv=app.pcardRowValues('QB',qbS,{fpts:43,snp:100,rank:2});
chk(qv.p_lng===55,'PASS LNG');
chk(qv.p_rtg===135.2,'PASS RTG');
chk(qv.p_rz_att===6,'RZ ATT');
chk(qv.p_sack===2,'SACK');
chk(Math.abs(qv.p_cmp_pct-76.9)<0.1,'CMP PCT');
chk(app.PCARD_SCHEMA.QB.cols.some(c=>c.key==='p_rtg'),'passer rating col in PASSING');

console.log('\n=== WR advanced receiving (AIR after YPC, LNG+RZ before TD) ===');
const wrS={rec_tgt:16,rec:14,rec_yd:165,rec_td:1,rec_air_yd:120,rec_lng:38,rec_rz_tgt:3};
const wv=app.pcardRowValues('WR',wrS,{fpts:29,snp:96,rank:3});
chk(wv.re_air===120,'AIR yards');
chk(wv.re_lng===38,'REC LNG');
chk(wv.re_rz_tgt===3,'REC RZ');
// verify column order: AIR after YPC, LNG+RZ right before TD
const wrCols=app.PCARD_SCHEMA.WR.cols.map(c=>c.key);
chk(wrCols.indexOf('re_air')===wrCols.indexOf('re_ypc')+1,'AIR right after YPC');
chk(wrCols.indexOf('re_td')===wrCols.indexOf('re_rz_tgt')+1,'TD right after RZ');

console.log('\n=== RB advanced rushing (LNG after YPC, RZ before TD) ===');
const rbS={rush_att:19,rush_yd:216,rush_td:2,rush_lng:40,rush_rz_att:3};
const rv=app.pcardRowValues('RB',rbS,{fpts:33,snp:44,rank:2});
chk(rv.ru_lng===40,'RUSH LNG');
chk(rv.ru_rz_att===3,'RUSH RZ');
const rbCols=app.PCARD_SCHEMA.RB.cols.map(c=>c.key);
chk(rbCols.indexOf('ru_lng')===rbCols.indexOf('ru_ypc')+1,'LNG right after YPC');
chk(rbCols.indexOf('ru_td')===rbCols.indexOf('ru_rz_att')+1,'TD right after RZ');

console.log('\n=== Season totals row ===');
const weekly={
  '1':{team:'CIN',opponent:'NE',stats:{gp:1,pass_cmp:21,pass_att:29,pass_yd:164,pass_td:0,pass_int:0,pass_lng:30,pass_sack:2,pos_rank_half_ppr:29,off_snp:70,tm_off_snp:70}},
  '2':{team:'CIN',opponent:'KC',stats:{gp:1,pass_cmp:23,pass_att:36,pass_yd:258,pass_td:2,pass_int:0,pass_lng:45,pass_sack:1,pos_rank_half_ppr:10,off_snp:70,tm_off_snp:70}},
  '7':{team:'CIN',opponent:null,stats:{gp:0}},
};
app.setFormat('half_ppr');
const rows=app.pcardSeasonRows(weekly,'QB');
const tot=app.pcardSeasonTotals(rows,'QB');
chk(tot._games===2,'2 games counted (BYE excluded)');
chk(tot.p_yd===164+258,'passing yards summed = 422');
chk(tot.p_td===2,'TDs summed');
chk(tot.p_lng===45,'LNG is the MAX (45), not summed');
chk(tot.p_sack===3,'sacks summed');
chk(Math.abs(tot.p_cmp_pct-(44/65*100))<0.1,'CMP% recomputed from totals');
// render includes totals row
const html=app.renderPcardSeason(2024,rows,'QB');
chk(html.includes('pcard-total-row')&&html.includes('TOT'),'totals row rendered');
chk(html.includes('2g'),'games count shown');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
