// ── The league's trade ledger ────────────────────────────────────────────────
// Every completed trade this league has made, newest first, under the Trade Center. The
// calculator above it says what a deal WOULD be worth; this says what the league has actually
// been willing to do — which is the only prior anyone in it trades against.
//
// Sleeper has no "all transactions" endpoint. The log is per week, so the ledger is one read
// of `/transactions/{leg}` per leg, filtered to trades. That is the same sweep hubFaabCurve
// already makes for the FAAB curve, and this file still keeps its own cache: the curve keeps
// only winning bids and chops and throws every trade away.
//
// A trade moves three kinds of asset and each arrives in its own shape:
//   adds          {player_id: roster_id}                       that roster RECEIVES the player
//   draft_picks   [{season, round, roster_id, owner_id, …}]    roster_id is WHOSE pick it
//                                                              originally is; owner_id gets it
//   waiver_budget [{sender, receiver, amount}]                 FAAB, in whole dollars
// `drops` on a trade is the exact mirror of `adds` and carries nothing new, so it is ignored —
// reading both would double every player in the ledger.

const LA_TX_URL    = (lid, leg)=>`https://api.sleeper.app/v1/league/${lid}/transactions/${leg}`;
const LA_TH_TTL    = 30*60*1000;   // half an hour — a trade you just accepted should show up
const LA_TH_TTL_OLD= 24*60*60*1000;// a finished season's ledger cannot change; re-read it daily
const LA_TH_HOPS   = 4;            // how far back "earlier seasons" walks the renewal chain
const LA_TH_PAGE   = 40;           // rows before the "show all" cut

var _laTh = {};   // leagueId → {rows, seasons, at, busy, err, more:{busy,done,err}, all}
var laThFilter = {q:'', pos:'ALL', picks:false, faab:false, mgr:'all', season:'all'};

function laThStore(leagueId){
  const k=String(leagueId||'');
  if(!_laTh[k]) _laTh[k]={rows:null, seasons:[], at:0, busy:false, err:null,
                          more:{busy:false, done:false, err:null}, all:false};
  return _laTh[k];
}
// A new league is a new ledger AND a new set of filters: "manager = roster 4" means someone
// else entirely over there, and a position chip left on QB would hide the new league's trades.
function laThReset(){ laThFilter={q:'', pos:'ALL', picks:false, faab:false, mgr:'all', season:'all'}; }

