// ─────────────────────────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────────────────────────
const SIDEBAR_DIVISIONS = [
  { title:'AFC North', teams:['CIN','PIT','BAL','CLE'] },
  { title:'AFC South', teams:['HOU','JAX','TEN','IND'] },
  { title:'AFC East',  teams:['BUF','NE','MIA','NYJ'] },
  { title:'AFC West',  teams:['KC','LAC','LV','DEN'] },
  { title:'NFC North', teams:['GB','DET','MIN','CHI'] },
  { title:'NFC South', teams:['TB','CAR','ATL','NO'] },
  { title:'NFC East',  teams:['PHI','DAL','WAS','NYG'] },
  { title:'NFC West',  teams:['LAR','SF','SEA','ARI'] },
];

const SIDEBAR_TEAM_LABEL = {
  CIN:'Bengals', PIT:'Steelers', BAL:'Ravens', CLE:'Browns',
  HOU:'Texans', JAX:'Jaguars', TEN:'Titans', IND:'Colts',
  BUF:'Bills', NE:'Patriots', MIA:'Dolphins', NYJ:'Jets',
  KC:'Chiefs', LAC:'Chargers', LV:'Raiders', DEN:'Broncos',
  GB:'Packers', DET:'Lions', MIN:'Vikings', CHI:'Bears',
  TB:'Buccaneers', CAR:'Panthers', ATL:'Atlanta', NO:'Saints',
  PHI:'Eagles', DAL:'Cowboys', WAS:'Commanders', NYG:'Giants',
  LAR:'Rams', SF:'49ers', SEA:'Seahawks', ARI:'Cardinals',
};

function sidebarTeamLabel(t){
  return SIDEBAR_TEAM_LABEL[t] || t;
}

let mobileTeamPickerExpanded = false;

function isMobileTeamPickerLayout(){
  return !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
}

function toggleMobileTeamPicker(){
  if(!isMobileTeamPickerLayout()) return;
  mobileTeamPickerExpanded = !mobileTeamPickerExpanded;
  renderSidebar();
}

function renderSidebar(){
  const sb=document.getElementById('sidebar');
  let done=0;
  const doneClass = t => {
    const st=userProj[t]; if(!st) return '';
    const a=st.qbs&&st.qbs[0]&&st.qbs[0].passing_yards>0;
    const b=!!st.passing_shares;const c=!!st.rushing.shares;
    if(a&&b&&c){ done++; return 'done'; }
    return (a||b||c) ? 'partial' : '';
  };

  const mkTeamItem = (t, cls) => `<div class="team-item ${t===currentTeam?'active':''}" onclick="selectTeam('${t}')">
    <img src="${NFL_LOGO(t)}" class="team-logo-sm" alt="${t}" onerror="this.style.display='none'">
    <div class="team-dot ${cls}"></div><span class="team-name">${sidebarTeamLabel(t)}</span></div>`;

  const conferences = [
    { title:'AFC', divisions:SIDEBAR_DIVISIONS.filter(d=>d.title.startsWith('AFC')) },
    { title:'NFC', divisions:SIDEBAR_DIVISIONS.filter(d=>d.title.startsWith('NFC')) },
  ];

  const groupsHtml = conferences.map(conf=>{
    const divisionHtml = conf.divisions.map(div=>{
      const teamsHtml = div.teams.map(t=>mkTeamItem(t, doneClass(t))).join('');
      return `<div class="sidebar-division-block">
        <div class="sidebar-section">${div.title}</div>
        <div class="sidebar-team-grid">${teamsHtml}</div>
      </div>`;
    }).join('');
    return `<div class="sidebar-conference-block">
      <div class="sidebar-conference-title">${conf.title}</div>
      <div class="sidebar-division-grid">${divisionHtml}</div>
    </div>`;
  }).join('');

  const mobile = isMobileTeamPickerLayout();
  const hasTeam = !!currentTeam;
  const selectedLabel = hasTeam ? `${sidebarTeamLabel(currentTeam)} (${currentTeam})` : 'Select Team';
  const chevron = mobileTeamPickerExpanded ? '▾' : '▸';
  const mobileToggle = `<button class="team-picker-toggle" onclick="toggleMobileTeamPicker()" aria-expanded="${mobileTeamPickerExpanded?'true':'false'}" title="Tap to ${mobileTeamPickerExpanded?'collapse':'expand'} team selector">
    <span class="team-picker-toggle-label">Teams: ${selectedLabel}</span>
    <span class="team-picker-toggle-icon">${chevron}</span>
  </button>`;

  const collapsedClass = (mobile && !mobileTeamPickerExpanded) ? 'mobile-collapsed' : '';
  const html = `${mobileToggle}<div class="sidebar-groups ${collapsedClass}">${groupsHtml}</div>`;

  sb.innerHTML=html;
  document.getElementById('progressText').textContent=`${done}/32 teams`;
  document.getElementById('progressFill').style.width=`${done/32*100}%`;
}

