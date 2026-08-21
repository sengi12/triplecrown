// ═══════════════════════════════════════════════════════════════════════════
// OL stat tagging — every stat on the OL card must be taggable, and the target
// list must include the whole offensive line, not just the lineman whose card it
// is. A guard's run grade is as legitimately a note about the back running behind
// him as about the guard.
//
// Offensive linemen are not in SEED (fantasy positions only), so they are pulled
// from the nflverse ol_players map. Guards against three regressions found while
// building this: grades pinned to a single player and skipping the picker, the
// line sorting last because `order[pos] || 9` turns a 0 priority into a 9, and
// receiving stats offering linemen as targets.
// ═══════════════════════════════════════════════════════════════════════════
const elStore={};
function mkEl(id){ if(!elStore[id]) elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,
  classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},
  appendChild(){},querySelectorAll:()=>[],addEventListener(){}}; return elStore[id]; }
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],
  createElement:()=>({style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');
global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={};}abort(){}};
const fs=require('fs');
// __dirname, not a cwd-relative path: run_tests.sh executes from tests/, so 'tests/check.js'
// resolved to tests/tests/check.js, the file crashed before printing anything, and the runner
// logged "no assertions" rather than a failure. Registered but silently dead.
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  noteRelevantPlayers, noteOlPlayersForTeam, noteRelevanceForTableKey, notePickerTargets,
  renderPcardOlGrades, setNflverse:(n)=>{NFLVERSE=n;}, setSeed:(s)=>{SEED=s;}, getSeedKeys:()=>Object.keys(SEED||{}),
  setPlayers:(p)=>{sleeperPlayers=p;}, setPcardState:(s)=>{pcardState=s;},
  getBody:()=>document.getElementById('pcardBody').innerHTML };`)();

app.setNflverse({'2025':{ol_players:{
  'penei sewell':{name:'Penei Sewell',team:'DET',slot:'RT',pos:'T',ol_grade:'A+',ol_pctile:99,ol_conf:'HIGH',
    p_market:99,p_snap:96,p_draft:72,snap_pct:98,pass_grade:'A-',pass_pctile:93,run_grade:'B+',run_pctile:88,
    team_pass_pctile:60,team_run_pctile:70,espn_pbwr:94,espn_rbwr:80,penalty_rate:0.4,penalty_hold_rate:0.2,penalty_fs_rate:0.2,
    hist_seasons:'2021,2022,2023,2024,2025',ol_pctile_hist:'96,97,94,100,100',market_pctile_hist:'74,79,80,99,99'},
  'taylor decker':{name:'Taylor Decker',team:'DET',slot:'LT',pos:'T',ol_grade:'B'},
  'graham glasgow':{name:'Graham Glasgow',team:'DET',slot:'LG',pos:'G',ol_grade:'C+'},
  'frank ragnow':{name:'Frank Ragnow',team:'DET',slot:'C',pos:'C',ol_grade:'A-'},
  'kevin zeitler':{name:'Kevin Zeitler',team:'DET',slot:'RG',pos:'G',ol_grade:'B-'},
  'other guy':{name:'Other Guy',team:'GB',slot:'LT',pos:'T',ol_grade:'C'}
}}});
app.setSeed({DET:{QB:[{name:'Jared Goff',player_id:'1',adp:80}],RB:[{name:'Jahmyr Gibbs',player_id:'2',adp:5}],
  WR:[{name:'Amon-Ra St. Brown',player_id:'3',adp:8}],TE:[{name:'Sam LaPorta',player_id:'4',adp:40}]}});
console.log('  (harness) SEED teams loaded:', app.getSeedKeys().join(','));

let pass=0,total=0; const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== OL appears as a tag target ===');
const ol=app.noteOlPlayersForTeam('DET');
chk(ol.length===5,`all five DET linemen enumerated (got ${ol.length})`);
chk(ol.map(p=>p.slot).join(',')==='LT,LG,C,RG,RT','linemen ordered left to right along the line');
chk(!ol.some(p=>p.team!=='DET'),'other teams excluded');

console.log('\n=== relevance drives who is offered ===');
const pass1=app.noteRelevantPlayers('DET','OL,QB');
chk(pass1.filter(p=>p.pos==='OL').length===5,'protection stat offers the whole line');
chk(pass1[0].pos==='OL','line is offered first for a line stat');
chk(pass1.some(p=>p.pos==='QB'&&p.relevant),'quarterback marked relevant for protection');
chk(pass1.some(p=>p.pos==='WR'&&!p.relevant),'pass catchers still reachable, just not flagged relevant');

const run1=app.noteRelevantPlayers('DET','OL,RB');
chk(run1.some(p=>p.pos==='RB'&&p.relevant),'back marked relevant for run blocking');
chk(run1.find(p=>p.pos==='QB')&&!run1.find(p=>p.pos==='QB').relevant,'QB not flagged relevant for run blocking');

const skill=app.noteRelevantPlayers('DET','WR,TE');
chk(!skill.some(p=>p.pos==='OL'),'a receiving stat does NOT offer linemen');

console.log('\n=== team OL tables inherit OL targeting ===');
chk(app.noteRelevanceForTableKey('offensive_line_run')==='OL,RB','run table targets line + backs');
chk(app.noteRelevanceForTableKey('offensive_line_pass')==='OL,QB,RB','pass table targets line + QB + backs');

console.log('\n=== every stat on the card is taggable ===');
app.setPlayers({'9':{name:'Penei Sewell',pos:'RT'}});
app.setPcardState({pid:'9',posc:'RT',isSkill:false,isOl:true,team:'DET'});
const body=app.renderPcardOlGrades('9');
const tagged=(body.match(/data-noteable="1"/g)||[]).length;
console.log(`  tagged elements on the card: ${tagged}`);
chk(tagged>=18, `every stat carries a tag hook (got ${tagged})`);
for(const k of ['ol_grade','pass_grade','run_grade','penalty_rate','snap_pct','market_pctile',
                'p_market','p_snap','p_draft','ol_pctile_hist','espn_pbwr','team_run_pctile'])
  chk(body.includes(`data-note-stat-key="${k}"`)||body.includes(`"${k}"`), `${k} is taggable`);
chk(!/data-note-player-name="Penei Sewell"[\s\S]{0,80}data-note-stat-key="ol_grade"/.test(body),
    'grades are no longer pinned to one lineman');
chk(body.includes('data-note-relevance="OL,QB"'),'pass stats carry OL,QB relevance');
chk(body.includes('data-note-relevance="OL,RB"'),'run stats carry OL,RB relevance');

console.log(`\nRESULT: ${pass}/${total} `+(pass===total?'ALL PASS':'SOME FAILED'));
if(pass!==total) process.exit(1);
