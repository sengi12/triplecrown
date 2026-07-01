const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { sumWeeklyRange, applyWeekFilterOverrides, isWeekFilterActive };`)();

console.log('=== TEST: Tucker Kraft weeks 1-9 (hot stretch) vs full season ===');
const weekly=JSON.parse(fs.readFileSync(require('path').join(__dirname,'kraft_weekly.json'),'utf8'));
const full=app.sumWeeklyRange(weekly,'GB',1,18);
const hot=app.sumWeeklyRange(weekly,'GB',1,9);
console.log('Full season (wk1-18):', JSON.stringify(full));
console.log('Hot stretch (wk1-9): ', JSON.stringify(hot));
// Manual check: rec_tgt sum wk1-9 = 4+7+4+5+2+10+9+3 = 44 (week5 is bye/null)
const expectedTgts=4+7+4+5+2+10+9+3;
const expectedYds=16+124+29+56+43+58+143+20;
console.log('Expected targets:', expectedTgts, '| got:', hot.receiving_targets);
console.log('Expected yards:', expectedYds, '| got:', hot.receiving_yards);
console.log('RESULT:', hot.receiving_targets===expectedTgts && hot.receiving_yards===expectedYds && full.receiving_targets===expectedTgts ? 'PASS (full season = hot stretch since no games after wk9)':'FAIL');

console.log('\n=== TEST: isWeekFilterActive ===');
console.log('Default [1,18]:', app.isWeekFilterActive({weekFilter:[1,18]}), '(expect false)');
console.log('Narrowed [1,9]:', app.isWeekFilterActive({weekFilter:[1,9]}), '(expect true)');
console.log('No filter set:', app.isWeekFilterActive({}), '(expect false)');
const ok2 = app.isWeekFilterActive({weekFilter:[1,18]})===false && app.isWeekFilterActive({weekFilter:[1,9]})===true && app.isWeekFilterActive({})===false;
console.log('RESULT:', ok2?'PASS':'FAIL');

console.log('\n=== TEST: applyWeekFilterOverrides preserves players with no fetched data ===');
const roster=[{player_id:'9484',name:'Tucker Kraft',pos:'TE',receiving_targets:999,receiving_yards:999},
              {player_id:'unknown',name:'No Data Guy',pos:'WR',receiving_targets:50,receiving_yards:500}];
const filterData={'9484': hot};
const overlaid=app.applyWeekFilterOverrides(roster, filterData);
console.log('Kraft overridden targets:', overlaid[0].receiving_targets, '(expect',expectedTgts+')');
console.log('No-data player keeps season totals:', overlaid[1].receiving_targets, '(expect 50)');
console.log('RESULT:', overlaid[0].receiving_targets===expectedTgts && overlaid[1].receiving_targets===50?'PASS':'FAIL');
