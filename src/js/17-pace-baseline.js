// ═════════════════════════════════════════════════════════════════════════════
// Pace baseline — the user's projections frozen at kickoff.
//
// When the NFL flips to the regular season, the working projections are snapshotted
// ONCE for that season. The in-season "Pace" view always compares live actuals to
// this frozen line, so the user can keep editing their working set (ROS updates)
// without moving their own goalposts. Stored under its OWN localStorage key —
// deliberately outside triplecrown.session.v1, whose quota shedding must never
// take the baseline with it. Written once per season, not on every slider tick.
// ═════════════════════════════════════════════════════════════════════════════

let PACE_BASELINE = null;   // unpacked: {v, season, frozenAt, frozenWeek, players:{key→row}}
const TC_PACE_KEY = 'triplecrown.paceBaseline.v1';
// Raw stat columns frozen per player — enough to re-score under ANY league scoring later.
const _PB_FIELDS = ['passing_yards','passing_tds','passing_attempts','passing_completions',
  'interceptions_thrown','rushing_yards','rushing_tds','rushing_attempts',
  'receiving_yards','receiving_tds','receptions','receiving_targets','fumbles_lost'];

function _pbKey(p){ return (p && p.player_id!=null && p.player_id!=='') ? String(p.player_id) : `${p.name}|${p.pos}`; }

// Column-packed wire form (~80KB for a full board) ↔ row objects.
function _pbPack(players){
  const out={};
  for(const k in players){
    const r=players[k];
    out[k]=[r.name, r.team, r.pos].concat(_PB_FIELDS.map(f=>{ const v=Number(r[f]||0); return v?+v.toFixed(1):0; }));
  }
  return out;
}
function _pbUnpack(packed, fields){
  const cols = Array.isArray(fields) && fields.length ? fields : _PB_FIELDS;
  const out={};
  for(const k in packed){
    const a=packed[k]; if(!Array.isArray(a)) continue;
    const r={name:a[0], team:a[1], pos:a[2], player_id:(k.indexOf('|')<0?k:null)};
    cols.forEach((f,i)=>{ r[f]=Number(a[3+i]||0); });
    out[k]=r;
  }
  return out;
}

function loadPaceBaseline(){
  if(PACE_BASELINE) return PACE_BASELINE;
  try{
    const raw = (typeof localStorage!=='undefined') ? localStorage.getItem(TC_PACE_KEY) : null;
    if(!raw) return null;
    const j = JSON.parse(raw);
    if(!j || j.v!==1 || !j.players) return null;
    PACE_BASELINE = {v:1, season:Number(j.season), frozenAt:j.frozenAt||0,
      frozenWeek:Number(j.frozenWeek||1), players:_pbUnpack(j.players, j.fields)};
  }catch(e){ PACE_BASELINE = null; }
  return PACE_BASELINE;
}

var _pbFreezing = false;       // re-entrancy guard (var: safe under concat order)
var _pbQuotaWarned = false;
// The ONLY writer. Freeze-once semantics: a stored baseline for this season makes every
// later call a no-op, so re-entering the regular season weeks later can't re-freeze.
// A late first open (user first visits in week 8) still freezes, honestly labeled by
// frozenWeek so the UI can say what the baseline actually captured.
function maybeFreezePaceBaseline(){
  if(_pbFreezing) return false;
  if(typeof hasSeasonStarted!=='function' || !hasSeasonStarted()) return false;
  if(Number(PROJ_SEASON)!==Number(TC_SEASON.year)) return false;   // stale seed → wrong year, never freeze
  if(typeof activeSeason!=='undefined' && activeSeason!=='proj') return false;  // must snapshot the WORKING set
  const existing = loadPaceBaseline();
  if(existing && Number(existing.season)===Number(TC_SEASON.year)) return false;
  if(typeof buildPlayerList!=='function') return false;
  _pbFreezing = true;
  try{
    const list = buildPlayerList();
    if(!Array.isArray(list) || !list.length) return false;
    const players={};
    list.forEach(p=>{
      const row={name:p.name, team:p.team, pos:p.pos, player_id:p.player_id||null};
      _PB_FIELDS.forEach(f=>{ row[f]=Number(p[f]||0); });
      players[_pbKey(p)]=row;
    });
    PACE_BASELINE = {v:1, season:Number(TC_SEASON.year), frozenAt:Date.now(),
      frozenWeek:Math.max(1, TC_SEASON.week||1), players};
    try{
      if(typeof localStorage!=='undefined')
        localStorage.setItem(TC_PACE_KEY, JSON.stringify({v:1, season:PACE_BASELINE.season,
          frozenAt:PACE_BASELINE.frozenAt, frozenWeek:PACE_BASELINE.frozenWeek,
          fields:_PB_FIELDS, players:_pbPack(players)}));
    }catch(e){
      // Quota — keep the in-memory copy (this session still paces correctly) and say so once.
      if(!_pbQuotaWarned && typeof toast==='function'){ _pbQuotaWarned=true;
        toast('Pace baseline kept in memory only (storage full) — it will re-freeze from your projections next visit','err'); }
    }
    if(typeof toast==='function') toast(`Projections frozen as your ${PACE_BASELINE.season} pace baseline (week ${PACE_BASELINE.frozenWeek}) ✓`,'ok');
    return true;
  }finally{ _pbFreezing=false; }
}

// Frozen line for one player: by player_id first, then name|pos. null when absent.
function getPaceBaseline(pidOrPlayer){
  const b = PACE_BASELINE || loadPaceBaseline();
  if(!b) return null;
  if(typeof pidOrPlayer==='object' && pidOrPlayer){
    return b.players[_pbKey(pidOrPlayer)] || b.players[`${pidOrPlayer.name}|${pidOrPlayer.pos}`] || null;
  }
  return b.players[String(pidOrPlayer)] || null;
}

// Dev/explicit only — never called automatically.
function resetPaceBaseline(){
  PACE_BASELINE=null;
  try{ if(typeof localStorage!=='undefined') localStorage.removeItem(TC_PACE_KEY); }catch(e){}
}
