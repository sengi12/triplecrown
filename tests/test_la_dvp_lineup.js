// DvP + Lineup Helper: fantasy-points-allowed built from raw sidecar components under the
// LEAGUE's scoring (memo keyed on it), rank direction, small-sample banner, and the lineup
// adjustment multipliers with their clamps and declared degradation.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove:()=>{}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){},visibilityState:'visible'};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){}};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  TC_SEASON, laDvpTable, laDvpView, laAdjWeekProj, laLineupView, laState,
  laWeekPickupsHTML, laBestAvailView, pcardAppendFutureWeeks,
  setBPL:(f)=>{buildPlayerList=f;}, setProjMap:(f)=>{laProjMap=f;},
  setSeasonStarted:(f)=>{hasSeasonStarted=f;}, setIsRedraft:(f)=>{laIsRedraft=f;},
  setInseason:(x)=>{TC_INSEASON=x;}, setSnapshot:(s)=>{leagueSnapshot=s;}, setPhaseVar:(p)=>{currentPhase=p;},
  setSleeperFetch:(f)=>{sleeperFetch=f;},
  setPaceForPlayer:(f)=>{paceForPlayer=f;},
  scoring:scoringSettings };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

app.TC_SEASON.year=2026; app.TC_SEASON.phase='regular'; app.TC_SEASON.week=3;
app.setPhaseVar('League');
app.setSleeperFetch(async()=>{ throw new Error('no net'); });

// DVP fixture: cols must match src/nflverse/inseason.py DVP_COLS. Team AAA is stingy vs WR,
// team BBB generous (double the yardage/receptions).
const COLS=["tgt","rec","rec_yd","rec_td","carry","rush_yd","rush_td","pass_att","pass_yd","pass_td","pass_int"];
const wr=(t,r,y,td)=>{ const a=new Array(COLS.length).fill(0); a[0]=t; a[1]=r; a[2]=y; a[3]=td; return a; };
app.setInseason({v:1, season:2026, weeks:[1,2], asof:'x',
  schedule:{MIA:{'3':'AAA'}, BUF:{'3':'BBB'}, CCC:{'1':'MIA','2':'BUF'}},
  def_vs_pos:{cols:COLS, teams:{
    AAA:{WR:{'1':wr(20,12,110,0),'2':wr(18,10,95,1)},  QB:{'1':new Array(COLS.length).fill(0)}, RB:{}, TE:{}},
    BBB:{WR:{'1':wr(30,24,230,2),'2':wr(28,22,210,2)}, QB:{'1':new Array(COLS.length).fill(0)}, RB:{}, TE:{}},
    CCC:{WR:{'1':wr(30,24,230,2)}, QB:{}, RB:{}, TE:{}},   // one big week, then a shutout
  }}});

console.log('=== DvP table ===');
const t=app.laDvpTable();
chk(!!t,'table builds from the sidecar');
chk(t.ranks.BBB.WR===1 && t.ranks.CCC.WR===2 && t.ranks.AAA.WR===3,'MOST points allowed = rank 1 (easiest matchup first — the fantasy read)');
chk(t.teams.BBB.WR.fppg > t.teams.AAA.WR.fppg,'generous defense allows more fppg');
// CCC allowed BBB's week-1 line, then shut WRs out in week 2. The divisor must be games
// PLAYED (2, schedule-derived), not weeks-with-rows (1) — under the old math the shutout
// made CCC read MORE generous than BBB (fppg = the one big week undivided).
chk(t.teams.CCC.WR.games===2,'shutout week still counts as a game played');
chk(t.teams.CCC.WR.fppg < t.teams.BBB.WR.fppg,'positional shutout lowers fppg (was: inflated past BBB)');
const before=t.teams.BBB.WR.fppg;
const oldRec=app.scoring.receptions; app.scoring.receptions=oldRec+1;   // league-scoring aware
const t2=app.laDvpTable();
chk(t2.teams.BBB.WR.fppg>before,'fppg respects the league scoring (memo re-keys on it)');
app.scoring.receptions=oldRec;

console.log('=== DvP view ===');
const dvpHtml=app.laDvpView({});
chk(dvpHtml.includes('small sample'),'small-sample banner through week 4');
chk(dvpHtml.includes('la-dvp-table'),'table renders');

