// nflverse season roster for a team, or null. Only for COMPLETED seasons — on the projection
// season the roster is a moving target and Spotrac's offseason moves are the real story.
function nflverseRosterFor(team){
  if(activeSeason==='proj' || !team) return null;
  const blk = (typeof NFLVERSE!=='undefined' && NFLVERSE) ? NFLVERSE[String(activeSeason)] : null;
  const r = blk && blk.rosters && blk.rosters[team];
  return (r && r.length) ? r : null;
}
// Historical roster in the SAME shape as the live depth chart (renderDepthChart): position
// rows, players left→right, starter highlighted, every chip opening a player card.
// Row arrays are positional — [name, pos, jersey, yrsExp, age, sleeperId, status, snaps] —
// see team_rosters() in nflverse.py. The builder already sorted them by position group then
// snaps DESC, so the FIRST player in each position is that season's real starter: for a
// completed year, snaps are what actually happened (better than anyone's depth chart).
function renderNflverseRoster(team){
  const rows = nflverseRosterFor(team);
  if(!rows) return '';
  const FANTASY={QB:1,RB:1,WR:1,TE:1};
  const byPos={};
  rows.forEach(r=>{ const pos=String(r[1]||'').toUpperCase(); (byPos[pos]=byPos[pos]||[]).push(r); });
  const posKeys=Object.keys(byPos).sort((x,y)=>{
    const ix=DEPTH_POS_ORDER.indexOf(x), iy=DEPTH_POS_ORDER.indexOf(y);
    return (ix<0?99:ix)-(iy<0?99:iy) || x.localeCompare(y);
  });
  const groups=posKeys.map(pos=>{
    const chips=byPos[pos].map(([name,ps,jersey,exp,age,sid,status,snaps],i)=>{
      // The id column must be a SLEEPER id (all digits) — that's what openPlayerCard() and
      // hsURL() understand. Be defensive: an earlier build of team_rosters() wrote gsis ids
      // here ("00-0036900"), and ~19% of older rosters have no sleeper_id at all. Anything
      // that isn't all-digits is discarded in favour of the NAME, which resolvePlayerId()
      // and hsURL() both handle — so cards and headshots work on any vintage of the seed.
      const sleeperId = (sid!=null && /^\d+$/.test(String(sid))) ? String(sid) : null;
      const hpack = sleeperId ? hsPack({player_id:sleeperId, name, pos:ps, team}) : hsPack({name, pos:ps, team});
      const hs = hpack && hpack.src
        ? `<img src="${hpack.src}" class="depth-hs" data-fallbacks="${(hpack.fallbacks||[]).join('|')}" onerror="const l=(this.dataset.fallbacks||'').split('|').filter(Boolean);if(l.length){this.dataset.fallbacks=l.slice(1).join('|');this.src=l[0];}else{this.style.display='none';}">`
        : '';
      const rk = exp===0 ? `<span class="depth-rookie">R</span>` : '';
      const jr = jersey!=null ? `<span class="depth-jersey">#${jersey}</span>` : '';
      const ir = status==='RES' ? `<span class="depth-ir" title="Finished the season on injured reserve / reserve">IR</span>` : '';
      // Starter = most snaps at the position (and actually played). A 0-snap player is
      // never a "starter" even if he's alphabetically first in an empty group.
      const starter = (i===0 && snaps>0) ? ' depth-starter' : '';
      const tip = `${ordinal(i+1)} · ${ps}${snaps?` · ${snaps.toLocaleString()} snaps`:' · did not play'}${age!=null?` · age ${age}`:''}`;
      return `<span class="depth-player clickable-player${starter}" title="${tip}" onclick="${pcardOnclick(sleeperId||name, ps, team)}">${hs}<span class="depth-name">${name}</span>${jr}${rk}${ir}</span>`;
    }).join('');
    const lbl = FANTASY[pos] ? `<span class="pos-badge pos-${pos}">${pos}</span>` : `<span class="depth-pos-abbr">${pos}</span>`;
    return `<div class="depth-pos"><div class="depth-pos-label">${lbl}</div><div class="depth-players">${chips}</div></div>`;
  }).join('');
  return `<div class="add-section">
    <div class="add-section-head">\ud83d\udccb ${activeSeason} Roster <span class="add-count">${rows.length}</span></div>
    <div class="depth-sub">nflverse \u00b7 end-of-season active + reserve \u00b7 ordered by snaps played, so the
      <b class="depth-starter-key">highlighted</b> player is that season\u2019s real starter \u00b7 tap any player for their card.</div>
    <div class="depth-grid">${groups}</div></div>`;
}

