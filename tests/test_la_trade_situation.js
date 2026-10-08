// Trade situations: every roster gets a mode (contend / retool / rebuild) from the persona and
// the standings; assets are priced as that team would price them; a deal is judged from BOTH
// chairs; the finder leads with deals both sides should want and shapes SELL HIGH / WIN NOW
// lanes from the situations themselves; the ledger says who actually deals.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[],querySelector:()=>null,getBoundingClientRect:()=>({top:0}),scrollIntoView(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));global.AbortController=class{constructor(){this.signal={};}abort(){}};
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
// A 1QB dynasty league of four. Values are chart points; ages come from ECR; nobody has
// projections (so the persona ladder ranks on dynasty capital alone — the clearest test).
const P=(n,pos,v,age,tier)=>[n,{n,pos,v,age,tier:tier||4}];
const ROSTER={
  // me: old and thin at the bottom → Hard Rebuild
  1:[P('Old Vet WR','WR',70,31),P('Aging Back','RB',30,28),P('Grey QB','QB',35,34),P('Fill TE','TE',10,27)],
  // the contender: young stars, deep
  2:[P('Young Star WR','WR',95,24),P('Prime RB','RB',80,25),P('Star QB','QB',70,27),P('Prime TE','TE',60,26),P('Mid WR','WR',45,26),P('Prime WR2','WR',55,27)],
  // ascending: young, mid value
  3:[P('Kid WR','WR',50,22),P('Kid RB','RB',45,23),P('Kid QB','QB',40,23),P('Kid TE','TE',30,22),P('Kid Scrub','WR',8,22)],
  // aging but capital-rich → 1-Yr Reload
  4:[P('Vet WR Two','WR',60,30),P('Vet RB Two','RB',50,29),P('Vet QB Two','QB',55,33),P('Vet TE Two','TE',40,31),P('Vet WR Three','WR',25,28),P('Vet WR Four','WR',20,29),P('Vet WR Five','WR',18,27)],
};
const app=new Function('ROSTER', code+`
  toast=function(){}; renderLeagueAnalyzer=function(){};
  buildProjectionList=()=>[];
  const DV={}, ECRIN={};
  Object.values(ROSTER).forEach(list=>list.forEach(([n,e])=>{ const k=ecrNormName(n); DV[k]={n:e.n,pos:e.pos,v:e.v}; ECRIN[k]={age:e.age,tier:e.tier}; }));
  DYNASTY_VALUES={asof:'2026-09', players:DV, picks:{'2027':[['1.01',60,70],['1.06',45,52],['1.12',32,36],['2nd',14,16],['3rd',6,7]], '2028':[['1st',40,46],['2nd',12,14],['3rd',5,6]]}};
  ECR={dynasty:ECRIN};
  TRADE_VALUES={markets:{}};
  hasSeasonStarted=()=>true;
  return { situations:laTeamSituations, situ:laTeamSituation, mult:laSituMult, fit:laSituFit, fitFor:laSituFitFor, props:laSituProposals, finder:laTradeFinder, view:laTradeView,
    pools:laAssetPools, tend:laPartnerTendency, card:laSituCardHTML, fitHTML:laSituFitHTML, reset:laSituReset, laState,
    setSnap:(o)=>{ leagueSnapshot=o; laSituReset(); _laTierVals=null; _laPosRankCache=null; }, setTh:(lid,rows)=>{ _laTh[String(lid)]={rows, seasons:['2026'], at:Date.now(), busy:false, err:null, more:{busy:false,done:true,err:null}, all:false}; } };`)(ROSTER);
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const team=(rid,owner,rec,players,picks)=>({rosterId:rid, ownerId:'u'+rid, owner, teamName:owner, wins:rec[0], losses:rec[1], ties:0, fpts:1000-rid*50,
  players:players.map(([n,e],i)=>({id:`${rid}-${i}`, name:n, pos:e.pos, team:'FA'})), picks:picks||[]});
const pk=(season,round,orig)=>({season:String(season), round, origRosterId:orig});
const snap=(opts)=>Object.assign({provider:'sleeper', leagueId:'L1', season:'2026', takenAt:1, leagueType:2, superflex:false, tep:false, myUserId:'u1', rosterPositions:['QB','RB','RB','WR','WR','TE','FLEX','BN','BN','BN'],
  teamList:[ team(1,'Me',[1,4],ROSTER[1],[pk(2027,2,1)]), team(2,'Champ',[4,1],ROSTER[2],[pk(2027,1,2),pk(2028,1,2),pk(2027,2,2)]),
             team(3,'Kids',[2,3],ROSTER[3],[pk(2027,1,3),pk(2028,1,3)]), team(4,'Vets',[3,2],ROSTER[4],[pk(2027,1,4)]) ]}, opts||{});

