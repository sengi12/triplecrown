const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { assembleSeed, assignQBSnapShares, normalizeSleeperRow };`)();

// Current player DB (where everyone is NOW)
const playersDB={
  'moore':{player_id:'moore',name:'DJ Moore',pos:'WR',team:'BUF',age:28},  // now on Bills
  'burrow':{player_id:'burrow',name:'Joe Burrow',pos:'QB',team:'CIN',age:28},
  'flacco':{player_id:'flacco',name:'Joe Flacco',pos:'QB',team:'CLE',age:40},
  'browning':{player_id:'browning',name:'Jake Browning',pos:'QB',team:'CIN',age:28},
};

console.log('=== TEST 1: DJ Moore on correct team per season ===');
// 2024 row says he was on CHI
const idx2024={ moore:app.normalizeSleeperRow({player_id:'moore',team:'CHI',position:'WR',stats:{rec_yd:1000,rec_tgt:140,rec:98,gp:17}}) };
const seed2024=app.assembleSeed(playersDB, idx2024);
const mooreCHI = seed2024.CHI.WR.find(p=>p.name==='DJ Moore');
const mooreBUF = seed2024.BUF.WR.find(p=>p.name==='DJ Moore');
console.log('2024 Moore on CHI:', !!mooreCHI, '| on BUF:', !!mooreBUF);
console.log('RESULT:', mooreCHI && !mooreBUF ? 'PASS' : 'FAIL');

console.log('\n=== TEST 2: rotating QB backups per season ===');
// 2023 CIN: Burrow (10 games, injured) + Browning (7 games)
const idx2023={
  burrow:app.normalizeSleeperRow({player_id:'burrow',team:'CIN',position:'QB',stats:{pass_yd:2300,pass_att:300,gp:10}}),
  browning:app.normalizeSleeperRow({player_id:'browning',team:'CIN',position:'QB',stats:{pass_yd:1900,pass_att:250,gp:7}}),
};
const seed2023=app.assembleSeed(playersDB, idx2023);
console.log('2023 CIN QBs:', seed2023.CIN.QB.map(q=>`${q.name} (${q.games_played}gp, ${(q.snap_share*100).toFixed(0)}%)`).join(', '));
const cinQBs=seed2023.CIN.QB;
console.log('RESULT:', cinQBs.length===2 && cinQBs[0].name==='Joe Burrow' ? 'PASS (Burrow primary)' : 'FAIL');

console.log('\n=== TEST 3: Rodgers 16gp → ~94% not 70% ===');
// 2025: Rodgers 16 games, backup 2 games
const idxRodgers={
  rod:app.normalizeSleeperRow({player_id:'rod',team:'PIT',position:'QB',stats:{pass_yd:3800,pass_att:520,gp:16}}),
  back:app.normalizeSleeperRow({player_id:'back',team:'PIT',position:'QB',stats:{pass_yd:200,pass_att:30,gp:2}}),
};
const seedRod=app.assembleSeed({rod:{name:'Aaron Rodgers',pos:'QB',team:'PIT'},back:{name:'Backup',pos:'QB',team:'PIT'}}, idxRodgers);
const rod=seedRod.PIT.QB.find(q=>q.name==='Aaron Rodgers');
console.log('Rodgers snap share:', (rod.snap_share*100).toFixed(0)+'% ('+(rod.snap_share*17).toFixed(1)+'/17)');
// 16gp: others=2gp <=2 and starter>=16 → bell cow = 100%. That's acceptable (he was THE starter)
console.log('RESULT:', rod.snap_share>=0.90 ? 'PASS (≥90%, not 70%)' : 'FAIL ('+(rod.snap_share*100).toFixed(0)+'%)');

console.log('\n=== TEST 4: Panthers have a QB in 2021 ===');
// Sam Darnold started for CAR in 2021
const idx2021={ darnold:app.normalizeSleeperRow({player_id:'darnold',team:'CAR',position:'QB',stats:{pass_yd:2500,pass_att:400,gp:12}}) };
const seed2021=app.assembleSeed({darnold:{name:'Sam Darnold',pos:'QB',team:'CAR'}}, idx2021);
console.log('2021 CAR QBs:', seed2021.CAR.QB.map(q=>q.name).join(', ') || 'NONE');
console.log('RESULT:', seed2021.CAR.QB.length>=1 ? 'PASS' : 'FAIL (no QB!)');

console.log('\n=== TEST 5: primary QB default (gp sort) ===');
// 2023 PIT: Wilson didn't play, it was actually a mix — test that highest gp is first
const idxPIT={
  fields:app.normalizeSleeperRow({player_id:'fields',team:'PIT',position:'QB',stats:{pass_yd:1500,pass_att:200,gp:6}}),
  wilson:app.normalizeSleeperRow({player_id:'wilson',team:'PIT',position:'QB',stats:{pass_yd:2400,pass_att:330,gp:11}}),
};
const seedPIT=app.assembleSeed({fields:{name:'Justin Fields',pos:'QB',team:'PIT'},wilson:{name:'Russell Wilson',pos:'QB',team:'PIT'}}, idxPIT);
console.log('PIT QB order:', seedPIT.PIT.QB.map(q=>`${q.name}(${q.games_played})`).join(' → '));
console.log('RESULT:', seedPIT.PIT.QB[0].name==='Russell Wilson' ? 'PASS (Wilson primary, 11gp)' : 'FAIL');

console.log('\n=== DONE ===');
