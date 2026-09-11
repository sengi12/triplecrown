// Live-data provenance: the sidecar names the games its plays cover and the nflverse stamps
// it was built from; the app turns that into one line ("thru Thu 9/10 · LAR@SF") with the
// full story in the title. Pinned: the latest game night wins, several games on one night
// are all named, a schedule-only sidecar says so, and no sidecar means no span at all.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  return { set:(v)=>{ TC_INSEASON=v; }, note:tcLiveDataNote, title:tcLiveDataTitle, html:tcLiveFreshHTML, facts:tcLiveDataFacts };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== a sidecar with two game nights ===');
app.set({season:2026, weeks:[1], asof:'2026-09-11T15:56:37Z',
  games:{'1':[['SEA','NE','2026-09-09'],['LAR','SF','2026-09-10']]},
  upstream:{pbp:'2026-09-11 10:01:38 EDT', nextgen_stats:'2026-09-11 08:15:55 EDT'}});
chk(app.note()==='thru Thu 9/10 · LAR@SF', `the note names the latest game night (${app.note()})`);
const t=app.title();
chk(/^plays through Thu 9\/10 \(LAR@SF\) · 2 games/.test(t), 'the title leads with the games covered');
chk(/nflverse pbp Fri 10:01 EDT/.test(t) && /NGS Fri 08:15 EDT/.test(t), 'and says when nflverse posted pbp and NGS');
chk(/baked /.test(t), 'and when the sidecar was baked');
const h=app.html();
chk(/^<span class="la-ins-fresh" title="plays through/.test(h) && />thru Thu 9\/10 · LAR@SF<\/span>$/.test(h), 'the span carries the note, the title the story');

console.log('=== a Sunday: several games on the latest night ===');
app.set({season:2026, weeks:[1], asof:'2026-09-14T12:00:00Z',
  games:{'1':[['LAR','SF','2026-09-10'],['DAL','NYG','2026-09-13'],['CIN','TB','2026-09-13'],['ARI','LAC','2026-09-13']]}, upstream:{}});
chk(app.note()==='thru Sun 9/13 · ARI@LAC, CIN@TB, DAL@NYG', `up to three games are named, alphabetical (${app.note()})`);
chk(/4 games/.test(app.title()) && !/nflverse/.test(app.title()), 'count right; no stamps → no stamp text');
app.set({season:2026, weeks:[1], asof:'2026-09-14T12:00:00Z',
  games:{'1':[['LAR','SF','2026-09-10'],['DAL','NYG','2026-09-13'],['CIN','TB','2026-09-13'],['ARI','LAC','2026-09-13'],['HOU','BUF','2026-09-13']]}, upstream:{}});
chk(app.note()==='thru Sun 9/13 · 4 games', `a full slate is a count, not a list (${app.note()})`);
chk(/\(ARI@LAC, CIN@TB, DAL@NYG, HOU@BUF\)/.test(app.title()), '…while the title still lists every game');

console.log('=== degenerate sidecars ===');
app.set({season:2026, weeks:[], asof:'2026-09-01T12:00:00Z', schedule:{}});
chk(app.note()==='schedule only' && /no plays yet/.test(app.title()), 'week zero: schedule only');
app.set({season:2026, weeks:[1,2], asof:'2026-09-22T12:00:00Z'});
chk(app.note()==='thru wk 2', 'a sidecar built before provenance falls back to its weeks list');
app.set(null);
chk(app.note()==='' && app.html()==='' && app.facts()===null, 'no sidecar → nothing rendered');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
