// The league's trade ledger: reading Sleeper's transaction log into rows, the filters over
// them, and the sweep that fetches them. Sleeper's own shapes are the fixtures — adds keyed
// by player id to the RECEIVING roster, draft_picks with an owner_id and a separate
// roster_id for whose pick it is, waiver_budget as sender/receiver/amount.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){},getBoundingClientRect:()=>({top:0})};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;
global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};
global.fetch=()=>Promise.reject(new Error('offline in test'));
global.requestAnimationFrame=(fn)=>fn();

const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');

let pass=0, fail=0;
const ok=(cond,msg)=>{ if(cond){pass++;console.log('  PASS:',msg);} else {fail++;console.log('  FAIL:',msg);} };

const app=new Function(code+`
  toast=function(){};
  sleeperPlayers={
    '1':{name:'Star Back',pos:'RB',team:'NE'},
    '2':{name:'Solid Wideout',pos:'WR',team:'KC'},
    '3':{name:'The Passer',pos:'QB',team:'KC'},
    '4':{name:'Some Tight',pos:'TE',team:'SEA'},
  };
  Object.assign(TC_SEASON,{year:2026,phase:'regular',week:5,source:'test'});
  renderLeagueAnalyzer=function(){ RENDERS.push(1); };
  const RENDERS=[];
  return {laThNormalize, laThMatch, laThFilterRows, laThPositions, laThSort, laThMerge,
          laThLastLeg, laThLoad, laThLoadEarlier, laThStore, laThReset, laThSet, laThSetQuery, laThClear,
          laTradeHistoryHTML, laThRowHTML, laThPickLabel, LA_TH_TTL, LA_TX_URL,
          get filter(){ return laThFilter; },
          renders:RENDERS, store:(id)=>laThStore(id),
          setSnap:(s)=>{ leagueSnapshot=s; },
          setFetch:(fn)=>{ sleeperFetch=fn; },
          setSeason:(y,w)=>{ Object.assign(TC_SEASON,{year:y, week:w}); }};
`)();

// Roster 1 is me (owner u1), roster 2 is the rival (u2), roster 3 a third party (u3).
const byRid={
  1:{rosterId:1, ownerId:'u1', owner:'me',    teamName:'Gridiron Goats'},
  2:{rosterId:2, ownerId:'u2', owner:'rival', teamName:'Bayou Bandits'},
  3:{rosterId:3, ownerId:'u3', owner:'third', teamName:'Third Wheel'},
};
const snap={ provider:'sleeper', leagueId:'L26', season:'2026', myUserId:'u1',
  teamList:[byRid[1], byRid[2], byRid[3]] };

console.log('=== one trade, read out of Sleeper\'s own shape ===');
const tx1={ type:'trade', status:'complete', transaction_id:'t1', leg:3, created:3000,
  roster_ids:[1,2],
  adds:{'1':2, '2':1},                      // roster 2 gets Star Back, roster 1 gets Solid Wideout
  drops:{'1':1, '2':2},                     // the exact mirror — must not double anything
  draft_picks:[{season:'2027', round:1, roster_id:3, previous_owner_id:2, owner_id:1}],
  waiver_budget:[{sender:1, receiver:2, amount:25}] };
const r1=app.laThNormalize(tx1, '2026', byRid);
ok(!!r1, 'a completed trade becomes a row');
const side=(r,rid)=>r.teams.find(x=>x.rid===rid);
ok(side(r1,2).players.map(p=>p.name).join()==='Star Back', 'adds send the player to the roster in the VALUE, not the key');
ok(side(r1,1).players.map(p=>p.name).join()==='Solid Wideout', 'and the other side gets the other player');
ok(side(r1,1).players.length===1 && side(r1,2).players.length===1, 'drops are the mirror of adds and are ignored — nobody is counted twice');
ok(side(r1,1).picks.length===1 && side(r1,2).picks.length===0, 'a draft pick lands on its owner_id, not its roster_id');
ok(side(r1,1).picks[0].label==='2027 1st (Third Wheel)', 'the pick names whose it originally is when that is not the team receiving it');
ok(side(r1,2).faab===25 && side(r1,1).faab===0, 'waiver_budget credits the receiver only');
ok(r1.faab===25 && r1.hasPicks===true, 'the row indexes that money and a pick were in it');
ok(r1.posSet.sort().join()==='RB,WR', 'the row indexes which positions moved');
ok(r1.owners.sort().join()==='u1,u2', 'and which managers were in it, by owner id');
ok(r1.week===3 && r1.season==='2026', 'the leg is the week');

