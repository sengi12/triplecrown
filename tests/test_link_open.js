const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={};}abort(){}};
global.setInterval=()=>0; global.clearInterval=()=>{};

const USER={avatar:"x",display_name:"Sengi12",user_id:"318054040384589824",username:"sengi12"};
const STATE={league_season:"2026"};
// A league with an UPCOMING draft (the draft-season happy path)
const LEAGUES=[{draft_id:"1377716925001367552",league_id:"555",name:"Mock Season League",season:"2026",status:"pre_draft",total_rosters:10,scoring_settings:{rec:0.5},roster_positions:["QB","RB","RB","WR","WR","TE","FLEX"]}];
// The user's real mock draft object (pre_draft)
const DRAFT_OPEN={draft_id:"1377716925001367552",status:"pre_draft",league_id:null,settings:{teams:10,rounds:15},metadata:{scoring_type:"std"}};

global.fetch=(u)=>{
  const J=(o)=>Promise.resolve({ok:true,json:()=>Promise.resolve(o)});
  if(u.includes('/user/sengi12')) return J(USER);
  if(u.includes('/state/nfl')) return J(STATE);
  if(u.match(/leagues\/nfl\/2026/)) return J(LEAGUES);
  if(u.match(/league\/555\/drafts/)) return J([DRAFT_OPEN]);
  if(u.match(/draft\/1377716925001367552\/picks/)) return J([{player_id:'6794',picked_by:USER.user_id},{player_id:'4046',picked_by:'other'}]);
  if(u.match(/draft\/1377716925001367552$/)) return J(DRAFT_OPEN);
  return Promise.reject(new Error('unmocked '+u));
};
let toasts=[];
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(m,t){toasts.push({m,t});};
  return { submitLeagueUsername, pickLeague, openLeaguePicker,
    setUsernameInput:(v)=>{document.getElementById('lpUsername').value=v;},
    getState:()=>leaguePickerState, getDraftId:()=>draftId, getDrafted:()=>draftedIds, getToasts:()=>toasts };
`)();
global.toasts=toasts;

(async()=>{
  let pass=0,total=0;
  const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

  console.log('=== HAPPY PATH: league with an upcoming draft links and follows ===');
  app.openLeaguePicker();
  app.setUsernameInput('sengi12');
  await app.submitLeagueUsername();
  chk(app.getState().leagues.length===1,'league loaded');

  await app.pickLeague(0);
  await new Promise(r=>setTimeout(r,20));
  chk(app.getDraftId()==='1377716925001367552','draftId set to the resolved draft');
  chk(app.getState().open===false,'picker closed after linking');
  chk(Object.keys(app.getDrafted()).length===2,'picks fetched (2 drafted) via existing follow machinery');
  chk(app.getToasts().some(t=>/Linked to Mock Season League/.test(t.m)),'shows "Linked to <league>" toast');

  console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
})();
