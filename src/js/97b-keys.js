// ── Keyboard shortcuts ────────────────────────────────────────────────────────
// One table drives both the handler and the help sheet (⌘/ or "?"), so they can
// never disagree. "Mod" is ⌘ on a Mac and Ctrl elsewhere. Nothing fires while
// you're typing in a field (Esc excepted), and bindings declare WHEN they apply
// — a card open, a team view, the rankings, the Game Center — so a key means one
// thing at a time. Every binding has an id; the sheet lets you click a key and
// press a new one, and the changes live on this device (localStorage) and win
// over the defaults. Bindings without a `run` (Mod+Z, the digits, Esc) are fixed.
const TC_IS_MAC = (typeof navigator!=='undefined' && /Mac|iPhone|iPad/.test(navigator.platform||'')) ||
                  (typeof navigator!=='undefined' && /Mac OS/.test(navigator.userAgent||''));
const TC_MOD_LABEL = TC_IS_MAC ? '⌘' : 'Ctrl';

const TC_TEAM_VIEWS = ['Passing','Receiving','Rushing','Advanced','Additions'];
function _keysCardOpen(){ return typeof pcardOpen!=='undefined' && !!pcardOpen && !!(typeof pcardState!=='undefined' && pcardState); }
function _keysInTeamView(){ return typeof currentPhase!=='undefined' && TC_TEAM_VIEWS.includes(currentPhase); }
function _keysInRankings(){ return typeof currentPhase!=='undefined' && currentPhase==='Rankings' && !_keysCardOpen(); }
function _keysInLeague(){ return typeof currentPhase!=='undefined' && currentPhase==='League' && !_keysCardOpen(); }
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

// ── Game Center helpers (the desktop right sidebar at its widest) ────────────
let _keysGcPrev='normal';   // the size the sidebar had before G opened the Game Center
function _keysGcOn(){
  return typeof ldOn==='function' && ldOn() && typeof _gc!=='undefined' && !_keysCardOpen()
    && !(typeof isMobileTeamPickerLayout==='function' && isMobileTeamPickerLayout());
}
function _keysGcOpen(){ return _keysGcOn() && _gc.mode==='max'; }
function _keysGcGames(){ return _keysGcOpen() && _gc.view!=='feed'; }
function _keysGcToggle(){
  if(typeof gcSetMode!=='function') return false;
  if(_gc.mode==='max'){ gcSetMode(_keysGcPrev==='max'?'normal':_keysGcPrev); }
  else { _keysGcPrev=_gc.mode; gcSetMode('max'); }
  return true;
}
function _keysGcView(){
  if(typeof gcSetView!=='function') return false;
  if(_gc.mode!=='max'){ _keysGcPrev=_gc.mode; gcSetMode('max'); }
  gcSetView(_gc.view==='feed'?'games':'feed');
  return true;
}
function _keysGcGameStep(dir){
  if(typeof gcGames!=='function' || typeof gcBoard!=='function' || typeof gcPick!=='function') return false;
  const board=gcBoard(gcWeek()); if(!board) return false;
  const games=gcGames(board); if(!games.length) return false;
  const cur=_gc.game || (typeof gcDefaultGame==='function' ? gcDefaultGame(games) : games[0].id);
  const i=Math.max(0, games.findIndex(g=>g.id===cur));
  gcPick(games[(i+dir+games.length)%games.length].id);
  return true;
}
function _keysGcWeekStep(dir){
  if(typeof gcSetWeek!=='function' || typeof gcWeek!=='function') return false;
  const last=(typeof gcLastWeek==='function') ? gcLastWeek() : 18;
  const next=Math.max(1, Math.min(last, gcWeek()+dir));
  if(next===gcWeek()) return false;
  gcSetWeek(next); return true;
}
function _keysGcTab(t){
  if(typeof gcdSetTab!=='function' || !_gc.game) return false;
  gcdSetTab(t); return true;
}
// Rankings: the position filter row, in its on-screen order.
const TC_KEYS_RANK_POS=['ALL','QB','RB','WR','TE','FLEX'];
function _keysRankPosStep(dir){
  if(typeof setPosFilter!=='function') return false;
  const cur=(typeof rankPosFilter!=='undefined') ? rankPosFilter : 'ALL';
  const i=Math.max(0, TC_KEYS_RANK_POS.indexOf(cur));
  setPosFilter(TC_KEYS_RANK_POS[(i+dir+TC_KEYS_RANK_POS.length)%TC_KEYS_RANK_POS.length]);
  return true;
}
function _keysRankPosIndex(n){
  if(typeof setPosFilter!=='function' || !TC_KEYS_RANK_POS[n-1]) return false;
  setPosFilter(TC_KEYS_RANK_POS[n-1]); return true;
}
// League analyzer: its tab row (Team · Rosters · Compare · Waivers · Trades · Season · Multi-League).
function _keysLaTabs(){ return [...document.querySelectorAll('.la-icon-tabs .phase-tab, .phase-tabs .phase-tab')]; }
function _keysLaTabStep(dir){
  const tabs=_keysLaTabs(); if(!tabs.length) return false;
  const i=Math.max(0, tabs.findIndex(b=>b.classList.contains('active')));
  tabs[(i+dir+tabs.length)%tabs.length].click();
  return true;
}
function _keysLaTabIndex(n){
  const tabs=_keysLaTabs(); if(!tabs[n-1]) return false;
  tabs[n-1].click(); return true;
}

