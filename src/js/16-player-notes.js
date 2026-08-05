// ── Player notes + hidden stat tagging ─────────────────────────────────────
// Notes are keyed per player and live alongside the working projection session. A hidden
// long-press gesture on tagged stats opens a picker that lets the user attach that stat to a
// relevant player without cluttering the UI with visible controls.

const NOTE_HOLD_MS = 520;
const NOTE_MOVE_PX = 10;
let _notePickerState = null;
let _noteHoldState = null;
let _noteSuppressClickUntil = 0;
let _notesBrowserOpen = false;

function playerNoteCount(nameOrId, pos, team){
  const note = getPlayerNote(nameOrId, pos, team);
  if(!note) return 0;
  return (note.text && note.text.trim() ? 1 : 0) + ((note.tags && note.tags.length) || 0);
}

function noteTagAttrs(meta){
  if(!meta) return '';
  const attrs = [['data-noteable', '1']];
  const put = (k, v)=>{ if(v!=null && v!=='') attrs.push([k, String(v)]); };
  put('data-note-label', meta.label || 'Stat');
  put('data-note-value', meta.value);
  put('data-note-source', meta.source || 'app');
  put('data-note-context', meta.context || '');
  put('data-note-stat-key', meta.statKey || '');
  put('data-note-team', meta.team || '');
  put('data-note-relevance', Array.isArray(meta.relevance) ? meta.relevance.join(',') : (meta.relevance || ''));
  if(meta.nav) put('data-note-nav', JSON.stringify(meta.nav));
  const p = meta.player || null;
  if(p){
    put('data-note-player-id', p.player_id || p.pid || p.id || '');
    put('data-note-player-name', p.name || '');
    put('data-note-player-pos', p.pos || '');
    put('data-note-player-team', p.team || meta.team || '');
  }
  if(Array.isArray(meta.players) && meta.players.length){
    put('data-note-players', JSON.stringify(meta.players.slice(0, 12).map(ply=>({
      player_id: ply.player_id || ply.pid || ply.id || '',
      name: ply.name || '',
      pos: ply.pos || '',
      team: ply.team || meta.team || '',
    }))));
  }
  return attrs.map(([k,v])=>` ${k}="${escAttr(v)}"`).join('');
}

function noteWrapHtml(innerHtml, meta, cls){
  return `<span class="${cls||'note-tag-hit'}"${noteTagAttrs(meta)}>${innerHtml}</span>`;
}

function noteDisplayValue(value){
  if(value==null || value==='') return '';
  return String(value);
}

function noteAbbrevLabel(label){
  return String(label||'')
    .replace(/Strength of Schedule/gi,'SOS')
    .replace(/Expert Consensus Rank/gi,'ECR')
    .replace(/Completion Percentage/gi,'CMP%')
    .replace(/Passer Rating/gi,'RTG')
    .replace(/Value Over Replacement/gi,'VOR')
    .replace(/Yards Per Carry/gi,'YPC')
    .replace(/Receiving Yards/gi,'Rec Yds')
    .replace(/Rush Touchdowns/gi,'Rush TDs')
    .replace(/Receiving Touchdowns/gi,'Rec TDs')
    .replace(/Pass Touchdowns/gi,'Pass TDs')
    .replace(/Interceptions Thrown/gi,'INT Thrown')
    .replace(/Cumulative Run Blocking Score/gi,'Run Block Score')
    .replace(/Drive friction ranking/gi,'Drive Friction')
    .replace(/3rd\/4th down frequency/gi,'3rd/4th Freq')
    .replace(/Early down red zone success/gi,'Early RZ SR')
    .replace(/Late down red zone success/gi,'Late RZ SR');
}

function noteCompactText(text, maxLen){
  const raw = String(text||'').replace(/\s+/g,' ').trim();
  if(raw.length<=maxLen) return raw;
  return raw.slice(0, Math.max(0, maxLen-1)).trimEnd() + '…';
}

