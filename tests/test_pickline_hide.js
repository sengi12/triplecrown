const elStore={};let contentHTML='';
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{display:''},dataset:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],addEventListener(){},appendChild(){}};if(id==='content'){Object.defineProperty(elStore[id],'innerHTML',{get:()=>contentHTML,set:v=>{contentHTML=v;},configurable:true});}return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('_n'+Math.random()),body:{appendChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
const code=require('fs').readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  renderRankings, setBuild:(fn)=>{buildPlayerList=fn;}, setFollowing:(id)=>{draftId=id;}, setMySlot:(s)=>{mySlot=s;},
  setMeta:(m)=>{draftMeta=m;}, setPicks:(p)=>{draftPicksBySlot=p;}, setDrafted:(d)=>{draftedIds=d;}, setHide:(v)=>{hideDrafted=v;},
  getContent:()=>document.getElementById('content').innerHTML };`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const players=[]; for(let i=1;i<=40;i++)players.push({name:'P'+i,player_id:''+i,pos:'RB',team:'X',fpts:400-i,ecr:i,ecr_tier:1,rushing_attempts:1,rushing_yards:1,ypc:4,rushing_tds:1,receiving_targets:1,receptions:1,receiving_yards:1,receiving_tds:1,passing_attempts:0,passing_yards:0,passing_tds:0,interceptions_thrown:0});
app.setBuild(()=>players.map(p=>({...p})));
app.setFollowing('123'); app.setMySlot(4);
app.setMeta({type:'snake',settings:{teams:12,rounds:15,reversal_round:0}});
app.setPicks({}); app.setDrafted({});
app.setHide(false); app.renderRankings();
chk((app.getContent().match(/rank-pickline/g)||[]).length>0,'pick lines show with hide-drafted OFF');
app.setHide(true); app.renderRankings();
const h=app.getContent();
chk((h.match(/rank-pickline/g)||[]).length>0,'pick lines show with hide-drafted ON (the bug)');
const firstLineIdx=h.indexOf('rank-pickline');
const rowsBefore=(h.slice(0,firstLineIdx).match(/rank-name/g)||[]).length;
chk(rowsBefore===3,'line placed after 3 players (slot 4 picks 4th)');
chk(h.slice(firstLineIdx,firstLineIdx+120).includes('next up'),'first line labeled next-up');
console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
