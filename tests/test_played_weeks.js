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
console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
