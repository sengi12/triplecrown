// ═══════════════════════════════════════════════════════════════════════════
// Session persistence under storage pressure.
//
// Regression cover for the silent-data-loss bug: undoStacks were persisted in full
// (40 deep-copied snapshots per team, each holding BOTH the working set and the
// proj-seed roster row). Past ~8 edited teams the payload crossed the ~5MB
// localStorage quota, setItem threw, the catch swallowed it, and from that moment
// the user's PROJECTIONS stopped being saved with no indication at all.
//
// The fix: persist only the newest UNDO_PERSIST_LIMIT snapshots per team, and on a
// quota rejection shed optional state (undo history, then the league snapshot) and
// retry rather than giving up. Also covers memoizing persistAvailable(), which used
// to do a blocking setItem+removeItem on every slider `oninput` tick.
// ═══════════════════════════════════════════════════════════════════════════

// Mock localStorage with a settable byte budget so we can force a quota rejection.
let QUOTA = Infinity;
let probeCount = 0;          // counts the persistAvailable() write-probe
const _store = {};
global.localStorage = {
  getItem: k => (k in _store ? _store[k] : null),
  setItem: (k, v) => {
    const s = String(v);
    if (k === '__tc_test__') probeCount++;
    else if (s.length > QUOTA) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
    _store[k] = s;
  },
  removeItem: k => { delete _store[k]; },
};

const elStore = {};
function mkEl(id){ if(!elStore[id]) elStore[id]={innerHTML:'',style:{},value:'',dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){},focus(){},blur(){}}; return elStore[id]; }
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){},click(){}}),body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){}}};
global.confirm=()=>true; global.btoa=s=>s; global.FileReader=function(){}; global.Range=function(){};
global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.fetch=()=>Promise.reject(new Error('no net'));
global.setTimeout=(fn)=>{fn();return 0;}; global.clearTimeout=()=>{};

const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  saveSession, loadSession, clearSession, persistAvailable,
  setReady:(b)=>{_persistReady=b;},
  setWorking:(w)=>{workingProj=w; userProj=w;},
  setUndo:(u)=>{undoStacks=u;}, getUndo:()=>undoStacks,
  setLeagueSnapshot:(s)=>{leagueSnapshot=s;},
  resetWarned:()=>{_persistWarned=false;},
  getStoreKey:()=>TC_STORE_KEY, UNDO_PERSIST_LIMIT, UNDO_LIMIT, PROJ:PROJ_SEASON };
`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

// Build a realistically chunky undo stack: `teams` teams x `depth` snapshots.
function bigUndo(teams, depth){
  const out={};
  for(let t=0;t<teams;t++){
    const code='T'+t;
    out[code]=[];
    for(let d=0;d<depth;d++){
      out[code].push({
        working:{QB:[{name:'QB'+d,games:17,passing_yards:4000+d,passing_tds:30}],
                 WR:Array.from({length:6},(_,i)=>({name:'WR'+i,targets:120+d,rec:80,rec_yards:1100,rec_tds:8}))},
        seed:{QB:[{name:'QB'+d,passing_yards:4000}],
              WR:Array.from({length:6},(_,i)=>({name:'WR'+i,targets:120,rec_yards:1100}))},
      });
    }
  }
  return out;
}

app.setReady(true);
app.setWorking({CIN:{QB:[{name:'Burrow',games:17,passing_yards:4800}]}});

console.log('=== persisted undo depth is capped well below the in-session depth ===');
chk(app.UNDO_PERSIST_LIMIT < app.UNDO_LIMIT, 'UNDO_PERSIST_LIMIT ('+app.UNDO_PERSIST_LIMIT+') < UNDO_LIMIT ('+app.UNDO_LIMIT+')');
app.setUndo(bigUndo(3, app.UNDO_LIMIT));
app.saveSession();
let saved = app.loadSession();
chk(saved !== null, 'session saved with a full undo stack');
chk(saved.undoStacks.T0.length === app.UNDO_PERSIST_LIMIT,
    'only the newest '+app.UNDO_PERSIST_LIMIT+' snapshots are persisted (was '+app.UNDO_LIMIT+')');
chk(app.getUndo().T0.length === app.UNDO_LIMIT,
    'in-session undo depth is NOT truncated by saving');
// The newest snapshot must be the one kept — undo pops from the end.
chk(saved.undoStacks.T0[saved.undoStacks.T0.length-1].working.QB[0].name === 'QB'+(app.UNDO_LIMIT-1),
    'the snapshots kept are the newest ones, in order');

console.log('=== over quota: projections still save, undo history is shed ===');
// Measure a bare payload (no undo) first so the budget can be set precisely between
// "base fits" and "base + even the TRIMMED undo history fits".
app.clearSession();
app.setUndo({});
app.saveSession();
const baseLen = String(global.localStorage.getItem(app.getStoreKey())).length;
app.clearSession();
app.resetWarned();
app.setUndo(bigUndo(8, app.UNDO_LIMIT));
QUOTA = baseLen + 100;   // room for the projections, nowhere near enough for undo snapshots
app.saveSession();
saved = app.loadSession();
chk(saved !== null, 'a session was still written when the full payload exceeded quota');
chk(saved.workingProj && saved.workingProj.CIN.QB[0].name === 'Burrow',
    'working projections survived the degraded save (the actual bug)');
chk(!saved.undoStacks, 'undo history was shed to make room');

console.log('=== hard quota: nothing fits, but we never claim success ===');
app.clearSession();
app.resetWarned();
QUOTA = 10;   // nothing will fit
app.setUndo(bigUndo(2, 4));
app.saveSession();
chk(app.loadSession() === null, 'no partial or corrupt session left behind when no tier can be written');

console.log('=== persistAvailable() is probed once, not per edit ===');
QUOTA = Infinity;
probeCount = 0;
for(let i=0;i<50;i++) app.persistAvailable();
chk(probeCount === 0, 'repeat persistAvailable() calls do no storage writes (memoized; '+probeCount+' probes over 50 calls)');
chk(app.persistAvailable() === true, 'and it still reports storage as available');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
process.exit(pass===total?0:1);