// ── Reading one transaction ──────────────────────────────────────────────────
// byRid maps a roster id to that SEASON's team, which is why earlier seasons are scanned with
// their own roster map: roster 4 is not the same manager two league ids ago.
function laThPlayer(pid){
  const id=String(pid);
  const sp=(typeof sleeperPlayers!=='undefined' && sleeperPlayers) ? (sleeperPlayers[id]||null) : null;
  if(sp && sp.name) return {id, name:sp.name, pos:sp.pos||'?', team:sp.team||'FA'};
  // Team defenses are not in the slim player DB and Sleeper uses the team code as their id.
  if(/^[A-Z]{2,4}$/.test(id))
    return {id, name:(typeof teamDisplayName==='function'?teamDisplayName(id):id)+' D/ST', pos:'DEF', team:id};
  return {id, name:id, pos:'?', team:'FA'};
}
function laThPickLabel(pk, byRid){
  const rd=+pk.round||0;
  const sfx=['','st','nd','rd','th'][rd]||'th';
  const orig=+pk.roster_id;
  // Whose pick it is matters as much as which round: a rebuilding team's 1st is not a
  // contender's. Name the original owner whenever it is not the team receiving it.
  const from=(byRid && byRid[orig] && orig!==+pk.owner_id) ? ` (${byRid[orig].teamName})` : '';
  return `${pk.season} ${rd}${sfx}${from}`;
}
function laThNormalize(t, season, byRid){
  if(!t || t.type!=='trade') return null;
  if(t.status && t.status!=='complete') return null;     // a proposed or vetoed deal never happened
  const order=[]; const side={};
  const get=(rid)=>{ const k=+rid; if(!side[k]){ side[k]={rid:k, players:[], picks:[], faab:0}; order.push(k); } return side[k]; };
  (t.roster_ids||[]).forEach(r=>{ if(+r>0) get(r); });
  const adds=t.adds||{};
  for(const pid in adds){ if(adds[pid]!=null) get(adds[pid]).players.push(laThPlayer(pid)); }
  (t.draft_picks||[]).forEach(pk=>{ if(pk && pk.owner_id!=null)
    get(pk.owner_id).picks.push({season:String(pk.season), round:+pk.round||0, orig:+pk.roster_id,
                                 label:laThPickLabel(pk, byRid)}); });
  (t.waiver_budget||[]).forEach(w=>{ if(w && w.receiver!=null) get(w.receiver).faab += (+w.amount||0); });
  const teams=order.map(rid=>{
    const x=side[rid], tm=(byRid&&byRid[rid])||null;
    x.players.sort((a,b)=>a.name.localeCompare(b.name));
    x.picks.sort((a,b)=> a.season===b.season ? a.round-b.round : a.season.localeCompare(b.season));
    return {rid, players:x.players, picks:x.picks, faab:x.faab,
            teamName:tm?tm.teamName:`Roster ${rid}`, owner:tm?tm.owner:'', ownerId:tm?(tm.ownerId||null):null};
  });
  // Nobody received anything: Sleeper files a reversed or emptied trade this way. It is not a
  // trade that happened, and it renders as two blank columns, so it does not belong in a ledger.
  if(!teams.some(x=>x.players.length||x.picks.length||x.faab>0)) return null;
  const players=teams.reduce((a,x)=>a.concat(x.players), []);
  const picks=teams.reduce((a,x)=>a.concat(x.picks), []);
  const week=+t.leg||0;
  return {
    id:String(t.transaction_id || `${season}|${week}|${order.join('-')}`),
    season:String(season), week, at:+t.created||0, teams,
    posSet:Array.from(new Set(players.map(p=>p.pos))),
    owners:teams.map(x=>x.ownerId).filter(Boolean),
    rids:teams.map(x=>x.rid),
    hasPicks:picks.length>0,
    faab:teams.reduce((a,x)=>a+x.faab, 0),
    // One lowercase haystack, built once, so typing in the box is a substring test per row and
    // not a walk of every asset on every keystroke.
    hay:[players.map(p=>p.name).join(' '), picks.map(p=>p.label).join(' '),
         teams.map(x=>`${x.teamName} ${x.owner}`).join(' ')].join(' ').toLowerCase(),
  };
}
// Newest first. Sleeper stamps `created` on every transaction; season+leg is the tiebreak for
// the rare row that arrives without one.
function laThSort(rows){
  return rows.sort((a,b)=> (b.at-a.at)
    || String(b.season).localeCompare(String(a.season))
    || (b.week-a.week));
}
function laThMerge(into, rows){
  const seen={}; into.forEach(r=>seen[r.id]=1);
  rows.forEach(r=>{ if(seen[r.id]) return; seen[r.id]=1; into.push(r); });
  return laThSort(into);
}

// ── Filtering ────────────────────────────────────────────────────────────────
// Managers are matched on OWNER id, not roster id: roster 4 is a different person in an
// earlier season's league, and the whole point of loading those seasons is to follow one
// manager through them.
function laThMatch(r, f){
  if(!r) return false;
  f=f||{};
  if(f.season && f.season!=='all' && r.season!==String(f.season)) return false;
  if(f.mgr && f.mgr!=='all' && (r.owners||[]).indexOf(String(f.mgr))<0) return false;
  if(f.pos && f.pos!=='ALL' && (r.posSet||[]).indexOf(f.pos)<0) return false;
  if(f.picks && !r.hasPicks) return false;
  if(f.faab && !(r.faab>0)) return false;
  const q=String(f.q||'').trim().toLowerCase();
  if(q && !q.split(/\s+/).every(w=>r.hay.indexOf(w)>=0)) return false;
  return true;
}
function laThFilterRows(rows, f){ return (rows||[]).filter(r=>laThMatch(r, f)); }
// Which position chips to offer: only the ones this league has actually traded, so a league
// that has never moved a kicker is not asked about kickers.
function laThPositions(rows){
  const seen={}; (rows||[]).forEach(r=>(r.posSet||[]).forEach(p=>{ if(p && p!=='?') seen[p]=1; }));
  return ['QB','RB','WR','TE','K','DEF'].filter(p=>seen[p]);
}

