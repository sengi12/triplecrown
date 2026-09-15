// The Games sheet — the Game Center on a phone. A pill bottom-right (red while a game is on,
// quiet between games), a bottom sheet in two heights (half: the week's games as a rail of
// chips + the picked game's banner; full: every position group), the selected team's score in
// the team picker's bar while its game is on. Nothing renders off-season, on desktop, or while
// a draft follow owns the same corner.
const elStore={};
const mkCls=()=>({_s:new Set(),add(...c){c.forEach(x=>this._s.add(x));},remove(...c){c.forEach(x=>this._s.delete(x));},toggle(c,on){ if(on===undefined) on=!this._s.has(c); on?this._s.add(c):this._s.delete(c); return on; },contains(c){return this._s.has(c);}});
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',hidden:false,style:{},dataset:{},classList:mkCls(),setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},getBoundingClientRect(){return {height:300,width:390,right:390};}};return elStore[id];}
const main={appendChild(el){ elStore[el.id]=el; }};
const body={appendChild(el){ elStore[el.id]=el; },classList:mkCls(),style:{}};
global.document={getElementById:(id)=>mkEl(id),querySelector:(q)=>q==='.main'?main:null,querySelectorAll:()=>[],createElement:()=>({id:'',className:'',innerHTML:'',hidden:false,style:{},classList:mkCls(),appendChild(){},querySelector:()=>null,querySelectorAll:()=>[]}),body,documentElement:{style:{}},addEventListener(){},visibilityState:'visible'};
global.window={addEventListener(){},removeEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),innerWidth:390,innerHeight:780,setTimeout:(fn,ms)=>setTimeout(fn,ms)};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  const P=(id,fn,ln,pos,team,st)=>({player_id:id, team, player:{first_name:fn,last_name:ln,position:pos,team}, stats:st});
  const ROWS=[ P('q1','Baker','Mayfield','QB','TB',{pass_yd:216,pass_td:1,pass_cmp:23,pass_att:28,rush_yd:30,gp:1}), P('q2','Joe','Burrow','QB','CIN',{pass_yd:254,pass_td:1,pass_int:1,pass_cmp:25,pass_att:35,gp:1}),
    P('q3','Sam','Darnold','QB','SEA',{pass_yd:200,pass_td:1,gp:1}), P('w3','Stefon','Diggs','WR','NE',{rec:6,rec_yd:80,gp:1}) ];
  fetchWeekStats=async(season,wk,pos)=>ROWS;
  // Thursday (final), Sunday late (final), Sunday night (live), Monday night (upcoming).
  let BOARD={events:[{date:'2026-09-13T20:25Z',competitions:[{status:{type:{state:'post',shortDetail:'Final'}},competitors:[{homeAway:'home',team:{abbreviation:'CIN'},score:'33',records:[{type:'total',summary:'1-0'}]},{homeAway:'away',team:{abbreviation:'TB'},score:'27',records:[{type:'total',summary:'0-1'}]}]}]},
    {date:'2026-09-14T00:20Z',competitions:[{status:{type:{state:'in',shortDetail:'3rd 8:12'}},competitors:[{homeAway:'home',team:{abbreviation:'SEA'},score:'13',records:[{type:'total',summary:'0-0'}]},{homeAway:'away',team:{abbreviation:'NE'},score:'10',records:[{type:'total',summary:'0-0'}]}]}]},
    {date:'2026-09-11T00:15Z',competitions:[{status:{type:{state:'post',shortDetail:'Final'}},competitors:[{homeAway:'home',team:{abbreviation:'KC'},score:'21',records:[{type:'total',summary:'1-0'}]},{homeAway:'away',team:{abbreviation:'DEN'},score:'17',records:[{type:'total',summary:'0-1'}]}]}]},
    {date:'2026-09-15T00:15Z',competitions:[{status:{type:{state:'pre',shortDetail:'9/14 - 8:15 PM EDT'}},competitors:[{homeAway:'home',team:{abbreviation:'MIN'},score:'0',records:[{type:'total',summary:'0-0'}]},{homeAway:'away',team:{abbreviation:'ATL'},score:'0',records:[{type:'total',summary:'0-0'}]}]}]}]};
  sleeperFetch=async(url)=>{ if(/scoreboard/.test(url)) return BOARD; throw new Error('x'); };
  let started=true, mobile=true;
  hasSeasonStarted=()=>started; TC_SEASON.year=2026; TC_SEASON.phase='regular'; TC_SEASON.week=1; isMobileTeamPickerLayout=()=>mobile;
  sleeperPlayers={}; leagueSnapshot=null;
  return { render:renderRightSidebar, phone:renderGamesPhone, set:gcmSet, open:gcOpenGame, pick:gcPick, line:gcPickerLineHTML, on:gcPhoneOn,
    host:()=>document.getElementById('gamesSheet'), html:()=>document.getElementById('gamesSheet').innerHTML, bodyCls:()=>[...document.body.classList._s], state:()=>_gcm, gc:()=>_gc,
    setMobile:v=>{mobile=v;}, setStarted:v=>{started=v;}, setDraft:v=>{rosterBarVisible=v;}, setBoard:b=>{ BOARD=b; _tcBoard.at=0; _gc.boards={}; }, sidebar:()=>document.getElementById('leaders') };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const settle=()=>new Promise(r=>setTimeout(r,20));
