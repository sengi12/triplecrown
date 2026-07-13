// ─────────────────────────────────────────────────────────────────────────────
// Team coaching scheme modal (nflverse)
// ─────────────────────────────────────────────────────────────────────────────
let schemeOverlayOpen = false;
let schemeTeam = null;
let _schemeEscBound = false;
const _SCHEME_SCRIPT_OPEN = '<scr' + 'ipt>';
const _SCHEME_SCRIPT_CLOSE = '</scr' + 'ipt>';

function _schemePayload(team){
  if(!team || !NFLVERSE) return null;
  const keys = Object.keys(NFLVERSE).map(x=>parseInt(x,10)).filter(Number.isFinite).sort((a,b)=>b-a);
  const pref = [];
  if(Number.isFinite(parseInt(SHARP_SEASON,10))) pref.push(String(parseInt(SHARP_SEASON,10)));
  if(activeSeason!=='proj' && Number.isFinite(parseInt(activeSeason,10))) pref.push(String(parseInt(activeSeason,10)));
  const seen = new Set();
  const order = pref.concat(keys.map(String)).filter(s=>{ if(seen.has(s)) return false; seen.add(s); return true; });
  for(const s of order){
    const block = NFLVERSE[s] && NFLVERSE[s].coaching_scheme && NFLVERSE[s].coaching_scheme[team];
    if(block && block.views) return {season:s, data:block};
  }
  return null;
}

function _schemeNumber(v, d){
  return (v==null || Number.isNaN(Number(v))) ? d : Number(v);
}

function _schemeRunSide(lanes){
  if(!lanes || !lanes.length || !lanes[0] || !lanes[0][0]) return 'mid';
  const lane = String(lanes[0][0]);
  if(lane[0]==='L') return 'left';
  if(lane[0]==='R') return 'right';
  return 'mid';
}

function _schemeToGroup(g){
  if(!g) return null;
  const lanes = Array.isArray(g.lanes) ? g.lanes : [];
  const assigns = Array.isArray(g.assigns) ? g.assigns : [];
  return {
    p: String(g.p||''),
    align: String(g.align||'gun'),
    name: String(g.name||g.p||'FORMATION'),
    backs: _schemeNumber(g.backs, 0),
    te: _schemeNumber(g.te, 0),
    wr: _schemeNumber(g.wr, 0),
    ol: _schemeNumber(g.ol, 5),
    n: _schemeNumber(g.n, 0),
    share: _schemeNumber(g.share, 0),
    pass_rate: _schemeNumber(g.pass_rate, 0),
    epa: _schemeNumber(g.epa, 0),
    succ: _schemeNumber(g.succ, 0),
    np: _schemeNumber(g.np, 0),
    sp: _schemeNumber(g.sp, 0),
    ep: _schemeNumber(g.ep, 0),
    nr: _schemeNumber(g.nr, 0),
    sr: _schemeNumber(g.sr, 0),
    er: _schemeNumber(g.er, 0),
    assigns: assigns.map(a=>({
      role: String(((a&&a.slot)||'').replace(/\d+/g,'')||'WR'),
      slot: String((a&&a.slot)||''),
      name: String((a&&a.name)||'—'),
      routes: Array.isArray(a&&a.routes) ? a.routes : [],
      src: 'form',
    })),
    lanes: lanes,
    ltot: lanes.reduce((t,l)=>t+_schemeNumber(l&&l[1],0),0),
    run_side: _schemeRunSide(lanes),
  };
}

function _schemeNode(view){
  const v = view || {total:0,groups:[]};
  const groups = (Array.isArray(v.groups) ? v.groups : []).map(_schemeToGroup).filter(Boolean);
  const total = _schemeNumber(v.total, groups.reduce((t,g)=>t+_schemeNumber(g.n,0),0));
  return {total, groups};
}

function _schemeEmptyNode(){ return {total:0, groups:[]}; }

function _schemeBuildFv(p){
  const views = (p && p.data && p.data.views) ? p.data.views : {};
  const all = _schemeNode(views.all);
  const pa = _schemeNode(views.pa);
  const motion = _schemeNode(views.motion);
  const nohuddle = _schemeNode(views.nohuddle);
  const d1 = _schemeNode(views.down1);
  const d2 = _schemeNode(views.down2);
  const d3 = _schemeNode(views.down3);
  const d4 = _schemeNode(views.down4);
  const e = _schemeEmptyNode();

  function downBlock(main){
    return {
      all:{all:main, pa:e, motion:e, nohuddle:e},
      short:{all:e, pa:e, motion:e, nohuddle:e},
      med:{all:e, pa:e, motion:e, nohuddle:e},
      long:{all:e, pa:e, motion:e, nohuddle:e},
    };
  }

  return {
    data: {
      all: {
        all: {all:all, pa:pa, motion:motion, nohuddle:nohuddle},
        short:{all:e, pa:e, motion:e, nohuddle:e},
        med:{all:e, pa:e, motion:e, nohuddle:e},
        long:{all:e, pa:e, motion:e, nohuddle:e},
      },
      '1': downBlock(d1),
      '2': downBlock(d2),
      '3': downBlock(d3),
      '4': downBlock(d4),
    },
    season: p ? p.season : {},
    names: (p && p.data && p.data.names) ? p.data.names : {},
    slots: (p && p.data && p.data.slots) ? p.data.slots : {},
  };
}

