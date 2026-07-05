const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('_new'+Math.random()),body:{appendChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  lineupFromRosterPositions, bucketPicksBySlot, fillLineup, slotOwnerName, renderRosterBar, renderTrackerPanel, claimSlot, fillLineupWith:(picks,lineup,bench)=>{draftLineup=lineup;draftBenchCount=bench||0;return fillLineup(picks);},
  setLineup:(l,b)=>{draftLineup=l;draftBenchCount=b||0;}, setPicks:(p)=>{draftPicksBySlot=p;}, setMeta:(m)=>{draftMeta=m;}, setUsers:(u)=>{draftUsers=u;}, setMySlot:(s)=>{mySlot=s;}, setBarVisible:(v)=>{rosterBarVisible=v;}, setNeedsPick:(v)=>{_trackerNeedsSlotPick=v;}, setTrackerOpen:(v)=>{trackerOpen=v;},
  getMySlot:()=>mySlot };`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== lineupFromRosterPositions parses league settings ===');
const lu=app.lineupFromRosterPositions(['QB','RB','RB','WR','WR','TE','FLEX','K','DEF','BN','BN','BN','BN','BN','BN']);
chk(JSON.stringify(lu.lineup)===JSON.stringify(['QB','RB','RB','WR','WR','TE','FLEX','K','DEF']),'starters parsed');
chk(lu.bench===6,'6 bench slots');
const sf=app.lineupFromRosterPositions(['QB','QB','RB','WR','SUPER_FLEX','BN']);
chk(sf.lineup.includes('SUPER_FLEX'),'superflex mapped');
chk(sf.bench===1,'1 bench in SF');
const empty=app.lineupFromRosterPositions([]);
chk(empty.lineup.length===9,'empty → default 9-slot lineup');

console.log('=== bucketPicksBySlot groups by draft_slot ===');
const picks=[
  {draft_slot:1,player_id:'6770',pick_no:1,picked_by:'userA',metadata:{first_name:'Joe',last_name:'Burrow',position:'QB',team:'CIN'}},
  {draft_slot:3,player_id:'4034',pick_no:2,picked_by:'userB',metadata:{first_name:'Christian',last_name:'McCaffrey',position:'RB',team:'SF'}},
  {draft_slot:1,player_id:'6794',pick_no:24,picked_by:'userA',metadata:{first_name:'Jamarr',last_name:'Chase',position:'WR',team:'CIN'}},
];
const bs=app.bucketPicksBySlot(picks);
chk(bs[1].length===2,'slot 1 has 2 picks');
chk(bs[3].length===1,'slot 3 has 1 pick');
chk(bs[1][0].name==='Joe Burrow','name assembled from metadata');
chk(bs[1][0].pos==='QB','position captured');

console.log('=== fillLineup slots players correctly ===');
app.setLineup(['QB','RB','RB','WR','WR','TE','FLEX','K','DEF'],6);
const teamPicks=[
  {player_id:'1',name:'Joe Burrow',pos:'QB',team:'CIN',pick_no:1},
  {player_id:'2',name:'Bijan Robinson',pos:'RB',team:'ATL',pick_no:2},
  {player_id:'3',name:'Ja Marr Chase',pos:'WR',team:'CIN',pick_no:3},
  {player_id:'4',name:'CeeDee Lamb',pos:'WR',team:'DAL',pick_no:4},
  {player_id:'5',name:'Saquon Barkley',pos:'RB',team:'PHI',pick_no:5},
  {player_id:'6',name:'Extra WR',pos:'WR',team:'X',pick_no:6},   // → FLEX
];
const fl=app.fillLineup(teamPicks);
const qb=fl.slots.find(s=>s.slot==='QB');
chk(qb.player && qb.player.name==='Joe Burrow','QB slot filled');
const flex=fl.slots.find(s=>s.slot==='FLEX');
chk(flex.player && flex.player.name==='Extra WR','extra WR → FLEX');
chk(fl.needs.includes('TE')&&fl.needs.includes('K')&&fl.needs.includes('DEF'),'needs TE/K/DEF');
chk(fl.slots.filter(s=>s.player).length===6,'6 starters filled');

console.log('=== overflow goes to bench ===');
const many=[];for(let i=0;i<12;i++)many.push({player_id:''+i,name:'RB'+i,pos:'RB',team:'X',pick_no:i});
const fl2=app.fillLineup(many);
chk(fl2.bench.length>0,'extra RBs overflow to bench');

console.log('=== slotOwnerName resolves username via draft_order ===');
app.setMeta({draft_order:{'userA':1,'userB':3},settings:{teams:12}});
app.setUsers({userA:'SengiTheGreat',userB:'RivalDrafter'});
chk(app.slotOwnerName(1)==='SengiTheGreat','slot 1 → username');
chk(app.slotOwnerName(3)==='RivalDrafter','slot 3 → username');
chk(app.slotOwnerName(7)==='Team 7','unknown slot → Team N');

console.log('=== claimSlot sets mySlot (mock draft) ===');
app.setMySlot(null); app.setNeedsPick(true);
app.claimSlot(5);
chk(app.getMySlot()===5,'claimSlot sets mySlot=5');

console.log('=== bar renders chips + count when visible ===');
app.setBarVisible(true); app.setMySlot(1); app.setNeedsPick(false); app.setTrackerOpen(false);
app.setPicks({1:teamPicks});
app.renderRosterBar();
const barHost=global.document.getElementById('rosterBar');
chk(barHost.innerHTML.includes('rt-bar'),'bar rendered');
chk(barHost.innerHTML.includes('starters'),'shows starter count');
chk(barHost.innerHTML.includes('Burrow'),'shows a drafted player name');

console.log('=== panel shows lineup + needs + switcher ===');
app.setTrackerOpen(true); app.renderRosterBar();
const h=global.document.getElementById('rosterBar').innerHTML;
chk(h.includes('rt-panel'),'panel present when open');
chk(h.includes('Still needs')||h.includes('complete'),'needs line present');
chk(h.includes('rt-switcher'),'team switcher present');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
