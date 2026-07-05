const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},value:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},removeChild(){},querySelectorAll:()=>[],addEventListener(){},remove(){delete elStore[id];}};return elStore[id];}
let appended=[];
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>{const e={style:{},className:'',innerHTML:'',appendChild(){},set onclick(f){},remove(){}};return e;},body:{appendChild:(e)=>{appended.push(e);},removeChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.toast=()=>{};
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  pcardFptsFromStats, pcardSeasonRows, renderPcardSeason, PCARD_SCHEMA, pcardRowValues,
  setScoring:(s)=>{scoringSettings=s;}, setSeasons:(s)=>{HISTORY_SEASONS=s;} };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

// Standard scoring: 25 yd/pt pass, 6 pass TD... wait, model stores yards-per-point
app.setScoring({passing_yards_yardage:25, passing_touchdowns:6, interceptions_thrown:-2,
  rushing_yards_yardage:10, rushing_touchdowns:6, receiving_yards_yardage:10, receptions:0.5,
  receiving_touchdowns:6, passing_attempts:0, fumbles_lost:-2});

console.log('=== FPTS computation from a QB game ===');
// Burrow wk5 2024: 392 yd, 5 TD, 0 INT (from screenshot, ~43.78 pts)
const g={pass_yd:392, pass_td:5, pass_int:0, pass_att:39, pass_cmp:30};
const fp=app.pcardFptsFromStats(g);
// 392/25=15.68 + 5*6=30 + 0 = 45.68 (standard 4pt pass TD would differ; screenshot uses 6pt TD in this league? 43.78 suggests 4pt TD + 0.04/yd)
console.log('  computed FPTS:', fp, '(392yd/25 + 5*6TD = 45.68)');
chk(Math.abs(fp-45.68)<0.1,'FPTS matches scoring math');

console.log('\n=== color thresholds (QB) ===');
const sc=app.PCARD_SCHEMA.QB.cols;
const intCol=sc.find(c=>c.key==='p_int'); const tdCol=sc.find(c=>c.key==='p_td'); const ydCol=sc.find(c=>c.key==='p_yd');
chk(intCol.color(0)==='g','INT 0 → green');
chk(intCol.color(1)==='y','INT 1 → yellow');
chk(intCol.color(2)==='r','INT 2 → red');
chk(tdCol.color(2)==='g'&&tdCol.color(1)==='y'&&tdCol.color(0)==='r','TD 2/1/0 → g/y/r');
chk(ydCol.color(300)==='g'&&ydCol.color(220)==='y'&&ydCol.color(150)==='r','YD thresholds');

console.log('\n=== season rows from weekly data ===');
const weekly={
  '1':{team:'CIN',opponent:'NE',stats:{gp:1,pass_yd:164,pass_td:0,pass_int:1,pass_att:29,pass_cmp:21,off_snp:70,tm_off_snp:70}},
  '5':{team:'CIN',opponent:'BAL',stats:{gp:1,pass_yd:392,pass_td:5,pass_int:0,pass_att:39,pass_cmp:30,off_snp:65,tm_off_snp:65}},
  '12':{team:'CIN',opponent:null,stats:{gp:0}},  // BYE
};
const rows=app.pcardSeasonRows(weekly,'QB');
chk(rows.length===3,'3 week rows');
chk(rows[0].wk===1 && rows[2].wk===12,'sorted by week');
chk(rows[2].bye===true,'week 12 detected as BYE');
chk(Math.abs(rows[1].fpts-45.68)<0.1,'wk5 FPTS computed');
chk(rows[0].snp===100,'wk1 snap% = 100');

console.log('\n=== render produces table with color classes ===');
app.setSeasons([2024]);
const html=app.renderPcardSeason(2024, rows, 'QB');
chk(html.includes('2024'),'season title');
chk(html.includes('FANTASY')&&html.includes('PASSING'),'group headers');
chk(html.includes('pcard-cell g')||html.includes('pcard-cell r')||html.includes('pcard-cell y'),'color classes applied');
chk(html.includes('BYE'),'BYE row rendered');
chk(html.includes('@BAL')||html.includes('BAL'),'opponent shown');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
