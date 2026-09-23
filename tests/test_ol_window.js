// Offensive line by week window (74-team-tabs): the recompute behind the team card's
// week slider and the rushing fan's per-game run-blocking banner. Pinned: a PFR field
// the source has not published for any selected week stays MISSING (null value, null
// rank) instead of summing to 0 — a 0 would rank every line 32nd on yards before contact
// and 1st on pressure rate — while pbp-derived fields keep their real zeros; a published
// week computes normally; the rushing fan's rank-average score skips the missing fields.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  return { range:_advComputeOlRangeTables, score:_rbRunScoreAndRankFromTable, setNV:(n)=>{NFLVERSE=n;}, clear:()=>{_advOlRangeCache={};},
           form:_laOlForm, boards:_laOlFormBoards, pane:laOlineView, season:laSeasonView, TC_SEASON, laState, setWin:laSetOlWin,
           setEnsure:(f)=>{ensureNflverseSection=f;}, resetWeeklySeed:()=>{_advWeeklySeedReady=false;_advWeeklySeedLoading=false;},
           badge:_advCurrentOlBadge, setActive:(s)=>{activeSeason=s;}, setLive:(b)=>{tcIsLiveSeason=()=>b;},
           setTable:setSharpTable, league:()=>document.getElementById('content').innerHTML, setProjSeason:(y)=>{PROJ_SEASON=y;},
           olLag:_advOlPfrLagInfo, dlLag:_advDlPfrLagInfo, lagBtn:_advPfrLagInfoBtn, popBody:(key)=>TC_INFO_BOOK[key].body() };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const pass_cols=['dropbacks','designed_rushes','sacks','times_pressured','times_hit','times_hurried','times_blitzed','non_qb_sacks','no_blitz_pressures','pocket_time_w','pocket_time_att'];
const run_cols=['designed_rushes','stuffed','explosive','rush_yards','ybc','yac','broken_tackles','rush_first_downs','ngs_att','roe_w','box8_w','tlos_w','rush_successes','rush_rb_att'];
// Week 1: PFR not published (nulls). Week 2: published. Three teams so ranks are meaningful.
const mk=(db,ra,st,ry,ybc,yac,bt,pr)=>({
  pass:[[db,ra,2,null,null,null,null,1,3,60,25],[db,ra,1,pr,3,4,8,1,2,60,25]],
  run: [[ra,st,3,ry,null,null,null,6,ra,10,300,60,10,ra],[ra,st,3,ry,ybc,yac,bt,6,ra,10,300,60,10,ra]],
});
const pack={weeks:[1,2], pass_cols, run_cols, teams:{ KC:mk(30,30,3,180,60,90,4,8), DEN:mk(30,30,6,120,40,50,2,12), SEA:mk(30,30,9,90,30,30,1,15) }};
app.setNV({'2026':{ol_weekly:pack, team:{}}});
app.clear();

console.log('=== week 1 alone: PFR unpublished ===');
const w1=app.range('2026',1,1);
const kc1=w1.runTbl.teams.KC;
chk(kc1.values['YBC/Rush']===null && kc1.ranks['YBC/Rush']===null && kc1.values['Broken Tackle Rate']===null, 'yards before contact / broken tackles stay missing, not 0 and not ranked 32nd');
chk(kc1.values['Stuff Rate']===10 && kc1.ranks['Stuff Rate']===1 && kc1.values['Yards/Rush']===6, 'pbp-derived stuff rate and yards per rush compute and rank as before');
const kp1=w1.passTbl.teams.KC;
chk(kp1.values['Pressure Rate']===null && kp1.ranks['Pressure Rate']===null && Math.abs(kp1.values['Sack Rate']-6.7)<0.01, 'pressure rate (PFR) stays missing while sack rate (pbp) computes');
const s1=app.score(w1.runTbl,'KC');
chk(s1.score!=null && s1.rank===1, 'the run-blocking score averages only the fields that exist — KC leads on what is known');

console.log('=== week 2: published ===');
const w2=app.range('2026',2,2);
chk(w2.runTbl.teams.KC.values['YBC/Rush']===2 && w2.runTbl.teams.KC.ranks['YBC/Rush']===1 && w2.passTbl.teams.KC.values['Pressure Rate']!=null, 'a published week computes yards before contact and pressure rate');
console.log('=== weeks 1-2: the window sums only what was published ===');
const w12=app.range('2026',1,2);
chk(w12.runTbl.teams.KC.values['YBC/Rush']===1 && w12.runTbl.teams.KC.values['Yards/Rush']===6, 'over both weeks YBC divides week-2 yards by BOTH weeks\' carries (the honest denominator) and pbp fields sum across both');