function renderTeamAdditions(team){
  // Completed season → show that year's actual roster instead of Spotrac's offseason moves
  // (which only describe the upcoming season and would be misleading dated to a past year).
  const histRoster = renderNflverseRoster(team);
  if(histRoster) return histRoster;
  const a = (ADDITIONS && ADDITIONS[team]) || {};
  // Highlight fantasy-relevant offensive positions (QB/RB/WR/TE) with the same Sleeper-style
  // colors as the Rankings page; leave defensive/other positions neutral so skill players pop.
  const FANTASY_POS = {QB:1, RB:1, WR:1, TE:1};
  const posBadge=(p)=>{
    if(!p) return '';
    const up = String(p).toUpperCase().trim();
    // Some players list multiple (e.g. "RB/WR"); color by the first fantasy pos found.
    const first = up.split(/[\/,\s]+/).find(x=>FANTASY_POS[x]) || up;
    if(FANTASY_POS[first]) return `<span class="pos-badge pos-${first}">${p}</span>`;
    return `<span class="add-pos">${p}</span>`;
  };
  // Free agency + draft share a layout (player, pos, years, value).
  const signingTable=(rows, kind)=>{
    if(!rows||!rows.length) return `<div class="add-empty">No ${kind==='draft'?'draft picks':'free-agent signings'} listed.</div>`;
    const body=rows.map(r=>`<tr>
      <td class="add-player clickable-player" onclick="${pcardOnclick(r.player, r.pos, '')}">${r.player}</td>
      <td>${posBadge(r.pos)}</td>
      <td class="add-num">${noteWrapHtml(escHtml(r.years!=null?r.years+' yr':'—'), { label:'Contract Term', value:r.years!=null?r.years+' yr':'—', source:'roster_changes', statKey:'term', context:`${teamDisplayName(team)} ${PROJ_SEASON} ${kind==='draft'?'draft':'free agency'}`, player:noteTargetFromArgs(r.player, r.pos, team), team, relevance:'QB,RB,WR,TE' }, 'note-tag-hit')}</td>
      <td class="add-num add-val">${noteWrapHtml(escHtml(fmtMillions(r.value_m)), { label:'Contract Total', value:fmtMillions(r.value_m), source:'roster_changes', statKey:'value_m', context:`${teamDisplayName(team)} ${PROJ_SEASON} ${kind==='draft'?'draft':'free agency'}`, player:noteTargetFromArgs(r.player, r.pos, team), team, relevance:'QB,RB,WR,TE' }, 'note-tag-hit')}</td>
      <td class="add-num add-aav">${noteWrapHtml(escHtml(fmtMillions(r.aav_m)), { label:'Contract AAV', value:fmtMillions(r.aav_m), source:'roster_changes', statKey:'aav_m', context:`${teamDisplayName(team)} ${PROJ_SEASON} ${kind==='draft'?'draft':'free agency'}`, player:noteTargetFromArgs(r.player, r.pos, team), team, relevance:'QB,RB,WR,TE' }, 'note-tag-hit')}</td>
    </tr>`).join('');
    return `<div class="add-table-scroll"><table class="add-table"><thead><tr>
      <th class="add-th-player">PLAYER</th><th>POS</th><th class="add-num">TERM</th>
      <th class="add-num">TOTAL</th><th class="add-num">AAV</th></tr></thead><tbody>${body}</tbody></table></div>`;
  };
  const tradeTable=(rows)=>{
    if(!rows||!rows.length) return `<div class="add-empty">No trade acquisitions listed.</div>`;
    const body=rows.map(r=>`<tr>
      <td class="add-player clickable-player" onclick="${pcardOnclick(r.player, r.pos, '')}">${r.player}</td>
      <td>${posBadge(r.pos)}</td>
      <td class="add-num add-val">${noteWrapHtml(escHtml(fmtMillions(r.cap_m)), { label:'Cap Acquired', value:fmtMillions(r.cap_m), source:'roster_changes', statKey:'cap_m', context:`${teamDisplayName(team)} ${PROJ_SEASON} trade`, player:noteTargetFromArgs(r.player, r.pos, team), team, relevance:'QB,RB,WR,TE' }, 'note-tag-hit')}</td>
      <td class="add-detail">${noteWrapHtml(escHtml(r.detail||'—'), { label:'Trade Detail', value:r.detail||'—', source:'roster_changes', statKey:'detail', context:`${teamDisplayName(team)} ${PROJ_SEASON} trade`, player:noteTargetFromArgs(r.player, r.pos, team), team, relevance:'QB,RB,WR,TE' }, 'note-tag-hit')}</td>
    </tr>`).join('');
    return `<div class="add-table-scroll"><table class="add-table add-trade-table"><thead><tr>
      <th class="add-th-player">PLAYER</th><th>POS</th><th class="add-num">CAP ACQ.</th>
      <th>TRADE DETAIL</th></tr></thead><tbody>${body}</tbody></table></div>`;
  };
  const count=(n)=>`<span class="add-count">${n}</span>`;
  // Free Agents Lost — players who left in free agency, with where they went.
  const lossTable=(rows)=>{
    if(!rows||!rows.length) return `<div class="add-empty">No free agents lost.</div>`;
    const body=rows.map(r=>`<tr>
      <td class="add-player clickable-player" onclick="${pcardOnclick(r.player, r.pos, '')}">${r.player}</td>
      <td>${posBadge(r.pos)}</td>
      <td class="add-dest">${r.to_team?`→ <img src="${NFL_LOGO(r.to_team)}" class="add-dest-logo" onerror="this.style.display='none'"><b>${r.to_team}</b>`:'—'}</td>
      <td class="add-num">${noteWrapHtml(escHtml(r.years!=null?r.years+' yr':'—'), { label:'Contract Term', value:r.years!=null?r.years+' yr':'—', source:'roster_changes_loss', statKey:'term', context:`${teamDisplayName(team)} ${PROJ_SEASON} free-agent loss`, player:noteTargetFromArgs(r.player, r.pos, team), team, relevance:'QB,RB,WR,TE' }, 'note-tag-hit')}</td>
      <td class="add-num add-val add-loss-val">${noteWrapHtml(escHtml(fmtMillions(r.value_m)), { label:'Contract Total', value:fmtMillions(r.value_m), source:'roster_changes_loss', statKey:'value_m', context:`${teamDisplayName(team)} ${PROJ_SEASON} free-agent loss`, player:noteTargetFromArgs(r.player, r.pos, team), team, relevance:'QB,RB,WR,TE' }, 'note-tag-hit')}</td>
      <td class="add-num add-aav">${noteWrapHtml(escHtml(fmtMillions(r.aav_m)), { label:'Contract AAV', value:fmtMillions(r.aav_m), source:'roster_changes_loss', statKey:'aav_m', context:`${teamDisplayName(team)} ${PROJ_SEASON} free-agent loss`, player:noteTargetFromArgs(r.player, r.pos, team), team, relevance:'QB,RB,WR,TE' }, 'note-tag-hit')}</td>
    </tr>`).join('');
    return `<div class="add-table-scroll"><table class="add-table"><thead><tr>
      <th class="add-th-player">PLAYER</th><th>POS</th><th>SIGNED WITH</th>
      <th class="add-num">TERM</th><th class="add-num">TOTAL</th><th class="add-num">AAV</th>
      </tr></thead><tbody>${body}</tbody></table></div>`;
  };
  return `<div class="add-wrap">
    <div class="add-note"><b>${teamDisplayName(team)}</b> ${PROJ_SEASON} roster changes — additions via free agency, the draft, and trades, plus notable departures. Sorted by contract/cap value. Pair this with the ${advTeamSeason()} Advanced Stats to see how weaknesses were addressed — and where new holes may have opened.</div>

    <div class="add-section">
      <div class="add-section-head">Free Agency ${count((a.free_agents||[]).length)}</div>
      ${signingTable(a.free_agents,'fa')}
    </div>

    <div class="add-section">
      <div class="add-section-head">Draft ${count((a.draft||[]).length)}</div>
      ${signingTable(a.draft,'draft')}
    </div>

    <div class="add-section">
      <div class="add-section-head">Trades ${count((a.trades||[]).length)}</div>
      ${tradeTable(a.trades)}
    </div>

    <div class="add-section add-losses-section">
      <div class="add-section-head">Notable Losses ${count((a.free_agents_lost||[]).length)}</div>
      <div class="add-losses-sub">Free agents who signed elsewhere this offseason.</div>
      ${lossTable(a.free_agents_lost)}
    </div>

    ${renderDepthChart(team)}

    <div class="sr-source">${PROJ_SEASON} offseason moves · depth chart via ESPN · for informational use.</div>
  </div>`;
}

// Per-team advanced view: one card per Sharp table, each showing this team's value + rank.
// Coordinator helpers -------------------------------------------------------
function coordFor(team, side){ return COORDINATORS && COORDINATORS[team] && COORDINATORS[team][side]; }
// A coordinator "carries over" another team's scheme when they're brand-new this season
// AND came from another NFL team. Those get the Coordinators tab.
function coordCarriesOver(c){ return !!(c && c.is_new && !c.internal && c.prev_code); }
// Head-coach history entry (former team/role), from the seed.
function hcHistFor(team){ return HC_HISTORY && HC_HISTORY[team]; }
// When the HEAD COACH is the primary playcaller AND is new this season AND came from another
// NFL team, the OFFENSIVE scheme travels with the HC — so the carryover source is the HC's
// former team, not the OC's. Returns a carryover-source object shaped like a coordinator
// (name, prev_code, prev_role, prev_years) or null.
function playcallerHCOffenseSource(team){
  if(!hcIsPlaycaller(team)) return null;
  const h=hcHistFor(team);
  if(!h) return null;
  if(!(h.is_new && h.prev_code)) return null;   // must be new this season, from another team
  // Guard: if the HC's "former team" is this same team (rare data quirk), no carryover.
  if(h.prev_code===team) return null;
  return { name:h.name||(HC_PLAYCALLERS&&HC_PLAYCALLERS[team])||'Head coach', prev_code:h.prev_code,
           prev_role:h.prev_role||'head coach', prev_years:h.prev_years, is_new:true, internal:false,
           _fromHC:true };
}

// If a team's HC is the primary offensive playcaller, offensive trend context should reference
// that HC's tenure on the team (used when another coach moved here from that team).
function offensivePlaycallerContextFor(team){
  const t = String(team||'').toUpperCase();
  if(!t || !(HC_PLAYCALLERS && HC_PLAYCALLERS[t])) return null;
  const h = hcHistFor(t) || {};
  const nm = (HC_PLAYCALLERS && HC_PLAYCALLERS[t]) || h.name || '';
  const since = parseInt(h.since, 10);
  return {
    name: nm,
    since: Number.isFinite(since) ? since : null,
  };
}
function teamHasCarryover(team){
  const o=coordFor(team,'offense'), d=coordFor(team,'defense');
  return coordCarriesOver(o) || coordCarriesOver(d);
}
// Short inline label for a coordinator next to a section head.
function coordInlineLabel(a,b,c){
  // Backward-compatible signature: (coord, sideWord) or (team, coord, sideWord)
  let team = (typeof a==='string' && b && typeof b==='object') ? a : (c || currentTeam);
  const coord = (typeof a==='string' && b && typeof b==='object') ? b : a;
  const sideWord = (typeof a==='string' && b && typeof b==='object') ? c : b;
  // Legacy callers may pass only the coordinator object; infer the team by object identity.
  if(!team && coord && COORDINATORS){
    for(const code in COORDINATORS){
      const row = COORDINATORS[code]||{};
      if(row.offense===coord || row.defense===coord){ team = code; break; }
    }
  }
  const attrs = team
    ? `class="coord-inline scheme-open" role="button" tabindex="0" title="Open playbook visualization" onclick="openTeamCoachingScheme('${team}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openTeamCoachingScheme('${team}');}"`
    : `class="coord-inline"`;
  if(!coord) return '';
  if(!coord.name) return '';
  if(coordCarriesOver(coord)){
    const role = coord.prev_role || 'coordinator';
    return `<span ${attrs}>
      ${sideWord==='offensive'?'OC':'DC'}: <b>${coord.name}</b> <span class="coord-new-tag">NEW · from ${teamDisplayName(coord.prev_code)} ${role}</span></span>`;
  }
  // carryover/internal: last season's stats apply directly
  const since = coord.since?` · since ${coord.since}`:'';
  return `<span ${attrs}>${sideWord==='offensive'?'OC':'DC'}: <b>${coord.name}</b>${since}</span>`;
}

