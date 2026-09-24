// The Advanced tab for the season in progress: the week-window recompute prefers PFR's
// charted pressures and carries missed tackles when the window has them; an inferred table
// is marked ≈ and a table that can only come after the season shows as pending instead of
// vanishing; the Advanced season falls back to the newest season with tables at the
// rollover; Sleeper's post-season weeks land on 19-22 whichever way it counts them.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){},classList:{add(){},remove(){}}}),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  return { range:_advComputeGeneralRangeTables, tables:nflverseSharpTables, season:advTeamSeason, state:_tcApplySleeperState, render:renderTeamAdvanced,
    setNV:(nv)=>{ NFLVERSE=nv; _advGenRangeCache={}; }, setSharp:(y)=>{ SHARP_SEASON=y; }, setActive:(s)=>{ activeSeason=s; },
    setStarted:(b)=>{ hasSeasonStarted=()=>b; }, setYear:(y)=>{ TC_SEASON.year=y; TC_SEASON.frozen=false; }, tc:()=>TC_SEASON,
    stubCard:()=>{ renderAdvWeekRange=()=>''; coordFor=()=>null; coordInlineLabel=()=>''; _carrySideSource=()=>null; advTrendFor=()=>null; _advProjOlBadge=()=>''; COORDINATORS={}; SOS={}; _advWeekRangeActive=()=>false; } };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== the week window: EPA per dropback and rush attempt ===');
const EPA_COLS=['off_plays','off_epa','off_pass_plays','off_pass_epa','off_run_plays','off_run_epa'];
app.setNV({'2026':{team:{}, adv_weekly:{cols:EPA_COLS, weeks:[1,2], teams:{
  DET:[[60,6,40,8,20,-2],[50,-5,25,-2,25,-3]],
  SEA:[[60,0,30,3,30,-3],[50,5,20,2,30,3]],
}}}});
let epa=app.range('2026',1,2);
chk(epa.offense.teams.DET.values['EPA/PASS']===Number((6/65).toFixed(3)), 'EPA/PASS is pass EPA divided by pass plays across the selected weeks');
chk(epa.offense.teams.DET.values['EPA/RUSH']===Number((-5/45).toFixed(3)), 'EPA/RUSH is rush EPA divided by rush attempts across the selected weeks');
chk(epa.offense.columns.includes('EPA/PASS') && epa.offense.columns.includes('EPA/RUSH'), 'live offense table exposes both abbreviated EPA rates');

console.log('=== the week window: PFR pressures and missed tackles when charted ===');
const COLS=['dl_dropbacks','dl_pressures','dl_no_blitz_obs','dl_no_blitz_pressures','dl_rush_att','dl_rush_stuffed','dl_pfr_obs','dl_pfr_pressures','dl_missed_tackles'];
const row=(db,prox,nbo,nbp,ra,rs,pfr,pp,mt)=>[db,prox,nbo,nbp,ra,rs,pfr,pp,mt];
app.setNV({'2026':{team:{}, adv_weekly:{cols:COLS, weeks:[1,2,3], teams:{
  DET:[row(40,6,20,2,25,5, 1,14,7), row(35,5,18,1,20,4, 1,12,6), row(38,7,19,3,22,6, 0,0,0)],
  SEA:[row(40,4,20,1,25,3, 1,8,10), row(35,3,18,1,20,2, 1,7,9), row(38,4,19,2,22,3, 0,0,0)],
}}}});
let t=app.range('2026',1,2);
chk(t && t.defensive_line.teams.DET.values['Pressure Rate']===Number((26/75*100).toFixed(1)), 'weeks 1-2 (charted): pressure rate = PFR pressures over dropbacks (26/75)');
chk(t.defensive_line.teams.DET.values['Missed Tackles']===13 && t.defensive_line.teams.SEA.values['Missed Tackles']===19, 'missed tackles sum the charted weeks (13, 19)');
chk(t.defensive_line.teams.SEA.ranks['Missed Tackles']===2 && t.defensive_line.teams.DET.ranks['Missed Tackles']===1, 'fewer missed tackles ranks better');
chk(t.defensive_line.columns.includes('Missed Tackles'), 'the window table carries the column');
t=app.range('2026',3,3);
chk(t.defensive_line.teams.DET.values['Pressure Rate']===Number((7/38*100).toFixed(1)) && t.defensive_line.teams.DET.values['Missed Tackles']===null, 'week 3 (not charted yet): the hit-or-sack proxy, and no missed tackles rather than zero');

