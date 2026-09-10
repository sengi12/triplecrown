// Next Gen Stats · live strip: the free in-season stand-in under each chart.
// Pinned: renders from NFLVERSE[season].ngs_weekly for the chart's selected
// game or the season line; tiles color against the league median with the
// right direction per stat; nothing renders without the block, for the
// wrong kind, or for a game NGS didn't publish.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  return { strip:pcardNgsStrip, setNV:(n)=>{NFLVERSE=n;}, adopt:_adoptInseason, sections:_INSEASON_NV_SECTIONS };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const NGS={
  players:{
    'jaxon smithnjigba':{pos:'WR',team:'SEA',kind:'rec',
      season:{sep:3.09,cush:6.18,iay:7.28,share:54.5,yac_oe:4.34,tgt:11,rec:8,yds:122,td:1,catch:72.7},
      games:[{wk:1,sep:3.09,cush:6.18,iay:7.28,share:54.5,yac_oe:4.34,tgt:11,rec:8,yds:122}]},
    'drake maye':{pos:'QB',team:'NE',kind:'qb',season:{ttt:2.61,cpoe:-3.2,agg:18.1,sticks:-1.2,cay:5.9,att:33},
      games:[{wk:1,ttt:2.61,cpoe:-3.2,agg:18.1,sticks:-1.2,cay:5.9,att:33}]},
    'rhamondre stevenson':{pos:'RB',team:'NE',kind:'rb',season:{ryoe:0.8,eff:3.4,box8:22.2,tlos:2.9,att:18},games:[]},
  },
  lg:{ rec:{sep:2.8,cush:6.0,yac_oe:0.2,share:25,iay:8.5}, qb:{ttt:2.7,cpoe:0,agg:16,sticks:-0.5,cay:6}, rb:{ryoe:0,eff:3.6,box8:20,tlos:2.8} },
};

console.log('=== the sidecar section merges like the rest ===');
chk(app.sections.includes('ngs_weekly'), 'ngs_weekly is an in-season section');
app.setNV({'2025':{}});
app.adopt({season:2026, weeks:[1], nflverse:{'2026':{ngs_weekly:NGS}}});

console.log('=== receiver strip ===');
let h=app.strip('rec','jaxon smithnjigba','2026',null);
chk(/NEXT GEN · live/.test(h), 'the badge names the source');
chk(/season · 11 tgt/.test(h), 'season scope + volume');
chk(/Separation<\/label><b><span class="note-tag-hit"[^>]*data-note-source="ngs_live"[^>]*>3.09<\/span><\/b><small>lg 2.80/.test(h), 'separation reads against the league median — and is taggable');
chk(/ngs-good"[^>]*title="[^"]*separation/i.test(h) || /ngs-tile ngs-good[^>]*>\s*<label>Separation/.test(h), 'above-median separation is good (hi)');
chk(/ngs-tile ngs-bad[^>]*>\s*<label>aDOT/.test(h)===false, 'aDOT has no direction → never colored');
h=app.strip('rec','jaxon smithnjigba','2026',1);
chk(/Wk 1 · 11 tgt/.test(h), 'the chart\'s game chip selects the game line');
chk(app.strip('rec','jaxon smithnjigba','2026',2)==='', 'a game NGS has not published renders nothing');

console.log('=== passer + rusher strips ===');
h=app.strip('qb','drake maye','2026',1);
chk(/Time to Throw<\/label><b><span[^>]*>2.61s/.test(h) && /CPOE<\/label><b><span[^>]*>-3.2%/.test(h), 'QB tiles format seconds and percents');
chk(/ngs-tile ngs-bad[^>]*>\s*<label>CPOE/.test(h), 'below-median CPOE is bad (hi)');
h=app.strip('rb','rhamondre stevenson','2026',null);
chk(/ngs-tile ngs-good[^>]*>\s*<label>Efficiency/.test(h), 'lower efficiency is good (lo)');
chk(/ngs-tile ngs-good[^>]*>\s*<label>RYOE/.test(h), 'positive RYOE is good');
chk(app.strip('rb','rhamondre stevenson','2026',1)==='', 'no per-game row for him yet → nothing');

console.log('=== honest absences ===');
chk(app.strip('qb','jaxon smithnjigba','2026',null)==='', 'wrong kind for the player → nothing');
chk(app.strip('rec','jaxon smithnjigba','2025',null)==='', 'a frozen season without the block → nothing');
chk(app.strip('rec','nobody here','2026',null)==='', 'unknown player → nothing');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
