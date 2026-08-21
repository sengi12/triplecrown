// ─────────────────────────────────────────────────────────────────────────────
// Swipe left/right to move between tabs. Deliberately generic: it reads the rendered
// `.phase-tabs` bar and clicks the neighbouring `.phase-tab`, so it works for the projections
// builder AND the league analyzer (and anything else using that markup) without needing to
// know either tab list — they stay in sync automatically as tabs are added or hidden.
//
// The hard part isn't the gesture, it's knowing when NOT to fire:
//   • horizontal scrollers (rankings table, tab strip, card tables) must win — a swipe that
//     starts inside one is the user scrolling it, not changing tabs;
//   • vertical scrolling must never be hijacked, so the axis is decided before we commit;
//   • the browser's own gestures (pull-to-refresh, back-swipe) must not fire underneath, which
//     means claiming the gesture with preventDefault once we own it — hence a NON-passive
//     touchmove, same reasoning as the player card's swipe-to-close;
//   • the iOS left-edge back-swipe can't be reliably cancelled, so we simply don't engage there
//     rather than fighting it and feeling broken.
// ─────────────────────────────────────────────────────────────────────────────

const TS_COMMIT = 60;      // px of horizontal travel before a tab change commits
const TS_DECIDE = 10;      // px before we decide the gesture's axis
const TS_EDGE   = 24;      // ignore starts this close to the left edge (iOS back-swipe zone)
const TS_MAXSHIFT = 420;   // cap on the content's follow-the-finger travel

function tsTabPhase(btn){
  if(!btn) return null;
  const oc=btn.getAttribute('onclick')||'';
  // Builder tabs use setPhase('X'); League Analyzer tabs use laSetTab('x') — both swipe.
  const m=oc.match(/(?:setPhase|laSetTab)\('([^']+)'\)/);
  return m ? m[1] : null;
}

function tsCanPreviewPhase(phase){
  const p=String(phase||'');
  // League Analyzer tabs (checked BEFORE the currentTeam guard — the analyzer needs no team).
  if(typeof currentPhase!=='undefined' && currentPhase==='League'){
    return !!(typeof leagueSnapshot!=='undefined' && leagueSnapshot) &&
      ['myteam','rosters','compare','best','trade','matchup','lineup','dvp','trends'].includes(p);
  }
  if(!currentTeam) return false;
  if(['Passing','Receiving','Rushing','Advanced','Additions'].includes(p)) return true;
  if(p==='Rankings') return (typeof rankScope!=='undefined' ? rankScope==='team' : true);
  return false;
}