console.log('=== a pick that stays with its own team is not annotated ===');
const ownPick=app.laThPickLabel({season:'2028', round:2, roster_id:2, owner_id:2}, byRid);
ok(ownPick==='2028 2nd', 'a team getting its own pick back reads plainly');

console.log('=== what is not a trade ===');
ok(app.laThNormalize({type:'waiver', status:'complete', adds:{'1':1}}, '2026', byRid)===null, 'a waiver claim is not a trade');
ok(app.laThNormalize({type:'trade', status:'failed', roster_ids:[1,2], adds:{'1':2}}, '2026', byRid)===null, 'a trade that did not complete never happened');
ok(app.laThNormalize({type:'trade', status:'complete', roster_ids:[1,2]}, '2026', byRid)===null, 'a trade in which nothing moved is not a row — it renders as two blank columns');

console.log('=== the ledger is newest first, and merges without repeating ===');
const tx2=Object.assign({}, tx1, {transaction_id:'t2', leg:5, created:7000,
  adds:{'3':1}, drops:null, draft_picks:[], waiver_budget:[]});
const tx3=Object.assign({}, tx1, {transaction_id:'t3', leg:1, created:1000,
  roster_ids:[2,3], adds:{'4':3}, drops:null, draft_picks:[], waiver_budget:[]});
const rows=app.laThSort([r1, app.laThNormalize(tx2,'2026',byRid), app.laThNormalize(tx3,'2026',byRid)]);
ok(rows.map(r=>r.id).join()==='t2,t1,t3', 'newest first');
const merged=app.laThMerge(rows.slice(), [app.laThNormalize(tx1,'2026',byRid)]);
ok(merged.length===3, 'the same transaction id arriving twice is one row');

console.log('=== filters ===');
const F=(o)=>Object.assign({q:'', pos:'ALL', picks:false, faab:false, mgr:'all', season:'all'}, o);
const ids=(f)=>app.laThFilterRows(rows, f).map(r=>r.id).join();
ok(ids(F())==='t2,t1,t3', 'no filter is every trade');
ok(ids(F({q:'star back'}))==='t1', 'a player name finds the trade he was in');
ok(ids(F({q:'bayou'}))==='t2,t1,t3', 'a team name finds every trade that team made');
ok(ids(F({q:'2027 1st'}))==='t1', 'a pick label is searchable too');
ok(ids(F({q:'star wideout'}))==='t1', 'two words must BOTH appear — it is an AND, not a phrase');
ok(ids(F({q:'nobody'}))==='', 'a miss is a miss');
ok(ids(F({pos:'QB'}))==='t2', 'a position chip keeps the trades that moved one');
ok(ids(F({pos:'RB'}))==='t1', 'and only those');
ok(ids(F({picks:true}))==='t1', 'the picks toggle keeps the trades that included draft capital');
ok(ids(F({faab:true}))==='t1', 'the FAAB toggle keeps the trades that included money');
ok(ids(F({mgr:'u3'}))==='t3', 'a manager filter is on OWNER id — roster ids are a different person in an earlier season');
ok(ids(F({mgr:'u1'}))==='t2,t1', 'and it keeps every trade that manager was in');
ok(ids(F({season:'2025'}))==='', 'a season with no trades shows none');
ok(ids(F({pos:'RB', picks:true, mgr:'u2'}))==='t1', 'filters compose');
ok(app.laThPositions(rows).join()==='QB,RB,WR,TE', 'only the positions this league has actually traded are offered as chips');

