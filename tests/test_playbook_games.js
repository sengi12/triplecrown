// ═══════════════════════════════════════════════════════════════════════════
// The playsheet adds a season up from rows, and can add up one game.
//
// The coaching payload used to ship a precomputed bucket for every
// down × distance-to-sticks × play-type combination — ~80 per team, each
// repeating every formation's totals. It now ships ONE ROW PER PLAY and the
// app adds up whichever rows the filters select. That is 44% smaller on the
// 2025 season (2.13 MB → 1.19 MB) and, because the rows carry the week, the
// same code answers "week 2 at Buffalo" — which precomputed buckets could
// never do without multiplying the payload by every week in the season.
//
// _schemeAggregate is the single implementation: the app builds its season
// grid with it, and its SOURCE is injected into the playsheet's iframe so the
// game filter cannot drift from it. This pins the arithmetic, the filters, the
// game filter, the deterministic tie-breaks, and the fallback for payloads
// baked before the rows existed.
// ═══════════════════════════════════════════════════════════════════════════
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};
global.AbortController=class{constructor(){this.signal={}}abort(){}};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs'), path=require('path');
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  return { agg:_schemeAggregate, node:_schemeNode, fv:_schemeBuildFvCalc };
`)();
let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

// rows: [set, week, down, ydstogo, flags, epa×1000, success, yards, td, lane]
// flags: 1 pass · 2 play-action · 4 motion · 8 no-huddle · 16 red zone
const SIGS=['11|gun|3|1|1|5','12|uc|2|2|1|5'];
const LANES=['LE','LT','LG','MID','RG','RT','RE'];
const R=[
  // week 1 — four plays out of the 11 set, one out of 12
  [0,1,1,10, 1|2,  500,1, 12,0,-1],   // 1st & 10, play-action pass, +12
  [0,1,2, 6, 1,   -200,0,  0,0,-1],   // 2nd & 6, pass, incomplete
  [0,1,3, 2, 0,    300,1,  4,0, 3],   // 3rd & 2, run up the middle, +4
  [0,1,1,10, 0|16, 100,1,  2,2, 5],   // 1st & 10 in the red zone, rushing TD right tackle
  [1,1,2, 9, 1|4,  800,1, 25,1,-1],   // 12 personnel, motion pass TD
  // week 2 — two plays, both out of the 11 set
  [0,2,1,10, 1,    400,1, 10,0,-1],
  [0,2,3,12, 0,   -500,0, -1,0, 0],   // 3rd & long run for a loss, left end
];
const sel=(o)=>Object.assign({down:'all',dist:'all',type:'all',wk:0}, o);

console.log('=== the whole season ===');
const all=app.agg(R,SIGS,LANES,sel({}));
chk(all.total===7, 'every row counts toward the total');
chk(all.groups.length===2 && all.groups[0].sig===SIGS[0] && all.groups[0].n===6, 'sets are ranked by snaps, the 11 set leading with six');
const g0=all.groups[0];
chk(g0.share===85.7 && g0.pass_rate===50, 'share and pass rate are percentages of the set\'s own snaps');
chk(g0.np===3 && g0.nr===3, 'pass and run counts split on the row\'s own flag');
chk(g0.py===22 && g0.ry===5, 'yards are summed per side: 12+0+10 passing, 4+2+-1 rushing');
chk(g0.ptd===0 && g0.rtd===1, 'a touchdown counts to the side that scored it');
chk(all.groups[1].ptd===1 && all.groups[1].py===25, 'the 12 set has the passing score');
chk(Math.abs(g0.epa-0.1)<0.0005, 'EPA per play is the mean over the set\'s rows');
chk(JSON.stringify(g0.lanes)===JSON.stringify([['LE',1,-0.5],['MID',1,0.3],['RT',1,0.1]]),
    'run lanes carry their count and EPA, ties broken by name so the top three never depend on row order');

console.log('=== the filters ===');
chk(app.agg(R,SIGS,LANES,sel({down:'1'})).total===3, 'a down filter keeps only that down');
chk(app.agg(R,SIGS,LANES,sel({dist:'short'})).total===1, 'short is 1 to 3 to go');
chk(app.agg(R,SIGS,LANES,sel({dist:'long'})).total===5, 'long is 8 or more');
chk(app.agg(R,SIGS,LANES,sel({type:'pa'})).total===1 && app.agg(R,SIGS,LANES,sel({type:'motion'})).total===1,
    'play-action and motion read their own bits, not each other\'s');
chk(app.agg(R,SIGS,LANES,sel({type:'redzone'})).total===1, 'the red-zone bit filters too');
chk(app.agg(R,SIGS,LANES,sel({down:'1',dist:'long',type:'pa'})).total===1, 'filters combine');
chk(app.agg(R,SIGS,LANES,sel({down:'4'})).groups.length===0, 'a situation that never happened comes back empty, not broken');

console.log('=== one game ===');
const w1=app.agg(R,SIGS,LANES,sel({wk:1})), w2=app.agg(R,SIGS,LANES,sel({wk:2}));
chk(w1.total===5 && w2.total===2, 'a game filter keeps only that week');
chk(w1.total+w2.total===all.total, 'and the weeks add back up to the season');
chk(w2.groups.length===1 && w2.groups[0].n===2 && w2.groups[0].share===100,
    'share is of the games shown, so one game\'s only set reads 100%');
chk(app.agg(R,SIGS,LANES,sel({wk:2, down:'3'})).total===1, 'a game combines with the other filters');
chk(app.agg(R,SIGS,LANES,sel({wk:9})).total===0, 'a week with no plays is empty');

console.log('=== the app builds its grid from the same rows ===');
const built=app.fv({season:'2025', data:{plays:R, sigs:SIGS, lanes:LANES, formations:{}, games:[[1,'CLE'],[2,'JAX']]}});
chk(built.data.all.all.all.total===7 && built.data['1'].all.all.total===3, 'every down × distance × type cell is filled from the rows');
chk(built.data.all.short.all.total===1 && built.data.all.all.pa.total===1, 'including the combinations the builder used to precompute');
chk(Array.isArray(built.plays) && built.games.length===2, 'the rows and the game list ride along for the playsheet');

console.log('=== payloads baked before the rows still work ===');
const legacy=app.fv({season:'2024', data:{formations:{}, views:{all:{all:{all:{total:4, groups:[{sig:'x', n:4, share:100}]}}}}}});
chk(legacy.data.all.all.all.total===4, 'a bucket payload decodes through the old path');
chk(legacy.plays===null, 'and offers no game filter, because it has no rows');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