function tsPreviewTeamRankings(){
  if(!currentTeam) return '';
  let all=[];
  try{ all=buildPlayerList().filter(p=>p.team===currentTeam); }
  catch(e){ all=[]; }
  if(!all.length){
    return `<div class="ts-preview-pane ts-preview-rankings"><div class="empty"><div class="empty-icon">${typeof TC_ICON==='function'?TC_ICON('trophy','tc-ico-lg'):'🏆'}</div>
      <div class="empty-title">No projections yet</div><div class="empty-body">Set at least one team's stats to see rankings.</div></div></div>`;
  }
  all.sort((a,b)=>b.fpts-a.fpts);
  const rankIsRookie = (p)=> (typeof rankingIsRookieForSeason==='function')
    ? !!rankingIsRookieForSeason(p, activeSeason)
    : !!(p && (p.is_rookie===true || Number(p.years_exp)===0));
  let view=rankPosFilter==='ALL'?all
    :rankPosFilter==='ROOKIES'?all.filter(rankIsRookie)
    :rankPosFilter==='FLEX'?all.filter(p=>p.pos!=='QB')
    :all.filter(p=>p.pos===rankPosFilter);
  const rows=view.slice(0,28).map((p,i)=>`<tr>
    <td class="c-ecr">${i+1}</td>
    <td class="fpts">${(Number(p.fpts)||0).toFixed(1)}</td>
    <td><span class="pos-badge pos-${p.pos}">${p.pos}</span></td>
    <td class="c-player"><div class="clickable-player" style="display:flex;align-items:center;gap:6px" onclick="${pcardOnclick(p.player_id||p.name, p.pos, p.team||'')}">${imgTag(hsPack(p),'rank-hs')}<span class="rank-name">${p.name}</span></div></td>
    <td class="c-team"><img src="${NFL_LOGO(p.team)}" class="rank-logo" loading="lazy" decoding="async" onerror="this.style.display='none'"> ${p.team}</td>
  </tr>`).join('');
  return `<div class="ts-preview-pane ts-preview-rankings"><div class="rankings-scope-bar">
      <span class="scope-title">${currentTeam} Rankings</span><span class="scope-sub">this team only</span>
      <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="showFullRankings()">View full league →</button>
    </div>
    <div class="card ts-rankings-preview-card" style="padding:0;overflow:hidden">
      <div style="padding:11px 14px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border);flex-wrap:wrap">
        <span style="font-size:11px;color:var(--muted);font-weight:700">PREVIEW</span>
        <span style="font-size:11px;color:var(--muted)">Top ${Math.min(view.length,28)} players · full controls after tab settle</span>
      </div>
      <div class="rank-table-wrap ts-rankings-preview-wrap" style="max-height:calc(100vh - 380px)">
        <table class="rankings-table grouped ts-rankings-preview-table"><thead><tr>
          <th><div class="th-stack">RK</div></th>
          <th><div class="th-stack">FPTS</div></th>
          <th><div class="th-stack">POS</div></th>
          <th><div class="th-stack">PLAYER</div></th>
          <th><div class="th-stack">TM</div></th>
        </tr></thead><tbody>${rows}</tbody></table>
      </div>
    </div></div>`;
}

function tsRenderPhasePreview(phase){
  if(!tsCanPreviewPhase(phase)) return '';
  // League Analyzer previews: render the neighbouring tab's view from IN-MEMORY data only.
  // The strict rule for the in-season tabs is cache-only — a cold matchup/DvP/trends tab
  // returns '' (blank underlay; the commit-by-click still works) rather than fetching from
  // a gesture. laTabViewHTML itself never fetches synchronously, so it is safe to call.
  if(typeof currentPhase!=='undefined' && currentPhase==='League'){
    const s=(typeof leagueSnapshot!=='undefined')?leagueSnapshot:null;
    if(!s) return '';
    try{
      if(phase==='myteam') return laMyTeamView(s);
      if(phase==='rosters') return laRostersView(s);
      if(phase==='compare') return laCompareView(s);
      if(phase==='best') return laBestAvailView(s);
      if(phase==='trade') return laTradeView(s);
      if(['matchup','lineup','dvp','trends'].includes(phase)){
        // Cache-only: preview only when the data is already loaded.
        if(phase==='matchup' && !(_laMu.byWeek[laMuWeek()])) return '';
        if(phase==='lineup' && !(_laMu.byWeek[laCurrentWeek()])) return '';
        if((phase==='dvp'||phase==='trends') && !(typeof TC_INSEASON!=='undefined' && TC_INSEASON)) return '';
        return (typeof laTabViewHTML==='function' && laTabViewHTML(phase, s)) || '';
      }
    }catch(e){ return ''; }
    return '';
  }
  const t=currentTeam;
  const state=userProj[t];
  if(!state) return '';
  if(phase==='Passing') return renderPassing(t,state);
  if(phase==='Receiving'){ initPassingShares(t); return renderReceiving(t,state); }
  if(phase==='Rushing'){ initRushingShares(t); return renderRushing(t,state); }
  if(phase==='Advanced') return renderTeamAdvanced(t);
  if(phase==='Additions') return renderTeamAdditions(t);
  if(phase==='Rankings') return tsPreviewTeamRankings();
  return '';
}

function tsSanitizePreviewHTML(html){
  return String(html||'').replace(/\sid="[^"]*"/g,'');
}

function tsSwipeTop(host){
  if(!host) return null;
  return host.querySelector(':scope > .ts-swipe-top') || host.firstElementChild || host;
}

