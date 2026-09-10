// Player-card season redesign (2026-09-10, ported from the BAFL viewer):
// NFL game logs live behind per-season TABS (newest auto-opens, past seasons
// fetch lazily, empty seasons grey out), future/missed rows keep the opponent
// logo, and the college prospect panel is honest about injury-shortened final
// seasons (JSN: percentiles rank the representative season, career row added).
const elStore={};let contentHTML='';
function mkEl(id){if(!elStore[id]){const kids=[];elStore[id]={id,innerHTML:'',style:{display:''},dataset:{},textContent:'',title:'',classList:{_s:new Set(),add(c){this._s.add(c);},remove(c){this._s.delete(c);},toggle(c,on){on?this._s.add(c):this._s.delete(c);},contains(c){return this._s.has(c);}},querySelectorAll:(q)=>Object.values(elStore).filter(e=>q==='.pcard-season-tab'&&/^pcst_/.test(e.id||'')),addEventListener(){},appendChild(){}};}return elStore[id];}
global.document={getElementById:(id)=>elStore[id]||mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('_n'+Math.random()),body:{appendChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
let weeklyFetches=[];
global.fetch=(u)=>{
  u=String(u);
  const J=(o)=>Promise.resolve({ok:true,json:()=>Promise.resolve(o)});
  const m=u.match(/stats\/nfl\/player\/(\w+)\?.*season=(\d{4})/) || u.match(/player\/(\w+)\/.*?(\d{4})/);
  if(u.includes('/player/')){
    weeklyFetches.push(u);
    if(u.includes('2024')) return J(null);                       // empty season → grey tab
    return J({ '1':{stats:{gp:1, rec:5, rec_yd:80, rec_tgt:7, off_snp:40, tm_off_snp:60}, opponent:'KC', team:'CIN', is_away_team:false} });
  }
  return Promise.reject(new Error('unmocked '+u));
};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  pcardToken=1; pcardOpen=true;
  return { pcardEligibleSeasons, loadSleeperCareerStats, pcardSelectSeason, rbReceivingQualifies,
    pcardAppendFutureWeeks, pcardSeasonRows, renderPcardSeason,
    _cfbCareerRow, _CFB_SEASON_COLS, renderCfbProspect,
    TC_SEASON, setPlayers:(p)=>{sleeperPlayers=p;},
    setHistSeasons:(h)=>{HISTORY_SEASONS=h;},
    setInseason:(x)=>{TC_INSEASON=x;},
    setCfb:(c)=>{CFB=c;} };
`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

(async()=>{
console.log('=== eligible seasons: years_exp is the career, 2009 the floor ===');
app.TC_SEASON.year=2026; app.TC_SEASON.phase='regular'; app.TC_SEASON.week=1;
app.setHistSeasons(['2025','2024']);
app.setPlayers({ vet:{years_exp:20, team:'CIN'}, soph:{years_exp:1, team:'CIN'}, unk:{team:'CIN'} });
const vet=app.pcardEligibleSeasons('vet');
chk(vet[0]==='2026' && vet[vet.length-1]==='2009', 'a 20-year vet: current season down to the 2009 data floor');
chk(app.pcardEligibleSeasons('soph').join(',')==='2026,2025', 'a second-year player gets exactly his two seasons');
app.TC_SEASON.phase='pre';
chk(app.pcardEligibleSeasons('soph')[0]==='2025', 'before kickoff the current season stays off the strip');
app.TC_SEASON.phase='regular';

console.log('\n=== tabs render instantly; only the OPEN season fetches ===');
weeklyFetches=[];
const body=mkEl('cardBody');
await app.loadSleeperCareerStats('soph','WR',body);
await new Promise(r=>setTimeout(r,20));
chk(/pcst_2026/.test(body.innerHTML) && /pcst_2025/.test(body.innerHTML), 'one tab per eligible season');
chk(weeklyFetches.length===1 && /2026/.test(weeklyFetches[0]),
    `newest season auto-opens with ONE fetch (the old card fetched every season up front) — got ${weeklyFetches.length}`);
const seasonBody=mkEl('pcardSeasonBody');
chk(/KC/.test(seasonBody.innerHTML), 'the opened season shows its games');

console.log('\n=== a season with no games greys its tab ===');
app.setHistSeasons(['2025','2024']);
weeklyFetches=[];
await app.pcardSelectSeason('soph','2024','WR');
await new Promise(r=>setTimeout(r,20));
chk(mkEl('pcst_2024').classList.contains('empty'), 'years_exp lied → the tab remembers');
chk(/No games in 2024/.test(mkEl('pcardSeasonBody').innerHTML), 'and the body says so plainly');

console.log('\n=== future + missed rows keep the opponent logo ===');
app.setInseason({schedule:{CIN:{'2':'BAL','3':'SEA'}}, schedule_meta:{}});
const rows=app.pcardSeasonRows({'1':{stats:{gp:1,rec:4,rec_yd:50},opponent:'KC',team:'CIN'}},'WR');
app.pcardAppendFutureWeeks(rows,'CIN');
const html=app.renderPcardSeason('2026', rows, 'WR');
const futureChunk=html.slice(html.indexOf('pcard-future-row'));
chk(/pcard-opp-logo/.test(futureChunk), 'an upcoming game wears its opponent logo like any other row');
const dnpRows=[{wk:1,opp:'KC',isAway:false,gp:0,bye:true,dnp:true,stats:{},fpts:null}];
chk(/pcard-opp-logo/.test(app.renderPcardSeason('2025', dnpRows, 'WR')), 'so does a missed game');

console.log('\n=== college honesty: the JSN case ===');
const jsn={name:'Jaxon Smith-Njigba',pos:'WR',college:'Ohio State',conf:'Big Ten',
  final:'2022', rep:'2021', class:2023, ref_n:150,
  seasons:{'2020':{games:4,dominator:1.2,rec_yds:17,tgt:8,rec:6,rec_td:1},
           '2021':{games:12,dominator:28.8,rec_yds:1259,tgt:110,rec:95,rec_td:6,ypr:13.3},
           '2022':{games:3,dominator:1.2,rec_yds:43,tgt:6,rec:4,rec_td:0}},
  pct:{dominator:88.0,tgt_share:82.0,ypr:70.0}};
app.setCfb({players:{jsn1:jsn}, labels:{}, headline:{WR:['dominator','tgt_share','ypr']},
            reference:{classes:[2018,2025]}});
const panel=app.renderCfbProspect('jsn1');
chk(/cfb-repnote/.test(panel) && /2021 season \(12 gm\)/.test(panel),
    'an injury-shortened final year says which season the percentiles rank');
chk(/28\.8/.test(panel), 'and the bars carry the representative season’s raw numbers');
const career=app._cfbCareerRow(jsn, app._CFB_SEASON_COLS.WR);
chk(/CAREER/.test(career) && /1319/.test(career), 'career row: receiving yards sum across seasons (17+1259+43)');
chk(/3 seasons/.test(career), 'and says how many seasons it spans');
chk(app._cfbCareerRow({seasons:{'2022':{games:3}}}, app._CFB_SEASON_COLS.WR)==='',
    'one season is the career already — no duplicate row');

console.log('\n=== RBs who catch passes exist in week 1 too ===');
chk(app.rbReceivingQualifies({receiving_targets:4, games_played:1}),
    'one game, four targets -> he belongs in the receiving view (was hidden behind a full-season bar)');
chk(app.rbReceivingQualifies({receptions:1, games_played:2}), 'even a single catch counts early');
chk(!app.rbReceivingQualifies({receiving_targets:0, receptions:0, games_played:1}),
    'no receiving work, no row');
chk(!app.rbReceivingQualifies({receiving_targets:3, games_played:12}),
    'past the early-season window the season-scale bar applies again');
chk(app.rbReceivingQualifies({receiving_targets:40, games_played:12}), 'a real receiving back always qualifies');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
})();
