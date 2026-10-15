// The week sliders on the season in progress: the whole season on the track, the thumbs held
// to the weeks a team has PLAYED — the completed weeks plus the week in progress once that
// team's game has kicked off (a Thursday-night team's week 2 is in on Friday morning) — and
// the rest dimmed as not played yet. The banner chip reads the played week too.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],textContent:''};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){},classList:{add(){},remove(){}}}),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),innerWidth:1200,scrollTo(){},scrollX:0,scrollY:0};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));global.requestAnimationFrame=(f)=>setTimeout(f,0);
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  sleeperFetch=async(url)=>{ throw new Error('offline'); };
  hasSeasonStarted=()=>true; TC_SEASON.year=2026; TC_SEASON.phase='regular'; TC_SEASON.week=2; activeSeason='2026';
  const board=(teams)=>{ _tcBoard={season:'2026',week:2,at:Date.now(),teams,busy:false,live:Object.values(teams).some(t=>t.state==='in')}; };
  return { board, played:tcSeasonPlayedWeek, max:tcSeasonMaxWeek, numRail:renderWeekNumberRail, setWeek:(w)=>{ TC_SEASON.week=w; _tcBoard.week=w; },
    parse:_parseWeeklySchedule, rail:(team,cls)=>renderWeekOpponentRail(team,'2026',cls), setSched:(m)=>{ _weeklyOppBySeason['2026']=m; }, setProj:(t,st)=>{ userProj[t]=st; }, picks:weekPicks, chips:(t)=>weekPickChipsHTML(t,'2026'), sumR:sumWeeklyRange, sumQ:sumWeeklyRangeQB,
    oppRail:(team)=>{ _weeklyOppBySeason['2026']={[team]:{1:{opp:'GB',home:true},2:{opp:'CHI',home:false},3:{opp:'BAL',home:true}}}; return renderWeekOpponentRail(team,'2026'); },
    advCard:(team)=>{ _advWeeklySeedReady=true; _advSeasonCanRange=()=>true; _advEnsureWeeklyLoaded=()=>{}; advTeamSeason=()=>'2026'; return renderAdvWeekRange(team,{showOppRail:false}); },
    advDrag:(team,which,v)=>{ advWeekRangeDrag(team,which,v); return document.getElementById('adv-wr-hi-'+team).textContent+'|'+document.getElementById('adv-wr-lo-'+team).textContent; } };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
console.log('=== the week a team has played through ===');
app.board({DET:{state:'post',opp:'BUF'}, BUF:{state:'post',opp:'DET'}, MIA:{state:'pre',opp:'NE'}, NE:{state:'pre',opp:'MIA'}});
chk(app.played('2026','DET')===2 && app.played('2026','BUF')===2, 'Friday after Thursday night: the Lions and Bills have played week 2');
chk(app.played('2026','MIA')===1 && app.played('2026','NE')===1, 'a team that plays Sunday is still through week 1');
chk(app.played('2026')===2, 'no team named: the week is in once any game has kicked off');
chk(app.played('2025','DET')===18 && app.max('2026')===18 && app.max('2025')===18, 'a finished season is the whole season; the slider\'s track is the whole season either way');
app.board({DET:{state:'pre',opp:'BUF'}, BUF:{state:'pre',opp:'DET'}});
chk(app.played('2026','DET')===1 && app.played('2026')===1, 'before the first kickoff of the week: the completed weeks');
app.board({DET:{state:'in',opp:'BUF'}, BUF:{state:'in',opp:'DET'}});
chk(app.played('2026','DET')===2, 'kicked off and in progress counts as played (the stats move play by play)');

