// League setup screen: the ONE place in the analyzer that knows more than one fantasy
// platform exists. Guards the things a template string quietly gets wrong — an unbalanced
// tag, an `undefined` leaking into markup, a provider tab that throws — plus the promises the
// screen makes to the user — the public-only ESPN limitation is stated before you try, and
// Yahoo is absent rather than shown as a disabled promise.
const store={};
function mkEl(id){if(!store[id])store[id]={id,innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return store[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');
global.FileReader=function(){};global.Range=function(){};
global.fetch=()=>Promise.reject(new Error('no network in ui smoke'));
const fs=require('fs'), path=require('path');
const app=new Function(fs.readFileSync(path.join(__dirname,'check.js'),'utf8')+`
  toast=function(){}; saveSession=function(){}; persistAvailable=function(){return false;};
  return { renderLeagueAnalyzer, laSetProvider, laSetupStartHTML, getLaState:()=>laState,
           setPhase:(p)=>{currentPhase=p;} };
`)();
const host=mkEl('content');
let fails=0;
function check(label,cond,extra){ console.log((cond?'  PASS: ':'  FAIL: ')+label+(extra&&!cond?'  '+extra:'')); if(!cond)fails++; }
for(const p of ['sleeper','espn']){
  let html='';
  try{ app.laSetProvider(p); html=app.laSetupStartHTML(); }
  catch(e){ check(`${p} tab renders without throwing`, false, e.message); continue; }
  check(`${p} tab renders without throwing`, true);
  check(`  ${p}: both platform tabs shown`, (html.match(/class="la-prov[ "]/g)||[]).length === 2);
  check(`  ${p}: no undefined leaked into markup`, !/undefined/.test(html), html.slice(0,200));
  const open=(html.match(/<div/g)||[]).length, close=(html.match(/<\/div>/g)||[]).length;
  check(`  ${p}: <div> tags balanced (${open} open / ${close} close)`, open===close);
}
app.laSetProvider('espn');
const espn=app.laSetupStartHTML();
check('espn: league-link input is the primary entry point', /id="laEspnLeague"/.test(espn));
check('espn: never asks the user for a SWID', !/SWID/i.test(espn));
check('espn: never sends the user to developer tools', !/developer tools|F12|Application \u2192 Cookies/i.test(espn));
check('espn: explains where to find the league link', /address bar|leagueId=/.test(espn));
check('espn: public-only limitation stated up front', /public/i.test(espn) && /private/i.test(espn));
// Yahoo must not appear at all. Its fantasy scope is not grantable to a self-serve app
// (scope=fspt-r → invalid_scope), so a tab for it — even a disabled one — would promise
// something with no timeline behind it.
app.laSetProvider('espn');
const anyPane=app.laSetupStartHTML();
check('no Yahoo tab is offered anywhere on the setup screen', !/yahoo/i.test(anyPane));
check('only two platforms are advertised', (anyPane.match(/class="la-prov[ "]/g)||[]).length === 2);
app.laSetProvider('sleeper');
const sl=app.laSetupStartHTML();
check('sleeper: username field unchanged', /id="laUsername"/.test(sl));
check('sleeper: still says Sleeper username', /Sleeper username/.test(sl));
console.log(fails?`\nRESULT: FAIL (${fails} problems)`:'\nRESULT: PASS');
process.exit(fails?1:0);
