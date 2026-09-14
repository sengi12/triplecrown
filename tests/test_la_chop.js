// Chopped leagues (Sleeper type 3): the in-season pane is the Chopping Block — every survivor
// ranked by projected finish with a Safe % (the chance it is NOT the week's lowest), banded
// CHOP ZONE / DANGER / SAFE, chopped teams read off the finished weeks.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){},classList:{add(){},remove(){}}}),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){},visibilityState:'visible'};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){}; sleeperFetch=async()=>{ throw new Error('no net in tests'); };
  laProjMap=()=>new Map(); paceForPlayer=()=>null; laGameStarted=(team,wk)=> team==='DONE' ? true : team==='LATER' ? false : null;
  laAdjWeekProj=(p,wk)=>({adj: p.pos==='QB'?18:10, bye:false, out:false});
  return { view:laChopView, season:laSeasonView, safe:laChopSafePct, gone:laChopEliminated, isChopped:laIsChopped,
    mu:()=>_laMu, set:(s)=>{ leagueSnapshot=s; currentPhase='League'; }, TC_SEASON, laState, pane:laActivePane };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== safe % ===');
const sums=[{rosterId:1,n:8,pts:120,rem:0,ytp:0,proj:120},{rosterId:2,n:8,pts:60,rem:0,ytp:0,proj:60},{rosterId:3,n:8,pts:70,rem:0,ytp:0,proj:70},{rosterId:4,n:8,pts:55,rem:20,ytp:2,proj:75}];
let sp=app.safe(sums);
chk(sp[1]===100 && sp[3]===100, 'teams with two locked lower scores beneath them are 100% safe');
chk(sp[2]<20 && sp[4]>80 && sp[2]+0<sp[4], `the 60 (done) is in danger, the 55 with 20 projected left mostly clears it (${sp[2]}% v ${sp[4]}%)`);
chk(JSON.stringify(app.safe(sums))===JSON.stringify(sp), 'deterministic — a re-render never flickers');
chk(app.safe([{rosterId:9,n:8,pts:1,rem:0,ytp:0,proj:1}])[9]===100, 'a lone survivor is safe');

console.log('=== the pane in a chopped league ===');
const T=(i,owner)=>({rosterId:i, ownerId:owner||('u'+i), owner:'o'+i, teamName:'Team '+i, players:[{id:'q'+i,name:'QB '+i,pos:'QB',team:'DONE'},{id:'r'+i,name:'RB '+i,pos:'RB',team:'LATER'}]});
const S={provider:'sleeper', leagueId:'C', season:'2026', myUserId:'me', leagueType:3, chop:{startWeek:1,lastLeg:17}, rosterPositions:['QB','RB','BN'],
  teamList:[T(1,'me'),T(2),T(3),T(4),T(5),T(6)]};
app.set(S); app.TC_SEASON.year=2026; app.TC_SEASON.phase='regular'; app.TC_SEASON.week=2; app.laState.muWeek=2; app.laState.laTab='season'; app.laState.seasonPane=null;
chk(app.isChopped(S) && !app.isChopped({leagueType:0}), 'type 3 is chopped');
// Week 1 is done: team 6 scored least → chopped. Week 2 in progress: QBs (DONE) played, RBs (LATER) not.
app.mu().byWeek[1]={fetchedAt:Date.now(), sig:'a', rows:[1,2,3,4,5,6].map(i=>({roster_id:i, matchup_id:i, points:100-(i===6?60:0)+i, starters:['q'+i,'r'+i], starters_points:[20,10]}))};
app.mu().byWeek[2]={fetchedAt:Date.now(), sig:'b', rows:[1,2,3,4,5,6].map(i=>({roster_id:i, matchup_id:i, points:[0,30,12,25,28,29,0][i], starters:['q'+i,'r'+i], starters_points:[[0,30,12,25,28,29,0][i],0]}))};
const gone=app.gone(S,2);
chk(gone[6]===1 && Object.keys(gone).length===1, 'team 6 (week 1\'s lowest) is chopped in week 1');
let h=app.view(S);
chk(/CHOPPING BLOCK/.test(h) && /5 alive · 1 chopped · chops through week 17/.test(h), 'the head counts survivors and the last chopping week');
chk(/CHOP ZONE/.test(h) && /DANGER/.test(h) && /SAFE/.test(h) && /CHOPPED/.test(h), 'four bands');
const chopIdx=h.indexOf('la-chop-band-chop'), t2=h.indexOf('Team 2');
chk(t2>chopIdx && t2<h.indexOf('la-chop-band-danger'), 'team 2 (12 banked + 10 projected, the lowest projection) sits in the chop zone');
chk(/la-chop-row la-chop-chop[^>]*>\s*<span class="la-chop-rank">5</.test(h), 'the chop-zone row is ranked 5 of 5');
chk(/la-chop-mine/.test(h) && /You: <b>\d+% safe<\/b>/.test(h), 'my team is highlighted with its own safe % line');
chk(/la-chop-gone[^>]*>[\s\S]*Team 6[\s\S]*chopped week 1/.test(h), 'the chopped team lists at the bottom with its week');
chk(/la-chop-played">1\/2</.test(h) && /<b>30\.00<\/b><small>40\.00</.test(h), 'played 1/2 (the QB is done); points banked with the projection under (30 + the RB\'s 10)');
chk(app.laState.seasonPane===null && /pane-tab active[^>]*onclick="laSetPane\('chop'\)"/.test(app.season(S)) && !/laSetPane\('matchup'\)/.test(app.season(S)), 'the Chop pane replaces Matchup and is the default');
S.leagueType=0; S.chop=null;
chk(/laSetPane\('matchup'\)/.test(app.season(S)) && !/laSetPane\('chop'\)/.test(app.season(S)), 'a points league keeps Matchup');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
