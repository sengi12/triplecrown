// The Playbook's Tendencies tab: the team's numbers beside the league's in the modal's paper
// idiom, ranks among the teams that have them, the live season reachable from the season row
// before its playsheet publishes, honest empties — and the call sheet left as one page whose
// scripts parse (the OPEN_PAGE double-declaration that emptied the Formations grid).
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},insertAdjacentHTML(){},remove(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};global.fetch=()=>Promise.reject(new Error('offline'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs'), path=require('path');
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { render:_schemeRenderTendencies, has:_schemeHasTendencies, norm:_schemeNormTab, tabHas:_schemeTabHasSeason, tpl:(t,p)=>_schemeRenderTemplate(t,p),
  setNflverse:(n)=>{NFLVERSE=n;}, setTeam:(t)=>{schemeTeam=t;}, setTab:(t)=>{schemeViewTab=t;}, setYear:(y)=>{TC_SEASON.year=y;}, template:()=>SCHEME_TEMPLATE_INLINE,
  noPlaysheet:(s)=>{ _coachingSeasonFailed[String(s)]=true; }, adopt:_adoptInseason, nv:()=>NFLVERSE };`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const off=(o)=>Object.assign({plays:1000, pass_rate:58,
  situations:{'1st':{n:400,pass:50,lg:48,epa:0.02},'3rd & long':{n:80,pass:90,lg:85,epa:-0.1},'Red zone':{n:0,pass:null,lg:55,epa:null}},
  guess:{situation:66.0, team:70.5, beyond:4.5, naive:58},
  sequencing:{pass_after_pass:60,pass_after_run:52,n_after_pass:300,n_after_run:300,streak_lift:8,formation_hold:70,no_huddle:5},
  play_action:{rate_early:28,n_early:300,epa:0.15,n:120,epa_without:0.05,n_without:400,epa_after_run:0.12,n_after_run:60,epa_cold:0.18,n_cold:60},
  motion:{rate:55,n:1000,epa:0.06,n_with:550,epa_without:0.02,n_without:450,epa_pass:0.1,epa_pass_without:0.05}}, o);
const de=(o)=>Object.assign({plays:1000, blitz:{rate:30,n:600,'1st down':{rate:20,n:200},'3rd & long':{rate:45,n:80},'Red zone':{rate:null,n:3},'Trailing 9+':{rate:33,n:50},'Leading 9+':{rate:25,n:50},
  after_blitz:40,after_none:26,streak_lift:14,n_after_blitz:150,n_after_none:400,pressure_with:38,pressure_without:24,epa_with:-0.05,epa_without:0.03},
  box:{light:40,heavy:20,n:400,epa_light:0.05,epa_heavy:-0.1}}, o);
const block=(teams)=>({schema:'tendencies_v1', teams, n_teams:Object.keys(teams).length, has_ftn:true,
  league:{offense:off({guess:{situation:66.0, team:66.0, beyond:0, naive:55}}), defense:de({})}});
app.setNflverse({'2025':{tendencies:block({DET:{offense:off({guess:{situation:66.0,team:72.0,beyond:6.0,naive:60}}), defense:de({})},
                                               SEA:{offense:off({guess:{situation:66.0,team:64.0,beyond:-2.0,naive:52}, motion:{rate:70,n:900,epa:0.1,n_with:600,epa_without:0.0,n_without:300,epa_pass:0.1,epa_pass_without:0.0}}), defense:de({blitz:{rate:45,n:600,streak_lift:20,after_blitz:50,after_none:30}})}})},
                 '2026':{tendencies:block({DET:{offense:off({}), defense:de({})}})},
                 '2024':{}});
app.setYear(2026); app.setTeam('DET');

console.log('=== the tab ===');
chk(app.norm('tendencies')==='tendencies' && app.norm('tend')==='tendencies' && app.norm('scheme')==='scheme' && app.norm('x')==='playbook', 'the modal has a Tendencies tab id of its own');
const src=fs.readFileSync(path.join(__dirname,'..','src/js/73-coaching-scheme.js'),'utf8');
chk(/setTeamCoachingSchemeTab\('tendencies'\)">Tendencies<\/button>/.test(src) && /schemeViewTab==='tendencies'[^\n]*_schemeRenderTendencies\(/.test(src), 'the tab sits in the row with Playbook, Red Zone, Regression and Scheme, and renders through the same insight path');
chk(app.has('2025','DET') && app.has('2025','SEA') && app.has('2026','DET') && !app.has('2026','KC') && !app.has('2024','DET') && !app.has(null,'DET'), 'has-tendencies: by season and team');
app.noPlaysheet('2026');   // the season in progress: its participation file publishes after the season
app.setTab('playbook'); const pbOff=!app.tabHas('2026');
app.setTab('tendencies'); const tendOn=app.tabHas('2026');
chk(pbOff && tendOn, 'the season row: 2026 is off for the Playbook (no playsheet yet) and on for Tendencies (the sidecar has it)');

console.log('=== the render ===');
let h=app.render({team:'DET', season:'2025'});
chk(/scheme-insights-wrap scheme-tend/.test(h) && /scheme-insights-pill">Tendencies · 2025</.test(h) && /1,000 plays · 2 teams ranked/.test(h), 'the paper wrap with the season pill and the samples');
chk(/How guessable is the call/.test(h) && /<b>72\.0%<\/b>/.test(h) && /\+6\.0 pp/.test(h) && /1st of 2 most guessable/.test(h) && /tn-rank hi/.test(h), 'guessability stamp: the rate, beyond the situation, ranked first and stamped green');
chk(/3rd &amp; long<small>80<\/small>/.test(h) && /PASS 90%/.test(h) && /class="lg" style="left:15\.0%"/.test(h) && !/Red zone<small>0/.test(h), 'situations: run/pass bars with the league tick; an empty situation is left out');
chk(/Streak lift/.test(h) && /Formation hold/.test(h) && /Cold/.test(h) && /After a run/.test(h) && /Motion rate/.test(h) && /lg 55%/.test(h), 'sequencing, play action (after a run vs cold) and motion, each with the league beside');
chk(/blitz habits/.test(h) && /<b>30%<\/b>/.test(h) && /2nd of 2/.test(h) && /Stacked box vs run/.test(h), 'the defense: the blitz stamp ranked second of two, situations, box counts');
chk(/tn-card/.test(h) && /tn-kv/.test(h) && !/pgtab|tn-seasons|parent\./.test(h), 'rendered in the modal\'s classes: no in-sheet page tabs, no season chips of its own');
chk(/The Side Quest/.test(h) && /scheme-insight-note/.test(h), 'credits the methods in the paper footnote');
h=app.render({team:'DET', season:'2026'});
chk(/Tendencies · 2026 · live/.test(h) && /scheme-insights-pill neutral/.test(h) && /1 teams ranked/.test(h), 'the season in progress is marked live on its pill');
h=app.render({team:'KC', season:'2026'});
chk(/No tendencies for KC in 2026 yet/.test(h) && /scheme-empty/.test(h), 'a team without a block in the season says so');
app.setNflverse({'2025':{tendencies:{teams:{}, league:{}, n_teams:0}}});
chk(/build from the season/.test(app.render({team:'DET', season:''})) && /No tendencies for DET in 2025/.test(app.render({team:'DET', season:'2025'})), 'no tendencies anywhere → the honest empties');
app.adopt({season:2026, nflverse:{'2026':{tendencies:block({CIN:{offense:off({}), defense:de({})}}), team:{}}}});
chk(app.has('2026','CIN') && app.nv()['2026'] && app.nv()['2026'].tendencies && app.nv()['2026'].tendencies.teams.CIN && /Tendencies · 2026 · live/.test(app.render({team:'CIN', season:'2026'})), 'the in-season sidecar\'s tendencies block merges into the live season like its other sections, and renders');

console.log('=== the call sheet is one page again, and its scripts parse ===');
const tpl=app.template();
chk(typeof tpl==='string' && !/page-tend|pgtab|OPEN_PAGE|__TC_TENDENCIES__/.test(tpl), 'the sheet template carries no page tabs or tendencies hook');
chk(!/_schemeOpenPage|__TC_TENDENCIES__|OPEN_PAGE/.test(src), 'the renderer injects no second page');
const out=app.tpl('<script>__TC_FV_SCRIPT__</script><script>const FV={};const FORM=FV.data;const SEASON=FV.season;const NAMES=FV.names;const TEAM_CODE="X";</script>', {season:'2025', data:{views:{}}});
const blocks=[...out.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const parses=blocks.every(b=>{ try{ new Function(b); return true; }catch(e){ console.log('    parse error:', e.message); return false; } });
chk(blocks.length===2 && parses && (out.match(/const FV=/g)||[]).length===2 && !/OPEN_PAGE/.test(out), 'every script block of the rendered sheet parses, each declaring its constants once');
console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