console.log('=== lineup adjustment ===');
const pm=new Map();
const norm=(n)=>n.toLowerCase();
// laAdjWeekProj keys pm by ecrNormName(name)+'|'+pos — use simple lowercase-safe names.
pm.set('gamma wideout|WR', 170);   // 10/wk
pm.set('epsilon wideout|WR', 170);
const dvp=app.laDvpTable();
const good=app.laAdjWeekProj({name:'Gamma Wideout',pos:'WR',team:'MIA',id:'p3'}, 3, pm, dvp);
chk(Math.abs(good.defMult-0.90)<1e-9,'stingiest opponent → 0.90 multiplier');
const bad=app.laAdjWeekProj({name:'Epsilon Wideout',pos:'WR',team:'BUF',id:'p5'}, 3, pm, dvp);
chk(Math.abs(bad.defMult-1.10)<1e-9,'most generous opponent → 1.10 multiplier');
const noDvp=app.laAdjWeekProj({name:'Gamma Wideout',pos:'WR',team:'MIA',id:'p3'}, 3, pm, null);
chk(noDvp.defMult===1,'no sidecar → matchup multiplier degrades to 1');
// The weekly number is OUR blend now: 55% season-projection rate + 45% season FPPG when no
// recent-form data is loaded (the sidecar here carries no player_weekly).
app.setPaceForPlayer(()=>({gp:5, base:100, act:100, pace17:300}));   // 20 FPPG to date
const blended=app.laAdjWeekProj({name:'Gamma Wideout',pos:'WR',team:'MIA',id:'p3'}, 3, pm, dvp);
chk(Math.abs(blended.adj-(0.55*10+0.45*20)*0.90)<1e-6,'weekly proj = 55% yours + 45% season FPPG, × matchup');
app.setPaceForPlayer(()=>null);
const noPace=app.laAdjWeekProj({name:'Gamma Wideout',pos:'WR',team:'MIA',id:'p3'}, 3, pm, dvp);
chk(Math.abs(noPace.adj-10*0.90)<1e-6,'no live data → your projection rate alone, × matchup');

console.log('=== lineup view smoke ===');
app.setSnapshot({provider:'sleeper', leagueId:'L1', season:'2026', myUserId:'u1',
  rosterPositions:['QB','WR','WR','FLEX','BN'],
  teamList:[{rosterId:1, ownerId:'u1', teamName:'Me', players:[
    {id:'p1',name:'Alpha Quarterback',pos:'QB',team:'CIN'},
    {id:'p3',name:'Gamma Wideout',pos:'WR',team:'MIA'},
    {id:'p5',name:'Epsilon Wideout',pos:'WR',team:'BUF'},
    {id:'p2',name:'Beta Back',pos:'RB',team:'DET'}]}]});
const lh=app.laLineupView({provider:'sleeper', leagueId:'L1', season:'2026', myUserId:'u1',
  rosterPositions:['QB','WR','WR','FLEX','BN'],
  teamList:[{rosterId:1, ownerId:'u1', teamName:'Me', players:[
    {id:'p1',name:'Alpha Quarterback',pos:'QB',team:'CIN'},
    {id:'p3',name:'Gamma Wideout',pos:'WR',team:'MIA'},
    {id:'p5',name:'Epsilon Wideout',pos:'WR',team:'BUF'},
    {id:'p2',name:'Beta Back',pos:'RB',team:'DET'}]}]});
chk(lh.includes('OPTIMAL LINEUP'),'lineup helper renders');
chk(lh.includes('Gamma Wideout') && lh.includes('Beta Back'),'roster players placed into slots');
chk(lh.includes('matchup: opponent defense-vs-position'),'active adjustments footnoted');

