// TC Rating cache, keyed on the board array's IDENTITY: a rebuilt board is a new
// array, so invalidation is automatic and computing the key costs nothing. The
// first version derived its key by calling buildPlayerList() — a full 516-player
// board build — PER CELL from the row renderer: O(n²) board builds per render,
// which crawled on phones. Never compute a cache key with the thing you cached.
let _tcrForList=null, _tcrCache=null;
function _tcrMap(list){
  if(!list) list=(typeof buildPlayerList==='function')?buildPlayerList():[];
  if(_tcrForList===list && _tcrCache) return _tcrCache;
  _tcrCache=(typeof tcRatingsFor==='function')?tcRatingsFor(list):new Map();
  _tcrForList=list;
  return _tcrCache;
}
// The rendered-HTML LRU is bounded by TOTAL SIZE, not entry count. Counting entries looks
// safe until you notice how big one entry is: a full-width board measured ~1.4M chars, and V8
// stores these two-byte, so eight of them was ~23MB on a phone / ~60MB on desktop — duplicating
// what is already in the DOM, on exactly the devices most likely to discard the tab for it.
// The cache key varies on sort key, direction, position filter, advanced flag, refinement,
// three min-volume values, search query and scope, so a handful of taps used to fill all eight.
// A byte budget self-adjusts instead: small phone-capped boards keep several, huge desktop
// boards keep one or two.
const _RANKINGS_RENDER_CACHE_MAX = 8;              // hard ceiling on entries
const _RANKINGS_RENDER_CACHE_MAX_CHARS = 3000000;  // ~6MB of UTF-16, the real limit
let _rankingsRenderCache = new Map();
let _rankingsRenderCacheChars = 0;
let _rankingsPrewarmQueued = false;

// ── Chunked row streaming (phones) ──────────────────────────────────────────
// A full-width board is ~900 rows / ~17k cells; parsing that in one innerHTML pass
// measured ~1.2s on a 4x-throttled phone, and the old two-phase answer (paint a trimmed
// board + a "Mobile quick-open" notice, then re-render the WHOLE page on idle) meant every
// control tap flashed the notice and re-parsed the page twice. Instead: paint the chrome +
// the first slice synchronously, then append the remaining rows into the live <tbody> over
// successive frames. They land below the fold, so nothing visibly "loads" — the page is
// just interactive immediately, and there is exactly one chrome parse per render.
const RANKINGS_STREAM_FIRST = 180;   // rows in the synchronous first paint
const RANKINGS_STREAM_SLICE = 250;   // rows appended per subsequent frame
let _rankingsStreamToken = 0;        // bumped by every render; abandons stale streams
let _rankingsStreamPending = false;  // a stream is currently appending rows
let _rankingsScrollTargetY = null;   // deep WINDOW scroll restore that needs more rows to exist
let _rankingsScrollTargetWrapY = null; // same, for the .rank-table-wrap scroller (phones scroll it, not the page)

function _rankingsRaf(fn){
  if(typeof window!=='undefined' && window.requestAnimationFrame) window.requestAnimationFrame(fn);
  else setTimeout(fn, 16);
}

function _rankingsStreamRows(token, chunks, onDone){
  _rankingsStreamPending = true;
  const step = ()=>{
    if(token!==_rankingsStreamToken) return;   // a newer render owns the board (and the flag)
    const tbody = (typeof document!=='undefined') ? document.querySelector('#content .rankings-table tbody') : null;
    if(!tbody || (tbody.isConnected===false)){ _rankingsStreamPending=false; _rankingsScrollTargetY=null; _rankingsScrollTargetWrapY=null; return; }
    const slice = chunks.splice(0, RANKINGS_STREAM_SLICE);
    if(slice.length) tbody.insertAdjacentHTML('beforeend', slice.join(''));
    // Rows that land after an in-place search / min-volume / position filter must obey it.
    if(typeof applyRankingsFiltersInPlace==='function' && _rankingsInPlaceFiltersActive()) applyRankingsFiltersInPlace();
    else if(typeof rankingsUpdateReplacementLine==='function') rankingsUpdateReplacementLine();
    // A sort tap deep in the table wants its scroll position back, but the restore that ran
    // right after the first paint could only clamp to the rows that existed then. Keep
    // nudging toward the target as the table grows tall enough to honor it.
    if(_rankingsScrollTargetY!=null && typeof window!=='undefined'){
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo(0, Math.min(_rankingsScrollTargetY, max));
      if(max>=_rankingsScrollTargetY || !chunks.length) _rankingsScrollTargetY = null;
    }
    if(_rankingsScrollTargetWrapY!=null){
      const wrap = document.querySelector('#content .rank-table-wrap');
      if(!wrap){ _rankingsScrollTargetWrapY = null; }
      else {
        const maxW = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
        wrap.scrollTop = Math.min(_rankingsScrollTargetWrapY, maxW);
        if(maxW>=_rankingsScrollTargetWrapY || !chunks.length) _rankingsScrollTargetWrapY = null;
      }
    }
    if(chunks.length) _rankingsRaf(step);
    else { _rankingsStreamPending=false; if(onDone) onDone(); }
  };
  _rankingsRaf(step);
}

// Split a cached full-page HTML string into (chrome-before, row strings, chrome-after) so
// cache hits can stream on phones too. Returns null when there's no point (small board).
function _rankingsSplitCachedRows(html){
  const open = html.indexOf('<tbody>');
  const close = html.lastIndexOf('</tbody>');
  if(open<0 || close<=open) return null;
  const rows = html.slice(open+7, close).split(/(?=<tr[\s>])/);
  if(rows.length <= RANKINGS_STREAM_FIRST+60) return null;   // two phases not worth it
  return { pre: html.slice(0, open+7), rows, post: html.slice(close) };
}

