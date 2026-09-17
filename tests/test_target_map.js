// Target map: the Routes tab's default view. Pinned: every target row becomes a mark
// at its depth and side; a catch grows its after-catch tail; a touchdown gets the ring
// AND the TD tag; a pick the red cross; a charted route (7th slot → legend) is drawn
// as a path from the line of scrimmage to the catch point instead of the dotted stem;
// the view buttons default to Map, offer Zones, and Tree only when the season has a
// charted route tree; the NGS deep link needs the ESB id.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  return { block:targetMapBlock, plays:_tmPlays, url:ngsChartUrl, link:ngsChartLink, btns:_pcardRouteViewBtns,
           view:()=>pcardTargetView, setView:setPcardTargetView, seasons:pcardRouteSeasons, setNV:(n)=>{NFLVERSE=n;},
           routePath:_tmRoutePath, qbBlock:qbPassMapBlock, qbView:()=>pcardQbView, setQbView:setPcardQbView, weekly:pcardWeeklyGames,
           rbBlock:rbCarryMapBlock, runPath:_cmRunPath, rbView:()=>pcardRbView, setRbView:setPcardRbView };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const node={pos:'WR',team:'SEA',esb:'SMI829636',
  season:{tgt:5,rec:3,yds:70,td:1},
  games:[{wk:1,opp:'NE',tgt:4,rec:2,yds:61,td:1,plays:[[6,2,1,10,63,1],[4,0,2,41,45,4],[26,1,0,0,97,2],[12,0,3,0,12,3]]},
         {wk:2,opp:'PIT',tgt:1,rec:1,yds:9,td:0,plays:[[9,1,1,3,50,1,2]]}]};
const v={label:'Week 1 · NE', tgt:4};

console.log('=== rows become marks ===');
app.setNV({'2026':{target_trees:{players:{'test receiver':node}}}});
const html=app.block('Test Receiver', node, 2026, 1, v, null);
chk(/<svg[^>]*class="qpc-svg"/.test(html) && /TEST RECEIVER TARGETS/.test(html), 'draws the field with the player + game header');
const titles=[...html.matchAll(/<title>(.*?)<\/title>/g)].map(m=>m[1]);
chk(titles.length===4, `four targets → four marks (${titles.length})`);
chk(titles[0]==='WK 1 · NE · Q3 · Left, +12 air · Intercepted' || titles.some(t=>t.includes('Intercepted')), 'the pick is named as intercepted');
chk(titles.some(t=>t==='WK 1 · NE · Q4 · Left, +4 air · Touchdown · 41 YAC (45 yds)'), 'the score reads: side, air, touchdown, YAC and total');
chk((html.match(/stroke="#39c15a" stroke-width="5"/g)||[]).length===2, 'two catches with YAC → two green tails');
chk((html.match(/stroke="#2f6fe4" stroke-width="3.5"/g)||[]).length===1 && (html.match(/>TD \+45<\/text>/g)||[]).length===1 && !/fill="#39c15a" font-size="11"[^>]*>\+45</.test(html),
    'the touchdown gets its ring AND one TD tag — a score that runs off the top carries its total in the tag, not a second label');
chk((html.match(/stroke-dasharray="3 4"/g)||[]).length===3 && (html.match(/<path d="M[^"]* C[^"]*" fill="none" stroke="#2f6fe4" stroke-width="4" stroke-linecap="round"/g)||[]).length===1,
    'without charting every mark hangs on the dotted depth stem (no invented routes) — except the score, which gets the blue lob (a cubic, up and down) from the passer');