function tsSwipeUnder(host){
  if(!host) return null;
  let under = host.querySelector(':scope > .ts-swipe-under');
  if(under) return under;
  under=document.createElement('div');
  under.className='ts-swipe-under';
  const top=tsSwipeTop(host);
  if(top && top.parentElement===host) host.insertBefore(under, top);
  else host.appendChild(under);
  return under;
}

function tsHostWidth(host){
  if(!host || !host.getBoundingClientRect) return 320;
  const w = host.getBoundingClientRect().width;
  return (Number.isFinite(w) && w>10) ? w : 320;
}

function tsPlacePair(host, topX, dir){
  if(!host) return;
  const top = tsSwipeTop(host);
  const under = tsSwipeUnder(host);
  if(!top || !under) return;
  const w = tsHostWidth(host);
  top.style.transform = `translateX(${topX.toFixed(1)}px)`;
  under.style.transform = `translateX(${(topX + (dir<0 ? w : -w)).toFixed(1)}px)`;
}

// Wrap everything AFTER the active tab bar so swipe animation only moves the changing
// page region (content below labels), leaving static chrome above untouched.
function tsSwipeHost(bar){
  if(!bar || !bar.parentElement) return document.getElementById('content');
  const parent=bar.parentElement;
  const next=bar.nextElementSibling;
  if(next && next.classList && next.classList.contains('ts-swipe-host')){
    if(!next.querySelector(':scope > .ts-swipe-top')){
      const top=document.createElement('div');
      top.className='ts-swipe-top';
      while(next.firstChild) top.appendChild(next.firstChild);
      next.appendChild(top);
    }
    return next;
  }
  const host=document.createElement('div');
  host.className='ts-swipe-host';
  const top=document.createElement('div');
  top.className='ts-swipe-top';
  let n=bar.nextSibling;
  while(n){
    const after=n.nextSibling;
    top.appendChild(n);
    n=after;
  }
  host.appendChild(top);
  parent.appendChild(host);
  return host;
}

function tsAnimateTabTurn(host, tabs, next, moved, opts){
  if(!host || !tabs || next<0 || next>=tabs.length){
    if(tabs && tabs[next]) tabs[next].click();
    return;
  }
  const top = tsSwipeTop(host) || host;
  const under = tsSwipeUnder(host);
  const w = tsHostWidth(host);
  host.classList.add('ts-swipe-dragging');
  if(under) under.style.transition = 'transform .18s ease-out';
  top.style.transition = 'transform .18s ease-out';
  top.style.transform = `translateX(${moved<0 ? -w : w}px)`;
  if(under) under.style.transform='translateX(0px)';
  setTimeout(()=>{
    tabs[next].click();
  }, 145);
}

// The visible tab bar, if any. Multiple can exist in the DOM across views, so take the first
// one that's actually laid out.
function tsActiveBar(){
  const bars=[...document.querySelectorAll('.phase-tabs')];
  return bars.find(b=>b.offsetParent!==null && b.getClientRects().length>0) || null;
}

// True when this element (or an ancestor) is a horizontal scroller with somewhere left to go in
// the swipe direction — in which case the scroller owns the gesture, not us.
function tsScrollerClaims(el, dir){
  let n=el;
  while(n && n!==document.body && n!==document.documentElement){
    if(n.scrollWidth > n.clientWidth + 2){
      const style=getComputedStyle(n);
      if(/(auto|scroll)/.test(style.overflowX)){
        const maxX=n.scrollWidth-n.clientWidth;
        // dir<0 = swiping left (content moves left → scroller advances right)
        if(dir<0 && n.scrollLeft < maxX-1) return true;
        if(dir>0 && n.scrollLeft > 1) return true;
      }
    }
    n=n.parentElement;
  }
  return false;
}

