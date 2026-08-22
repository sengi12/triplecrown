// Regression coverage for the live-audit fixes: import merges notes / derives targets /
// leaves the reference season, copy-from-season zeroes every spelling of a stat, the
// player-list cache follows the league shape, weekly fetches cache "no stats" and dedupe,
// names are escaped in the QB tab and team header, D/ST weeks that fail are reported rather
// than hidden, 2-QB leagues are superflex, detached-image onerror cannot throw, and a
// restored session rebuilds the league shape.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},textContent:'',value:'',dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},children:[],appendChild(){},querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
const store={};
global.localStorage={getItem:k=>store[k]==null?null:store[k], setItem:(k,v)=>{store[k]=String(v);}, removeItem:k=>{delete store[k];}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),matchMedia:()=>({matches:false}),innerWidth:1200};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};
global.AbortController=class{constructor(){this.signal={};}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){}; renderContent=function(){}; renderSeasonTabs=function(){}; renderSidebar=function(){}; syncAppChrome=function(){};
  let __fetches=[]; sleeperFetch=async(u)=>{ __fetches.push(u); if(/\\/stats\\/nfl\\/player\\//.test(u)) return null; if(/stats\\/nfl\\/2024\\/(3|7)\\?/.test(u)) throw new Error('429'); if(/stats\\/nfl\\/2024\\//.test(u)) return [{player_id:'GB',stats:{gp:1,sack:2,pts_std:7}}]; return null; };
  return {
  assembleSeed, normalizeSleeperRow, setSEED:(s)=>{SEED=s;seasonStatsCache.proj=s;projSeed=s;},
  ensureTeam, initPassingShares, initRushingShares, buildPlayerList, leagueStarterCounts, buildPlayerShapeSig,
  loadProjections, getNotes:()=>playerNotes, setNotes:(n)=>{playerNotes=n;}, setActive:(s)=>{activeSeason=s;}, getActive:()=>activeSeason, getSEED:()=>SEED,
  setRefSeed:(y,s)=>{seasonStatsCache[y]=s;}, copyTeamToWorking, getProj:()=>userProj, setUserProj:(u)=>{userProj=u;workingProj=u;},
  setShape:(sh)=>{leagueShape=sh;}, getShape:()=>leagueShape,
  fetchPlayerWeekly, fetches:()=>__fetches, cacheKeys:()=>Object.keys(weeklySkillCache),
  renderPassing:(t,st)=>renderPassing(t,st), teamHeaderQbText,
  dst:(s)=>pcardFetchDstSeason(s), dstCache:()=>_dstWeekCache,
  leagueIsSuperflex, lineupFromRosterPositions,
  saveNow:()=>{ _persistReady=true; clearTimeout(_persistTimer); saveSession(); }, restoreSession, setSnapshot:(s)=>{leagueSnapshot=s;}, setPersistReady:()=>{_persistReady=true;},
  selectTeam:t=>{currentTeam=t;ensureTeam(t);},
};`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const players={ qb:{player_id:'qb',name:'Joe Burrow',pos:'QB',team:'CIN'}, wr1:{player_id:'wr1',name:"Ja'Marr Chase",pos:'WR',team:'CIN'}, wr2:{player_id:'wr2',name:'Tee Higgins',pos:'WR',team:'CIN'}, rb:{player_id:'rb',name:'Chase Brown',pos:'RB',team:'CIN'} };
const idx={ qb:app.normalizeSleeperRow({player_id:'qb',team:'CIN',position:'QB',stats:{pass_yd:4500,pass_att:600,pass_td:35,gp:17}}),
  wr1:app.normalizeSleeperRow({player_id:'wr1',team:'CIN',position:'WR',stats:{rec:110,rec_tgt:160,rec_yd:1500,rec_td:12,gp:17}}),
  wr2:app.normalizeSleeperRow({player_id:'wr2',team:'CIN',position:'WR',stats:{rec:70,rec_tgt:110,rec_yd:950,rec_td:8,gp:17}}),
  rb:app.normalizeSleeperRow({player_id:'rb',team:'CIN',position:'RB',stats:{rush_att:230,rush_yd:1000,rush_td:7,rec:40,rec_tgt:50,rec_yd:300,gp:17}}) };
const seed=app.assembleSeed(players,idx);
app.setSEED(seed);

console.log('=== import: merges notes, derives targets, leaves the reference season ===');
app.setNotes({'n1':{text:'keep me',tags:[]}});
app.setActive('2024'); app.setRefSeed('2024', JSON.parse(JSON.stringify(seed)));
app.loadProjections({projections:[
  {name:"Ja'Marr Chase",fantasy_position:'WR',team:'CIN',player_id:'wr1',receptions:110,receiving_yards:1500,receiving_touchdowns:12},
  {name:'Joe Burrow',fantasy_position:'QB',team:'CIN',player_id:'qb',passing_yards:4500,passing_attempts:600,passing_touchdowns:35,games_played:17},
]});
chk(Object.keys(app.getNotes()).length===1,'a file without playerNotes keeps existing notes (was: wiped)');
chk(app.getActive()==='proj' && app.getSEED()===seed,'import lands on the projection season with the projection seed as base');
const cin=app.getProj().CIN; const chase=(cin.passing_shares||[]).find(p=>p.name==="Ja'Marr Chase");
chk(!!chase && chase.share>0.5,`receptions-only row gets a real target share (${chase&&(chase.share*100).toFixed(0)}%)`);

console.log('=== copy-from-season zeroes both spellings ===');
app.setUserProj({}); app.setActive('2024');
const ref=JSON.parse(JSON.stringify(seed)); ref.CIN.QB=[]; // no QB line that season
app.setRefSeed('2024', ref);
app.getSEED().CIN.QB[0].passing_tds=35; app.getSEED().CIN.QB[0].passing_touchdowns=35;
app.copyTeamToWorking('CIN');
const q=app.getSEED().CIN.QB[0];
chk((q.passing_tds||0)===0 && (q.passing_touchdowns||0)===0,'QB with no line in the copied season has 0 TDs under BOTH keys (was: 35 via the fallback)');

console.log('=== player list cache follows the league shape ===');
app.setActive('proj'); app.setUserProj({}); app.selectTeam('CIN'); app.initPassingShares('CIN'); app.initRushingShares('CIN');
app.setShape({teams:12,lineup:['QB','RB','RB','WR','WR','TE','FLEX'],bench:6});
const l1=app.buildPlayerList(); const v1=l1.find(p=>p.name==="Ja'Marr Chase").vor;
app.setShape({teams:10,lineup:['QB','RB','RB','WR','WR','WR','TE','FLEX','FLEX'],bench:6});
const l2=app.buildPlayerList(); const v2=l2.find(p=>p.name==="Ja'Marr Chase").vor;
chk(app.buildPlayerShapeSig().includes('"WR":3') || v1!==v2,'changing the synced lineup invalidates the cached list (VOR recomputes)');

console.log('=== weekly fetch: caches "no stats", dedupes in flight ===');
(async()=>{
  const a=app.fetchPlayerWeekly('rook','2025'); const b=app.fetchPlayerWeekly('rook','2025');
  await Promise.all([a,b]);
  await app.fetchPlayerWeekly('rook','2025');
  const n=app.fetches().filter(u=>/player\/rook/.test(u)).length;
  chk(n===1,`three calls for a null-stats season hit the network once (${n})`);
  chk(app.cacheKeys().includes('2025:rook'),'null result is cached');

  console.log('=== D/ST weeks that fail are reported, not hidden ===');
  const by=await app.dst('2024');
  chk(Array.isArray(by.__failedWeeks) && by.__failedWeeks.join(',')==='3,7','failed weeks are listed on the result');
  chk(!app.dstCache()['2024'],'a partial season is not cached (next open retries)');
  chk(by.GB && by.GB.length===16,'the weeks that did load are still shown');

  console.log('=== escaping ===');
  app.getProj().CIN.qbs[0].name='<img src=x onerror=alert(1)>';
  const html=app.renderPassing('CIN', app.getProj().CIN);
  chk(!/<img src=x/.test(html) && /&lt;img/.test(html),'QB tab escapes the quarterback name');
  chk(!/<img/.test(app.teamHeaderQbText('CIN',[{name:'<img src=x>'}],'')),'team header escapes QB names');
  app.getProj().CIN.qbs[0].name='Joe Burrow';

  console.log('=== 2-QB is superflex; onerror guards; shape restore ===');
  chk(app.leagueIsSuperflex(['QB','QB','RB','WR'])===true,'two QB slots without SUPER_FLEX count as superflex');
  const src=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
  chk(!/onerror="this\.outerHTML=/.test(src) && !/else\{this\.outerHTML=/.test(src),'no onerror handler sets outerHTML on a possibly-detached image');
  store['triplecrown.session.v1']=JSON.stringify({v:2, season:2026, leagueSnapshot:{provider:'sleeper',leagueId:'9',season:'2026',takenAt:1,teams:10,rosterPositions:['QB','RB','RB','WR','WR','WR','TE','FLEX','BN','BN'],teamList:[]}});
  app.setShape(null);
  app.restoreSession();
  const sh=app.getShape();
  chk(!!sh && sh.teams===10 && sh.lineup.filter(x=>x==='WR').length===3,'restoreSession rebuilds leagueShape from the saved snapshot');

  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
