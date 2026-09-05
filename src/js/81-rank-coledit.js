// ── Rankings column editor ─────────────────────────────────────────────────────────────
// Long-press any customizable rankings header → home-screen-style edit mode: headers wobble
// with an ✕ badge (tap to hide; stat groups hide as whole units), and meta columns drag to
// reorder. Prefs live in rankColPrefs (15-session-globals.js), persist with the session, and
// "↺ Reset table" in the rankings hamburger restores the default layout.
// Mobile-first: delegated listeners only, one cloned ghost moved by transform, header rects
// re-read only while a drag is live — nothing here touches the 17k-cell body.

let rankColEditActive = false;
let _rcLP = null;     // pending long-press {x, y, timer}
let _rcDrag = null;   // live drag {key, ghost, items, beforeKey, raf, px}

const RC_LP_MS = 450;      // press-and-hold before edit mode arms
const RC_LP_SLOP = 8;      // px of movement that cancels the press (it's a scroll)

function _rcHeadThs(){
  return Array.from(document.querySelectorAll('.rankings-table thead th[data-rc], .rankings-table thead th[data-rcg], .rankings-table thead th[data-rc-adv]'));
}
function _rcIsLocked(key){ return !!(typeof RANK_COL_LOCKED!=='undefined' && RANK_COL_LOCKED[key]); }

function rankColEditAugment(){
  // (Re)apply edit-mode chrome to the CURRENT header DOM — called on entry and after any
  // re-render while editing. Idempotent.
  const wrap = document.querySelector('.rank-table-wrap');
  if(!wrap) return;
  wrap.classList.add('rank-coledit');
  _rcHeadThs().forEach(el=>{
    const key = el.getAttribute('data-rc');
    const grp = el.getAttribute('data-rcg');
    const adv = el.getAttribute('data-rc-adv');
    if(key && _rcIsLocked(key)){ el.classList.add('rc-locked'); return; }
    el.classList.add('rc-edit');
    // A stat group hides as one unit, so only its FIRST column wears the ✕ — twelve badges
    // across RUSH/REC/PASS read as noise and imply per-column hiding that doesn't exist.
    // Adv columns are individual metrics, so each wears its own.
    if(grp && !el.classList.contains('grp-'+grp)) return;
    if(!el.querySelector('.rc-x')){
      const x=document.createElement('span');
      x.className='rc-x'; x.textContent='✕';
      x.title = grp ? 'Hide this stat group' : 'Hide this column';
      x.addEventListener('click',(e)=>{ e.stopPropagation(); e.preventDefault();
        rankColHide(adv!=null?('adv:'+adv):grp?('grp_'+grp):key); });
      el.appendChild(x);
    }
  });
  _rcHiddenTray();
  if(!document.getElementById('rcDoneChip')){
    const b=document.createElement('button');
    b.id='rcDoneChip'; b.textContent='Done';
    b.title='Finish editing columns';
    b.addEventListener('click', exitRankColEdit);
    document.body.appendChild(b);
  }
}

function enterRankColEdit(){
  if(rankColEditActive) return;
  rankColEditActive = true;
  try{ if(navigator.vibrate) navigator.vibrate(10); }catch(_e){}
  rankColEditAugment();
}

function exitRankColEdit(){
  if(!rankColEditActive) return;
  rankColEditActive = false;
  _rcCancelDrag();
  const wrap = document.querySelector('.rank-table-wrap');
  if(wrap) wrap.classList.remove('rank-coledit');
  document.querySelectorAll('.rankings-table thead th.rc-edit, .rankings-table thead th.rc-locked').forEach(el=>{
    el.classList.remove('rc-edit','rc-locked','rc-drop','rc-drop-end','rc-dragging');
  });
  document.querySelectorAll('.rankings-table .rc-x').forEach(el=>el.remove());
  const chip=document.getElementById('rcDoneChip');
  if(chip) chip.remove();
  const tray=document.getElementById('rcHiddenTray');
  if(tray) tray.remove();
}

function rankColHide(key){
  const hid=[...rankColHidden()];      // start from the EFFECTIVE set (defaults included)
  if(!hid.includes(key)) hid.push(key);
  rankColPrefs.hidden = hid;
  _rcCommit();
}
function rankColShow(key){
  rankColPrefs.hidden = [...rankColHidden()].filter(k=>k!==key);
  _rcCommit();
}
// Labels for the "+ add back" tray in edit mode — the reveal half of hide.
const RC_LABELS = { ecr:'ECR', ecr_tier:'TIER', tc:'TC', tcr:'TC★', adp:'ADP', fpts:'FPTS',
  vor:'VOR', pos:'POS', name:'PLAYER', team:'TM', own:'OWNER', age:'AGE', apy:'APY', fa:'FA',
  grp_rush:'RUSH', grp_rec:'REC', grp_pass:'PASS' };
