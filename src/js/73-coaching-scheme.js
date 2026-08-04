// ─────────────────────────────────────────────────────────────────────────────
// Team playbook modal (nflverse)
// ─────────────────────────────────────────────────────────────────────────────
let schemeOverlayOpen = false;
let schemeTeam = null;
let schemeSeason = null;
let schemeViewTab = 'playbook';
let _schemeEscBound = false;
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
    : `<span class="scheme-oc-missing">No prior-team playbook seasons loaded.</span>`;
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
  return Number.isFinite(v) ? `${v.toFixed(1)}%` : '—';
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
  const block = NFLVERSE && NFLVERSE[String(season)] && NFLVERSE[String(season)].coaching_scheme;
  const teams = block ? Object.keys(block) : [];
  const rows = teams.map(team=>{
    const data = _schemeRedZoneInsightData({ season:String(season), data:block[team] });
    return {
      thirdDownReach: data.thirdDownReach,
      earlySucc: data.earlySucc,
      earlyPass: data.earlyPass,
      allSucc: data.allSucc,
    };
  });
  return {
    leagueSize: teams.length,
    thirdDownReach: rows.map(r=>r.thirdDownReach).filter(Number.isFinite),
    earlySucc: rows.map(r=>r.earlySucc).filter(Number.isFinite),
    earlyPass: rows.map(r=>r.earlyPass).filter(Number.isFinite),
    allSucc: rows.map(r=>r.allSucc).filter(Number.isFinite),
  };
}

function _schemeRedZoneInsightData(p){
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
  const earlyPass = _schemeWeightedGroupRate([rz1, rz2], 'pass_rate');
  const allSucc = _schemeWeightedGroupRate(rzAll, 'succ');

  let label = 'Balanced';
  let tone = 'neutral';
  if(Number.isFinite(thirdDownReach)){
    if(thirdDownReach >= 43){ label = 'High Drive Friction'; tone = 'warn'; }
    else if(thirdDownReach <= 34){ label = 'Low Drive Friction'; tone = 'good'; }
  }

  return {
    samplePlays: Math.max(downsKnown, _schemeNumber(rzAll.total, 0)),
    thirdDownReach,
    earlySucc,
    earlyPass,
    allSucc,
    label,
    tone,
  };
}