// ── Advanced week-range control (team cards) ───────────────────────────────
// Uses nflverse weekly sidecars (`ol_weekly` + `adv_weekly`) to recompute
// selected advanced cards over arbitrary week windows.
let _advWeekDragByTeam = {};       // temporary drag state before commit
let _advWeeklySeedReady = false;
let _advWeeklySeedLoading = false;
let _advOlRangeCache = {};         // key: `${season}:${lo}-${hi}` -> {passTbl, runTbl}
let _advGenRangeCache = {};        // key: `${season}:${lo}-${hi}` -> recomputed advanced tables
const ADV_LEAGUE_RANGE_KEY = '__LEAGUE__';

function _advSeasonCanRange(){
  const s=String(advTeamSeason());
  // On the projection view the week slider only makes sense when the Advanced tab is showing
  // the season in progress (live sidecar); a last-season fallback stays un-ranged.
  if(activeSeason==='proj' && !(typeof tcIsLiveSeason==='function' && tcIsLiveSeason(s))) return false;
  return !!(NFLVERSE && NFLVERSE[s] && NFLVERSE[s].team);
}
function _advRangeKey(team){ return `${advTeamSeason()}:${String(team||'').toUpperCase()}`; }
function _advGetWeekRange(team){
  if(typeof getSharedWeekRange==='function') return getSharedWeekRange(team, advTeamSeason());
  return [1,18];
}
function _advWeekRangeActive(team){
  const [lo,hi]=_advGetWeekRange(team);
  return lo>1 || hi<18;
}
function _advWeekLabel(team){
  const [lo,hi]=_advGetWeekRange(team);
  return lo===1 && hi===18 ? 'Weeks 1-18 (full season)' : `Weeks ${lo}-${hi}`;
}
function _advEnsureWeeklyLoaded(){
  if(_advWeeklySeedReady || _advWeeklySeedLoading) return;
  if(typeof ensureNflverseSection!=='function') return;
  _advWeeklySeedLoading=true;
  Promise.all([
    ensureNflverseSection('ol_weekly').catch(()=>false),
    ensureNflverseSection('adv_weekly').catch(()=>false),
  ]).then(([okOl, okAdv])=>{
    _advWeeklySeedReady = !!(okOl || okAdv);
    _advWeeklySeedLoading = false;
    if(typeof renderContent==='function') renderContent();
  }).catch(()=>{ _advWeeklySeedLoading=false; });
}
function advWeekRangeDrag(team, which, val){
  team=String(team||'').toUpperCase();
  const maxWk=(typeof tcSeasonMaxWeek==='function')?tcSeasonMaxWeek(advTeamSeason()):18;
  const [curLo,curHi]=_advGetWeekRange(team);
  let lo=Math.min(curLo,maxWk), hi=Math.min(curHi,maxWk);
  const n=Math.max(1, Math.min(maxWk, parseInt(val,10)||1));
  if(which==='lo') lo=Math.min(n, hi); else hi=Math.max(n, lo);
  _advWeekDragByTeam[_advRangeKey(team)] = [lo,hi];
  const loEl=document.getElementById(`adv-wr-lo-${team}`); if(loEl) loEl.textContent=lo;
  const hiEl=document.getElementById(`adv-wr-hi-${team}`); if(hiEl) hiEl.textContent=hi;
  const fill=document.getElementById(`adv-wr-fill-${team}`);
  const span=Math.max(1,maxWk-1);
  if(fill){
    fill.style.left=((lo-1)/span*100)+'%';
    fill.style.right=((maxWk-hi)/span*100)+'%';
  }
}
function advWeekRangeCommit(team){
  team=String(team||'').toUpperCase();
  const key=_advRangeKey(team);
  const next=_advWeekDragByTeam[key] || _advGetWeekRange(team);
  delete _advWeekDragByTeam[key];
  if(typeof setSharedWeekRange==='function') setSharedWeekRange(team, advTeamSeason(), next[0], next[1]);
  if(team!==ADV_LEAGUE_RANGE_KEY && typeof applyWeekRange==='function' && advTeamSeason()===String(activeSeason)){
    applyWeekRange(team, next[0], next[1]);
    return;
  }
  if(typeof renderContent==='function') renderContent();
}
function advWeekRangeReset(team){
  team=String(team||'').toUpperCase();
  if(typeof setSharedWeekRange==='function') setSharedWeekRange(team, advTeamSeason(), 1, 18);
  if(team!==ADV_LEAGUE_RANGE_KEY && typeof resetWeekRange==='function' && advTeamSeason()===String(activeSeason)){
    resetWeekRange(team);
    return;
  }
  if(typeof renderContent==='function') renderContent();
}
function _advPctRank(valuesByTeam, lowerBetter){
  const entries = Object.entries(valuesByTeam).filter(([,v])=>typeof v==='number' && Number.isFinite(v));
  entries.sort((a,b)=> lowerBetter ? (a[1]-b[1]) : (b[1]-a[1]));
  const out={};
  const n=entries.length;
  if(!n) return out;
  for(let i=0;i<n;i++){
    const pct=((i+1)/n)*100;
    out[entries[i][0]] = lowerBetter ? (100-pct) : pct;
  }
  return out;
}
function _advRankMap(valuesByTeam, lowerBetter){
  const entries = Object.entries(valuesByTeam).filter(([,v])=>typeof v==='number' && Number.isFinite(v));
  entries.sort((a,b)=> lowerBetter ? (a[1]-b[1]) : (b[1]-a[1]));
  const out={};
  for(let i=0;i<entries.length;i++) out[entries[i][0]] = i+1;
  return out;
}
function _advNum(v, dp){
  if(v==null || !Number.isFinite(v)) return null;
  return Number(v.toFixed(dp));
}
function _advComputeOlRangeTables(season, lo, hi){
  const cacheKey=`${season}:${lo}-${hi}`;
  if(_advOlRangeCache[cacheKey]) return _advOlRangeCache[cacheKey];
  const pack=(NFLVERSE&&NFLVERSE[String(season)]&&NFLVERSE[String(season)].ol_weekly)||null;
  if(!pack || !pack.teams || !Array.isArray(pack.weeks)) return null;
  const weekIdx=[];
  for(let i=0;i<pack.weeks.length;i++){
    const w=Number(pack.weeks[i]);
    if(Number.isFinite(w) && w>=lo && w<=hi) weekIdx.push(i);
  }
  if(!weekIdx.length) return null;
  const pcols=pack.pass_cols||[];
  const rcols=pack.run_cols||[];
  const pidx={}; pcols.forEach((c,i)=>{ pidx[c]=i; });
  const ridx={}; rcols.forEach((c,i)=>{ ridx[c]=i; });
  const teams={};
  for(const tm in pack.teams){
    const node=pack.teams[tm]||{};
    const passRows=Array.isArray(node.pass)?node.pass:[];
    const runRows=Array.isArray(node.run)?node.run:[];
    const ps=new Array(pcols.length).fill(0);
    const rs=new Array(rcols.length).fill(0);
    weekIdx.forEach(ix=>{
      const pr=passRows[ix]||[]; const rr=runRows[ix]||[];
      for(let i=0;i<pcols.length;i++) ps[i]+=Number(pr[i]||0);
      for(let i=0;i<rcols.length;i++) rs[i]+=Number(rr[i]||0);
    });
    const db=ps[pidx.dropbacks]||0;
    const dr=ps[pidx.designed_rushes]||0;
    const sacks=ps[pidx.sacks]||0;
    const pressure=ps[pidx.times_pressured]||0;
    const hits=ps[pidx.times_hit]||0;
    const hurries=ps[pidx.times_hurried]||0;
    const blitzes=ps[pidx.times_blitzed]||0;
    const nonQb=ps[pidx.non_qb_sacks]||0;
    const nbp=ps[pidx.no_blitz_pressures]||0;
    const ptW=ps[pidx.pocket_time_w]||0;
    const ptAtt=ps[pidx.pocket_time_att]||0;

    const ra=rs[ridx.designed_rushes]||0;
    const stuffed=rs[ridx.stuffed]||0;
    const expl=rs[ridx.explosive]||0;
    const ry=rs[ridx.rush_yards]||0;
    const ybc=rs[ridx.ybc]||0;
    const yac=rs[ridx.yac]||0;
    const bt=rs[ridx.broken_tackles]||0;
    const r1d=rs[ridx.rush_first_downs]||0;
    const ngsAtt=rs[ridx.ngs_att]||0;
    const roeW=rs[ridx.roe_w]||0;
    const b8W=rs[ridx.box8_w]||0;
    const tlosW=rs[ridx.tlos_w]||0;

    teams[tm]={
      pass:{
        Dropbacks: _advNum(db,0),
        'Pass Rate': _advNum((db+dr)>0 ? (db/(db+dr))*100 : null,1),
        'Pressure Rate': _advNum(db>0 ? (pressure/db)*100 : null,1),
        'Hit Rate': _advNum(db>0 ? (hits/db)*100 : null,1),
        'Hurry Rate': _advNum(db>0 ? (hurries/db)*100 : null,1),
        'Blitz Rate': _advNum(db>0 ? (blitzes/db)*100 : null,1),
        'Pocket Time': _advNum(ptAtt>0 ? (ptW/ptAtt) : null,2),
        'Sack Rate': _advNum(db>0 ? (sacks/db)*100 : null,1),
        'Non-QB Sack Rate': _advNum(db>0 ? (nonQb/db)*100 : null,1),
        'No Blitz Pressure Rate': _advNum(db>0 ? (nbp/db)*100 : null,1),
      },
      run:{
        'Stuff Rate': _advNum(ra>0 ? (stuffed/ra)*100 : null,1),
        'Explosive Run Rate': _advNum(ra>0 ? (expl/ra)*100 : null,1),
        'Yards/Rush': _advNum(ra>0 ? (ry/ra) : null,2),
        'YBC/Rush': _advNum(ra>0 ? (ybc/ra) : null,2),
        'YAC/Rush': _advNum(ra>0 ? (yac/ra) : null,2),
        'Rush 1D Rate': _advNum(ra>0 ? (r1d/ra)*100 : null,1),
        'Broken Tackle Rate': _advNum(ra>0 ? (bt/ra)*100 : null,1),
        'ROE/Att': _advNum(ngsAtt>0 ? (roeW/ngsAtt) : null,2),
        '8+ Box Rate': _advNum(ngsAtt>0 ? (b8W/ngsAtt) : null,1),
        'Time to LOS': _advNum(ngsAtt>0 ? (tlosW/ngsAtt) : null,2),
      },
      util: _advNum((db+dr)>0 ? (db/(db+dr))*100 : null,1),
    };
  }

  const map=(which,col)=>{ const o={}; for(const tm in teams){ o[tm]=teams[tm][which][col]; } return o; };
  const passScore={
    p: _advPctRank(map('pass','Pressure Rate'), true),
    h: _advPctRank(map('pass','Hit Rate'), true),
    hu:_advPctRank(map('pass','Hurry Rate'), true),
    s: _advPctRank(map('pass','Sack Rate'), true),
    n: _advPctRank(map('pass','Non-QB Sack Rate'), true),
    nb:_advPctRank(map('pass','No Blitz Pressure Rate'), true),
    pt:_advPctRank(map('pass','Pocket Time'), false),
  };
  const runProxy=_advPctRank(map('run','Stuff Rate'), true);
  for(const tm in teams){
    const ps=(Number(passScore.p[tm]||0)*0.30)+(Number(passScore.h[tm]||0)*0.10)+(Number(passScore.hu[tm]||0)*0.10)+
      (Number(passScore.s[tm]||0)*0.20)+(Number(passScore.n[tm]||0)*0.15)+(Number(passScore.nb[tm]||0)*0.10)+
      (Number(passScore.pt[tm]||0)*0.05);
    const util=(Number(teams[tm].util)||50)/100;
    const overall=(util*ps)+((1-util)*Number(runProxy[tm]||50));
    teams[tm].pass['Pass Score']=_advNum(ps,2);
    teams[tm].pass['Overall Score']=_advNum(overall,2);
    teams[tm].run['Overall Score']=_advNum(overall,2);
  }

  const passCols=['Overall Score','Dropbacks','Pass Score','Pressure Rate','Hit Rate','Hurry Rate','Blitz Rate','No Blitz Pressure Rate','Sack Rate','Non-QB Sack Rate','Pocket Time'];
  const runCols=['Overall Score','Stuff Rate','Explosive Run Rate','Yards/Rush','YBC/Rush','YAC/Rush','Rush 1D Rate','Broken Tackle Rate','ROE/Att','8+ Box Rate','Time to LOS'];
  const passLower=new Set(['Pressure Rate','Hit Rate','Hurry Rate','Sack Rate','Non-QB Sack Rate','No Blitz Pressure Rate']);
  const runLower=new Set(['Stuff Rate','8+ Box Rate','Time to LOS']);

  const passTbl={columns:passCols, pct_cols:['Pass Rate','Pressure Rate','Hit Rate','Hurry Rate','Blitz Rate','No Blitz Pressure Rate','Sack Rate','Non-QB Sack Rate'], teams:{}};
  const runTbl={columns:runCols, pct_cols:['Stuff Rate','Explosive Run Rate','Rush 1D Rate','Broken Tackle Rate','8+ Box Rate'], teams:{}};
  passCols.forEach(col=>{
    const vals={}; for(const tm in teams) vals[tm]=teams[tm].pass[col];
    const rk=_advRankMap(vals, passLower.has(col));
    for(const tm in teams){
      passTbl.teams[tm]=passTbl.teams[tm]||{values:{},ranks:{}};
      passTbl.teams[tm].values[col]=teams[tm].pass[col];
      passTbl.teams[tm].ranks[col]=(rk[tm]!=null)?rk[tm]:null;
    }
  });
  runCols.forEach(col=>{
    const vals={}; for(const tm in teams) vals[tm]=teams[tm].run[col];
    const rk=_advRankMap(vals, runLower.has(col));
    for(const tm in teams){
      runTbl.teams[tm]=runTbl.teams[tm]||{values:{},ranks:{}};
      runTbl.teams[tm].values[col]=teams[tm].run[col];
      runTbl.teams[tm].ranks[col]=(rk[tm]!=null)?rk[tm]:null;
    }
  });

  const out={passTbl, runTbl};
  _advOlRangeCache[cacheKey]=out;
  return out;
}

