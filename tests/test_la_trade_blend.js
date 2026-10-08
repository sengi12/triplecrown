// The tradesourced blend: the FP dynasty chart nudged toward what real Sleeper trades pay.
// 'Chart' shows FP verbatim, 'Blend' adds a confidence-weighted slice of the market delta
// (thin trade counts barely move), 'Market' adds the full delta. The tilt applies only on the
// dynasty basis and only for players the corpus covers.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[],querySelector:()=>null};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  renderLeagueAnalyzer=function(){};
  DYNASTY_VALUES={asof:'2026-09', players:{
    'jahmyr gibbs':{n:'Jahmyr Gibbs',pos:'RB',v:85},
    'marvin harrison':{n:'Marvin Harrison',pos:'WR',v:52},
    'random guy':{n:'Random Guy',pos:'WR',v:30}}, picks:{}};
  TRADE_VALUES={asof:'2026-09-28', markets:{ '1qb':{players:{
    'jahmyr gibbs':{fp:85,trade:100,n:12,pos:'RB'},
    'marvin harrison':{fp:52,trade:40,n:20,pos:'WR'}}}}};
  return { dvf:dynastyValueFor, blend:laTradeBlend, hasTrade:laHasTradeData,
    src:laValSource, setSrc:laSetValSource, pinBar:laValPinBarHTML, K:LA_TRADE_CONF_K,
    verdict:laTcVerdict, adj:laTcAdjusted, calib:laTcCalib, setCalib:(c)=>{ TRADE_VALUES.calib=c; },
    setSnap:(o)=>{ leagueSnapshot=o; } };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const near=(a,b)=>Math.abs(a-b)<1e-6;
const SC=100, K=app.K;
const dyn1qb={leagueType:2, superflex:false, tep:false};

console.log('=== the blend adds a confidence-weighted slice of the market delta ===');
app.setSnap(dyn1qb);
chk(app.src()==='blend', 'default lens is Blend');
chk(app.hasTrade(), 'the 1QB corpus covers this league');
// Gibbs: n=12 → conf = 12/(12+12) = 0.5 → 85 + (100-85)*0.5 = 92.5
chk(near(app.blend(85,'Jahmyr Gibbs','RB'), 85+(100-85)*(12/(12+K))), 'Gibbs (n=12) moves halfway to the market value');
chk(near(app.dvf('Jahmyr Gibbs','RB'), 92.5*SC), '…and dynastyValueFor scales the blended points');
// Harrison: n=20 → conf = 20/32 = 0.625 → market says LESS (40<52) → 52+(40-52)*0.625 = 44.5
chk(near(app.dvf('Marvin Harrison','WR'), 44.5*SC), 'Harrison (market cooler than chart) fades below FP');

console.log('=== Chart is FP verbatim, Market is the full delta ===');
app.setSrc('fp');
chk(app.src()==='fp' && near(app.dvf('Jahmyr Gibbs','RB'), 85*SC), 'Chart returns the FP value untouched');
chk(near(app.dvf('Marvin Harrison','WR'), 52*SC), '…for both directions');
app.setSrc('market');
chk(app.src()==='market' && near(app.dvf('Jahmyr Gibbs','RB'), 100*SC), 'Market applies the whole trade-implied value');
chk(near(app.dvf('Marvin Harrison','WR'), 40*SC), '…including the full fade');
app.setSrc('blend');

console.log('=== gated: no tilt off the corpus, or off the dynasty basis ===');
chk(near(app.dvf('Random Guy','WR'), 30*SC), 'a player the corpus never saw stays on the chart');
const dynSF={leagueType:2, superflex:true, tep:false};
app.setSnap(dynSF);
chk(!app.hasTrade(), 'no superflex corpus here → no trade data');
chk(near(app.blend(85,'Jahmyr Gibbs','RB'), 85), '…so the blend is a no-op even for a covered name');
const redraft={leagueType:0, superflex:false, tep:false};
app.setSnap(redraft);
chk(near(app.blend(85,'Jahmyr Gibbs','RB'), 85), 'the redraft/VOR basis never takes a chart tilt');

console.log('=== the Source control shows only where the blend applies ===');
app.setSnap(dyn1qb);
let bar=app.pinBar();
chk(/Source:/.test(bar) && /onclick="laSetValSource\('blend'\)"/.test(bar), 'dynasty + corpus → the Source pins render');
chk(/format-btn active" onclick="laSetValSource\('blend'\)"/.test(bar), '…with the current lens marked active');
app.setSnap(dynSF);
chk(!/Source:/.test(app.pinBar()), 'no Source control when the corpus does not cover the market');
app.setSnap(redraft);
chk(app.pinBar()==='' , 'and none at all on a redraft league');

console.log('=== the corpus calibrates the consolidation curve ===');
app.setSnap(dyn1qb); app.setSrc('blend');
chk(app.calib()===null && near(app.adj([100,60]), 100+60*.75), 'no calibration in the seed → the constants (second asset at 75%)');
app.setCalib({stud:0.4, w2:0.85, n:500});
chk(app.calib() && near(app.adj([100,60]), 100+60*.85), 'with one, the second asset weighs what the market pays (85%)');
const vc=app.verdict([100],[70,40]);
chk(near(vc.effA, 100+(100-70)*0.4) && near(vc.effB, 70+40*.85), 'and the stud premium is the fitted one (40% of the gap)');
app.setSrc('fp');
chk(app.calib()===null && near(app.adj([100,60]), 145), 'the Chart lens keeps the constants');
app.setSrc('blend'); app.setSnap(redraft);
chk(app.calib()===null, 'so does a redraft league');
app.setSnap(dyn1qb); app.setCalib({stud:0.4, w2:0.85, n:40});
chk(app.calib()===null, 'a calibration from too few trades is ignored');
app.setCalib({stud:3, w2:0.85, n:500});
chk(app.calib()===null, 'and one outside the bounds');
app.setCalib(null);

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
