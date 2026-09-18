// The nflverse blocks are keyed by nflverse's display name and Sleeper names its players its
// own way — "Joshua Palmer" on Sleeper is "josh palmer" in the target trees, so his Routes tab
// went missing. Pinned: the exact name wins; a first-name alias (Joshua/Josh, Matthew/Matt)
// finds the seed's key; a lone teammate with that surname and position does too; an
// ambiguous surname or a player the seed has never seen falls back to the plain name; the
// QB and RB tabs read the same resolver.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  return { setNV:(n)=>{NFLVERSE=n;}, setPlayers:(p)=>{sleeperPlayers=p;}, nameFor:tcSeedNameFor,
           routesOk:pcardRoutesAvailable, qbOk:pcardQbPassingAvailable, qbNorm:_pcardQbNorm, rbNorm:_pcardRbNorm,
           routeSeasons:pcardRouteSeasons };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const node=(team,pos)=>({team,pos,games:[{wk:1,tgt:2,plays:[]},{wk:2,tgt:3,plays:[]}]});
app.setPlayers({
  '7670':{name:'Joshua Palmer',team:'BUF',position:'WR'},
  '4046':{name:'Matthew Stafford',team:'LAR',position:'QB'},
  '9001':{name:'Keon Coleman',team:'BUF',position:'WR'},
  '9002':{name:'Dalton Kincaid',team:'BUF',position:'TE'},
  '9003':{name:'Xavier Worthy',team:'KC',position:'WR'},
  '9004':{name:'Mike Williams',team:'PIT',position:'WR'},
  '9005':{name:'DJ Moore',team:'CHI',position:'WR'},
  '9006':{name:'Bucky Irving',team:'TB',position:'RB'},
});
app.setNV({
  '2026':{ routes:null, target_trees:{players:{
      'josh palmer':node('BUF','WR'), 'keon coleman':node('BUF','WR'), 'dalton kincaid':node('BUF','TE'),
      'x worthy':node('KC','WR'), 'michael williams':node('PIT','WR'), 'maurice williams':node('PIT','WR'),
      'dj moore':node('CHI','WR') }},
    qb_passing:{'matt stafford':{attempts:70}}, rb_fan:{'rachaad white':{}} },
  '2025':{ routes:{'josh palmer':{}}, target_trees:null, qb_passing:{}, rb_fan:{'bucky irving':{}} },
});

console.log('=== a Sleeper name finds the seed\'s key ===');
chk(app.nameFor('7670')==='josh palmer', 'Joshua Palmer → "josh palmer" (first-name alias, same surname)');
chk(app.routesOk('7670')===true && app.routeSeasons('josh palmer').length===2, 'so his Routes tab is on: the 2026 target tree and the 2025 routes');
chk(app.nameFor('9001')==='keon coleman', 'an exact match is returned as is');
chk(app.nameFor('4046')==='matt stafford' && app.qbNorm('4046')==='matt stafford' && app.qbOk('4046')===true, 'Matthew Stafford → "matt stafford": the QB passing tab reads the same resolver');
chk(app.nameFor('9003')==='x worthy', 'no alias but the only KC receiver named Worthy in the trees → his key');
chk(app.nameFor('9004')==='michael williams', 'Mike Williams → "michael williams" by alias even though PIT has two Williamses');
chk(app.nameFor('9005')==='dj moore', 'punctuation-free names normalise the same on both sides');
chk(app.nameFor('9006')==='bucky irving' && app.rbNorm('9006')==='bucky irving', 'an RB keyed only in rb_fan resolves; the RB tab reads the same resolver');

console.log('=== when the seed has no such player, the plain name ===');
app.setPlayers({'1':{name:'Marquez Williams',team:'PIT',position:'WR'}, '2':{name:'Nobody Here',team:'BUF',position:'WR'}, '3':{name:'Josh Palmer',team:'',position:'WR'}, '4':{name:'',team:'BUF'}});
chk(app.nameFor('1')==='marquez williams', 'two PIT Williamses and no alias → ambiguous, stays "marquez williams"');
chk(app.nameFor('2')==='nobody here' && app.routesOk('2')===false, 'a player the seed has never seen keeps his name and has no Routes tab');
chk(app.nameFor('3')==='josh palmer', 'no team on Sleeper still resolves the exact name');
chk(app.nameFor('4')==='', 'an empty name stays empty');
app.setNV({});
chk(app.nameFor('1')==='marquez williams', 'no seed loaded at all → the plain name, no throw');
console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