console.log('=== the rails and the slider show the whole season, the unplayed part dimmed ===');
app.board({DET:{state:'post',opp:'BUF'}, BUF:{state:'post',opp:'DET'}, MIA:{state:'pre',opp:'NE'}});
const nr=app.numRail();
chk((nr.match(/wr-week-cell/g)||[]).length===18 && (nr.match(/wr-unplayed/g)||[]).length===16, 'the week-number rail runs 1-18; weeks 3-18 are dimmed (league-wide: week 2 has begun)');
const orD=app.oppRail('DET'), orM=app.oppRail('MIA');
chk((orD.match(/wr-opp-cell/g)||[]).length===18 && (orD.match(/wr-unplayed/g)||[]).length===16 && (orM.match(/wr-unplayed/g)||[]).length===17, 'the opponent rail: 18 weeks; the Lions have played 2, the Dolphins 1');
const card=app.advCard('DET');
chk(/max="18"/.test(card) && /of 2 played/.test(card) && /dual-slider-dead" style="left:5\.88%"/.test(card) && /adv-wr-hi-DET">2</.test(card), 'the Lions\' slider: the track is 18 weeks, the hint says 2 played, the dead zone starts after week 2, the high thumb sits at 2');
chk(app.advDrag('DET','hi',9)==='2|1', 'dragging the high thumb into the unplayed weeks holds it at the last game played');
const cardM=app.advCard('MIA');
chk(/of 1 played/.test(cardM) && /dual-slider-dead" style="left:0\.00%"/.test(cardM), 'the Dolphins\' slider: 1 played, the dead zone from week 1 on');

console.log('=== picked games: the schedule carries the scores, the rail carries the taps ===');
const CSV='season,game_type,week,home_team,away_team,home_score,away_score\n2026,REG,1,CIN,TB,27,24\n2026,REG,2,HOU,CIN,20,31\n2026,REG,3,PIT,CIN,,\n2025,REG,1,CIN,KC,10,13\n2026,POST,19,CIN,BAL,3,0';
const m=app.parse(CSV,'2026');
chk(m && m.CIN[1].res==='W' && m.CIN[1].pf===27 && m.CIN[1].pa===24 && m.CIN[2].res==='W' && m.CIN[2].home===false && m.CIN[2].pf===31 && !m.CIN[3].res && !m.CIN[19] && m.TB[1].res==='L',
    'each played game carries the score from the team\'s own chair (W 27-24 at home, W 31-20 on the road), an unplayed one no result, other seasons and the playoffs left out');
app.setSched(m); app.setWeek(4);
app.setProj('CIN', {weekPick:[2], rushing:{}, passing_shares:null});
const r=app.rail('CIN','wr-opp-main');
chk(/wr-pickable[^"]*wr-picked wr-res-W[^>]*onclick="weekPickToggle\('CIN',2,event\)"/.test(r) && /<span class="wr-res wr-res-badge" aria-label="Win">W<\/span>/.test(r), 'the picked game wears its result — a W badge on the logo’s corner — and a tap drops it');
chk(/wr-pickable wr-dim[^>]*onclick="weekPickToggle\('CIN',1,event\)"/.test(r), 'the other played games dim while a pick is on, and stay a tap');
chk((r.match(/wr-res-badge/g)||[]).length===2 && (r.match(/wr-res-[WLT]/g)||[]).length===2 && /wr-pickable wr-dim wr-res-W[^>]*onclick="weekPickToggle\('CIN',1,event\)"/.test(r) && /wr-pickable wr-dim"[^>]*onclick="weekPickToggle\('CIN',3,event\)"/.test(r), 'every scored game wears its W or L, picked or not — the record reads at a glance; a game without a score yet wears none');
chk(!/weekPickToggle\('CIN',3/.test(r) || /wr-pickable[^>]*weekPickToggle\('CIN',3/.test(r), 'week 3 (played, no score yet) is still pickable');
chk(!/weekPickToggle/.test(app.rail('CIN','wr-opp-adv')), 'the Adv Metrics rail keeps its own week range: no taps there');
app.setProj('CIN', {weekPick:null, rushing:{}});
chk(!/wr-dim|wr-picked/.test(app.rail('CIN','wr-opp-main')) && /weekPickToggle\('CIN',1,event\)/.test(app.rail('CIN','wr-opp-main')), 'no pick: nothing dimmed, every played game a tap');
chk((app.rail('CIN','wr-opp-main').match(/wr-res-badge/g)||[]).length>=2 && /wr-pickable wr-res-[WLT]/.test(app.rail('CIN','wr-opp-main')), 'no pick: the badges are still there');
const wk={1:{team:'CIN',stats:{rec:3,rec_yd:30,gp:1}}, 2:{team:'CIN',stats:{rec:5,rec_yd:50,gp:1}}, 3:{team:'CIN',stats:{rec:7,rec_yd:70,gp:1}}};
chk(app.sumR(wk,'CIN',1,3).receptions===15 && app.sumR(wk,'CIN',1,3,new Set([1,3])).receptions===10 && app.sumR(wk,'CIN',1,3,new Set([1,3])).games_played===2, 'a set of weeks filters the span to the picked games (1 and 3 of 1–3)');
chk(app.sumQ({1:{team:'CIN',stats:{pass_yd:200,gp:1}},2:{team:'CIN',stats:{pass_yd:300,gp:1}}},'CIN',1,2,new Set([2])).pass_yards===300, 'the quarterback sum takes the same set');
app.setProj('CIN', {weekPick:[1], rushing:{}});
const ch=app.chips('CIN');
chk((ch.match(/class="wr-chip[ "]/g)||[]).length===4 && /wr-chip wr-picked wr-res-W[^>]*onclick="weekPickToggle\('CIN',1,event\)"/.test(ch) && /wr-chip-clear/.test(ch), 'the phone\'s chips: one per played game, the picked one lit with its result, and a clear chip while a pick is on');
chk((ch.match(/class="wr-chip wr-res-W"/g)||[]).length===1 && (ch.match(/class="wr-chip"/g)||[]).length===1, 'the other chips carry their W or L too, unlit; the unscored game’s chip has none');
console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
