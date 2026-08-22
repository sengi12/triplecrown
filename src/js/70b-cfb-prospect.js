// ─────────────────────────────────────────────────────────────────────────────
// College prospect panel (rookie player cards — and every projected veteran drafted since 2015)
// ─────────────────────────────────────────────────────────────────────────────
// A rookie has no NFL snaps, so their card's NFL tab is empty and the College tab has
// historically shown a raw ESPN box score — attempts, yards, TDs, longs. Those numbers can't
// answer the only question that matters about a prospect: is that good?
//
// This panel sits above the ESPN game logs on the College tab and answers it, from the seed's
// `cfb` block (build_seed.py --cfb, built by src/cfb/). Each headline metric is shown as a
// percentile against every drafted player at the same position from the 2018-2025 classes, so
// "25% dominator" reads as "51st percentile" — median, not the star number it looks like.
//
// EVERY NUMBER HERE IS NOTE-TAGGABLE. Percentiles, season stats, the summary line and the
// school itself all carry data-noteable attributes, so any of them can be attached to a player
// note the same way rankings and OL-card stats are. Percentile rows and season cells tag the
// PERCENTILE and the RAW STAT respectively, which are different claims about the same player —
// "84th percentile target share" and "95 targets" are both worth being able to cite.
//
// DEGRADES TO NOTHING. Roughly 3% of rookies have no CFBD coverage at all (D2/D3/NAIA/Ivy),
// and a seed built before --cfb existed has no block. In both cases every function here
// returns '' and the College tab renders exactly as it did before — the ESPN gamelog below is
// never replaced, only preceded.

// ── Lazy per-game logs ───────────────────────────────────────────────────────
// Season lines and percentiles ride inline in the main seed (~81 KB gzipped); the per-game
// logs are ~60% of the payload and only matter once a specific rookie's card is open, so they
// follow def_weekly's pattern and live in a sidecar fetched on first use.
const _CFB_LOGS_URL = 'seeds/triplecrown_seed.cfb_logs.json';
let _cfbLogsLoaded = false;
let _cfbLogsPromise = null;

function resetCfbLazy(){
  _cfbLogsLoaded = false;
  _cfbLogsPromise = null;
  CFB_LOGS = (typeof SEED_CFB_LOGS!=='undefined') ? SEED_CFB_LOGS : {};
}

function cfbLogsReady(){
  return _cfbLogsLoaded || !!(CFB_LOGS && Object.keys(CFB_LOGS).length);
}

function ensureCfbLogs(){
  if(cfbLogsReady()) return Promise.resolve(true);
  if(_cfbLogsPromise) return _cfbLogsPromise;
  _cfbLogsPromise = (async()=>{
    try{
      const raw = await fetchSeedJson(_CFB_LOGS_URL);
      if(!raw) return false;
      CFB_LOGS = raw;
      _cfbLogsLoaded = true;
      return true;
    }catch(e){ return false; }
  })();
  return _cfbLogsPromise;
}

// ── Lookup ───────────────────────────────────────────────────────────────────
function cfbProfile(pid){
  const players = CFB && CFB.players;
  if(!players) return null;
  return players[String(pid)] || null;
}

function cfbHasProfile(pid){ return !!cfbProfile(pid); }

// ── Note tagging ─────────────────────────────────────────────────────────────
// Full names for the season-table columns. The table headers are abbreviated to fit a phone;
// a note that just said "TGT" a month later would be useless, so tags carry the long form.
const _CFB_STAT_LABELS = {
  games:'College games', att:'College pass attempts', comp:'College completions',
  pass_yds:'College passing yards', pass_td:'College passing TDs', int:'College interceptions',
  ypa:'College yards per attempt', rushes:'College carries', rush_yds:'College rushing yards',
  rush_td:'College rushing TDs', ypc:'College yards per carry',
  epa_play:'College EPA per play', succ:'College success rate',
  expl_rate:'College explosive rate', stuff_rate:'College stuff rate',
  rush_share:'College rush share', tgt:'College targets', tgt_share:'College target share',
  rec:'College receptions', rec_yds:'College receiving yards', rec_td:'College receiving TDs',
  ypr:'College yards per reception', dominator:'College dominator rating',
  scrim_share:'College scrimmage-yards share',
  yptpa:'College yards per team pass attempt',
};

function _cfbStatLabel(key){ return _CFB_STAT_LABELS[key] || (CFB.labels && CFB.labels[key]) || key; }

// Shared note metadata for everything in this panel. `source` is distinct from the ESPN gamelog
// below it so a note records which of the two it came from.
function _cfbNoteBase(prof, pid){
  const team = (typeof pcardState!=='undefined' && pcardState && pcardState.team) || '';
  return {
    source: 'cfb_prospect',
    team: team,
    relevance: prof.pos,
    player: (typeof noteTargetFromArgs==='function')
      ? noteTargetFromArgs(pid, prof.pos, team) : null,
  };
}

