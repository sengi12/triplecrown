const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},value:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){}}),body:{}};
global.window={};global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  renderTeamAdditions,
  setAdd:(a)=>{ADDITIONS=a;}, setNames:(n)=>{TEAM_NAMES=n;}, setTeam:(t)=>{currentTeam=t;} };`)();

const ADD={CIN:{
  free_agents:[
    {player:'Boye Mafe',pos:'OLB',years:3,value_m:60.0,aav_m:20.0},
    {player:'Joe Flacco',pos:'QB',years:1,value_m:4.0,aav_m:4.0},
    {player:'Some Back',pos:'RB',years:2,value_m:8.0,aav_m:4.0},
  ],
  draft:[
    {player:'Wide Guy',pos:'WR',years:4,value_m:12.0,aav_m:3.0},
    {player:'Tight Guy',pos:'TE',years:4,value_m:6.0,aav_m:1.5},
    {player:'Cashius Howell',pos:'ED',years:4,value_m:12.01,aav_m:3.0},
  ],
  trades:[{player:'Dexter Lawrence',pos:'DT',cap_m:20.0,detail:'Traded to Cincinnati from NYG'}],
  free_agents_lost:[
    {player:'Trey Hendrickson',pos:'OLB',to_team:'BAL',years:4,value_m:112.0,aav_m:28.0},
    {player:'Tee Higgins',pos:'WR',to_team:'NYJ',years:3,value_m:60.0,aav_m:20.0},
  ],
}};
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
app.setAdd(ADD); app.setNames({CIN:'Cincinnati Bengals'}); app.setTeam('CIN');
const html=app.renderTeamAdditions('CIN');

console.log('=== Fantasy positions get colored badges ===');
chk(html.includes('pos-badge pos-QB">QB'),'QB colored badge');
chk(html.includes('pos-badge pos-RB">RB'),'RB colored badge');
chk(html.includes('pos-badge pos-WR">WR'),'WR colored badge');
chk(html.includes('pos-badge pos-TE">TE'),'TE colored badge');

console.log('\n=== Defensive positions stay neutral ===');
chk(html.includes('add-pos">OLB'),'OLB neutral badge');
chk(html.includes('add-pos">ED'),'ED neutral badge');
chk(html.includes('add-pos">DT'),'DT neutral badge');
chk(!html.includes('pos-badge pos-OLB'),'OLB not given a fantasy color');

console.log('\n=== Destination logo on losses ===');
const lossIdx=html.indexOf('Notable Losses'); const lossSec=html.slice(lossIdx);
chk(lossSec.includes('add-dest-logo'),'destination logo img present');
chk(lossSec.includes('→ <img'),'arrow then logo');
chk(lossSec.includes('<b>BAL</b>'),'still shows team code');
chk(lossSec.includes('pos-badge pos-WR')||lossSec.includes('add-pos">WR')===false,'Higgins WR colored in losses');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