function _advComputeGeneralRangeTables(season, lo, hi){
  const cacheKey=`${season}:${lo}-${hi}`;
  if(_advGenRangeCache[cacheKey]) return _advGenRangeCache[cacheKey];
  const pack=(NFLVERSE&&NFLVERSE[String(season)]&&NFLVERSE[String(season)].adv_weekly)||null;
  if(!pack || !pack.teams || !Array.isArray(pack.weeks) || !Array.isArray(pack.cols)) return null;
  const weekIdx=[];
  for(let i=0;i<pack.weeks.length;i++){
    const w=Number(pack.weeks[i]);
    if(Number.isFinite(w) && w>=lo && w<=hi) weekIdx.push(i);
  }
  if(!weekIdx.length) return null;
  const cols=pack.cols;

  const teams={};
  for(const tm in pack.teams){
    const rows=Array.isArray(pack.teams[tm]) ? pack.teams[tm] : [];
    const sum={};
    cols.forEach(c=>{ sum[c]=0; });
    weekIdx.forEach(ix=>{
      const r=rows[ix]||[];
      cols.forEach((c,j)=>{ sum[c]+=Number(r[j]||0); });
    });

    const offPlays=sum.off_plays||0;
    const defPlays=sum.def_plays||0;
    const offConvObs=sum.off_conv_obs||0;
    const defConvObs=sum.def_conv_obs||0;
    const offDriveCt=sum.off_drive_ct||0;
    const defDriveCt=sum.def_drive_ct||0;

    const tendPlays=sum.tend_plays||0;
    const db=sum.db||0;
    const catchable=sum.tend_catchable||0;

    const paceSnaps=sum.pace_snaps||0;
    const paceNeutralSnaps=sum.pace_neutral_snaps||0;
    const paceGames=sum.pace_games||0;
    const paceSecN=sum.pace_sec_n||0;

    const offPersObs=sum.off_pers_obs||0;
    const defPersObs=sum.def_pers_obs||0;
    const covObs=sum.cov_obs||0;
    const covShellObs=sum.cov_shell_obs||0;
    const blitzObs=sum.blitz_db_obs||0;
    const dlDropbacks=sum.dl_dropbacks||0;
    const dlNoBlitzObs=sum.dl_no_blitz_obs||0;
    const dlRushAtt=sum.dl_rush_att||0;

    teams[tm]={
      offense:{
        'EPA/Play': _advNum(offPlays>0 ? (sum.off_epa/offPlays) : null, 3),
        'Yards Per Play': _advNum(offPlays>0 ? (sum.off_yards/offPlays) : null, 2),
        'Points Per Drive': _advNum(offDriveCt>0 ? (sum.off_drive_pts/offDriveCt) : null, 2),
        'Explosive Play Rate': _advNum(offPlays>0 ? (sum.off_explosive/offPlays)*100 : null, 1),
        'Down Conversion Rate': _advNum(offConvObs>0 ? (sum.off_conv/offConvObs)*100 : null, 1),
      },
      defense:{
        'EPA/Play': _advNum(defPlays>0 ? (-(sum.def_epa_allowed/defPlays)) : null, 3),
        'Yards Per Play': _advNum(defPlays>0 ? (sum.def_yards/defPlays) : null, 2),
        'Points Per Drive': _advNum(defDriveCt>0 ? (sum.def_drive_pts_allowed/defDriveCt) : null, 2),
        'Explosive Play Rate': _advNum(defPlays>0 ? (sum.def_explosive_allowed/defPlays)*100 : null, 1),
        'Down Conversion Rate': _advNum(defConvObs>0 ? (sum.def_conv_allowed/defConvObs)*100 : null, 1),
      },
      tendencies:{
        'Shotgun Rate': _advNum(tendPlays>0 ? (sum.tend_shotgun/tendPlays)*100 : null, 1),
        'NoHuddle Rate': _advNum(tendPlays>0 ? (sum.tend_nohuddle/tendPlays)*100 : null, 1),
        'AirYards/Att': _advNum((sum.air_att||0)>0 ? (sum.air_sum/sum.air_att) : null, 2),
        'Motion Rate': _advNum(tendPlays>0 ? (sum.tend_motion/tendPlays)*100 : null, 1),
        'Play Action Rate': _advNum(db>0 ? (sum.tend_play_action/db)*100 : null, 1),
        'RPO Rate': _advNum(tendPlays>0 ? (sum.tend_rpo/tendPlays)*100 : null, 1),
        'Screen Rate': _advNum(db>0 ? (sum.tend_screen/db)*100 : null, 1),
        'Trick Play Rate': _advNum(tendPlays>0 ? (sum.tend_trick/tendPlays)*100 : null, 1),
        'Drop Rate': _advNum(catchable>0 ? (sum.tend_drop/catchable)*100 : null, 1),
      },
      pace:{
        'Neutral DB Rate': _advNum(paceNeutralSnaps>0 ? (sum.pace_neutral_db/paceNeutralSnaps)*100 : null, 1),
        'Sec/Play': _advNum(paceSecN>0 ? (sum.pace_sec_sum/paceSecN) : null, 1),
        'Off Plays/G': _advNum(paceGames>0 ? (paceSnaps/paceGames) : null, 1),
        'Total Plays/G': _advNum(paceGames>0 ? ((sum.pace_total_game_plays||0)/paceGames) : null, 1),
      },
      personnel:{
        '11 Personnel': _advNum(offPersObs>0 ? (sum.off_11/offPersObs)*100 : null, 1),
        '12 Personnel': _advNum(offPersObs>0 ? (sum.off_12/offPersObs)*100 : null, 1),
        '13 Personnel': _advNum(offPersObs>0 ? (sum.off_13/offPersObs)*100 : null, 1),
        '21 Personnel': _advNum(offPersObs>0 ? (sum.off_21/offPersObs)*100 : null, 1),
        '3WR Rate': _advNum(offPersObs>0 ? (sum.off_wr3/offPersObs)*100 : null, 1),
        'Multi TE Rate': _advNum(offPersObs>0 ? (sum.off_mte/offPersObs)*100 : null, 1),
        'Multi RB Rate': _advNum(offPersObs>0 ? (sum.off_multirb/offPersObs)*100 : null, 1),
      },
      coverage:{
        'Man Rate': _advNum(covObs>0 ? (sum.cov_man/covObs)*100 : null, 1),
        'Zone Rate': _advNum(covObs>0 ? (sum.cov_zone/covObs)*100 : null, 1),
        'Middle Closed Rate': _advNum(covShellObs>0 ? (sum.cov_mofc/covShellObs)*100 : null, 1),
        'Middle Open Rate': _advNum(covShellObs>0 ? (sum.cov_mofo/covShellObs)*100 : null, 1),
        'Cover 1': _advNum(covShellObs>0 ? (sum.cov_c1/covShellObs)*100 : null, 1),
        'Cover 2': _advNum(covShellObs>0 ? (sum.cov_c2/covShellObs)*100 : null, 1),
        'Cover 3': _advNum(covShellObs>0 ? (sum.cov_c3/covShellObs)*100 : null, 1),
      },
      def_tendencies:{
        'Blitz Rate': _advNum(blitzObs>0 ? (sum.blitz_db5/blitzObs)*100 : null, 1),
        'Sub Package Rate': _advNum(defPersObs>0 ? (sum.def_sub/defPersObs)*100 : null, 1),
        'Nickel Rate': _advNum(defPersObs>0 ? (sum.def_nickel/defPersObs)*100 : null, 1),
        'Dime+ Rate': _advNum(defPersObs>0 ? (sum.def_dime/defPersObs)*100 : null, 1),
      },
      defensive_line:{
        'Pressure Rate': _advNum(dlDropbacks>0 ? (sum.dl_pressures/dlDropbacks)*100 : null, 1),
        'No Blitz Pressure Rate': _advNum(dlNoBlitzObs>0 ? (sum.dl_no_blitz_pressures/dlNoBlitzObs)*100 : null, 1),
        'Rush Stuff Rate': _advNum(dlRushAtt>0 ? (sum.dl_rush_stuffed/dlRushAtt)*100 : null, 1),
      },
    };
  }

  const mk=(vals, lower)=>_advRankMap(vals, lower);
  const out={};
  const defLower=new Set(['Yards Per Play','Points Per Drive','Explosive Play Rate','Down Conversion Rate']);
  const tendLower=new Set(['Drop Rate']);
  const paceLower=new Set(['Sec/Play']);
  const covLower=new Set();
  const persLower=new Set();
  const dtendLower=new Set();
  const dlineLower=new Set(['Missed Tackles']);
  const spec={
    offense:{lower:new Set(), cols:['EPA/Play','Yards Per Play','Points Per Drive','Explosive Play Rate','Down Conversion Rate']},
    defense:{lower:defLower, cols:['EPA/Play','Yards Per Play','Points Per Drive','Explosive Play Rate','Down Conversion Rate']},
    tendencies:{lower:tendLower, cols:['Shotgun Rate','NoHuddle Rate','AirYards/Att','Motion Rate','Play Action Rate','RPO Rate','Screen Rate','Trick Play Rate','Drop Rate']},
    pace:{lower:paceLower, cols:['Neutral DB Rate','Sec/Play','Off Plays/G','Total Plays/G']},
    personnel:{lower:persLower, cols:['11 Personnel','12 Personnel','13 Personnel','21 Personnel','3WR Rate','Multi TE Rate','Multi RB Rate']},
    coverage:{lower:covLower, cols:['Man Rate','Zone Rate','Middle Closed Rate','Middle Open Rate','Cover 1','Cover 2','Cover 3']},
    def_tendencies:{lower:dtendLower, cols:['Blitz Rate','Sub Package Rate','Nickel Rate','Dime+ Rate']},
    defensive_line:{lower:dlineLower, cols:['Pressure Rate','No Blitz Pressure Rate','Rush Stuff Rate','Missed Tackles']},
  };
  for(const key of Object.keys(spec)){
    const colsList=spec[key].cols;
    const table={columns:colsList, teams:{}};
    for(const c of colsList){
      const vals={};
      for(const tm in teams) vals[tm]=teams[tm][key][c];
      const rk=mk(vals, spec[key].lower.has(c));
      for(const tm in teams){
        table.teams[tm]=table.teams[tm]||{values:{},ranks:{}};
        table.teams[tm].values[c]=teams[tm][key][c];
        table.teams[tm].ranks[c]=(rk[tm]!=null)?rk[tm]:null;
      }
    }
    out[key]=table;
  }
  _advGenRangeCache[cacheKey]=out;
  return out;
}
function _advTableForRange(key, baseTable, team){
  if(!baseTable) return baseTable;
  if(!_advWeekRangeActive(team)) return baseTable;
  if(!_advSeasonCanRange()) return baseTable;
  const [lo,hi]=_advGetWeekRange(team);
  const season=String(advTeamSeason());
  if(key==='offensive_line_pass' || key==='offensive_line_run'){
    const agg=_advComputeOlRangeTables(season, lo, hi);
    if(!agg) return baseTable;
    return key==='offensive_line_pass' ? agg.passTbl : agg.runTbl;
  }
  if(key==='offense' || key==='defense' || key==='tendencies' || key==='pace'){
    const agg=_advComputeGeneralRangeTables(season, lo, hi);
    if(!agg || !agg[key]) return baseTable;
    const aggTbl=agg[key];
    const baseTeams=(baseTable&&baseTable.teams)||{};
    const aggTeams=(aggTbl&&aggTbl.teams)||{};
    const outTeams={};
    const allTeams=new Set([...Object.keys(baseTeams), ...Object.keys(aggTeams)]);
    const cols=(Array.isArray(baseTable.columns) && baseTable.columns.length) ? baseTable.columns : (aggTbl.columns||[]);
    allTeams.forEach(tm=>{
      const b=baseTeams[tm]||{values:{},ranks:{}};
      const a=aggTeams[tm]||{values:{},ranks:{}};
      const values={}; const ranks={};
      cols.forEach(col=>{
        const av=(a.values||{})[col];
        const ar=(a.ranks||{})[col];
        values[col]=(av!=null && Number.isFinite(av)) ? av : ((b.values||{})[col]!=null ? (b.values||{})[col] : null);
        ranks[col]=(ar!=null && Number.isFinite(ar)) ? ar : ((b.ranks||{})[col]!=null ? (b.ranks||{})[col] : null);
      });
      outTeams[tm]={values,ranks};
    });
    return Object.assign({}, baseTable, { columns: cols, teams: outTeams });
  }
  if(key==='personnel' || key==='coverage' || key==='def_tendencies' || key==='defensive_line'){
    const agg=_advComputeGeneralRangeTables(season, lo, hi);
    if(!agg || !agg[key]) return baseTable;
    const aggTbl=agg[key];
    const baseTeams=(baseTable&&baseTable.teams)||{};
    const aggTeams=(aggTbl&&aggTbl.teams)||{};
    const outTeams={};
    const allTeams=new Set([...Object.keys(baseTeams), ...Object.keys(aggTeams)]);
    const cols=(Array.isArray(baseTable.columns) && baseTable.columns.length) ? baseTable.columns : (aggTbl.columns||[]);
    allTeams.forEach(tm=>{
      const b=baseTeams[tm]||{values:{},ranks:{}};
      const a=aggTeams[tm]||{values:{},ranks:{}};
      const values={}; const ranks={};
      cols.forEach(col=>{
        const av=(a.values||{})[col];
        const ar=(a.ranks||{})[col];
        values[col]=(av!=null && Number.isFinite(av)) ? av : ((b.values||{})[col]!=null ? (b.values||{})[col] : null);
        ranks[col]=(ar!=null && Number.isFinite(ar)) ? ar : ((b.ranks||{})[col]!=null ? (b.ranks||{})[col] : null);
      });
      outTeams[tm]={values,ranks};
    });
    return Object.assign({}, baseTable, { columns: cols, teams: outTeams });
  }
  return baseTable;
}
function renderAdvWeekRange(team, opts){
  if(!_advSeasonCanRange()) return '';
  _advEnsureWeeklyLoaded();
  opts = opts || {};
  const showOppRail = opts.showOppRail !== false;
  const extraRail = opts.extraRailHTML || '';
  const [lo0,hi0]=_advGetWeekRange(team);
  const maxWk=(typeof tcSeasonMaxWeek==='function')?tcSeasonMaxWeek(advTeamSeason()):18;
  const lo=Math.min(lo0,maxWk), hi=Math.min(hi0,maxWk), span=Math.max(1,maxWk-1);
  const left=((lo-1)/span*100), right=((maxWk-hi)/span*100);
  const loading=_advWeeklySeedLoading ? '<span class="week-range-loading">loading…</span>' : '';
  const active = _advWeekRangeActive(team);
  const oppRail = (showOppRail && typeof renderWeekOpponentRail==='function')
    ? renderWeekOpponentRail(team, advTeamSeason(), 'wr-opp-adv')
    : '';
  return `<div class="week-range-card adv-week-range-card">
    <div class="week-range-label">
      <span>${TC_ICON("calendar")} Filter weeks: <b id="adv-wr-lo-${team}">${lo}</b> – <b id="adv-wr-hi-${team}">${hi}</b>${maxWk<18?` <span class="week-range-hint">of ${maxWk} played</span>`:''}${loading ? ' ' + loading : ''}</span>
      ${active ? `<span class="week-range-reset" onclick="advWeekRangeReset('${escJsSingle(team)}')">↺ Reset to full season</span>` : '<span class="week-range-hint">drag either end to zoom into a stretch of games</span>'}
    </div>
    <div class="dual-slider">
      <div class="dual-slider-track"></div>
      <div class="dual-slider-fill" id="adv-wr-fill-${team}" style="left:${left}%;right:${right}%;"></div>
      <input class="dual-range" type="range" min="1" max="${maxWk}" step="1" value="${lo}" oninput="advWeekRangeDrag('${team}','lo',this.value)" onchange="advWeekRangeCommit('${team}')">
      <input class="dual-range" type="range" min="1" max="${maxWk}" step="1" value="${hi}" oninput="advWeekRangeDrag('${team}','hi',this.value)" onchange="advWeekRangeCommit('${team}')">
      ${extraRail}
      ${oppRail}
    </div>
  </div>`;
}