function _schemeRenderTemplate(template, p){
  const fv = _schemeBuildFv(p);
  const team = schemeTeam || '';
  const season = String((p && p.season) || SHARP_SEASON || '');
  const full = teamDisplayName(team);
  const wr1 = fv.names[(fv.slots||{}).WR1] || 'WR1';
  const wr2 = fv.names[(fv.slots||{}).WR2] || 'WR2';
  const script = `const FV=${JSON.stringify(fv)};\nconst FORM=FV.data;\nconst SEASON=FV.season;\nconst NAMES=FV.names;`;
  return template
    .replace(/__TC_SCRIPT_OPEN__/g, _SCHEME_SCRIPT_OPEN)
    .replace(/__TC_SCRIPT_CLOSE__/g, _SCHEME_SCRIPT_CLOSE)
    .replace('__TC_FV_SCRIPT__', script)
    .replace('Detroit Lions &mdash; Formation &amp; Concept Sheet', `${full} &mdash; Formation &amp; Concept Sheet`)
    .replace('2025 · Routes mapped to players', `${season} · Routes mapped to players`)
    .replace('WR1=St. Brown, WR2=Williams', `WR1=${wr1}, WR2=${wr2}`)
    .replace(/const FV=.*?const FORM=FV\.data;\s*const SEASON=FV\.season;\s*const NAMES=FV\.names;/s, script);
}

function _renderTeamCoachingScheme(){
  const host = document.getElementById('schemeOverlayHost');
  if(!host || !schemeTeam){ return; }
  const p = _schemePayload(schemeTeam);
  if(!p){
    host.innerHTML = `<div class="scheme-overlay" onclick="closeTeamCoachingScheme()">
      <div class="scheme-modal" onclick="event.stopPropagation()">
        <button class="scheme-close" onclick="closeTeamCoachingScheme()" aria-label="Close">✕</button>
        <div class="scheme-head">
          <img src="${NFL_LOGO(schemeTeam)}" class="scheme-team-logo" onerror="this.style.display='none'">
          <div><div class="scheme-title">${teamDisplayName(schemeTeam)} Coaching Scheme</div>
          <div class="scheme-subtitle">No nflverse coaching-scheme payload found for this team.</div></div>
        </div>
      </div>
    </div>`;
    return;
  }

  host.innerHTML = `<div class="scheme-overlay" onclick="closeTeamCoachingScheme()">
    <div class="scheme-modal" onclick="event.stopPropagation()">
      <button class="scheme-close" onclick="closeTeamCoachingScheme()" aria-label="Close">✕</button>
      <div class="scheme-head">
        <img src="${NFL_LOGO(schemeTeam)}" class="scheme-team-logo" onerror="this.style.display='none'">
        <div>
          <div class="scheme-title">${teamDisplayName(schemeTeam)} Coaching Scheme</div>
          <div class="scheme-subtitle">Interactive playsheet · nflverse charting · ${p.season} regular season</div>
        </div>
      </div>
      <div class="scheme-loading">Loading playsheet template…</div>
    </div>
  </div>`;

  try{
    const tpl = (typeof SCHEME_TEMPLATE_INLINE==='string' && SCHEME_TEMPLATE_INLINE)
      ? SCHEME_TEMPLATE_INLINE
      : '';
    if(!tpl) throw new Error('missing inline template');
    const html = _schemeRenderTemplate(tpl, p);
    const frame = `<iframe class="scheme-frame" title="${escAttr(teamDisplayName(schemeTeam))} coaching playsheet" srcdoc="${escAttr(html)}"></iframe>`;
    const modal = host.querySelector('.scheme-modal');
    if(modal) modal.insertAdjacentHTML('beforeend', frame);
    const loading = host.querySelector('.scheme-loading');
    if(loading) loading.remove();
  }catch(e){
    const loading = host.querySelector('.scheme-loading');
    if(loading){
      loading.outerHTML = `<div class="scheme-subtitle">Unable to render inline coaching playsheet template.</div>`;
    }
  }
}

function openTeamCoachingScheme(team, initialView){
  if(!team) return;
  schemeOverlayOpen = true;
  schemeTeam = team;
  void initialView; // route preserved for compatibility with existing onclick hooks
  // Coaching-scheme payloads live in a lazy-loaded nflverse sidecar. Fetch it first (hosted
  // first-open), showing a loading shell, then render the interactive playsheet.
  if(typeof ensureNflverseSection==='function' && !nflverseSectionReady('coaching_scheme')){
    _renderSchemeLoadingShell();
    ensureNflverseSection('coaching_scheme').then(()=>{
      if(schemeOverlayOpen && schemeTeam===team) _renderTeamCoachingScheme();
    });
    return;
  }
  _renderTeamCoachingScheme();
}

// Minimal overlay shell shown while the coaching-scheme sidecar is fetched.
function _renderSchemeLoadingShell(){
  const host = document.getElementById('schemeOverlayHost');
  if(!host || !schemeTeam) return;
  host.innerHTML = `<div class="scheme-overlay" onclick="closeTeamCoachingScheme()">
    <div class="scheme-modal" onclick="event.stopPropagation()">
      <button class="scheme-close" onclick="closeTeamCoachingScheme()" aria-label="Close">✕</button>
      <div class="scheme-head">
        <img src="${NFL_LOGO(schemeTeam)}" class="scheme-team-logo" onerror="this.style.display='none'">
        <div>
          <div class="scheme-title">${teamDisplayName(schemeTeam)} Coaching Scheme</div>
          <div class="scheme-subtitle">Loading coaching-scheme data…</div>
        </div>
      </div>
      <div class="scheme-loading">Loading coaching-scheme data…</div>
    </div>
  </div>`;
}

function closeTeamCoachingScheme(){
  schemeOverlayOpen = false;
  schemeTeam = null;
  const host = document.getElementById('schemeOverlayHost');
  if(host) host.innerHTML = '';
}

if(document && document.addEventListener && !_schemeEscBound){
  _schemeEscBound = true;
  document.addEventListener('keydown', e=>{
    if(e && e.key==='Escape' && schemeOverlayOpen) closeTeamCoachingScheme();
  });
}