function _schemeInsightNarrative(d){
  const pieces = [];
  if(Number.isFinite(d.thirdDownReach)){
    if(d.thirdDownReach >= 43){
      pieces.push('Goal-to-go sequences are reaching late downs too often. That usually means lower touchdown certainty and more week-to-week volatility.');
    }else if(d.thirdDownReach <= 34){
      pieces.push('Goal-to-go sequences are converting early at a healthy rate. Primary red-zone roles tend to be more reliable for touchdowns.');
    }else{
      pieces.push('Goal-to-go execution looks near league middle. Treat touchdown outcomes as role-driven more than scheme-extreme.');
    }
  }
  if(Number.isFinite(d.earlyPass)){
    if(d.earlyPass >= 58) pieces.push('Early downs skew pass-heavy inside the 10, which can support target-driven profiles over pure goal-line rushers.');
    if(d.earlyPass <= 42) pieces.push('Early downs skew run-heavy inside the 10, which can concentrate upside into primary rushing roles.');
  }
  if(!pieces.length) pieces.push('Not enough red-zone charting for a confident read yet.');
  return pieces.join(' ');
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

function _schemePosPlayers(team, pos){
  if(typeof getBase!=='function' || !team) return [];
  const rows = getBase(team, pos) || [];
  return rows.map(p=>{
    const full = String((p && p.name) || '').trim();
    const toks = full.split(/\s+/).filter(Boolean);
    const first = _schemeNormNameToken(toks[0] || '');
    const last = _schemeNormNameToken(toks[toks.length-1] || '');
    const suffix = _schemeNormNameToken(toks[toks.length-1] || '').replace(/[^a-z0-9]/g,'');
    const vol = _schemeNumber(p && (p.receiving_targets || p.receptions || p.rushing_attempts || p.targets), 0);
    return {
      name: full,
      player_id: String((p && p.player_id) || ''),
      pos: String((p && p.pos) || pos),
      team: String((p && p.team) || team),
      first,
      last,
      suffix,
      norm: _schemeNormNameToken(full),
      vol,
    };
  }).filter(p=>p.name);
}

function _schemeResolveRosterPlayer(team, pos, shortName, slot){
  const players = _schemePosPlayers(team, pos);
  if(!players.length){
    return { name: String(shortName||slot||'Unknown'), player_id:'', pos, team };
  }
  const tok = _schemeNormNameToken(shortName);
  const slotIdx = Math.max(1, parseInt(String(slot||'').replace(/\D+/g,''), 10) || 1);

  let best = null;
  let bestScore = -1;
  players.forEach((p, i)=>{
    let s = 0;
    if(tok){
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
  if(!best) best = players[Math.min(slotIdx-1, players.length-1)] || players[0];
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

function _schemeBenefactorReason(pos, passLean, friction){
  if((pos==='WR' || pos==='TE') && passLean > 0.18) return 'Pass-lean red-zone script';
  if((pos==='WR' || pos==='TE') && friction > 0.12) return 'Late-down dependency boosts target paths';
  if(pos==='RB' && passLean < -0.18) return 'Run-lean red-zone script';
  if(pos==='RB' && friction < -0.08) return 'Early-down conversion supports rush TD paths';
  if(pos==='QB' && passLean > 0.2) return 'Pass-heavy red-zone design can lift QB TD paths';
  return 'High role concentration in this team context';
}

// Position priors for "who benefits" in red-zone context.
// Higher `fitWeight` means team tendencies matter more than raw usage for that position.
const SCHEME_BENEFIT_PROFILE = {
  WR: { passW: 1.25, frictionW: 0.85, usageWeight: 0.54, fitWeight: 0.46 },
  TE: { passW: 1.18, frictionW: 0.72, usageWeight: 0.56, fitWeight: 0.44 },
  RB: { passW: -1.30, frictionW: -0.62, usageWeight: 0.60, fitWeight: 0.40 },
  QB: { passW: 0.78, frictionW: -0.48, usageWeight: 0.66, fitWeight: 0.34 },
  DEF: { passW: 0.0, frictionW: 0.0, usageWeight: 1.0, fitWeight: 0.0 },
};

function _schemeBenefitForPos(pos, useNorm, passLean, friction){
  const cfg = SCHEME_BENEFIT_PROFILE[pos] || SCHEME_BENEFIT_PROFILE.WR;
  const fitRaw = cfg.passW * passLean + cfg.frictionW * friction;
  const fitNorm = _schemeClamp((fitRaw + 1) / 2, 0, 1);
  return {
    score: _schemeClamp(cfg.usageWeight * useNorm + cfg.fitWeight * fitNorm, 0, 1),
    fitNorm,
  };
}

function _schemeBuildBenefactors(p, d){
  const fv = _schemeBuildFv(p);
  const slotDownOpp = {};
  const posDownOpp = {};
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
      const posBuckets = {};
      assigns.forEach(a=>{
        const slot = String((a && a.slot) || '');
        if(!slot) return;
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
          const pRec = (posDownOpp[pos] = posDownOpp[pos] || { d1:0, d2:0, d3:0, d4:0, total:0 });
          pRec[`d${down}`] += shareOpp;
          pRec.total += shareOpp;
        });
      });
    });
  });

  const totals = Object.values(slotDownOpp);
  const maxOpp = totals.reduce((m,r)=>Math.max(m,_schemeNumber(r && r.total,0)),0) || 1;
  const rows = [];

  Object.keys(slotDownOpp).forEach(slot=>{
    const rec = slotDownOpp[slot] || {};
    const pos = rec.pos || _schemePosFromSlot(slot);
    const pRec = posDownOpp[pos] || { d1:0, d2:0, d3:0, d4:0, total:0 };
    const d1Pct = pRec.d1>0 ? (100*rec.d1/pRec.d1) : 0;
    const d2Pct = pRec.d2>0 ? (100*rec.d2/pRec.d2) : 0;
    const d3Pct = pRec.d3>0 ? (100*rec.d3/pRec.d3) : 0;
    const d4Pct = pRec.d4>0 ? (100*rec.d4/pRec.d4) : 0;
    const wPct = (0.22*d1Pct) + (0.30*d2Pct) + (0.40*d3Pct) + (0.08*d4Pct);
    const volNorm = _schemeClamp(_schemeNumber(rec.total, 0) / maxOpp, 0, 1);
    const benefit = _schemeClamp((0.7*(wPct/100)) + (0.3*volNorm), 0, 1);

    const gsis = slotMap[slot];
    const shortName = names[gsis] || slot;
    const resolved = _schemeResolveRosterPlayer(schemeTeam||'', pos, shortName, slot);
    const rid = String((resolved && resolved.player_id) || '');
    const name = String((resolved && resolved.name) || shortName || slot);
    const bestDown = [
      {k:'1st',v:d1Pct}, {k:'2nd',v:d2Pct}, {k:'3rd',v:d3Pct}, {k:'4th',v:d4Pct}
    ].sort((a,b)=>b.v-a.v)[0];

    rows.push({
      name,
      slot,
      pos,
      player_id: rid || null,
      team: schemeTeam || '',
      useRaw: _schemeNumber(rec.total, 0),
      useShare: totals.length ? (100*_schemeNumber(rec.total,0)/totals.reduce((t,x)=>t+_schemeNumber(x.total,0),0)) : 0,
      benefit,
      d1Pct,
      d2Pct,
      d3Pct,
      d4Pct,
      targetPct: wPct,
      reason: `${bestDown.k}-down ${pos} target-share leader (${bestDown.v.toFixed(1)}%)`,
    });
  });

  return rows
    .sort((a,b)=> (b.targetPct - a.targetPct) || (b.benefit - a.benefit) || (b.useShare - a.useShare) || String(a.name).localeCompare(String(b.name)))
    .slice(0, 6);
}

