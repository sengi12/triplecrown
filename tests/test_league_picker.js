const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={};}abort(){}};

// Mock fetch with the user's REAL data shapes
const USER={avatar:"cfaaea56e2926d0275c1512c062a8fb8",display_name:"Sengi12",user_id:"318054040384589824",username:"sengi12"};
const STATE={week:0,season:"2026",league_season:"2026",previous_season:"2025"};
// Two leagues from the real payload (one dynasty complete, one redraft complete) + a fake open one
const LEAGUES_2026=[];  // empty (leagues haven't rolled to 2026 yet) → triggers fallback
const LEAGUES_2025=[
  {draft_id:"1180564550988939265",league_id:"1180564550988939264",name:"Originally from Ohio Dynasty League",season:"2025",status:"complete",total_rosters:12,scoring_settings:{rec:0.5},roster_positions:["QB","RB","RB","WR","WR","WR","TE","FLEX","FLEX","BN"],avatar:"93d576477b6c9e9fc0fad6e8265e3480"},
  {draft_id:"1257102686747103233",league_id:"1257102686747103232",name:"Queen City Kings",season:"2025",status:"complete",total_rosters:12,scoring_settings:{rec:1.0},roster_positions:["QB","RB","RB","WR","WR","WR","TE","FLEX","SUPER_FLEX","DEF","BN"],avatar:"b8988d0d11b143548e682ff24c039248"},
];
const DRAFT_COMPLETE={draft_id:"1180564550988939265",status:"complete",league_id:"1180564550988939264"};
const DRAFT_OPEN={draft_id:"9999999999",status:"pre_draft",league_id:"1180564550988939264"};

let fetchLog=[];
let leagueDraftsMode='single-complete';  // controls what /drafts returns
global.fetch=(u)=>{
  fetchLog.push(u);
  const J=(o)=>Promise.resolve({ok:true,json:()=>Promise.resolve(o)});
  if(u.includes('/user/sengi12')) return J(USER);
  if(u.includes('/state/nfl')) return J(STATE);
  if(u.match(/leagues\/nfl\/2026/)) return J(LEAGUES_2026);
  if(u.match(/leagues\/nfl\/2025/)) return J(LEAGUES_2025);
  if(u.match(/league\/\d+\/drafts/)){
    if(leagueDraftsMode==='has-open') return J([DRAFT_OPEN, DRAFT_COMPLETE]);
    return J([DRAFT_COMPLETE]);
  }
  if(u.match(/draft\/9999999999$/)) return J(DRAFT_OPEN);
  if(u.match(/draft\/\d+$/)) return J(DRAFT_COMPLETE);
  if(u.match(/draft\/\d+\/picks/)) return J([{player_id:'6794',picked_by:USER.user_id}]);
  return Promise.reject(new Error('unmocked '+u));
};

let toasts=[];
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(m,t){toasts.push({m,t});};
  return {
    resolveSleeperUser, fetchCurrentSeason, fetchUserLeagues, resolveLeagueDraft,
    submitLeagueUsername, pickLeague, openLeaguePicker, leagueScoringLabel, leagueIsSuperflex,
    setUsernameInput:(v)=>{document.getElementById('lpUsername').value=v;},
    getState:()=>leaguePickerState, getDraftId:()=>draftId, getToasts:()=>toasts,
    setLeagueDraftsMode:(m)=>{}, __setMode:(m)=>{globalThis.__mode=m;} };
`)();
global.toasts=toasts;

(async()=>{
  let pass=0,total=0;
  const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

  console.log('=== TEST 1: scoring + superflex label helpers ===');
  chk(app.leagueScoringLabel({rec:1.0})==='PPR','rec 1.0 → PPR');
  chk(app.leagueScoringLabel({rec:0.5})==='Half-PPR','rec 0.5 → Half-PPR');
  chk(app.leagueScoringLabel({rec:0})==='Standard','rec 0 → Standard');
  chk(app.leagueIsSuperflex(["QB","RB","SUPER_FLEX"])===true,'SUPER_FLEX detected');
  chk(app.leagueIsSuperflex(["QB","QB","RB"])===true,'2 QB slots → superflex');
  chk(app.leagueIsSuperflex(["QB","RB","WR"])===false,'single QB → not superflex');

  console.log('\n=== TEST 2: username → user_id → leagues (with 2026-empty → 2025 fallback) ===');
  app.openLeaguePicker();
  app.setUsernameInput('sengi12');
  await app.submitLeagueUsername();
  const st=app.getState();
  chk(st.user && st.user.user_id==='318054040384589824','resolved real user_id');
  chk(st.season==='2025','fell back to 2025 season when 2026 was empty');
  chk(st.leagues.length===2,'loaded 2 leagues');
  chk(st.leagues[0].name==='Originally from Ohio Dynasty League','league names present');

  console.log('\n=== TEST 3: pick a league whose draft is COMPLETE → explains, does not link ===');
  await app.pickLeague(0);
  const st2=app.getState();
  chk(app.getDraftId()==null || app.getDraftId()===null,'did NOT start following a completed draft');
  chk(/already complete/.test(st2.error||''),'shows "draft complete" message pointing to Paste draft ID');

  console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
})();
