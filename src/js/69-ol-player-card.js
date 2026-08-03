// ── OL grades card (player-card "OL Grades" tab) ───────────────────────────
// Seed payload: NFLVERSE[season].ol_players[normName] = {
//   team, slot, pos, pass_grade, pass_pctile, pass_conf, pass_snaps,
//   run_grade, run_pctile, run_conf, poa_carries, shared_credit,
//   penalty_rate, allpro_recent, career_ap1, career_pb, consensus_flag, market_pctile,
//   pass_rate, run_rate, ol_weighted_pctile, ol_weighted_grade,
//   entanglement_factor, is_projected_starter, last5_sacks_allowed_est
// }

const OL_CARD_POS = new Set(['LT','LG','C','RG','RT','OL','G','T','OT','OG']);
const OL_TEAM_FIX = {LA:'LAR', OAK:'LV', SD:'LAC', STL:'LAR'};

let pcardOlSeason = null;
let pcardQbOlSeason = null;

function _pcardOlNorm(pid){
  const p=(typeof sleeperPlayers!=='undefined'&&sleeperPlayers&&sleeperPlayers[pid])||{};
  return ecrNormName(p.name||'');
}

function _olTeamCode(team){
  const t=String(team||'').toUpperCase();
  return OL_TEAM_FIX[t] || t;
}

function pcardOlSeasons(normName){
  if(typeof NFLVERSE==='undefined' || !NFLVERSE) return [];
  return Object.keys(NFLVERSE)
    .filter(s=>{ const d=NFLVERSE[s]&&NFLVERSE[s].ol_players; return d && d[normName]; })
    .sort((a,b)=>b-a);
}

function pcardOlAvailable(pid){
  return pcardOlSeasons(_pcardOlNorm(pid)).length>0;
}

function _olGradeClass(g){
  const c=String(g||'').trim().charAt(0).toUpperCase();
  if(c==='A') return 'a';
  if(c==='B') return 'b';
  if(c==='C') return 'c';
  if(c==='D') return 'd';
  return 'f';
}

function _olNum(v, dp=1){
  if(v==null || Number.isNaN(v)) return '—';
  return Number(v).toFixed(dp);
}

function _olPct(v){
  if(v==null || Number.isNaN(v)) return '—';
  return `${Number(v).toFixed(1)}%`;
}

function _olRankClass(rank){
  if(typeof sharpRankClass==='function') return sharpRankClass(rank)||'';
  if(rank==null) return '';
  if(rank<=8) return 'sr-good';
  if(rank<=16) return 'sr-okhi';
  if(rank<=24) return 'sr-oklo';
  return 'sr-bad';
}

function _olRankBadge(rank){
  if(rank==null || Number.isNaN(rank)) return '<span class="olc-rank-muted">Rank —</span>';
  const rk=Number(rank);
  return `<span class="sr-badge ${_olRankClass(rk)} olc-rank-badge">Rank #${rk}</span>`;
}

function _olRankFromPct(pct){
  if(pct==null || Number.isNaN(pct)) return null;
  const p=Math.max(0, Math.min(100, Number(pct)));
  return Math.max(1, Math.min(32, Math.round(((100-p)/100)*31)+1));
}

