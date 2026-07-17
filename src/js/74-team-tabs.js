function renderTeamAdditions(team){
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
      <td class="add-num">${r.years!=null?r.years+' yr':'—'}</td>
      <td class="add-num add-val">${fmtMillions(r.value_m)}</td>
      <td class="add-num add-aav">${fmtMillions(r.aav_m)}</td>
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
      <td class="add-num add-val">${fmtMillions(r.cap_m)}</td>
      <td class="add-detail">${r.detail||'—'}</td>
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
      <td class="add-num">${r.years!=null?r.years+' yr':'—'}</td>
      <td class="add-num add-val add-loss-val">${fmtMillions(r.value_m)}</td>
      <td class="add-num add-aav">${fmtMillions(r.aav_m)}</td>
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
    ? `class="coord-inline scheme-open" role="button" tabindex="0" title="Open coaching scheme visualization" onclick="openTeamCoachingScheme('${team}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openTeamCoachingScheme('${team}');}"`
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

function renderTeamAdvanced(team){
  const hasSharp=sharpHasData(), hasSOS=SOS&&Object.keys(SOS).length>0;
  const hasCoord = COORDINATORS && COORDINATORS[team];
  if(!hasSharp && !hasSOS && !hasCoord){
    return `<div class="empty"><div class="empty-icon">📊</div>
      <div class="empty-title">No advanced stats loaded</div>
      <div class="empty-body">Run <code>build_seed.py</code> and load the 📦 seed to populate advanced team stats.</div></div>`;
  }
  const SRC=activeSharp();
  const cardFor=(key, srcTeam)=>{
    const tbl=SRC[key]; if(!tbl) return '';
    const useTeam = srcTeam||team;
    const row=tbl.teams&&tbl.teams[useTeam];
    if(!row) return `<div class="sr-card"><div class="sr-card-title">${tbl.title||key}</div>
      <div class="sr-empty">No data for ${teamDisplayName(useTeam)}</div></div>`;
    const lines = tbl.columns.map(col=>{
      const v=row.values?row.values[col]:null;
      const r=row.ranks?row.ranks[col]:null;
      return `<div class="sr-stat">
        <div class="sr-stat-label">${col}</div>
        <div class="sr-stat-val">${fmtSharpVal(v, sharpColIsPct(tbl,col))}</div>
        <div class="sr-stat-rank">${sharpRankBadge(r)}</div>
      </div>`;
    }).join('');
    return `<div class="sr-card">
      <div class="sr-card-title">${tbl.title||key}</div>
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
  const sos=SOS && SOS[team];
  const sosStrip = sos ? `<div class="sr-sos-strip">
    <span class="sr-sos-rank ${sharpRankClass(sos.rank)}">${ordinal(sos.rank)}</span>
    <div><div class="sr-sos-label">${PROJ_SEASON} Strength of Schedule</div>
      <div class="sr-sos-sub">${sos.win_total!=null?`Vegas win total <b>${sos.win_total}</b> · `:''}rank ${sos.rank} of 32 (1 = easiest)</div></div>
    <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="showSharpLeague('sos')">See SOS chart →</button>
  </div>` : '';
  // Carryover coordinators → a highlighted section that pulls the former team's scheme stats.
  const carryBlock = renderCoordinatorCarryover(team, cardFor);
  const srcLabel = 'nflverse (computed from play-by-play)';
  return `<div class="sr-team-wrap">
    <div class="sr-note">📊 <b>Advanced team stats</b> · ${srcLabel} · <b>${advTeamSeason()} season</b> · league rank out of 32 · read-only reference to inform your ${PROJ_SEASON} decisions.
      <button class="btn btn-ghost btn-sm" style="margin-left:6px" onclick="showSharpLeague()">🌐 View league-wide tables →</button></div>
    ${sosStrip}
    ${carryBlock}
    ${section('Offense', offKeys, coordInlineLabel(team,oc,'offensive'))}
    ${section('Defense', defKeys, coordInlineLabel(team,dc,'defensive'))}
    <div class="sr-source">${advTeamSeason()} season · computed from nflverse play-by-play (nflfastR) — for informational use.</div>
  </div>`;
}

// The Coordinators carryover block: when a NEW coordinator came from another NFL team, show
// their former team's carry-over scheme stats (tendencies + personnel for OC; tendencies +
// coverage for DC — the aspects that travel with a coordinator), clearly labeled.
function renderCoordinatorCarryover(team, cardFor){
  const SRC=activeSharp();
  const oc=coordFor(team,'offense'), dc=coordFor(team,'defense');
  const blocks=[];
  // OFFENSE: when the head coach is the primary playcaller and is new-from-another-team, the
  // scheme travels with the HC → carry over the HC's former team. Otherwise use the OC.
  const hcSrc = playcallerHCOffenseSource(team);
  const offSrc = hcSrc || (coordCarriesOver(oc) ? oc : null);
  if(offSrc){
    // Offensive scheme travels most in tendencies + personnel.
    const wantTitles=['Tendencies','Personnel'];
    const ks=Object.keys(SRC).filter(k=>(SRC[k].category||'offense')==='offense'
      && wantTitles.some(w=>(SRC[k].title||'').toLowerCase().includes(w.toLowerCase())));
    blocks.push(coordCarryCard('offensive', offSrc, ks, cardFor));
  }
  if(coordCarriesOver(dc)){
    // Defensive scheme travels most in tendencies + coverage SCHEMES (not the
    // coverage-by-position table, which is more about personnel matchups than scheme).
    const wantTitles=['Tendencies','Coverage'];
    const ks=Object.keys(SRC).filter(k=>{
      if(SRC[k].category!=='defense') return false;
      const title=(SRC[k].title||'').toLowerCase();
      if(title.includes('by position')) return false;   // exclude Coverage by Position
      return wantTitles.some(w=>title.includes(w.toLowerCase()));
    });
    blocks.push(coordCarryCard('defensive', dc, ks, cardFor));
  }
  if(!blocks.length) return '';
  return `<div class="coord-carry-wrap">
    <div class="coord-carry-head">🔄 New coordinator scheme carryover</div>
    <div class="coord-carry-note">A brand-new coordinator arrived for ${PROJ_SEASON}. Below are their <b>former team's</b> ${advTeamSeason()} scheme stats — the tendencies &amp; personnel that tend to travel with a coordinator. Use as a forecast for how this unit may shift.</div>
    ${blocks.join('')}
  </div>`;
}
function coordCarryCard(sideWord, c, ks, cardFor){
  const SRC=activeSharp();
  const from = teamDisplayName(c.prev_code);
  const roleNote = c.prev_role
    ? `previously <b>${from} ${c.prev_role}</b>${c.prev_years?` (${c.prev_years})`:''}`
    : `previously with <b>${from}</b>`;
  const cards = ks.length ? ks.map(k=>cardFor(k, c.prev_code)).join('')
    : `<div class="sr-empty">No carry-over tables available for ${from}.</div>`;
  // When the offensive source is a play-calling head coach, label it as such (the scheme
  // follows the HC, not the OC).
  const badge = c._fromHC ? 'New play-calling Head Coach'
    : (sideWord==='offensive' ? 'New Offensive Coordinator' : 'New Defensive Coordinator');
  const schemeOwner = c._fromHC ? 'play-calling head coach' : `${sideWord} coordinator`;
  return `<div class="coord-carry-block">
    <div class="coord-carry-title">
      <span class="coord-side">${badge}</span>
      <b>${c.name||'(name unavailable)'}</b> — ${roleNote}
    </div>
    <div class="coord-carry-sub">Showing ${from}'s ${advTeamSeason()} ${sideWord} scheme (${ks.map(k=>SRC[k].title).join(' · ')||'—'}) — the tendencies &amp; personnel that travel with a ${schemeOwner}:</div>
    <div class="sr-card-grid">${cards}</div>
  </div>`;
}

// League-wide advanced view: pick a table, see all 32 teams, sortable by any column.