function _cfbTagAttrs(meta){
  return (typeof noteTagAttrs==='function') ? noteTagAttrs(meta) : '';
}

// ── Rendering ────────────────────────────────────────────────────────────────
// Percentile → color band. Deliberately the same green/yellow/red vocabulary the gamelog
// cells already use, so one card doesn't speak two visual languages.
function _cfbPctClass(v){
  if(v==null) return '';
  if(v>=80) return 'cfb-elite';
  if(v>=60) return 'cfb-good';
  if(v>=40) return 'cfb-avg';
  if(v>=20) return 'cfb-poor';
  return 'cfb-bad';
}

// The attributes go straight onto the existing value/label divs rather than wrapping them in a
// span: this row is a CSS grid, and an extra element between the grid and its children would
// collapse the column alignment.
function _cfbBar(label, pct, raw, meta){
  const cls = _cfbPctClass(pct);
  const w = Math.max(2, Math.min(100, pct));
  const shown = Math.round(pct);
  const rawTxt = raw==null ? '' : ` (${_cfbNum(raw)})`;
  const cellMeta = meta && Object.assign({}, meta, {
    label: `${label} percentile`,
    value: `${_cfbOrdinal(shown)} percentile${rawTxt}`,
  });
  const attrs = cellMeta ? _cfbTagAttrs(cellMeta) : '';
  return `<div class="cfb-bar-row">
      <div class="cfb-bar-label">${escHtml(label)}</div>
      <div class="cfb-bar-track"><div class="cfb-bar-fill ${cls}" style="width:${w}%"></div></div>
      <div class="cfb-bar-val ${cls} note-tag-hit"${attrs}>${shown}</div>
    </div>`;
}

// Ordinal suffix for the plain-English summary line ("84th percentile").
function _cfbOrdinal(n){
  n = Math.round(n);
  const t = n % 100;
  if(t>=11 && t<=13) return n + 'th';
  return n + ({1:'st', 2:'nd', 3:'rd'}[n % 10] || 'th');
}

// The season table. Columns differ by position because the interesting numbers do.
const _CFB_SEASON_COLS = {
  QB: [['games','G'], ['att','ATT'], ['comp','CMP'], ['pass_yds','YDS'], ['pass_td','TD'],
       ['int','INT'], ['ypa','Y/A'], ['epa_play','EPA/DB'], ['succ','SUCC%'],
       ['rushes','RU'], ['rush_yds','RUYDS'], ['rush_td','RUTD']],
  RB: [['games','G'], ['rushes','ATT'], ['rush_yds','YDS'], ['rush_td','TD'], ['ypc','Y/C'],
       ['epa_play','EPA/RU'], ['succ','SUCC%'], ['expl_rate','EXPL%'], ['stuff_rate','STUFF%'],
       ['rush_share','RU%'], ['tgt','TGT'], ['rec_yds','RECYDS'], ['dominator','DOM%']],
  WR: [['games','G'], ['tgt','TGT'], ['rec','REC'], ['rec_yds','YDS'], ['rec_td','TD'],
       ['ypr','Y/R'], ['epa_play','EPA/TGT'], ['succ','SUCC%'], ['dominator','DOM%'],
       ['tgt_share','TGT%'], ['yptpa','YPTPA']],
};
_CFB_SEASON_COLS.TE = _CFB_SEASON_COLS.WR;

function _cfbNum(v){
  if(v==null || v==='') return '–';
  if(typeof v!=='number') return escHtml(String(v));
  return Number.isInteger(v) ? String(v) : String(Math.round(v*100)/100);
}

