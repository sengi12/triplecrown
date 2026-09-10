// The chat guard's field-reported blind spot (2026-09-10): "what were JSN's
// stats last night" — and even the full name — flagged as not-football. Stats
// vocabulary, initialisms, aliases, and the empty-board race, all pinned.
const elStore={};let contentHTML='';
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},querySelectorAll:()=>[],addEventListener(){},appendChild(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'),body:{appendChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  return { tcChatGuard, tcChatGroundPlayers, setBoard:(b)=>{_chat.board=b;} };
`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const board=[
  {player_id:'1', name:'Jaxon Smith-Njigba', pos:'WR', team:'SEA'},
  {player_id:'2', name:'Amon-Ra St. Brown', pos:'WR', team:'DET'},
  {player_id:'3', name:'Christian McCaffrey', pos:'RB', team:'SF'},
  {player_id:'4', name:"Ja'Marr Chase", pos:'WR', team:'CIN'},
  {player_id:'5', name:'Jahan Dotson', pos:'WR', team:'PHI'},   // JD vs nobody — 2-letter, never an initialism
];
app.setBoard(board);

console.log('=== the exact field reports pass now ===');
chk(app.tcChatGuard("do you know what JSN's stats were?")==='ok', '"JSN\'s stats" is football');
chk(app.tcChatGuard("what were Jaxon Smith-Njigba's stats last night?")==='ok', 'the full name with a possessive is football');
chk(app.tcChatGroundPlayers('how did JSN do')[0].name==='Jaxon Smith-Njigba',
    'JSN doesn\'t just pass the gate — he GROUNDS (his packet attaches)');
chk(app.tcChatGroundPlayers('is ARSB elite')[0].name==='Amon-Ra St. Brown', 'generated initialisms: ARSB');
chk(app.tcChatGroundPlayers('thoughts on CMC')[0].name==='Christian McCaffrey', 'curated aliases: CMC');
chk(app.tcChatGuard('how many points did Chase score')==='ok', 'stats vocabulary: points/score');
chk(app.tcChatGuard('show me his box score from last night')==='ok', 'box score + last night');

console.log('=== the fence still stands ===');
chk(app.tcChatGuard('write me a poem about the ocean')==='offtopic', 'non-football is still off-topic');
chk(app.tcChatGuard('give me a lasagna recipe')==='offtopic', 'trivia still bounces');
chk(app.tcChatGroundPlayers('the JD candidate').length===0, 'two-letter initials never match (too ambiguous)');

console.log('=== the empty-board race fails OPEN, not closed ===');
app.setBoard([]);
chk(app.tcChatGuard('how did JSN do last week')==='ok', 'stats vocab covers it even boardless');
chk(app.tcChatGuard('tell me about Puka Nacua')==='ok', 'board not loaded yet → let it through (model fence holds)');
chk(app.tcChatGuard('JSN?')==='ok', 'board not loaded yet → an initialism alone still passes');
chk(app.tcChatGuard('write my resume for me')==='offtopic', 'board not loaded yet → nameless drift is still off-topic');
app.setBoard(board);
chk(app.tcChatGuard('write me a poem about the ocean')==='offtopic', 'and the fence returns with the board');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
