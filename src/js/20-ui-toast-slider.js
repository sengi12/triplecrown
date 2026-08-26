// ─────────────────────────────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────────────────────────────
// ── Scroll containment for floating surfaces ─────────────────────────────────
// While a popup or modal is at the forefront, swiping/wheeling must never move the page
// behind it. One document-level guard instead of per-popup lock bookkeeping: any scroll
// gesture that doesn't land in a genuinely scrollable region of a floating surface is
// cancelled. (Each region's own overscroll-behavior:contain keeps edge-scrolls from
// chaining once the region runs out of room.)
const TC_FLOAT_SEL='.pcard-overlay,.scheme-overlay,.ps-overlay,.note-picker-overlay,.note-info-overlay,.tc-modal-overlay,#vonaOptPop,#tcInjPop,#tcInfoPop';
var _tcLastTouchY=null, _tcGestureFloaters=null;
function _tcTouchAnchor(e){
  const t=e.touches&&e.touches[0]; _tcLastTouchY=t?t.clientY:null;
  // Resolve the visible floating surfaces ONCE per gesture — running a 9-selector
  // querySelectorAll on every touchmove is wasted work on a phone mid-scroll.
  let fl=[];
  try{ document.querySelectorAll(TC_FLOAT_SEL).forEach(f=>{ if(f.offsetWidth||f.offsetHeight) fl.push(f); }); }catch(_e){}
  _tcGestureFloaters=fl;
}
// Can anything between `el` and the page actually scroll this gesture? (Used to decide
// whether a touch would land on the PAGE scroller — the one we edge-guard on iOS.)
function _tcInInnerScroller(el){
  let n=(el && el.nodeType===1)?el:(el&&el.parentElement);
  while(n && n!==document.body && n!==document.documentElement){
    if(n.scrollHeight>n.clientHeight+1 || n.scrollWidth>n.clientWidth+1){
      let st=null; try{ st=getComputedStyle(n); }catch(_e){}
      if(st && (/(auto|scroll)/.test(st.overflowY) || /(auto|scroll)/.test(st.overflowX))) return true;
    }
    n=n.parentElement;
  }
  return false;
}
function _tcScrollGuard(e){
  // Only VISIBLE floating surfaces count — an overlay some path left hidden in the DOM
  // must never freeze the page. Touch gestures reuse the touchstart snapshot; wheel
  // events (no gesture anchor) resolve fresh.
  let floaters;
  if(e.type==='touchmove' && _tcGestureFloaters){ floaters=_tcGestureFloaters; }
  else {
    floaters=[];
    try{ document.querySelectorAll(TC_FLOAT_SEL).forEach(f=>{ if(f.offsetWidth||f.offsetHeight) floaters.push(f); }); }catch(_e){ return; }
  }
  if(!floaters.length){
    // No popup up. One job remains, touch only: cancel iOS rubber-banding — a pull past
    // either page edge that no inner scroller claims. Never cancel an in-range scroll.
    if(e.type!=='touchmove' || _tcLastTouchY==null) return;
    const t0=e.touches&&e.touches[0]; if(!t0) return;
    const dy=t0.clientY-_tcLastTouchY; _tcLastTouchY=t0.clientY;
    if(!dy || _tcInInnerScroller(e.target)) return;
    const sc=document.scrollingElement||document.documentElement;
    const atTop=sc.scrollTop<=0, atBottom=sc.scrollTop+window.innerHeight>=sc.scrollHeight-1;
    if((atTop && dy>0) || (atBottom && dy<0)){ if(e.cancelable) e.preventDefault(); }
    return;
  }
  const t=e.target;
  let within=null;
  floaters.forEach(f=>{ if(f.contains(t)) within=f; });
  if(!within){ if(e.cancelable) e.preventDefault(); return; }
  // Inside the surface: fine as long as the gesture lands in something that can actually
  // scroll (either axis — cards hold horizontally-scrolling tables).
  let n=(t && t.nodeType===1)?t:(t&&t.parentElement);
  while(n){
    const canY=n.scrollHeight>n.clientHeight+1, canX=n.scrollWidth>n.clientWidth+1;
    if(canY||canX){
      let st=null; try{ st=getComputedStyle(n); }catch(_e){}
      if(st && ((canY && /(auto|scroll)/.test(st.overflowY)) || (canX && /(auto|scroll)/.test(st.overflowX)))) return;
    }
    if(n===within) break;
    n=n.parentElement;
  }
  if(e.cancelable) e.preventDefault();
}
try{
  document.addEventListener('touchstart',_tcTouchAnchor,{passive:true});
  document.addEventListener('touchmove',_tcScrollGuard,{passive:false});
  document.addEventListener('wheel',_tcScrollGuard,{passive:false});
}catch(_e){}

