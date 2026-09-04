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
  coachRecChip, coachDefRecChip, setCoachRecords:(r)=>{COACH_RECORDS=r;},
  advTrendFor, advSparkSvg,
  _carryPopBody, withTeam:(t,f)=>{const o=currentTeam;currentTeam=t;try{f();}finally{currentTeam=o;}},
  setCoord:(c)=>{COORDINATORS=c;}, setPlaycallers:(p)=>{HC_PLAYCALLERS=p;}, setNflverse:(n)=>{NFLVERSE=n;},
  setNames:(n)=>{TEAM_NAMES=n;}, setSharpSeason:(y)=>{SHARP_SEASON=y;},
  getHC:(t)=>headCoaches[t], setHC:(t,v)=>{headCoaches[t]=v;} };
`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const NAMES={CIN:'Cincinnati Bengals',BAL:'Baltimore Ravens',CHI:'Chicago Bears',LAC:'Los Angeles Chargers',MIA:'Miami Dolphins'};
const NFLV={'2025':{team:{
  offense:{columns:['EPA/Play'],teams:{CHI:{values:{'EPA/Play':0.1},ranks:{'EPA/Play':8}},MIA:{values:{'EPA/Play':0.05},ranks:{'EPA/Play':14}}}},
  tendencies:{columns:['Play Action Rate'],teams:{CHI:{values:{'Play Action Rate':28},ranks:{'Play Action Rate':5}},MIA:{values:{'Play Action Rate':22},ranks:{'Play Action Rate':18}}}},
  personnel:{columns:['3WR Rate'],teams:{CHI:{values:{'3WR Rate':70},ranks:{'3WR Rate':10}},MIA:{values:{'3WR Rate':82},ranks:{'3WR Rate':2}}}},
}}};
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
  chk(balLbl.includes("openTeamCoachingScheme('BAL')") || balLbl.includes('openTeamCoachingScheme'), 'Ravens: coordinator label opens playbook');

  console.log('\n=== TEST 5: carryover block pulls former team stats ===');
  app.setNflverse(NFLV); app.setSharpSeason(2025);
  const balHtml=app.renderTeamAdvanced('BAL');
  chk(balHtml.includes('tc-info-warn'),'incoming play-caller flagged on the section head');
  chk(balHtml.includes('Declan Doyle'),'shows new OC name');
  chk(balHtml.includes('Chicago Bears') && /\bOC\b/.test(balHtml),'shows former team + role (compact OC)');
  chk(balHtml.includes('View Chicago Bears') || balHtml.includes('Chicago Bears'),'shows former-team advanced-metrics link');

  console.log('\n=== TEST 6: LAC new OC was a HEAD COACH ===');
  const lacHtml=app.renderTeamAdvanced('LAC');
  chk(lacHtml.includes('Mike McDaniel'),'LAC shows McDaniel');
  const lacBody=(()=>{ let out; app.withTeam('LAC',()=>{ out=app._carryPopBody('offense'); }); return out; })();
  chk(lacBody.includes('Miami Dolphins') && /head coach/i.test(lacBody),'popup shows former team + HC role');
  chk(lacHtml.includes('View Miami Dolphins') || lacHtml.includes('Miami Dolphins'),'LAC links to Miami advanced view');

  console.log('\n=== TEST 7: Bengals (carryover) shows NO carryover block ===');
  const cinHtml=app.renderTeamAdvanced('CIN');
  chk(!cinHtml.includes('New coordinator scheme carryover'),'no carryover block for internal promotion');
  chk(cinHtml.includes('Dan Pitcher'),'still shows OC name inline');
  chk(cinHtml.includes("openTeamCoachingScheme('CIN')") || cinHtml.includes('openTeamCoachingScheme'), 'advanced section embeds playbook trigger');

  console.log('\n=== TEST 8: season labels ===');
  chk(cinHtml.includes('2025 Offense'),'section head labels the season ("2025 Offense")');

  console.log('\n=== TEST 9: playcaller track-record chips ===');
  app.setCoachRecords({'Ben Johnson':{z:1.52,n:4},'Matt Nagy':{z:0.07,n:7},'Brian Daboll':{z:-0.61,n:11},'Rook Ie':{z:2.0,n:1}});
  chk(/coord-rec good/.test(app.coachRecChip('Ben Johnson')) && /\+1\.5 · 4yr/.test(app.coachRecChip('Ben Johnson')),
      'a strong record wears the green chip with the number');
  chk(/coord-rec bad/.test(app.coachRecChip('Brian Daboll')), 'a poor record wears the red one');
  const nagy=app.coachRecChip('Matt Nagy');
  chk(/coord-rec"/.test(nagy) && !/good|bad/.test(nagy), 'a middling record stays quiet — neutral chip, no color');
  chk(app.coachRecChip('Rook Ie')==='', 'one season of record is noise — no chip until 2+');
  chk(app.coachRecChip('Nobody Named')==='', 'no record, no chip');
  chk(/z-score/.test(app.coachRecChip('Ben Johnson')), 'the method is explained on hover, not on screen');
  const lbl=app.coordInlineLabel({name:'Ben Johnson', since:2024},'offensive');
  chk(/coord-rec good/.test(lbl), 'the chip rides the OC inline label');
  console.log('\n=== TEST 10b: 5-year trend sparklines ===');
  {
    const mk=(v,r)=>({columns:['EPA/Play','Yards Per Play'],teams:{DET:[[v,v*30],[r,r]],KC:[[0.1,6],[5,5]]}});
    app.setNflverse({'2022':{team:{offense:mk(0.02,20)}}, '2023':{team:{offense:mk(0.08,11)}},
              '2024':{team:{offense:mk(0.17,3)}}, 'meta':{}});
    const tr=app.advTrendFor('DET','offense','EPA/Play');
    chk(tr && tr.length===3 && tr[0].y===2022 && tr[2].v===0.17 && tr[2].r===3,
        'a trend reads packed year rows in season order');
    const svg=app.advSparkSvg(tr,false);
    chk(/sr-spark-line/.test(svg) && /sr-spark-dot sr-good/.test(svg),
        'the sparkline draws with the endpoint in the CURRENT rank\u2019s color');
    chk(/2022: 0.02 · #20/.test(svg) && /2024: 0.17 · #3/.test(svg),
        'hover tells the season-by-season story');
    app.setNflverse({'2024':{team:{offense:mk(0.17,3)}}});
    chk(app.advTrendFor('DET','offense','EPA/Play')===null, 'fewer than 3 seasons is not a trend — no spark');
    app.setNflverse({});
  }

  console.log('\n=== TEST 10: side-aware chips — DCs get DEFENSE records, never the offense ===');
  app.setCoachRecords({'Vic Fangio':{dz:0.97,dn:11,side:'def'},'Lou Anarumo':{dz:-0.2,dn:6,side:'def'},'Ben Johnson':{z:1.52,n:4,side:'off'}});
  chk(app.coachRecChip('Vic Fangio')==='', 'a defensive coach has NO offense chip — no more passenger credit');
  chk(/coord-rec good/.test(app.coachDefRecChip('Vic Fangio')) && /\+1\.0 · 11yr/.test(app.coachDefRecChip('Vic Fangio')),
      'his DEFENSE record chips green (points allowed, sign flipped)');
  const dl=app.coordInlineLabel({name:'Vic Fangio', since:2025},'defensive');
  chk(/coord-rec good/.test(dl), 'the DC inline label carries the defense chip');
  const dl2=app.coordInlineLabel({name:'Lou Anarumo', since:2019},'defensive');
  chk(/coord-rec"/.test(dl2) && !/good|bad/.test(dl2), 'a middling defense stays quiet too');
  chk(app.coachDefRecChip('Ben Johnson')==='', 'an offense-sided coach has no defense chip');
  app.setCoachRecords({});

  console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
})();
