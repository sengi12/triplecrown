// The sidebar's standings follow the NFL's division tiebreakers: head-to-head, division
// record, common games, conference record, strength of victory / schedule, the points
// rankings, net points — with the three-club restart rule. Results come from the sidecar's
// real points + schedule, ESPN's boards fill the gaps (one fetch per missing week) and the
// week in play.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){},classList:{add(){},remove(){}}}),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),innerWidth:1200};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  const calls=[]; const boards={};
  sleeperFetch=async(url)=>{ calls.push(url); const m=String(url).match(/week=(\\d+)/); if(m && boards[m[1]]) return boards[m[1]]; throw new Error('no board'); };
  hasSeasonStarted=()=>true; renderSidebar=function(){ calls.push('render'); };
  return { calls, boards, order:tcStandingsOrder, results:tcSeasonResults, tie:tcBreakTie, recFrom:tcRecordFrom, TC_SEASON,
    setNv:(n)=>{ NFLVERSE=n; }, setIns:(i)=>{ TC_INSEASON=i; }, recs:()=>espnRecordCache, setStarted:(v)=>{ hasSeasonStarted=()=>v; },
    reset:()=>{ _tcResults={season:null,weeks:{},asked:{}}; _tcBoard={season:null,week:null,at:0,teams:{},busy:false,live:false}; } };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
// A game as one board event (ESPN shape) and as sidecar rows.
const ev=(home,away,hs,as,state='post')=>({competitions:[{status:{type:{state,shortDetail:state==='post'?'Final':'Sun 1:00 PM'}},competitors:[
  {homeAway:'home',team:{abbreviation:home},score:String(hs),records:[{type:'total',summary:''}]},
  {homeAway:'away',team:{abbreviation:away},score:String(as),records:[{type:'total',summary:''}]}]}]});
// The sidecar: weeks × teams rows of [off_pts, def_pts_allowed] plus the schedule.
function sidecar(games){   // games: {wk: [[home, away, hs, as], ...]}
  const weeks=Object.keys(games).map(Number).sort((a,b)=>a-b);
  const teams={}, sched={}, meta={};
  weeks.forEach((w,i)=>{ games[w].forEach(([h,a,hs,as])=>{
    [[h,a,hs,as,1],[a,h,as,hs,0]].forEach(([tm,opp,pf,pa,home])=>{
      (teams[tm]=teams[tm]||[]); while(teams[tm].length<i) teams[tm].push(null); teams[tm][i]=[pf,pa];
      (sched[tm]=sched[tm]||{})[String(w)]=opp; (meta[tm]=meta[tm]||{})[String(w)]=[opp,home,'Sun','1:00 PM',''];
    }); }); });
  Object.keys(teams).forEach(tm=>{ while(teams[tm].length<weeks.length) teams[tm].push(null); });
  return { nv:{'2026':{adv_weekly:{weeks, cols:['off_pts','def_pts_allowed'], teams}}}, ins:{schedule:sched, schedule_meta:meta} };
}
const R=(o)=>{ Object.keys(o).forEach(k=>{ app.recs()['2026:'+k]=o[k]; }); };

