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
  let _applied=null;
  return { board, played:tcSeasonPlayedWeek, max:tcSeasonMaxWeek, numRail:renderWeekNumberRail, setWeek:(w)=>{ TC_SEASON.week=w; _tcBoard.week=w; },
    parse:_parseWeeklySchedule, rail:(team,cls)=>renderWeekOpponentRail(team,'2026',cls), setSched:(m)=>{ _weeklyOppBySeason['2026']=m; }, setProj:(t,st)=>{ userProj[t]=st; }, picks:weekPicks, chips:(t)=>weekPickChipsHTML(t,'2026'), sumR:sumWeeklyRange, sumQ:sumWeeklyRangeQB,
    oppRail:(team)=>{ _weeklyOppBySeason['2026']={[team]:{1:{opp:'GB',home:true},2:{opp:'CHI',home:false},3:{opp:'BAL',home:true}}}; return renderWeekOpponentRail(team,'2026'); },
    advCard:(team)=>{ _advWeeklySeedReady=true; _advSeasonCanRange=()=>true; _advEnsureWeeklyLoaded=()=>{}; advTeamSeason=()=>'2026'; return renderAdvWeekRange(team,{showOppRail:false}); },
    advDrag:(team,which,v)=>{ advWeekRangeDrag(team,which,v); return document.getElementById('adv-wr-hi-'+team).textContent+'|'+document.getElementById('adv-wr-lo-'+team).textContent; },
    card:(team)=>{ activeSeason='2026'; getSharedWeekRange=()=>[1,18]; isWeekFilterActive=()=>false; return weekRangeSliderHTML(team, userProj[team]); },
    tap:weekCardTap, ensure:ensureWeeklyOppSchedule, noRender:()=>{ renderContent=()=>{}; },
    toggle:weekPickToggle, clear:weekPickClear, picksOf:(t,s)=>[...weekPicks(t,s)].sort((a,b)=>a-b), sharedRange:getSharedWeekRange, clickOff:weekPickClickOff,
    numRailPick:(s)=>renderWeekNumberRail('wr-week-adv',{pickTeam:ADV_LEAGUE_RANGE_KEY, season:s}), advCardPicks:(team)=>{ _advWeeklySeedReady=true; _advSeasonCanRange=()=>true; _advEnsureWeeklyLoaded=()=>{}; advTeamSeason=()=>'2026'; return renderAdvWeekRange(team); },
    applied:()=>_applied, stubApply:()=>{ applyWeekRange=(t,lo,hi,w)=>{ _applied={t,lo,hi,w:w?[...w]:null}; }; resetWeekRange=(t)=>{ _applied={t,reset:true}; }; } };
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
chk(/wr-pickable[^"]*wr-picked wr-res-W[^>]*onclick="weekPickToggle\('CIN',2,event,'2026'\)"/.test(r) && /<span class="wr-res wr-res-badge" aria-label="Win">W<\/span>/.test(r), 'the picked game wears its result — a W badge on the logo’s corner — and a tap drops it');
chk(/wr-pickable wr-dim[^>]*onclick="weekPickToggle\('CIN',1,event,'2026'\)"/.test(r), 'the other played games dim while a pick is on, and stay a tap');
chk((r.match(/wr-res-badge/g)||[]).length===2 && (r.match(/wr-res-[WLT]/g)||[]).length===2 && /wr-pickable wr-dim wr-res-W[^>]*onclick="weekPickToggle\('CIN',1,event,'2026'\)"/.test(r) && /wr-pickable wr-dim"[^>]*onclick="weekPickToggle\('CIN',3,event,'2026'\)"/.test(r), 'every scored game wears its W or L, picked or not — the record reads at a glance; a game without a score yet wears none');
chk(!/weekPickToggle\('CIN',3/.test(r) || /wr-pickable[^>]*weekPickToggle\('CIN',3/.test(r), 'week 3 (played, no score yet) is still pickable');
chk(/wr-pickable[^"]*wr-picked wr-res-W[^>]*onclick="weekPickToggle\('CIN',2,event,'2026'\)"/.test(app.rail('CIN','wr-opp-adv')), 'the Adv Metrics rail is the same picker on the same pick: week 2 rings there too');
app.setProj('CIN', {weekPick:null, rushing:{}});
chk(!/wr-dim|wr-picked/.test(app.rail('CIN','wr-opp-main')) && /weekPickToggle\('CIN',1,event,'2026'\)/.test(app.rail('CIN','wr-opp-main')), 'no pick: nothing dimmed, every played game a tap');
chk((app.rail('CIN','wr-opp-main').match(/wr-res-badge/g)||[]).length>=2 && /wr-pickable wr-res-[WLT]/.test(app.rail('CIN','wr-opp-main')), 'no pick: the badges are still there');
const wk={1:{team:'CIN',stats:{rec:3,rec_yd:30,gp:1}}, 2:{team:'CIN',stats:{rec:5,rec_yd:50,gp:1}}, 3:{team:'CIN',stats:{rec:7,rec_yd:70,gp:1}}};
chk(app.sumR(wk,'CIN',1,3).receptions===15 && app.sumR(wk,'CIN',1,3,new Set([1,3])).receptions===10 && app.sumR(wk,'CIN',1,3,new Set([1,3])).games_played===2, 'a set of weeks filters the span to the picked games (1 and 3 of 1–3)');
chk(app.sumQ({1:{team:'CIN',stats:{pass_yd:200,gp:1}},2:{team:'CIN',stats:{pass_yd:300,gp:1}}},'CIN',1,2,new Set([2])).pass_yards===300, 'the quarterback sum takes the same set');
app.setProj('CIN', {weekPick:[1], rushing:{}});
const ch=app.chips('CIN');
chk((ch.match(/class="wr-chip[ "]/g)||[]).length===4 && /wr-chip wr-picked wr-res-W[^>]*onclick="weekPickToggle\('CIN',1,event,'2026'\)"/.test(ch) && /wr-chip-clear/.test(ch), 'the phone\'s chips: one per played game, the picked one lit with its result, and a clear chip while a pick is on');
chk((ch.match(/class="wr-chip wr-res-W"/g)||[]).length===1 && (ch.match(/class="wr-chip"/g)||[]).length===1, 'the other chips carry their W or L too, unlit; the unscored game’s chip has none');
(async()=>{

console.log('=== one pick, every card: the projections tabs, the Adv Metrics card, the league-wide card ===');
app.stubApply(); app.setProj('CIN', {weekPick:null, rushing:{}, passing_shares:null});
app.toggle('CIN', 2, null, '2026');
chk(app.picksOf('CIN','2026').join()==='2' && app.sharedRange('CIN','2026').join()==='2,2' && app.applied() && app.applied().t==='CIN' && app.applied().w.join()==='2', 'a tap on the rail picks week 2 for CIN in 2026: the shared store, the shared range and the projections data all follow');
chk(/wr-picked wr-res-W[^>]*weekPickToggle\('CIN',2,event,'2026'\)/.test(app.rail('CIN','wr-opp-main')) && /wr-picked wr-res-W[^>]*weekPickToggle\('CIN',2,event,'2026'\)/.test(app.rail('CIN','wr-opp-adv')), 'the projections rail and the Adv Metrics rail both ring week 2 — switching tabs keeps the pick');
const ac=app.advCardPicks('CIN');
chk(/<div class="week-range-card" data-wr-team="CIN" data-wr-season="2026" onclick="weekCardTap\(event\)"/.test(ac) && !/adv-week-range-card/.test(ac) && /Picked game: <b>wk 2<\/b> · click off to clear/.test(ac) && /wr-chips/.test(ac) && /wr-more/.test(ac) && /or tap a game below/.test(ac)===false, 'the Adv Metrics card IS the projections card — one builder, one class — with team and season on it, the picked line, the chips, the fold toggle (the hint gives way to Reset while a pick is on)');
app.toggle('CIN', 2, null, '2026');
chk(app.picksOf('CIN','2026').length===0 && app.applied() && app.applied().reset===true, 'tapping the picked game again drops it and the projections data resets');
app.toggle('CIN', 1, null, '2025');
chk(app.picksOf('CIN','2025').join()==='1' && app.picksOf('CIN','2026').length===0 && !(app.applied() && app.applied().t==='CIN' && app.applied().w && app.applied().w.join()==='1'), 'a pick on a past season’s Adv card is its own: shared by season, never applied to this season’s projections');
app.clear('CIN','2025');
const lr=app.numRailPick('2026');
chk((lr.match(/wr-pickable/g)||[]).length===4 && /wr-week-cell wr-week-bottom wr-pickable"[^>]*onclick="weekPickToggle\('__LEAGUE__',1,event,'2026'\)"/.test(lr) && !/wr-dim/.test(lr), 'the league-wide card’s week numbers are taps for the played weeks (1–4 by now), none dimmed before a pick');
app.toggle('__LEAGUE__', 1, null, '2026');
const lr2=app.numRailPick('2026');
chk(/wr-week-cell wr-week-bottom wr-pickable wr-picked"[^>]*weekPickToggle\('__LEAGUE__',1/.test(lr2) && /wr-week-cell wr-week-top wr-pickable wr-dim"[^>]*weekPickToggle\('__LEAGUE__',2/.test(lr2) && app.sharedRange('__LEAGUE__','2026').join()==='1,1', 'a tap on week 1 rings it, dims week 2 and narrows the league-wide range to that week');
chk(/<b>1<\/b> wk/.test(app.chips('__LEAGUE__')) || /<b>1<\/b> wk/.test(app.chips('__LEAGUE__','2026')), 'the league card’s phone chips are week numbers');
app.clear('__LEAGUE__','2026');
chk(app.picksOf('__LEAGUE__','2026').length===0 && app.sharedRange('__LEAGUE__','2026').join()==='1,18', 'clearing the league pick restores the full season');
app.toggle('CIN', 2, null, '2026');
const kept=app.clickOff({target:{closest:(sel)=>/button/.test(sel)?{}:null}});
chk(!kept && app.picksOf('CIN','2026').join()==='2', 'a click on a tab or a button is not a click off: the pick survives a walk to another tab');
app.clear('CIN','2026');
console.log('=== the phone card: compact until a tap opens the chips ===');
let cd=app.card('CIN');
chk(/<div class="week-range-card" data-wr-team="CIN" data-wr-season="2026" onclick="weekCardTap\(event\)">/.test(cd) && /week-range-hint week-range-help/.test(cd) && /<span class="wr-more" aria-hidden="true">games ▾<\/span>/.test(cd) && /wr-chips/.test(cd), 'the card is a tap; closed it says "games ▾", the long hint and the chips are there for CSS to hide on a phone');
const fakeCard={on:false, classList:{contains(){ return fakeCard.on; }, toggle(c,v){ fakeCard.on=v; }}, querySelector:()=>fakeCard.more, more:{textContent:''}};
const mk=(hit)=>({target:{closest:(sel)=>hit && sel.indexOf(hit)>=0 ? fakeCard : (sel==='.week-range-card'?fakeCard:null)}});
app.tap(mk('.wr-chip'));
chk(!fakeCard.on, 'a tap on a chip is the chip’s, not the card’s');
app.tap(mk(null));
chk(fakeCard.on && fakeCard.more.textContent==='hide ▴' && /week-range-card wr-open"/.test(app.card('CIN')) && /hide ▴/.test(app.card('CIN')), 'a tap on the card opens it — the class flips on the spot and a re-render keeps it open');
app.tap(mk(null));
chk(!fakeCard.on && !/wr-open/.test(app.card('CIN')), 'another tap closes it');

console.log('=== the schedule is re-validated each load; the cached copy only serves offline ===');
app.noRender();
const calls=[];
global.fetch=async(url,opts)=>{ if(!/games\.csv/.test(String(url))) return {ok:false, text:async()=>''}; calls.push((opts||{}).cache); if((opts||{}).cache==='no-cache') throw new Error('offline'); return {ok:true, text:async()=>'season,game_type,week,home_team,away_team,home_score,away_score\n2025,REG,1,CIN,KC,10,13'}; };
const ok=await app.ensure('2025');
chk(ok===true && calls.join(',')==='no-cache,force-cache', 'no-cache first (an ETag revalidation, so a new week’s scores land), the force-cache copy only when that fails');
calls.length=0;
global.fetch=async(url,opts)=>{ if(!/games\.csv/.test(String(url))) return {ok:false, text:async()=>''}; calls.push((opts||{}).cache); return {ok:true, text:async()=>'season,game_type,week,home_team,away_team,home_score,away_score\n2024,REG,1,CIN,KC,10,13'}; };
chk((await app.ensure('2024'))===true && calls.join(',')==='no-cache', 'online: one request, never the stale copy');
console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
})();