// combo grammar: "Mod+F", "Shift+ArrowLeft", "[", "?" — key names as KeyboardEvent.key.
// A punctuation key that needs Shift on your layout ("?", "<", "{") is written as the
// character alone; the handler reads it the same way whether Shift is down or not.
const TC_KEYS=[
  // everywhere
  {id:'search',       combo:'Mod+F',       group:'Everywhere', label:'Search players (inside a card: open another player alongside)', run:_keysSearch},
  {id:'chat',         combo:'Mod+K',       group:'Everywhere', label:'Ask TripleCrown', run:()=>{ if(typeof openTcChat==='function'){ openTcChat(); return true; } }},
  {id:'compare',      combo:'Mod+Shift+C', group:'Everywhere', label:'Compare two players', run:()=>{ if(typeof openAiCompare==='function'){ openAiCompare(_keysCardOpen()?pcardState.pid:undefined); return true; } }},
  {id:'save',         combo:'Mod+S',       group:'Everywhere', label:'Save projections', run:()=>{ if(typeof tcSaveClick==='function'){ tcSaveClick(); return true; } }},
  {id:'manager',      combo:'Mod+O',       group:'Everywhere', label:'Open the projections Manager', run:()=>{ if(typeof tcOpenManager==='function'){ tcOpenManager(); return true; } }},
  {id:'import',       combo:'Mod+I',       group:'Everywhere', label:'Import projections', run:()=>{ if(typeof triggerImport==='function'){ triggerImport(); return true; } }},
  {id:'download',     combo:'Mod+D',       group:'Everywhere', label:'Download projections', run:()=>{ if(typeof menuDownloadPrompt==='function'){ menuDownloadPrompt(); return true; } }},
  {id:'undo',         combo:'Mod+Z',       group:'Everywhere', label:'Undo the last edit (team views)', run:null},   // lives in tcUndoHotkey; listed for the sheet
  {id:'menu',         combo:'Mod+M',       group:'Everywhere', label:'Open the ☰ menu', run:()=>{ if(typeof toggleAppMenu==='function'){ toggleAppMenu(); return true; } }},
  {id:'view-proj',    combo:'Mod+1',       group:'Everywhere', label:'Projections view', run:()=>{ if(typeof showProjectionsView==='function'){ showProjectionsView(); return true; } }},
  {id:'view-rank',    combo:'Mod+2',       group:'Everywhere', label:'Rankings view', run:()=>{ if(typeof showFullRankings==='function'){ showFullRankings(); return true; } }},
  {id:'view-league',  combo:'Mod+3',       group:'Everywhere', label:'Leagues view', run:()=>{ if(typeof openLeagueAnalyzer==='function'){ openLeagueAnalyzer(); return true; } }},
  {id:'escape',       combo:'Escape',      group:'Everywhere', label:'Close what is on top (popover, card, chat, modal, menu)', run:tcKeysEscape, whileTyping:true, fixed:true},
  {id:'help',         combo:'?',           group:'Everywhere', label:'This sheet', run:()=>{ tcKeysHelp(); return true; }},
  {id:'help2',        combo:'Mod+/',       group:'Everywhere', label:'This sheet', run:()=>{ tcKeysHelp(); return true; }, hidden:true},
  // game center (desktop sidebar)
  {id:'gc-toggle',    combo:'G',           group:'Game Center', label:'Open / close the Game Center (the sidebar at its widest)', when:_keysGcOn, run:_keysGcToggle},
  {id:'gc-view',      combo:'V',           group:'Game Center', label:'Games ⇄ Live feed', when:_keysGcOn, run:_keysGcView},
  {id:'gc-prev-game', combo:'<',           group:'Game Center', label:'Previous game', when:_keysGcGames, run:()=>_keysGcGameStep(-1)},
  {id:'gc-next-game', combo:'>',           group:'Game Center', label:'Next game', when:_keysGcGames, run:()=>_keysGcGameStep(1)},
  {id:'gc-prev-week', combo:'{',           group:'Game Center', label:'Previous week', when:_keysGcOpen, run:()=>_keysGcWeekStep(-1)},
  {id:'gc-next-week', combo:'}',           group:'Game Center', label:'Next week', when:_keysGcOpen, run:()=>_keysGcWeekStep(1)},
  {id:'gc-feed',      combo:'F',           group:'Game Center', label:'The game\'s Feed tab', when:_keysGcGames, run:()=>_keysGcTab('feed')},
  {id:'gc-stats',     combo:'S',           group:'Game Center', label:'The game\'s Stats tab', when:_keysGcGames, run:()=>_keysGcTab('stats')},
  // rankings
  {id:'rank-pos-next',combo:'P',           group:'Rankings', label:'Next position filter (ALL → QB → RB → WR → TE → FLEX)', when:_keysInRankings, run:()=>_keysRankPosStep(1)},
  {id:'rank-pos-prev',combo:'Shift+P',     group:'Rankings', label:'Previous position filter', when:_keysInRankings, run:()=>_keysRankPosStep(-1)},
  {id:'rank-pos-n',   combo:'1-6',         group:'Rankings', label:'Jump to a position filter', when:_keysInRankings, run:null},
  // league analyzer
  {id:'la-prev-tab',  combo:'[',           group:'Leagues', label:'Previous tab (Team · Rosters · Compare · Waivers · Trades · Season · Multi-League)', when:_keysInLeague, run:()=>_keysLaTabStep(-1)},
  {id:'la-next-tab',  combo:']',           group:'Leagues', label:'Next tab', when:_keysInLeague, run:()=>_keysLaTabStep(1)},
  {id:'la-tab-n',     combo:'1-7',         group:'Leagues', label:'Jump to a tab', when:_keysInLeague, run:null},
  // team views
  {id:'team-prev',    combo:'[',           group:'Team views', label:'Previous team', when:()=>_keysInTeamView() && !_keysCardOpen(), run:()=>_keysTeamStep(-1)},
  {id:'team-next',    combo:']',           group:'Team views', label:'Next team', when:()=>_keysInTeamView() && !_keysCardOpen(), run:()=>_keysTeamStep(1)},
  {id:'season-prev',  combo:',',           group:'Team views', label:'Previous season tab', when:()=>!_keysCardOpen(), run:()=>_keysSeasonStep(-1)},
  {id:'season-next',  combo:'.',           group:'Team views', label:'Next season tab', when:()=>!_keysCardOpen(), run:()=>_keysSeasonStep(1)},
  // player card
  {id:'card-prev',    combo:'ArrowLeft',   group:'Player card', label:'Previous player tab', when:_keysCardOpen, run:()=>_keysDockStep(-1)},
  {id:'card-next',    combo:'ArrowRight',  group:'Player card', label:'Next player tab', when:_keysCardOpen, run:()=>_keysDockStep(1)},
  {id:'card-stat-prev', combo:'Shift+ArrowLeft',  group:'Player card', label:'Previous stats tab (NFL / College / charts)', when:_keysCardOpen, run:()=>_keysStatTabStep(-1)},
  {id:'card-stat-next', combo:'Shift+ArrowRight', group:'Player card', label:'Next stats tab', when:_keysCardOpen, run:()=>_keysStatTabStep(1)},
  {id:'card-stat-n',  combo:'1-7',         group:'Player card', label:'Jump to a stats tab', when:_keysCardOpen, run:null},
  {id:'card-alongside', combo:'Mod+T',     group:'Player card', label:'Open another player alongside', when:_keysCardOpen, run:()=>{ if(typeof pcardDockAddOpen==='function'){ pcardDockAddOpen(); return true; } }},
  {id:'card-close',   combo:'Mod+W',       group:'Player card', label:'Close this player tab', when:_keysCardOpen, run:()=>{ if(typeof _pcardDock!=='undefined' && _pcardDock.length>1 && typeof pcardDockClose==='function'){ pcardDockClose(_pcardDockActive); return true; } if(typeof closePlayerCard==='function'){ closePlayerCard(); return true; } }},
  {id:'card-notes',   combo:'N',           group:'Player card', label:'Notes', when:_keysCardOpen, run:()=>{ if(typeof openPcardNotes==='function'){ openPcardNotes(); return true; } }},
];