function renderAdvLeagueWeekRange(){
  return renderAdvWeekRange(ADV_LEAGUE_RANGE_KEY, {
    showOppRail:false,
    extraRailHTML:(typeof renderWeekNumberRail==='function') ? renderWeekNumberRail('wr-week-adv') : '',
    title:'League-wide advanced week range:',
    summaryHint:'Windowed recompute applies to all 32 teams on the selected table (same season, weeks only).'
  });
}

// Projected-season OL overall-score chip shown next to the OL Pass / OL Run block titles.
// which = 'pass' | 'run'. Empty when no projection is available for the team.
function _advProjOlBadge(team, which){
  const p = (typeof projectedOlScore==='function') ? projectedOlScore(team, which) : null;
  if(!p || p.score==null || Number.isNaN(Number(p.score))) return '';
  const rk = (p.rank!=null && !Number.isNaN(Number(p.rank))) ? Number(p.rank) : null;
  const cls = (typeof sharpRankClass==='function' && rk!=null) ? sharpRankClass(rk) : '';
  const lbl = which==='pass' ? 'pass-protection' : 'run-blocking';
  const projSeason = String((typeof PROJ_SEASON!=='undefined' && PROJ_SEASON) ? PROJ_SEASON : new Date().getFullYear());
  const shortSeason = projSeason.slice(-2);
  return ` <span class="sr-proj-badge ${cls}" title="Projected ${projSeason} ${lbl} overall score, from projected depth-chart starters">Proj \u2019${shortSeason} ${Number(p.score).toFixed(1)}${rk!=null?` \u00b7 #${rk}`:''}</span>`;
}

