// ESPN league linking: SWID→leagues lookup, player resolution to Sleeper ids, slot + scoring
// translation, and snapshot assembly. Fixtures are TRIMMED REAL PAYLOADS captured from
// lm-api-reads.fantasy.espn.com and fan.api.espn.com, so the shapes are the ones we actually
// have to parse — not an idealised version of them.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');
global.FileReader=function(){};global.Range=function(){};
global.AbortController=class{constructor(){this.signal={};}abort(){}};
// A real localStorage so the "remember this account" half of the flow can be asserted.
const LSTORE=new Map();
global.localStorage={ getItem:k=>(LSTORE.has(k)?LSTORE.get(k):null),
                      setItem:(k,v)=>{LSTORE.set(k,String(v));}, removeItem:k=>{LSTORE.delete(k);} };

const fs=require('fs'), path=require('path');
const LEAGUE=JSON.parse(fs.readFileSync(path.join(__dirname,'espn_league_fixture.json'),'utf8'));
const PLAYERS=JSON.parse(fs.readFileSync(path.join(__dirname,'espn_sleeper_players_fixture.json'),'utf8'));

// Real fan-profile shape: preferences keyed "gameId:leagueId:entryId:season". gameId 1 is
// football; the MLB row must be filtered out.
const FAN={ id:'{3A2C2DB2-7702-429A-8C0E-BC6C84DAA2EF}', anon:false,
  fantasyData:{totalFantasyLeagues:3, leaguesBySportLeague:{NFL:2,MLB:1}},
  preferences:[
    {id:'1:1241838:1:2026', metaData:{entry:{entryId:1, seasonId:2026, gameId:1,
      entryMetadata:{teamName:'Team Binish', draftComplete:false},
      groups:[{groupId:1241838, groupSize:10, groupName:'The Keeper League'}],
      logoUrl:'https://g.espncdn.com/x.svg'}}},
    {id:'1:23007934:3:2026', metaData:{entry:{entryId:3, seasonId:2026, gameId:1,
      entryMetadata:{teamName:'Other Team', draftComplete:true},
      groups:[{groupId:23007934, groupSize:12, groupName:'Second League'}]}}},
    {id:'2:2056549836:1:2026', metaData:{entry:{entryId:1, seasonId:2026, gameId:2,
      entryMetadata:{teamName:'Baseball Team'},
      groups:[{groupId:2056549836, groupSize:10, groupName:'A Baseball League'}]}}},
  ]};

let fetchLog=[];
let leagueStatus=200;   // flip to 401 to exercise the private-league path
global.fetch=(u)=>{
  fetchLog.push(u);
  const J=(o)=>Promise.resolve({ok:true,json:()=>Promise.resolve(o)});
  if(u.includes('fan.api.espn.com')){
    if(u.includes('BADSWID')) return Promise.resolve({ok:false,status:404});
    return J(FAN);
  }
  if(u.includes('lm-api-reads.fantasy.espn.com')){
    if(/leagues\/BADLEAGUE/.test(u)) return Promise.resolve({ok:false,status:404});
    if(leagueStatus!==200) return Promise.resolve({ok:false,status:leagueStatus});
    // The second league on the fan profile, so "discovered a league we weren't told about"
    // is a real assertion rather than a fixture echo.
    if(/leagues\/23007934/.test(u))
      return J(Object.assign({}, LEAGUE, {id:23007934,
        settings:Object.assign({}, LEAGUE.settings, {name:'Second League'})}));
    return J(LEAGUE);
  }
  if(u.includes('api.sleeper.app/v1/players/nfl')) return J(PLAYERS);
  if(u.includes('state/nfl')) return J({season:'2026',league_season:'2026'});
  return Promise.reject(new Error('unmocked '+u));
};

let toasts=[];
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(m,t){toasts.push({m,t});};
  saveSession=function(){};
  persistAvailable=function(){return true;};
  renderLeagueAnalyzer=function(){};
  syncAppChrome=function(){};
  return {
    espnParseLeagueRef, espnFetchFanLeagues, espnFetchLeagueMembers, espnMarkReadable,
    espnRosterPositions, espnScoringToSleeper, espnLeagueType, espnBuildSnapshot,
    espnResolvePlayer, laParseRef, laRefKey, laEspnErrorText,
    laTakeSnapshot, loadSleeperPlayers, calcFpts,
    laSubmitEspnLeague, laEspnPickMember, laEspnRefreshLeagues, laSetupStartHTML,
    getSnapshot:()=>leagueSnapshot,
    getScoring:()=>scoringSettings,
    getLaState:()=>laState,
    getToasts:()=>toasts,
  };