// ── Fetching ─────────────────────────────────────────────────────────────────
const LA_TH_CACHE = (lid)=>`tc_trades_${lid}`;
function laThRosterMap(rosters, users){
  const uById={}; (users||[]).forEach(u=>{ if(u&&u.user_id) uById[u.user_id]=u; });
  const by={};
  (rosters||[]).forEach(r=>{
    const u=uById[r.owner_id]||{};
    by[r.roster_id]={ rosterId:r.roster_id, ownerId:r.owner_id||null, owner:u.display_name||'(orphan)',
      teamName:(u.metadata&&u.metadata.team_name)||u.display_name||`Roster ${r.roster_id}` };
  });
  return by;
}
// How far up the log to read. A finished season is read whole; the season in progress stops a
// week past today, because the legs beyond it are empty and each one is still a request.
// A season that is over cannot gain a trade, so its sweep — eighteen requests — is worth
// keeping for the day rather than the half hour a live league needs.
function laThTtl(season){
  const now=(typeof TC_SEASON!=='undefined' && TC_SEASON) ? TC_SEASON : null;
  return (now && String(now.year)===String(season)) ? LA_TH_TTL : LA_TH_TTL_OLD;
}
function laThLastLeg(season){
  const now=(typeof TC_SEASON!=='undefined' && TC_SEASON) ? TC_SEASON : null;
  if(!now || String(now.year)!==String(season)) return HUB_LAST_WEEK;
  return Math.max(1, Math.min(HUB_LAST_WEEK, (+now.week||0)+1));
}
async function laThScan(leagueId, season, byRid, lastLeg){
  const legs=[]; for(let w=1; w<=lastLeg; w++) legs.push(w);
  // One leg failing is a gap, not a failure — the other seventeen still make a ledger. Every
  // leg failing is Sleeper being unreachable, and an empty ledger would then be a lie: this
  // league would read "no trades" when the truth is that nobody asked it.
  let err=null;
  const logs=await Promise.all(legs.map(w=>sleeperFetch(LA_TX_URL(leagueId, w)).catch(e=>{ err=err||e; return null; })));
  if(logs.every(x=>x===null)) throw (err || new Error('could not reach the transaction log'));
  const rows=[];
  logs.forEach(list=>(list||[]).forEach(t=>{ const r=laThNormalize(t, season, byRid); if(r) rows.push(r); }));
  return rows;
}
function laThSave(leagueId, store){
  try{ localStorage.setItem(LA_TH_CACHE(leagueId), JSON.stringify(
    {v:1, at:store.at, seasons:store.seasons, done:store.more.done, rows:store.rows})); }catch(e){}
}
// The cache is what makes the ledger appear instantly on the second visit, and it also carries
// the resolved names — so the rows render before the Sleeper player DB has landed.
function laThRestore(leagueId){
  const store=laThStore(leagueId);
  if(store.rows) return store;
  try{
    const raw=localStorage.getItem(LA_TH_CACHE(leagueId)); if(!raw) return store;
    const c=JSON.parse(raw);
    if(c && c.v===1 && Array.isArray(c.rows)){
      store.rows=c.rows; store.at=+c.at||0; store.seasons=c.seasons||[]; store.more.done=!!c.done;
    }
  }catch(e){}
  return store;
}
async function laThLoad(s, force){
  if(!s || s.provider!=='sleeper' || !s.leagueId) return;
  const store=laThRestore(s.leagueId);
  if(store.busy) return;
  // The TTL gates the read, not the presence of rows: a league whose log cannot be reached
  // has no rows either, and gating on those would re-fire the whole sweep on every render.
  if(!force && (Date.now()-store.at)<laThTtl(s.season)) return;
  store.busy=true; store.err=null;
  try{
    const byRid={}; (s.teamList||[]).forEach(t=>byRid[t.rosterId]=t);
    const rows=await laThScan(s.leagueId, s.season, byRid, laThLastLeg(s.season));
    // A refresh replaces THIS season's rows and keeps whatever earlier seasons were loaded,
    // so pressing refresh does not silently throw away the chain you waited for.
    const kept=(store.rows||[]).filter(r=>r.season!==String(s.season));
    store.rows=laThMerge(kept, rows);
    store.seasons=Array.from(new Set(store.rows.map(r=>r.season))).sort().reverse();
    store.at=Date.now();
    laThSave(s.leagueId, store);
  }catch(e){
    store.err=(e&&e.message)||'could not read the league transaction log';
    store.at=Date.now();   // back the retry off by the TTL rather than re-sweeping every render
  }
  finally{ store.busy=false; if(typeof renderLeagueAnalyzer==='function') renderLeagueAnalyzer(); }
}
// The earlier seasons of a renewed league. Opt-in because it costs a full log sweep per season
// plus that season's rosters and users — the default load is one season for a reason.
async function laThLoadEarlier(){
  const s=(typeof leagueSnapshot!=='undefined') ? leagueSnapshot : null;
  if(!s || s.provider!=='sleeper') return;
  const store=laThStore(s.leagueId);
  if(store.more.busy || store.more.done) return;
  store.more.busy=true; store.more.err=null;
  if(typeof renderLeagueAnalyzer==='function') renderLeagueAnalyzer();
  try{
    let lg=await sleeperFetch(LA_LEAGUE_URL(s.leagueId));
    const seen={}; seen[String(s.leagueId)]=1;
    let hops=0;
    while(lg && lg.previous_league_id && !seen[String(lg.previous_league_id)] && hops<LA_TH_HOPS){
      const pid=String(lg.previous_league_id); seen[pid]=1; hops++;
      lg=await sleeperFetch(LA_LEAGUE_URL(pid));
      if(!lg) break;
      const [rosters, users]=await Promise.all([
        sleeperFetch(LA_ROSTERS_URL(pid)).catch(()=>[]),
        sleeperFetch(SLEEPER_LG_USERS_URL(pid)).catch(()=>[]),
      ]);
      const rows=await laThScan(pid, lg.season, laThRosterMap(rosters, users), HUB_LAST_WEEK);
      store.rows=laThMerge(store.rows||[], rows);
      store.seasons=Array.from(new Set(store.rows.map(r=>r.season))).sort().reverse();
    }
    store.more.done=true;
    laThSave(s.leagueId, store);
  }catch(e){ store.more.err=(e&&e.message)||'could not follow this league back'; }
  finally{ store.more.busy=false; if(typeof renderLeagueAnalyzer==='function') renderLeagueAnalyzer(); }
}