function _advTeamPowerScore(team, src, opts){
  const o = opts || {};
  const season = String(advTeamSeason());
  const pack = (NFLVERSE && NFLVERSE[season] && NFLVERSE[season].adv_weekly) || null;
  const fallbackFromSrc = ()=>{
    const SRC = (src && typeof src==='object') ? src : (typeof activeSharp==='function' ? activeSharp() : null);
    if(!SRC || typeof SRC!=='object') return null;
    const sums = {};
    const partsByTeam = {};
    Object.keys(SRC).forEach((key)=>{
      const tbl = SRC[key] || {};
      const teams = tbl.teams || {};
      const label = String(tbl.title || key);
      Object.keys(teams).forEach((tm)=>{
        const row = teams[tm] || {};
        const ranks = row.ranks || {};
        const vals = Object.values(ranks).map(Number).filter(v=>Number.isFinite(v) && v>0);
        if(!vals.length) return;
        const avg = vals.reduce((a,b)=>a+b,0) / vals.length;
        if(!sums[tm]) sums[tm] = { sum:0, count:0 };
        sums[tm].sum += avg;
        sums[tm].count += 1;
        (partsByTeam[tm] = partsByTeam[tm] || []).push({ label, rank: avg });
      });
    });
    const rows = Object.keys(sums)
      .filter(tm=>sums[tm].count>0)
      .map(tm=>({
        team: tm,
        avg: sums[tm].sum / sums[tm].count,
        parts: (partsByTeam[tm]||[]).sort((a,b)=>a.rank-b.rank).slice(0,6),
      }))
      .sort((a,b)=>a.avg-b.avg || String(a.team).localeCompare(String(b.team)));
    if(!rows.length) return null;
    const rankMap = {};
    rows.forEach((r,i)=>{ rankMap[r.team] = i + 1; });
    const me = rows.find(r=>String(r.team).toUpperCase()===String(team).toUpperCase());
    if(!me) return null;
    return {
      team: String(team).toUpperCase(),
      avgRank: me.avg,
      leagueRank: rankMap[me.team],
      leagueSize: rows.length,
      parts: me.parts,
    };
  };
  if(o.stableFromSource) return fallbackFromSrc();
  if(!pack || !pack.teams || !Array.isArray(pack.weeks) || !Array.isArray(pack.cols)) return fallbackFromSrc();

  const requiredCols = [
    'off_pass_epa', 'off_pass_plays',
    'off_run_epa', 'off_run_plays',
    'def_pass_epa_allowed', 'def_pass_plays',
    'def_run_epa_allowed', 'def_run_plays',
    'off_drive_pts', 'def_drive_pts_allowed', 'pace_games',
  ];
  const colIdx = {};
  requiredCols.forEach(c=>{ colIdx[c] = pack.cols.indexOf(c); });
  if(requiredCols.some(c=>colIdx[c] < 0)) return fallbackFromSrc();

  const [lo, hi] = _advGetWeekRange(team);
  const weekIdx = [];
  for(let i=0;i<pack.weeks.length;i++){
    const w = Number(pack.weeks[i]);
    if(Number.isFinite(w) && w>=lo && w<=hi) weekIdx.push(i);
  }
  if(!weekIdx.length) return fallbackFromSrc();

  const specs = [
    { key:'off_pass_epa_pp', label:'Off EPA/Play (Pass)', lowerBetter:false },
    { key:'off_run_epa_pp', label:'Off EPA/Play (Run)', lowerBetter:false },
    { key:'def_pass_epa_allowed_pp', label:'Def EPA/Play Allowed (Pass)', lowerBetter:true },
    { key:'def_run_epa_allowed_pp', label:'Def EPA/Play Allowed (Run)', lowerBetter:true },
    { key:'points_scored_pg', label:'Points Scored', lowerBetter:false },
    { key:'points_allowed_pg', label:'Points Allowed', lowerBetter:true },
  ];

  const metricsByTeam = {};
  for(const tm of Object.keys(pack.teams)){
    const rows = Array.isArray(pack.teams[tm]) ? pack.teams[tm] : [];
    const sum = {
      offPassEpa:0, offPassPlays:0,
      offRunEpa:0, offRunPlays:0,
      defPassEpa:0, defPassPlays:0,
      defRunEpa:0, defRunPlays:0,
      offPts:0, defPts:0, games:0,
    };
    weekIdx.forEach(ix=>{
      const r = rows[ix] || [];
      sum.offPassEpa += Number(r[colIdx.off_pass_epa] || 0);
      sum.offPassPlays += Number(r[colIdx.off_pass_plays] || 0);
      sum.offRunEpa += Number(r[colIdx.off_run_epa] || 0);
      sum.offRunPlays += Number(r[colIdx.off_run_plays] || 0);
      sum.defPassEpa += Number(r[colIdx.def_pass_epa_allowed] || 0);
      sum.defPassPlays += Number(r[colIdx.def_pass_plays] || 0);
      sum.defRunEpa += Number(r[colIdx.def_run_epa_allowed] || 0);
      sum.defRunPlays += Number(r[colIdx.def_run_plays] || 0);
      sum.offPts += Number(r[colIdx.off_drive_pts] || 0);
      sum.defPts += Number(r[colIdx.def_drive_pts_allowed] || 0);
      sum.games += Number(r[colIdx.pace_games] || 0);
    });
    const games = sum.games > 0 ? sum.games : weekIdx.length;
    metricsByTeam[tm] = {
      off_pass_epa_pp: sum.offPassPlays>0 ? (sum.offPassEpa / sum.offPassPlays) : null,
      off_run_epa_pp: sum.offRunPlays>0 ? (sum.offRunEpa / sum.offRunPlays) : null,
      def_pass_epa_allowed_pp: sum.defPassPlays>0 ? (sum.defPassEpa / sum.defPassPlays) : null,
      def_run_epa_allowed_pp: sum.defRunPlays>0 ? (sum.defRunEpa / sum.defRunPlays) : null,
      points_scored_pg: games>0 ? (sum.offPts / games) : null,
      points_allowed_pg: games>0 ? (sum.defPts / games) : null,
    };
  }

  const rankMaps = {};
  specs.forEach(s=>{
    const vals = {};
    Object.keys(metricsByTeam).forEach(tm=>{ vals[tm] = metricsByTeam[tm][s.key]; });
    rankMaps[s.key] = _advRankMap(vals, s.lowerBetter);
  });

  const sums = {};
  const partsByTeam = {};
  specs.forEach(s=>{
    const rkMap = rankMaps[s.key] || {};
    Object.keys(rkMap).forEach(tm=>{
      const rk = rkMap[tm];
      if(!Number.isFinite(rk)) return;
      if(!sums[tm]) sums[tm] = { sum:0, count:0 };
      sums[tm].sum += Number(rk);
      sums[tm].count += 1;
      (partsByTeam[tm] = partsByTeam[tm] || []).push({ label:s.label, rank:Number(rk) });
    });
  });

  const rows = Object.keys(sums)
    .filter(tm=>sums[tm].count === specs.length)
    .map(tm=>({
      team: tm,
      avg: sums[tm].sum / specs.length,
      parts: partsByTeam[tm] || [],
    }))
    .sort((a,b)=>a.avg - b.avg || String(a.team).localeCompare(String(b.team)));
  if(!rows.length) return fallbackFromSrc();
  const rankMap = {};
  rows.forEach((r, i)=>{ rankMap[r.team] = i + 1; });
  const me = rows.find(r=>String(r.team).toUpperCase()===String(team).toUpperCase());
  if(!me) return fallbackFromSrc();
  return {
    team: String(team).toUpperCase(),
    avgRank: me.avg,
    leagueRank: rankMap[me.team],
    leagueSize: rows.length,
    parts: me.parts,
  };
}

