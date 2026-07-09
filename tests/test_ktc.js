// KeepTradeCut player-card link: name/position lookup, URL build, position guard, misses.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const path=require('path');
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  ecrNormName, ktcEntry, ktcLinkHTML,
  setKTC:(k)=>{KTC=k;} };
`)();

let pass=0, fail=0;
function ok(cond, msg){ if(cond){ console.log('  PASS '+msg); pass++; } else { console.log('  FAIL '+msg); fail++; } }

console.log('=== TEST 1: KTC lookup + URL build ===');
app.setKTC({
  'bijan robinson':{slug:'bijan-robinson-1414', pos:'RB'},
  'jamarr chase':{slug:'ja-marr-chase-1004', pos:'WR'},
});
const e = app.ktcEntry('Bijan Robinson','RB');
ok(e && e.slug==='bijan-robinson-1414', 'resolves Bijan Robinson slug');
const html = app.ktcLinkHTML('Bijan Robinson','RB');
ok(html.includes('https://keeptradecut.com/dynasty-rankings/players/bijan-robinson-1414'), 'link URL uses the slug');
ok(/target="_blank"/.test(html) && /rel="noopener/.test(html), 'opens in a new tab safely (noopener)');

console.log('\n=== TEST 2: name normalization (apostrophe) matches build_seed _norm_name ===');
const chase = app.ktcLinkHTML("Ja'Marr Chase",'WR');
ok(chase.includes('ja-marr-chase-1004'), "Ja'Marr Chase resolves despite apostrophe");

console.log('\n=== TEST 3: position guard ===');
ok(app.ktcEntry('Bijan Robinson','WR')===null, 'RB entry not returned for a WR card (same name, wrong pos)');
ok(app.ktcEntry('Bijan Robinson',null)!==null, 'no position → still resolves (no guard)');

console.log(`\n=== TEST 4: misses render nothing ===`);
ok(app.ktcLinkHTML('Nobody Here','WR')==='', 'unknown player → empty string');
app.setKTC({});
ok(app.ktcLinkHTML('Bijan Robinson','RB')==='', 'empty KTC map → empty string');

if(fail===0) console.log(`\nRESULT: PASS (${pass} checks)`);
else console.log(`\nRESULT: FAIL (${pass} pass, ${fail} bad)`);
process.exit(fail===0?0:1);