console.log('=== every roster gets a mode from the persona and the standings ===');
const s=snap(); app.setSnap(s);
const S=app.situations(s);
chk(S[1] && S[1].mode==='rebuild', `old, thin, last on capital → Rebuilding (${S[1]&&S[1].title})`);
chk(S[2] && S[2].mode==='contend', `young stars at the top → Contending (${S[2]&&S[2].title})`);
chk(S[3] && S[3].mode==='retool', `young and mid → Retooling (${S[3]&&S[3].title})`);
chk(S[1].wants==='youth and draft picks' && S[2].wants==='proven starters now', 'each mode says what it wants');
chk(S[1].reasons.some(r=>/1-4/.test(r)) && S[1].reasons.some(r=>/core age/.test(r)), `the read shows its facts (${S[1].reasons.join(' · ')})`);
// the standings override: a persona contender buried in the standings is retooling
const buried=snap(); buried.teamList[1].wins=0; buried.teamList[1].losses=6; buried.teamList[0].wins=5; buried.teamList[0].losses=1; buried.takenAt=2;
app.setSnap(buried);
chk(app.situ(buried,2).mode==='retool', 'a capital contender at 0-6 after six games is Retooling, not Contending');
app.setSnap(s);

console.log('=== an asset is worth what the chair says ===');
const me=S[1], champ=S[2];
const pick27=app.pools(s,2).picks.find(x=>x.season==='2027'&&x.round===1);
chk(app.mult(pick27, me).m>1.2 && app.mult(pick27, champ).m<0.9, `a 2027 1st: ×${app.mult(pick27,me).m} to the rebuild, ×${app.mult(pick27,champ).m} to the contender`);
const oldWr=app.pools(s,1).players.find(x=>x.name==='Old Vet WR');
chk(app.mult(oldWr, me).m<=0.6 && /past the WR age cliff/.test(app.mult(oldWr, me).why), `a 31-year-old WR is ×${app.mult(oldWr,me).m} to a rebuild, and it says why`);
chk(app.mult(oldWr, champ).m>1, `the contender minds the production, not the age (×${app.mult(oldWr,champ).m})`);
const kid=app.pools(s,3).players.find(x=>x.name==='Kid WR'), scrub=app.pools(s,3).players.find(x=>x.name==='Kid Scrub');
chk(app.mult(kid, me).m>1.1 && app.mult(scrub, champ).m<1, `a 22-year-old: ×${app.mult(kid,me).m} to the rebuild; one a contender cannot start is ×${app.mult(scrub,champ).m} to it`);
chk(app.mult(oldWr, Object.assign({}, me, {redraft:true})).m===1, 'redraft: no situational tilt at all');

console.log('=== the same deal from both chairs ===');
const primeRb=app.pools(s,2).players.find(x=>x.name==='Prime RB');
const f=app.fitFor(s, 1, 2, [oldWr], [pick27, app.pools(s,2).picks.find(x=>x.season==='2027'&&x.round===2)]);
chk(f.mine.ok && f.mine.gain>0, `the rebuild sends the old WR for picks and comes out ahead in its chair (+${f.mine.gain})`);
chk(f.theirs.ok, `the contender gets a starter for picks it discounts and is ahead too (+${f.theirs.gain})`);
chk(f.mutual===true && (f.likely==='plausible'||f.likely==='likely'), `works in both chairs → ${f.likely}`);
const bad=app.fitFor(s, 1, 2, [pick27 && app.pools(s,1).picks[0]], [primeRb]);
chk(bad.mine.ok===true, 'the rebuild would take a prime RB for its 2nd...');
const wrong=app.fitFor(s, 2, 1, [primeRb], [oldWr]);
chk(wrong.theirs.ok===false || wrong.mine.ok===false, 'but a contender sending its prime RB for an old WR is not a deal both want');

