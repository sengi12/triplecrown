const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},value:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){}}),body:{}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  renderTeamAdditions, tabBar,
  setAdd:(a)=>{ADDITIONS=a;}, setNames:(n)=>{TEAM_NAMES=n;}, setTeam:(t)=>{currentTeam=t;} };`)();

const ADD={CIN:{
  free_agents:[{player:'Boye Mafe',pos:'OLB',years:3,value_m:60.0,aav_m:20.0}],
  draft:[{player:'Cashius Howell',pos:'ED',years:4,value_m:12.01,aav_m:3.0}],
  trades:[{player:'Dexter Lawrence',pos:'DT',cap_m:20.0,detail:'Traded to Cincinnati (CIN) from New York (NYG) for a 2026 1st round pick'}],
  free_agents_lost:[
    {player:'Trey Hendrickson',pos:'OLB',to_team:'BAL',years:4,value_m:112.0,aav_m:28.0},
    {player:'Joseph Ossai',pos:'DE',to_team:'NYJ',years:3,value_m:34.5,aav_m:11.5},
  ],
}};
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
app.setAdd(ADD); app.setNames({CIN:'Cincinnati Bengals'}); app.setTeam('CIN');

console.log('=== Tab renamed to Roster ===');
chk(app.tabBar().includes('Roster'),'tab says "Roster"');
chk(!app.tabBar().includes('New Additions'),'no longer says "New Additions"');

console.log('\n=== Notable Losses section ===');
const html=app.renderTeamAdditions('CIN');
chk(html.includes('📉 Notable Losses'),'Notable Losses section present');
const lossIdx=html.indexOf('Notable Losses');
const lossSec=html.slice(lossIdx);
chk(lossSec.includes('Trey Hendrickson'),'Hendrickson in losses');
chk(lossSec.includes('→ <b>BAL</b>')||lossSec.includes('BAL'),'shows destination BAL');
chk(lossSec.includes('$112M'),'shows $112M contract');
chk(lossSec.includes('Joseph Ossai')&&lossSec.includes('NYJ'),'Ossai → NYJ');

console.log('\n=== Losses sorted by value (Hendrickson > Ossai) ===');
chk(lossSec.indexOf('Hendrickson')<lossSec.indexOf('Ossai'),'sorted desc by value');

console.log('\n=== Losses appears at BOTTOM (after Trades) ===');
chk(html.indexOf('Notable Losses')>html.indexOf('🔄 Trades'),'losses after trades');

console.log('\n=== additions still intact ===');
chk(html.includes('Boye Mafe')&&html.includes('Cashius Howell')&&html.includes('Dexter Lawrence'),'all additions still render');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