function _olFmtMetric(col, val){
  if(val==null || Number.isNaN(val)) return '—';
  const n=Number(val);
  if(col==='Dropbacks' || col==='Last 5 Sacks Allowed') return String(Math.round(n));
  if(/Rate/.test(col)) return `${n.toFixed(1)}%`;
  if(col==='Time to Throw') return `${n.toFixed(2)}s`;
  if(col==='Pocket Time' || col==='Time to LOS') return `${n.toFixed(2)}s`;
  if(col==='Yards Before Contact Per RB Rush') return n.toFixed(2);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function _olMetricScoreFromRow(row, keys){
  if(!row || !row.values) return null;
  for(const k of keys){
    if(row.values[k]!=null && !Number.isNaN(Number(row.values[k]))) return Number(row.values[k]);
  }
  return null;
}

function _olMetricRankFromRow(row, keys){
  if(!row || !row.ranks) return null;
  for(const k of keys){
    if(row.ranks[k]!=null && !Number.isNaN(Number(row.ranks[k]))) return Number(row.ranks[k]);
  }
  return null;
}

function _olNormName(n){ return ecrNormName(String(n||'')); }

let _olLatestExplicitSlotCache = null;
function _olLatestExplicitSlotByName(){
  if(_olLatestExplicitSlotCache) return _olLatestExplicitSlotCache;
  const out={};
  if(!(typeof NFLVERSE==='object' && NFLVERSE)) return out;
  const allSeasons=Object.keys(NFLVERSE);
  const seasons=[];
  if(allSeasons.includes('2026')) seasons.push('2026');
  seasons.push(...allSeasons
    .filter(s=>s!=='2026')
    .sort((a,b)=>Number(b)-Number(a)));
  for(const s of seasons){
    const rosters=(NFLVERSE[s]&&NFLVERSE[s].rosters)||{};
    for(const tm in rosters){
      const rows=rosters[tm]||[];
      for(const r of rows){
        const nm=_olNormName(r&&r[0]);
        const pos=String((r&&r[1])||'').toUpperCase();
        if(!nm || out[nm]) continue;
        if(pos==='LT' || pos==='LG' || pos==='C' || pos==='RG' || pos==='RT') out[nm]=pos;
      }
    }
  }
  _olLatestExplicitSlotCache = out;
  return out;
}

let _olGradesSlotHintsCache = null;
function _olGradesSlotHints(){
  if(_olGradesSlotHintsCache) return _olGradesSlotHintsCache;
  const byTeam={};
  const global={};
  if(!(typeof NFLVERSE==='object' && NFLVERSE)) return {byTeam, global};
  const allSeasons=Object.keys(NFLVERSE).sort((a,b)=>Number(b)-Number(a));
  for(const s of allSeasons){
    const pack=NFLVERSE[s]||{};
    const pl=pack.ol_players||{};
    for(const k in pl){
      const r=pl[k]||{};
      const nm=_olNormName(r.name||k);
      const tm=_olTeamCode(r.team||'');
      const sl=String(r.slot||'').toUpperCase();
      if(!nm || !tm) continue;
      if(!(sl==='LT'||sl==='LG'||sl==='C'||sl==='RG'||sl==='RT')) continue;
      const tkey=`${tm}|${nm}`;
      if(!byTeam[tkey]) byTeam[tkey]=sl;
      if(!global[nm]) global[nm]=sl;
    }
  }
  _olGradesSlotHintsCache = {byTeam, global};
  return _olGradesSlotHintsCache;
}

function _olPosFamily(pos){
  const p=String(pos||'').toUpperCase();
  if(p==='C') return 'C';
  if(p==='LG' || p==='RG' || p==='G' || p==='OG') return 'G';
  if(p==='LT' || p==='RT' || p==='T' || p==='OT') return 'T';
  return 'OL';
}
function _olSlotFamily(slot){
  if(slot==='C') return 'C';
  if(slot==='LG' || slot==='RG') return 'G';
  if(slot==='LT' || slot==='RT') return 'T';
  return 'OL';
}

function _olRosterSlotsBySeason(season, teamCode, preferredSlotByName){
  const pack=(NFLVERSE&&NFLVERSE[String(season)])||{};
  const rows=(pack.rosters&&pack.rosters[teamCode])||[];
  if(!rows.length) return null;
  const olPos = new Set(['LT','LG','C','RG','RT','T','G','OT','OG','OL']);
  const sNum=Number(season);
  const prevSeason=Number.isFinite(sNum)?String(sNum-1):'';
  const prevPack=(NFLVERSE&&NFLVERSE[prevSeason])||{};
  const prevRows=(prevPack.rosters&&prevPack.rosters[teamCode])||[];
  const prevSnapsByName={};
  for(const r of prevRows){
    const nm=_olNormName(r&&r[0]);
    const pos=String((r&&r[1])||'').toUpperCase();
    if(!nm || !olPos.has(pos)) continue;
    const snaps=Number((r&&r[7])||0);
    if(prevSnapsByName[nm]==null || snaps>prevSnapsByName[nm]) prevSnapsByName[nm]=snaps;
  }
  const latestKnown=_olLatestExplicitSlotByName();
  const slotHints=_olGradesSlotHints();
  const cand = rows
    .map(r=>{
      const name=String((r&&r[0])||'').trim();
      const pos=String((r&&r[1])||'').toUpperCase();
      const nkey=_olNormName(name);
      const teamHint=slotHints.byTeam[`${teamCode}|${nkey}`]||null;
      const globalHint=slotHints.global[nkey]||null;
      const preferred=(preferredSlotByName&&preferredSlotByName[nkey])||teamHint||latestKnown[nkey]||globalHint||null;
      const lockFamily=_olSlotFamily(preferred);
      return {
        name,
        pos,
        snaps:Number((r&&r[7])||0),
        prevSnaps:Number(prevSnapsByName[nkey]||0),
        explicit:(pos==='LT'||pos==='LG'||pos==='C'||pos==='RG'||pos==='RT')?pos:null,
        preferred,
        lockFamily,
      };
    })
    .filter(r=>r.name && olPos.has(r.pos))
    .sort((a,b)=>
      (b.snaps-a.snaps)
      || (b.prevSnaps-a.prevSnaps)
      || String(a.name).localeCompare(String(b.name))
    );
  if(!cand.length) return null;
  const out={LT:null,LG:null,C:null,RG:null,RT:null};
  const used=new Set();
  const slots=['LT','LG','C','RG','RT'];
  const fits=(c, slot)=>{
    let fam=_olPosFamily(c.pos);
    if(fam==='OL' && c.lockFamily && c.lockFamily!=='OL') fam=c.lockFamily;
    const sf=_olSlotFamily(slot);
    if(sf==='C') return fam==='C' || fam==='OL';
    if(sf==='G') return fam==='G' || fam==='OL';
    if(sf==='T') return fam==='T' || fam==='OL';
    return true;
  };
  const claim=(slot, pred)=>{
    if(out[slot]) return;
    const hit=cand.find(c=>!used.has(c.name) && fits(c,slot) && (!pred || pred(c)));
    if(!hit) return;
    used.add(hit.name);
    out[slot]=hit;
  };

  // 1) Explicit side/center tags from that season roster are highest-confidence.
  for(const sl of slots) claim(sl, c=>c.explicit===sl);
  // 2) Preferred side from ol metadata / latest explicit side history.
  for(const sl of slots) claim(sl, c=>c.preferred===sl);
  // 3) Family-only fallback (never place C at T, or G at C, etc.).
  claim('C', c=>_olPosFamily(c.pos)==='C');
  claim('LT', c=>_olPosFamily(c.pos)==='T');
  claim('RT', c=>_olPosFamily(c.pos)==='T');
  claim('LG', c=>_olPosFamily(c.pos)==='G');
  claim('RG', c=>_olPosFamily(c.pos)==='G');
  // 4) Generic OL as last-resort fillers.
  for(const sl of slots) claim(sl, c=>_olPosFamily(c.pos)==='OL');
  return out;
}

function _olPlayerMetaByName(season, teamCode){
  const pack=(NFLVERSE&&NFLVERSE[String(season)])||{};
  const pl=pack.ol_players||{};
  const out={};
  for(const k in pl){
    const r=pl[k]||{};
    if(_olTeamCode(r.team)!==teamCode) continue;
    const nm=_olNormName(r.name);
    if(!nm) continue;
    out[nm]=r;
  }
  return out;
}

function _olLineByTeamSeason(season, teamCode){
  const pack=(NFLVERSE&&NFLVERSE[String(season)])||{};

  // Preferred source: rb_fan line cards are built from the season-specific OL slot map,
  // so this captures real year-to-year personnel changes most reliably.
  const rf=pack.rb_fan||{};
  for(const k in rf){
    const rec=rf[k]||{};
    if(_olTeamCode(rec.team)!==teamCode) continue;
    if(rec.line && typeof rec.line==='object'){
      const out={LT:null, LG:null, C:null, RG:null, RT:null};
      for(const sl of ['LT','LG','C','RG','RT']){
        const r=rec.line[sl]||null;
        if(!r) continue;
        out[sl]={
          name:r.name||null,
          run_grade:r.run_grade||null,
          pass_grade:r.pass_grade||null,
          pass_snaps:r.pass_snaps!=null?Number(r.pass_snaps):null,
        };
      }
      const metaByName=_olPlayerMetaByName(season, teamCode);
      for(const sl of ['LT','LG','C','RG','RT']){
        const cur=out[sl]; if(!cur || !cur.name) continue;
        const m=metaByName[_olNormName(cur.name)]||{};
        out[sl]={
          name:cur.name,
          run_grade:cur.run_grade||m.run_grade||null,
          pass_grade:cur.pass_grade||m.pass_grade||null,
          pass_snaps:cur.pass_snaps!=null?Number(cur.pass_snaps):(m.pass_snaps!=null?Number(m.pass_snaps):null),
          pass_pctile:m.pass_pctile!=null?Number(m.pass_pctile):null,
          is_projected_starter:(m.is_projected_starter===true),
        };
      }
      const preferredByName={};
      for(const nk in metaByName){
        const sl=String(metaByName[nk]&&metaByName[nk].slot||'').toUpperCase();
        if(sl==='LT'||sl==='LG'||sl==='C'||sl==='RG'||sl==='RT') preferredByName[nk]=sl;
      }
      const rosterSlots=_olRosterSlotsBySeason(season, teamCode, preferredByName);
      if(!rosterSlots) return out;
      const byName={};
      for(const sl of ['LT','LG','C','RG','RT']){
        const r=out[sl];
        if(r&&r.name) byName[_olNormName(r.name)]=r;
      }
      const merged={LT:null,LG:null,C:null,RG:null,RT:null};
      for(const sl of ['LT','LG','C','RG','RT']){
        const rr=rosterSlots[sl];
        if(!rr || !rr.name){ merged[sl]=out[sl]||null; continue; }
        const key=_olNormName(rr.name);
        const g=byName[key] || metaByName[key] || {};
        merged[sl]={
          name:rr.name,
          run_grade:g.run_grade||null,
          pass_grade:g.pass_grade||null,
          pass_snaps:g.pass_snaps!=null?Number(g.pass_snaps):null,
          pass_pctile:g.pass_pctile!=null?Number(g.pass_pctile):null,
          is_projected_starter:(g.is_projected_starter===true),
        };
      }
      return merged;
    }
  }

  // Fallback: derive from ol_players if rb_fan line block is unavailable.
  const pl=pack.ol_players||{};
  const slots={LT:null, LG:null, C:null, RG:null, RT:null};
  const metaByName=_olPlayerMetaByName(season, teamCode);
  for(const k in pl){
    const r=pl[k]||{};
    if(_olTeamCode(r.team)!==teamCode) continue;
    const sl=String(r.slot||'').toUpperCase();
    if(!Object.prototype.hasOwnProperty.call(slots, sl)) continue;
    const cur=slots[sl];
    const curSnap=cur&&cur.pass_snaps!=null?Number(cur.pass_snaps):-1;
    const nextSnap=r.pass_snaps!=null?Number(r.pass_snaps):-1;
    if(!cur || nextSnap>curSnap) slots[sl]=r;
  }
  const preferredByName={};
  for(const nk in metaByName){
    const sl=String(metaByName[nk]&&metaByName[nk].slot||'').toUpperCase();
    if(sl==='LT'||sl==='LG'||sl==='C'||sl==='RG'||sl==='RT') preferredByName[nk]=sl;
  }
  const rosterSlots=_olRosterSlotsBySeason(season, teamCode, preferredByName);
  if(!rosterSlots) return slots;
  const byName={};
  for(const sl of ['LT','LG','C','RG','RT']){
    const r=slots[sl];
    if(r&&r.name) byName[_olNormName(r.name)]=r;
  }
  const merged={LT:null,LG:null,C:null,RG:null,RT:null};
  for(const sl of ['LT','LG','C','RG','RT']){
    const rr=rosterSlots[sl];
    if(!rr || !rr.name){ merged[sl]=slots[sl]||null; continue; }
    const key=_olNormName(rr.name);
    const g=byName[key] || metaByName[key] || {};
    merged[sl]={
      name:rr.name,
      run_grade:g.run_grade||null,
      pass_grade:g.pass_grade||null,
      pass_snaps:g.pass_snaps!=null?Number(g.pass_snaps):null,
      pass_pctile:g.pass_pctile!=null?Number(g.pass_pctile):null,
      is_projected_starter:(g.is_projected_starter===true),
    };
  }
  return merged;
}

function _qbTeamForSeason(pid, season, normName, fallbackTeam){
  const pack=(NFLVERSE&&NFLVERSE[String(season)])||{};
  const qb=(pack.qb_passing&&pack.qb_passing[normName])||null;
  const qbTeam=_olTeamCode((qb&&qb.team)||'');
  if(qbTeam) return qbTeam;

  // Fallback when qb_passing name keys miss: infer team from this season's roster using
  // sleeper id first, then normalized QB name match.
  const rosters=pack.rosters||{};
  const pidStr=String(pid||'');
  for(const tm in rosters){
    const rows=rosters[tm]||[];
    for(const r of rows){
      const pos=String(r&&r[1]||'').toUpperCase();
      if(pos!=='QB') continue;
      const sid = r && r[5]!=null ? String(r[5]) : '';
      if(pidStr && sid && sid===pidStr) return _olTeamCode(tm);
    }
  }
  const nn=String(normName||'');
  for(const tm in rosters){
    const rows=rosters[tm]||[];
    for(const r of rows){
      const pos=String(r&&r[1]||'').toUpperCase();
      if(pos!=='QB') continue;
      const nm=ecrNormName(String(r&&r[0]||''));
      if(nn && nm===nn) return _olTeamCode(tm);
    }
  }
  return _olTeamCode(fallbackTeam||'');
}

function _olHeadshot(name, slot){
  if(!name) return '';
  const src = (typeof hsURL==='function') ? hsURL({name, pos:slot}) : '';
  if(!src) return '<div class="olc-qb-hs ph-err"></div>';
  return `<img src="${src}" class="olc-qb-hs" alt="" onerror="this.outerHTML='<div class=\\'olc-qb-hs ph-err\\'></div>'">`;
}

function pcardQbOlAvailable(pid){
  if(typeof NFLVERSE==='undefined' || !NFLVERSE) return false;
  const p=(typeof sleeperPlayers!=='undefined'&&sleeperPlayers&&sleeperPlayers[pid])||{};
  if(String(p.position||p.pos||'').toUpperCase()!=='QB') return false;
  const teamNow=_olTeamCode(p.team||'');
  if(!teamNow) return false;
  return Object.keys(NFLVERSE).some(s=>{
    const pack=NFLVERSE[s]||{};
    const tbl=pack.team&&pack.team.offensive_line_pass;
    return !!(tbl && tbl.teams && tbl.teams[teamNow]);
  });
}

function renderPcardQbOl(pid){
  const p=(typeof sleeperPlayers!=='undefined'&&sleeperPlayers&&sleeperPlayers[pid])||{};
  const norm=ecrNormName(p.name||'');
  if(!norm) return '<div class="pcard-loading">No QB identity found for OL context view.</div>';

  let seasons=(typeof NFLVERSE==='object'&&NFLVERSE)?Object.keys(NFLVERSE)
    .filter(s=>{
      const pack=NFLVERSE[s]||{};
      const tm=_qbTeamForSeason(pid, s, norm, p.team||'');
      const passTbl=pack.team&&pack.team.offensive_line_pass;
      return !!(tm && passTbl && passTbl.teams && passTbl.teams[tm]);
    })
    .sort((a,b)=>b-a):[];
  // Fallback for occasional name mismatches: if we cannot tie this QB to a season-specific
  // qb_passing row, show current-team OL context so the tab still renders.
  if(!seasons.length){
    seasons=(typeof NFLVERSE==='object'&&NFLVERSE)?Object.keys(NFLVERSE)
      .filter(s=>{
        const pack=NFLVERSE[s]||{};
        const passTbl=pack.team&&pack.team.offensive_line_pass;
        const tm=_olTeamCode(p.team||'');
        return !!(tm && passTbl && passTbl.teams && passTbl.teams[tm]);
      })
      .sort((a,b)=>b-a):[];
  }
  if(!seasons.length) return '<div class="pcard-loading">No OL pass-protection data available for this QB.</div>';
  if(pcardQbOlSeason==null || !seasons.includes(String(pcardQbOlSeason))) pcardQbOlSeason=seasons[0];
  const season=String(pcardQbOlSeason);
  const pack=NFLVERSE[season]||{};
  const teamCode=_qbTeamForSeason(pid, season, norm, p.team||'');
  if(!teamCode) return '<div class="pcard-loading">No team context available for this QB in that season.</div>';

  const passTbl=pack.team&&pack.team.offensive_line_pass;
  const row=passTbl&&passTbl.teams&&passTbl.teams[teamCode];
  const cols=(passTbl&&passTbl.columns)||[];
  if(!row || !cols.length) return '<div class="pcard-loading">No team pass-protection table found for this season.</div>';

  const line=_olLineByTeamSeason(season, teamCode);
  const slotCards=['LT','LG','C','RG','RT'].map(sl=>{
    const r=line[sl]||{};
    const g=r.pass_grade||'—';
    const pct=(r.pass_pctile==null||Number.isNaN(r.pass_pctile))?'—':`${Number(r.pass_pctile).toFixed(1)}%`;
    const pctRank=_olRankFromPct(r.pass_pctile);
    const pctBadge=pctRank!=null ? `<span class="sr-badge ${_olRankClass(pctRank)} olc-rank-badge">${pct}</span>` : `<span class="olc-rank-muted">${pct}</span>`;
    const snaps=(r.pass_snaps==null||Number.isNaN(r.pass_snaps))?'—':Number(r.pass_snaps).toLocaleString();
    const starter = r.is_projected_starter===true ? '<span class="olc-starter-pill">Starter</span>' : '';
    const click = r.name ? `openPlayerCardFromCard(${pcardArg(r.name)},${pcardArg(sl)},${pcardArg(teamCode)})` : '';
    return `<div class="olc-qb-slot-card${r.name?' clickable-player':''}" ${r.name?`onclick="${click}" role="button" tabindex="0"`:''}>
      <div class="olc-qb-slot-top"><span class="olc-qb-slot">${sl}</span>${starter}</div>
      ${_olHeadshot(r.name||'', sl)}
      <div class="olc-qb-name">${r.name||'—'}</div>
      <div class="olc-qb-grade ${_olGradeClass(g)}">${g}</div>
      <div class="olc-qb-sub">${pctBadge} · ${snaps} snaps</div>
    </div>`;
  }).join('');

  const metricCols=cols.filter(c=>c!=='Last 5 Sacks Allowed' && c!=='Last 5 Sack Rate');
  const overallPassScore=_olMetricScoreFromRow(row, ['Pass Score','Overall Score','Overall','Score']);
  const overallPassRank=_olMetricRankFromRow(row, ['Pass Score','Overall Score','Overall','Score']);
  const overallPassHtml = (overallPassScore!=null || overallPassRank!=null)
    ? `<div class="olc-overview"><b>Cumulative Pass Protection Score: ${overallPassScore!=null?overallPassScore.toFixed(1):'—'}</b> ${_olRankBadge(overallPassRank)}</div>`
    : '';
  const teamMetrics=metricCols.map(c=>{
    const v=row.values?row.values[c]:null;
    const rk=row.ranks?row.ranks[c]:null;
    return `<div class="olc-metric">
      <label>${c}</label>
      <b>${_olFmtMetric(c,v)}</b>
      <small>${_olRankBadge(rk)}</small>
    </div>`;
  }).join('');

  const seasonBtns=seasons.map(s=>`<button class="rt-season-btn ${String(s)===season?'active':''}" onclick="setPcardQbOlSeason('${s}')">${s}</button>`).join('');

  return `<div class="olc-wrap">
    <div class="rt-head">
      <div class="rt-seasons">${seasonBtns}</div>
      <div class="rt-summary">${teamDisplayName(teamCode)||teamCode} · pass protection context for ${p.name||'QB'}</div>
    </div>
    ${overallPassHtml}
    <div class="olc-team-head">${teamDisplayName(teamCode)||teamCode} Offensive Line (Pass Protection)</div>
    <div class="olc-qb-slot-grid">${slotCards}</div>
    <div class="olc-team-head" style="margin-top:10px">Team Pass Protection Metrics (${season})</div>
    <div class="olc-metrics">${teamMetrics}</div>
    <div class="pcard-src">Linemen from this season's team context; pass grades from the OL pipeline.</div>
  </div>`;
}

function setPcardQbOlSeason(season){
  pcardQbOlSeason=season;
  const body=document.getElementById('pcardBody');
  if(body && pcardState) body.innerHTML=renderPcardQbOl(pcardState.pid);
}

function renderPcardOlGrades(pid){
  const norm=_pcardOlNorm(pid);
  const seasons=pcardOlSeasons(norm);
  if(!seasons.length) return '<div class="pcard-loading">No OL grades available for this player.</div>';
  if(pcardOlSeason==null || !seasons.includes(String(pcardOlSeason))) pcardOlSeason=seasons[0];
  const season=String(pcardOlSeason);

  const pack=NFLVERSE[season]||{};
  const rec=(pack.ol_players&&pack.ol_players[norm])||null;
  if(!rec) return '<div class="pcard-loading">No OL grades available for this season.</div>';

  const teamCode=_olTeamCode(rec.team);
  const olPassTable=pack.team&&pack.team.offensive_line_pass;
  const olRunTable=pack.team&&pack.team.offensive_line_run;
  const olLegacyTable=pack.team&&pack.team.offensive_line;
  const passRow=olPassTable&&olPassTable.teams&&olPassTable.teams[teamCode];
  const runRow=olRunTable&&olRunTable.teams&&olRunTable.teams[teamCode];
  const legacyRow=olLegacyTable&&olLegacyTable.teams&&olLegacyTable.teams[teamCode];
  const passCols=((olPassTable&&olPassTable.columns)||[])
    .filter(c=>c!=='Last 5 Sacks Allowed' && c!=='Last 5 Sack Rate');
  const runCols=(olRunTable&&olRunTable.columns)||[];
  const legacyCols=(olLegacyTable&&olLegacyTable.columns)||[];
  const seasonBtns=seasons.map(s=>`<button class="rt-season-btn ${String(s)===season?'active':''}" onclick="setPcardOlSeason('${s}')">${s}</button>`).join('');

    const metricRow = (title, row, cols) => `<div class="olc-team-head" style="margin-top:8px">${title}</div><div class="olc-metrics">${cols.map(c=>{
      const v=row.values ? row.values[c] : null;
      const r=row.ranks ? row.ranks[c] : null;
      return `<div class="olc-metric">
        <label>${c}</label>
        <b>${_olFmtMetric(c, v)}</b>
        <small>${_olRankBadge(r)}</small>
      </div>`;
    }).join('')}</div>`;

  const metrics = (passRow && passCols.length) || (runRow && runCols.length)
    ? `${passRow&&passCols.length?metricRow('Pass Protection', passRow, passCols):''}${runRow&&runCols.length?metricRow('Run Blocking', runRow, runCols):''}`
    : ((legacyRow && legacyCols.length)
      ? metricRow('Offensive Line Context', legacyRow, legacyCols)
      : '<div class="pcard-loading">Team OL metrics unavailable for this season.</div>');

  const flagBits=[];
  if(rec.shared_credit) flagBits.push(`Shared credit ${rec.shared_credit}`);
  if(rec.consensus_flag) flagBits.push(String(rec.consensus_flag));
  const flags = flagBits.length ? `<div class="olc-flags">${flagBits.join(' · ')}</div>` : '';

  const passPctRank=_olRankFromPct(rec.pass_pctile);
  const runPctRank=_olRankFromPct(rec.run_pctile);
  const weightedPctRank=_olRankFromPct(rec.ol_weighted_pctile);
  const marketPctRank=_olRankFromPct(rec.market_pctile);

  return `<div class="olc-wrap">
    <div class="rt-head">
      <div class="rt-seasons">${seasonBtns}</div>
      <div class="rt-summary">${teamDisplayName(teamCode)||teamCode||'Team'} · ${rec.slot||rec.pos||'OL'} · validated OL pipeline grades</div>
    </div>

    <div class="olc-grades">
      <div class="olc-grade-tile">
        <label>Pass Grade</label>
        <b class="olc-grade ${_olGradeClass(rec.pass_grade)}">${rec.pass_grade||'—'}</b>
        <small>${_olPct(rec.pass_pctile)} pctile · ${passPctRank!=null?_olRankBadge(passPctRank):'<span class="olc-rank-muted">Rank —</span>'} · ${rec.pass_conf||'—'} conf · ${rec.pass_snaps!=null?Number(rec.pass_snaps).toLocaleString():'—'} snaps</small>
      </div>
      <div class="olc-grade-tile">
        <label>Run Grade</label>
        <b class="olc-grade ${_olGradeClass(rec.run_grade)}">${rec.run_grade||'—'}</b>
        <small>${_olPct(rec.run_pctile)} pctile · ${runPctRank!=null?_olRankBadge(runPctRank):'<span class="olc-rank-muted">Rank —</span>'} · ${rec.run_conf||'—'} conf · ${rec.poa_carries!=null?Number(rec.poa_carries).toLocaleString():'—'} POA carries</small>
      </div>
      <div class="olc-grade-tile">
        <label>Utilization-Weighted OL Grade</label>
        <b class="olc-grade ${_olGradeClass(rec.ol_weighted_grade)}">${rec.ol_weighted_grade||'—'}</b>
        <small>${_olPct(rec.ol_weighted_pctile)} pctile · ${weightedPctRank!=null?_olRankBadge(weightedPctRank):'<span class="olc-rank-muted">Rank —</span>'} · pass weight ${rec.pass_rate!=null?`${Number(rec.pass_rate).toFixed(1)}%`:'—'} · run weight ${rec.run_rate!=null?`${Number(rec.run_rate).toFixed(1)}%`:'—'}</small>
      </div>
      <div class="olc-mini-grid">
        <div><span>Penalty Rate</span><b>${_olNum(rec.penalty_rate,2)}%</b></div>
        <div><span>Projected Starter</span><b>${rec.is_projected_starter?'Yes':'No'}</b></div>
        <div><span>Entanglement Factor</span><b>${rec.entanglement_factor!=null?Number(rec.entanglement_factor).toFixed(2):'—'}</b></div>
        <div><span>All-Pro Recent</span><b>${rec.allpro_recent||'—'}</b></div>
        <div><span>Career AP1 / PB</span><b>${rec.career_ap1!=null?rec.career_ap1:'—'} / ${rec.career_pb!=null?rec.career_pb:'—'}</b></div>
        <div><span>Market Percentile</span><b>${rec.market_pctile==null||Number.isNaN(rec.market_pctile)?'—':`${Math.round(Number(rec.market_pctile))}%`} ${marketPctRank!=null?_olRankBadge(marketPctRank):''}</b></div>
      </div>
    </div>

    ${flags}

    <div class="olc-team-head">${teamDisplayName(teamCode)||teamCode||'Team'} Offensive Line Context (${season})</div>
    ${metrics}

    <div class="pcard-src">Player grades from local OL pipeline csv; team context from nflverse offensive-line season table.</div>
  </div>`;
}

function setPcardOlSeason(season){
  pcardOlSeason=season;
  const body=document.getElementById('pcardBody');
  if(body && pcardState) body.innerHTML=renderPcardOlGrades(pcardState.pid);
}
