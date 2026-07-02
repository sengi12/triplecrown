const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={};}abort(){}};global.setInterval=()=>0;global.clearInterval=()=>{};

const QCK={draft_id:"1257102686747103233",league_id:"1257102686747103232",name:"Queen City Kings",season:"2025",
  scoring_settings:{"rec":1.0,"pass_yd":0.05,"pass_td":6.0,"pass_int":-2.0,"rush_yd":0.1,"rush_td":6.0,"rec_yd":0.1,"rec_td":6.0,"fum_lost":-1.0},
  roster_positions:["QB","RB","RB","WR","WR","WR","TE","FLEX","SUPER_FLEX","DEF","BN"], settings:{type:0}};
const DRAFT_COMPLETE={draft_id:"1257102686747103233",status:"complete",metadata:{scoring_type:"2qb"}};

global.fetch=(u)=>{
  const J=(o)=>Promise.resolve({ok:true,json:()=>Promise.resolve(o)});
  if(u.match(/league\/1257102686747103232\/drafts/)) return J([DRAFT_COMPLETE]);
  if(u.match(/draft\/1257102686747103233$/)) return J(DRAFT_COMPLETE);
  return Promise.reject(new Error('unmocked '+u));
};
let toasts=[];
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(m,t){toasts.push({m,t});};
  return { pickLeague, getScoring:()=>scoringSettings, getFormat:()=>rankFormat, getToasts:()=>toasts,
    seedPicker:(lg)=>{leaguePickerState={open:true,loading:false,user:{},season:'2025',leagues:[lg],error:null};} };
`)();
global.toasts=toasts;

(async()=>{
  let pass=0,total=0;
  const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
  const near=(a,b)=>Math.abs(a-b)<0.01;

  console.log('=== Picking Queen City Kings (completed draft) applies its scoring + superflex ===');
  app.seedPicker(QCK);
  await app.pickLeague(0);
  await new Promise(r=>setTimeout(r,20));
  const s=app.getScoring();
  chk(app.getFormat()==='superflex','format switched to superflex (2qb league)');
  chk(near(s.receptions,1.0),'reception value set to 1.0 (full PPR from league)');
  chk(near(s.passing_yards_yardage,20),'pass yardage set to 20 yds/pt (from pass_yd 0.05)');
  chk(near(s.passing_touchdowns,6),'pass TD set to 6');
  chk(app.getToasts().some(t=>/Applied Queen City Kings/.test(t.m)),'confirms scoring applied even for completed draft');

  console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
})();
