// Draft-follow lifecycle: start/stop generation token (no zombie polls), completion
// detection stops the interval, keeper-aware on-clock pick, stop cleans hideDrafted and the
// VONA cache, and the follow persists (id + seat + hide) so a mid-draft reload re-arms.
const elStore={};let contentHTML='';
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{display:''},dataset:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},offsetHeight:40};if(id==='content'){Object.defineProperty(elStore[id],'innerHTML',{get:()=>contentHTML,set:v=>{contentHTML=v;},configurable:true});}return elStore[id];}
global.document={documentElement:{scrollTop:0,scrollHeight:0,style:{setProperty(){}}},getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('_n'+Math.random()),body:{appendChild(){}},addEventListener(){}};
global.requestAnimationFrame=(f)=>{try{f()}catch(e){}};
global.window={scrollY:0,innerHeight:800,scrollTo(){},addEventListener(){}};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
const store={};
global.localStorage={getItem:(k)=>store[k]!=null?store[k]:null,setItem:(k,v)=>{store[k]=String(v);},removeItem:(k)=>{delete store[k];}};
let intervals=0, cleared=0, timerId=0;
global.setInterval=(fn,ms)=>{intervals++;return ++timerId;};
global.clearInterval=(id)=>{if(id)cleared++;};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  startDraftFollow, stopDraftFollow, pollDraft, currentPickNo,
  setFetch:(f)=>{sleeperFetch=f;}, setDraftId:(d)=>{draftId=d;}, getDraftId:()=>draftId,
  setPicks:(p)=>{draftPicksBySlot=p;}, setMeta:(m)=>{draftMeta=m;}, setMySlot:(s)=>{mySlot=s;},
  setHide:(v)=>{hideDrafted=v;}, getHide:()=>hideDrafted,
  getDone:()=>_draftDone, getTimer:()=>draftTimer,
  saveNow:()=>{_persistReady=true;_persistOk=true;_saveSessionNow();},
  getVonaCache:()=>_vonaCache };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

(async()=>{
  console.log('=== keeper-aware on-clock pick ===');
  // Feed contains picks 1,2 plus a pre-populated keeper at pick 30 → on the clock = 3, not 4.
  app.setPicks({1:[{pick_no:1},{pick_no:30}],2:[{pick_no:2}]});
  chk(app.currentPickNo()===3,'smallest missing pick number wins (keepers pre-populated at 30)');
  app.setPicks({1:[{pick_no:1}],2:[{pick_no:2}]});
  chk(app.currentPickNo()===3,'normal draft unchanged');

  console.log('=== start/stop race (generation token) ===');
  let meta={draft_id:'D1', type:'snake', settings:{teams:2, rounds:2, slots_qb:1}, draft_order:{}};
  let picks=[];
  app.setFetch(async(url)=>{ if(String(url).includes('/picks')) return picks; return meta; });
  app.setDraftId('D1');
  const before=intervals;
  const p1=app.startDraftFollow(false);
  const p2=app.startDraftFollow(false);   // double-start: only ONE interval may survive
  await p1; await p2;
  chk(intervals-before===1,'concurrent starts arm exactly one poll interval');
  const stopBefore=cleared;
  app.stopDraftFollow();
  chk(app.getDraftId()===null && cleared>stopBefore,'stop clears the interval and the id');
  chk(app.getHide()===false,'stop resets hide-drafted');
  chk(app.getVonaCache().key===null,'stop clears the VONA cache');

  console.log('=== stop during start never resurrects ===');
  app.setDraftId('D2');
  const armed=intervals;
  const p3=app.startDraftFollow(false);
  app.stopDraftFollow();                  // user taps Stop while the start is awaiting
  await p3;
  chk(intervals===armed,'the in-flight start aborted — no zombie interval, no “Following null”');
  chk(app.getDraftId()===null,'id stays null after the aborted start');

  console.log('=== completion detection ===');
  app.setDraftId('D3');
  await app.startDraftFollow(false);
  picks=[{pick_no:1,player_id:'a'},{pick_no:2,player_id:'b'},{pick_no:3,player_id:'c'},{pick_no:4,player_id:'d'}]; // 2 teams × 2 rounds
  await app.pollDraft();
  chk(app.getDone()===true,'all picks in → draft marked complete');
  chk(app.getTimer()===null,'…and the poll interval stops (was: polled forever)');

  console.log('=== the follow persists ===');
  app.setDraftId('D4'); app.setMySlot(7); app.setHide(true);
  app.saveNow();
  const saved=JSON.parse(store['triplecrown.session.v1']);
  chk(saved.draftFollow && saved.draftFollow.id==='D4' && saved.draftFollow.slot===7 && saved.draftFollow.hide===true,
    'session payload carries draft id + seat + hide toggle');
  chk(!saved.draftedIds,'drafted ids are NOT persisted (first poll rebuilds them)');

  console.log(`\n${pass}/${total}`);
  process.exit(pass===total?0:1);
})().catch(e=>{ console.log('  FAIL: unhandled', e.message); process.exit(1); });
