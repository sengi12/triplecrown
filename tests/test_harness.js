// Mock browser globals
global.document = {
  getElementById: () => ({ innerHTML:'', style:{}, textContent:'', value:'', classList:{add(){},remove(){}} }),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ click(){}, style:{}, appendChild(){} }),
  activeElement: null,
  body: { appendChild(){}, removeChild(){} },
};
global.window = { getSelection: ()=>({removeAllRanges(){},addRange(){}}) };
global.Chart = function(){ return {destroy(){},update(){},data:{datasets:[{}]}}; };
global.confirm = () => true;
global.btoa = s => Buffer.from(s,'binary').toString('base64');
global.FileReader = function(){};
global.Range = function(){};

// Load the code
const fs = require('fs');
let code = fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
// Remove the trailing renderSidebar() init call side effects are fine (mocked)
eval(code);

// ─── TEST 1: averageGroup correctness ───
const adams = [
  {name:'Davante Adams',team:'LAR',fantasy_position:'WR',receiving_yards:791,receiving_targets:'110.00',receiving_touchdowns:8.1,receptions:65,analyst_name:'Andy'},
  {name:'Davante Adams',team:'LAR',fantasy_position:'WR',receiving_yards:930,receiving_targets:'118.00',receiving_touchdowns:10.5,receptions:72,analyst_name:'Jason'},
  {name:'Davante Adams',team:'LAR',fantasy_position:'WR',receiving_yards:972,receiving_targets:'129.00',receiving_touchdowns:8.7,receptions:80,analyst_name:'Mike'},
];
const avg = averageGroup(adams);
console.log('TEST 1 — averageGroup:');
console.log('  rec_yards:', avg.receiving_yards.toFixed(2), '(expect 897.67)');
console.log('  targets:', avg.receiving_targets.toFixed(2), '(expect 119.00)');
console.log('  rec_tds:', avg.receiving_touchdowns.toFixed(2), '(expect 9.10)');
console.log('  receptions:', avg.receptions.toFixed(2), '(expect 72.33)');
console.log('  analyst:', avg.analyst_name);
const ok1 = Math.abs(avg.receiving_yards-897.67)<0.1 && Math.abs(avg.receiving_targets-119)<0.1 && Math.abs(avg.receiving_touchdowns-9.1)<0.01;
console.log('  RESULT:', ok1?'PASS':'FAIL');

// ─── TEST 2: single entry passthrough ───
const single = averageGroup([{name:'X',receiving_yards:500,receiving_targets:'80.00',analyst_name:'Solo'}]);
console.log('\nTEST 2 — single entry:');
console.log('  yards:', single.receiving_yards, '(expect 500)');
console.log('  RESULT:', single.receiving_yards===500?'PASS':'FAIL');

// ─── TEST 3: calcFpts ───
scoringSettings = {passing_yards_points:1,passing_yards_yardage:25,passing_touchdowns:6,
  interceptions_thrown:-2,passing_attempts:0,passing_completions:0,
  receiving_yards_points:1,receiving_yards_yardage:10,receiving_touchdowns:6,receptions:0.5,
  rushing_yards_points:1,rushing_yards_yardage:10,rushing_touchdowns:6,rushing_attempts:0,fumbles_lost:-2};
const qb = {passing_yards:5000,passing_tds:40,interceptions_thrown:10,rushing_yards:300,rushing_tds:3,
  receiving_yards:0,receiving_tds:0,receptions:0,fumbles_lost:2,passing_attempts:600,passing_completions:400,rushing_attempts:50};
const fp = calcFpts(qb);
// expect: 5000/25=200 + 40*6=240 + 10*-2=-20 + 300/10=30 + 3*6=18 + 2*-2=-4 = 464
console.log('\nTEST 3 — calcFpts QB:');
console.log('  fpts:', fp.toFixed(1), '(expect 464.0)');
console.log('  RESULT:', Math.abs(fp-464)<0.1?'PASS':'FAIL');

// ─── TEST 4: normalizeShares ───
const shares = [{share:0.5},{share:0.3},{share:0.2}];
shares[0].share = 0.8;
normalizeShares(shares,0,'share');
const sum = shares.reduce((s,p)=>s+p.share,0);
console.log('\nTEST 4 — normalizeShares (set [0]=0.8):');
console.log('  shares:', shares.map(s=>s.share.toFixed(3)).join(', '));
console.log('  sum:', sum.toFixed(4), '(expect 1.0)');
console.log('  [1]/[2] ratio preserved (3:2):', (shares[1].share/shares[2].share).toFixed(3), '(expect 1.5)');
console.log('  RESULT:', Math.abs(sum-1)<0.001 && Math.abs(shares[1].share/shares[2].share-1.5)<0.01?'PASS':'FAIL');

// ─── TEST 5: recomputeTeamRushYards ───
const state = { rushing: { total_attempts:300, ypa:4,
  shares:[{share:0.7,ypc:5.0},{share:0.3,ypc:4.0}] } };
recomputeTeamRushYards(state);
// player1: 210 att * 5 = 1050; player2: 90 att * 4 = 360; total = 1410
console.log('\nTEST 5 — recomputeTeamRushYards (70%@5.0, 30%@4.0, 300 att):');
console.log('  total_yards:', state.rushing.total_yards, '(expect ~1410)');
console.log('  team ypa:', state.rushing.ypa.toFixed(2), '(expect ~4.70)');
console.log('  RESULT:', Math.abs(state.rushing.total_yards-1410)<5?'PASS':'FAIL');

console.log('\n=== ALL TESTS COMPLETE ===');