const arcNode={games:[{wk:1,opp:'NE',plays:[[4,0,2,41,45,4,null,1,1],[30,2,2,0,40,2,null,0,0],[45,1,0,0,50,1,null,1,null],[44,1,1,3,60,2,null,1,null]]}]};
const arcs=app.block('Arc Test', arcNode, 2026, 1, {label:'Week 1 · NE'}, null);
const ds=[...arcs.matchAll(/<path d="M(-?[\d.]+),(-?[\d.]+) C(-?[\d.]+),(-?[\d.]+) -?[\d.]+,-?[\d.]+ (-?[\d.]+),(-?[\d.]+)" fill="none" stroke="#2f6fe4"/g)].map(m=>m.slice(1).map(Number));
chk(ds.length===2 && ds.every(d=>Math.abs(d[2]-d[0])<=22.01 && d[3]<d[1]), 'each scoring throw climbs out of the passer\'s hand (control above the start, a slight bow at most) before settling onto the catch');
chk(ds[0][0]<ds[1][0] && Math.abs(ds[1][0]-380)<0.6, 'an out-of-pocket throw to the left starts left of centre; a pocket throw starts centred');
chk(ds[0][1]>ds[1][1], 'a shotgun throw starts deeper than an under-centre one');
chk(arcs.includes('out of the pocket') && (arcs.match(/out of the pocket/g)||[]).length===1, 'the tooltip says when he was out of the pocket');
const tags=[...arcs.matchAll(/<text[^>]*x="([\d.]+)" y="([\d.]+)"[^>]*paint-order="stroke"[^>]*>(TD \+\d+|\+\d+)<\/text>/g)].map(m=>({x:Number(m[1]), y:Number(m[2]), t:m[3]}));
const clash=tags.some((a,i)=>tags.some((b,j)=>j>i && Math.abs(a.y-b.y)<12 && Math.abs(a.x-b.x)<a.t.length*6.6+4));
chk(tags.length===3 && !clash, 'three deep balls off the top get three tags and no two sit on each other (a tag that would, steps down a line)');
const pile={games:[{wk:1,opp:'NE',plays:[[43,1,1,0,50,1],[42,1,0,0,50,1],[45,1,2,36,50,2],[44,1,1,0,50,3]]}]};
const ph=app.block('Pile', pile, 2026, 1, {label:'Week 1 · NE'}, null);
const pt=[...ph.matchAll(/<text[^>]*x="([\d.]+)" y="([\d.]+)"[^>]*paint-order="stroke"[^>]*>(TD \+\d+|\+\d+)<\/text>/g)].map(m=>({x:Number(m[1]), y:Number(m[2]), t:m[3]}));
chk(pt.length===4 && !pt.some((a,i)=>pt.some((b,j)=>j>i && Math.abs(a.y-b.y)<12 && Math.abs(a.x-b.x)<a.t.length*6.6+4)) && new Set(pt.map(t=>Math.round(t.y))).size>=2,
    'four deep balls in one lane: the tags stack down instead of piling on the top edge');
chk(/stroke="#d33b2f" stroke-width="2\.5"/.test(html) && /M\d/.test(html), 'the interception is the red hollow with its cross');
chk(/Charted route/.test(html)===false && /routes come with the season/.test(html), 'the legend and subtitle say routes are not charted yet');