console.log('=== the finder leads with deals both sides should want, and shapes SELL HIGH for a rebuild ===');
app.laState.fndSeed=0; app.laState.fndPos='AUTO'; app.laState.fndShape='ANY';
const props=app.props(s, 1);
chk(props.length>0 && props.every(p=>p.lane==='sell' && p.fit && p.fit.mutual), `${props.length} SELL HIGH deals, every one ahead in both chairs`);
chk(props.every(p=>p.give.every(g=>g.type==='p' && app.mult(g, me).m<1)), 'a rebuild sells only what its timeline discounts');
chk(props.every(p=>p.get.every(g=>g.type==='k' || app.mult(g, me).m>1)), 'and takes back only picks and youth');
chk(!props.some(p=>p.b.rosterId===1) && !props.some(p=>S[p.b.rosterId].mode==='rebuild'), 'never with itself, never with another rebuild');
const fnd=app.finder(s);
chk(fnd.mySit && fnd.mySit.mode==='rebuild' && fnd.situCount>0, 'the board knows my situation and how many situation deals there are');
chk(fnd.proposals.length>0 && fnd.proposals[0].lane==='sell' && fnd.proposals[0].mutual, 'the first card on the board is a SELL HIGH deal that works in both chairs');
chk(fnd.proposals.every(p=>p.fit && typeof p.mutual==='boolean' && p.likely), 'every proposal carries both chairs and a likelihood');
// a contender's board leads with WIN NOW
const asChamp=snap({myUserId:'u2', takenAt:3}); app.setSnap(asChamp);
const champProps=app.props(asChamp, 2);
chk(champProps.length>0 && champProps.every(p=>p.lane==='now'), `${champProps.length} WIN NOW deals for the contender`);
chk(champProps.every(p=>p.get.every(g=>g.type==='p') && p.give.some(g=>g.type==='k' || app.mult(g, app.situ(asChamp,2)).m<1)), 'it buys starters with picks and prospects');
chk(!champProps.some(p=>app.situ(asChamp,p.b.rosterId).mode==='contend'), 'from teams that are not contending');
app.setSnap(s);

console.log('=== the ledger says who deals ===');
chk(app.tend(s,2)===null, 'no ledger loaded → no tendency, no claim');
app.setTh('L1', [
  {id:'t1', season:'2026', at:3, teams:[{rid:2, picks:[{season:'2027',round:1}], players:[]},{rid:4, picks:[], players:[{name:'X'}]}]},
  {id:'t2', season:'2026', at:2, teams:[{rid:2, picks:[], players:[{name:'Y'}]},{rid:3, picks:[{season:'2028',round:2}], players:[]}]},
  {id:'t3', season:'2026', at:1, teams:[{rid:2, picks:[], players:[{name:'Z'}]},{rid:3, picks:[], players:[{name:'W'}]}]},
  {id:'t0', season:'2025', at:0, teams:[{rid:2, picks:[], players:[]},{rid:3, picks:[], players:[{name:'V'}]}]},
]);
const t2=app.tend(s,2);
chk(t2 && t2.n===3 && t2.active && /3 trades this season/.test(t2.label), `Champ has dealt three times this season (${t2&&t2.label})`);
chk(app.tend(s,1).quiet && /no trades/.test(app.tend(s,1).label), 'Me has not dealt at all');
app.reset();
const f2=app.fitFor(s, 1, 2, [oldWr], [pick27, app.pools(s,2).picks.find(x=>x.season==='2027'&&x.round===2)]);
chk(f2.likely==='likely' && f2.tend && f2.tend.active, 'a deal both chairs want with an active partner is "likely"');

console.log('=== the page shows it ===');
const html=app.view(s);
chk(/class="la-trade"/.test(html) && (html.match(/la-situ-card/g)||[]).length>=2, 'the Trade Center wraps itself and shows a situation card on each side');
chk(/la-situ la-situ-rebuild[^>]*>Rebuilding</.test(html) && /wants <b>youth and draft picks<\/b>/.test(html), 'my card reads Rebuilding and says what I want');
chk(/la-fnd-cards/.test(html) && /la-fc la-fc-sell/.test(html) && /la-fnd-lane la-lane-sell[^>]*>SELL HIGH</.test(html), 'the suggestions are cards, the first lane SELL HIGH');
chk(/la-fc-fit ok[^>]*>you \+\d+%/.test(html) && /la-fc-fit ok[^>]*>them \+\d+%/.test(html), 'each card shows both chairs');
chk(/You are <span class="la-situ la-situ-rebuild/.test(html), 'the board header says what I am');
app.laState.trade={a:1,b:2,giveA:[oldWr.key],giveB:[pick27.key],faabA:0,faabB:0};
const html2=app.view(s);
chk(/la-fit-lbl">Works in both chairs</.test(html2) && (html2.match(/la-fit-line ok/g)||[]).length===2, 'a loaded deal is judged from both chairs under the verdict');
console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