function _schemeRenderBenefactors(list){
  if(!list || !list.length){
    return `<div class="scheme-benefactors-wrap">
      <div class="scheme-benefactors-title">Most Benefiting Players</div>
      <div class="scheme-empty">No player-level red-zone role data available for this season/team.</div>
    </div>`;
  }
  const rows = list.map((p, i)=>{
    const click = _schemePlayerOnclick(p);
    const wrapOpen = click
      ? `<div class="scheme-benefit-row clickable-player" role="button" tabindex="0" onclick="${click}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${click}}">`
      : '<div class="scheme-benefit-row">';
    const wrapClose = '</div>';
    return `${wrapOpen}
      <span class="scheme-benefit-rank">${i+1}</span>
      <span class="scheme-benefit-head">${_schemePlayerHeadshot(p)}</span>
      <span class="scheme-benefit-main">
        <span class="scheme-benefit-name">${_schemeEscHtml(p.name)}</span>
        <span class="scheme-benefit-meta">${_schemeEscHtml(p.pos)} · ${_schemeEscHtml(p.slot)} · TGT% ${p.targetPct.toFixed(1)} (D1 ${p.d1Pct.toFixed(0)} / D2 ${p.d2Pct.toFixed(0)} / D3 ${p.d3Pct.toFixed(0)})</span>
      </span>
      <span class="scheme-benefit-score">${(p.benefit*100).toFixed(0)}</span>
      <span class="scheme-benefit-why">${_schemeEscHtml(p.reason)}</span>
    ${wrapClose}`;
  }).join('');
  return `<div class="scheme-benefactors-wrap">
    <div class="scheme-benefactors-title">Most Benefiting Players <span>ranked by fit + role usage</span></div>
    <div class="scheme-benefit-list">${rows}</div>
  </div>`;
}

