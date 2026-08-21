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
const OL_PROJ_SEASON = String((typeof PROJ_SEASON!=='undefined' && PROJ_SEASON) ? PROJ_SEASON : new Date().getFullYear());

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

// Model grades are plus-minus attributions of a team outcome — pressure allowed is charged
// to all five linemen equally, because no free data source records who lost the rep. Measured
// split-half reliability of the individual coefficient is r ≈ 0.07, so a percentile carried to
// a tenth and a league rank to the unit assert precision the pipeline does not have. Report a
// coarse band instead: the resolution the model can actually support.
const OL_PCT_BANDS=[
  [80,'Top 20%'],[60,'Upper third'],[40,'Middle'],[20,'Lower third'],[0,'Bottom 20%']
];
function _olPctBand(v){
  if(v==null || Number.isNaN(v)) return '—';
  const n=Math.max(0, Math.min(100, Number(v)));
  const hit=OL_PCT_BANDS.find(([floor])=>n>=floor);
  return hit?hit[1]:'—';
}

// Show WHY a grade is what it is. A composite that cannot be explained reads as a black box,
// and these three components are the whole model.
function _olDriverBar(rec){
  const parts=[['Market',rec.p_market],['Snaps',rec.p_snap],['Draft',rec.p_draft]]
    .filter(([,v])=>v!=null && !Number.isNaN(Number(v)));
  if(!parts.length) return '';
  return `<div class="olc-drivers">${parts.map(([lab,v])=>{
    const n=Math.max(0,Math.min(100,Number(v)));
    return `<div class="olc-driver"><span>${lab}</span><i><u style="width:${n.toFixed(0)}%"></u></i><em>${n.toFixed(0)}</em></div>`;
  }).join('')}</div>`;
}