function selectTeam(t){
  currentTeam=t;
  // Keep whatever phase the user was on (Targets stays Targets across teams). Only the
  // global Rankings view falls back to a per-team phase since it isn't team-scoped here.
  if(currentPhase==='Rankings' && rankScope==='all') currentPhase='Receiving';
  // League-wide Advanced Metrics is a standalone view; selecting a team should return to
  // that team's Advanced tab instead of keeping the league table pinned on screen.
  if(currentPhase==='AdvancedLeague') currentPhase='Advanced';
  ensureTeam(t);
  // make sure shares exist so the targets/rushing tab is populated as if previously opened
  if(currentPhase==='Receiving') initPassingShares(t);
  else if(currentPhase==='Rushing') initRushingShares(t);
  if(isMobileTeamPickerLayout()) mobileTeamPickerExpanded=false;
  renderSidebar();renderContent();
}
function setPhase(p){
  // The per-team "Rankings" phase tab is team-scoped; the header 🏆 button is league-wide.
  if(p==='Rankings') rankScope='team';
  // The Advanced tab is per-team; if no team is selected, fall back to the league-wide view.
  if(p==='Advanced' && !currentTeam){ showSharpLeague(); return; }
  currentPhase=p;renderContent();
}
function showFullRankings(){ rankScope='all'; currentPhase='Rankings'; renderContent(); }

function showCurrentTeamAdvanced(){
  if(!currentTeam){ showSharpLeague(); return; }
  rankScope='team';
  currentPhase='Advanced';
  selectTeam(currentTeam);
}

function seasonHeadCoachName(team, season){
  const t = String(team || '').toUpperCase();
  const s = String(season || '');
  if(!t || !s || !NFLVERSE || !NFLVERSE[s] || !NFLVERSE[s].head_coaches) return '';
  return String(NFLVERSE[s].head_coaches[t] || '').trim();
}

function _teamLastName(name){
  const parts = String(name||'').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length-1] : String(name||'').trim();
}

function teamHeaderQbText(team, qbs, recStr){
  const list = Array.isArray(qbs) ? qbs.map(q=>String((q&&q.name)||'').trim()).filter(Boolean) : [];
  let txt = list.length ? list.join(' / ') : 'No projected QB';

  // Mobile compacting: replace trailing names with last names until the line fits better.
  const w = (typeof window!=='undefined' && window && Number.isFinite(window.innerWidth)) ? window.innerWidth : 9999;
  const maxChars = (w <= 420) ? 34 : (w <= 560 ? 42 : (w <= 820 ? 56 : 9999));
  if(list.length > 1 && txt.length > maxChars){
    const work = list.slice();
    for(let i=work.length-1; i>=1 && work.join(' / ').length > maxChars; i--){
      work[i] = _teamLastName(work[i]);
    }
    txt = work.join(' / ');
  }
  return txt + (recStr ? ` · ${recStr}` : '');
}

