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
  ];
  buildPlayerList=function(){ return ROWS.map(r=>Object.assign({},r)); };
  if(typeof HISTORY==='undefined' || !HISTORY) HISTORY={}; Object.assign(HISTORY, { '1':{'2025':[{team:'NE',pos:'RB',games_played:16,stats:{rushing_attempts:240,rushing_yards:1050,rushing_tds:8,receptions:38,receiving_yards:280}}]},
            '9':{'2025':[{team:'SEA',pos:'RB',games_played:15,stats:{rushing_attempts:150,rushing_yards:700,rushing_tds:5,receptions:30,receiving_yards:250}}]},
            '10':{'2025':[{team:'NE',pos:'WR',games_played:17,stats:{receptions:80,receiving_yards:1100,receiving_tds:7}}]} });
  return { hubScoringFor, calcFptsUnder, hubWeekProj, hubFormMap, hubFill, hubCallouts, hubWaiverReasons, hubFaabAdvice, hubFaabCurveFromHistory, hubFaabFallbackCurve, hubAnalyzeLeague, hubKickoff,
           laDvpTable, laCurrentWeek, byId:()=>{ const m=new Map(); buildPlayerList().forEach(p=>m.set(String(p.player_id),p)); return m; },
           gs:()=>scoringSettings, HUB_CLOSE, ins:()=>TC_INSEASON, sp:()=>sleeperPlayers };
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
chk(res.adds.some(a=>a.id==='10') && res.adds.some(a=>a.id==='9'), 'the two free agents are the adds');
const fw=res.adds.find(a=>a.id==='10');
chk(fw && fw.faab && fw.faab.bid>0 && fw.faab.left===88, 'FAAB advice reads the league budget and what I have spent ($88 left)');
chk(res.drops.length>0 && res.drops[0].p.id==='2' || res.drops.some(d=>d.p.id==='2'), 'the backup back is a drop candidate once he leaves the lineup');
chk(res.lineup.optTotal>res.lineup.curTotal, 'optimal beats the set lineup');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
