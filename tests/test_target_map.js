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
           routePath:_tmRoutePath };
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
chk((html.match(/stroke-dasharray="3 4"/g)||[]).length===4, 'without charting every mark hangs on the dotted depth stem (no invented routes)');
chk(/stroke="#d33b2f" stroke-width="2\.5"/.test(html) && /M\d/.test(html), 'the interception is the red hollow with its cross');
chk(/Charted route/.test(html)===false && /routes come with the season/.test(html), 'the legend and subtitle say routes are not charted yet');

console.log('=== season view + charted routes ===');
app.setNV({'2026':{target_trees:{players:{'test receiver':node}, routes:['GO','SHALLOW CROSS/DRAG','SLANT']}}});
const all=app.plays(node, null, ['GO','SHALLOW CROSS/DRAG','SLANT']);
chk(all.length===5 && all[4].route==='SLANT' && all[0].route===null, 'season = every game; the 7th slot resolves through the legend, missing → null');
const html2=app.block('Test Receiver', node, 2026, null, {label:'Season to date',tgt:5}, null);
chk((html2.match(/<path d="M[^"]*" fill="none" stroke="#ffffff"/g)||[]).length===1 && (html2.match(/stroke-dasharray="3 4"/g)||[]).length===4,
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

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
