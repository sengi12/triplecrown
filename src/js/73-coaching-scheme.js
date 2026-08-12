// ─────────────────────────────────────────────────────────────────────────────
// Team playbook modal (nflverse)
// ─────────────────────────────────────────────────────────────────────────────
let schemeOverlayOpen = false;
let schemeTeam = null;
let schemeSeason = null;
let schemeViewTab = 'playbook';
let schemeBenefactorSort = 'opp';
let _schemeEscBound = false;
let _schemeInsightSeasonCache = {};
let _schemeNavStack = [];
let _schemeCoachContext = null;
const _SCHEME_SCRIPT_OPEN = '<scr' + 'ipt>';
const _SCHEME_SCRIPT_CLOSE = '</scr' + 'ipt>';

function _schemeOverlayHost(create){
  let el = document.getElementById('schemeOverlay');
  if(!el && create){
    el = document.createElement('div');
    el.id = 'schemeOverlay';
    el.className = 'scheme-overlay-host';
    document.body.appendChild(el);
  }
  return el;
}

function _schemeLockPage(on){
  try{ document.documentElement.classList.toggle('scheme-locked', !!on); }catch(e){}
}

function _schemeEscHtml(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function _schemeEscJsSingle(s){
  return String(s==null?'':s)
    .replace(/\\/g,'\\\\')
    .replace(/'/g,"\\'");
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

function _schemeSeasonHeadCoach(team, season){
  const s = String(season || '');
  const tm = String(team || '').toUpperCase();
  if(!s || !tm || !NFLVERSE || !NFLVERSE[s] || !NFLVERSE[s].head_coaches) return '';
  const v = NFLVERSE[s].head_coaches[tm];
  return String(v || '').trim();
}

function _schemePrevTeamPlaycallerContext(team){
  const tm = String(team||'').toUpperCase();
  if(!tm || !_schemePlaycallerHC(tm)) return null;
  const h = HC_HISTORY && HC_HISTORY[tm];
  const nm = (HC_PLAYCALLERS && HC_PLAYCALLERS[tm]) || (h && h.name) || '';
  const since = parseInt(h && h.since, 10);
  return {
    team: tm,
    name: nm,
    since: Number.isFinite(since) ? since : null,
    isPlaycaller: true,
  };
}

function _schemeOcSource(team){
  if(!team) return null;
  const hc = HC_HISTORY && HC_HISTORY[team];
  if(_schemePlaycallerHC(team)){
    const oc = COORDINATORS && COORDINATORS[team] && COORDINATORS[team].offense;
    const isNewFromElsewhere = !!(hc && hc.is_new && hc.prev_code && hc.prev_code!==team);
    const fallbackPrevCode = (!isNewFromElsewhere && hc && hc.is_new && oc && oc.is_new && !oc.internal && oc.prev_code && oc.prev_code!==team)
      ? oc.prev_code : null;
    return {
      name: (hc && hc.name) || (HC_PLAYCALLERS && HC_PLAYCALLERS[team]) || 'Head coach',
      since: hc ? hc.since : null,
      is_new: !!(isNewFromElsewhere || fallbackPrevCode),
      prev_code: isNewFromElsewhere ? hc.prev_code : fallbackPrevCode,
      prev_role: isNewFromElsewhere ? (hc.prev_role || 'head coach') : (fallbackPrevCode ? 'head coach' : null),
      prev_years: isNewFromElsewhere ? hc.prev_years : null,
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

function _schemeYearsFromSpan(span){
  const txt = String(span||'');
  const vals = (txt.match(/\d{4}/g) || []).map(x=>parseInt(x, 10)).filter(Number.isFinite);
  if(!vals.length) return [];
  if(vals.length === 1) return [String(vals[0])];
  const lo = Math.min.apply(null, vals);
  const hi = Math.max.apply(null, vals);
  const out = [];
  for(let y=lo; y<=hi; y++) out.push(String(y));
  return out;
}

function _schemeRelevantPrevSeasons(src){
  const available = _schemeSeasonsForTeam(src && src.prev_code);
  const wanted = _schemeYearsFromSpan(src && src.prev_years);
  const role = String((src && src.prev_role) || '').toLowerCase();
  const srcWasHeadCoach = role.includes('head coach');

  // Explicit HC tenure spans (e.g., "2022-2025") are authoritative.
  if(srcWasHeadCoach && wanted.length){
    const hit = available.filter(s=>wanted.includes(String(s)));
    if(hit.length) return hit;
  }

  // If explicit HC years are absent, infer tenure from nflverse season coach names.
  if(srcWasHeadCoach && src && src.name){
    const want = _schemeNormNameToken(src.name);
    const byName = available.filter(s=>_schemeNormNameToken(_schemeSeasonHeadCoach(src.prev_code, s)) === want);
    if(byName.length) return byName;
  }

  const prevCtx = _schemePrevTeamPlaycallerContext(src && src.prev_code);
  if(prevCtx && prevCtx.isPlaycaller){
    if(Number.isFinite(prevCtx.since)){
      const fromPlaycallerEra = available.filter(s=>parseInt(s, 10) >= prevCtx.since);
      if(fromPlaycallerEra.length) return fromPlaycallerEra;
    }
    // For OC/DC carryovers, if we know the previous team is HC-playcaller-led but we don't
    // have a usable start year, broad-link that team's loaded seasons.
    if(!srcWasHeadCoach) return available;
  }

  if(wanted.length){
    const hit = available.filter(s=>wanted.includes(String(s)));
    if(hit.length) return hit;
  }
  return available;
}

function _schemeCoachContextFor(team, season){
  if(!_schemeCoachContext || !team || !season) return null;
  if(String(_schemeCoachContext.team||'') !== String(team||'')) return null;
  const allowed = Array.isArray(_schemeCoachContext.seasons) ? _schemeCoachContext.seasons.map(String) : [];
  if(allowed.length && !allowed.includes(String(season))) return null;
  return _schemeCoachContext;
}

function _schemeOcCallout(team){
  const ctx = _schemeCoachContextFor(team, schemeSeason);
  if(ctx && ctx.name){
    const roleTag = ctx.fromHC ? 'Play-calling HC' : 'OC context';
    const yr = ctx.years ? ` · ${_schemeEscHtml(String(ctx.years))}` : '';
    return `<div class="scheme-oc-callout"><span class="scheme-oc-pill new">${roleTag}</span><b>${_schemeEscHtml(ctx.name)}</b><span class="scheme-oc-note">historical playcaller context for ${teamDisplayName(team)}${yr}</span></div>`;
  }

  const src = _schemeOcSource(team);
  if(!src) return '';
  const seasonCoach = _schemeSeasonHeadCoach(team, schemeSeason);
  const seasonCoachLine = seasonCoach
    ? `<div class="scheme-oc-note">${_schemeEscHtml(String(schemeSeason||''))} HC: <b>${_schemeEscHtml(seasonCoach)}</b></div>`
    : '';
  const roleTag = src._fromHC ? 'Play-calling HC' : 'OC';
  const since = src.since ? ` · since ${src.since}` : '';
  if(!src.is_new || !src.prev_code){
    return `<div class="scheme-oc-callout"><span class="scheme-oc-pill">${roleTag}</span><b>${_schemeEscHtml(src.name)}</b>${since}${seasonCoachLine}</div>`;
  }
  const prev = src.prev_code;
  const prevName = teamDisplayName(prev);
  const prevCtx = _schemePrevTeamPlaycallerContext(prev);
  const prevPlaycallerNote = (!src._fromHC && prevCtx && prevCtx.name)
    ? ` · play-caller there: ${_schemeEscHtml(prevCtx.name)}${Number.isFinite(prevCtx.since) ? ` (since ${prevCtx.since})` : ''}`
    : '';
  const seasons = _schemeRelevantPrevSeasons(src);
  const seasonCsv = seasons.join(',');
  const coachNameJs = _schemeEscJsSingle(src.name || '');
  const coachRoleJs = _schemeEscJsSingle(src.prev_role || '');
  const coachYearsExpr = (src.prev_years == null)
    ? 'null'
    : `'${_schemeEscJsSingle(String(src.prev_years))}'`;
  const coachSeasonsJs = _schemeEscJsSingle(seasonCsv);
  const links = seasons.length
    ? `<div class="scheme-oc-links">${seasons.map(s=>`<button class="scheme-oc-link" onclick="openTeamCoachingScheme('${prev}',{season:'${s}',from:'${team}',coachName:'${coachNameJs}',coachRole:'${coachRoleJs}',coachYears:${coachYearsExpr},coachFromHC:${src._fromHC?'true':'false'},coachSeasons:'${coachSeasonsJs}'})">${s}</button>`).join('')}</div>`
    : `<span class="scheme-oc-missing">No prior-team playbook seasons loaded.</span>`;
  return `<div class="scheme-oc-callout">
    <div><span class="scheme-oc-pill new">NEW ${roleTag}</span><b>${_schemeEscHtml(src.name)}</b>${since}
      <span class="scheme-oc-note">from ${prevName}${src.prev_role?` (${_schemeEscHtml(src.prev_role)})`:''}${src.prev_years?` · ${_schemeEscHtml(String(src.prev_years))}`:''}${prevPlaycallerNote}</span>
    </div>
    ${seasonCoachLine}
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

// Coerce a seed value to a number, falling back to `d` when it's null/undefined/NaN.
// Used everywhere in the scheme normalizer because the seed omits fields that had no sample
// (e.g. `er` is null for a formation with zero runs) and the UI must not render NaN.
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
    // Production out of this formation (filter-dependent, so it lives on the group).
    py: _schemeNumber(g.py, 0),
    ptd: _schemeNumber(g.ptd, 0),
    ry: _schemeNumber(g.ry, 0),
    rtd: _schemeNumber(g.rtd, 0),
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

function _schemeSafeNode(fv, down, dist, kind){
  return (((((fv||{}).data||{})[String(down)]||{})[String(dist)]||{})[String(kind)]) || {total:0, groups:[]};
}

function _schemeWeightedGroupRate(nodes, key){
  const arr = Array.isArray(nodes) ? nodes : [nodes];
  let nTot = 0;
  let sum = 0;
  arr.forEach(node=>{
    const gs = Array.isArray(node && node.groups) ? node.groups : [];
    gs.forEach(g=>{
      const n = _schemeNumber(g && g.n, 0);
      const v = _schemeNumber(g && g[key], 0);
      if(n <= 0) return;
      nTot += n;
      sum += n * v;
    });
  });
  return nTot > 0 ? (sum / nTot) : null;
}

function _schemePct(v){
  return Number.isFinite(v) ? `${v.toFixed(2)}%` : '—';
}

function _schemeOrdinal(n){
  const v = Math.max(1, parseInt(n, 10) || 1);
  const mod100 = v % 100;
  if(mod100 >= 11 && mod100 <= 13) return `${v}th`;
  const mod10 = v % 10;
  if(mod10 === 1) return `${v}st`;
  if(mod10 === 2) return `${v}nd`;
  if(mod10 === 3) return `${v}rd`;
  return `${v}th`;
}

function _schemeRankInLeague(value, values, dir){
  if(!Number.isFinite(value)) return null;
  const arr = (values||[]).filter(Number.isFinite);
  if(!arr.length) return null;
  const better = dir==='asc'
    ? arr.filter(v=>v < value).length
    : arr.filter(v=>v > value).length;
  return 1 + better;
}

function _schemeRankClass(rank, nTeams){
  const r = _schemeNumber(rank, 0);
  const n = _schemeNumber(nTeams, 0);
  if(r <= 0 || n <= 0) return 'neutral';
  const pct = r / n;
  if(pct <= 0.34) return 'good';
  if(pct <= 0.67) return 'mid';
  return 'bad';
}

function _schemeLeagueInsightRanks(season){
  return _schemeLeagueInsightSnapshot(season) || {
    leagueSize: 0,
    thirdDownReach: [],
    earlySucc: [],
    lateSucc: [],
    frictionScore: [],
  };
}

function _schemeSeasonOffenseTable(season){
  return NFLVERSE && NFLVERSE[String(season)] && NFLVERSE[String(season)].team
    && NFLVERSE[String(season)].team.offense;
}

function _schemeSeasonAdvWeeklySums(season){
  const pack = NFLVERSE && NFLVERSE[String(season)] && NFLVERSE[String(season)].adv_weekly;
  if(!pack || !pack.teams || !Array.isArray(pack.cols)) return null;
  const cols = pack.cols;
  const out = {};
  Object.keys(pack.teams).forEach(tm=>{
    const rows = Array.isArray(pack.teams[tm]) ? pack.teams[tm] : [];
    const sum = {};
    cols.forEach(c=>{ sum[c] = 0; });
    rows.forEach(r=>{
      cols.forEach((c, i)=>{ sum[c] += Number((r && r[i]) || 0); });
    });
    out[tm] = sum;
  });
  return out;
}

function _schemeBadness(value, values, higherIsWorse){
  if(!Number.isFinite(value)) return null;
  const arr = (values||[]).filter(Number.isFinite);
  if(arr.length < 2) return null;
  const worse = higherIsWorse
    ? arr.filter(v=>v < value).length
    : arr.filter(v=>v > value).length;
  return worse / (arr.length - 1);
}

function _schemeDriveFrictionComposite(season, team, thirdDownReach){
  const tbl = _schemeSeasonOffenseTable(season);
  const teams = tbl && tbl.teams ? Object.keys(tbl.teams) : [];
  if(!tbl || !teams.length) return { score:null, rank:null, leagueSize:0, components:null };
  const valuesFor = (col) => teams.map(tm=>tbl.teams[tm] && tbl.teams[tm].values ? tbl.teams[tm].values[col] : null).filter(Number.isFinite);
  const metrics = tbl.teams[team] && tbl.teams[team].values ? tbl.teams[team].values : {};
  const epa = _schemeNumber(metrics['EPA/Play'], NaN);
  const ppd = _schemeNumber(metrics['Points Per Drive'], NaN);
  const conv = _schemeNumber(metrics['Down Conversion Rate'], NaN);
  const expl = _schemeNumber(metrics['Explosive Play Rate'], NaN);
  const badness = {
    lateDownFreq: _schemeBadness(thirdDownReach, teams.map(tm=>_schemeRedZoneCore({ season:String(season), team:tm, data:(NFLVERSE[String(season)] && NFLVERSE[String(season)].coaching_scheme || {})[tm] }).thirdDownReach).filter(Number.isFinite), true),
    epa: _schemeBadness(epa, valuesFor('EPA/Play'), false),
    pointsPerDrive: _schemeBadness(ppd, valuesFor('Points Per Drive'), false),
    conversion: _schemeBadness(conv, valuesFor('Down Conversion Rate'), false),
    explosive: _schemeBadness(expl, valuesFor('Explosive Play Rate'), false),
  };
  const usable = Object.values(badness).filter(Number.isFinite);
  if(!usable.length) return { score:null, rank:null, leagueSize:teams.length, components:badness };

  const scoreFor = (tm)=>{
    const tMetrics = tbl.teams[tm] && tbl.teams[tm].values ? tbl.teams[tm].values : {};
    const tThird = _schemeRedZoneCore({ season:String(season), team:tm, data:(NFLVERSE[String(season)] && NFLVERSE[String(season)].coaching_scheme || {})[tm] }).thirdDownReach;
    const tBad = [
      _schemeBadness(tThird, teams.map(code=>_schemeRedZoneCore({ season:String(season), team:code, data:(NFLVERSE[String(season)] && NFLVERSE[String(season)].coaching_scheme || {})[code] }).thirdDownReach).filter(Number.isFinite), true),
      _schemeBadness(_schemeNumber(tMetrics['EPA/Play'], NaN), valuesFor('EPA/Play'), false),
      _schemeBadness(_schemeNumber(tMetrics['Points Per Drive'], NaN), valuesFor('Points Per Drive'), false),
      _schemeBadness(_schemeNumber(tMetrics['Down Conversion Rate'], NaN), valuesFor('Down Conversion Rate'), false),
      _schemeBadness(_schemeNumber(tMetrics['Explosive Play Rate'], NaN), valuesFor('Explosive Play Rate'), false),
    ].filter(Number.isFinite);
    return tBad.length ? (100 * tBad.reduce((a,b)=>a+b,0) / tBad.length) : null;
  };

  const score = 100 * usable.reduce((a,b)=>a+b,0) / usable.length;
  const scores = teams.map(tm=>scoreFor(tm)).filter(Number.isFinite);
  const rank = Number.isFinite(score) ? (1 + scores.filter(v=>v < score).length) : null;
  return { score, rank, leagueSize:teams.length, components:badness };
}

function _schemeLeagueInsightSnapshot(season){
  const s = String(season||'');
  if(!s) return null;
  if(_schemeInsightSeasonCache[s]) return _schemeInsightSeasonCache[s];

  // Trigger adv_weekly lazy load so drive-component and RZ-volume stats populate.
  // The cache key will be cleared by laOnAdvWeeklyLoaded when the fetch completes.
  if(typeof ensureNflverseSection==='function') ensureNflverseSection('adv_weekly').then(ok=>{
    if(!ok) return;
    // Re-render the scheme modal if it's open on the insights tab so RZ data appears.
    if(typeof schemeOverlayOpen!=='undefined' && schemeOverlayOpen
       && typeof schemeViewTab!=='undefined' && schemeViewTab!=='playbook'
       && typeof _renderTeamCoachingScheme==='function'){
      _renderTeamCoachingScheme();
    }
  });

  const block = NFLVERSE && NFLVERSE[s] && NFLVERSE[s].coaching_scheme;
  const teams = block ? Object.keys(block) : [];
  if(!teams.length) return null;

  const tbl = _schemeSeasonOffenseTable(s);
  const teamTable = (tbl && tbl.teams) ? tbl.teams : {};
  const adv = _schemeSeasonAdvWeeklySums(s) || {};
  const coreByTeam = {};
  teams.forEach(tm=>{ coreByTeam[tm] = _schemeRedZoneCore({ season:s, team:tm, data:block[tm] }); });

  const rowsByTeam = {};
  teams.forEach(tm=>{
    const core = coreByTeam[tm] || {};
    const metrics = teamTable[tm] && teamTable[tm].values ? teamTable[tm].values : {};
    const wk = adv[tm] || {};
    const driveCt = _schemeNumber(wk.off_drive_ct, 0);
    const games = _schemeNumber(wk.pace_games, 0);
    rowsByTeam[tm] = {
      samplePlays: core.samplePlays,
      thirdDownReach: core.thirdDownReach,
      earlySucc: core.earlySucc,
      lateSucc: core.lateSucc,
      earlyPass: core.earlyPass,
      pointsPerDrive: driveCt > 0 ? _schemeNumber(wk.off_drive_pts, 0) / driveCt : _schemeNumber(metrics['Points Per Drive'], NaN),
      conversionRate: _schemeNumber(wk.off_conv_obs, 0) > 0 ? (100 * _schemeNumber(wk.off_conv, 0) / _schemeNumber(wk.off_conv_obs, 0)) : _schemeNumber(metrics['Down Conversion Rate'], NaN),
      epaPerPlay: _schemeNumber(wk.off_plays, 0) > 0 ? (_schemeNumber(wk.off_epa, 0) / _schemeNumber(wk.off_plays, 0)) : _schemeNumber(metrics['EPA/Play'], NaN),
      explosiveRate: _schemeNumber(wk.off_plays, 0) > 0 ? (100 * _schemeNumber(wk.off_explosive, 0) / _schemeNumber(wk.off_plays, 0)) : _schemeNumber(metrics['Explosive Play Rate'], NaN),
      puntRate: driveCt > 0 ? (100 * _schemeNumber(wk.off_drive_punt_ct, 0) / driveCt) : null,
      turnoverDriveRate: driveCt > 0 ? (100 * (_schemeNumber(wk.off_drive_turnover_ct, 0) + _schemeNumber(wk.off_drive_tod_ct, 0)) / driveCt) : null,
      threeOutRate: driveCt > 0 ? (100 * _schemeNumber(wk.off_drive_three_out_ct, 0) / driveCt) : null,
      tdDriveRate: driveCt > 0 ? (100 * _schemeNumber(wk.off_drive_td_ct, 0) / driveCt) : null,
      rzTdRate: _schemeNumber(wk.off_drive_rz_ct, 0) > 0 ? (100 * _schemeNumber(wk.off_drive_rz_td_ct, 0) / _schemeNumber(wk.off_drive_rz_ct, 0)) : null,
      rzDrivesPerGame: games > 0 ? (_schemeNumber(wk.off_drive_rz_ct, 0) / games) : null,
      rzPlaysPerGame: games > 0 ? (_schemeNumber(core.samplePlays, 0) / games) : null,
      fpPprPerGame: games > 0 ? (_schemeNumber(wk.off_fp_ppr, 0) / games) : null,
      fpPprPerDrive: driveCt > 0 ? (_schemeNumber(wk.off_fp_ppr, 0) / driveCt) : null,
    };
  });

  const thirdVals = teams.map(tm=>rowsByTeam[tm].thirdDownReach).filter(Number.isFinite);
  const epaVals = teams.map(tm=>rowsByTeam[tm].epaPerPlay).filter(Number.isFinite);
  const ppdVals = teams.map(tm=>rowsByTeam[tm].pointsPerDrive).filter(Number.isFinite);
  const convVals = teams.map(tm=>rowsByTeam[tm].conversionRate).filter(Number.isFinite);
  const explVals = teams.map(tm=>rowsByTeam[tm].explosiveRate).filter(Number.isFinite);
  const puntVals = teams.map(tm=>rowsByTeam[tm].puntRate).filter(Number.isFinite);
  const toVals = teams.map(tm=>rowsByTeam[tm].turnoverDriveRate).filter(Number.isFinite);
  const threeVals = teams.map(tm=>rowsByTeam[tm].threeOutRate).filter(Number.isFinite);
  const tdDriveVals = teams.map(tm=>rowsByTeam[tm].tdDriveRate).filter(Number.isFinite);
  const rzTdVals = teams.map(tm=>rowsByTeam[tm].rzTdRate).filter(Number.isFinite);
  const rzDriveVolVals = teams.map(tm=>rowsByTeam[tm].rzDrivesPerGame).filter(Number.isFinite);
  const rzPlayVolVals = teams.map(tm=>rowsByTeam[tm].rzPlaysPerGame).filter(Number.isFinite);
  const fpVals = teams.map(tm=>rowsByTeam[tm].fpPprPerGame).filter(Number.isFinite);

  teams.forEach(tm=>{
    const parts = [
      _schemeBadness(rowsByTeam[tm].thirdDownReach, thirdVals, true),
      _schemeBadness(rowsByTeam[tm].puntRate, puntVals, true),
      _schemeBadness(rowsByTeam[tm].turnoverDriveRate, toVals, true),
      _schemeBadness(rowsByTeam[tm].threeOutRate, threeVals, true),
      _schemeBadness(rowsByTeam[tm].pointsPerDrive, ppdVals, false),
      _schemeBadness(rowsByTeam[tm].conversionRate, convVals, false),
      _schemeBadness(rowsByTeam[tm].tdDriveRate, tdDriveVals, false),
      _schemeBadness(rowsByTeam[tm].rzTdRate, rzTdVals, false),
      _schemeBadness(rowsByTeam[tm].epaPerPlay, epaVals, false),
      _schemeBadness(rowsByTeam[tm].explosiveRate, explVals, false),
    ].filter(Number.isFinite);
    rowsByTeam[tm].frictionScore = parts.length ? (100 * parts.reduce((a,b)=>a+b,0) / parts.length) : null;
  });

  teams.forEach(tm=>{
    const score = rowsByTeam[tm].frictionScore;
    rowsByTeam[tm].frictionRank = Number.isFinite(score)
      ? (1 + teams.filter(other=>Number.isFinite(rowsByTeam[other].frictionScore) && rowsByTeam[other].frictionScore < score).length)
      : null;
  });

  const snapshot = {
    leagueSize: teams.length,
    rowsByTeam,
    thirdDownReach: teams.map(tm=>rowsByTeam[tm].thirdDownReach).filter(Number.isFinite),
    earlySucc: teams.map(tm=>rowsByTeam[tm].earlySucc).filter(Number.isFinite),
    lateSucc: teams.map(tm=>rowsByTeam[tm].lateSucc).filter(Number.isFinite),
    frictionScore: teams.map(tm=>rowsByTeam[tm].frictionScore).filter(Number.isFinite),
    puntRate: puntVals,
    turnoverDriveRate: toVals,
    threeOutRate: threeVals,
    tdDriveRate: tdDriveVals,
    rzTdRate: rzTdVals,
    rzDrivesPerGame: rzDriveVolVals,
    rzPlaysPerGame: rzPlayVolVals,
    fpPprPerGame: fpVals,
  };
  // Only cache once adv_weekly is loaded — otherwise a later load would never refresh.
  const advReady = typeof _nflverseLazyLoaded !== 'undefined' && _nflverseLazyLoaded.adv_weekly;
  if(advReady) _schemeInsightSeasonCache[s] = snapshot;
  return snapshot;
}

function _schemeRedZoneCore(p){
  const fv = _schemeBuildFv(p);
  const rz1 = _schemeSafeNode(fv, '1', 'all', 'redzone');
  const rz2 = _schemeSafeNode(fv, '2', 'all', 'redzone');
  const rz3 = _schemeSafeNode(fv, '3', 'all', 'redzone');
  const rz4 = _schemeSafeNode(fv, '4', 'all', 'redzone');
  const rzAll = _schemeSafeNode(fv, 'all', 'all', 'redzone');

  const n1 = _schemeNumber(rz1.total, 0);
  const n2 = _schemeNumber(rz2.total, 0);
  const n3 = _schemeNumber(rz3.total, 0);
  const n4 = _schemeNumber(rz4.total, 0);
  const downsKnown = n1 + n2 + n3 + n4;

  const thirdDownReach = downsKnown > 0 ? ((n3 + n4) / downsKnown) * 100 : null;
  const earlySucc = _schemeWeightedGroupRate([rz1, rz2], 'succ');
  const lateSucc = _schemeWeightedGroupRate([rz3, rz4], 'succ');
  const earlyPass = _schemeWeightedGroupRate([rz1, rz2], 'pass_rate');

  return {
    samplePlays: Math.max(downsKnown, _schemeNumber(rzAll.total, 0)),
    thirdDownReach,
    earlySucc,
    lateSucc,
    earlyPass,
  };
}

function _schemeRedZoneInsightData(p){
  const core = _schemeRedZoneCore(p);
  const team = (p && p.team) || schemeTeam || '';
  const snap = _schemeLeagueInsightSnapshot(p && p.season);
  const cached = snap && team ? snap.rowsByTeam[team] : null;
  const friction = cached ? {
    score: cached.frictionScore,
    rank: cached.frictionRank,
    leagueSize: snap.leagueSize,
    components: null,
  } : _schemeDriveFrictionComposite(p && p.season, team, core.thirdDownReach);

  let label = 'Balanced Friction';
  let tone = 'neutral';
  if(Number.isFinite(friction.rank) && Number.isFinite(friction.leagueSize) && friction.leagueSize > 0){
    const pct = friction.rank / friction.leagueSize;
    if(pct <= 0.34){ label = 'Low Drive Friction'; tone = 'good'; }
    else if(pct >= 0.67){ label = 'High Drive Friction'; tone = 'warn'; }
  }

  return {
    samplePlays: cached && Number.isFinite(cached.samplePlays) ? cached.samplePlays : core.samplePlays,
    thirdDownReach: cached && Number.isFinite(cached.thirdDownReach) ? cached.thirdDownReach : core.thirdDownReach,
    earlySucc: cached && Number.isFinite(cached.earlySucc) ? cached.earlySucc : core.earlySucc,
    lateSucc: cached && Number.isFinite(cached.lateSucc) ? cached.lateSucc : core.lateSucc,
    earlyPass: cached && Number.isFinite(cached.earlyPass) ? cached.earlyPass : core.earlyPass,
    tdDriveRate: cached ? cached.tdDriveRate : null,
    rzTdRate: cached ? cached.rzTdRate : null,
    puntRate: cached ? cached.puntRate : null,
    turnoverDriveRate: cached ? cached.turnoverDriveRate : null,
    threeOutRate: cached ? cached.threeOutRate : null,
    rzDrivesPerGame: cached ? cached.rzDrivesPerGame : null,
    rzPlaysPerGame: cached ? cached.rzPlaysPerGame : null,
    fpPprPerGame: cached ? cached.fpPprPerGame : null,
    frictionScore: friction.score,
    frictionRank: friction.rank,
    frictionLeagueSize: friction.leagueSize,
    frictionComponents: friction.components,
    label,
    tone,
  };
}

function _schemeInsightNarrative(d){
  const pieces = [];
  if(Number.isFinite(d.frictionRank) && Number.isFinite(d.frictionLeagueSize)){
    if((d.frictionRank / d.frictionLeagueSize) <= 0.34){
      pieces.push('This offense is finishing drives with relatively low friction: stronger drive efficiency and fewer late-down red-zone stalls make core touchdown roles cleaner.');
    }else if((d.frictionRank / d.frictionLeagueSize) >= 0.67){
      pieces.push('This offense is ranking among the stickier drives in the league: punts, drive-killers, and late-down red-zone pressure all squeeze touchdown reliability.');
    }else{
      pieces.push('Drive friction sits around league middle, so role clarity matters more than the macro environment.');
    }
  }
  if(Number.isFinite(d.tdDriveRate) && d.tdDriveRate <= 18){
    pieces.push('Touchdown drives are landing below league baseline, so TD opportunity on this offense is thinner than the raw volume may suggest.');
  }else if(Number.isFinite(d.tdDriveRate) && d.tdDriveRate >= 26){
    pieces.push('A strong touchdown-drive rate keeps this offense fantasy-friendly even when overall volume is only average.');
  }
  if(Number.isFinite(d.fpPprPerGame)){
    if(d.fpPprPerGame >= 65) pieces.push('The offense is still generating strong total fantasy ecosystem output, which can soften individual efficiency concerns.');
    else if(d.fpPprPerGame <= 48) pieces.push('Total fantasy ecosystem output is light, which raises the bar for secondary options to matter.');
  }
  if(Number.isFinite(d.thirdDownReach) && d.thirdDownReach >= 40){
    pieces.push('A high 3rd/4th-down red-zone rate means the offense is needing extra snaps to finish drives.');
  }
  if(Number.isFinite(d.earlySucc) && Number.isFinite(d.lateSucc) && d.earlySucc > d.lateSucc + 7){
    pieces.push('The early-down edge fades on later downs, which usually narrows scoring chances to the most trusted pass-game roles.');
  }
  if(!pieces.length) pieces.push('Not enough red-zone charting for a confident read yet.');
  return pieces.join(' ');
}

function _schemeLeagueMetricTag(opts){
  const teamCode = String((opts && opts.team) || '').toUpperCase();
  const season = String((opts && opts.season) || advTeamSeason() || '');
  const ctx = `${teamDisplayName(teamCode)} red-zone insights · ${season}`;
  const nav = { type:'coaching', team:teamCode, season, tab:'insights' };
  return noteWrapHtml(String((opts && opts.html) || ''), {
    label: String((opts && opts.label) || ''),
    value: String((opts && opts.value) || ''),
    source: 'coaching_insights',
    statKey: String((opts && opts.statKey) || ''),
    context: ctx,
    team: teamCode,
    relevance: 'QB,RB,WR,TE',
    nav,
  }, 'note-tag-hit');
}

function _schemeRenderDriveFrictionBreakdown(p, d, league, rankText, rankClass){
  const nTeams = _schemeNumber(league && league.leagueSize, 0);
  const season = String((p && p.season) || advTeamSeason() || '');
  const teamCode = String((p && p.team) || schemeTeam || '').toUpperCase();
  const metric = (label, value, list, dir, key, higherWorse)=>{
    const rank = _schemeRankInLeague(value, list, dir);
    const rc = rankClass(rank);
    const polarity = higherWorse ? 'Lower is better' : 'Higher is better';
    const txt = _schemePct(value);
    const wrapped = _schemeLeagueMetricTag({
      team: teamCode,
      season,
      label,
      value: `${txt}${rank&&nTeams?` · ${_schemeOrdinal(rank)} of ${nTeams}`:''} · ${polarity}`,
      statKey: key,
      html: `${txt}${rank ? ` <span class="scheme-insight-rank ${rc}">(${rankText(rank)})</span>` : ''}`,
    });
    return `<div class="scheme-op-card"><div class="scheme-op-k">${label}</div><div class="scheme-op-v">${wrapped}</div></div>`;
  };
  return `<div class="scheme-op-wrap">
    <div class="scheme-op-title">Drive Friction Components</div>
    <div class="scheme-op-grid">
      ${metric('Punt Drive Rate', d.puntRate, league.puntRate, 'asc', 'punt_drive_rate', true)}
      ${metric('Turnover Drive Rate', d.turnoverDriveRate, league.turnoverDriveRate, 'asc', 'turnover_drive_rate', true)}
      ${metric('Three-and-Out Rate', d.threeOutRate, league.threeOutRate, 'asc', 'three_out_rate', true)}
      ${metric('TD Drive Rate', d.tdDriveRate, league.tdDriveRate, 'desc', 'td_drive_rate', false)}
    </div>
  </div>`;
}

function _schemeRenderRzOpportunityVolume(p, d, league, rankText, rankClass){
  const nTeams = _schemeNumber(league && league.leagueSize, 0);
  const season = String((p && p.season) || advTeamSeason() || '');
  const teamCode = String((p && p.team) || schemeTeam || '').toUpperCase();
  const driveRank = _schemeRankInLeague(d.rzDrivesPerGame, league.rzDrivesPerGame, 'desc');
  const playRank = _schemeRankInLeague(d.rzPlaysPerGame, league.rzPlaysPerGame, 'desc');
  const drivesTxt = Number.isFinite(d.rzDrivesPerGame) ? d.rzDrivesPerGame.toFixed(2) : '—';
  const playsTxt = Number.isFinite(d.rzPlaysPerGame) ? d.rzPlaysPerGame.toFixed(2) : '—';
  const drives = _schemeLeagueMetricTag({
    team: teamCode,
    season,
    label: 'Red-zone drives per game',
    value: `${drivesTxt}${driveRank&&nTeams?` · ${_schemeOrdinal(driveRank)} of ${nTeams}`:''}`,
    statKey: 'rz_drives_per_game',
    html: `${drivesTxt}${driveRank ? ` <span class="scheme-insight-rank ${rankClass(driveRank)}">(${rankText(driveRank)})</span>` : ''}`,
  });
  const plays = _schemeLeagueMetricTag({
    team: teamCode,
    season,
    label: 'Red-zone plays per game',
    value: `${playsTxt}${playRank&&nTeams?` · ${_schemeOrdinal(playRank)} of ${nTeams}`:''}`,
    statKey: 'rz_plays_per_game',
    html: `${playsTxt}${playRank ? ` <span class="scheme-insight-rank ${rankClass(playRank)}">(${rankText(playRank)})</span>` : ''}`,
  });
  return `<div class="scheme-insight-card">
    <div class="scheme-insight-k">Red-Zone Opportunity Volume (League-Wide)</div>
    <div class="scheme-insight-v">${drives}</div>
    <div class="scheme-insight-sub">RZ drives per game. Volume baseline for touchdown opportunities.</div>
    <div class="scheme-insight-v" style="margin-top:7px">${plays}</div>
    <div class="scheme-insight-sub">RZ plays per game. Helps compare opportunity volume against usage concentration.</div>
  </div>`;
}

function _schemeProductionTotalsFromPayload(p){
  const fv = _schemeBuildFv(p);
  const node = _schemeSafeNode(fv, 'all', 'all', 'all');
  const groups = Array.isArray(node && node.groups) ? node.groups : [];
  const sum = { passYds:0, rushYds:0, passTD:0, rushTD:0, passAtt:0, rushAtt:0 };
  groups.forEach(g=>{
    sum.passYds += _schemeNumber(g && g.py, 0);
    sum.rushYds += _schemeNumber(g && g.ry, 0);
    sum.passTD += _schemeNumber(g && g.ptd, 0);
    sum.rushTD += _schemeNumber(g && g.rtd, 0);
    sum.passAtt += _schemeNumber(g && g.np, 0);
    sum.rushAtt += _schemeNumber(g && g.nr, 0);
  });
  sum.totalTD = sum.passTD + sum.rushTD;
  return sum;
}

function _schemeTeamOffenseProduction(season, teamCode){
  const snap = _schemeLeagueInsightSnapshot(season);
  const block = NFLVERSE && NFLVERSE[String(season)] && NFLVERSE[String(season)].coaching_scheme;
  const teams = block ? Object.keys(block) : [];
  if(!snap || !block || !teams.length || !teamCode || !block[teamCode]) return null;
  const byTeam = {};
  teams.forEach(tm=>{ byTeam[tm] = _schemeProductionTotalsFromPayload({ season:String(season), team:tm, data:block[tm] }); });
  const stats = [
    { key:'Team Total TDs', dataKey:'totalTD', digits:0, higher:true },
    { key:'Pass Yards', dataKey:'passYds', digits:0, higher:true },
    { key:'Rush Yards', dataKey:'rushYds', digits:0, higher:true },
    { key:'Pass Att', dataKey:'passAtt', digits:0, higher:true },
    { key:'Rush Att', dataKey:'rushAtt', digits:0, higher:true },
    { key:'Points/Drive', dataKey:'pointsPerDrive', digits:2, higher:true },
  ];
  return stats.map(s=>{
    const value = s.dataKey==='pointsPerDrive'
      ? (snap.rowsByTeam[teamCode] ? snap.rowsByTeam[teamCode].pointsPerDrive : null)
      : (byTeam[teamCode] ? byTeam[teamCode][s.dataKey] : null);
    const arr = teams.map(tm=> s.dataKey==='pointsPerDrive'
      ? (snap.rowsByTeam[tm] ? snap.rowsByTeam[tm].pointsPerDrive : null)
      : (byTeam[tm] ? byTeam[tm][s.dataKey] : null)).filter(Number.isFinite);
    const rank = _schemeRankInLeague(value, arr, s.higher ? 'desc' : 'asc');
    const rankCls = _schemeRankClass(rank, teams.length);
    const txt = Number.isFinite(value) ? (s.digits>0 ? value.toFixed(s.digits) : Math.round(value).toLocaleString()) : '—';
    const rv = rank ? `${txt} · league rank #${rank} of ${teams.length}` : txt;
    return { label:s.key, value, display:txt, rank, rankCls, rankText: rank ? `#${rank}` : '—', valueText:rv };
  });
}

function _schemeRenderTeamOffenseProduction(p){
  const season = String((p&&p.season) || '');
  const teamCode = String((p&&p.team) || schemeTeam || '').toUpperCase();
  const teamName = teamDisplayName(teamCode) || teamCode;
  const rows = _schemeTeamOffenseProduction(season, teamCode);
  if(!rows || !rows.length) return '';
  const cards = rows.map(r=>{
    const tagged = noteWrapHtml(`${r.display} <span class="scheme-op-rank ${r.rankCls}">(${r.rankText})</span>`, {
      label: r.label,
      value: r.valueText,
      source:'coaching_insights',
      statKey:r.label,
      context:`${teamName} team offense production · ${season}`,
      team:teamCode,
      relevance:'QB,RB,WR,TE',
      nav:{ type:'coaching', team:teamCode, season:String(season), tab:'insights' },
    }, 'note-tag-hit');
    return `<div class="scheme-op-card"><div class="scheme-op-k">${_schemeEscHtml(r.label)}</div><div class="scheme-op-v">${tagged}</div></div>`;
  }).join('');
  return `<div class="scheme-op-wrap"><div class="scheme-op-title">Team offensive production · ${_schemeEscHtml(String(season))}</div><div class="scheme-op-grid">${cards}</div></div>`;
}

function _schemeClamp(v, lo, hi){
  const n = _schemeNumber(v, 0);
  return Math.max(lo, Math.min(hi, n));
}

function _schemePosFromSlot(slot){
  const s = String(slot||'').toUpperCase();
  if(s.startsWith('WR')) return 'WR';
  if(s.startsWith('TE')) return 'TE';
  if(s.startsWith('RB') || s.startsWith('FB')) return 'RB';
  if(s.startsWith('QB')) return 'QB';
  return 'WR';
}

function _schemeNormNameToken(s){
  return String(s||'').toLowerCase()
    .replace(/[.'\-]/g,'')
    .replace(/\s+/g,' ')
    .trim();
}

function _schemePosPlayers(team, pos, season){
  const rows = [];
  const seasonRows = NFLVERSE && NFLVERSE[String(season)] && NFLVERSE[String(season)].rosters && NFLVERSE[String(season)].rosters[team];
  if(Array.isArray(seasonRows)){
    seasonRows.forEach(r=>{
      const rpos = String((r && r[1]) || '').toUpperCase();
      if(rpos !== String(pos||'').toUpperCase() && !(pos==='RB' && rpos==='FB')) return;
      rows.push({
        name: String((r && r[0]) || ''),
        player_id: String((r && r[5]) || ''),
        pos: pos,
        team,
        vol: _schemeNumber(r && r[7], 0),
      });
    });
  }
  const allowCurrentFallback = String(season||'') === String(PROJ_SEASON||'')
    || String(season||'') === String(activeSeason||'');
  if(!rows.length && allowCurrentFallback && typeof getBase==='function' && team){
    (getBase(team, pos) || []).forEach(p=>{
      rows.push({
        name: String((p && p.name) || ''),
        player_id: String((p && p.player_id) || ''),
        pos: String((p && p.pos) || pos),
        team: String((p && p.team) || team),
        vol: _schemeNumber(p && (p.receiving_targets || p.receptions || p.rushing_attempts || p.targets), 0),
      });
    });
  }
  return rows.map(p=>{
    const full = String(p.name || '').trim();
    const toks = full.split(/\s+/).filter(Boolean);
    return Object.assign({}, p, {
      first: _schemeNormNameToken(toks[0] || ''),
      last: _schemeNormNameToken(toks[toks.length-1] || ''),
      suffix: _schemeNormNameToken(toks[toks.length-1] || '').replace(/[^a-z0-9]/g,''),
      norm: _schemeNormNameToken(full),
    });
  }).filter(p=>p.name);
}

function _schemeBasePosPlayers(team, pos){
  if(typeof getBase!=='function' || !team) return [];
  const rows = [];
  (getBase(team, pos) || []).forEach(p=>{
    rows.push({
      name: String((p && p.name) || ''),
      player_id: String((p && p.player_id) || ''),
      pos: String((p && p.pos) || pos),
      team: String((p && p.team) || team),
      vol: _schemeNumber(p && (p.receiving_targets || p.receptions || p.rushing_attempts || p.targets), 0),
    });
  });
  return rows.map(p=>{
    const full = String(p.name || '').trim();
    const toks = full.split(/\s+/).filter(Boolean);
    return Object.assign({}, p, {
      first: _schemeNormNameToken(toks[0] || ''),
      last: _schemeNormNameToken(toks[toks.length-1] || ''),
      suffix: _schemeNormNameToken(toks[toks.length-1] || '').replace(/[^a-z0-9]/g,''),
      norm: _schemeNormNameToken(full),
    });
  }).filter(p=>p.name);
}

function _schemeResolveRosterPlayer(team, pos, shortName, slot, season, slotRef){
  const players = _schemePosPlayers(team, pos, season);
  const basePlayers = _schemeBasePosPlayers(team, pos);
  const slotRefKey = String(slotRef || '').trim();
  if(!players.length){
    if(basePlayers.length){
      const slotIdx = Math.max(1, parseInt(String(slot||'').replace(/\D+/g,''), 10) || 1);
      const pick = basePlayers[Math.min(slotIdx-1, basePlayers.length-1)] || basePlayers[0];
      if(pick) return pick;
    }
    return { name: String(shortName||slot||'Unknown'), player_id:'', pos, team };
  }
  const tok = _schemeNormNameToken(shortName);
  const weakTok = /^(jr|sr|ii|iii|iv|v)$/.test(tok);
  const slotIdx = Math.max(1, parseInt(String(slot||'').replace(/\D+/g,''), 10) || 1);

  if(slotRefKey){
    const byId = players.find(p=>String(p.player_id||'')===slotRefKey);
    if(byId) return byId;
  }

  if(weakTok && basePlayers.length){
    const pick = basePlayers[Math.min(slotIdx-1, basePlayers.length-1)] || basePlayers[0];
    if(pick){
      if(tok==='jr' && pick.name && !/\bjr\.?$/i.test(pick.name)){
        return Object.assign({}, pick, { name: `${pick.name} Jr.` });
      }
      return pick;
    }
  }

  let best = null;
  let bestScore = -1;
  players.forEach((p, i)=>{
    let s = 0;
    if(tok && !weakTok){
      if(p.last === tok) s += 8;
      if(p.first === tok) s += 5;
      if(p.suffix === tok) s += 6;
      if(p.norm.includes(tok)) s += 3;
      if(tok.includes(p.last) || p.last.includes(tok)) s += 2;
    }
    if(i === (slotIdx-1)) s += 0.6;
    s += Math.min(2, _schemeNumber(p.vol, 0) / 120);
    if(s > bestScore){ bestScore = s; best = p; }
  });
  if(!best){
    best = players[Math.min(slotIdx-1, players.length-1)] || players[0];
    if(weakTok && best && basePlayers.length){
      const pick = basePlayers[Math.min(slotIdx-1, basePlayers.length-1)] || basePlayers[0];
      if(pick) return pick;
    }
  }
  return best || { name: String(shortName||slot||'Unknown'), player_id:'', pos, team };
}

function _schemePlayerOnclick(p){
  const target = p.player_id || p.name;
  if(typeof pcardOnclick==='function') return pcardOnclick(target, p.pos, p.team||'');
  if(typeof openPlayerCard==='function'){
    return `openPlayerCard(${JSON.stringify(target)},${JSON.stringify(p.pos)},${JSON.stringify(p.team||'')})`;
  }
  return '';
}

function _schemePlayerHeadshot(p){
  const hasSleeper = (id)=>{
    const rid = String(id||'');
    return !!(rid && typeof sleeperPlayers!=='undefined' && sleeperPlayers && sleeperPlayers[rid]);
  };
  const byNameId = (typeof resolvePlayerId==='function')
    ? (resolvePlayerId(p.name, p.pos) || resolvePlayerId(p.name) || '')
    : '';
  const pid = hasSleeper(p.player_id) ? String(p.player_id) : (hasSleeper(byNameId) ? String(byNameId) : '');
  const hp = {
    name: p.name,
    pos: p.pos,
    team: p.team,
    player_id: pid || null,
    headshot: p.headshot || null,
  };
  if(typeof hsPack==='function'){
    const pack = hsPack(hp) || { src:'', fallbacks:[] };
    const src = String(pack.src || '');
    const fbs = Array.isArray(pack.fallbacks) ? pack.fallbacks.filter(Boolean) : [];
    if(src){
      const fbList = fbs.join('|');
      const onerr = "const l=(this.dataset.fallbacks||'').split('|').filter(Boolean);if(l.length){this.dataset.fallbacks=l.slice(1).join('|');this.src=l[0];}else{this.outerHTML='<span class=\\'scheme-benefit-hs-err\\'>NA</span>'; }";
      return `<img src="${src}" class="scheme-benefit-hs" alt="" data-fallbacks="${fbList}" loading="lazy" decoding="async" onerror="${onerr}">`;
    }
  }
  if(typeof imgTag==='function' && typeof hsURL==='function'){
    return imgTag(hsURL(hp), 'scheme-benefit-hs', 'NA');
  }
  return '<span class="scheme-benefit-hs ph"></span>';
}

function _schemeInfoTip(label, text){
  return `<details class="scheme-help" onclick="event.stopPropagation()" ontoggle="_schemePlaceHelpPopup(this)"><summary class="scheme-help-btn" aria-label="${_schemeEscHtml(label)}">i</summary><div class="scheme-help-pop"><b>${_schemeEscHtml(label)}</b><span>${_schemeEscHtml(text)}</span></div></details>`;
}

function _schemePlaceHelpPopup(detailsEl){
  const el = detailsEl;
  if(!el || !el.querySelector) return;
  const pop = el.querySelector('.scheme-help-pop');
  if(!pop) return;

  if(!el.open){
    pop.style.transform = '';
    pop.style.top = '';
    pop.style.bottom = '';
    return;
  }

  pop.style.transform = '';
  pop.style.top = '18px';
  pop.style.bottom = 'auto';

  requestAnimationFrame(()=>{
    const pad = 10;
    const rect = pop.getBoundingClientRect();
    let shiftX = 0;
    if(rect.right > (window.innerWidth - pad)) shiftX -= (rect.right - (window.innerWidth - pad));
    if((rect.left + shiftX) < pad) shiftX += (pad - (rect.left + shiftX));
    pop.style.transform = `translateX(${Math.round(shiftX)}px)`;

    const after = pop.getBoundingClientRect();
    if(after.bottom > (window.innerHeight - pad)){
      pop.style.top = 'auto';
      pop.style.bottom = '18px';
    }
  });
}

function _schemeTargetSortLabel(mode){
  if(String(mode)==='tgt') return 'Red-zone target share';
  return 'Red-zone target opportunity share';
}

function _schemeSortTargetBenefactors(list, mode){
  const rows = Array.isArray(list) ? list.slice() : [];
  if(String(mode)==='tgt'){
    return rows.sort((a,b)=>
      (_schemeNumber(b && b.tgtShare, 0) - _schemeNumber(a && a.tgtShare, 0))
      || (_schemeNumber(b && b.d3Pct, 0) - _schemeNumber(a && a.d3Pct, 0))
      || (_schemeNumber(b && b.oppShare, 0) - _schemeNumber(a && a.oppShare, 0))
      || String((a && a.name) || '').localeCompare(String((b && b.name) || ''))
    );
  }
  return rows.sort((a,b)=>
    (_schemeNumber(b && b.oppShare, 0) - _schemeNumber(a && a.oppShare, 0))
    || (_schemeNumber(b && b.tgtShare, 0) - _schemeNumber(a && a.tgtShare, 0))
    || (_schemeNumber(b && b.d3Pct, 0) - _schemeNumber(a && a.d3Pct, 0))
    || String((a && a.name) || '').localeCompare(String((b && b.name) || ''))
  );
}

function setTeamCoachingSchemeBenefactorSort(mode){
  const m = String(mode||'').toLowerCase();
  schemeBenefactorSort = (m==='tgt') ? 'tgt' : 'opp';
  if(schemeOverlayOpen && schemeTeam && schemeViewTab!=='playbook'){
    if(typeof tcPreserveViewScroll==='function') tcPreserveViewScroll(()=>_renderTeamCoachingScheme(), ['.scheme-modal']);
    else _renderTeamCoachingScheme();
  }
}

function _schemeBindSwipeClose(host){
  if(!host) return;
  const modal = host.querySelector('.scheme-modal');
  if(!modal || modal._swipeBound) return;
  modal._swipeBound = true;
  const CLOSE_AT = 90;
  let y0 = null;
  let x0 = null;
  let dy = 0;
  let dragging = false;

  const reset = (anim)=>{
    modal.style.transition = anim ? 'transform .18s ease-out, opacity .18s ease-out' : '';
    modal.style.transform = '';
    modal.style.opacity = '';
    if(anim) setTimeout(()=>{ modal.style.transition = ''; }, 200);
  };

  modal.addEventListener('touchstart', e=>{
    if(!schemeOverlayOpen || schemeViewTab!=='playbook'){ dragging=false; y0=null; x0=null; return; }
    if(e.touches.length!==1){ dragging=false; y0=null; x0=null; return; }
    const t = e.touches && e.touches[0];
    if(!t){ dragging=false; y0=null; x0=null; return; }
    y0 = t.clientY;
    x0 = t.clientX;
    dy = 0;
    dragging = true;
    modal.style.transition = '';
  }, { passive:true });
  modal.addEventListener('touchmove', e=>{
    if(!schemeOverlayOpen || schemeViewTab!=='playbook') return;
    if(!dragging || !Number.isFinite(y0) || !Number.isFinite(x0)) return;
    if(modal.scrollTop > 1) return;
    const t = e.touches && e.touches[0];
    if(!t) return;
    dy = t.clientY - y0;
    const dx = Math.abs(t.clientX - x0);
    if(dy <= 0){ modal.style.transform=''; modal.style.opacity=''; return; }
    if(dy > 20 && dy > dx * 1.25){
      // Keep the pull gesture from chaining into page refresh behind the modal.
      e.preventDefault();
      const shift = dy<CLOSE_AT ? dy*0.7 : CLOSE_AT*0.7 + (dy-CLOSE_AT)*0.35;
      modal.style.transform = `translateY(${shift.toFixed(1)}px)`;
      modal.style.opacity = String(Math.max(0.6, 1 - dy/650));
    }
  }, { passive:false });
  const finish = (e)=>{
    if(!dragging){ return; }
    dragging = false;
    const shouldTrack = schemeOverlayOpen && schemeViewTab==='playbook' && modal.scrollTop <= 1;
    if(!shouldTrack){ y0=null; x0=null; dy=0; reset(false); return; }
    const t = e.changedTouches && e.changedTouches[0];
    if(!t || !Number.isFinite(y0) || !Number.isFinite(x0)){ y0=null; x0=null; dy=0; reset(false); return; }
    const endDy = t.clientY - y0;
    const dx = Math.abs(t.clientX - x0);
    y0 = null;
    x0 = null;
    modal.style.opacity = '';
    if(endDy >= CLOSE_AT && endDy > dx * 1.25){
      closeTeamCoachingScheme();
    }else{
      reset(true);
    }
    dy = 0;
  };
  modal.addEventListener('touchend', finish, { passive:true });
  modal.addEventListener('touchcancel', finish, { passive:true });
}

function _schemeBackButtonHtml(){
  if(!Array.isArray(_schemeNavStack) || !_schemeNavStack.length) return '';
  return `<button class="scheme-back" onclick="backTeamCoachingScheme()" aria-label="Back">← Back</button>`;
}

// ── Actual red-zone usage (real Sleeper logs) ──────────────────────────────
// The modeled benefactor builders below split formation/route charting evenly across
// receivers, which massively over-credits players who are merely ON THE FIELD a lot
// (e.g. a blocking TE) versus the real target hog. These functions instead pull the
// ACTUAL per-player red-zone target/carry logs (rec_rz_tgt / rush_rz_att) — the same
// data shown on the player card — and compute true team red-zone shares.
let _schemeRzUsageCache = {};    // `${season}:${TEAM}` -> {loaded, targets, carries, meta, teamTgt, teamAtt}
let _schemeRzUsagePromise = {};  // `${season}:${TEAM}` -> Promise

function _schemeRosterSkillPlayers(team, season){
  const seen = new Set();
  const out = [];
  ['WR','TE','RB'].forEach(pos=>{
    (_schemePosPlayers(team, pos, season) || []).forEach(pl=>{
      const pid = String((pl && pl.player_id) || '');
      if(!pid || seen.has(pid)) return;
      seen.add(pid);
      out.push({ player_id: pid, name: String((pl && pl.name) || ''), pos });
    });
  });
  return out;
}

// Fetch weekly logs for every skill player on the team's roster and sum their actual
// red-zone targets (rec_rz_tgt) and red-zone carries (rush_rz_att) for the season.
// Season totals are used (unfiltered by team code) so they line up exactly with the
// per-player season totals on the player card, which is the source the user compares to.
async function _schemeEnsureRzUsage(team, season){
  const tm = String(team || '').toUpperCase();
  const key = `${season}:${tm}`;
  if(_schemeRzUsageCache[key]) return _schemeRzUsageCache[key];
  if(_schemeRzUsagePromise[key]) return _schemeRzUsagePromise[key];
  _schemeRzUsagePromise[key] = (async()=>{
    let roster = [];
    try{ roster = _schemeRosterSkillPlayers(tm, season); }catch(e){ roster = []; }
    const targets = {};
    const carries = {};
    const recTds = {};
    const rushTds = {};
    const meta = {};
    if(roster.length && typeof fetchPlayerWeekly==='function'){
      const results = await Promise.allSettled(
        roster.map(p=>fetchPlayerWeekly(p.player_id, season).then(w=>({ p, weekly:w })))
      );
      results.forEach(r=>{
        if(r.status!=='fulfilled' || !r.value || !r.value.weekly) return;
        const p = r.value.p;
        const weekly = r.value.weekly;
        let rzTgt = 0, rzAtt = 0, recTd = 0, rushTd = 0;
        for(const wk in weekly){
          const row = weekly[wk];
          if(!row || typeof row!=='object') continue;
          const s = row.stats || {};
          rzTgt += s.rec_rz_tgt || 0;
          rzAtt += s.rush_rz_att || 0;
          recTd += s.rec_td || 0;
          rushTd += s.rush_td || 0;
        }
        if(rzTgt > 0) targets[p.player_id] = rzTgt;
        if(rzAtt > 0) carries[p.player_id] = rzAtt;
        // TDs + full meta captured for every player with any RZ opportunity so the
        // Regression tab can compare actual TDs to their red-zone workload.
        if(rzTgt > 0 || rzAtt > 0){
          recTds[p.player_id] = recTd;
          rushTds[p.player_id] = rushTd;
          meta[p.player_id] = { name: p.name, pos: p.pos, rzTgt, rzAtt, recTd, rushTd };
        }
      });
    }
    const teamTgt = Object.values(targets).reduce((a,b)=>a+b,0);
    const teamAtt = Object.values(carries).reduce((a,b)=>a+b,0);
    const teamRecTd = Object.values(recTds).reduce((a,b)=>a+b,0);
    const teamRushTd = Object.values(rushTds).reduce((a,b)=>a+b,0);
    const snap = { loaded:true, targets, carries, recTds, rushTds, meta, teamTgt, teamAtt, teamRecTd, teamRushTd };
    _schemeRzUsageCache[key] = snap;
    return snap;
  })();
  return _schemeRzUsagePromise[key];
}

// Turn a usage snapshot into ranked rows with real shares:
//   tgtShare  = player RZ targets ÷ team RZ targets
//   rushShare = player RZ carries ÷ team RZ carries
//   oppShare  = player RZ touches (tgt+carry) ÷ team RZ touches  (the fantasy money metric)
function _schemeBuildActualBenefactors(snap, teamCode){
  const meta = (snap && snap.meta) || {};
  const targets = (snap && snap.targets) || {};
  const carries = (snap && snap.carries) || {};
  const teamTgt = (snap && snap.teamTgt) || 0;
  const teamAtt = (snap && snap.teamAtt) || 0;
  const teamTouch = teamTgt + teamAtt;
  const ids = new Set([...Object.keys(targets), ...Object.keys(carries)]);
  const rows = [];
  ids.forEach(pid=>{
    const m = meta[pid] || {};
    const rzTgt = targets[pid] || 0;
    const rzAtt = carries[pid] || 0;
    const touches = rzTgt + rzAtt;
    rows.push({
      name: m.name || pid,
      pos: m.pos || '',
      player_id: pid,
      team: teamCode,
      rzTgt, rzAtt, touches,
      tgtShare: teamTgt > 0 ? (100 * rzTgt / teamTgt) : 0,
      rushShare: teamAtt > 0 ? (100 * rzAtt / teamAtt) : 0,
      oppShare: teamTouch > 0 ? (100 * touches / teamTouch) : 0,
    });
  });
  return rows;
}

function _schemeRenderActualBenefactorList(title, subtitle, list, teamCode, season, kind){
  if(!list || !list.length){
    return `<div class="scheme-benefactors-wrap">
      <div class="scheme-benefactors-title">${_schemeEscHtml(title)}</div>
      <div class="scheme-empty">No red-zone ${kind==='rush'?'carry':'target'} logs for this season/team.</div>
    </div>`;
  }
  const rows = list.map((p, i)=>{
    const click = _schemePlayerOnclick(p);
    const notePlayer = (p.player_id || p.name) ? noteTargetFromArgs(p.player_id || p.name, p.pos || '', teamCode) : null;
    const ctx = `${teamDisplayName(teamCode)} red-zone usage · ${season}`;
    const chipMeta = (label, value, statKey)=>({ label, value, source:'coaching_insights', statKey, context:ctx, player:notePlayer, team:teamCode, relevance:'QB,RB,WR,TE', nav:{ type:'coaching', team:teamCode, season:String(season), tab:'insights' } });
    const chips = `<span class="scheme-benefit-splits">
      <span class="scheme-benefit-split">${noteWrapHtml(`<b>TGT </b><span>${p.rzTgt} · ${p.tgtShare.toFixed(1)}%</span>`, chipMeta('RZ target share', `${p.rzTgt} RZ targets · ${p.tgtShare.toFixed(1)}% of team RZ targets`, 'rz_target_share'), 'note-tag-hit')}</span>
      <span class="scheme-benefit-split">${noteWrapHtml(`<b>CARR </b><span>${p.rzAtt} · ${p.rushShare.toFixed(1)}%</span>`, chipMeta('RZ carry share', `${p.rzAtt} RZ carries · ${p.rushShare.toFixed(1)}% of team RZ carries`, 'rz_carry_share'), 'note-tag-hit')}</span>
      <span class="scheme-benefit-split">${noteWrapHtml(`<b>OPP </b><span>${p.touches} · ${p.oppShare.toFixed(1)}%</span>`, chipMeta('RZ opportunity share', `${p.touches} RZ touches · ${p.oppShare.toFixed(1)}% of team RZ touches`, 'rz_opp_share'), 'note-tag-hit')}</span>
    </span>`;
    const useOpp = (kind!=='rush') && (schemeBenefactorSort==='opp');
    const scoreVal = kind==='rush' ? p.rushShare : (useOpp ? p.oppShare : p.tgtShare);
    const scoreLbl = kind==='rush' ? 'RZ RUSH' : (useOpp ? 'RZ OPP' : 'RZ TGT');
    const reason = kind==='rush'
      ? `${p.rzAtt} red-zone carr${p.rzAtt===1?'y':'ies'} · ${p.rushShare.toFixed(1)}% of team RZ carries · ${p.touches} total RZ touches (${p.oppShare.toFixed(1)}% opp share).`
      : `${p.rzTgt} red-zone target${p.rzTgt===1?'':'s'} · ${p.tgtShare.toFixed(1)}% of team RZ targets · ${p.touches} total RZ touches (${p.oppShare.toFixed(1)}% opp share).`;
    const headClick = click ? `role="button" tabindex="0" title="Open player card" onclick="event.stopPropagation();${click}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();${click}}"` : '';
    const scoreHtml = noteWrapHtml(`${scoreLbl} ${scoreVal.toFixed(1)}%`, chipMeta(`${title} leader`, `${p.rzTgt} RZ tgt · ${p.rzAtt} RZ carr · ${p.touches} RZ touches`, 'rz_leader'), 'note-tag-hit');
    const metaHtml = noteWrapHtml(`${_schemeEscHtml(p.pos)} · ${p.rzTgt} RZ tgt · ${p.rzAtt} RZ carr`, chipMeta(`${title} role`, `${p.pos} · ${p.rzTgt} RZ targets · ${p.rzAtt} RZ carries`, 'rz_role'), 'note-tag-hit');
    return `<div class="scheme-benefit-row">
      <span class="scheme-benefit-rank">${i+1}</span>
      <span class="scheme-benefit-head scheme-benefit-head-btn" ${headClick}>${_schemePlayerHeadshot(p)}</span>
      <span class="scheme-benefit-main">
        <span class="scheme-benefit-name">${_schemeEscHtml(p.name)}</span>
        <span class="scheme-benefit-meta">${metaHtml}</span>
        ${chips}
      </span>
      <span class="scheme-benefit-score">${scoreHtml}</span>
      <span class="scheme-benefit-why">${_schemeEscHtml(reason)}</span>
    </div>`;
  }).join('');
  return `<div class="scheme-benefactors-wrap">
    <div class="scheme-benefactors-title">${_schemeEscHtml(title)} <span>${_schemeEscHtml(subtitle)}</span></div>
    <div class="scheme-benefit-list">${rows}</div>
  </div>`;
}

// Returns rendered HTML for the actual-data leader lists, or null when there are no
// real red-zone logs for this season/team (caller then falls back to the modeled view).
function _schemeRenderActualBenefactors(snap, teamCode, season){
  const hasData = ((snap && snap.teamTgt) || 0) > 0 || ((snap && snap.teamAtt) || 0) > 0;
  if(!hasData) return null;
  const all = _schemeBuildActualBenefactors(snap, teamCode);
  const targetSort = (schemeBenefactorSort === 'tgt') ? 'tgt' : 'opp';
  const targetRows = all.filter(r=>r.rzTgt > 0)
    .sort((a,b)=> targetSort==='tgt'
      ? ((b.tgtShare - a.tgtShare) || (b.oppShare - a.oppShare))
      : ((b.oppShare - a.oppShare) || (b.tgtShare - a.tgtShare)))
    .slice(0, 8);
  const rushRows = all.filter(r=>r.rzAtt > 0)
    .sort((a,b)=> (b.rushShare - a.rushShare) || (b.oppShare - a.oppShare))
    .slice(0, 6);
  const tip = _schemeInfoTip(
    'Red-zone usage (actual)',
    "Real inside-the-20 target and carry logs from Sleeper weekly data — not modeled from formations. Target share = a player's RZ targets ÷ team RZ targets. Opportunity share = (RZ targets + RZ carries) ÷ team RZ touches, which is the best single read on who actually gets the ball near the goal line (great for dual-threat backs and target hogs)."
  );
  const controls = `<div class="scheme-benefit-sort" role="group" aria-label="Sort red-zone leaders">
    <span class="scheme-benefit-sort-label">Sort target leaders by ${tip}</span>
    <button type="button" class="scheme-benefit-sort-btn ${targetSort==='tgt'?'active':''}" onclick="event.stopPropagation();setTeamCoachingSchemeBenefactorSort('tgt')">RZ target share</button>
    <button type="button" class="scheme-benefit-sort-btn ${targetSort==='opp'?'active':''}" onclick="event.stopPropagation();setTeamCoachingSchemeBenefactorSort('opp')">RZ opportunity share</button>
  </div>`;
  const tgtList = _schemeRenderActualBenefactorList(
    'Red-Zone Target Leaders',
    `actual RZ target logs · team ${snap.teamTgt} RZ targets · ${targetSort==='opp'?'sorted by opportunity (touch) share':'sorted by target share'}`,
    targetRows, teamCode, season, 'target'
  );
  const rushList = _schemeRenderActualBenefactorList(
    'Red-Zone Rushing Leaders',
    `actual RZ carry logs · team ${snap.teamAtt} RZ carries · sorted by carry share`,
    rushRows, teamCode, season, 'rush'
  );
  return `${controls}${tgtList}${rushList}`;
}

// ── Tab id normalization (Playbook / Red Zone / Regression / Scheme) ───────
// Legacy note-nav and saved sessions may reference the old 'insights' id — treat it
// as an alias for the renamed 'redzone' tab so nothing breaks.
function _schemeNormTab(t){
  const s = String(t || '').toLowerCase();
  if(s==='insights' || s==='redzone' || s==='red_zone') return 'redzone';
  if(s==='regression') return 'regression';
  if(s==='scheme') return 'scheme';
  return 'playbook';
}

// Trigger the async Sleeper RZ-usage fetch (once) and return the cached snapshot (or null).
// Any insight tab (redzone/regression) can call this; the modal re-renders when it lands.
function _schemeRzTrigger(teamCode, season){
  const key = `${season}:${teamCode}`;
  const snap = _schemeRzUsageCache[key];
  if(!snap && teamCode && !_schemeRzUsagePromise[key]){
    _schemeEnsureRzUsage(teamCode, season).then(()=>{
      if(schemeOverlayOpen && schemeViewTab!=='playbook' && String(schemeTeam||'').toUpperCase()===teamCode){
        if(typeof tcPreserveViewScroll==='function') tcPreserveViewScroll(()=>_renderTeamCoachingScheme(), ['.scheme-modal']);
        else _renderTeamCoachingScheme();
      }
    });
  }
  return snap;
}

// ── Red-zone TD source (real nflverse pbp production) ──────────────────────
// Personnel identity naming — matches the playbook's `${g.p} PERSONNEL` label (11 = 1RB/1TE/3WR,
// 12 = 1RB/2TE/2WR, 21 = 2RB/1TE/2WR, etc). Falls back to composing the code from RB/TE counts
// when the personnel string is missing/odd.
function _schemePersonnelName(g){
  const p = String((g && g.p) || '').trim();
  if(/^\d{2}$/.test(p)) return `${p} personnel`;
  const b = _schemeNumber(g && g.backs, 0);
  const t = _schemeNumber(g && g.te, 0);
  return `${b}${t} personnel`;
}
function _schemePersonnelDetail(g){
  return `${_schemeNumber(g && g.backs,0)}RB ${_schemeNumber(g && g.te,0)}TE ${_schemeNumber(g && g.wr,0)}WR`;
}

// League-wide scheme snapshot (pass rate, PA/motion/no-huddle rates, RZ TD air%, and per-personnel
// usage share) so every scheme metric can carry an NFL rank. Cached per season; one build pass.
let _schemeSchemeLeagueCache = {};
function _schemeSchemeLeague(season){
  const s = String(season || '');
  if(!s) return null;
  if(_schemeSchemeLeagueCache[s]) return _schemeSchemeLeagueCache[s];
  const block = NFLVERSE && NFLVERSE[s] && NFLVERSE[s].coaching_scheme;
  const teams = block ? Object.keys(block) : [];
  if(!teams.length) return null;
  const byTeam = {};
  const passRate = [], paRate = [], motionRate = [], nohuddleRate = [], rzAir = [];
  const persShare = {};
  teams.forEach(tm=>{
    const pp = { season:s, team:tm, data:block[tm] };
    const sp = _schemeSchemeProfile(pp);
    const sc = _schemeRzScoring(pp);
    const air = sc.totalTD ? (100 * sc.passTD / sc.totalTD) : null;
    byTeam[tm] = { sp, air };
    if(Number.isFinite(sp.passRate)) passRate.push(sp.passRate);
    if(Number.isFinite(sp.paRate)) paRate.push(sp.paRate);
    if(Number.isFinite(sp.motionRate)) motionRate.push(sp.motionRate);
    if(Number.isFinite(sp.nohuddleRate)) nohuddleRate.push(sp.nohuddleRate);
    if(Number.isFinite(air)) rzAir.push(air);
    (sp.persList || []).forEach(r=>{ (persShare[r.key] = persShare[r.key] || []).push(r.share); });
  });
  const snap = { teams: teams.length, byTeam, passRate, paRate, motionRate, nohuddleRate, rzAir, persShare };
  _schemeSchemeLeagueCache[s] = snap;
  return snap;
}

// Sums pass/rush TDs from the red-zone formation charting, by down and by personnel,
// so we can see WHERE this offense's touchdown equity lives: air vs ground, which
// personnel package, which down. (Validated: e.g. CIN 2024 = 30 pass / 9 rush RZ TDs.)
function _schemeRzScoring(p){
  const fv = _schemeBuildFv(p);
  const byDown = {};
  let passTD = 0, rushTD = 0, passPlays = 0, runPlays = 0;
  ['1','2','3','4'].forEach(dn=>{
    const node = _schemeSafeNode(fv, dn, 'all', 'redzone');
    let ptd=0, rtd=0, np=0, nr=0;
    (node.groups||[]).forEach(g=>{ ptd+=_schemeNumber(g.ptd,0); rtd+=_schemeNumber(g.rtd,0); np+=_schemeNumber(g.np,0); nr+=_schemeNumber(g.nr,0); });
    byDown[dn] = { ptd, rtd, np, nr };
    passTD+=ptd; rushTD+=rtd; passPlays+=np; runPlays+=nr;
  });
  const allNode = _schemeSafeNode(fv, 'all', 'all', 'redzone');
  const allPtd = (allNode.groups||[]).reduce((t,g)=>t+_schemeNumber(g.ptd,0),0);
  const allRtd = (allNode.groups||[]).reduce((t,g)=>t+_schemeNumber(g.rtd,0),0);
  // Prefer the down-split sum, but never under-count vs the all-node total.
  if((passTD+rushTD) < (allPtd+allRtd)){ passTD=allPtd; rushTD=allRtd; }
  const pers = {};
  (allNode.groups||[]).forEach(g=>{
    const key = _schemePersonnelName(g);
    const detail = _schemePersonnelDetail(g);
    const rec = (pers[key] = pers[key] || { key, detail, td:0, ptd:0, rtd:0, n:0 });
    rec.ptd += _schemeNumber(g.ptd,0);
    rec.rtd += _schemeNumber(g.rtd,0);
    rec.td  += _schemeNumber(g.ptd,0) + _schemeNumber(g.rtd,0);
    rec.n   += _schemeNumber(g.n,0);
  });
  const persList = Object.values(pers).filter(r=>r.td>0).sort((a,b)=>b.td-a.td).slice(0,4);
  return { byDown, passTD, rushTD, totalTD:passTD+rushTD, passPlays, runPlays, persList };
}

function _schemeRenderRzTdSource(p){
  const s = _schemeRzScoring(p);
  if(!s || s.totalTD<=0) return '';
  const teamCode = String((p&&p.team)||schemeTeam||'').toUpperCase();
  const season = String((p&&p.season)||advTeamSeason()||'');
  const ctx = `${teamDisplayName(teamCode)} red-zone TD source · ${season}`;
  const tag = (html, label, value, statKey)=>noteWrapHtml(html, { label, value, source:'coaching_insights', statKey, context:ctx, team:teamCode, relevance:'QB,RB,WR,TE', nav:{ type:'coaching', team:teamCode, season, tab:'redzone' } }, 'note-tag-hit');
  const airPct = s.totalTD? Math.round(100*s.passTD/s.totalTD):0;
  const grPct = 100-airPct;
  const lg = _schemeSchemeLeague(season);
  const nT = lg? lg.teams : 0;
  const airRank = (lg && s.totalTD)? _schemeRankInLeague(100*s.passTD/s.totalTD, lg.rzAir, 'desc') : null;
  const grRank  = (lg && s.totalTD)? _schemeRankInLeague(100*s.passTD/s.totalTD, lg.rzAir, 'asc')  : null;
  const rkTxt = r => (r&&nT)? `${_schemeOrdinal(r)} of ${nT}` : '';
  const dl = {1:'1st',2:'2nd',3:'3rd',4:'4th'};
  const downCells = ['1','2','3','4'].map(dn=>{
    const b=s.byDown[dn]||{ptd:0,rtd:0};
    const td=b.ptd+b.rtd;
    return `<div class="scheme-op-card"><div class="scheme-op-k">${dl[dn]} down</div><div class="scheme-op-v">${tag(`${td} <span class="scheme-insight-rank neutral">(${b.ptd}p / ${b.rtd}r)</span>`, `${dl[dn]}-down RZ TDs`, `${td} RZ TDs on ${dl[dn]} down (${b.ptd} pass, ${b.rtd} rush)`, 'rz_td_down_'+dn)}</div></div>`;
  }).join('');
  const persCells = s.persList.map(r=>`<div class="scheme-op-card"><div class="scheme-op-k">${_schemeEscHtml(r.key)}${r.detail?` <span style="font-weight:700;color:#8a8470">${_schemeEscHtml(r.detail)}</span>`:''}</div><div class="scheme-op-v">${tag(`${r.td} <span class="scheme-insight-rank neutral">(${r.ptd}p / ${r.rtd}r)</span>`, `${r.key} RZ TDs`, `${r.td} RZ TDs from ${r.key}${r.detail?` (${r.detail})`:''} (${r.ptd} pass, ${r.rtd} rush)`, 'rz_td_pers')}</div></div>`).join('');
  return `<div class="scheme-op-wrap">
    <div class="scheme-op-title">Red-Zone TD Source · ${_schemeEscHtml(season)}</div>
    <div class="scheme-insights-grid" style="margin-bottom:8px">
      <div class="scheme-insight-card"><div class="scheme-insight-k">Through the air</div><div class="scheme-insight-v">${tag(`${airPct}% <span class="scheme-insight-rank neutral">(${airRank?`${rkTxt(airRank)} · `:''}${s.passTD} pass TD)</span>`, 'RZ TDs through the air', `${airPct}% of RZ TDs via pass${airRank?` — ${rkTxt(airRank)} most pass-heavy`:''} (${s.passTD} pass TDs)`, 'rz_td_air')}</div><div class="scheme-insight-sub">Share of red-zone TDs scored passing. Higher ⇒ pass-catchers own the TD equity.</div></div>
      <div class="scheme-insight-card"><div class="scheme-insight-k">On the ground</div><div class="scheme-insight-v">${tag(`${grPct}% <span class="scheme-insight-rank neutral">(${grRank?`${rkTxt(grRank)} · `:''}${s.rushTD} rush TD)</span>`, 'RZ TDs on the ground', `${grPct}% of RZ TDs via rush${grRank?` — ${rkTxt(grRank)} most ground-heavy`:''} (${s.rushTD} rush TDs)`, 'rz_td_ground')}</div><div class="scheme-insight-sub">Share of red-zone TDs scored rushing. Higher ⇒ the goal-line back carries more value.</div></div>
    </div>
    <div class="scheme-op-title" style="font-size:11px">TDs by down (pass / rush)</div>
    <div class="scheme-op-grid">${downCells}</div>
    ${persCells?`<div class="scheme-op-title" style="font-size:11px;margin-top:8px">Top scoring personnel</div><div class="scheme-op-grid">${persCells}</div>`:''}
  </div>`;
}

// ── Scheme identity (pass tendency, play-action, motion, tempo, personnel) ──
function _schemeSchemeProfile(p){
  const fv = _schemeBuildFv(p);
  const sumNode = node=>{ let np=0,nr=0,n=0,epaW=0; (node.groups||[]).forEach(g=>{ np+=_schemeNumber(g.np,0); nr+=_schemeNumber(g.nr,0); n+=_schemeNumber(g.n,0); epaW+=_schemeNumber(g.epa,0)*_schemeNumber(g.n,0); }); return { np, nr, n, epa: n?epaW/n:null }; };
  const allNode = _schemeSafeNode(fv,'all','all','all');
  const totalPlays = _schemeNumber(allNode.total,0) || sumNode(allNode).n;
  const all = sumNode(allNode);
  const passRate = (all.np+all.nr)? 100*all.np/(all.np+all.nr):null;
  const byDown = {};
  ['1','2','3'].forEach(dn=>{ const sd=sumNode(_schemeSafeNode(fv,dn,'all','all')); byDown[dn]=(sd.np+sd.nr)?100*sd.np/(sd.np+sd.nr):null; });
  const typeTotal = key=>{ const node=_schemeSafeNode(fv,'all','all',key); return _schemeNumber(node.total,0) || sumNode(node).n; };
  const paNode = _schemeSafeNode(fv,'all','all','pa');
  const pa = sumNode(paNode);
  const paRate = totalPlays? 100*(_schemeNumber(paNode.total,0)||pa.n)/totalPlays:null;
  const paEpa = pa.epa;
  const motionRate = totalPlays? 100*typeTotal('motion')/totalPlays:null;
  const nohuddleRate = totalPlays? 100*typeTotal('nohuddle')/totalPlays:null;
  const pers = {};
  (allNode.groups||[]).forEach(g=>{ const key=_schemePersonnelName(g); const detail=_schemePersonnelDetail(g); const rec=(pers[key]=pers[key]||{key,detail,n:0,np:0,nr:0,epaW:0}); rec.n+=_schemeNumber(g.n,0); rec.np+=_schemeNumber(g.np,0); rec.nr+=_schemeNumber(g.nr,0); rec.epaW+=_schemeNumber(g.epa,0)*_schemeNumber(g.n,0); });
  const persList = Object.values(pers).map(r=>({ key:r.key, detail:r.detail, share: totalPlays?100*r.n/totalPlays:0, passRate:(r.np+r.nr)?100*r.np/(r.np+r.nr):null, epa:r.n?r.epaW/r.n:null, n:r.n })).sort((a,b)=>b.share-a.share).slice(0,5);
  return { totalPlays, passRate, byDown, paRate, paEpa, motionRate, nohuddleRate, persList };
}

function _schemeRenderScheme(p){
  const sp = _schemeSchemeProfile(p);
  const teamCode=String((p&&p.team)||schemeTeam||'').toUpperCase();
  const teamName=teamDisplayName(teamCode)||teamCode;
  const season=String((p&&p.season)||advTeamSeason()||'');
  if(!sp || !sp.totalPlays) return `<div class="scheme-insights-wrap"><div class="scheme-empty">No scheme charting available for this season/team.</div></div>`;
  const ctx=`${teamName} scheme identity · ${season}`;
  const tag=(html,label,value,statKey)=>noteWrapHtml(html,{label,value,source:'coaching_insights',statKey,context:ctx,team:teamCode,relevance:'QB,RB,WR,TE',nav:{type:'coaching',team:teamCode,season,tab:'scheme'}},'note-tag-hit');
  const pct=v=>Number.isFinite(v)?`${v.toFixed(1)}%`:'—';
  const epaTxt=v=>Number.isFinite(v)?(v>=0?`+${v.toFixed(2)}`:v.toFixed(2)):'—';
  const cards=`<div class="scheme-insights-grid">
    <div class="scheme-insight-card"><div class="scheme-insight-k">Pass rate</div><div class="scheme-insight-v">${tag(pct(sp.passRate),'Pass rate',`${pct(sp.passRate)} overall pass rate`,'pass_rate')}</div><div class="scheme-insight-sub">Overall pass tendency. 1st ${pct(sp.byDown['1'])} · 2nd ${pct(sp.byDown['2'])} · 3rd ${pct(sp.byDown['3'])}.</div></div>
    <div class="scheme-insight-card"><div class="scheme-insight-k">Play-action rate</div><div class="scheme-insight-v">${tag(`${pct(sp.paRate)} <span class="scheme-insight-rank neutral">(EPA ${epaTxt(sp.paEpa)})</span>`,'Play-action rate',`${pct(sp.paRate)} play-action rate · ${epaTxt(sp.paEpa)} EPA/play`,'pa_rate')}</div><div class="scheme-insight-sub">PA volume + efficiency. High PA lifts deep-shot WRs and QB efficiency.</div></div>
    <div class="scheme-insight-card"><div class="scheme-insight-k">Pre-snap motion</div><div class="scheme-insight-v">${tag(pct(sp.motionRate),'Motion rate',`${pct(sp.motionRate)} of plays use pre-snap motion`,'motion_rate')}</div><div class="scheme-insight-sub">Motion usage schemes easy touches / YAC for movement players.</div></div>
    <div class="scheme-insight-card"><div class="scheme-insight-k">No-huddle rate</div><div class="scheme-insight-v">${tag(pct(sp.nohuddleRate),'No-huddle rate',`${pct(sp.nohuddleRate)} of plays run no-huddle`,'nohuddle_rate')}</div><div class="scheme-insight-sub">Tempo. More no-huddle ⇒ more total plays and volume for everyone.</div></div>
  </div>`;
  const persCards = sp.persList.map(r=>`<div class="scheme-op-card"><div class="scheme-op-k">${_schemeEscHtml(r.key)}</div><div class="scheme-op-v">${tag(`${r.share.toFixed(0)}% <span class="scheme-insight-rank neutral">${pct(r.passRate)} pass</span>`, `${r.key} usage`, `${r.share.toFixed(1)}% of snaps · ${pct(r.passRate)} pass · ${epaTxt(r.epa)} EPA`, 'personnel_share')}</div></div>`).join('');
  return `<div class="scheme-insights-wrap">
    <div class="scheme-insights-head"><span class="scheme-insights-pill neutral">Scheme Identity</span><span class="scheme-insights-sample">${Math.round(sp.totalPlays)} offensive plays charted</span></div>
    ${cards}
    ${persCards?`<div class="scheme-op-wrap"><div class="scheme-op-title">Personnel identity (share · pass rate)</div><div class="scheme-op-grid">${persCards}</div></div>`:''}
  </div>`;
}

// ── TD regression (Sleeper RZ workload vs actual TDs) ──────────────────────
// Compares each player's actual season TDs to what their red-zone workload implies,
// using this offense's own TD-per-RZ-opportunity rate (so Σexpected == Σactual).
function _schemeBuildRegression(snap){
  const meta=(snap&&snap.meta)||{};
  const rows=[];
  let teamOpp=0, teamTD=0;
  Object.keys(meta).forEach(pid=>{
    const m=meta[pid]||{};
    const opp=(m.rzTgt||0)+(m.rzAtt||0);
    const td=(m.recTd||0)+(m.rushTd||0);
    if(opp<=0) return;
    teamOpp+=opp; teamTD+=td;
    rows.push({ player_id:pid, name:m.name||pid, pos:m.pos||'', rzTgt:m.rzTgt||0, rzAtt:m.rzAtt||0, opp, td });
  });
  const rate = teamOpp>0? teamTD/teamOpp : 0;
  rows.forEach(r=>{ r.exp = r.opp*rate; r.delta = r.td - r.exp; });
  return { rows, rate, teamOpp, teamTD };
}

function _schemeRegFlagStyle(flag){
  if(flag==='buy') return 'background:rgba(52,211,153,.18);color:#34d399';
  if(flag==='sell') return 'background:rgba(248,113,113,.18);color:#f87171';
  return 'background:rgba(148,163,184,.15);color:var(--muted)';
}

function _schemeRenderRegression(p){
  const teamCode=String((p&&p.team)||schemeTeam||'').toUpperCase();
  const teamName=teamDisplayName(teamCode)||teamCode;
  const season=String((p&&p.season)||advTeamSeason()||'');
  const snap=_schemeRzTrigger(teamCode, season);
  if(!snap){
    return `<div class="scheme-insights-wrap"><div class="scheme-benefactors-wrap"><div class="scheme-benefactors-title">TD Regression</div><div class="scheme-empty">Loading actual red-zone &amp; touchdown logs…</div></div></div>`;
  }
  const reg=_schemeBuildRegression(snap);
  if(!reg.rows.length || reg.teamOpp<=0){
    return `<div class="scheme-insights-wrap"><div class="scheme-benefactors-wrap"><div class="scheme-benefactors-title">TD Regression</div><div class="scheme-empty">No red-zone opportunity logs for this season/team.</div></div></div>`;
  }
  const tip=_schemeInfoTip('TD regression', "Compares each player's actual season touchdowns to what their red-zone workload (targets + carries) implies, using this offense's own TD-per-RZ-opportunity rate. Under-scorers are positive-regression buy-low candidates; over-scorers are TD-dependent sell-high risks. Season TDs (most come from close range).");
  const rowHtml=(r,i)=>{
    const click=_schemePlayerOnclick(r);
    const notePlayer=(r.player_id||r.name)?noteTargetFromArgs(r.player_id||r.name,r.pos||'',teamCode):null;
    const ctx=`${teamName} TD regression · ${season}`;
    const cm=(label,value,statKey)=>({label,value,source:'coaching_insights',statKey,context:ctx,player:notePlayer,team:teamCode,relevance:'QB,RB,WR,TE',nav:{type:'coaching',team:teamCode,season,tab:'regression'}});
    const flag = r.delta>=1?'sell':(r.delta<=-1?'buy':'neutral');
    const flagTxt = flag==='sell'?'TD-dependent':(flag==='buy'?'Buy-low':'Efficient');
    const dSign=r.delta>=0?'+':'';
    const chips=`<span class="scheme-benefit-splits">
      <span class="scheme-benefit-split">${noteWrapHtml(`<b>OPP </b><span>${r.opp}</span>`, cm('RZ opportunities',`${r.opp} RZ touches (${r.rzTgt} tgt, ${r.rzAtt} carr)`,'reg_opp'),'note-tag-hit')}</span>
      <span class="scheme-benefit-split">${noteWrapHtml(`<b>TD </b><span>${r.td}</span>`, cm('Actual TDs',`${r.td} actual season TDs`,'reg_td'),'note-tag-hit')}</span>
      <span class="scheme-benefit-split">${noteWrapHtml(`<b>xTD </b><span>${r.exp.toFixed(1)}</span>`, cm('Expected TDs',`${r.exp.toFixed(1)} expected TDs from RZ workload`,'reg_xtd'),'note-tag-hit')}</span>
    </span>`;
    const headClick=click?`role="button" tabindex="0" title="Open player card" onclick="event.stopPropagation();${click}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();${click}}"`:'';
    const scoreHtml=noteWrapHtml(`${dSign}${r.delta.toFixed(1)}`, cm('TD regression delta',`${dSign}${r.delta.toFixed(1)} TDs vs expected · ${flagTxt}`,'reg_delta'),'note-tag-hit');
    const reason= flag==='buy'?`${r.td} TD on ${r.opp} RZ touches — ${Math.abs(r.delta).toFixed(1)} below workload-implied. Positive-regression buy-low.`
      : flag==='sell'?`${r.td} TD on ${r.opp} RZ touches — ${r.delta.toFixed(1)} above workload-implied. TD-dependent, regression risk.`
      : `${r.td} TD on ${r.opp} RZ touches — roughly in line with workload.`;
    return `<div class="scheme-benefit-row">
      <span class="scheme-benefit-rank">${i+1}</span>
      <span class="scheme-benefit-head scheme-benefit-head-btn" ${headClick}>${_schemePlayerHeadshot(r)}</span>
      <span class="scheme-benefit-main">
        <span class="scheme-benefit-name">${_schemeEscHtml(r.name)} <span style="font-size:9px;padding:1px 5px;border-radius:6px;font-weight:700;${_schemeRegFlagStyle(flag)}">${flagTxt}</span></span>
        <span class="scheme-benefit-meta">${_schemeEscHtml(r.pos)} · ${r.rzTgt} RZ tgt · ${r.rzAtt} RZ carr</span>
        ${chips}
      </span>
      <span class="scheme-benefit-score">${scoreHtml}</span>
      <span class="scheme-benefit-why">${_schemeEscHtml(reason)}</span>
    </div>`;
  };
  const buys=reg.rows.filter(r=>r.opp>=4 && r.delta<=-1).sort((a,b)=>a.delta-b.delta).slice(0,6);
  const sells=reg.rows.filter(r=>r.opp>=4 && r.delta>=1).sort((a,b)=>b.delta-a.delta).slice(0,6);
  const list=(title,sub,rows)=> rows.length? `<div class="scheme-benefactors-wrap"><div class="scheme-benefactors-title">${title} <span>${sub}</span></div><div class="scheme-benefit-list">${rows.map(rowHtml).join('')}</div></div>`:'';
  const empty = (!buys.length && !sells.length) ? `<div class="scheme-benefactors-wrap"><div class="scheme-empty">No strong over/under-performers — this offense's RZ scoring closely matches workload.</div></div>`:'';
  return `<div class="scheme-insights-wrap">
    <div class="scheme-insights-head"><span class="scheme-insights-pill neutral">TD Regression ${tip}</span><span class="scheme-insights-sample">${reg.teamTD} team TDs · ${reg.teamOpp} RZ touches · ${reg.rate.toFixed(2)} TD/opp</span></div>
    ${list('Buy-Low — under-scored RZ workload','sorted by biggest TD shortfall',buys)}
    ${list('Sell-High — TD-dependent','sorted by biggest TD surplus',sells)}
    ${empty}
  </div>`;
}

function _schemeBuildBenefactors(p, d){
  const fv = _schemeBuildFv(p);
  const slotDownOpp = {};
  const slotDownTgt = {};
  const slotMap = fv.slots || {};
  const names = fv.names || {};
  const downs = ['1','2','3','4'];
  downs.forEach(down=>{
    const node = _schemeSafeNode(fv, down, 'all', 'redzone');
    const groups = Array.isArray(node && node.groups) ? node.groups : [];
    groups.forEach(g=>{
      const n = _schemeNumber(g && g.n, 0);
      const passRate = _schemeNumber(g && g.pass_rate, 0) / 100;
      const passPlays = n * passRate;
      if(passPlays <= 0) return;

      const assigns = Array.isArray(g && g.assigns) ? g.assigns : [];
      const eligible = assigns.filter(a=>{
        const slot = String((a && a.slot) || '');
        return !!slot && _schemePosFromSlot(slot)!=='QB';
      });
      if(eligible.length){
        const perSlotTgt = passPlays / eligible.length;
        eligible.forEach(a=>{
          const slot = String((a && a.slot) || '');
          const pos = _schemePosFromSlot(slot);
          const rec = (slotDownTgt[slot] = slotDownTgt[slot] || { pos, total:0, d1:0, d2:0, d3:0, d4:0 });
          rec.total += perSlotTgt;
          rec[`d${down}`] += perSlotTgt;
        });
      }

      const posBuckets = {};
      assigns.forEach(a=>{
        const slot = String((a && a.slot) || '');
        if(!slot) return;
        if(_schemePosFromSlot(slot)==='QB') return;
        const pos = _schemePosFromSlot(slot);
        (posBuckets[pos] = posBuckets[pos] || []).push({ slot, a });
      });

      Object.keys(posBuckets).forEach(pos=>{
        const bucket = posBuckets[pos] || [];
        if(!bucket.length) return;
        const weights = bucket.map(x=>{
          const routes = Array.isArray(x.a && x.a.routes) ? x.a.routes : [];
          const sumPct = routes.reduce((t,r)=>t+Math.max(0,_schemeNumber(r && r[1],0)),0);
          return Math.max(0.2, sumPct / 100);
        });
        const wSum = weights.reduce((t,v)=>t+v,0) || bucket.length;
        bucket.forEach((x, i)=>{
          const slot = x.slot;
          const shareOpp = passPlays * (weights[i] / wSum);
          const rec = (slotDownOpp[slot] = slotDownOpp[slot] || { pos, total:0, d1:0, d2:0, d3:0, d4:0 });
          rec.total += shareOpp;
          rec[`d${down}`] += shareOpp;
        });
      });
    });
  });

  const totals = Object.values(slotDownOpp);
  const totalOpp = totals.reduce((t,r)=>t+_schemeNumber(r && r.total,0),0) || 1;
  const tgtTotals = Object.values(slotDownTgt);
  const totalTgt = tgtTotals.reduce((t,r)=>t+_schemeNumber(r && r.total,0),0) || 1;
  const downTotals = {
    d1: totals.reduce((t,r)=>t+_schemeNumber(r && r.d1,0),0) || 1,
    d2: totals.reduce((t,r)=>t+_schemeNumber(r && r.d2,0),0) || 1,
    d3: totals.reduce((t,r)=>t+_schemeNumber(r && r.d3,0),0) || 1,
    d4: totals.reduce((t,r)=>t+_schemeNumber(r && r.d4,0),0) || 1,
  };
  const posTotals = {};
  totals.forEach(r=>{ posTotals[r.pos] = _schemeNumber(posTotals[r.pos], 0) + _schemeNumber(r.total, 0); });
  const rows = [];

  Object.keys(slotDownOpp).forEach(slot=>{
    const rec = slotDownOpp[slot] || {};
    const pos = rec.pos || _schemePosFromSlot(slot);
    const d1Pct = 100 * _schemeNumber(rec.d1, 0) / downTotals.d1;
    const d2Pct = 100 * _schemeNumber(rec.d2, 0) / downTotals.d2;
    const d3Pct = 100 * _schemeNumber(rec.d3, 0) / downTotals.d3;
    const d4Pct = 100 * _schemeNumber(rec.d4, 0) / downTotals.d4;
    const oppShare = 100 * _schemeNumber(rec.total, 0) / totalOpp;
    const tgtRec = slotDownTgt[slot] || { total:0 };
    const tgtShare = 100 * _schemeNumber(tgtRec.total, 0) / totalTgt;

    const gsis = slotMap[slot];
    const shortName = names[gsis] || slot;
    const resolved = _schemeResolveRosterPlayer(schemeTeam||'', pos, shortName, slot, p && p.season, gsis);
    const rid = String((resolved && resolved.player_id) || '');
    const name = String((resolved && resolved.name) || shortName || slot);
    const bestDown = [
      {k:'1st ',v:d1Pct}, {k:'2nd ',v:d2Pct}, {k:'3rd ',v:d3Pct}, {k:'4th ',v:d4Pct}
    ].sort((a,b)=>b.v-a.v)[0];

    rows.push({
      name,
      slot,
      pos,
      player_id: rid || null,
      team: schemeTeam || '',
      oppShare,
      tgtShare,
      d1Pct,
      d2Pct,
      d3Pct,
      d4Pct,
      reason: `Modeled red-zone target opportunity share ${oppShare.toFixed(2)}%; modeled red-zone target share ${tgtShare.toFixed(2)}%; strongest on ${bestDown.k} down (${bestDown.v.toFixed(2)}%).`,
    });
  });

  return rows;
}

function _schemeBuildRushBenefactors(p, d){
  const fv = _schemeBuildFv(p);
  const slotRunOpp = {};
  const slotMap = fv.slots || {};
  const names = fv.names || {};
  const downs = ['1','2','3','4'];
  downs.forEach(down=>{
    const node = _schemeSafeNode(fv, down, 'all', 'redzone');
    const groups = Array.isArray(node && node.groups) ? node.groups : [];
    groups.forEach(g=>{
      const n = _schemeNumber(g && g.n, 0);
      const runPlays = n * (1 - (_schemeNumber(g && g.pass_rate, 0) / 100));
      if(runPlays <= 0) return;
      const assigns = Array.isArray(g && g.assigns) ? g.assigns : [];
      const backs = assigns.filter(a=>/^(RB|FB)/.test(String((a && a.slot) || '').toUpperCase()));
      if(!backs.length) return;
      const weights = backs.map((a, i)=>{
        const slot = String((a && a.slot) || 'RB1').toUpperCase();
        if(slot === 'RB1') return 1;
        if(slot === 'RB2') return 0.48;
        if(slot.startsWith('FB')) return 0.2;
        return i === 0 ? 0.8 : 0.35;
      });
      const wSum = weights.reduce((t,v)=>t+v,0) || 1;
      backs.forEach((a, i)=>{
        const slot = String((a && a.slot) || '');
        const rec = (slotRunOpp[slot] = slotRunOpp[slot] || { total:0, d1:0, d2:0, d3:0, d4:0 });
        const opp = runPlays * (weights[i] / wSum);
        rec.total += opp;
        rec[`d${down}`] += opp;
      });
    });
  });

  const totalRunOpp = Object.values(slotRunOpp).reduce((t,r)=>t+_schemeNumber(r.total,0),0) || 1;
  const rows = Object.keys(slotRunOpp).map(slot=>{
    const rec = slotRunOpp[slot] || {};
    const gsis = slotMap[slot];
    const shortName = names[gsis] || slot;
    const resolved = _schemeResolveRosterPlayer(schemeTeam||'', 'RB', shortName, slot, p && p.season, gsis);
    const d1 = 100 * _schemeNumber(rec.d1, 0) / totalRunOpp;
    const d2 = 100 * _schemeNumber(rec.d2, 0) / totalRunOpp;
    const d3 = 100 * _schemeNumber(rec.d3, 0) / totalRunOpp;
    const d4 = 100 * _schemeNumber(rec.d4, 0) / totalRunOpp;
    const oppShare = 100 * _schemeNumber(rec.total, 0) / totalRunOpp;
    const bestDown = [
      {k:'1st',v:d1}, {k:'2nd',v:d2}, {k:'3rd',v:d3}, {k:'4th',v:d4}
    ].sort((a,b)=>b.v-a.v)[0];
    return {
      name: String((resolved && resolved.name) || shortName || slot),
      slot,
      pos: 'RB',
      player_id: String((resolved && resolved.player_id) || '') || null,
      team: schemeTeam || '',
      oppShare,
      d1Pct: d1,
      d2Pct: d2,
      d3Pct: d3,
      d4Pct: d4,
      reason: `Modeled for ${oppShare.toFixed(2)}% of red-zone rushing TD path volume; strongest on ${bestDown.k} down (${bestDown.v.toFixed(2)}%).`,
    };
  });
  return rows.sort((a,b)=>b.oppShare-a.oppShare).slice(0, 4);
}

function _schemeRenderBenefactorList(title, subtitle, list, scoreFmt, metaFmt){
  if(!list || !list.length){
    return `<div class="scheme-benefactors-wrap">
      <div class="scheme-benefactors-title">${_schemeEscHtml(title)}</div>
      <div class="scheme-empty">No player-level role data available for this season/team.</div>
    </div>`;
  }
  const rows = list.map((p, i)=>{
    const teamCode = String(p && p.team || schemeTeam || '').toUpperCase();
    const season = String(schemeSeason || (list[0] && list[0].season) || advTeamSeason() || '');
    const click = _schemePlayerOnclick(p);
    const notePlayer = p.player_id||p.name ? noteTargetFromArgs(p.player_id||p.name,p.pos||'',teamCode) : null;
    // Individual player is the note target for down splits — each pill tags that specific player.
    const splitMeta = (label, value, statKey) => ({ label, value, source:'coaching_insights', statKey, context:`${teamDisplayName(teamCode)} ${title.toLowerCase()} · ${season}`, player:notePlayer, team:teamCode, nav:{ type:'coaching', team:teamCode, season:String(season), tab:'insights' } });
    const wrapOpen = '<div class="scheme-benefit-row">';
    const wrapClose = '</div>';
    const splits = `<span class="scheme-benefit-splits">
      <span class="scheme-benefit-split">${noteWrapHtml(`<b>1st </b><span>${p.d1Pct.toFixed(2)}%</span>`, splitMeta(`${title} 1st-down share`, `${p.d1Pct.toFixed(2)}%`, 'd1_share'), 'note-tag-hit')}</span>
      <span class="scheme-benefit-split">${noteWrapHtml(`<b>2nd </b><span>${p.d2Pct.toFixed(2)}%</span>`, splitMeta(`${title} 2nd-down share`, `${p.d2Pct.toFixed(2)}%`, 'd2_share'), 'note-tag-hit')}</span>
      <span class="scheme-benefit-split">${noteWrapHtml(`<b>3rd </b><span>${p.d3Pct.toFixed(2)}%</span>`, splitMeta(`${title} 3rd-down share`, `${p.d3Pct.toFixed(2)}%`, 'd3_share'), 'note-tag-hit')}</span>
      <span class="scheme-benefit-split">${noteWrapHtml(`<b>4th </b><span>${p.d4Pct.toFixed(2)}%</span>`, splitMeta(`${title} 4th-down share`, `${p.d4Pct.toFixed(2)}%`, 'd4_share'), 'note-tag-hit')}</span>
    </span>`;
    const headClick = click ? `role="button" tabindex="0" title="Open player card" onclick="event.stopPropagation();${click}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();${click}}"` : '';
    return `${wrapOpen}
      <span class="scheme-benefit-rank">${i+1}</span>
      <span class="scheme-benefit-head scheme-benefit-head-btn" ${headClick}>${_schemePlayerHeadshot(p)}</span>
      <span class="scheme-benefit-main">
        <span class="scheme-benefit-name">${_schemeEscHtml(p.name)}</span>
        <span class="scheme-benefit-meta">${noteWrapHtml(metaFmt(p), { label:`${title} role context`, value:`${p.pos||''} · ${p.slot||''}${p.oppShare!=null?` · opp share ${p.oppShare.toFixed(2)}%`:''}${p.tgtShare!=null?` · tgt share ${p.tgtShare.toFixed(2)}%`:''}`, source:'coaching_insights', statKey:'role_context', context:`${teamDisplayName(teamCode)} ${title.toLowerCase()} · ${season}`, player:notePlayer, team:teamCode, relevance:'QB,RB,WR,TE', nav:{ type:'coaching', team:teamCode, season:String(season), tab:'insights' } }, 'note-tag-hit')}</span>
        ${splits}
      </span>
      <span class="scheme-benefit-score">${noteWrapHtml(scoreFmt(p), { label:`${title} leader score`, value:`${p.tgtShare!=null?`RZ target share ${p.tgtShare.toFixed(2)}% · `:''}${p.oppShare!=null?`team share ${p.oppShare.toFixed(2)}%`:''}`.trim() || scoreFmt(p).replace(/<[^>]+>/g,''), source:'coaching_insights', statKey:'leader_score', context:`${teamDisplayName(teamCode)} ${title.toLowerCase()} · ${season}`, player:notePlayer, team:teamCode, relevance:'QB,RB,WR,TE', nav:{ type:'coaching', team:teamCode, season:String(season), tab:'insights' } }, 'note-tag-hit')}</span>
      <span class="scheme-benefit-why">${_schemeEscHtml(p.reason)}</span>
    ${wrapClose}`;
  }).join('');
  return `<div class="scheme-benefactors-wrap">
    <div class="scheme-benefactors-title">${_schemeEscHtml(title)} <span>${_schemeEscHtml(subtitle)}</span></div>
    <div class="scheme-benefit-list">${rows}</div>
  </div>`;
}

function _schemeRenderBenefactors(targets, rushers){
  const targetSort = (schemeBenefactorSort === 'tgt') ? 'tgt' : 'opp';
  const sortedTargets = _schemeSortTargetBenefactors(targets, targetSort).slice(0, 6);
  const byTgt = targetSort === 'tgt';
  const targetSortTip = _schemeInfoTip(
    'Target leader sort',
    'Target opportunity share uses route-role weighting inside red-zone pass concepts. Target share uses a neutral split of red-zone pass targets across eligible receivers in each concept.'
  );
  const teamShareTip = _schemeInfoTip(
    'Team share',
    'These are modeled shares, not exact target logs. Opportunity share emphasizes route-role usage; target share is the neutral split baseline for red-zone pass concepts.'
  );
  const targetSortControls = `<div class="scheme-benefit-sort" role="group" aria-label="Sort target leaders">
    <span class="scheme-benefit-sort-label">Sort target leaders by ${targetSortTip}</span>
    <button type="button" class="scheme-benefit-sort-btn ${targetSort==='opp'?'active':''}" onclick="event.stopPropagation();setTeamCoachingSchemeBenefactorSort('opp')">RZ target opportunity share</button>
    <button type="button" class="scheme-benefit-sort-btn ${targetSort==='tgt'?'active':''}" onclick="event.stopPropagation();setTeamCoachingSchemeBenefactorSort('tgt')">RZ target share</button>
  </div>`;

  return `${targetSortControls}${_schemeRenderBenefactorList(
    'Red-Zone Target Opportunity Leaders',
    `sorted by ${_schemeTargetSortLabel(targetSort).toLowerCase()} · modeled red-zone shares (not play-by-play target logs)`,
    sortedTargets,
    p=>`${byTgt ? 'RZ TGT' : 'RZ OPP'} ${byTgt ? p.tgtShare.toFixed(2) : p.oppShare.toFixed(2)}% ${teamShareTip}`,
    p=>`${_schemeEscHtml(p.pos)} · ${_schemeEscHtml(p.slot)} · RZ opp share ${p.oppShare.toFixed(2)}% · RZ target share ${p.tgtShare.toFixed(2)}%`
  )}${_schemeRenderBenefactorList(
    'Rushing TD Paths',
    'modeled team share of red-zone rushing TD path volume',
    rushers,
    p=>`TEAM ${p.oppShare.toFixed(2)}% ${teamShareTip}`,
    p=>`${_schemeEscHtml(p.pos)} · ${_schemeEscHtml(p.slot)} · Team rush-path share ${p.oppShare.toFixed(2)}%`
  )}`;
}

function _schemeRenderRedZone(p){
  const d = _schemeRedZoneInsightData(p);
  const teamCode = String((p && p.team) || schemeTeam || '').toUpperCase();
  const teamName = teamDisplayName(teamCode) || teamCode;
  const season = String((p && p.season) || advTeamSeason() || '');
  const offenseStrip = _schemeRenderTeamOffenseProduction(p);
  const benefactors = _schemeBuildBenefactors(p, d);         // modeled fallback (formation/route)
  const rushBenefactors = _schemeBuildRushBenefactors(p, d); // modeled fallback (formation/route)
  // Actual red-zone usage from Sleeper weekly logs (real targets/carries) — fetched + cached
  // async, then the modal re-renders. This replaces the misleading modeled formation shares.
  const rzUsage = _schemeRzTrigger(teamCode, season);
  const benefactorsHtml = rzUsage
    ? (_schemeRenderActualBenefactors(rzUsage, teamCode, season) || _schemeRenderBenefactors(benefactors, rushBenefactors))
    : `<div class="scheme-benefactors-wrap"><div class="scheme-benefactors-title">Red-Zone Usage Leaders</div><div class="scheme-empty">Loading actual red-zone target &amp; carry logs…</div></div>`;
  const tdSourceHtml = _schemeRenderRzTdSource(p);
  const league = _schemeLeagueInsightRanks(p && p.season);
  const nTeams = _schemeNumber(league && league.leagueSize, 0);
  const rankText = (rank) => (rank && nTeams) ? `${_schemeOrdinal(rank)} of ${nTeams}` : '—';
  const rankClass = (rank) => _schemeRankClass(rank, nTeams);
  const rzRank = _schemeRankInLeague(d.thirdDownReach, league.thirdDownReach, 'asc');
  const earlySuccRank = _schemeRankInLeague(d.earlySucc, league.earlySucc, 'desc');
  const lateSuccRank = _schemeRankInLeague(d.lateSucc, league.lateSucc, 'desc');
  const frictionRank = d.frictionRank || _schemeRankInLeague(d.frictionScore, league.frictionScore, 'asc');
  const frictionRankClass = rankClass(frictionRank);
  const toneClass = d.tone==='warn' ? 'warn' : (d.tone==='good' ? 'good' : 'neutral');
  const blurb = _schemeInsightNarrative(d);
  const frictionTip = _schemeInfoTip(
    'Drive friction rank',
    'This compares this offense to the league. Lower friction means cleaner touchdown paths with fewer stalled drives. It combines how often drives end with punts, turnovers, or three-and-outs plus drive efficiency and red-zone finishing.'
  );
  const frictionComponents = _schemeRenderDriveFrictionBreakdown(p, d, league, rankText, rankClass);
  const rzVolumeCard = _schemeRenderRzOpportunityVolume(p, d, league, rankText, rankClass);

  // Build a direct player list from benefactors for the four insight tags so they don't
  // fall back to getBase() (which reads the projection-year roster and may be empty).
  const insightPlayers = (()=>{
    const seen = new Set();
    const out = [];
    const add = (list)=>{ (list||[]).forEach(pl=>{ const k=pl.player_id||pl.name; if(!k||seen.has(k)) return; seen.add(k); out.push({player_id:pl.player_id||'',name:pl.name||'',pos:pl.pos||'',team:pl.team||teamCode}); }); };
    if(rzUsage && rzUsage.meta){ Object.keys(rzUsage.meta).forEach(pid=>{ const m=rzUsage.meta[pid]||{}; add([{player_id:pid, name:m.name||'', pos:m.pos||'', team:teamCode}]); }); }
    add(benefactors);
    add(rushBenefactors);
    if(!out.length){
      // Last resort: projection-year roster
      ['QB','RB','WR','TE'].forEach(pos=>{ (getBase(teamCode,pos)||[]).slice(0,3).forEach(pl=>{ const k=pl.player_id||pl.name; if(!k||seen.has(k)) return; seen.add(k); out.push({player_id:pl.player_id||'',name:pl.name||'',pos,team:teamCode}); }); });
    }
    return out.slice(0, 12);
  })();
  const _itm = (label, value, statKey)=>({ label, value, source:'coaching_insights', statKey, context:`${teamName} red-zone insights · ${p&&p.season?p.season:advTeamSeason()}`, team:teamCode, players:insightPlayers, nav:{ type:'coaching', team:teamCode, season:String(p&&p.season?p.season:advTeamSeason()), tab:'insights' } });

  return `<div class="scheme-insights-wrap">
    ${offenseStrip}
    <div class="scheme-insights-head">
      <span class="scheme-insights-pill ${toneClass}">${d.label}</span>
      <span class="scheme-insights-sample">Sample: ${Math.round(_schemeNumber(d.samplePlays, 0))} red-zone plays</span>
    </div>
    <div class="scheme-insights-grid">
      <div class="scheme-insight-card">
        <div class="scheme-insight-k">3rd/4th down frequency</div>
        <div class="scheme-insight-v">${noteWrapHtml(`${_schemePct(d.thirdDownReach)} <span class="scheme-insight-rank ${rankClass(rzRank)}">(${rankText(rzRank)})</span>`, _itm('3rd/4th down frequency', _schemePct(d.thirdDownReach), 'third_down_reach'), 'note-tag-hit')}</div>
        <div class="scheme-insight-sub">Share of red-zone plays that reach 3rd or 4th down.</div>
      </div>
      <div class="scheme-insight-card">
        <div class="scheme-insight-k">Early down red zone success (1st/2nd)</div>
        <div class="scheme-insight-v">${noteWrapHtml(`${_schemePct(d.earlySucc)} <span class="scheme-insight-rank ${rankClass(earlySuccRank)}">(${rankText(earlySuccRank)})</span>`, _itm('Early down red zone success', _schemePct(d.earlySucc), 'early_succ'), 'note-tag-hit')}</div>
        <div class="scheme-insight-sub">Weighted by formation usage on early downs inside the red zone.</div>
      </div>
      <div class="scheme-insight-card">
        <div class="scheme-insight-k">Late down red zone success (3rd/4th)</div>
        <div class="scheme-insight-v">${noteWrapHtml(`${_schemePct(d.lateSucc)} <span class="scheme-insight-rank ${rankClass(lateSuccRank)}">(${rankText(lateSuccRank)})</span>`, _itm('Late down red zone success', _schemePct(d.lateSucc), 'late_succ'), 'note-tag-hit')}</div>
        <div class="scheme-insight-sub">How efficiently this team finishes once drives get extended.</div>
      </div>
      <div class="scheme-insight-card">
        <div class="scheme-insight-k">Drive friction ranking ${frictionTip}</div>
        <div class="scheme-insight-v">${noteWrapHtml(`${rankText(frictionRank)} <span class="scheme-insight-rank ${frictionRankClass}">(score ${Number.isFinite(d.frictionScore)?d.frictionScore.toFixed(0):'—'})</span>`, _itm('Drive friction ranking', `${rankText(frictionRank)} · score ${Number.isFinite(d.frictionScore)?d.frictionScore.toFixed(0):'—'}`, 'friction_rank'), 'note-tag-hit')}</div>
        <div class="scheme-insight-sub">Ranked by drive cleanliness (1 = least friction / cleanest drives, 32 = most friction / toughest drives).</div>
      </div>
      ${rzVolumeCard}
    </div>
    ${frictionComponents}
    ${tdSourceHtml}
    <div class="scheme-insight-note"><b>Fantasy angle:</b> ${_schemeEscHtml(blurb)}</div>
    ${benefactorsHtml}
  </div>`;
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
  const script = `const FV=${JSON.stringify(fv)};\nconst FORM=FV.data;\nconst SEASON=FV.season;\nconst NAMES=FV.names;\nconst TEAM_CODE=${JSON.stringify(team)};`;
  return template
    .replace('svg{display:block;margin:0 auto;}', 'svg{display:block;margin:0 auto;max-width:100%;height:auto;}')
    .replace('grid-template-columns:repeat(auto-fill,minmax(330px,1fr));', 'grid-template-columns:repeat(auto-fill,minmax(280px,1fr));')
    .replace('</style>', '@media (max-width:560px){ body{padding:8px;} .sheet{max-width:100%;} .controls{padding:8px 10px;} .grid{grid-template-columns:1fr;} .card{padding:8px 8px 10px;} }</style>')
    .replace(/__TC_SCRIPT_OPEN__/g, _SCHEME_SCRIPT_OPEN)
    .replace(/__TC_SCRIPT_CLOSE__/g, _SCHEME_SCRIPT_CLOSE)
    .replace('__TC_FV_SCRIPT__', script)
    .replace('Detroit Lions &mdash; Playbook', `${full} &mdash; Playbook`)
    .replace(/\b20\d{2}\s+·\s+Routes mapped to players/, `${season} · Routes mapped to players`)
    .replace('WR1=St. Brown, WR2=Williams', `WR1=${wr1}, WR2=${wr2}`)
    .replace(/const FV=.*?const FORM=FV\.data;\s*const SEASON=FV\.season;\s*const NAMES=FV\.names;\s*const TEAM_CODE=.*?;/s, script);
}

function _renderTeamCoachingScheme(){
  const host = _schemeOverlayHost(true);
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
          <div><div class="scheme-title">${teamDisplayName(schemeTeam)} Playbook</div>
          <div class="scheme-subtitle">No nflverse coaching-scheme payload found for this team.</div></div>
        </div>
      </div>
    </div>`;
    _schemeBindSwipeClose(host);
    return;
  }

  host.innerHTML = `<div class="scheme-overlay" onclick="closeTeamCoachingScheme()">
    <div class="scheme-modal" onclick="event.stopPropagation()">
      <button class="scheme-close" onclick="closeTeamCoachingScheme()" aria-label="Close">✕</button>
      <div class="scheme-head">
        ${_schemeBackButtonHtml()}
        <img src="${NFL_LOGO(schemeTeam)}" class="scheme-team-logo" onerror="this.style.display='none'">
        <div>
          <div class="scheme-title">${teamDisplayName(schemeTeam)} Playbook</div>
          <div class="scheme-subtitle">Interactive playsheet · nflverse charting · ${p.season} regular season</div>
          ${_schemeOcCallout(schemeTeam)}
        </div>
      </div>
      <div class="scheme-view-tabs">
        <button class="scheme-view-tab ${schemeViewTab==='playbook'?'active':''}" onclick="setTeamCoachingSchemeTab('playbook')">Playbook</button>
        <button class="scheme-view-tab ${schemeViewTab==='redzone'?'active':''}" onclick="setTeamCoachingSchemeTab('redzone')">Red Zone</button>
        <button class="scheme-view-tab ${schemeViewTab==='regression'?'active':''}" onclick="setTeamCoachingSchemeTab('regression')">Regression</button>
        <button class="scheme-view-tab ${schemeViewTab==='scheme'?'active':''}" onclick="setTeamCoachingSchemeTab('scheme')">Scheme</button>
      </div>
      <div class="scheme-loading">Loading playsheet template…</div>
      ${seasons.length>1?`<div class="scheme-tabs">${seasons.map(s=>`<button class="scheme-tab ${String(s)===String(schemeSeason)?'active':''}" onclick="setTeamCoachingSchemeSeason('${s}')"><span>${s}</span></button>`).join('')}</div>`:''}
    </div>
  </div>`;
  _schemeBindSwipeClose(host);

  if(schemeViewTab!=='playbook'){
    const modal = host.querySelector('.scheme-modal');
    const loading = host.querySelector('.scheme-loading');
    if(loading) loading.remove();
    let insightHtml;
    if(schemeViewTab==='regression') insightHtml = _schemeRenderRegression(p);
    else if(schemeViewTab==='scheme') insightHtml = _schemeRenderScheme(p);
    else insightHtml = _schemeRenderRedZone(p);
    if(modal) modal.insertAdjacentHTML('beforeend', insightHtml);
    return;
  }

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
  const from = initialView && typeof initialView==='object' ? String(initialView.from || '') : '';
  const fromOcJump = !!from;
  if(schemeOverlayOpen && fromOcJump && schemeTeam && String(schemeTeam)!==String(team)){
    const cur = {
      team: String(schemeTeam),
      season: String(schemeSeason || _schemePreferredSeason(schemeTeam) || ''),
      tab: _schemeNormTab(schemeViewTab),
      coachContext: _schemeCoachContext ? JSON.parse(JSON.stringify(_schemeCoachContext)) : null,
    };
    const top = _schemeNavStack[_schemeNavStack.length - 1];
    if(!top || top.team!==cur.team || String(top.season||'')!==String(cur.season||'') || top.tab!==cur.tab){
      _schemeNavStack.push(cur);
    }
  }else if(!fromOcJump){
    _schemeNavStack = [];
  }
  schemeOverlayOpen = true;
  _schemeLockPage(true);
  schemeTeam = team;
  schemeViewTab = _schemeNormTab(initialView && initialView.tab);

  if(initialView && typeof initialView==='object' && initialView.coachName){
    const seasons = String(initialView.coachSeasons || '')
      .split(',').map(x=>String(x||'').trim()).filter(Boolean);
    _schemeCoachContext = {
      team: String(team),
      name: String(initialView.coachName || ''),
      role: String(initialView.coachRole || ''),
      years: initialView.coachYears == null ? null : String(initialView.coachYears),
      fromHC: !!initialView.coachFromHC,
      seasons,
    };
  }else if(!fromOcJump){
    _schemeCoachContext = null;
  }

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
  const host = _schemeOverlayHost(true);
  if(!host || !schemeTeam) return;
  host.innerHTML = `<div class="scheme-overlay" onclick="closeTeamCoachingScheme()">
    <div class="scheme-modal" onclick="event.stopPropagation()">
      <button class="scheme-close" onclick="closeTeamCoachingScheme()" aria-label="Close">✕</button>
      <div class="scheme-head">
        ${_schemeBackButtonHtml()}
        <img src="${NFL_LOGO(schemeTeam)}" class="scheme-team-logo" onerror="this.style.display='none'">
        <div>
          <div class="scheme-title">${teamDisplayName(schemeTeam)} Playbook</div>
          <div class="scheme-subtitle">Loading coaching-scheme data…</div>
        </div>
      </div>
      <div class="scheme-loading">Loading coaching-scheme data…</div>
    </div>
  </div>`;
  _schemeBindSwipeClose(host);
}

function closeTeamCoachingScheme(){
  schemeOverlayOpen = false;
  _schemeLockPage(false);
  schemeTeam = null;
  schemeSeason = null;
  schemeViewTab = 'playbook';
  _schemeNavStack = [];
  _schemeCoachContext = null;
  const host = _schemeOverlayHost(false);
  if(host) host.remove();
}

function backTeamCoachingScheme(){
  if(!schemeOverlayOpen || !Array.isArray(_schemeNavStack) || !_schemeNavStack.length) return;
  const prev = _schemeNavStack.pop();
  if(!prev || !prev.team) return;

  schemeTeam = String(prev.team);
  schemeViewTab = _schemeNormTab(prev.tab);
  schemeSeason = String(prev.season || _schemePreferredSeason(schemeTeam) || '');
  _schemeCoachContext = prev.coachContext || null;

  const want = schemeSeason;
  if(want && typeof ensureNflverseCoachingSeason==='function' && !coachingSeasonReady(want)){
    _renderSchemeLoadingShell();
    ensureNflverseCoachingSeason(want).then(()=>{
      if(
        schemeOverlayOpen
        && String(schemeTeam)===String(prev.team)
        && String(schemeSeason)===String(want)
      ) _renderTeamCoachingScheme();
    });
    return;
  }
  _renderTeamCoachingScheme();
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

function setTeamCoachingSchemeTab(tab){
  if(!schemeOverlayOpen || !schemeTeam) return;
  schemeViewTab = _schemeNormTab(tab);
  _renderTeamCoachingScheme();
}

if(document && document.addEventListener && !_schemeEscBound){
  _schemeEscBound = true;
  document.addEventListener('keydown', e=>{
    if(e && e.key==='Escape' && schemeOverlayOpen) closeTeamCoachingScheme();
  });
}
