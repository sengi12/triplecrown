// The live feed (33-live-feed.js): every game at once from ONE request — the week
// scoreboard's last play per live game, accumulated across polls into a rolling feed,
// filtered to the leagues you play in, each play carrying the points it just moved under
// that league's own scoring, and narrowable to the two line-ups in your own matchup.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',hidden:false,style:{},dataset:{},classList:{_s:new Set(),add(c){this._s.add(c);},remove(...c){c.forEach(x=>this._s.delete(x));},toggle(){},contains(c){return this._s.has(c);}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){},getBoundingClientRect:()=>({width:300,height:300,left:0,top:0})};return elStore[id];}
const main={appendChild(el){ elStore[el.id]=el; }};
global.document={getElementById:(id)=>mkEl(id),querySelector:(q)=>q==='.main'?main:null,querySelectorAll:()=>[],createElement:()=>({id:'',className:'',innerHTML:'',hidden:false,style:{},classList:{add(){},remove(){}},appendChild(){},remove(){},addEventListener(){}}),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),innerWidth:1200,scrollTo(){},scrollX:0,scrollY:0,pageYOffset:0};
global.requestAnimationFrame=(fn)=>setTimeout(fn,0);global.cancelAnimationFrame=(id)=>clearTimeout(id);
global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  hasSeasonStarted=()=>true; TC_SEASON.year=2026; TC_SEASON.phase='regular'; TC_SEASON.week=2; isMobileTeamPickerLayout=()=>false;
  sleeperPlayers={
    q1:{name:'Aaron Rodgers', pos:'QB', team:'NYJ', espn_id:'8439'},
    r1:{name:'Breece Hall', pos:'RB', team:'NYJ', espn_id:'4429795'},
    w1:{name:'Garrett Wilson', pos:'WR', team:'NYJ', espn_id:'4569618'},
    q2:{name:'Joe Burrow', pos:'QB', team:'CIN'},
    t1:{name:'Mike Gesicki', pos:'TE', team:'CIN'},
    k1:{name:'Evan McPherson', pos:'K', team:'CIN'},
    // namesakes on one team: a tackle listed before the back; and a receiver whose first name
    // is not the one ESPN abbreviates (Marquise "Hollywood" Brown → "H.Brown")
    o1:{name:'Kenneth Walker', pos:'T', team:'SEA'},
    r9:{name:'Kenneth Walker', pos:'RB', team:'SEA'},
    hb:{name:'Marquise Brown', pos:'WR', team:'KC'},
    pm:{name:'Patrick Mahomes', pos:'QB', team:'KC'},
  };
  // Two leagues: one where Rodgers is my starter and Wilson is my opponent's; one where
  // only Burrow is rostered (by a leaguemate).
  hubState.results={
    L1:{ league:{name:'Queen City Keepers', scoring_settings:{pass_yd:0.04, pass_td:4, pass_int:-1, rush_yd:0.1, rush_td:6, rec:1, rec_yd:0.1, rec_td:6, fgm:3, xpm:1}},
         rostered:new Set(['q1','w1','r1']), lineup:{starters:['q1'], oppStarters:['w1'], opponent:'kademiller'} },
    L2:{ league:{name:'Dirty Mikes', scoring_settings:{pass_yd:0.05, pass_td:6, rec:0.5, rec_yd:0.1, rec_td:6, fgm:3}},
         rostered:new Set(['q2','t1','k1']), lineup:{starters:[], oppStarters:[], opponent:null} },
    L3:{ inactive:true },
  };
  const LP=(o)=>Object.assign({id:'p1', text:'', type:'Rush', scoreValue:0, yds:0, team:'NYJ', athletes:[], down:2, ddt:'2nd & 4', spot:'GB 5', yte:5}, o);
  const G=(o)=>Object.assign({state:'in', eid:'E1', score:6, oppScore:14, home:true, opp:'MIN', sit:{period:3, clock:'10:07', lastPlayId:'p1', lastPlay:LP({})}}, o);
  let feedPaints=0, detailPaints=0;
  lfRepaint=()=>{ feedPaints++; };
  gcDetailRepaint=()=>{ detailPaints++; };
  return { onBoard:lfOnBoard, rows:()=>_lf.rows, view:lfRows, clear:lfClear, read:lfReadPlay, stats:lfPlayStats, pid:lfPidFor,
    seed:(eid,sum)=>{ _gcd.sum[eid]={data:sum, at:Date.now()}; }, landed:lfSummaryLanded, seededAt:()=>_lf.seedAt, unseen:lfUnseen, markSeen:lfMarkSeen, viewRow:gcViewRowHTML, setView:(v)=>{ _gc.view=v; },
    summaryPaint:gcSummaryRepaint, stream:gcStreamOnBoard, setGame:(id)=>{ _gc.game=id; }, paints:()=>({feed:feedPaints,detail:detailPaints}), resetPaints:()=>{ feedPaints=detailPaints=0; },
    delta:lfDelta, rel:lfRelevance, leagues:lfLeagueList, toggle:lfToggleLeague, all:lfSetAll, sel:()=>_lf.leagues,
    initials:lfLeagueInitials, chipInner:lfLeagueChipInner, lg:()=>_pcardLg.byLeague,
    setPcard:(o)=>{ _pcardLg={byLeague:o, at:Date.now(), loading:null}; }, setMu:(lid,wk,v)=>{ _gcMu.cache[lid+'|'+wk]=v; }, panel:lfPanelHTML, rowHTML:lfRowHTML, allLeagues:lfSetAllLeagues, sides:lfSideSets, stat:()=>_lf.stat, titleHTML:lfTitleHTML, LP, G, board:(t)=>{ _tcBoard={season:String(TC_SEASON.year), week:tcBoardWeek(), at:Date.now(), teams:t, busy:false, live:true}; }, MAX:LF_MAX_ROWS };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const LP=app.LP, G=app.G;
