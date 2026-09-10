// ── Keyboard shortcuts ────────────────────────────────────────────────────────
// One table drives both the handler and the help sheet (⌘/ or "?"), so they can
// never disagree. "Mod" is ⌘ on a Mac and Ctrl elsewhere. Nothing fires while
// you're typing in a field (Esc excepted), and bindings declare WHEN they apply
// — a card open, a team view, the rankings — so a key means one thing at a time.
const TC_IS_MAC = (typeof navigator!=='undefined' && /Mac|iPhone|iPad/.test(navigator.platform||'')) ||
                  (typeof navigator!=='undefined' && /Mac OS/.test(navigator.userAgent||''));
const TC_MOD_LABEL = TC_IS_MAC ? '⌘' : 'Ctrl';

const TC_TEAM_VIEWS = ['Passing','Receiving','Rushing','Advanced','Additions'];
function _keysCardOpen(){ return typeof pcardOpen!=='undefined' && !!pcardOpen && !!(typeof pcardState!=='undefined' && pcardState); }
function _keysInTeamView(){ return typeof currentPhase!=='undefined' && TC_TEAM_VIEWS.includes(currentPhase); }
function _keysTyping(e){
  const t=e && e.target;
  return !!(t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName||'')));
}
// The topmost thing that can be dismissed, and its close control.
function _keysTopOverlay(){
  const sel='.pcard-addpop,.pcard-overlay,.scheme-overlay,.ps-overlay,.note-picker-overlay,.note-info-overlay,.tc-modal-overlay,.tc-keys-overlay,[class*="-overlay"]';
  const all=[...document.querySelectorAll(sel)].filter(el=>el && (el.offsetWidth||el.offsetHeight||el.getClientRects().length));
  return all.length ? all[all.length-1] : null;
}
function tcKeysEscape(){
  // the ＋ popover inside a card closes before the card does
  const pop=document.querySelector('#pcardOverlay .pcard-addpop');
  if(pop){ if(typeof pcardDockAddOpen==='function') pcardDockAddOpen(); else pop.remove(); return true; }
  if(typeof appMenuOpen!=='undefined' && appMenuOpen && typeof closeAppMenu==='function'){ closeAppMenu(); return true; }
  const menu=document.querySelector('.app-menu'); if(menu && !menu.hidden && typeof closeAppMenu==='function'){ closeAppMenu(); return true; }
  const ov=_keysTopOverlay();
  if(!ov) return false;
  const btn=ov.querySelector('[aria-label="Close"],.tc-modal-close,.pcard-close,.scheme-close,.ps-close,.note-picker-close,.note-info-close');
  if(btn){ btn.click(); return true; }
  if(ov.classList.contains('pcard-overlay') && typeof closePlayerCard==='function'){ closePlayerCard(); return true; }
  ov.remove(); return true;
}

// ── Dock + card helpers ──────────────────────────────────────────────────────
function _keysDockStep(dir){
  if(typeof _pcardDock==='undefined' || _pcardDock.length<2) return false;
  const i=_pcardDock.findIndex(t=>t.pid===_pcardDockActive);
  const n=(i+dir+_pcardDock.length)%_pcardDock.length;
  pcardDockGo(_pcardDock[n].pid);
  return true;
}
function _keysStatTabStep(dir){
  const tabs=[...document.querySelectorAll('#pcardTabs .pcard-tab')];
  if(!tabs.length) return false;
  const i=Math.max(0, tabs.findIndex(b=>b.classList.contains('active')));
  tabs[(i+dir+tabs.length)%tabs.length].click();
  return true;
}
function _keysStatTabIndex(n){
  const tabs=[...document.querySelectorAll('#pcardTabs .pcard-tab')];
  if(!tabs[n-1]) return false;
  tabs[n-1].click(); return true;
}
function _keysTeamStep(dir){
  const items=[...document.querySelectorAll('.sidebar .team-item')];
  const codes=items.map(el=>{ const m=/selectTeam\('([A-Z]{2,4})'\)/.exec(el.getAttribute('onclick')||''); return m?m[1]:null; }).filter(Boolean);
  const order=codes.length ? codes : (typeof TEAMS!=='undefined' ? TEAMS : []);
  if(!order.length || typeof selectTeam!=='function') return false;
  const i=Math.max(0, order.indexOf(currentTeam));
  selectTeam(order[(i+dir+order.length)%order.length]);
  return true;
}
function _keysSeasonStep(dir){
  const tabs=[...document.querySelectorAll('#seasonTabs .season-tab')].filter(b=>!b.classList.contains('mode-tab'));
  if(!tabs.length) return false;
  const i=Math.max(0, tabs.findIndex(b=>b.classList.contains('active')));
  tabs[(i+dir+tabs.length)%tabs.length].click();
  return true;
}
function _keysSearch(){
  if(_keysCardOpen() && typeof pcardDockAddOpen==='function'){ pcardDockAddOpen(); return true; }
  if(typeof openPlayerSearch==='function'){ openPlayerSearch(); return true; }
  return false;
}