function _renderAdvPowerScore(team, src, opts){
  const p = _advTeamPowerScore(team, src, opts);
  if(!p) return '';
  const o = opts || {};
  const showLabel = !o.shieldOnly;
  const cls = typeof sharpRankClass==='function' ? sharpRankClass(p.leagueRank) : '';
  const season = String(advTeamSeason());
  const detail = p.parts.map(x=>`${x.label} #${x.rank}`).join(' · ');
  const scoreTxt = p.avgRank.toFixed(2);
  return noteWrapHtml(`<span class="sr-sos-power ${cls}${showLabel?'':' sr-sos-power-shield-only'}" title="Power score rank ${ordinal(p.leagueRank)} of ${p.leagueSize}">${showLabel?'<span class="sr-sos-power-label">Power Score</span>':''}<span class="sr-sos-power-shield">${TC_ICON('shield')}<b>${ordinal(p.leagueRank)}</b></span></span>`, {
      label: 'Power Score league rank',
      value: `${ordinal(p.leagueRank)} of ${p.leagueSize} · Avg rank ${scoreTxt} · ${detail}`,
      source: 'team_advanced',
      statKey: 'power_score_rank',
      context: historicalTagContext(`${teamDisplayName(team)} · Advanced Power Score · ${season}`, team, season),
      team,
      relevance: 'QB,RB,WR,TE',
      nav: { type:'advanced', team, season },
    }, 'note-tag-hit');
}