console.log('=== the O-Line pane (Season tools) ===');
app.TC_SEASON.year=2026; app.TC_SEASON.phase='regular'; app.TC_SEASON.week=3;   // two weeks played
app.clear();
const F=app.form(3);
chk(Array.isArray(F) && F.length===3 && F.every(t=>t.lo===1 && t.hi===2), 'one row per line; a 3-week stretch with two played weeks spans weeks 1-2');
const kc=F.find(t=>t.tm==='KC');
chk(kc && kc.runA.rank===1 && kc.runR.rank===1 && kc.dRunRk===0 && kc.passA.score!=null, 'season and stretch scores with ranks; the rank move is season rank minus stretch rank');
console.log('=== a "recent" window that reaches back to week 1 IS the season — no manufactured surging/slipping ===');
// Reported bug: with 2 weeks played, every selectable "Last N" window (2/3/4/6) clamps its
// low end to week 1, so the recent table is literally the season table and every team's
// rank move is 0 — SURGING/SLIPPING then rendered two headers over "nobody in this scope
// yet" forever. The boards must fall back to a plain best-to-worst ranking instead.
const html=app.boards(2);
chk(/O-LINE · RUN BLOCKING · THRU WK 2/.test(html) && /O-LINE · PASS PROTECTION/.test(html) && /BEST/.test(html) && /WORST/.test(html), 'two weeks played, "Last 3" selected: the season-so-far ranking, not an always-empty surging/slipping split');
chk(!/SURGING/.test(html) && !/SLIPPING/.test(html), 'no surging/slipping headers when the recent window cannot differ from the season');
chk(/Last 2/.test(html) && /Last 6/.test(html) && /onclick="laSetOlWin\(4\)"/.test(html), 'the stretch chips still ride the board subtitle');

console.log('=== a genuine recent stretch (window shorter than weeks played) does split surging vs slipping ===');
// A separate 4-week pack: KC's run blocking falls off a cliff in weeks 3-4 (slipping), SEA's
// picks up (surging), DEN holds the league-average line all four weeks (flat) — the season
// (wks 1-2) vs. the "Last 2" recent window (wks 3-4) must be genuinely different tables for
// the split to mean anything, unlike the always-lo-1 case above.
const goodRun=[30, 2, 8, 220, 80, 110, 1, 12, 30, 18, 200, 40, 20, 30];
const midRun =[30, 6, 4, 150, 50, 70,  4, 6,  30, 10, 300, 60, 11, 30];
const badRun =[30, 10,1, 90,  25, 30,  8, 2,  30, 3,  400, 90, 4,  30];
const flatPass=[30,30,2,8,3,4,8,1,2,60,25];
const mkTeam4=(rows)=>({ pass: rows.map(()=>flatPass), run: rows });
const pack4={weeks:[1,2,3,4], pass_cols, run_cols, teams:{
  KC:  mkTeam4([goodRun,goodRun,badRun,badRun]),
  SEA: mkTeam4([badRun,badRun,goodRun,goodRun]),
  DEN: mkTeam4([midRun,midRun,midRun,midRun]),
}};
app.setNV({'2026':{ol_weekly:pack4, team:{}}});
app.clear();
app.TC_SEASON.week=5; app.clear();   // four weeks played, "Last 2" is a real sub-window
app.setWin(2);
const F4=app.form(2);
chk(F4 && F4[0].lo===3 && F4[0].hi===4, 'a 2-week stretch with four played weeks is weeks 3-4, not clamped to week 1');
const kc4=F4.find(t=>t.tm==='KC'), sea4=F4.find(t=>t.tm==='SEA');
chk(kc4.dRunRk<0 && sea4.dRunRk>0, 'the team that got worse recently drops rank, the one that improved climbs it');
const htmlSplit=app.boards(4);
chk(/O-LINE · RUN BLOCKING · LAST 2/.test(htmlSplit) && /SURGING/.test(htmlSplit) && /SLIPPING/.test(htmlSplit), 'once the window is genuinely shorter than the season, the surging/slipping board returns');
app.setWin(3);
app.setNV({'2026':{ol_weekly:pack, team:{}}});
app.TC_SEASON.week=2; app.clear();
const h1=app.boards(1);
chk(/THRU WK 1/.test(h1) && /BEST/.test(h1) && /WORST/.test(h1) && !/SURGING/.test(h1), 'with one played week the boards show the season so far, best to worst');
app.setWin(6); chk(app.laState.olWin===6, 'the stretch selector sticks'); app.setWin(3);
const pv=app.pane({});
chk(/O-LINE · RUN BLOCKING/.test(pv) && /laoline/.test(pv), 'the pane renders the boards with its info button');
app.setNV({'2026':{}}); app.clear();
chk(/No offensive-line weeks yet|Loading the weekly offensive-line block/.test(app.pane({})), 'without the weekly block the pane says so (or kicks the sidecar load)');