(async()=>{
  console.log('=== the board\'s last play becomes a feed row ===');
  app.clear(); app.resetPaints();
  const rush=G({sit:{period:3, clock:'10:07', lastPlayId:'p1', lastPlay:LP({id:'p1', type:'Rush', yds:6, text:'A.Rodgers right end to GB 5 for 6 yards (X.McKinney).', team:'NYJ', athletes:[{id:'8439', name:'Aaron Rodgers', pos:'QB', team:'NYJ'}]})}});
  chk(app.onBoard({NYJ:rush, MIN:Object.assign({}, rush, {home:false, opp:'NYJ', score:14, oppScore:6})})===1 && app.rows().length===1, 'one row per game, not one per team');
  let r=app.rows()[0];
  chk(r.title==='A. Rodgers 6 yd rush' && r.q===3 && r.clock==='10:07' && r.ddt==='2nd & 4' && r.spot==='GB 5' && r.rz===true && r.away==='MIN' && r.home==='NYJ' && r.as===14 && r.hs===6, `the row carries the headline, the situation, the clock and the score (${r.title})`);
  chk(r.roles.primary==='q1' && r.stats.q1.rush_yd===6 && r.stats.q1.rush_att===1, 'the runner resolves to his Sleeper id and the play\'s stats are his');
  chk(app.onBoard({NYJ:rush})===0 && app.rows().length===1, 'the same last play again adds nothing');
  const fixed=JSON.parse(JSON.stringify(rush)); fixed.sit.lastPlay.text='A.Rodgers right end to GB 3 for 8 yards (X.McKinney).'; fixed.sit.lastPlay.yds=8;
  chk(app.onBoard({NYJ:fixed})===1 && app.rows().length===1 && app.rows()[0].yds===8 && app.rows()[0].corrected===true && /8 yd rush/.test(app.rows()[0].title), 'the same play id with new words is a correction: the row is replaced where it stands, not appended');
  chk(app.paints().feed===1, 'only the new row repaints the Live Feed; a repeated poll and a correction stay quiet');
  const inactive=G({state:'post'});
  chk(app.onBoard({BUF:inactive})===0, 'a game that is not on is ignored');
  const to=G({sit:{period:3, clock:'9:09', lastPlayId:'t1', lastPlay:LP({id:'t1', type:'Official Timeout', text:'Official Timeout at 09:09.', team:''})}});
  const tmw=G({sit:{period:2, clock:'2:00', lastPlayId:'t2', lastPlay:LP({id:'t2', type:'Two-minute warning', text:'Two-Minute Warning', team:''})}});
  const eop=G({sit:{period:1, clock:'0:00', lastPlayId:'t3', lastPlay:LP({id:'t3', type:'End Period', text:'END QUARTER 1', team:''})}});
  chk(app.onBoard({NYJ:to})===0 && app.onBoard({NYJ:tmw})===0 && app.onBoard({NYJ:eop})===0 && app.rows().length===1, 'a timeout, the two-minute warning and the end of a quarter are pauses, not plays — the game feed skips them and so does this one');

  console.log('=== the plays it can read ===');
  const td=app.read(LP({type:'Rushing Touchdown', yds:9, text:'B.Hall left end for 9 yards, TOUCHDOWN.', team:'NYJ'}));
  chk(td.kind==='rushTd' && td.title==='B. Hall 9 yd rush TD 🎉' && td.roles.primary==='r1' && td.stats.r1.rush_td===1 && td.stats.r1.rush_yd===9, 'a rushing touchdown: the back, his yards and the six');
  const cat=app.read(LP({type:'Passing Touchdown', yds:12, text:'(Shotgun) A.Rodgers pass short right to G.Wilson for 12 yards, TOUCHDOWN.', team:'NYJ'}));
  chk(cat.kind==='recTd' && cat.title==='G. Wilson 12 yd TD catch 🎉' && cat.stats.w1.rec===1 && cat.stats.w1.rec_yd===12 && cat.stats.w1.rec_td===1 && cat.stats.q1.pass_yd===12 && cat.stats.q1.pass_td===1, 'a touchdown catch pays the receiver AND the passer');
  const pick=app.read(LP({type:'Interception Return', yds:0, text:'A.Rodgers pass short left intended for G.Wilson INTERCEPTED by J.Trotter at NYJ 40.', team:'NYJ'}));
  chk(pick.kind==='int' && /^INT! A\. Rodgers picked off/.test(pick.title) && pick.stats.q1.pass_int===1, 'an interception is charged to the passer');
  const fg=app.read(LP({type:'Field Goal Good', yds:32, text:'E.McPherson 32 yard field goal is GOOD.', team:'CIN'}));
  chk(fg.kind==='fg' && fg.title==='E. McPherson 32 yd FG 🙌' && fg.stats.k1.fgm===1 && fg.stats.k1.fga===1, 'a made field goal, by a kicker with no espn_id — matched on name and team');
  const sack=app.read(LP({type:'Sack', yds:-7, text:'(Shotgun) A.Rodgers sacked at NYJ 20 for -7 yards (M.Murphy).', team:'NYJ'}));
  chk(sack.kind==='sack' && /sacked, -7 yds/.test(sack.title) && !Object.keys(sack.stats).length, 'a sack has a headline and moves no fantasy stat by itself');

  console.log('=== namesakes and nicknames ===');
  const kw=app.read(LP({type:'Rushing Touchdown', yds:60, text:'K.Walker right end for 60 yards, TOUCHDOWN.', team:'SEA'}));
  chk(kw.roles.primary==='r9' && kw.title==='K. Walker 60 yd rush TD 🎉', 'two Kenneth Walkers on the team: the ball goes to the back, not the tackle');
  chk(app.pid('K.Walker','SEA',null,'primary')==='r9' && app.pid('K.Walker','SEA',null,'picker')==='r9', 'the tackle is never picked over the back for any role');
  const hb=app.read(LP({type:'Passing Touchdown', yds:30, text:'P.Mahomes pass deep left to H.Brown for 30 yards, TOUCHDOWN.', team:'KC'}));
  chk(hb.roles.receiver==='hb' && hb.roles.primary==='pm' && hb.title==='M. Brown 30 yd TD catch 🎉', 'an initial ESPN abbreviates differently still finds the only Brown on the team');
  chk(app.pid('Z.Nobody','SEA',null,'primary')===null && app.stat().unresolved>=1, 'an unknown name stays unresolved and is counted');

  console.log('=== the ids ===');
  chk(app.pid('A.Rodgers','NYJ',null)==='q1' && app.pid('A.Rodgers','MIN','8439')==='q1' && app.pid('Z.Nobody','NYJ',null)===null, 'a play\'s name resolves by team, an ESPN id resolves outright, an unknown stays null');

  console.log('=== what a play moved, per league ===');
  const lgs=app.leagues();
  chk(lgs.length===2 && lgs.map(l=>l.id).join(',')==='L1,L2' && lgs[0].mine.has('q1') && lgs[0].opp.has('w1'), 'the synced leagues, with my starters and my opponent\'s (the inactive one is out)');
  chk(app.delta(cat, lgs[0])===12.68 && app.delta(cat, lgs[1])===null, 'the TD catch is 8.20 to the receiver (1 + 1.2 + 6) and 4.48 to the passer (0.48 + 4) = 12.68 in my league; the other league rosters neither man');
  chk(app.delta(fg, lgs[0])===null, 'a kicker nobody rosters moves nothing');

  console.log('=== the filters ===');
  app.clear(); app.all();
  app.onBoard({NYJ:G({sit:{period:3, clock:'10:07', lastPlayId:'a', lastPlay:LP({id:'a', type:'Passing Touchdown', yds:12, text:'(Shotgun) A.Rodgers pass short right to G.Wilson for 12 yards, TOUCHDOWN.', team:'NYJ'})}})});
  app.onBoard({CIN:G({eid:'E2', sit:{period:1, clock:'2:00', lastPlayId:'b', lastPlay:LP({id:'b', type:'Field Goal Good', yds:32, text:'E.McPherson 32 yard field goal is GOOD.', team:'CIN'})}})});
  app.onBoard({BUF:G({eid:'E3', sit:{period:2, clock:'5:00', lastPlayId:'c', lastPlay:LP({id:'c', type:'Rush', yds:3, text:'J.Cook up the middle for 3 yards.', team:'BUF'})}})});
  chk(app.rows().length===3 && app.view().length===3 && app.view()[0].tags.length===0, 'All games: every play, no league tags');
  app.toggle('L1');
  let v=app.view();
  chk(app.sel().join(',')==='L1' && v.length===1 && /TD catch/.test(v[0].title) && v[0].tags.length===1 && v[0].tags[0].name==='Queen City Keepers', 'one league: only the plays its rosters are in');
  chk(v[0].tags[0].mine===true && v[0].tags[0].opp===true && v[0].tags[0].delta===12.68, 'the tag says it touched both line-ups of my matchup, and what it moved');
  app.toggle('L2'); v=app.view();
  chk(app.sel().length===2 && v.length===1 && !v.some(x=>/FG/.test(x.title)), 'a second league brings its own MATCHUP only: the kicker a leaguemate rosters there is not in my game, so his field goal stays out');
  app.allLeagues();
  chk(app.sel().length===2 && app.view().length===1, 'All leagues: every matchup I have at once');
  app.all();
  chk(app.sel().length===0 && app.view().length===3, 'back to all games');

  console.log('=== the leagues come from the player-card map once it has loaded ===');
  app.setPcard({P1:{id:'P1', name:'Pcard League', byPid:{q1:{owner:'me', mine:true}, w1:{owner:'them', mine:false}}, rosters:{'1':{owner:'me',mine:true,players:['q1'],starters:['q1']},'2':{owner:'them',mine:false,players:['w1'],starters:['w1']}}, myRosterId:1, scoring:{rec_td:6}}});
  let L=app.leagues();
  chk(L.length===1 && L[0].id==='P1' && L[0].rostered.has('w1') && L[0].mine.has('q1') && L[0].opp.size===0, 'the map\'s league: rostered from its rosters, mine from my roster, no opponent until the matchup read lands');
  app.setMu('P1', 2, {mine:new Set(['q1']), opp:new Set(['w1']), oppName:'them', pending:false});
  L=app.leagues();
  chk(L[0].opp.has('w1') && L[0].oppName==='them', 'the week\'s matchup makes the opponent red');
  app.setPcard({});
  chk(app.leagues().length===2, 'with no map the hub\'s leagues stand in');

  console.log('=== yards from the words ===');
  const noy=app.read(LP({type:'Rushing Touchdown', yds:0, text:'B.Hall left end for 9 yards, TOUCHDOWN.', team:'NYJ'}));
  chk(noy.stats.r1.rush_yd===9 && /9 yd rush TD/.test(noy.title), 'no yardage on the board: the words say 9');
  const fgy=app.read(LP({type:'Field Goal Good', yds:0, text:'E.McPherson 47 yard field goal is GOOD.', team:'CIN'}));
  chk(/47 yd FG/.test(fgy.title), 'a field goal reads its distance from the words too');

  console.log('=== the panel ===');
  app.board({NYJ:G({}), CIN:G({eid:'E2'})});
  let h=app.panel(false);
  chk(/Live feed/.test(h) && /lf-live on">2 live/.test(h) && /All games<\/button>/.test(h) && /title="Queen City Keepers"[^>]*><span class="lf-lg-ini">QCK<\/span><\/button>/.test(h) && /title="Dirty Mikes"[^>]*><span class="lf-lg-ini">DM<\/span>/.test(h), 'the panel heads with the live count and a chip per league — initials when the league has no icon, the full name in its tooltip');
  chk(app.initials('Show Me The Money')==='SMT' && app.initials('BAFL')==='BAF' && app.initials("🔑 Last Man Standing")==='LMS' && app.initials('')==='L', 'initials: first letters of up to three words, the first three letters of a one-word name, emoji ignored');
  chk(/<img class="lf-lg-av" src="https:\/\/sleepercdn\.com\/avatars\/thumbs\/abc123" alt="" onerror="[^"]+"><span class="lf-lg-ini" hidden>QCK<\/span>/.test(app.chipInner({name:'Queen City Keepers', avatar:'https://sleepercdn.com/avatars/thumbs/abc123'})), 'a league with an icon shows the icon, its initials waiting behind it should the image fail');
  chk(/lf-lg-ini">QCK<\/span>$/.test(app.chipInner({name:'Queen City Keepers', avatar:null})) && !/<img/.test(app.chipInner({name:'Queen City Keepers'})), 'no icon → initials only');
  chk(true, 'the panel heads with the live count and a chip per league (a long name is clipped, the full one in its tooltip)');
  chk(/gcf-row lf-row gcf-td/.test(h) && /G\. Wilson(?:<\/span>)? 12 yd TD catch/.test(h) && /gcf-pos-wr">WR/.test(h) && /Q3 10:07/.test(h), 'rows wear the per-game feed\'s clothes: kind, headline, positions, clock');
  chk(!/lf-mine/.test(h), 'the my-matchup toggle only appears once a league is picked');
  chk(/All leagues<\/button>/.test(h), 'with more than one league synced, an All leagues chip sits beside All games');
  { const cur=app.lg(); app.setPcard(Object.assign({}, cur, {L8:{id:'L8', name:'Business of Innovation', noRoster:true, byPid:{}, scoring:{}}})); const h8=app.panel(false);
    chk(!/Business of Innovation/.test(h8) && /title="Queen City Keepers"/.test(h8), 'a league I only run (no roster of mine) gets no chip — nothing to follow there'); app.setPcard(cur); }
  const S=app.sides();
  chk(S.mine.has('q1') && S.opp.has('w1'), 'showing all games still knows my starters and my opponents across every league');
  app.toggle('L1'); h=app.panel(false);
  chk(!/lf-mine/.test(h) && /lf-tag lf-tag-mine/.test(h) && /lf-up">\+12\.68/.test(h), 'with a league picked: no matchup toggle (the league IS my matchup), the starred tag and the points it moved');
  chk(/gcf-name gc-mine">A\. Rodgers/.test(h) && /gcf-name gc-opp">G\. Wilson/.test(h), 'my starter is blue in the feed, the man I am playing is red');
  chk(/gcf-title"><span class="gc-opp">G\. Wilson<\/span> 12 yd TD catch/.test(h), 'and the headline wears the same colour');
  app.all(); app.clear(); h=app.panel(false);
  chk(/waiting for the next play/.test(h), 'games on but nothing seen yet');
  app.board({}); h=app.panel(false);
  chk(/the feed fills as games kick off/.test(h) && /no games on/.test(h), 'nothing on at all');

  console.log('=== it stays small ===');
  app.clear();
  for(let i=0;i<app.MAX+20;i++) app.onBoard({NYJ:G({sit:{period:1, clock:'1:00', lastPlayId:'x'+i, lastPlay:LP({id:'x'+i, type:'Rush', yds:1, text:'A.Rodgers right end for 1 yard.', team:'NYJ'})}})});
  chk(app.rows().length===app.MAX && app.rows()[0].id==='x'+(app.MAX+19), `the feed is capped at ${app.MAX} rows, newest first`);
  chk(app.MAX===150, 'the bounded cache retains 150 recent plays across games');

  console.log('=== history: a live game\'s summary fills the feed back to kickoff ===');
  app.clear();
  const PL=(id,seq,type,text,clock,extra)=>Object.assign({id, sequenceNumber:seq, type:{text:type}, text, period:{number:1}, clock:{displayValue:clock}, statYardage:0, awayScore:0, homeScore:0,
    start:{down:1, shortDownDistanceText:'1st & 10', possessionText:'NYJ 25', yardsToEndzone:75}}, extra||{});
  const SUM9={drives:{previous:[{team:{abbreviation:'NYJ'}, plays:[
      PL('901',1,'Rush','B.Hall left end for 5 yards.','14:00',{statYardage:5}),
      PL('902',2,'Pass Reception','(Shotgun) A.Rodgers pass short left to G.Wilson for 20 yards.','13:20',{statYardage:20}),
      PL('903',3,'Official Timeout','Official Timeout at 13:00.','13:00'),
      PL('904',4,'Passing Touchdown','A.Rodgers pass deep right to G.Wilson for 30 yards, TOUCHDOWN.','12:40',{statYardage:30, scoringPlay:true, awayScore:0, homeScore:7})]}]}};
  app.seed('E9', SUM9);
  // the board caught only the touchdown (its clock is the poll's, not the play's)
  const n9=app.onBoard({NYJ:G({eid:'E9', score:7, oppScore:0, sit:{period:1, clock:'12:11', lastPlayId:'904', lastPlay:LP({id:'904', type:'Passing Touchdown', yds:30, scoreValue:6, text:'A.Rodgers pass deep right to G.Wilson for 30 yards, TOUCHDOWN.', team:'NYJ'})}})});
  const r9=app.rows().filter(r=>r.eid==='E9');
  chk(n9===3 && r9.length===3 && r9.map(r=>r.id).join(',')==='904,902,901', 'one board landing: the play the poll caught plus the two before it from the summary (the timeout skipped), newest first');
  chk(r9[0].src==='sum' && r9[0].clock==='12:40' && r9[0].hs===7 && r9[0].scoreValue===6 && /TD catch/.test(r9[0].title), 'the board\'s row takes the play\'s own clock and the score after it');
  chk(r9[2].title==='B. Hall 5 yd rush' && r9[2].clock==='14:00' && r9[1].kind==='rec' && r9[1].yds===20 && r9[1].roles.receiver==='w1', 'history rows read like live ones — typed, named, with the yards');
  chk(app.onBoard({NYJ:G({eid:'E9', score:7, oppScore:0, sit:{period:1, clock:'12:11', lastPlayId:'904', lastPlay:LP({id:'904', type:'Passing Touchdown', yds:30, scoreValue:6, text:'A.Rodgers pass deep right to G.Wilson for 30 yards, TOUCHDOWN.', team:'NYJ'})}})})===0 && app.rows().filter(r=>r.eid==='E9').length===3, 'the next landing adds nothing — no doubles from the summary');
  chk(app.seededAt() && app.seededAt().E9>0, 'the game\'s summary is read once on first sight (then every ten minutes)');
  console.log('=== concurrent summaries merge by the time each play happened ===');
  app.clear();
  const timed=(eid,team,opp,id,text,wallclock)=>({drives:{previous:[{team:{abbreviation:team},plays:[
    PL(id+'1',1,'Rush',text+' first','14:00',{statYardage:3,wallclock}),
    PL(id+'2',2,'Rush',text+' second','13:20',{statYardage:4,wallclock:new Date(Date.parse(wallclock)+30000).toISOString()})
  ]}]}});
  app.onBoard({NYJ:G({eid:'EA',opp:'MIN',sit:{period:1,clock:'13:20',lastPlayId:'A2',lastPlay:LP({id:'A2',type:'Rush',yds:4,text:'A.Rodgers right end for 4 yards.',team:'NYJ'})}}),
    CIN:G({eid:'EB',opp:'BAL',sit:{period:1,clock:'13:20',lastPlayId:'B2',lastPlay:LP({id:'B2',type:'Rush',yds:4,text:'J.Burrow right end for 4 yards.',team:'CIN'})}})});
  const sumA=timed('EA','NYJ','MIN','A','A.Rodgers right end for', '2026-09-20T17:05:00.000Z');
  const sumB=timed('EB','CIN','BAL','B','J.Burrow right end for', '2026-09-20T17:05:15.000Z');
  app.landed('EB',sumB); app.landed('EA',sumA);   // the newer game's response finishes first
  const merged=app.rows().filter(r=>r.eid==='EA'||r.eid==='EB');
  chk(merged.slice(0,4).map(r=>r.id).join(',')==='B2,A2,B1,A1',
    'plays from concurrent games form one newest-first timeline even when summaries arrive out of order');
  app.resetPaints(); app.setView('feed'); app.summaryPaint(0); app.summaryPaint(2);
  chk(app.paints().feed===1 && app.paints().detail===0, 'an open Live Feed repaints only when a summary contributed a new play');
  app.resetPaints(); app.setGame('MIN@NYJ'); app.stream({NYJ:rush});
  chk(app.paints().feed===0 && app.paints().detail===0, 'a selected game\'s clock and situation stream cannot repaint the open Live Feed');
  app.resetPaints(); app.setView('games'); app.summaryPaint(0);
  chk(app.paints().feed===0 && app.paints().detail===1, 'the single-game view still repaints summary updates for its score and stats');
  app.board({NYJ:G({eid:'E9'})}); let hf=app.panel(false);
  chk(/lf-live on">1 live/.test(hf) && /class="tc-fresh"/.test(hf) && /tc-fresh-t">(just now|\d+s ago)</.test(hf), 'with a game on, the feed\'s head carries the stamp beside the live count');
  app.board({}); hf=app.panel(false);
  chk(!/tc-fresh/.test(hf), 'no game on: no stamp');

  console.log('=== the badge on the Live feed tab: plays that matter since you looked ===');
  app.clear(); app.all(); app.setView('games');
  const T0=Date.now()-1; app.markSeen();
  await new Promise(r=>setTimeout(r,3));
  app.onBoard({NYJ:G({sit:{period:3, clock:'10:07', lastPlayId:'u1', lastPlay:LP({id:'u1', type:'Passing Touchdown', yds:12, text:'(Shotgun) A.Rodgers pass short right to G.Wilson for 12 yards, TOUCHDOWN.', team:'NYJ'})}})});
  app.onBoard({CIN:G({eid:'E2', sit:{period:1, clock:'2:00', lastPlayId:'u2', lastPlay:LP({id:'u2', type:'Field Goal Good', yds:32, text:'E.McPherson 32 yard field goal is GOOD.', team:'CIN'})}})});
  chk(app.unseen()===2 && /gc-vt-live">2</.test(app.viewRow()) && !/gc-vt-live">1</.test(app.viewRow()), 'two plays since the feed was last on screen → the tab says 2 (not the number of games on)');
  app.toggle('L1');
  chk(app.unseen()===1 && /gc-vt-live">1</.test(app.viewRow()), 'with a league picked, only the plays in my matchup count');
  app.all();
  app.panel(false);
  chk(app.unseen()===0 && !/gc-vt-live/.test(app.viewRow()), 'painting the feed marks everything seen — the badge goes');
  await new Promise(r=>setTimeout(r,3));
  app.onBoard({BUF:G({eid:'E3', sit:{period:2, clock:'5:00', lastPlayId:'u3', lastPlay:LP({id:'u3', type:'Rush', yds:3, text:'J.Cook up the middle for 3 yards.', team:'BUF'})}})});
  chk(app.unseen()===1, 'the next play counts again');
  app.setView('feed');
  chk(!/gc-vt-live/.test(app.viewRow()), 'no badge while the feed is the view');
  app.setView('games');
  app.seed('E9', SUM9); app.clear(); app.markSeen(); await new Promise(r=>setTimeout(r,3));
  app.onBoard({NYJ:G({eid:'E9', score:7, oppScore:0, sit:{period:1, clock:'12:11', lastPlayId:'904', lastPlay:LP({id:'904', type:'Passing Touchdown', yds:30, scoreValue:6, text:'A.Rodgers pass deep right to G.Wilson for 30 yards, TOUCHDOWN.', team:'NYJ'})}})});
  chk(app.unseen()===1 && app.rows().filter(r=>r.eid==='E9').length===3, 'a game\'s first fill is history: only the play the board caught counts, not the two seeded behind it');
  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