(async()=>{
  app.TC_SEASON.year=2026; app.TC_SEASON.phase='regular'; app.TC_SEASON.week=4;

  console.log('=== head-to-head ===');
  app.reset(); let s=sidecar({1:[['SEA','SF',20,10],['LAR','ARI',24,14]], 2:[['SF','ARI',30,3],['KC','SEA',17,16]], 3:[['DEN','SF',21,7],['SEA','LAR',21,17]]});
  app.setNv(s.nv); app.setIns(s.ins); R({SEA:'2-1',SF:'2-1',LAR:'1-2',ARI:'0-3',KC:'3-0',DEN:'2-1'});
  let res=app.results();
  chk(res.SEA && res.SEA.length===3 && res.SEA[0].opp==='SF' && res.SEA[0].pf===20 && res.SEA[0].home===true, 'results read off the sidecar: SEA\'s three games, points and home/away');
  chk(app.order(['LAR','SF','SEA','ARI']).join(',')==='SEA,SF,LAR,ARI', 'SEA and SF both 2-1: SEA beat SF → SEA leads');
  chk(app.recFrom(res.SEA).w===2 && app.recFrom(res.SEA).l===1, 'a record computed from results agrees');

  console.log('=== division record, then the restart ===');
  // SEA, SF, LAR all 2-1 and 1-1 against each other (a circle); SF also lost a division game to ARI.
  app.reset(); s=sidecar({1:[['SEA','SF',20,10],['LAR','KC',24,14]], 2:[['SF','LAR',30,3],['DEN','SEA',17,16]], 3:[['LAR','SEA',21,7],['ARI','SF',21,20]]});
  app.setNv(s.nv); app.setIns(s.ins); R({SEA:'2-1',SF:'2-1',LAR:'2-1',ARI:'1-2',KC:'2-1',DEN:'2-1'});
  chk(app.order(['LAR','SF','SEA','ARI']).join(',')==='LAR,SEA,SF,ARI', 'circle at head-to-head → division record drops SF (1-2) → LAR and SEA restart: LAR beat SEA');

  console.log('=== strength of victory ===');
  // BUF and MIA 2-1, never met, no division games, no common opponents, same conference record.
  app.reset(); s=sidecar({1:[['BUF','KC',20,10],['MIA','LV',24,14]], 2:[['BUF','DEN',30,3],['MIA','LAC',17,16]], 3:[['PIT','BUF',21,7],['BAL','MIA',21,17]]});
  app.setNv(s.nv); app.setIns(s.ins); R({BUF:'2-1',MIA:'2-1',KC:'3-0',DEN:'2-1',LV:'0-3',LAC:'1-2',PIT:'2-1',BAL:'2-1',NE:'0-3',NYJ:'0-3'});
  chk(app.order(['BUF','NE','MIA','NYJ']).join(',')==='BUF,MIA,NE,NYJ', 'BUF\'s victims (KC 3-0, DEN 2-1) outrank MIA\'s (LV 0-3, LAC 1-2): strength of victory');

  console.log('=== the sources ===');
  // The sidecar has weeks 1-2 in full and week 3 half-posted (SEA@LAR still to come); ESPN's
  // week-3 board fills it (one fetch), the week in play (4) comes from the live board.
  app.reset(); app.calls.length=0;
  s=sidecar({1:[['SEA','SF',20,10],['LAR','ARI',24,14]], 2:[['SF','ARI',30,3],['KC','SEA',17,16]], 3:[['ARI','SF',9,3]]});
  s.ins.schedule.SEA['3']='LAR'; s.ins.schedule.LAR['3']='SEA';        // scheduled, not posted
  app.setNv(s.nv); app.setIns(s.ins);
  app.boards['3']={events:[ev('ARI','SF',9,3), ev('LAR','SEA',31,10)]};
  app.boards['4']={events:[ev('SEA','ARI',27,3), ev('SF','LAR',0,0,'pre')]};
  R({SEA:'2-2',SF:'1-3',LAR:'2-1',ARI:'1-3',KC:'3-0'});
  res=app.results();
  chk(!(res.SF||[]).some(g=>g.wk===3) && app.calls.filter(u=>/week=3/.test(u)).length===1, 'a half-posted sidecar week is not trusted: the week-3 board is asked for, once');
  await wait(10); res=app.results();
  chk(res.SEA.some(g=>g.wk===3 && g.opp==='LAR' && g.pa===31) && res.SF.some(g=>g.wk===3 && g.pa===9), 'the board landed: week 3 for everyone, and the sidebar re-rendered');
  chk(app.calls.includes('render') && app.calls.filter(u=>/week=3/.test(u)).length===1, 'no second fetch for the same week');
  chk(res.SEA.some(g=>g.wk===4 && g.opp==='ARI' && g.pf===27) && !(res.SF||[]).some(g=>g.wk===4), 'the week in play: finals only, from the live board');

  console.log('=== percentage, not wins ===');
  app.reset(); s=sidecar({1:[['SEA','SF',20,10],['LAR','ARI',24,14]], 2:[['SEA','ARI',30,3],['LAR','KC',17,16]], 3:[['SEA','KC',21,7]]});
  app.setNv(s.nv); app.setIns(s.ins); R({SEA:'3-0',LAR:'2-0',SF:'0-1',ARI:'0-2',KC:'0-2'});
  chk(app.order(['LAR','SF','SEA','ARI']).join(',')==='SEA,LAR,SF,ARI' || app.order(['LAR','SF','SEA','ARI']).join(',')==='LAR,SEA,SF,ARI', '3-0 and 2-0 (bye) tie at 1.000 and go to the book, not to wins');
  // No head-to-head, LAR is 1-0 in the division and SEA 2-0 — both 1.000; common games: ARI, KC → both 2-0 (1.000) …
  // conference: both 1.000; strength of victory: SEA's (SF 0-1, ARI 0-2, KC 0-2) .000 vs LAR's (ARI, KC) .000; → points.
  chk(app.order(['LAR','SF','SEA','ARI'])[0]==='SEA', '… and the points rankings finally separate them (SEA scored more, allowed less)');

  console.log('=== yet to play ===');
  R({LV:'1-0',LAC:'0-1',KC:'0-0',DEN:'0-0'});
  chk(app.order(['KC','LAC','LV','DEN']).join(',')==='LV,KC,DEN,LAC', 'a 0-0 (Monday night still to come) lists between the 1-0 and the 0-1, in the fixed order among themselves');

  console.log('=== nothing to break ===');
  app.setStarted(false);
  chk(app.order(['LAR','SF','SEA','ARI']).join(',')==='LAR,SF,SEA,ARI' && Object.keys(app.results()).length===0, 'off-season: the fixed order, no results');
  app.setStarted(true);
  chk(app.tie(['SEA','SF'], {}, ()=>null).join(',')==='SEA,SF', 'no results at all → the fixed order');
  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
