const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};global.Chart=function(){return{destroy(){},update(){}};};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={};}abort(){}};
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  renderTeamAdvanced, playcallerHCOffenseSource, hcIsPlaycaller, _carryPopBody,
  setTeamVar:(t)=>{currentTeam=t;},
  setNflverse:(n)=>{NFLVERSE=n;}, setCoord:(c)=>{COORDINATORS=c;}, setNames:(n)=>{TEAM_NAMES=n;},
  setSharpSeason:(y)=>{SHARP_SEASON=y;}, setHC:(t,v)=>{headCoaches[t]=v;},
  setPlaycallers:(p)=>{HC_PLAYCALLERS=p;}, setHCHist:(h)=>{HC_HISTORY=h;} };`)();

let pass=0,total=0; const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

// Sharp offensive tables incl tendencies + personnel; Cleveland (Stefanski's former team) has data
const NFLV={'2025':{team:{
  offense:{columns:['EPA/Play'],teams:{ATL:{values:{'EPA/Play':0.02},ranks:{'EPA/Play':18}},CLE:{values:{'EPA/Play':-0.05},ranks:{'EPA/Play':25}},DET:{values:{'EPA/Play':0.07},ranks:{'EPA/Play':11}}}},
  tendencies:{columns:['Play Action Rate'],teams:{ATL:{values:{'Play Action Rate':24},ranks:{'Play Action Rate':14}},CLE:{values:{'Play Action Rate':31},ranks:{'Play Action Rate':3}},DET:{values:{'Play Action Rate':27},ranks:{'Play Action Rate':9}}}},
  personnel:{columns:['3WR Rate'],teams:{ATL:{values:{'3WR Rate':60},ranks:{'3WR Rate':22}},CLE:{values:{'3WR Rate':75},ranks:{'3WR Rate':7}},DET:{values:{'3WR Rate':72},ranks:{'3WR Rate':12}}}},
}}};
app.setNflverse(NFLV); app.setNames({ATL:'Atlanta Falcons',CLE:'Cleveland Browns',DET:'Detroit Lions'}); app.setSharpSeason(2025);
app.setHC('ATL',{name:'Kevin Stefanski',experience:7}); app.setHC('DET',{name:'Dan Campbell',experience:5});

console.log('=== TEST 1: playcaller-HC offense source resolves to HC former team ===');
app.setPlaycallers({ATL:'Kevin Stefanski'});
app.setHCHist({ATL:{name:'Kevin Stefanski',since:2026,is_new:true,prev_code:'CLE',prev_role:'head coach',prev_years:'2020-2025'}});
const src=app.playcallerHCOffenseSource('ATL');
chk(src && src.prev_code==='CLE','offense source = Cleveland (HC former team)');
chk(src._fromHC===true,'flagged as from HC');
chk(app.hcIsPlaycaller('ATL')===true,'Stefanski is playcaller');

console.log('\n=== TEST 2: Falcons carryover pulls CLEVELAND scheme, labeled as play-calling HC ===');
// Give ATL an OC that came from a DIFFERENT team (Detroit) to prove HC wins over OC
app.setCoord({ATL:{offense:{name:'Some OC',since:2026,is_new:true,internal:false,carryover:false,prev_code:'DET',prev_role:'passing game coordinator'}}});
app.setTeamVar('ATL');
const html=app.renderTeamAdvanced('ATL');
chk(html.includes('tc-info-warn'),'yellow ! flag on the section head (the card is gone)');
const body=app._carryPopBody('offense');
chk(/play-calling HC/i.test(body),'popup labeled as play-calling HC (badge)');
chk(body.includes('Kevin Stefanski'),'popup shows HC name');
chk(body.includes('Cleveland Browns'),'popup pulls Cleveland, not Detroit');
chk(body.includes("advJumpToTeam('CLE')"),'popup chip jumps to Cleveland advanced view');
chk(!body.includes('Detroit'),'popup does not point to Detroit');

console.log('\n=== TEST 3: non-playcaller HC → OC drives carryover (unchanged behavior) ===');
app.setPlaycallers({});  // ATL HC not a playcaller now
app.setHCHist({ATL:{name:'Kevin Stefanski',since:2026,is_new:true,prev_code:'CLE',prev_role:'head coach'}});
app.setCoord({ATL:{offense:{name:'Some OC',since:2026,is_new:true,internal:false,carryover:false,prev_code:'DET',prev_role:'offensive coordinator'}}});
app.renderTeamAdvanced('ATL');
const body3=app._carryPopBody('offense');
chk(body3.includes('Detroit'),'non-playcaller HC → popup uses OC former team (Detroit)');
chk(!body3.includes('play-calling'),'not labeled as play-calling HC');

console.log('\n=== TEST 4: playcaller HC who is NOT new → no HC carryover ===');
app.setPlaycallers({ATL:'Kevin Stefanski'});
app.setHCHist({ATL:{name:'Kevin Stefanski',since:2020,is_new:false,prev_code:'CLE',prev_role:'head coach'}});
chk(app.playcallerHCOffenseSource('ATL')===null,'established playcaller HC → no carryover source');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