console.log('=== the pane self-heals: it kicks the ol_weekly fetch instead of just saying "not yet" forever ===');
// A league that never opened a team card's Advanced tab never triggered the fetch that
// backs this pane. Visiting the pane itself must ask for it — not depend on some other view.
app.resetWeeklySeed();
let askedFor=[];
app.setEnsure((section)=>{ askedFor.push(section); return Promise.resolve(false); });
const emptyHtml=app.pane({});
chk(askedFor.includes('ol_weekly'), 'rendering the empty pane kicks a fetch of the ol_weekly sidecar itself');
chk(/Loading the weekly offensive-line block/.test(emptyHtml), 'while that fetch is in flight the pane shows a real loading state, not "no weeks yet"');
app.laState.laTab='season'; app.laState.seasonPane='oline';
const sv=app.season({});
chk(/pane-tab active[^>]*title="O-Line"/.test(sv) && (sv.match(/pane-tab /g)||[]).length>=5, 'O-Line is a Season pane beside Defense, and the active one when selected');

console.log('=== the team card\'s O-Line badge: current-season grade, not the offseason projection ===');
app.setNV({'2026':{ol_weekly:pack, team:{}}});
app.setActive('proj'); app.setLive(true);
app.TC_SEASON.week=3; app.clear();   // two weeks played
const runBadge=app.badge('KC','run'), passBadge=app.badge('KC','pass');
chk(/^ <span class="sr-proj-badge/.test(runBadge) && /2026 [\d.]+/.test(runBadge) && !/Proj/.test(runBadge), 'the run badge reads the season number, not "Proj"');
chk(/2026 [\d.]+ · #1/.test(passBadge), 'the pass badge carries the same Pass Score/rank the O-Line pane uses');
app.TC_SEASON.week=1; app.clear();
chk(app.badge('KC','run')==='', 'no completed weeks yet: no current-season badge to show');

console.log('=== the league-wide O-Line table: live season swaps the projection column for the real one ===');
const teamOl={
  offensive_line_pass:{columns:['Overall Score','Pressure Rate'], teams:{
    KC:{values:{'Overall Score':70,'Pressure Rate':30}, ranks:{'Overall Score':2,'Pressure Rate':10}},
    SEA:{values:{'Overall Score':50,'Pressure Rate':40}, ranks:{'Overall Score':10,'Pressure Rate':20}},
    DEN:{values:{'Overall Score':60,'Pressure Rate':35}, ranks:{'Overall Score':6,'Pressure Rate':15}},
  }},
  offensive_line_run:{columns:['Overall Score','Stuff Rate'], teams:{
    KC:{values:{'Overall Score':65,'Stuff Rate':15}, ranks:{'Overall Score':4,'Stuff Rate':8}},
    SEA:{values:{'Overall Score':55,'Stuff Rate':20}, ranks:{'Overall Score':8,'Stuff Rate':18}},
    DEN:{values:{'Overall Score':58,'Stuff Rate':18}, ranks:{'Overall Score':7,'Stuff Rate':14}},
  }},
};
app.setNV({'2026':{ol_weekly:pack, team:teamOl}});
app.setProjSeason(2026);
app.TC_SEASON.week=3; app.clear();   // two weeks played, live
app.setTable('offensive_line_pass');
const liveHtml=app.league();
chk(/<th class="sr-th active" onclick="sortSharpBy\('2026'\)"/.test(liveHtml), 'the live column header reads the season, not "Proj 2026"');
chk(!/Proj 2026/.test(liveHtml), 'no offseason projection column while the season is live and weeks are in the books');
chk(/title="2026 OL pass-protection overall score, weeks 1–2"/.test(liveHtml), 'the header explains it\'s the real weeks-1-2 recompute');
app.setLive(false); app.clear();
app.setTable('offensive_line_pass');
const projHtml=app.league();
chk(/Proj 2026/.test(projHtml) && !/title="2026 pass-protection overall score/.test(projHtml), 'off the live season (or no weeks played) it falls back to the offseason projection column');

console.log('=== the PFR-charting-lag note: a played week not charted yet shouldn\'t read as a clean week ===');
// Mirrors a real case: week 1 fully charted, week 2's PFR pass file hasn't landed — sacks/
// non-QB-sacks/no-blitz-pressures (pbp) are still real for week 2, only the PFR fields are null.
const mkLag=(db,ra)=>({
  pass:[[db,ra,2,5,3,0,11,2,3,76.5,29], [db,ra,2,null,null,null,null,1,3,0,0]],
  run: [[ra,3,3,150,60,90,4,6,ra,10,300,60,10,ra], [ra,3,3,140,null,null,null,6,ra,10,300,60,10,ra]],
});
const packLag={weeks:[1,2], pass_cols, run_cols, teams:{ NYG:mkLag(33,32), WAS:mkLag(34,25) }};
app.setNV({'2026':{ol_weekly:packLag, team:teamOl}});
const passLag=app.olLag('2026','pass');
chk(passLag && passLag.week===2 && ['Pressure Rate','Hit Rate','Hurry Rate','Blitz Rate'].every(c=>passLag.cols.includes(c)), 'week 2 not yet charted: all four PFR-sourced pass columns flagged');
const runLag=app.olLag('2026','run');
chk(runLag && runLag.week===2 && ['YBC/Rush','YAC/Rush','Broken Tackle Rate'].every(c=>runLag.cols.includes(c)), 'and the run-blocking PFR columns too');
app.setNV({'2026':{ol_weekly:pack, team:teamOl}});   // the original pack: week 2 IS charted
chk(app.olLag('2026','pass')===null && app.olLag('2026','run')===null, 'once the latest week is charted for any team, no note');

console.log('=== the defensive-line pressure/missed-tackles note shares the same lag ===');
const dlCols=['dl_dropbacks','dl_pressures','dl_no_blitz_obs','dl_no_blitz_pressures','dl_rush_att','dl_rush_stuffed','dl_pfr_obs','dl_pfr_pressures','dl_missed_tackles'];
const dlRow=(charted)=>[40,6,20,2,25,5, charted?1:0, charted?14:0, charted?7:0];
app.setNV({'2026':{ol_weekly:pack, team:teamOl, adv_weekly:{cols:dlCols, weeks:[1,2], teams:{
  DET:[dlRow(true), dlRow(false)], SEA:[dlRow(true), dlRow(false)],
}}}});
const dlLagOn=app.dlLag('2026');
chk(dlLagOn && dlLagOn.week===2 && dlLagOn.cols.includes('Pressure Rate') && dlLagOn.cols.includes('Missed Tackles'), 'week 2 uncharted defensively: Pressure Rate and Missed Tackles flagged');
app.setNV({'2026':{ol_weekly:pack, team:teamOl, adv_weekly:{cols:dlCols, weeks:[1,2], teams:{
  DET:[dlRow(true), dlRow(true)], SEA:[dlRow(true), dlRow(false)],
}}}});
chk(app.dlLag('2026')!==null, 'PFR charts per team, not the whole league at once: SEA still uncharted keeps the league-wide note up');
chk(app.dlLag('2026','DET')===null && app.dlLag('2026','SEA')!==null, 'and a team-specific check only warns for the team that\'s actually missing it');

console.log('=== the real bug: PFR charts some teams before others, not the whole league at once ===');
// BUF/DET already have week 2 pass charting; NYG/WAS don't yet — a league-wide "any team has
// it" check used to wrongly conclude the file had landed for everyone.
const mkCharted=(db,ra)=>({
  pass:[[db,ra,2,5,3,0,11,2,3,76.5,29], [db,ra,2,3,2,1,5,1,2,80,28]],
  run: [[ra,3,3,150,60,90,4,6,ra,10,300,60,10,ra], [ra,3,3,140,55,85,3,6,ra,10,300,60,10,ra]],
});
const packMixed={weeks:[1,2], pass_cols, run_cols, teams:{ NYG:mkLag(33,32), WAS:mkLag(34,25), BUF:mkCharted(38,28), DET:mkCharted(44,18) }};
app.setNV({'2026':{ol_weekly:packMixed, team:teamOl}});
chk(app.olLag('2026','pass','NYG')!==null, 'NYG\'s own card still warns: its week 2 is still null');
chk(app.olLag('2026','pass','BUF')===null, 'BUF\'s card does not: its week 2 is already charted');
chk(app.olLag('2026','pass')!==null, 'the league-wide table still warns too, since NYG/WAS drag the column');

app.setNV({'2026':{ol_weekly:packLag, team:teamOl}});
const btn=app.lagBtn('offensive_line_pass','2026');
chk(/tc-info-btn tc-info-warn/.test(btn) && /onclick="tcInfoPop\(event,'advpfrlag_offensive_line_pass'\)"/.test(btn), 'the card gets a warn-styled ⓘ wired to its own popup key');
const body=app.popBody('advpfrlag_offensive_line_pass');
chk(/Week 2/.test(body) && /Pressure Rate/.test(body) && /Hit Rate/.test(body) && /Hurry Rate/.test(body) && /Blitz Rate/.test(body), 'the popup names the week and every affected column');
app.setNV({'2026':{ol_weekly:pack, team:teamOl}});
chk(app.lagBtn('offensive_line_pass','2026')==='', 'no button once the week is actually charted');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