console.log('=== waivers: the This-Week lens ===');
{
  // FA universe: one stud WR into the generous matchup, one afterthought, one QB,
  // plus the rostered names (which must be excluded, not re-listed).
  app.setBPL(()=>[
    {player_id:'f1', name:'Zeta Wideout',  pos:'WR', team:'BUF'},
    {player_id:'f2', name:'Eta Wideout',   pos:'WR', team:'MIA'},
    {player_id:'f3', name:'Theta Passer',  pos:'QB', team:'CIN'},
    {player_id:'p3', name:'Gamma Wideout', pos:'WR', team:'MIA'},   // rostered
  ]);
  // My own starters need projections too, or their floor is zero and every FA
  // "starts" — which is exactly what this test exists to catch.
  const pm=new Map([['zeta wideout|WR',180],['eta wideout|WR',34],
                    ['theta passer|QB',150],['gamma wideout|WR',170],
                    ['alpha quarterback|QB',300],['epsilon wideout|WR',150],
                    ['beta back|RB',140]]);
  app.setProjMap(()=>pm);
  app.setPaceForPlayer(()=>null);
  const snap={provider:'sleeper', leagueId:'L1', season:'2026', myUserId:'u1',
    rosterPositions:['QB','WR','WR','FLEX','BN'],
    teamList:[{rosterId:1, ownerId:'u1', teamName:'Me', players:[
      {id:'p1',name:'Alpha Quarterback',pos:'QB',team:'CIN'},
      {id:'p3',name:'Gamma Wideout',pos:'WR',team:'MIA'},
      {id:'p5',name:'Epsilon Wideout',pos:'WR',team:'BUF'},
      {id:'p2',name:'Beta Back',pos:'RB',team:'DET'}]}]};
  app.laState.baPos='ALL'; app.laState.baLens='week';
  const html=app.laWeekPickupsHTML(snap);
  chk(html.includes('WK PROJ'), 'the weekly table renders');
  const zi=html.indexOf('Zeta Wideout'), ei=html.indexOf('Eta Wideout');
  chk(zi>=0 && ei>=0, 'free agents are listed');
  chk(zi<ei, 'the better weekly projection ranks first');
  chk(html.indexOf('>Gamma Wideout<')<0, 'players rostered in the league are excluded');
  chk(html.includes('STARTS +'), 'a pickup who beats your weakest starter is flagged');
  // Eta (2 fppg) must not carry the flag — assert the flag count, not just presence.
  chk((html.match(/STARTS \+/g)||[]).length===1, 'and only the one who actually would');
  app.laState.baPos='QB';
  const qb=app.laWeekPickupsHTML(snap);
  chk(qb.includes('Theta Passer') && !qb.includes('Zeta Wideout'), 'the position filter holds');
  app.laState.baPos='ALL';
  // The lens toggle: in season the Waivers tab offers both lenses and routes.
  app.setSeasonStarted(()=>true);
  app.setIsRedraft(()=>true);
  const tab=app.laBestAvailView(snap);
  chk(tab.includes('Season value') && tab.includes('This week'), 'both lenses offered in season');
  chk(tab.includes('WK PROJ'), "and baLens='week' routes to the weekly table");
  app.laState.baLens='value';
}

console.log('=== player card: the live season lists what is coming ===');
{
  // Restore the sidecar the earlier block cleared.
  app.setInseason({v:1, season:2026, weeks:[1,2], asof:'x',
    schedule:{MIA:{'3':'AAA','5':'BUF'}},
    schedule_meta:{MIA:{'3':['AAA',1,'Sun','1:00 PM','d'],'5':['BUF',0,'Mon','8:15 PM','d']}},
    def_vs_pos:null});
  app.TC_SEASON.year=2026; app.TC_SEASON.phase='regular'; app.TC_SEASON.week=3;
  const played=[{wk:1, opp:'CCC', isAway:false, gp:1, bye:false, dnp:false, stats:{gp:1},
                 team:'MIA', fpts:10, pprFpts:12, snp:80, rank:5},
                {wk:2, opp:'DDD', isAway:true, gp:1, bye:false, dnp:false, stats:{gp:1},
                 team:'MIA', fpts:8, pprFpts:9, snp:75, rank:9}];
  const rows=played.slice();
  app.pcardAppendFutureWeeks(rows, 'MIA');
  chk(rows.length===18, 'the log runs to week 18');
  const w3=rows.find(r=>r.wk===3), w4=rows.find(r=>r.wk===4), w5=rows.find(r=>r.wk===5);
  chk(w3 && w3.future && w3.opp==='AAA' && w3.isAway===false,
      'a scheduled future week carries its opponent and venue');
  chk(w5 && w5.future && w5.opp==='BUF' && w5.isAway===true, 'road games read as away');
  chk(w4 && !w4.future && w4.bye && !w4.opp, 'a week with no game is a BYE, not a blank');
  chk(rows.filter(r=>r.future).every(r=>r.gp===0 && r.fpts==null),
      'future rows carry no invented production');
  // Totals must ignore them entirely.
  const tot=rows.filter(r=>r.gp>0).length;
  chk(tot===2, 'played games still count exactly themselves');
  // No sidecar, no team → untouched.
  chk(app.pcardAppendFutureWeeks(played.slice(), null).length===2, 'a free agent gets no schedule');
  app.setInseason(null);
  chk(app.pcardAppendFutureWeeks(played.slice(), 'MIA').length===2, 'preseason (no sidecar) appends nothing');
}

console.log(`\n${pass}/${total}`);
if(pass!==total) process.exit(1);