console.log('=== the cards: ≈ for an inferred table, pending for a post-season one ===');
const team={
  offense:{columns:['EPA/Play'], teams:{DET:{values:{'EPA/Play':0.1},ranks:{'EPA/Play':3}}}},
  personnel:{columns:['11 Personnel','12 Personnel'], teams:{DET:{values:{'11 Personnel':61.2,'12 Personnel':22.0},ranks:{'11 Personnel':10,'12 Personnel':9}}},
             estimated:{from:2025, note:'Estimated: FTN backs × the 2025 tight-end split'}},
  def_tendencies:{columns:['Blitz Rate','Sub Package Rate'], teams:{DET:{values:{'Blitz Rate':28.1,'Sub Package Rate':64.0},ranks:{'Blitz Rate':8,'Sub Package Rate':12}}},
             estimated:{from:2025, cols:['Sub Package Rate'], note:'Estimated: the 2025 DB split'}},
};
app.setNV({'2026':{team}}); app.setYear(2026); app.setStarted(true); app.setActive('proj'); app.setSharp(2025);
chk(app.season()==='2026', 'the projection view\'s Advanced tab is the season in progress');
const tb=app.tables();
chk(tb.personnel && tb.personnel.estimated && tb.personnel.estimated.from===2025, 'the inferred personnel table carries its estimate note');
chk(tb.coverage && tb.coverage.pending && /after the season/.test(tb.coverage.pending) && tb.coverage.category==='defense', 'coverage (participation only) shows as a pending defense card');
chk(!tb.offense.pending && !tb.offense.estimated, 'a measured table carries neither');
chk(!tb.personnel.pct_cols.includes('Pressure Rate Allowed'), 'the dead Pressure Rate Allowed column is gone');
app.stubCard();
const html=app.render('DET');
chk(/sr-card-title">Personnel<span class="sr-est sr-est-title"[^>]*>≈ est\.<\/span>/.test(html), 'the personnel card is titled ≈ est. with the method on hover');
chk(/Sub Package Rate<span class="sr-est"[^>]*>≈<\/span>/.test(html) && !/Blitz Rate<span class="sr-est"/.test(html), 'the defensive tendencies card marks only its inferred columns (Blitz Rate is charted)');
chk(/sr-card sr-card-pending"><div class="sr-card-title">Coverage \(man\/zone\)<\/div>\s*<div class="sr-empty">Coverage charting/.test(html), 'the coverage card says it publishes after the season');
app.setStarted(false);
chk(!app.tables().coverage, 'no pending cards for a completed season');
chk(/if\(baseTbl\.pending\)\{[\s\S]{0,400}sr-desc">\$\{escHtml\(baseTbl\.pending\)\}/.test(code) && /SRC\[k\]\.estimated\?'<span class="sr-est"/.test(code), 'the league view shows the pending note under the tabs and marks an inferred table\'s tab ≈');

console.log('=== the rollover: the Advanced season follows what the seed has ===');
app.setNV({'2025':{team:{offense:{columns:['EPA/Play'],teams:{}}}}}); app.setYear(2026); app.setStarted(false); app.setActive('proj'); app.setSharp(2026);
chk(app.season()==='2025', 'SHARP_SEASON moved to 2026 before the seed carries it → the newest season with tables (2025)');
app.setNV({'2025':{team:{offense:{columns:[],teams:{}}}},'2026':{team:{offense:{columns:[],teams:{}}}}});
chk(app.season()==='2026', 'and 2026 itself once the seed has it');

console.log('=== the post-season weeks ===');
app.setYear(2026);
app.state({season:2026, season_type:'post', week:2, display_week:1});
chk(app.tc().week===20 && app.tc().displayWeek===19, 'post-season weeks 1-4 land on 19-22 (Divisional = 20, Wild Card = 19)');
app.state({season:2026, season_type:'post', week:20, display_week:19});
chk(app.tc().week===20 && app.tc().displayWeek===19, 'and 19-22 stay as they are');
app.state({season:2026, season_type:'regular', week:2, display_week:1});
chk(app.tc().week===2 && app.tc().displayWeek===1, 'the regular season is untouched');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