(async()=>{
  console.log('=== a phone, in season: the pill; nothing else moves ===');
  app.render(); await settle(); await settle(); app.phone();
  let h=app.html();
  chk(app.on()===true && app.host().hidden===false, 'the sheet host renders on a phone in season');
  chk(app.sidebar().hidden===true, 'the desktop sidebar (Leaders / Game Center) stays hidden on the phone');
  chk(/class="gcm-pill gcm-live"[^>]*onclick="gcmSet\('half'\)"/.test(h) && /gcm-dot/.test(h) && /<b class="gcm-n">1<\/b> LIVE/.test(h) && /2 final/.test(h), 'the pill glows red: 1 LIVE · 2 final');
  chk(/gcm-sheet gcm-closed/.test(h) && !/gc-head/.test(h) && !app.bodyCls().includes('gcm-open'), 'closed: the sheet is empty and the page carries no open flag');

  console.log('=== half: the week\'s games as a rail, the picked game\'s banner ===');
  app.set('half'); await settle(); h=app.html();
  chk(/gcm-sheet gcm-half/.test(h) && app.bodyCls().includes('gcm-open') && /gcm-scrim[^>]*onclick="gcmSet\('closed'\)"/.test(h), 'half: the sheet is up, the page is flagged open, the scrim closes it');
  chk(/gcm-grab[^>]*onpointerdown="gcmDragStart\(event\)"/.test(h), 'a drag handle');
  chk(/Game Center/.test(h) && /gcm-x[^>]*onclick="gcmSet\('closed'\)"/.test(h) && !/gcStep\(/.test(h) && !/rsb-grip/.test(h), 'the same Game Center head, with a close button instead of the sidebar\'s size buttons and grip');
  const ids=[...h.matchAll(/gcPick\('([^']+)'\)/g)].map(m=>m[1]);
  chk(ids.join(' ')==='DEN@KC TB@CIN NE@SEA ATL@MIN', 'the games in kickoff order: Thursday, Sunday late, Sunday night, Monday night');
  chk(/gc-game gc-on gc-in[\s\S]*NE[\s\S]*SEA/.test(h) && /gc-hero[\s\S]*gc-team">NE<[\s\S]*gc-score">10<[\s\S]*3rd 8:12[\s\S]*gc-score">13<[\s\S]*gc-team">SEA</.test(h), 'the game being played is picked and its banner reads NE 10 · 3rd 8:12 · 13 SEA');
  chk(/Quarterback[\s\S]*S\. Darnold/.test(h) && !/B\. Mayfield/.test(h), 'its stat lines, not another game\'s');

  console.log('=== a chip from the half sheet pulls it up to full ===');
  app.pick('TB@CIN'); await settle(); h=app.html();
  chk(app.state().open==='full' && /gcm-sheet gcm-full/.test(h), 'picking a game from half opens full');
  chk(/gc-team">TB<[\s\S]*gc-score">27<[\s\S]*FINAL[\s\S]*gc-score">33<[\s\S]*gc-team">CIN</.test(h) && /B\. Mayfield/.test(h) && /J\. Burrow/.test(h), 'TB 27 · FINAL · 33 CIN with both quarterbacks');
  app.pick('DEN@KC'); await settle(); chk(app.state().open==='full' && app.gc().game==='DEN@KC', 'picking from full stays full');
  app.set('closed'); h=app.html();
  chk(/gcm-sheet gcm-closed/.test(h) && !app.bodyCls().includes('gcm-open') && /gcm-pill/.test(h), 'closed again: the pill is back');

  console.log('=== the selected team\'s score in the team picker\'s bar ===');
  let l=app.line('SEA');
  chk(/team-picker-live/.test(l) && /SEA 13–10 NE/.test(l) && /team-picker-clock">3rd 8:12/.test(l) && /gcm-dot/.test(l), 'SEA, playing: "SEA 13–10 NE · 3rd 8:12" with the red dot');
  chk(/gcOpenGame\('NE@SEA'\)/.test(l) && /event\.stopPropagation\(\)/.test(l), 'tapping it opens that game without expanding the picker');
  chk(app.line('NE')==='' ? false : /NE 10–13 SEA/.test(app.line('NE')), 'the away side reads from its own end: NE 10–13 SEA');
  chk(app.line('KC')==='' && app.line('MIN')==='' && app.line('BUF')==='', 'a final, an upcoming game, a bye: nothing in the bar');
  app.open('NE@SEA'); h=app.html();
  chk(app.state().open==='full' && app.gc().game==='NE@SEA' && app.gc().week==='current', 'gcOpenGame: the sheet opens full on that game, this week');
  app.set('closed');

  console.log('=== the pill between games ===');
  app.setBoard({events:[{date:'2026-09-11T00:15Z',competitions:[{status:{type:{state:'post',shortDetail:'Final'}},competitors:[{homeAway:'home',team:{abbreviation:'KC'},score:'21',records:[]},{homeAway:'away',team:{abbreviation:'DEN'},score:'17',records:[]}]}]},
    {date:'2026-09-13T17:00Z',competitions:[{status:{type:{state:'pre',shortDetail:'9/13 - 1:00 PM EDT'}},competitors:[{homeAway:'home',team:{abbreviation:'BUF'},score:'0',records:[]},{homeAway:'away',team:{abbreviation:'NYJ'},score:'0',records:[]}]}]}]});
  app.phone(); await settle(); await settle(); app.phone(); h=app.html();
  chk(/class="gcm-pill"/.test(h) && !/gcm-live/.test(h) && /Games<span class="gcm-idle"> · 9\/13 - 1:00 PM EDT/.test(h), 'nothing on: a quiet pill with the next kickoff');
  chk(app.line('BUF')==='', 'and no score in the bar before kickoff');
  app.setBoard({events:[{date:'2026-09-11T00:15Z',competitions:[{status:{type:{state:'post',shortDetail:'Final'}},competitors:[{homeAway:'home',team:{abbreviation:'KC'},score:'21',records:[]},{homeAway:'away',team:{abbreviation:'DEN'},score:'17',records:[]}]}]}]});
  app.phone(); await settle(); await settle(); app.phone(); h=app.html();
  chk(/Games<span class="gcm-idle"> · Week 1 final/.test(h), 'the week over: "Week 1 final"');

  console.log('=== who owns the corner ===');
  app.setDraft(true); app.phone(); chk(app.on()===false && app.host().hidden===true && app.html()==='', 'a draft being followed keeps its drawer — the Games sheet steps aside');
  app.setDraft(false); app.setMobile(false); app.phone(); chk(app.on()===false && app.host().hidden===true, 'desktop: the sidebar has it');
  app.setMobile(true); app.setStarted(false); app.phone(); chk(app.on()===false && app.host().hidden===true, 'off-season: nothing');
  app.setStarted(true); app.phone(); chk(app.host().hidden===false && /gcm-pill/.test(app.html()), 'in season on a phone again: the pill returns');
  if(app.state().timer) clearTimeout(app.state().timer);
  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
