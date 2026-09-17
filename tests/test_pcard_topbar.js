// The player card's top bar on a phone: icon tabs (inactive ones collapse to the icon in
// CSS), the PROJECTIONS toggle at the row's right end that drops the model row down, and
// the season picker — one strip of season tabs that doubles as the phone's "2026 ▾" menu.
const elStore={};
function mkEl(id){if(!elStore[id]){const kids=[];elStore[id]={id,innerHTML:'',hidden:false,style:{},dataset:{},textContent:'',title:'',
  classList:{_s:new Set(),add(c){this._s.add(c);},remove(c){this._s.delete(c);},toggle(c,on){(on===undefined?!this._s.has(c):on)?this._s.add(c):this._s.delete(c);},contains(c){return this._s.has(c);}},
  querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){},setAttribute(){},getBoundingClientRect:()=>({top:0,left:0,width:0,height:0})};}return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('_n'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{},classList:{add(){},remove(){},toggle(){}}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),innerWidth:390};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  pcardRoutesAvailable=()=>false; pcardQbPassingAvailable=()=>true; pcardQbOlAvailable=()=>true; pcardRbFanAvailable=()=>false; pcardOlAvailable=()=>false; pcardNewsAvailable=()=>true;
  let tcRow='<div class="tc-model-row">PROJECTIONS 19.5 vs 21.4</div>';
  renderTcModel=(pid)=>tcRow;
  return { tabs:()=>{ renderPcardStatTabs(); return document.getElementById('pcardTabs').innerHTML; },
    setState:(pid,posc)=>{ pcardState={pid:String(pid),posc,team:'CIN',isSkill:posc!=='QB',isOl:false,isDefense:false}; pcardStatsMode='pro'; },
    setMode:(m)=>{ pcardStatsMode=m; }, setRow:(h)=>{ tcRow=h; },
    vsToggle:pcardVsProjToggle, vsRender:pcardVsProjRender, vsOpen:()=>_pcardVsOpen, setPace:(h)=>{ _pcardLastPace=h; },
    seasons:loadSleeperCareerStats, select:pcardSelectSeason, setSeasons:(list)=>{ pcardEligibleSeasons=()=>list; },
    icon:(n)=>TC_ICON(n), hasIcon:(n)=>TC_ICON.has(n) };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
