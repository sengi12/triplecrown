// Power Score: the average league rank of six things — offensive pass and run EPA/play,
// defensive pass and run EPA/play allowed, points scored, points allowed — over a week range.
// Pinned: the math (each metric ranked the right way round, real points preferred over drive
// expected points), the week-by-week trajectory, the team chip reading the same table, and the
// SOS table carrying the column with its sparkline and sort.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){}}),body:{appendChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  table:advPowerTable, traj:advPowerTrajectory, chip:_advTeamPowerScore, sos:renderSOSView, focus:(c)=>{ _sosPowerFocus=c; }, setTab:(t)=>{ _sosChartTab=t; }, tab:()=>_sosChartTab, setTeam:(t)=>{ currentTeam=t; },
  setPack:(season,pack)=>{ NFLVERSE[season]=Object.assign(NFLVERSE[season]||{}, {adv_weekly:pack, team:{}}); _advPowerMemo={}; },
  setSeason:(y)=>{ sharpSeasonOverride=String(y); _sharpSeasonAtOverride=String(activeSeason); },
  setSOS:(s)=>{SOS=s;}, setSchedLoaded:()=>{_sosSchedLoaded=true;}, setRange:(f)=>{ getSharedWeekRange=f; } };`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

// Three teams, two weeks. Columns are the sidecar's names; only the ones the score reads are filled.
const COLS=['off_pass_epa','off_pass_plays','off_run_epa','off_run_plays','def_pass_epa_allowed','def_pass_plays','def_run_epa_allowed','def_run_plays','off_drive_pts','def_drive_pts_allowed','pace_games','off_pts','def_pts_allowed'];
const row=(ope,opp,ore,orp,dpe,dpp,dre,drp,dpts,dal,g,pts,al)=>[ope,opp,ore,orp,dpe,dpp,dre,drp,dpts,dal,g,pts,al];
const pack={cols:COLS, weeks:[1,2], teams:{
  // AAA: elite offense, elite defense, scores a lot, allows little → #1
  AAA:[row(8,30,3,25,-4,30,-2,25, 26.9,6.97, 1, 31,10), row(6,30,2,25,-3,30,-1,25, 20.9,9.97, 1, 24,13)],
  // BBB: middling everywhere
  BBB:[row(1,30,0,25, 1,30, 0,25, 20.9,20.9, 1, 21,20), row(0,30,1,25, 0,30, 1,25, 17,17, 1, 17,17)],
  // CCC: bad offense, bad defense, allows plenty → #3; but its DRIVE points beat BBB's in week 2
  CCC:[row(-6,30,-3,25, 5,30, 3,25, 9.97,26.9, 1, 10,31), row(-4,30,-2,25, 4,30, 2,25, 24,24, 1, 14,24)],
}};
app.setPack('2026', pack);
app.setSeason('2026');

console.log('=== the math ===');
let t=app.table('2026',1,18);
chk(t && t.size===3 && t.rankMap.AAA===1 && t.rankMap.BBB===2 && t.rankMap.CCC===3, `ranks: AAA #1, BBB #2, CCC #3 (${t&&Object.entries(t.rankMap).map(e=>e.join(':')).join(' ')})`);
const A=t.rows.find(r=>r.team==='AAA'), C=t.rows.find(r=>r.team==='CCC');
chk(A.avg===1 && C.avg===3, 'AAA is #1 in all six (avg 1.00); CCC last in all six (avg 3.00)');
chk(Math.abs(A.metrics.off_pass_epa_pp-(14/60))<1e-9 && Math.abs(A.metrics.def_run_epa_allowed_pp-(-3/50))<1e-9, 'EPA/play is total EPA over total plays across the weeks, not an average of weekly rates');
chk(A.metrics.points_scored_pg===27.5 && A.metrics.points_allowed_pg===11.5 && t.actualPoints, 'points per game come from the real scoreboard columns (31+24)/2, (10+13)/2');
const dParts=C.parts.find(p=>p.key==='def_pass_epa_allowed_pp'), sParts=C.parts.find(p=>p.key==='points_allowed_pg');
chk(dParts.rank===3 && sParts.rank===3, 'defensive EPA allowed and points allowed rank LOW = good (CCC allows the most → #3)');

console.log('=== real points beat drive points ===');
// Week 2 only: CCC's drive points (24) beat BBB's (17) but the scoreboard says 14 v 17.
t=app.table('2026',2,2);
const b2=t.rows.find(r=>r.team==='BBB').parts.find(p=>p.key==='points_scored_pg'), c2=t.rows.find(r=>r.team==='CCC').parts.find(p=>p.key==='points_scored_pg');
chk(b2.rank===2 && c2.rank===3 && b2.value===17 && c2.value===14, 'week 2: points scored uses 17 v 14 (scoreboard), not 17 v 24 (drive expected points)');
const noPts={cols:COLS.slice(0,11), weeks:[1], teams:{AAA:[pack.teams.AAA[0].slice(0,11)], BBB:[pack.teams.BBB[0].slice(0,11)], CCC:[pack.teams.CCC[0].slice(0,11)]}};
app.setPack('2025', noPts);
const t25=app.table('2025',1,18);
chk(t25 && !t25.actualPoints && t25.rows.find(r=>r.team==='AAA').metrics.points_scored_pg===26.9, 'a sidecar without the scoreboard columns falls back to drive expected points, and says so');

