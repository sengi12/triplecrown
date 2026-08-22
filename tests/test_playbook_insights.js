// Team playbook modal: swipe-to-close on every tab, league-baselined TD regression,
// leader lists that rank targets by targets, modeled fallback that does not hand the lone
// back a third of the targets, and a Scheme tab with league ranks (and honest blanks for
// seasons that were never charted).
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},textContent:'',value:'',dataset:{},scrollTop:0,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},children:[],appendChild(){},querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},documentElement:{classList:{add(){},remove(){}}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),matchMedia:()=>({matches:false})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
const fs=require('fs'), path=require('path'), zlib=require('zlib');
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  setNflverse:(n)=>{NFLVERSE=n; _schemeSchemeLeagueCache={};},
  buildRegression:_schemeBuildRegression, expectedTd:_schemeExpectedTd, REG_FLAG:_SCHEME_REG_FLAG,
  buildActual:_schemeBuildActualBenefactors, MIN_RZ:_SCHEME_MIN_RZ_SAMPLE,
  renderActual:(snap,t,s)=>_schemeRenderActualBenefactors(snap,t,s), getSort:()=>schemeBenefactorSort,
  benefactors:(p)=>_schemeBuildBenefactors(p, {}),
  profile:(p)=>_schemeSchemeProfile(p), renderScheme:(p)=>_schemeRenderScheme(p), league:(s)=>_schemeSchemeLeague(s),
  bindSwipe:(host)=>_schemeBindSwipeClose(host), setOverlay:(o,t)=>{schemeOverlayOpen=o; schemeViewTab=t;},
  closed:()=>__closed, resetClosed:()=>{__closed=0;},
  setSchemeTeam:(t)=>{schemeTeam=t;},
};`.replace('return {','let __closed=0; closeTeamCoachingScheme=function(){__closed++;}; return {'))();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

// ── 1. swipe-to-close works from the chrome on every tab ───────────────────────
console.log('=== swipe-to-close: gated on where the drag starts, not which tab is open ===');
function fakeModal(){
  const handlers={};
  const modal={ _swipeBound:false, style:{}, scrollTop:0, addEventListener:(ev,fn)=>{handlers[ev]=fn;} };
  const host={ querySelector:()=>modal };
  const target=(sel)=>({ closest:(q)=>q.split(',').some(x=>sel.includes(x.trim()))?{}:null });
  const fire=(ev,opts)=>handlers[ev](Object.assign({ touches:[{clientX:10,clientY:opts.y}], changedTouches:[{clientX:10,clientY:opts.y}], target:target(opts.sel||''), preventDefault(){} }, opts));
  return {modal, host, fire};
}
function swipeFrom(sel, tab, scrollTop){
  const m=fakeModal(); m.modal.scrollTop=scrollTop||0;
  app.setOverlay(true, tab); app.resetClosed();
  app.bindSwipe(m.host);
  m.fire('touchstart',{y:0, sel});
  m.fire('touchmove',{y:60, sel});
  m.fire('touchmove',{y:140, sel});
  m.fire('touchend',{y:140, sel});
  return app.closed()>0;
}
chk(swipeFrom('.scheme-view-tabs','playbook')===true,'Playbook tab: pull from the view tabs closes');
chk(swipeFrom('.scheme-view-tabs','redzone')===true,'Red Zone tab: pull from the view tabs closes (was dead)');
chk(swipeFrom('.scheme-tabs','regression')===true,'Regression tab: pull from the season tabs closes');
chk(swipeFrom('.scheme-head','scheme')===true,'Scheme tab: pull from the header closes');
chk(swipeFrom('.scheme-close','redzone')===false,'a touch on the close button is not a drag');
chk(swipeFrom('.scheme-insights-wrap','redzone',0)===true,'body at the top: pull closes');
chk(swipeFrom('.scheme-insights-wrap','redzone',400)===false,'scrolled body: pull scrolls, never closes');
chk(swipeFrom('.scheme-view-tabs','redzone',400)===true,'chrome pull still closes even when the body is scrolled');

// ── 2. TD regression: league baseline over ALL touches ─────────────────────────
console.log('=== TD regression: league-expected TDs, not a team-internal zero-sum split ===');
const snap={ meta:{
  deep:  { name:'Deep Threat', pos:'WR', rzTgt:6,  rzAtt:0,  recTd:5, rushTd:0, tgt:120, att:0 },   // scores from distance
  gl:    { name:'Goal Line',   pos:'RB', rzTgt:2,  rzAtt:40, recTd:0, rushTd:6, tgt:20,  att:200 }, // converts at the norm
  hog:   { name:'Target Hog',  pos:'TE', rzTgt:20, rzAtt:0,  recTd:1, rushTd:0, tgt:90,  att:0 },   // badly under-scored
  lucky: { name:'Lucky',       pos:'WR', rzTgt:3,  rzAtt:0,  recTd:6, rushTd:0, tgt:30,  att:0 },   // badly over-scored
}};
const reg=app.buildRegression(snap);
const byName=Object.fromEntries(reg.rows.map(r=>[r.name,r]));
chk(Math.abs(byName['Deep Threat'].exp - (6*0.19+114*0.022))<1e-9,'xTD counts RZ targets AND open-field targets at league rates');
chk(Math.abs(byName['Goal Line'].exp - (2*0.13+18*0.012+40*0.11+160*0.011))<1e-9,'xTD for a back uses carry rates, RZ and otherwise');
chk(byName['Deep Threat'].delta < app.REG_FLAG,'a deep threat scoring 5 on 120 targets (6 in the RZ) is NOT flagged TD-dependent (was: every long TD charged to RZ touches)');
chk(Math.abs(byName['Goal Line'].delta) < app.REG_FLAG,'a goal-line back converting at the league rate is NOT a buy-low (was: team-rate zero-sum)');
chk(byName['Target Hog'].delta <= -app.REG_FLAG,'20 RZ targets for 1 TD is a buy-low');
chk(byName['Lucky'].delta >= app.REG_FLAG,'6 TDs on 3 RZ targets / 30 total is TD-dependent');
chk(Number.isFinite(reg.teamExp) && reg.teamExp>0,'team expected total reported');
chk(!reg.rows.some(r=>r.delta<=-app.REG_FLAG && r.delta>=app.REG_FLAG),'no player can be in both lists');

// ── 3. actual leader lists ─────────────────────────────────────────────────────
console.log('=== actual RZ leaders: targets ranked by target share, minimum sample ===');
const usage={ loaded:true,
  targets:{ wr1:18, te1:10, rb1:2, wr3:1 }, carries:{ rb1:30, wr1:1 },
  recTds:{}, rushTds:{}, meta:{ wr1:{name:'WR One',pos:'WR'}, te1:{name:'TE One',pos:'TE'}, rb1:{name:'RB One',pos:'RB'}, wr3:{name:'WR Three',pos:'WR'} },
  teamTgt:31, teamAtt:31 };
chk(app.getSort()==='tgt','default sort is target share');
const html=app.renderActual(usage,'KC','2025');
const order=[...html.matchAll(/scheme-benefit-name">([^<]+)</g)].map(m=>m[1]);
chk(order.indexOf('WR One')===0,`WR with 18 RZ targets tops the target leaders (got ${order[0]})`);
chk(order.indexOf('RB One') > order.indexOf('TE One'),'the goal-line back (2 targets, 30 carries) no longer leads the TARGET list on touch share');
chk(!order.slice(0,3).includes('WR Three'),'a single red-zone target does not make the leader board');
chk(order.includes('RB One') && order.lastIndexOf('RB One')>order.indexOf('TE One'),'the back still leads the rushing list');

// ── 4. modeled fallback + Scheme tab, on the real 2025 coaching sidecar ───────────
console.log('=== modeled fallback + scheme ranks on the shipped coaching sidecar ===');
const sidecar=path.join(__dirname,'..','seeds','triplecrown_seed.coaching.2025.json.gz');
const old21=path.join(__dirname,'..','seeds','triplecrown_seed.coaching.2021.json.gz');
if(fs.existsSync(sidecar)){
  const {decodeAnySeed}=require('../src/js/15b-nflverse-lazy.js');
  const c25=decodeAnySeed(JSON.parse(zlib.gunzipSync(fs.readFileSync(sidecar)).toString()));
  const nv={ '2025':{ coaching_scheme:c25 } };
  if(fs.existsSync(old21)) nv['2021']={ coaching_scheme: decodeAnySeed(JSON.parse(zlib.gunzipSync(fs.readFileSync(old21)).toString())) };
  app.setNflverse(nv);
  const det={ season:'2025', team:'DET', data:c25.DET };
  const rows=app.benefactors(det);
  const top=rows.slice().sort((a,b)=>b.oppShare-a.oppShare).slice(0,3).map(r=>r.pos);
  chk(top.filter(p=>p==='WR').length>=1,`modeled target opportunity no longer led only by the lone RB/TE (top 3: ${top.join(',')})`);
  const sumOpp=rows.reduce((t,r)=>t+r.oppShare,0);
  chk(Math.abs(sumOpp-100)<0.5,`modeled opportunity shares sum to 100 (got ${sumOpp.toFixed(1)}) — one pool, not one per position`);
  const sp=app.profile(det);
  chk(Number.isFinite(sp.paRate) && Number.isFinite(sp.motionRate),'2025: play-action and motion are charted');
  const sh=app.renderScheme(det);
  chk(/Pass rate[\s\S]*?\d+(st|nd|rd|th) of \d+/.test(sh),'Scheme tab: pass rate carries a league rank');
  chk((sh.match(/(st|nd|rd|th) of 3\d/g)||[]).length>=4,'Scheme tab: PA, motion, no-huddle and personnel all ranked');
  if(nv['2021']){
    const det21={ season:'2021', team:'DET', data:nv['2021'].coaching_scheme.DET };
    const sp21=app.profile(det21);
    chk(sp21.paRate===null && sp21.motionRate===null && sp21.nohuddleRate===null,'2021 (pre-FTN): play-action / motion / no-huddle are null, not 0.0%');
    const sh21=app.renderScheme(det21);
    chk(/Not charted for this season/.test(sh21) && !/>0\.0%/.test(sh21),'2021 Scheme tab says "not charted" instead of 0.0%');
  }
}else{
  console.log('  SKIP: coaching sidecar not present');
}

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
