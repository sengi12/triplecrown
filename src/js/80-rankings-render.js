function renderRankings(){
  let all=buildPlayerList();
  // Team-scoped rankings (from a team's Rankings tab) show only that team's players.
  const teamScoped = (rankScope==='team' && currentTeam);
  if(teamScoped) all=all.filter(p=>p.team===currentTeam);
  if(!all.length){document.getElementById('content').innerHTML=
    `<div class="phase-tabs">${tabBar()}</div><div class="empty"><div class="empty-icon">🏆</div>
     <div class="empty-title">No projections yet</div><div class="empty-body">Set at least one team's stats to see rankings.</div></div>`;return;}
  // Overall order is by fantasy points (your projections). ECR/tier come from FantasyPros.
  all.sort((a,b)=>b.fpts-a.fpts);
  all.forEach((p,i)=>{ p.overall=i+1; });
  // live draft: mark drafted players
  const following = !!draftId;
  all.forEach(p=>{ p.drafted = following && !!draftedIds[p.player_id]; });
  let view=rankPosFilter==='ALL'?all
    :rankPosFilter==='FLEX'?all.filter(p=>p.pos!=='QB')
    :all.filter(p=>p.pos===rankPosFilter);
  if(following && hideDrafted) view=view.filter(p=>!p.drafted);
  view=[...view].sort((a,b)=>{
    if(rankSortKey==='ecr'){
      // Unranked players sort to the bottom regardless of direction.
      const av=a.ecr==null?99999:a.ecr, bv=b.ecr==null?99999:b.ecr;
      return (av-bv)*(rankSortDir<0?1:-1);
    }
    if(rankSortKey==='name') return a.name.localeCompare(b.name)*(rankSortDir<0?1:-1);
    if(rankSortKey==='team') return a.team.localeCompare(b.team)*(rankSortDir<0?1:-1);
    if(rankSortKey==='pos') return (({QB:1,RB:2,WR:3,TE:4})[a.pos]-({QB:1,RB:2,WR:3,TE:4})[b.pos])*(rankSortDir<0?1:-1)||b.fpts-a.fpts;
    // Contract columns: players with no contract data always sort to the bottom.
    if(rankSortKey==='age'||rankSortKey==='apy'||rankSortKey==='fa'){
      const av=a[rankSortKey], bv=b[rankSortKey];
      if(av==null && bv==null) return b.fpts-a.fpts;
      if(av==null) return 1;
      if(bv==null) return -1;
      return (av-bv)*(rankSortDir<0?1:-1);
    }
    // SumerSports advanced columns (key "sumer:<label>"): players missing that stat sink.
    if(rankSortKey.startsWith('sumer:')){
      const label=rankSortKey.slice(6);
      const av=sumerValue(a,label), bv=sumerValue(b,label);
      const an=(typeof av==='number'), bn=(typeof bv==='number');
      if(!an && !bn) return b.fpts-a.fpts;
      if(!an) return 1;
      if(!bn) return -1;
      return (bv-av)*(rankSortDir<0?1:-1);   // default high→low
    }
    return ((b[rankSortKey]||0)-(a[rankSortKey]||0))*(rankSortDir<0?1:-1);
  });
  const tierC=['','var(--accent)','var(--info)','var(--warn)','var(--danger)','var(--muted)','#8b7cff','#6ad1c4'];
  const tierColor=t=>t?tierC[Math.min(t,7)]:'var(--border)';
  // Two-line header helper. `grp` adds a left border to mark a stat group's start.
  const th=(k,l1,l2,cls,grp)=>{const a=rankSortKey===k;
    return `<th onclick="rankSort('${k}')" class="${cls||''} ${grp?'grp-start':''}" style="${a?'color:var(--accent)':''}">
      <div class="th-stack">${l1}${l2?`<br>${l2}`:''}${a?(rankSortDir<0?' ↓':' ↑'):''}</div></th>`;};
  // Dynasty tab only: three extra columns (Age / APY / Free-Agency year) right after TM.
  // FA is highlighted red when it's the very next season (contracts expiring soonest).
  const isDynasty = rankFormat==='dynasty' || rankFormat==='dynasty_superflex';
  const nextYear = PROJ_SEASON + 1;
  // Advanced (SumerSports) view: reference-season only. When active, the rush/rec/pass stat
  // columns are replaced by this season's Sumer metrics for the selected position (or the
  // columns common to the positions in view for ALL/FLEX). Falls back to standard silently
  // if there's no usable column set.
  // Situational split is only meaningful on the Adv. Metrics view; drop a stale selection that
  // the current season/position no longer offers so the table + dropdown stay in sync.
  if(rankAdvanced && sumerRefinement && !sumerRefinementsForFilter().includes(sumerRefinement)) sumerRefinement=null;
  const sumerView = (rankAdvanced && sumerAvailable()) ? sumerColumnsForFilter() : null;
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
  // Projected-pick lines: when following a draft with a known seat and the board is in draft
  // order (sorted by ECR). This is *especially* useful with "hide drafted" on, since the board
  // then shows only available players and the line marks exactly how far down your pick lands.
  const inDraftOrder = rankSortKey==='ecr';
  const showPickLines = following && mySlot!=null && inDraftOrder;
  let pickGaps=[];   // successive counts of players between your turns
  if(showPickLines){
    const { teams, type, reversalRound, rounds } = draftParams();
    const start = currentPickNo();
    const maxPick = teams*rounds;
    // gaps: from now, how many other picks between each of your turns
    let prev=start-1;
    for(let n=start; n<=maxPick; n++){
      if(slotOnClock(n, teams, type, reversalRound)===mySlot){
        pickGaps.push(n-prev-1);   // players taken by others before this, your turn
        prev=n;
        if(pickGaps.length>=rounds) break;
      }
    }
  }
  const totalCols = 7 + (isDynasty?3:0) + nStatCols;  // ecr,tier,fpts,vor,pos,name,tm + stat cols
  const pickLineRow=(round)=>`<tr class="rank-pickline"><td colspan="${totalCols}">
    <span class="rank-pickline-lbl">▸ Your pick ${round==1?'(next up)':`#${round}`} projected here</span></td></tr>`;

  let undraftedSeen=0, nextGapIdx=0, gapRemaining=(pickGaps[0]!=null?pickGaps[0]:-1);
  const rowChunks=[];
  view.forEach(p=>{
    // emit a pick line right before the player who'd fall to your pick
    if(showPickLines && nextGapIdx<pickGaps.length && !p.drafted && undraftedSeen===gapRemaining){
      rowChunks.push(pickLineRow(nextGapIdx+1));
      nextGapIdx++;
      undraftedSeen=0;
      gapRemaining=(pickGaps[nextGapIdx]!=null?pickGaps[nextGapIdx]:-1);
    }
    const ecrTxt = p.ecr!=null ? p.ecr : '—';
    const tier = p.ecr_tier;
    const ypc = p.ypc>0 ? p.ypc.toFixed(1) : '';
    let contractCells='';
    if(isDynasty){
      const ageTxt = p.age!=null ? p.age : '';
      const apyTxt = p.apy!=null ? fmtAPY(p.apy) : '';
      const faTxt = p.fa!=null ? p.fa : '';
      const faSoon = p.fa!=null && p.fa===nextYear;   // hits free agency next season
      contractCells =
        `<td class="c-age">${ageTxt?`<span class="num">${ageTxt}</span>`:''}</td>`+
        `<td class="c-apy">${apyTxt?`<span class="num">${apyTxt}</span>`:''}</td>`+
        `<td class="c-fa ${faSoon?'fa-soon':''}">${faTxt?`<span class="num">${faTxt}</span>`:''}</td>`;
    }
    // Stat cells: standard rush/rec/pass groups, or SumerSports advanced columns when active.
    let statCells;
    if(advActive){
      statCells = sumerView.cols.map((label,ci)=>{
        const v=sumerValue(p,label);
        const isPct=sumerView.pct.has(label);
        return `<td class="grp-adv${ci===0?' grp-start':''}">${v==null?'':`<span class="num">${fmtSumer(v,isPct)}</span>`}</td>`;
      }).join('');
    } else {
      statCells =
        `<td class="grp-rush">${cell(p.rushing_attempts)}</td><td class="grp-rush-mid">${cell(p.rushing_yards)}</td><td class="grp-rush-mid">${ypc?`<span class="num">${ypc}</span>`:''}</td><td class="grp-rush-end">${cell(p.rushing_tds)}</td>`+
        `<td class="grp-rec">${cell(p.receiving_targets)}</td><td class="grp-rec-mid">${cell(p.receptions)}</td><td class="grp-rec-mid">${cell(p.receiving_yards)}</td><td class="grp-rec-end">${cell(p.receiving_tds)}</td>`+
        `<td class="grp-pass">${cell(p.passing_attempts)}</td><td class="grp-pass-mid">${cell(p.passing_yards)}</td><td class="grp-pass-mid">${cell(p.passing_tds)}</td><td class="grp-pass-end">${cell(p.interceptions_thrown)}</td>`;
    }
    rowChunks.push(`<tr class="${p.drafted?'drafted':''}">
    <td class="c-ecr">${ecrTxt}</td>
    <td class="c-tier">${tier!=null?`<span class="tier-pill" style="background:${tierColor(tier)}">${tier}</span>`:''}</td>
    <td class="fpts">${p.fpts.toFixed(1)}</td>
    <td class="c-vor"><span class="vor-val ${p.vor>0?'vor-pos':p.vor<0?'vor-neg':''}">${p.vor>0?'+':''}${p.vor!=null?p.vor.toFixed(1):'—'}</span></td>
    <td><span class="pos-badge pos-${p.pos}">${p.pos}</span></td>
    <td class="c-player"><div class="clickable-player" style="display:flex;align-items:center;gap:6px" onclick="${pcardOnclick(p.player_id||p.name, p.pos, p.team||'')}">${imgTag(hsURL(p),'rank-hs','🏈')}<span class="rank-name">${p.name}</span></div></td>
    <td class="c-team"><img src="${NFL_LOGO(p.team)}" class="rank-logo" onerror="this.style.display='none'"> ${p.team}</td>
    ${contractCells}
    ${statCells}
  </tr>`);
    if(!p.drafted) undraftedSeen++;
  });
  const rows=rowChunks.join('');
  // Two-axis format picker: league TYPE (redraft/dynasty) + SCORING (std/half/full/superflex).
  const curType=leagueTypeOf(rankFormat);
  const curScoring=scoringAxis;   // source of truth for the scoring buttons (independent of rankFormat)
  const typeBtns=[['redraft','Re-Draft'],['dynasty','Dynasty']]
    .map(([t,l])=>`<button class="ltype-btn ${curType===t?'active':''}" onclick="setLeagueType('${t}')">${l}</button>`).join('');
  const scoringList=[['std','Standard'],['half_ppr','Half PPR'],['ppr','Full PPR'],['superflex','Superflex']];
  const fmtBtns=scoringList
    .map(([s,l])=>`<button class="format-btn ${curScoring===s?'active':''}" onclick="setScoringAxis('${s}')">${l}</button>`).join('');
  const posBtns=['ALL','QB','RB','WR','TE','FLEX'].map(pos=>
    `<button class="pos-filter-btn ${rankPosFilter===pos?'active':''}" onclick="setPosFilter('${pos}')">${pos}</button>`).join('');
  // Advanced-metrics toggle — only on a reference season nflverse has player data for
  // (2022-2025). Switches the stat columns to advanced per-player metrics (computed from
  // nflverse play-by-play; SumerSports was retired as a source).
  const sumerOn = sumerAvailable();
  const advToggle = sumerOn
    ? `<span style="font-size:11px;color:var(--muted);font-weight:700;margin-left:8px">STATS</span>
       <div class="format-toggle">
         <button class="format-btn ${!rankAdvanced?'active':''}" onclick="setRankAdvanced(false)">Standard</button>
         <button class="format-btn ${rankAdvanced?'active':''}" onclick="setRankAdvanced(true)" title="nflverse advanced ${sumerSeasonKey()} metrics">Adv. Metrics</button>
       </div>`
    : '';
  const minInputs = advActive ? sumerMinInputs() : '';
  // "Situational" dropdown — Adv. Metrics only. Swaps the stat columns to a game-situation
  // split (Red Zone / When Trailing / vs. Man / per-down / box counts …) for the season.
  const refineOpts = advActive ? sumerRefinementsForFilter() : [];
  const situationalSelect = (advActive && refineOpts.length)
    ? `<span style="font-size:11px;color:var(--muted);font-weight:700;margin-left:8px">SITUATIONAL</span>
       <select class="sumer-situational" onchange="setSumerRefinement(this.value)" title="Filter Adv. Metrics by game situation">
         <option value=""${!sumerRefinement?' selected':''}>Standard</option>
         ${refineOpts.map(r=>`<option value="${r}"${sumerRefinement===r?' selected':''}>${SUMER_REFINE_LABELS[r]||r}</option>`).join('')}
       </select>`
    : '';
  const advNote = advActive
    ? `<span class="ecr-missing" style="color:var(--muted)">📊 nflverse advanced ${sumerSeasonKey()} stats${sumerRefinement?` · ${SUMER_REFINE_LABELS[sumerRefinement]||sumerRefinement}`:''}${sumerView.single?'':' · common columns (pick a position for the full set)'}${((sumerRefinement==='vs_man'||sumerRefinement==='vs_zone'))?' · coverage counts approximate, rates accurate':''}</span>`
    : '';
  const ecrNote = hasECR() ? '' : `<span class="ecr-missing">⚠ No FantasyPros ECR loaded — run build_seed.py and load the 📦 seed to populate ECR/Tier</span>`;
  document.getElementById('content').innerHTML=`
    <div class="phase-tabs">${tabBar()}</div>
    <div class="rankings-scope-bar">
      ${teamScoped
        ? `<span class="scope-title">🏆 ${currentTeam} Rankings</span><span class="scope-sub">this team only</span>
           <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="showFullRankings()">View full league →</button>`
        : `<span class="scope-title">🏆 Full League Rankings</span><span class="scope-sub">all ${all.length} players</span>`}
    </div>
    <div class="card" style="margin-bottom:12px">
      <div class="card-title" style="margin-bottom:10px">Scoring Settings
        <button class="btn btn-accent btn-sm" style="margin-left:auto" onclick="recalcRankings()">Recalculate</button></div>
      <div class="scoring-grid">
        <div class="scoring-field"><label>PASS YDS / POINT</label><input id="sc_pass_yds_ydg" type="number" value="${scoringSettings.passing_yards_yardage}" step="1"></div>
        <div class="scoring-field"><label>PASS TD PTS</label><input id="sc_pass_td" type="number" value="${scoringSettings.passing_touchdowns}" step="0.5"></div>
        <div class="scoring-field"><label>INT PTS</label><input id="sc_int" type="number" value="${scoringSettings.interceptions_thrown}" step="0.5"></div>
        <div class="scoring-field"><label>RUSH YDS / POINT</label><input id="sc_rush_yds_ydg" type="number" value="${scoringSettings.rushing_yards_yardage}" step="1"></div>
        <div class="scoring-field"><label>RUSH TD PTS</label><input id="sc_rush_td" type="number" value="${scoringSettings.rushing_touchdowns}" step="0.5"></div>
        <div class="scoring-field"><label>REC YDS / POINT</label><input id="sc_rec_yds_ydg" type="number" value="${scoringSettings.receiving_yards_yardage}" step="1"></div>
        <div class="scoring-field"><label>REC TD PTS</label><input id="sc_rec_td" type="number" value="${scoringSettings.receiving_touchdowns}" step="0.5"></div>
        <div class="scoring-field"><label>RECEPTION PTS (PPR)</label><input id="sc_rec" type="number" value="${scoringSettings.receptions}" step="0.25"></div>
        <div class="scoring-field"><label>FUMBLE LOST PTS</label><input id="sc_fum" type="number" value="${scoringSettings.fumbles_lost}" step="0.5"></div>
        <div class="scoring-field"><label>PASS ATT PTS</label><input id="sc_pass_att" type="number" value="${scoringSettings.passing_attempts}" step="0.1"></div>
        <div class="scoring-field"><label>PASS COMP PTS</label><input id="sc_pass_comp" type="number" value="${scoringSettings.passing_completions}" step="0.1"></div>
        <div class="scoring-field"><label>RUSH ATT PTS</label><input id="sc_rush_att" type="number" value="${scoringSettings.rushing_attempts}" step="0.1"></div>
      </div>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      ${following ? `<div style="padding:8px 14px;border-bottom:1px solid var(--border)">
        <div class="draft-banner">
          <span class="draft-live">LIVE</span>
          <span>Following draft <b>${draftId}</b> · ${Object.keys(draftedIds).length} picks made</span>
          ${(mySlot!=null)?(()=>{const u=picksUntilMyTurn(mySlot);return u===0?`<span class="draft-onclock">★ YOU'RE ON THE CLOCK</span>`:u!=null?`<span class="draft-upturn">seat ${mySlot} · ${u} pick${u===1?'':'s'} until you're up</span>`:`<span class="draft-upturn">seat ${mySlot}</span>`;})():`<span class="draft-upturn">tap your seat in the bar below ↓</span>`}
          <label style="display:flex;align-items:center;gap:5px;cursor:pointer;margin-left:8px">
            <input type="checkbox" ${hideDrafted?'checked':''} onchange="toggleHideDrafted()"> hide drafted</label>
          <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="stopDraftFollow()">Stop</button>
        </div></div>` : ''}
      ${(!following && leaguePickerState.open) ? renderLeaguePicker() : ''}
      <div style="padding:11px 14px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border);flex-wrap:wrap">
        <span style="font-size:11px;color:var(--muted);font-weight:700">LEAGUE</span>
        <div class="ltype-toggle">${typeBtns}</div>
        <span style="font-size:11px;color:var(--muted);font-weight:700;margin-left:8px">SCORING (ECR)</span>
        <div class="format-toggle">${fmtBtns}</div>
        <span style="font-size:11px;color:var(--muted);font-weight:700;margin-left:8px">POSITION</span>
        <div class="pos-filter">${posBtns}</div>
        ${advToggle}
        ${situationalSelect}
        ${minInputs}
        ${advNote}
        ${ecrNote}
        <span style="font-size:11px;font-weight:700;margin-left:auto">${view.length} players</span>
        ${following?'':`<button class="btn btn-accent btn-sm" onclick="openLeaguePicker()">🔗 Link Sleeper League</button>
        <button class="btn btn-ghost btn-sm" onclick="promptDraftFollow()" title="Follow a live or mock draft by its ID">Paste draft ID</button>`}
        <button class="btn btn-ghost btn-sm" onclick="exportRankingsCSV()">⬇ CSV</button>
      </div>
      <div class="rank-table-wrap" style="max-height:calc(100vh - 320px)">
      <table class="rankings-table grouped"><thead><tr>
        ${th('ecr','ECR','','c-ecr')}${th('ecr_tier','TIER','','c-tier')}${th('fpts','FPTS','')}${th('vor','VOR','','c-vor')}
        ${th('pos','POS','')}${th('name','PLAYER','','c-player')}${th('team','TM','','c-team')}
        ${isDynasty?`${th('age','AGE','','c-age',true)}${th('apy','APY','','c-apy')}${th('fa','FA','','c-fa')}`:''}
        ${advActive
          ? sumerView.cols.map((label,ci)=>{const key='sumer:'+label;const on=rankSortKey===key;
              return `<th onclick="rankSort('sumer:${label.replace(/'/g,"\\'")}')" class="grp-adv${ci===0?' grp-start':''}" style="${on?'color:var(--accent)':''}" title="${label}"><div class="th-stack">${sumerHead(label)}${on?(rankSortDir<0?' ↓':' ↑'):''}</div></th>`;}).join('')
          : `${th('rushing_attempts','RUSH','ATT','grp-rush',true)}${th('rushing_yards','RUSH','YDS','grp-rush-mid')}${th('ypc','YPC','','grp-rush-mid')}${th('rushing_tds','RUSH','TDS','grp-rush-end')}
        ${th('receiving_targets','TGTS','','grp-rec',true)}${th('receptions','REC','','grp-rec-mid')}${th('receiving_yards','REC','YDS','grp-rec-mid')}${th('receiving_tds','REC','TDS','grp-rec-end')}
        ${th('passing_attempts','PASS','ATT','grp-pass',true)}${th('passing_yards','PASS','YDS','grp-pass-mid')}${th('passing_tds','PASS','TDS','grp-pass-mid')}${th('interceptions_thrown','PASS','INTS','grp-pass-end')}`}
      </tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
}
function cell(v){return v&&v>0?`<span class="num">${(+v)%1!==0?(+v).toFixed(1):(+v).toLocaleString()}</span>`:'';}
function rankSort(k){if(rankSortKey===k)rankSortDir*=-1;else{rankSortKey=k;rankSortDir=k==='ecr'?-1:-1;}renderRankings();}
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
  renderRankings();
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
  renderRankings();
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
function setPosFilter(p){rankPosFilter=p;renderRankings();}
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
  renderRankings();
}
// Select a "Situational" refinement (game-situation split) for the Adv. Metrics view. Empty
// value = Standard (overall). Re-sort onto the first column so the board reflects the split.
function setSumerRefinement(val){
  sumerRefinement = val || null;
  const sv=sumerColumnsForFilter();
  if(sv) { rankSortKey='sumer:'+sv.cols[0]; rankSortDir=-1; }
  renderRankings();
}
// Build the minimum-volume input(s) for the Adv. Metrics view, matched to the position filter:
// QB → Min Plays, WR/TE → Min Routes, RB → Min Rushes. ALL/FLEX show each relevant one.
function sumerMinInputs(){
  const mk=(bucket,label)=>`<label style="font-size:11px;color:var(--muted);font-weight:700;display:inline-flex;align-items:center;gap:4px">${label}
    <input type="number" min="0" step="10" value="${sumerMin[bucket]||0}" onchange="setSumerMin('${bucket}',this.value)"
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
function setSumerMin(bucket, val){
  const n=parseInt(val,10);
  sumerMin[bucket] = (isNaN(n)||n<0) ? 0 : n;
  renderRankings();
}
function recalcRankings(){
  const g=(id,d)=>{const v=parseFloat(document.getElementById(id).value);return isNaN(v)?d:v;};
  scoringSettings.passing_yards_yardage=g('sc_pass_yds_ydg',25)||25;
  scoringSettings.passing_touchdowns=g('sc_pass_td',6);
  scoringSettings.interceptions_thrown=g('sc_int',-2);
  scoringSettings.rushing_yards_yardage=g('sc_rush_yds_ydg',10)||10;
  scoringSettings.rushing_touchdowns=g('sc_rush_td',6);
  scoringSettings.receiving_yards_yardage=g('sc_rec_yds_ydg',10)||10;
  scoringSettings.receiving_touchdowns=g('sc_rec_td',6);
  scoringSettings.receptions=g('sc_rec',0.5);
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
  const keys=['ecr','tier','fpts','pos','name','team',
    ...(dyn?['age','apy','fa']:[]),
    'rushing_attempts','rushing_yards','ypc','rushing_tds',
    'receiving_targets','receptions','receiving_yards','receiving_tds',
    'passing_attempts','passing_yards','passing_tds','interceptions_thrown'];
  const csv=[keys.join(','),...all.map(p=>[
    p.ecr!=null?p.ecr:'', p.ecr_tier!=null?p.ecr_tier:'', p.fpts.toFixed(1), p.pos, p.name, p.team,
    ...(dyn?[p.age!=null?p.age:'', p.apy!=null?p.apy:'', p.fa!=null?p.fa:'']:[]),
    p.rushing_attempts, p.rushing_yards, p.ypc>0?p.ypc.toFixed(1):'', p.rushing_tds,
    p.receiving_targets, p.receptions, p.receiving_yards, p.receiving_tds,
    p.passing_attempts, p.passing_yards, p.passing_tds, p.interceptions_thrown
  ].join(','))].join('\n');
  dlFile(csv,'rankings.csv','text/csv');toast('Rankings exported ✓','ok');
}


// ─────────────────────────────────────────────────────────────────────────────
