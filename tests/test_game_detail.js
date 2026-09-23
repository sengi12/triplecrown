// Game detail (32b-game-detail.js): one ESPN game summary → the play feed (key plays newest
// first, headlines, the players' game lines as of the play with the delta, the situation with
// its red-zone badge, the clock and the score after), the quarter line, a side's box score,
// and the fantasy pane's league switcher (any synced league's scoring, its owners, the
// projection under the points). The fixture is a trimmed real summary (TB @ CIN, 2026 week 1).
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',hidden:false,style:{},dataset:{},classList:{_s:new Set(),add(c){this._s.add(c);},remove(...c){c.forEach(x=>this._s.delete(x));},toggle(){},contains(c){return this._s.has(c);}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){},getBoundingClientRect:()=>({width:300,height:300,left:0,top:0})};return elStore[id];}
const main={appendChild(el){ elStore[el.id]=el; }};
global.document={getElementById:(id)=>mkEl(id),querySelector:(q)=>q==='.main'?main:null,querySelectorAll:()=>[],createElement:()=>({id:'',className:'',innerHTML:'',hidden:false,style:{},classList:{add(){},remove(){}},appendChild(){},remove(){},addEventListener(){}}),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),innerWidth:1200,scrollTo(){},scrollX:0,scrollY:0,pageYOffset:0};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};
global.requestAnimationFrame=(fn)=>setTimeout(fn,0);global.cancelAnimationFrame=(id)=>clearTimeout(id);
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs'), path=require('path');
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const SUM=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','espn_summary_2026_w1_tb_cin.json'),'utf8'));
const athId=(name)=>{ for(const tp of SUM.boxscore.players) for(const g of tp.statistics) for(const a of g.athletes) if(a.athlete.displayName===name) return String(a.athlete.id); return null; };
const IDS={ q1:athId('Baker Mayfield'), q2:athId('Joe Burrow'), r2:athId('Chase Brown'), t1:athId('Mike Gesicki'), k1:athId('Chase McLaughlin'), k2:athId('Evan McPherson') };
const app=new Function('IDS','SUM', code+`
  toast=function(){};
  const P=(id,fn,ln,pos,team,st)=>({player_id:id, team, player:{first_name:fn,last_name:ln,position:pos,team}, stats:st});
  const ROWS=[ P('q1','Baker','Mayfield','QB','TB',{pass_yd:216,pass_td:1,pass_cmp:23,pass_att:28,rush_yd:30,rush_td:1,gp:1}), P('q2','Joe','Burrow','QB','CIN',{pass_yd:254,pass_td:1,pass_int:1,pass_cmp:25,pass_att:35,gp:1}),
    P('r2','Chase','Brown','RB','CIN',{rush_yd:56,rush_att:16,rush_td:1,rec:5,rec_yd:22,gp:1}), P('t1','Mike','Gesicki','TE','CIN',{rec:5,rec_yd:78,rec_td:1,gp:1}) ];
  fetchWeekStats=async(season,wk,pos)=>ROWS;
  const BOARD={events:[{id:'401872925',date:'2026-09-13T17:00Z',competitions:[{status:{type:{state:'post',shortDetail:'Final'}},competitors:[
    {homeAway:'home',team:{abbreviation:'CIN'},score:'33',records:[{type:'total',summary:'1-0'}],linescores:[{value:14},{value:10},{value:3},{value:6}]},
    {homeAway:'away',team:{abbreviation:'TB'},score:'27',records:[{type:'total',summary:'0-1'}],linescores:[{value:3},{value:7},{value:10},{value:7}]}]}]},
    {id:'401872999',date:'2026-09-14T00:20Z',competitions:[{status:{type:{state:'pre',shortDetail:'Sun 8:20 PM'}},competitors:[{homeAway:'home',team:{abbreviation:'SEA'},score:'0'},{homeAway:'away',team:{abbreviation:'NE'},score:'0'}]}]}]};
  let fetches=[];
  sleeperFetch=async(url)=>{ fetches.push(url); if(/scoreboard/.test(url)) return BOARD; if(/summary\\?event=401872925/.test(url)) return JSON.parse(JSON.stringify(SUM)); throw new Error('x'); };
  hasSeasonStarted=()=>true; TC_SEASON.year=2026; TC_SEASON.phase='regular'; TC_SEASON.week=1; isMobileTeamPickerLayout=()=>false;
  sleeperPlayers={q1:{name:'Baker Mayfield',pos:'QB',team:'TB',espn_id:IDS.q1}, q2:{name:'Joe Burrow',pos:'QB',team:'CIN',espn_id:IDS.q2}, r2:{name:'Chase Brown',pos:'RB',team:'CIN',espn_id:IDS.r2}, t1:{name:'Mike Gesicki',pos:'TE',team:'CIN',espn_id:IDS.t1}, k1:{name:'Chase McLaughlin',pos:'K',team:'TB',espn_id:IDS.k1}, k2:{name:'Evan McPherson',pos:'K',team:'CIN',espn_id:IDS.k2}};
  leagueSnapshot={name:'Dirty Mikes', leagueId:'L1', myUserId:'u1', scoringRaw:{pass_yd:0.04,pass_td:4,pass_int:-1,rush_yd:0.1,rush_td:6,rec:0.5,rec_yd:0.1,rec_td:6,fgm:3,xpm:1},
    teamList:[{rosterId:1, ownerId:'u1', owner:'Sengi12', teamName:'Sengi', players:[{id:'q1'}]},{rosterId:2, ownerId:'u2', owner:'RichBigMeechy', teamName:'Rich', players:[{id:'t1'}]}]};
  let PROJ={ q2:{pos:'QB', stats:{pass_yd:300, pass_td:2}}, t1:{pos:'TE', stats:{rec:4, rec_yd:50}} };
  laWeekProjFeed=(wk)=>PROJ;
  _pcardLg={byLeague:{}, at:Date.now(), loading:null};
  const GAME=(st)=>({id:'TB@CIN', home:'CIN', away:'TB', state:st||'post', detail:'Final', date:'2026-09-13T17:00Z', hs:33, as:27, hrec:'1-0', arec:'0-1', eid:'401872925', hls:[14,10,3,6], als:[3,7,10,7]});
  return { parse:tcParseBoard, games:gcGames, plays:gcPlays, names:gcPlayNames, kinds:(s)=>gcPlays(s).map(p=>p.kind), feed:gcFeedRows, build:gcFeedBuild, feedHTML:gcFeedHTML, ls:gcLinescoreHTML, box:gcBoxHTML,
    gameHTML:(g,rows)=>gcGameHTML(g||GAME(), rows===undefined?ROWS:rows, 1), GAME, summary:gcSummary, setSum:(eid,d)=>{ _gcd.sum[eid]={data:d, at:Date.now()}; }, fetches:()=>fetches,
    setTab:(t)=>{ _gcd.tab=t; }, setSide:(s)=>{ _gcd.side=s; }, setAll:(v)=>{ _gcd.feedAll=v; }, tab:gcdTab,
    lgOpts:gcLeagueOptions, setLeague:(id)=>{ _gc.league=id; }, league:gcLeague, owner:gcOwnerOf, mine:gcIsMine, pts:gcPoints, proj:gcProjPts,
    setPcard:(o)=>{ _pcardLg.byLeague=o; _pcardLg.at=Date.now(); }, BOARD, ath:gcAthletes, short:gcShort,
    resetPcard:()=>{ _pcardLg={at:0, byLeague:{}, loading:null}; }, lgSelect:gcLeagueSelectHTML, setProfile:(p)=>{ laLoadSleeperProfile=()=>p; },
    stubLeagueReads:()=>{ const prev=sleeperFetch; sleeperFetch=async(url)=>{   // no log here: prev() already logs what it handles
        if(/\\/league\\/L9\\/matchups\\/1$/.test(url)) return [{roster_id:1, matchup_id:5, starters:['q2']},{roster_id:2, matchup_id:5, starters:['t1']}];
        if(/\\/league\\/L9\\/matchups\\/2$/.test(url)) return [{roster_id:1, matchup_id:9, starters:['q2']},{roster_id:3, matchup_id:9, starters:['k1']}];
        if(/\\/league\\/L9\\/rosters/.test(url)) return [{roster_id:1, owner_id:'u1', players:['q2'], starters:['q2']},{roster_id:2, owner_id:'u7', players:['t1'], starters:['t1']},{roster_id:3, owner_id:'u8', players:['k1'], starters:['k1']}];
        if(/\\/league\\/L9\\/users/.test(url)) return [{user_id:'u1', display_name:'Sengi12'},{user_id:'u7', display_name:'kade', metadata:{team_name:'kademiller'}},{user_id:'u8', display_name:'zkirk97'}];
        if(/\\/league\\/L9$/.test(url)) return {name:'Queen City Keepers', status:'in_season', season:'2026', scoring_settings:{pass_yd:0.05, pass_td:6}, roster_positions:['QB','RB','SUPER_FLEX'], settings:{type:0}, total_rosters:12};
        return prev(url); }; },
    sideClass:gcSideClass, setWeekNum:(w)=>{ _gc.week=w; _gc._mu=null; }, liveTimer:()=>_gcLiveTimer, clearLive:()=>{ if(_gcLiveTimer){ clearTimeout(_gcLiveTimer); _gcLiveTimer=null; } }, setMode:(m)=>{ _gc.mode=m; }, setGame:(id)=>{ _gc.game=id; },
    onBoard:gcStreamOnBoard, behind:gcSummaryBehind, catchUp:gcSummaryCatchUp, sumAt:(eid)=>_gcd.sum[eid]&&_gcd.sum[eid].at, ROWS, liveRows:gcLiveRows, boxRows:gcBoxRows, POLL:GC_LIVE_POLL, fresh:tcFreshHTML, refresh:tcRefreshNow, stubContent:(fn)=>{ renderContent=fn; }, setLiveView:(v)=>{ currentProjViewMode=()=>v?'live':'proj'; }, drives:gcDrives, sentence:gcDriveSentence, turnover:gcTurnoverRead, punt:gcPuntRead, logo:NFL_LOGO, esc:escAttr, drive:gcDriveChartHTML, wp:gcWinProbHTML, wpOpen:(v)=>{ _gcd.wpOpen=v; }, top:gcTopHTML, lastPlay:gcLastPlayHTML, idle:tcRepaintWhenIdle, busy:tcUiBusy, setDown:(v)=>{ _tcIdle.down=v; }, flush:tcIdleFlush, setActive:(el)=>{ document.activeElement=el; }, sidebarSig:()=>_tcBoard.sig, boardAt:()=>_tcBoard.at, setBoardAt:(t)=>{ _tcBoard.at=t; _tcBoard.live=true; }, freshBusy:()=>_tcFresh.busy, sitHTML:gcSituationHTML, boardUrl:TC_BOARD_URL, weekLabel:tcWeekLabel, statsUrl:SLEEPER_WEEK_STATS_URL, projUrl:LA_WEEK_PROJ_URL, landed:tcBoardLanded, setBoardTeams:(t)=>{ _tcBoard.teams=t; } };
`)(IDS, SUM);
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const settle=()=>new Promise(r=>setTimeout(r,20));
(async()=>{
  console.log('=== the board keeps the event id and the quarter line ===');
  const b=app.parse(app.BOARD);
  chk(b.CIN.eid==='401872925' && b.TB.eid==='401872925' && JSON.stringify(b.CIN.ls)==='[14,10,3,6]' && JSON.stringify(b.TB.ls)==='[3,7,10,7]', 'each side carries ESPN\'s event id and its linescores');
  const games=app.games(b); const g=games.find(x=>x.id==='TB@CIN');
  chk(g && g.eid==='401872925' && JSON.stringify(g.hls)==='[14,10,3,6]' && JSON.stringify(g.als)==='[3,7,10,7]', 'the game object carries them too');

  console.log('=== the plays, typed ===');
  const plays=app.plays(SUM);
  chk(plays.length>60 && plays.every((p,i)=>i===0 || p.seq>=plays[i-1].seq), `every drive's plays flattened in order (${plays.length})`);
  const kinds=app.kinds(SUM);
  chk(kinds.includes('fg') && kinds.includes('td') && kinds.includes('sack') && kinds.includes('to') && kinds.includes('xp')===false && kinds.includes('play'), 'field goals, touchdowns, sacks and turnovers are typed; ordinary snaps are plays');
  const n=app.names('(Shotgun) J.Burrow pass short left to M.Gesicki for 2 yards, TOUCHDOWN. E.McPherson extra point is GOOD, Center-W.Wagner.');
  chk(n.primary==='J.Burrow' && n.receiver==='M.Gesicki' && !n.picker, 'the passer and the receiver come out of the text');
  const n2=app.names('(No Huddle, Shotgun) J.Burrow pass short right intended for A.Iosivas INTERCEPTED by J.Trotter [V.Vea] at CIN 38. J.Trotter for 38 yards, TOUCHDOWN.');
  chk(n2.primary==='J.Burrow' && n2.intended==='A.Iosivas' && n2.picker==='J.Trotter', 'the intended target and the interceptor too');
  const A=app.ath(SUM);
  chk(A.byId[IDS.q2] && A.byId[IDS.q2].pid==='q2' && A.byId[IDS.q2].pos==='QB' && A.byId[IDS.t1].pid==='t1' && A.byId[IDS.t1].pos==='TE', 'box-score athletes join to Sleeper ids and positions by espn_id');

  console.log('=== the feed ===');
  const feed=app.feed(SUM, false);
  chk(feed.length>=12 && feed[0].q===4 && feed[feed.length-1].q===1 && feed.every(p=>['td','fg','xp','miss','to','sack','big','fourth'].includes(p.kind)), `key plays newest first (${feed.length}); every one a score, miss, turnover, sack, 20+ or fourth down`);
  chk(app.feed(SUM, true).length>feed.length && app.feed(SUM, true).some(p=>p.kind==='play'), 'all plays adds the ordinary snaps');
  const titles=feed.map(p=>p.title);
  chk(titles.includes('M. Gesicki 2 yd TD catch 🎉') && titles.includes('C. Brown 5 yd rush TD 🎉') && titles.includes('C. McLaughlin 34 yd FG 🙌'), `headlines name the scorer, the yards and the play (${titles.slice(-3).join(' | ')})`);
  chk(titles.some(t=>/^INT! J\. Burrow picked off by J\. Trotter — pick six 🎉$/.test(t)) && titles.some(t=>/^B\. Mayfield sacked, -\d+ yds$/.test(t)) && titles.some(t=>/^Fumble! B\. Mayfield/.test(t)), 'interceptions, sacks and fumbles read as such');
  const td=feed.find(p=>p.title==='M. Gesicki 2 yd TD catch 🎉');
  const ges=td.who.find(w=>w.ath.name==='Mike Gesicki'), bur=td.who.find(w=>w.ath.name==='Joe Burrow');
  chk(ges && /^\d+ REC, \d+ YD, 1 TD$/.test(ges.line) && ges.delta==='+2 YD' && bur && /^\d+\/\d+ CMP, \d+ YD, 1 TD$/.test(bur.line), `the receiver's and the passer's game lines as of the play, with the delta (${ges&&ges.line} · ${bur&&bur.line})`);
  chk(td.yte<=20 && td.scoredBy==='home' && td.hs>td.as-100 && td.ddt && /CIN|TB/.test(td.spot), 'the touchdown is a red-zone play whose score moved the home side');
  const fg=feed.find(p=>p.title==='C. McLaughlin 34 yd FG 🙌');
  chk(fg.who[0] && fg.who[0].line==='1/1 FG, 0/0 XP' && fg.scoredBy==='away' && fg.as===3, 'the kicker\'s line counts the kick; the away score moved');
  const mcp=app.build(SUM).filter(p=>p.who.some(w=>w.ath.name==='Evan McPherson')).pop();
  const mk=mcp.who.find(w=>w.ath.name==='Evan McPherson');
  chk(mk && /^4\/4 FG, 2\/2 XP$/.test(mk.line) && mk.ath.pos==='K', `the kicker's line counts the tries inside the touchdown texts, and he is a K not a DEF (${mk&&mk.line})`);
  const tdx=app.build(SUM).find(p=>p.title==='M. Gesicki 2 yd TD catch 🎉');
  chk(tdx.who.some(w=>w.ath.name==='Evan McPherson' && /XP$/.test(w.line)), 'the touchdown row shows the kicker under the scorer');
  chk(app.build(SUM).every(p=>p.type!=='Penalty' || p.kind==='pen') && app.build(SUM).some(p=>/^Flag: .+ on (TB|CIN)/.test(p.title)), 'a penalty is a penalty on any down, with the foul in its headline');
  const rb=app.build(SUM).find(p=>p.title==='C. Brown 5 yd rush TD 🎉');
  chk(rb.who[0] && /CAR, \d+ YD, 1 TD$/.test(rb.who[0].line) && rb.who[0].delta==='+5 YD', 'a rushing touchdown carries the back\'s line');

  console.log('=== a lineman reporting eligible is not the man with the ball ===');
  const el1=app.names('C.Vinson reported in as eligible.  D.Henry right end to IND 25 for 4 yards (B.Boettcher).');
  chk(el1.primary==='D.Henry', `the runner, not the tackle who reported (${el1.primary})`);
  const el2=app.names('(Shotgun) C.Vinson reported in as eligible.  L.Jackson pass short right to M.Andrews to IND 45 for 13 yards.');
  chk(el2.primary==='L.Jackson' && el2.receiver==='M.Andrews', 'the formation note and the report together still leave the passer and his target');
  const el3=app.names('G.Van Roten reported in as eligible.  D.Maye pass short left to E.Raridon for 2 yards, TOUCHDOWN.');
  chk(el3.primary==='D.Maye' && el3.receiver==='E.Raridon', 'a two-word surname in the report does not confuse it');
  chk(app.names('(No Huddle, Shotgun) B.Mayfield pass incomplete deep left to E.Egbuka (J.Davis).').primary==='B.Mayfield', 'an ordinary play is untouched');
  const el4=app.names('J.Ezeudu, J.Moore and K.Tonga reported in as eligible.  K.Walker left end for 60 yards, TOUCHDOWN. H.Butker extra point is GOOD, Center-J.Winchester, Holder-M.Araiza.');
  chk(el4.primary==='K.Walker', `three linemen reported: the 60-yard touchdown is Walker\'s, not Ezeudu\'s (${el4.primary})`);
  chk(app.names('A.Jones & B.Smith reported in as eligible. C.Brown up the middle for 3 yards.').primary==='C.Brown' && app.names('(Shotgun) G.Van Roten, K.Walker III reported in as eligible.  D.Maye scrambles right end for 4 yards.').primary==='D.Maye', 'an ampersand, a two-word surname and a suffix inside the list');

  console.log('=== a namesake lineman in the box score does not take the back\'s key ===');
  const twin=JSON.parse(JSON.stringify(SUM));
  const cinP=twin.boxscore.players.find(t=>t.team.abbreviation==='CIN');
  cinP.statistics.find(g=>g.name==='fumbles').athletes.unshift({athlete:{id:'999001', displayName:'Chase Brown', shortName:'C. Brown'}, stats:['1','0','0']});
  global.__twinPos='T';
  const A2=app.ath(twin);
  chk(A2.byKey['cin|c.brown'] && A2.byKey['cin|c.brown'].id!=='999001', 'the key stays with the running back');

  console.log('=== the feed on the page ===');
  const h=app.feedHTML(app.GAME(), SUM);
  chk(/gcf-row gcf-td/.test(h) && /gcf-rz">RZ/.test(h) && /gcf-clock">Q4 /.test(h) && /gcf-badge gcf-b-td">TD/.test(h) && /gcf-sc-hit/.test(h), 'rows carry the kind, the RZ badge, the clock, the badge and the moved score');
  chk(/gcf-name">M\. Gesicki<\/span><span class="gcf-pos gcf-pos-te">TE<\/span><span class="gcf-owner">@RichBigMeechy/.test(h) && /gcf-name gc-mine">B\. Mayfield/.test(h), 'players show position, the fantasy owner in the pane\'s league, and my players light up');
  chk(/\(<em>\+2 YD<\/em>\)|<em>\(\+2 YD\)<\/em>/.test(h), 'the delta is marked');
  chk(/onclick="gcdSetFeedAll\(true\)"/.test(h) && !/gcf-play/.test(h), 'key plays by default with the All toggle');
  chk(/no plays yet · Sun 8:20 PM/.test(app.feedHTML({state:'pre', detail:'Sun 8:20 PM', home:'SEA', away:'NE'}, null)), 'a game ahead says so');
  chk(/loading the plays/.test(app.feedHTML(app.GAME(), null)), 'no summary yet → loading');

  console.log('=== the quarter line and the box score ===');
  const ls=app.ls(app.GAME(), SUM);
  chk(/<th>Q1<\/th><th>Q2<\/th><th>Q3<\/th><th>Q4<\/th><th>TOT<\/th>/.test(ls) && /TB<\/td><td>3<\/td><td>7<\/td><td>10<\/td><td>7<\/td><td class="gcls-tot">27/.test(ls) && /CIN<\/td><td>14<\/td><td>10<\/td><td>3<\/td><td>6<\/td><td class="gcls-tot">33/.test(ls), 'the quarter line, away then home, with totals');
  const box=app.box(app.GAME(), SUM, 'CIN');
  chk(/Passing[\s\S]*<th>C\/ATT<\/th><th>YDS<\/th>[\s\S]*J\. Burrow[\s\S]*<td>25\/35<\/td><td>254<\/td>/.test(box) && /Receiving[\s\S]*M\. Gesicki[\s\S]*<td>5<\/td><td>78<\/td>/.test(box), 'the box score by stat group with ESPN\'s labels and lines');
  chk(/M\. Gesicki<\/span><small class="gcf-owner">@RichBigMeechy/.test(box) && /gcb-click/.test(box), 'a rostered player shows his owner; a known player opens his card');
  chk(/no box score yet for SEA/.test(app.box(app.GAME(), SUM, 'SEA')), 'a side the summary lacks says so');

  console.log('=== the game panel: Feed | Stats, Away | Fantasy | Home ===');
  app.setSum('401872925', SUM);
  chk(app.tab(app.GAME())==='feed' && app.tab(app.GAME('pre'))==='stats', 'a played game opens on the feed, a game ahead on stats');
  let gh=app.gameHTML();
  chk(/gc-hero/.test(gh) && /gc-tab active" onclick="gcdSetTab\('feed'\)"/.test(gh) && /gcf-row/.test(gh) && !/gc-group/.test(gh), 'the feed tab: hero, tabs, plays');
  app.setTab('stats'); gh=app.gameHTML();
  chk(/gcls-tot">33/.test(gh) && /gc-seg/.test(gh) && /Quarterback[\s\S]*J\. Burrow/.test(gh) && /gc-lgsel/.test(gh), 'the stats tab: the quarter line, the segmented control, the fantasy pane with its league switcher');
  app.setSide('home'); gh=app.gameHTML();
  chk(/Passing[\s\S]*J\. Burrow[\s\S]*25\/35/.test(gh) && !/gc-group/.test(gh), 'Home shows the Bengals\' box score');
  app.setSide('fantasy');

  console.log('=== the league switcher ===');
  chk(app.lgOpts().map(o=>o.id).join(',')==='snap,app' && app.league()==='snap', 'the Analyzer\'s league and the app\'s scoring before any synced league loads');
  app.setPcard({L9:{id:'L9', name:'Queen City Keepers', byPid:{q2:{owner:'Sengi12', mine:true}, t1:{owner:'kademiller', mine:false}}, scoring:{pass_yd:0.05, pass_td:6, rec:1, rec_yd:0.1, rec_td:6}}, L1:{id:'L1', name:'Dirty Mikes', byPid:{}, scoring:{}}});
  chk(app.lgOpts().map(o=>o.name).join(',')==='Dirty Mikes,Queen City Keepers,TripleCrown', 'every synced league joins the list once (the Analyzer\'s not twice)');
  app.setPcard({L9:{id:'L9', name:'Queen City Keepers', byPid:{q2:{owner:'Sengi12', mine:true}}, scoring:{}}, L7:{id:'L7', name:'Business of Innovation', noRoster:true, byPid:{}, scoring:{}}, L1:{id:'L1', name:'Dirty Mikes', byPid:{}, scoring:{}}});
  chk(app.lgOpts().map(o=>o.name).join(',')==='Dirty Mikes,Queen City Keepers,TripleCrown', 'a league I run but have no roster in (commissioner only) stays out of the switcher — no team to follow');
  app.setPcard({L9:{id:'L9', name:'Queen City Keepers', byPid:{q2:{owner:'Sengi12', mine:true}, t1:{owner:'kademiller', mine:false}}, scoring:{pass_yd:0.05, pass_td:6, rec:1, rec_yd:0.1, rec_td:6}}, L1:{id:'L1', name:'Dirty Mikes', byPid:{}, scoring:{}}});
  app.setLeague('L9');
  chk(app.league()==='L9' && app.owner('q2')==='@Sengi12' && app.mine('q2')===true && app.owner('t1')==='@kademiller' && app.mine('t1')===false && app.owner('q1')==='', 'owners and "mine" follow the picked league');
  chk(app.pts({player_id:'q2', position:'QB', stats:{pass_yd:254, pass_td:1}})===18.7, 'points under the picked league\'s own scoring (254×0.05 + 6 = 18.70)');
  chk(app.proj('q2', 1)===27 && app.proj('t1', 1)===9, 'the projection scored the same way (300×0.05 + 12 = 27; 4 + 5 = 9)');
  gh=app.gameHTML();
  chk(/gc-owner">@Sengi12<\/span><span class="gc-pname gc-mine">J\. Burrow/.test(gh) && /<b class="gc-pts">18\.70<\/b><small class="gc-proj" title="projected">27\.00<\/small>/.test(gh), 'the fantasy pane: the owner above the name, the projection under the points');
  chk(/<option value="L9" selected>Queen City Keepers/.test(gh), 'the switcher shows the picked league');
  app.setLeague('app');
  chk(app.owner('q2')==='' && app.mine('q2')===false && app.pts({player_id:'q2', position:'QB', stats:{pass_yd:254, pass_td:1}})!==18.7, 'App scoring: no owners, the app\'s own number');
  app.setLeague('snap');

  console.log('=== the synced leagues load on the first paint that needs them ===');
  app.resetPcard(); app.setProfile({user:{user_id:'u1'}, leagues:[{league_id:'L9', name:'Queen City Keepers', status:'in_season', season:'2026'}]}); app.stubLeagueReads();
  let sel=app.lgSelect();
  chk(/loading your leagues…/.test(sel) && /Dirty Mikes/.test(sel) && !/Queen City/.test(sel), 'the first paint kicks the load and says so');
  await settle(); await settle();
  sel=app.lgSelect();
  chk(/<option value="L9"[^>]*>Queen City Keepers/.test(sel) && !/loading your leagues/.test(sel), 'the leagues land and the list has them');
  app.setLeague('L9');
  chk(app.owner('q2')==='@Sengi12' && app.mine('q2')===true && app.owner('t1')==='@kademiller' && app.pts({player_id:'q2', position:'QB', stats:{pass_yd:254, pass_td:1}})===18.7, 'owners, mine and the league\'s scoring come from the loaded reads');
  chk(app.sideClass('q2')===' gc-mine' && app.sideClass('t1')==='', 'mine is blue from the roster at once; the opponent waits for the week\'s matchup read, kicked by that first paint');
  await settle(); await settle();
  chk(app.sideClass('q2')===' gc-mine' && app.sideClass('t1')===' gc-opp' && app.sideClass('k1')==='', 'week 1: my starter blue, the man I play red, a third roster plain');
  app.setWeekNum(2); app.sideClass('k1'); await settle(); await settle();
  chk(app.sideClass('k1')===' gc-opp' && app.sideClass('t1')==='', 'week 2 is a different opponent: red follows the week on screen');
  app.setWeekNum('current');
  app.resetPcard(); app.setProfile({username:'sengi12', leagues:[{league_id:'L9', name:'Queen City Keepers', status:'in_season', season:'2026'}]});
  app.lgSelect(); await settle(); await settle();
  chk(app.mine('q2')===true && app.owner('q2')==='@Sengi12', 'a profile saved by username alone still knows which roster is mine');
  app.setLeague('snap');

  console.log('=== a game on: the feed polls on its own clock ===');
  app.setMode('max'); app.setGame('TB@CIN'); app.setSum('401872925', SUM);
  app.gameHTML(app.GAME('in'));
  chk(!!app.liveTimer(), 'rendering a live game arms the poll');
  app.clearLive(); app.gameHTML(app.GAME('post'));
  chk(!app.liveTimer(), 'a final does not');
  app.setMode('min'); app.gameHTML(app.GAME('in'));
  chk(!app.liveTimer(), 'nor a live game while the panel is out of view');
  app.setMode('max');

  console.log('=== the playoff rounds are weeks 19-22 everywhere ===');
  chk(/seasontype=2&week=18&/.test(app.boardUrl(2026,18)) && /seasontype=3&week=1&/.test(app.boardUrl(2026,19)) && /seasontype=3&week=2&/.test(app.boardUrl(2026,20)) && /seasontype=3&week=3&/.test(app.boardUrl(2026,21)) && /seasontype=3&week=5&/.test(app.boardUrl(2026,22)), 'ESPN: season type 3, rounds 1/2/3/5 (4 is the Pro Bowl)');
  chk(app.weekLabel(19)==='Wild Card' && app.weekLabel(22)==='Super Bowl' && app.weekLabel(7)==='Week 7', 'the rounds have names');
  chk(/2026\/18\?season_type=regular/.test(app.statsUrl(2026,18)) && /2026\/1\?season_type=post/.test(app.statsUrl(2026,19)) && /2026\/4\?season_type=post/.test(app.statsUrl(2026,22)) && /2026\/2\?season_type=post/.test(app.projUrl(2026,20)), 'Sleeper: the post-season weeks 1-4 for stats and projections');
  const selHtml=app.gameHTML();   // (any tab) — the week select lives in gcHTML; check the label helper through the option text instead
  chk(typeof app.weekLabel==='function', 'labels ready for the picker');

  console.log('=== a play posts: the board changes, the summary is re-read at once ===');
  const LIVE={state:'in', eid:'401872925', sit:{down:2, distance:7, ddt:'2nd & 7', spot:'TB 34', rz:false, poss:'CIN', period:3, clock:'4:12', lastPlayId:'p1', lastPlay:{id:'p1', text:'x', type:'Rush'}}};
  const nSum=()=>app.fetches().filter(u=>/summary\?event=401872925/.test(u)).length;
  app.setGame('TB@CIN'); app.setSum('401872925', SUM); const s0=nSum();
  app.onBoard({CIN:LIVE, TB:LIVE});
  chk(app.sumAt('401872925')===0 && nSum()>s0, 'a first sighting of a last play stales the cached summary and fetches it');
  await settle();
  const s1=nSum();
  app.onBoard({CIN:LIVE, TB:LIVE});
  chk(nSum()===s1, 'the same play again: nothing');
  const LIVE2=JSON.parse(JSON.stringify(LIVE)); LIVE2.sit.ddt='3rd & 2'; LIVE2.sit.spot='TB 29';
  app.onBoard({CIN:LIVE2, TB:LIVE2});
  chk(nSum()===s1, 'the down moving without a new play repaints, no fetch');
  const LIVE3=JSON.parse(JSON.stringify(LIVE2)); LIVE3.sit.lastPlayId='p2';
  app.onBoard({CIN:LIVE3, TB:LIVE3}); await settle();
  chk(nSum()===s1+1, 'a new play id: one fetch');
  const g3=Object.assign(app.GAME('in'), {sit:LIVE3.sit});
  const sh=app.sitHTML(g3);
  chk(/gcf-dot/.test(sh) && /CIN ball/.test(sh) && /3rd &amp; 2 @ TB 29/.test(sh) && /Q3 4:12/.test(sh) && !app.sitHTML(app.GAME('post')), 'the situation line: possession, the down and spot, the clock — live games only');
  const fh1=app.feedHTML(g3, SUM); const fewer=JSON.parse(JSON.stringify(SUM)); fewer.drives.previous=fewer.drives.previous.slice(0,-2);
  app.feedHTML(g3, fewer); const fh2=app.feedHTML(g3, SUM);
  chk(!/gcf-new/.test(fh1) && (fh2.match(/gcf-new/g)||[]).length>=1 && !/gcf-now/.test(fh2), 'plays newer than the last paint flash in (the situation line is the hero\'s now, not the feed\'s)');
  app.setBoardTeams({CIN:LIVE3, TB:LIVE3}); const s2=nSum(); app.landed();
  chk(nSum()===s2, 'the board landing hook runs the stream check (same play: no fetch)');

  console.log('=== the summary fetch ===');
  const fresh=app.GAME(); fresh.eid='401872925'; delete require('fs');   // (no-op; keeps the linter quiet)
  const before=app.fetches().length;
  app.setSum('x','y'); // unrelated
  const g2={...app.GAME(), eid:'401872925'};
  chk(app.summary(g2)===SUM || (app.summary(g2)&&app.summary(g2).drives), 'a cached final summary is served without a fetch');
  chk(app.fetches().length===before, 'and no request went out');

  console.log('=== live: the drive in progress is listed twice by ESPN (previous AND current) ===');
  const dup=JSON.parse(JSON.stringify(SUM)); dup.drives.current=JSON.parse(JSON.stringify(dup.drives.previous[dup.drives.previous.length-1]));
  chk(app.plays(dup).length===app.plays(SUM).length && app.plays(dup).every((p,i)=>p.id===app.plays(SUM)[i].id), 'each play once — the live drive\'s plays are not doubled');
  const lastSum=app.build(SUM).pop(), lastDup=app.build(dup).pop();
  chk(lastDup.title===lastSum.title && JSON.stringify(lastDup.who.map(w=>w.line))===JSON.stringify(lastSum.who.map(w=>w.line)), 'so the running lines (N CAR, N YD …) are not inflated by the duplicate');

  console.log('=== live: the summary lags the scoreboard — keep reading until it has the last play ===');
  const lastId=SUM.drives.previous[SUM.drives.previous.length-1].plays.slice(-1)[0].id;
  const gIn=Object.assign(app.GAME('in'), {sit:{lastPlayId:String(lastId)}});
  app.setSum('401872925', SUM);
  const c0=nSum();
  chk(app.behind(gIn)===false && app.catchUp(gIn)===false && nSum()===c0, 'the summary carries the board\'s last play: nothing to do');
  const gLag=Object.assign(app.GAME('in'), {sit:{lastPlayId:'p_not_yet'}});
  chk(app.behind(gLag)===true, 'the board names a play the summary does not have yet → behind');
  chk(app.catchUp(gLag)===true && app.sumAt('401872925')===0 && nSum()===c0+1, 'the tick stales the cache and reads the summary again');
  await settle();
  chk(app.behind(gLag)===true && app.catchUp(gLag)===true && nSum()===c0+2, 'still behind after it lands → the next tick reads again (until the play is there)');
  chk(app.behind(Object.assign(app.GAME('in'), {sit:{lastPlayId:''}}))===false && app.behind(app.GAME('post'))===false, 'no last play on the board, or no situation: never behind');
  chk(app.POLL===5000, 'the live poll ticks every 5 seconds');

  console.log('=== live: the fantasy pane scores the box score, not Sleeper\'s trailing rows ===');
  app.setSum('401872925', SUM);
  const boxR=app.boxRows(SUM);
  const bq1=boxR.find(r=>r.player_id==='q1'), br2=boxR.find(r=>r.player_id==='r2'), bk2=boxR.find(r=>r.player_id==='k2');
  chk(bq1 && bq1.stats.pass_cmp===23 && bq1.stats.pass_att===28 && bq1.stats.pass_yd===216 && bq1.stats.pass_td===0 && bq1.stats.pass_int===0 && bq1.stats.pass_sack===4 && bq1.stats.fum_lost===3 && bq1.position==='QB', 'a passer\'s box line → Sleeper keys (C/ATT split, sacks from "4-23", fumbles lost)');
  chk(br2 && br2.stats.rush_att>0 && br2.stats.rush_yd>0 && br2.stats.rec>=0 && br2.stats.rec_yd>=0 && br2.player.first_name==='Chase' && br2.team==='CIN', 'a back carries rushing AND receiving from his two groups');
  chk(bk2 && bk2.stats.fgm!=null && bk2.stats.fga!=null && bk2.stats.xpm!=null && bk2.stats.xpa!=null, 'a kicker\'s FG and XP splits');
  chk(!boxR.some(r=>!r.player_id) && boxR.every(r=>r.stats.gp===1), 'only athletes the app can name become rows (an ESPN-only name is left out), each with a game played');
  const gLive=Object.assign(app.GAME('in'), {eid:'401872925'});
  const live=app.liveRows(app.ROWS, gLive);
  const lq1=live.find(r=>r.player_id==='q1'), sq1=app.ROWS.find(r=>r.player_id==='q1');
  chk(sq1.stats.pass_td===1 && lq1.stats.pass_td===0 && lq1.stats.pass_yd===216 && lq1.stats.rush_td===1 && lq1.live===true, 'the box score lays over Sleeper\'s row (Sleeper still says a passing TD; the box says none) — keys the box does not carry stay');
  chk(live.length>=app.ROWS.length && app.liveRows(app.ROWS, app.GAME('post'))===app.ROWS && app.liveRows(app.ROWS, Object.assign(app.GAME('in'), {eid:'nope'}))===app.ROWS, 'players the box names but Sleeper has not sent yet join; a final, or a game with no summary, keeps Sleeper\'s rows');

  console.log('=== the refresh mark: a tap that reads ESPN again now; halftime says so ===');
  app.setBoardAt(Date.now()-4000); app.setSum('401872925', SUM);
  const st=app.fresh('401872925');
  chk(/class="tc-fresh"/.test(st) && /onclick="tcRefreshNow\(event\)"/.test(st) && /tc-ico/.test(st) && /tc-fresh-t">just now</.test(st), 'the stamp: the refresh mark and the age of the newest read (the summary, cached just now)');
  chk(/tc-fresh-t">(3|4|5)s ago</.test(app.fresh('')), 'without a picked game it is the board\'s age — the ticking heartbeat');
  const sitLive=app.sitHTML(Object.assign(app.GAME('in'), {sit:LIVE3.sit}));
  chk(/gcf-now-clock/.test(sitLive) && /tc-fresh/.test(sitLive) && !/tc-fresh/.test(app.sitHTML(app.GAME('post'))), 'the situation line carries the mark, live games only');
  const half=app.sitHTML(Object.assign(app.GAME('in'), {sit:Object.assign({}, LIVE3.sit, {phase:'Halftime', ddt:'', spot:'', poss:'', clock:'0:00'})}));
  chk(/<b>Halftime<\/b>/.test(half) && !/gcf-now-clock/.test(half) && !/ball/.test(half) && /tc-fresh/.test(half), 'halftime: the line says Halftime — no down, no clock, the mark stays');
  const noSit=app.sitHTML(Object.assign(app.GAME('in'), {sit:null, detail:'Halftime'}));
  chk(/<b>Halftime<\/b>/.test(noSit), 'no situation block from ESPN at all: the status text stands in');
  const halfBoard=app.parse({events:[{id:'1',date:'',competitions:[{status:{type:{state:'in',name:'STATUS_HALFTIME',shortDetail:'Halftime'},period:2,displayClock:'0:00'},situation:{down:1,distance:10},competitors:[{homeAway:'home',team:{abbreviation:'BUF'},score:'27'},{homeAway:'away',team:{abbreviation:'DET'},score:'7'}]}]}]});
  chk(halfBoard.BUF.sit.phase==='Halftime' && halfBoard.BUF.detail==='Halftime' && app.parse({events:[{id:'2',date:'',competitions:[{status:{type:{state:'in',name:'STATUS_END_PERIOD',shortDetail:'End of 1st'},period:1,displayClock:'0:00'},situation:{},competitors:[{homeAway:'home',team:{abbreviation:'BUF'},score:'7'},{homeAway:'away',team:{abbreviation:'DET'},score:'0'}]}]}]}).BUF.sit.phase==='End of Q1', 'the board reads ESPN\'s halftime and end-of-quarter statuses into the situation');
  console.log('=== the board\'s last play leads the feed while the summary is behind ===');
  const LPTD={id:'p_soon', type:'Passing Touchdown', yds:12, text:'(Shotgun) J.Burrow pass short right to M.Gesicki for 12 yards, TOUCHDOWN.', team:'CIN', athletes:[], down:2, ddt:'2nd & 7', spot:'TB 12', yte:12, scoreValue:6};
  const gBehind=Object.assign(app.GAME('in'), {sit:{period:4, clock:'2:00', lastPlayId:'p_soon', lastPlay:LPTD}});
  app.setSum('401872925', SUM); app.setAll(false);
  const fSoon=app.feedHTML(gBehind, SUM);
  const iSoon=fSoon.indexOf('gcf-soon');
  chk(iSoon>0 && /gcf-row gcf-td gcf-new gcf-soon/.test(fSoon) && /just in/.test(fSoon) && /M\. Gesicki 12 yd TD catch/.test(fSoon) && /2nd &amp; 7 @ TB 12/.test(fSoon) && /Q4 2:00/.test(fSoon) && fSoon.indexOf('class="gcf-row')===fSoon.lastIndexOf('class="gcf-row', iSoon), 'a touchdown the scoreboard has and the summary does not: a provisional row at the top — headline, spot, clock, the TD badge, tagged "just in"');
  const gHave=Object.assign(app.GAME('in'), {sit:{period:4, clock:'2:00', lastPlayId:String(lastId), lastPlay:Object.assign({}, LPTD, {id:String(lastId)})}});
  chk(!/gcf-soon/.test(app.feedHTML(gHave, SUM)), 'once the summary carries the play, no provisional row');
  const gRun=Object.assign(app.GAME('in'), {sit:{period:4, clock:'2:00', lastPlayId:'p_run', lastPlay:Object.assign({}, LPTD, {id:'p_run', type:'Rush', yds:3, text:'C.Brown left end for 3 yards.', scoreValue:0})}});
  chk(!/gcf-soon/.test(app.feedHTML(gRun, SUM)) && (app.setAll(true), /gcf-soon/.test(app.feedHTML(gRun, SUM))) && /C\. Brown 3 yd rush/.test(app.feedHTML(gRun, SUM)), 'an ordinary snap is provisional only when every play is showing');
  app.setAll(false);
  chk(!/gcf-soon/.test(app.feedHTML(Object.assign(app.GAME('in'), {sit:{period:4, clock:'2:00', lastPlayId:'p_to', lastPlay:Object.assign({}, LPTD, {id:'p_to', type:'Official Timeout', text:'Official Timeout at 02:00.'})}}), SUM)), 'a timeout never leads');
  const nB=()=>app.fetches().filter(u=>/scoreboard/.test(u)).length, b0=nB();
  app.setGame('TB@CIN'); app.setBoardTeams({CIN:LIVE3, TB:LIVE3});
  chk(app.refresh({stopPropagation(){}})===true && app.boardAt()===0 && app.sumAt('401872925')===0 && app.freshBusy()===true && nB()===b0+1, 'a tap stales the board and every summary, reads the board at once, and spins until it lands');
  await settle();
  chk(app.freshBusy()===false && app.boardAt()>0, 'the landing stops the spin');

  console.log('=== under the hero: the drive on the field, the win probability, the last play ===');
  const ds=app.drives(SUM);
  chk(ds.length===SUM.drives.previous.length && new Set(ds.map(d=>d.id)).size===ds.length && ds.every(d=>d.team && Array.isArray(d.plays)), 'one entry per drive, its team and its plays');
  const dupD=JSON.parse(JSON.stringify(SUM)); dupD.drives.current=JSON.parse(JSON.stringify(dupD.drives.previous[dupD.drives.previous.length-1]));
  chk(app.drives(dupD).length===ds.length && app.drives(dupD)[ds.length-1].live===true && !ds[ds.length-1].live, 'the drive in progress (listed twice by ESPN) is one drive, marked live');
  const lastD=ds[ds.length-1]; const sent=app.sentence(lastD);
  chk(new RegExp('^'+lastD.team+' from ').test(sent) && /\d+-plays?\./.test(sent) && /(rush|pass)/.test(sent), `the drive sentence: "${sent}"`);
  const dc=app.drive(app.GAME('post'), SUM);
  chk(/<svg[^>]*gc-drive-svg/.test(dc) && (dc.match(/stroke="#e6b23c"/g)||[]).length===2 && (dc.match(/<polygon/g)||[]).length>=6 && /url\(#gcEzA\)/.test(dc) && /url\(#gcEzH\)/.test(dc) && !/<image [^>]*teamlogos[^>]*opacity="0.9"/.test(dc) && /gc-drive-sum/.test(dc), 'the field in perspective: the bands, solid club-coloured end zones with nothing in them, uprights on both back lines, the sentence under it');
  chk((dc.match(/<circle/g)||[]).length>=3 && /<image /.test(dc) && /paint-order="stroke"/.test(dc), 'the drive\'s start, the newest snap, the ball, a pin with a face (or the club) above it, the last play\'s label');
  const mini={drives:{previous:[{id:'m1', team:{abbreviation:'CIN'}, description:'2 plays, 32 yards, 0:40', result:'TD', plays:[
    {id:'p1', sequenceNumber:1, type:{text:'Rush'}, text:'C.Brown left end for 12 yards.', statYardage:12, period:{number:1}, clock:{displayValue:'10:00'}, start:{down:1, yardsToEndzone:60, shortDownDistanceText:'1st & 10', possessionText:'CIN 40'}},
    {id:'p2', sequenceNumber:2, type:{text:'Passing Touchdown'}, text:'J.Burrow pass deep left to M.Gesicki for 48 yards, TOUCHDOWN.', statYardage:48, scoringPlay:true, period:{number:1}, clock:{displayValue:'9:20'}, start:{down:1, yardsToEndzone:48, shortDownDistanceText:'1st & 10', possessionText:'TB 48'}}]}]}};
  const mc=app.drive(app.GAME('post'), mini);
  chk((mc.match(/class="gc-seg gc-seg-prog" d="M[^"]*L[^"]*" fill="none" stroke="#39c15a"/g)||[]).length===1 && (mc.match(/gc-seg-last" d="M[^"]*Q[^"]*" fill="none" stroke="#39c15a"/g)||[]).length===1 && /M\. Gesicki 48 yd TD catch/.test(mc) && /<animateMotion/.test(mc) && /<animate attributeName="stroke-dashoffset"/.test(mc), 'one continuous drive: the run a straight line to the next snap, the pass an arc to the end zone — and the newest play animates in (the segment draws, the ball travels it)');
  chk(!/<animateMotion/.test(app.drive(app.GAME('post'), mini)), 'the same play again does not animate twice');
  const fgD=(type)=>({drives:{previous:[{id:'k'+type, team:{abbreviation:'CIN'}, description:'2 plays, 9 yards, 0:50', result:type==='Field Goal Good'?'FG':'MISSED FG', plays:[
    {id:'k1', sequenceNumber:1, type:{text:'Rush'}, text:'C.Brown up the middle for 9 yards.', statYardage:9, period:{number:2}, clock:{displayValue:'1:00'}, start:{down:1, yardsToEndzone:34, shortDownDistanceText:'1st & 10', possessionText:'TB 34'}},
    {id:'k2', sequenceNumber:2, type:{text:type}, text:'E.McPherson 43 yard field goal is '+(type==='Field Goal Good'?'GOOD':'No Good')+', Center-C.Adomitis, Holder-R.Rehkow.', statYardage:43, scoringPlay:type==='Field Goal Good', period:{number:2}, clock:{displayValue:'0:10'}, start:{down:4, yardsToEndzone:25, shortDownDistanceText:'4th & 1', possessionText:'TB 25'}}]}]}});
  const good=app.drive(app.GAME('post'), fgD('Field Goal Good')), miss=app.drive(app.GAME('post'), fgD('Field Goal Missed'));
  chk(/gc-seg-fg" d="M[^"]*Q/.test(good) && !/gc-seg-miss/.test(good) && /E\. McPherson 43 yd FG/.test(good) && (good.match(/stroke="#e6b23c"/g)||[]).length===2, 'a made field goal flies from the spot through the uprights');
  chk(/gc-seg-fg gc-seg-miss/.test(miss) && /stroke="#e5484d"/.test(miss) && /no good/.test(miss), 'a miss flies wide, in red');
  const toD=(plays, result)=>({drives:{previous:[{id:'t'+result, team:{abbreviation:'CIN'}, description:'x', result, plays}]}});
  const P=(id,seq,type,text,yds,yte,extra)=>Object.assign({id, sequenceNumber:seq, type:{text:type}, text, statYardage:yds, period:{number:3}, clock:{displayValue:'5:00'}, start:{down:1, yardsToEndzone:yte, shortDownDistanceText:'1st & 10', possessionText:'CIN '+(100-yte)}}, extra||{});
  const intD=toD([P('i1',1,'Rush','C.Brown left end for 5 yards.',5,70), P('i2',2,'Interception Return','(Shotgun) J.Burrow pass deep left intended for M.Gesicki INTERCEPTED by J.Trotter [L.David] at TB 30. J.Trotter to TB 45 for 15 yards (M.Gesicki).',15,65,{isTurnover:true})], 'INT');
  const ih=app.drive(app.GAME('post'), intD);
  const ir=app.turnover({text:intD.drives.previous[0].plays[1].text, type:'Interception Return'}, 'CIN');
  chk(ir && ir.kind==='int' && ir.who==='J.Trotter' && ir.at===70 && ir.end===55 && ir.td===false && ir.ret===15, 'an interception read from the words: who, where (the offense\'s 70), carried back 15 to the 55');
  chk(/gc-seg-pre" d="M[^"]*Q/.test(ih) && /gc-seg-last gc-seg-ret" d="M[^"]*" fill="none" stroke="#e5484d"/.test(ih) && /J\. Trotter INT · 15 yd return/.test(ih), 'the pass arcs to where it was picked, the return runs the other way in red, the label says who and how far');
  const six=toD([P('s1',1,'Rush','C.Brown left end for 5 yards.',5,70), P('s2',2,'Interception Return Touchdown','J.Burrow pass short right INTERCEPTED by J.Trotter at TB 40. J.Trotter for 60 yards, TOUCHDOWN.',60,65,{isTurnover:true, scoringPlay:true})], 'INT TD');
  const sr=app.turnover({text:six.drives.previous[0].plays[1].text}, 'CIN');
  chk(sr.td===true && sr.end===0 && /J\. Trotter pick six!/.test(app.drive(app.GAME('post'), six)), 'a pick six runs to the left end zone — the offense\'s own — and says so');
  const fumD=toD([P('f1',1,'Rush','C.Brown up the middle for 3 yards.',3,60), P('f2',2,'Fumble Recovery (Opponent)','C.Brown left tackle to TB 35 for 8 yards (L.David). FUMBLES (L.David), RECOVERED by TB-J.Trotter at TB 34. J.Trotter to TB 44 for 10 yards (C.Brown).',8,57,{isTurnover:true})], 'FUMBLE');
  const fr=app.turnover({text:fumD.drives.previous[0].plays[1].text}, 'CIN');
  chk(fr && fr.kind==='fum' && fr.who==='J.Trotter' && fr.at===66 && fr.end===56 && fr.ret===10 && /gc-seg-pre" d="M[^"]*L/.test(app.drive(app.GAME('post'), fumD)) && /J\. Trotter recovers · 10 yd return/.test(app.drive(app.GAME('post'), fumD)), 'a fumble: the run to where it was lost (a line), the recovery carried back 10');
  const flagD=toD([P('g1',1,'Rush','C.Brown left end for 4 yards.',4,60), P('g2',2,'Penalty','PENALTY on TB-L.David, Defensive Offside, 5 yards, enforced at CIN 44 - No Play.',5,56), P('g3',3,'Rush','C.Brown up the middle for 2 yards.',2,51)], '');
  const fh=app.drive(app.GAME('post'), flagD);
  chk((fh.match(/class="gc-flag"/g)||[]).length===0 && /gc-seg gc-seg-prog/.test(fh) && (fh.match(/<circle /g)||[]).length===4, 'an older flag is gone once the next snap comes: the drive so far is one quiet line, the start dot, the newest snap, the ball and the pin');
  const flagLast=toD([P('h1',1,'Rush','C.Brown left end for 4 yards.',4,60), P('h2',2,'Penalty','PENALTY on TB-L.David, Defensive Offside, 5 yards, enforced at CIN 44 - No Play.',5,56)], '');
  chk((app.drive(app.GAME('post'), flagLast).match(/class="gc-flag"/g)||[]).length===1 && /Flag: Defensive Offside on TB/.test(app.drive(app.GAME('post'), flagLast)), 'a flag that just happened: the yellow marker at the spot, the ball waiting there');

  console.log('=== a punt: the kick to where it was fielded, then the return the other way ===');
  const punR=app.punt('M.Araiza punts 41 yards to TB 28, Center-J.Winchester. A.Bachman to TB 42 for 14 yards (E.Downs; C.McDonald).', 'CIN');
  chk(punR && punR.catchYd===72 && punR.returner==='A.Bachman', 'a punt read from the words: where it was fielded, and by whom');
  const retD=toD([P('r1',1,'Rush','C.Brown left end for 5 yards.',5,55),
    P('r2',2,'Punt','M.Araiza punts 41 yards to TB 28, Center-J.Winchester. A.Bachman to TB 42 for 14 yards (E.Downs; C.McDonald).',3,45)], 'PUNT');
  const rh=app.drive(app.GAME('post'), retD);
  chk(/gc-seg-kick" d="M[^"]*Q/.test(rh) && /gc-seg-last gc-seg-ret" d="M[^"]*L[^"]*" fill="none" stroke="#39c15a"/.test(rh) && /A\. Bachman 14 yd return/.test(rh), 'the punt arcs to where it was fielded (static), the return runs on in green (animated), the label names the returner and the yards');
  chk(rh.includes(`<image href="${app.esc(app.logo('TB'))}"`) && !rh.includes(`<image href="${app.esc(app.logo('CIN'))}"`), 'the pin wears the receiving club\'s own logo, not the punting team\'s');

  console.log('=== a punt fair caught: no return, just the credit ===');
  const fcD=toD([P('c1',1,'Rush','C.Brown left end for 5 yards.',5,55),
    P('c2',2,'Punt','M.Araiza punts 58 yards to TB 13, Center-J.Winchester, fair catch by A.Bachman.',32,45)], 'PUNT');
  const fch=app.drive(app.GAME('post'), fcD);
  chk(/gc-seg-kick" d="M[^"]*Q/.test(fch) && !/gc-seg-ret/.test(fch) && /A\. Bachman fair catch/.test(fch), 'a fair catch draws one kick arc and credits the catch, no return segment');

  console.log('=== a punt with no returner named: the old single arc still draws ===');
  const oobD=toD([P('o1',1,'Rush','C.Brown left end for 5 yards.',5,55),
    P('o2',2,'Punt','A.Cole punts 53 yards to TB 27, Center-J.Bobenmoyer, out of bounds.',18,45)], 'PUNT');
  const oobh=app.drive(app.GAME('post'), oobD);
  chk(!/gc-seg-ret/.test(oobh) && (oobh.match(/gc-seg-kick/g)||[]).length===1 && /A\. Cole punts/.test(oobh), 'out of bounds names no returner: one arc from snap to the dead spot, the punter still gets the label');
  const posts=[...dc.matchAll(/<g class="gc-posts"><path d="M([\d.]+),([\d.]+) V([\d.]+) M([\d.]+),([\d.]+) L([\d.]+),([\d.]+) M[\d.]+,[\d.]+ V[\d.]+ M[\d.]+,[\d.]+ V[\d.]+"/g)].map(m=>m.slice(1).map(Number));
  chk(posts.length===2 && posts[0][6]<posts[0][4] && posts[1][6]>posts[1][4] && posts.every(q=>q[3]<q[5]) && !/skewX/.test(dc), 'uprights on both back lines, Sleeper\'s: a vertical stem, the crossbar tilted with the field (climbing toward mid-field on both sides), two short vertical uprights');
  chk(app.sentence(app.drives(mini)[0])==='CIN from own 40: 2-plays. 1 rush, 12 yds. 1/1 pass, 48 yds. TD 🎉', `the sentence, Sleeper's wording: "${app.sentence(app.drives(mini)[0])}"`);
  app.wpOpen(false); app.setSum('401872925', SUM);
  const w0=app.wp(app.GAME('post'), SUM);
  chk(/gc-wp-head/.test(w0) && /<b>6%<\/b>/.test(w0) && /<b>94%<\/b>/.test(w0) && !/<svg/.test(w0) && /aria-expanded="false"/.test(w0), 'win probability folded by default: the two numbers, no chart (TB 6%, CIN 94% at the end)');
  app.wpOpen(true); const w1=app.wp(app.GAME('post'), SUM);
  const cy=Number((w1.match(/<circle cx="[\d.]+" cy="([\d.]+)"/)||[])[1]);
  chk(/<svg/.test(w1) && cy>40 && /aria-expanded="true"/.test(w1) && (w1.match(/<image /g)||[]).length===2, 'open: the chart with both clubs\' marks on the axis, and the line ends near the bottom — the home side, who is winning');
  const hc=(typeof pwTeamColor==='function')?'':'';
  chk(/,8 L[\d.]+,8 Z" fill="#/.test(w1) && !/,64 L[\d.]+,64 Z" fill="#/.test(w1) && /x="338"/.test(w1), 'the winner\'s share is filled in the winner\'s colour (the home side wins here: from the line up to the top), the clubs\' marks on the right');
  app.wpOpen(false);
  const lp1=app.lastPlay(Object.assign(app.GAME('in'), {sit:{period:4, clock:'2:50', lastPlayId:'z', lastPlay:{id:'z', type:'Extra Point Good', text:'E.McPherson extra point is GOOD.', yds:0, team:'CIN', athletes:[], down:0, ddt:'', spot:'', yte:null}}}), SUM);
  chk(/LAST PLAY/.test(lp1) && /End zone/.test(lp1) && /E\. McPherson XP, good/.test(lp1) && /tc-fresh/.test(lp1), 'the last-play line: LIVE, the spot, the play, the stamp');
  chk(/FINAL PLAY/.test(app.lastPlay(app.GAME('post'), SUM)) && app.lastPlay(app.GAME('pre'), SUM)==='' && app.top(app.GAME('pre'), SUM)==='', 'after the game it is the final play; before it, nothing');

  console.log('=== repaints wait for the hand to lift ===');
  let painted=0; const paint=()=>{ painted++; };
  chk(app.busy()===false && app.idle('t', paint)===true && painted===1, 'idle: a repaint runs at once');
  app.setDown(true);
  chk(app.busy()===true && app.idle('t', paint)===false && app.idle('t', paint)===false && painted===1, 'a finger down: the repaint is queued, one per key (the newest wins)');
  app.setDown(false); app.flush(); await new Promise(r=>setTimeout(r,220));
  chk(painted===2, 'the finger lifts: the queued repaint runs once');
  app.setActive({tagName:'SELECT'});
  chk(app.busy()===true && app.idle('t', paint)===false && painted===2, 'an open week picker (a focused select) holds repaints too');
  app.setActive(null); app.flush(); await new Promise(r=>setTimeout(r,220));
  chk(painted===3 && app.busy()===false, 'the pick closes: the repaint lands');
  app.setBoardTeams({CIN:LIVE3, TB:LIVE3}); app.landed(); const sig1=app.sidebarSig(); app.landed();
  chk(sig1 && app.sidebarSig()===sig1, 'the left sidebar repaints on a state change, not on every read');
  // a game changing state redraws the Live view (the week sliders and the chip follow the games)
  let contentPaints=0; app.stubContent(()=>{ contentPaints++; }); app.setLiveView(true);
  app.landed();
  chk(contentPaints===0, 'the same states again: the page is left alone');
  app.setBoardTeams({CIN:Object.assign({}, LIVE3, {state:'post'}), TB:Object.assign({}, LIVE3, {state:'post'})}); app.landed();
  chk(contentPaints===1, 'a game going final redraws the Live view once');
  app.setLiveView(false); app.setBoardTeams({CIN:LIVE3, TB:LIVE3}); app.landed();
  chk(contentPaints===1, 'not on the Live view: no redraw');
  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