// combo grammar: "Mod+F", "Shift+ArrowLeft", "[", "?" — key names as KeyboardEvent.key.
const TC_KEYS=[
  // everywhere
  {combo:'Mod+F',       group:'Everywhere', label:'Search players (inside a card: open another player alongside)', run:_keysSearch},
  {combo:'Mod+K',       group:'Everywhere', label:'Ask TripleCrown', run:()=>{ if(typeof openTcChat==='function'){ openTcChat(); return true; } }},
  {combo:'Mod+Shift+C', group:'Everywhere', label:'Compare two players', run:()=>{ if(typeof openAiCompare==='function'){ openAiCompare(_keysCardOpen()?pcardState.pid:undefined); return true; } }},
  {combo:'Mod+S',       group:'Everywhere', label:'Save projections', run:()=>{ if(typeof tcSaveClick==='function'){ tcSaveClick(); return true; } }},
  {combo:'Mod+O',       group:'Everywhere', label:'Open the projections Manager', run:()=>{ if(typeof tcOpenManager==='function'){ tcOpenManager(); return true; } }},
  {combo:'Mod+I',       group:'Everywhere', label:'Import projections', run:()=>{ if(typeof triggerImport==='function'){ triggerImport(); return true; } }},
  {combo:'Mod+D',       group:'Everywhere', label:'Download projections', run:()=>{ if(typeof menuDownloadPrompt==='function'){ menuDownloadPrompt(); return true; } }},
  {combo:'Mod+Z',       group:'Everywhere', label:'Undo the last edit (team views)', run:null},   // lives in tcUndoHotkey; listed for the sheet
  {combo:'Mod+M',       group:'Everywhere', label:'Open the ☰ menu', run:()=>{ if(typeof toggleAppMenu==='function'){ toggleAppMenu(); return true; } }},
  {combo:'Mod+1',       group:'Everywhere', label:'Projections view', run:()=>{ if(typeof showProjectionsView==='function'){ showProjectionsView(); return true; } }},
  {combo:'Mod+2',       group:'Everywhere', label:'Rankings view', run:()=>{ if(typeof showFullRankings==='function'){ showFullRankings(); return true; } }},
  {combo:'Mod+3',       group:'Everywhere', label:'Leagues view', run:()=>{ if(typeof openLeagueAnalyzer==='function'){ openLeagueAnalyzer(); return true; } }},
  {combo:'Escape',      group:'Everywhere', label:'Close what is on top (popover, card, chat, modal, menu)', run:tcKeysEscape, whileTyping:true},
  {combo:'?',           group:'Everywhere', label:'This sheet', run:()=>{ tcKeysHelp(); return true; }},
  {combo:'Mod+/',       group:'Everywhere', label:'This sheet', run:()=>{ tcKeysHelp(); return true; }, hidden:true},
  // team views
  {combo:'[',           group:'Team views', label:'Previous team', when:()=>_keysInTeamView() && !_keysCardOpen(), run:()=>_keysTeamStep(-1)},
  {combo:']',           group:'Team views', label:'Next team', when:()=>_keysInTeamView() && !_keysCardOpen(), run:()=>_keysTeamStep(1)},
  {combo:',',           group:'Team views', label:'Previous season tab', when:()=>!_keysCardOpen(), run:()=>_keysSeasonStep(-1)},
  {combo:'.',           group:'Team views', label:'Next season tab', when:()=>!_keysCardOpen(), run:()=>_keysSeasonStep(1)},
  // player card
  {combo:'ArrowLeft',   group:'Player card', label:'Previous player tab', when:_keysCardOpen, run:()=>_keysDockStep(-1)},
  {combo:'ArrowRight',  group:'Player card', label:'Next player tab', when:_keysCardOpen, run:()=>_keysDockStep(1)},
  {combo:'Shift+ArrowLeft',  group:'Player card', label:'Previous stats tab (NFL / College / charts)', when:_keysCardOpen, run:()=>_keysStatTabStep(-1)},
  {combo:'Shift+ArrowRight', group:'Player card', label:'Next stats tab', when:_keysCardOpen, run:()=>_keysStatTabStep(1)},
  {combo:'1-7',         group:'Player card', label:'Jump to a stats tab', when:_keysCardOpen, run:null},
  {combo:'Mod+T',       group:'Player card', label:'Open another player alongside', when:_keysCardOpen, run:()=>{ if(typeof pcardDockAddOpen==='function'){ pcardDockAddOpen(); return true; } }},
  {combo:'Mod+W',       group:'Player card', label:'Close this player tab', when:_keysCardOpen, run:()=>{ if(typeof _pcardDock!=='undefined' && _pcardDock.length>1 && typeof pcardDockClose==='function'){ pcardDockClose(_pcardDockActive); return true; } if(typeof closePlayerCard==='function'){ closePlayerCard(); return true; } }},
  {combo:'N',           group:'Player card', label:'Notes', when:_keysCardOpen, run:()=>{ if(typeof openPcardNotes==='function'){ openPcardNotes(); return true; } }},
];

