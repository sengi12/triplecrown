// League Analyzer · Standings & the playoff picture: Sleeper's order (wins, then points),
// division leaders seeded first when the league seeds that way, the playoff line where the
// format puts it, and a conservative clinched / in / bubble / out from what winning out can do.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){},visibilityState:'visible'};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){}};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { TC_SEASON, laTabViewHTML, laStandingsView, laPlayoffPicture, laStdOrder, laSeasonView,
  pts:_laPts, fmt:_laPlayoffFormat, setSnapshot:(s)=>{leagueSnapshot=s;}, setPhaseVar:(p)=>{currentPhase=p;} };`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const T=(id,name,owner,w,l,pf,pa,div,extra)=>Object.assign({rosterId:id, ownerId:'u'+id, owner, teamName:name, wins:w, losses:l, ties:0, fpts:pf, fptsAgainst:pa, division:div, streak:'', players:[]}, extra||{});
// Week 10 of a 14-week regular season (playoffs start week 15), 4 of 8 make it, no divisions.
const SNAP={provider:'sleeper', leagueId:'L1', season:'2026', myUserId:'u3', rosterPositions:['QB','RB','WR','TE','FLEX','BN'],
  playoffs:{teams:4, weekStart:15, divisions:0, divNames:{}, seedType:0, type:0},
  teamList:[ T(1,'Juggernaut','ace',9,0,1301.5,980.2,null,{streak:'9W'}), T(2,'Solid','bo',7,2,1210.0,1010.4,null), T(3,'Me Too','me',6,3,1188.8,1100.1,null),
             T(4,'Points Rich','cy',6,3,1150.0,1150.0,null), T(5,'Points Poor','di',5,4,1100.0,1200.0,null), T(6,'Bubble Boy','ed',4,5,1150.0,1180.0,null),
             T(7,'Longshot','fa',2,7,1000.0,1250.0,null), T(8,'Done','gi',0,9,900.0,1300.0,null) ]};
app.setPhaseVar('League'); app.setSnapshot(SNAP);
app.TC_SEASON.year=2026; app.TC_SEASON.phase='regular'; app.TC_SEASON.week=10;

console.log('=== the snapshot\'s fields ===');
chk(app.pts({fpts:1301, fpts_decimal:50},'fpts')===1301.5 && app.pts({fpts:12},'fpts_against')===null, 'points assemble the whole and the two-digit decimal; a missing field is null');
const f=app.fmt({settings:{playoff_teams:6, playoff_week_start:15, divisions:2, playoff_seed_type:0}, metadata:{division_1:'East', division_2:'West'}});
chk(f.teams===6 && f.weekStart===15 && f.divisions===2 && f.divNames[2]==='West', 'the playoff format: spots, start week, divisions with their names');

console.log('=== order and the line ===');
const pic=app.laPlayoffPicture(SNAP);
chk(pic.rows.map(r=>r.t.teamName).slice(0,5).join(',')==='Juggernaut,Solid,Me Too,Points Rich,Points Poor', 'wins first, points for break the 6-3 tie (Me Too 1188.8 over Points Rich 1150.0)');
chk(pic.spots===4 && pic.regularWeeks===14, '4 spots; the regular season is the 14 weeks before the playoffs');
chk(pic.rows[0].remaining===5 && pic.rows[7].remaining===5, 'five games left for everyone after nine played');

console.log('=== the picture ===');
const st=Object.fromEntries(pic.rows.map(r=>[r.t.teamName, r.status]));
chk(st.Juggernaut==='in', '9-0 is only IN while an outsider (5-4, five left) could still reach 10 wins — conservative, no points tiebreak assumed');
chk(st.Solid==='in' && st['Me Too']==='in' && st['Points Rich']==='in', 'the top four are in on the current line');
chk(st['Points Poor']==='bubble' && st['Bubble Boy']==='bubble' && st.Longshot==='bubble', 'teams that can still reach the line\'s record (6 wins) by winning out are on the bubble — 2-7 included');
chk(st.Done==='out', '0-9 with five to play cannot reach 6 wins → out');
const gb=Object.fromEntries(pic.rows.map(r=>[r.t.teamName, r.gb]));
chk(gb['Points Rich']===0 && gb['Points Poor']===1 && gb['Bubble Boy']===2 && gb.Done===6, 'games behind the last seed: a half game per unmatched win or loss');
// Two weeks later the picture hardens.
const LATE=JSON.parse(JSON.stringify(SNAP)); LATE.teamList.forEach(t=>{ if(t.rosterId===1){t.wins=11;} else if(t.rosterId===8){t.losses=11;} else {t.wins+=1;t.losses+=1;} });
const pic2=app.laPlayoffPicture(LATE);
const st2=Object.fromEntries(pic2.rows.map(r=>[r.t.teamName, r.status]));
chk(st2.Juggernaut==='clinched', '11-0 with three to play: the best outsider tops out at 9 → clinched');
chk(st2.Longshot==='out', '3-8 with three left cannot reach the line\'s 7 → out');

console.log('=== divisions seed first ===');
const DIV=JSON.parse(JSON.stringify(SNAP)); DIV.playoffs={teams:4, weekStart:15, divisions:2, divNames:{1:'East',2:'West'}, seedType:0};
DIV.teamList.forEach(t=>{ t.division = t.rosterId%2 ? 1 : 2; });   // odd rosters East, even West
const dp=app.laPlayoffPicture(DIV);
chk(dp.byDivision && dp.rows[0].t.teamName==='Juggernaut' && dp.rows[1].t.teamName==='Solid' && dp.rows[0].divLeader && dp.rows[1].divLeader, 'the two division leaders hold seeds 1 and 2');
chk(dp.rows[2].t.teamName==='Me Too' && !dp.rows[2].divLeader, 'then the rest by record');
DIV.playoffs.seedType=1;
chk(!app.laPlayoffPicture(DIV).byDivision, 'a league that seeds by record ignores divisions');

console.log('=== the pane ===');
const h=app.laStandingsView(SNAP);
chk(/la-std-table/.test(h) && /playoff line · 4 of 8 make it/.test(h), 'a table with the playoff line drawn after seed 4');
chk(/la-std-mine[\s\S]*Me Too/.test(h), 'my team is highlighted');
chk(/9 of 14 regular-season weeks played · 5 to go/.test(h), 'the header counts the weeks');
chk(/la-std-pill la-std-out">Out</.test(h) && /la-std-pill la-std-bubble">Bubble</.test(h), 'status pills');
chk(/<td class="la-std-num">1301\.5</.test(h) && />9W</.test(h), 'points for and the streak');
const season=app.laSeasonView(SNAP, 'standings');
chk(/pane-tab active"[^>]*>[\s\S]*?Standings/.test(season) && /la-std-table/.test(season), 'Standings is a pane of the Season tab');
chk(typeof app.laTabViewHTML('standings', SNAP)==='string', 'and dispatches through the analyzer');
const CHOP=Object.assign({}, SNAP, {leagueType:3, chop:{startWeek:1,lastLeg:17}});
chk(!/Standings/.test(app.laSeasonView(CHOP)), 'a Chopped league has no Standings pane (it has the Chopping Block)');
console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