console.log('=== the trajectory ===');
app.setPack('2026', pack);
const tr=app.traj('2026',1,18);
chk(tr && tr.AAA.length===2 && tr.AAA[0].week===1 && tr.AAA[1].week===2 && tr.CCC.every(x=>x.rank===3), 'rank after each week, season to date');
const w1=app.table('2026',1,1);
chk(w1.weeks.length===1 && w1.rows.find(r=>r.team==='BBB').leagueRank===2, 'a one-week window ranks on that week alone');
chk(app.table('2026',9,9)===null, 'a window with no games is null, not a table of zeros');

console.log('=== the team chip reads the same table ===');
app.setRange(()=>[1,18]);
const chip=app.chip('CCC', null, {});
chk(chip && chip.leagueRank===3 && chip.leagueSize===3 && chip.parts.length===6 && Math.abs(chip.avgRank-3)<1e-9, 'CCC chip: 3rd of 3, six parts');

console.log('=== the SOS table carries the column ===');
app.setSOS({AAA:{win_total:10.5,rank:3,name:'Aces',opp_win_total:150,opp_games:17},BBB:{win_total:8.5,rank:1,name:'Bees',opp_win_total:140,opp_games:17},CCC:{win_total:6.5,rank:2,name:'Cees',opp_win_total:145,opp_games:17}});
app.setSchedLoaded();
const html=app.sos();
chk(/2026 POWER SCORE/.test(html), 'a Power Score column header');
chk(/sr-td-val">1st<\/span><span class="sr-td-rank">1\.0</.test(html) && /sr-td-val">3rd<\/span><span class="sr-td-rank">3\.0</.test(html), 'each row shows the rank and the average rank');
chk((html.match(/sr-td-spark/g)||[]).length===3, 'and a trajectory sparkline per team');
chk(/Off EPA\/Play \(Pass\): 0\.233 · #1/.test(html) && /Points Allowed: 11\.5 · #1/.test(html), 'the tooltip lists the six parts with values and ranks');
chk(/sortSOSBy\('power'\)/.test(html) && /Power Score: average league rank/.test(html), 'sortable, with the one-line explainer');

console.log('=== the bump chart, as a tab beside the SOS arc ===');
let g=app.sos();
chk(/pw-tabs/.test(g) && /sosChartTab\('sos'\)/.test(g) && /sosChartTab\('power'\)/.test(g) && /sos-chart"/.test(g) && !/pw-chart/.test(g), 'two tabs; the SOS arc shows by default');
app.setTab('power'); g=app.sos();
chk(/Power Score through the season/.test(g) && /pw-chart/.test(g) && !/class="sos-chart"/.test(g), 'the Power tab swaps in the bump chart and keeps the table');
chk((g.match(/class="pw-team/g)||[]).length===3 && (g.match(/class="pw-node"/g)||[]).length===6 && (g.match(/class="pw-num"[^>]*>(1st|2nd|3rd)</g)||[]).length===6, 'one coloured line per team, an ordinal pill (1st, 2nd, 3rd) at every week');
chk(/style="--pw-c:#/.test(g) && (g.match(/class="pw-logo"/g)||[]).length===3 && !/pw-label/.test(g), 'lines carry the team colour; a logo, not a name, ends each line');
chk(/--pw-w:\d+px;--pw-h:\d+px/.test(g) && /pw-scroll/.test(g), 'drawn at a fixed size inside a scrolling frame (phones scroll, desktops scale)');
chk(!/pw-focus/.test(g) && !/pw-dim/.test(g) && /tap a line, a logo, or a row below/.test(g) && /within weeks 1–2 ·/.test(g), 'nothing followed: every team in full colour; the window is named');
chk((g.match(/class="pw-row /g)||[]).length===3 && /onclick="sosPowerFocus\('AAA'\)"/.test(g), 'every table row follows its team on tap');
app.focus('CCC'); g=app.sos();
chk((g.match(/pw-team pw-focus/g)||[]).length===1 && (g.match(/pw-dim/g)||[]).length===2 && /pw-row-focus/.test(g), 'following CCC: its line comes forward, the other two fade, its row is marked');
chk(/3rd now · unchanged since week 1 · tap again to release/.test(g), 'the caption says where it is and how far it moved');
const svg=g.slice(g.indexOf('<svg'), g.indexOf('</svg>'));
chk(svg.lastIndexOf("sosPowerFocus('CCC')")>svg.lastIndexOf("sosPowerFocus('AAA')"), 'the followed line is drawn last, on top');
app.focus(null);
// The league-wide week range narrows the window: ranks are then season-to-date WITHIN it.
app.setRange(()=>[2,2]); g=app.sos();
chk(/within weeks 2–2 only \(the week range above\)/.test(g) && (g.match(/class="pw-node"/g)||[]).length===3 && /class="pw-xlbl"[^>]*>2</.test(g) && !/class="pw-xlbl"[^>]*>1</.test(g), 'a narrowed range plots only those weeks, ranked on those weeks alone');
chk(/sr-td-val">2nd<\/span>/.test(g) && /Power Score: average league rank[^<]*weeks 2–2/.test(g), 'the table column follows the same window');
app.setRange(()=>[1,18]); app.setTab('sos');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