function renderTeamAdvanced(team){
  const hasSharp=sharpHasData(), hasSOS=SOS&&Object.keys(SOS).length>0;
  const hasCoord = COORDINATORS && COORDINATORS[team];
  if(!hasSharp && !hasSOS && !hasCoord){
    return `<div class="empty"><div class="empty-icon">${TC_ICON("chart","tc-ico-lg")}</div>
      <div class="empty-title">No advanced stats loaded</div>
      <div class="empty-body">Run <code>build_seed.py</code> and load the 📦 seed to populate advanced team stats.</div></div>`;
  }
  const SRC=activeSharp();
  const cardFor=(key, srcTeam)=>{
    const baseTbl=SRC[key]; if(!baseTbl) return '';
    const tbl=_advTableForRange(key, baseTbl, team);
    const useTeam = srcTeam||team;
    const row=tbl.teams&&tbl.teams[useTeam];
    if(!row) return `<div class="sr-card"><div class="sr-card-title">${tbl.title||key}</div>
      <div class="sr-empty">No data for ${teamDisplayName(useTeam)}</div></div>`;
    const displayCols = (key==='offensive_line_pass')
      ? (tbl.columns||[]).filter(c=>c!=='Last 5 Sacks Allowed' && c!=='Last 5 Sack Rate')
      : (tbl.columns||[]);
    const lines = displayCols.map(col=>{
      const v=row.values?row.values[col]:null;
      const r=row.ranks?row.ranks[col]:null;
      const txt = fmtSharpVal(v, sharpColIsPct(tbl,col));
      const tagValue = r!=null ? `${txt} · league rank #${r}` : txt;
      return `<div class="sr-stat">
        <div class="sr-stat-label">${col}</div>
        <div class="sr-stat-val">${txt?noteWrapHtml(escHtml(txt), {
          label: col,
          value: tagValue,
          source: 'team_advanced',
          statKey: key,
          context: historicalTagContext(`${teamDisplayName(useTeam)} · ${tbl.title||key} · ${advTeamSeason()} season`, useTeam, advTeamSeason()),
          team: useTeam,
          relevance: noteRelevanceForTableKey(key),
          nav: { type:'advanced', team: useTeam, season: String(advTeamSeason()) },
        }, 'note-tag-hit'):txt}</div>
        <div class="sr-stat-rank">${sharpRankBadge(r)}</div>
      </div>`;
    }).join('');
    const projBadge = (key==='offensive_line_pass' || key==='offensive_line_run')
      ? _advProjOlBadge(useTeam, key==='offensive_line_pass'?'pass':'run') : '';
    return `<div class="sr-card">
      <div class="sr-card-title">${tbl.title||key}${projBadge}</div>
      <div class="sr-stat-grid">${lines}</div>
    </div>`;
  };
  const keys=Object.keys(SRC);
  const offKeys=keys.filter(k=>(SRC[k].category||'offense')==='offense');
  const defKeys=keys.filter(k=>SRC[k].category==='defense');
  const oc=coordFor(team,'offense'), dc=coordFor(team,'defense');
  const section=(label,ks,coordLbl)=> ks.length ? `<div class="sr-section-head">${label} ${coordLbl||''}</div>
    <div class="sr-card-grid">${ks.map(k=>cardFor(k)).join('')}</div>` : '';
  // SOS summary strip
  // The SOS block describes the PROJECTION season's slate — on a past-season reference
  // view it would be a 2026 schedule pinned over 2024 stats.
  const sos=(activeSeason==='proj') && SOS && SOS[team];
  const sosSched = (typeof renderTeamScheduleStrip==='function') ? renderTeamScheduleStrip(team) : '';
  const sosOpen = (typeof _sosStripOpen!=='undefined' && _sosStripOpen);
  const sosStrip = sos ? `<div class="sr-sos-block ${sosSched?'sos-clickable':''}" ${sosSched?`onclick="toggleSosStrip()" title="${sosOpen?'Hide':'Show'} the week-by-week schedule"`:''}>
  <div class="sr-sos-strip">
    <span class="sr-sos-rank ${sharpRankClass(sos.rank)}">${ordinal(sos.rank)}</span>
    <div class="sr-sos-main"><div class="sr-sos-label">${PROJ_SEASON} Strength of Schedule</div>
      <div class="sr-sos-sub">${noteWrapHtml(`${sos.win_total!=null?`Vegas win total <b>${sos.win_total}</b> · `:''}rank ${sos.rank} of 32 (1 = easiest)`, {
        label: `${PROJ_SEASON} Strength of Schedule`,
        value: `${sos.win_total!=null?`Vegas win total ${sos.win_total} · `:''}rank ${sos.rank} of 32`,
        source: 'team_sos',
        statKey: 'sos',
        context: `${teamDisplayName(team)} · ${PROJ_SEASON} schedule`,
        team,
        relevance: 'QB,RB,WR,TE',
        nav: { type:'advanced', team, season: 'proj' },
      }, 'note-tag-hit')}</div></div>
    ${sosSched?`<span class="sr-sos-caret" aria-hidden="true">${sosOpen?'▾':'▸'}</span>`:''}
    <button class="btn btn-ghost btn-sm sr-sos-btn" onclick="event.stopPropagation();showSharpLeague('sos')">See SOS chart →</button>
  </div>${sosSched}</div>` : '';
  // Carryover coordinators → a highlighted section that pulls the former team's scheme stats.
  const carryBlock = renderCoordinatorCarryover(team);
  const srcLabel = 'nflverse (computed from play-by-play)';
  return `<div class="sr-team-wrap">
    ${renderAdvWeekRange(team)}
    <div class="sr-note">${TC_ICON("chart")} <b>Advanced team stats</b> · ${srcLabel} · <b>${(typeof tcSeasonLabel==='function')?tcSeasonLabel(advTeamSeason()):advTeamSeason()} season${(typeof tcIsLiveSeason==='function'&&tcIsLiveSeason(advTeamSeason()))?' to date':''}</b> · league rank out of 32 · read-only reference to inform your ${PROJ_SEASON} decisions.
      <button class="btn btn-ghost btn-sm" style="margin-left:6px" onclick="showSharpLeague()">View league-wide tables →</button></div>
    ${sosStrip}
    ${carryBlock}
    ${section('Offense', offKeys, coordInlineLabel(team,oc,'offensive'))}
    ${section('Defense', defKeys, coordInlineLabel(team,dc,'defensive'))}
    <div class="sr-source">${(typeof tcSeasonLabel==='function')?tcSeasonLabel(advTeamSeason()):advTeamSeason()} season${(typeof tcIsLiveSeason==='function'&&tcIsLiveSeason(advTeamSeason()))?' · through the completed weeks, rebuilt weekly':''} · computed from nflverse play-by-play (nflfastR) — for informational use.</div>
  </div>`;
}

// The Coordinators carryover block: when a NEW coordinator came from another NFL team, show
// their former team's carry-over scheme stats (tendencies + personnel for OC; tendencies +
// coverage for DC — the aspects that travel with a coordinator), clearly labeled.
function renderCoordinatorCarryover(team){
  const oc=coordFor(team,'offense'), dc=coordFor(team,'defense');
  const blocks=[];
  // OFFENSE: when the head coach is the primary playcaller and is new-from-another-team, the
  // scheme travels with the HC → point at the HC's former team. Otherwise use the OC.
  const hcSrc = playcallerHCOffenseSource(team);
  const offSrc = hcSrc || (coordCarriesOver(oc) ? oc : null);
  if(offSrc) blocks.push(coordCarryCard('offensive', offSrc));
  if(coordCarriesOver(dc)) blocks.push(coordCarryCard('defensive', dc));
  if(!blocks.length) return '';
  return `<div class="coord-carry-wrap">
    <div class="coord-carry-head">${TC_ICON("refresh")} New coordinator for ${PROJ_SEASON}</div>
    ${blocks.join('')}
  </div>`;
}

// Jump to another team's Adv Metrics from a carryover link. Stays on the Advanced phase so
// you land on the same view you were reading, rather than being bounced to a default tab.
function advJumpToTeam(code){
  if(!code) return;
  currentPhase='Advanced';
  selectTeam(String(code).toUpperCase());
  if(typeof renderContent==='function') renderContent();
  try{ window.scrollTo({top:0, behavior:'smooth'}); }catch(e){ window.scrollTo(0,0); }
}
function coordCarryCard(sideWord, c){
  const from = teamDisplayName(c.prev_code);
  const prevPlaycaller = (sideWord==='offensive' && !c._fromHC)
    ? offensivePlaycallerContextFor(c.prev_code)
    : null;
  // A LINK, not an embedded copy of the other team's tables. Inlining the former team's stat
  // cards doubled the length of the Adv Metrics page and put another team's numbers directly
  // beside this team's — easy to misread as this team's own. The pointer is the useful part;
  // the reader can follow it when they want the detail, in the full context of that team.
  const jump = `advJumpToTeam('${escAttr(c.prev_code)}')`;
  const link = `<button class="adv-carry-link" onclick="${jump}" title="View ${escAttr(from)}\u2019s advanced metrics">`
    + `<img src="${NFL_LOGO(String(c.prev_code).toUpperCase())}" class="adv-carry-logo" alt="" onerror="this.style.display='none'">`
    + `${from}</button>`;
  const roleNote = c.prev_role
    ? `previously ${link} <b>${c.prev_role}</b>${c.prev_years?` (${c.prev_years})`:''}`
    : `previously with ${link}`;
  const playcallerHint = prevPlaycaller && prevPlaycaller.name
    ? ` · offense there was called by <b>${prevPlaycaller.name}</b>${Number.isFinite(prevPlaycaller.since)?` (since ${prevPlaycaller.since})`:''}`
    : '';
  // When the offensive source is a play-calling head coach, label it as such (the scheme
  // follows the HC, not the OC).
  const badge = c._fromHC ? 'New play-calling Head Coach'
    : (sideWord==='offensive' ? 'New Offensive Coordinator' : 'New Defensive Coordinator');
  const schemeOwner = c._fromHC ? 'play-calling head coach' : `${sideWord} coordinator`;
  return `<div class="coord-carry-block">
    <div class="coord-carry-title">
      <span class="coord-side">${badge}</span>
      <b>${c.name||'(name unavailable)'}</b> — ${roleNote}${playcallerHint}
    </div>
    <div class="coord-carry-sub">The tendencies &amp; personnel that travel with a ${schemeOwner} tend to follow them here \u2014 open ${from} to see their ${advTeamSeason()} ${sideWord} scheme.</div>
  </div>`;
}

// League-wide advanced view: pick a table, see all 32 teams, sortable by any column.
