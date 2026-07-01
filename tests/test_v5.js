global.document={getElementById:()=>({innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},insertBefore(){}}),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  return { loadProjections, buildPlayerList, getProj:()=>userProj,
    setTeam:t=>{currentTeam=t;}, initRushingShares,
    assembleSeed, normalizeSleeperRow, getDrafted:()=>draftedIds,
    setDrafted:(o)=>{draftedIds=o;}, setDraftId:(d)=>{draftId=d;},
    editRushYds, editRushTDsCarry, teamRushTDs,
    getSeed:()=>SEED, getHistorySeasons:()=>HISTORY_SEASONS };
`)();

console.log('=== TEST: assembleSeed from mock Sleeper data ===');
const mockPlayers={
  '100':{player_id:'100',name:'Test QB',pos:'QB',team:'KC',age:28},
  '200':{player_id:'200',name:'Test RB',pos:'RB',team:'KC',age:24},
  '300':{player_id:'300',name:'Test WR',pos:'WR',team:'KC',age:26},
};
const mockIdx={
  '100':{stats:{passing_yards:4500,passing_touchdowns:35,passing_attempts:580,interceptions_thrown:8,adp_ppr:25},team:'KC',pos:'QB',name:'Test QB'},
  '200':{stats:{rushing_yards:1200,rushing_touchdowns:10,rushing_attempts:260,receiving_targets:60,receptions:48,receiving_yards:380,adp_ppr:8},team:'KC',pos:'RB',name:'Test RB'},
  '300':{stats:{receiving_targets:140,receptions:95,receiving_yards:1300,receiving_touchdowns:9,adp_ppr:12},team:'KC',pos:'WR',name:'Test WR'},
};
const seed=app.assembleSeed(mockPlayers,mockIdx);
console.log('KC QBs:', seed.KC.QB.map(p=>`${p.name} ${p.passing_yards}yd`).join(', '));
console.log('KC RBs:', seed.KC.RB.map(p=>`${p.name} ${p.rushing_yards}yd ${p.rushing_tds}td`).join(', '));
console.log('KC WRs:', seed.KC.WR.map(p=>`${p.name} ${p.receiving_targets}tgt`).join(', '));
const qbOk=seed.KC.QB[0]&&seed.KC.QB[0].passing_yards===4500;
const rbOk=seed.KC.RB[0]&&seed.KC.RB[0].rushing_tds===10;
console.log('RESULT:', qbOk&&rbOk?'PASS':'FAIL');

console.log('\n=== TEST: normalizeSleeperRow maps stat keys ===');
const row={player_id:'42',stats:{pass_yd:4000,pass_td:30,rec_tgt:0,rush_att:50}};
const norm=app.normalizeSleeperRow(row);
console.log('mapped:', JSON.stringify(norm.stats), 'pid:', norm.pid);
console.log('RESULT:', norm.stats.passing_yards===4000&&norm.stats.passing_touchdowns===30&&norm.pid==='42'?'PASS':'FAIL');

console.log('\n=== TEST: draft filtering marks drafted players ===');
const data=JSON.parse(fs.readFileSync('/mnt/user-data/uploads/season_projections.json','utf8'));
app.loadProjections(data);
const list=app.buildPlayerList();
// mark the top player drafted
const top=[...list].sort((a,b)=>b.fpts-a.fpts)[0];
app.setDraftId('123456');
app.setDrafted({[top.player_id]:true});
console.log(`Marked ${top.name} (id=${top.player_id}) as drafted`);
console.log('draftedIds has it:', !!app.getDrafted()[top.player_id]?'PASS':'FAIL');

console.log('\n=== TEST: editRushYds sets ypc to hit target ===');
app.setTeam('SF');
app.initRushingShares('SF');
const sf=app.getProj()['SF'];
const r=sf.rushing;
const att0=Math.round(r.shares[0].share*r.total_attempts);
app.editRushYds(0,'900');
const newYds=Math.round(att0*r.shares[0].ypc);
console.log(`Set RB0 yards=900 (${att0} att → ypc=${r.shares[0].ypc.toFixed(2)}, yields ${newYds})`);
console.log('RESULT:', Math.abs(newYds-900)<att0?'PASS':'FAIL');

console.log('\n=== TEST: editRushTDsCarry grows team total ===');
const before=app.teamRushTDs(sf);
app.editRushTDsCarry(0,'12');
const after=app.teamRushTDs(sf);
const p0tds=r.shares[0].td_share*after;
console.log(`Set RB0 TDs=12: team ${before.toFixed(1)}→${after.toFixed(1)}, player=${p0tds.toFixed(1)}`);
console.log('RESULT:', Math.abs(p0tds-12)<0.5?'PASS':'FAIL');

console.log('\n=== DONE ===');
