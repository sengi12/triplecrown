// Second audit batch: traded picks credit the owning roster, a narrowed week range whose
// state lost its data re-applies itself, and following a draft always lands on the
// projection board.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},textContent:'',value:'',dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},children:[],appendChild(){},querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),matchMedia:()=>({matches:false})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
global.AbortController=class{constructor(){this.signal={};}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){}; renderContent=function(){}; saveSession=function(){}; renderRankings=function(){}; renderRosterBar=function(){};
  let __applied=[]; applyWeekRange=async function(team,lo,hi){ __applied.push([team,lo,hi]); };
  loadDraftMeta=async function(){}; pollDraft=async function(){};
  return {
  bucketPicksBySlot, setMeta:(m)=>{draftMeta=m;},
  weekRangeSliderHTML, setActive:(s)=>{activeSeason=s;}, setShared:(t,s,lo,hi)=>setSharedWeekRange(t,s,lo,hi), applied:()=>__applied,
  startDraftFollow, getActive:()=>activeSeason, setProj:(p)=>{projSeed=p;SEED=p;seasonStatsCache.proj=p;workingProj={};userProj=workingProj;}, setDraftId:(d)=>{draftId=d;},
};`)();
let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== traded picks ===');
app.setMeta({slot_to_roster_id:{1:7, 2:3, 3:9}});
const picks=[
  {draft_slot:1, roster_id:7, pick_no:1, player_id:'a', metadata:{first_name:'A',last_name:'One',position:'RB',team:'KC'}},
  {draft_slot:2, roster_id:7, pick_no:2, player_id:'b', metadata:{first_name:'B',last_name:'Two',position:'WR',team:'KC'}},   // slot 2's pick, traded to roster 7
  {draft_slot:3, roster_id:9, pick_no:3, player_id:'c', metadata:{first_name:'C',last_name:'Three',position:'WR',team:'KC'}},
];
const by=app.bucketPicksBySlot(picks);
chk((by[1]||[]).map(p=>p.player_id).join(',')==='a,b','a traded pick is credited to the roster that owns it (slot 1 has both)');
chk(!by[2],'the column that traded the pick away gets nothing');
chk((by[3]||[]).length===1,'an untraded pick stays put');
app.setMeta(null);
const mock=app.bucketPicksBySlot([{draft_slot:4, pick_no:1, player_id:'z', metadata:{}}]);
chk(!!mock[4],'mocks (no slot_to_roster_id) still bucket by column');

console.log('=== week range re-applies when the state lost its data ===');
app.setActive('2025'); app.setShared('GB','2025',3,10);
const st={passing_shares:[], rushing:{}};
const html=app.weekRangeSliderHTML('GB', st);
chk(/Reset to full season/.test(html) && /loading…/.test(html),'narrowed range renders as loading, not as a finished filter');
setTimeout(()=>{
  chk(app.applied().length===1 && app.applied()[0].join(',')==='GB,3,10','applyWeekRange is kicked for the shared range');
  const st2={passing_shares:[], rushing:{}, weekFilterData:{x:1}};
  app.weekRangeSliderHTML('GB', st2);
  setTimeout(async()=>{
    chk(app.applied().length===1,'a state that already has filtered data does not refetch');
    console.log('=== following a draft lands on the projection board ===');
    app.setProj({KC:{QB:[],RB:[],WR:[],TE:[]}}); app.setActive('2025'); app.setDraftId('123');
    await app.startDraftFollow(false);
    chk(app.getActive()==='proj','activeSeason is proj after startDraftFollow');
    console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
    process.exit(pass===total?0:1);
  },5);
},5);
