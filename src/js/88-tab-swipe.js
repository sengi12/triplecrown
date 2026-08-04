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
const TS_MAXSHIFT = 500;   // cap on the content's follow-the-finger travel

function tsTabPhase(btn){
  if(!btn) return null;
  const oc=btn.getAttribute('onclick')||'';
  const m=oc.match(/setPhase\('([^']+)'\)/);
  return m ? m[1] : null;
}

function tsCanPreviewPhase(phase){
  const p=String(phase||'');
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
  let view=rankPosFilter==='ALL'?all
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
  const out = moved<0 ? -120 : 120;
  const inn = moved<0 ? 120 : -120;
  const seamless = !!(opts && opts.seamless);

  if(seamless && under && under.innerHTML && under.innerHTML.trim()){
    // The target is already visible underneath during drag; promote it immediately so
    // the release feels "already there", then sync canonical state via normal tab click.
    host.classList.add('ts-swipe-committing');
    host.classList.remove('ts-swipe-dragging');
    try{
      top.style.transition='none';
      top.style.transform='translateX(0px)';
      top.innerHTML=under.innerHTML;
      under.innerHTML='';
      under.style.transform='translateX(0px) scale(1)';
      tabs.forEach(t=>t.classList.remove('active'));
      if(tabs[next]) tabs[next].classList.add('active');
    }catch(e){}
    setTimeout(()=>{ if(tabs[next]) tabs[next].click(); }, 0);
    return;
  }
  host.classList.add('ts-swipe-dragging');
  host.dataset.tsNext = (tabs[next] && tabs[next].textContent) ? tabs[next].textContent.trim() : '';
  host.style.setProperty('--ts-dir', moved<0 ? '1' : '-1');
  host.style.setProperty('--ts-reveal', '1');
  if(under){
    under.style.transform='translateX(0px) scale(1)';
  }
  top.style.transition = 'transform .16s ease-out';
  top.style.transform = `translateX(${out}px)`;
  setTimeout(()=>{
    tabs[next].click();
    const freshBar=tsActiveBar();
    const fresh=freshBar ? tsSwipeHost(freshBar) : (document.getElementById('content') || host);
    const freshTop = tsSwipeTop(fresh) || fresh;
    fresh.style.setProperty('--ts-dir', moved<0 ? '1' : '-1');
    fresh.style.setProperty('--ts-reveal', '0');
    fresh.classList.remove('ts-swipe-dragging');
    if(seamless){
      // The target page was already revealed under the top card during drag: settle
      // directly to it (no second "slide in" pass) to avoid a double-motion feel.
      freshTop.style.transition='none';
      freshTop.style.transform='translateX(0px)';
      setTimeout(()=>{ if(freshTop){ freshTop.style.transition=''; } }, 40);
      return;
    }
    freshTop.style.transition='none';
    freshTop.style.transform=`translateX(${inn}px)`;
    freshTop.getBoundingClientRect();
    freshTop.style.transition='transform .18s ease-out';
    freshTop.style.transform='translateX(0px)';
    setTimeout(()=>{ if(freshTop){ freshTop.style.transition=''; } }, 210);
  }, 140);
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

  const cachePreviewForPhase = (phase)=>{
    if(!phase || !tsCanPreviewPhase(phase)) return;
    const cacheKey = `${String(currentTeam||'')}:${String(activeSeason||'')}:${String(phase)}`;
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
      host.classList.remove('ts-swipe-live');
      host.dataset.tsNext = label||'';
      return;
    }
    if(previewPhase===phase) return;
    const cacheKey = `${String(currentTeam||'')}:${String(activeSeason||'')}:${String(phase)}`;
    if(previewCache[cacheKey]==null) cachePreviewForPhase(phase);
    let html = previewCache[cacheKey];
    if(!html){
      previewPhase=null;
      under.innerHTML='';
      host.classList.remove('ts-swipe-live');
      host.dataset.tsNext = label||'';
      return;
    }
    under.innerHTML=html;
    host.classList.add('ts-swipe-live');
    host.dataset.tsNext='';
    previewPhase=phase;
  };

  const clearShift = (anim)=>{
    if(!host) return;
    const top = tsSwipeTop(host) || host;
    const under = tsSwipeUnder(host);
    top.style.transition = anim ? 'transform .16s ease-out' : '';
    top.style.transform = '';
    if(under){
      under.style.transition = anim ? 'transform .16s ease-out' : '';
      under.style.transform = '';
      under.innerHTML='';
    }
    host.classList.remove('ts-swipe-dragging');
    host.classList.remove('ts-swipe-live');
    host.classList.remove('ts-swipe-committing');
    host.style.removeProperty('--ts-reveal');
    host.style.removeProperty('--ts-dir');
    host.dataset.tsNext = '';
    previewPhase=null;
    previewCache={};
    if(anim){ const t=top; setTimeout(()=>{ if(t) t.style.transition=''; }, 180); }
  };

  document.addEventListener('touchstart', e=>{
    x0=y0=null; axis=null; dx=0; bar=null; host=null; tabs=null; cur=-1; previewPhase=null; previewCache={};
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
    // Pre-render only the immediate left/right neighbors for instant direction changes
    // without precomputing the whole tab stack.
    preloadAdjacentPreviews();
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
    }
    if(axis!=='x') return;
    // Ours now: stop the browser from scrolling / pull-to-refreshing underneath.
    if(e.cancelable) e.preventDefault();
    // Follow the finger with resistance so the swipe feels connected, capped so the layout
    // never travels far enough to look broken.
    const shift = Math.sign(dx) * Math.min(TS_MAXSHIFT, Math.abs(dx)*0.35);
    if(host){
      const dir = dx<0 ? 1 : -1;
      const next = cur>=0 ? (cur + (dx<0 ? 1 : -1)) : -1;
      const valid = next>=0 && tabs && next<tabs.length;
      host.classList.toggle('ts-swipe-dragging', !!valid);
      const nextLabel = valid ? String((tabs[next]&&tabs[next].textContent)||'').trim() : '';
      const nextPhase = valid ? tsTabPhase(tabs[next]) : null;
      setPreview(nextPhase, nextLabel);
      const under=tsSwipeUnder(host);
      host.style.setProperty('--ts-dir', String(dir));
      host.style.setProperty('--ts-reveal', String(Math.min(1, Math.abs(dx)/150)));
      const top = tsSwipeTop(host) || host;
      top.style.transform = `translateX(${shift.toFixed(1)}px)`;
      if(under && valid){
        const reveal = Math.min(1, Math.abs(dx)/150);
        const underShift = (22 - reveal*22) * dir;
        under.style.transform = `translateX(${underShift.toFixed(1)}px) scale(${(0.985 + reveal*0.015).toFixed(4)})`;
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
    const nextPhase = tsTabPhase(tabs[next]);
    const seamless = !!(nextPhase && previewPhase===nextPhase && host && host.classList.contains('ts-swipe-live'));
    tsAnimateTabTurn(host, tabs, next, moved, {seamless});
  };
  document.addEventListener('touchend', finish, {passive:true});
  document.addEventListener('touchcancel', finish, {passive:true});
})();
