// The right sidebar's Game Center: the week's games from the scoreboard, and for the picked
// game each side's players by position with the league's exact points (Σ stat × setting over
// Sleeper's own scoring table), a stat line, and the fantasy owner. Sizes: min / normal / max,
// remembered.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',hidden:false,style:{},dataset:{},classList:{_s:new Set(),add(c){this._s.add(c);},remove(...c){c.forEach(x=>this._s.delete(x));},toggle(){},contains(c){return this._s.has(c);}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}};return elStore[id];}
const main={appendChild(el){ elStore[el.id]=el; }};
global.document={getElementById:(id)=>mkEl(id),querySelector:(q)=>q==='.main'?main:null,querySelectorAll:()=>[],createElement:()=>({id:'',className:'',innerHTML:'',hidden:false,style:{},classList:{add(){},remove(){}},appendChild(){}}),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){},visibilityState:'visible'};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),innerWidth:1200};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.requestAnimationFrame=(fn)=>setTimeout(fn,0);global.cancelAnimationFrame=(id)=>clearTimeout(id);
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  const P=(id,fn,ln,pos,team,st)=>({player_id:id, team, player:{first_name:fn,last_name:ln,position:pos,team}, stats:st});
  const ROWS=[ P('q1','Baker','Mayfield','QB','TB',{pass_yd:216,pass_td:1,pass_cmp:23,pass_att:28,rush_yd:30,pass_int:0,gp:1}), P('q2','Joe','Burrow','QB','CIN',{pass_yd:254,pass_td:1,pass_int:1,pass_cmp:25,pass_att:35,gp:1}),
    P('r1','Bucky','Irving','RB','TB',{rush_yd:45,rush_att:8,rush_td:1,rec:7,rec_tgt:7,rec_yd:48,gp:1}), P('r2','Chase','Brown','RB','CIN',{rush_yd:56,rush_att:16,rush_td:1,rec:5,rec_yd:22,gp:1}),
    P('w1','Emeka','Egbuka','WR','TB',{rec:5,rec_yd:63,gp:1}), P('w2','Tee','Higgins','WR','CIN',{rec:3,rec_yd:59,gp:1}),
    P('k1','Chase','McLaughlin','K','TB',{fgm:2,fga:2,xpm:3,xpa:3,gp:1}), P('CIN','','','DEF','CIN',{pts_allow:27,sack:2,int:0,gp:1}),
    P('d1','Logan','Wilson','LB','CIN',{idp_tkl:9,idp_tkl_solo:6,idp_sack:1,gp:1}), P('d2','Lavonte','David','LB','TB',{idp_tkl:7,idp_tkl_solo:4,gp:1}),
    P('x1','Sam','Darnold','QB','SEA',{pass_yd:200,gp:1}) ];
  fetchWeekStats=async(season,wk,pos)=>ROWS;
  // Three games out of kickoff order on the wire: Sunday late (final), Sunday night (live), Thursday (final).
  const BOARD={events:[{date:'2026-09-13T20:25Z',competitions:[{status:{type:{state:'post',shortDetail:'Final'}},competitors:[{homeAway:'home',team:{abbreviation:'CIN'},score:'33',records:[{type:'total',summary:'1-0'}]},{homeAway:'away',team:{abbreviation:'TB'},score:'27',records:[{type:'total',summary:'0-1'}]}]}]},
    {date:'2026-09-14T00:20Z',competitions:[{status:{type:{state:'in',shortDetail:'3rd 8:12'}},competitors:[{homeAway:'home',team:{abbreviation:'SEA'},score:'13',records:[{type:'total',summary:'0-0'}]},{homeAway:'away',team:{abbreviation:'NE'},score:'10',records:[{type:'total',summary:'0-0'}]}]}]},
    {date:'2026-09-11T00:15Z',competitions:[{status:{type:{state:'post',shortDetail:'Final'}},competitors:[{homeAway:'home',team:{abbreviation:'KC'},score:'21',records:[{type:'total',summary:'1-0'}]},{homeAway:'away',team:{abbreviation:'DEN'},score:'17',records:[{type:'total',summary:'0-1'}]}]}]}]};
  sleeperFetch=async(url)=>{ if(/scoreboard/.test(url)) return BOARD; throw new Error('x'); };
  hasSeasonStarted=()=>true; TC_SEASON.year=2026; TC_SEASON.phase='regular'; TC_SEASON.week=1; isMobileTeamPickerLayout=()=>false;
  sleeperPlayers={q1:{name:'Baker Mayfield',years_exp:8}, w1:{name:'Emeka Egbuka',years_exp:0}, d2:{name:'Lavonte David',years_exp:14}};
  leagueSnapshot={name:'Dirty Mikes', myUserId:'u1', scoringRaw:{pass_yd:0.04,pass_td:4,pass_int:-1,rush_yd:0.1,rush_td:6,rec:0.5,rec_yd:0.1,fgm:3,xpm:1,pts_allow:-0.1,sack:1,idp_tkl:1,idp_sack:2},
    teamList:[{rosterId:1, ownerId:'u1', owner:'Sengi12', teamName:'Sengi', players:[{id:'q1'},{id:'r2'}]},{rosterId:2, ownerId:'u2', owner:'RichBigMeechy', teamName:'Rich', players:[{id:'w2'}]}]};
  _gcd.tab='stats'; _gcd.side='fantasy';   // the fantasy pane, as before the Feed | Stats tabs
  return { pts:tcSleeperPoints, mode:gcSetMode, step:gcStep, setPos:gcSetPos, render:renderRightSidebar, html:()=>document.getElementById('leaders').innerHTML, cls:()=>[...document.getElementById('leaders').classList._s], pick:gcPick, week:gcSetWeek, load:gcLoadMode, state:()=>_gc, games:()=>gcGames(gcBoard(1)), mine:gcIsMine, maxW:gcMaxWidth, gameHTML:gcGameHTML, weekOpts:gcWeekOptions, gcWeek, setWeekProj:(wk,rows)=>{ const d=_laWpEntry(wk); d.rows=rows; d.at=Date.now(); d.fails=9; } };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const settle=()=>new Promise(r=>setTimeout(r,20));
