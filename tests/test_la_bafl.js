// BAFL Mode in the League Analyzer: the matchup is best-3-of-5 categories, and it renders as
// the BAFL app's own card (../bafl) — category math, projections blended as "what has happened
// plus the unplayed share of the rest", the exact five-draw win probability, ticks beside the
// side holding each category, the PROJECTED line, total yards as the tiebreaker.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){},visibilityState:'visible'};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  sleeperFetch=async()=>{ throw new Error('no net in tests'); };
  return { catsOf:laBaflCatsOf, catStats:laBaflCatStats, result:laBaflResult, blend:laBaflBlend, wp:laBaflWinProb, card:laBaflMatchupCard, prog:laBaflGameProgress,
    view:laMatchupView, mu:()=>_laMu, bafl:()=>_laBafl, setSnapshot:(s)=>{ leagueSnapshot=s; }, setPhase:(p)=>{ currentPhase=p; }, TC_SEASON, laState,
    on:()=>{ scoringSettings.baflMode=true; }, off:()=>{ scoringSettings.baflMode=false; }, cat:calcBaflCat };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== category math — the BAFL app\'s, verbatim ===');
const c=app.catsOf({pass_yd:300, pass_int:2, rush_yd:12, rec_yd:0, pass_td:2, rush_td:1, xpm:3, fgm:2, rush_2pt:1});
chk(c.passing===260 && c.rushing===12 && c.tds===3 && c.kicking===3+6+2, `pass 300−2×20=260 · TDs 3 · kicking XPM+3×FGM+2×2pt = ${c.kicking}`);

const rows=[{roster_id:1, matchup_id:7, starters:['q1','r1','w1','k1'], players_points:{q1:1,r1:1,w1:1,k1:1}},
            {roster_id:2, matchup_id:7, starters:['q2','r2','w2','k2','x0'], players_points:{q2:1,r2:1,w2:1,k2:1}}];
const stats={ q1:{pass_yd:280,pass_int:1,pass_td:2}, r1:{rush_yd:90,rush_td:1}, w1:{rec_yd:110}, k1:{xpm:3,fgm:1},
              q2:{pass_yd:240,pass_td:1}, r2:{rush_yd:120,rush_td:1,rec_yd:20}, w2:{rec_yd:60,rec_td:1}, k2:{xpm:2,fgm:3}, x0:{rush_yd:99} };
const cs=app.catStats(rows, stats);
chk(cs.passing[1]===260 && cs.rushing[2]===120 && cs.receiving[2]===80 && cs.tds[1]===3 && cs.tds[2]===3 && cs.kicking[2]===11, 'per-roster totals sum the starters');
chk(cs.rushing[2]===120, 'a starter not in players_points did not participate and is skipped (x0)');
const r=app.result(cs,1,2);
chk(r.s1===2 && r.s2===2 && r.cats.Touchdowns===2, 'passing + receiving to me, rushing + kicking to them, TDs level → 2–2');
chk(r.ty1===460 && r.ty2===440 && r.tb1 && r.s1dec===2.5, 'level count breaks on total yards — mine (460 v 440), shown as *');

console.log('=== the card ===');
const names=rid=>rid===1?'Sengi':'Rivals';
let h=app.card(1,2,cs,null,names,{mine:true});
chk(/la-mc-score win"[^>]*>2\*</.test(h) && /la-mc-score loss"[^>]*>2</.test(h), 'header: 2* (tiebreak, green) vs 2 (grey)');
chk(/la-mc-team">Sengi<\/span>/.test(h) && /la-mc-team">Rivals<\/span>/.test(h), 'team names flank the vs');
chk((h.match(/la-mc-tick/g)||[]).length===4 && /<td class="la-mc-chk"><span class="la-mc-tick">✔<\/span><\/td><td class="la-mc-val">260/.test(h), 'four ticks; passing 260 ticked on my side');
chk(/decided/.test(h) && />100%<\/span>/.test(h) && /width:100%/.test(h), 'no football left: the bar is decided, 100/0');
chk(/Total Yards<\/td><td class="la-mc-val la-mc-val-r">440/.test(h) && !/la-proj-bar/.test(h), 'total yards row; no PROJECTED line when nothing is left to play');
chk(/la-mc-mine/.test(h), 'my matchup is outlined');