console.log('=== season view + charted routes ===');
app.setNV({'2026':{target_trees:{players:{'test receiver':node}, routes:['GO','SHALLOW CROSS/DRAG','SLANT']}}});
const all=app.plays(node, null, ['GO','SHALLOW CROSS/DRAG','SLANT']);
chk(all.length===5 && all[4].route==='SLANT' && all[0].route===null, 'season = every game; the 7th slot resolves through the legend, missing → null');
const html2=app.block('Test Receiver', node, 2026, null, {label:'Season to date',tgt:5}, null);
chk((html2.match(/<path d="M[^"]*" fill="none" stroke="#ffffff"/g)||[]).length===1 && (html2.match(/stroke-dasharray="3 4"/g)||[]).length===3,
    'the charted target is drawn as a route path to the catch point; the uncharted four keep the stem');
chk(/Charted route/.test(html2) && /with the route he ran/.test(html2), 'legend + subtitle switch once any route is charted');
chk(html2.includes('Middle, +9 air · Slant · Catch · 3 YAC (12 yds)'), 'the tooltip names the route');
const d=app.routePath('GO', 1, 380, 460, 380, 300, 10);
chk(d && d.startsWith('M380.0,460.0') && d.endsWith('L380.0,300.0'), 'a go route runs straight from the line of scrimmage to the dot');
const dig=app.routePath('IN/DIG', 2, 500, 460, 470, 380, 10);
chk(dig && dig.split(' L').length===3 && dig.endsWith('L470.0,380.0'), 'a dig keeps its three waypoints and still lands on the target');
const digL=app.routePath('IN/DIG', 0, 200, 460, 230, 380, 10), digR=app.routePath('IN/DIG', 2, 200, 460, 230, 380, 10);
chk(digL!==digR, 'a left-side target mirrors the break');

console.log('=== view buttons, seasons, deep link ===');
chk(app.view()==='map', 'Map is the default view');
chk(/active" title="Every target[^>]*>Map</.test(app.btns('map', false)) && !/Tree/.test(app.btns('map', false)), 'Map + Zones without a charted tree; no Tree button');
chk(/Tree/.test(app.btns('tree', true)) && /active[^>]*>Tree</.test(app.btns('tree', true)), 'Tree appears (and can be active) when the season has a route tree');
app.setView('zones'); chk(app.view()==='zones', 'Zones is selectable'); app.setView('bogus'); chk(app.view()==='zones', 'an unknown view is ignored'); app.setView('map');
app.setNV({'2026':{target_trees:{players:{'test receiver':node}}}, '2025':{routes:{'test receiver':{tree:{GO:3}, total:3}}}, '2024':{routes:{}}});
chk(JSON.stringify(app.seasons('test receiver'))==='["2026","2025"]', 'seasons = those with his map OR his charted tree, newest first');
chk(app.url(node,'Jaxon Smith-Njigba',2026,1)==='https://nextgenstats.nfl.com/charts/single/all/team/2026/1/jaxon-smith-njigba/SMI829636', 'week deep link: season/week/slug/esb');
chk(app.url(node,"Ja'Marr Chase",2026,null).endsWith('/2026/week/jamarr-chase/SMI829636'), 'season deep link drops the apostrophe and uses the week=all route');
chk(app.url({esb:null},'X',2026,1)==='' && app.link({esb:null},'X',2026,1)==='', 'no ESB id → no link at all');
chk(app.block('X', {games:[{wk:1,plays:[]}]}, 2026, 1, v, null).includes('next weekly bake'), 'a node without per-target rows says so instead of drawing an empty field');

console.log('=== the QB pass map ===');
const qb={team:'JAX',esb:'LAW123456',rcv:['B.Thomas','E.Engram'],
  games:[{wk:1,opp:'CLE',totals:{attempts:3},plays:[[12,2,1,4,60,1,0],[30,1,2,10,40,2,1],[8,0,0,0,70,3,null]]}]};
const q1=app.qbBlock('Trevor Lawrence', qb, 2026, 1, 'Week 1 · CLE', null);
chk(/TREVOR LAWRENCE PASSES/.test(q1) && /WEEK 1 · CLE/.test(q1), 'the QB map is titled as passes for the game');
const qt=[...q1.matchAll(/<title>(.*?)<\/title>/g)].map(m=>m[1]);
chk(qt.length===3 && qt.some(t=>t==='WK 1 · CLE · Q1 · Right, +12 air · Catch → B.Thomas · 4 YAC (16 yds)'), 'each mark names its receiver');
chk(qt.some(t=>t.includes('Touchdown → E.Engram · 10 YAC (40 yds)')) && qt.some(t=>t==='WK 1 · CLE · Q3 · Left, +8 air · Incomplete'), 'the score names its receiver; an incompletion without one stays plain');
chk(/>Complete</.test(q1) && !/>Catch</.test(q1), 'the legend reads Complete, not Catch, for a passer');
chk((q1.match(/>TD<\/text>/g)||[]).length===1, 'the touchdown gets its TD tag');
chk(app.qbView()==='map', 'Map is the passing chart\'s default view');
app.setQbView('zones'); chk(app.qbView()==='zones', 'Zones is selectable'); app.setQbView('map');
chk(app.qbBlock('X', {games:[{wk:1,plays:[]}]}, 2026, 1, 'Week 1', null).includes('next weekly bake'), 'a node without per-attempt rows says so');
app.setNV({'2025':{qb_passing_weekly:{'trevor lawrence':qb}}});
chk(Array.isArray(app.weekly('qb_passing_weekly','trevor lawrence','2025')) && app.weekly('qb_passing_weekly','nobody','2025')===null,
    'per-game chips come from any season that carries the weekly block (the offseason bakes the season just played)');

console.log('=== the RB carry map ===');
const rb={team:'KC',esb:'WAL391813',games:[{wk:1,opp:'DEN',attempts:5,plays:[[3,7,4,50,1],[1,60,1,60,2],[0,-2,8,40,3],[5,2,2,30,4],[3,4,0,25,4]]}]};
const c1=app.rbBlock('Kenneth Walker', rb, 2026, 1, 'Week 1 · DEN', null);
chk(/KENNETH WALKER CARRIES/.test(c1) && (c1.match(/<title>/g)||[]).length===5, 'five carries → five runs, titled as carries for the game');
const ct=[...c1.matchAll(/<title>(.*?)<\/title>/g)].map(m=>m[1]);
chk(ct.includes('WK 1 · DEN · Q1 · Middle · +7 yds · First down') && ct.includes('WK 1 · DEN · Q3 · Left end · -2 yds · Tackled for loss') && ct.includes('WK 1 · DEN · Q2 · Left tackle · +60 yds · Touchdown'),
    'each run names its gap, yards and what happened');
chk((c1.match(/stroke="#d33b2f" stroke-width="3.5" stroke-linecap/g)||[]).length===1 && (c1.match(/stroke="#d8a51d" stroke-width="3.5"/g)||[]).length===2 && (c1.match(/stroke="#39c15a" stroke-width="3.5"/g)||[]).length===2,
    'red for the loss, gold for 0–4, green for 5+');
chk(/>TD \+60<\/text>/.test(c1) && />FUM<\/text>/.test(c1) && (c1.match(/r="3.5" fill="#ffffff"/g)||[]).length===2, 'the score is tagged with its length off the top, the fumble is tagged, first downs (and the score) get the white cap');
chk(app.rbBlock('Kenneth Walker', rb, 2026, 1, 'Week 1 · DEN', null)===c1, 'the drawn paths are seeded: the same map every render');
const d1=app.runPath(380, 530, 300, 460, 290, 200, 60, 12345, true), d2=app.runPath(380, 530, 300, 460, 290, 200, 60, 12345, true), d3=app.runPath(380, 530, 300, 460, 290, 200, 60, 999, true);
chk(d1===d2 && d1!==d3 && /[ L]290\.0,200\.0$/.test(d1) && d1.startsWith('M') && / L290\.0,200\.0$/.test(d1), 'a run path is deterministic per seed, varies across seeds, ends exactly on its dot — and finishes with a straight segment');
chk(app.runPath(380, 530, 300, 460, 310, 480, 60, 7, false).endsWith(' 310.0,480.0'), 'a loss bends to its end without reaching the line');
chk(/Tackled for loss/.test(c1) && /Fumble lost/.test(c1) && /First down/.test(c1), 'the legend explains the carry marks');
chk(app.rbView()==='map', 'Map is the rushing fan\'s default view'); app.setRbView('fan'); chk(app.rbView()==='fan', 'Fan is selectable'); app.setRbView('map');
chk(app.rbBlock('X', {games:[{wk:1,plays:[]}]}, 2026, 1, 'Week 1', null).includes('next weekly bake'), 'a node without per-carry rows says so');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
