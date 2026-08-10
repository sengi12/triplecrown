// Import fixes: (1) committee QB games estimated from passing-yards share (no QB stuck at 0
// → receivers not halved), and (2) projected-roster players omitted from the import stay
// selectable at a zero baseline (mirrors copy-from-season). Uses the real projections file
// for the LV Cousins/Mendoza case, plus a synthetic team for roster preservation.
global.document={getElementById:()=>({innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){},toggle(){}},children:[],appendChild(){},insertBefore(){},setAttribute(){},removeAttribute(){},hasAttribute:()=>false}),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){},scrollTo(){},requestAnimationFrame(){}};
global.requestAnimationFrame=()=>{};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};

const fs=require('fs');const path=require('path');
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  return { loadProjections, buildPlayerList, getProj:()=>userProj, teamPassAtt, teamTargetPool, teamPassTDs,
    setSeed:(s)=>{ SEED=s; projSeed=s; seasonStatsCache['proj']=s; },
    getSeed:()=>SEED, projectQBGames, SEASON_GAMES };
`)();

let pass=0, fail=0;
const chk=(name,cond)=>{ console.log(`${cond?'RESULT: PASS':'RESULT: FAIL'} — ${name}`); cond?pass++:fail++; };

// ── TEST 1: real projections — LV committee keeps BOTH QBs active ───────────────
console.log('=== TEST: LV Cousins/Mendoza committee (real projections) ===');
const REAL='/Volumes/Linux Share/Live-Draft-Analyzer/data/triplecrown_projections.json';
if(!fs.existsSync(REAL)){
  console.log('  (real projections file not present — synthetic checks below still run)');
} else {
  const data=JSON.parse(fs.readFileSync(REAL,'utf8'));
  app.loadProjections(data);
  const lv=app.getProj()['LV'];
  const qbNames=lv.qbs.map(q=>`${q.name}(g=${q.games})`).join(', ');
  console.log('  LV QBs:', qbNames);
  const cousins=lv.qbs.find(q=>/cousins/i.test(q.name));
  const mendoza=lv.qbs.find(q=>/mendoza/i.test(q.name));
  chk('both LV QBs present', !!cousins && !!mendoza);
  chk('Cousins has games>0', cousins && cousins.games>0);
  chk('Mendoza has games>0 (was 0 before fix)', mendoza && mendoza.games>0);
  // teamPassAtt must include BOTH QBs' attempts (committee not halved)
  const bothAtt=(cousins.passing_attempts||0)+(mendoza.passing_attempts||0);
  const tpa=app.teamPassAtt(lv);
  console.log(`  teamPassAtt=${Math.round(tpa)} vs both-QB sum=${Math.round(bothAtt)}`);
  chk('teamPassAtt counts both QBs (receivers not halved)', Math.abs(tpa-bothAtt)<1);
  // receiving pool reflects both QBs
  console.log(`  LV target pool=${app.teamTargetPool(lv)} (${lv.passing_shares?lv.passing_shares.length:0} receivers)`);
  chk('LV has a receiving corps', lv.passing_shares && lv.passing_shares.length>0);
}

// ── TEST 2: roster preservation — seed player omitted from import kept at 0 ──────
console.log('\n=== TEST: projected-roster player omitted from import stays selectable ===');
// Seed a team (BUF) whose projected roster has a WR + RB the import will NOT mention.
const seed={}; ['ARI','ATL','BAL','BUF'].forEach(t=>seed[t]={QB:[],RB:[],WR:[],TE:[]});
seed.BUF.QB.push({name:'Starter QB',player_id:'q1',pos:'QB',team:'BUF',passing_yards:4000,passing_attempts:560,passing_touchdowns:30,adp_ppr:40});
seed.BUF.QB.push({name:'Backup QB',player_id:'q2',pos:'QB',team:'BUF',passing_yards:0,passing_attempts:0,passing_touchdowns:0,adp_ppr:300});
seed.BUF.WR.push({name:'Roster Only WR',player_id:'rw1',pos:'WR',team:'BUF',receiving_targets:80,receptions:55,receiving_yards:700,receiving_tds:5,adp_ppr:60});
seed.BUF.RB.push({name:'Roster Only RB',player_id:'rr1',pos:'RB',team:'BUF',rushing_attempts:120,rushing_yards:500,rushing_tds:4,adp_ppr:70});
seed.BUF.WR.push({name:'Imported WR',player_id:'iw1',pos:'WR',team:'BUF',receiving_targets:0,receptions:0,receiving_yards:0,receiving_tds:0,adp_ppr:20});
app.setSeed(seed);
// Import mentions only the QB + the "Imported WR" (targets), NOT the two roster-only players.
const imp={projections:[
  {season:'2026',analyst_name:'T',name:'BUF QB',fantasy_position:'QB',team:'BUF',player_id:'q1',passing_yards:4000,passing_attempts:560,passing_touchdowns:30,passing_completions:370,interceptions_thrown:10},
  {season:'2026',analyst_name:'T',name:'Imported WR',fantasy_position:'WR',team:'BUF',player_id:'iw1',receiving_targets:130,receptions:90,receiving_yards:1200,receiving_touchdowns:9},
]};
app.loadProjections(imp);
const buf=app.getProj()['BUF'];
const shareNames=(buf.passing_shares||[]).map(p=>p.name);
const rushNames=(buf.rushing&&buf.rushing.shares||[]).map(p=>p.name);
const qbNames2=(buf.qbs||[]).map(q=>`${q.name}(g=${q.games})`);
console.log('  BUF QBs:', qbNames2.join(', '));
console.log('  BUF receivers:', shareNames.join(', '));
console.log('  BUF rushers:', rushNames.join(', '));
chk('imported starter QB present', (buf.qbs||[]).some(q=>q.player_id==='q1'));
chk('roster-only backup QB preserved (was dropped before fix)', (buf.qbs||[]).some(q=>q.name==='Backup QB'));
const bk=(buf.qbs||[]).find(q=>q.name==='Backup QB');
chk('backup QB kept at 0 games (excluded from team totals until dialed up)', bk && bk.games===0);
chk('imported WR present with stats', shareNames.includes('Imported WR'));
chk('roster-only WR preserved (was dropped before fix)', shareNames.includes('Roster Only WR'));
chk('roster-only RB preserved (was dropped before fix)', rushNames.includes('Roster Only RB'));
const rw=(buf.passing_shares||[]).find(p=>p.name==='Roster Only WR');
chk('roster-only WR kept at ZERO baseline', rw && rw.baseline_targets===0 && rw.share===0);
const iw=(buf.passing_shares||[]).find(p=>p.name==='Imported WR');
chk('imported WR keeps real targets', iw && iw.baseline_targets===130);
chk('team target pool anchored to imported total (not QB att fallback)', app.teamTargetPool(buf)===130);

const list=app.buildPlayerList();
const iwRow=list.find(p=>p.team==='BUF' && p.name==='Imported WR');
chk('rankings keep imported WR targets exactly', iwRow && iwRow.receiving_targets===130);
chk('rankings keep imported WR receptions exactly', iwRow && iwRow.receptions===90);
chk('rankings keep imported WR yards exactly', iwRow && iwRow.receiving_yards===1200);
chk('rankings keep imported WR TDs exactly', iwRow && Math.abs(iwRow.receiving_tds-9)<0.001);

console.log(`\n=== DONE: ${pass}/${pass+fail} checks passed ===`);
if(fail>0){ console.log('RESULT: FAIL (see above)'); process.exit(1); }
