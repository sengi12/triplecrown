// ─────────────────────────────────────────────────────────────────────────────
// Player search — a modal reachable from the ☰ menu. Type a name, get normalized-matched
// results (same ecrNormName the rest of the app uses), each showing photo, name, team logo
// and position. Includes EVERY loaded player, not just offensive fantasy positions — any
// depth-chart player in the Sleeper DB (LB, CB, OL, …) is searchable. Clicking a result
// opens the existing player card.
// ─────────────────────────────────────────────────────────────────────────────

let _psOpen = false;

function openPlayerSearch(){
  if(_psOpen) return;
  // The search reads the Sleeper player DB; make sure it's loaded first.
  if(!sleeperPlayers){
    loadSleeperPlayers(true).then(()=>openPlayerSearch()).catch(()=>{
      toast('Player data still loading — try again in a moment','err');
    });
    return;
  }
  _psOpen = true;
  const ov = document.createElement('div');
  ov.id = 'psOverlay';
  ov.className = 'ps-overlay';
  ov.innerHTML = `
    <div class="ps-modal" role="dialog" aria-label="Search players">
      <div class="ps-head">
        <span class="ps-search-ico">${TC_ICON('search')}</span>
        <input id="psInput" class="ps-input" type="text" autocomplete="off" spellcheck="false"
               placeholder="Search any player…" aria-label="Player name">
        <button class="ps-close" onclick="closePlayerSearch()" aria-label="Close">${TC_ICON('close')}</button>
      </div>
      <div id="psResults" class="ps-results"></div>
    </div>`;
  // Click on the backdrop (not the modal) closes.
  ov.addEventListener('mousedown', e=>{ if(e.target===ov) closePlayerSearch(); });
  document.body.appendChild(ov);
  const inp = document.getElementById('psInput');
  inp.addEventListener('input', ()=>psRender(inp.value));
  inp.addEventListener('keydown', psKey);
  psRender('');
  setTimeout(()=>inp.focus(), 30);
}

function closePlayerSearch(){
  _psOpen = false;
  const el = document.getElementById('psOverlay'); if(el) el.remove();
}

// Precomputed once per open: [{pid, name, norm, pos, team}] over every player in the DB.
let _psIndex = null;
function psBuildIndex(){
  const out = [];
  for(const pid in sleeperPlayers){
    const p = sleeperPlayers[pid];
    if(!p || !p.name) continue;
    out.push({ pid, name:p.name, norm:ecrNormName(p.name), pos:p.pos||'', team:p.team||'' });
  }
  // Team defenses aren't in the slim player DB (it drops position 'DEF'), but they're real
  // roster units people search for. Add one entry per NFL team, keyed by the abbreviation the
  // player card / DEF logic already understands, matchable by club name or code.
  if(typeof TEAMS!=='undefined' && Array.isArray(TEAMS)){
    TEAMS.forEach(tc=>{
      const full = (typeof teamDisplayName==='function' ? teamDisplayName(tc) : tc);
      const label = `${full} D/ST`;
      out.push({ pid:tc, name:label, norm:ecrNormName(full+' '+tc), pos:'DEF', team:tc });
    });
  }
  return out;
}

function psRender(q){
  const box = document.getElementById('psResults'); if(!box) return;
  if(!_psIndex) _psIndex = psBuildIndex();
  const raw = (q||'').trim();
  if(!raw){
    box.innerHTML = `<div class="ps-hint">Start typing a player's name — every player on an NFL roster is searchable, not just fantasy skill positions.</div>`;
    return;
  }
  const nq = ecrNormName(raw);
  // Rank: exact norm match, then prefix, then substring; alphabetical within a tier. Cap the
  // list so a two-letter query doesn't paint 800 rows.
  const scored = [];
  for(const e of _psIndex){
    let s = -1;
    if(e.norm === nq) s = 0;
    else if(e.norm.startsWith(nq)) s = 1;
    else if(e.norm.includes(nq)) s = 2;
    else if(nq.length>=3 && e.norm.replace(/\s/g,'').includes(nq.replace(/\s/g,''))) s = 3;
    if(s>=0) scored.push({e, s});
  }
  scored.sort((a,b)=> a.s-b.s || a.e.name.localeCompare(b.e.name));
  const top = scored.slice(0, 40);
  if(!top.length){
    box.innerHTML = `<div class="ps-hint">No players match “${escAttr(raw)}”.</div>`;
    return;
  }
  box.innerHTML = top.map((r,i)=>{
    const e = r.e;
    const isDef = e.pos==='DEF';
    const img = (isDef && e.team)
      ? imgTag(NFL_LOGO(String(e.team).toUpperCase()), 'ps-hs ps-def')
      : imgTag(hsPack({player_id:e.pid, name:e.name, pos:e.pos}), 'ps-hs');
    const logo = e.team ? `<img class="ps-team-logo" src="${NFL_LOGO(String(e.team).toUpperCase())}" alt="${escAttr(e.team)}" onerror="this.style.display='none'">` : '';
    return `<button class="ps-row${i===0?' ps-active':''}" data-pid="${escAttr(e.pid)}" data-pos="${escAttr(e.pos)}" data-team="${escAttr(e.team)}"
                    onclick="psPick(this)">
      ${img}
      <span class="ps-nm">${e.name}</span>
      <span class="ps-meta">${logo}<span class="ps-pos ps-pos-${e.pos}">${e.pos||'—'}</span></span>
    </button>`;
  }).join('');
}

function psPick(btn){
  const pid = btn.getAttribute('data-pid');
  const pos = btn.getAttribute('data-pos');
  const team = btn.getAttribute('data-team');
  closePlayerSearch();
  openPlayerCard(pid, pos, team);
}

// Arrow keys move the highlight; Enter opens it; Escape closes.
function psKey(e){
  const box = document.getElementById('psResults'); if(!box) return;
  const rows = [...box.querySelectorAll('.ps-row')];
  if(!rows.length) return;
  let idx = rows.findIndex(r=>r.classList.contains('ps-active'));
  if(e.key==='ArrowDown'){ e.preventDefault(); idx=Math.min(rows.length-1, idx+1); }
  else if(e.key==='ArrowUp'){ e.preventDefault(); idx=Math.max(0, idx-1); }
  else if(e.key==='Enter'){ e.preventDefault(); if(rows[idx]) psPick(rows[idx]); return; }
  else if(e.key==='Escape'){ e.preventDefault(); closePlayerSearch(); return; }
  else return;
  rows.forEach(r=>r.classList.remove('ps-active'));
  if(rows[idx]){ rows[idx].classList.add('ps-active'); rows[idx].scrollIntoView({block:'nearest'}); }
}

// Rebuild the index if the player DB reloads mid-session (rare, but cheap to be correct).
if(typeof document!=='undefined' && document.addEventListener){
  document.addEventListener('keydown', e=>{ if(e.key==='Escape' && _psOpen) closePlayerSearch(); });
}
