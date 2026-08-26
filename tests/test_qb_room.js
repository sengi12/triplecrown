// QB room: SPLIT SQUAD only when MULTIPLE QBs have projected starts. One starter → a
// minimized one-line block (tap opens the full room to split starts). A real committee
// shows only the QBs with starts; the rest of the room sits behind a toggle.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){},remove(){},innerHTML:'',contains:()=>false}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){},removeEventListener(){}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){},innerWidth:800,innerHeight:600,matchMedia:()=>({matches:false})};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  renderPassing, toggleQbRoom,
  setUserProj:(u)=>{userProj=u;}, setTeamVar:(t)=>{currentTeam=t;},
  noopRender:()=>{ renderContent=()=>{}; } };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
app.noopRender();

const QB=(name,id,games)=>({name, player_id:id, games, games_played:games,
  passing_yards:200*games, passing_tds:games, passing_attempts:30*games, passing_completions:20*games,
  interceptions_thrown:0, qb_rush_yards:0, qb_rush_tds:0, qb_rush_attempts:0});

console.log('=== one projected starter → minimized block, no SPLIT SQUAD ===');
let state={activeQB:0, qbs:[QB('Joe Burrow','q1',17), QB('Jake Browning','q2',0), QB('Logan Woodside','q3',0)]};
app.setUserProj({CIN:state}); app.setTeamVar('CIN');
let html=app.renderPassing('CIN', state);
chk(!html.includes('SPLIT SQUAD'),'three QBs on the roster alone is NOT a split squad');
chk(html.includes('qb-wl-min'),'workload collapses to the minimized block');
chk(html.includes('17 games projected'),'…showing the starter and his starts');
chk(html.includes('QB room (3)'),'…and the way into the full room');
chk(!html.includes('games_1'),'backups carry no sliders while collapsed');

console.log('=== the room opens for editing ===');
app.toggleQbRoom('CIN');
html=app.renderPassing('CIN', state);
chk(!html.includes('qb-wl-min'),'minimized block replaced by the full card');
chk(html.includes('games_0') && html.includes('games_1') && html.includes('games_2'),'every QB gets his starts slider');
chk(!html.includes('SPLIT SQUAD'),'still not a split — one starter');
chk(html.includes('games-only mode'),'advanced games-only control available in the room');
app.toggleQbRoom('CIN');
html=app.renderPassing('CIN', state);
chk(html.includes('qb-wl-min'),'toggling again re-collapses');

console.log('=== two projected starters → split squad, starters only ===');
state={activeQB:0, qbs:[QB('Starter A','q1',10), QB('Starter B','q2',7), QB('Clipboard C','q3',0)]};
app.setUserProj({CIN:state});
html=app.renderPassing('CIN', state);
chk(html.includes('SPLIT SQUAD'),'two QBs with starts → split squad');
chk(html.includes('games_0') && html.includes('games_1'),'both starters shown with their sliders');
chk(!html.includes('games_2'),'the clipboard QB stays hidden');
chk(html.includes('Full QB room (1 more)'),'…behind the room toggle');
app.toggleQbRoom('CIN');
html=app.renderPassing('CIN', state);
chk(html.includes('games_2'),'opening the room reveals him for a start split');

console.log('=== team switch re-collapses ===');
const kcState={activeQB:0, qbs:[QB('Patrick Mahomes','k1',17), QB('Backup','k2',0)]};
app.setUserProj({CIN:state, KC:kcState}); app.setTeamVar('KC');
html=app.renderPassing('KC', kcState);
chk(html.includes('qb-wl-min'),'a different team starts minimized (the open state is per-team)');

console.log('=== all zero games → full room (never an empty card) ===');
const zState={activeQB:0, qbs:[QB('Nobody A','z1',0), QB('Nobody B','z2',0)]};
app.setUserProj({NYJ:zState}); app.setTeamVar('NYJ');
html=app.renderPassing('NYJ', zState);
chk(html.includes('games_0') && html.includes('games_1'),'no starters at all → the whole room is editable');

console.log(`\n${pass}/${total}`);
process.exit(pass===total?0:1);