function teamHeaderHcLine(team, opts){
  const t = String(team || '').toUpperCase();
  const o = opts || {};
  const openTitle = String(o.openTitle || 'Open playbook');
  const openTitleEsc = escAttr(openTitle);
  const isRef = activeSeason !== 'proj';
  const histName = isRef ? seasonHeadCoachName(t, activeSeason) : '';
  if(histName){
    const callerName = (HC_PLAYCALLERS && HC_PLAYCALLERS[t]) ? String(HC_PLAYCALLERS[t]) : '';
    const callerMatch = callerName && callerName.toLowerCase() === histName.toLowerCase();
    return `<div class="team-hc scheme-open" role="button" tabindex="0" title="${openTitleEsc}" onclick="openTeamCoachingScheme('${t}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openTeamCoachingScheme('${t}');}">
      <span class="team-hc-label">HC ${activeSeason}</span> <b>${histName}</b>
      ${callerMatch?`<span class="hc-caller" title="This head coach is listed as the team's primary offensive playcaller.">🎧 Primary playcaller</span>`:''}
    </div>`;
  }

  if(headCoaches[t]===undefined) fetchHeadCoach(t);
  const hc=headCoaches[t];
  const hcCaller = hcIsPlaycaller(t);
  return hc ? `<div class="team-hc scheme-open" role="button" tabindex="0" title="${openTitleEsc}" onclick="openTeamCoachingScheme('${t}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openTeamCoachingScheme('${t}');}">
      ${hc.headshot?`<img src="${hc.headshot}" class="team-hc-img" onerror="this.style.display='none'">`:''}
      <span class="team-hc-label">HC</span> <b>${hc.name}</b>${hc.experience!=null?` · yr ${hc.experience}`:''}
      ${hcCaller?`<span class="hc-caller" title="This head coach is the team's primary offensive playcaller — the OC is less pivotal for scheme continuity.">🎧 Primary playcaller</span>`:''}
    </div>` : (headCoaches[t]===null?'':`<div class="team-hc team-hc-loading">Loading head coach…</div>`);
}