// ─────────────────────────────────────────────────────────────────────────────
// The ⓘ system: methodology / source / caveat prose lives in popups, not in the
// layout. Views render one small round button; the words appear on demand and
// stay inside the window. Register copy in TC_INFO_BOOK (title + html body).
// ─────────────────────────────────────────────────────────────────────────────
const TC_INFO_BOOK={};
function tcInfoBtn(key, label, icon){
  if(!TC_INFO_BOOK[key]) return '';
  return `<button class="tc-info-btn ${icon?'tc-info-ico':''}" onclick="tcInfoPop(event,'${key}')" title="${escAttr(label||'What am I looking at?')}" aria-label="${escAttr(label||'About this section')}">${icon||'i'}</button>`;
}
var _infoPopOff=null;
function tcInfoPop(ev, key){
  try{ ev.stopPropagation(); }catch(e){}
  const old=document.getElementById('tcInfoPop');
  if(old){
    old.remove();
    if(_infoPopOff){ try{ document.removeEventListener('click',_infoPopOff,true); }catch(e){} _infoPopOff=null; }
    if(old.dataset && old.dataset.key===key) return;   // same button again = toggle closed
  }
  const info=TC_INFO_BOOK[key]; if(!info) return;
  const div=document.createElement('div');
  div.id='tcInfoPop'; div.className='tc-info-pop';
  if(div.dataset) div.dataset.key=key;
  const body=(typeof info.body==='function')?info.body():info.body;
  div.innerHTML=`<div class="tc-info-head"><b>${info.title||''}</b>
      <button class="tc-info-close" onclick="tcInfoPop(event,'${key}')" aria-label="Close">✕</button></div>
    <div class="tc-info-body">${body||''}</div>`;
  document.body.appendChild(div);
  const r=(ev.target&&ev.target.getBoundingClientRect)?ev.target.getBoundingClientRect():{left:20,right:40,top:60,bottom:80};
  const pw=div.offsetWidth||280, ph=div.offsetHeight||120;
  const vw=window.innerWidth||360, vh=window.innerHeight||640;
  div.style.left=Math.max(8, Math.min(vw-pw-8, r.left))+'px';
  div.style.top=(r.bottom+6+ph>vh ? Math.max(8, r.top-ph-6) : r.bottom+6)+'px';
  setTimeout(()=>{ const off=(e)=>{
      if(e.target && e.target.closest && e.target.closest('.tc-info-btn')) return;   // buttons manage their own toggle
      if(!div.contains(e.target)){ div.remove(); document.removeEventListener('click',off,true); if(_infoPopOff===off) _infoPopOff=null; } };
    _infoPopOff=off; document.addEventListener('click',off,true); },0);
}

function toast(msg,type=''){
  const el=document.getElementById('toast');
  el.textContent=msg;
  el.style.borderColor=type==='ok'?'var(--success)':type==='err'?'var(--danger)':'var(--border)';
  el.classList.add('show');
  clearTimeout(el._t);
  el._t=setTimeout(()=>el.classList.remove('show'),2800);
}