(async()=>{
  console.log('=== the league\'s own scoring, verbatim ===');
  chk(app.pts({pass_yd:216,pass_td:1,rush_yd:30},{pass_yd:0.04,pass_td:4,rush_yd:0.1})===15.64, 'Σ stat × setting: 216×0.04 + 4 + 3 = 15.64');
  chk(app.pts({idp_tkl:9,idp_sack:1},{idp_tkl:1,idp_sack:2})===11 && app.pts({pts_allow:27,sack:2},{pts_allow:-0.1,sack:1})===-0.7, 'defenders and D/ST score off the same table');
  chk(app.pts({pass_yd:100},null)===null, 'no table → no number (the caller falls back)');

  console.log('=== sizes: − and +, a rail, a drag handle ===');
  app.mode('min'); chk(app.cls().includes('rsb-min') && /rsb-rail/.test(app.html()) && /gcStep\(1\)[^>]*>\+</.test(app.html()) && !/gcStep\(-1\)/.test(app.html()), 'min: a rail with one + button');
  app.step(1); chk(app.state().mode==='normal' && /Leaders/.test(app.html()) && /gcStep\(-1\)[^>]*>−</.test(app.html()) && /gcStep\(1\)[^>]*>\+</.test(app.html()), '+ → the Leaders, with − and + in its scoring line');
  app.step(1); await settle(); await settle();
  chk(app.state().mode==='max' && app.cls().includes('rsb-max') && /Game Center/.test(app.html()), '+ again → the Game Center');
  chk(/gcStep\(1\)[^>]*disabled/.test(app.html()) && !/gcStep\(-1\)[^>]*disabled/.test(app.html()), 'at the widest, + is disabled and − is not');
  chk(global.localStorage._s.tc_rsb==='max', 'the size is remembered');
  chk(/rsb-grip[^>]*onpointerdown="gcGripDown\(event\)"/.test(app.html()), 'the left edge is a drag handle');
  chk(app.maxW()>=260, 'the drag stops at the width of the content area');
  app.step(1); chk(app.state().mode==='max', '+ past the widest does nothing');

  console.log('=== the games, in the order they were played ===');
  let h=app.html();
  chk(app.games().map(g=>g.id).join(' ')==='DEN@KC TB@CIN NE@SEA', 'Thursday night, then the Sunday late window, then Sunday night — by kickoff, not by state');
  chk(/gc-game gc-on gc-in[\s\S]*NE[\s\S]*SEA/.test(h) && /3rd 8:12/.test(h), 'the game being played is picked by default');
  chk(/gc-game  gc-post[\s\S]*TB[\s\S]*CIN/.test(h) && /gc-won">[^]*?CIN[^]*?<b>33/.test(h), 'the final shows its score with the winner bright');
  app.pick('TB@CIN'); await settle(); h=app.html();
  chk(/gc-hero[\s\S]*gc-team">TB<[\s\S]*gc-score">27<[\s\S]*FINAL[\s\S]*gc-score">33<[\s\S]*gc-team">CIN</.test(h), 'the hero: TB 27 · FINAL · 33 CIN');
  chk(/gc-hero" style="--ga:#[0-9A-Fa-f]{6};--gh:#[0-9A-Fa-f]{6}"/.test(h), 'the banner carries both clubs\' colours (away left, home right) for its gradient');
  chk(/Quarterback[\s\S]*B\. Mayfield[\s\S]*<b class="gc-pts">15\.64<[\s\S]*J\. Burrow[\s\S]*<b class="gc-pts">13\.16</.test(h), 'quarterbacks by side with the league\'s points (Mayfield 15.64, Burrow 254×0.04+4−1 = 13.16)');
  chk(/gc-owner">@Sengi12<\/span><span class="gc-pname gc-mine">B\. Mayfield/.test(h) && /gc-owner">@RichBigMeechy<\/span><span class="gc-pname">T\. Higgins/.test(h), 'the fantasy owner rides above a rostered player\'s name');
  chk(/Kicker[\s\S]*C\. McLaughlin[\s\S]*2\/2 FG, 3\/3 XP/.test(h), 'kickers with a stat line');
  chk(/Defense \/ ST[\s\S]*CIN D\/ST[\s\S]*27 PA, 2 sacks/.test(h), 'the D/ST line');
  chk(/Defenders[\s\S]*L\. Wilson[\s\S]*9 tkl \(6 solo\), 1 sack[\s\S]*<b class="gc-pts">11\.00</.test(h) && /L\. David[\s\S]*7 tkl \(4 solo\)/.test(h), 'individual defenders with tackles, sacks and the league\'s IDP points');
  chk(!/S\. Darnold/.test(h), 'a player from another game is not in this one');
  chk(/216yd · 1TD · 30rush/.test(h) && /45rush · 7\/7 48rec · 1TD/.test(h), 'offensive stat lines in the app\'s own grammar');

  console.log('=== my players light up ===');
  chk(app.mine('q1') && app.mine('r2') && !app.mine('w2'), 'the roster owned by my user id is mine; a leaguemate\'s is not');
  chk(/gc-pname gc-mine">B\. Mayfield/.test(h) && /gc-pname gc-mine">C\. Brown/.test(h) && /gc-pname">T\. Higgins/.test(h), 'my players\' names carry the highlight; a leaguemate\'s player does not');

  console.log('=== filters: position and rookies, like the Rankings page ===');
  chk(/gc-posrow[\s\S]*gcSetPos\('QB'\)[\s\S]*gcSetPos\('IDP'\)[\s\S]*gcSetPos\('RK'\)/.test(h), 'a filter row: ALL, QB … IDP, RK');
  app.setPos('QB'); h=app.html();
  chk(/Quarterback/.test(h) && !/Running back/.test(h) && !/Defenders/.test(h) && /B\. Mayfield/.test(h), 'QB: only the quarterbacks');
  app.setPos('RK'); h=app.html();
  chk(/E\. Egbuka/.test(h) && !/B\. Mayfield/.test(h) && !/L\. David/.test(h), 'RK: only the rookies (Egbuka), across every group');
  app.setPos('ALL'); h=app.html();
  chk(/B\. Mayfield/.test(h) && /E\. Egbuka/.test(h) && /L\. David/.test(h), 'ALL: everyone again');


console.log('=== a game still ahead shows each side with the week\'s projected line ===');
{
  app.setWeekProj(1, { q1:{stats:{pass_yd:250, pass_td:2}, opp:'CIN', team:'TB', pos:'QB'}, w1:{stats:{rec:6, rec_yd:80}, opp:'CIN', team:'TB', pos:'WR'}, CIN:{stats:{sack:3, pts_allow:20}, opp:'TB', team:'CIN', pos:'DEF'} });
  const h=app.gameHTML({id:'TB@CIN', home:'CIN', away:'TB', state:'pre', detail:'9/20 - 1:00 PM', hrec:'1-0', arec:'0-1'}, null, 1);
  chk(/gc-projnote/.test(h) && /projected · Sleeper's week 1 line/.test(h), 'the panel says the lines are projected');
  chk(/B\. Mayfield/.test(h) && /gc-p-proj/.test(h) && />18\.00</.test(h), 'Mayfield projects 18.00 under the league table (250 yds, 2 TD)');
  chk(/E\. Egbuka/.test(h) && />11\.00</.test(h), 'Egbuka 6 catches for 80 → 11.00');
  chk(/CIN D\/ST/.test(h) && />1\.00</.test(h), 'the Bengals defense: 3 sacks, 20 allowed → 1.00');
  chk(!/no stat lines yet/.test(h) && !/loading the week/.test(h), 'no stat-line placeholder on an unplayed game');
  const played=app.gameHTML({id:'TB@CIN', home:'CIN', away:'TB', state:'post', detail:'Final', hs:33, as:27, hrec:'1-0', arec:'0-1'}, null, 1);
  chk(/loading the week's stat lines/.test(played) && !/gc-projnote/.test(played), 'a played game still waits for its stat lines');
  chk(JSON.stringify(app.weekOpts(1))===JSON.stringify(Array.from({length:22},(_,i)=>i+1)) && JSON.stringify(app.weekOpts(17))==='[17,18,19,20,21,22,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1]' && app.weekOpts(2)[0]===2 && app.weekOpts(2)[20]===22 && app.weekOpts(2)[21]===1, 'the picker lists now, every week ahead through the Super Bowl (19-22 = the playoff rounds), then the weeks played');
  app.state().week=3; chk(app.gcWeek()===3, 'a week ahead can be picked'); app.state().week='current';
}

  console.log('=== back to the list ===');
  app.mode('normal'); chk(!app.cls().includes('rsb-max') && /Leaders/.test(app.html()), 'normal: the Leaders list again');
  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