function _rcHiddenTray(){
  let tray=document.getElementById('rcHiddenTray');
  const hid=[...rankColHidden()];
  if(!hid.length){ if(tray) tray.remove(); return; }
  if(!tray){
    tray=document.createElement('div');
    tray.id='rcHiddenTray';
    document.body.appendChild(tray);
  }
  tray.innerHTML='<span class="rc-tray-lbl">hidden</span>'+hid.map(k=>{
    const lbl=RC_LABELS[k]||(k.startsWith('adv:')?k.slice(4):k);
    return `<button class="rc-add" data-k="${k}">+ ${lbl}</button>`;
  }).join('');
  tray.querySelectorAll('.rc-add').forEach(b=>b.addEventListener('click',()=>rankColShow(b.getAttribute('data-k'))));
}

// Move `key` so it renders immediately before `beforeKey` (null = end of the meta segment).
// Operates on the CANONICAL order so hidden/unavailable columns keep their relative slots.
// ECR is the sticky rank spine: nothing may land in front of it.
function rankColMove(key, beforeKey){
  if(_rcIsLocked(key)) return;
  const ord = rankColOrder();
  const from = ord.indexOf(key);
  if(from<0) return;
  ord.splice(from,1);
  let at = beforeKey!=null ? ord.indexOf(beforeKey) : ord.length;
  if(at<0) at = ord.length;
  ord.splice(Math.max(at, 1), 0, key);   // index 0 is forever ECR
  rankColPrefs.order = ord;
  _rcCommit();
}

// Reorder an Adv. Metrics column. Canonical advOrder = the table's current (prefs-applied)
// label sequence, with stored-but-not-in-view labels appended so other views keep theirs.
function rankAdvMove(label, beforeLabel){
  const ord=_rcHeadThs().filter(el=>el.getAttribute('data-rc-adv'))
    .map(el=>el.getAttribute('data-rc-adv'));
  ((rankColPrefs&&rankColPrefs.advOrder)||[]).forEach(l=>{ if(!ord.includes(l)) ord.push(l); });
  const i=ord.indexOf(label); if(i<0) return;
  ord.splice(i,1);
  let at=beforeLabel!=null?ord.indexOf(beforeLabel):-1;
  if(at<0) at=ord.length;
  ord.splice(at,0,label);
  rankColPrefs.advOrder=ord;
  _rcCommit();
}

function resetRankColPrefs(){
  rankColPrefs = { order: null, hidden: null, advOrder: null };   // null = the default-hidden set
  exitRankColEdit();
  if(typeof saveSession==='function') saveSession();
  if(typeof renderRankings==='function') renderRankings();
  if(typeof toast==='function') toast('Table layout reset ✓','ok');
}

function _rcCommit(){
  if(typeof saveSession==='function') saveSession();
  if(typeof renderRankings==='function') renderRankings();   // re-augments via the editor hook
}

// ── gesture wiring (delegated, bound once) ────────────────────────────────────────────
function _rcThFromEvent(e){
  const t=e.target;
  if(!t || !t.closest) return null;
  if(t.closest('.rc-x')) return null;              // the ✕ owns its own click
  return t.closest('.rankings-table thead th[data-rc], .rankings-table thead th[data-rcg], .rankings-table thead th[data-rc-adv]');
}

function _rcCancelLP(){
  if(_rcLP){ clearTimeout(_rcLP.timer); _rcLP=null; }
}

function _rcCancelDrag(){
  if(!_rcDrag) return;
  if(_rcDrag.raf) cancelAnimationFrame(_rcDrag.raf);
  if(_rcDrag.ghost) _rcDrag.ghost.remove();
  document.querySelectorAll('.rc-drop,.rc-drop-end').forEach(el=>el.classList.remove('rc-drop','rc-drop-end'));
  document.querySelectorAll('.rc-dragging').forEach(el=>el.classList.remove('rc-dragging'));
  _rcDrag=null;
}

