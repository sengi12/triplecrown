// ─────────────────────────────────────────────────────────────────────────────
// Team coaching scheme modal (nflverse)
// ─────────────────────────────────────────────────────────────────────────────
let schemeOverlayOpen = false;
let schemeTeam = null;
let schemeSeason = null;
let _schemeEscBound = false;
const _SCHEME_SCRIPT_OPEN = '<scr' + 'ipt>';
const _SCHEME_SCRIPT_CLOSE = '</scr' + 'ipt>';

function _schemeEscHtml(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function _schemeAllSeasons(){
  if(typeof NFLVERSE!=='object' || !NFLVERSE) return [];
  return Object.keys(NFLVERSE).map(x=>parseInt(x,10)).filter(Number.isFinite)
    .sort((a,b)=>b-a).map(String);
}

// Candidate seasons for a team = every season the loaded nflverse block covers. Coaching
// data for each season is lazy-loaded per-season on demand, so this deliberately does NOT
// require the coaching_scheme block to be present yet (that would hide season tabs/links
// before their sidecar is fetched).
function _schemeSeasons(team){
  return _schemeAllSeasons();
}

function _schemePreferredSeason(team){
  const seasons = _schemeAllSeasons();
  if(!seasons.length) return null;
  if(schemeSeason && seasons.includes(String(schemeSeason))) return String(schemeSeason);
  if(activeSeason!=='proj' && seasons.includes(String(activeSeason))) return String(activeSeason);
  if(SHARP_SEASON!=null && seasons.includes(String(SHARP_SEASON))) return String(SHARP_SEASON);
  return seasons[0];
}

function _schemePlaycallerHC(team){
  return !!(HC_PLAYCALLERS && HC_PLAYCALLERS[team]);
}

function _schemeOcSource(team){
  if(!team) return null;
  const hc = HC_HISTORY && HC_HISTORY[team];
  if(_schemePlaycallerHC(team) && hc && hc.is_new && hc.prev_code && hc.prev_code!==team){
    return {
      name: hc.name || HC_PLAYCALLERS[team] || 'Head coach',
      since: hc.since,
      is_new: true,
      prev_code: hc.prev_code,
      prev_role: hc.prev_role || 'head coach',
      prev_years: hc.prev_years,
      _fromHC: true,
    };
  }
  const oc = COORDINATORS && COORDINATORS[team] && COORDINATORS[team].offense;
  if(!oc || !oc.name) return null;
  return {
    name: oc.name,
    since: oc.since,
    is_new: !!(oc.is_new && !oc.internal && oc.prev_code),
    prev_code: oc.prev_code || null,
    prev_role: oc.prev_role || 'coordinator',
    prev_years: oc.prev_years,
    _fromHC: false,
  };
}

function _schemeSeasonsForTeam(team){
  // Candidate seasons (see _schemeSeasons) so prior-team links appear before their
  // per-season coaching sidecar is fetched; clicking a link loads that season on demand.
  return _schemeAllSeasons();
}

function _schemeOcCallout(team){
  const src = _schemeOcSource(team);
  if(!src) return '';
  const roleTag = src._fromHC ? 'Play-calling HC' : 'OC';
  const since = src.since ? ` · since ${src.since}` : '';
  if(!src.is_new || !src.prev_code){
    return `<div class="scheme-oc-callout"><span class="scheme-oc-pill">${roleTag}</span><b>${_schemeEscHtml(src.name)}</b>${since}</div>`;
  }
  const prev = src.prev_code;
  const prevName = teamDisplayName(prev);
  const seasons = _schemeSeasonsForTeam(prev);
  const links = seasons.length
    ? `<div class="scheme-oc-links">${seasons.map(s=>`<button class="scheme-oc-link" onclick="openTeamCoachingScheme('${prev}',{season:'${s}',from:'${team}'})">${prev} ${s}</button>`).join('')}</div>`
    : `<span class="scheme-oc-missing">No prior-team coaching scheme seasons loaded.</span>`;
  return `<div class="scheme-oc-callout">
    <div><span class="scheme-oc-pill new">NEW ${roleTag}</span><b>${_schemeEscHtml(src.name)}</b>${since}
      <span class="scheme-oc-note">from ${prevName}${src.prev_role?` (${_schemeEscHtml(src.prev_role)})`:''}${src.prev_years?` · ${_schemeEscHtml(String(src.prev_years))}`:''}</span>
    </div>
    ${links}
  </div>`;
}

function _schemePayload(team, seasonPref){
  if(!team || !NFLVERSE) return null;
  const seasons = _schemeSeasons(team);
  const keys = Object.keys(NFLVERSE).map(x=>parseInt(x,10)).filter(Number.isFinite).sort((a,b)=>b-a);
  const pref = [];
  if(seasonPref && seasons.includes(String(seasonPref))) pref.push(String(seasonPref));
  if(schemeSeason && seasons.includes(String(schemeSeason))) pref.push(String(schemeSeason));
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

function _schemeExpandGroup(g, formations){
  if(!g) return g;
  // New (deduped) schema: groups carry a `sig` referencing the per-team formations table
  // (formation metadata + slot assignments/routes). Merge those back in so downstream
  // rendering sees a self-contained group. Legacy full groups (no sig) pass through unchanged.
  const f = (formations && g.sig && formations[g.sig]) || null;
  return f ? Object.assign({}, f, g) : g;
}

function _schemeNode(view, formations){
  const v = view || {total:0,groups:[]};
  const groups = (Array.isArray(v.groups) ? v.groups : [])
    .map(g => _schemeToGroup(_schemeExpandGroup(g, formations)))
    .filter(Boolean);
  const total = _schemeNumber(v.total, groups.reduce((t,g)=>t+_schemeNumber(g.n,0),0));
  return {total, groups};
}

function _schemeEmptyNode(){ return {total:0, groups:[]}; }

function _schemeBuildFv(p){
  const views = (p && p.data && p.data.views) ? p.data.views : {};
  const formations = (p && p.data && p.data.formations) ? p.data.formations : {};
  const DOWNS = ['all','1','2','3','4'];
  const DISTS = ['all','short','med','long'];
  const TYPES = ['all','pa','motion','nohuddle','redzone'];
  const isNode = x => !!x && (Array.isArray(x.groups) || typeof x.total === 'number');
  // Old flat schema (down/type marginals only) vs new nested down→dist→type schema.
  const legacy = isNode(views.all) || isNode(views.down1);

  const data = {};
  if(legacy){
    // Back-compat: map the old marginal views onto the grid so the primary views still
    // render; combined (down+dist / down+type) filters fall back to empty as they did before.
    const e = _schemeEmptyNode();
    const node = k => _schemeNode(views[k], formations);
    const dblk = (main,pa,mo,nh,rz) => ({
      all:{all:main, pa:pa, motion:mo, nohuddle:nh, redzone:rz},
      short:{all:e, pa:e, motion:e, nohuddle:e, redzone:e},
      med:{all:e, pa:e, motion:e, nohuddle:e, redzone:e},
      long:{all:e, pa:e, motion:e, nohuddle:e, redzone:e},
    });
    data.all = dblk(node('all'), node('pa'), node('motion'), node('nohuddle'), e);
    data['1'] = dblk(node('down1'), e, e, e, e);
    data['2'] = dblk(node('down2'), e, e, e, e);
    data['3'] = dblk(node('down3'), e, e, e, e);
    data['4'] = dblk(node('down4'), e, e, e, e);
  } else {
    // New schema: fill the full down × distance × type grid, defaulting any pruned
    // (empty) combination to an empty node so every filter selection resolves cleanly.
    for(const dn of DOWNS){
      const dv = views[dn] || {};
      data[dn] = {};
      for(const ds of DISTS){
        const sv = dv[ds] || {};
        data[dn][ds] = {};
        for(const fl of TYPES){
          data[dn][ds][fl] = _schemeNode(sv[fl], formations);
        }
      }
    }
  }

  return {
    data: data,
    season: p ? p.season : {},
    names: (p && p.data && p.data.names) ? p.data.names : {},
    jerseys: (p && p.data && p.data.jerseys) ? p.data.jerseys : {},
    slots: (p && p.data && p.data.slots) ? p.data.slots : {},
  };
}

function _schemeCompactLabel(slot, pid, names, jerseys){
  const id = String(pid||'');
  const j = jerseys && jerseys[id];
  if(j!=null && String(j)!=='') return `#${j}`;
  const nm = names && names[id] ? String(names[id]) : '';
  if(nm) return nm.length>6 ? nm.slice(0,6) : nm;
  return String(slot||'').toUpperCase() || '—';
}

function _schemeCompactFvLabels(fv){
  if(!fv || !fv.data) return fv;
  const out = JSON.parse(JSON.stringify(fv));
  const names = out.names || {};
  const jerseys = out.jerseys || {};
  const slots = out.slots || {};
  const data = out.data || {};
  for(const down of Object.keys(data)){
    const distBlock = data[down] || {};
    for(const dist of Object.keys(distBlock)){
      const fieldBlock = distBlock[dist] || {};
      for(const field of Object.keys(fieldBlock)){
        const node = fieldBlock[field];
        const groups = Array.isArray(node&&node.groups) ? node.groups : [];
        groups.forEach(g=>{
          const assigns = Array.isArray(g&&g.assigns) ? g.assigns : [];
          assigns.forEach(a=>{
            const slot = String((a&&a.slot)||'');
            const pid = slots[slot];
            a.name = _schemeCompactLabel(slot, pid, names, jerseys);
          });
        });
      }
    }
  }
  return out;
}

function _schemeRenderTemplate(template, p){
  const fv = _schemeCompactFvLabels(_schemeBuildFv(p));
  const team = schemeTeam || '';
  const season = String((p && p.season) || SHARP_SEASON || '');
  const full = teamDisplayName(team);
  const wr1 = fv.names[(fv.slots||{}).WR1] || 'WR1';
  const wr2 = fv.names[(fv.slots||{}).WR2] || 'WR2';
  const script = `const FV=${JSON.stringify(fv)};\nconst FORM=FV.data;\nconst SEASON=FV.season;\nconst NAMES=FV.names;`;
  return template
    .replace('svg{display:block;margin:0 auto;}', 'svg{display:block;margin:0 auto;max-width:100%;height:auto;}')
    .replace('grid-template-columns:repeat(auto-fill,minmax(330px,1fr));', 'grid-template-columns:repeat(auto-fill,minmax(280px,1fr));')
    .replace('</style>', '@media (max-width:560px){ body{padding:8px;} .sheet{max-width:100%;} .controls{padding:8px 10px;} .grid{grid-template-columns:1fr;} .card{padding:8px 8px 10px;} }</style>')
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
  const seasons = _schemeAllSeasons();
  const pick = (schemeSeason && seasons.includes(String(schemeSeason)))
    ? String(schemeSeason) : _schemePreferredSeason(schemeTeam);
  schemeSeason = pick;
  // Ensure the selected season's coaching sidecar is loaded before we read it (per-season lazy).
  if(pick && typeof coachingSeasonReady==='function' && !coachingSeasonReady(pick)){
    _renderSchemeLoadingShell();
    if(typeof ensureNflverseCoachingSeason==='function'){
      ensureNflverseCoachingSeason(pick).then(()=>{
        if(schemeOverlayOpen && schemeTeam) _renderTeamCoachingScheme();
      });
    }
    return;
  }
  const p = _schemePayload(schemeTeam, pick);
  schemeSeason = p ? p.season : pick;
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
          ${_schemeOcCallout(schemeTeam)}
        </div>
      </div>
      <div class="scheme-loading">Loading playsheet template…</div>
      ${seasons.length>1?`<div class="scheme-tabs">${seasons.map(s=>`<button class="scheme-tab ${String(s)===String(schemeSeason)?'active':''}" onclick="setTeamCoachingSchemeSeason('${s}')">Season <span>${s}</span></button>`).join('')}</div>`:''}
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
  if(initialView && typeof initialView==='object' && initialView.season!=null){
    schemeSeason = String(initialView.season);
  }else{
    schemeSeason = _schemePreferredSeason(team);
  }
  // Coaching-scheme payloads are lazy-loaded per season (triplecrown_seed.coaching.<season>.json)
  // so we only fetch the season being viewed. Load it first (showing a loading shell), then render.
  const want = schemeSeason;
  if(want && typeof ensureNflverseCoachingSeason==='function' && !coachingSeasonReady(want)){
    _renderSchemeLoadingShell();
    ensureNflverseCoachingSeason(want).then(()=>{
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
  schemeSeason = null;
  const host = document.getElementById('schemeOverlayHost');
  if(host) host.innerHTML = '';
}

function setTeamCoachingSchemeSeason(season){
  if(!schemeOverlayOpen || !schemeTeam) return;
  const s = String(season||'');
  if(!s) return;
  schemeSeason = s;
  // Load this season's coaching sidecar on demand before re-rendering.
  if(typeof coachingSeasonReady==='function' && !coachingSeasonReady(s)){
    _renderSchemeLoadingShell();
    if(typeof ensureNflverseCoachingSeason==='function'){
      ensureNflverseCoachingSeason(s).then(()=>{
        if(schemeOverlayOpen && String(schemeSeason)===s) _renderTeamCoachingScheme();
      });
    }
    return;
  }
  _renderTeamCoachingScheme();
}

if(document && document.addEventListener && !_schemeEscBound){
  _schemeEscBound = true;
  document.addEventListener('keydown', e=>{
    if(e && e.key==='Escape' && schemeOverlayOpen) closeTeamCoachingScheme();
  });
}