(async()=>{
  console.log('=== icon tabs ===');
  chk(app.hasIcon('nfl') && app.hasIcon('ncaa') && app.hasIcon('news') && app.hasIcon('pass') && app.hasIcon('wall'), 'the icon set carries the NFL and NCAA wordmarks and a paper for News beside the pass / wall marks');
  chk(/<span class="tc-ico tc-ico-mask tc-ico-nfl"/.test(app.icon('nfl')) && /tc-ico-ncaa/.test(app.icon('ncaa')) && /<svg/.test(app.icon('news')), 'the wordmarks are currentColor masks (theme-painted), the rest strokes');
  app.setState('6770','QB');
  let tabs=app.tabs();
  const tabOf=(mode)=>(tabs.match(new RegExp(`<button class="pcard-tab[^"]*" onclick="setPcardStatsMode\\('${mode}'\\)"[^>]*>[\\s\\S]*?</button>`))||[''])[0];
  chk(/tc-ico-nfl/.test(tabOf('pro')) && !/tab-lbl/.test(tabOf('pro')) && /title="NFL"/.test(tabOf('pro')), 'NFL: the shield lettering alone — no label, the title carries the word');
  chk(/tc-ico-ncaa/.test(tabOf('college')) && !/tab-lbl/.test(tabOf('college')) && /title="College"/.test(tabOf('college')) && /tc-ico/.test(tabOf('passing')) && /tab-lbl">Passing Chart</.test(tabOf('passing')) && /tc-ico/.test(tabOf('qbol')) && /tab-lbl">Offensive Line</.test(tabOf('qbol')) && /tc-ico/.test(tabOf('news')) && /tab-lbl">News</.test(tabOf('news')), 'College: the NCAA mark alone; Passing Chart, Offensive Line, News: each an icon + label (CSS collapses the inactive labels on a phone)');
  chk(/title="Passing Chart"/.test(tabOf('passing')), 'the label rides along as the title, so the collapsed icon still explains itself');
  chk(tabOf('pro').includes('class="pcard-tab active"') && !/pcard-proj-btn/.test(tabs), 'NFL is the active tab; the tab row carries nothing else');

  console.log('=== the season picker, and the PROJECTIONS row above it ===');
  app.setSeasons(['2026','2025','2024']);
  const body=mkEl('cardBody');
  await app.seasons('6770','QB',body);
  chk(/^<div class="pcard-proj-tap[^"]*" id="pcardProjTap" role="button" aria-expanded="false" onclick="pcardVsProjToggle\(\)"><div class="tc-model-row">PROJECTIONS 19\.5 vs 21\.4<\/div><\/div><div class="pcard-vsproj" id="pcardVsProj" hidden><\/div>/.test(body.innerHTML), 'the PROJECTIONS row (TC vs Sleeper) leads the log, tappable, with its drop-down slot right beneath');
  chk(/class="pcard-season-pick" id="pcardSeasonPick"/.test(body.innerHTML) && /pcard-season-btn/.test(body.innerHTML) && /id="pcardSeasonBtnTxt">2026</.test(body.innerHTML), 'then one picker: a "2026 ▾" button (the phone) …');
  chk(/id="pcardSeasonTabs"/.test(body.innerHTML) && /pcst_2026/.test(body.innerHTML) && /pcst_2025/.test(body.innerHTML) && /pcst_2024/.test(body.innerHTML), '… and the strip of season tabs (wide screens) — the same buttons are the phone\'s menu');
  const pick=mkEl('pcardSeasonPick'); pick.classList.add('open');
  await app.select('6770','2025','QB');
  chk(mkEl('pcardSeasonBtnTxt').textContent==='2025' && !pick.classList.contains('open'), 'picking a season relabels the button and folds the menu');
  app.setRow(''); body.innerHTML=''; await app.seasons('6770','QB',body);
  chk(!/pcardProjTap|pcardVsProj/.test(body.innerHTML) && /pcardSeasonPick/.test(body.innerHTML), 'no model row for him (a rookie) → the log starts at the picker, no empty tap target');
  app.setRow('<div class="tc-model-row">x</div>');

  console.log('=== the "vs projection" drop-down ===');
  const slot=mkEl('pcardVsProj'), tap=mkEl('pcardProjTap');
  const pace='<div class="pcard-pace"><span class="pcard-pace-lbl">vs projection</span><div class="pace-strip">Att 35.0 vs 32.3/gm +8%</div></div>';
  app.setPace(pace); app.vsRender();
  chk(slot.hidden===true && slot.innerHTML==='' && tap.classList.contains('has-pace') && !tap.classList.contains('open'), 'live season: the row grows its caret (has-pace), the strip stays folded — the busy chips are out of the log');
  app.vsToggle();
  chk(app.vsOpen()===true && slot.hidden===false && slot.innerHTML===pace && tap.classList.contains('open'), 'tap the PROJECTIONS row: the strip drops down directly beneath it');
  app.setPace(''); app.vsRender();
  chk(slot.hidden===true && slot.innerHTML==='' && !tap.classList.contains('has-pace'), 'a past season has no strip: the slot empties and the caret goes (the open state is remembered)');
  app.setPace(pace); app.vsRender();
  chk(slot.hidden===false && slot.innerHTML===pace, 'back on the live season it is open again');
  app.vsToggle();
  chk(app.vsOpen()===false && slot.hidden===true && !tap.classList.contains('open') && tap.classList.contains('has-pace'), 'tap again: folded, the caret stays');
  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
