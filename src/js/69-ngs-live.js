// ── Next Gen Stats · live ──────────────────────────────────────────────────
// The in-season companion under each chart. NGS is player TRACKING (not
// charting), so it updates the morning after every game — separation and
// cushion for receivers, time-to-throw and CPOE for passers, efficiency and
// yards over expected for rushers. The sidecar bakes it per game
// (NFLVERSE[season].ngs_weekly, see ngs_weekly in src/nflverse/nflverse.py);
// the strip follows the chart's game chip, and reads every tile against the
// league median — no hardcoded notion of good.
const NGS_TILES = {
  rec: [
    ['sep',    'Separation', 'hi', 'yds', 'Average yards of separation from the nearest defender at the catch/incompletion (NGS)'],
    ['cush',   'Cushion',    null, 'yds', 'Average yards between the receiver and the defender lined up across him at the snap — press vs off coverage (NGS)'],
    ['yac_oe', 'YAC +/−',    'hi', 'yds', 'Yards after catch above what the tracking model expected from that catch point (NGS)'],
    ['share',  'Air-Yd Share','hi', '%',  'Share of the team\'s intended air yards that went his way (NGS)'],
    ['iay',    'aDOT',       null, 'yds', 'Average intended air yards per target (NGS)'],
  ],
  qb: [
    ['ttt',    'Time to Throw', null, 's', 'Average seconds from snap to release (NGS)'],
    ['cpoe',   'CPOE',          'hi', '%', 'Completion percentage above the tracking model\'s expectation for those throws (NGS)'],
    ['agg',    'Aggressive',    null, '%', 'Share of throws into tight coverage (a defender within a yard) (NGS)'],
    ['sticks', 'Air to Sticks', null, 'yds', 'Average intended air yards relative to the first-down marker (NGS)'],
    ['cay',    'Comp Air Yds',  null, 'yds', 'Average air yards on completions (NGS)'],
  ],
  rb: [
    ['ryoe',   'RYOE / att', 'hi', 'yds', 'Rush yards over the tracking model\'s expectation per carry — the runner minus his blocking (NGS)'],
    ['eff',    'Efficiency', 'lo', '',    'Yards travelled per yard gained — lower is more north-south (NGS)'],
    ['box8',   '8+ in Box',  null, '%',   'Share of carries against eight or more defenders in the box (NGS)'],
    ['tlos',   'Time to LOS', 'lo', 's',  'Average seconds to reach the line of scrimmage (NGS)'],
  ],
};

function _ngsNode(norm, season){
  const blk=(typeof NFLVERSE!=='undefined' && NFLVERSE && NFLVERSE[String(season)] && NFLVERSE[String(season)].ngs_weekly)||null;
  return blk && blk.players && blk.players[norm] ? {node:blk.players[norm], lg:(blk.lg||{})} : null;
}

function _ngsFmt(v, unit){
  if(v==null || Number.isNaN(Number(v))) return '—';
  const n=Number(v);
  if(unit==='%') return `${n.toFixed(1)}%`;
  if(unit==='s') return `${n.toFixed(2)}s`;
  if(unit==='') return n.toFixed(2);
  return (Math.abs(n)>=10 ? n.toFixed(1) : n.toFixed(2));
}

// kind: 'rec' | 'qb' | 'rb'. selWk: the chart's selected game (null = season to date).
function pcardNgsStrip(kind, norm, season, selWk){
  const found=_ngsNode(norm, season);
  if(!found || !NGS_TILES[kind]) return '';
  const {node, lg}=found;
  if(node.kind!==kind) return '';
  const line = (selWk!=null) ? (node.games||[]).find(g=>g.wk===Number(selWk)) : (node.season && Object.keys(node.season).length ? node.season : null);
  if(!line) return '';
  const med=lg[kind]||{};
  const tiles=NGS_TILES[kind].map(([k,label,dir,unit,tip])=>{
    const v=line[k];
    if(v==null) return '';
    const m=med[k];
    let cls='';
    if(dir && m!=null){
      const d=Number(v)-Number(m);
      const good = dir==='hi' ? d>0 : d<0;
      cls = Math.abs(d)<1e-9 ? '' : (good ? 'ngs-good' : 'ngs-bad');
    }
    return `<div class="qpc-tile ngs-tile ${cls}" title="${escAttr(tip)}"><label>${label}</label><b>${_ngsFmt(v,unit)}</b>${m!=null?`<small>lg ${_ngsFmt(m,unit)}</small>`:''}</div>`;
  }).join('');
  if(!tiles) return '';
  const scope = selWk!=null ? `Wk ${selWk}` : 'season';
  const vol = kind==='rec' ? (line.tgt!=null?`${line.tgt} tgt`:'') : kind==='qb' ? (line.att!=null?`${line.att} att`:'') : (line.att!=null?`${line.att} att`:'');
  return `<div class="ngs-wrap">
    <div class="ngs-head"><span class="tt-badge" title="Next Gen Stats player tracking — updates the morning after each game, no charting lag. Tiles are colored against the league median.">◉ NEXT GEN · live</span><span class="tt-sub">${escHtml(scope)}${vol?` · ${escHtml(vol)}`:''}</span></div>
    <div class="qpc-totals ngs-tiles">${tiles}</div>
  </div>`;
}