console.log('=== how far up the log to read ===');
app.setSeason(2026, 5);
ok(app.laThLastLeg('2026')===6, 'the season in progress stops a week past today — the legs beyond it are empty requests');
ok(app.laThLastLeg('2024')===18, 'a finished season is read whole');
app.setSeason(2026, 0);
ok(app.laThLastLeg('2026')===1, 'before week 1 there is still leg 1 — Sleeper files offseason trades there');
app.setSeason(2026, 5);

console.log('=== the sweep ===');
(async()=>{
  const all=[], calls=[];
  app.setFetch((url)=>{ all.push(url); if(/\/transactions\//.test(url)) calls.push(url);
    const leg=+String(url).split('/').pop();
    return Promise.resolve(leg===3 ? [tx1, {type:'waiver', status:'complete', adds:{'1':1}}] : leg===5 ? [tx2] : []);
  });
  app.setSnap(snap);
  app.laThReset();
  await app.laThLoad(snap);
  const st=app.store('L26');
  ok(calls.length===6, 'one read per leg up to a week past today');
  ok(calls[0]===app.LA_TX_URL('L26',1), 'and they are the transaction log, leg by leg');
  ok(st.rows.map(r=>r.id).join()==='t2,t1', 'the trades come out, the waiver claim does not');
  ok(st.seasons.join()==='2026', 'the season it covers is recorded');
  ok(!!localStorage.getItem('tc_trades_L26'), 'the sweep is cached — the second visit is instant');

  const before=calls.length;
  await app.laThLoad(snap);
  ok(calls.length===before, 'a second call inside the TTL does not re-sweep 18 legs');
  await app.laThLoad(snap, true);
  ok(calls.length>before, 'refresh forces it');
  // A season that is over cannot gain a trade; its eighteen requests are worth a day.
  const old26=app.store('L26').at;
  app.store('L26').at = Date.now() - (60*60*1000);          // an hour ago
  const n1=calls.length;
  await app.laThLoad(snap);
  ok(calls.length>n1, 'an hour-old sweep of the LIVE season is re-read');
  app.setSeason(2027, 2);
  app.store('L26').at = Date.now() - (60*60*1000);
  const n2=calls.length;
  await app.laThLoad(snap);
  ok(calls.length===n2, 'the same age on a FINISHED season is not — that ledger cannot change');
  app.setSeason(2026, 5); app.store('L26').at=old26;

  console.log('=== a log that cannot be read backs off instead of hammering ===');
  app.store('LX').at=0;
  let tries=0;
  app.setFetch(()=>{ tries++; return Promise.reject(new Error('Sleeper 500')); });
  const bad=Object.assign({}, snap, {leagueId:'LX'});
  await app.laThLoad(bad);
  ok(app.store('LX').err==='Sleeper 500', 'every leg failing is an unreachable log, not an empty ledger');
  ok(!(app.store('LX').rows||[]).length, 'and it does not claim this league has never traded');
  const t1n=tries;
  await app.laThLoad(bad);
  ok(tries===t1n, 'and the next render does not fire the whole sweep again');

  console.log('=== earlier seasons follow the renewal chain, with THAT season\'s rosters ===');
  // Roster 2 is a different manager in 2025 — which is exactly why the ledger keys managers
  // on owner id and each season is scanned with its own roster map.
  const oldTx={type:'trade', status:'complete', transaction_id:'o1', leg:4, created:500,
    roster_ids:[1,2], adds:{'4':2, '3':1}, drops:{'4':1, '3':2}};
  app.setFetch((url)=>{
    all.push(url);
    if(/\/transactions\//.test(url)){ calls.push(url); return Promise.resolve(/L25\//.test(url) && /\/4$/.test(url) ? [oldTx] : []); }
    if(/league\/L26$/.test(url)) return Promise.resolve({league_id:'L26', season:'2026', previous_league_id:'L25'});
    if(/league\/L25$/.test(url)) return Promise.resolve({league_id:'L25', season:'2025', previous_league_id:null});
    if(/L25\/rosters$/.test(url)) return Promise.resolve([{roster_id:1, owner_id:'u1'},{roster_id:2, owner_id:'u9'}]);
    if(/L25\/users$/.test(url)) return Promise.resolve([{user_id:'u1', display_name:'me', metadata:{team_name:'Gridiron Goats'}},
                                                        {user_id:'u9', display_name:'gone', metadata:{team_name:'Departed Ducks'}}]);
    return Promise.resolve([]);
  });
  await app.laThLoadEarlier();
  const st2=app.store('L26');
  ok(st2.seasons.join()==='2026,2025', 'the earlier season joins the ledger');
  ok(st2.more.done===true, 'and the chain is walked once');
  const old=st2.rows.find(r=>r.id==='o1');
  ok(!!old && old.season==='2025', 'its trades come back stamped with their own season');
  ok(old.teams.find(x=>x.rid===2).teamName==='Departed Ducks',
     "a 2025 roster id resolves to who owned it THEN, not to this year's team of the same number");
  ok(app.laThFilterRows(st2.rows, F({mgr:'u2'})).every(r=>r.season==='2026'),
     'so filtering to a manager never drags in a stranger who happened to hold that roster id');
  ok(app.laThFilterRows(st2.rows, F({season:'2025'})).map(r=>r.id).join()==='o1', 'and the season filter separates them');
  ok(app.laThFilterRows(st2.rows, F({mgr:'u1'})).map(r=>r.id).join()==='t2,t1,o1', 'a manager reads across every season loaded');

  console.log('=== the section itself ===');
  app.setSnap(snap);
  app.laThReset();
  let h=app.laTradeHistoryHTML(snap);
  ok(/Trade history/.test(h), 'the section is titled');
  ok(/Star Back/.test(h) && /The Passer/.test(h), 'and lists the trades');
  ok(/Gridiron Goats/.test(h) && /Bayou Bandits/.test(h), 'with both sides named');
  ok(/\$25 FAAB/.test(h), 'money in a trade is shown as money');
  ok(/2027 1st \(Third Wheel\)/.test(h), 'and a pick as a pick');
  ok(/id="la-th-q"/.test(h), 'the search box is there');
  ok(/laThSet\('pos','QB'\)/.test(h) && /laThSet\('pos','RB'\)/.test(h), 'so are the position chips this league has traded');
  ok(!/laThSet\('pos','K'\)/.test(h), 'and not the ones it has not');
  ok(/laThSet\('picks'\)/.test(h) && /laThSet\('faab'\)/.test(h), 'plus the picks and FAAB toggles');
  ok(/laThSet\('mgr',this.value\)/.test(h), 'and a manager select');
  ok(/laThSet\('season',this.value\)/.test(h), 'and, now that two seasons are loaded, a season select');
  ok(/3 trades/.test(h), 'the count is stated — both seasons now loaded');

  app.laThSet('pos','QB');
  h=app.laTradeHistoryHTML(snap);
  ok(/The Passer/.test(h) && !/Star Back/.test(h), 'a chip narrows the list');
  ok(/2 of 3 trades/.test(h), 'and says so');
  app.laThSet('pos','K');
  h=app.laTradeHistoryHTML(snap);
  ok(/No trade matches those filters/.test(h), 'an empty result says so rather than showing nothing');
  app.laThClear();
  ok(app.filter.pos==='ALL', 'clear resets the filters');

  ok(app.laTradeHistoryHTML({provider:'espn', leagueId:'E1', season:'2026', teamList:[]})==='',
     'an ESPN league has no Sleeper transaction log, so the section stays off entirely');

  console.log(`\nRESULT: ${pass}/${pass+fail} ${fail?'FAILURES':'ALL PASS'}`);
  process.exit(fail?1:0);
})();
