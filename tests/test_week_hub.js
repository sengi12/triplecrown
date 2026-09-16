// This Week hub: the lineup/waiver/FAAB engine, driven with fixtures — every
// league scored under its OWN settings, lineup.py's callout grades, the waiver
// reasons, and the FAAB pacing math (early beats late).
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){},getBoundingClientRect:()=>({top:0})};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};
global.fetch=()=>Promise.reject(new Error('offline in test'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  sleeperPlayers={
    '1':{name:'Star Back',pos:'RB',team:'NE',injury_status:''},
    '2':{name:'Backup Back',pos:'RB',team:'NE',injury_status:''},
    '3':{name:'Hurt Wideout',pos:'WR',team:'SEA',injury_status:'Out'},
    '4':{name:'Deep Wideout',pos:'WR',team:'SEA',injury_status:''},
    '5':{name:'Solid Wideout',pos:'WR',team:'KC',injury_status:''},
    '6':{name:'Bench Wideout',pos:'WR',team:'KC',injury_status:''},
    '7':{name:'Some Tight',pos:'TE',team:'KC',injury_status:''},
    '8':{name:'The Passer',pos:'QB',team:'KC',injury_status:''},
    '9':{name:'Free Back',pos:'RB',team:'SEA',injury_status:''},
    '10':{name:'Free Wideout',pos:'WR',team:'NE',injury_status:''},
    '11':{name:'Spare Passer',pos:'QB',team:'NE',injury_status:''},
    '12':{name:'Third Back',pos:'RB',team:'KC',injury_status:''},
  };
  Object.assign(TC_SEASON,{year:2026,phase:'regular',week:2,source:'test'});
  hasSeasonStarted=function(){return true;};
  TC_INSEASON={season:2026, weeks:[1],
    schedule:{NE:{'2':'MIA','3':'NYJ','4':'BUF','5':'DEN'}, SEA:{'2':'ARI','3':'LAR','4':'SF','5':'DET'}, KC:{'2':'LV','3':'DEN','4':'LAC','5':'BAL'}},
    schedule_meta:{NE:{'2':['MIA',1,'Sun','1:00 PM','2099-01-01']}, SEA:{'2':['ARI',0,'Sun','4:25 PM','2099-01-01']}, KC:{'2':['LV',1,'Mon','8:15 PM','2099-01-01']}},
    player_weekly:{cols:['tgt','rec','rec_yd','rec_td','air_yd','carry','rush_yd','rush_td','pass_att','pass_yd','pass_td','pass_int','epa_touch','team_tgt'],
      players:{ g1:{n:'Star Back',p:'RB',t:'NE',w:{'1':[3,3,20,0,5,18,80,1,0,0,0,0,2,30]}},
                g9:{n:'Free Back',p:'RB',t:'SEA',w:{'1':[4,4,30,0,3,14,70,0,0,0,0,0,1,28]}},
                g10:{n:'Free Wideout',p:'WR',t:'NE',w:{'1':[11,8,122,1,80,0,0,0,0,0,0,0,7,30]}} }},
    def_vs_pos:{cols:['tgt','rec','rec_yd','rec_td','carry','rush_yd','rush_td','pass_att','pass_yd','pass_td','pass_int'],
      teams:{MIA:{RB:{'1':[5,4,30,0,25,140,2,0,0,0,0]},WR:{'1':[20,14,200,2,0,0,0,0,0,0,0]}},
             ARI:{RB:{'1':[3,3,10,0,20,60,0,0,0,0,0]},WR:{'1':[22,15,180,1,0,0,0,0,0,0,0]}},
             LV:{RB:{'1':[4,3,20,0,22,90,1,0,0,0,0]},WR:{'1':[24,16,220,1,0,0,0,0,0,0,0]}}}}};
  laPidFromGsis=function(g){ return {g1:'1',g9:'9',g10:'10'}[g]||null; };
  const ROWS=[
    {player_id:'1',name:'Star Back',pos:'RB',team:'NE',rushing_attempts:250,rushing_yards:1100,rushing_tds:9,receptions:40,receiving_yards:300,receiving_tds:1,proj_games:17},
    {player_id:'2',name:'Backup Back',pos:'RB',team:'NE',rushing_attempts:90,rushing_yards:380,rushing_tds:2,receptions:15,receiving_yards:100,receiving_tds:0,proj_games:17},
    {player_id:'3',name:'Hurt Wideout',pos:'WR',team:'SEA',receptions:90,receiving_yards:1200,receiving_tds:8,receiving_targets:140,proj_games:17},
    {player_id:'4',name:'Deep Wideout',pos:'WR',team:'SEA',receptions:60,receiving_yards:800,receiving_tds:5,receiving_targets:95,proj_games:17},
    {player_id:'5',name:'Solid Wideout',pos:'WR',team:'KC',receptions:70,receiving_yards:900,receiving_tds:6,receiving_targets:110,proj_games:17},
    {player_id:'6',name:'Bench Wideout',pos:'WR',team:'KC',receptions:66,receiving_yards:850,receiving_tds:6,receiving_targets:100,proj_games:17},
    {player_id:'7',name:'Some Tight',pos:'TE',team:'KC',receptions:55,receiving_yards:600,receiving_tds:5,receiving_targets:80,proj_games:17},
    {player_id:'8',name:'The Passer',pos:'QB',team:'KC',passing_yards:4300,passing_tds:32,interceptions_thrown:9,passing_attempts:560,rushing_yards:200,rushing_tds:2,proj_games:17},
    {player_id:'9',name:'Free Back',pos:'RB',team:'SEA',rushing_attempts:80,rushing_yards:340,rushing_tds:2,receptions:20,receiving_yards:150,receiving_tds:0,proj_games:17},
    {player_id:'10',name:'Free Wideout',pos:'WR',team:'NE',receptions:35,receiving_yards:450,receiving_tds:2,receiving_targets:55,proj_games:17},
    {player_id:'11',name:'Spare Passer',pos:'QB',team:'NE',passing_yards:4000,passing_tds:28,interceptions_thrown:10,passing_attempts:540,proj_games:17},
    {player_id:'12',name:'Third Back',pos:'RB',team:'KC',rushing_attempts:60,rushing_yards:250,rushing_tds:1,receptions:10,receiving_yards:80,proj_games:17},
  ];
  buildPlayerList=function(){ return ROWS.map(r=>Object.assign({},r)); };
  if(typeof HISTORY==='undefined' || !HISTORY) HISTORY={}; Object.assign(HISTORY, { '1':{'2025':[{team:'NE',pos:'RB',games_played:16,stats:{rushing_attempts:240,rushing_yards:1050,rushing_tds:8,receptions:38,receiving_yards:280}}]},
            '9':{'2025':[{team:'SEA',pos:'RB',games_played:15,stats:{rushing_attempts:150,rushing_yards:700,rushing_tds:5,receptions:30,receiving_yards:250}}]},
            '10':{'2025':[{team:'NE',pos:'WR',games_played:17,stats:{receptions:80,receiving_yards:1100,receiving_tds:7}}]} });
  _laMu={byWeek:{'2':{rows:[{roster_id:1,matchup_id:1,starters:['8','2','3','5','7','6']},{roster_id:2,matchup_id:1,starters:[]}],sig:'x'}},fetching:{}};
  laFetchMatchups=function(){};
  return { dur:hubDurability, snap:hubSnapshotResult, teamCard:laThisWeekCardHTML, hubScoringFor, calcFptsUnder, hubWeekProj, hubFormMap, hubFill, hubCallouts, hubWaiverReasons, hubFaabAdvice, hubFaabCurveFromHistory, hubFaabFallbackCurve, hubAnalyzeLeague, hubKickoff,
    hubChopBand, hubChopMarket, hubChopFaab, hubChopCaliber, HUB_CHOP_DEFAULTS, leagueHTML:_hubActionsHTML,
    hubFaabCurve, hubChopScanTx, hubLeagueNameKey, hubWireBoard, laRosValueMap, rankDefaultSortKey, laTrendsView, laState:()=>laState, tcLocalToolCall, tcLocalToolDefs, tcChatLeagueContext, setHub:(r)=>{ hubState.results=r; hubState.loadedAt=Date.now(); }, setProfile:(p)=>{ laLoadSleeperProfile=function(){ return p; }; }, setFetch:(f)=>{ sleeperFetch=f; }, chopHist:(id)=>_hubChopHist[id], LA_LEAGUE_URL, SLEEPER_LEAGUES_URL,
           laDvpTable, laCurrentWeek, byId:()=>{ const m=new Map(); buildPlayerList().forEach(p=>m.set(String(p.player_id),p)); return m; },
           gs:()=>scoringSettings, HUB_CLOSE, ins:()=>TC_INSEASON, sp:()=>sleeperPlayers, nv:()=>NFLVERSE, setDyn:(d)=>{ DYNASTY_VALUES=d; } };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== scoring per league, no global leak ===');
const before=JSON.stringify(app.gs());
const ppr=app.hubScoringFor({name:'Queen City Kings', scoring_settings:{rec:1, rec_yd:0.1, rush_yd:0.1, rec_td:6, rush_td:6}});
const std=app.hubScoringFor({name:'Old School', scoring_settings:{rec:0, rec_yd:0.1, rush_yd:0.1, rec_td:6, rush_td:6}});
chk(JSON.stringify(app.gs())===before, 'building a league context leaves the global scoring untouched');
const row=app.byId().get('1');
chk(app.calcFptsUnder(row,ppr) > app.calcFptsUnder(row,std), 'the same back scores more in PPR than in standard');
chk(app.calcFptsUnder(row,ppr)-app.calcFptsUnder(row,std)===40, '…by exactly his receptions');
const bafl=app.hubScoringFor({name:'BAFL 2026', scoring_settings:{rec:0.5}});
chk(bafl.baflMode===true && ppr.baflMode===false, 'a league named BAFL gets the category lens; others do not');

console.log('=== the week projection ===');
const dvp=app.laDvpTable();
const form=app.hubFormMap(ppr);
const ctx={sc:ppr, wk:2, dvp, form, sched:app.ins().schedule, now:Date.now()};
const wp1=app.hubWeekProj(app.byId().get('1'), ctx);
chk(wp1.adj>0 && wp1.opp==='MIA' && wp1.oppRank!=null, `Star Back projects ${wp1.adj.toFixed(1)} vs MIA (DvP #${wp1.oppRank})`);
chk(wp1.seas!=null && wp1.gp===1, 'one played week blends in as season FPPG');
const wp3=app.hubWeekProj(app.byId().get('3'), ctx);
chk(wp3.adj===0 && wp3.out && wp3.status==='Out', 'an Out player projects zero');
chk(Math.abs(wp1.defMult-1.10)<1e-9, 'the most generous run defense (DvP #1) is +10%');

console.log('=== lineup fill + callouts (lineup.py grades) ===');
const mk=(id,val,extra)=>Object.assign({id,name:app.sp()[id].name,pos:app.sp()[id].pos,team:app.sp()[id].team,value:val,locked:false,unavailable:''},extra||{});
const slots=['QB','RB','WR','WR','TE','FLEX'];
const current={0:mk('8',20),1:mk('2',6),2:mk('3',0,{unavailable:'Out'}),3:mk('5',12),4:mk('7',9),5:mk('6',11)};
const bench=[mk('1',16),mk('4',10.5)];
const all=Object.values(current).concat(bench).sort((a,b)=>b.value-a.value);
const opt=app.hubFill(slots, all, current);
chk(opt[1].player.id==='1' && opt[0].player.id==='8', 'the better back takes RB, the QB stays');
chk(!opt.some(f=>f.player&&f.player.id==='3'), 'the Out wideout never fills a slot');
const co=app.hubCallouts(slots, opt, current, bench);
const obv=co.find(c=>c.kind==='OBVIOUS'&&c.start.id==='1');
chk(obv && obv.sit && obv.sit.id==='2' && obv.delta===10, 'START Star Back over Backup Back (+10) is OBVIOUS');
const forOut=co.find(c=>c.start&&c.start.id==='4');
chk(forOut && forOut.kind==='OBVIOUS' && forOut.sit.id==='3', 'replacing an Out starter is OBVIOUS whatever the margin');
chk(!co.some(c=>c.kind==='CLOSE'&&c.delta>=app.HUB_CLOSE), `nothing under ${app.HUB_CLOSE} points is graded OBVIOUS`);
const cur2={0:mk('8',20),1:mk('1',16),2:mk('5',12),3:mk('6',11),4:mk('7',9),5:mk('2',6)};
const bench2=[mk('4',5.2)];
const opt2=app.hubFill(slots, Object.values(cur2).concat(bench2).sort((a,b)=>b.value-a.value), cur2);
const co2=app.hubCallouts(slots, opt2, cur2, bench2);
chk(co2.length===1 && co2[0].kind==='CALL' && co2[0].sit.id==='4' && co2[0].start.id==='2', 'a bench player within 3 of the weakest eligible starter is a CLOSE CALL, nothing else fires');
const locked={0:mk('8',20),1:mk('2',6,{locked:true})};
const opt3=app.hubFill(['QB','RB'], [mk('1',16),mk('8',20),mk('2',6,{locked:true})], locked);
chk(opt3[1].player.id==='2', 'a starter whose game kicked off keeps his slot');

console.log('=== waiver reasons ===');
const teammates=[app.byId().get('3'), app.byId().get('4'), app.byId().get('9')];
const r9=app.hubWaiverReasons(app.byId().get('9'), null, ctx, teammates);
chk(!r9.some(r=>r.k==='vacancy'), 'a WR going out does not open an RB role');
const wrTeam=[app.byId().get('3'), app.byId().get('4')];
const r4=app.hubWaiverReasons(app.byId().get('4'), null, ctx, wrTeam);
chk(r4.some(r=>r.k==='vacancy' && /Hurt Wideout Out/.test(r.text)), 'a better WR teammate ruled Out opens the role');
const ctxSpike=Object.assign({}, ctx, {usageRank:new Map([['10',2]]), projRank:new Map([['10',30]])});
const r10=app.hubWaiverReasons(app.byId().get('10'), null, ctxSpike, []);
chk(r10.some(r=>r.k==='spike'), 'week 1: WR2 in touches while projected WR30 is a usage spike');

console.log('=== FAAB: early beats late ===');
const fb=app.hubFaabFallbackCurve();
const early=app.hubFaabAdvice(120, 1, fb, 12, 100, 100);
const late=app.hubFaabAdvice(120, 10, fb, 12, 100, 100);
chk(late.share>early.share, 'the same rest-of-season value deserves a BIGGER share late (fewer pickups ahead)…');
const pace10=app.hubFaabAdvice(1,10,fb,12,100,100).spentShould;
const earlyVal=app.hubFaabAdvice(16*8, 1, fb, 12, 100, 100), lateVal=app.hubFaabAdvice(7*8, 10, fb, 12, 100, Math.round(100*(1-pace10)));
chk(earlyVal.bid>lateVal.bid, `the same player (8 ppg) draws $${earlyVal.bid} in week 1 and $${lateVal.bid} in week 10 on a paced budget`);
chk(early.spentShould<0.15 && app.hubFaabAdvice(1,9,fb,12,100,100).spentShould>0.6, 'the pace curve says most pickup value is gone by midseason');
chk(early.bid<=100 && early.bid>=0, 'bids never exceed what is left');
const adds=[]; for(let w=1; w<=8; w++){ adds.push({season:2025, week:w, pid:'1', bid:20}); adds.push({season:2025, week:w, pid:'9', bid:5}); adds.push({season:2025, week:w, pid:'10', bid:8}); }
const curve=app.hubFaabCurveFromHistory(adds, ppr);
chk(curve && curve[1]>curve[8], 'a history-built curve decays: a week-1 pickup carries more rest-of-season value than a week-8 one');
chk(app.hubFaabCurveFromHistory(adds.slice(0,3), ppr)===null, 'too thin a history is refused (fallback stands in)');

console.log('=== a whole league, end to end ===');
const lg={league_id:'L1', name:'Queen City Kings', season:'2026', total_rosters:2, roster_positions:['QB','RB','WR','WR','TE','FLEX','BN','BN'],
  scoring_settings:{rec:1, rec_yd:0.1, rush_yd:0.1, rec_td:6, rush_td:6, pass_yd:0.04, pass_td:4}, settings:{waiver_type:2, waiver_budget:100}, previous_league_id:null};
const rosters=[{roster_id:1, owner_id:'me', players:['8','1','2','3','5','6','7','4'], starters:['8','2','3','5','7','6'], settings:{waiver_budget_used:12}},
               {roster_id:2, owner_id:'them', players:[], starters:[]}];
const matchups=[{roster_id:1, matchup_id:1, starters:['8','2','3','5','7','6']},{roster_id:2, matchup_id:1, starters:[]}];
const users=[{user_id:'me',display_name:'pottluke'},{user_id:'them',display_name:'rival',metadata:{team_name:'Rivals'}}];
const projRank=new Map(); const usageRank=new Map([['10',1],['9',2],['1',3]]);
['QB','RB','WR','TE'].forEach(pos=>{ const rows=[]; app.byId().forEach(r=>{ if(r.pos===pos) rows.push(r); }); rows.map(r=>({id:String(r.player_id),v:app.calcFptsUnder(r,ppr)})).sort((a,b)=>b.v-a.v).forEach((r,i)=>projRank.set(r.id,i+1)); });
const res=app.hubAnalyzeLeague(lg, rosters, users, matchups, {sc:ppr, wk:2, dvp, form, sched:app.ins().schedule, now:Date.now(), byId:app.byId(), myUserId:'me', projRank, usageRank, faabCurve:null});
chk(res.mine && res.lineup && res.lineup.opponent==='Rivals', 'finds my roster and names the opponent');
chk(res.lineup.callouts.some(c=>c.kind==='OBVIOUS' && c.start.id==='1'), 'says to start Star Back');
chk(res.lineup.callouts.some(c=>c.start && c.start.id==='4' && c.sit && c.sit.id==='3'), 'says to replace the Out wideout');
chk(res.adds.every(a=>!['8','1','2','3','5','6','7','4'].includes(a.id)), 'adds are unrostered only');
chk(!res.adds.some(a=>a.id==='11'), 'a 1-QB league with a healthy QB never suggests a QB, however many raw points he scores');
const fw=res.adds.find(a=>a.id==='10');
chk(fw && fw.drop && fw.drop.id==='2', 'the wideout pickup names the player he replaces: the backup back');
chk(fw && fw.net>0 && fw.drop.vor!=null && fw.vor>fw.drop.vor, 'and the add is net-positive over replacement');
chk(!res.adds.some(a=>a.drop && (a.drop.id==='3' || a.drop.id==='4')), 'the Out wideout and the man covering him are protected — never the drop');
chk(fw && fw.faab && fw.faab.bid>0 && fw.faab.left===88, 'FAAB advice reads the league budget and what I have spent ($88 left)');
chk(res.drops.some(d=>d.p.id==='2') && !res.drops.some(d=>d.p.id==='3'), 'drop candidates: the backup back, never the injured starter');
chk(!res.adds.some(a=>a.id==='12'), 'a third-string back below replacement is not an add');
chk(res.lineup.optTotal>res.lineup.curTotal, 'optimal beats the set lineup');

console.log('=== durability: sticky or fleeting ===');
const mkForm=(entries)=>{ const m=new Map(); for(const id in entries){ const ws=entries[id]; m.set(id,{gp:ws.length, fppg:ws.reduce((a,w)=>a+w.pts,0)/ws.length, f3:ws.slice(-3).reduce((a,w)=>a+w.pts,0)/Math.min(3,ws.length), weeks:ws, pos:app.sp()[id].pos, team:app.sp()[id].team}); } return m; };
const dctx=(form, extra)=>Object.assign({sc:ppr, wk:3, dvp, sched:app.ins().schedule, form}, extra||{});
// a sustained 24% target share across three weeks
let f=mkForm({'10':[{wk:1,pts:12,tgt:7,teamTgt:30,carry:0,touches:7,tds:0},{wk:2,pts:14,tgt:8,teamTgt:32,carry:0,touches:8,tds:1},{wk:3,pts:11,tgt:7,teamTgt:29,carry:0,touches:7,tds:0}]});
let d=app.dur(app.byId().get('10'), dctx(f), []);
chk(d.score>0.65 && d.sticky.some(x=>/target share · 3 wks running/.test(x)), `a sustained target share is sticky (${d.score.toFixed(2)}: ${d.sticky[0]})`);
// two TDs on five touches, one week
f=mkForm({'10':[{wk:3,pts:22,tgt:5,teamTgt:30,carry:0,touches:5,tds:2}]});
d=app.dur(app.byId().get('10'), dctx(f), []);
chk(d.score<0.4 && d.fleeting.some(x=>/TD-driven/.test(x)), `TD-driven points on light volume are fleeting (${d.score.toFixed(2)})`);
// a share that collapsed
f=mkForm({'10':[{wk:2,pts:15,tgt:9,teamTgt:30,carry:0,touches:9,tds:0},{wk:3,pts:3,tgt:2,teamTgt:31,carry:0,touches:2,tds:0}]});
d=app.dur(app.byId().get('10'), dctx(f), []);
chk(d.fleeting.some(x=>/target share fell/.test(x)), 'a target share that collapsed reads as fleeting');
// the opportunity's source: a teammate on IR vs one who is Out for a week
app.sp()['3'].injury_status='IR';
d=app.dur(app.byId().get('4'), dctx(mkForm({})), [app.byId().get('3'), app.byId().get('4')]);
chk(d.score>0.6 && d.sticky.some(x=>/on IR/.test(x)), 'a role opened by an IR stint is sticky');
app.sp()['3'].injury_status='Out';
d=app.dur(app.byId().get('4'), dctx(mkForm({})), [app.byId().get('3'), app.byId().get('4')]);
chk(d.fleeting.some(x=>/short absence/.test(x)), 'a role opened by a one-week Out is flagged as short');
app.sp()['3'].injury_status='Out';
// trending
d=app.dur(app.byId().get('10'), dctx(mkForm({}), {trending:{'10':{count:23400}}}), []);
chk(/23k adds/.test(d.trend||''), 'league-wide trending adds surface as urgency');
// a 12-carry back, efficiency backing from the live fan ranks
app.nv()['2026']=Object.assign(app.nv()['2026']||{}, {rb_fan:{'free back':{totals:{attempts:14, rk:{rz:[1,8]}}}}, ngs_weekly:{players:{'free back':{kind:'rb',pos:'RB',season:{rk:{ryoe:[2,8]}}}}}});
f=mkForm({'9':[{wk:2,pts:13,tgt:2,teamTgt:28,carry:14,touches:16,tds:0},{wk:3,pts:12,tgt:1,teamTgt:30,carry:13,touches:14,tds:0}]});
d=app.dur(app.byId().get('9'), dctx(f), []);
chk(d.score>=0.8 && d.sticky.some(x=>/RYOE/.test(x)) && d.sticky.some(x=>/RZ carries/.test(x)), `a back with sustained carries, RYOE and red-zone work is as sticky as it gets (${d.score.toFixed(2)})`);
delete app.nv()['2026'].rb_fan; delete app.nv()['2026'].ngs_weekly;

console.log('=== dynasty leagues price the wire on the dynasty chart; chopped is this season only ===');
if(typeof DYNASTY_VALUES==='undefined' || !DYNASTY_VALUES) globalThis.DYNASTY_VALUES=null;
const dynRes=(type)=>app.hubAnalyzeLeague(Object.assign({}, lg, {settings:{waiver_type:2, waiver_budget:100, type}}), rosters, users, matchups, {sc:ppr, wk:2, dvp, form, sched:app.ins().schedule, now:Date.now(), byId:app.byId(), myUserId:'me', projRank, usageRank, faabCurve:null});
app.setDyn({players:{'free wideout':{v:70,sf:70,pos:'WR'}, 'free back':{v:8,sf:8,pos:'RB'}, 'backup back':{v:4,sf:4,pos:'RB'}, 'third back':{v:2,sf:2,pos:'RB'}, 'star back':{v:85,sf:85,pos:'RB'}, 'hurt wideout':{v:60,sf:60,pos:'WR'}, 'deep wideout':{v:30,sf:30,pos:'WR'}, 'solid wideout':{v:40,sf:40,pos:'WR'}, 'bench wideout':{v:35,sf:35,pos:'WR'}, 'some tight':{v:25,sf:25,pos:'TE'}, 'the passer':{v:50,sf:90,pos:'QB'}, 'spare passer':{v:20,sf:60,pos:'QB'}}});
let r2=dynRes(2);
chk(r2.dynasty===true && r2.adds.length && r2.adds[0].id==='10' && r2.adds[0].dynasty, 'a dynasty league: the wire is priced on the chart — Free Wideout (70) leads');
chk(r2.adds[0].vor===70 && /dyn/.test(JSON.stringify(r2.drops[0].reasons)), 'values are chart units (70 over a replacement of 0), the drop reasons say "dynasty"');
chk(r2.adds.findIndex(a=>a.id==='9')>r2.adds.findIndex(a=>a.id==='10') && (r2.adds.find(a=>a.id==='9')||{vor:0}).vor<=8, 'Free Back (chart 8) sits below the wideout and is priced in chart units, not on his projection');
let r3=dynRes(3);
chk(r3.dynasty===false && r3.adds.some(a=>a.id==='9') && !r3.adds[0].dynasty, 'a chopped league (Sleeper type 3) prices the wire on rest-of-season projection like redraft');
app.setDyn(null);

console.log('=== a Chopped league prices a release on its chop market: caliber × teams alive ===');
chk(app.hubChopBand('RB',9)==='top12' && app.hubChopBand('WR',20)==='b24' && app.hubChopBand('QB',5)==='top6' && app.hubChopBand('TE',9)==='b12' && app.hubChopBand('RB',null)===null, 'caliber bands: RB/WR by 12s, QB/TE by 6s, unranked → none');
// the study's defaults (three seasons, weighted toward 2025): a top-12 back with most of the league alive goes for ~23% (median), ~35% wins three in four
let f0=app.hubChopFaab('RB', 8, 17/18, [], 1000, 1000);
chk(f0 && f0.src==='study' && f0.market===234 && f0.bid===281 && f0.chop===true, `no history: the study's numbers — market $${f0&&f0.market}, bid $${f0&&f0.bid} for a top-12 RB with 17 of 18 alive`);
chk(app.hubChopFaab('RB', 8, 5/18, [], 1000, 1000).bid<=5, 'the same back with five teams left is worth a few dollars');
chk(app.hubChopFaab('WR', 8, 17/18, [], 1000, 1000).bid<f0.bid && app.hubChopFaab('QB', 3, 17/18, [], 1000, 1000).bid<100, 'wideouts price below backs, quarterbacks far below');
chk(app.hubChopFaab('RB', 8, 17/18, [], 1000, 120).bid===120, 'capped at what is left');
// the league's own history outranks the defaults once it has three comparables
const hist={ meta:{2025:{total:18, budget:1000}},
  chops:[{season:2025, leg:2, pids:['a']},{season:2025, leg:3, pids:['b']},{season:2025, leg:4, pids:['c','x']},{season:2025, leg:5, pids:['d']}],
  wins:[{season:2025, week:2, pid:'a', bid:400},{season:2025, week:3, pid:'b', bid:380},{season:2025, week:4, pid:'c', bid:360},{season:2025, week:4, pid:'x', bid:12},{season:2025, week:5, pid:'d', bid:340},{season:2025, week:9, pid:'z', bid:250}],
  caliber:{2025:{a:{pos:'RB',rank:3}, b:{pos:'RB',rank:7}, c:{pos:'RB',rank:10}, x:{pos:'WR',rank:40}, d:{pos:'RB',rank:5}, z:{pos:'RB',rank:2}}} };
const mkt=app.hubChopMarket(hist, {});
chk(mkt.length===5 && mkt.every(r=>r.pid!=='z'), 'the market keeps chop releases only (a week-9 add nobody chopped is not one)');
chk(mkt.find(r=>r.pid==='d').alive===15 && mkt.find(r=>r.pid==='a').alive===18, 'teams alive counts the chops before that week');
let f1=app.hubChopFaab('RB', 6, 17/18, mkt, 1000, 1000);
chk(f1.src==='history' && f1.n===4 && f1.market===302 && f1.bid===328, `four comparables from the league's own history: market $${f1.market} (median), bid $${f1.bid} (60th pct, shrunk toward the study)`);
chk(app.hubChopFaab('WR', 8, 17/18, mkt, 1000, 1000).src==='study', 'a band with fewer than three comparables falls back to the study');
// older seasons count for less: four $10-of-$100 releases from 2023 barely move a market set by 2025
const hist3=JSON.parse(JSON.stringify(hist)); hist3.meta[2023]={total:18, budget:100};
['e','f','g','h'].forEach((p,i)=>{ hist3.chops.push({season:2023, leg:i+2, pids:[p]}); hist3.wins.push({season:2023, week:i+2, pid:p, bid:10}); });
hist3.caliber[2023]={e:{pos:'RB',rank:2}, f:{pos:'RB',rank:4}, g:{pos:'RB',rank:9}, h:{pos:'RB',rank:11}};
const mkt3=app.hubChopMarket(hist3, {});
let f3=app.hubChopFaab('RB', 6, 17/18, mkt3, 1000, 1000);
chk(mkt3.length===9 && f3.n===8 && Math.abs(f3.nEff-5.44)<0.01, `eight comparables across two seasons weigh ${f3.nEff.toFixed(2)} (2023 at 0.6² each)`);
chk(f3.market>=290 && f3.market<=310, `market $${f3.market}: near the 2025 level, not the unweighted $225`);
const old4=app.hubChopMarket(Object.assign({}, hist3, {chops:hist3.chops.filter(c=>c.season===2023), wins:hist3.wins.filter(w=>w.season===2023)}), {});
chk(app.hubChopFaab('RB', 6, 17/18, old4, 1000, 1000).market===app.hubChopFaab('RB', 6, 17/18, old4.map(r=>Object.assign({}, r, {season:2025})), 1000, 1000).market, 'recency is relative to the latest comparable, so a history that is all one season is not discounted');
// a lesser caliber never prices above a better one, however its few comparables landed
const hot=mkt.filter(r=>r.pos==='RB').map(r=>Object.assign({}, r, {band:'b24', share:0.8}));
const f4=app.hubChopFaab('RB', 20, 17/18, mkt.concat(hot), 1000, 1000);
chk(f4.n===4 && f4.market===f1.market && f4.bid===f1.bid, `four 13-24 comparables at 80% are capped at the top-12 price: market $${f4.market}, bid $${f4.bid}`);
// the manual era: a roster shedding ten or more in a week, without adding, was chopped by hand
const scan={meta:{}, chops:[], wins:[]}, sAdds=[];
const drops12={}; for(let i=1;i<=12;i++) drops12['p'+i]=4;
app.hubChopScanTx([[], [], [
  {type:'commissioner', status:'complete', leg:3, roster_ids:[4], drops:{p1:4, p2:4, p3:4, p4:4, p5:4, p6:4}},
  {type:'free_agent', status:'complete', leg:3, roster_ids:[4], drops:{p7:4, p8:4, p9:4, p10:4, p11:4, p12:4}},
  {type:'free_agent', status:'complete', leg:3, roster_ids:[5], drops:{q1:5, q2:5, q3:5}},
  {type:'free_agent', status:'complete', leg:3, roster_ids:[6], adds:{p1:6}, drops:{q9:6}},
  {type:'waiver', status:'complete', leg:3, roster_ids:[7], adds:{p2:7}, settings:{waiver_bid:30}},
  {type:'waiver', status:'failed', leg:3, roster_ids:[8], adds:{p2:8}, settings:{waiver_bid:20}},
], [ {type:'chopped', leg:4, roster_ids:[9], drops:drops12} ]], 2024, sAdds, scan);
chk(scan.chops.length===2 && scan.chops[0].leg===4 && scan.chops[1].leg===3 && scan.chops[1].pids.length===12 && !scan.chops.some(c=>c.pids.includes('q1')), 'twelve drops by one roster in a week is a chop; three is a roster move; Sleeper\'s own chop still counts');
chk(scan.wins.length===1 && scan.wins[0].bid===30 && scan.wins[0].week===3 && sAdds.length===2, 'the winning bid is kept (the failed one is not); adds feed the FAAB curve');
chk(app.hubLeagueNameKey('🪓 Last Man Standing Eliminator ')===app.hubLeagueNameKey('Last Man Standing Eliminator') && app.hubLeagueNameKey('Last Man Standing')!==app.hubLeagueNameKey('Last Man Standing Eliminator'), 'the axe emoji and a trailing space do not make it a different league');
// the seasons behind the chain: a re-created league of the same name on the user's account
const hits=[]; const L={
  [app.LA_LEAGUE_URL('L25')]: {league_id:'L25', season:'2025', name:'🪓 Last Man Standing Eliminator ', previous_league_id:null, total_rosters:18, settings:{type:3, waiver_budget:1000}},
  [app.LA_LEAGUE_URL('L23')]: {league_id:'L23', season:'2023', name:'Last Man Standing Eliminator ', previous_league_id:null, total_rosters:18, settings:{type:0, waiver_budget:100}},
  [app.SLEEPER_LEAGUES_URL('u1', 2024)]: [{league_id:'X1', season:'2024', name:'Dynasty Pals'}, {league_id:'L24', season:'2024', name:'Last Man Standing Eliminator ', previous_league_id:'L23', total_rosters:18, settings:{type:0, waiver_budget:200}}],
  [app.LA_LEAGUE_URL('L25')+'/transactions/2']: [{type:'chopped', leg:2, drops:{a:1}}, {type:'waiver', status:'complete', leg:2, roster_ids:[1], adds:{a:1}, settings:{waiver_bid:400}}],
  [app.LA_LEAGUE_URL('L24')+'/transactions/3']: [{type:'commissioner', status:'complete', leg:3, roster_ids:[4], drops:drops12}, {type:'waiver', status:'complete', leg:3, roster_ids:[2], adds:{p1:2}, settings:{waiver_bid:30}}],
  [app.LA_LEAGUE_URL('L23')+'/transactions/2']: [{type:'free_agent', status:'complete', leg:2, roster_ids:[3], drops:drops12}, {type:'waiver', status:'complete', leg:2, roster_ids:[5], adds:{p3:5}, settings:{waiver_bid:25}}],
};
app.setFetch(async url=>{ hits.push(url); if(url in L) return L[url]; if(/transactions/.test(url)) return []; throw new Error('404 '+url); });
localStorage._s={};
const _asyncTests=(async()=>{
  await app.hubFaabCurve({league_id:'L26', season:'2026', name:'🪓 Last Man Standing Eliminator ', previous_league_id:'L25', settings:{type:3, waiver_budget:1000}}, ppr, 'u1');
  const h=app.chopHist('L26');
  chk(h && Object.keys(h.meta).sort().join()==='2023,2024,2025' && h.meta[2024].budget===200 && h.meta[2023].budget===100, 'three seasons of history: 2025 by the chain, 2024 by name from the user\'s leagues, 2023 by the 2024 league\'s chain');
  chk(h.chops.some(c=>c.season===2024 && c.leg===3 && c.pids.length===12) && h.chops.some(c=>c.season===2023 && c.leg===2) && h.chops.some(c=>c.season===2025 && c.leg===2), 'the manual chops are found in both hand-run seasons');
  chk(h.wins.filter(w=>w.season===2024).length===1 && h.wins.filter(w=>w.season===2023).length===1 && h.wins.filter(w=>w.season===2025).length===1, 'each season\'s winning bids are kept');
  chk(hits.includes(app.SLEEPER_LEAGUES_URL('u1', 2024)) && !hits.includes(app.SLEEPER_LEAGUES_URL('u1', 2025)) && !hits.includes(app.SLEEPER_LEAGUES_URL('u1', 2023)), 'only the seasons the chain did not reach are looked up by name');
  const cached=JSON.parse(localStorage.getItem('tc_faab_curve_L26'));
  chk(cached && cached.v===2 && cached.chop && Object.keys(cached.chop.meta).length===3, 'the history is cached for the season');
  app.setFetch(()=>Promise.reject(new Error('offline')));
})();
// caliber from the seed's history: positional rank by PPG under this scoring
const cal=app.hubChopCaliber(2025, ppr);
chk(cal['1'] && cal['1'].pos==='RB' && cal['1'].rank===1 && cal['9'].rank===2 && cal['10'].pos==='WR' && cal['10'].rank===1, 'Star Back ranks RB1 and Free Back RB2 by 2025 PPG; Free Wideout WR1');
// end to end: the chopped league's adds carry chop-market bids, and the card explains them
const chopRes=app.hubAnalyzeLeague(Object.assign({}, lg, {settings:{waiver_type:2, waiver_budget:1000, type:3}}), rosters, users, matchups, {sc:ppr, wk:2, dvp, form, sched:app.ins().schedule, now:Date.now(), byId:app.byId(), myUserId:'me', projRank:new Map([['9',4],['10',30]]), usageRank, faabCurve:null, faabChop:hist});
chk(chopRes.faab && chopRes.faab.chop && chopRes.faab.chop.alive===2 && chopRes.faab.chop.total===2, 'the result carries the field: 2 of 2 alive');
const fbc=chopRes.adds.find(a=>a.id==="9");
chk(fbc && fbc.faab && fbc.faab.chop && fbc.faab.src==="history" && fbc.faab.bid===328, 'Free Back (RB4 projected, every team alive) is priced off the four history comparables at $328');
chk(/hub-bid-chop/.test(app.leagueHTML(chopRes, true)) && /mkt \$302/.test(app.leagueHTML(chopRes, true)) && /Chop market/.test(app.leagueHTML(chopRes, true)), 'the card shows the bid with the market beside it and says where it came from');

console.log('=== the Team tab: one league from the analyzer snapshot ===');
const snap={leagueId:'L1', name:'Queen City Kings', season:'2026', teams:2, rosterPositions:['QB','RB','WR','WR','TE','FLEX','BN','BN'], myUserId:'me',
  teamList:[{rosterId:1, ownerId:'me', owner:'pottluke', teamName:'Mine', players:['8','1','2','3','5','6','7','4'].map(id=>({id,name:sleeperPlayersFix(id).name,pos:sleeperPlayersFix(id).pos,team:sleeperPlayersFix(id).team}))},
            {rosterId:2, ownerId:'them', owner:'rival', teamName:'Rivals', players:[]}]};
function sleeperPlayersFix(id){ return app.sp()[id]; }
const sres=app.snap(snap);
chk(sres && sres.mine && sres.lineup && sres.lineup.opponent==='Rivals', 'the snapshot becomes a league result with my roster and the opponent');
chk(sres.lineup.callouts.some(c=>c.kind==='OBVIOUS' && c.start.id==='1'), 'with the same START call');
const card=app.teamCard(snap);
chk(/WAIVER WIRE/.test(card) && /la-slot-ADD/.test(card) && /la-slot-DROP/.test(card) && /Free Wideout/.test(card) && /Multi-League/.test(card), 'the Lineup pane section renders ADD → DROP pairs in the pane\'s rows and links to Multi-League');

// a Chopped FAAB league: the wire prices on the chop market and every free agent carries a price
const chopSnap=Object.assign({}, snap, {leagueId:'L2', leagueType:3, waiverType:2, waiverBudget:1000, teamList:[Object.assign({}, snap.teamList[0], {faabUsed:100}), snap.teamList[1]]});
const cres=app.snap(chopSnap);
chk(cres && cres.faab && cres.faab.chop && cres.faab.budget===1000 && cres.faab.left===900 && cres.faab.chop.alive===2, 'a Chopped FAAB snapshot prices the wire on the chop market with $900 of $1000 left, 2 of 2 alive');
const board=app.hubWireBoard(cres, 'ALL');
chk(board.length===4 && ['Free Back','Free Wideout','Spare Passer','Third Back'].every(n=>board.some(r=>r.name===n)) && !board.some(r=>r.name==='Star Back'), 'every unrostered QB/RB/WR/TE is on the board, nobody rostered is');
chk(board.every(r=>r.faab && r.faab.chop && r.faab.bid>=0) && board.every((r,i)=>!i || board[i-1].faab.bid>=r.faab.bid), 'each carries a chop-market price, ordered by bid');
chk(app.hubWireBoard(cres, 'QB').length===1 && app.hubWireBoard(cres, 'QB')[0].name==='Spare Passer', 'the position filter narrows it');
const ccard=app.teamCard(chopSnap);
chk(/CHOP MARKET/.test(ccard) && /Spare Passer/.test(ccard) && (ccard.match(/mkt \$/g)||[]).length>=4 && /laSetChopPos\('TE'\)/.test(ccard), 'the Lineup pane shows the chop market board: a price with its market on every free agent, position chips');
chk(!/CHOP MARKET/.test(card) && !/WIRE VALUES/.test(card), 'a league without FAAB has no wire board');
// an ordinary FAAB league: every free agent priced on rest-of-season value, the same chips
const faabSnap=Object.assign({}, snap, {leagueId:'L3', leagueType:0, waiverType:2, waiverBudget:100, teamList:[Object.assign({}, snap.teamList[0], {faabUsed:30}), snap.teamList[1]]});
const fres=app.snap(faabSnap);
chk(fres && fres.faab && !fres.faab.chop && fres.faab.left===70 && Array.isArray(fres.faab.wire) && fres.faab.wire.length===4, 'a redraft FAAB snapshot prices the whole wire with $70 of $100 left');
const fwire=fres.faab.wire.find(r=>r.name==="Free Wideout");
chk(fwire && fwire.faab && !fwire.faab.chop && fwire.faab.bid>0 && fwire.faab.bid<=70 && fres.faab.wire.every((r,i)=>!i || fres.faab.wire[i-1].faab.bid>=r.faab.bid), `Free Wideout is worth $${fwire&&fwire.faab.bid} on rest-of-season value; the wire is ordered by bid`);
const fcard=app.teamCard(faabSnap);
chk(/WIRE VALUES/.test(fcard) && /over replacement, split across the league/.test(fcard) && /Spare Passer/.test(fcard) && !/mkt \$/.test(fcard), 'the Lineup pane shows the wire board without chop-market chips');
// the Trends boards tag every unrostered player with his bid in a FAAB league
app.laState().trndScope='waiver'; app.laState().trndTab='trending';
const tv=app.laTrendsView(faabSnap);
chk(/la-trnd-bid/.test(tv) && !/mkt \$/.test(tv), 'the Waivers scope of Trends carries a bid chip on the wire\'s players');
const tvc=app.laTrendsView(chopSnap);
chk(/la-trnd-bid hub-bid-chop/.test(tvc) && /mkt \$/.test(tvc), 'in a Chopped league the chip is the chop-market price');
app.laState().trndScope='myteam';
chk(!/la-trnd-bid/.test(app.laTrendsView(chopSnap)), 'rostered players carry no bid');
app.laState().trndScope='rostered'; app.laState().trndTab='trending';

console.log('=== Ask TripleCrown sees every league and the season in progress ===');
const _asyncTools=(async()=>{
  app.setProfile({username:'Sengi12', user:{user_id:'me'}, leagues:[{league_id:'L2', name:'🪓 Last Man Standing Eliminator', season:'2026', status:'in_season', total_rosters:2, type:3}, {league_id:'L3', name:'Queen City Kings', season:'2026', status:'in_season', total_rosters:2}]});
  app.setHub({L2:cres, L3:fres});
  const av=await app.tcLocalToolCall('available', {});
  chk(/AVAILABLE — week 1/.test(av) && av.indexOf('Free Wideout')<av.indexOf('Free Back') && /37% of team targets \(11 tgt/.test(av) && /available in: .*Eliminator.*\$147.*mkt/.test(av) && /Queen City Kings \$\d+/.test(av), 'available: free agents across both leagues by target share, with each league\'s bid');
  chk(!/Star Back/.test(av), 'a rostered player is not available anywhere');
  const avRb=await app.tcLocalToolCall('available', {pos:'RB', sort:'carries'});
  chk(/Free Back/.test(avRb) && !/Free Wideout/.test(avRb) && /14 car/.test(avRb), 'available narrows by position and sorts by carries');
  chk(/No synced league matching/.test(await app.tcLocalToolCall('available', {league:'nope'})), 'an unknown league name lists the real ones');
  const wu=await app.tcLocalToolCall('week_usage', {name:'free wideout'});
  chk(/Free Wideout \(WR NE\)/.test(wu) && /week 1: 37% of team targets \(11 tgt of 30, 8 rec, 122 yds, 1 TD\)/.test(wu), 'week_usage: one player week by week');
  const wl=await app.tcLocalToolCall('week_usage', {pos:'WR'});
  chk(/WR usage leaders, week 1/.test(wl) && /1\. Free Wideout/.test(wl), 'week_usage: a position\'s target-share leaders');
  const ml=await app.tcLocalToolCall('my_leagues', {});
  chk(/MY LEAGUES \(2\)/.test(ml) && /Eliminator.*Chopped.*FAAB \$900 left of \$1000 · 2 of 2 teams alive/.test(ml) && /Queen City Kings.*redraft.*FAAB \$70 left of \$100/.test(ml) && /top adds: Free Wideout \(WR\) \$/.test(ml), 'my_leagues: every synced league with FAAB, the field and the top adds');
  const lu=await app.tcLocalToolCall('lineup', {league:'kings'});
  chk(/Queen City Kings/.test(lu) && !/Eliminator/.test(lu) && /optimal lineup: QB The Passer/.test(lu) && /adds: Free Wideout \(WR\) for Backup Back \$10/.test(lu) && /FAAB \$70 of \$100/.test(lu), 'lineup: one league\'s optimal lineup, calls and adds');
  chk(/No league is synced/.test(await app.tcLocalToolCall('standings', {})), 'standings without an Analyzer snapshot says so');
  const ad=await app.tcLocalToolCall('app_data', {path:'inseason.player_weekly.cols'});
  chk(/"tgt","rec","rec_yd"/.test(ad), 'app_data reads a leaf table');
  const ad2=await app.tcLocalToolCall('app_data', {path:'leagues'});
  chk(/leagues: 2 keys/.test(ad2) && /L2/.test(ad2) && /L3/.test(ad2), 'app_data lists the keys of an object');
  const ad3=await app.tcLocalToolCall('app_data', {path:'leagues.L2.faab.wire', find:'spare passer'});
  chk(/1 item matching/.test(ad3) && /Spare Passer/.test(ad3), 'app_data filters an array by text');
  chk(/No "nothing" under "inseason"/.test(await app.tcLocalToolCall('app_data', {path:'inseason.nothing'})), 'a wrong path names the keys that exist');
  chk(/Roots: inseason, leagues/.test(await app.tcLocalToolCall('app_data', {})), 'no path lists the roots');
  const ctx=app.tcChatLeagueContext('of all my leagues, what players that are available in my leagues have the largest target share on their teams from week 1?');
  chk(/IN SEASON — NFL week 2, 1 week complete/.test(ctx) && /MY LEAGUES \(2\)/.test(ctx) && /AVAILABLE — week 1 usage, sorted by share/.test(ctx) && /Free Wideout/.test(ctx), 'the chat attaches the season, every league and the cross-league wire to a waiver question — no tools needed');
  const ctx2=app.tcChatLeagueContext('who is the best dynasty QB');
  chk(/IN SEASON/.test(ctx2) && /MY LEAGUES/.test(ctx2) && !/AVAILABLE —/.test(ctx2), 'a non-waiver question gets the season and the leagues, not the wire');
})();


console.log('=== the hub reads Sleeper\'s weekly line too; in season the redraft value is rest-of-season worth ===');
{
  const row=app.byId().get('10');
  const base={sc:ppr, wk:2, form, sched:app.ins().schedule, dvp, now:Date.now()};
  const plain=app.hubWeekProj(row, base);
  const withS=app.hubWeekProj(row, Object.assign({}, base, {weekProj:{'10':{stats:{rec:5, rec_yd:60}, opp:'MIA'}}, scRaw:{rec:1, rec_yd:0.1}}));
  chk(withS.slp===11 && Math.abs(withS.adj-(0.4*plain.adj+0.6*11))<1e-6 && withS.src==='blend', `Free Wideout: ours ${plain.adj.toFixed(1)} blended 40/60 with Sleeper's 11 under the league's raw table → ${withS.adj.toFixed(1)}`);
  const gated=app.hubWeekProj(row, Object.assign({}, base, {weekProj:{'10':{stats:{rec:0}}}, scRaw:{rec:1}}));
  chk(gated.adj===0 && gated.src==='sleeper-gate', 'Sleeper at zero → not playing, our number gives way');
  const dst=app.hubWeekProj({player_id:'NE', name:'New England Patriots D/ST', pos:'DEF', team:'NE', proj_games:17}, Object.assign({}, base, {weekProj:{NE:{stats:{sack:2, int:1}, opp:'MIA'}}, scRaw:{sack:1, int:2}}));
  chk(dst.adj===4 && dst.src==='sleeper' && dst.opp==='MIA', 'a defense takes Sleeper\'s line under the league table: 2 sacks + 1 INT = 4');
  const ros=app.laRosValueMap();
  chk(ros.size>=8 && [...ros.values()].every(v=>v>=0) && ros.get('star back|RB')>ros.get('backup back|RB') && ros.get('third back|RB')===0, 'rest-of-season values: non-negative, the star above his backup, the last back at replacement is 0');
  chk(app.rankDefaultSortKey()==='fpts', 'in season the rankings board opens sorted by FPTS');
}

Promise.all([_asyncTests, _asyncTools]).catch(e=>{ total++; console.log('  FAIL: async test threw', e && e.stack||e); }).then(()=>{
  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
});
