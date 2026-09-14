// A rookie lineman's OL tab: the college line context (his unit's numbers by season with FBS
// percentiles) stands alone when he has no NFL grades, rides beneath them when he does, and
// the College tab's prospect panel stays out of a lineman's way.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){},matchMedia:()=>({matches:false})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={};}abort(){}};
global.fetch=()=>Promise.reject(new Error('offline'));global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  return { avail:pcardOlAvailable, render:renderPcardOlGrades, college:renderPcardOlCollege, prospect:renderCfbProspect,
    setCfb:(c)=>{ CFB=c; }, setPlayers:(p)=>{ sleeperPlayers=p; }, setNflverse:(n)=>{ NFLVERSE=n; }, setPcardState:(s)=>{ pcardState=s; } };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const row=(season,team,conf,ly,stuff,tfl,power,sack,pct)=>({season,team,conf,rushes:410,dropbacks:380,ly,stuff,tfl,power,sack,opp_elo:1610,pct});
app.setPlayers({'9':{name:'Test Tackle',pos:'OT',team:'SEA'}, '10':{name:'Vet Guard',pos:'G',team:'SEA'}});
app.setCfb({players:{'9':{name:'Test Tackle',pos:'OT',college:'Oregon',ol_unit:{schema:'cfb_ol_unit_v1',seasons:[
  row(2024,'Oregon','Big Ten',3.41,12.1,6.2,71.4,4.2,{ly:88,stuff:90,tfl:84,power:66,sack:71}),
  row(2025,'Oregon','Big Ten',3.63,11.4,7.0,77.8,4.8,{ly:97,stuff:95,tfl:81,power:73,sack:66})]}}}});
app.setNflverse({'2025':{ol_players:{}}});
app.setPcardState({pid:'9',posc:'OT',team:'SEA',isOl:true});

console.log('=== a rookie with no NFL grades ===');
chk(app.avail('9')===true, 'the OL tab is available on the strength of the college context alone');
let h=app.render('9');
chk(/College line context/.test(h) && /Oregon/.test(h) && !/No OL grades/.test(h), 'the college block stands alone — no "No OL grades" message');
chk(/<td class="pcard-wk">2025<\/td>/.test(h) && h.indexOf('>2025<')<h.indexOf('>2024<'), 'seasons newest first');
chk(/Line yds\/carry/.test(h) && /Stuff %/.test(h) && /TFL %/.test(h) && /Power %/.test(h) && /Sack %/.test(h), 'the five unit metrics as columns');
chk(/3\.63<small class="olc-cc-pct">97</.test(h) && /4\.8<small class="olc-cc-pct">66</.test(h), 'each cell carries the number and the FBS percentile');
chk(/97th percentile of FBS units/.test(h), 'the percentile is spelled out in the cell\'s title');
chk(/unit&#39;s|unit's/.test(h.replace(/&#x27;/g,"'")) && /no lineman attribution/.test(h), 'the note says these are the unit\'s numbers, not his');
chk(/Big Ten/.test(h) && />1610</.test(h), 'conference and opponent Elo ride along');
chk(app.prospect('9')==='', 'the College tab\'s prospect panel has nothing to add for a lineman-only profile');

console.log('=== a lineman with NFL grades keeps the college line beneath them ===');
app.setNflverse({'2025':{ol_players:{'test tackle':{team:'SEA',consensus:62}}}});
h=app.render('9');
chk(/College line context/.test(h) && h.indexOf('College line context')>h.indexOf('olc-'), 'NFL grades first, the college block after');

console.log('=== nothing for a veteran without a profile ===');
app.setNflverse({'2025':{ol_players:{}}});
chk(app.college('10')==='' && app.avail('10')===false && /No OL grades/.test(app.render('10')), 'no college context, no NFL grades → the plain empty state');
console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
