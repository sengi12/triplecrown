// Owner pills everywhere a player name appears once a league is synced:
//   projections (passing / receiving / rushing rows), the rankings table (OWNER column) and
//   the search bar (pill on the right of the row, next to the name). Nothing at all when no
//   league is linked.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},textContent:'',value:'',dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},children:[],appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),matchMedia:()=>({matches:false})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
global.AbortController=class{constructor(){this.signal={};}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){}; saveSession=function(){};
  return {
  assembleSeed, normalizeSleeperRow, setSEED:(s)=>{SEED=s;seasonStatsCache.proj=s;},
  initPassingShares, initRushingShares, ensureTeam, selectTeam:t=>{currentTeam=t;ensureTeam(t);}, getProj:()=>userProj,
  setPlayers:(p)=>{sleeperPlayers=p; _psIndex=null;},
  setSnapshot:(s)=>{leagueSnapshot=s; if(typeof invalidateRankingsRenderCache==='function') invalidateRankingsRenderCache();},
  renderPassing:(t,st)=>renderPassing(t,st),
  renderTargets:(t,st)=>{ passingSubTab='targets'; return renderReceiving(t,st); },
  renderDerived:(t,st)=>{ passingSubTab='rec'; return renderReceiving(t,st); },
  renderCarries:(t,st)=>{ rushingSubTab='carries'; return renderRushing(t,st); },
  renderRankingsHtml:()=>{ currentPhase='Rankings'; renderRankings(); return document.getElementById('content').innerHTML; },
  search:(q)=>{ psRender(q); return document.getElementById('psResults').innerHTML; },
  tcOwnerPill, tcOwnerActive,
};`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const players={
  qb:{player_id:'qb',name:'Patrick Mahomes',pos:'QB',team:'KC'},
  wr1:{player_id:'wr1',name:'Rashee Rice',pos:'WR',team:'KC'},
  wr2:{player_id:'wr2',name:'Xavier Worthy',pos:'WR',team:'KC'},
  te:{player_id:'te',name:'Travis Kelce',pos:'TE',team:'KC'},
  rb1:{player_id:'rb1',name:'Isiah Pacheco',pos:'RB',team:'KC'},
};
const idx={
  qb:app.normalizeSleeperRow({player_id:'qb',team:'KC',position:'QB',stats:{pass_yd:4600,pass_att:570,pass_td:36,gp:17}}),
  wr1:app.normalizeSleeperRow({player_id:'wr1',team:'KC',position:'WR',stats:{rec:95,rec_tgt:140,rec_yd:1300,rec_td:10,gp:17}}),
  wr2:app.normalizeSleeperRow({player_id:'wr2',team:'KC',position:'WR',stats:{rec:70,rec_tgt:110,rec_yd:780,rec_td:5,gp:17}}),
  te:app.normalizeSleeperRow({player_id:'te',team:'KC',position:'TE',stats:{rec:60,rec_tgt:90,rec_yd:650,rec_td:6,gp:17}}),
  rb1:app.normalizeSleeperRow({player_id:'rb1',team:'KC',position:'RB',stats:{rush_att:250,rush_yd:1100,rush_td:8,gp:17}}),
};
app.setPlayers(players);
app.setSEED(app.assembleSeed(players,idx));
app.selectTeam('KC');
app.initPassingShares('KC'); app.initRushingShares('KC');
const st=app.getProj()['KC'];

const snap={
  provider:'sleeper', leagueId:'123', season:'2026', takenAt:1000, myUserId:'me-1',
  teamList:[
    { rosterId:1, ownerId:'me-1', owner:'Sengi12', teamName:'Who Dey',
      players:[{id:'qb', name:'Patrick Mahomes', pos:'QB'}, {id:'wr1', name:'Rashee Rice', pos:'WR'}] },
    { rosterId:2, ownerId:'them-2', owner:'mstums1', teamName:'Bengal Mauler',
      players:[{id:'te', name:'Travis Kelce', pos:'TE'}, {id:'rb1', name:'Isiah Pacheco', pos:'RB'}] },
  ],
};

console.log('=== TEST: no league synced → no pills, no OWNER column ===');
app.setSnapshot(null);
chk(app.tcOwnerActive()===false,'owner lookup inactive');
chk(!/tc-own-pill/.test(app.renderTargets('KC',st)),'receiving rows carry no pill');
chk(!/tc-own-pill/.test(app.renderCarries('KC',st)),'rushing rows carry no pill');
chk(!/tc-own-pill/.test(app.renderPassing('KC',st)),'passing view carries no pill');
let rk=app.renderRankingsHtml();
chk(!/c-own/.test(rk),'rankings has no OWNER column');
chk(!/tc-own-pill/.test(app.search('rice')),'search rows carry no pill');

console.log('=== TEST: league synced → manager handle next to every name ===');
app.setSnapshot(snap);
chk(app.tcOwnerActive()===true,'owner lookup active');
const tg=app.renderTargets('KC',st);
chk(/Rashee Rice<\/span><span class="tc-own-chip tc-own-mine tc-own-sm tc-own-pill"[^>]*>★ Sengi12</.test(tg),'targets row: my player → ★ my handle right after the name');
chk(/Travis Kelce<\/span><span class="tc-own-chip tc-own-sm tc-own-pill"[^>]*>mstums1</.test(tg),'targets row: rival player → rival handle');
chk(/Xavier Worthy<\/span>(?!<button class="tc-own)/.test(tg),'targets row: free agent → nothing');
chk(/Rashee Rice<\/span><span class="tc-own-chip[^>]*>★ Sengi12</.test(app.renderDerived('KC',st)),'receptions/yards rows carry the pill');
chk(/Isiah Pacheco<\/span><span class="tc-own-chip[^>]*>mstums1</.test(app.renderCarries('KC',st)),'rushing rows carry the pill');
const ps=app.renderPassing('KC',st);
chk(/Patrick Mahomes<span class="tc-own-chip[^>]*>★ Sengi12</.test(ps) || /Patrick Mahomes<\/span><span class="tc-own-chip[^>]*>★ Sengi12</.test(ps),'passing view: QB row carries the pill');
chk(/Bengal Mauler/.test(tg) && /title="[^"]*mstums1 \(Bengal Mauler\)/.test(tg),'team name is kept in the tooltip');

rk=app.renderRankingsHtml();
chk(/<th class="c-own"/.test(rk),'rankings gains an OWNER column');
chk(/<td class="c-own"><span class="tc-own-chip tc-own-mine[^>]*>★ Sengi12</.test(rk),'rankings row shows my handle');
chk(/<td class="c-own"><span class="tc-own-chip tc-own-sm tc-own-pill"[^>]*>mstums1</.test(rk),'rankings row shows the rival handle');
chk(/<td class="c-own"><\/td>/.test(rk),'un-owned player leaves the cell empty');
const colspan=(rk.match(/colspan="(\d+)"/)||[])[1];
const ths=(rk.match(/<th[\s>]/g)||[]).length;
chk(!colspan || Number(colspan)===ths, `pick-line colspan matches header count (${colspan||'n/a'} vs ${ths})`);

const sr=app.search('rice');
chk(/<span class="ps-pos ps-pos-WR">WR<\/span>\s*<span class="ps-nm">/.test(sr),'search row: position badge before the name block');
chk(/<span class="ps-nm-main">Rashee Rice<\/span><span class="ps-nm-sub">.*KC<\/span>/.test(sr),'search row: team under the name');
chk(/<\/span>\s*<span class="tc-own-chip tc-own-mine tc-own-sm tc-own-pill"[^>]*>★ Sengi12<\/span>\s*<\/button>/.test(sr),'search row: owner pill last (right edge)');

console.log('=== TEST: switching leagues re-renders rankings (cache key) ===');
app.setSnapshot(Object.assign({},snap,{takenAt:2000,teamList:[{rosterId:3,ownerId:'x',owner:'newguy',teamName:'T',players:[{id:'wr2',name:'Xavier Worthy',pos:'WR'}]}]}));
rk=app.renderRankingsHtml();
chk(/newguy/.test(rk) && !/Sengi12/.test(rk),'rankings follow the new snapshot');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
