// The call sheet's Tendencies page: the team's numbers beside the league's in the sheet's
// own idiom, ranks among the teams that have them, the season chips, honest empties, and
// the template that carries the page and its tab.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},insertAdjacentHTML(){},remove(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};global.fetch=()=>Promise.reject(new Error('offline'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs'), path=require('path');
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { sheet:_schemeTendSheetHTML, seasons:_schemeTendSeasons, norm:_schemeNormTab, tpl:(t,p)=>_schemeRenderTemplate(t,p),
  setNflverse:(n)=>{NFLVERSE=n;}, setTeam:(t)=>{schemeTeam=t;}, setSeason:(s)=>{schemeTendSeason=s;}, setYear:(y)=>{TC_SEASON.year=y;}, openPage:()=>_schemeOpenPage };`)();
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
                 '2026':{tendencies:block({DET:{offense:off({}), defense:de({})}})}});
app.setYear(2026); app.setTeam('DET');

console.log('=== the page ===');
chk(app.norm('tendencies')==='playbook' && app.norm('scheme')==='scheme', 'the modal has no Tendencies tab of its own: the id falls to the Playbook');
chk(JSON.stringify(app.seasons())==='["2026","2025"]', 'the seasons with tendencies, newest first');
let h=app.sheet({team:'DET', season:'2025'});
chk(/class="banner">Tendencies · 2025 · 1000 plays · 2 teams ranked/.test(h), 'the sheet banner names the season and the samples');
chk(/tn-seasons/.test(h) && /class="active"[^>]*>2025</.test(h) && /2026 · LIVE/.test(h) && /parent\.setTeamCoachingSchemeTendSeason\('2026'\)/.test(h), 'season chips in the sheet call up to the app; the live season is marked');
chk(/How guessable is the call/.test(h) && /<b>72\.0%<\/b>/.test(h) && /\+6\.0 pp/.test(h) && /1st of 2 most guessable/.test(h), 'guessability stamp: the rate, beyond the situation, ranked first of two');
chk(/3rd &amp; long<small>80<\/small>/.test(h) && /PASS 90%/.test(h) && /class="lg" style="left:15\.0%"/.test(h) && !/Red zone<small>0/.test(h), 'situations: run/pass bars with the league tick; an empty situation is left out');
chk(/Streak lift/.test(h) && /Formation hold/.test(h) && /Cold/.test(h) && /After a run/.test(h) && /Motion rate/.test(h) && /lg 55%/.test(h), 'sequencing, play action (after a run vs cold) and motion, each with the league beside');
chk(/blitz habits/.test(h) && /<b>30%<\/b>/.test(h) && /2nd of 2/.test(h) && /Stacked box vs run/.test(h) && /3rd &amp; long<small>80<\/small>/.test(h), 'the defense: the blitz stamp ranked second of two, situations, box counts');
chk(/tn-card/.test(h) && /tn-kv/.test(h) && !/scheme-tend/.test(h), 'rendered in the sheet\'s classes, none of the app\'s dark-theme ones');
chk(/The Side Quest/.test(h) && /tn-note/.test(h), 'credits the methods in the sheet\'s footnote');
app.setSeason('2026'); h=app.sheet({team:'DET', season:'2025'});
chk(/Tendencies · 2026/.test(h) && /1 teams ranked/.test(h) && app.openPage()===null, 'a season chip switches the page to the live season');
h=app.sheet({team:'KC', season:'2026'});
chk(/No tendencies for KC in 2026 yet/.test(h) && /tn-seasons/.test(h), 'a team without a block in the season says so, chips kept');
app.setNflverse({'2025':{tendencies:{teams:{}, league:{}, n_teams:0}}}); app.setSeason(null);
h=app.sheet({team:'DET', season:'2025'});
chk(/build from the season/.test(h), 'no tendencies anywhere → the honest empty');

console.log('=== the template carries the page ===');
const tpl=fs.readFileSync(path.join(__dirname,'..','src/templates/coaching-template.html'),'utf8');
chk(/data-page="form"/.test(tpl) && /data-page="tend"/.test(tpl) && /id="page-tend">__TC_TENDENCIES__</.test(tpl) && /OPEN_PAGE/.test(tpl), 'the sheet has Formations and Tendencies page tabs and the injection hook');
chk(/\.tn-bar \.run\{background:var\(--hl-grn\)/.test(tpl) && /\.tn-rank\{background:var\(--hl-yel\)/.test(tpl), 'the page is styled in the sheet\'s own palette');
app.setNflverse({'2025':{tendencies:block({DET:{offense:off({}), defense:de({})}})}});
const out=app.tpl('<style>svg{display:block;margin:0 auto;}</style><script>__TC_FV_SCRIPT__</script><div id="page-tend">__TC_TENDENCIES__</div>', {team:'DET', season:'2025'});
chk(/class="banner">Tendencies · 2025/.test(out) && !/__TC_TENDENCIES__/.test(out) && /const OPEN_PAGE=/.test(out), 'rendering the template injects the page and the opening-page flag');
console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