function _rankingsMobileNarrow(){
  return !!(typeof window!=='undefined' && window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
}

function rankingsRenderCacheGet(key){
  if(!key || !_rankingsRenderCache.has(key)) return '';
  const html = _rankingsRenderCache.get(key) || '';
  // LRU touch: reinsert so recent views survive tab/phase hopping.
  _rankingsRenderCache.delete(key);
  _rankingsRenderCache.set(key, html);
  return html;
}

function _rankingsRenderCacheEvictOldest(){
  const oldest = _rankingsRenderCache.keys().next();
  if(!oldest || oldest.done) return false;
  const gone = _rankingsRenderCache.get(oldest.value);
  _rankingsRenderCache.delete(oldest.value);
  _rankingsRenderCacheChars -= (gone ? gone.length : 0);
  if(_rankingsRenderCacheChars < 0) _rankingsRenderCacheChars = 0;
  return true;
}

function rankingsRenderCacheSet(key, html){
  if(!key || !html) return;
  if(_rankingsRenderCache.has(key)){
    const prev = _rankingsRenderCache.get(key);
    _rankingsRenderCacheChars -= (prev ? prev.length : 0);
    _rankingsRenderCache.delete(key);
  }
  // A single render larger than the whole budget is not worth caching at all — storing it
  // would evict everything else and then sit there alone.
  if(html.length > _RANKINGS_RENDER_CACHE_MAX_CHARS) return;
  _rankingsRenderCache.set(key, html);
  _rankingsRenderCacheChars += html.length;
  while(_rankingsRenderCache.size > _RANKINGS_RENDER_CACHE_MAX ||
        (_rankingsRenderCacheChars > _RANKINGS_RENDER_CACHE_MAX_CHARS && _rankingsRenderCache.size > 1)){
    if(!_rankingsRenderCacheEvictOldest()) break;
  }
}

// Bytes currently held, for tests and the dev console.
function rankingsRenderCacheBytes(){ return _rankingsRenderCacheChars; }

function rankHeadshotSlotHtml(p){
  const pid = p && p.player_id!=null ? String(p.player_id) : '';
  const nm = p && p.name ? String(p.name) : '';
  const pos = p && p.pos ? String(p.pos) : '';
  const tm = p && p.team ? String(p.team) : '';
  return `<span class="rank-hs-slot" data-rank-hs="1" data-rhs-pid="${escAttr(pid)}" data-rhs-n="${escAttr(nm)}" data-rhs-pos="${escAttr(pos)}" data-rhs-tm="${escAttr(tm)}"></span>`;
}

function rankHydrateHeadshotSlot(slot){
  if(!slot || slot.dataset.rankHsReady==='1') return;
  const pid = slot.getAttribute('data-rhs-pid') || '';
  const nm = slot.getAttribute('data-rhs-n') || '';
  const pos = slot.getAttribute('data-rhs-pos') || '';
  const tm = slot.getAttribute('data-rhs-tm') || '';
  slot.innerHTML = imgTag(hsPack({ player_id: pid || null, name: nm, pos, team: tm }), 'rank-hs');
  slot.dataset.rankHsReady = '1';
}

function hydrateRankingsHeadshots(){
  if(typeof document==='undefined') return;
  const slots = Array.from(document.querySelectorAll('.rank-hs-slot[data-rank-hs="1"]'));
  if(!slots.length) return;
  // Tests / older browsers: hydrate immediately so behavior remains deterministic.
  if(typeof IntersectionObserver!=='function'){
    slots.forEach(rankHydrateHeadshotSlot);
    return;
  }
  const root = document.querySelector('.rank-table-wrap') || null;
  const io = new IntersectionObserver((entries, obs)=>{
    entries.forEach(en=>{
      if(!en.isIntersecting) return;
      rankHydrateHeadshotSlot(en.target);
      obs.unobserve(en.target);
    });
  }, { root, rootMargin: '120px 0px' });
  slots.forEach(slot=>io.observe(slot));
}

function invalidateRankingsRenderCache(){
  _rankingsRenderCache.clear();
  _rankingsRenderCacheChars = 0;   // keep the byte accounting in step with the map
}

function prewarmRankingsFromSeed(){
  if(_rankingsPrewarmQueued) return;
  _rankingsPrewarmQueued = true;
  const run = ()=>{
    try{
      if(typeof buildPlayerList==='function') buildPlayerList();
    }catch(_e){
      _rankingsPrewarmQueued = false;
    }
  };
  if(typeof requestIdleCallback==='function') requestIdleCallback(run, { timeout: 1500 });
  else setTimeout(run, 0);
}

function rankingsRenderCacheKey(teamScoped){
  if(typeof ktcGameState!=='undefined' && ktcGameState && ktcGameState.active) return '';
  if(typeof draftId!=='undefined' && draftId) return '';
  if(typeof leaguePickerState!=='undefined' && leaguePickerState && leaguePickerState.open) return '';
  const scSig = (typeof buildPlayerScoringSig==='function') ? buildPlayerScoringSig() : '';
  const advCols = (rankAdvanced && typeof sumerAvailable==='function' && sumerAvailable() && typeof sumerColumnsForFilter==='function')
    ? ((sumerColumnsForFilter()||{}).cols||[]).join(',')
    : '';
  const buildEpoch = (typeof _buildPlayerCacheEpoch!=='undefined') ? _buildPlayerCacheEpoch : 0;
  return [
    'rankings',
    buildEpoch,
    (typeof buildPlayerShapeSig==='function') ? buildPlayerShapeSig() : '',   // league shape / draft / ADP
    String(activeSeason),
    String(typeof rankLiveDelta!=='undefined' && rankLiveDelta ? 1 : 0),
    String(typeof rankFiltersOpen!=='undefined' && rankFiltersOpen ? 1 : 0),   // hamburger menu row
    String(typeof draftBannerOpen!=='undefined' && draftBannerOpen ? 1 : 0),   // follow banner expanded?
    String(typeof hideDrafted!=='undefined' && hideDrafted ? 1 : 0),
    // Injury tags come from the Sleeper player DB, which lands asynchronously — a board
    // rendered before it arrives must not stay cached without designations.
    String(typeof sleeperPlayers!=='undefined' && sleeperPlayers ? 1 : 0),
    String(typeof liveSeasonEpoch==='function' ? liveSeasonEpoch() : 0),
    String(rankFormat),
    scSig,
    String(rankSortKey),
    String(rankSortDir),
    String(rankPosFilter),
    String(rankRookiesOnly?1:0),
    String(!!rankAdvanced),
    String(sumerRefinement||''),
    String(sumerMin && Number.isFinite(+sumerMin.QB) ? +sumerMin.QB : 0),
    String(sumerMin && Number.isFinite(+sumerMin.WRTE) ? +sumerMin.WRTE : 0),
    String(sumerMin && Number.isFinite(+sumerMin.RB) ? +sumerMin.RB : 0),
    advCols,
    String(scoringPanelOpen),
    String(scoringAxis||''),
    String(rankingsSearchOpen?1:0),
    String((rankingsSearchQuery||'').trim().toLowerCase()),
    String(rankScope||'all'),
    String(teamScoped?1:0),
    String(teamScoped?(currentTeam||''):'all'),
    // The cached HTML always carries the FULL row set (phones stream it in on hit), so the
    // key is deliberately viewport-independent — rotating the phone reuses the same entry.
    String(typeof tcOwnerStamp==='function' ? tcOwnerStamp() : ''),   // owner column follows the synced league
    // Column customization (hide/reorder) changes the header AND every row.
    (typeof rankColPrefs!=='undefined' && rankColPrefs) ? JSON.stringify(rankColPrefs) : '',
  ].join('|');
}

function renderRankings(){
  const _rkNow = ()=>((typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now());
  const _rkDebug = (typeof tcLatencyDebugEnabled==='function' && tcLatencyDebugEnabled());
  const _rkT0 = _rkNow();
  // Every render supersedes any in-flight row stream from the previous one.
  ++_rankingsStreamToken;
  _rankingsStreamPending = false;
  _rankingsScrollTargetY = null;       // stale deep-restore targets die with the old stream
  _rankingsScrollTargetWrapY = null;   // (handlers that want one set it AFTER their render)
  const teamScoped = (rankScope==='team' && currentTeam);
  const cacheKey = rankingsRenderCacheKey(teamScoped);
  const cachedHtml = rankingsRenderCacheGet(cacheKey);
  if(cachedHtml){
    // Phones: don't pay one giant parse for a board that's 80% below the fold — paint the
    // chrome + first slice, stream the rest into the live tbody over the next few frames.
    const split = _rankingsMobileNarrow() ? _rankingsSplitCachedRows(cachedHtml) : null;
    if(split){
      const token = ++_rankingsStreamToken;
      document.getElementById('content').innerHTML = split.pre + split.rows.slice(0, RANKINGS_STREAM_FIRST).join('') + split.post;
      hydrateRankingsHeadshots();
      rankingsUpdateReplacementLine();
      _rankingsStreamRows(token, split.rows.slice(RANKINGS_STREAM_FIRST), ()=>hydrateRankingsHeadshots());
    } else {
      document.getElementById('content').innerHTML = cachedHtml;
      hydrateRankingsHeadshots();
      rankingsUpdateReplacementLine();
    }
    // Cached HTML is always pristine — re-augment it if the column editor is open.
    if(typeof rankColEditAugment==='function' && typeof rankColEditActive!=='undefined' && rankColEditActive) rankColEditAugment();
    if(_rkDebug){
      const dt = (_rkNow()-_rkT0).toFixed(1);
      try{ console.info(`[rankings-latency] cache-hit total=${dt}ms stream=${split?1:0}`); }catch(_e){}
    }
    return;
  }

  const tBuildStart = _rkNow();
  let all=buildPlayerList();
  const tcrMap=_tcrMap(all);   // once per render — the rows and the sort both read this
  const tBuildDone = _rkNow();
  // Team-scoped rankings (from a team's Rankings tab) show only that team's players.
  let teamHeader='';
  if(teamScoped && currentTeam){
    const t=currentTeam;
    const state=userProj[t]||{qbs:[]};
    const prev=TEAMS[TEAMS.indexOf(t)-1], next=TEAMS[TEAMS.indexOf(t)+1];
    const isRef = activeSeason!=='proj';
    const recKey = `${activeSeason}:${t}`;
    if(isRef && espnRecordCache[recKey]==null) fetchTeamRecord(activeSeason,t);
    const recStr = isRef ? (espnRecordCache[recKey]||'') : '';
    const sos = SOS && SOS[t];
    const sosBadge = sos ? `<span class="team-sos">SOS: <b>${ordinal(sos.rank)}</b>${sos.win_total!=null?` · Vegas Win Total: <b>${sos.win_total}</b>`:''}</span>` : '';
    const hcLine = teamHeaderHcLine(t, { openTitle: 'Open playbook visualization' });
    teamHeader = `<div class="team-header">
      <img src="${NFL_LOGO(t)}" class="team-logo-lg scheme-open" alt="${t}" title="Open playbook visualization" onclick="openTeamCoachingScheme('${t}')" onerror="this.style.opacity='.25'">
      <div><div class="team-abbr team-fullname scheme-open" role="button" tabindex="0" title="Open playbook visualization" onclick="openTeamCoachingScheme('${t}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openTeamCoachingScheme('${t}');}">${teamDisplayName(t)} ${isRef?`<span class="ref-year">${activeSeason}</span>`:''}</div>
        <div class="team-qb-name">${teamHeaderQbText(t, state.qbs, recStr)}</div>
        ${hcLine}
        ${sosBadge?`<div class="team-sos-row">${sosBadge}</div>`:''}</div>
      <div class="team-nav">
        <button id="undoBtn" class="btn btn-ghost undo-btn ${canUndo(t)?'':'disabled'}" ${canUndo(t)?'':'disabled'} onclick="undoTeam('${t}')" title="Undo last working-set change to ${t}">↶ Undo<span id="undoCount">${canUndo(t)?' '+undoStacks[t].length:''}</span></button>
        ${prev?`<button class="btn btn-ghost" onclick="selectTeam('${prev}')">← ${prev}</button>`:''}
        ${next?`<button class="btn btn-accent" onclick="selectTeam('${next}')">${next} →</button>`:''}
      </div>
    </div>`;
  }
  if(teamScoped) all=all.filter(p=>p.team===currentTeam);
  if(!all.length){document.getElementById('content').innerHTML=
    `${teamScoped?`${teamHeader}<div class="phase-tabs la-icon-tabs">${tabBar()}</div>`:''}<div class="empty"><div class="empty-icon">${TC_ICON("trophy","tc-ico-lg")}</div>
     <div class="empty-title">No projections yet</div><div class="empty-body">Set at least one team's stats to see rankings.</div></div>`;return;}
  // Overall order is by fantasy points (your projections). ECR/tier come from FantasyPros.
  const tSortStart = _rkNow();
  all.sort((a,b)=>b.fpts-a.fpts);
  all.forEach((p,i)=>{ p.overall=i+1; });
  // live draft: mark drafted players
  const following = !!draftId;
  all.forEach(p=>{ p.drafted = following && !!draftedIds[p.player_id]; });
  const rankIsRookie = (p)=> (typeof rankingIsRookieForSeason==='function')
    ? !!rankingIsRookieForSeason(p, activeSeason)
    : !!(p && (p.is_rookie===true || Number(p.years_exp)===0));
  // Legacy: 'ROOKIES' used to BE the position filter (old note-nav payloads may still carry it).
  if(rankPosFilter==='ROOKIES'){ rankPosFilter='ALL'; rankRookiesOnly=true; }
  let view=rankPosFilter==='ALL'?all
    :rankPosFilter==='FLEX'?all.filter(p=>p.pos!=='QB')
    :all.filter(p=>p.pos===rankPosFilter);
  // ROOKIES stacks on top of the position filter — WR + ROOKIES = rookie WRs. Because the
  // position filter stays what it is, the Adv. Metrics view keeps that position's own
  // column set instead of collapsing to the all-position common columns.
  if(rankRookiesOnly) view=view.filter(rankIsRookie);
  if(following && hideDrafted) view=view.filter(p=>!p.drafted);
  const searchTokens = rankingsSearchTokens(rankingsSearchQuery);
  if(searchTokens.length){
    view = view.filter(p=>{
      const nm = String(p && p.name ? p.name : '').toLowerCase();
      return searchTokens.some(tok=>nm.includes(tok));
    });
  }
  // One pass to derive each player's value for the active advanced column, so the comparator
  // below is a Map lookup instead of a full sumerValue() derivation per comparison (which,
  // at n log n comparisons, means each player's value was recomputed a dozen-plus times).
  const _sumerSortKeys = new Map();
  if(rankSortKey.startsWith('sumer:')){
    const _lbl = rankSortKey.slice(6);
    view.forEach(p=>_sumerSortKeys.set(p, sumerValue(p, _lbl)));
  }
  const _sumerSortKeyFor = (p, label)=>{
    if(_sumerSortKeys.has(p)) return _sumerSortKeys.get(p);
    const v = sumerValue(p, label);   // player not in the prepass (shouldn't happen) — derive
    _sumerSortKeys.set(p, v);
    return v;
  };
  // Live view, Δ column opted in: annotate every row with its pace vs the kickoff baseline
  // BEFORE sorting so the column sorts through the generic numeric comparator.
  const liveView = (typeof currentProjViewMode==='function' && currentProjViewMode()==='live');
  const paceActive = (liveView && typeof rankLiveDelta!=='undefined' && rankLiveDelta
    && typeof buildPaceIndex==='function' && !!buildPaceIndex());
  if(paceActive){
    view.forEach(p=>{
      const e=paceForPlayer(p.name, p.pos, p.player_id);
      p.pacePct = e && e.gp>0 && e.base>0 ? e.pct : null;
      p.paceTip = e && e.gp>0 ? `17-game pace ${e.pace17.toFixed(0)} vs projected ${e.base.toFixed(0)} · ${e.gp} gm${e.gp===1?'':'s'}` : '';
      p.paceCls = e ? e.cls : '';
    });
  }
  view=[...view].sort((a,b)=>{
    if(rankSortKey==='ecr'){
      // Unranked players sort to the bottom regardless of direction.
      const av=a.ecr==null?99999:a.ecr, bv=b.ecr==null?99999:b.ecr;
      return (av-bv)*(rankSortDir<0?1:-1);
    }
    if(rankSortKey==='adp'){
      const av=adpFor(a), bv=adpFor(b);
      const am=(av==null||av>=999), bm=(bv==null||bv>=999);
      if(am&&bm) return b.fpts-a.fpts;
      if(am) return 1;
      if(bm) return -1;
      return (av-bv)*(rankSortDir<0?1:-1);
    }
    if(rankSortKey==='name') return a.name.localeCompare(b.name)*(rankSortDir<0?1:-1);
    if(rankSortKey==='team') return a.team.localeCompare(b.team)*(rankSortDir<0?1:-1);
    if(rankSortKey==='pos') return (({QB:1,RB:2,WR:3,TE:4})[a.pos]-({QB:1,RB:2,WR:3,TE:4})[b.pos])*(rankSortDir<0?1:-1)||b.fpts-a.fpts;
    // Contract columns: players with no contract data always sort to the bottom.
    if(rankSortKey==='pacePct'){
      const av=a.pacePct, bv=b.pacePct;
      if(av==null && bv==null) return b.fpts-a.fpts;
      if(av==null) return 1;
      if(bv==null) return -1;
      return (bv-av)*(rankSortDir<0?1:-1);
    }
    if(rankSortKey==='age'||rankSortKey==='apy'||rankSortKey==='fa'){
      const av=a[rankSortKey], bv=b[rankSortKey];
      if(av==null && bv==null) return b.fpts-a.fpts;
      if(av==null) return 1;
      if(bv==null) return -1;
      return (av-bv)*(rankSortDir<0?1:-1);
    }
    // TC model column: rookies/unscored players have no number and always sink.
    if(rankSortKey==='tc'){
      const av=a.tcPts, bv=b.tcPts;
      if(av==null && bv==null) return b.fpts-a.fpts;
      if(av==null) return 1;
      if(bv==null) return -1;
      return (bv-av)*(rankSortDir<0?1:-1);   // default high→low
    }
    // TC Rating: unrated players (no ADP or no TC number) sink.
    if(rankSortKey==='tcr'){
      const m=tcrMap;
      const av=m.get(String(a.player_id||a.name)), bv=m.get(String(b.player_id||b.name));
      if(av==null && bv==null) return b.fpts-a.fpts;
      if(av==null) return 1;
      if(bv==null) return -1;
      return (bv-av)*(rankSortDir<0?1:-1);
    }
    // SumerSports advanced columns (key "sumer:<label>"): players missing that stat sink.
    // sumerValue() is not cheap — it allocates a table object under a refinement, normalises
    // the player name with three regexes, and linear-scans the column list — so calling it
    // from inside the comparator re-derived both operands on every comparison. The values are
    // precomputed into _sumerSortKeys before the sort (see below) and read back here.
    if(rankSortKey.startsWith('sumer:')){
      const label=rankSortKey.slice(6);
      const av=_sumerSortKeyFor(a,label), bv=_sumerSortKeyFor(b,label);
      const an=(typeof av==='number'), bn=(typeof bv==='number');
      if(!an && !bn) return b.fpts-a.fpts;
      if(!an) return 1;
      if(!bn) return -1;
      return (bv-av)*(rankSortDir<0?1:-1);   // default high→low
    }
    return ((b[rankSortKey]||0)-(a[rankSortKey]||0))*(rankSortDir<0?1:-1);
  });
  // During a live follow, the VONA sim (cached per draft state) knows every player's odds of
  // surviving to my next pick — dim the rows the market will almost certainly take first, and
  // hang scarcity tooltips on the position chips. One Map read per row; no new computation.
  let vonaLive=null;
  if(following && mySlot!=null && !teamScoped && activeSeason==='proj' && typeof computeVONA==='function'){
    try{ vonaLive=computeVONA(); }catch(e){ vonaLive=null; }
  }
  const vonaAvail = vonaLive && vonaLive.pAvail;
  const tierC=['','var(--accent)','var(--info)','var(--warn)','var(--danger)','var(--muted)','#8b7cff','#6ad1c4'];
  const tierColor=t=>t?tierC[Math.min(t,7)]:'var(--border)';
  // Two-line header helper. `grp` adds a left border to mark a stat group's start.
  // TC Rating map, memoized per board signature (rebuilds on format/board change).
  const th=(k,l1,l2,cls,grp,rc)=>{const a=rankSortKey===k;
    // data-rc / data-rcg mark customizable columns for the long-press editor (81-rank-coledit.js):
    // rc = a meta column's pref key; stat-group columns carry their group derived from class.
    const g=(cls||'').match(/^grp-(rush|rec|pass)/);
    const tag = rc ? ` data-rc="${rc}"` : (g ? ` data-rcg="${g[1]}"` : '');
    return `<th onclick="rankSort('${k}')" class="${cls||''} ${grp?'grp-start':''}"${tag} style="${a?'color:var(--accent)':''}">
      <div class="th-stack">${l1}${l2?`<br>${l2}`:''}${a?(rankSortDir<0?' ↓':' ↑'):''}</div></th>`;};
  // Dynasty tab only: three extra columns (Age / APY / Free-Agency year) right after TM.
  // FA is highlighted red when it's the very next season (contracts expiring soonest).
  const isDynasty = rankFormat==='dynasty' || rankFormat==='dynasty_superflex';
  // Synced league → an OWNER column (manager handle) right after TM, on every row.
  const ownerActive = (typeof tcOwnerActive==='function' && typeof tcOwnerPill==='function') ? tcOwnerActive() : false;
  const nextYear = PROJ_SEASON + 1;
  // Advanced (SumerSports) view: reference-season only. When active, the rush/rec/pass stat
  // columns are replaced by this season's Sumer metrics for the selected position (or the
  // columns common to the positions in view for ALL/FLEX). Falls back to standard silently
  // if there's no usable column set.
  // Situational split is only meaningful on the Adv. Metrics view; drop a stale selection that
  // the current season/position no longer offers so the table + dropdown stay in sync.
  if(rankAdvanced && sumerRefinement && !sumerRefinementsForFilter().includes(sumerRefinement)) sumerRefinement=null;
  const sumerView = (rankAdvanced && sumerAvailable()) ? sumerColumnsForFilter() : null;
  // User column prefs apply to the adv view too — hide by 'adv:<label>', reorder by advOrder.
  // Header and cells both iterate sumerView.cols, so one permuted array keeps them in sync.
  if(sumerView && typeof rankAdvApplyPrefs==='function') sumerView.cols = rankAdvApplyPrefs(sumerView.cols);
  const advActive = !!sumerView;
  const nStatCols = advActive ? sumerView.cols.length : 12;
  // Two-line-ify a Sumer column label so headers stack like the standard ones.
  const sumerHead = (label)=>{ const t=label.split(' '); return t.length>1 ? `${t.slice(0,-1).join(' ')}<br>${t[t.length-1]}` : label; };
  // Adv. Metrics minimum-volume filter: hide small-sample players (below the Plays/Routes/Rushes
  // floor for their position) so rate stats stay meaningful. Applied after sorting.
  if(advActive){
    view = view.filter(p=>{
      const min = sumerMin[sumerBucket(p.pos)]||0;
      if(min<=0) return true;
      const v = sumerValue(p, sumerVolCol(p.pos));
      return typeof v==='number' && v>=min;
    });
  }
  const searchActive = !!(rankingsSearchOpen || (rankingsSearchQuery||'').trim());
  const mobileNarrow = _rankingsMobileNarrow();
  const tSortDone = _rkNow();
  // Projected-pick lines: when following a draft with a known seat and the board is in draft
  // order (sorted by ECR). This is *especially* useful with "hide drafted" on, since the board
  // then shows only available players and the line marks exactly how far down your pick lands.
  const inDraftOrder = rankSortKey==='ecr';
  // Pick gaps are counted in TOTAL picks, so the line is only meaningful on the unfiltered
  // board: with the WR filter on it sat after the 11th available WR, far past your pick.
  // The line used to require an unfiltered board, because gaps were counted in
  // TOTAL picks: with a WR filter on, "18 picks away" landed 18 WRs down. But the
  // filtered board is exactly where you want it — "which of these reaches me?".
  // So under a filter, count in MARKET terms instead: how many of the players
  // SHOWN are priced to go before that turn of yours. Same question, asked of the
  // ADP board for this format rather than of raw pick numbers.
  const showPickLines = following && mySlot!=null && inDraftOrder && !(rankingsSearchQuery||'').trim();
  const filteredBoard = !(rankPosFilter==='ALL' && !rankRookiesOnly);
  let pickGaps=[];   // successive counts of players between your turns
  let myPickNos=[];  // the actual pick numbers those turns land on
  if(showPickLines){
    const { teams, type, reversalRound, rounds } = draftParams();
    const start = currentPickNo();
    const maxPick = teams*rounds;
    // gaps: from now, how many LIVE picks between each of your turns. Keeper drafts
    // pre-populate future picks in the feed — those consume no board player (their players
    // are already marked drafted), so counting them drifted every line too deep. A future
    // pick of MINE that's already a keeper doesn't get a line either: that turn is spent.
    const feed = (typeof _draftFeedPickNos==='function') ? _draftFeedPickNos() : new Set();
    let liveBetween=0;
    myPickNos=[];
    for(let n=start; n<=maxPick; n++){
      if(slotOnClock(n, teams, type, reversalRound)===mySlot){
        if(!feed.has(n)){
          pickGaps.push(liveBetween);   // players taken by others before this, your turn
          myPickNos.push(n);
          liveBetween=0;
          if(pickGaps.length>=rounds) break;
        }
      } else if(!feed.has(n)) liveBetween++;
    }
    // Filtered board: a line goes after the shown players the market expects to be
    // gone by that pick — i.e. those whose ADP is earlier than it. Counted over the
    // rows actually on screen, so it lands where you can see it.
    if(filteredBoard){
      const shown=view.filter(p=>!p.drafted);
      pickGaps=myPickNos.map((n,k)=>{
        let c=0;
        shown.forEach(p=>{ const a=adpFor(p); if(a!=null && a<999 && a<n) c++; });
        return Math.max(0, c-k);   // your own earlier picks consumed a row each
      });
      // Successive counts, mirroring the unfiltered path's "players between turns".
      let prev=0;
      pickGaps=pickGaps.map(c=>{ const g=Math.max(0,c-prev); prev=c; return g; });
    }
  }
  // ── Customizable columns ──────────────────────────────────────────────────────────────
  // The meta columns render from ONE ordered key list so user prefs (hide / drag-reorder,
  // 81-rank-coledit.js) permute a single array instead of two parallel template literals.
  // ADP and TC exist only on the projection board: reference seasons have no market ADP and
  // the TC model projects the UPCOMING season, so both drop entirely there (not just go blank).
  const projBoard = activeSeason==='proj';
  const availMeta = new Set(['ecr','ecr_tier','fpts','vor','pos','name','team']);
  if(projBoard){ availMeta.add('adp');
    // TC/TC★ only when someone actually carries model data — a seedless board (live-Sleeper
    // fallback, no TC model) would otherwise offer columns that render entirely blank.
    if(all.some(p=>p.tcPts!=null)) availMeta.add('tc');
    if(tcrMap.size) availMeta.add('tcr'); }
  _rcLastAvail = availMeta;   // the reveal tray only offers chips this board can populate
  if(ownerActive) availMeta.add('own');
  if(isDynasty){ availMeta.add('age'); availMeta.add('apy'); availMeta.add('fa'); }
  const hiddenCols = (typeof rankColHidden==='function') ? rankColHidden() : new Set();
  const metaOrder = ((typeof rankColOrder==='function') ? rankColOrder() : ['ecr','ecr_tier','tc','tcr','adp','fpts','vor','pos','name','team','own','age','apy','fa'])
    .filter(k=>availMeta.has(k) && !hiddenCols.has(k));
  // Stat groups hide as whole units (ATT/YDS/… of a group live or die together); the adv view
  // is its own opt-in column set and ignores group prefs.
  const statGroupsVisible = advActive ? [] : ['rush','rec','pass'].filter(g=>!hiddenCols.has('grp_'+g));
  const nStatColsVis = advActive ? nStatCols : statGroupsVisible.length*4;
  const totalCols = metaOrder.length + (paceActive && metaOrder.includes('fpts') ? 1 : 0) + nStatColsVis;
  const pickLineRow=(round)=>`<tr class="rank-pickline"><td colspan="${totalCols}">
    <span class="rank-pickline-lbl" data-pick="${round==1?'Your pick · next up':`Your pick #${round}`}">▸ Your pick ${round==1?'(next up)':`#${round}`} projected here</span></td></tr>`;

  let undraftedSeen=0, nextGapIdx=0, gapRemaining=(pickGaps[0]!=null?pickGaps[0]:-1);
  const rowChunks=[];
  const tRowsStart = _rkNow();
  const rankBaseContext = activeSeason==='proj'
    ? `${PROJ_SEASON} projections · ${teamScoped?`${currentTeam} rankings`:'full rankings'}`
    : `${teamScoped?`${currentTeam} rankings`:'full rankings'} · ${activeSeason}`;
  const rankNoteContext = `${rankBaseContext}${advActive?` · adv metrics${sumerRefinement?` · ${SUMER_REFINE_LABELS[sumerRefinement]||sumerRefinement}`:''}`:''}`;
  // Per-cell note tags carry ONLY what differs cell to cell. Everything constant for the row
  // — context string, nav payload, player identity, team — is emitted once on the <tr> by
  // rankNoteScopeAttrs() below and inherited at click time (see noteInfoFromElement).
  //
  // Measured on a phone-width board before this split: data-note-* attributes were 848KB,
  // 57.9% of the table's entire HTML, with the nav JSON re-serialised once per tagged cell
  // (~2,000 times) for ~32 distinct values.
  // `value` is omitted on purpose: it is exactly this cell's rendered text, which
  // noteInfoFromElement reads back from the DOM. `source` is constant for the whole render
  // and rides on the row. That leaves two genuinely per-cell attributes.
  const rankValueHtml = (display, p, label, statKey, source)=> noteCellHtml(display, {
    label,
    statKey,
  }, 'note-tag-hit');
  // Built once per row. The nav object is identical for every cell in a row and takes only a
  // handful of distinct values across the whole table, so memoise on the one field that varies.
  const _navByTeam = new Map();
  const rankNavFor = (team)=>{
    let n = _navByTeam.get(team);
    if(!n){
      n = { type:'rankings', season:String(activeSeason), scope: teamScoped?'team':'all',
            team: teamScoped?currentTeam:team, advanced: advActive,
            refinement: sumerRefinement||'', posFilter: rankPosFilter, rookies: rankRookiesOnly };
      _navByTeam.set(team, n);
    }
    return n;
  };
  const rankNoteSource = advActive ? 'rankings_advanced' : 'rankings';
  const rankNoteScopeAttrs = (p)=> noteScopeAttrs({
    context: rankNoteContext,
    source: rankNoteSource,
    player: p,
    team: p.team,
    nav: rankNavFor(p.team),
  });
  const statCell = (v, p, label, statKey)=>{
    if(!(v && v>0)) return '';
    const txt = (+v)%1!==0?(+v).toFixed(1):(+v).toLocaleString();
    return rankValueHtml(`<span class="num">${txt}</span>`, p, label, statKey, advActive?'rankings_advanced':'rankings');
  };
  view.forEach(p=>{
    // emit a pick line right before the player who'd fall to your pick
    if(showPickLines && nextGapIdx<pickGaps.length && !p.drafted && undraftedSeen===gapRemaining){
      rowChunks.push(pickLineRow(nextGapIdx+1));
      nextGapIdx++;
      // -1, not 0: the row rendered under this line is YOUR projected pick — it consumes a
      // board row but is not one of the OTHER teams' picks the next gap counts. Counting it
      // drifted every later line a row too high, and a snake-corner seat (gap 0 between its
      // back-to-back picks) could never re-match and silently lost every remaining line.
      undraftedSeen=-1;
      gapRemaining=(pickGaps[nextGapIdx]!=null?pickGaps[nextGapIdx]:-1);
      // Corner seat: the very next line has gap 0 — emit it immediately after this row.
      while(nextGapIdx<pickGaps.length && gapRemaining===0){
        rowChunks.push(pickLineRow(nextGapIdx+1));
        nextGapIdx++;
        gapRemaining=(pickGaps[nextGapIdx]!=null?pickGaps[nextGapIdx]:-1);
        undraftedSeen=-2;   // two of the next rows are our own picks
      }
    }
    const ecrTxt = p.ecr!=null ? p.ecr : '—';
    const tier = p.ecr_tier;
    const adpV = adpFor(p);
    const adpTxt = (adpV!=null && adpV<999) ? (adpV%1 ? adpV.toFixed(1) : String(adpV)) : '—';
    const ypc = p.ypc>0 ? p.ypc.toFixed(1) : '';
    const pNameAttr = escAttr(p.name);
    const pNameText = escHtml(p.name);
    const pTeamAttr = escAttr(p.team);
    const pTeamText = escHtml(p.team);
    // Stat cells: standard rush/rec/pass groups, or SumerSports advanced columns when active.
    let statCells;
    if(advActive){
      statCells = sumerView.cols.map((label,ci)=>{
        const v=sumerValue(p,label);
        const isPct=sumerView.pct.has(label);
        const txt = v==null ? '' : fmtSumer(v,isPct);
        return `<td class="grp-adv${ci===0?' grp-start':''}">${txt?rankValueHtml(`<span class="num">${txt}</span>`, p, label, `sumer:${label}`, 'rankings_advanced'):''}</td>`;
      }).join('');
    } else {
      const grpCells = {
        rush: `<td class="grp-rush">${statCell(p.rushing_attempts,p,'Rush Attempts','rushing_attempts')}</td><td class="grp-rush-mid">${statCell(p.rushing_yards,p,'Rush Yards','rushing_yards')}</td><td class="grp-rush-mid">${ypc?rankValueHtml(`<span class="num">${ypc}</span>`, p, 'Yards Per Carry', 'ypc', 'rankings'):''}</td><td class="grp-rush-end">${statCell(p.rushing_tds,p,'Rush Touchdowns','rushing_tds')}</td>`,
        rec:  `<td class="grp-rec">${statCell(p.receiving_targets,p,'Targets','receiving_targets')}</td><td class="grp-rec-mid">${statCell(p.receptions,p,'Receptions','receptions')}</td><td class="grp-rec-mid">${statCell(p.receiving_yards,p,'Receiving Yards','receiving_yards')}</td><td class="grp-rec-end">${statCell(p.receiving_tds,p,'Receiving Touchdowns','receiving_tds')}</td>`,
        pass: `<td class="grp-pass">${statCell(p.passing_attempts,p,'Pass Attempts','passing_attempts')}</td><td class="grp-pass-mid">${statCell(p.passing_yards,p,'Pass Yards','passing_yards')}</td><td class="grp-pass-mid">${statCell(p.passing_tds,p,'Pass Touchdowns','passing_tds')}</td><td class="grp-pass-end">${statCell(p.interceptions_thrown,p,'Interceptions Thrown','interceptions_thrown')}</td>`,
      };
      statCells = statGroupsVisible.map(g=>grpCells[g]).join('');
    }
    const fptsTxt = p.fpts.toFixed(1);
    // Live Δ column (opt-in): ONE colored ±% pill vs the kickoff-frozen projection — the
    // detail rides in the tooltip, not the grid.
    let fptsCells = `<td class="fpts">${rankValueHtml(fptsTxt, p, 'Fantasy Points', 'fpts', 'rankings')}</td>`;
    if(paceActive){
      const pill = p.pacePct!=null
        ? `<span class="pace-chip ${p.paceCls}" title="${escAttr(p.paceTip||'')}">${p.pacePct>=0?'▲+':'▼−'}${Math.round(Math.abs(p.pacePct)*100)}%</span>`
        : `<span class="pace-chip pace-thin">—</span>`;
      fptsCells += `<td class="c-pace-delta">${pill}</td>`;
    }
    const vorTxt = `${p.vor>0?'+':''}${p.vor!=null?p.vor.toFixed(1):'—'}`;
    const pSearchAttr = escAttr(String(p.name||'').toLowerCase());
    const volBucket = advActive ? String(sumerBucket(p.pos)||'') : '';
    const volCol = advActive ? sumerVolCol(p.pos) : '';
    const volVal = (advActive && volCol) ? sumerValue(p, volCol) : null;
    const volAttrs = advActive
      ? ` data-rank-sumer-bucket="${escAttr(volBucket)}" data-rank-sumer-vol="${(volVal!=null && Number.isFinite(+volVal)) ? escAttr(String(+volVal)) : ''}"`
      : '';
    // Meta cells keyed by pref key; the row emits them in the user's column order. Keys not
    // in metaOrder are simply never built into the string (the ternaries below stay cheap).
    const faSoon = p.fa!=null && p.fa===nextYear;   // hits free agency next season
    const metaTd = {
      ecr: `<td class="c-ecr">${ecrTxt!=='—'?rankValueHtml(ecrTxt, p, 'Expert Consensus Rank', 'ecr', 'rankings'):ecrTxt}</td>`,
      ecr_tier: `<td class="c-tier">${tier!=null?rankValueHtml(`<span class="tier-pill" style="background:${tierColor(tier)}">${tier}</span>`, p, 'Tier', 'ecr_tier', 'rankings'):''}</td>`,
      tc: `<td class="c-tc"${p.tcPts!=null?` title="TC model · projected season fantasy points (your scoring)"`:''}>${p.tcPts!=null?rankValueHtml(`<span class="num">${p.tcPts.toFixed(1)}</span>`, p, 'TC Model Projection', 'tcPts', 'rankings'):''}</td>`,
      tcr: (()=>{ const v=tcrMap.get(String(p.player_id||p.name));
        const cls=v==null?'':v>=75?' tcr-hi':v<=25?' tcr-lo':'';
        return `<td class="c-tcr${cls}"${v!=null?` title="TripleCrown Rating ${v} · market ADP blended with the TC model at the validated per-position weight (QB 12% · RB 0% · WR 50% · TE 25% model) — percentile within position"`:''}>${v!=null?`<span class="num">${v}</span>`:''}</td>`;})(),
      adp: `<td class="c-adp"${adpTxt!=='—'?` title="Market ADP (${rankFormat.replace(/_/g,' ')} board)"`:''}>${adpTxt!=='—'?`<span class="num">${adpTxt}</span>`:''}</td>`,
      fpts: fptsCells,
      vor: `<td class="c-vor">${rankValueHtml(`<span class="vor-val ${p.vor>0?'vor-pos':p.vor<0?'vor-neg':''}">${vorTxt}</span>`, p, 'Value Over Replacement', 'vor', 'rankings')}</td>`,
      pos: `<td class="c-pos"><span class="pos-badge pos-${p.pos}">${p.pos}</span></td>`,
      name: `<td class="c-player"><div style="display:flex;align-items:center;gap:6px">${
        (typeof draftStars!=='undefined' && following) ? rankStarBtn(p) : ''
      }<div class="clickable-player" style="display:flex;align-items:center;gap:6px;min-width:0" title="${pNameAttr}" onclick="${pcardOnclick(p.player_id||p.name, p.pos, p.team||'')}">${rankHeadshotSlotHtml(p)}<span class="rank-name">${pNameText}</span>${typeof tcInjuryTagBtn==='function'?tcInjuryTagBtn(p.player_id):''}</div></div></td>`,
      team: `<td class="c-team"><img src="${NFL_LOGO(p.team)}" class="rank-logo" alt="${pTeamAttr}" loading="lazy" decoding="async" onerror="this.style.display='none'"> ${pTeamText}</td>`,
      own: ownerActive?`<td class="c-own">${tcOwnerPill(p.player_id, p.name)}</td>`:'',
      age: `<td class="c-age">${p.age!=null?`<span class="num">${p.age}</span>`:''}</td>`,
      apy: `<td class="c-apy">${p.apy!=null?`<span class="num">${fmtAPY(p.apy)}</span>`:''}</td>`,
      fa: `<td class="c-fa ${faSoon?'fa-soon':''}">${p.fa!=null?`<span class="num">${p.fa}</span>`:''}</td>`,
    };
    let fadeCls='';
    if(vonaAvail && !p.drafted){
      const pa=vonaAvail.get(p.player_id||p.name);
      if(pa!=null && pa<0.25) fadeCls=' rank-fade';
    }
    const starCls=(typeof isDraftStar==='function' && isDraftStar(p)) ? ' rank-starred' : '';
    rowChunks.push(`<tr class="${p.drafted?'drafted':''}${fadeCls}${starCls}" data-star-row="${escAttr(String(p.player_id||p.name))}" data-rank-search="${pSearchAttr}" data-rank-pos="${p.pos}" data-rank-vor="${p.vor>0?'1':'0'}"${rankIsRookie(p)?' data-rank-rk="1"':''}${volAttrs}${rankNoteScopeAttrs(p)}>
    ${metaOrder.map(k=>metaTd[k]).join('\n    ')}
    ${statCells}
  </tr>`);
    if(!p.drafted) undraftedSeen++;
  });
  const rows=rowChunks.join('');
  const tRowsDone = _rkNow();
  // Two-axis format picker: league TYPE (redraft/dynasty) + SCORING (std/half/full/superflex).
  const curType=leagueTypeOf(rankFormat);
  const curScoring=scoringAxis;   // source of truth for the scoring buttons (independent of rankFormat)
  const typeBtns=[['redraft','Re-Draft'],['dynasty','Dynasty']]
    .map(([t,l])=>`<button class="ltype-btn ${curType===t?'active':''}" onclick="setLeagueType('${t}')">${l}</button>`).join('');
  const scoringList=[['std','Standard'],['half_ppr','Half PPR'],['ppr','Full PPR'],['superflex','Superflex']];
  const fmtBtns=scoringList
    .map(([s,l])=>`<button class="format-btn ${curScoring===s?'active':''}" onclick="setScoringAxis('${s}')">${l}</button>`).join('');
  const posBtns=['ALL','QB','RB','WR','TE','FLEX'].map(pos=>{
    let tip='';
    const st = vonaLive && vonaLive.struct && vonaLive.struct[pos];
    if(st) tip=` title="${st.supply} startable ${pos}s left \u00b7 ${Math.round(st.demand)} league starter slots still open"`;
    return `<button class="pos-filter-btn ${rankPosFilter===pos?'active':''}" onclick="setPosFilter('${pos}')"${tip}>${pos}</button>`;
  }).join('')
    // ROOKIES is an overlay, not a position: it stays lit NEXT TO the active position chip.
    +`<button class="pos-filter-btn rookies-filter-btn ${rankRookiesOnly?'active':''}" onclick="toggleRookiesFilter()" title="Show only rookies — stacks with the position filter">ROOKIES</button>`;
  const searchOpen = searchActive;
  const searchPlaceholder = 'Search players (comma separated)';
  // Advanced-metrics toggle — only on a reference season nflverse has player data for.
  // Switches the stat columns to advanced per-player metrics (computed from
  // nflverse play-by-play; SumerSports was retired as a source).
  const sumerOn = sumerAvailable();
  const advToggle = sumerOn
    ? `<span class="tc-label">STATS</span>
       <div class="format-toggle">
         <button class="format-btn ${!rankAdvanced?'active':''}" onclick="setRankAdvanced(false)">Standard</button>
         <button class="format-btn ${rankAdvanced?'active':''}" onclick="setRankAdvanced(true)" title="nflverse advanced ${sumerSeasonKey()} metrics">Adv. Metrics</button>
       </div>`
    : '';
  // Live view only: opt-in Δ-vs-projection column (off by default — the live board stays a
  // clean stat sheet until the comparison is asked for).
  const liveDeltaToggle = (liveView && typeof toggleRankLiveDelta==='function' && typeof buildPaceIndex==='function' && buildPaceIndex())
    ? `<button class="format-btn rank-delta-toggle ${typeof rankLiveDelta!=='undefined'&&rankLiveDelta?'active':''}" onclick="toggleRankLiveDelta()" title="Show each player's pace vs the projections frozen at kickoff">Δ proj</button>`
    : '';
  const minInputs = advActive ? sumerMinInputs() : '';
  // "Situational" dropdown — Adv. Metrics only. Swaps the stat columns to a game-situation
  // split (Red Zone / When Trailing / vs. Man / per-down / box counts …) for the season.
  const refineOpts = advActive ? sumerRefinementsForFilter() : [];
  const situationalSelect = (advActive && refineOpts.length)
    ? `<span class="tc-label">SITUATIONAL</span>
       <select class="sumer-situational" onchange="setSumerRefinement(this.value)" title="Filter Adv. Metrics by game situation">
         <option value=""${!sumerRefinement?' selected':''}>Standard</option>
         ${refineOpts.map(r=>`<option value="${r}"${sumerRefinement===r?' selected':''}>${SUMER_REFINE_LABELS[r]||r}</option>`).join('')}
       </select>`
    : '';
  const advNote = advActive
    ? `<span class="ecr-missing" style="color:var(--muted)">${TC_ICON("chart")} nflverse advanced ${sumerSeasonKey()} stats${sumerRefinement?` · ${SUMER_REFINE_LABELS[sumerRefinement]||sumerRefinement}`:''}${sumerView.single?'':' · common columns (pick a position for the full set)'}${((sumerRefinement==='vs_man'||sumerRefinement==='vs_zone'))?' · coverage counts approximate, rates accurate':''}</span>`
    : '';
  const ecrNote = hasECR() ? '' : `<span class="ecr-missing">${TC_ICON("warning")} No FantasyPros ECR loaded — run build_seed.py and load the seed to populate ECR/Tier</span>`;
  const pageOf = (rowsHtml)=>`
    ${teamScoped ? `${teamHeader}<div class="phase-tabs la-icon-tabs">${tabBar()}</div>` : ''}
    <div class="rankings-scope-bar">
      ${teamScoped
        ? `<span class="scope-title">${currentTeam} Rankings</span><span class="scope-sub">this team only</span>
           <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="showFullRankings()">View full league →</button>`
        : `<span class="scope-title">Full League Rankings</span><span class="scope-sub">all ${all.length} players</span>`}
    </div>
    <div class="card card-flush scoring-card ${scoringPanelOpen?'open':''}" style="margin-bottom:12px">
      <div class="scoring-head" onclick="toggleScoringPanel()" title="Show / hide scoring settings">
        <span class="scoring-caret">\u25b8</span>
        <span class="scoring-title">Scoring Settings</span>
        <span class="scoring-summary">${scoringSummary()}</span>
        <button class="btn btn-accent btn-sm scoring-recalc" onclick="event.stopPropagation();recalcRankings()">Recalculate</button>
        <span class="scoring-edit">edit \u203a</span>
      </div>
      <div class="scoring-body">
        <div class="scoring-grid">
          <div class="scoring-field"><label>PASS YDS / FPTS</label><input id="sc_pass_yds_ydg" type="number" value="${scoringSettings.passing_yards_yardage}" step="1"></div>
          <div class="scoring-field"><label>PASS TD</label><input id="sc_pass_td" type="number" value="${scoringSettings.passing_touchdowns}" step="0.5"></div>
          <div class="scoring-field"><label>INT PTS</label><input id="sc_int" type="number" value="${scoringSettings.interceptions_thrown}" step="0.5"></div>
          <div class="scoring-field"><label>RUSH YDS / FPTS</label><input id="sc_rush_yds_ydg" type="number" value="${scoringSettings.rushing_yards_yardage}" step="1"></div>
          <div class="scoring-field"><label>RUSH TD</label><input id="sc_rush_td" type="number" value="${scoringSettings.rushing_touchdowns}" step="0.5"></div>
          <div class="scoring-field"><label>REC YDS / FPTS</label><input id="sc_rec_yds_ydg" type="number" value="${scoringSettings.receiving_yards_yardage}" step="1"></div>
          <div class="scoring-field"><label>REC TD</label><input id="sc_rec_td" type="number" value="${scoringSettings.receiving_touchdowns}" step="0.5"></div>
          <div class="scoring-field"><label>REC (PPR)</label><input id="sc_rec" type="number" value="${scoringSettings.receptions}" step="0.25"></div>
          <div class="scoring-field"><label>TE PREM</label><input id="sc_rec_te" type="number" value="${scoringSettings.receptions_te_bonus}" step="0.25" title="Extra points per reception for TEs only, on top of PPR. 0.5 here = a 1.5-PPR-TE league in full PPR."></div>
          <div class="scoring-field"><label>FUMBLE</label><input id="sc_fum" type="number" value="${scoringSettings.fumbles_lost}" step="0.5"></div>
          <div class="scoring-field"><label>PASS ATT</label><input id="sc_pass_att" type="number" value="${scoringSettings.passing_attempts}" step="0.1"></div>
          <div class="scoring-field"><label>PASS COMP</label><input id="sc_pass_comp" type="number" value="${scoringSettings.passing_completions}" step="0.1"></div>
          <div class="scoring-field"><label>RUSH ATT</label><input id="sc_rush_att" type="number" value="${scoringSettings.rushing_attempts}" step="0.1"></div>
        </div>
      </div>
    </div>
    <div class="card card-flush">
      ${following ? (()=>{
        const bannerOpen = typeof draftBannerOpen!=='undefined' && draftBannerOpen;
        const done = typeof _draftDone!=='undefined' && _draftDone;
        const statusPill = done ? `<span class="draft-done">DRAFT COMPLETE</span>` : `<span class="draft-live">LIVE</span>`;
        const u = (mySlot!=null) ? picksUntilMyTurn(mySlot) : null;
        // Collapsed: just the glowing pill — plus the one thing that can't wait, being on the clock.
        if(!bannerOpen) return `<div class="draft-mini">
          <button class="draft-mini-pill" onclick="toggleDraftBanner()" title="Draft status — tap for details">${statusPill}${(u===0&&!done)?`<span class="draft-onclock">★ YOU'RE UP</span>`:''}<span class="draft-mini-caret">▾</span></button>
        </div>`;
        return `<div style="padding:8px 14px;border-bottom:1px solid var(--border)">
        <div class="draft-banner">
          <button class="draft-mini-pill" onclick="toggleDraftBanner()" title="Collapse">${statusPill}<span class="draft-mini-caret">▴</span></button>
          <span>Following draft <b>${draftId}</b> · ${Object.keys(draftedIds).length} picks made</span>
          ${(mySlot!=null)?(u===0?`<span class="draft-onclock">★ YOU'RE ON THE CLOCK</span>`:u!=null?`<span class="draft-upturn">seat ${mySlot} · ${u} pick${u===1?'':'s'} until you're up</span>`:`<span class="draft-upturn">seat ${mySlot}</span>`):`<span class="draft-upturn">tap your seat in the bar below ↓</span>`}
          <label style="display:flex;align-items:center;gap:5px;cursor:pointer;margin-left:8px">
            <input type="checkbox" ${hideDrafted?'checked':''} onchange="toggleHideDrafted()"> hide drafted</label>
          <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="stopDraftFollow()">Stop</button>
        </div></div>`;
      })() : ''}
      ${(!following && leaguePickerState.open) ? renderLeaguePicker() : ''}
      <div class="rank-toolbar">
        <div class="rank-toolbar-row">
          <div class="pos-filter">${posBtns}</div>
          <button class="btn btn-ghost btn-sm rank-search-toggle ${searchOpen?'active':''}" onclick="toggleRankingsSearch()" title="Search rankings players">${TC_ICON("search")}</button>
          <div class="rank-search-wrap ${searchOpen?'':'rank-search-hidden'}">
            <input id="rankSearchInput" class="rank-search-input" type="text" value="${escAttr(rankingsSearchQuery||'')}" placeholder="${searchPlaceholder}" oninput="setRankingsSearchQuery(this.value, this.selectionStart, this.selectionEnd)">
            <button class="btn btn-ghost btn-sm rank-search-clear ${(rankingsSearchQuery||'').trim()?'':'rank-search-hidden'}" onclick="clearRankingsSearch()" title="Clear search">Clear</button>
          </div>
          ${liveDeltaToggle}
          <button class="btn btn-ghost btn-sm rank-filters-toggle ${rankFiltersOpen?'active':''}" onclick="toggleRankFilters()" title="League, scoring, stat views &amp; filters" aria-label="Menu">${TC_ICON("menu")}</button>
          <span id="rankPlayerCount" data-default-label="${escAttr(`${view.length} players`)}" class="rank-count">${view.length} players</span>
          ${vonaAvail?`<span class="rank-fade-key" title="From the availability model: under a 25% chance they last until your next pick">dimmed = likely gone before your pick</span>`:''}
        </div>
        <div class="rank-toolbar-row rank-filters ${rankFiltersOpen?'open':''}">
          <span class="tc-label">LEAGUE</span>
          <div class="ltype-toggle">${typeBtns}</div>
          <span class="tc-label">SCORING (ECR)</span>
          <div class="format-toggle">${fmtBtns}</div>
          ${advToggle}
          ${situationalSelect}
          ${minInputs}
          ${advNote}
          ${ecrNote}
          <span class="rank-toolbar-spacer"></span>
          ${following?'':`<button class="btn btn-accent btn-sm" onclick="openLeaguePicker()">🔗 Link Sleeper League</button>
          <button class="btn btn-ghost btn-sm" onclick="promptDraftFollow()" title="Follow a live or mock draft by its ID">Paste draft ID</button>`}
          ${(typeof rankColPrefsCustomized==='function' && rankColPrefsCustomized())?`<button class="btn btn-ghost btn-sm" onclick="resetRankColPrefs()" title="Restore hidden and reordered columns to the default layout">↺ Reset table</button>`:''}
          <button class="btn btn-ghost btn-sm" onclick="exportRankingsCSV()">${TC_ICON("download")} CSV</button>
        </div>
      </div>
      <div class="rank-table-wrap">
      <table class="rankings-table grouped${paceActive?' pace-mode':''}" data-rank-rendered-pos="${rankPosFilter}" data-rank-rendered-rk="${rankRookiesOnly?1:0}" data-rank-adv="${advActive?1:0}"><thead><tr>
        ${metaOrder.map(k=>({
          ecr: ()=>th('ecr','ECR','','c-ecr',false,'ecr'),
          ecr_tier: ()=>th('ecr_tier','TIER','','c-tier',false,'ecr_tier'),
          // The house columns wear the house crest: the crown IS "TripleCrown's number".
          // alt text keeps the header readable anywhere the image can't load (offline
          // bakes ship without images/), and screen readers still hear TC / TC★.
          tc: ()=>th('tc','<img src="images/app-icon.png" class="th-logo" alt="TC">','','c-tc',false,'tc'),
          tcr: ()=>th('tcr','<span class="th-crownstar"><img src="images/app-icon.png" class="th-logo" alt="TC">★</span>','','c-tcr',false,'tcr'),
          adp: ()=>th('adp','ADP','','c-adp',false,'adp'),
          fpts: ()=>th('fpts','FPTS','','',false,'fpts')+(paceActive?th('pacePct','Δ','PROJ','c-pace-delta'):''),
          vor: ()=>{const a=rankSortKey==='vor';
            return `<th onclick="rankSort('vor')" class="c-vor" data-rc="vor" style="${a?'color:var(--accent)':''}"><div class="th-stack">VOR${a?(rankSortDir<0?' \u2193':' \u2191'):''}${(typeof tcInfoBtn==='function')?tcInfoBtn('rank_vor','What is VOR?'):''}</div></th>`;},
          pos: ()=>th('pos','POS','','c-pos',false,'pos'),
          name: ()=>th('name','PLAYER','','c-player',false,'name'),
          team: ()=>th('team','TM','','c-team',false,'team'),
          own: ()=>`<th class="c-own" data-rc="own" title="Rostered by (synced league)"><div class="th-stack">OWNER</div></th>`,
          age: ()=>th('age','AGE','','c-age',true,'age'),
          apy: ()=>th('apy','APY','','c-apy',false,'apy'),
          fa: ()=>th('fa','FA','','c-fa',false,'fa'),
        })[k]()).join('')}
        ${advActive
          ? sumerView.cols.map((label,ci)=>{const key='sumer:'+label;const on=rankSortKey===key;
              return `<th onclick="rankSort('sumer:${label.replace(/'/g,"\\'")}')" class="grp-adv${ci===0?' grp-start':''}" data-rc-adv="${escAttr(label)}" style="${on?'color:var(--accent)':''}" title="${label}"><div class="th-stack">${sumerHead(label)}${on?(rankSortDir<0?' ↓':' ↑'):''}</div></th>`;}).join('')
          : [
        statGroupsVisible.includes('rush')?`${th('rushing_attempts','RUSH','ATT','grp-rush',true)}${th('rushing_yards','RUSH','YDS','grp-rush-mid')}${th('ypc','YPC','','grp-rush-mid')}${th('rushing_tds','RUSH','TDS','grp-rush-end')}`:'',
        statGroupsVisible.includes('rec')?`${th('receiving_targets','TGTS','','grp-rec',true)}${th('receptions','REC','','grp-rec-mid')}${th('receiving_yards','REC','YDS','grp-rec-mid')}${th('receiving_tds','REC','TDS','grp-rec-end')}`:'',
        statGroupsVisible.includes('pass')?`${th('passing_attempts','PASS','ATT','grp-pass',true)}${th('passing_yards','PASS','YDS','grp-pass-mid')}${th('passing_tds','PASS','TDS','grp-pass-mid')}${th('interceptions_thrown','PASS','INTS','grp-pass-end')}`:'',
          ].join('')}
      </tr></thead><tbody>${rowsHtml}</tbody></table></div>
    </div>`;
  // The cached entry always carries every row; on phones the DOM gets the first slice now
  // and the rest streamed into the tbody by _rankingsStreamRows below.
  const streaming = mobileNarrow && rowChunks.length > RANKINGS_STREAM_FIRST+60;
  const pageHtml = pageOf(rows);
  const tHtmlDone = _rkNow();
  document.getElementById('content').innerHTML = streaming
    ? pageOf(rowChunks.slice(0, RANKINGS_STREAM_FIRST).join(''))
    : pageHtml;
  hydrateRankingsHeadshots();
  rankingsUpdateReplacementLine();
  // A hide/reorder re-render happens WITH the editor still open — put its ✕ badges back.
  if(typeof rankColEditAugment==='function' && typeof rankColEditActive!=='undefined' && rankColEditActive) rankColEditAugment();
  const tDomDone = _rkNow();
  // A team-scoped board renders "Loading head coach…" / no record until those async fetches
  // land — and their completion re-renders into the SAME cache key. Never cache the pending
  // state, or it becomes permanent.
  const _hcPending = teamScoped && ((typeof headCoaches!=='undefined' && headCoaches && headCoaches[currentTeam]===undefined)
    || (activeSeason!=='proj' && typeof espnRecordCache!=='undefined' && espnRecordCache && espnRecordCache[`${activeSeason}:${currentTeam}`]==null));
  if(!_hcPending) rankingsRenderCacheSet(cacheKey, pageHtml);
  if(streaming){
    const token = ++_rankingsStreamToken;
    _rankingsStreamRows(token, rowChunks.slice(RANKINGS_STREAM_FIRST), ()=>hydrateRankingsHeadshots());
  }
  if(_rkDebug){
    const mBuild = (tBuildDone - tBuildStart).toFixed(1);
    const mSort = (tSortDone - tSortStart).toFixed(1);
    const mRows = (tRowsDone - tRowsStart).toFixed(1);
    const mHtml = (tHtmlDone - tRowsDone).toFixed(1);
    const mDom = (tDomDone - tHtmlDone).toFixed(1);
    const mTotal = (tDomDone - _rkT0).toFixed(1);
    const meta = `players=${all.length} shown=${view.length} adv=${advActive?1:0} mobile=${mobileNarrow?1:0} stream=${streaming?1:0}`;
    try{ console.info(`[rankings-latency] total=${mTotal}ms build=${mBuild} sort/filter=${mSort} rows=${mRows} html=${mHtml} dom=${mDom} ${meta}`); }catch(_e){}
  }
}
function rankSort(k){
  // In column-edit mode headers are drag handles, not sort buttons.
  if(typeof rankColEditActive!=='undefined' && rankColEditActive) return;
  if(rankSortKey===k) rankSortDir*=-1;
  else { rankSortKey=k; rankSortDir=k==='ecr'?-1:-1; }
  // renderRankings() replaces #content wholesale, so BOTH scroll positions are lost: the page's
  // vertical offset and the table wrapper's horizontal one. The horizontal one matters as much
  // as the vertical — if you've scrolled right to read YAC and sort by it, snapping back to the
  // name column hides the very numbers you just sorted on.
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  const wrapBefore = document.querySelector('.rank-table-wrap');
  const x = wrapBefore ? wrapBefore.scrollLeft : 0;
  const wy = wrapBefore ? wrapBefore.scrollTop : 0;   // phones scroll the wrap, not the page
  renderRankings();
  // On phones the rows are still streaming in, so the board may not be tall enough yet for a
  // deep restore — hand the targets to the streamer, which keeps nudging as the table grows.
  if(_rankingsStreamPending){
    if(y>0) _rankingsScrollTargetY = y;
    if(wy>0) _rankingsScrollTargetWrapY = wy;
  }
  // Restore after layout settles. All axes are clamped to the NEW content size, since a
  // different sort can change the table's height (and column widths).
  requestAnimationFrame(()=>{
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, Math.min(y, max));
    const wrap = document.querySelector('.rank-table-wrap');
    if(wrap && x){
      const maxX = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
      wrap.scrollLeft = Math.min(x, maxX);
    }
    if(wrap && wy){
      const maxY = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
      wrap.scrollTop = Math.min(wy, maxY);
    }
  });
}
// Scoring presets per format. The reception value is what distinguishes PPR / Half / Standard.
const FORMAT_PRESETS={
  ppr:      {receptions:1.0},
  half_ppr: {receptions:0.5},
  std:      {receptions:0.0},
  superflex:{receptions:0.5},  // half-PPR superflex by default (matches the FantasyPros page we pull)
  dynasty:  {receptions:0.5},  // dynasty half-PPR overall
  dynasty_superflex:{receptions:0.5},  // dynasty + superflex/2QB (QBs valued highest)
};
// Selecting a format applies its scoring and re-sorts by ECR (the FantasyPros rank for that format).
function setRankFormat(f){
  rankFormat=f;
  const preset=FORMAT_PRESETS[f];
  if(preset){ Object.assign(scoringSettings,preset); }
  rankSortKey='ecr'; rankSortDir=-1;
  saveSession();
  rankingsRenderWithViewPreserved();
  toast(`${formatLabel(f)} — ECR + scoring applied`,'ok');
}
// ── Two-axis format model ───────────────────────────────────────────────────
// A league is really TWO independent choices: its TYPE (redraft vs dynasty) and its SCORING
// (standard / half / full PPR, plus whether it's superflex). rankFormat encodes the combo;
// these helpers decompose it into the two axes and recombine after a toggle, so the UI can
// offer a clean "Redraft | Dynasty" switch alongside the scoring buttons (and expose
// Dynasty-Superflex naturally as Dynasty + Superflex).
function leagueTypeOf(f){ return (f==='dynasty'||f==='dynasty_superflex') ? 'dynasty' : 'redraft'; }
function scoringAxisOf(f){
  if(f==='superflex'||f==='dynasty_superflex') return 'superflex';
  if(f==='ppr') return 'ppr';
  if(f==='std') return 'std';
  if(f==='dynasty'){
    // dynasty w/o explicit scoring → infer from reception value, default half
    const r=scoringSettings.receptions;
    return r>=1?'ppr':r<=0?'std':'half_ppr';
  }
  return 'half_ppr';
}
// Recombine a (type, scoring) pair into a rankFormat.
function combineFormat(type, scoring){
  if(type==='dynasty'){
    return scoring==='superflex' ? 'dynasty_superflex' : 'dynasty';
  }
  // redraft
  if(scoring==='superflex') return 'superflex';
  if(scoring==='ppr') return 'ppr';
  if(scoring==='std') return 'std';
  return 'half_ppr';
}
function setLeagueType(type){
  applyTwoAxisFormat(type, scoringAxis);
}
function setScoringAxis(scoring){
  applyTwoAxisFormat(leagueTypeOf(rankFormat), scoring);
}
// Apply a (type, scoring) pair. The scoring axis is remembered independently and always drives
// the reception preset, so the scoring buttons + FPTS respond even in Dynasty (whose non-SF ECR
// table is identical for std/half/ppr). rankFormat stays correct for the ECR lookup.
function applyTwoAxisFormat(type, scoring){
  scoringAxis = scoring;
  rankFormat = combineFormat(type, scoring);
  const preset = FORMAT_PRESETS[scoring];   // scoring axis — not rankFormat — drives reception points
  if(preset){ Object.assign(scoringSettings, preset); }
  rankSortKey='ecr'; rankSortDir=-1;
  saveSession();
  rankingsRenderWithViewPreserved();
  toast(`${formatLabel(rankFormat)} — ECR + scoring applied`,'ok');
}
// When the user edits the reception value directly, keep the format label in sync so the
// ECR table matches: 1.0→Full PPR, 0.5→Half PPR, 0→Standard. (Superflex/Dynasty are only
// set via their buttons since they change the ranking pool, not just the reception value.)
function syncFormatFromScoring(){
  if(rankFormat==='superflex'||rankFormat==='dynasty_superflex') return; // superflex scoring isn't reception-derived
  const r=scoringSettings.receptions;
  const f = r>=1 ? 'ppr' : r>=0.25 ? 'half_ppr' : 'std';
  scoringAxis=f;   // keep the scoring buttons accurate whether redraft or dynasty
  if(rankFormat==='dynasty') return;  // dynasty ECR table doesn't change with reception value; only the buttons/scoring do
  if(f!==rankFormat){ rankFormat=f;
    toast(`Reception value ${r} → switched to ${({ppr:'Full PPR',half_ppr:'Half PPR',std:'Standard'})[f]} (ECR follows)`,'ok'); }
}
function rankingsRenderWithViewPreserved(){
  const y = (typeof window!=='undefined') ? (window.scrollY || document.documentElement.scrollTop || 0) : 0;
  const wrapBefore = (typeof document!=='undefined') ? document.querySelector('.rank-table-wrap') : null;
  const wy = wrapBefore ? wrapBefore.scrollTop : 0;
  if(typeof tcPreserveViewScroll==='function') tcPreserveViewScroll(()=>renderRankings(), ['.rank-table-wrap']);
  else renderRankings();
  // Streaming render: the immediate restore above clamped to the first row slice — let the
  // streamer finish the job as rows land.
  if(_rankingsStreamPending){
    if(y>0) _rankingsScrollTargetY = y;
    if(wy>0) _rankingsScrollTargetWrapY = wy;
  }
}

// Position-filter taps: when the DOM already holds the unfiltered (ALL) standard board, a
// filter is just "hide the rows that don't match" — no rebuild, no innerHTML, ~1ms. The
// Adv. Metrics board can't do this (its columns change per position), and a board rendered
// under some other filter doesn't have the missing rows to reveal; both fall back to a render.
function rankingsPosFilterInPlace(){
  if(typeof document==='undefined') return false;
  const table = document.querySelector('#content .rankings-table');
  if(!table || typeof table.getAttribute!=='function') return false;
  if(table.getAttribute('data-rank-rendered-pos')!=='ALL') return false;
  if(table.getAttribute('data-rank-rendered-rk')==='1') return false;   // board rendered pre-filtered to rookies: full render to widen
  if(table.getAttribute('data-rank-adv')==='1') return false;
  if(rankAdvanced && typeof sumerAvailable==='function' && sumerAvailable()) return false;
  const btns = document.querySelectorAll('#content .rank-toolbar .pos-filter-btn');
  if(!btns || !btns.length) return false;
  btns.forEach(b=>{ const t=String(b.textContent).trim();
    b.classList.toggle('active', t==='ROOKIES' ? rankRookiesOnly : t===rankPosFilter); });
  return applyRankingsFiltersInPlace();
}

function setPosFilter(p){
  rankPosFilter=p;
  if(rankingsPosFilterInPlace()) return;
  rankingsRenderWithViewPreserved();
}
function toggleRookiesFilter(){
  rankRookiesOnly=!rankRookiesOnly;
  if(rankingsPosFilterInPlace()) return;
  rankingsRenderWithViewPreserved();
}

function rankingsSearchTokens(q){
  const s = String(q||'').trim().toLowerCase();
  if(!s) return [];
  // Comma/newline/pipe separated names; a plain single phrase remains intact.
  return s.split(/[\n,|]+/).map(x=>x.trim()).filter(Boolean);
}

function setRankingsSearchQuery(v, selStart, selEnd){
  rankingsSearchQuery = String(v||'');
  const keepFocus = (typeof document!=='undefined' && document.activeElement && document.activeElement.id==='rankSearchInput');
  if(keepFocus && applyRankingsFiltersInPlace()){
    const clr = document.querySelector('.rank-search-clear');
    if(clr) clr.classList.toggle('rank-search-hidden', !String(rankingsSearchQuery||'').trim());
    return;
  }
  renderRankings();
  if(!keepFocus) return;
  requestAnimationFrame(()=>{
    const el = document.getElementById('rankSearchInput');
    if(!el || typeof el.focus!=='function') return;
    el.focus();
    const max = el.value.length;
    const s = Math.max(0, Math.min(max, Number.isFinite(selStart) ? selStart : max));
    const e = Math.max(0, Math.min(max, Number.isFinite(selEnd) ? selEnd : s));
    if(typeof el.setSelectionRange==='function') el.setSelectionRange(s, e);
  });
}

function activeSumerMinFilters(){
  if(!(rankAdvanced && typeof sumerAvailable==='function' && sumerAvailable())) return {};
  const out = {};
  ['QB','WRTE','RB'].forEach((bucket)=>{
    const min = sumerMin && Number.isFinite(+sumerMin[bucket]) ? +sumerMin[bucket] : 0;
    if(min>0) out[bucket] = min;
  });
  return out;
}

// True when some in-place filter (search tokens, Adv. min-volume, or a position filter over
// an ALL-rendered board) diverges the visible rows from what the last full render painted.
// The row streamer checks this so late-arriving rows obey the filter too.
function _rankingsInPlaceFiltersActive(){
  if(rankingsSearchTokens(rankingsSearchQuery).length) return true;
  if(Object.keys(activeSumerMinFilters()).length) return true;
  if(typeof document!=='undefined' && (rankPosFilter!=='ALL' || rankRookiesOnly)){
    const table = document.querySelector('#content .rankings-table');
    if(table && typeof table.getAttribute==='function' && table.getAttribute('data-rank-rendered-pos')==='ALL'
       && table.getAttribute('data-rank-rendered-rk')!=='1') return true;
  }
  return false;
}

// ── Replacement-level marker ────────────────────────────────────────────────
// On a single-position view, one marker row sits between the startable tier (VOR>0) and the
// sub-replacement rest — the visual answer to "where does the position stop mattering?".
// Only rendered when the visible rows are MONOTONE (startables first, then the rest) under
// the active sort, so the line is always truthful: FPTS/VOR sorts qualify, an ECR sort only
// when the market happens to agree. Returns the visible-row index the marker goes before.
function _rankReplacementBoundary(flags){
  let idx=-1;
  for(let i=0;i<flags.length;i++){
    if(flags[i]){ if(idx>=0) return -1; }   // a startable BELOW the boundary → not monotone
    else if(idx<0) idx=i;
  }
  return (idx>0 && idx<flags.length) ? idx : -1;   // needs rows on both sides
}
function rankingsUpdateReplacementLine(){
  if(typeof document==='undefined') return;
  // Defensive DOM handling throughout: this also runs under the test harness's stub
  // elements, and a marker glitch must never take the board down with it.
  const kill=(el)=>{ if(el && typeof el.remove==='function') el.remove(); };
  const old=document.getElementById('rankReplacementLine');
  const tbody=document.querySelector('#content .rankings-table tbody');
  if(!tbody || typeof tbody.insertBefore!=='function'){ kill(old); return; }
  const posF=(rankPosFilter==='QB'||rankPosFilter==='RB'||rankPosFilter==='WR'||rankPosFilter==='TE') ? rankPosFilter : null;
  if(!posF || typeof VOR_BASELINE==='undefined' || !(VOR_BASELINE[posF]>0)){ kill(old); return; }
  const rows=[];
  tbody.querySelectorAll('tr').forEach(r=>{
    if(r.classList.contains('rank-pickline') || r.classList.contains('rank-replacement-line')) return;
    if(r.style && r.style.display==='none') return;
    rows.push(r);
  });
  const flags=rows.map(r=>r.getAttribute('data-rank-vor')==='1');
  const at=_rankReplacementBoundary(flags);
  if(at<0){ kill(old); return; }
  const startable=flags.filter(Boolean).length;
  const el=(old && typeof old.remove==='function') ? old : document.createElement('tr');
  el.id='rankReplacementLine'; el.className='rank-replacement-line';
  const cols=(rows[0] && rows[0].children) ? rows[0].children.length : 12;
  el.innerHTML=`<td colspan="${cols}"><span class="rank-repl-lbl">▼ replacement level · ${posF}${startable+1} (${(VOR_BASELINE[posF]||0).toFixed(0)} pts) — players below are roughly free on waivers</span></td>`;
  try{ tbody.insertBefore(el, rows[at]); }catch(e){ kill(el); }
}

function applyRankingsFiltersInPlace(){
  if(typeof document==='undefined') return false;
  const tbody = document.querySelector('.rankings-table tbody');
  if(!tbody) return false;
  const tokens = rankingsSearchTokens(rankingsSearchQuery);
  const minFilters = activeSumerMinFilters();
  const hasMinFilters = Object.keys(minFilters).length>0;
  // Position filter over a board rendered unfiltered (see rankingsPosFilterInPlace).
  const table = document.querySelector('.rankings-table');
  const _onAllBoard = table && typeof table.getAttribute==='function'
    && table.getAttribute('data-rank-rendered-pos')==='ALL' && table.getAttribute('data-rank-rendered-rk')!=='1';
  const posF = (_onAllBoard && rankPosFilter!=='ALL') ? rankPosFilter : null;
  // ROOKIES overlays the position filter — both can be active at once.
  const rkF = !!(_onAllBoard && rankRookiesOnly);
  let shown = 0;
  const rows = tbody.querySelectorAll('tr');
  rows.forEach((row)=>{
    if(row.classList.contains('rank-replacement-line')) return;   // repositioned below, not filtered
    if(row.classList.contains('rank-pickline')){
      // Pick-line markers become misleading during ad-hoc filtering.
      row.style.display = (tokens.length || hasMinFilters || posF || rkF) ? 'none' : '';
      return;
    }
    const hay = String(row.getAttribute('data-rank-search')||'').toLowerCase();
    const matchSearch = !tokens.length || tokens.some(tok=>hay.includes(tok));
    const bucket = String(row.getAttribute('data-rank-sumer-bucket')||'');
    const volRaw = row.getAttribute('data-rank-sumer-vol');
    const vol = (volRaw==null || volRaw==='') ? null : Number(volRaw);
    const matchMin = !hasMinFilters || !bucket || !Object.prototype.hasOwnProperty.call(minFilters, bucket)
      ? true
      : (Number.isFinite(vol) && vol>=minFilters[bucket]);
    let matchPos = true;
    if(posF){
      const rowPos = String(row.getAttribute('data-rank-pos')||'');
      matchPos = posF==='FLEX' ? (rowPos!=='' && rowPos!=='QB')
        : posF==='ROOKIES' ? row.getAttribute('data-rank-rk')==='1'   // legacy value, still honored
        : rowPos===posF;
    }
    const matchRk = !rkF || row.getAttribute('data-rank-rk')==='1';
    const match = matchSearch && matchMin && matchPos && matchRk;
    row.style.display = match ? '' : 'none';
    if(match) shown++;
  });
  const countEl = document.getElementById('rankPlayerCount');
  if(countEl){
    const def = String(countEl.getAttribute('data-default-label')||'').trim();
    countEl.textContent = (tokens.length || hasMinFilters || posF || rkF) ? `${shown} players` : (def || `${shown} players`);
  }
  rankingsUpdateReplacementLine();
  return true;
}

function applyRankingsSearchInPlace(){
  return applyRankingsFiltersInPlace();
}

// The search wrap is ALWAYS in the toolbar DOM, hidden by a class when closed — so opening,
// clearing and closing are class flips on the mounted page, never a page rebuild. (The old
// conditional markup meant every tap of the magnifier re-rendered ~17k table cells.)
function _rankSearchEls(){
  if(typeof document==='undefined') return null;
  const wrap = document.querySelector('#content .rank-search-wrap');
  const input = document.getElementById('rankSearchInput');
  if(!wrap || !input || !wrap.classList || typeof wrap.classList.toggle!=='function') return null;
  return { wrap, input,
    btn: document.querySelector('#content .rank-search-toggle'),
    clr: document.querySelector('#content .rank-search-clear') };
}

function clearRankingsSearch(){
  rankingsSearchQuery = '';
  rankingsSearchOpen = true;
  const els = _rankSearchEls();
  if(els){
    els.input.value = '';
    if(els.clr) els.clr.classList.add('rank-search-hidden');
    applyRankingsFiltersInPlace();
    if(typeof els.input.focus==='function') els.input.focus();
    return;
  }
  renderRankings();
  requestAnimationFrame(()=>{
    const el = document.getElementById('rankSearchInput');
    if(el && typeof el.focus==='function') el.focus();
  });
}

function toggleRankingsSearch(){
  const els = _rankSearchEls();
  if(rankingsSearchOpen){
    // Closing also clears any query, restoring the full board.
    rankingsSearchOpen = false;
    rankingsSearchQuery = '';
    if(els){
      els.input.value = '';
      els.wrap.classList.add('rank-search-hidden');
      if(els.btn) els.btn.classList.remove('active');
      if(els.clr) els.clr.classList.add('rank-search-hidden');
      applyRankingsFiltersInPlace();
      return;
    }
    renderRankings();
    return;
  }
  rankingsSearchOpen = true;
  if(els){
    els.wrap.classList.remove('rank-search-hidden');
    if(els.btn) els.btn.classList.add('active');
    if(typeof els.input.focus==='function') els.input.focus();
    return;
  }
  renderRankings();
  requestAnimationFrame(()=>{
    const el = document.getElementById('rankSearchInput');
    if(el && typeof el.focus==='function') el.focus();
  });
}
// Toggle the SumerSports advanced stat columns on the rankings page.
function setRankAdvanced(v){
  rankAdvanced=!!v;
  if(!rankAdvanced) sumerRefinement=null;   // leaving Adv. Metrics clears the situational split
  // Advanced columns sort high→low; reset to the first advanced column (or ECR when leaving).
  if(rankAdvanced){
    const sv=sumerColumnsForFilter();
    rankSortKey = sv ? ('sumer:'+sv.cols[0]) : 'ecr';
    rankSortDir = -1;
  } else if(rankSortKey.startsWith('sumer:')){
    rankSortKey='ecr'; rankSortDir=-1;
  }
  rankingsRenderWithViewPreserved();
}
// Select a "Situational" refinement (game-situation split) for the Adv. Metrics view. Empty
// value = Standard (overall). Re-sort onto the first column so the board reflects the split.
function setSumerRefinement(val){
  sumerRefinement = val || null;
  const sv=sumerColumnsForFilter();
  if(sv) { rankSortKey='sumer:'+sv.cols[0]; rankSortDir=-1; }
  rankingsRenderWithViewPreserved();
}
// Build the minimum-volume input(s) for the Adv. Metrics view, matched to the position filter:
// QB → Min Plays, WR/TE → Min Routes, RB → Min Rushes. ALL/FLEX show each relevant one.
function sumerMinInputs(){
  const mk=(bucket,label)=>`<label style="font-size:11px;color:var(--muted);font-weight:700;display:inline-flex;align-items:center;gap:4px">${label}
    <input type="number" min="0" step="10" value="${sumerMin[bucket]||0}" data-rank-min-bucket="${bucket}" oninput="setSumerMin('${bucket}',this.value,this.selectionStart,this.selectionEnd)"
      style="width:58px;background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:3px 6px;color:var(--text);font-size:12px;font-family:var(--mono)"></label>`;
  const pos=rankPosFilter;
  let items;
  if(pos==='QB') items=[['QB','Min Plays']];
  else if(pos==='RB') items=[['RB','Min Rushes']];
  else if(pos==='WR'||pos==='TE') items=[['WRTE','Min Routes']];
  else if(pos==='FLEX') items=[['WRTE','Min Routes'],['RB','Min Rushes']];
  else items=[['QB','Min Plays'],['WRTE','Min Routes'],['RB','Min Rushes']];  // ALL
  return items.map(([b,l])=>mk(b,l)).join('');
}
function setSumerMin(bucket, val, selStart, selEnd){
  const n=parseInt(val,10);
  sumerMin[bucket] = (isNaN(n)||n<0) ? 0 : n;
  const keepFocus = !!(typeof document!=='undefined'
    && document.activeElement
    && document.activeElement.getAttribute
    && document.activeElement.getAttribute('data-rank-min-bucket')===String(bucket));
  if(keepFocus && applyRankingsFiltersInPlace()) return;
  rankingsRenderWithViewPreserved();
  if(!keepFocus) return;
  requestAnimationFrame(()=>{
    const el = document.querySelector(`[data-rank-min-bucket="${String(bucket)}"]`);
    if(!el || typeof el.focus!=='function') return;
    el.focus();
    if(typeof el.setSelectionRange!=='function') return;
    const max = el.value.length;
    const s = Math.max(0, Math.min(max, Number.isFinite(selStart) ? selStart : max));
    const e = Math.max(0, Math.min(max, Number.isFinite(selEnd) ? selEnd : s));
    el.setSelectionRange(s, e);
  });
}
// A one-line digest of the current scoring, shown in the collapsed panel header so you can
// confirm your settings without expanding it. Only surfaces the fields people actually vary.
function scoringSummary(){
  const sc=scoringSettings;
  const rec=+sc.receptions;
  const recTxt = rec>=1 ? 'Full PPR' : (rec>0 ? `${rec} PPR` : 'Standard');
  const tep=+sc.receptions_te_bonus||0;
  const bits=[recTxt + (tep ? ` +${tep} TEP` : ''), `${sc.passing_touchdowns} pass TD`, `${sc.receiving_touchdowns} rec TD`,
              `${sc.passing_yards_yardage} pass yd/pt`, `${sc.receiving_yards_yardage} rec yd/pt`];
  if(+sc.interceptions_thrown!==0) bits.push(`${sc.interceptions_thrown} INT`);
  return bits.join(' \u00b7 ');
}
function toggleScoringPanel(){
  scoringPanelOpen=!scoringPanelOpen;
  // Toggle the class in place — do NOT re-render. renderRankings() rebuilds ~17k table cells
  // and 884 headshot <img> tags; measured at ~1.2s on a 4x-throttled phone purely to show or
  // hide this panel. Both header variants live in the DOM and are swapped by CSS, so a class
  // flip (~0.1ms) is all that's needed. Bonus: in-progress edits survive a collapse/expand.
  const card = document.querySelector('.scoring-card');
  if(card) card.classList.toggle('open', scoringPanelOpen);
  else renderRankings();      // not mounted (e.g. another phase) → fall back
  saveSession();              // already debounced
}
function recalcRankings(){
  // g(id, d) = read the number out of scoring input #id, falling back to default `d` when the
  // field is blank or garbage. Every scoringSettings key below is populated straight from the
  // DOM, so an input's id is the single source of truth linking UI ↔ state.
  const g=(id,d)=>{const v=parseFloat(document.getElementById(id).value);return isNaN(v)?d:v;};
  scoringSettings.passing_yards_yardage=g('sc_pass_yds_ydg',25)||25;
  scoringSettings.passing_touchdowns=g('sc_pass_td',6);
  scoringSettings.interceptions_thrown=g('sc_int',-2);
  scoringSettings.rushing_yards_yardage=g('sc_rush_yds_ydg',10)||10;
  scoringSettings.rushing_touchdowns=g('sc_rush_td',6);
  scoringSettings.receiving_yards_yardage=g('sc_rec_yds_ydg',10)||10;
  scoringSettings.receiving_touchdowns=g('sc_rec_td',6);
  scoringSettings.receptions=g('sc_rec',0.5);
  scoringSettings.receptions_te_bonus=g('sc_rec_te',0);
  scoringSettings.fumbles_lost=g('sc_fum',-2);
  scoringSettings.passing_attempts=g('sc_pass_att',0);
  scoringSettings.passing_completions=g('sc_pass_comp',0);
  scoringSettings.rushing_attempts=g('sc_rush_att',0);
  syncFormatFromScoring();  // 1.0/0.5/0 reception value keeps the format label + ECR in sync
  saveSession();
  renderRankings();toast('Rankings recalculated ✓','ok');
}
function exportRankingsCSV(){
  let all=buildPlayerList();all.sort((a,b)=>b.fpts-a.fpts);
  const dyn = rankFormat==='dynasty' || rankFormat==='dynasty_superflex';
  // TC + ADP are projection-board concepts; reference-season exports drop both columns.
  const proj = activeSeason==='proj';
  const keys=['ecr','tier',...(proj?['tc','adp']:[]),'fpts','pos','name','team',
    ...(dyn?['age','apy','fa']:[]),
    'rushing_attempts','rushing_yards','ypc','rushing_tds',
    'receiving_targets','receptions','receiving_yards','receiving_tds',
    'passing_attempts','passing_yards','passing_tds','interceptions_thrown'];
  const csv=[keys.join(','),...all.map(p=>[
    p.ecr!=null?p.ecr:'', p.ecr_tier!=null?p.ecr_tier:'',
    ...(proj?[p.tcPts!=null?p.tcPts.toFixed(1):'', (()=>{const v=adpFor(p);return (v!=null&&v<999)?v:'';})()]:[]),
    p.fpts.toFixed(1), p.pos, p.name, p.team,
    ...(dyn?[p.age!=null?p.age:'', p.apy!=null?p.apy:'', p.fa!=null?p.fa:'']:[]),
    p.rushing_attempts, p.rushing_yards, p.ypc>0?p.ypc.toFixed(1):'', p.rushing_tds,
    p.receiving_targets, p.receptions, p.receiving_yards, p.receiving_tds,
    p.passing_attempts, p.passing_yards, p.passing_tds, p.interceptions_thrown
  ].join(','))].join('\n');
  dlFile(csv,'rankings.csv','text/csv');toast('Rankings exported ✓','ok');
}


// ─────────────────────────────────────────────────────────────────────────────

// ── VOR explainer (the column header's ⓘ) ───────────────────────────────────
if(typeof TC_INFO_BOOK!=='undefined'){
  TC_INFO_BOOK.rank_vor={title:'The projection numbers', body:()=>{
    const four=`Four columns answer “how good is this player”, each a different lens:
      <b>FPTS</b> — projected season points under your scoring (the Sleeper baseline the app
      edits). <b>TC</b> — the TripleCrown model’s own season points, a validated second
      opinion. <b>TC★</b> — market ADP blended with the TC model at per-position weights
      that beat the market out-of-sample (0–100, within position). <b>VOR</b> — the one
      shown by default, because it’s the draft decision itself:<br><br>`;
    const reveal=`<br><br>Only VOR shows by default — <b>long-press any column header</b> and
      tap the <b>+ chips</b> to add TC, TC★, ADP or FPTS (or hide anything else).`;
    return four+_rankVorBody()+reveal;
  }};
  const _rankVorBody=()=>{
    const b=(typeof VOR_BASELINE!=='undefined' && VOR_BASELINE) || {};
    const line=['QB','RB','WR','TE'].filter(p=>b[p]>0).map(p=>`${p} ${b[p].toFixed(0)}`).join(' · ');
    return `Points above the <b>last starter</b> your league shape forces someone to start —
      the fairest way to compare players across positions. The baseline is rebuilt from your
      projections whenever scoring, roster slots, or format change: dedicated starter slots
      fill first, then FLEX demand goes to whichever position\u2019s next player scores most
      (restricted flexes only draw from their eligible positions). Superflex assumes ~2.3 QBs
      rostered per team, matching how those leagues actually draft.${line?`<br><br>Current
      replacement level: <b>${line}</b> fantasy points.`:''}<br><br>+VOR = start-worthy;
      0 or below = replaceable from waivers. On a position filter (sorted by FPTS or VOR),
      the board draws the replacement line right in the table.`;
  };
}
