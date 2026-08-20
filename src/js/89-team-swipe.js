// ─────────────────────────────────────────────────────────────────────────────
// Team-header swipe navigation (mobile-friendly)
// Swipe left/right on the top team banner to move to next/previous team.
// This complements the arrow buttons; both paths call the same selectTeam flow.
// ─────────────────────────────────────────────────────────────────────────────

const THS_COMMIT = 56;   // px of horizontal travel before team switch commits
const THS_DECIDE = 10;   // px before deciding axis
const THS_EDGE = 24;     // ignore left edge to avoid iOS back-swipe conflict
const THS_MAXSHIFT = 320;

function _thsActiveHeader(){
  const headers = [...document.querySelectorAll('.team-header')];
  return headers.find(h=>h.offsetParent!==null && h.getClientRects().length>0) || null;
}

function _thsHostForHeader(h){
  if(!h || !h.parentElement) return null;
  if(h.parentElement.classList && h.parentElement.classList.contains('ths-swipe-top')){
    const host = h.parentElement.parentElement;
    return (host && host.classList && host.classList.contains('ths-swipe-host')) ? host : null;
  }
  const host=document.createElement('div');
  host.className='ths-swipe-host';
  const top=document.createElement('div');
  top.className='ths-swipe-top';
  const parent=h.parentElement;
  parent.insertBefore(host, h);
  host.appendChild(top);
  top.appendChild(h);
  return host;
}

function _thsTop(host){
  if(!host) return null;
  return host.querySelector(':scope > .ths-swipe-top') || host.firstElementChild || host;
}

function _thsUnder(host){
  if(!host) return null;
  let under = host.querySelector(':scope > .ths-swipe-under');
  if(under) return under;
  under=document.createElement('div');
  under.className='ths-swipe-under';
  host.insertBefore(under, _thsTop(host));
  return under;
}

function _thsWidth(host){
  if(!host || !host.getBoundingClientRect) return 320;
  const w = host.getBoundingClientRect().width;
  return (Number.isFinite(w) && w > 10) ? w : 320;
}

function _thsPlacePair(host, topX, dir){
  if(!host) return;
  const top = _thsTop(host);
  const under = _thsUnder(host);
  if(!top || !under) return;
  const w = _thsWidth(host);
  top.style.transform = `translateX(${topX.toFixed(1)}px)`;
  under.style.transform = `translateX(${(topX + (dir<0 ? w : -w)).toFixed(1)}px)`;
}

// Team record for the swipe-preview header. This used to call calcTeamWinsLosses(), which
// does not exist anywhere in the codebase — the typeof guard meant it failed silently, so the
// preview header simply never showed a record while the real header (30-sidebar.js:218) did.
// Use the same source the real header uses: the ESPN record cache, reference seasons only.
function _thsReco(team){
  try{
    if(typeof activeSeason==='undefined' || activeSeason==='proj') return '';   // no record for a projection
    if(typeof espnRecordCache==='undefined' || !espnRecordCache) return '';
    const key = `${activeSeason}:${team}`;
    // Warm the cache the same way the real header does, so swiping to a team you haven't
    // opened yet fills in on the next render instead of staying blank forever.
    if(espnRecordCache[key]==null && typeof fetchTeamRecord==='function') fetchTeamRecord(activeSeason, team);
    return espnRecordCache[key] || '';
  }catch(e){
    return '';
  }
}

function _thsSosRow(team){
  const s = (typeof SOS!=='undefined' && SOS) ? SOS[team] : null;
  if(!s) return '';
  const rankTxt = (typeof ordinal==='function') ? ordinal(s.rank) : String(s.rank);
  const wt = (s.win_total!=null) ? ` · Vegas Win Total: <b>${s.win_total}</b>` : '';
  return `<div class="team-sos-row"><span class="team-sos">SOS: <b>${rankTxt}</b>${wt}</span></div>`;
}

function _thsPreviewCacheKey(team){
  return `${String(activeSeason||'proj')}:${String(team||'')}`;
}

const _thsPreviewCache = Object.create(null);

