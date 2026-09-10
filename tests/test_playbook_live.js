// The Playbook hang (field report, 2026-09-10): opening a team's Playbook on the
// season in progress spun the tab until Firefox offered to stop the page. The
// live season's coaching sidecar does not exist on the host (its formations and
// personnel come from the participation file, published after the post-season),
// so ensureNflverseCoachingSeason resolved false — and cached that resolved
// promise. The modal's render → "not ready, load" → then(render) then re-entered
// on every microtask, forever. Pinned here: a missing season is remembered, the
// modal falls to the newest season that has a playsheet, and the render path
// runs a bounded number of times.
const elStore={};
function mkEl(id){
  if(!elStore[id]) elStore[id]={id,innerHTML:'',style:{},dataset:{},
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},
    remove(){},insertAdjacentHTML(){},getBoundingClientRect:()=>({}),setAttribute(){}};
  return elStore[id];
}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],
  createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},
  documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;
global.FileReader=function(){};global.Range=function(){};
global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
global.fetch=()=>Promise.reject(new Error('offline in test'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  let _shells=0, _renders=0;
  const _origShell=_renderSchemeLoadingShell, _origRender=_renderTeamCoachingScheme;
  _renderSchemeLoadingShell=function(){ _shells++; return _origShell(); };
  _renderTeamCoachingScheme=function(){ _renders++; return _origRender(); };
  // The host's answer per season: null = 404 (the season in progress), an object = a playsheet.
  let _files={};
  fetchSeedJson=async(url)=>{ const m=/coaching\\.(\\d{4})\\.json/.exec(url); return m ? (_files[m[1]]||null) : null; };
  return {
    open:openTeamCoachingScheme, close:closeTeamCoachingScheme, setSeason:setTeamCoachingSchemeSeason,
    setNV:(n)=>{ NFLVERSE=n; resetNflverseLazy(); }, setFiles:(f)=>{ _files=f; },
    counts:()=>({shells:_shells, renders:_renders}), reset:()=>{ _shells=0; _renders=0; },
    season:()=>schemeSeason, unavailable:coachingSeasonUnavailable,
    host:()=>_schemeOverlayHost(false), pref:_schemePreferredSeason,
  };
`)();

let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const settle=()=>new Promise(r=>setTimeout(r,60));

(async()=>{
  console.log('=== the live season has no playsheet: the modal must not spin ===');
  // The in-season sidecar puts a 2026 block in NFLVERSE (charts, rosters) — so the
  // season list offers 2026 — but no coaching file exists for it on the host.
  app.setNV({'2026':{team:{},players:{}}, '2025':{team:{}}});
  app.setFiles({'2025':{CIN:{team:'CIN',slots:{},names:{},formations:{},views:{}}}});
  app.reset();
  app.open('CIN', {season:'2026'});   // the live-season tab, as the user opened it
  await settle();
  const c1=app.counts();
  chk(c1.shells>=1, 'the 2026 load was attempted once');
  chk(c1.renders<8 && c1.shells<8, `render path is bounded (renders=${c1.renders}, shells=${c1.shells})`);
  chk(app.unavailable('2026'), 'the 404 is remembered for the session');
  chk(!app.unavailable('2025'), 'a season that loaded is not marked unavailable');
  chk(String(app.season())==='2025', `falls to the newest season with a playsheet (got ${app.season()})`);
  const html=(app.host()||{}).innerHTML||'';
  chk(/2026 playsheet publishes after the season/.test(html), 'the subtitle says why 2026 is not showing');
  chk(/scheme-tab-off/.test(html), 'the 2026 tab is dimmed, not hidden');

  console.log('=== asking for it again by tab does not re-open the trap ===');
  app.reset();
  app.setSeason('2026');
  await settle();
  const c2=app.counts();
  chk(c2.shells===0, 'a season already known missing is never re-fetched');
  chk(c2.renders<8, `tab click on a missing season is bounded (renders=${c2.renders})`);
  chk(String(app.season())==='2025', 'still shows the season that has a playsheet');

  console.log('=== nothing available at all: a plain message, no loop ===');
  app.close();
  app.setNV({'2026':{team:{}}});
  app.setFiles({});
  app.reset();
  app.open('CIN');
  await settle();
  const c3=app.counts();
  chk(c3.renders<8 && c3.shells<8, `no-season case is bounded (renders=${c3.renders}, shells=${c3.shells})`);
  const html3=(app.host()||{}).innerHTML||'';
  chk(/publishes after the season|No nflverse coaching-scheme payload/.test(html3), 'an honest empty state renders');
  chk(app.pref('CIN')==null, 'preferred season skips seasons known to be missing');
  app.close();

  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
