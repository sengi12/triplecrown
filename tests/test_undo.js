const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  assembleSeed, normalizeSleeperRow, ensureTeam, initPassingShares, handleSliderKey,
  pushUndo, undoTeam, canUndo, clearUndoCoalesce,
  setSEED:(s)=>{SEED=s;projSeed=s;seasonStatsCache.proj=s;workingProj={};userProj=workingProj;activeSeason='proj';},
  selectTeam:t=>{currentTeam=t;ensureTeam(t);initPassingShares(t);},
  getProj:()=>userProj, getCurrentTeam:()=>currentTeam,
  setCurrentTeam:(t)=>{currentTeam=t;},
  getUndoDepth:(t)=>{const s=userProj[t];return s;} };
`)();

const players={q:{player_id:'q',name:'QB',pos:'QB',team:'KC'},
  a:{player_id:'a',name:'WR A',pos:'WR',team:'KC'},b:{player_id:'b',name:'WR B',pos:'WR',team:'KC'}};
const idx={q:app.normalizeSleeperRow({player_id:'q',team:'KC',position:'QB',stats:{pass_yd:4500,pass_att:600,pass_cmp:430,pass_td:35,gp:17}}),
  a:app.normalizeSleeperRow({player_id:'a',team:'KC',position:'WR',stats:{rec:100,rec_yd:1300,rec_td:10,rec_tgt:150,gp:17}}),
  b:app.normalizeSleeperRow({player_id:'b',team:'KC',position:'WR',stats:{rec:60,rec_yd:700,rec_td:5,rec_tgt:90,gp:17}})};
app.setSEED(app.assembleSeed(players,idx));
app.selectTeam('KC');
app.setCurrentTeam('KC');

console.log('=== TEST 1: undo restores prior share ===');
const st=app.getProj()['KC'];
const origShare=st.passing_shares[0].share;
console.log('Original WR A share:', (origShare*100).toFixed(1)+'%');
// snapshot, then change
app.pushUndo('KC','test-edit-1');
st.passing_shares[0].share=0.80; // manually change
console.log('After change:', (st.passing_shares[0].share*100).toFixed(1)+'%');
console.log('canUndo:', app.canUndo('KC'));
app.undoTeam('KC');
const restored=app.getProj()['KC'].passing_shares[0].share;
console.log('After undo:', (restored*100).toFixed(1)+'%');
console.log('RESULT:', Math.abs(restored-origShare)<0.001?'PASS (restored original)':'FAIL');

console.log('\n=== TEST 2: multi-step undo ===');
const st2=app.getProj()['KC'];
app.pushUndo('KC','step-a'); st2.passing_shares[0].share=0.50;
app.clearUndoCoalesce();
app.pushUndo('KC','step-b'); st2.passing_shares[0].share=0.60;
app.clearUndoCoalesce();
app.pushUndo('KC','step-c'); st2.passing_shares[0].share=0.70;
console.log('Current:', (st2.passing_shares[0].share*100).toFixed(0)+'%','(stacked 3 changes)');
app.undoTeam('KC');
console.log('Undo 1:', (app.getProj()['KC'].passing_shares[0].share*100).toFixed(0)+'% (expect 60)');
app.undoTeam('KC');
console.log('Undo 2:', (app.getProj()['KC'].passing_shares[0].share*100).toFixed(0)+'% (expect 50)');
const v=app.getProj()['KC'].passing_shares[0].share;
console.log('RESULT:', Math.abs(v-0.50)<0.001?'PASS (stepped back through history)':'FAIL');

console.log('\n=== TEST 3: undo is per-team (KC undo does not affect SF) ===');
const players2={q2:{player_id:'q2',name:'SF QB',pos:'QB',team:'SF'},w:{player_id:'w',name:'SF WR',pos:'WR',team:'SF'}};
const idx2={q2:app.normalizeSleeperRow({player_id:'q2',team:'SF',position:'QB',stats:{pass_yd:4000,pass_att:550,pass_cmp:380,pass_td:28,gp:17}}),
  w:app.normalizeSleeperRow({player_id:'w',team:'SF',position:'WR',stats:{rec:90,rec_yd:1200,rec_td:8,rec_tgt:130,gp:17}})};
// add SF to SEED
const seedAll=app.assembleSeed(Object.assign({},players,players2),Object.assign({},idx,idx2));
app.setSEED(seedAll);
app.selectTeam('SF'); app.setCurrentTeam('SF');
const sf=app.getProj()['SF'];
const sfOrig=sf.passing_shares[0].share;
app.pushUndo('SF','sf-edit'); sf.passing_shares[0].share=0.99;
// KC should have NO undo history now (fresh SEED). SF has 1.
console.log('SF canUndo:', app.canUndo('SF'), '| KC canUndo:', app.canUndo('KC'));
app.undoTeam('SF');
console.log('SF restored:', Math.abs(app.getProj()['SF'].passing_shares[0].share-sfOrig)<0.001?'yes':'no');
console.log('RESULT:', app.canUndo('SF')===false?'PASS (per-team isolation)':'FAIL');

console.log('\n=== TEST 4: dedup identical snapshots ===');
app.selectTeam('SF'); app.setCurrentTeam('SF');
const before=app.canUndo('SF');
app.pushUndo('SF','noop1'); app.clearUndoCoalesce();
app.pushUndo('SF','noop2'); // no change between → should dedup
console.log('canUndo after 2 no-op snapshots:', app.canUndo('SF'));
// Should have at most 1 (second is identical, deduped)
let depth=0; // count via repeated undo
while(app.canUndo('SF')){app.undoTeam('SF');depth++;if(depth>5)break;}
console.log('Undo depth from no-op snapshots:', depth, '(expect ≤1)');
console.log('RESULT:', depth<=1?'PASS (identical snapshots deduped)':'FAIL');
