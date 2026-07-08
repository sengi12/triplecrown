// ESPN gamelog player-card rendering: data-driven columns, AVG→YPC rename, opponent + team logos,
// per-season team tag, season totals, per-game coloring, defensive-schema support, rookie detection
// + athlete-id resolution.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  renderEspnSeason, espnStatGroup, espnColor, cfbNum, cfbSeasonTotals, pcardSeasonTeamTag,
  isRookiePlayer, resolveEspnAthleteId, NCAA_LOGO, ESPN_HEADSHOT,
  normalizeEspnDraft, espnDraftLine, renderDepthChart, buildDepthRows,
  setPlayers:(p)=>{sleeperPlayers=p;}, setIdCache:(c)=>{espnAthleteIdCache=c;},
  setRosters:(t,r)=>{espnRosters[t]=r;}, setDepth:(t,r)=>{espnDepth[t]=r;},
};`)();

let pass=0,fail=0;
function chk(name,cond){ if(cond){pass++;console.log('  PASS',name);} else {fail++;console.log('  FAIL',name);} }

// A WR-shaped ESPN gamelog payload (like Jordyn Tyson): receiving + rushing, two games, one team.
const gl = {
  labels:['REC','YDS','AVG','LNG','TD','CAR','YDS','AVG','TD','LNG'],
  names:['receptions','receivingYards','yardsPerReception','longReception','receivingTouchdowns',
         'rushingAttempts','rushingYards','yardsPerRushAttempt','rushingTouchdowns','longRushing'],
  filters:[{name:'season',options:[{value:'2025'},{value:'2024'}]}],
  seasonTypes:[{displayName:'2024 Regular Season',categories:[{events:[
    {eventId:'g1',stats:['5','80','16.0','30','1','0','0','0.0','0','0']},
    {eventId:'g2',stats:['7','61','8.7','20','0','1','9','9.0','0','9']},
  ]}]}],
  events:{
    g1:{id:'g1',week:1,gameDate:'2024-09-01T00:00:00Z',atVs:'vs',
        opponent:{id:'12',abbreviation:'ARIZ',logo:'https://a.espncdn.com/i/teamlogos/ncaa/500/12.png'},
        team:{abbreviation:'ASU',id:'9',logo:'https://a.espncdn.com/i/teamlogos/ncaa/500/9.png'}},
    g2:{id:'g2',week:2,gameDate:'2024-09-08T00:00:00Z',atVs:'@',
        opponent:{id:'2',abbreviation:'TEX'},   // no logo → build from id
        team:{abbreviation:'ASU',id:'9',logo:'https://a.espncdn.com/i/teamlogos/ncaa/500/9.png'}},
  },
};

console.log('=== TEST 1: renderEspnSeason (WR, college) ===');
const html = app.renderEspnSeason('2024', gl, {def:false, league:'college-football'});
chk('renders a season block', /pcard-season/.test(html));
chk('AVG renamed to YPC in header', /YPC/.test(html) && !/>AVG</.test(html));
chk('COLLEGE tag shown', /pcard-college-tag/.test(html));
chk('team tag ASU next to season', /ASU/.test(html));
chk('season team logo shown', /pcard-season-logo/.test(html) && /ncaa\/500\/9\.png/.test(html));
chk('opponent ARIZ shown', /ARIZ/.test(html));
chk('opponent logo (provided) used', /ncaa\/500\/12\.png/.test(html));
chk('opponent logo (built from id) used', /ncaa\/500\/2\.png/.test(html));
chk('@ marker for away game', /pcard-at/.test(html));
chk('group header RECEIVING', /RECEIVING/.test(html));
chk('group header RUSHING', /RUSHING/.test(html));
chk('season totals row present', /pcard-total-row/.test(html) && /TOT/.test(html));
chk('totals: REC summed to 12', /12/.test(html));  // 5+7
chk('per-game green cell colored', /pcard-cell g/.test(html));   // REC 7 / YDS 80
chk('per-game yellow cell colored', /pcard-cell y/.test(html));  // REC 5

console.log('\n=== TEST 2: espnStatGroup mapping (offense + defense) ===');
chk('receptions → RECEIVING', app.espnStatGroup('receptions',false)==='RECEIVING');
chk('rushingYards → RUSHING', app.espnStatGroup('rushingYards',false)==='RUSHING');
chk('passingYards → PASSING', app.espnStatGroup('passingYards',false)==='PASSING');
chk('offense sacks → PASSING', app.espnStatGroup('sacks',false)==='PASSING');
chk('offense interceptions → PASSING', app.espnStatGroup('interceptions',false)==='PASSING');
chk('fumblesLost (off) → FUM', app.espnStatGroup('fumblesLost',false)==='FUM');
chk('def totalTackles → TACKLES', app.espnStatGroup('totalTackles',true)==='TACKLES');
chk('def sacks → SACKS/TFL', app.espnStatGroup('sacks',true)==='SACKS/TFL');
chk('def stuffs → SACKS/TFL', app.espnStatGroup('stuffs',true)==='SACKS/TFL');
chk('def fumblesForced → TURNOVERS', app.espnStatGroup('fumblesForced',true)==='TURNOVERS');
chk('def interceptions → COVERAGE', app.espnStatGroup('interceptions',true)==='COVERAGE');
chk('def passesDefended → COVERAGE', app.espnStatGroup('passesDefended',true)==='COVERAGE');

console.log('\n=== TEST 3: espnColor (direction flips by side of ball) ===');
chk('WR receptions 7 → green', app.espnColor('receptions',7,false)==='g');
chk('WR receptions 5 → yellow', app.espnColor('receptions',5,false)==='y');
chk('QB interceptions 1 thrown → yellow', app.espnColor('interceptions',1,false)==='y');
chk('QB sacks 4 taken → red', app.espnColor('sacks',4,false)==='r');
chk('DEF totalTackles 8 → green', app.espnColor('totalTackles',8,true)==='g');
chk('DEF interceptions 1 → green', app.espnColor('interceptions',1,true)==='g');
chk('DEF sacks 1 → green', app.espnColor('sacks',1,true)==='g');
chk('DEF passesDefended 2 → green', app.espnColor('passesDefended',2,true)==='g');

console.log('\n=== TEST 4: renderEspnSeason (defensive, NFL) ===');
const dgl = {
  labels:['TOT','SOLO','AST','SACK','STF','STFYDS','FUM','LST','FF','FR','KB','INT','YDS','AVG','TD','LNG','PD'],
  names:['totalTackles','soloTackles','assistTackles','sacks','stuffs','stuffYards','fumbles','fumblesLost',
         'fumblesForced','fumblesRecovered','kicksBlocked','interceptions','interceptionYards',
         'avgInterceptionYards','interceptionTouchdowns','longInterception','passesDefended'],
  filters:[{name:'season',options:[{value:'2024'}]}],
  seasonTypes:[{displayName:'2024 Regular Season',categories:[{events:[
    {eventId:'d1',stats:['8','5','3','1','1','6','0','0','1','0','0','1','12','12.0','0','12','2']},
  ]}]}],
  events:{
    d1:{id:'d1',week:1,gameDate:'2024-09-08T00:00:00Z',atVs:'@',
        opponent:{abbreviation:'DAL',logo:'https://a.espncdn.com/i/teamlogos/nfl/500/dal.png'},
        team:{abbreviation:'GB',id:'9',logo:'https://a.espncdn.com/i/teamlogos/nfl/500/gb.png'}},
  },
};
const dhtml = app.renderEspnSeason('2024', dgl, {def:true, league:'nfl'});
chk('def: renders season block', /pcard-season/.test(dhtml));
chk('def: NO college tag (nfl)', !/pcard-college-tag/.test(dhtml));
chk('def: TACKLES group', /TACKLES/.test(dhtml));
chk('def: SACKS/TFL group', /SACKS\/TFL/.test(dhtml));
chk('def: TURNOVERS group', /TURNOVERS/.test(dhtml));
chk('def: COVERAGE group', /COVERAGE/.test(dhtml));
chk('def: AVG kept (not YPC)', />AVG</.test(dhtml) && !/YPC/.test(dhtml));
chk('def: NFL team logo used', /nfl\/500\/gb\.png/.test(dhtml));
chk('def: green cells colored', /pcard-cell g/.test(dhtml));
chk('def: totalTackles 8 shown', />8</.test(dhtml));

console.log('\n=== TEST 5: cfbSeasonTotals (sum / max long / recomputed YPC) ===');
const rows=[
  {stats:['5','80','16.0','30','1','0','0','0.0','0','0']},
  {stats:['7','61','8.7','20','0','1','9','9.0','0','9']},
];
const tot=app.cfbSeasonTotals(rows, gl.names);
chk('REC total = 12', tot[0]==='12');
chk('rec YDS total = 141', tot[1]==='141');
chk('rec YPC recomputed = 141/12 = 11.8', tot[2]==='11.8');
chk('LNG rec = max 30', tot[3]==='30');
chk('rec TD total = 1', tot[4]==='1');
chk('rush LNG = max 9', tot[9]==='9');

console.log('\n=== TEST 6: def totals blank avgInterceptionYards ===');
const dtot=app.cfbSeasonTotals([{stats:['8','5','3','1','1','6','0','0','1','0','0','1','12','12.0','0','12','2']}], dgl.names);
chk('def: TOT tackles summed = 8', dtot[0]==='8');
chk('def: avgInterceptionYards blanked (rate)', dtot[13]==null);

console.log('\n=== TEST 7: rookie detection + id resolution + ESPN headshot ===');
app.setPlayers({ '1':{player_id:'1',name:'Rook One',pos:'WR',years_exp:0,espn_id:'4880281'},
                 '2':{player_id:'2',name:'Vet Two',pos:'WR',years_exp:6,espn_id:'123'} });
app.setIdCache({});
chk('years_exp 0 → rookie', app.isRookiePlayer('1')===true);
chk('years_exp 6 → not rookie', app.isRookiePlayer('2')===false);
chk('NCAA_LOGO builds url', app.NCAA_LOGO('9')==='https://a.espncdn.com/i/teamlogos/ncaa/500/9.png');
chk('ESPN_HEADSHOT nfl url', app.ESPN_HEADSHOT('nfl','123')==='https://a.espncdn.com/i/headshots/nfl/players/full/123.png');
chk('ESPN_HEADSHOT college url', app.ESPN_HEADSHOT('college-football','9')==='https://a.espncdn.com/i/headshots/college-football/players/full/9.png');

console.log('\n=== TEST 7b: normalizeEspnDraft + espnDraftLine ===');
const draftJson={draft:{displayText:'Year: 2026 Round: 5 Pick: 161',round:5,year:2026,selection:161,
  team:{$ref:'http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/teams/12?lang=en&region=us'}}};
const nd=app.normalizeEspnDraft(draftJson);
chk('draft: year parsed', nd && nd.year===2026);
chk('draft: round parsed', nd.round===5);
chk('draft: pick parsed', nd.selection===161);
chk('draft: team id 12 → KC', nd.teamCode==='KC');
chk('draft: loaded-but-no-draft → undrafted sentinel', app.normalizeEspnDraft({}).undrafted===true);
chk('draft: null input → null (unavailable)', app.normalizeEspnDraft(null)===null);
const dl=app.espnDraftLine(nd);
chk('draftLine: shows year/round/pick', /2026/.test(dl) && /5/.test(dl) && /161/.test(dl));
chk('draftLine: DRAFT label', /pcard-draft-lbl/.test(dl) && /DRAFT/.test(dl));
chk('draftLine: KC logo + code', /clubs\/logos\/KC/.test(dl) && /KC/.test(dl));
chk('draftLine: undrafted → shows "Undrafted"', /Undrafted/.test(app.espnDraftLine({undrafted:true})));
chk('draftLine: empty when null', app.espnDraftLine(null)==='');

console.log('\n=== TEST 7c: buildDepthRows (order, rank sort, holder skip) ===');
const R='http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/athletes/';
const depthRaw={items:[
  {id:'21',name:'3WR 1TE',positions:{
    qb:{position:{abbreviation:'QB'},athletes:[{rank:2,athlete:{$ref:R+'2'}},{rank:1,athlete:{$ref:R+'1'}}]},
    rb:{position:{abbreviation:'RB'},athletes:[{rank:1,athlete:{$ref:R+'3'}}]},
  }},
  {id:'16',name:'Base 4-3 D',positions:{
    ldt:{position:{abbreviation:'LDT'},athletes:[{rank:1,athlete:{$ref:R+'4'}},{rank:2,athlete:{$ref:R+'5'}}]},
  }},
  {id:'18',name:'Special Teams',positions:{
    pk:{position:{abbreviation:'PK'},athletes:[{rank:1,athlete:{$ref:R+'6'}}]},
    h:{position:{abbreviation:'H'},athletes:[{rank:1,athlete:{$ref:R+'7'}}]},
  }},
]};
const byId={
  '1':{id:'1',name:'Patrick Mahomes',pos:'QB',jersey:'15',exp:9,headshot:'h1'},
  '2':{id:'2',name:'Backup QB',pos:'QB',jersey:'4',exp:2,headshot:'h2'},
  '3':{id:'3',name:'Rook Back',pos:'RB',jersey:'20',exp:0,headshot:'h3'},
  '4':{id:'4',name:'Chris Jones',pos:'DT',jersey:'95',exp:8,headshot:'h4'},
  '5':{id:'5',name:'Backup DT',pos:'DT',jersey:'99',exp:3,headshot:'h5'},
  '6':{id:'6',name:'Kicker Guy',pos:'PK',jersey:'7',exp:5,headshot:'h6'},
  '7':{id:'7',name:'Punter Guy',pos:'P',jersey:'2',exp:4,headshot:'h7'},
};
const drows=app.buildDepthRows(depthRaw, byId);
chk('rows: first row is QB (offense first)', drows[0].slot==='qb');
chk('rows: QB ordered by rank (Mahomes starter)', drows[0].players[0].name==='Patrick Mahomes' && drows[0].players[1].name==='Backup QB');
chk('rows: offense before defense before special',
  drows.findIndex(r=>r.slot==='qb') < drows.findIndex(r=>r.slot==='ldt') && drows.findIndex(r=>r.slot==='ldt') < drows.findIndex(r=>r.slot==='pk'));
chk('rows: LDT granular slot kept', drows.some(r=>r.slot==='ldt' && r.label==='LDT'));
chk('rows: holder (h) row skipped', !drows.some(r=>r.slot==='h'));
chk('rows: units tagged', drows.find(r=>r.slot==='qb').unit==='offense' && drows.find(r=>r.slot==='ldt').unit==='defense' && drows.find(r=>r.slot==='pk').unit==='special');

console.log('\n=== TEST 7d: renderDepthChart (ordered rows: starter, granular label, clickable) ===');
app.setDepth('KC', drows);
const dc=app.renderDepthChart('KC');
chk('depth: section rendered', /Depth Chart/.test(dc));
chk('depth: unit headers present', /Offense/.test(dc) && /Defense/.test(dc) && /Special Teams/.test(dc));
chk('depth: Mahomes clickable', /openPlayerCard\('Patrick Mahomes','QB','KC'\)/.test(dc));
chk('depth: starter marked on first chip', /depth-player clickable-player depth-starter/.test(dc));
chk('depth: granular LDT label shown', /depth-pos-abbr">LDT/.test(dc));
chk('depth: rookie tag shown', /depth-rookie/.test(dc));
chk('depth: Mahomes before Chris Jones (offense first)', dc.indexOf('Mahomes')<dc.indexOf('Chris Jones'));
const dcLoad=app.renderDepthChart('QQ');   // never set → loading state (no network, tid unknown)
chk('depth: unset team → loading placeholder', /Loading depth chart/.test(dcLoad));

console.log('\n=== TEST 7e: renderDepthChart fallback (flat roster grouping) ===');
app.setDepth('BUF', null);   // depth chart unavailable → fall back to roster grouping
app.setRosters('BUF',[
  {id:'10',name:'Josh Allen',pos:'QB',jersey:'17',exp:8,headshot:'a1',status:'active'},
  {id:'11',name:'James Cook',pos:'RB',jersey:'4',exp:3,headshot:'a2',status:'active'},
  {id:'12',name:'PS Guy',pos:'WR',jersey:'88',exp:0,headshot:null,status:'practice-squad'},
]);
const fb=app.renderDepthChart('BUF');
chk('fallback: renders grouped roster', /Depth Chart/.test(fb) && /Josh Allen/.test(fb));
chk('fallback: QB before RB', fb.indexOf('Josh Allen')<fb.indexOf('James Cook'));
chk('fallback: practice-squad excluded', !/PS Guy/.test(fb));

console.log('\n=== TEST 8: resolveEspnAthleteId prefers Sleeper espn_id (no network) ===');
app.resolveEspnAthleteId('1','Rook One').then(id=>{
  chk('resolved via espn_id', id==='4880281');

  console.log('\n=== TEST 9: pcardSeasonTeamTag (NFL cards, with logos) ===');
  const t1=app.pcardSeasonTeamTag([{team:'CLE'},{team:'CLE'}]);
  chk('single team tag', /CLE/.test(t1));
  chk('team tag has NFL logo', /pcard-season-logo/.test(t1) && /clubs\/logos\/CLE/.test(t1));
  chk('traded → both teams', (()=>{const t=app.pcardSeasonTeamTag([{team:'CLE'},{team:'CIN'}]);return /CLE/.test(t)&&/CIN/.test(t);})());
  chk('no team → empty', app.pcardSeasonTeamTag([{bye:true}])==='');

  console.log('\nRESULT:', fail===0 ? `PASS (${pass} checks)` : `FAIL (${fail}/${pass+fail})`);
  process.exit(fail===0?0:1);
});