function _rcStartDrag(th, e){
  const key = th.getAttribute('data-rc');
  const adv = th.getAttribute('data-rc-adv');
  if(adv==null && (!key || _rcIsLocked(key))) return;   // stat groups hide-only; locked cols inert
  const ghost=document.createElement('div');
  ghost.className='rc-ghost';
  ghost.textContent=(th.textContent||'').replace('✕','').trim();
  document.body.appendChild(ghost);
  th.classList.add('rc-dragging');
  _rcDrag={ key, adv, ghost, beforeKey:undefined, raf:0, px:e.clientX, py:e.clientY, th };
  try{ th.setPointerCapture && e.pointerId!=null && th.setPointerCapture(e.pointerId); }catch(_e){}
  _rcDragFrame();
}

function _rcDragFrame(){
  if(!_rcDrag) return;
  const d=_rcDrag;
  d.ghost.style.transform=`translate(${d.px+10}px, ${d.py-34}px)`;
  // Edge auto-scroll so a phone can drag a column across the whole strip.
  const wrap=document.querySelector('.rank-table-wrap');
  if(wrap){
    const r=wrap.getBoundingClientRect();
    if(d.px < r.left+36) wrap.scrollLeft -= 12;
    else if(d.px > r.right-36) wrap.scrollLeft += 12;
  }
  // Insertion target: the first header (of the dragged column's own segment) whose center
  // lies right of the pointer. A meta column reorders among meta columns; an adv metric
  // reorders among adv metrics. Rects re-read per frame only while dragging.
  const ths=_rcHeadThs().filter(el=> d.adv!=null ? el.getAttribute('data-rc-adv')
                                                 : el.getAttribute('data-rc'));
  let before=null, beforeEl=null, lastEl=null;
  const self = d.adv!=null ? d.adv : d.key;
  for(const el of ths){
    lastEl=el;
    const k = d.adv!=null ? el.getAttribute('data-rc-adv') : el.getAttribute('data-rc');
    if(k===self) continue;
    const r=el.getBoundingClientRect();
    if(before==null && d.px < r.left + r.width/2){ before=k; beforeEl=el; }
  }
  if(before!==d.beforeKey){
    document.querySelectorAll('.rc-drop,.rc-drop-end').forEach(el=>el.classList.remove('rc-drop','rc-drop-end'));
    if(beforeEl) beforeEl.classList.add('rc-drop');
    else if(lastEl) lastEl.classList.add('rc-drop-end');
    d.beforeKey=before;
  }
  d.raf=requestAnimationFrame(_rcDragFrame);
}

function _rcInstall(){
  if(typeof document==='undefined' || !document.addEventListener) return;
  document.addEventListener('pointerdown',(e)=>{
    const th=_rcThFromEvent(e);
    if(!th){
      // Tapping anywhere outside the header strip dismisses edit mode — but the ✕ badges and
      // the Done chip ARE the editor's own controls: dismissing on their pointerdown removed
      // them before their click could ever fire (the "✕ doesn't work" bug).
      if(rankColEditActive && e.target && e.target.closest && !e.target.closest('#rcDoneChip') && !e.target.closest('.rc-x')) exitRankColEdit();
      return;
    }
    if(rankColEditActive){
      e.preventDefault();
      _rcStartDrag(th, e);
      return;
    }
    _rcCancelLP();
    _rcLP={ x:e.clientX, y:e.clientY, timer:setTimeout(()=>{ _rcLP=null; enterRankColEdit(); }, RC_LP_MS) };
  }, true);
  document.addEventListener('pointermove',(e)=>{
    if(_rcLP && (Math.abs(e.clientX-_rcLP.x)>RC_LP_SLOP || Math.abs(e.clientY-_rcLP.y)>RC_LP_SLOP)) _rcCancelLP();
    if(_rcDrag){ _rcDrag.px=e.clientX; _rcDrag.py=e.clientY; e.preventDefault(); }
  }, {passive:false, capture:true});
  const up=(e)=>{
    _rcCancelLP();
    if(_rcDrag){
      const {key, adv, beforeKey}=_rcDrag;
      _rcCancelDrag();
      if(adv!=null) rankAdvMove(adv, beforeKey!=null?beforeKey:null);
      else rankColMove(key, beforeKey!=null?beforeKey:null);
    }
  };
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', ()=>{ _rcCancelLP(); _rcCancelDrag(); }, true);
  // iOS long-press callout / desktop context menu would hijack the hold gesture.
  document.addEventListener('contextmenu',(e)=>{
    if(e.target && e.target.closest && e.target.closest('.rankings-table thead')) e.preventDefault();
  });
  document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') exitRankColEdit(); });
}
_rcInstall();
