// ═════════════════════════════════════════════════════════════════════════════
// Roster ownership — "who owns this player in my league?"
// ═════════════════════════════════════════════════════════════════════════════
// Once a league is synced, most player names in the app can answer a question they currently
// can't: is this player already taken, and by whom? This module owns that lookup and the small
// chip that renders it, so every surface (player card hero, search results, rankings) shows the
// same answer in the same shape rather than each growing its own version.
//
// WHY THIS IS CHEAP
//   Both league providers resolve their rosters to Sleeper player_ids before the snapshot is
//   built — that is the whole point of the adapter contract in 91-espn-league.js. So a single
//   id→owner map serves Sleeper and ESPN leagues identically, and nothing here is
//   provider-aware.
//
// WHEN IT SHOWS NOTHING
//   No league synced, or the player is a free agent in that league. Both are the same case as
//   far as callers are concerned: the chip helper returns '' and the caller's template
//   collapses. There is deliberately no "FA" badge — an un-owned player is the common case,
//   and badging every one of them would be noise on every row in the app.

// pid → {rosterId, teamName, owner, mine}. Rebuilt lazily; invalidated whenever the snapshot
// changes identity or is re-taken (see tcOwnerIndex).
let _tcOwnIdx = null;
let _tcOwnStamp = null;      // which snapshot the index was built from
let _tcOwnNameIdx = null;    // normalised name → same record, for entries without an id match

// Build (or reuse) the ownership index for the current snapshot.
//
// The cache key is league + when the snapshot was taken, so a re-sync or a league switch
// rebuilds automatically without anyone remembering to call an invalidator. Season is in the
// key too: looking back at an earlier season of the same league is a different roster set.
function tcOwnerIndex(){
  const s = (typeof leagueSnapshot !== 'undefined') ? leagueSnapshot : null;
  if(!s || !Array.isArray(s.teamList)) { _tcOwnIdx = null; _tcOwnNameIdx = null; _tcOwnStamp = null; return null; }
  const stamp = `${s.provider||'sleeper'}|${s.leagueId}|${s.season}|${s.takenAt}`;
  if(_tcOwnIdx && _tcOwnStamp === stamp) return _tcOwnIdx;

  const idx = {}, byName = {};
  s.teamList.forEach(t=>{
    const rec = {
      rosterId: t.rosterId,
      teamName: t.teamName || `Roster ${t.rosterId}`,
      owner: t.owner || '',
      mine: !!(s.myUserId && t.ownerId === s.myUserId),
    };
    (t.players||[]).forEach(p=>{
      if(!p) return;
      if(p.id) idx[String(p.id)] = rec;
      // Unresolved ESPN players carry a synthetic "espn:<id>" and their ESPN spelling. Index
      // them by name too so the chip still appears for a player we couldn't match to Sleeper.
      if(p.name && typeof normName === 'function') byName[normName(p.name)] = rec;
    });
  });
  _tcOwnIdx = idx; _tcOwnNameIdx = byName; _tcOwnStamp = stamp;
  return idx;
}

// Who owns this player? → {rosterId, teamName, owner, mine} or null.
// `pid` is a Sleeper player_id (or a team code for a D/ST). Name is a fallback only.
function tcOwnerOf(pid, name){
  const idx = tcOwnerIndex();
  if(!idx) return null;
  if(pid != null && idx[String(pid)]) return idx[String(pid)];
  if(name && _tcOwnNameIdx && typeof normName === 'function'){
    const hit = _tcOwnNameIdx[normName(name)];
    if(hit) return hit;
  }
  return null;
}

// The chip itself. Returns '' when there is nothing to say, so callers can interpolate it
// unconditionally: `${tcOwnerChip(pid, name)}`.
//
// `variant` tunes the density for where it sits:
//   'full'    player-card hero — team name plus the manager's handle
//   'compact' search rows and tables — team name only, since space is tight
//   'pill'    projection rows / rankings / search — the MANAGER's handle (what you scan a
//             league for: "is this one of mine, or Sengi12's?"), team name in the tooltip,
//             no left margin so the row can push it to the right edge
function tcOwnerChip(pid, name, variant){
  const rec = tcOwnerOf(pid, name);
  if(!rec) return '';
  const compact = variant === 'compact' || variant === 'pill';
  const pill = variant === 'pill';
  const label = pill ? (rec.owner || rec.teamName) : rec.teamName;
  const who = (!compact && rec.owner) ? `<span class="tc-own-mgr">@${escHtml(rec.owner)}</span>` : '';
  const title = rec.mine
    ? `On your team (${rec.teamName}) — open it in the League Analyzer`
    : `Rostered by ${rec.owner || rec.teamName}${rec.owner && rec.teamName ? ` (${rec.teamName})` : ''} — open that roster in the League Analyzer`;
  // stopPropagation: these chips sit inside rows and cards that already have their own click
  // handler (open the player card, pick a search result). Without it, jumping to a roster
  // would also fire whatever the surrounding element does.
  // rosterId lands inside an inline handler, so it is coerced to a number rather than
  // trusted. Both adapters supply an integer today; this makes that a guarantee instead of
  // an assumption, since the value ultimately originates from a provider's API.
  const rid = Number(rec.rosterId);
  if(!isFinite(rid)) return '';
  // A <span role="button">, not a <button>: the search rows and several projection rows ARE
  // buttons, and the HTML parser closes an open <button> the moment it meets another one —
  // a nested chip would be ejected out of its row onto the next line.
  return `<span class="tc-own-chip${rec.mine?' tc-own-mine':''}${compact?' tc-own-sm':''}${pill?' tc-own-pill':''}" role="button" tabindex="0"
            onclick="event.stopPropagation();tcOwnerJump(${rid})"
            onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();tcOwnerJump(${rid});}"
            title="${escAttr(title)}">${rec.mine?'★ ':''}${escHtml(label)}${who}</span>`;
}

// Jump to this roster in the League Analyzer. Closes the player card first when one is open,
// otherwise the analyzer renders behind the overlay and nothing appears to happen.
function tcOwnerJump(rosterId){
  try{
    if(typeof closePlayerCard === 'function'){
      const overlay = document.getElementById('pcardOverlay');
      if(overlay) closePlayerCard();
    }
    if(typeof closePlayerSearch === 'function') closePlayerSearch();
  }catch(e){}
  if(typeof laViewTeam !== 'function' || typeof leagueSnapshot === 'undefined' || !leagueSnapshot) return;
  if(typeof currentPhase !== 'undefined') currentPhase = 'League';
  if(typeof laState !== 'undefined'){ laState.step = 'view'; laState.laTab = 'myteam'; }
  if(typeof renderContent === 'function') renderContent();
  laViewTeam(rosterId);
  if(typeof syncAppChrome === 'function') syncAppChrome();
}

// Is a league synced right now? Lets table renderers add/remove the owner column as a whole
// rather than leaving an empty column when nothing is linked.
function tcOwnerActive(){
  return !!tcOwnerIndex();
}
// Cache stamp for renderers that memoise their HTML (rankings): changes when the snapshot does.
function tcOwnerStamp(){
  tcOwnerIndex();
  return _tcOwnStamp || '';
}
// Owner pill for a projection row: manager handle, pushed to the right of the name.
function tcOwnerPill(pid, name){
  return tcOwnerChip(pid, name, 'pill');
}
