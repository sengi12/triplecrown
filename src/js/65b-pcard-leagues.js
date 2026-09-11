// ── In your leagues: where this player stands across every synced Sleeper league ──
// The analyzer's saved profile lists every league on the account; each league's
// rosters are three small reads, fetched once per session on first open and kept
// for ten minutes. One row per league — avatar, name, format — and a status:
// ★ MINE, the owner's team, or AVAILABLE. Tapping a row opens the league on Sleeper.
let _pcardLg={ at:0, byLeague:{}, loading:null };
let _pcardLgOpen=false;
const PCARD_LG_TTL=10*60*1000;
function pcardLeaguesList(){
  const p=(typeof laLoadSleeperProfile==='function')?laLoadSleeperProfile():null;
  return (p && Array.isArray(p.leagues)) ? {prof:p, list:p.leagues.filter(l=>!l.stale)} : {prof:null, list:[]};
}
function pcardLeaguesAvailable(){ return pcardLeaguesList().list.length>0; }
function pcardLeagueSub(L){
  const rp=L.roster_positions||[];
  const sf=(typeof leagueIsSuperflex==='function')?leagueIsSuperflex(rp):rp.includes('SUPER_FLEX');
  const rec=+((L.scoring_settings||{}).rec||0);
  const fmt= rec>=1?'PPR':rec>=0.25?'Half PPR':'Standard';
  const type=+((L.settings||{}).type)||0;
  return `${L.total_rosters||'?'}-team ${type===2?'Dynasty ':type===1?'Keeper ':''}${sf?'SF ':''}${fmt}`;
}
async function pcardLeaguesLoad(force){
  if(!force && _pcardLg.at && Date.now()-_pcardLg.at<PCARD_LG_TTL) return _pcardLg;
  if(_pcardLg.loading) return _pcardLg.loading;
  const {prof, list}=pcardLeaguesList();
  const myId=prof && prof.user ? prof.user.user_id : null;
  _pcardLg.loading=(async()=>{
    await Promise.all(list.map(async lg=>{
      try{
        const [L, rosters, users]=await Promise.all([
          sleeperFetch(LA_LEAGUE_URL(lg.league_id)),
          sleeperFetch(LA_ROSTERS_URL(lg.league_id)),
          sleeperFetch(SLEEPER_LG_USERS_URL(lg.league_id)).catch(()=>[]),
        ]);
        const uById={}; (users||[]).forEach(u=>uById[u.user_id]=u);
        const byPid={};
        (rosters||[]).forEach(r=>{
          const u=uById[r.owner_id]||{};
          const mine=!!myId && (r.owner_id===myId || (Array.isArray(r.co_owners)&&r.co_owners.includes(myId)));
          const owner=(u.metadata&&u.metadata.team_name)||u.display_name||`Roster ${r.roster_id}`;
          (r.players||[]).forEach(p=>{ byPid[String(p)]={owner, mine}; });
        });
        _pcardLg.byLeague[lg.league_id]={id:String(lg.league_id), name:L.name||lg.name||'League',
          avatar:(L.avatar && typeof SLEEPER_AVATAR_THUMB==='function')?SLEEPER_AVATAR_THUMB(L.avatar):null,
          sub:pcardLeagueSub(L), byPid};
      }catch(e){
        _pcardLg.byLeague[lg.league_id]={id:String(lg.league_id), name:lg.name||'League', error:true, byPid:{}};
      }
    }));
    _pcardLg.at=Date.now(); _pcardLg.loading=null;
    return _pcardLg;
  })();
  return _pcardLg.loading;
}
function pcardLeaguesRows(pid){
  if(!_pcardLg.at) return '<div class="pcard-lg-row pcard-lg-muted">Loading your leagues…</div>';
  const {list}=pcardLeaguesList();
  return list.map(lg=>{
    const L=_pcardLg.byLeague[lg.league_id]; if(!L) return '';
    const st=L.byPid[String(pid)];
    const status= L.error ? '<span class="pcard-lg-st pcard-lg-err">unavailable</span>'
      : !st ? '<span class="pcard-lg-st pcard-lg-free">AVAILABLE</span>'
      : st.mine ? '<span class="pcard-lg-st pcard-lg-mine">★ MINE</span>'
      : `<span class="pcard-lg-st pcard-lg-owned" title="On ${escAttr(st.owner)}">${escHtml(st.owner)}</span>`;
    return `<a class="pcard-lg-row ${st?(st.mine?'is-mine':'is-owned'):'is-free'}" href="https://sleeper.com/leagues/${escAttr(L.id)}/players" target="_blank" rel="noopener">
      ${L.avatar?`<img class="pcard-lg-av" src="${escAttr(L.avatar)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`:'<span class="pcard-lg-av"></span>'}
      <span class="pcard-lg-main"><b>${escHtml(L.name)}</b><small>${escHtml(L.sub||'')}</small></span>${status}</a>`;
  }).join('');
}
// The pill: one small control in the hero's bottom row. Before the leagues have
// loaded this session it reads "Leagues"; after, "4 of 9 avail" — the answer at a
// glance, the rows one tap away in a popover that overlays the card (nothing in the
// card's flow moves).
function pcardLeaguesSummary(pid){
  if(!_pcardLg.at) return null;
  const {list}=pcardLeaguesList();
  let n=0, avail=0, mine=0;
  list.forEach(lg=>{ const L=_pcardLg.byLeague[lg.league_id]; if(!L || L.error) return; n++; const st=L.byPid[String(pid)]; if(!st) avail++; else if(st.mine) mine++; });
  return {n, avail, mine};
}
// The pill is the stadium icon and, once the leagues are known, "1 of 4" — leagues
// where he is available, of the leagues you are in. Nothing more; the popover explains.
function pcardLeaguesPillText(pid){
  const s=pcardLeaguesSummary(pid);
  if(!s || !s.n) return '';
  return `${s.avail} of ${s.n}`;
}
function pcardLeaguesBarHTML(pid){
  if(!pcardLeaguesAvailable()) return '';
  return `<button class="pcard-lg-pill" id="pcardLgPill" onclick="pcardLeaguesToggle('${escAttr(String(pid))}',event)" title="Leagues where he is available, of the leagues you are in — tap for each league">${(typeof TC_ICON==='function')?TC_ICON('stadium'):''}<span id="pcardLgPillTxt">${escHtml(pcardLeaguesPillText(pid))}</span><span class="pcard-lg-caret">▾</span></button>`;
}
function _pcardLgRefresh(pid){
  if(!pcardState || String(pcardState.pid)!==String(pid)) return;
  const t=document.getElementById('pcardLgPillTxt'); if(t) t.textContent=pcardLeaguesPillText(pid);
  const b=document.getElementById('pcardLgBody'); if(b) b.innerHTML=pcardLeaguesRows(pid);
}
function pcardLeaguesToggle(pid, ev){
  if(ev && ev.stopPropagation) ev.stopPropagation();
  const card=document.querySelector('#pcardOverlay .pcard'); if(!card) return;
  let pop=card.querySelector('.pcard-lg-pop');
  if(pop){ pop.remove(); _pcardLgOpen=false; return; }
  _pcardLgOpen=true;
  pop=document.createElement('div'); pop.className='pcard-lg-pop';
  pop.innerHTML=`<div class="pcard-lg-head"><b>In your leagues</b><button class="pcard-add-x" onclick="pcardLeaguesToggle('${escAttr(String(pid))}',event)" aria-label="Close">✕</button></div><div class="pcard-lg-body" id="pcardLgBody">${pcardLeaguesRows(pid)}</div>`;
  pop.onclick=(e)=>{ if(e && e.stopPropagation) e.stopPropagation(); };
  const tabs=card.querySelector('#pcardTabs');
  if(tabs && tabs.parentNode===card) card.insertBefore(pop, tabs); else card.appendChild(pop);
  pcardLeaguesLoad(false).then(()=>_pcardLgRefresh(pid)).catch(()=>_pcardLgRefresh(pid));
}
// A card opening: once the leagues are known this session, the pill says the answer.
function pcardLeaguesOnOpen(pid){
  _pcardLgOpen=false;
  if(!pcardLeaguesAvailable()) return;
  if(_pcardLg.at) _pcardLgRefresh(pid);
}