// Grade movement over the seasons a player has actually played. The market line is the one
// worth watching: a young lineman outplaying his rookie deal shows up as market climbing a
// year or two before the composite follows, which is the case the composite is weakest on.
function _olTrend(rec){
  const yrs=String(rec.hist_seasons||'').split(',').filter(Boolean);
  const ol=String(rec.ol_pctile_hist||'').split(',').map(v=>v===''?null:Number(v));
  const mkt=String(rec.market_pctile_hist||'').split(',').map(v=>v===''?null:Number(v));
  if(yrs.length<2) return '';
  const W=180,H=34,pad=3;
  const x=i=>pad+(i*(W-2*pad))/(yrs.length-1);
  const y=v=>H-pad-((Math.max(0,Math.min(100,v))/100)*(H-2*pad));
  const path=(arr)=>{
    const pts=arr.map((v,i)=>v==null?null:`${x(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean);
    return pts.length>1?pts.join(' '):'';
  };
  const olP=path(ol), mkP=path(mkt);
  if(!olP) return '';
  const first=ol.find(v=>v!=null), last=[...ol].reverse().find(v=>v!=null);
  const delta=(first!=null&&last!=null)?Math.round(last-first):null;
  const arrow=delta==null?'':(delta>4?`▲ ${delta}`:(delta<-4?`▼ ${Math.abs(delta)}`:'flat'));
  const cls=delta==null?'':(delta>4?'olc-up':(delta<-4?'olc-down':'olc-flat'));
  return `<div class="olc-trend">
    <div class="olc-trend-head"><span>${yrs[0]}–${yrs[yrs.length-1]} trend</span><b class="${cls}">${arrow}</b></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Grade percentile by season">
      <line x1="${pad}" y1="${y(50)}" x2="${W-pad}" y2="${y(50)}" class="olc-trend-mid"/>
      ${mkP?`<polyline points="${mkP}" class="olc-trend-mkt"/>`:''}
      <polyline points="${olP}" class="olc-trend-ol"/>
    </svg>
    <div class="olc-trend-key"><i class="k-ol"></i>Grade${mkP?' <i class="k-mkt"></i>Market':''}</div>
  </div>`;
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

function _olIsProjSeason(season){
  return String(season)===OL_PROJ_SEASON;
}

let _olLatestExplicitSlotCache = null;
function _olLatestExplicitSlotByName(){
  if(_olLatestExplicitSlotCache) return _olLatestExplicitSlotCache;
  const out={};
  if(!(typeof NFLVERSE==='object' && NFLVERSE)) return out;
  const allSeasons=Object.keys(NFLVERSE);
  const seasons=[];
  if(allSeasons.includes(OL_PROJ_SEASON)) seasons.push(OL_PROJ_SEASON);
  seasons.push(...allSeasons
    .filter(s=>s!==OL_PROJ_SEASON)
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

function _olDepthChartSlotsByTeam(teamCode){
  if(typeof espnDepth==='undefined') return null;
  const rows=espnDepth[teamCode];
  if(rows===undefined){
    if(typeof fetchEspnDepth==='function') fetchEspnDepth(teamCode).catch(()=>{});
    return null;
  }
  if(!Array.isArray(rows) || !rows.length) return null;

  const bySlot={};
  for(const r of rows){
    const k=String((r&&r.slot)||'').toLowerCase();
    if(!k) continue;
    bySlot[k]=r;
  }

  const out={LT:null,LG:null,C:null,RG:null,RT:null};
  const used=new Set();
  const take=(slot, keys)=>{
    for(const k of keys){
      const row=bySlot[k];
      if(!row || !Array.isArray(row.players)) continue;
      const p=row.players.find(x=>x&&x.name&&!used.has(_olNormName(x.name)));
      if(!p) continue;
      used.add(_olNormName(p.name));
      out[slot]={
        name:String(p.name||'').trim(),
        pos:String(p.pos||row.label||slot).toUpperCase(),
        snaps:0,
        prevSnaps:0,
        explicit:slot,
        preferred:slot,
        lockFamily:_olSlotFamily(slot),
      };
      return true;
    }
    return false;
  };

  take('LT', ['lt']);
  take('LG', ['lg']);
  take('C',  ['c']);
  take('RG', ['rg']);
  take('RT', ['rt']);

  // If ESPN omits side-specific rows, fill any gaps from generic OL rows by family.
  const pool=[];
  for(const k of ['ol','ot','og','g','t']){
    const row=bySlot[k];
    if(!row || !Array.isArray(row.players)) continue;
    for(const p of row.players){
      if(!p || !p.name) continue;
      const nk=_olNormName(p.name);
      if(!nk || used.has(nk)) continue;
      pool.push(p);
    }
  }
  const pull=(fam)=>{
    const i=pool.findIndex(p=>{
      const pf=_olPosFamily(String((p&&p.pos)||'').toUpperCase());
      if(fam==='C') return pf==='C';
      if(fam==='G') return pf==='G' || pf==='OL';
      if(fam==='T') return pf==='T' || pf==='OL';
      return true;
    });
    if(i<0) return null;
    return pool.splice(i,1)[0];
  };
  const fill=(slot, fam)=>{
    if(out[slot]) return;
    const p=pull(fam);
    if(!p) return;
    used.add(_olNormName(p.name));
    out[slot]={
      name:String(p.name||'').trim(),
      pos:String(p.pos||slot).toUpperCase(),
      snaps:0,
      prevSnaps:0,
      explicit:slot,
      preferred:slot,
      lockFamily:_olSlotFamily(slot),
    };
  };
  fill('C','C');
  fill('LT','T');
  fill('RT','T');
  fill('LG','G');
  fill('RG','G');

  const hasAny=Object.values(out).some(v=>v&&v.name);
  return hasAny ? out : null;
}

function _olRosterSlotsBySeason(season, teamCode, preferredSlotByName){
  if(_olIsProjSeason(season)){
    const depthSlots=_olDepthChartSlotsByTeam(teamCode);
    if(depthSlots) return depthSlots;
  }
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

function _olGradeToPct(grade){
  const g=String(grade||'').trim().toUpperCase();
  if(!g) return null;
  const base={A:95,B:82,C:70,D:58,F:45};
  const l=g.charAt(0);
  if(!Object.prototype.hasOwnProperty.call(base, l)) return null;
  let v=base[l];
  if(g.includes('+')) v+=3;
  if(g.includes('-')) v-=3;
  return Math.max(1, Math.min(99, v));
}

let _olLatestPlayerPctileCache = null;
function _olLatestPlayerPctileByName(){
  if(_olLatestPlayerPctileCache) return _olLatestPlayerPctileCache;
  const out={};
  if(!(typeof NFLVERSE==='object' && NFLVERSE)) return out;
  const seasons=Object.keys(NFLVERSE).sort((a,b)=>Number(b)-Number(a));
  for(const s of seasons){
    const pl=(NFLVERSE[s]&&NFLVERSE[s].ol_players)||{};
    for(const k in pl){
      const r=pl[k]||{};
      const nm=_olNormName(r.name||k);
      if(!nm || out[nm]) continue;
      const passPct=(r.pass_pctile!=null && !Number.isNaN(Number(r.pass_pctile))) ? Number(r.pass_pctile) : _olGradeToPct(r.pass_grade);
      const runPct=(r.run_pctile!=null && !Number.isNaN(Number(r.run_pctile))) ? Number(r.run_pctile) : _olGradeToPct(r.run_grade);
      out[nm]={
        pass_pctile:passPct,
        run_pctile:runPct,
        pass_grade:(r.pass_grade||null),
        run_grade:(r.run_grade||null),
        career_ap1:(r.career_ap1!=null?Number(r.career_ap1):0),
        career_pb:(r.career_pb!=null?Number(r.career_pb):0),
        allpro_recent:String(r.allpro_recent||''),
        market_pctile:(r.market_pctile!=null && !Number.isNaN(Number(r.market_pctile)))?Number(r.market_pctile):null,
      };
    }
  }
  _olLatestPlayerPctileCache = out;
  return out;
}

function _olPctFromStarter(rec, which){
  if(!rec) return null;
  if(which==='pass'){
    if(rec.pass_pctile!=null && !Number.isNaN(Number(rec.pass_pctile))) return Number(rec.pass_pctile);
    return _olGradeToPct(rec.pass_grade);
  }
  if(rec.run_pctile!=null && !Number.isNaN(Number(rec.run_pctile))) return Number(rec.run_pctile);
  return _olGradeToPct(rec.run_grade);
}

function _olAvgStarterPct(line, which){
  const vals=[];
  const latestByName=_olLatestPlayerPctileByName();
  for(const sl of ['LT','LG','C','RG','RT']){
    const r=line&&line[sl];
    if(!r || !r.name) continue;
    let pct=_olPctFromStarter(r, which);
    if((pct==null || Number.isNaN(pct)) && r.name){
      const snap=latestByName[_olNormName(r.name)]||{};
      pct = which==='pass' ? snap.pass_pctile : snap.run_pctile;
    }
    if(pct!=null && !Number.isNaN(Number(pct))) vals.push(Number(pct));
  }
  if(!vals.length) return null;
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}

function _olRankMap(valsByTeam, lowerBetterSet){
  const entries=Object.entries(valsByTeam).filter(([,v])=>v!=null && !Number.isNaN(Number(v)));
  entries.sort((a,b)=>{
    const av=Number(a[1]), bv=Number(b[1]);
    return (lowerBetterSet ? (av-bv) : (bv-av));
  });
  const out={};
  for(let i=0;i<entries.length;i++) out[entries[i][0]]=i+1;
  return out;
}

// Slot weights: pass protection is tackle-premium; run blocking is interior-premium.
const _OL_PASS_SLOT_W = {LT:1.30, RT:1.20, LG:1.00, RG:1.00, C:0.95};
const _OL_RUN_SLOT_W  = {C:1.20, LG:1.15, RG:1.15, LT:0.85, RT:0.85};

// A single projected starter's talent (0-100), earned on ANY prior team. This is the core
// signal: it reflects the player's own multi-year grade, not last year's team outcome — so a
// stud returning from an injury-wrecked team season is valued on his real ability, and an
// unknown/backup projected starter drops to a below-median replacement level.
function _olStarterTalent(rec, which){
  const latestByName=_olLatestPlayerPctileByName();
  const name = rec && rec.name;
  const snap = name ? (latestByName[_olNormName(name)]||{}) : {};
  let pct = _olPctFromStarter(rec, which);
  if(pct==null || Number.isNaN(pct)) pct = (which==='pass' ? snap.pass_pctile : snap.run_pctile);
  if((pct==null || Number.isNaN(pct)) && snap.market_pctile!=null) pct = snap.market_pctile;
  if(pct==null || Number.isNaN(pct)) return {pct:38, known:false}; // replacement level
  let v=Number(pct);
  const ap = snap.allpro_recent||'';
  if(/1st/i.test(ap)) v+=8;
  else if(/2nd/i.test(ap)) v+=5;
  if((snap.career_ap1||0)>=1) v+=4;
  else if((snap.career_pb||0)>=2) v+=2;
  return {pct:Math.max(1, Math.min(99, v)), known:true};
}

// Weighted team talent (0-100) across the five projected starters.
function _olTeamTalent(line, which){
  const W = which==='pass' ? _OL_PASS_SLOT_W : _OL_RUN_SLOT_W;
  let num=0, den=0, known=0;
  for(const sl of ['LT','LG','C','RG','RT']){
    const rec=line&&line[sl];
    const w=W[sl]||1.0;
    const t=_olStarterTalent(rec&&rec.name?rec:null, which);
    num += t.pct * w;
    den += w;
    if(t.known) known++;
  }
  if(!den) return null;
  return {talent:num/den, known};
}

// Ascending-sorted league values for a metric column (baseline season distribution).
function _olColumnSorted(baseTbl, col){
  const vals=[];
  const teams=(baseTbl&&baseTbl.teams)||{};
  for(const tm in teams){
    const v=teams[tm]&&teams[tm].values?teams[tm].values[col]:null;
    if(v!=null && !Number.isNaN(Number(v))) vals.push(Number(v));
  }
  vals.sort((a,b)=>a-b);
  return vals;
}

// Map a projected quality (0..1, 1=best) onto the league distribution so projected metric
// values stay realistic and monotonic with the projected rank.
function _olValueAtQuality(sorted, quality, lowerBetter){
  if(!sorted.length) return null;
  const q=Math.max(0, Math.min(1, quality));
  const pos=lowerBetter ? (1-q) : q;
  const idx=Math.round(pos*(sorted.length-1));
  return sorted[Math.max(0, Math.min(sorted.length-1, idx))];
}

// Attach each projected starter's latest-known letter grade/percentile (earned on any team)
// to the line record, so the projection page shows real grades instead of blanks.
function _olEnrichLineGrades(line){
  if(!line) return line;
  const latestByName=_olLatestPlayerPctileByName();
  const out={};
  for(const sl of ['LT','LG','C','RG','RT']){
    const r=line[sl];
    if(!r || !r.name){ out[sl]=r||null; continue; }
    const snap=latestByName[_olNormName(r.name)]||{};
    const havePassPct=(r.pass_pctile!=null && !Number.isNaN(Number(r.pass_pctile)));
    const haveRunPct=(r.run_pctile!=null && !Number.isNaN(Number(r.run_pctile)));
    out[sl]=Object.assign({}, r, {
      pass_grade: r.pass_grade || snap.pass_grade || null,
      run_grade: r.run_grade || snap.run_grade || null,
      pass_pctile: havePassPct ? Number(r.pass_pctile) : (snap.pass_pctile!=null?Number(snap.pass_pctile):null),
      run_pctile: haveRunPct ? Number(r.run_pctile) : (snap.run_pctile!=null?Number(snap.run_pctile):null),
    });
  }
  return out;
}

function _olProjectedTeam2026(){
  const out={};
  if(!(typeof NFLVERSE==='object' && NFLVERSE)) return out;

  const projSeasonNum=Number(OL_PROJ_SEASON);
  let baselineSeason=Number.isFinite(projSeasonNum) ? String(projSeasonNum-1) : String(new Date().getFullYear()-1);
  if(!(NFLVERSE[baselineSeason] && NFLVERSE[baselineSeason].team && NFLVERSE[baselineSeason].team.offensive_line_pass)){
    const cands=Object.keys(NFLVERSE)
      .filter(x=>Number.isFinite(Number(x)) && Number(x)<projSeasonNum)
      .sort((a,b)=>Number(b)-Number(a));
    baselineSeason=cands[0]||'';
  }
  const basePack=(NFLVERSE[baselineSeason]||{});
  const basePassTbl=basePack.team&&basePack.team.offensive_line_pass;
  const baseRunTbl=basePack.team&&basePack.team.offensive_line_run;
  const passCols=(basePassTbl&&basePassTbl.columns)||[];
  const runCols=(baseRunTbl&&baseRunTbl.columns)||[];
  const allTeams=(basePassTbl&&basePassTbl.teams)?Object.keys(basePassTbl.teams):[];
  if(!allTeams.length) return out;

  const lowerCols=new Set(['Pressure Rate','Hit Rate','Hurry Rate','Sack Rate','Non-QB Sack Rate','No Blitz Pressure Rate','Last 5 Sacks Allowed','Last 5 Sack Rate']);
  const keepBaseline=new Set(['Dropbacks','Pass Rate','Blitz Rate','Last 5 Sacks Allowed','Last 5 Sack Rate']);

  // 1) Projected quality per team = projected-starter talent, lightly anchored (20%) to the
  //    prior-season team Pass Score for scheme/coaching continuity. Talent dominates so an
  //    injury-ruined team result no longer drags a healthy projected line down.
  const teamRows={};
  for(const tm of allTeams){
    const teamCode=_olTeamCode(tm);
    const rawLine=_olLineByTeamSeason(OL_PROJ_SEASON, teamCode) || _olLineByTeamSeason(baselineSeason, teamCode);
    if(!rawLine) continue;
    const line=_olEnrichLineGrades(rawLine);
    const tp=_olTeamTalent(line, 'pass');
    const tr=_olTeamTalent(line, 'run');
    const talentPass = tp?tp.talent:50;
    const talentRun  = tr?tr.talent:50;

    const passBaseRow=basePassTbl.teams[teamCode];
    const bs=(passBaseRow&&passBaseRow.values)?passBaseRow.values['Pass Score']:null;
    const baseScore=(bs!=null && !Number.isNaN(Number(bs)))?Number(bs):null;
    const projPassScore=(baseScore!=null)
      ? Math.max(0, Math.min(100, 0.80*talentPass + 0.20*baseScore))
      : talentPass;

    const runBaseRow0=baseRunTbl&&baseRunTbl.teams&&baseRunTbl.teams[teamCode];
    const brsRun=(runBaseRow0&&runBaseRow0.values)?runBaseRow0.values['Run Score']:null;
    const brsOverall=(runBaseRow0&&runBaseRow0.values)?runBaseRow0.values['Overall Score']:null;
    const baseRunScore=(brsRun!=null && !Number.isNaN(Number(brsRun)))
      ? Number(brsRun)
      : ((brsOverall!=null && !Number.isNaN(Number(brsOverall))) ? Number(brsOverall) : null);
    const projRunScore=(baseRunScore!=null)
      ? Math.max(0, Math.min(100, 0.80*talentRun + 0.20*baseRunScore))
      : talentRun;

    teamRows[teamCode]={ team:teamCode, line, talentPass, talentRun, projPassScore, projRunScore, baseRow:passBaseRow };
  }

  const teamCodes=Object.keys(teamRows);
  if(!teamCodes.length) return out;

  // 2) League ranking by projected pass/run quality → per-team quality fraction (1 = best).
  const scoreMap={};
  teamCodes.forEach(tm=>{ scoreMap[tm]=teamRows[tm].projPassScore; });
  const passScoreRank=_olRankMap(scoreMap, false);
  const runScoreMap={};
  teamCodes.forEach(tm=>{ runScoreMap[tm]=teamRows[tm].projRunScore; });
  const runScoreRank=_olRankMap(runScoreMap, false);
  const n=teamCodes.length;
  // Early renders can happen before the full league table is hydrated. Using projected
  // ranks on partial coverage creates volatile #1/#2 flashes, so fall back to baseline
  // season ranks until coverage is effectively complete.
  const ranksStable = n >= 28;
  const rankNum = (v)=> (v!=null && !Number.isNaN(Number(v))) ? Number(v) : null;

  // 3) Baseline league distributions for realistic projected metric values.
  const sortedByCol={};
  passCols.forEach(c=>{ sortedByCol[c]=_olColumnSorted(basePassTbl, c); });

  // 4) Assemble projected pass values (Pass/Overall Score direct; rate/time via distribution).
  teamCodes.forEach(tm=>{
    const tr=teamRows[tm];
    const rank=passScoreRank[tm]||n;
    const quality=n>1 ? (1-(rank-1)/(n-1)) : 1;
    const passValues={};
    passCols.forEach(c=>{
      const baseVal=(tr.baseRow&&tr.baseRow.values)?tr.baseRow.values[c]:null;
      if(c==='Pass Score'){ passValues[c]=Math.round(tr.projPassScore*10)/10; return; }
      if(c==='Overall Score'){
        const util=(tr.baseRow&&tr.baseRow.values&&tr.baseRow.values['Pass Rate']!=null)?Number(tr.baseRow.values['Pass Rate'])/100:0.58;
        passValues[c]=Math.round((util*tr.projPassScore + (1-util)*tr.talentRun)*10)/10;
        return;
      }
      if(keepBaseline.has(c)){ passValues[c]=(baseVal!=null && !Number.isNaN(Number(baseVal)))?Number(baseVal):null; return; }
      const mapped=_olValueAtQuality(sortedByCol[c], quality, lowerCols.has(c));
      passValues[c]=(mapped!=null)?mapped:((baseVal!=null && !Number.isNaN(Number(baseVal)))?Number(baseVal):null);
    });
    tr.passValues=passValues;
    tr.quality=quality;
    tr.rank=rank;
  });

  // 5) Per-column ranks from the assembled projected values.
  const ranksByCol={};
  passCols.forEach(c=>{
    const vals={};
    teamCodes.forEach(tm=>{ vals[tm]=teamRows[tm].passValues[c]; });
    ranksByCol[c]=_olRankMap(vals, lowerCols.has(c));
  });

  teamCodes.forEach(tm=>{
    const tr=teamRows[tm];
    const passRanks={};
    passCols.forEach(c=>{ passRanks[c]=(ranksByCol[c]&&ranksByCol[c][tm]!=null)?ranksByCol[c][tm]:null; });
    const runBaseRow=baseRunTbl&&baseRunTbl.teams&&baseRunTbl.teams[tm];
    const runValues={};
    runCols.forEach(c=>{ runValues[c]=(runBaseRow&&runBaseRow.values)?runBaseRow.values[c]:null; });
    const basePassRank = rankNum(tr.baseRow&&tr.baseRow.ranks&&
      (tr.baseRow.ranks['Pass Score']!=null ? tr.baseRow.ranks['Pass Score'] : tr.baseRow.ranks['Overall Score']));
    const baseRunRank = rankNum(runBaseRow&&runBaseRow.ranks&&
      (runBaseRow.ranks['Run Score']!=null ? runBaseRow.ranks['Run Score'] : runBaseRow.ranks['Overall Score']));
    out[tm]={
      team:tm,
      baselineSeason,
      talentPass:tr.talentPass,
      talentRun:tr.talentRun,
      projPassScore:tr.projPassScore,
      projRunScore:tr.projRunScore,
      baselinePassRank:basePassRank,
      baselineRunRank:baseRunRank,
      passRank:ranksStable ? tr.rank : (basePassRank!=null ? basePassRank : tr.rank),
      runRank:ranksStable ? (runScoreRank[tm]||n) : (baseRunRank!=null ? baseRunRank : (runScoreRank[tm]||n)),
      line:tr.line,
      passTbl:{ columns:passCols, teams:{ [tm]:{ values:tr.passValues, ranks:passRanks } } },
      runTbl:{ columns:runCols, teams:{ [tm]:{ values:runValues, ranks:(runBaseRow&&runBaseRow.ranks)||{} } } },
    };
  });
  return out;
}

// Public accessor: projected OL overall score + league rank for a team.
// which = 'pass' | 'run'. Returns {score, rank} or null.
function projectedOlScore(team, which){
  if(typeof _olProjectedTeam2026!=='function') return null;
  const proj=_olProjectedTeam2026()[_olTeamCode(team)];
  if(!proj) return null;
  if(which==='run') return {score:proj.projRunScore, rank:proj.runRank};
  return {score:proj.projPassScore, rank:proj.passRank};
}

function _olQbHasSeasonData(pid, season, normName, fallbackTeam){
  const s=String(season);
  const tm=_qbTeamForSeason(pid, s, normName, fallbackTeam) || _qbAnyKnownTeam(pid, normName, fallbackTeam);
  if(!tm) return false;
  if(_olIsProjSeason(s)){
    const p=_olProjectedTeam2026()[tm];
    if(p && p.passTbl && p.passTbl.teams && p.passTbl.teams[tm]) return true;
  }
  const pack=NFLVERSE[s]||{};
  const passTbl=pack.team&&pack.team.offensive_line_pass;
  return !!(passTbl && passTbl.teams && passTbl.teams[tm]);
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

function _qbAnyKnownTeam(pid, normName, fallbackTeam){
  const base=_olTeamCode(fallbackTeam||'');
  if(!(typeof NFLVERSE==='object' && NFLVERSE)) return base;
  const seasons=Object.keys(NFLVERSE).sort((a,b)=>Number(b)-Number(a));
  for(const s of seasons){
    const tm=_qbTeamForSeason(pid, s, normName, '');
    if(tm) return tm;
  }
  return base;
}

function _olDepthHeadshot(teamCode, name){
  const tn=_olNormName(name);
  if(!tn) return '';
  if(typeof espnDepth!=='undefined'){
    const rows=espnDepth[teamCode];
    if(Array.isArray(rows)){
      for(const row of rows){
        const players=Array.isArray(row&&row.players)?row.players:[];
        for(const p of players){
          if(_olNormName(p&&p.name)===tn && p&&p.headshot) return String(p.headshot);
        }
      }
    }else if(rows===undefined && typeof fetchEspnDepth==='function'){
      fetchEspnDepth(teamCode).catch(()=>{});
    }
  }
  if(typeof espnRosters!=='undefined'){
    const players=espnRosters[teamCode];
    if(Array.isArray(players)){
      const hit=players.find(p=>_olNormName(p&&p.name)===tn && p&&p.headshot);
      if(hit&&hit.headshot) return String(hit.headshot);
    }
  }
  return '';
}

function _olHeadshot(name, slot, teamCode){
  if(!name) return '';
  const depthSrc = _olDepthHeadshot(teamCode, name);
  let rid='';
  if(typeof resolvePlayerId==='function'){
    const rawPos=String(slot||'').toUpperCase();
    rid = resolvePlayerId(name, rawPos) || resolvePlayerId(name, 'OL') || resolvePlayerId(name) || '';
  }
  const sleeperSrc = (rid && typeof SLEEPER_HEADSHOT==='function') ? SLEEPER_HEADSHOT(rid) : ((typeof hsURL==='function') ? hsURL({name, pos:slot}) : '');
  const primary = depthSrc || sleeperSrc;
  if(!primary) return '<div class="olc-qb-hs ph-err"></div>';

  const fallbacks=[];
  if(depthSrc && sleeperSrc && sleeperSrc!==depthSrc) fallbacks.push(sleeperSrc);
  if(rid && typeof sleeperPlayers!=='undefined' && sleeperPlayers && sleeperPlayers[rid] && sleeperPlayers[rid].espn_id && typeof ESPN_HEADSHOT==='function'){
    const aid=String(sleeperPlayers[rid].espn_id);
    fallbacks.push(ESPN_HEADSHOT('nfl', aid), ESPN_HEADSHOT('college-football', aid));
  }
  const fb=fallbacks.filter(Boolean).join('|');
  const onerr = "const l=(this.dataset.fallbacks||'').split('|').filter(Boolean);if(l.length){this.dataset.fallbacks=l.slice(1).join('|');this.src=l[0];}else{this.outerHTML='<div class=\\'olc-qb-hs ph-err\\'></div>'; }";
  return `<img src="${primary}" class="olc-qb-hs" alt="" data-fallbacks="${fb}" onerror="${onerr}">`;
}

function pcardQbOlAvailable(pid){
  if(typeof NFLVERSE==='undefined' || !NFLVERSE) return false;
  const p=(typeof sleeperPlayers!=='undefined'&&sleeperPlayers&&sleeperPlayers[pid])||{};
  if(String(p.position||p.pos||'').toUpperCase()!=='QB') return false;
  const teamNow=_olTeamCode(p.team||'');
  if(!teamNow) return false;
  const proj2026=_olProjectedTeam2026()[teamNow];
  if(proj2026 && proj2026.passTbl && proj2026.passTbl.teams && proj2026.passTbl.teams[teamNow]) return true;
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

  const seasonPool=(typeof NFLVERSE==='object'&&NFLVERSE)?Object.keys(NFLVERSE):[];
  if(!seasonPool.includes(OL_PROJ_SEASON)) seasonPool.push(OL_PROJ_SEASON);

  let seasons=seasonPool
    .filter(s=>_olQbHasSeasonData(pid, s, norm, p.team||''))
    .sort((a,b)=>b-a);
  // Fallback for occasional name mismatches: if we cannot tie this QB to a season-specific
  // qb_passing row, show current-team OL context so the tab still renders.
  if(!seasons.length){
    seasons=seasonPool
      .filter(s=>_olQbHasSeasonData(pid, s, norm, p.team||''))
      .sort((a,b)=>b-a);
  }
  if(!seasons.length) return '<div class="pcard-loading">No OL pass-protection data available for this QB.</div>';
  if(pcardQbOlSeason==null || !seasons.includes(String(pcardQbOlSeason))) pcardQbOlSeason=seasons[0];
  const season=String(pcardQbOlSeason);
  const pack=NFLVERSE[season]||{};
  const teamCode=_qbTeamForSeason(pid, season, norm, p.team||'') || _qbAnyKnownTeam(pid, norm, p.team||'');
  if(!teamCode) return '<div class="pcard-loading">No team context available for this QB in that season.</div>';
  const notePlayer = noteTargetFromArgs(pid, 'QB', teamCode);
  const noteCtx = _olIsProjSeason(season) ? `${season} projections · QB OL` : `${season} QB OL`;

  const proj=_olIsProjSeason(season) ? (_olProjectedTeam2026()[teamCode]||null) : null;
  const passTbl=proj ? proj.passTbl : (pack.team&&pack.team.offensive_line_pass);
  const row=passTbl&&passTbl.teams&&passTbl.teams[teamCode];
  const cols=(passTbl&&passTbl.columns)||[];
  if(!row || !cols.length) return '<div class="pcard-loading">No team pass-protection table found for this season.</div>';

  const line=(proj&&proj.line) ? proj.line : _olLineByTeamSeason(season, teamCode);
  const slotCards=['LT','LG','C','RG','RT'].map(sl=>{
    const r=line[sl]||{};
    const g=r.pass_grade||'—';
    const pct=(r.pass_pctile==null||Number.isNaN(r.pass_pctile))?'—':`${Number(r.pass_pctile).toFixed(1)}%`;
    const pctRank=_olRankFromPct(r.pass_pctile);
    const pctBadge=pctRank!=null ? `<span class="sr-badge ${_olRankClass(pctRank)} olc-rank-badge">${pct}</span>` : `<span class="olc-rank-muted">${pct}</span>`;
    const snaps=(r.pass_snaps==null||Number.isNaN(r.pass_snaps))?'—':Number(r.pass_snaps).toLocaleString();
    const click = r.name ? `openPlayerCardFromCard(${pcardArg(r.name)},${pcardArg(sl)},${pcardArg(teamCode)})` : '';
    return `<div class="olc-qb-slot-card${r.name?' clickable-player':''}" ${r.name?`onclick="${click}" role="button" tabindex="0"`:''}>
      <div class="olc-qb-slot-top"><span class="olc-qb-slot">${sl}</span></div>
      ${_olHeadshot(r.name||'', sl, teamCode)}
      <div class="olc-qb-name">${r.name||'—'}</div>
      <div class="olc-qb-grade ${_olGradeClass(g)}">${g}</div>
      <div class="olc-qb-sub">${pctBadge} · ${snaps} snaps</div>
    </div>`;
  }).join('');

  const metricCols=cols.filter(c=>c!=='Last 5 Sacks Allowed' && c!=='Last 5 Sack Rate');
  const overallPassScore=_olMetricScoreFromRow(row, ['Pass Score','Overall Score','Overall','Score']);
  const overallPassRank=_olMetricRankFromRow(row, ['Pass Score','Overall Score','Overall','Score']);
  const overallPassValue = overallPassScore!=null ? `${overallPassScore.toFixed(1)}${overallPassRank!=null?` · league rank #${overallPassRank}`:''}` : `—${overallPassRank!=null?` · league rank #${overallPassRank}`:''}`;
  const overallPassHtml = (overallPassScore!=null || overallPassRank!=null)
    ? `<div class="olc-overview">${noteWrapHtml(`<b>Cumulative Pass Protection Score: ${overallPassScore!=null?overallPassScore.toFixed(1):'—'}</b> ${_olRankBadge(overallPassRank)}`, { label:'Cumulative Pass Protection Score', value:overallPassValue, source:'qb_ol_context', statKey:'overall_pass_score', context:`${teamDisplayName(teamCode)||teamCode} pass protection · ${noteCtx}`, player:notePlayer, team:teamCode, relevance:'QB', nav:{ type:'advanced', team:teamCode, season:_olIsProjSeason(season)?'proj':String(season) } }, 'note-tag-hit')}</div>`
    : '';

  let projOverallHtml='';
  let metricColsUse=metricCols.slice();
  if(proj){
    const basePack=NFLVERSE[String(proj.baselineSeason)]||{};
    const baseTbl=basePack.team&&basePack.team.offensive_line_pass;
    const baseRow=baseTbl&&baseTbl.teams&&baseTbl.teams[teamCode];
    const projScore=row.values?row.values['Overall Score']:null;
    const projRank=row.ranks?row.ranks['Overall Score']:null;
    const baseScore=baseRow&&baseRow.values?baseRow.values['Overall Score']:null;
    const baseRank=baseRow&&baseRow.ranks?baseRow.ranks['Overall Score']:null;
    projOverallHtml = `<div class="olc-metrics" style="margin-bottom:8px">`
      + `<div class="olc-metric"><label>Proj ${OL_PROJ_SEASON}</label><b>${noteWrapHtml(escHtml(_olFmtMetric('Overall Score', projScore)), { label:`Proj ${OL_PROJ_SEASON} Pass Protection Score`, value:`${_olFmtMetric('Overall Score', projScore)}${projRank!=null?` · league rank #${projRank}`:''}`, source:'qb_ol_context', statKey:'proj_overall_score', context:`${teamDisplayName(teamCode)||teamCode} pass protection · ${OL_PROJ_SEASON} projections`, player:notePlayer, team:teamCode, relevance:'QB', nav:{ type:'advanced', team:teamCode, season:'proj' } }, 'note-tag-hit')}</b><small>${_olRankBadge(projRank)}</small></div>`
      + `<div class="olc-metric"><label>${proj.baselineSeason}</label><b>${noteWrapHtml(escHtml(_olFmtMetric('Overall Score', baseScore)), { label:`${proj.baselineSeason} Pass Protection Score`, value:`${_olFmtMetric('Overall Score', baseScore)}${baseRank!=null?` · league rank #${baseRank}`:''}`, source:'qb_ol_context', statKey:'base_overall_score', context:`${teamDisplayName(teamCode)||teamCode} pass protection · ${proj.baselineSeason}`, player:notePlayer, team:teamCode, relevance:'QB', nav:{ type:'advanced', team:teamCode, season:String(proj.baselineSeason) } }, 'note-tag-hit')}</b><small>${_olRankBadge(baseRank)}</small></div>`
      + `</div>`;
    metricColsUse=metricColsUse.filter(c=>c!=='Overall Score');
  }

  const teamMetrics=metricColsUse.map(c=>{
    const v=row.values?row.values[c]:null;
    const rk=row.ranks?row.ranks[c]:null;
    const txt=_olFmtMetric(c,v);
    return `<div class="olc-metric">
      <label>${c}</label>
      <b>${noteWrapHtml(escHtml(txt), { label:c, value:`${txt}${rk!=null?` · league rank #${rk}`:''}`, source:'qb_ol_context', statKey:c, context:`${teamDisplayName(teamCode)||teamCode} pass protection · ${noteCtx}`, player:notePlayer, team:teamCode, relevance:'QB', nav:{ type:'advanced', team:teamCode, season:_olIsProjSeason(season)?'proj':String(season) } }, 'note-tag-hit')}</b>
      <small>${_olRankBadge(rk)}</small>
    </div>`;
  }).join('');

  const seasonBtns=seasons.map(s=>`<button class="rt-season-btn ${String(s)===season?'active':''}" onclick="setPcardQbOlSeason('${s}')">${s}</button>`).join('');
  const projNote=(proj)
    ? `<div class="olc-overview"><b>${OL_PROJ_SEASON} Projection:</b> from projected depth-chart starters' multi-year grades (line talent ${proj.talentPass!=null?Math.round(proj.talentPass):'—'}%), lightly anchored to ${proj.baselineSeason} scheme. Projected pass-protection rank #${proj.passRank!=null?proj.passRank:'—'}.</div>`
    : '';

  return `<div class="olc-wrap">
    <div class="rt-head">
      <div class="rt-seasons">${seasonBtns}</div>
      <div class="rt-summary">${teamDisplayName(teamCode)||teamCode} · ${proj?'projected ':'pass protection '}context for ${p.name||'QB'}</div>
    </div>
    ${projNote}
    ${overallPassHtml}
    <div class="olc-team-head">${teamDisplayName(teamCode)||teamCode} Offensive Line (Pass Protection)</div>
    <div class="olc-qb-slot-grid">${slotCards}</div>
    <div class="olc-team-head" style="margin-top:10px">Team Pass Protection Metrics (${season})</div>
    ${projOverallHtml}
    <div class="olc-metrics">${teamMetrics}</div>
    <div class="pcard-src">${proj?`Projected starters from ${OL_PROJ_SEASON} depth chart, adjusted from prior team OL performance using starter quality deltas.`:'Linemen from this season\'s team context; pass grades from the OL pipeline.'}</div>
  </div>`;
}

function setPcardQbOlSeason(season){
  pcardQbOlSeason=season;
  const body=document.getElementById('pcardBody');
  if(body && pcardState) body.innerHTML=renderPcardQbOl(pcardState.pid);
}

// Called when an ESPN depth chart finishes loading: if a QB OL card is open on the projection-season
// projection tab for that team, re-render so projected starters (and their talent-driven
// ranks) replace the prior-season fallback line used on first paint.
function _olRefreshOpenQbOlForTeam(team){
  if(typeof pcardState==='undefined' || !pcardState) return;
  if(typeof pcardStatsMode==='undefined' || pcardStatsMode!=='qbol') return;
  if(!_olIsProjSeason(pcardQbOlSeason)) return;
  const body=document.getElementById('pcardBody');
  if(!body) return;
  try{
    const p=(typeof sleeperPlayers!=='undefined'&&sleeperPlayers&&sleeperPlayers[pcardState.pid])||{};
    const norm=ecrNormName(p.name||'');
    const tm=_qbTeamForSeason(pcardState.pid,OL_PROJ_SEASON,norm,p.team||'')||_qbAnyKnownTeam(pcardState.pid,norm,p.team||'');
    if(_olTeamCode(team)!==_olTeamCode(tm)) return;
  }catch(e){ /* refresh anyway on lookup failure */ }
  body.innerHTML=renderPcardQbOl(pcardState.pid);
}

function renderPcardOlGrades(pid){
  const norm=_pcardOlNorm(pid);
  const seasons=pcardOlSeasons(norm);
  if(!seasons.length) return '<div class="pcard-loading">No OL grades available for this player.</div>';
  if(pcardOlSeason==null || !seasons.includes(String(pcardOlSeason))) pcardOlSeason=seasons[0];
  const season=String(pcardOlSeason);
  const notePlayer = noteTargetFromArgs(pid, pcardState&&pcardState.posc, pcardState&&pcardState.team);
  const noteCtx = _olIsProjSeason(season) ? `${season} projections · OL grades` : `${season} OL grades`;

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
      const txt=_olFmtMetric(c, v);
      return `<div class="olc-metric">
        <label>${c}</label>
        <b>${noteWrapHtml(escHtml(txt), { label:c, value:txt, source:'ol_team_context', statKey:c, context:`${teamDisplayName(teamCode)||teamCode} ${title} · ${_olIsProjSeason(season)?`${season} projections`:`${season}`}`, team:teamCode, relevance:noteRelevanceForTableKey(title==='Run Blocking'?'offensive_line_run':'offensive_line_pass') }, 'note-tag-hit')}</b>
        <small>${_olRankBadge(r)}</small>
      </div>`;
    }).join('')}</div>`;

  const metrics = (passRow && passCols.length) || (runRow && runCols.length)
    ? `${passRow&&passCols.length?metricRow('Pass Protection', passRow, passCols):''}${runRow&&runCols.length?metricRow('Run Blocking', runRow, runCols):''}`
    : ((legacyRow && legacyCols.length)
      ? metricRow('Offensive Line Context', legacyRow, legacyCols)
      : '<div class="pcard-loading">Team OL metrics unavailable for this season.</div>');

  const flagBits=[];
  // The shared-credit dagger is deliberately not shown. It meant "this grade is split with a
  // linemate rather than measured individually" — true of the old plus-minus model, false of
  // the composite, which never looks at play-level data. It survives as apm_shared_credit.
  if(rec.consensus_flag) flagBits.push(String(rec.consensus_flag));
  const flags = flagBits.length ? `<div class="olc-flags">${flagBits.join(' · ')}</div>` : '';

  // Model-grade ranks are deliberately not derived here — see _olPctBand. Market percentile
  // comes from observed contract data, so it keeps a real rank.
  const marketPctRank=_olRankFromPct(rec.market_pctile);

  return `<div class="olc-wrap">
    <div class="rt-head">
      <div class="rt-seasons">${seasonBtns}</div>
      <div class="rt-summary">${noteWrapHtml(`${teamDisplayName(teamCode)||teamCode||'Team'} · ${rec.slot||rec.pos||'OL'}`, { label:'Offensive line slot', value:`${teamDisplayName(teamCode)||teamCode||'Team'} · ${rec.slot||rec.pos||'OL'}`, source:'ol_grades', statKey:'slot', context:noteCtx, player:notePlayer, team:teamCode }, 'note-tag-hit')} · validated OL pipeline grades</div>
    </div>

    <div class="olc-grades">
      <div class="olc-grade-tile olc-grade-lead">
        <label>Overall OL Grade</label>
        <b class="olc-grade ${_olGradeClass(rec.ol_grade)}">${noteWrapHtml(escHtml(rec.ol_grade||'—'), { label:'Overall OL Grade', value:rec.ol_grade||'—', source:'ol_grades', statKey:'ol_grade', context:noteCtx, player:notePlayer, team:teamCode }, 'note-tag-hit')}</b>
        <small>${_olPctBand(rec.ol_pctile)} at ${rec.pos||'OL'} · ${rec.ol_conf||'—'} conf</small>
        ${_olDriverBar(rec)}
        ${_olTrend(rec)}
      </div>
      <div class="olc-grade-tile">
        <label>Pass Grade</label>
        <b class="olc-grade ${_olGradeClass(rec.pass_grade)}">${noteWrapHtml(escHtml(rec.pass_grade||'—'), { label:'Pass Grade', value:rec.pass_grade||'—', source:'ol_grades', statKey:'pass_grade', context:noteCtx, player:notePlayer, team:teamCode }, 'note-tag-hit')}</b>
        <small>${_olPctBand(rec.pass_pctile)}${rec.espn_pbwr!=null?` · <b class="olc-espn">ESPN ${Math.round(Number(rec.espn_pbwr))}% PBWR</b>`:''} · line ${_olPctBand(rec.team_pass_pctile)}</small>
      </div>
      <div class="olc-grade-tile">
        <label>Run Grade</label>
        <b class="olc-grade ${_olGradeClass(rec.run_grade)}">${noteWrapHtml(escHtml(rec.run_grade||'—'), { label:'Run Grade', value:rec.run_grade||'—', source:'ol_grades', statKey:'run_grade', context:noteCtx, player:notePlayer, team:teamCode }, 'note-tag-hit')}</b>
        <small>${_olPctBand(rec.run_pctile)}${rec.espn_rbwr!=null?` · <b class="olc-espn">ESPN ${Math.round(Number(rec.espn_rbwr))}% RBWR</b>`:''} · line ${_olPctBand(rec.team_run_pctile)}</small>
      </div>
      <div class="olc-grade-tile">
        <label>Utilization-Weighted</label>
        <b class="olc-grade ${_olGradeClass(rec.ol_weighted_grade)}">${rec.ol_weighted_grade||'—'}</b>
        <small>${_olPctBand(rec.ol_weighted_pctile)} · pass weight ${rec.pass_rate!=null?`${Number(rec.pass_rate).toFixed(0)}%`:'—'} · run weight ${rec.run_rate!=null?`${Number(rec.run_rate).toFixed(0)}%`:'—'}</small>
      </div>
      <div class="olc-mini-grid">
        <div><span>Penalty Rate</span><b>${_olNum(rec.penalty_rate,2)}%</b></div>
        <div><span>Holding / False Start</span><b>${_olNum(rec.penalty_hold_rate,2)} / ${_olNum(rec.penalty_fs_rate,2)}%</b></div>
        <div><span>Snap Share</span><b>${rec.snap_pct!=null?`${Number(rec.snap_pct).toFixed(0)}%`:'—'}</b></div>
        <div><span>Projected Starter</span><b>${rec.is_projected_starter?'Yes':'No'}</b></div>
        <div><span>All-Pro Recent</span><b>${rec.allpro_recent||'—'}</b></div>
        <div><span>Career AP1 / PB</span><b>${rec.career_ap1!=null?rec.career_ap1:'—'} / ${rec.career_pb!=null?rec.career_pb:'—'}</b></div>
        <div><span>Market Percentile</span><b>${rec.market_pctile==null||Number.isNaN(rec.market_pctile)?'—':`${Math.round(Number(rec.market_pctile))}%`} ${marketPctRank!=null?_olRankBadge(marketPctRank):''}</b></div>
      </div>
    </div>

    ${flags}

    <div class="olc-caveat">Grades combine the market's valuation, snap share and draft capital — the three signals that measurably track lineman quality — plus ESPN's tracking-derived win rate where it is published. Validated against ESPN's top-20: AUC 0.80 pass, 0.75 run. No free source records which lineman lost a rep, so grades are shown as bands rather than ranks.</div>

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
