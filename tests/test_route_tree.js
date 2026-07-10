// Route tree (player-card "Routes" tab): season discovery, SVG render, backfield origin for
// Swing/Angle, ranked list, and season switching. Uses the same headless harness as test_sumer.
const _bodies={};
function mkEl(id){ if(!_bodies[id]) _bodies[id]={innerHTML:'',style:{},classList:{add(){},remove(){}}}; return _bodies[id]; }
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){}}),body:{appendChild(){}}};
global.window={};
global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  ecrNormName, ROUTE_TREE_SHAPES, ROUTE_TREE_ORDER, _routeHeat,
  pcardRouteSeasons, pcardRoutesAvailable, routeTreeSVG, routeTreeList, renderPcardRoutes, setPcardRouteSeason,
  setNflverse:(n)=>{NFLVERSE=n;}, setPlayers:(p)=>{sleeperPlayers=p;},
  setPcardState:(s)=>{pcardState=s;}, setPcardOpen:()=>{pcardOpen=true;},
  getRouteSeason:()=>pcardRouteSeason, resetRouteSeason:()=>{pcardRouteSeason=null;},
  getBody:()=>document.getElementById('pcardBody').innerHTML,
};`)();

// Fixture: Chase has 2025 + 2024 route trees (2025 includes backfield routes); 2023 has none.
const NFLVERSE={
  "2025":{routes:{ "jamarr chase":{pos:"WR", total:100, tree:{
    "HITCH/CURL":20,"GO":15,"DEEP OUT":12,"IN/DIG":9,"SCREEN":8,"POST":7,"CORNER":6,
    "SLANT":10,"QUICK OUT":5,"SWING":5,"TEXAS/ANGLE":3 }}}},
  "2024":{routes:{ "jamarr chase":{pos:"WR", total:80, tree:{
    "HITCH/CURL":25,"GO":20,"DEEP OUT":20,"SLANT":15 }}}},
  "2023":{routes:{}},
};
const PLAYERS={ "1":{name:"Ja'Marr Chase",pos:"WR"}, "2":{name:"Nobody Here",pos:"WR"} };
app.setNflverse(NFLVERSE); app.setPlayers(PLAYERS); app.setPcardOpen();

let pass=0,fail=0;
function chk(name,cond){ if(cond){pass++;console.log('  PASS',name);} else {fail++;console.log('  FAIL',name);} }

console.log('=== TEST 1: season discovery + availability ===');
chk('seasons desc, empty excluded', app.pcardRouteSeasons('jamarr chase').join(',')==='2025,2024');
chk('unknown player → no seasons', app.pcardRouteSeasons('nobody here').length===0);
chk('Chase route data available', app.pcardRoutesAvailable('1')===true);
chk('player w/o routes unavailable', app.pcardRoutesAvailable('2')===false);

console.log('\n=== TEST 2: backfield routes start behind the LOS ===');
const sw=app.ROUTE_TREE_SHAPES['SWING'], tx=app.ROUTE_TREE_SHAPES['TEXAS/ANGLE'];
chk('Swing origin = backfield', sw.o==='bf' && sw.p[0][1]<0);
chk('Angle origin = backfield', tx.o==='bf' && tx.p[0][1]<0);
const wr=app.ROUTE_TREE_SHAPES['GO'];
chk('Go origin = LOS (y=0)', wr.o==='los' && wr.p[0][1]===0);

console.log('\n=== TEST 3: SVG render ===');
const rt=NFLVERSE['2025'].routes['jamarr chase'];
const svg=app.routeTreeSVG(rt);
const nRoutes=Object.keys(rt.tree).length;
chk('valid <svg> root', svg.startsWith('<svg') && svg.trim().endsWith('</svg>'));
chk('one polyline per run route', (svg.match(/<polyline/g)||[]).length===nRoutes);
chk('one label per run route', (svg.match(/rt-label-name/g)||[]).length===nRoutes);
chk('backfield marker present (swing/angle run)', svg.includes('rt-origin-bf'));
chk('LOS + receiver origin drawn', svg.includes('rt-los') && svg.includes('rt-origin'));
// A route NOT run should not appear (Wheel absent from the fixture).
chk('unrun route omitted (Wheel)', !svg.includes('>Wheel<'));

console.log('\n=== TEST 4: heat scale ===');
chk('rare route = cool hue, hot route = warm hue',
  parseInt(app._routeHeat(0).match(/hsl\((\d+)/)[1]) > parseInt(app._routeHeat(1).match(/hsl\((\d+)/)[1]));

console.log('\n=== TEST 5: ranked list ===');
const list=app.routeTreeList(rt);
chk('one list row per route', (list.match(/rt-list-row/g)||[]).length===nRoutes);
chk('list shows Hitch 20.0%', list.includes('20.0%'));

console.log('\n=== TEST 6: tab body + season switching ===');
app.resetRouteSeason();
app.setPcardState({pid:'1', posc:'WR', isSkill:true});
const body=app.renderPcardRoutes('1');
chk('defaults to latest season (2025 active)', body.includes('rt-season-btn active') && body.includes('>2025</button>'));
chk('body has two season buttons', (body.match(/rt-season-btn/g)||[]).length===2);
chk('body embeds svg + list', body.includes('<svg') && body.includes('rt-list'));
chk('default selected season = 2025', String(app.getRouteSeason())==='2025');
app.setPcardRouteSeason('2024');
chk('switch updates selected season', String(app.getRouteSeason())==='2024');
chk('re-render wrote 2024 tree to body', app.getBody().includes('>2024</button>') && app.getBody().includes('<svg'));

console.log('\nRESULT:', fail===0 ? `PASS (${pass} checks)` : `FAIL (${fail}/${pass+fail})`);
process.exit(fail===0?0:1);
