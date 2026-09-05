// Rankings column customization: the TC model column (left of ADP, sortable, proj-only),
// hide/reorder prefs driving the header AND every row, stat-group hiding, colspan staying
// honest, the hamburger Reset button appearing only when customized, reference seasons
// dropping ADP/TC entirely, and prefs surviving a persist round-trip.
const elStore={};let contentHTML='';
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{display:''},dataset:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],addEventListener(){},appendChild(){}};if(id==='content'){Object.defineProperty(elStore[id],'innerHTML',{get:()=>contentHTML,set:v=>{contentHTML=v;},configurable:true});}return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('_n'+Math.random()),body:{appendChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
const _store={};
global.localStorage={getItem:k=>(_store[k]!=null?_store[k]:null),setItem(k,v){_store[k]=String(v);},removeItem(k){delete _store[k];}};
const code=require('fs').readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  renderRankings, tcRatingsFor, TC_RATING_W, setBuild:(fn)=>{buildPlayerList=fn;},
  setSort:(k,d)=>{rankSortKey=k;rankSortDir=d;}, setSeason:(s)=>{activeSeason=s;},
  setPrefs:(p)=>{rankColPrefs=p;}, getPrefs:()=>rankColPrefs,
  setPos:(p)=>{rankPosFilter=p;}, setRookies:(v)=>{rankRookiesOnly=v;}, getPos:()=>rankPosFilter, getRookies:()=>rankRookiesOnly,
  rankColOrder, rankColHidden, rankColPrefsCustomized, rankColMove, rankColHide, resetRankColPrefs,
  rankAdvApplyPrefs,
  setFiltersOpen:(v)=>{rankFiltersOpen=v;},
  saveNow:()=>{_saveSessionNow();}, restore:()=>restoreSession(),
  invalidate:()=>{invalidateRankingsRenderCache();},
  getContent:()=>document.getElementById('content').innerHTML };`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const players=[]; for(let i=1;i<=30;i++)players.push({name:'P'+i,player_id:''+i,pos:'RB',team:'X',fpts:300-i,ecr:i,ecr_tier:1,
  tcFpg:(i<=20?20-i*0.5:null), tcPts:(i<=20?(20-i*0.5)*17:null), adp_ppr:i+10,
  rushing_attempts:1,rushing_yards:1,ypc:4,rushing_tds:1,receiving_targets:1,receptions:1,receiving_yards:1,receiving_tds:1,
  passing_attempts:0,passing_yards:0,passing_tds:0,interceptions_thrown:0});
app.setBuild(()=>players.map(p=>({...p})));

const head=()=>{const h=app.getContent();return h.slice(h.indexOf('<thead'),h.indexOf('</thead>'));};
const colspanOk=()=>{const h=app.getContent();
  const ths=(head().match(/<th[\s>]/g)||[]).length;
  return {ths, h};};

console.log('=== TC column (default layout) ===');
app.setSort('ecr',-1); app.renderRankings();
let hd=head();
chk(hd.indexOf('>TC')>hd.indexOf('>TIER') && hd.indexOf('>TC')<hd.indexOf('>ADP'), 'TC header sits between TIER and ADP');
chk(hd.indexOf('>ADP')<hd.indexOf('>FPTS'), 'ADP still precedes FPTS');
chk(app.getContent().includes('c-tc'), 'TC cells render');
chk((app.getContent().match(/TC model · projected season fantasy points/g)||[]).length>=1, 'TC cells carry the explanatory title');
chk(app.getContent().includes('>331.5<'), 'TC renders as a season total (19.5 FPG × 17), not per-game');
chk(hd.includes('data-rc="tc"'), 'TC header is customizable (data-rc)');
chk(hd.includes('data-rcg="rush"'), 'stat-group headers carry their group key');

console.log('=== TC sort: high first, null (rookies) sink ===');
app.invalidate(); app.setSort('tc',-1); app.renderRankings();
const names=[...app.getContent().matchAll(/rank-name">(P\d+)</g)].map(m=>m[1]);
chk(names[0]==='P1', 'highest TC first');
chk(names.indexOf('P21')>names.indexOf('P20'), 'players with no TC score sink below scored ones');

console.log('=== hide a column ===');
app.setSort('ecr',-1);
app.setPrefs({order:null, hidden:['adp']}); app.invalidate(); app.renderRankings();
hd=head();
chk(!hd.includes('>ADP'), 'hidden ADP header gone');
chk(!app.getContent().includes('c-adp'), 'hidden ADP cells gone');
chk(hd.includes('>TC'), 'TC unaffected by hiding ADP');
chk(app.rankColPrefsCustomized(), 'hiding marks the table customized');

console.log('=== hide a stat group ===');
app.setPrefs({order:null, hidden:['grp_pass']}); app.invalidate(); app.renderRankings();
hd=head();
chk(!hd.includes('>PASS'), 'PASS group headers gone');
chk(!app.getContent().includes('grp-pass'), 'PASS group cells gone');
chk(hd.includes('>RUSH') && hd.includes('>TGTS'), 'other groups intact');

console.log('=== reorder ===');
app.setPrefs({order:null, hidden:[]});
app.rankColMove('vor','ecr_tier');   // VOR up next to the rank columns
hd=(app.renderRankings(), head());
chk(hd.indexOf('>VOR')<hd.indexOf('>TIER'), 'VOR moved before TIER');
chk(app.getPrefs().order && app.getPrefs().order[0]==='ecr', 'ECR stays pinned first');
const rowSlice=app.getContent().slice(app.getContent().indexOf('<tbody'));
chk(rowSlice.indexOf('c-vor')<rowSlice.indexOf('c-tier'), 'row cells follow the reordered header');
chk(app.rankColPrefsCustomized(), 'reorder marks the table customized');
app.rankColMove('ecr','fpts');
chk(app.rankColOrder()[0]==='ecr', 'ECR cannot be dragged off the front (locked)');

console.log('=== reset ===');
app.setFiltersOpen(true); app.invalidate(); app.renderRankings();
chk(app.getContent().includes('Reset table'), 'Reset button visible in the hamburger while customized');
app.resetRankColPrefs();
chk(!app.rankColPrefsCustomized(), 'reset restores defaults');
chk(!app.getContent().includes('Reset table'), 'Reset button hides when layout is default');
hd=head();
chk(hd.indexOf('>TIER')<hd.indexOf('>TC') && hd.indexOf('>TC')<hd.indexOf('>ADP'), 'default order restored');
app.setFiltersOpen(false);

console.log('=== colspan honesty (pick lines depend on it) ===');
app.setPrefs({order:null, hidden:['adp','grp_pass','vor']}); app.invalidate(); app.renderRankings();
const ths=(head().match(/<th[\s>]/g)||[]).length;
chk(ths===8+8, `header count reflects hides (${ths} th = ecr,tier,tc,tcr,fpts,pos,player,team + rush/rec groups)`);
app.setPrefs({order:null, hidden:[]}); app.invalidate();

console.log('=== reference season: no ADP, no TC ===');
app.setSeason('2024'); app.invalidate(); app.renderRankings();
hd=head();
chk(!hd.includes('>ADP'), 'reference board drops the ADP column');
chk(!hd.includes('>TC'), 'reference board drops the TC column');
chk(hd.includes('>FPTS') && hd.includes('>TIER'), 'other columns survive');
app.setSeason('proj'); app.invalidate(); app.renderRankings();
chk(head().includes('>ADP'), 'projection board gets ADP back');

console.log('=== ROOKIES stacks on the position filter ===');
players.forEach((p,i)=>{ p.years_exp = (i%3===0) ? 0 : 3; p.is_rookie = (i%3===0); });   // P1,P4,P7… rookies
players.forEach((p,i)=>{ if(i>=15) p.pos='WR'; });                                        // P16..P30 are WRs
app.setPos('WR'); app.setRookies(true); app.invalidate(); app.renderRankings();
let body=app.getContent();
const shown=[...body.matchAll(/rank-name">(P\d+)</g)].map(m=>m[1]);
chk(shown.length>0 && shown.every(n=>{const i=+n.slice(1);return i>=16 && (i-1)%3===0;}), `WR + ROOKIES shows only rookie WRs (${shown.join(',')})`);
chk((body.match(/filter-btn active/g)||[]).length===2 && body.includes('rookies-filter-btn active'), 'BOTH chips highlighted (WR and ROOKIES)');
app.setRookies(false); app.invalidate(); app.renderRankings();
const shownAll=[...app.getContent().matchAll(/rank-name">(P\d+)</g)].map(m=>m[1]);
chk(shownAll.length>shown.length, 'toggling ROOKIES off widens back to all WRs');
app.setPos('ROOKIES'); app.invalidate(); app.renderRankings();   // legacy value normalizes
chk(app.getPos()==='ALL' && app.getRookies()===true, "legacy rankPosFilter='ROOKIES' normalizes to ALL + rookies toggle");
app.setPos('ALL'); app.setRookies(false); app.invalidate(); app.renderRankings();
players.forEach((p,i)=>{ if(i>=15) p.pos='RB'; delete p.is_rookie; p.years_exp=3; });

console.log('=== Adv. Metrics column prefs ===');
const COLS=['EPA/P','Success %','YPRR','ADOT'];
app.setPrefs({order:null,hidden:[],advOrder:null});
chk(app.rankAdvApplyPrefs(COLS).join()===COLS.join(), 'no prefs → default adv order');
app.setPrefs({order:null,hidden:['adv:YPRR'],advOrder:null});
chk(app.rankAdvApplyPrefs(COLS).join()==='EPA/P,Success %,ADOT', "'adv:' hidden keys drop that metric");
app.setPrefs({order:null,hidden:[],advOrder:['YPRR','Bogus Col','EPA/P']});
chk(app.rankAdvApplyPrefs(COLS).join()==='YPRR,EPA/P,Success %,ADOT', 'advOrder permutes; unknown labels ignored; rest keep default order');
chk(app.rankColPrefsCustomized(), 'an advOrder marks the table customized');
app.setPrefs({order:null,hidden:[],advOrder:null});

console.log('=== persistence round-trip ===');
app.setPrefs({order:null, hidden:['adp','grp_rec']});
app.saveNow();
app.setPrefs({order:null, hidden:[]});
app.restore();
chk((app.getPrefs().hidden||[]).includes('adp') && (app.getPrefs().hidden||[]).includes('grp_rec'), 'hidden prefs survive save/restore');
app.setPrefs({order:null, hidden:['bogus_key','adp']});
app.saveNow(); app.setPrefs({order:null,hidden:[]}); app.restore();
chk(!(app.getPrefs().hidden||[]).includes('bogus_key') && (app.getPrefs().hidden||[]).includes('adp'), 'unknown keys are whitelisted away on restore');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
if(pass!==total) process.exitCode=1;

// ── TripleCrown Rating (validated blend) ─────────────────────────────────────
(()=>{
  console.log('\n=== TC Rating: the market, tilted only where the tilt is proven ===');
  const chk=(c,l)=>{console.log((c?'  PASS: ':'  FAIL: ')+l); if(!c) process.exitCode=1;};
  chk(JSON.stringify(app.TC_RATING_W)===JSON.stringify({QB:0.125,RB:0,WR:0.5,TE:0.25}),
      'the pre-registered weights ship exactly as validated (QB 12% · RB 0% · WR 50% · TE 25%)');
  const mk=(id,pos,tc,adp)=>({player_id:id,pos,name:id,tcPts:tc,fpts:tc,adp_ppr:adp});
  global.adpFor=(p)=>p.adp_ppr!=null?p.adp_ppr:999;
  const rbs=[...Array(10)].map((_,i)=>mk('rb'+i,'RB',200-i*10,i+1));
  const r=app.tcRatingsFor(rbs);
  chk(r.get('rb0')===100 && r.get('rb9')===0, 'RB rating IS the market (weight 0): best ADP = 100, worst = 0');
  // At WR (50/50), a player the model loves over his ADP outranks his market twin.
  const wrs=[...Array(10)].map((_,i)=>mk('wr'+i,'WR',180-i*8,i+1));
  wrs[7].tcPts=210;   // wr7: ADP 8th, model's #1
  const rw=app.tcRatingsFor(wrs);
  chk(rw.get('wr7')>rw.get('wr5'), 'a model darling climbs past his ADP at WR (50% model)');
  chk(rw.get('wr0')>=rw.get('wr9'), 'but the market still anchors the order');
  const thin=app.tcRatingsFor([mk('a','TE',100,1),mk('b','TE',90,2)]);
  chk(thin.size===0, 'fewer than 8 rated players at a position → no ratings (no fake precision)');
  delete global.adpFor;
})();

process.exit(process.exitCode||0);
