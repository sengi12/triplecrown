const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={};}abort(){}};

// Mock ESPN coach endpoints
const COACH_LIST={count:1,items:[{$ref:"http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/coaches/2184471?lang=en&region=us"}]};
const COACH_OBJ={id:"2184471",firstName:"Zac",lastName:"Taylor",headshot:{href:"https://a.espncdn.com/i/headshots/nfl/coaches/65/2184471.jpg"},experience:7};
global.fetch=(u)=>{
  const J=(o)=>Promise.resolve({ok:true,json:()=>Promise.resolve(o)});
  if(/teams\/4\/coaches/.test(u)) return J(COACH_LIST);
  if(/coaches\/2184471/.test(u)) return J(COACH_OBJ);
  return Promise.reject(new Error('unmocked '+u));
};

const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  fetchHeadCoach, hcIsPlaycaller, renderTeamAdvanced, coordCarriesOver, coordInlineLabel, coordFor,
  setCoord:(c)=>{COORDINATORS=c;}, setPlaycallers:(p)=>{HC_PLAYCALLERS=p;}, setSharp:(s)=>{SHARP=s;},
  setNames:(n)=>{TEAM_NAMES=n;}, setSharpSeason:(y)=>{SHARP_SEASON=y;},
  getHC:(t)=>headCoaches[t], setHC:(t,v)=>{headCoaches[t]=v;} };
`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const NAMES={CIN:'Cincinnati Bengals',BAL:'Baltimore Ravens',CHI:'Chicago Bears',LAC:'Los Angeles Chargers',MIA:'Miami Dolphins'};
const SHARP={
  offense:{title:'Offensive Metrics',category:'offense',pct_cols:[],columns:['EPA/Play'],teams:{CHI:{values:{'EPA/Play':0.1},ranks:{'EPA/Play':8}},MIA:{values:{'EPA/Play':0.05},ranks:{'EPA/Play':14}}}},
  tendencies:{title:'Tendencies',category:'offense',pct_cols:['Play Action Rate'],columns:['Play Action Rate'],teams:{CHI:{values:{'Play Action Rate':28},ranks:{'Play Action Rate':5}},MIA:{values:{'Play Action Rate':22},ranks:{'Play Action Rate':18}}}},
  personnel:{title:'Personnel',category:'offense',pct_cols:['3WR Rate'],columns:['3WR Rate'],teams:{CHI:{values:{'3WR Rate':70},ranks:{'3WR Rate':10}},MIA:{values:{'3WR Rate':82},ranks:{'3WR Rate':2}}}},
};
const COORD={
  CIN:{offense:{name:'Dan Pitcher',since:2024,is_new:false,internal:true,carryover:true,prev_code:'CIN',prev_role:'quarterbacks coach'}},
  BAL:{offense:{name:'Declan Doyle',since:2026,is_new:true,internal:false,carryover:false,prev_code:'CHI',prev_role:'offensive coordinator',prev_years:'2025'}},
  LAC:{offense:{name:'Mike McDaniel',since:2026,is_new:true,internal:false,carryover:false,prev_code:'MIA',prev_role:'head coach',prev_years:'2022-2025'}},
};

console.log('=== TEST 1: live ESPN head coach fetch ===');
app.setPlaycallers({CIN:'Zac Taylor'});
(async()=>{
  const hc=await app.fetchHeadCoach('CIN');
  chk(hc && hc.name==='Zac Taylor','fetched HC name Zac Taylor');
  chk(hc.experience===7,'experience 7');
  chk(hc.headshot.includes('2184471'),'headshot url');

  console.log('\n=== TEST 2: HC playcaller flag ===');
  chk(app.hcIsPlaycaller('CIN')===true,'Zac Taylor flagged as playcaller');
  app.setHC('BAL',{name:'John Harbaugh',experience:18});
  app.setPlaycallers({CIN:'Zac Taylor'});
  chk(app.hcIsPlaycaller('BAL')===false,'Harbaugh not in playcaller list');

  console.log('\n=== TEST 3: coordinator classification ===');
  app.setCoord(COORD);
  chk(app.coordCarriesOver(COORD.CIN.offense)===false,'Bengals (since 2024) → no carryover');
  chk(app.coordCarriesOver(COORD.BAL.offense)===true,'Ravens (new from Bears) → carryover');
  chk(app.coordCarriesOver(COORD.LAC.offense)===true,'Chargers (new from Miami) → carryover');

  console.log('\n=== TEST 4: inline coordinator labels ===');
  app.setNames(NAMES);
  const cinLbl=app.coordInlineLabel(COORD.CIN.offense,'offensive');
  chk(cinLbl.includes('Dan Pitcher')&&cinLbl.includes('since 2024'),'Bengals: name + since (no NEW tag)');
  chk(!cinLbl.includes('NEW'),'Bengals not marked NEW');
  const balLbl=app.coordInlineLabel(COORD.BAL.offense,'offensive');
  chk(balLbl.includes('Declan Doyle')&&balLbl.includes('NEW'),'Ravens: name + NEW tag');
  chk(balLbl.includes('Chicago Bears'),'Ravens: shows former team');

  console.log('\n=== TEST 5: carryover block pulls former team stats ===');
  app.setSharp(SHARP); app.setSharpSeason(2025);
  const balHtml=app.renderTeamAdvanced('BAL');
  chk(balHtml.includes('New coordinator scheme carryover'),'carryover block present');
  chk(balHtml.includes('Declan Doyle'),'shows new OC name');
  chk(balHtml.includes('Chicago Bears offensive coordinator'),'shows former role');
  chk(balHtml.includes('Tendencies')&&balHtml.includes('Personnel'),'pulls tendencies + personnel');
  // The carryover cards should show CHICAGO's values (28 PA rate, 70 3WR), not Baltimore's
  chk(balHtml.includes('28%')||balHtml.includes('28'),'carryover shows Bears PA rate');

  console.log('\n=== TEST 6: LAC new OC was a HEAD COACH ===');
  const lacHtml=app.renderTeamAdvanced('LAC');
  chk(lacHtml.includes('Mike McDaniel'),'LAC shows McDaniel');
  chk(lacHtml.includes('Miami Dolphins head coach'),'LAC spells out former HC role');
  chk(lacHtml.includes('Miami')&&(lacHtml.includes('82')||lacHtml.includes('22')),'LAC pulls Miami scheme stats');

  console.log('\n=== TEST 7: Bengals (carryover) shows NO carryover block ===');
  const cinHtml=app.renderTeamAdvanced('CIN');
  chk(!cinHtml.includes('New coordinator scheme carryover'),'no carryover block for internal promotion');
  chk(cinHtml.includes('Dan Pitcher'),'still shows OC name inline');

  console.log('\n=== TEST 8: season labels ===');
  chk(cinHtml.includes('2025 season'),'advanced note shows 2025 season');

  console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
})();
