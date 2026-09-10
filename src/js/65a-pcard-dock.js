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

function _pcardDockReset(){ _pcardDock=[]; _pcardDockActive=null; }

function _pcardDockRender(){
  const card=document.querySelector('#pcardOverlay .pcard');
  if(!card) return;
  let dock=card.querySelector('.pcard-dock');
  if(_pcardDock.length<2){ if(dock) dock.remove(); return; }
  if(!dock){
    dock=document.createElement('div');
    dock.className='pcard-dock';
    dock.setAttribute('role','tablist');
    card.insertBefore(dock, card.firstChild);
  }
  dock.innerHTML=_pcardDock.map(t=>{
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
