// TC model row on the player card: seed lookup + index invalidation, the Sleeper-vs-model
// comparison markup, the agree/disagree chip thresholds, and — as with every additive seed
// block — that a player without a `tc` entry (every rookie, every pre-tcproj seed) renders
// nothing rather than erroring.
const _bodies={};
function mkEl(id){ if(!_bodies[id]) _bodies[id]={innerHTML:'',style:{},classList:{add(){},remove(){}}}; return _bodies[id]; }
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){}}),body:{appendChild(){}}};
global.window={};
global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  tcModelRec, renderTcModel, tcModelDelta, TC_MD_AGREE_PCT, TC_INFO_BOOK,
  setSeed:(s)=>{SEED=s;}, setPcardState:(s)=>{pcardState=s;},
};`)();

let passed=0, failed=0;
function chk(c,label){ if(c){passed++;console.log('  PASS:',label);}else{failed++;console.log('  FAIL:',label);} }

const SEED_FIX={
  KC:{RB:[{name:'Vet Back', player_id:'1001', pos:'RB', team:'KC',
           tc:{fpg:13.2, base:15.4, in:{yr:2025,g:16,fpg:14.5,xfpg:13.1,tdoe:2.4,age:27,mv:1}}}],
      WR:[{name:'Agree Guy', player_id:'1002', pos:'WR', team:'KC',
           tc:{fpg:12.1, base:12.0, in:{yr:2025,g:17,fpg:12.3,xfpg:12.0,tdoe:0.2,age:25,mv:0}}},
          {name:'Model Darling', player_id:'1003', pos:'WR', team:'KC',
           tc:{fpg:17.0, base:13.5, in:{yr:2025,g:15,fpg:18.8,xfpg:17.2,tdoe:-0.3,age:25,mv:0}}}],
      TE:[{name:'Rookie Tight', player_id:'2001', pos:'TE', team:'KC'}]},
  SF:{RB:[{name:'No Base', player_id:'1004', pos:'RB', team:'SF', tc:{fpg:9.0, base:null, in:{yr:2025,g:10,fpg:8.0}}}],
      QB:[{name:'Backup QB', player_id:'1005', pos:'QB', team:'SF',
           tc:{fpg:15.3, base:0.8, in:{yr:2025,g:10,fpg:12.6,xfpg:15.3,tdoe:-14.5,age:32,mv:0}}}]},
};
app.setSeed(SEED_FIX);

console.log('=== lookup ===');
chk(app.tcModelRec('1001') && app.tcModelRec('1001').name==='Vet Back', 'finds a player by pid across teams/positions');
chk(app.tcModelRec('2001')===null, 'player without a tc block is not indexed');
chk(app.tcModelRec('9999')===null, 'unknown pid -> null');

console.log('=== render: disagree low ===');
const low=app.renderTcModel('1001');
chk(low.includes('TC MODEL'), 'row carries the TC MODEL label');
chk(low.includes('15.4') && low.includes('13.2'), 'shows Sleeper baseline and model FPG');
chk(low.includes('PPR/G'), 'unit is explicit (PPR per game)');
chk(low.includes('tc-md-dn') && low.includes('▼'), 'model-below-baseline gets the down chip');
chk(low.includes('14%'), 'chip carries the percent gap (13.2 vs 15.4 ≈ −14%)');

console.log('=== render: agree band ===');
const eq=app.renderTcModel('1002');
chk(eq.includes('tc-md-eq') && eq.includes('agrees'), 'within ±6% -> the ≈ agrees chip');
chk(!eq.includes('tc-md-up') && !eq.includes('tc-md-dn'), 'no directional chip inside the agree band');

console.log('=== render: disagree high ===');
const hi=app.renderTcModel('1003');
chk(hi.includes('tc-md-up') && hi.includes('▲'), 'model-above-baseline gets the up chip');
chk(hi.includes('+26%'), '17.0 vs 13.5 reads +26%');

console.log('=== render: degradation ===');
chk(app.renderTcModel('2001')==='', 'no tc block -> empty string (rookies)');
chk(app.renderTcModel('9999')==='', 'unknown player -> empty string');
const nb=app.renderTcModel('1004');
chk(nb.includes('9.0') && !nb.includes('tc-md-chip'), 'missing baseline: model number alone, no chip');
chk(!nb.includes('Sleeper <b>'), 'missing baseline: no dangling "Sleeper" value');
const bk=app.renderTcModel('1005');
chk(bk.includes('per-game read') && !bk.includes('▲'), 'deep-bench baseline: basis tag instead of a nonsense percent chip');
chk(bk.includes('0.8') && bk.includes('15.3'), 'deep-bench row still shows both numbers');

console.log('=== delta math ===');
chk(Math.abs(app.tcModelDelta({fpg:11,base:10})-0.1)<1e-9, 'delta is (model-base)/base');
chk(app.tcModelDelta({fpg:11,base:null})===null, 'null base -> null delta');
chk(app.tcModelDelta({fpg:11,base:0})===null, 'zero base -> null delta (no divide-by-zero)');
chk(app.TC_MD_AGREE_PCT>0 && app.TC_MD_AGREE_PCT<0.2, 'agreement band is a sane small threshold');

console.log('=== league-scoring conversion (the Burrow unit fix) ===');
// A 6-pt-pass-TD QB: stat line worth ~372 league pts (21.9/g) vs PPR base 18.1.
app.setSeed({CIN:{QB:[{name:'Franchise QB', player_id:'4001', pos:'QB', team:'CIN',
  passing_yards:4500, passing_touchdowns:32, interceptions_thrown:10, rushing_yards:150, rushing_tds:2,
  receptions:0, receiving_yards:0, receiving_tds:0,
  tc:{fpg:16.9, base:18.1, in:{yr:2025,g:8,fpg:16.8,age:29,mv:0}}}]}});
const q=app.renderTcModel('4001');
chk(q.includes('your scoring'), 'row converts to the league scoring unit');
chk(q.includes('22.3'), 'seed-schema passing TDs are counted (4500/25 + 32×6 − 20 + 15 + 12 = 379 → 22.3/g)');
chk(!q.includes('>16.9<') && !q.includes('>18.1<'), 'raw PPR numbers no longer shown as the headline');
chk(q.includes('▼') && q.includes('7%'), 'the percent verdict is unit-invariant (16.9/18.1 ≈ −7%)');
const q2=(()=>{ // no stat line -> falls back to PPR display
  app.setSeed({CIN:{QB:[{name:'No Line', player_id:'4002', pos:'QB', team:'CIN',
    tc:{fpg:16.9, base:18.1, in:{yr:2025,g:8}}}]}});
  return app.renderTcModel('4002'); })();
chk(q2.includes('PPR/G') && q2.includes('16.9'), 'no stat line -> honest PPR fallback');

console.log('=== rookie tc blocks ===');
app.setSeed({ARI:{RB:[{name:'First Round Rook', player_id:'5001', pos:'RB', team:'ARI',
  rushing_yards:900, rushing_tds:5, receptions:45, receiving_yards:350, receiving_tds:2,
  tc:{fpg:9.4, base:10.2, in:{rk:1, pick:3, prob:0.62}}}]}});
const rk1=app.renderTcModel('5001');
chk(rk1.includes('TC MODEL') && rk1.includes('your scoring'), 'rookie tc block renders the row with league conversion');
app.setPcardState({pid:'5001'});
const rkInfo=app.TC_INFO_BOOK.tcmodel.body();
chk(rkInfo.includes('Rookie projection') && rkInfo.includes('pick 3') && rkInfo.includes('62%'),
  'ⓘ explains the rookie basis with pick + prospect probability');
chk(rkInfo.includes('bust risk'), 'ⓘ states the bust-risk-included basis');

console.log('=== index invalidation on seed swap ===');
app.setSeed({KC:{RB:[{name:'New Guy', player_id:'3001', pos:'RB', tc:{fpg:10, base:10, in:{yr:2025,g:17,fpg:10}}}]}});
chk(app.tcModelRec('3001') && app.tcModelRec('1001')===null, 'swapping SEED rebuilds the index');

console.log('=== info book ===');
chk(!!app.TC_INFO_BOOK.tcmodel && typeof app.TC_INFO_BOOK.tcmodel.body==='function', 'ⓘ entry registered with a dynamic body');
app.setSeed(SEED_FIX); app.setPcardState({pid:'1001'});
const info=app.TC_INFO_BOOK.tcmodel.body();
chk(info.includes('2025 inputs') && info.includes('changed teams'), "ⓘ body explains THIS player's inputs");
chk(info.includes('PPR'), 'ⓘ body states the scoring basis');
app.setPcardState({pid:'9999'});
chk(app.TC_INFO_BOOK.tcmodel.body().includes('trained on every NFL season'), 'ⓘ body still explains the model with no player context');

console.log(`\nRESULT: ${passed}/${passed+failed} ${failed===0?'ALL PASS':'SOME FAILED'}`);
process.exit(failed===0?0:1);