// Row scope carries what's constant for a season (player, team, which season); each cell adds
// only the label/value/statKey that varies. That split is what noteScopeAttrs/noteCellHtml
// exist for, and it keeps a twelve-column row from repeating the player on every cell.
function _cfbSeasonTable(prof, pid, base){
  const cols = _CFB_SEASON_COLS[prof.pos];
  if(!cols) return '';
  const years = Object.keys(prof.seasons||{}).sort();
  if(!years.length) return '';
  const head = cols.map(c=>`<th>${c[1]}</th>`).join('');
  const rows = years.map(y=>{
    const s = prof.seasons[y] || {};
    const school = s.team || prof.college || '';
    const ctx = `${school}${school?' · ':''}${y} college season`;
    const scope = (typeof noteScopeAttrs==='function')
      ? noteScopeAttrs(Object.assign({}, base, { context: ctx })) : '';
    const tds = cols.map(c=>{
      const key = c[0], v = s[key];
      const txt = _cfbNum(v);
      if(v==null) return `<td>${txt}</td>`;   // nothing to cite in an empty cell
      const cell = (typeof noteCellHtml==='function')
        ? noteCellHtml(txt, { label:`${_cfbStatLabel(key)} (${y})`, value:txt,
                              source:'cfb_prospect', statKey:key }, 'note-tag-hit')
        : txt;
      return `<td>${cell}</td>`;
    }).join('');
    const teamTxt = school ? escHtml(school) : '–';
    return `<tr${scope}><th class="cfb-season-th">${escHtml(y)}<span class="cfb-season-team">${teamTxt}</span></th>${tds}</tr>`;
  }).join('');
  return `<div class="pcard-table-scroll"><table class="pcard-table cfb-table">
      <thead><tr><th class="cfb-season-th">SEASON</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

// The main entry point: the whole panel for one player, or '' when there's nothing to show.
function renderCfbProspect(pid){
  const prof = cfbProfile(pid);
  if(!prof) return '';
  const headline = (CFB.headline && CFB.headline[prof.pos]) || [];
  const labels = CFB.labels || {};
  const pct = prof.pct || {};
  const cls = (CFB.reference && CFB.reference.classes) || [];
  const refTxt = cls.length===2 ? `${cls[0]}–${cls[1]} draft classes` : 'past draft classes';
  const base = _cfbNoteBase(prof, pid);
  const finalSeason = (prof.seasons && prof.final && prof.seasons[prof.final]) || {};
  const pctCtx = `${prof.college||''}${prof.college?' · ':''}college percentile vs ${refTxt}`;

  const bars = headline.filter(m=>pct[m]!=null)
    .map(m=>_cfbBar(labels[m] || m, pct[m], finalSeason[m],
                    Object.assign({}, base, { statKey:`pct_${m}`, context: pctCtx })))
    .join('');

  // A one-line plain-English read, using the position's leading metric. Percentile bars are
  // precise but not immediate; this says the thing out loud.
  let summary = '';
  const lead = headline.find(m=>pct[m]!=null);
  if(lead){
    const leadLabel = labels[lead] || lead;
    const inner = `<b class="${_cfbPctClass(pct[lead])}">${_cfbOrdinal(pct[lead])} percentile</b>`;
    const tagged = (typeof noteWrapHtml==='function')
      ? noteWrapHtml(inner, Object.assign({}, base, {
          label: `${leadLabel} percentile`,
          value: `${_cfbOrdinal(pct[lead])} percentile among ${prof.pos} prospects`,
          statKey: `pct_${lead}`,
          context: pctCtx,
        }), 'note-tag-hit')
      : inner;
    summary = `<div class="cfb-summary">${escHtml(leadLabel)} ranks ${tagged}
      among ${escHtml(prof.pos)} prospects.</div>`;
  }

  // School/conference/final season: not a stat, but the thing a note most often needs to say
  // alongside one ("dominant, but in the MAC").
  // Veterans carry their draft class (profiles exist for every projected player drafted
  // since 2015, not only rookies), so the panel says whose college career this is.
  const clsTxt = prof.class ? `${prof.class} draft class` : '';
  const metaBits = [prof.college, prof.conf, prof.final ? `final season ${prof.final}` : '', clsTxt]
    .filter(Boolean);
  const metaTxt = metaBits.join(' · ');
  const metaInner = [
    prof.college ? escHtml(prof.college) : '',
    prof.conf ? `<span class="cfb-meta-sep">·</span>${escHtml(prof.conf)}` : '',
    prof.final ? `<span class="cfb-meta-sep">·</span>final season ${escHtml(prof.final)}` : '',
    clsTxt ? `<span class="cfb-meta-sep">·</span>${escHtml(clsTxt)}` : '',
  ].join('');
  const metaTagged = (typeof noteWrapHtml==='function' && metaTxt)
    ? noteWrapHtml(metaInner, Object.assign({}, base, {
        label: 'College program', value: metaTxt, statKey: 'college_program',
        context: `${prof.college||''} college career`,
      }), 'note-tag-hit')
    : metaInner;

  return `<div class="cfb-panel">
      <div class="cfb-head">
        <div class="cfb-title">College production</div>
        <div class="cfb-meta">${metaTagged}</div>
      </div>
      ${summary}
      <div class="cfb-bars">${bars}</div>
      <div class="cfb-bars-note">Percentile vs ${escHtml(refTxt)} at ${escHtml(prof.pos)}. Higher is better on every row.</div>
      ${_cfbSeasonTable(prof, pid, base)}
      <div class="pcard-src">College play-by-play via cfbfastR / CollegeFootballData.
        No air yards, routes or snap data exists for college football, so those cards stay NFL-only.</div>
    </div>`;
}
