// ── Depth chart (ESPN) ──────────────────────────────────────────────────────
// The Roster Changes tab shows the team's depth chart from ESPN — granular position slots
// (LDT/RDT, WLB/MLB/SLB, LCB/RCB…) with players ordered starter → backup, every one clickable.
// We fetch the ORDERED depth chart (core API, athletes referenced by id) and the ROSTER (for
// each player's name/photo/jersey/exp), then join them. If the depth chart is unavailable we
// fall back to a flat by-position grouping of the roster.
const ESPN_DEPTHCHART_URL = (season,tid) =>
  `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/teams/${tid}/depthcharts?lang=en&region=us`;
let espnRosters = {};        // team -> [players] | null   (roster meta, also feeds the fallback)
let espnDepth = {};          // team -> [ordered rows] | null
let espnDepthInFlight = {};
// Which unit a depth-chart formation belongs to (for the Offense/Defense/Special headers).
function depthUnitOf(item){
  const keys = Object.keys(item.positions||{});
  if(/special/i.test(item.name||'') || keys.includes('pk') || keys.includes('ls') || keys.includes('pr')) return 'special';
  if(keys.includes('qb') || keys.includes('rb') || keys.includes('wr') || keys.includes('lt')) return 'offense';
  return 'defense';
}
// Row display order: offense (skill → line) → defense (line → LB → secondary) → special teams.
const DEPTH_SLOT_ORDER = ['qb','rb','fb','wr','te','lt','lg','c','rg','rt','ol',
  'lde','ldt','dt','rdt','nt','de','rde','edge','lb','wlb','mlb','slb','ilb','olb',
  'lcb','cb','rcb','nb','db','ss','s','fs','pk','p','ls','pr','kr'];
