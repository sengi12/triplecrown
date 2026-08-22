// Roster-ownership chip: "who owns this player in my league?"
//
// Renders next to a player name wherever one appears, once a league is synced. Three things
// matter and are tested here:
//
//   1. It works identically for a Sleeper and an ESPN league. Both providers resolve rosters
//      to Sleeper player_ids before the snapshot is built, so one index serves both — if that
//      ever stops being true, these tests are where it surfaces.
//   2. It shows NOTHING for an un-owned player. Most players in most leagues are free agents;
//      badging every one of them would put noise on every row in the app.
//   3. It escapes. Team names, manager handles and player names all come from OTHER PEOPLE in
//      the league — a leaguemate can name their team `<img onerror=…>`. This is the app's most
//      direct path from attacker-controlled text to innerHTML.
const elStore = {};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');
global.FileReader=function(){};global.Range=function(){};
global.AbortController=class{constructor(){this.signal={};}abort(){}};
global.fetch=()=>Promise.reject(new Error('no network'));

const fs=require('fs'), path=require('path');
const app=new Function(fs.readFileSync(path.join(__dirname,'check.js'),'utf8')+`
  toast=function(){}; saveSession=function(){}; persistAvailable=function(){return false;};
  renderLeagueAnalyzer=function(){}; renderContent=function(){}; syncAppChrome=function(){};
  return {
    tcOwnerIndex, tcOwnerOf, tcOwnerChip, tcOwnerJump,
    setSnapshot:(s)=>{ leagueSnapshot = s; },
    getLaState:()=>laState,
    getPhase:()=>currentPhase,
  };
`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  MISS:',l);};

// A snapshot in exactly the shape both adapters produce.
function snap(provider, extra){
  return Object.assign({
    provider, leagueId:'123', season:'2026', takenAt:1000,
    myUserId:'me-1',
    teamList:[
      { rosterId:1, ownerId:'me-1', owner:'sengi12', teamName:'Who Dey',
        players:[{id:'4046', name:'Patrick Mahomes', pos:'QB'}, {id:'6794', name:'Ja’Marr Chase', pos:'WR'}] },
      { rosterId:2, ownerId:'them-2', owner:'rivalguy', teamName:'Bengal Mauler',
        players:[{id:'4881', name:'Justin Jefferson', pos:'WR'}, {id:'CIN', name:'Cincinnati D/ST', pos:'DEF', isDef:true}] },
    ],
  }, extra||{});
}

(async()=>{
  console.log('=== TEST 1: no league synced → the app looks exactly as it did ===');
  app.setSnapshot(null);
  chk(app.tcOwnerIndex()===null, 'no snapshot yields no index');
  chk(app.tcOwnerOf('4046','Patrick Mahomes')===null, 'no snapshot yields no owner');
  chk(app.tcOwnerChip('4046','Patrick Mahomes')==='', 'and renders nothing at all');

  console.log('\n=== TEST 2: a Sleeper league ===');
  app.setSnapshot(snap('sleeper'));
  const mine=app.tcOwnerOf('4046','Patrick Mahomes');
  chk(!!mine, 'a rostered player resolves');
  chk(mine && mine.teamName==='Who Dey', 'to the right team');
  chk(mine && mine.owner==='sengi12', 'with the manager handle');
  chk(mine && mine.mine===true, 'and is flagged as MY team (ownerId matches myUserId)');
  const theirs=app.tcOwnerOf('4881','Justin Jefferson');
  chk(theirs && theirs.teamName==='Bengal Mauler', 'another manager’s player resolves to them');
  chk(theirs && theirs.mine===false, 'and is not flagged as mine');
  chk(app.tcOwnerOf('9999','Nobody Rostered')===null, 'a free agent resolves to nothing');

  console.log('\n=== TEST 3: an ESPN league behaves identically ===');
  // Both adapters resolve to Sleeper ids, so the same lookups must work unchanged.
  app.setSnapshot(snap('espn', {leagueId:'1241838', takenAt:2000}));
  const e=app.tcOwnerOf('4046','Patrick Mahomes');
  chk(e && e.teamName==='Who Dey', 'the same player id resolves in an ESPN snapshot');
  chk(e && e.mine===true, 'and My Team still resolves via ownerId');
  chk(/sengi12/.test(app.tcOwnerChip('4046','Patrick Mahomes')), 'the chip renders for an ESPN league');

  console.log('\n=== TEST 4: team defenses ===');
  const def=app.tcOwnerOf('CIN','Cincinnati D/ST');
  chk(def && def.teamName==='Bengal Mauler', 'a D/ST resolves by its team-code id');

  console.log('\n=== TEST 5: the name fallback covers unresolved ESPN players ===');
  // An ESPN player we could not match to Sleeper carries a synthetic id and ESPN's spelling.
  app.setSnapshot(snap('espn', {takenAt:3000, teamList:[
    { rosterId:7, ownerId:'x', owner:'someone', teamName:'Fallback FC',
      players:[{id:'espn:999999', name:'Unmatched Player', pos:'WR', unresolved:true}] },
  ]}));
  chk(!!app.tcOwnerOf('espn:999999','Unmatched Player'), 'resolves by its synthetic id');
  chk(!!app.tcOwnerOf(null,'Unmatched Player'), 'and by name when no id is known');
  chk(!!app.tcOwnerOf(null,'unmatched  player'), 'name matching is normalised');

  console.log('\n=== TEST 6: the chip renders what each surface needs ===');
  app.setSnapshot(snap('sleeper', {takenAt:4000}));
  const full=app.tcOwnerChip('4046','Patrick Mahomes');
  const small=app.tcOwnerChip('4046','Patrick Mahomes','compact');
  chk(/tc-own-chip/.test(full), 'full variant carries the chip class');
  chk(/tc-own-mine/.test(full), 'my own player is styled differently');
  chk(/>★ sengi12</.test(full), 'full variant shows the manager handle (team names run long)');
  chk(/Who Dey/.test(full), 'the team name survives in the tooltip');
  chk(/tc-own-sm/.test(small), 'compact variant is marked compact');
  chk(/sengi12/.test(small) && !/Who Dey<\/span>/.test(small), 'compact variant shows the handle too');
  chk(/tcOwnerJump\(1\)/.test(full), 'clicking jumps to that rosterId');
  chk(/event\.stopPropagation\(\)/.test(full),
      'the click does not also fire the row/card handler it sits inside');
  chk(app.tcOwnerChip('9999','Free Agent')==='', 'an un-owned player still renders nothing');

  console.log('\n=== TEST 7: leaguemate-controlled text cannot inject markup ===');
  // A rival naming their team "<img src=x onerror=alert(1)>" is the app's shortest path from
  // someone else's input to innerHTML.
  app.setSnapshot(snap('sleeper', {takenAt:5000, teamList:[
    { rosterId:1, ownerId:'me-1', owner:'"><script>alert(1)</script>', teamName:'<img src=x onerror=alert(1)>',
      players:[{id:'4046', name:'Patrick Mahomes', pos:'QB'}] },
  ]}));
  const evil=app.tcOwnerChip('4046','Patrick Mahomes');
  chk(!/<img src=x/.test(evil), 'a script-y TEAM NAME is escaped');
  chk(!/<script>/.test(evil), 'a script-y OWNER HANDLE is escaped');
  chk(/&lt;img/.test(evil), 'it is escaped rather than stripped (name still readable)');
  chk((evil.match(/onclick=/g)||[]).length===1, 'exactly one onclick — no injected handler');
  // The property that matters is BREAKING OUT, not whether the string "onerror" survives as
  // inert text. A payload sitting harmlessly inside an escaped attribute is a pass.
  const titleVal = /title="([^"]*)"/.exec(evil);
  chk(!!titleVal, 'the title attribute is well-formed (no unescaped quote broke it)');
  chk(titleVal && !/[<>]/.test(titleVal[1]), 'no raw angle brackets survive inside it');
  chk(!/<img|<script/i.test(evil), 'no real tag is produced anywhere in the chip');

  console.log('\n=== TEST 7b: a non-numeric rosterId cannot reach the inline handler ===');
  app.setSnapshot(snap('sleeper', {takenAt:5100, teamList:[
    { rosterId:'1);alert(1);//', ownerId:'me-1', owner:'x', teamName:'Sneaky',
      players:[{id:'4046', name:'Patrick Mahomes', pos:'QB'}] },
  ]}));
  chk(app.tcOwnerChip('4046','Patrick Mahomes')==='',
      'a rosterId that is not a number renders nothing rather than injecting JS');

  console.log('\n=== TEST 8: the index tracks the snapshot, with no manual invalidation ===');
  app.setSnapshot(snap('sleeper', {takenAt:6000}));
  chk(!!app.tcOwnerOf('4046','Patrick Mahomes'), 'player is owned before the re-sync');
  // Same league, re-synced, player has been dropped.
  app.setSnapshot(snap('sleeper', {takenAt:7000, teamList:[
    { rosterId:1, ownerId:'me-1', owner:'sengi12', teamName:'Who Dey', players:[] },
  ]}));
  chk(app.tcOwnerOf('4046','Patrick Mahomes')===null,
      'after a re-sync that dropped him, he reads as a free agent (takenAt busts the cache)');
  // Switching leagues must not leak the previous league's rosters.
  app.setSnapshot(snap('sleeper', {leagueId:'999', takenAt:7000}));
  chk(!!app.tcOwnerOf('4046','Patrick Mahomes'), 'a different league rebuilds rather than reusing');
  // Looking back at an earlier season is a different roster set.
  app.setSnapshot(snap('sleeper', {season:'2024', takenAt:7000, teamList:[
    { rosterId:3, ownerId:'z', owner:'old', teamName:'Old Team',
      players:[{id:'4046', name:'Patrick Mahomes', pos:'QB'}] },
  ]}));
  chk(app.tcOwnerOf('4046','Patrick Mahomes').teamName==='Old Team',
      'a season switch rebuilds too (season is in the cache key)');

  console.log('\n=== TEST 9: malformed snapshots never throw ===');
  app.setSnapshot({provider:'espn', leagueId:'1', season:'2026', takenAt:1});
  chk(app.tcOwnerIndex()===null, 'a snapshot with no teamList yields no index');
  app.setSnapshot(snap('sleeper', {takenAt:8000, teamList:[
    { rosterId:1, ownerId:'me-1', owner:null, teamName:null, players:[null, {id:null, name:null}] },
  ]}));
  let threw=false;
  try{ app.tcOwnerChip('4046','Patrick Mahomes'); app.tcOwnerIndex(); }catch(e){ threw=true; }
  chk(!threw, 'null players, names and team names are tolerated');

  console.log(`\nRESULT: ${pass===total?'PASS':'MISS'} (${pass}/${total} checks)`);
  process.exit(pass===total?0:1);
})().catch(e=>{console.error('ERROR:',e);process.exit(1);});