// ── Filter setters ───────────────────────────────────────────────────────────
// The whole analyzer re-renders on a filter change, which takes the caret out of the search
// box with it. Same restore the rankings search uses: put the focus and the selection back on
// the next frame.
function laThSetQuery(v, selStart, selEnd){
  laThFilter.q=String(v||'');
  const keep=(typeof document!=='undefined' && document.activeElement && document.activeElement.id==='la-th-q');
  if(typeof renderLeagueAnalyzer==='function') renderLeagueAnalyzer();
  if(!keep) return;
  requestAnimationFrame(()=>{
    const el=document.getElementById('la-th-q');
    if(!el || typeof el.focus!=='function') return;
    el.focus();
    if(typeof el.setSelectionRange!=='function') return;
    const max=String(el.value||'').length;
    const a=selStart==null?max:Math.min(selStart,max), b=selEnd==null?a:Math.min(selEnd,max);
    try{ el.setSelectionRange(a,b); }catch(e){}
  });
}
function laThSet(key, val){
  if(key==='picks'||key==='faab') laThFilter[key]=!laThFilter[key];
  else laThFilter[key]=val;
  laThStore((typeof leagueSnapshot!=='undefined'&&leagueSnapshot)?leagueSnapshot.leagueId:'').all=false;
  if(typeof renderLeagueAnalyzer==='function') renderLeagueAnalyzer();
}
function laThClear(){ laThReset(); if(typeof renderLeagueAnalyzer==='function') renderLeagueAnalyzer(); }
function laThShowAll(){
  const s=(typeof leagueSnapshot!=='undefined')?leagueSnapshot:null;
  if(s) laThStore(s.leagueId).all=true;
  if(typeof renderLeagueAnalyzer==='function') renderLeagueAnalyzer();
}
function laThRefresh(){
  const s=(typeof leagueSnapshot!=='undefined')?leagueSnapshot:null;
  if(s) laThLoad(s, true);
}

