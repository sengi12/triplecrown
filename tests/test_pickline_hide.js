const elStore={};let contentHTML='';
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{display:''},dataset:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],addEventListener(){},appendChild(){}};if(id==='content'){Object.defineProperty(elStore[id],'innerHTML',{get:()=>contentHTML,set:v=>{contentHTML=v;},configurable:true});}return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('_n'+Math.random()),body:{appendChild(){}},addEventListener(){}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
const code=require('fs').readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  renderRankings, setBuild:(fn)=>{buildPlayerList=fn;}, setFollowing:(id)=>{draftId=id;}, setMySlot:(s)=>{mySlot=s;},
  setMeta:(m)=>{draftMeta=m;}, setPicks:(p)=>{draftPicksBySlot=p;}, setDrafted:(d)=>{draftedIds=d;}, setHide:(v)=>{hideDrafted=v;},
  setSort:(k,d)=>{rankSortKey=k;rankSortDir=d;}, setFormat:(f)=>{rankFormat=f;},
  setBannerOpen:(v)=>{draftBannerOpen=v;},
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
// Multi-line placement (each line's HTML contains 'rank-pickline' twice — tr + span).
app.setHide(false); app.setMySlot(4); app.renderRankings();
let h2=app.getContent();
const lineStarts=[]; let ix=-1; while((ix=h2.indexOf('rank-pickline"',ix+1))>=0) lineStarts.push(ix);
const rowsBeforeN=(k)=>(h2.slice(0,lineStarts[k]).match(/rank-name/g)||[]).length;
chk(rowsBeforeN(0)===3 && rowsBeforeN(1)===20 && rowsBeforeN(2)===27,
  'seat 4 lines land after 3 / 20 / 27 board rows (own picks consume a row — was 3 / 19 / 25)');
// Corner seat: back-to-back picks must yield back-to-back lines, none dropped.
app.setMySlot(12); app.renderRankings();
h2=app.getContent();
const cornerLines=(h2.match(/rank-pickline"/g)||[]).length;
chk(cornerLines>=3,'corner seat 12 keeps its later pick lines (was: everything after line 1 dropped)');
const cs=[]; ix=-1; while((ix=h2.indexOf('rank-pickline"',ix+1))>=0) cs.push((h2.slice(0,ix).match(/rank-name/g)||[]).length);
chk(cs[0]===11 && cs[1]===11,'corner picks 12+13 render adjacent lines');
// ── ADP column: sits right after TIER, sortable, missing market data sinks ──
players.forEach((p,i)=>{ if(i<5) p.adp_ppr=50-i*10; });   // P1..P5 carry ADP 50/40/30/20/10
app.setMySlot(4); app.setHide(false);
app.setSort('adp',-1); app.renderRankings();
let h4=app.getContent();
const headEnd=h4.indexOf('</thead>');
const hd=h4.slice(0,headEnd);
chk(hd.indexOf('>TIER')>-1 && hd.indexOf('>ADP')>hd.indexOf('>TIER') && hd.indexOf('>ADP')<hd.indexOf('>FPTS'),
  'ADP header sits between TIER and FPTS');
const firstNames=[...h4.matchAll(/rank-name">(P\d+)</g)].map(m=>m[1]);
chk(firstNames[0]==='P5' && firstNames[1]==='P4' && firstNames[2]==='P3',
  'sorting by ADP orders the market board ascending (P5 first at ADP 10)');
chk(firstNames.slice(0,5).join()==='P5,P4,P3,P2,P1' && firstNames[5]!==undefined,
  'the 35 players with no market data sink below the five with ADP');
chk((h4.match(/c-adp"[^>]*><span class="num">/g)||[]).length===5,
  'ADP cells render only where market data exists');
app.setSort('ecr',-1); app.renderRankings();
const h5=app.getContent();
chk((h5.match(/rank-pickline/g)||[]).length>0,'pick lines still render with the extra column (colspan follows)');

// ── ADP follows the scoring format's market board ──
// PPR board runs P5→P1 (ADP 10..50); give the 2QB board the OPPOSITE order so a wrong
// lookup is unmissable.
players.forEach((p,i)=>{ if(i<5) p.adp_2qb=i+1; });
app.setFormat('superflex'); app.setSort('adp',-1); app.renderRankings();
let h6=app.getContent();
let names6=[...h6.matchAll(/rank-name">(P\d+)</g)].map(m=>m[1]);
chk(names6.slice(0,5).join()==='P1,P2,P3,P4,P5','superflex reads the 2QB market board (order flips)');
chk(/c-adp"[^>]*superflex[^>]*><span class="num">1<\/span>/.test(h6),'cell shows the 2QB value and names the board in its tooltip');
app.setFormat('ppr'); app.setSort('adp',-1); app.renderRankings();
names6=[...app.getContent().matchAll(/rank-name">(P\d+)</g)].map(m=>m[1]);
chk(names6.slice(0,5).join()==='P5,P4,P3,P2,P1','switching back to PPR re-renders on the PPR board (cache key follows format)');
app.setSort('ecr',-1); app.renderRankings();

// ── Follow banner: collapsed pill by default, full detail on demand ──
app.renderRankings();
let hb=app.getContent();
chk(hb.includes('draft-mini-pill') && !hb.includes('Following draft'),'banner collapses to the LIVE pill by default');
app.setBannerOpen(true); app.renderRankings();
hb=app.getContent();
chk(hb.includes('Following draft') && hb.includes('hide drafted') && hb.includes('stopDraftFollow'),
  'expanding shows the id, picks, hide-drafted and Stop');
app.setBannerOpen(false); app.renderRankings();
chk(app.getContent().includes('rank-filters-toggle') && !app.getContent().includes('>Filters<'),
  'the toolbar toggle is a pure hamburger now — no Filters label');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