function renderContent(){
  // Single choke point for phase changes — keep view-specific chrome honest here.
  if(typeof syncAppChrome==='function') syncAppChrome();
  if(typeof ktcGameState!=='undefined' && ktcGameState && ktcGameState.active
    && !(currentPhase==='Rankings' && rankScope==='all')
    && typeof stopKtcGame==='function'){
    stopKtcGame();
  }
  if(currentPhase==='Rankings'){renderRankings();return;}
  if(currentPhase==='AdvancedLeague'){renderSharpLeague();return;}
  if(currentPhase==='League'){renderLeagueAnalyzer();return;}
  if(!currentTeam){document.getElementById('content').innerHTML=emptyHTML();return;}
  const t=currentTeam,state=userProj[t];
  const tabs=tabBar();
  let body='';
  if(currentPhase==='Passing') body=renderPassing(t,state);
  else if(currentPhase==='Receiving'){initPassingShares(t);body=renderReceiving(t,state);}
  else if(currentPhase==='Rushing'){initRushingShares(t);body=renderRushing(t,state);}
  else if(currentPhase==='Advanced') body=renderTeamAdvanced(t);
  else if(currentPhase==='Additions') body=renderTeamAdditions(t);
  const prev=TEAMS[TEAMS.indexOf(t)-1],next=TEAMS[TEAMS.indexOf(t)+1];
  const isRef = activeSeason!=='proj';
  const recKey = `${activeSeason}:${t}`;
  // In reference mode, fetch this team's record if we don't have it yet (covers switching
  // teams while already viewing a past season — not just entering the season first).
  if(isRef && espnRecordCache[recKey]==null) fetchTeamRecord(activeSeason,t);
  const recStr = isRef ? (espnRecordCache[recKey]||'') : '';
  const powerScoreBadge = (isRef && typeof _renderAdvPowerScore==='function' && typeof activeSharp==='function')
    ? _renderAdvPowerScore(t, activeSharp(), { shieldOnly:true })
    : '';
  const powerScoreInline = isRef
    ? `<div class="season-power">${powerScoreBadge}<span class="season-power-text">Power Score</span></div>`
    : '';
  const seasonBanner = isRef
    ? `<div class="season-readonly">
       <div class="season-readonly-main">${TC_ICON("calendar")} <b>${activeSeason} actual stats</b>${recStr?` · <b>${recStr}</b> Record`:''}</div>
       ${powerScoreInline}
       <div class="season-readonly-actions">
         ${canUndo(t)?`<button class="btn btn-ghost btn-sm" onclick="undoTeam('${t}')" title="Undo the last working-set change for ${t}">↶ Undo last copy</button>`:''}
         <button class="btn btn-accent btn-sm" onclick="copyTeamToWorking('${t}')">⤵ Copy</button>
       </div>
     </div>`
    : '';
  const sos = SOS && SOS[t];
  const sosBadge = sos ? `<span class="team-sos">SOS: <b>${ordinal(sos.rank)}</b>${sos.win_total!=null?` · Vegas Win Total: <b>${sos.win_total}</b>`:''}</span>` : '';
  const hcLine = teamHeaderHcLine(t, { openTitle: 'Open playbook' });
  document.getElementById('content').innerHTML=`
    <div class="team-header">
      <img src="${NFL_LOGO(t)}" class="team-logo-lg scheme-open" alt="${t}" title="Open playbook" onclick="openTeamCoachingScheme('${t}')" onerror="this.style.opacity='.25'">
      <div><div class="team-abbr team-fullname scheme-open" role="button" tabindex="0" title="Open playbook" onclick="openTeamCoachingScheme('${t}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openTeamCoachingScheme('${t}');}">${teamDisplayName(t)} ${isRef?`<span class="ref-year">${activeSeason}</span>`:''}</div>
        <div class="team-qb-name">${teamHeaderQbText(t, state.qbs, recStr)}</div>
        ${hcLine}
        ${sosBadge?`<div class="team-sos-row">${sosBadge}</div>`:''}</div>
      <div class="team-nav">
        <button id="undoBtn" class="btn btn-ghost undo-btn ${canUndo(t)?'':'disabled'}" ${canUndo(t)?'':'disabled'} onclick="undoTeam('${t}')" title="Undo last working-set change to ${t}">↶ ${isRef?'Undo':'Undo'}<span id="undoCount">${canUndo(t)?' '+undoStacks[t].length:''}</span></button>
        ${prev?`<button class="btn btn-ghost" onclick="selectTeam('${prev}')">← ${prev}</button>`:''}
        ${next?`<button class="btn btn-accent" onclick="selectTeam('${next}')">${next} →</button>`:''}
      </div>
    </div>
    ${seasonBanner}
    <div class="phase-tabs">${tabs}</div>${body}
    <div id="schemeOverlayHost"></div>`;
  if(currentPhase==='Receiving') initPie(t,'pass');
  else if(currentPhase==='Rushing') initPie(t,'rush');
  initSliders();
  updateUndoButton();
}
function tabBar(){
  const hasSharp = (typeof sharpHasData==='function' ? sharpHasData() : false) || (SOS && Object.keys(SOS).length>0);
  const tabs=[['Passing','Passing'],['Receiving','Receiving'],['Rushing','Rushing']];
  if(hasSharp) tabs.push(['Advanced','Adv Metrics']);
  // "Roster Changes" appears when the currently-selected team has Spotrac data.
  // "Roster" shows Spotrac offseason moves on the projection season, and the actual nflverse
  // roster for that year on any completed season — so it's available whenever either exists.
  if(currentTeam && ((ADDITIONS && ADDITIONS[currentTeam]) || nflverseRosterFor(currentTeam))) tabs.push(['Additions','Roster']);
  tabs.push(['Rankings','Rankings']);
  // Treat the league-wide advanced view as the same visual tab as the per-team one.
  const phaseForTab = (currentPhase==='AdvancedLeague') ? 'Advanced' : currentPhase;
  return tabs.map(([p,l])=>`<button class="phase-tab ${phaseForTab===p?'active':''}" onclick="setPhase('${p}')">${l}</button>`).join('');
}
function emptyHTML(){return`<div class="logo-icon-lg"><img src="images/app-icon.png" class="logo-icon-lg" alt="Centered Image"></div>
  <div class="empty-title">Select a team to begin</div>
  <div class="empty-body">Work through each team's QB output, receiver target &amp; TD share,
  and RB rushing distribution. Click Rankings any time to see fantasy scores.</div></div>`;}


