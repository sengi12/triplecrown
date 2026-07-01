global.document = {
  getElementById:()=>({innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}}}),
  querySelector:()=>null, querySelectorAll:()=>[],
  createElement:()=>({click(){},style:{},appendChild(){}}),
  activeElement:null, body:{appendChild(){},removeChild(){}},
};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true; global.btoa=s=>Buffer.from(s,'binary').toString('base64');
global.FileReader=function(){}; global.Range=function(){};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  return { loadProjections, buildPlayerList, getProj:()=>userProj,
    setTeam:t=>{currentTeam=t;}, setSub:(p,r)=>{passingSubTab=p;rushingSubTab=r;},
    editCatchPct, editRecYds, editYpt, editRecTDs, editRushTDsAbs, editCarries, editYpc,
    scaleTeamRushYards, teamRushTDs, teamPassAtt, teamPassTDs, recomputeTeamRushYards,
    initPassingShares, initRushingShares, editRushYds, editRushTDsCarry };
`)();

const data=JSON.parse(fs.readFileSync('/mnt/user-data/uploads/season_projections.json','utf8'));
app.loadProjections(data);
app.setTeam('SF');
const proj=app.getProj();
const sf=proj['SF'];

console.log('=== PASSING EDITS (team SF) ===');
const totalTgts=Math.round(app.teamPassAtt(sf)*0.95);
const totalTDs=app.teamPassTDs(sf);
console.log('Team pass att:',app.teamPassAtt(sf),'→ total targets:',totalTgts,'· total pass TDs:',totalTDs.toFixed(1));

// pick first receiver
const p0=sf.passing_shares[0];
console.log(`\nPlayer: ${p0.name}, baseline ypt=${p0.ypt.toFixed(2)}, catch=${(p0.catch_rate*100).toFixed(0)}%`);

// TEST A: edit Y/Tgt → projected yards should change
app.editYpt(0,'12.5');
console.log('TEST A — set Y/Tgt=12.5:', sf.passing_shares[0].ypt===12.5?'PASS':'FAIL ('+sf.passing_shares[0].ypt+')');

// TEST B: edit Receiving Yards → ypt back-computes
const projTgts0=Math.round(sf.passing_shares[0].share*totalTgts);
app.editRecYds(0,'1000');
const expectedYpt=1000/projTgts0;
console.log(`TEST B — set RecYds=1000 (over ${projTgts0} tgts): ypt=${sf.passing_shares[0].ypt.toFixed(2)} (expect ${expectedYpt.toFixed(2)})`,
  Math.abs(sf.passing_shares[0].ypt-expectedYpt)<0.01?'PASS':'FAIL');

// TEST C: edit Catch% → catch_rate changes
app.editCatchPct(0,'72');
console.log('TEST C — set Catch%=72:', Math.abs(sf.passing_shares[0].catch_rate-0.72)<0.001?'PASS':'FAIL');

// TEST D: edit Receiving TDs → td_share recomputes, shares still sum ~1
app.editRecTDs(0,'10');
const tdSum=sf.passing_shares.reduce((s,p)=>s+p.td_share,0);
const p0tds=sf.passing_shares[0].td_share*totalTDs;
console.log(`TEST D — set RecTDs=10: player now ${p0tds.toFixed(1)} TDs, td_share sum=${tdSum.toFixed(3)}`,
  Math.abs(tdSum-1)<0.01 && Math.abs(p0tds-10)<0.5?'PASS':'FAIL');

console.log('\n=== RUSHING EDITS ===');
app.setTeam('SF');
app.initRushingShares('SF');
const r=sf.rushing;
console.log('RB carries:',r.total_attempts,'· team yards:',r.total_yards,'· team rush TDs:',app.teamRushTDs(sf).toFixed(1));

// TEST E: scale team rush yards → per-player ypc scales, total hits target
const before=r.total_yards;
app.scaleTeamRushYards(sf,1800);
console.log(`TEST E — scale team yards ${before}→1800: now ${r.total_yards}`,
  Math.abs(r.total_yards-1800)<15?'PASS':'FAIL');

// TEST F: edit per-player ypc → team total recomputes
const ypcBefore=r.shares[0].ypc;
app.editYpc(0,'6.0');
console.log(`TEST F — set RB0 Y/Carry=6.0: ypc=${r.shares[0].ypc}`, r.shares[0].ypc===6.0?'PASS':'FAIL');

// TEST G: edit absolute rushing TDs → team total grows
const rtdBefore=app.teamRushTDs(sf);
app.setSub('targets','rush_tds');
const rb0name=r.shares[0].name;
app.editRushTDsAbs(0,'15');
const rtdAfter=app.teamRushTDs(sf);
const rb0tds=r.shares[0].td_share*rtdAfter;
console.log(`TEST G — set ${rb0name} rush TDs=15: team total ${rtdBefore.toFixed(1)}→${rtdAfter.toFixed(1)}, player=${rb0tds.toFixed(1)}`,
  Math.abs(rb0tds-15)<0.5?'PASS':'FAIL');

// TEST H: rankings still build cleanly, no NaN
const list=app.buildPlayerList();
const nan=list.filter(p=>isNaN(p.fpts)).length;
console.log(`\nTEST H — rankings build: ${list.length} players, ${nan} NaN`, nan===0?'PASS':'FAIL');

console.log('\n=== DONE ===');
