// ─────────────────────────────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────────────────────────────
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
    // Resort the player list only when the user releases the slider (avoids glitchy
    // reordering mid-drag). 'change' fires on pointer-up / keyboard commit.
    el.onchange=function(){ resortAfterRelease(this); };
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
function sRow(key,label,cur,base,min,max,step,col,invert){
  col=col||'var(--accent)';
  const pct=Math.max(0,Math.min(100,(cur-min)/(max-min)*100));
  const disp=(step<1&&cur%1!==0)?(+cur).toFixed(2):Math.round(cur*10)/10;
  const bDisp=(step<1&&base%1!==0)?(+base).toFixed(2):Math.round(+base);
  return `<div class="stat-row" id="row-${key}" data-invert="${invert?1:0}">
    <div class="stat-header">
      <span class="stat-label">${label}</span>
      <div class="stat-val-group">
        <span class="stat-current" id="sv-${key}" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="manualEdit('${key}',this.textContent,${min},${max})"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">${disp}</span>
        <span class="stat-baseline">/ ${bDisp}</span>
        <span id="sd-${key}">${mkDelta(cur,base,invert)}</span>
      </div>
    </div>
    <div class="slider-track">
      <div class="slider-fill" style="width:${pct}%;background:${col}"></div>
      <input class="sl" type="range" min="${min}" max="${max}" step="${step}" value="${cur}"
        data-key="${key}" data-team="${currentTeam}" data-col="${col}" style="--col:${col}">
    </div>
    <div class="slider-labels"><span>${min}</span><span>${max}</span></div>
  </div>`;
}
function selAll(el){
  // Snapshot the team before this field is edited, so a single edit is one undo step.
  // Coalesced per element so re-selecting the same field doesn't stack duplicates.
  pushUndo(currentTeam, 'edit:'+(el.id||el.getAttribute('onblur')||'field'));
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


