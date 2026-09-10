// ── Player tabs (the dock) ──────────────────────────────────────────────────
// Every card opened this session stays reachable as a tab across the top of the
// card, the way Sleeper keeps players open — drill from an RB's fan to a lineman
// and the RB is still one tap away, and so is everyone else you looked at. The
// strip only appears once a second player is open, so a single card is unchanged.
// Each tab remembers the view it was on (stats tab, chart season) and restores
// it on return; closing a tab lands on its left neighbour; closing the last tab
// closes the card. The ✕ on the card closes everything.
let _pcardDock = [];            // [{pid, pos, team, label, sub, color, snap}]
let _pcardDockActive = null;
const PCARD_DOCK_MAX = 8;       // beyond this the oldest background tab drops off

function _pcardDockLabel(pid, pos, team){
  if(typeof pcardIsTeamDef==='function' && pcardIsTeamDef(pid, pos)){
    const code=String(pid).toUpperCase();
    return {label:`${typeof teamDisplayName==='function'?teamDisplayName(code):code} D/ST`, sub:'DEF', team:code};
  }
  const p=(typeof sleeperPlayers!=='undefined' && sleeperPlayers && sleeperPlayers[pid])||{};
  const name=String(p.name||'Player').trim();
  const parts=name.split(/\s+/);
  const label=parts.length>1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : name;
  const tm=p.team||team||'';
  const ps=p.pos||pos||'';
  return {label, sub:[ps, tm].filter(Boolean).join(' · '), team:tm};
}

// Called as a card opens, BEFORE the shell replaces pcardState — so the tab being
// left can snapshot the view it was on.
function _pcardDockAdd(pid, pos, team){
  const key=String(pid);
  if(_pcardDockActive && _pcardDockActive!==key){
    const cur=_pcardDock.find(t=>t.pid===_pcardDockActive);
    if(cur && pcardState && String(pcardState.pid)===_pcardDockActive && typeof pcardCaptureNavState==='function'){
      cur.snap=pcardCaptureNavState();
    }
  }
  let t=_pcardDock.find(x=>x.pid===key);
  if(!t){
    const meta=_pcardDockLabel(pid, pos, team);
    t={pid:key, pos:pos||'', team:meta.team||team||'', label:meta.label, sub:meta.sub,
       color:(typeof teamColor==='function' && meta.team) ? teamColor(meta.team) : '', snap:null};
    _pcardDock.push(t);
    while(_pcardDock.length>PCARD_DOCK_MAX){
      const i=_pcardDock.findIndex(x=>x.pid!==key);
      if(i<0) break;
      _pcardDock.splice(i,1);
    }
  }
  _pcardDockActive=key;
}

function pcardDockGo(pid){
  const t=_pcardDock.find(x=>x.pid===String(pid));
  if(!t || t.pid===_pcardDockActive) return;
  pcardRestoreState = t.snap || null;
  pcardSuppressNavPush = true;          // a tab switch is not a drill-down
  openPlayerCard(t.pid, t.pos, t.team);
}

function pcardDockClose(pid, ev){
  if(ev && ev.stopPropagation) ev.stopPropagation();
  const i=_pcardDock.findIndex(x=>x.pid===String(pid));
  if(i<0) return;
  const wasActive=_pcardDock[i].pid===_pcardDockActive;
  _pcardDock.splice(i,1);
  if(!_pcardDock.length){ closePlayerCard(); return; }
  if(wasActive){
    _pcardDockActive=null;
    pcardDockGo(_pcardDock[Math.max(0,i-1)].pid);
  }else{
    _pcardDockRender();
  }
}

function _pcardDockReset(){ _pcardDock=[]; _pcardDockActive=null; _pcardAddOpen=false; }

