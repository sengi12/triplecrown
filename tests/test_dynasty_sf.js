const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={};}abort(){}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  detectLeagueFormat, ecrTableFor, formatLabel,
  setECR:(e)=>{ECR=e;},
  setFormat:(f)=>{rankFormat=f;} };
`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

// Real roster_positions from the two dynasty leagues
const DYN_HALF_RP=["QB","RB","RB","WR","WR","WR","TE","FLEX","FLEX","BN"];       // Originally from Ohio (1QB dynasty)
const DYN_2QB_RP=["QB","RB","RB","WR","WR","WR","TE","FLEX","SUPER_FLEX","DEF","BN"]; // Cyber Fantasy Legends (dynasty 2qb) — has SUPER_FLEX

console.log('=== TEST 1: dynasty_half_ppr → dynasty (1QB) ===');
chk(app.detectLeagueFormat({rec:0.5},DYN_HALF_RP,'dynasty_half_ppr',2)==='dynasty','dynasty_half_ppr → dynasty');

console.log('\n=== TEST 2: dynasty_2qb → dynasty_superflex (THE fix) ===');
chk(app.detectLeagueFormat({rec:1.0},DYN_2QB_RP,'dynasty_2qb',2)==='dynasty_superflex','dynasty_2qb scoring_type → dynasty_superflex');
// Even without the scoring_type, the SUPER_FLEX roster + dynasty type should catch it
chk(app.detectLeagueFormat({rec:1.0},DYN_2QB_RP,null,2)==='dynasty_superflex','SUPER_FLEX roster + dynasty type → dynasty_superflex');
// And via scoring_type alone even if roster missing
chk(app.detectLeagueFormat({rec:1.0},[],'dynasty_2qb',0)==='dynasty_superflex','dynasty_2qb scoring_type alone → dynasty_superflex');

console.log('\n=== TEST 3: ecrTableFor falls back gracefully ===');
app.setECR({dynasty_superflex:{a:{rank_ecr:1}}, dynasty:{b:{rank_ecr:1}}, superflex:{c:{rank_ecr:1}}});
chk(Object.keys(app.ecrTableFor('dynasty_superflex'))[0]==='a','uses dynasty_superflex table when present');
app.setECR({dynasty:{b:{rank_ecr:1}}, superflex:{c:{rank_ecr:1}}}); // no dynasty_superflex (old seed)
chk(Object.keys(app.ecrTableFor('dynasty_superflex'))[0]==='b','falls back to dynasty when dynasty_superflex missing');
app.setECR({superflex:{c:{rank_ecr:1}}}); // only superflex
chk(Object.keys(app.ecrTableFor('dynasty_superflex'))[0]==='c','falls back to superflex when only that exists');

console.log('\n=== TEST 4: label ===');
chk(app.formatLabel('dynasty_superflex')==='Dynasty Superflex','label reads "Dynasty Superflex"');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