function mkDelta(cur,base,invert){
  const d=+cur-+base;
  if(Math.abs(d)<0.05) return '';
  const s=d>0?'+':'',v=Math.abs(d)<10?d.toFixed(1):Math.round(d);
  // For "bad" stats (interceptions, fumbles) an increase should read RED, not green.
  const good = invert ? (d<0) : (d>0);
  return `<span class="${good?'delta-up':'delta-dn'}">${s}${v}</span>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Slider scale (every width)
// The full stat domain makes small values nearly impossible to work with — a 22%
// target share lives in the first fifth of a 0–100 track. Compress the draggable
// range to realistic headroom (a 30% share reads as an almost-full bar, which is
// the honest picture). Typed values may exceed the visual cap: the bar pins full
// and the next paint rescales around it.
// ─────────────────────────────────────────────────────────────────────────────
function tcNiceCeil(v){
  if(!(v>0)) return 0;
  const p=Math.pow(10, Math.floor(Math.log10(v)));
  for(const m of [1,1.5,2,2.5,3,4,5,6,8,10]){ if(m*p>=v) return m*p; }
  return 10*p;
}
function tcSliderScaleMax(cur, base, staticMax, floorCap){
  const v=Math.max(Number(cur)||0, Number(base)||0);
  let cap=Math.max(Number(floorCap)||0, tcNiceCeil(v*1.35), staticMax*0.12);
  return Math.min(staticMax, cap);
}

// ─────────────────────────────────────────────────────────────────────────────
// Slider fill (div overlay, pixel-perfect)
// ─────────────────────────────────────────────────────────────────────────────
function setFill(el,color){
  const min=parseFloat(el.min)||0,max=parseFloat(el.max)||100,v=parseFloat(el.value)||0;
  const pct=Math.max(0,Math.min(100,(v-min)/(max-min)*100));
  const fill=el.previousElementSibling;
  if(fill&&fill.classList.contains('slider-fill')){
    fill.style.width=pct+'%';
    if(color) fill.style.background=color;
  }
}

function initSliders(){
  document.querySelectorAll('input.sl').forEach(el=>{
    setFill(el,el.dataset.col||null);
    el.oninput=function(){ setFill(this,this.dataset.col||null); handleSlider(this); };
    // A fresh grab = a fresh undo step, even on the same slider twice in a row.
    el.onpointerdown=function(){ clearUndoCoalesce(); };
    el.onkeydown=function(){ clearUndoCoalesce(); };
    // Resort the player list only when the user releases the slider (avoids glitchy
    // reordering mid-drag). 'change' fires on pointer-up / keyboard commit — but a drag
    // returned to its start value fires NO change event, so pointerup is the safety net
    // that always ends the drag session.
    el.onchange=function(){ resortAfterRelease(this); };
    el.onpointerup=function(){ resortAfterRelease(this); };
  });
}
// Set true while a share slider is mid-drag so live updaters skip the DOM reorder.
let sliderDragging=false;
function resortAfterRelease(el){
  sliderDragging=false;
  clearUndoCoalesce();   // next drag starts a fresh undo step
  const key=el.dataset.key||'';
  const state=userProj[el.dataset.team]; if(!state) return;
  if(key.startsWith('ps_')) reorderShareBlocks('shareControls','pblk-',state.passing_shares,'share');
  else if(key.startsWith('tds_')) reorderShareBlocks('shareControls','pblk-',state.passing_shares,'td_share');
  else if(key.startsWith('rs_')) reorderShareBlocks('rushShareControls','rblk-',state.rushing.shares,'share');
  else if(key.startsWith('rtds_')) reorderShareBlocks('rushShareControls','rblk-',state.rushing.shares,'td_share');
}

// ─────────────────────────────────────────────────────────────────────────────
// Slider row builders
// ─────────────────────────────────────────────────────────────────────────────
function sRow(key,label,cur,base,min,max,step,col,invert,opts){
  opts=opts||{};
  const readOnly=!!opts.readOnly;
  const noteMeta=opts.noteMeta||null;
  col=col||'var(--accent)';
  const markerV=(opts.paceMarker&&Number.isFinite(opts.paceMarker.value))?opts.paceMarker.value:0;
  const effMax=tcSliderScaleMax(Math.max(cur,markerV), base, max, opts.floorCap);
  const pct=Math.max(0,Math.min(100,(cur-min)/(effMax-min)*100));
  const disp=(step<1&&cur%1!==0)?(+cur).toFixed(2):Math.round(cur*10)/10;
  const bDisp=(step<1&&base%1!==0)?(+base).toFixed(2):Math.round(+base);
  const curHtml = readOnly
    ? (noteMeta
      ? noteWrapHtml(`<span class="stat-current" id="sv-${key}">${disp}</span>`, Object.assign({}, noteMeta, {value:String(disp)}), 'note-tag-hit')
      : `<span class="stat-current" id="sv-${key}">${disp}</span>`)
    : `<span class="stat-current" id="sv-${key}" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="manualEdit('${key}',this.textContent,${min},${max})"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">${disp}</span>`;
  return `<div class="stat-row" id="row-${key}" data-invert="${invert?1:0}">
    <div class="stat-header">
      <span class="stat-label">${label}</span>
      <div class="stat-val-group">
        ${curHtml}
        <span class="stat-baseline">/ ${bDisp}</span>
        <span id="sd-${key}">${mkDelta(cur,base,invert)}</span>
      </div>
    </div>
    <div class="slider-track">
      <div class="slider-fill" style="width:${pct}%;background:${col}"></div>
      ${opts.paceMarker&&Number.isFinite(opts.paceMarker.value)?`<div class="pace-marker ${opts.paceMarker.cls||''}" style="left:${Math.max(0,Math.min(100,(opts.paceMarker.value-min)/(effMax-min)*100)).toFixed(1)}%" title="${escAttr(opts.paceMarker.title||'')}"></div>`:''}
      <input class="sl" type="range" min="${min}" max="${effMax}" step="${step}" value="${cur}"
        data-key="${key}" data-team="${currentTeam}" data-col="${col}" style="--col:${col}"${readOnly?' disabled':''}>
    </div>
    <div class="slider-labels"><span>${min}</span><span>${effMax}</span></div>
  </div>`;
}
function selAll(el){
  // Snapshot the team before this field is edited, so a single edit is one undo step.
  // Coalesced per element so re-selecting the same field doesn't stack duplicates.
  pushUndo(currentTeam, 'edit:'+(el.id||el.getAttribute('onblur')||'field'), 'field edit');
  setTimeout(()=>{ const r=document.createRange();r.selectNodeContents(el);
    const s=window.getSelection();s.removeAllRanges();s.addRange(r);},0);
}
function manualEdit(key,raw,min,max){
  const v=parseFloat(raw);
  if(isNaN(v)){ renderContent(); return; }
  const clamped=Math.max(min,Math.min(max,v));
  const sl=document.querySelector(`input.sl[data-key="${key}"]`);
  if(sl){ sl.value=clamped; setFill(sl,sl.dataset.col||null); handleSliderKey(key,clamped,currentTeam,true); }
  else { handleSliderKey(key,clamped,currentTeam,true); }
}