// ── Rendering ────────────────────────────────────────────────────────────────
function laThWhen(r){
  if(!r.at) return r.week?`Week ${r.week}`:'';
  const d=new Date(r.at);
  let day=''; try{ day=d.toLocaleDateString(undefined,{month:'short', day:'numeric'}); }catch(e){ day=String(r.at); }
  return `${day} ${r.season}`;
}
function laThAssetsHTML(x){
  const out=[];
  x.players.forEach(p=>{
    out.push(`<span class="la-th-a la-th-a-p clickable-player" onclick="${pcardOnclick(p.id||p.name, p.pos, p.team||'')}" title="${escAttr(p.name)}">
      <span class="rt-slot ${slotClass(p.pos)}">${escHtml(p.pos)}</span>${escHtml(p.name)}</span>`);
  });
  x.picks.forEach(p=>out.push(`<span class="la-th-a la-th-a-k">${escHtml(p.label)}</span>`));
  if(x.faab>0) out.push(`<span class="la-th-a la-th-a-f">$${x.faab} FAAB</span>`);
  return out.length ? out.join('') : '<span class="la-th-a la-th-a-none">nothing</span>';
}
function laThRowHTML(r, s){
  const mine=s&&s.myUserId;
  return `<div class="la-th-row">
    <div class="la-th-when"><b>${r.week?`Wk ${r.week}`:'Off'}</b><span>${escHtml(laThWhen(r))}</span></div>
    <div class="la-th-sides">${r.teams.map(x=>`
      <div class="la-th-side${mine&&x.ownerId===mine?' me':''}">
        <span class="la-th-team" title="${escAttr(x.owner?`@${x.owner}`:'')}">${escHtml(x.teamName)}</span>
        <span class="la-th-got">${laThAssetsHTML(x)}</span>
      </div>`).join('')}</div>
  </div>`;
}
function laTradeHistoryHTML(s){
  // The ledger is Sleeper's transaction log. ESPN snapshots come through a different adapter
  // that has no equivalent, so the section stays off rather than showing an empty shell.
  if(!s || s.provider!=='sleeper') return '';
  const store=laThRestore(s.leagueId);
  laThLoad(s);           // a no-op until the cached sweep is older than this season's TTL
  const head=(body, sub)=>`<div class="la-th">
    <div class="la-th-title">${TC_ICON("swap")} Trade history
      <span class="la-th-sub">${sub||''}</span>
      <button class="btn btn-sm btn-ghost la-th-refresh" onclick="laThRefresh()" title="Re-read the league's transaction log"${store.busy?' disabled':''}>${TC_ICON("refresh")} refresh</button>
    </div>${body}</div>`;
  if(store.busy && !store.rows) return head(`<div class="la-note">Reading the league's transaction log…</div>`, '');
  if(store.err && !store.rows) return head(`<div class="la-note">Could not read the transaction log — ${escHtml(store.err)}.</div>`, '');
  const rows=store.rows||[];
  if(!rows.length) return head(`<div class="la-note">No completed trades in ${escHtml(String(s.season))}${store.more.done?' or the seasons before it':''}.</div>`,
    store.more.done?'':`<button class="la-th-more" onclick="laThLoadEarlier()"${store.more.busy?' disabled':''}>${store.more.busy?'loading earlier seasons…':'+ earlier seasons'}</button>`);

  const f=laThFilter;
  const shown=laThFilterRows(rows, f);
  const positions=laThPositions(rows);
  const seasons=store.seasons&&store.seasons.length?store.seasons:[String(s.season)];
  // Only the managers who have actually traded get an option — a select listing all twelve
  // when four have ever made a deal is eight dead ends.
  const traded={}; rows.forEach(r=>(r.owners||[]).forEach(o=>traded[o]=1));
  const mgrs=(s.teamList||[]).filter(t=>t.ownerId && traded[t.ownerId]);
  const chip=(on, label, onclick, title)=>`<button class="format-btn ${on?'active':''}" onclick="${onclick}"${title?` title="${escAttr(title)}"`:''}>${escHtml(label)}</button>`;
  const active=(f.q||f.pos!=='ALL'||f.picks||f.faab||f.mgr!=='all'||f.season!=='all');
  const filters=`<div class="la-th-filters">
    <input id="la-th-q" class="la-th-q" type="text" value="${escAttr(f.q)}" placeholder="player, pick or manager…"
      aria-label="Filter trades" oninput="laThSetQuery(this.value, this.selectionStart, this.selectionEnd)">
    <span class="la-th-chips">${chip(f.pos==='ALL','ALL',`laThSet('pos','ALL')`,'Any position')}${positions.map(p=>chip(f.pos===p,p,`laThSet('pos','${p}')`,`Trades that moved a ${p}`)).join('')}</span>
    <span class="la-th-chips">${chip(f.picks,'picks',`laThSet('picks')`,'Only trades that included a draft pick')}${chip(f.faab,'FAAB',`laThSet('faab')`,'Only trades that included waiver money')}</span>
    <select class="la-tc-sel la-th-sel" onchange="laThSet('mgr',this.value)" aria-label="Filter by manager">
      <option value="all"${f.mgr==='all'?' selected':''}>all managers</option>
      ${mgrs.map(t=>`<option value="${escAttr(t.ownerId)}"${f.mgr===String(t.ownerId)?' selected':''}>${s.myUserId&&t.ownerId===s.myUserId?'★ ':''}${escHtml(t.teamName)}</option>`).join('')}
    </select>
    ${seasons.length>1?`<select class="la-tc-sel la-th-sel" onchange="laThSet('season',this.value)" aria-label="Filter by season">
      <option value="all"${f.season==='all'?' selected':''}>all seasons</option>
      ${seasons.map(y=>`<option value="${escAttr(y)}"${f.season===y?' selected':''}>${escHtml(y)}</option>`).join('')}
    </select>`:''}
    ${active?`<button class="btn btn-sm btn-ghost la-th-clr" onclick="laThClear()">clear</button>`:''}
  </div>`;

  const all=store.all;
  const list=all?shown:shown.slice(0, LA_TH_PAGE);
  const body=shown.length
    ? list.map(r=>laThRowHTML(r, s)).join('') +
      (shown.length>list.length?`<button class="la-th-more" onclick="laThShowAll()">show all ${shown.length}</button>`:'')
    : `<div class="la-note">No trade matches those filters.</div>`;
  const sub=`${shown.length===rows.length?rows.length:`${shown.length} of ${rows.length}`} trade${rows.length===1?'':'s'} · ${seasons.length>1?`${seasons[seasons.length-1]}–${seasons[0]}`:seasons[0]}`
    + (store.more.done?'' : ` <button class="la-th-more la-th-more-inline" onclick="laThLoadEarlier()"${store.more.busy?' disabled':''}>${store.more.busy?'loading earlier seasons…':'+ earlier seasons'}</button>`)
    + (store.more.err?` <span class="la-th-err">${escHtml(store.more.err)}</span>`:'');
  return head(filters+`<div class="la-th-list">${body}</div>`, sub);
}
