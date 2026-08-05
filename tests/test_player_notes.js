const path=require('path');
const fs=require('fs');

const _store={};
global.localStorage={
  getItem:k=>k in _store?_store[k]:null,
  setItem:(k,v)=>{_store[k]=String(v);},
  removeItem:k=>{delete _store[k];},
};

const elStore={};
function mkEl(id){
  if(!elStore[id]) elStore[id]={
    id,
    innerHTML:'',
    style:{},
    value:id==='scenarioName'?'Notes Test':'',
    textContent:'',
    dataset:{},
    disabled:false,
    classList:{add(){},remove(){},toggle(){}},
    setAttribute(){},
    getAttribute(){return '';},
    appendChild(){},
    querySelector(){return null;},
    querySelectorAll(){return [];},
    addEventListener(){},
    focus(){},
    blur(){},
  };
  return elStore[id];
}

global.document={
  getElementById:(id)=>mkEl(id),
  querySelector:()=>null,
  querySelectorAll:()=>[],
  createElement:()=>({style:{},appendChild(){},click(){},querySelector(){return null;}}),
  body:{appendChild(){},removeChild(){}},
  addEventListener(){},
};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){}}};
global.confirm=()=>true;
global.btoa=s=>Buffer.from(s,'binary').toString('base64');
global.FileReader=function(){};
global.Range=function(){};
global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.fetch=()=>Promise.reject(new Error('no net'));
global.setTimeout=(fn)=>{fn();return 0;};
global.clearTimeout=()=>{};
global.toast=()=>{};

const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  saveSession, loadSession, setPlayerNoteText, addPlayerNoteTag, getPlayerNote, buildOutput, loadProjections,
  setReady:(b)=>{_persistReady=b;},
  setWorking:(w)=>{workingProj=w; userProj=w;},
  setSeed:(s)=>{SEED=s; projSeed=s; seasonStatsCache.proj=s;},
  setSleeper:(p)=>{sleeperPlayers=p;},
  setPlayerNotes:(n)=>{playerNotes=n;},
  getPlayerNotes:()=>playerNotes,
};`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const baseTeamState={
  qbs:[{name:'Joe Burrow',player_id:'6770',headshot:null,slug:null,passing_yards:4700,passing_tds:35,passing_attempts:620,passing_completions:430,interceptions_thrown:10,qb_rush_yards:180,qb_rush_tds:2,qb_rush_attempts:30,games:17,games_played:17,base_games:17,snap_share:1}],
  activeQB:0,
  passing_shares:[],
  rushing:{shares:[],total_attempts:0,total_yards:0,ypa:4,total_rush_tds:0},
};
const working={CIN:JSON.parse(JSON.stringify(baseTeamState))};
const seed={};
['ATL','ARI','BAL','BUF','CAR','CHI','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS'].forEach(t=>{seed[t]={QB:[],RB:[],WR:[],TE:[]};});
seed.CIN={
  QB:[{player_id:'6770',name:'Joe Burrow',pos:'QB',team:'CIN',adp:50,adp_ppr:50,adp_half_ppr:50,adp_2qb:20,bye_week:10}],
  RB:[],WR:[],TE:[]
};

console.log('=== notes persist in session payload ===');
app.setReady(true);
app.setSeed(seed);
app.setWorking(JSON.parse(JSON.stringify(working)));
app.setSleeper({'6770':{player_id:'6770',name:'Joe Burrow',pos:'QB',team:'CIN'}});
app.setPlayerNoteText('6770','QB','CIN','Trust the volume.');
app.addPlayerNoteTag('6770','QB','CIN',{label:'EPA/Play',value:'0.31',source:'rankings_advanced',statKey:'epa_play',context:'2025 adv metrics'});
app.saveSession();
const loaded=app.loadSession();
chk(!!loaded && !!loaded.playerNotes,'playerNotes saved into session payload');
chk(loaded.playerNotes['pid:6770'].text==='Trust the volume.','note text persisted in session');
chk((loaded.playerNotes['pid:6770'].tags||[]).length===1,'note tags persisted in session');

console.log('\n=== notes export with projections ===');
const exported=app.buildOutput();
chk(!!exported.playerNotes,'playerNotes included in export payload');
chk(exported.playerNotes['pid:6770'].tags[0].label==='EPA/Play','export keeps tagged stat metadata');

console.log('\n=== notes restore on import ===');
app.setPlayerNotes({});
app.loadProjections(exported);
const restored=app.getPlayerNote('6770','QB','CIN');
chk(!!restored,'player note restored after import');
chk(restored.text==='Trust the volume.','import restores note text');
chk((restored.tags||[])[0] && restored.tags[0].context==='2025 adv metrics','import restores tag context');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));