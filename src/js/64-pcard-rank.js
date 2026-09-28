// ── League rank tag ─────────────────────────────────────────────────────────
// The builders rank every chart total against the league (rk:{stat:[rank, n]},
// see _attach_ranks in src/nflverse/nflverse.py — season totals against the
// season, a game against that week). "#3 / 41" beside a number is the context
// the number lacks; the color is the quartile.
function pcardRankTag(rk, key, pos){
  const r=rk && rk[key];
  if(!r || !(r[1]>1)) return '';
  const rank=+r[0], n=+r[1];
  const p=(rank-1)/(n-1);
  const cls = p<=0.25 ? 'rk-good' : p<=0.5 ? 'rk-okhi' : p<=0.75 ? 'rk-oklo' : 'rk-bad';
  const who = pos ? `${String(pos).toUpperCase()}s` : 'players';
  return `<small class="pc-rank ${cls}" title="Rank ${rank} of ${n} ${who} league-wide (season vs season, a game vs that week)">#${rank}<span class="pc-rank-n">/${n}</span></small>`;
}

// ── Live league-rank chips (projection / LIVE tab) ───────────────────────────
// The live tab shows each player's running totals; these rank one such total against
// the whole league's pool (buildPlayerList — every team's current per-player totals) so
// a bare number carries its standing. `dir` 'lo' ranks fewer-is-better stats (INTs).
// Distributions memoise on the buildPlayerList cache epoch, so a row of chips costs one
// sort, not one per chip. Format is ordinal ("1st / 120"), colored by percentile.
let _lgDistCache={}, _lgDistSig=null;
function _lgPool(){ return (typeof buildPlayerList==='function')?buildPlayerList():[]; }
function _lgPosMatch(p, posSel){ return !posSel ? true : (Array.isArray(posSel) ? posSel.indexOf(p.pos)>=0 : p.pos===posSel); }
function _lgPosKey(posSel){ return Array.isArray(posSel)?posSel.join('+'):(posSel||'*'); }
function _lgCache(k, build){
  // Rebuild the pool first, then key the distribution cache on buildPlayerList's own one-slot
  // list identity. Its epoch counter does NOT tick on an internal cache-miss rebuild (only on
  // explicit invalidation), so a season switch swaps the pool under a stale epoch and a badge
  // rendered right after would rank against the previous season. The list reference is replaced
  // on every rebuild, so it's the reliable signal.
  const list=_lgPool();
  const sig=(typeof _buildPlayerCache!=='undefined' && _buildPlayerCache && _buildPlayerCache.list) ? _buildPlayerCache.list : list;
  if(_lgDistSig!==sig){ _lgDistCache={}; _lgDistSig=sig; }
  if(_lgDistCache[k]) return _lgDistCache[k];
  const v=build(list); _lgDistCache[k]=v; return v;
}
// Sorted-ascending totals of one stat field across a position pool.
function _lgDist(posSel, field){
  return _lgCache('d|'+_lgPosKey(posSel)+'|'+field, (list)=>{
    const vals=[];
    for(let i=0;i<list.length;i++){ const p=list[i]; if(!_lgPosMatch(p,posSel)) continue; const v=+p[field]; if(Number.isFinite(v)) vals.push(v); }
    return vals.sort((a,b)=>a-b);
  });
}
// Sorted-ascending share-of-team (player stat ÷ team's summed stat) across a pool. The
// denominator sums `denomPos` (default: everyone) — carry share must divide by RB carries
// only, not the team's QB-inclusive rush attempts, or every lead back reads as 1st.
function _lgShareDist(rankPos, field, denomPos){
  return _lgCache('s|'+_lgPosKey(rankPos)+'|'+field+'|'+_lgPosKey(denomPos), (list)=>{
    const tot={};
    for(let i=0;i<list.length;i++){ const p=list[i]; if(denomPos && !_lgPosMatch(p,denomPos)) continue; tot[p.team]=(tot[p.team]||0)+(+p[field]||0); }
    const vals=[];
    for(let i=0;i<list.length;i++){ const p=list[i]; if(!_lgPosMatch(p,rankPos)) continue; const t=tot[p.team]; if(t>0) vals.push((+p[field]||0)/t); }
    return vals.sort((a,b)=>a-b);
  });
}
// Sorted-ascending per-team summed totals of a stat across a pool (32-team ranks).
function _lgTeamTotals(posSel, field){
  return _lgCache('t|'+_lgPosKey(posSel)+'|'+field, (list)=>{
    const tot={};
    for(let i=0;i<list.length;i++){ const p=list[i]; if(!_lgPosMatch(p,posSel)) continue; tot[p.team]=(tot[p.team]||0)+(+p[field]||0); }
    return Object.keys(tot).map(t=>tot[t]).sort((a,b)=>a-b);
  });
}
// Min-rank of `value` within a sorted-ascending array. 'hi' → rank 1 is the max.
function _lgRankIn(vals, value, dir){
  const n=vals.length;
  if(!(n>0)) return null;
  const v=+value;
  let better=0;
  if(dir==='lo'){ for(let i=0;i<n;i++){ if(vals[i]<v) better++; } }
  else          { for(let i=0;i<n;i++){ if(vals[i]>v) better++; } }
  return better+1;
}
function _lgRankChipHtml(rank, n, who, lessBetter){
  if(!(n>1) || !(rank>=1)) return '';
  const p=(rank-1)/(n-1);
  const cls=p<=0.25?'rk-good':p<=0.5?'rk-okhi':p<=0.75?'rk-oklo':'rk-bad';
  const ord=(typeof ordinal==='function')?ordinal(rank):('#'+rank);
  const detail=`${ord} of ${n} ${who} league-wide${lessBetter?' \u00b7 fewer is better':''}`;
  return `<span class="pc-rank ${cls}" role="button" tabindex="0" data-detail="${escAttr(detail)}" title="${escAttr(detail)}" onclick="tcRankPop(this,event)">${ord}</span>`;
}
// The chip shows only the ordinal to stay compact; a tap reveals "Nth of M …" (desktop
// gets it on hover via the title, but touch has no hover). Reuses the pace-popover plumbing.
function tcRankPop(btn, ev){
  if(ev && ev.stopPropagation) ev.stopPropagation();
  if(!btn || !btn.parentNode) return;
  const open = btn.parentNode.querySelector && btn.parentNode.querySelector('.pace-info-pop');
  closeWeekFilterPacePops();
  if(open) return;   // second tap toggles it closed
  const pop=document.createElement('div');
  pop.className='pace-info-pop';
  pop.onclick=(e)=>e.stopPropagation();
  pop.innerHTML=`<div class="pace-info-pop-head"><span class="pace-info-pop-lbl">League rank</span>`
    +`<button class="pace-info-pop-close" onclick="this.closest('.pace-info-pop').remove()" aria-label="Close">\u2715</button></div>`
    +`<div class="pace-info-pop-body">${escAttr(btn.getAttribute('data-detail')||'')}</div>`;
  btn.parentNode.appendChild(pop);
  if(typeof _pacePopsMaybeOpen!=='undefined') _pacePopsMaybeOpen=true;
  try{
    const M=8, vp=(typeof tcViewportSize==='function')?tcViewportSize():{vw:360,vh:640};
    const br=btn.getBoundingClientRect(), pr=pop.getBoundingClientRect();
    let left=br.right-pr.width; if(left+pr.width>vp.vw-M) left=vp.vw-M-pr.width; if(left<M) left=M;
    let top=br.bottom+6; if(top+pr.height>vp.vh-M) top=br.top-pr.height-6; if(top<M) top=M;
    pop.style.position='fixed'; pop.style.left=left+'px'; pop.style.top=top+'px'; pop.style.right='auto';
  }catch(e){}
}
// Rank one player's stat total against the league pool at his position(s).
function leagueRankChip(posSel, field, value, dir, opts){
  opts=opts||{};
  if(value==null || !Number.isFinite(+value)) return '';
  const vals=_lgDist(posSel, field);
  const rank=_lgRankIn(vals, value, dir);
  const who=opts.who || (Array.isArray(posSel)?'players':(posSel?(String(posSel).toUpperCase()+'s'):'players'));
  return _lgRankChipHtml(rank, vals.length, who, dir==='lo');
}
// Rank a player's share-of-team against every player's share in the pool. `denomPos` scopes
// the team-total denominator (see _lgShareDist).
function leagueShareRankChip(rankPos, field, share, who, denomPos){
  if(share==null || !Number.isFinite(+share)) return '';
  const vals=_lgShareDist(rankPos, field, denomPos);
  const rank=_lgRankIn(vals, +share, 'hi');
  return _lgRankChipHtml(rank, vals.length, who||'players', false);
}
// Rank a team total against all 32 teams' summed totals for the stat.
function leagueTeamRankChip(posSel, field, value, dir, who){
  if(value==null || !Number.isFinite(+value)) return '';
  const vals=_lgTeamTotals(posSel, field);
  const rank=_lgRankIn(vals, +value, dir||'hi');
  return _lgRankChipHtml(rank, vals.length, who||'teams', dir==='lo');
}
// Rank a value against a caller-supplied set (team totals, share %, …).
function leagueRankChipFromArray(vals, value, dir, who, lessBetter){
  if(value==null || !Number.isFinite(+value) || !Array.isArray(vals)) return '';
  const sorted=vals.filter(v=>Number.isFinite(+v)).map(Number).sort((a,b)=>a-b);
  const rank=_lgRankIn(sorted, value, dir);
  return _lgRankChipHtml(rank, sorted.length, who||'players', !!lessBetter);
}
// Chips render on the live season, past seasons, AND the editable projection tab — anywhere
// buildPlayerList has a pool to rank against.
function _rankChipsOn(){ return typeof buildPlayerList==='function' && typeof leagueRankChip==='function'; }
function _lgWho(pos){ return pos ? String(pos).toUpperCase()+'s' : 'players'; }
function _setSlot(id, html){ const el=document.getElementById(id); if(el && el.innerHTML!==html) el.innerHTML=html; }
// The share sliders update the value spans in place (55-live-dom.js) without a full re-render,
// so each chip lives in its own `rk-*` slot that those updaters never touch; this recomputes
// the slots for whatever projection card is on screen, called on slider release / manual edit.
function tcRefreshRankChips(state, team){
  if(!_rankChipsOn() || !state) return;
  const ph=(typeof currentPhase!=='undefined')?currentPhase:'';
  if(ph==='Passing'){
    const q=state.qbs && state.qbs[state.activeQB||0]; if(!q) return;
    _setSlot('rk-py', leagueRankChip('QB','passing_yards',Math.round(q.passing_yards),'hi'));
    _setSlot('rk-ptd', leagueRankChip('QB','passing_tds',Math.round(q.passing_tds),'hi'));
    _setSlot('rk-patt', leagueRankChip('QB','passing_attempts',Math.round(q.passing_attempts),'hi'));
    _setSlot('rk-pcomp', leagueRankChip('QB','passing_completions',Math.round(q.passing_completions),'hi'));
    _setSlot('rk-int', leagueRankChip('QB','interceptions_thrown',Math.round(q.interceptions_thrown),'lo'));
    _setSlot('rk-qbry', leagueRankChip('QB','rushing_yards',Math.round(q.qb_rush_yards),'hi'));
    _setSlot('rk-qbrtd', leagueRankChip('QB','rushing_tds',Math.round(q.qb_rush_tds),'hi'));
    _setSlot('rk-qbratt', leagueRankChip('QB','rushing_attempts',Math.round(q.qb_rush_attempts),'hi'));
    return;
  }
  if(ph==='Receiving'){
    const shares=state.passing_shares||[];
    const sub=(typeof passingSubTab!=='undefined')?passingSubTab:'targets';
    const totalTgts=teamTargetPool(state), totalTDs=teamPassTDs(state);
    const recPool=teamRecPool(state), ydsPool=teamRecYardsPool(state);
    shares.forEach((p,i)=>{
      const who=_lgWho(p.pos);
      if(sub==='rec' || sub==='recyds'){
        const isYds=sub==='recyds', f=isYds?'receiving_yards':'receptions';
        const sh=isYds?(p.recyds_share||0):(p.rec_share||0);
        const v=Math.round(sh*(isYds?ydsPool:recPool));
        _setSlot('rk-dp-'+i, leagueShareRankChip(p.pos,f,sh,who));
        _setSlot('rk-dv-'+i, leagueRankChip(p.pos,f,v,'hi',{who}));
      } else if(sub==='rec_tds'){
        _setSlot('rk-tdp-'+i, leagueShareRankChip(p.pos,'receiving_tds',p.td_share,who));
        _setSlot('rk-tdv-'+i, leagueRankChip(p.pos,'receiving_tds',p.td_share*totalTDs,'hi',{who}));
      } else {
        const projTgts=Math.round(p.share*totalTgts);
        _setSlot('rk-pp-'+i, leagueShareRankChip(p.pos,'receiving_targets',p.share,who));
        _setSlot('rk-pt-'+i, leagueRankChip(p.pos,'receiving_targets',projTgts,'hi',{who}));
      }
    });
    return;
  }
  if(ph==='Rushing'){
    const r=state.rushing||{}, shares=r.shares||[];
    const sub=(typeof rushingSubTab!=='undefined')?rushingSubTab:'carries';
    if(sub==='carries'){
      _setSlot('rk-rush_total_att', leagueTeamRankChip(['RB'],'rushing_attempts',r.total_attempts,'hi'));
      _setSlot('rk-rush_total_yds', leagueTeamRankChip(['RB'],'rushing_yards',r.total_yards,'hi'));
      shares.forEach((p,i)=>{
        const att=Math.round(p.share*r.total_attempts);
        const yds=Math.round(att*(p.ypc||r.ypa||4));
        _setSlot('rk-rp-'+i, leagueShareRankChip(['RB'],'rushing_attempts',p.share,'RBs',['RB']));
        _setSlot('rk-ratt-'+i, leagueRankChip(['RB'],'rushing_attempts',att,'hi',{who:'RBs'}));
        _setSlot('rk-ryd-'+i, leagueRankChip(['RB'],'rushing_yards',yds,'hi',{who:'RBs'}));
      });
    } else {
      const totalTDs=teamRushTDs(state);
      shares.forEach((p,i)=>{
        _setSlot('rk-rtdp-'+i, leagueShareRankChip(['RB'],'rushing_tds',p.td_share,'RBs',['RB']));
        _setSlot('rk-rtdv-'+i, leagueRankChip(['RB'],'rushing_tds',p.td_share*totalTDs,'hi',{who:'RBs'}));
      });
    }
    return;
  }
}