// ── Your own keys ────────────────────────────────────────────────────────────
// {id: combo} — '' means "no key". Only what differs from the defaults is stored.
const TC_KEYS_STORE='tc_keys_v1';
let _keysUser={};
function tcKeysLoad(){
  try{ const raw=localStorage.getItem(TC_KEYS_STORE); const o=raw?JSON.parse(raw):null; _keysUser=(o && typeof o==='object')?o:{}; }catch(e){ _keysUser={}; }
}
function tcKeysSave(){
  try{ if(Object.keys(_keysUser).length) localStorage.setItem(TC_KEYS_STORE, JSON.stringify(_keysUser)); else localStorage.removeItem(TC_KEYS_STORE); }catch(e){}
}
function tcKeysById(id){ return TC_KEYS.find(b=>b.id===id)||null; }
function tcKeysEditable(b){ return !!(b && b.run && !b.fixed); }
// The key a binding answers to right now: yours if you set one, else the default.
function tcKeyFor(b){ return (b && Object.prototype.hasOwnProperty.call(_keysUser, b.id)) ? _keysUser[b.id] : (b ? b.combo : ''); }
function tcKeysIsCustom(b){ return !!b && Object.prototype.hasOwnProperty.call(_keysUser, b.id); }
// Two bindings collide when they answer to the same key and could both apply at once:
// the same group, or either of them is an Everywhere key.
function _keysCollide(a, b){ return a!==b && (a.group===b.group || a.group==='Everywhere' || b.group==='Everywhere'); }
function tcKeysSet(id, combo){
  const b=tcKeysById(id); if(!tcKeysEditable(b)) return false;
  combo=String(combo||'');
  if(combo){
    TC_KEYS.forEach(o=>{ if(tcKeysEditable(o) && _keysCollide(o,b) && tcKeyFor(o)===combo) _keysUser[o.id]=''; });   // the other binding lets go of the key
  }
  if(combo===b.combo) delete _keysUser[id]; else _keysUser[id]=combo;
  _keysLastId=id;
  tcKeysSave(); _keysRerender();
  return true;
}
function tcKeysReset(id){
  if(id){ delete _keysUser[id]; _keysLastId=id; } else { _keysUser={}; }
  tcKeysSave(); _keysRerender();
}
tcKeysLoad();