// ── Open another player alongside ────────────────────────────────────────────
// The ＋ in the card header (and the ＋ tab when the strip is showing) opens a
// search INSIDE the card, seeded with the players you would want next to this
// one: his teammates at the position (the depth chart) and his projection
// neighbours (the "similar player"). The pick opens as a new tab on the SAME
// chart, season and game, so JSN's target chart → Kupp's target chart is one tap
// and the strip flips between them.
let _pcardAddOpen=false;
function _pcardAddBoard(){
  try{ return (typeof buildPlayerList==='function') ? buildPlayerList() : []; }catch(e){ return []; }
}
function _pcardAddRow(p){
  return `<button class="pcard-add-hit" onclick="pcardDockOpenLike('${escAttr(String(p.player_id||p.name))}','${escAttr(p.pos||'')}','${escAttr(p.team||'')}')">
    <span class="pcard-add-nm">${escHtml(p.name)}</span><span class="pcard-add-sub">${escHtml(p.pos||'')} · ${escHtml(p.team||'FA')}${p.fpts!=null?` · ${Math.round(p.fpts)} pts`:''}</span></button>`;
}
function _pcardAddRows(q){
  const cur = pcardState || {};
  const list = _pcardAddBoard();
  const me = list.find(p=>String(p.player_id)===String(cur.pid)) || null;
  q=String(q||'').trim();
  if(q.length>=2 && typeof _aiCmpMatches==='function'){
    const seen=new Set([String(cur.pid)]);
    const hits=_aiCmpMatches(q, list).filter(p=>!seen.has(String(p.player_id)) && seen.add(String(p.player_id))).slice(0,10);
    // beyond the projection board: the whole Sleeper DB, same lazy match, so any player opens
    if(hits.length<10 && typeof sleeperPlayers!=='undefined' && sleeperPlayers){
      const rest=[];
      for(const id in sleeperPlayers){ if(seen.has(String(id))) continue; const sp=sleeperPlayers[id];
        if(!sp || !sp.name || !sp.pos || !['QB','RB','WR','TE','K','DEF'].includes(sp.pos)) continue;
        rest.push({player_id:id, name:sp.name, pos:sp.pos, team:sp.team||'FA', fpts:null}); }
      _aiCmpMatches(q, rest).slice(0, 10-hits.length).forEach(p=>hits.push(p));
    }
    return hits.length ? `<div class="pcard-add-sec">Search</div>${hits.map(_pcardAddRow).join('')}` : '<div class="pcard-add-none">No match.</div>';
  }
  const team=String((me&&me.team)||cur.team||'').toUpperCase(), pos=(me&&me.pos)||cur.posc||'';
  const mates=list.filter(p=>String(p.team||'').toUpperCase()===team && p.pos===pos && String(p.player_id)!==String(cur.pid)).sort((a,b)=>(b.fpts||0)-(a.fpts||0)).slice(0,5);
  const near=(me && typeof _aiSimilarToA==='function') ? _aiSimilarToA(me, list, 6).filter(p=>!mates.includes(p)) : [];
  return (mates.length?`<div class="pcard-add-sec">${escHtml(team)} ${escHtml(pos)}s</div>${mates.map(_pcardAddRow).join('')}`:'')
       + (near.length?`<div class="pcard-add-sec">Nearby ${escHtml(pos)}s</div>${near.map(_pcardAddRow).join('')}`:'')
       || '<div class="pcard-add-none">Type a name.</div>';
}
function pcardDockAddOpen(ev){
  if(ev && ev.stopPropagation) ev.stopPropagation();
  const card=document.querySelector('#pcardOverlay .pcard'); if(!card) return;
  let pop=card.querySelector('.pcard-addpop');
  if(pop){ pop.remove(); _pcardAddOpen=false; return; }
  _pcardAddOpen=true;
  pop=document.createElement('div'); pop.className='pcard-addpop';
  pop.innerHTML=`<div class="pcard-add-head"><input class="pcard-add-in" type="search" placeholder="Open alongside… (name, team)" autocomplete="off" oninput="_pcardAddSearch(this.value)" onclick="event.stopPropagation()"><button class="pcard-add-x" onclick="pcardDockAddOpen(event)" aria-label="Close">✕</button></div><div class="pcard-add-list" id="pcardAddList">${_pcardAddRows('')}</div>`;
  pop.onclick=(e)=>{ if(e && e.stopPropagation) e.stopPropagation(); };
  const tabs=card.querySelector('#pcardTabs');
  if(tabs && tabs.parentNode===card) card.insertBefore(pop, tabs); else card.appendChild(pop);
  const inp=pop.querySelector('.pcard-add-in'); if(inp && inp.focus) try{ inp.focus(); }catch(e){}
}
function _pcardAddSearch(q){ const el=document.getElementById('pcardAddList'); if(el) el.innerHTML=_pcardAddRows(q); }
// Same chart, same season, same game — the tab strip does the flipping.
function pcardDockOpenLike(pid, pos, team){
  const snap=(typeof pcardCaptureNavState==='function') ? pcardCaptureNavState() : null;
  if(snap){ pcardRestoreState=Object.assign({}, snap, {pid:String(pid), pos:pos||'', team:team||''}); }
  if(typeof pcardChartGame!=='undefined') _pcardGameCarry=Object.assign({}, pcardChartGame||{});
  _pcardAddOpen=false;
  pcardSuppressNavPush=true;
  openPlayerCard(String(pid), pos||'', team||'');
}

function _pcardDockRender(){
  const card=document.querySelector('#pcardOverlay .pcard');
  if(!card) return;
  let dock=card.querySelector('.pcard-dock');
  if(_pcardDock.length<2){ if(dock) dock.remove(); return; }
  if(!dock){
    dock=document.createElement('div');
    dock.className='pcard-dock';
    dock.setAttribute('role','tablist');
    // A mouse wheel over the strip scrolls it sideways (trackpads already do); the
    // arrow keys step between tabs (97b-keys.js).
    if(dock.addEventListener) dock.addEventListener('wheel', (e)=>{ if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){ dock.scrollLeft+=e.deltaY; if(e.preventDefault) e.preventDefault(); } }, {passive:false});
    card.insertBefore(dock, card.firstChild);
  }
  dock.innerHTML=`<button class="pcard-dock-add" onclick="pcardDockAddOpen(event)" title="Open another player alongside" aria-label="Open another player alongside">＋</button>`+_pcardDock.map(t=>{
    const on=t.pid===_pcardDockActive;
    return `<div class="pcard-dock-tab${on?' active':''}" role="tab" aria-selected="${on}"
      ${t.color?`style="--dock-c:${escAttr(t.color)}"`:''} onclick="pcardDockGo('${escAttr(t.pid)}')">
      <span class="pcard-dock-name">${escHtml(t.label)}</span>
      <span class="pcard-dock-sub">${escHtml(t.sub)}</span>
      <button class="pcard-dock-x" onclick="pcardDockClose('${escAttr(t.pid)}',event)" aria-label="Close ${escAttr(t.label)}">✕</button>
    </div>`;
  }).join('');
  const act=dock.querySelector('.pcard-dock-tab.active');
  if(act && act.scrollIntoView){ try{ act.scrollIntoView({block:'nearest', inline:'nearest'}); }catch(e){} }
}