function _thsCachePreview(team){
  if(!team) return '';
  try{ if(typeof ensureTeam==='function') ensureTeam(team); }catch(e){}
  const key = _thsPreviewCacheKey(team);
  const html = _thsHeaderPreviewHtml(team);
  _thsPreviewCache[key] = html;
  return html;
}

function _thsGetPreview(team){
  if(!team) return '';
  const key = _thsPreviewCacheKey(team);
  if(_thsPreviewCache[key]) return _thsPreviewCache[key];
  return _thsCachePreview(team);
}

function _thsPrimeAdjacent(idx){
  if(!Array.isArray(TEAMS) || idx<0) return;
  const prev = TEAMS[idx-1];
  const next = TEAMS[idx+1];
  if(prev) _thsCachePreview(prev);
  if(next) _thsCachePreview(next);
}

function _thsSetInitialUnder(host, idx){
  if(!host || !Array.isArray(TEAMS) || idx<0) return;
  const next = TEAMS[idx+1] || '';
  const under = _thsUnder(host);
  if(!under) return;
  if(!next){
    under.innerHTML='';
    under.style.transform='translateX(100%)';
    return;
  }
  under.innerHTML = _thsGetPreview(next);
  const w = _thsWidth(host);
  under.style.transition='none';
  under.style.transform=`translateX(${w}px)`;
}

function _thsHeaderPreviewHtml(team){
  const state = (typeof userProj!=='undefined' && userProj) ? userProj[team] : null;
  const qbs = (state && Array.isArray(state.qbs)) ? state.qbs : [];
  const recStr = _thsReco(team);
  const isRef = activeSeason !== 'proj';
  const qb = (typeof teamHeaderQbText==='function')
    ? teamHeaderQbText(team, qbs, recStr)
    : ((qbs&&qbs.length)?qbs.map(q=>q.name).join(' / '):'No projected QB');
  const hcLine = (typeof teamHeaderHcLine==='function') ? teamHeaderHcLine(team, state||{}) : '';
  const sosRow = _thsSosRow(team);
  return `<div class="team-header" aria-hidden="true">
    <img src="${NFL_LOGO(team)}" class="team-logo-lg" alt="${team}" onerror="this.style.opacity='.25'">
    <div style="min-width:0;max-width:100%">
      <div class="team-abbr team-fullname">${teamDisplayName(team)} ${isRef?`<span class="ref-year">${activeSeason}</span>`:''}</div>
      <div class="team-qb-name">${qb}</div>
      ${hcLine}
      ${sosRow}
    </div>
  </div>`;
}

