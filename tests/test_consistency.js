const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},value:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},removeChild(){},querySelectorAll:()=>[],addEventListener(){},remove(){delete elStore[id];}};return elStore[id];}
let appended=[];
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>{const e={style:{},className:'',innerHTML:'',appendChild(){},set onclick(f){},remove(){}};return e;},body:{appendChild:(e)=>{appended.push(e);},removeChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.toast=()=>{};
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  pcardSeasonRows, pcardSeasonConsistency, renderPcardSeason, pcardFptsFromStats,
  setScoring:(s)=>{scoringSettings=s;}, getScoring:()=>scoringSettings, setSeasons:(s)=>{HISTORY_SEASONS=s;} };`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const path=require('path');
console.log('=== TEST: consistency grade — games not played, partial games, scoring format ===');

// Real Sleeper payload: Tucker Kraft 2025, season-ending injury at week 10.
const kraft=JSON.parse(fs.readFileSync(path.join(__dirname,'kraft_weekly.json'),'utf8'));
const weekly=kraft.stats||kraft;
const rows=app.pcardSeasonRows(weekly,'TE');
const dnp=rows.filter(r=>r.dnp), bye=rows.filter(r=>r.bye&&!r.dnp);
chk(dnp.length>0,'injured weeks (gms_active, no gp) are flagged DNP, not BYE');
chk(bye.length===0,'a real bye is absent from the payload, never a row');
app.setSeasons([2025]);
const html=app.renderPcardSeason(2025, rows, 'TE');
chk(html.includes('>DNP<') && !html.includes('>BYE<'),'log labels injured weeks DNP');
const c=app.pcardSeasonConsistency(rows,'TE');
chk(c && c.n===rows.filter(r=>r.gp>0).length - (c.skipped||0),'only games played are counted');
chk(c && c.n < rows.length,'DNP weeks are not counted as zero-point games');

// Scoring-format independence: the grade is scored in full PPR whatever the league uses.
const half=Object.assign({}, app.getScoring(), {receptions:0.5});
const std=Object.assign({}, app.getScoring(), {receptions:0});
const full=Object.assign({}, app.getScoring(), {receptions:1});
const gradeUnder=(sc)=>{ app.setScoring(sc); return app.pcardSeasonConsistency(app.pcardSeasonRows(weekly,'TE'),'TE'); };
const gH=gradeUnder(half), gS=gradeUnder(std), gF=gradeUnder(full);
chk(gH.hits===gF.hits && gS.hits===gF.hits,`same hits in half/standard/full PPR (${gH.hits}/${gH.n})`);
app.setScoring(std); const r2=app.pcardSeasonRows(weekly,'TE');
const played=r2.find(r=>r.gp>0 && (r.stats.rec||0)>0);
chk(played && played.pprFpts > played.fpts,'displayed FPTS still follow league scoring (standard < PPR)');

// Partial game: a 6-snap injury exit is shown but not graded.
const synth={
  '1':{team:'GB',stats:{gp:1,rec:6,rec_yd:70,off_snp:60,tm_off_snp:65}},
  '2':{team:'GB',stats:{gp:1,rec:5,rec_yd:60,off_snp:58,tm_off_snp:64}},
  '3':{team:'GB',stats:{gp:1,rec:0,rec_yd:0,off_snp:6,tm_off_snp:62}},   // hurt on the 6th snap
  '4':{team:'GB',stats:{gms_active:1}},                                   // out
  '5':null,                                                               // bye
  '6':{team:'GB',stats:{gp:1,rec:7,rec_yd:80,off_snp:61,tm_off_snp:66}},
};
app.setScoring(half);
const sr=app.pcardSeasonRows(synth,'TE');
const sc=app.pcardSeasonConsistency(sr,'TE');
chk(sc && sc.n===3 && sc.skipped===1,'6-snap exit excluded from the sample (n=3, 1 skipped)');
chk(sc && sc.grade==='A',`healthy games all clear the bar → A (got ${sc&&sc.grade})`);
chk(sr.length===5 && sr.filter(r=>r.dnp).length===1,'out week is a DNP row; bye week is no row');

// TE premium counts in the card's per-game points.
app.setScoring(Object.assign({}, full, {receptions_te_bonus:0.5}));
const te=app.pcardFptsFromStats({rec:4,rec_yd:40,pos:'TE'});
const wr=app.pcardFptsFromStats({rec:4,rec_yd:40,pos:'WR'});
chk(te-wr===2,'TE premium bonus applied per reception');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
