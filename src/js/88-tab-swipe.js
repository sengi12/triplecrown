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
const TS_MAXSHIFT = 44;    // cap on the content's follow-the-finger travel

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
  let x0=null, y0=null, dx=0, axis=null, bar=null, host=null;

  const clearShift = (anim)=>{
    if(!host) return;
    host.style.transition = anim ? 'transform .16s ease-out' : '';
    host.style.transform = '';
    if(anim){ const h=host; setTimeout(()=>{ if(h) h.style.transition=''; }, 180); }
  };

  document.addEventListener('touchstart', e=>{
    x0=y0=null; axis=null; dx=0; bar=null; host=null;
    if(e.touches.length!==1) return;
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
    const tabs=[...b.querySelectorAll('.phase-tab')];
    if(tabs.length<2) return;
    bar=b; host=document.getElementById('content');
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
    if(host) host.style.transform = `translateX(${shift.toFixed(1)}px)`;
  }, {passive:false});

  const finish = ()=>{
    if(x0==null || axis!=='x'){ x0=null; axis=null; clearShift(false); return; }
    const moved=dx;
    x0=null; axis=null;
    clearShift(true);
    if(Math.abs(moved) < TS_COMMIT || !bar) return;
    const tabs=[...bar.querySelectorAll('.phase-tab')];
    const cur=tabs.findIndex(b=>b.classList.contains('active'));
    if(cur<0) return;
    // Swipe left → next tab (content moves left, like turning a page).
    const next = moved<0 ? cur+1 : cur-1;
    if(next<0 || next>=tabs.length) return;
    tabs[next].click();
  };
  document.addEventListener('touchend', finish, {passive:true});
  document.addEventListener('touchcancel', finish, {passive:true});
})();