(function installTeamHeaderSwipe(){
  if(typeof document==='undefined' || !document.addEventListener) return;

  let x0=null, y0=null, dx=0, axis=null, header=null, host=null, targetTeam='';

  const clearShift = (anim)=>{
    if(!header || !host) return;
    const top = _thsTop(host) || header;
    const under = _thsUnder(host);
    const dir = dx<0 ? -1 : 1;
    const w = _thsWidth(host);
    top.style.transition = anim ? 'transform .16s ease-out' : '';
    if(under){
      under.style.transition = anim ? 'transform .16s ease-out' : '';
      under.style.transform = `translateX(${dir<0 ? w : -w}px)`;
    }
    top.style.transform = 'translateX(0px)';
    host.classList.remove('ths-swipe-dragging');
    host.classList.remove('ths-swipe-committing');
    if(anim){
      const t=top;
      const u=under;
      setTimeout(()=>{
        if(t) t.style.transition='';
        if(u){ u.style.transition=''; u.innerHTML=''; u.style.transform='translateX(100%)'; }
      }, 180);
    } else if(under){
      under.innerHTML='';
      under.style.transform='translateX(100%)';
    }
    for(const k in _thsPreviewCache) delete _thsPreviewCache[k];
    targetTeam='';
  };

  const finish = ()=>{
    if(x0==null || axis!=='x'){
      x0=null; y0=null; axis=null; dx=0;
      clearShift(false);
      header=null; host=null;
      return;
    }
    const moved = dx;
    x0=null; y0=null; axis=null; dx=0;

    if(Math.abs(moved) < THS_COMMIT){ clearShift(true); header=null; host=null; return; }
    if(!currentTeam || !Array.isArray(TEAMS)){ clearShift(true); header=null; host=null; return; }

    const idx = TEAMS.indexOf(currentTeam);
    if(idx < 0){ clearShift(true); header=null; host=null; return; }

    const target = moved < 0 ? TEAMS[idx+1] : TEAMS[idx-1];
    if(!target){ clearShift(true); header=null; host=null; return; }

    if(host){
      const top = _thsTop(host) || header;
      const under = _thsUnder(host);
      const w = _thsWidth(host);
      host.classList.add('ths-swipe-committing');
      top.style.transition = 'transform .18s ease-out';
      if(under) under.style.transition = 'transform .18s ease-out';
      top.style.transform = `translateX(${moved<0 ? -w : w}px)`;
      if(under) under.style.transform = 'translateX(0px)';
    }
    setTimeout(()=>{ selectTeam(target); }, 140);
    header=null;
    host=null;
  };

  document.addEventListener('touchstart', e=>{
    x0=y0=null; dx=0; axis=null; header=null; host=null; targetTeam='';
    if(e.touches.length!==1) return;
    if(!currentTeam) return;
    // League Analyzer uses a top .team-header shell for league identity, not team navigation.
    // Keep its header gestures owned by the analyzer/tab swipe handlers.
    if(typeof currentPhase!=='undefined' && currentPhase==='League') return;
    if(document.getElementById('pcardOverlay')) return;

    const t = e.touches[0];
    if(t.clientX <= THS_EDGE) return;

    const target = e.target;
    if(target && target.closest && target.closest('.scheme-overlay, .ps-overlay, .rt-bar-host')) return;
    if(target && target.closest && target.closest('input,select,textarea,button,a')) return;

    const h = target && target.closest ? target.closest('.team-header') : null;
    if(!h) return;

    const idx = TEAMS.indexOf(currentTeam);
    if(idx < 0) return;
    if(!TEAMS[idx-1] && !TEAMS[idx+1]) return;
    _thsPrimeAdjacent(idx);

    header = _thsActiveHeader() || h;
    host = _thsHostForHeader(header);
    if(!host) return;
    _thsSetInitialUnder(host, idx);
    x0=t.clientX;
    y0=t.clientY;
  }, {passive:true});

  document.addEventListener('touchmove', e=>{
    if(x0==null || e.touches.length!==1) return;
    const t=e.touches[0];
    dx = t.clientX - x0;
    const dy = t.clientY - y0;

    if(axis===null){
      if(Math.abs(dx) < THS_DECIDE && Math.abs(dy) < THS_DECIDE) return;
      axis = (Math.abs(dx) > Math.abs(dy)*1.35) ? 'x' : 'y';
      if(axis==='y'){ x0=null; y0=null; clearShift(false); header=null; host=null; return; }
    }
    if(axis!=='x') return;

    if(e.cancelable) e.preventDefault();

    if(!currentTeam || !Array.isArray(TEAMS) || !host){ return; }
    const idx = TEAMS.indexOf(currentTeam);
    if(idx < 0){ return; }
    // Resist swiping beyond the team list ends.
    if(dx > 0 && !TEAMS[idx-1]){ dx=0; }
    if(dx < 0 && !TEAMS[idx+1]){ dx=0; }

    const shift = Math.sign(dx) * Math.min(THS_MAXSHIFT, Math.abs(dx));

    const next = dx<0 ? TEAMS[idx+1] : (dx>0 ? TEAMS[idx-1] : '');
    if(next !== targetTeam){
      targetTeam = next || '';
      const under = _thsUnder(host);
      if(under){
        under.innerHTML = targetTeam ? _thsGetPreview(targetTeam) : '';
        under.style.transition = 'none';
      }
    }
    if(targetTeam){
      const dir = dx<0 ? -1 : 1;
      const top = _thsTop(host);
      if(top) top.style.transition = 'none';
      host.classList.add('ths-swipe-dragging');
      _thsPlacePair(host, shift, dir);
    } else {
      host.classList.remove('ths-swipe-dragging');
      clearShift(false);
    }
  }, {passive:false});

  document.addEventListener('touchend', finish, {passive:true});
  document.addEventListener('touchcancel', finish, {passive:true});
})();