(function installTabSwipe(){
  if(typeof document==='undefined' || !document.addEventListener) return;
  let x0=null, y0=null, dx=0, axis=null, bar=null, host=null, tabs=null, cur=-1;
  let previewPhase=null, previewCache={};

  // Per-gesture preview cache key. League previews key on the snapshot, not the team/season.
  const tsPreviewKey = (phase)=>
    (typeof currentPhase!=='undefined' && currentPhase==='League')
      ? `League:${(typeof laSnapshotRef==='function' && laSnapshotRef())||''}:${String(phase)}`
      : `${String(currentTeam||'')}:${String(activeSeason||'')}:${String(phase)}`;

  const cachePreviewForPhase = (phase)=>{
    if(!phase || !tsCanPreviewPhase(phase)) return;
    const cacheKey = tsPreviewKey(phase);
    if(previewCache[cacheKey]!=null) return;
    let html='';
    try{ html = tsSanitizePreviewHTML(tsRenderPhasePreview(phase)); }
    catch(e){ html=''; }
    previewCache[cacheKey]=html||'';
  };

  const preloadAdjacentPreviews = ()=>{
    if(!tabs || cur<0) return;
    const left = cur-1, right = cur+1;
    if(left>=0) cachePreviewForPhase(tsTabPhase(tabs[left]));
    if(right<tabs.length) cachePreviewForPhase(tsTabPhase(tabs[right]));
  };

  const setPreview = (phase, label)=>{
    if(!host) return;
    const under=tsSwipeUnder(host);
    if(!under) return;
    if(!phase || !tsCanPreviewPhase(phase)){
      previewPhase=null;
      under.innerHTML='';
      return;
    }
    if(previewPhase===phase) return;
    const cacheKey = tsPreviewKey(phase);
    if(previewCache[cacheKey]==null) cachePreviewForPhase(phase);
    let html = previewCache[cacheKey];
    if(!html){
      previewPhase=null;
      under.innerHTML='';
      return;
    }
    under.innerHTML=html;
    previewPhase=phase;
  };

  const clearShift = (anim)=>{
    if(!host) return;
    const top = tsSwipeTop(host) || host;
    const under = tsSwipeUnder(host);
    const dir = dx<0 ? -1 : 1;
    const w = tsHostWidth(host);
    top.style.transition = anim ? 'transform .16s ease-out' : '';
    top.style.transform = 'translateX(0px)';
    if(under){
      under.style.transition = anim ? 'transform .16s ease-out' : '';
      under.style.transform = `translateX(${dir<0 ? w : -w}px)`;
    }
    host.classList.remove('ts-swipe-dragging');
    host.classList.remove('ts-swipe-committing');
    previewPhase=null;
    // Cleared at the END of the gesture (not the start of the next touch): a preview is built
    // from live projections, week-range filters and scoring settings, any of which may change
    // between gestures, so one gesture is the only lifetime that's provably safe.
    previewCache={};
    if(anim){
      const t=top; const u=under;
      setTimeout(()=>{
        if(t) t.style.transition='';
        if(u){ u.style.transition=''; u.innerHTML=''; u.style.transform='translateX(100%)'; }
      }, 180);
    } else if(under){
      under.innerHTML='';
      under.style.transform='translateX(100%)';
    }
  };

  document.addEventListener('touchstart', e=>{
    x0=y0=null; axis=null; dx=0; bar=null; host=null; tabs=null; cur=-1; previewPhase=null;
    if(e.touches.length!==1) return;
    // League-wide Advanced Metrics is a standalone page (like Full Rankings):
    // no horizontal phase-swipe navigation from this view.
    if(typeof currentPhase!=='undefined' && currentPhase==='AdvancedLeague') return;
    const t=e.touches[0];
    if(t.clientX <= TS_EDGE) return;                 // leave the back-swipe zone alone
    // The player card runs its own gesture; don't compete with it.
    if(document.getElementById('pcardOverlay')) return;
    // INTERACTIVE CONTROLS OWN THEIR GESTURE. A range slider is itself a horizontal drag, so a
    // swipe starting on one must adjust the value and never change tabs — the two are decided
    // at touchstart and can't hand off mid-gesture. Same for the other form controls and the
    // overlays that run their own handlers.
    if(e.target && e.target.closest && e.target.closest(
        'input, select, textarea, .slider-wrap, .slider-track, [role="slider"], ' +
        '.ps-overlay, .scheme-overlay, .rt-bar-host')) return;
    const b=tsActiveBar();
    if(!b) return;
    if(e.target && e.target.closest && e.target.closest('.phase-tabs')) return;
    const ts=[...b.querySelectorAll('.phase-tab')];
    if(ts.length<2) return;
    bar=b;
    tabs=ts;
    cur=tabs.findIndex(t=>t.classList.contains('active'));
    if(cur<0) return;
    host=tsSwipeHost(b);
    if(!host || (e.target && !host.contains(e.target))) return;
    // NOTE: preloadAdjacentPreviews() deliberately does NOT run here. It renders two entire
    // phase pages (renderTeamAdvanced + a rankings preview ≈ 12ms desktop, 10-60ms on a phone)
    // and touchstart fires on every tap and every scroll-start — before we even know whether
    // the gesture is horizontal. It now runs in touchmove, the moment axis==='x' is decided,
    // which is ~10px of travel and still long before any preview becomes visible.
    x0=t.clientX; y0=t.clientY;
  }, {passive:true});

  document.addEventListener('touchmove', e=>{
    if(x0==null || e.touches.length!==1) return;
    const t=e.touches[0];
    dx = t.clientX - x0;
    const dy = t.clientY - y0;
    if(axis===null){
      if(Math.abs(dx) < TS_DECIDE && Math.abs(dy) < TS_DECIDE) return;
      // Require a clearly horizontal intent — otherwise this is a scroll and we stay out of it.
      axis = (Math.abs(dx) > Math.abs(dy)*1.4) ? 'x' : 'y';
      if(axis==='x' && tsScrollerClaims(e.target, dx)) axis='y';   // a scroller owns it
      if(axis==='y'){ x0=null; return; }
      // Horizontal intent confirmed — NOW pre-render the immediate left/right neighbours.
      // setPreview() below only needs whichever one the finger is heading toward, but doing
      // both here keeps a mid-gesture direction change instant, and this runs once per swipe
      // instead of once per tap.
      preloadAdjacentPreviews();
    }
    if(axis!=='x') return;
    // Ours now: stop the browser from scrolling / pull-to-refreshing underneath.
    if(e.cancelable) e.preventDefault();
    // Follow the finger with resistance so the swipe feels connected, capped so the layout
    // never travels far enough to look broken.
    const shift = Math.sign(dx) * Math.min(TS_MAXSHIFT, Math.abs(dx)*0.9);
    if(host){
      const dir = dx<0 ? -1 : 1;
      const next = cur>=0 ? (cur + (dx<0 ? 1 : -1)) : -1;
      const valid = next>=0 && tabs && next<tabs.length;
      host.classList.toggle('ts-swipe-dragging', !!valid);
      const nextLabel = valid ? String((tabs[next]&&tabs[next].textContent)||'').trim() : '';
      const nextPhase = valid ? tsTabPhase(tabs[next]) : null;
      setPreview(nextPhase, nextLabel);
      const top = tsSwipeTop(host);
      if(top) top.style.transition='none';
      const under=tsSwipeUnder(host);
      if(under) under.style.transition='none';
      if(valid){
        tsPlacePair(host, shift, dir);
      } else if(top){
        top.style.transform='translateX(0px)';
      }
    }
  }, {passive:false});

  const finish = ()=>{
    if(x0==null || axis!=='x'){ x0=null; axis=null; clearShift(false); return; }
    const moved=dx;
    x0=null; axis=null;
    if(host){ host.classList.remove('ts-swipe-dragging'); }
    if(Math.abs(moved) < TS_COMMIT || !bar){ clearShift(true); return; }
    if(!tabs || cur<0){ clearShift(true); return; }
    // Swipe left → next tab (content moves left, like turning a page).
    const next = moved<0 ? cur+1 : cur-1;
    if(next<0 || next>=tabs.length){ clearShift(true); return; }
    tsAnimateTabTurn(host, tabs, next, moved, {});
  };
  document.addEventListener('touchend', finish, {passive:true});
  document.addEventListener('touchcancel', finish, {passive:true});
})();