`)();
global.toasts=toasts;

(async()=>{
  let pass=0,total=0;
  const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

  console.log('=== TEST 1: a league hands out display name → account id ===');
  // ESPN has no username lookup, so this mapping is the ONLY way an ordinary user can be
  // identified — it's what lets "paste your league link, tap your name" replace a SWID.
  const mem=await app.espnFetchLeagueMembers('1241838','2025');
  chk(mem.members.length===2,'one entry per league member');
  chk(mem.leagueName==='The Keeper League','league name comes back for the "is this your league?" heading');
  const pudge=mem.members.find(m=>m.name==='justlikepudge');
  chk(!!pudge,'display name read from members[].displayName');
  chk(pudge && /^\{[0-9A-F-]+\}$/.test(pudge.swid),'that member carries their SWID (the account id)');
  chk(pudge && pudge.teamId===1,'member is joined to their own teamId');
  chk(pudge && pudge.teamName==='Team Binish','member is joined to their own team name');
  const names=mem.members.map(m=>m.name);
  chk(names.join()===names.slice().sort((x,y)=>x.toLowerCase().localeCompare(y.toLowerCase())).join(),
      'members are alphabetical so a big league stays scannable');

  console.log('\n=== TEST 2: league ref parsing (what people paste) ===');
  chk(app.espnParseLeagueRef('1241838').leagueId==='1241838','bare numeric id');
  const fromUrl=app.espnParseLeagueRef('https://fantasy.espn.com/football/league?leagueId=1241838&seasonId=2025');
  chk(fromUrl && fromUrl.leagueId==='1241838' && fromUrl.season==='2025','league URL yields id + season');
  const fromTeam=app.espnParseLeagueRef('https://fantasy.espn.com/football/team?leagueId=730841&teamId=4&seasonId=2026');
  chk(fromTeam && fromTeam.leagueId==='730841' && fromTeam.season==='2026','team URL yields id + season');
  chk(app.espnParseLeagueRef('https://fantasy.espn.com/football/league')===null,'URL with no leagueId returns null');
  chk(app.espnParseLeagueRef('')===null,'empty input returns null');

  console.log('\n=== TEST 3: provider refs stay backward-compatible ===');
  chk(app.laParseRef('1180564550988939264').provider==='sleeper','a bare id still means Sleeper');
  chk(app.laRefKey('1180564550988939264')==='1180564550988939264','Sleeper refs stay bare (no stored session migrates)');
  const er=app.laParseRef('espn:1241838:2026');
  chk(er.provider==='espn' && er.leagueId==='1241838' && er.season==='2026','espn ref round-trips');
  chk(app.laRefKey({provider:'espn',leagueId:'1241838',season:'2026'})==='espn:1241838:2026','ref key builds from an object');

  console.log('\n=== TEST 4: SWID → football leagues only ===');
  const leagues=await app.espnFetchFanLeagues('{3A2C2DB2-7702-429A-8C0E-BC6C84DAA2EF}');
  chk(leagues.length===2,'2 football leagues found (the MLB entry is filtered out)');
  const keeper=leagues.find(l=>l.leagueId==='1241838');
  chk(!!keeper,'league id read from groupId');
  chk(keeper && keeper.name==='The Keeper League','league name read from groupName');
  chk(keeper && keeper.teams===10,'league size read from groupSize');
  chk(keeper && keeper.teamId===1,'entryId captured as MY teamId — no second lookup needed');
  chk(keeper && keeper.season==='2026','season captured');
  chk(fetchLog.some(u=>u.includes('%7B')),'SWID braces are percent-encoded (raw braces 404 on ESPN)');
  chk(leagues.totalLeagues===3,'the account\u2019s REAL league count is carried, so "0 found" can be explained');

  console.log('\n=== TEST 5: lineup slots → Sleeper roster_positions ===');
  const rp=app.espnRosterPositions(LEAGUE.settings.rosterSettings.lineupSlotCounts);
  const count=(t)=>rp.filter(x=>x===t).length;
  chk(count('QB')===1,'1 QB');
  chk(count('RB')===2,'2 RB');
  chk(count('WR')===2,'2 WR');
  chk(count('TE')===1,'1 TE');
  chk(count('FLEX')===2,'slot 23 → 2 FLEX');
  chk(count('DEF')===1 && count('K')===1,'slot 16 → DEF, slot 17 → K');
  chk(count('BN')===7,'slot 20 → 7 BN');
  chk(count('IR')===2,'slot 21 → 2 IR');
  chk(rp.indexOf('QB')<rp.indexOf('RB') && rp.indexOf('TE')<rp.indexOf('FLEX'),'starters come out in lineup-card order');
  chk(app.espnRosterPositions({'7':1})[0]==='SUPER_FLEX','slot 7 (OP) → SUPER_FLEX');
  chk(app.espnRosterPositions(null).length===0,'missing slot counts → empty, never throws');

  console.log('\n=== TEST 6: scoring, including per-position overrides ===');
  const sc=app.espnScoringToSleeper(LEAGUE.settings.scoringSettings.scoringItems);
  // The real fixture is a half-PPR league with a TE premium expressed ONLY as overrides:
  // points:0 with {QB:.5,RB:.5,WR:.5,TE:1}. Reading `points` alone would call it Standard.
  chk(sc.rec===0.5,'receptions read from the non-TE override, not the zeroed base');
  chk(sc.bonus_rec_te===0.5,'TE premium becomes bonus_rec_te (TE override minus base)');
  chk(sc.pass_td===4,'pass TD carries through');
  chk(sc.pass_int===-2,'interception carries through (negative)');
  chk(sc.pass_yd===0.04,'passing yards stay points-per-yard for applySleeperScoring to invert');
  chk(sc.rush_yd===0.1,'rushing yards stay points-per-yard');
  chk(sc.rec_td===6,'receiving TD read from overrides when the base is 0');
  chk(sc.fum_lost===-2,'fumbles lost carries through');
  // A plain full-PPR league with no overrides must not gain a phantom TE bonus.
  const plain=app.espnScoringToSleeper([{statId:53,points:1}]);
  chk(plain.rec===1 && plain.bonus_rec_te===undefined,'no overrides → rec 1.0, no TE bonus invented');
  const teOnly=app.espnScoringToSleeper([{statId:53,points:1,pointsOverrides:{'3':1,'4':1.5}}]);
  chk(teOnly.rec===1 && teOnly.bonus_rec_te===0.5,'1.5-PPR TE reads as rec 1 + 0.5 bonus');
  chk(app.espnScoringToSleeper([]).rec===0,'empty scoring items → every mapped stat is an explicit 0');

  console.log('\n=== TEST 6b: an omitted stat means ZERO, not "keep the old value" ===');
  // ESPN ships no scoringItem at all for a stat the league doesn't score. Real case: league
  // 730841 is touchdown-only + PPR and sends no pass_yd/rush_yd/rec_yd. Leaving those absent
  // would inherit whatever the previously-linked league used.
  const tdOnly=app.espnScoringToSleeper([{statId:4,points:6},{statId:25,points:6},
                                         {statId:43,points:6},{statId:53,points:1}]);
  chk(tdOnly.pass_yd===0,'omitted passing yards → explicit 0');
  chk(tdOnly.rush_yd===0 && tdOnly.rec_yd===0,'omitted rushing/receiving yards → explicit 0');
  chk(tdOnly.fum_lost===0,'omitted fumble scoring → explicit 0');
  chk(tdOnly.rec===1 && tdOnly.pass_td===6,'stats that ARE scored keep their real values');

  console.log('\n=== TEST 7: keeper vs redraft ===');
  chk(app.espnLeagueType(LEAGUE.settings)===1,'keeperCount > 0 → Sleeper league type 1 (keeper)');
  chk(app.espnLeagueType({draftSettings:{keeperCount:0,keeperCountFuture:0}})===0,'no keepers → redraft');
  chk(app.espnLeagueType({})===0,'missing draftSettings → redraft, never throws');

  console.log('\n=== TEST 8: snapshot assembly + player resolution ===');
  await app.loadSleeperPlayers(true);
  // The fixture is a real 2025 payload. The snapshot's season comes from ESPN's OWN seasonId
  // rather than the season we asked for, so the two can never silently disagree.
  const built=await app.espnBuildSnapshot('1241838','2025',{myTeamId:1});
  const s=built.snapshot;
  chk(s.provider==='espn','snapshot is tagged with its provider');
  chk(s.leagueId==='1241838' && s.season==='2025','league id + season on the snapshot');
  chk(s.name==='The Keeper League','league name carried through');
  chk(s.teamList.length===2,'both teams present');
  chk(s.tep===true,'TE-premium detected from the translated scoring');
  chk(s.superflex===false,'not a superflex league');
  chk(s.leagueType===1,'keeper league type on the snapshot');

  const t1=s.teamList[0];
  chk(t1.teamName==='Team Binish','team name from ESPN');
  chk(t1.owner==='justlikepudge','owner handle resolved via members[] displayName');
  chk(t1.wins===7 && t1.losses===7,'record read from record.overall');
  chk(Array.isArray(t1.picks) && t1.picks.length===0,'no pick capital on an ESPN snapshot (documented limitation)');

  // The resolution bridge: espn_id first, normalised name second.
  const evans=t1.players.find(p=>/Evans/.test(p.name));
  chk(evans && !/^espn:/.test(evans.id),'Mike Evans resolved (has an espn_id in Sleeper)');
  const btj=t1.players.find(p=>/Thomas/.test(p.name));
  chk(btj && !/^espn:/.test(btj.id),'Brian Thomas Jr. resolved by NAME (no espn_id in Sleeper)');
  chk(btj && btj.name==='Brian Thomas','resolved player takes the SLEEPER name, not ESPN’s');
  const achane=t1.players.find(p=>/Achane/.test(p.name));
  chk(achane && !/^espn:/.test(achane.id),'De’Von Achane resolved (apostrophe normalised away)');
  const kw=s.teamList[1].players.find(p=>/Walker/.test(p.name));
  chk(kw && !/^espn:/.test(kw.id),'Kenneth Walker III resolved (numeral suffix stripped)');
  const gain=s.teamList[1].players.find(p=>/Gainwell/.test(p.name));
  chk(gain && !/^espn:/.test(gain.id),'Kenneth Gainwell resolved via the nickname alias table');
  chk(gain && gain.name==='Kenny Gainwell','alias hit returns the Sleeper spelling');

  const def=t1.players.find(p=>p.pos==='DEF');
  chk(def && def.id==='HOU','team defense resolved from proTeamId to the Sleeper team-code id');
  chk(def && def.isDef===true,'defense flagged as such');

  chk(built.unresolved.length===0,'every fixture player resolved — none left unmatched');
  const allResolved=s.teamList.every(t=>t.players.every(p=>!p.unresolved));
  chk(allResolved,'no roster entry carries the unresolved flag');

  console.log('\n=== TEST 9: unresolved players stay visible ===');
  const ghost=app.espnResolvePlayer({id:999999999,fullName:'Nonexistent Person',defaultPositionId:3});
  chk(ghost===null,'an unknown player resolves to null rather than a wrong match');

  console.log('\n=== TEST 10: my team is identified by OWNER id ===');
  // Every view compares t.ownerId to snapshot.myUserId, so the teamId from the fan lookup
  // has to be translated into that league's owner id or the wrong roster gets starred.
  chk(s.myUserId===t1.ownerId,'myTeamId 1 resolved to team 1’s ownerId');
  const noMine=await app.espnBuildSnapshot('1241838','2025',{});
  chk(noMine.snapshot.myUserId===null,'no hint → myUserId stays null (nothing wrongly starred)');
  const bySwid=await app.espnBuildSnapshot('1241838','2025',{mySwid:t1.ownerId});
  chk(bySwid.snapshot.myUserId===t1.ownerId,'a known SWID matches its own team directly');

  console.log('\n=== TEST 11: private-league error is explained, not raw ===');
  chk(/private/i.test(app.laEspnErrorText(new Error('ESPN 401'))),'401 → names the private-league cause');
  chk(/public/i.test(app.laEspnErrorText(new Error('ESPN 401'))),'401 → names the setting to change');
  chk(/No ESPN league/i.test(app.laEspnErrorText(new Error('ESPN 404'))),'404 → says the league wasn’t found');
  chk(/timed out/.test(app.laEspnErrorText(new Error('request timed out'))),'other errors pass their message through');

  console.log('\n=== TEST 12: end-to-end sync adopts the league’s rules ===');
  leagueStatus=200;
  await app.laTakeSnapshot('espn:1241838:2026',{myTeamId:1});
  const live=app.getSnapshot();
  chk(live && live.provider==='espn','laTakeSnapshot dispatched to the ESPN adapter');
  chk(live && live.name==='The Keeper League','snapshot landed on the global');
  const sset=app.getScoring();
  chk(sset.receptions===0.5,'league scoring applied globally: half PPR');
  chk(sset.receptions_te_bonus===0.5,'league scoring applied globally: TE premium');
  chk(sset.passing_yards_yardage===25,'points-per-yard inverted to 25 yards/point');
  chk(sset.rushing_yards_yardage===10,'rushing inverted to 10 yards/point');

  console.log('\n=== TEST 12b: a zero-yardage league scores zero for yards ===');
  // "Yards per point" cannot express "no points for yards" — there is no divisor that yields
  // zero — so the model's separate *_yards_points multiplier carries it. Verified through
  // calcFpts, the real scoring engine, not just the settings object.
  const LINE={pos:'WR',passing_yards:0,passing_tds:0,interceptions_thrown:0,passing_attempts:0,
    passing_completions:0,receiving_yards:100,receiving_tds:1,receptions:8,
    rushing_yards:0,rushing_tds:0,rushing_attempts:0,fumbles_lost:0};
  const normalPts=app.calcFpts(LINE);
  chk(Math.abs(normalPts-20)<0.001,'half-PPR TEP league: 100yd + TD + 8 rec = 20.0 pts');
  const SAVED=JSON.parse(JSON.stringify(LEAGUE.settings.scoringSettings.scoringItems));
  LEAGUE.settings.scoringSettings.scoringItems=[{statId:4,points:6},{statId:25,points:6},
                                                {statId:43,points:6},{statId:53,points:1}];
  await app.laTakeSnapshot('espn:1241838:2025');
  chk(app.getScoring().receiving_yards_points===0,'no rec-yard scoring → receiving_yards_points zeroed');
  const tdPts=app.calcFpts(LINE);
  chk(Math.abs(tdPts-14)<0.001,'TD-only + full PPR: 0 + 6 + 8 = 14.0 pts (yards contribute nothing)');
  LEAGUE.settings.scoringSettings.scoringItems=SAVED;
  await app.laTakeSnapshot('espn:1241838:2025');
  chk(app.getScoring().receiving_yards_points===1,'switching back RESTORES yardage scoring');
  chk(Math.abs(app.calcFpts(LINE)-20)<0.001,'and the same line scores 20.0 again');

  console.log('\n=== TEST 13: a private league degrades safely ===');
  leagueStatus=401;
  await app.laTakeSnapshot('espn:9999999:2026');
  chk(/private/i.test(app.getLaState().error||''),'401 surfaces the private-league explanation in the UI');
  chk(app.getSnapshot() && app.getSnapshot().leagueId==='1241838','the previous good snapshot is left intact');
  leagueStatus=200;

  console.log('\n=== TEST 14: unreadable leagues are labelled up front, not on click ===');
  // The fan profile lists leagues we have no access to (verified against a live account), so
  // an unchecked list can hand someone a button that only fails when tapped.
  leagueStatus=200;
  const probe=[{leagueId:'1241838',season:'2025'},{leagueId:'BADLEAGUE',season:'2025'}];
  await app.espnMarkReadable(probe);
  chk(probe[0].readable===true,'a readable league is marked readable');
  chk(probe[1].readable===false,'an unreadable one is marked, not dropped');

  console.log('\n=== TEST 15: the whole onboarding walk, no SWID typed ===');
  LSTORE.clear();
  app.getLaState().provider='espn';
  document.getElementById('laEspnLeague').value='https://fantasy.espn.com/football/league?leagueId=1241838&seasonId=2025';
  await app.laSubmitEspnLeague();
  let st=app.getLaState();
  chk(st.step==='espn-who','pasting a league link asks which manager you are');
  chk(st.espnMembers.length===2,'the league\u2019s managers are offered');
  chk(st.espnLeague && st.espnLeague.name==='The Keeper League','the league is named on that screen');
  const meIdx=st.espnMembers.findIndex(m=>m.name==='justlikepudge');
  await app.laEspnPickMember(meIdx);
  st=app.getLaState();
  chk(st.step==='pick','tapping your name moves on to the league list');
  chk(st.leagues.length===2,'the account\u2019s other leagues were discovered from one league link');
  chk(st.leagues.some(l=>String(l.leagueId)==='23007934'),'including a league we were never told about');
  const stored=JSON.parse(LSTORE.get('triplecrown.espn.v1')||'{}');
  chk(stored.swid==='{3A2C2DB2-7702-429A-8C0E-BC6C84DAA2EF}','the account id is remembered so this never repeats');
  chk(stored.username==='justlikepudge','remembered under the name they picked');

  console.log('\n=== TEST 16: a return visit skips identification entirely ===');
  app.getLaState().step='start'; app.getLaState().leagues=[];
  const startHtml=app.laSetupStartHTML();
  chk(!/SWID/i.test(startHtml),'the setup screen never mentions SWID to the user');
  chk(/Show my ESPN leagues/.test(startHtml),'a known account gets a one-tap league list');
  await app.laEspnRefreshLeagues();
  chk(app.getLaState().step==='pick','and it goes straight to the league list');
  chk(app.getLaState().leagues.length===2,'with the same leagues');

  console.log(`\nRESULT: ${pass===total?'PASS':'FAIL'} (${pass}/${total} checks)`);
  process.exit(pass===total?0:1);
})();
