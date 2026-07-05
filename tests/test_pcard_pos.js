const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],appendChild(){},addEventListener(){},remove(){delete elStore[id];}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:(t)=>({tagName:t,style:{},className:'',id:'',innerHTML:'',appendChild(){},set onclick(f){},remove(){}}),body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.toast=()=>{};
const code=require('fs').readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { PCARD_SCHEMA, pcardRowValues, renderPcardSeason, pcardSeasonRows, pcardFptsFromStats,
  setScoring:(s)=>{scoringSettings=s;} };`)();
app.setScoring({passing_yards_yardage:25,passing_touchdowns:6,interceptions_thrown:-2,rushing_yards_yardage:10,rushing_touchdowns:6,receiving_yards_yardage:10,receptions:0.5,receiving_touchdowns:6,passing_attempts:0,fumbles_lost:-2});
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== schemas exist for all 4 positions ===');
['QB','RB','WR','TE'].forEach(p=>chk(!!app.PCARD_SCHEMA[p],p+' schema present'));
chk(app.PCARD_SCHEMA.TE===app.PCARD_SCHEMA.WR,'TE reuses WR schema');

console.log('\n=== QB has RUSHING group now ===');
const qbGroups=app.PCARD_SCHEMA.QB.group.map(g=>g[0]);
chk(qbGroups.join(',')==='FANTASY,PASSING,RUSHING','QB groups: '+qbGroups.join(','));

console.log('\n=== QB row values incl rushing (Burrow wk6 2024: 208pass, 4att/55rush/1td) ===');
const qbS={pass_cmp:19,pass_yd:208,pass_td:0,pass_int:0,rush_att:4,rush_yd:55,rush_td:1};
const qv=app.pcardRowValues('QB',qbS,{fpts:20,snp:100,rank:null});
chk(qv.p_yd===208&&qv.ru_att===4&&qv.ru_yd===55&&qv.ru_td===1,'QB rushing populated');
chk(Math.abs(qv.ru_ypc-13.75)<0.01,'QB YPC = 55/4 = 13.75');

console.log('\n=== RB (James Cook wk8 2024: 19att/216yd/2td rush, 0 rec) ===');
const rbS={rush_att:19,rush_yd:216,rush_td:2,rec_tgt:0,rec:0,rec_yd:0,rec_td:0};
const rv=app.pcardRowValues('RB',rbS,{fpts:33.6,snp:44,rank:2});
chk(rv.ru_att===19&&rv.ru_yd===216&&rv.ru_td===2,'RB rushing');
chk(Math.abs(rv.ru_ypc-11.37)<0.01,'RB YPC = 216/19 = 11.37');
chk(rv.re_tar===0&&rv.re_rec===0,'RB receiving zeros');

console.log('\n=== WR (Ja\'Marr Chase wk2 2025: 16tar/14rec/165yd/1td) ===');
const wrS={rec_tgt:16,rec:14,rec_yd:165,rec_td:1,rush_att:0,rush_yd:0,rush_td:0};
const wv=app.pcardRowValues('WR',wrS,{fpts:29.5,snp:96,rank:3});
chk(wv.re_tar===16&&wv.re_rec===14&&wv.re_yd===165&&wv.re_td===1,'WR receiving');
chk(Math.abs(wv.re_ypt-10.31)<0.01,'WR YPT = 165/16 = 10.31');
chk(Math.abs(wv.re_ypc-11.79)<0.01,'WR YPC = 165/14 = 11.79');

console.log('\n=== render RB season table with 3 groups + horizontal scroll ===');
const weekly={
  '8':{team:'BUF',opponent:'CAR',stats:{gp:1,rush_att:19,rush_yd:216,rush_td:2,off_snp:44,tm_off_snp:100}},
  '7':{team:'BUF',opponent:null,stats:{gp:0}},
};
const rows=app.pcardSeasonRows(weekly,'RB');
const html=app.renderPcardSeason(2024,rows,'RB');
chk(html.includes('RUSHING')&&html.includes('RECEIVING')&&html.includes('FANTASY'),'RB 3 group headers');
chk(html.includes('pcard-table-scroll'),'horizontal scroll wrapper');
chk(html.includes('216'),'shows rush yards');
chk(html.includes('BYE'),'BYE row');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