function noteCompactValue(value){
  return noteCompactText(String(value||'')
    .replace(/Vegas win total/gi,'VWT')
    .replace(/league rank\s*#/gi,'#')
    .replace(/rank\s+(\d+)\s+of\s+32/gi,'#$1/32')
    .replace(/ projections /gi,' proj ')
    .replace(/ projection /gi,' proj ')
    .replace(/Passing Yards/gi,'Pass Yds')
    .replace(/Receiving Yards/gi,'Rec Yds')
    .replace(/Yards Per Carry/gi,'YPC')
    .replace(/Success Rate/gi,'SR')
    .replace(/Pass production/gi,'Pass Prod')
    .replace(/Run production/gi,'Run Prod'), 52);
}

function noteCompactContext(context){
  return noteCompactText(String(context||'')
    .replace(/ projections /gi,' proj ')
    .replace(/ projection /gi,' proj ')
    .replace(/full rankings/gi,'full rk')
    .replace(/ rankings/gi,' rk')
    .replace(/adv metrics/gi,'adv')
    .replace(/ season/gi,' szn')
    .replace(/ week /gi,' wk '), 40);
}

function noteDisplayTag(tag){
  return {
    label: noteAbbrevLabel(tag && tag.label),
    value: noteCompactValue(tag && tag.value),
    context: noteCompactContext(tag && tag.context),
  };
}

function noteRelevantPlayers(team, relevance){
  const tm = String(team||'').toUpperCase();
  if(!tm) return [];
  const want = String(relevance||'QB,RB,WR,TE').split(/[^A-Z]+/i).map(x=>x.toUpperCase()).filter(Boolean);
  const order = {QB:0,RB:1,WR:2,TE:3};
  const wantSet = new Set(want);
  const seen = new Set();
  const out = [];
  ['QB','RB','WR','TE'].forEach(pos=>{
    (getBase(tm, pos) || []).forEach(p=>{
      const key = playerNoteKey((p && (p.player_id || p.name)) || '', pos, tm);
      if(!key || seen.has(key)) return;
      seen.add(key);
      out.push({
        player_id: p.player_id || '',
        name: p.name || '',
        pos,
        team: tm,
        adp: Number.isFinite(+p.adp) ? +p.adp : 999,
        relevant: wantSet.has(pos),
      });
    });
  });
  out.sort((a,b)=> (a.relevant===b.relevant?0:(a.relevant?-1:1)) || (order[a.pos]||9)-(order[b.pos]||9) || a.adp-b.adp || a.name.localeCompare(b.name));
  return out;
}

function noteRelevanceForTableKey(key){
  const k = String(key||'');
  if(k==='offensive_line_run') return 'RB';
  if(k==='offensive_line_pass') return 'QB,RB';
  return 'QB,RB,WR,TE';
}

function notePickerTargets(info){
  if(info.player && (info.player.name || info.player.player_id)) return [info.player];
  if(Array.isArray(info.players) && info.players.length) return info.players;
  if(info.team) return noteRelevantPlayers(info.team, info.relevance);
  return [];
}

function noteInfoFromElement(el){
  if(!el || !el.dataset) return null;
  const ds = el.dataset;
  const info = {
    label: ds.noteLabel || 'Stat',
    value: ds.noteValue || '',
    source: ds.noteSource || 'app',
    context: ds.noteContext || '',
    statKey: ds.noteStatKey || '',
    team: ds.noteTeam || '',
    relevance: ds.noteRelevance || '',
  };
  if(ds.notePlayerId || ds.notePlayerName){
    info.player = {
      player_id: ds.notePlayerId || '',
      name: ds.notePlayerName || '',
      pos: ds.notePlayerPos || '',
      team: ds.notePlayerTeam || ds.noteTeam || '',
    };
  }
  if(ds.notePlayers){
    try{ info.players = JSON.parse(ds.notePlayers); }catch(e){}
  }
    if(ds.noteNav){
      try{ info.nav = JSON.parse(ds.noteNav); }catch(e){}
    }
  return info;
}

function noteClosePicker(){
  _notePickerState = null;
  const el = document.getElementById('notePickerOverlay');
  if(el) el.remove();
}

function noteRenderPicker(){
  const st = _notePickerState;
  if(!st) return;
  const existing = document.getElementById('notePickerOverlay');
  const targets = st.targets || [];
  const rows = targets.map((t, i)=>`
    <button class="note-picker-row" onclick="noteChooseTarget(${i})">
      <span class="note-picker-main"><span class="pos-badge pos-${t.pos||'WR'}">${escHtml(t.pos||'')}</span><span class="note-picker-name">${escHtml(t.name||'Unknown')}</span></span>
      <span class="note-picker-team">${escHtml(t.team||'')}</span>
    </button>`).join('');
  const html = `
    <div class="note-picker-backdrop" onclick="noteClosePicker()">
      <div class="note-picker" onclick="event.stopPropagation()">
        <div class="note-picker-head">
          <div class="note-picker-title">Add to player notes</div>
          <button class="note-picker-close" onclick="noteClosePicker()" aria-label="Close">✕</button>
        </div>
        <div class="note-picker-stat"><span class="note-picker-label">${escHtml(st.info.label)}</span><span class="note-picker-value">${escHtml(st.info.value)}</span></div>
        ${st.info.context ? `<div class="note-picker-context">${escHtml(st.info.context)}</div>` : ''}
        <div class="note-picker-list">${rows || '<div class="note-picker-empty">No relevant players found for this stat.</div>'}</div>
      </div>
    </div>`;
  if(existing) existing.innerHTML = html;
  else {
    const div = document.createElement('div');
    div.id = 'notePickerOverlay';
    div.className = 'note-picker-overlay';
    div.innerHTML = html;
    document.body.appendChild(div);
  }
}

function noteChooseTarget(index){
  const st = _notePickerState;
  if(!st || !st.targets || !st.targets[index]) return;
  const t = st.targets[index];
  addPlayerNoteTag(t.player_id || t.name, t.pos, t.team, {
    label: st.info.label,
    value: st.info.value,
    source: st.info.source,
    statKey: st.info.statKey,
    context: st.info.context,
    nav: st.info.nav || null,
  });
  const name = t.name || 'player';
  noteClosePicker();
  if(typeof pcardState!=='undefined' && pcardState && pcardStatsMode==='notes'){
    const cur = pcardNoteTarget();
    if(cur && playerNoteKey(cur.player_id || cur.name, cur.pos, cur.team)===playerNoteKey(t.player_id || t.name, t.pos, t.team)){
      const body = document.getElementById('pcardBody');
      if(body) body.innerHTML = renderPcardNotes();
      renderPcardStatTabs();
    }
  }
  refreshPcardNoteButton();
  toast(`Added ${st.info.label} to ${name}'s notes`,'ok');
}

function noteOpenPicker(info){
  const targets = notePickerTargets(info);
  if(!targets.length){
    toast('No relevant players found for that stat','err');
    return;
  }
  _notePickerState = {info, targets};
  noteRenderPicker();
}

function noteTargetFromArgs(nameOrId, pos, team){
  const pid = String(nameOrId||'');
  const p = (typeof sleeperPlayers!=='undefined' && sleeperPlayers && /^\d+$/.test(pid) && sleeperPlayers[pid]) ? sleeperPlayers[pid] : null;
  return {
    player_id: /^\d+$/.test(pid) ? pid : (p && p.player_id) || '',
    name: (p && p.name) || String(nameOrId||''),
    pos: String(pos|| (p && p.pos) || ''),
    team: String(team|| (p && p.team) || ''),
  };
}

function pcardNoteTarget(){
  if(typeof pcardState==='undefined' || !pcardState) return null;
  return noteTargetFromArgs(pcardState.pid, pcardState.posc, pcardState.team);
}

function refreshPcardNoteButton(){
  const btn = document.getElementById('pcardNoteBtn');
  const target = pcardNoteTarget();
  if(!btn || !target) return;
  const count = playerNoteCount(target.player_id || target.name, target.pos, target.team);
  btn.innerHTML = `${TC_ICON('clipboard')}${count?`<span class="pcard-note-badge">${count}</span>`:''}`;
}

function renderPcardNotes(){
  const target = pcardNoteTarget();
  if(!target) return `<div class="pcard-loading">Notes unavailable for this player.</div>`;
  const note = ensurePlayerNote(target.player_id || target.name, target.pos, target.team);
  const tags = (note.tags || []).map(tag=>{
    const d = noteDisplayTag(tag);
    const ttl = [tag.label||'', tag.value||'', tag.context||''].filter(Boolean).join(' · ');
    const clickable = !!(tag && tag.nav);
    return `<div class="pcard-note-tag${clickable?' is-link':''}"><div class="pcard-note-tag-top"><button class="pcard-note-tag-open" ${clickable?`onclick="noteOpenFromCard('${escJsSingle(tag.id)}')"`:'disabled'} title="${escAttr(ttl)}"><span class="pcard-note-tag-label">${escHtml(d.label)}</span><div class="pcard-note-tag-value">${escHtml(d.value)}</div>${d.context?`<div class="pcard-note-tag-context">${escHtml(d.context)}</div>`:''}</button><button class="pcard-note-tag-info" onclick="openPcardNoteTagInfo('${escJsSingle(tag.id)}')" aria-label="View note details">i</button><button class="pcard-note-tag-rm" onclick="removePcardNoteTagFromCard('${escJsSingle(tag.id)}')" aria-label="Remove tag">✕</button></div></div>`;
  }).join('');
  return `<div class="pcard-notes-view">
    <div class="pcard-notes-head"><div class="pcard-notes-title">Player Notes</div><div class="pcard-notes-sub">Hold down on tagged stats anywhere in the app to pin them here.</div></div>
    <div class="pcard-notes-tags">${tags || '<div class="pcard-notes-empty">No pinned stats yet.</div>'}</div>
    <label class="pcard-notes-label" for="pcardNotesText">Your notes</label>
    <textarea id="pcardNotesText" class="pcard-notes-text" spellcheck="true" placeholder="Write down anything you want to remember about this player…" oninput="updatePcardNotesText(this.value)">${escHtml(note.text || '')}</textarea>
    <div class="pcard-src">Notes save with this session and export with your projections JSON.</div>
  </div>`;
}

function noteOpenFromCard(tagId){
  const target = pcardNoteTarget();
  if(!target) return;
  const note = getPlayerNote(target.player_id || target.name, target.pos, target.team);
  if(!note) return;
  noteJumpToTag(note.key, tagId);
}

function _pcardNoteTagById(tagId){
  const target = pcardNoteTarget();
  if(!target) return null;
  const note = getPlayerNote(target.player_id || target.name, target.pos, target.team);
  if(!note || !Array.isArray(note.tags)) return null;
  return note.tags.find(t=>String(t.id)===String(tagId)) || null;
}

function closePcardNoteTagInfo(){
  const el = document.getElementById('pcardNoteInfoOverlay');
  if(el) el.remove();
}

function openPcardNoteTagInfo(tagId){
  const tag = _pcardNoteTagById(tagId);
  if(!tag) return;
  closePcardNoteTagInfo();
  const jumpBtn = tag.nav ? `<button class="btn btn-accent btn-sm" onclick="closePcardNoteTagInfo();noteOpenFromCard('${escJsSingle(tag.id)}')">Jump to source</button>` : '';
  const ov = document.createElement('div');
  ov.id = 'pcardNoteInfoOverlay';
  ov.className = 'note-info-overlay';
  ov.innerHTML = `<div class="note-info-backdrop" onclick="closePcardNoteTagInfo()"><div class="note-info-modal" onclick="event.stopPropagation()"><div class="note-info-head"><div class="note-info-title">Tag details</div><button class="note-info-close" onclick="closePcardNoteTagInfo()" aria-label="Close">✕</button></div><div class="note-info-row"><span>Label</span><b>${escHtml(tag.label||'—')}</b></div><div class="note-info-row"><span>Value</span><b>${escHtml(tag.value||'—')}</b></div>${tag.context?`<div class="note-info-row"><span>Context</span><b>${escHtml(tag.context)}</b></div>`:''}${tag.source?`<div class="note-info-row"><span>Source</span><b>${escHtml(tag.source)}</b></div>`:''}<div class="note-info-actions">${jumpBtn}<button class="btn btn-ghost btn-sm" onclick="closePcardNoteTagInfo()">Close</button></div></div></div>`;
  document.body.appendChild(ov);
}

function updatePcardNotesText(value){
  const target = pcardNoteTarget();
  if(!target) return;
  setPlayerNoteText(target.player_id || target.name, target.pos, target.team, value);
  renderPcardStatTabs();
  refreshPcardNoteButton();
}

function removePcardNoteTagFromCard(tagId){
  const target = pcardNoteTarget();
  if(!target) return;
  removePlayerNoteTag(target.player_id || target.name, target.pos, target.team, tagId);
  const body = document.getElementById('pcardBody');
  if(body) body.innerHTML = renderPcardNotes();
  renderPcardStatTabs();
  refreshPcardNoteButton();
}

function openPcardNotes(){
  if(typeof pcardState==='undefined' || !pcardState) return;
  setPcardStatsMode('notes');
}

function notesBrowserEntries(){
  return Object.values(playerNotes||{}).map(note=>{
    const text = String(note.text||'').trim();
    const tags = Array.isArray(note.tags) ? note.tags : [];
    return {
      key: note.key,
      pid: note.pid || '',
      name: note.name || 'Unknown',
      pos: note.pos || '',
      team: note.team || '',
      text,
      tags,
      count: (text?1:0) + tags.length,
      updatedAt: Number(note.updatedAt||0),
    };
  }).filter(e=>e.count>0).sort((a,b)=>b.updatedAt-a.updatedAt || a.name.localeCompare(b.name));
}

function noteGetByKey(key){ return key && playerNotes ? (playerNotes[key] || null) : null; }

async function noteJumpToTag(noteKey, tagId){
  const note = noteGetByKey(noteKey);
  const tag = note && Array.isArray(note.tags) ? note.tags.find(t=>String(t.id)===String(tagId)) : null;
  if(!tag) return;
  const nav = tag.nav || null;
  const team = String((note && note.team) || (nav && nav.team) || '').toUpperCase();
  closeNotesBrowser();
  if(nav && nav.type==='advanced' && team){
    if(nav.season && String(nav.season)!=='proj') await loadSeason(String(nav.season));
    currentTeam = team;
    currentPhase = 'Advanced';
    renderContent();
    return;
  }
  if(nav && nav.type==='coaching' && team){
    openTeamCoachingScheme(team, {season: nav.season || null, tab: nav.tab || 'insights'});
    return;
  }
  if(nav && nav.type==='rankings'){
    if(nav.season && String(nav.season)!=='proj') await loadSeason(String(nav.season));
    else if(nav.season==='proj') await loadSeason('proj');
    rankScope = nav.scope || 'all';
    rankPosFilter = nav.posFilter || rankPosFilter;
    if(typeof nav.advanced==='boolean') rankAdvanced = !!nav.advanced;
    sumerRefinement = nav.refinement || null;
    currentPhase = 'Rankings';
    if(team && rankScope==='team') currentTeam = team;
    renderContent();
    return;
  }
  if(team){
    openPlayerCard(note.pid || note.name, note.pos, team);
    setTimeout(()=>{ try{ openPcardNotes(); }catch(e){} }, 0);
  }
}

function noteDeleteBrowserTag(noteKey, tagId){
  const note = noteGetByKey(noteKey);
  if(!note) return;
  removePlayerNoteTag(note.pid || note.name, note.pos, note.team, tagId);
  const inp = document.getElementById('notesBrowserInput');
  renderNotesBrowser(inp ? inp.value : '');
}

function openNotesBrowser(){
  if(_notesBrowserOpen) return;
  _notesBrowserOpen = true;
  const ov = document.createElement('div');
  ov.id = 'notesBrowserOverlay';
  ov.className = 'ps-overlay';
  ov.innerHTML = `
    <div class="ps-modal notes-browser-modal" role="dialog" aria-label="Player notes browser">
      <div class="ps-head notes-browser-head">
        <span class="ps-search-ico">${TC_ICON('clipboard')}</span>
        <input id="notesBrowserInput" class="ps-input" type="text" autocomplete="off" spellcheck="false"
               placeholder="Search noted players or tagged stats…" aria-label="Search player notes">
        <button class="ps-close" onclick="closeNotesBrowser()" aria-label="Close">${TC_ICON('close')}</button>
      </div>
      <div id="notesBrowserMeta" class="notes-browser-meta"></div>
      <div id="notesBrowserResults" class="ps-results notes-browser-results"></div>
    </div>`;
  ov.addEventListener('mousedown', e=>{ if(e.target===ov) closeNotesBrowser(); });
  document.body.appendChild(ov);
  const inp = document.getElementById('notesBrowserInput');
  if(inp){
    inp.addEventListener('input', ()=>renderNotesBrowser(inp.value));
    inp.addEventListener('keydown', e=>{ if(e.key==='Escape'){ e.preventDefault(); closeNotesBrowser(); } });
    setTimeout(()=>inp.focus(), 30);
  }
  renderNotesBrowser('');
}

function closeNotesBrowser(){
  _notesBrowserOpen = false;
  const el = document.getElementById('notesBrowserOverlay');
  if(el) el.remove();
}

function renderNotesBrowser(query){
  const box = document.getElementById('notesBrowserResults');
  const meta = document.getElementById('notesBrowserMeta');
  if(!box || !meta) return;
  const rows = notesBrowserEntries();
  const raw = String(query||'').trim();
  const nq = ecrNormName(raw);
  const view = raw ? rows.filter(r=>{
    const hay = [r.name, r.team, r.pos, r.text].concat(r.tags.map(t=>`${t.label} ${t.value} ${t.context||''}`)).join(' ');
    return ecrNormName(hay).includes(nq);
  }) : rows;
  meta.innerHTML = `<div class="notes-browser-count">${view.length} noted player${view.length===1?'':'s'}</div>`;
  if(!view.length){
    box.innerHTML = `<div class="ps-hint">${rows.length?'No notes match that search.':'No player notes yet. Open a player card or hold down on a tagged stat to start collecting notes.'}</div>`;
    return;
  }
  box.innerHTML = view.map(r=>{
    const head = r.pid && sleeperPlayers && sleeperPlayers[r.pid]
      ? imgTag(hsPack({player_id:r.pid,name:r.name,pos:r.pos,team:r.team}),'ps-hs')
      : (r.team && r.pos==='DEF' ? imgTag(NFL_LOGO(String(r.team).toUpperCase()), 'ps-hs ps-def') : imgTag(hsPack({name:r.name,pos:r.pos,team:r.team}),'ps-hs'));
    const preview = r.text ? escHtml(r.text.slice(0,140)) : '';
    const tagPreview = r.tags.slice(0,4).map(t=>{ const d=noteDisplayTag(t); const ttl=[t.label||'',t.value||'',t.context||''].filter(Boolean).join(' · '); return `<span class="notes-browser-tag-wrap"><button class="notes-browser-tag" title="${escAttr(ttl)}" onclick="event.stopPropagation();noteJumpToTag(${pcardArg(r.key)},${pcardArg(t.id)})">${escHtml(d.label)}: ${escHtml(d.value)}</button><button class="notes-browser-tag-rm" onclick="event.stopPropagation();noteDeleteBrowserTag(${pcardArg(r.key)},${pcardArg(t.id)})" aria-label="Remove tag">✕</button></span>`; }).join('');
    return `<div class="ps-row notes-browser-row">
      <button class="notes-browser-open" onclick="openNotesBrowserPlayer(${pcardArg(r.pid||r.name)},${pcardArg(r.pos)},${pcardArg(r.team)})">
        ${head}
        <span class="notes-browser-main">
          <span class="notes-browser-top"><span class="ps-nm">${escHtml(r.name)}</span><span class="ps-meta"><span class="ps-pos ps-pos-${r.pos}">${escHtml(r.pos||'')}</span><span class="notes-browser-team">${escHtml(r.team||'')}</span></span></span>
          ${preview?`<span class="notes-browser-preview">${preview}</span>`:''}
        </span>
        <span class="notes-browser-badge">${r.count}</span>
      </button>
      ${tagPreview?`<div class="notes-browser-tags">${tagPreview}</div>`:''}
    </div>`;
  }).join('');
}

function openNotesBrowserPlayer(idOrName, pos, team){
  closeNotesBrowser();
  openPlayerCard(idOrName, pos, team);
  setTimeout(()=>{ try{ openPcardNotes(); }catch(e){} }, 0);
}

function _noteIgnoreTarget(t){
  return !!(t && t.closest && t.closest('input, textarea, select, button, [contenteditable="true"], [contenteditable=true], .sl, .dual-range, .pcard-notes-text, .mini-edit'));
}

function _noteStartHold(targetEl, clientX, clientY){
  _noteHoldState = {
    targetEl,
    clientX,
    clientY,
    timer: setTimeout(()=>{
      const st = _noteHoldState;
      if(!st || st.targetEl!==targetEl) return;
      _noteSuppressClickUntil = Date.now() + 600;
      const info = noteInfoFromElement(targetEl);
      _noteHoldState = null;
      if(info) noteOpenPicker(info);
    }, NOTE_HOLD_MS),
  };
}

function _noteClearHold(){
  if(_noteHoldState && _noteHoldState.timer) clearTimeout(_noteHoldState.timer);
  _noteHoldState = null;
}

function _noteMaybeCancelHold(clientX, clientY){
  if(!_noteHoldState) return;
  if(Math.abs(clientX - _noteHoldState.clientX) > NOTE_MOVE_PX || Math.abs(clientY - _noteHoldState.clientY) > NOTE_MOVE_PX) _noteClearHold();
}

if(typeof document!=='undefined' && document.addEventListener){
  document.addEventListener('contextmenu', e=>{
    const el = e.target && e.target.closest ? e.target.closest('[data-noteable="1"]') : null;
    if(el && !_noteIgnoreTarget(e.target)) e.preventDefault();
  });
  document.addEventListener('click', e=>{
    if(Date.now() < _noteSuppressClickUntil){
      e.preventDefault();
      e.stopPropagation();
      _noteSuppressClickUntil = 0;
    }
  }, true);
  document.addEventListener('touchstart', e=>{
    if(e.touches.length!==1) return _noteClearHold();
    const t = e.target;
    const el = t && t.closest ? t.closest('[data-noteable="1"]') : null;
    if(!el || _noteIgnoreTarget(t)) return;
    const touch = e.touches[0];
    _noteStartHold(el, touch.clientX, touch.clientY);
  }, {passive:true});
  document.addEventListener('touchmove', e=>{
    if(!_noteHoldState || !e.touches.length) return;
    const touch = e.touches[0];
    _noteMaybeCancelHold(touch.clientX, touch.clientY);
  }, {passive:true});
  document.addEventListener('touchend', _noteClearHold, {passive:true});
  document.addEventListener('touchcancel', _noteClearHold, {passive:true});
  document.addEventListener('mousedown', e=>{
    const t = e.target;
    const el = t && t.closest ? t.closest('[data-noteable="1"]') : null;
    if(!el || _noteIgnoreTarget(t) || e.button!==0) return;
    _noteStartHold(el, e.clientX, e.clientY);
  });
  document.addEventListener('mousemove', e=>_noteMaybeCancelHold(e.clientX, e.clientY));
  document.addEventListener('mouseup', _noteClearHold);
  document.addEventListener('mouseleave', _noteClearHold);
}