function tcKeyCombo(e){
  const parts=[];
  if(e.metaKey||e.ctrlKey) parts.push('Mod');
  let k=String(e.key||'');
  const punct = k.length===1 && !/[a-z0-9 ]/i.test(k);   // "?", "<", "{": the character already says Shift
  if(e.shiftKey && !punct) parts.push('Shift');
  if(e.altKey) parts.push('Alt');
  if(k.length===1) k = /[a-z]/i.test(k) ? k.toUpperCase() : k;
  if(k===' ') k='Space';
  parts.push(k);
  return parts.join('+');
}
// "?" arrives as Shift+/ on some layouts.
function tcKeyMatch(e, combo){
  const c=tcKeyCombo(e);
  if(combo===c) return true;
  if(combo==='?' && e.shiftKey && (c==='?' || c==='/')) return true;
  return false;
}
// Digits with no modifier: the card's stats tabs, the rankings' position filters, the analyzer's tabs.
function _keysDigit(n){
  if(_keysCardOpen()) return _keysStatTabIndex(n);
  if(_keysInRankings()) return _keysRankPosIndex(n);
  if(_keysInLeague()) return _keysLaTabIndex(n);
  return false;
}
const TC_KEYS_MODIFIERS=new Set(['Shift','Meta','Control','Alt','AltGraph','CapsLock','OS','Fn','Hyper','Super']);
function tcKeyHandle(e){
  if(!e) return false;
  // waiting for the new key of a binding being edited in the sheet
  if(_keysCapturing){
    const k=String(e.key||'');
    if(TC_KEYS_MODIFIERS.has(k)) return true;                              // a modifier alone: keep waiting
    if(e.preventDefault) e.preventDefault(); if(e.stopPropagation) e.stopPropagation();
    const id=_keysCapturing; _keysCapturing=null;
    if(k==='Escape'){ _keysRerender(); return true; }                        // cancel
    if(k==='Backspace'||k==='Delete'){ tcKeysReset(id); return true; }        // back to the default
    tcKeysSet(id, tcKeyCombo(e));
    return true;
  }
  const typing=_keysTyping(e);
  const c=tcKeyCombo(e);
  if(!typing && /^[1-7]$/.test(c)){ if(_keysDigit(+c)){ e.preventDefault&&e.preventDefault(); return true; } }
  for(const b of TC_KEYS){
    if(!b.run) continue;
    const combo=tcKeyFor(b); if(!combo) continue;
    if(!tcKeyMatch(e, combo)) continue;
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
let _keysCapturing=null;   // the id whose key is being changed
function tcKeysLabel(combo){
  return combo.replace('Mod', TC_MOD_LABEL).replace('Shift', TC_IS_MAC?'⇧':'Shift').replace('ArrowLeft','←').replace('ArrowRight','→').replace('Escape','Esc').replace('Backspace','⌫');
}
function _keysKbdHTML(combo){
  if(!combo) return '<kbd class="tc-keys-none">—</kbd>';
  return combo.split('+').map(k=>`<kbd>${escHtml(tcKeysLabel(k))}</kbd>`).join('<i>+</i>');
}
function _keysRowHTML(b){
  const combo=tcKeyFor(b), custom=tcKeysIsCustom(b), editable=tcKeysEditable(b), capturing=_keysCapturing===b.id;
  const cls='tc-keys-row'+(custom?' custom':'')+(capturing?' capturing':'')+(editable?'':' fixed');
  const keys = capturing ? '<span class="tc-keys-wait">press a key…</span>' : _keysKbdHTML(combo);
  const btn = editable
    ? `<button type="button" class="tc-keys-k" onclick="tcKeysCapture('${b.id}')" title="${capturing?'Esc cancels · ⌫ restores the default':'Click, then press the new key'}">${keys}</button>`
    : `<span class="tc-keys-k" title="Fixed">${keys}</span>`;
  const reset = (custom && !capturing) ? `<button type="button" class="tc-keys-reset" onclick="tcKeysReset('${b.id}')" title="Back to ${escHtml(tcKeysLabel(b.combo))}">↺</button>` : '';
  return `<div class="${cls}" data-id="${b.id}">${btn}<span class="tc-keys-l">${escHtml(b.label)}</span>${reset}</div>`;
}
function _keysSheetHTML(){
  const groups={};
  TC_KEYS.filter(b=>!b.hidden).forEach(b=>{ (groups[b.group]=groups[b.group]||[]).push(b); });
  const body=Object.keys(groups).map(g=>`<div class="tc-keys-group"><div class="tc-keys-g">${escHtml(g)}</div>${groups[g].map(_keysRowHTML).join('')}</div>`).join('');
  const any=Object.keys(_keysUser).length>0;
  const foot=`<div class="tc-keys-foot"><span>Click a key to change it · Esc cancels · ⌫ restores the default</span>${any?'<button type="button" class="tc-keys-resetall" onclick="tcKeysReset()">Reset all</button>':''}</div>`;
  return body+foot;
}
let _keysLastId=null;   // the row last touched, kept in view across re-renders
function _keysRerender(){
  const host=document.querySelector('.tc-keys-overlay .tc-keys-body');
  if(!host) return;
  host.innerHTML=_keysSheetHTML();
  const row=host.querySelector('.tc-keys-row.capturing') || (_keysLastId && host.querySelector(`.tc-keys-row[data-id="${_keysLastId}"]`));
  try{ if(row && row.scrollIntoView) row.scrollIntoView({block:'nearest'}); }catch(e){}
}
function tcKeysCapture(id){
  const b=tcKeysById(id); if(!tcKeysEditable(b)) return;
  _keysCapturing = (_keysCapturing===id) ? null : id;
  _keysLastId=id;
  _keysRerender();
}
function tcKeysHelp(){
  const old=document.querySelector('.tc-keys-overlay'); if(old){ old.remove(); _keysCapturing=null; return; }
  const div=document.createElement('div');
  div.className='tc-modal-overlay tc-keys-overlay';
  div.innerHTML=`<div class="tc-modal tc-modal-sm tc-keys" role="dialog" aria-label="Keyboard shortcuts">
    <div class="tc-modal-head"><span class="tc-modal-title">Keyboard shortcuts</span><button class="tc-modal-close" onclick="tcKeysHelp()" aria-label="Close">✕</button></div>
    <div class="tc-keys-body">${_keysSheetHTML()}</div></div>`;
  div.onclick=(e)=>{ if(e.target===div) tcKeysHelp(); };
  document.body.appendChild(div);
}
