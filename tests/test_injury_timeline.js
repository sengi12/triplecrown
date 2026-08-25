// Injury popup timelines: a REPORTED timeline in the note/news beats the knowledge-book
// estimate (in the popup text AND the absence-weeks discount), and the injury tag popup
// toggle-closes on a second tap instead of remove-then-reopen.
const reg={};
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){}},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={
  documentElement:{style:{setProperty(){}}},
  getElementById:(id)=> reg[id]!==undefined ? reg[id] : (id==='tcInjPop' ? null : mkEl(id)),
  querySelector:()=>null,querySelectorAll:()=>[],
  createElement:()=>{const el={id:'',className:'',innerHTML:'',style:{},dataset:{},offsetWidth:240,offsetHeight:80,contains:()=>false,appendChild(){},remove(){ if(el.id && reg[el.id]===el) delete reg[el.id]; }};return el;},
  body:{appendChild:(el)=>{ if(el.id) reg[el.id]=el; }},
  addEventListener(){},removeEventListener(){}
};
global.window={innerWidth:390,innerHeight:800,addEventListener(){}};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
global.fetch=()=>Promise.reject(new Error('no net'));

const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  tcInjuryInfo, tcInjuryStatedTimeline, tcInjuryAbsenceWeeks, _injPopHTML, tcInjuryPop,
  setPlayers:(db)=>{sleeperPlayers=db;} };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const setInj=(status,body,note)=>{ app.setPlayers({'1':{name:'Test Player',injury_status:status,injury_body_part:body,injury_note:note}}); return app.tcInjuryInfo('1'); };

console.log('=== stated-timeline parsing ===');
let i=setInj('Out','Hamstring','Expected to miss 4-6 weeks');
let st=app.tcInjuryStatedTimeline(i);
chk(st && st.label==='4–6 weeks' && st.weeks===6,'"expected to miss 4-6 weeks" → 4–6 weeks (upper bound 6)');
st=app.tcInjuryStatedTimeline(setInj('Out','Foot','He will be out six weeks after surgery'));
chk(st && st.weeks===6,'word numbers parse ("out six weeks")');
st=app.tcInjuryStatedTimeline(setInj('IR','Knee','Expected to miss 2 months'));
chk(st && st.weeks===8 && /month/.test(st.label),'months convert (~4 weeks each)');
st=app.tcInjuryStatedTimeline(setInj('Out','Ankle','Considered week-to-week'));
chk(st && st.label==='week-to-week' && st.weeks==null,'week-to-week recognized, no hard number');
st=app.tcInjuryStatedTimeline(setInj('Out','Shoulder','Out until Week 12 at the earliest'));
chk(st && st.label==='until Week 12','"until Week N" surfaces verbatim');
st=app.tcInjuryStatedTimeline(setInj('Questionable','Hamstring','Hamstring tightness'));
chk(st==null,'no timeline in the note → nothing invented');

console.log('=== popup prefers the reported timeline ===');
i=setInj('Out','Hamstring','Expected to miss 4-6 weeks');
let html=app._injPopHTML('1', i);
chk(/reported timeline/i.test(html) && html.includes('4–6 weeks'),'reported timeline headlines the designation line');
chk(!/Typical timetable/.test(html),'book range suppressed when a real timeline exists');
chk(!/not a diagnosis/.test(html),'…and so is the population-range caveat');
i=setInj('Out','Hamstring','Hamstring strain');
html=app._injPopHTML('1', i);
chk(/Typical timetable/.test(html) && /not a diagnosis/.test(html),'no reported timeline → book estimate + caveat as before');
i=setInj('Questionable','Ankle','Considered week-to-week');
html=app._injPopHTML('1', i);
chk(/game-time decision/.test(html) && /week-to-week/.test(html),'Q keeps its designation but appends the reported read');
i=setInj('IR','Knee','Suffered a season-ending ACL tear');
html=app._injPopHTML('1', i);
chk(/season-ending/.test(html) && !/reported timeline/i.test(html),'season-out verdict still outranks everything');

console.log('=== absence-weeks discount uses the reported number ===');
chk(app.tcInjuryAbsenceWeeks(setInj('Out','Hamstring','Expected to miss 4-6 weeks'))===6,
  'OUT hamstring with stated 4-6 wks → 6 (book alone said 2)');
chk(app.tcInjuryAbsenceWeeks(setInj('Out','Hamstring','Hamstring strain'))===2,
  'no stated timeline → book estimate unchanged');
chk(app.tcInjuryAbsenceWeeks(setInj('IR','Knee','Season-ending surgery'))===18,'season-out still 18');
chk(app.tcInjuryAbsenceWeeks(setInj('Questionable','Hamstring','Could miss 3 weeks'))===0,
  'Q designation still assumes no multi-week absence (floor gate intact)');

console.log('=== tag popup toggle ===');
setInj('Questionable','Ankle','Sprained ankle');
app.tcInjuryPop({target:null,stopPropagation(){}},'1');
chk(!!reg['tcInjPop'],'first tap opens the popup');
app.tcInjuryPop({target:null,stopPropagation(){}},'1');
chk(!reg['tcInjPop'],'same tag again closes it (was: remove-then-reopen)');
app.setPlayers({'1':{name:'A',injury_status:'Questionable',injury_body_part:'Ankle',injury_note:''},
                '2':{name:'B',injury_status:'Out',injury_body_part:'Hamstring',injury_note:''}});
app.tcInjuryPop({target:null,stopPropagation(){}},'1');
app.tcInjuryPop({target:null,stopPropagation(){}},'2');
chk(!!reg['tcInjPop'] && reg['tcInjPop'].dataset.pid==='2','a different tag replaces the popup');

console.log(`\n${pass}/${total}`);
process.exit(pass===total?0:1);