// Build ordered depth rows by joining the depth-chart formations (slot + rank) with roster meta.
function buildDepthRows(depthRaw, byId){
  const rows=[];
  (depthRaw.items||[]).forEach(item=>{
    const unit=depthUnitOf(item);
    const positions=item.positions||{};
    for(const key in positions){
      if(key==='h') continue;   // "holder" is just the punter — skip the duplicate row
      const p=positions[key];
      const label=(p.position && p.position.abbreviation) || key.toUpperCase();
      const ordered=(p.athletes||[]).slice().sort((a,b)=>(a.rank||a.slot||99)-(b.rank||b.slot||99));
      const players=[]; const seen={};
      ordered.forEach(a=>{
        const m=/athletes\/(\d+)/.exec((a.athlete && a.athlete.$ref) || '');
        if(!m) return;
        const meta=byId[m[1]];
        if(meta && !seen[m[1]]){ seen[m[1]]=1; players.push(Object.assign({depth:a.rank||a.slot}, meta)); }
      });
      if(players.length) rows.push({slot:key, label, unit, players});
    }
  });
  rows.sort((x,y)=>{
    const ix=DEPTH_SLOT_ORDER.indexOf(x.slot), iy=DEPTH_SLOT_ORDER.indexOf(y.slot);
    return (ix<0?99:ix)-(iy<0?99:iy) || x.label.localeCompare(y.label);
  });
  return rows;
}
async function fetchEspnDepth(team){
  if(espnDepth[team]!==undefined) return espnDepth[team];
  if(espnDepthInFlight[team]) return espnDepthInFlight[team];
  const tid = ESPN_TEAM_ID[team];
  if(!tid){ espnDepth[team]=null; espnRosters[team]=null; return null; }
  espnDepthInFlight[team]=(async()=>{
    try{
      const [rosterRaw, depthRaw] = await Promise.all([
        sleeperFetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${tid}/roster`),
        sleeperFetch(ESPN_DEPTHCHART_URL(PROJ_SEASON, tid)).catch(()=>null),
      ]);
      const players=[], byId={};
      (rosterRaw.athletes||[]).forEach(g=>(g.items||[]).forEach(p=>{
        const rec={
          id:String(p.id), name:p.fullName || `${p.firstName||''} ${p.lastName||''}`.trim(),
          pos:(p.position && p.position.abbreviation) || '',
          jersey:(p.jersey!=null && p.jersey!=='') ? p.jersey : null,
          exp:(p.experience && p.experience.years!=null) ? p.experience.years : null,
          headshot:(p.headshot && p.headshot.href) || null,
          unit:g.position || '', status:(p.status && p.status.type) || 'active',
        };
        players.push(rec); byId[rec.id]=rec;
      }));
      espnRosters[team]=players;
      const rows = (depthRaw && depthRaw.items) ? buildDepthRows(depthRaw, byId) : null;
      espnDepth[team] = (rows && rows.length) ? rows : null;
      if(currentTeam===team && currentPhase==='Additions') renderContent();
      return espnDepth[team];
    }catch(e){
      espnDepth[team]=null;
      if(espnRosters[team]===undefined) espnRosters[team]=null;
      if(currentTeam===team && currentPhase==='Additions') renderContent();
      return null;
    }finally{ delete espnDepthInFlight[team]; }
  })();
  return espnDepthInFlight[team];
}
const DEPTH_UNIT_LABEL = {offense:'Offense', defense:'Defense', special:'Special Teams'};
function renderDepthChart(team){
  const rows = espnDepth[team];
  if(rows===undefined){ fetchEspnDepth(team);
    return `<div class="add-section"><div class="add-section-head">📋 Depth Chart</div>
      <div class="add-empty">Loading depth chart from ESPN…</div></div>`; }
  if(rows===null) return renderDepthChartFallback(team);   // depth chart unavailable → flat roster
  const FANTASY={QB:1,RB:1,WR:1,TE:1};
  let body='', curUnit=null, total=0;
  rows.forEach(row=>{
    if(row.unit!==curUnit){ curUnit=row.unit; body+=`<div class="depth-unit-head">${DEPTH_UNIT_LABEL[curUnit]||''}</div>`; }
    const chips=row.players.map((p,i)=>{
      total++;
      const hs = p.headshot ? `<img src="${p.headshot}" class="depth-hs" onerror="this.style.display='none'">` : '';
      const rk = p.exp===0 ? `<span class="depth-rookie">R</span>` : '';
      const jersey = p.jersey ? `<span class="depth-jersey">#${p.jersey}</span>` : '';
      const starter = i===0 ? ' depth-starter' : '';
      return `<span class="depth-player clickable-player${starter}" title="${ordinal(i+1)} · ${p.pos||row.label}" onclick="${pcardOnclick(p.name, p.pos||row.label, team)}">${hs}<span class="depth-name">${p.name}</span>${jersey}${rk}</span>`;
    }).join('');
    const posBadge = FANTASY[row.label] ? `<span class="pos-badge pos-${row.label}">${row.label}</span>` : `<span class="depth-pos-abbr">${row.label}</span>`;
    body += `<div class="depth-pos"><div class="depth-pos-label">${posBadge}</div><div class="depth-players">${chips}</div></div>`;
  });
  return `<div class="add-section">
    <div class="add-section-head">📋 Depth Chart <span class="add-count">${total}</span></div>
    <div class="depth-sub">ESPN depth chart · starter → backups, left to right · tap any player for their card.</div>
    ${body}</div>`;
}
// Fallback when the ordered depth chart isn't available: flat by-position grouping of the roster.
const DEPTH_POS_ORDER = ['QB','RB','FB','WR','TE','OT','OG','C','G','T','OL',
  'DE','DT','NT','DL','EDGE','LB','ILB','OLB','MLB','CB','S','SS','FS','DB','K','PK','P','LS'];
function renderDepthChartFallback(team){
  const r = espnRosters[team];
  if(!r || !r.length){
    return `<div class="add-section"><div class="add-section-head">📋 Depth Chart</div>
      <div class="add-empty">Roster unavailable right now.</div></div>`; }
  const FANTASY={QB:1,RB:1,WR:1,TE:1};
  const active = r.filter(p=>!p.status || p.status==='active');
  const byPos={};
  active.forEach(p=>{ (byPos[p.pos]=byPos[p.pos]||[]).push(p); });
  const posKeys=Object.keys(byPos).sort((x,y)=>{
    const ix=DEPTH_POS_ORDER.indexOf(x), iy=DEPTH_POS_ORDER.indexOf(y);
    return (ix<0?99:ix)-(iy<0?99:iy) || x.localeCompare(y);
  });
  const groups=posKeys.map(pos=>{
    const chips=byPos[pos].map(p=>{
      const hs = p.headshot ? `<img src="${p.headshot}" class="depth-hs" onerror="this.style.display='none'">` : '';
      const rk = p.exp===0 ? `<span class="depth-rookie">R</span>` : '';
      const jersey = p.jersey ? `<span class="depth-jersey">#${p.jersey}</span>` : '';
      return `<span class="depth-player clickable-player" onclick="${pcardOnclick(p.name, p.pos, team)}">${hs}<span class="depth-name">${p.name}</span>${jersey}${rk}</span>`;
    }).join('');
    const lblCls = FANTASY[pos] ? `pos-${pos}` : '';
    return `<div class="depth-pos"><div class="depth-pos-label">${FANTASY[pos]?`<span class="pos-badge ${lblCls}">${pos}</span>`:`<span class="depth-pos-abbr">${pos}</span>`}</div><div class="depth-players">${chips}</div></div>`;
  }).join('');
  return `<div class="add-section">
    <div class="add-section-head">📋 Depth Chart <span class="add-count">${active.length}</span></div>
    <div class="depth-sub">Active roster via ESPN · tap any player for their card.</div>
    <div class="depth-grid">${groups}</div></div>`;
}
