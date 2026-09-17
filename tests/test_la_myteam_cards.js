// League Analyzer · My Team overview cards: the upgrade path names the weakest starting slot
// and the league-mates with a spare there; trade fit lists only two-way partners; the heat
// map has a row per team with my row marked; bye exposure reads the sidecar schedule and
// flags a doubled-up week; the age timeline is dynasty-only; roster construction counts
// against the league average; the this-week strip stays off before the season starts; and
// the page lays the cards out as a masonry with the lineup chart outside the columns.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[],querySelector:()=>null,getBoundingClientRect:()=>({top:0}),scrollIntoView(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){},classList:{add(){},remove(){}}},addEventListener(){},visibilityState:'visible'};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const css=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
const app=new Function(code+`
  toast=function(){}; renderLeagueAnalyzer=function(){};
  const P={};
  const add=(n,pos,team,v,age,tier)=>{ P[ecrNormName(n)]={n,pos,team,v}; ECR.dynasty[ecrNormName(n)]={tier:tier||3, age}; return {id:n.replace(/\\W/g,'').toLowerCase(),name:n,pos,team}; };
  ECR={dynasty:{}};
  DYNASTY_VALUES={asof:'2026-08', players:P, picks:{}};
  return { laState, my:laMyTeamView, add, setSnapshot:(s)=>{leagueSnapshot=s;}, setStarted:(b)=>{ hasSeasonStarted=()=>b; },
    setIns:(x)=>{ TC_INSEASON=x; }, setSeason:(x)=>{ Object.assign(TC_SEASON,x); }, mu:()=>_laMu, fetched:[], hookFetch:()=>{ const f=[]; laFetchMatchups=(w)=>{ f.push(w); }; return f; } };`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

// Four teams, 1 QB / 2 RB / 2 WR / 1 TE / 1 FLEX. Me: elite QB/WR, a hole at RB2 (empty RB room
// after RB1), an aging TE. Team 2 is RB-rich with a spare on the bench and thin at WR — the
// natural partner. Team 3 is strong everywhere. Team 4 is weak everywhere.
const A=app.add;
const me={rosterId:1, ownerId:'u1', teamName:'Me', wins:1, losses:0, picks:[], players:[
  A('Josh Allen','QB','BUF',95,30,1), A('Bijan Robinson','RB','ATL',90,24,1), A('Old Back','RB','NYJ',12,29,6),
  A("Ja'Marr Chase",'WR','CIN',92,26,1), A('Drake London','WR','ATL',70,25,2), A('Spare Wideout','WR','SEA',45,24,3), A('Third Wideout','WR','DEN',40,23,3),
  A('Travis Kelce','TE','KC',30,36.5,4), A('Young Kicker','K','BUF',5,25,9)]};
const rich={rosterId:2, ownerId:'u2', teamName:'RB Rich', wins:0, losses:1, picks:[], players:[
  A('Mid QB','QB','ARI',40,27,4), A('Saquon Barkley','RB','PHI',85,29,1), A('Jahmyr Gibbs','RB','DET',88,24,1), A('Flex Back','RB','MIA',70,25,2), A('Bench Back','RB','LAC',60,23,2),
  A('Thin Wideout','WR','NYG',20,28,6), A('Thinner Wideout','WR','CAR',15,27,7), A('Mid TE','TE','LV',35,26,3)]};
const strong={rosterId:3, ownerId:'u3', teamName:'Strong', wins:1, losses:0, picks:[], players:[
  A('Lamar Jackson','QB','BAL',94,29,1), A('Christian McCaffrey','RB','SF',80,30,2), A('Kyren Williams','RB','LAR',65,26,2),
  A('CeeDee Lamb','WR','DAL',93,27,1), A('Amon-Ra St. Brown','WR','DET',88,26,1), A('Sam LaPorta','TE','DET',60,25,1)]};
const weak={rosterId:4, ownerId:'u4', teamName:'Weak', wins:0, losses:1, picks:[], players:[
  A('Backup QB','QB','TEN',10,33,9), A('Backup Back','RB','JAX','8',31,9), A('Practice Squad WR','WR','HOU',6,24,9), A('Blocking TE','TE','MIA',4,30,9)]};
const snap=(type)=>({provider:'sleeper', leagueId:'L1', season:'2026', seasonChain:[{season:'2026'}], leagueType:type, myUserId:'u1',
  rosterPositions:['QB','RB','RB','WR','WR','TE','FLEX','BN','BN'], playoffs:{teams:2, weekStart:15}, teamList:[me,rich,strong,weak]});

console.log('=== dynasty, offseason: the cards on the page ===');
app.setStarted(false); app.setIns(null); app.setSeason({year:2026, phase:'off', week:0});
app.laState.myLens='value'; app.laState.viewTeam=null;
app.setSnapshot(snap(2));
let h=app.my(snap(2));
chk(/<div class="la-my-grid">/.test(h) && /<div class="la-my-stack">.*Positional Rankings.*Starter Rankings.*<\/div>/s.test(h), 'Positional + Starter Rankings stack in one masonry cell');
chk(h.indexOf('la-my-grid')<h.indexOf('Upgrade Path') && h.indexOf('Starting Lineup')>h.lastIndexOf('Roster Construction'), 'the cards sit inside the columns, the lineup chart after them');
chk(/Upgrade Path/.test(h) && /la-up-slot">RB2</.test(h) && /Old Back/.test(h.slice(h.indexOf('la-up-hero'))), 'Upgrade Path names RB2 (Old Back) as the weakest starting slot');
chk(/below the league median/.test(h) && /to move up a spot/.test(h), 'with its gap to the league median and to the next rank');
const up=h.slice(h.indexOf('la-up-list'), h.indexOf('la-up-foot'));
chk(/RB Rich/.test(up) && /Bench Back/.test(up) && /on their bench/.test(up) && !/Strong/.test(up), 'the partner list names RB Rich’s spare (Bench Back) and nobody without a spare');
chk(/needs WR/.test(up), 'and says what RB Rich is short of (WR)');
chk(/laState.fndPos='RB';laSetTab\('trade'\)/.test(h), 'the button opens the trade finder targeting RB');
chk(/Your surplus: <b>WR<\/b>/.test(h) && /Third Wideout/.test(h.slice(h.indexOf('la-up-surplus'))), 'my surplus is WR, with the best spare named');
const fit=h.slice(h.indexOf('Trade Fit'), h.indexOf('League Heat Map'));
chk(/RB Rich/.test(fit) && /get <b>RB<\/b>/.test(fit) && /send <b>WR<\/b>/.test(fit), 'Trade Fit: RB Rich mirrors me — get RB, send WR');
chk(!/la-fit-team[^>]*>[^<]*<\/span>Strong/.test(fit) && (fit.match(/la-fit-row/g)||[]).length<=3, 'a team stronger everywhere is not a two-way partner');
const heat=h.slice(h.indexOf('League Heat Map'), h.indexOf('Position Strength'));
chk((heat.match(/<tr class="[^"]*">/g)||[]).length===4 && /<tr class="mine">/.test(heat), 'the heat map has one row per team with mine marked');
chk(/<th title="QB">QB<\/th>/.test(heat) && /<th title="STARTERS">STRT<\/th>/.test(heat) && /la-heat-c la-q1"[^>]*>1</.test(heat) && /la-heat-c la-q4"[^>]*>4</.test(heat), 'columns per position, cells coloured by quartile');
chk(!/Bye Exposure/.test(h), 'no sidecar → no Bye Exposure card');
const age=h.slice(h.indexOf('Age Timeline'), h.indexOf('Roster Construction'));
chk(/la-age-col/.test(age) && /core age <b>\d+\.\d<\/b>/.test(age) && /Travis Kelce/.test(age) && /la-age-(past|defier)/.test(age), 'Age Timeline buckets the value and names Kelce, 36.5, at the TE cliff');
const bld=h.slice(h.indexOf('Roster Construction'));
chk(/la-bld-pos la-pos-WR">WR<\/span>\s*<span class="la-bld-n"[^>]*>4</.test(bld) && /la-bld-pos la-pos-K">K<\/span>\s*<span class="la-bld-n"[^>]*>1</.test(bld), 'Roster Construction counts my 4 WR and 1 K');
chk(/starts 2/.test(bld) && /league average/.test(bld), 'with the slots the league starts and the league average');
chk(!/la-tw/.test(h), 'no This Week strip before the season starts');

console.log('=== redraft: no age card; the units follow the lens ===');
app.setSnapshot(snap(0)); h=app.my(snap(0));
chk(!/Age Timeline/.test(h) && /Upgrade Path/.test(h) && /League Heat Map/.test(h), 'a redraft league drops the age card and keeps the rest');

console.log('=== in season: bye exposure from the sidecar, the this-week strip ===');
app.setSnapshot(snap(2)); app.setStarted(true); app.setSeason({year:2026, phase:'regular', week:5});
app.setIns({schedule:{BUF:{'5':'X','6':'X'}, ATL:{'6':'X'}, NYJ:{'5':'X'}, CIN:{'6':'X'}, KC:{'5':'X'}, SEA:{'5':'X','6':'X'}, DEN:{'5':'X','6':'X'}}});
// (weeks 7+ are unknown to this schedule — not byes)
const f=app.hookFetch();
h=app.my(snap(2));
const bye=h.slice(h.indexOf('Bye Exposure'), h.indexOf('Age Timeline'));
chk(/weeks 5–14/.test(bye) && /Wk 5/.test(bye) && /Wk 6/.test(bye) && !/Wk 7/.test(bye) && !/Wk 8/.test(bye), 'in season the card looks at the rest of the regular season and lists only the weeks with a bye');
chk(/la-bye-row la-bye-hot"[^>]*>\s*<span class="la-bye-wk">Wk 5<\/span>\s*<span class="la-bye-n"[^>]*>3</.test(bye) && /Bijan Robinson/.test(bye) && /Drake London/.test(bye) && /Chase/.test(bye), 'week 5 (ATL + CIN on bye) costs three starters and is flagged');
chk(/la-bye-row la-bye-hot"[^>]*>\s*<span class="la-bye-wk">Wk 6<\/span>\s*<span class="la-bye-n"[^>]*>2</.test(bye) && /Old Back/.test(bye) && /Kelce/.test(bye), 'week 6 (NYJ + KC) costs two');
if(!/Week 5 costs you 3 starters/.test(bye)) console.log('BYE:',bye.replace(/<[^>]+>/g,' ').replace(/\s+/g,' '));
chk(/Week 5 costs you 3 starters/.test(bye), 'and the footer names the worst week');
app.setIns({schedule:{BUF:{'5':'X','6':'X','9':'X'}, ATL:{'5':'X','6':'X','9':'X'}, NYJ:{'5':'X','6':'X','9':'X'}, CIN:{'5':'X','6':'X'}, KC:{'5':'X','6':'X','9':'X'}, SEA:{'5':'X','6':'X','9':'X'}, DEN:{'5':'X','6':'X','9':'X'}}});
h=app.my(snap(2)); const bye2=h.slice(h.indexOf('Bye Exposure'), h.indexOf('Age Timeline'));
chk(/Wk 5–8<\/span>\s*<span class="la-bye-n">0</.test(bye2) && /Wk 9/.test(bye2) && /Chase/.test(bye2.slice(bye2.indexOf('Wk 9'))), 'a clear next four weeks is one line, then the first real bye (week 9, Chase)');
chk(/la-tw la-tw-empty/.test(h) && f.length>=1 && f.every(w=>w===5), 'the strip asks for the current week’s matchups and shows a loading line');
app.mu().byWeek[5]={rows:[{roster_id:1, matchup_id:9, points:0, starters:[me.players[0].id], starters_points:[0]},{roster_id:2, matchup_id:9, points:0, starters:[rich.players[0].id], starters_points:[0]}], sig:''};
h=app.my(snap(2));
const tw=h.slice(h.indexOf('<div class="la-tw">'), h.indexOf('la-my-grid'));
chk(/Week 5/.test(tw) && /<b>Me<\/b>/.test(tw) && /<b>RB Rich<\/b>/.test(tw) && /laViewTeam\(2\)/.test(tw), 'with the rows cached the strip shows me against RB Rich');
chk(/la-tw-prob/.test(tw) && /\d+%<\/b> to win/.test(tw), 'with a win probability');
chk(/Seed 1/.test(tw) && /la-tw-status/.test(tw), 'and my seed and playoff status');
chk(/laSetTab\('season'\)/.test(tw), 'and a link to the matchup tab');

console.log('=== a chopped league: the strip is the chopping block\u2019s read ===');
app.setSnapshot(snap(3)); app.mu().byWeek[5]={rows:[1,2,3,4].map(id=>({roster_id:id, matchup_id:null, points:[50,40,60,10][id-1], starters:[[me,rich,strong,weak][id-1].players[0].id], starters_points:[[50,40,60,10][id-1]]})), sig:''};
h=app.my(snap(3));
const ch=h.slice(h.indexOf('<div class="la-tw">'), h.indexOf('la-my-grid'));
chk(/#2<\/b> of 4 alive/.test(ch) && /%<\/b> safe/.test(ch) && /chop line:/.test(ch) && /Weak/.test(ch.slice(ch.indexOf('chop line'))) && !/no opponent/.test(ch), 'me against the field: #2 of 4 alive, Safe %, and Weak on the block');
chk(/laSetTab\('season'\)/.test(ch) && /chopping block/.test(ch), 'linking to the chopping block');
app.setSnapshot(snap(2));

console.log('=== viewing another team swaps every card ===');
app.laState.viewTeam=4; h=app.my(snap(2));
chk(/<b>Weak<\/b>/.test(h.slice(h.indexOf('<div class="la-tw">'))) || /Weak/.test(h.slice(h.indexOf('la-up-hero'))), 'the cards follow the team on screen');
app.laState.viewTeam=null;

console.log('=== the stylesheet packs the cards ===');
chk(/\.la-my-grid\{display:block;column-width:600px/.test(css) && /\.la-my-grid>\.la-my-card\{break-inside:avoid/.test(css), 'the My Team grid is a masonry of 600px columns, cards never split');
chk(/@media \(max-width:760px\)\{[^}]*\n?\s*\.la-my-grid\{column-width:auto;column-count:1;\}/.test(css), 'one column on a phone');
chk(!/\.la-my-grid\{display:grid/.test(css), 'the old auto-fit grid rule is gone');

console.log(`\n${pass}/${total} passed`);
if(pass!==total) process.exit(1);