function tcKeyCombo(e){
  const parts=[];
  if(e.metaKey||e.ctrlKey) parts.push('Mod');
  if(e.shiftKey) parts.push('Shift');
  if(e.altKey) parts.push('Alt');
  let k=String(e.key||'');
  if(k.length===1) k = /[a-z]/i.test(k) ? k.toUpperCase() : k;
  if(k===' ') k='Space';
  parts.push(k);
  return parts.join('+');
}
// "?" arrives as Shift+/ on most layouts; digits 1-7 map to the stats tabs.
function tcKeyMatch(e, combo){
  const c=tcKeyCombo(e);
  if(combo===c) return true;
  if(combo==='?' && (c==='?' || c==='Shift+?' || c==='Shift+/')) return true;
  return false;
}
function tcKeyHandle(e){
  if(!e) return false;
  const typing=_keysTyping(e);
  const c=tcKeyCombo(e);
  // digits → stats tabs (card open, not typing, no modifier)
  if(!typing && _keysCardOpen() && /^[1-7]$/.test(c)){ if(_keysStatTabIndex(+c)){ e.preventDefault&&e.preventDefault(); return true; } }
  for(const b of TC_KEYS){
    if(!b.run) continue;
    if(!tcKeyMatch(e, b.combo)) continue;
    if(typing && !b.whileTyping) continue;
    if(b.when && !b.when()) continue;
    let ok=false;
    try{ ok=!!b.run(); }catch(err){ ok=false; }
    if(ok){ if(e.preventDefault) e.preventDefault(); if(e.stopPropagation) e.stopPropagation(); return true; }
  }
  return false;
}
try{ document.addEventListener('keydown', tcKeyHandle); }catch(e){}

// ── The sheet ────────────────────────────────────────────────────────────────
function tcKeysLabel(combo){
  return combo.replace('Mod', TC_MOD_LABEL).replace('Shift', TC_IS_MAC?'⇧':'Shift').replace('ArrowLeft','←').replace('ArrowRight','→').replace('Escape','Esc');
}
function tcKeysHelp(){
  const old=document.querySelector('.tc-keys-overlay'); if(old){ old.remove(); return; }
  const groups={};
  TC_KEYS.filter(b=>!b.hidden).forEach(b=>{ (groups[b.group]=groups[b.group]||[]).push(b); });
  const body=Object.keys(groups).map(g=>`<div class="tc-keys-group"><div class="tc-keys-g">${escHtml(g)}</div>${groups[g].map(b=>`<div class="tc-keys-row"><span class="tc-keys-k">${b.combo.split('+').map(k=>`<kbd>${escHtml(tcKeysLabel(k))}</kbd>`).join('<i>+</i>')}</span><span class="tc-keys-l">${escHtml(b.label)}</span></div>`).join('')}</div>`).join('');
  const div=document.createElement('div');
  div.className='tc-modal-overlay tc-keys-overlay';
  div.innerHTML=`<div class="tc-modal tc-modal-sm tc-keys" role="dialog" aria-label="Keyboard shortcuts">
    <div class="tc-modal-head"><span class="tc-modal-title">Keyboard shortcuts</span><button class="tc-modal-close" onclick="this.closest('.tc-keys-overlay').remove()" aria-label="Close">✕</button></div>
    <div class="tc-keys-body">${body}</div></div>`;
  div.onclick=(e)=>{ if(e.target===div) div.remove(); };
  document.body.appendChild(div);
}
