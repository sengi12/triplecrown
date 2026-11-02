// The matchup swing chart: ESPN plays replayed into one line of win chance, the biggest
// swings pinned to the man who made them, the weekend's windows on the x-axis.
// The axis labels are the viewer's local clock; the fixture's kickoffs are Eastern, so the test
// reads them the way the user does (CI runs in UTC, where the 1pm slate would say 5pm).
process.env.TZ='America/New_York';
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){},visibilityState:'visible'};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){}};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  laSwingBuild, laSwingSVG, laSwingRecapHTML, laSwingPlayEvents, laSwingGameFrac, laSwingWindows, laSwingX, laSwingSectionHTML, laSwingDrawWidth, laSwingPhrase, laState,
  setPlayers:(s)=>{sleeperPlayers=s;}, setSnapshot:(s)=>{leagueSnapshot=s;}, setSleeperFetch:(f)=>{sleeperFetch=f;} };`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const near=(a,b,e)=>Math.abs(a-b)<(e||1e-6);

console.log('=== the game clock ===');
chk(app.laSwingGameFrac(0,'')===0 && near(app.laSwingGameFrac(1,'15:00'),0) && near(app.laSwingGameFrac(3,'7:30'),0.625) && app.laSwingGameFrac(4,'0:00')===1 && app.laSwingGameFrac(5,'9:12')===1,
    'quarter + time left → share of the game played; overtime is all of it');

console.log('=== the replay ===');
const H=3600*1000, t0=Date.UTC(2026,9,11,17,0,0);   // Sunday 1pm ET
const SC={pass_yd:0.04, pass_td:4, rec:1, rec_yd:0.1, rec_td:6, rush_yd:0.1, rush_td:6};
const base={
  mine:['p1','p2','0'], opp:['q1'],
  proj:{p1:20, p2:12, q1:24}, teamOf:{p1:'CIN', p2:'MIA', q1:'DAL'}, pos:{p1:'QB', p2:'WR', q1:'RB'},
  games:{CIN:{eid:'e1', kick:t0, state:'post', loaded:true}, MIA:{eid:'e2', kick:t0+7*H, state:'pre', loaded:false}, DAL:{eid:'e3', kick:t0+5.5*H, state:'in', loaded:true}},
  scoring:SC, actualFinal:{p1:24.5},
  plays:[
    {eid:'e1', at:t0+5*60000, q:1, clock:'12:00', kind:'rec', title:'Burrow 12 yd pass', stats:{p1:{pass_yd:12, pass_att:1, pass_cmp:1}}},
    {eid:'e1', at:t0+39*60000, q:2, clock:'9:30', kind:'inc', title:'Burrow incomplete', stats:{p1:{pass_att:1}}},
    {eid:'e1', at:t0+40*60000, q:2, clock:'9:00', kind:'recTd', title:'Burrow 30 yd TD pass', stats:{p1:{pass_yd:30, pass_td:1, pass_att:1, pass_cmp:1}}},
    {eid:'e1', at:t0+2.5*H, q:4, clock:'0:00', kind:'final', title:'Final', stats:{}},
    {eid:'e3', at:t0+5.6*H, q:1, clock:'10:30', kind:'rush', title:'Pollard 2 yd rush', stats:{q1:{rush_yd:2, rush_att:1}}},
    {eid:'e3', at:t0+5.62*H, q:1, clock:'10:00', kind:'rushTd', title:'Pollard 40 yd rush TD', stats:{q1:{rush_yd:40, rush_att:1, rush_td:1}}},
    {eid:'e3', at:0, q:1, clock:'9:00', kind:'rush', title:'Pollard 3 yd rush', stats:{q1:{rush_yd:3, rush_att:1}}},
  ]};
const B=app.laSwingBuild(base);
const s=B.series;
chk(s.length===8 && s[0].t===t0 && near(s[0].mine,32) && near(s[0].opp,24) && s[0].p>0.5, 'the line starts at the first kickoff on projections alone: 32 to 24, my side favoured');
chk(s[1].pid==='p1' && near(s[1].delta,0.48) && s[1].side==='mine', 'a play credits the starter it moved, by the league table (12 pass yds = 0.48)');
chk(Math.abs(s[2].dp)<0.001 && s[2].p<s[1].p, 'an incompletion is no swing — the chance it cost is the projection burning off the clock, which the line shows but the play is not blamed for');
chk(s[3].dp>0.05 && s[3].kind==='recTd' && near(s[3].delta, 5.2), 'the touchdown pass lifts the chance (+30 yds, +TD = 5.2)');
chk(s[4].final==='e1' && near(s[4].pts.mine, 24.5), "the final snaps the quarterback's line to Sleeper's own total (two-point tries, fumbles — the box score's word)");
chk(Math.abs(s[5].dp)<0.01 && s[6].dp<-0.1 && s[6].side==='opp' && near(s[6].delta,10), "a two-yard carry is nothing; the other side's touchdown run pulls the chance down");
chk(s[7].t===s[6].t+20000, 'a play with no wall clock rides 20 s after its game\'s last one');
chk(!B.decided && B.final.p>0 && B.final.p<1, 'a receiver yet to play and a live game: nothing decided');
chk(B.keys.length===2 && B.keys[0].kind==='recTd' && B.keys[1].kind==='rushTd', 'the swings: the two touchdowns, in the order they happened; the 12-yard pass did not move three points');
chk(B.windows.length===2 && B.windows[0].t0===t0 && B.windows[1].t0===t0+5.6*H, 'two windows: the early game, then the late one after the long gap');

const done=app.laSwingBuild(Object.assign({}, base, {
  games:{CIN:{eid:'e1', kick:t0, state:'post', loaded:true}, MIA:{eid:'e2', kick:t0, state:'post', loaded:false}, DAL:{eid:'e3', kick:t0+5.5*H, state:'post', loaded:true}},
  actualFinal:{p1:24.5, p2:9.9, q1:27.0},
  plays: base.plays.concat([{eid:'e3', at:t0+6.5*H, q:4, clock:'0:00', kind:'final', title:'Final', stats:{}}]) }));
const L=done.series[done.series.length-1];
chk(done.decided && L.p===1 && near(L.pts.mine, 34.4) && near(L.pts.opp, 27), 'everyone done: the last point is the scoreboard (24.5 + 9.9 vs 27) and the chance is 1 — won');
chk(done.series[0].pts.mine===9.9 && near(done.series[0].mine, 9.9+20), "a final game with no summary (MIA's never loaded) is played and stands at Sleeper's total from the start");
const tie=app.laSwingBuild({mine:['a'], opp:['b'], proj:{a:10,b:10}, teamOf:{a:'KC',b:'KC'}, games:{KC:{eid:'e9', kick:t0, state:'post', loaded:false}}, actualFinal:{a:10,b:10}, plays:[]});
chk(tie.decided && tie.series[0].p===0.5, 'a dead-level final is a half');

console.log('=== the picture + the recap ===');
const svg=app.laSwingSVG(B, {label:'x'});
chk(/<svg class="la-swing-svg"/.test(svg) && (svg.match(/la-swing-mark /g)||[]).length===2 && /la-swing-up/.test(svg) && /la-swing-dn/.test(svg), 'the SVG carries one pinned mark per swing, up for mine, down for theirs');
chk(/sleepercdn\.com\/content\/nfl\/players\/p1\.jpg/.test(svg) && /\+\d+%/.test(svg) && /−\d+%/.test(svg), 'each mark is the player\'s headshot with the swing in points of chance');
chk((svg.match(/la-swing-tick"/g)||[]).length===2 && /Sun 1pm/.test(svg) && !/>Final</.test(svg), 'one x tick per kickoff slate (Sun 1pm, then the late one), no Final tick while it is live');
chk(app.laSwingBuild(Object.assign({}, base, {plays:[Object.assign({}, base.plays[0], {at:t0-3600000})]})).series[1].t===t0, 'a play stamped before its kickoff is held at the kickoff');
chk(/>Final</.test(app.laSwingSVG(done, {})), 'a decided week ends the axis at Final');
const recap=app.laSwingRecapHTML(B, {p1:'Joe Burrow', q1:'Tony Pollard'});
chk((recap.match(/la-swing-row/g)||[]).length===2 && /Joe Burrow/.test(recap) && /Tony Pollard/.test(recap) && /\+5\.2 pts/.test(recap), 'the recap lists the swings with the player and his points');
chk(/steady weekend/.test(app.laSwingRecapHTML(app.laSwingBuild(Object.assign({}, base, {plays:base.plays.slice(0,1)})), {})), 'no swing worth pinning says so');

console.log('=== the replay controls and the wide drawing ===');
const wide=app.laSwingSVG(B, {w:960});
chk(/viewBox="0 0 960 220"/.test(wide) && /data-w="960"/.test(wide) && /la-swing-reveal/.test(wide) && /la-swing-cursor/.test(wide) && (wide.match(/data-x="/g)||[]).length===2,
    'a wide screen gets a 960 × 220 drawing (the labels stay their size), with the reveal clip, a cursor and an x for every pinned swing');
chk(/viewBox="0 0 640 250"/.test(svg), 'the phone keeps the 640 × 250 card');
global.window.innerWidth=1200;
app.laState.swingHide=false;
chk(app.laSwingDrawWidth()===960, 'the drawing width follows the viewport: 960 from 900 px up');
global.window.innerWidth=390;
chk(app.laSwingDrawWidth()===640, '… and 640 on a phone');

console.log('=== the highlights: words, dots, a callout to pin them to ===');
chk(app.laSwingPhrase({kind:'recTd', yds:42})==='42 yard TD catch!' && app.laSwingPhrase({kind:'rushTd', yds:11})==='11 yard TD run!' && app.laSwingPhrase({kind:'int'})==='Intercepted' && app.laSwingPhrase({kind:'other', title:'Fumble! X'})==='Fumble! X',
    'a swing reads like a broadcast card: the yards and the play, no name');
chk(B.keys.every(k=>Number.isInteger(k.i) && B.series[k.i]===k), 'every swing knows its place on the scrubber');
chk(/data-i="0"[^>]*onclick="laSwingMarkTap\(event,0\)"/.test(svg), 'a tap on a pinned mark opens its highlight');

console.log('=== plays from an ESPN summary ===');
app.setPlayers({p1:{name:'Joe Burrow', team:'CIN', pos:'QB'}, p2:{name:"Ja'Marr Chase", team:'CIN', pos:'WR'}});
const SUM={drives:{previous:[{team:{abbreviation:'CIN'}, plays:[
  {id:'1', sequenceNumber:1, type:{text:'Pass Reception'}, text:'(14:20) J.Burrow pass short right to J.Chase for 25 yards (T.Someone).', wallclock:'2026-10-11T17:05:00Z', period:{number:1}, clock:{displayValue:'14:20'}, statYardage:25},
  {id:'2', sequenceNumber:2, type:{text:'Timeout'}, text:'Timeout #1 by CIN', wallclock:'2026-10-11T17:06:00Z', period:{number:1}, clock:{displayValue:'14:00'}},
  {id:'3', sequenceNumber:3, type:{text:'End of Game'}, text:'END GAME', wallclock:'2026-10-11T20:00:00Z', period:{number:4}, clock:{displayValue:'0:00'}}]}]}};
const ev=app.laSwingPlayEvents(SUM, 'e1');
chk(ev.length===2 && ev[0].kind==='rec' && ev[0].stats.p1 && ev[0].stats.p1.pass_yd===25 && ev[0].stats.p2 && ev[0].stats.p2.rec_yd===25 && ev[0].stats.p2.rec===1,
    'a reception is read for the passer and the receiver by Sleeper id; the timeout is dropped');
chk(ev[1].kind==='final' && ev[1].at===Date.parse('2026-10-11T20:00:00Z') && ev[0].at===Date.parse('2026-10-11T17:05:00Z'), 'the end of the game is an event with its wall clock');
chk(ev[0].yds===25, 'a play carries its yards for the highlight');

console.log('=== in the card ===');
app.laState.swingHide=false;
const html=app.laSwingSectionHTML(5, {roster_id:1, starters:['p1'], starters_points:[0], points:0}, {roster_id:2, starters:['q1'], starters_points:[0], points:0}, {meta:new Map(), pm:new Map(), names:{mine:'My Squad'}});
chk(/la-swing-wait/.test(html) && /board/.test(html), 'no board yet: the block says it is reading the week');
app.laState.swingHide=true;
chk(/la-swing-closed/.test(app.laSwingSectionHTML(5, {}, {}, {})), 'hidden: a one-line button to bring it back');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