console.log('=== projections: what has happened plus what is still to come ===');
const proj={ stats:{ q1:{pass_yd:280,pass_td:2}, r1:{rush_yd:70}, w1:{rec_yd:80,rec_td:0.6}, k1:{xpm:3,fgm:2},
                     q2:{pass_yd:250,pass_int:0.6,pass_td:1.8}, r2:{rush_yd:80,rush_td:0.7}, w2:{rec_yd:75,rec_td:0.5}, k2:{xpm:2,fgm:1.5} },
             game:{q1:'g1',r1:'g1',w1:'g2',k1:'g2',q2:'g3',r2:'g3',w2:'g1',k2:'g2'}, team:{} };
// g1 final, g2 at halftime, g3 not started
const prog={ rem:{g1:0, g2:0.5, g3:1}, byTeam:{}, weekDone:false };
const live={ q1:{pass_yd:280,pass_int:1,pass_td:2}, w2:{rec_yd:60,rec_td:1}, r1:{rush_yd:40}, w1:{rec_yd:30}, k1:{xpm:1}, k2:{xpm:1,fgm:1} };
const pcs=app.blend(rows, live, proj, prog);
chk(Math.abs(pcs.receiving[1]-(30+0.5*80))<1e-9 && Math.abs(pcs.passing[2]-(250-12))<1e-9 && pcs.rushing[1]===40, 'a half-played starter is live + half his projection; an unplayed one is his projection; a finished one is his line');
chk(pcs.rem[1]===1 && pcs.rem[2]===2.5, 'rem counts starter-games still unplayed');
chk(pcs.var.passing[1]===0 && pcs.var.passing[2]>0 && pcs.var.tds[2]>0, 'a finished starter carries no variance; an unplayed one does');
const wp=app.wp(pcs,1,2);
chk(wp.p1>0 && wp.p2>0 && Math.abs(wp.p1+wp.p2-1)<1e-9, `win probabilities sum to one (${(wp.p1*100).toFixed(0)}/${(wp.p2*100).toFixed(0)})`);
const locked={ passing:{1:300,2:100}, rushing:{1:150,2:50}, receiving:{1:200,2:80}, tds:{1:1,2:4}, kicking:{1:2,2:9}, var:{passing:{},rushing:{},receiving:{},tds:{1:0,2:4},kicking:{1:0,2:9}}, rem:{1:0,2:2} };
chk(app.wp(locked,1,2).p1===1, 'three locked category wins are 100% whatever the remaining games do');
const lcs=app.catStats(rows, live);
h=app.card(1,2,lcs,pcs,names,{});
chk(/la-proj-bar/.test(h) && /PROJECTED/.test(h) && /la-proj-score">\d<span class="la-proj-dash">–<\/span>\d/.test(h), 'the PROJECTED line shows the projected category score');
chk((h.match(/la-mc-proj">→/g)||[]).length===12, 'a → projected finish under every value (5 categories + total yards, both sides)');
chk(/la-mc-pchk/.test(h), 'a hollow ○ marks a category projected to flip');
chk(!/decided/.test(h) && !/>100%</.test(h), 'live bar: never 100%');
chk(/in play/.test(h) || !/la-proj-swing/.test(h), 'swing text names categories within 8%, or is absent');

console.log('=== game state from the schedule + ESPN ===');
const pg=app.prog([{week:2,game_id:'a',home:'KC',away:'DEN',status:'complete'},{week:2,game_id:'b',home:'SF',away:'LAR',status:'in_game'},{week:2,game_id:'c',home:'NE',away:'SEA',status:'pre_game'},{week:3,game_id:'z',home:'KC',away:'X',status:'pre_game'}],
  {events:[{competitions:[{competitors:[{homeAway:'home',team:{abbreviation:'SF'}},{homeAway:'away',team:{abbreviation:'LAR'}}],status:{type:{state:'in'},period:3,clock:900}}]}]}, 2);
chk(pg.rem.a===0 && pg.rem.c===1 && Math.abs(pg.rem.b-0.5)<1e-9 && pg.byTeam.LAR===pg.rem.b && !pg.weekDone && pg.rem.z===undefined, 'final → 0, pre → 1, ESPN clock refines the game in progress (3rd qtr, 15:00 = half left); other weeks ignored');

console.log('=== the Matchup pane in BAFL Mode ===');
const SNAP={provider:'sleeper', leagueId:'B', season:'2026', myUserId:'me', rosterPositions:['QB','RB','WR','K','BN'],
  teamList:[{rosterId:1, ownerId:'me', teamName:'Sengi', wins:1, losses:0, players:[{id:'q1',name:'Drake Maye',pos:'QB',team:'NE'},{id:'r1',name:'Rhamondre Stevenson',pos:'RB',team:'NE'},{id:'w1',name:'JSN',pos:'WR',team:'SEA'},{id:'k1',name:'Kicker One',pos:'K',team:'NE'}]},
            {rosterId:2, ownerId:'them', teamName:'Rivals', wins:0, losses:1, players:[{id:'q2',name:'Drew Lock',pos:'QB',team:'SEA'}]},
            {rosterId:3, ownerId:'a', teamName:'Third', players:[]},{rosterId:4, ownerId:'b', teamName:'Fourth', players:[]}]};
app.setSnapshot(SNAP); app.setPhase('League'); app.TC_SEASON.year=2026; app.TC_SEASON.phase='regular'; app.TC_SEASON.week=2; app.laState.muWeek=2; app.laState.muFocus=0;
app.mu().byWeek[2]={fetchedAt:Date.now(), sig:'s', rows:rows.concat([{roster_id:3, matchup_id:8, starters:['x1'], players_points:{}, points:10},{roster_id:4, matchup_id:8, starters:['x2'], players_points:{}, points:12}])};
app.on();
let v=app.view(SNAP);
chk(/la-mc-loading/.test(v) && /loading the week's stat lines/.test(v), 'before the week\'s stats land the card says so (no zeros invented)');
chk(!!app.bafl().byWeek[2], 'and the feeds were asked for');
app.bafl().byWeek[2].stats=stats; app.bafl().byWeek[2].statsAt=Date.now();
v=app.view(SNAP);
chk(/MY MATCHUP · WEEK 2/.test(v) && (v.match(/class="la-mc /g)||v.match(/class="la-mc"/g)||v.match(/la-mc la-mc-mine/g)).length>=1, 'my matchup is featured as the BAFL card');
chk(!/la-mu-fscore/.test(v) && !/la-mu-pts/.test(v), 'the points score block is gone in BAFL Mode');
chk(/ALL MATCHUPS/.test(v) && /la-mc-grid/.test(v) && (v.match(/la-mc-pick/g)||[]).length===2, 'every pairing is a BAFL card in the grid, tappable to feature');
chk(/Drake Maye/.test(v) && /points · projected/.test(v), 'the starters-by-slot detail stays under the card');
chk(/labaflwp/.test(v), 'the win % explainer is the BAFL one');
app.off();
v=app.view(SNAP);
chk(/la-mu-fscore/.test(v) && /SCOREBOARD/.test(v) && !/la-mc/.test(v), 'without BAFL Mode the points matchup is untouched');
chk(Math.round(app.cat({passing_yards:1547})*10)/10===60 && Math.round(app.cat({rushing_yards:833})*10)/10===60, 'the season category lens is unchanged: one category-season of yards = 60');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
