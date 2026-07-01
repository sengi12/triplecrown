const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  setHist:(h)=>{HISTORY_SEASONS=h;}, renderSeasonTabs, getTabsHTML:()=>document.getElementById('seasonTabs').innerHTML };`)();
// Simulate 10 years of history
app.setHist(['2025','2024','2023','2022','2021','2020','2019','2018','2017','2016']);
app.renderSeasonTabs();
const html=app.getTabsHTML();
const count=(html.match(/season-tab/g)||[]).length;
console.log('Season tabs rendered:', count, '(expect 11 = proj + 10 years)');
console.log('Contains 2016:', html.includes('2016')?'yes':'no');
console.log('RESULT:', count===11&&html.includes('2016')?'PASS':'FAIL');
