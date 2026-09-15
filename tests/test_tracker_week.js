// The tracker's week: Sleeper's counter rolls on Tuesday morning, the game tracker holds the
// finished week through Tuesday and until Wednesday 06:00 Eastern — only while Sleeper's own
// display_week is still behind, never in a frozen time machine.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},value:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){}}),body:{appendChild(){},classList:{add(){},remove(){},toggle(){}}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  hasSeasonStarted=()=>true;
  return { TC_SEASON, tracker:tcTrackerWeek, holds:tcHoldsFinishedWeek, apply:_tcApplySleeperState, boardWeek:tcBoardWeek, gcWeek:gcCurWeek, ldWeek:ldCurWeek };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
// Eastern-time instants (EDT in September: UTC−4).
const MON_NIGHT='2026-09-15T02:30:00Z';   // Mon 22:30 ET — Monday Night Football
const TUE_NOON ='2026-09-15T16:00:00Z';   // Tue 12:00 ET
const WED_0530 ='2026-09-16T09:30:00Z';   // Wed 05:30 ET
const WED_0630 ='2026-09-16T10:30:00Z';   // Wed 06:30 ET
const SUN      ='2026-09-20T17:00:00Z';   // Sun 13:00 ET

console.log('=== the hold window ===');
chk(app.holds(TUE_NOON)===true && app.holds(WED_0530)===true, 'Tuesday and early Wednesday hold');
chk(app.holds(WED_0630)===false && app.holds(MON_NIGHT)===false && app.holds(SUN)===false, 'Wednesday 06:00 ET onward, Monday night and Sunday do not');

console.log('=== Sleeper\'s payload, the Tuesday after week 1 ===');
app.apply({season:'2026', season_type:'regular', week:2, display_week:1, leg:2});
chk(app.TC_SEASON.week===2 && app.TC_SEASON.displayWeek===1, 'week 2 on the counter, display_week still 1');
chk(app.tracker(TUE_NOON)===1, 'Tuesday: the tracker holds week 1');
chk(app.tracker(WED_0530)===1, 'Wednesday 05:30 ET: still week 1');
chk(app.tracker(WED_0630)===2, 'Wednesday 06:30 ET: week 2');
chk(app.tracker(SUN)===2, 'Sunday: week 2');
app.apply({season:'2026', season_type:'regular', week:2, display_week:2, leg:2});
chk(app.tracker(TUE_NOON)===2, 'once Sleeper displays week 2 itself, no hold (an odd calendar never shows a week early)');
app.apply({season:'2026', season_type:'regular', week:1, display_week:1, leg:1});
chk(app.tracker(TUE_NOON)===1, 'week 1 never holds below 1');
app.apply({season:'2026', season_type:'regular', week:5, display_week:4, leg:5});
app.TC_SEASON.frozen=true;
chk(app.tracker(TUE_NOON)===5, 'a frozen time machine never holds');
app.TC_SEASON.frozen=false;

console.log('=== the consumers read the same week ===');
app.apply({season:'2026', season_type:'regular', week:2, display_week:1, leg:2});
const realHold=app.holds();
chk(app.boardWeek()===app.tracker() && app.gcWeek()===app.tracker() && app.ldWeek()===app.tracker(), `the board, the Game Center and the Leaders all use the tracker's week (${app.tracker()} right now${realHold?', a hold in effect':''})`);
console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
