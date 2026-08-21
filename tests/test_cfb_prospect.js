// College prospect panel (rookie player cards): lookup, percentile bars and banding, the
// per-position season table, and — most importantly — that the whole thing degrades to an
// empty string rather than an error whenever the college data isn't there. Roughly 3% of
// rookies have no CFBD coverage at all and every seed built before --cfb has no block, so the
// "nothing to show" path is the common one, not the edge case.
const _bodies={};
function mkEl(id){ if(!_bodies[id]) _bodies[id]={innerHTML:'',style:{},classList:{add(){},remove(){}}}; return _bodies[id]; }
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){}}),body:{appendChild(){}}};
global.window={};
global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  cfbProfile, cfbHasProfile, renderCfbProspect, resetCfbLazy, cfbLogsReady,
  _cfbPctClass, _cfbOrdinal, _cfbStatLabel,
  setCfb:(c)=>{CFB=c;}, setCfbLogs:(l)=>{CFB_LOGS=l;},
};`)();

// Fixture mirrors the real seed block: labels/headline live at the top level so each player
// row stays small, and percentiles are pre-computed at build time.
const CFB={
  schema:'cfb_profiles_v1', class:2026,
  reference:{classes:[2018,2025], steps:[0,50,100]},
  labels:{dominator:'Dominator', tgt_share:'Target share', yptpa:'Yds/team pass att',
          epa_play:'EPA/play', succ:'Success rate', ypr:'Yards/reception', expl_rate:'Explosive rate',
          ypc:'Yards/carry', stuff_rate:'Stuff rate', rush_share:'Rush share',
          ypa:'Yards/attempt', comp_pct:'Completion %', sack_pct:'Sack rate',
          pass_td:'Passing TDs', rush_yds:'Rushing yards'},
  headline:{
    WR:['dominator','tgt_share','yptpa','epa_play','succ','ypr','expl_rate'],
    TE:['dominator','tgt_share','yptpa','epa_play','succ','ypr','expl_rate'],
    RB:['epa_play','succ','ypc','expl_rate','stuff_rate','rush_share','tgt_share'],
    QB:['epa_play','succ','ypa','comp_pct','sack_pct','pass_td','rush_yds'],
  },
  players:{
    "100":{name:'Eli Stowers', pos:'TE', athlete_id:'123', method:'espn_id',
           college:'Vanderbilt', conf:'SEC', final:'2025',
           pct:{dominator:74, tgt_share:84, yptpa:87, epa_play:37, succ:38, ypr:36, expl_rate:25},
           seasons:{"2024":{team:'Vanderbilt', games:12, tgt:80, rec:60, rec_yds:700, rec_td:5,
                            ypr:11.67, epa_play:0.55, succ:57.5, dominator:22.1, tgt_share:20.0, yptpa:1.9},
                    "2025":{team:'Vanderbilt', games:13, tgt:95, rec:70, rec_yds:900, rec_td:7,
                            ypr:12.86, epa_play:0.61, succ:59.0, dominator:28.4, tgt_share:24.5, yptpa:2.2}}},
    "200":{name:'Jeremiyah Love', pos:'RB', athlete_id:'456', method:'name',
           college:'Notre Dame', conf:'FBS Independents', final:'2025',
           pct:{epa_play:21, succ:40, ypc:45, expl_rate:61, stuff_rate:24, rush_share:69, tgt_share:77},
           seasons:{"2025":{team:'Notre Dame', games:12, rushes:191, rush_yds:1092, rush_td:10,
                            ypc:5.72, epa_play:0.026, succ:44.0, expl_rate:13.6, stuff_rate:18.3,
                            rush_share:50.5, tgt:30, rec_yds:250}}},
    // A player whose percentiles are partly missing — a thin college season still renders.
    "300":{name:'Sparse Guy', pos:'WR', athlete_id:'789', method:'name+college',
           college:'Toledo', conf:'MAC', final:'2025',
           pct:{dominator:12},
           seasons:{"2025":{team:'Toledo', games:4, tgt:9, rec:5, rec_yds:40, rec_td:0, dominator:4.1}}},
    // Name carrying HTML — the panel interpolates school/conference into markup.
    "400":{name:'XSS Guy', pos:'WR', athlete_id:'999', method:'name',
           college:'<img src=x onerror=alert(1)>', conf:'"><script>alert(2)</script>', final:'2025',
           pct:{dominator:50},
           seasons:{"2025":{team:'<b>bad</b>', games:1, tgt:1, rec:1, rec_yds:1, rec_td:0, dominator:1}}},
  },
};

let pass=0,fail=0;
function chk(name,cond){ if(cond){pass++;console.log('  PASS',name);} else {fail++;console.log('  FAIL',name);} }

console.log('=== TEST 1: degrades to nothing when there is no data ===');
app.setCfb({});
chk('no cfb block → no profile', app.cfbProfile('100')===null);
chk('no cfb block → hasProfile false', app.cfbHasProfile('100')===false);
chk('no cfb block → empty panel, no throw', app.renderCfbProspect('100')==='');
app.setCfb(CFB);
chk('unlinked player → empty panel', app.renderCfbProspect('999999')==='');
chk('unlinked player → hasProfile false', app.cfbHasProfile('999999')===false);

console.log('\n=== TEST 2: lookup ===');
chk('profile found by string pid', app.cfbProfile('100').name==='Eli Stowers');
chk('profile found by numeric pid', app.cfbProfile(100).name==='Eli Stowers');
chk('hasProfile true for linked player', app.cfbHasProfile('200')===true);

console.log('\n=== TEST 3: percentile banding ===');
chk('80+ is elite', app._cfbPctClass(84)==='cfb-elite');
chk('60-79 is good', app._cfbPctClass(74)==='cfb-good');
chk('40-59 is average', app._cfbPctClass(50)==='cfb-avg');
chk('20-39 is poor', app._cfbPctClass(25)==='cfb-poor');
chk('under 20 is bad', app._cfbPctClass(12)==='cfb-bad');
chk('null percentile has no class', app._cfbPctClass(null)==='');

console.log('\n=== TEST 4: ordinals in the summary line ===');
chk('1 → 1st', app._cfbOrdinal(1)==='1st');
chk('2 → 2nd', app._cfbOrdinal(2)==='2nd');
chk('3 → 3rd', app._cfbOrdinal(3)==='3rd');
chk('4 → 4th', app._cfbOrdinal(4)==='4th');
chk('11 → 11th (not 11st)', app._cfbOrdinal(11)==='11th');
chk('12 → 12th', app._cfbOrdinal(12)==='12th');
chk('13 → 13th', app._cfbOrdinal(13)==='13th');
chk('21 → 21st', app._cfbOrdinal(21)==='21st');
chk('74 → 74th', app._cfbOrdinal(74)==='74th');

console.log('\n=== TEST 5: TE panel content ===');
const te = app.renderCfbProspect('100');
chk('renders a panel', te.indexOf('cfb-panel')>=0);
chk('shows the school', te.indexOf('Vanderbilt')>=0);
chk('shows the conference', te.indexOf('SEC')>=0);
chk('names the final season', te.indexOf('final season 2025')>=0);
chk('states the reference classes', te.indexOf('2018')>=0 && te.indexOf('2025')>=0);
chk('one bar per headline metric', (te.match(/cfb-bar-row/g)||[]).length===7);
chk('leading metric drives the summary', te.indexOf('Dominator ranks')>=0);
chk('summary uses an ordinal', te.indexOf('74th percentile')>=0);
chk('elite metric banded elite', te.indexOf('cfb-bar-fill cfb-elite')>=0);
chk('bar width tracks the percentile', te.indexOf('width:84%')>=0);
chk('season table present', te.indexOf('cfb-table')>=0);
chk('both college seasons listed', te.indexOf('>2024<')>=0 && te.indexOf('>2025<')>=0);
chk('table scrolls in its own container', te.indexOf('pcard-table-scroll')>=0);
chk('attribution names cfbfastR', te.indexOf('cfbfastR')>=0);
chk('states the college data limits', te.indexOf('No air yards')>=0);

console.log('\n=== TEST 6: position-specific columns ===');
const rb = app.renderCfbProspect('200');
chk('RB shows carries column', rb.indexOf('>ATT<')>=0);
chk('RB shows stuff rate', rb.indexOf('>STUFF%<')>=0);
chk('RB shows rush share', rb.indexOf('>RU%<')>=0);
chk('RB does not show dominator', rb.indexOf('>DOM%<')<0);
chk('TE shows dominator', te.indexOf('>DOM%<')>=0);
chk('TE does not show stuff rate', te.indexOf('>STUFF%<')<0);
chk('RB summary leads with EPA/play', rb.indexOf('EPA/play ranks')>=0);

console.log('\n=== TEST 7: partial data still renders ===');
const sparse = app.renderCfbProspect('300');
chk('sparse player renders a panel', sparse.indexOf('cfb-panel')>=0);
chk('only the present metric gets a bar', (sparse.match(/cfb-bar-row/g)||[]).length===1);
chk('missing season stats render as dash', sparse.indexOf('>–<')>=0);
chk('low percentile banded bad', sparse.indexOf('cfb-bar-fill cfb-bad')>=0);

console.log('\n=== TEST 8: escaping (school/conference are interpolated into markup) ===');
const xss = app.renderCfbProspect('400');
chk('no raw img tag', xss.indexOf('<img src=x')<0);
chk('no raw script tag', xss.indexOf('<script>')<0);
chk('no raw bold from season team', xss.indexOf('<b>bad</b>')<0);
chk('escaped entities present instead', xss.indexOf('&lt;')>=0);

console.log('\n=== TEST 9: every stat is note-taggable ===');
// The whole panel must be attachable to a player note, the same as rankings and OL stats.
const noteable = (te.match(/data-noteable="1"/g)||[]).length;
chk('panel emits noteable elements', noteable>0);
chk('every percentile bar is taggable', (te.match(/cfb-bar-val[^>]*data-noteable/g)||[]).length===7);
chk('percentile tags carry a stat key', te.indexOf('data-note-stat-key="pct_dominator"')>=0);
chk('percentile tag value is human readable', te.indexOf('74th percentile')>=0);
chk('percentile tag names the raw stat too', te.indexOf('28.4')>=0);
chk('summary percentile is taggable', te.indexOf('data-note-label="Dominator percentile"')>=0);
chk('school/conference is taggable', te.indexOf('data-note-stat-key="college_program"')>=0);
chk('season rows carry a note scope', (te.match(/data-note-scope="1"/g)||[]).length===2);
chk('season cells are taggable', te.indexOf('data-note-stat-key="rec_yds"')>=0);
chk('season cell labels are unabbreviated', te.indexOf('College receiving yards (2025)')>=0);
chk('season cell label carries its season', te.indexOf('(2024)')>=0);
chk('note source distinguishes college from the ESPN log', te.indexOf('data-note-source="cfb_prospect"')>=0);
chk('note relevance is the position', te.indexOf('data-note-relevance="TE"')>=0);
chk('row scope names the season context', te.indexOf('2025 college season')>=0);
chk('RB season cells taggable too', rb.indexOf('data-note-stat-key="rush_yds"')>=0);
chk('RB labels use RB wording', rb.indexOf('College rushing yards (2025)')>=0);
chk('stat label falls back for unknown keys', app._cfbStatLabel('not_a_real_key')==='not_a_real_key');
// An empty cell has no value worth citing, so it must NOT be taggable.
chk('empty season cells are not taggable', sparse.indexOf('data-noteable="1">–<')<0);

console.log('\n=== TEST 10: lazy game-log state ===');
app.setCfbLogs({});
app.resetCfbLazy();
chk('no logs loaded initially', app.cfbLogsReady()===false);
app.setCfbLogs({"100":{"2025":[{wk:1,opp:'Georgia',yds:80}]}});
chk('logs ready once populated', app.cfbLogsReady()===true);

// Summary follows the harness convention: run_tests.sh counts assertions by grepping the
// output for "PASS"/"FAIL", so a summary that says "0 failed" on a clean run registers as a
// failure. Only emit the word when there actually is one.
console.log('\nRESULT:', fail===0 ? `PASS (${pass} checks)` : `FAIL (${fail}/${pass+fail})`);
process.exit(fail?1:0);