function _schemeRenderInsights(p){
  const d = _schemeRedZoneInsightData(p);
  const benefactors = _schemeBuildBenefactors(p, d);
  const league = _schemeLeagueInsightRanks(p && p.season);
  const nTeams = _schemeNumber(league && league.leagueSize, 0);
  const rankText = (rank) => (rank && nTeams) ? `${_schemeOrdinal(rank)} of ${nTeams}` : '—';
  const rankClass = (rank) => _schemeRankClass(rank, nTeams);
  const rzRank = _schemeRankInLeague(d.thirdDownReach, league.thirdDownReach, 'asc');
  const earlySuccRank = _schemeRankInLeague(d.earlySucc, league.earlySucc, 'desc');
  const earlyPassRank = _schemeRankInLeague(d.earlyPass, league.earlyPass, 'desc');
  const allSuccRank = _schemeRankInLeague(d.allSucc, league.allSucc, 'desc');
  const toneClass = d.tone==='warn' ? 'warn' : (d.tone==='good' ? 'good' : 'neutral');
  const blurb = _schemeInsightNarrative(d);
  return `<div class="scheme-insights-wrap">
    <div class="scheme-insights-head">
      <span class="scheme-insights-pill ${toneClass}">${d.label}</span>
      <span class="scheme-insights-sample">Sample: ${Math.round(_schemeNumber(d.samplePlays, 0))} red-zone plays</span>
    </div>
    <div class="scheme-insights-grid">
      <div class="scheme-insight-card">
        <div class="scheme-insight-k">Goal-to-go 3rd/4th-down reach (proxy)</div>
        <div class="scheme-insight-v">${_schemePct(d.thirdDownReach)} <span class="scheme-insight-rank ${rankClass(rzRank)}">(${rankText(rzRank)})</span></div>
        <div class="scheme-insight-sub">Higher generally means weaker early-down finish quality.</div>
      </div>
      <div class="scheme-insight-card">
        <div class="scheme-insight-k">Early-down success in red zone (1st/2nd)</div>
        <div class="scheme-insight-v">${_schemePct(d.earlySucc)} <span class="scheme-insight-rank ${rankClass(earlySuccRank)}">(${rankText(earlySuccRank)})</span></div>
        <div class="scheme-insight-sub">Weighted by formation usage in this filter set.</div>
      </div>
      <div class="scheme-insight-card">
        <div class="scheme-insight-k">Early-down pass rate in red zone</div>
        <div class="scheme-insight-v">${_schemePct(d.earlyPass)} <span class="scheme-insight-rank ${rankClass(earlyPassRank)}">(${rankText(earlyPassRank)})</span></div>
        <div class="scheme-insight-sub">Context for WR/TE vs. RB touchdown paths.</div>
      </div>
      <div class="scheme-insight-card">
        <div class="scheme-insight-k">All-down red-zone success</div>
        <div class="scheme-insight-v">${_schemePct(d.allSucc)} <span class="scheme-insight-rank ${rankClass(allSuccRank)}">(${rankText(allSuccRank)})</span></div>
        <div class="scheme-insight-sub">Overall efficiency backdrop for touchdown expectation.</div>
      </div>
    </div>
    <div class="scheme-insight-note"><b>Fantasy angle:</b> ${_schemeEscHtml(blurb)}</div>
    ${_schemeRenderBenefactors(benefactors)}
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
  const script = `const FV=${JSON.stringify(fv)};\nconst FORM=FV.data;\nconst SEASON=FV.season;\nconst NAMES=FV.names;`;
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
    .replace(/const FV=.*?const FORM=FV\.data;\s*const SEASON=FV\.season;\s*const NAMES=FV\.names;/s, script);
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
    return;
  }

  host.innerHTML = `<div class="scheme-overlay" onclick="closeTeamCoachingScheme()">
    <div class="scheme-modal" onclick="event.stopPropagation()">
      <button class="scheme-close" onclick="closeTeamCoachingScheme()" aria-label="Close">✕</button>
      <div class="scheme-head">
        <img src="${NFL_LOGO(schemeTeam)}" class="scheme-team-logo" onerror="this.style.display='none'">
        <div>
          <div class="scheme-title">${teamDisplayName(schemeTeam)} Playbook</div>
          <div class="scheme-subtitle">Interactive playsheet · nflverse charting · ${p.season} regular season</div>
          ${_schemeOcCallout(schemeTeam)}
        </div>
      </div>
      <div class="scheme-view-tabs">
        <button class="scheme-view-tab ${schemeViewTab==='playbook'?'active':''}" onclick="setTeamCoachingSchemeTab('playbook')">Playbook</button>
        <button class="scheme-view-tab ${schemeViewTab==='insights'?'active':''}" onclick="setTeamCoachingSchemeTab('insights')">Insights</button>
      </div>
      <div class="scheme-loading">Loading playsheet template…</div>
      ${seasons.length>1?`<div class="scheme-tabs">${seasons.map(s=>`<button class="scheme-tab ${String(s)===String(schemeSeason)?'active':''}" onclick="setTeamCoachingSchemeSeason('${s}')">Season <span>${s}</span></button>`).join('')}</div>`:''}
    </div>
  </div>`;

  if(schemeViewTab==='insights'){
    const modal = host.querySelector('.scheme-modal');
    const loading = host.querySelector('.scheme-loading');
    if(loading) loading.remove();
    if(modal) modal.insertAdjacentHTML('beforeend', _schemeRenderInsights(p));
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
  schemeOverlayOpen = true;
  schemeTeam = team;
  schemeViewTab = (initialView && initialView.tab==='insights') ? 'insights' : 'playbook';
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
        <img src="${NFL_LOGO(schemeTeam)}" class="scheme-team-logo" onerror="this.style.display='none'">
        <div>
          <div class="scheme-title">${teamDisplayName(schemeTeam)} Playbook</div>
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
  schemeViewTab = 'playbook';
  const host = _schemeOverlayHost(false);
  if(host) host.remove();
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
  schemeViewTab = String(tab)==='insights' ? 'insights' : 'playbook';
  _renderTeamCoachingScheme();
}

if(document && document.addEventListener && !_schemeEscBound){
  _schemeEscBound = true;
  document.addEventListener('keydown', e=>{
    if(e && e.key==='Escape' && schemeOverlayOpen) closeTeamCoachingScheme();
  });
}
