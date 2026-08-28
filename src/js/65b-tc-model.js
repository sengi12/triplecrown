// ── TC Model row on the player card ──────────────────────────────────────────────
// The seed's per-player `tc` block (built by src/nflverse/tc_projections.py) carries the
// TC model's predicted PPR FPG next to the Sleeper baseline's implied PPR FPG, plus the
// compact inputs the ⓘ popup explains the number with. This renders the comparison row
// veterans get at the top of their card — the vet counterpart of the rookies' PROSPECT
// row. Rookies have no `tc` (no NFL season on tape) and fall through to ''.

// Lazy pid→player index over the live seed; rebuilt only when SEED is swapped out
// (live Sleeper pull, seed load, import), same cache-by-source-identity pattern as
// the League Analyzer's gsis map.
var _tcMdIdx = null, _tcMdIdxSrc = null;
function tcModelRec(pid){
  // Prefer the preserved PROJECTION seed: reference mode swaps the global SEED to a
  // historical season whose rows carry no tc block, but the model's read is about the
  // upcoming season and belongs on the card whichever season view is open.
  const src = (typeof projSeed !== 'undefined' && projSeed && Object.keys(projSeed).length)
    ? projSeed : ((typeof SEED !== 'undefined') ? SEED : null);
  if(!src) return null;
  if(_tcMdIdxSrc !== src){
    _tcMdIdx = {};
    for(const t in src){
      const posmap = src[t] || {};
      for(const pos in posmap){
        (posmap[pos] || []).forEach(p => {
          if(p && p.player_id != null && p.tc) _tcMdIdx[String(p.player_id)] = p;
        });
      }
    }
    _tcMdIdxSrc = src;
  }
  return _tcMdIdx[String(pid)] || null;
}

// Agreement threshold: within ±6% of the baseline the two projections are the same
// number for draft purposes; beyond it the chip says which way the model leans.
const TC_MD_AGREE_PCT = 0.06;
// Below this baseline the two numbers measure different things — Sleeper's projection
// bakes playing time into a backup's number (Mariota: 0.8) while the model reads
// production per game WHEN he plays (15.3). A percent chip on that pair is nonsense,
// so deep-bench rows show both numbers and let the ⓘ explain the basis difference.
const TC_MD_MIN_BASE = 5;

function tcModelDelta(tc){
  if(!tc || tc.fpg == null || tc.base == null || !(tc.base > 0)) return null;
  return (tc.fpg - tc.base) / tc.base;
}

function renderTcModel(pid){
  const p = tcModelRec(pid);
  if(!p || !p.tc || p.tc.fpg == null) return '';
  const tc = p.tc;
  const d = tcModelDelta(tc);
  let chip = '';
  if(d != null && tc.base < TC_MD_MIN_BASE){
    chip = `<span class="tc-md-chip tc-md-eq" title="Sleeper's number bakes in limited playing time; the model's is per game played — not comparable, so no verdict">per-game read</span>`;
  }else if(d != null){
    const pct = Math.round(Math.abs(d) * 100);
    if(Math.abs(d) < TC_MD_AGREE_PCT){
      chip = `<span class="tc-md-chip tc-md-eq" title="The model and Sleeper's baseline agree (within ±${Math.round(TC_MD_AGREE_PCT*100)}%)">≈ agrees</span>`;
    }else if(d > 0){
      chip = `<span class="tc-md-chip tc-md-up" title="The model projects ${pct}% MORE than Sleeper's baseline">▲ +${pct}%</span>`;
    }else{
      chip = `<span class="tc-md-chip tc-md-dn" title="The model projects ${pct}% LESS than Sleeper's baseline">▼ −${pct}%</span>`;
    }
  }
  // Show the comparison in the USER'S scoring whenever possible. The model's internals are
  // PPR, but a 6-pt-pass-TD league scores a QB ~25% higher — quoting Burrow "16.9 PPR/G" to
  // someone whose own card badges read 21-27 pts/g made the model look absurd when it was
  // merely speaking a different unit. The model's opinion is a RATIO vs the baseline (unit-
  // invariant), so both numbers convert by scaling the league-scored per-game baseline.
  let base = tc.base, fpg = tc.fpg, unit = 'PPR/G';
  if(tc.base != null && tc.base >= TC_MD_MIN_BASE && typeof calcFpts === 'function'){
    // Seed rows name passing TDs differently than the rankings rows calcFpts was built for;
    // the games divisor mirrors baseline_ppr_fpg (min(gp,17)) so both sides share one basis.
    const lgRow = (p.passing_tds == null && p.passing_touchdowns != null)
      ? Object.assign({}, p, {passing_tds: p.passing_touchdowns}) : p;
    const gp = Math.max(1, Math.min(Number(p.games_played) || 17, 17));
    const lg = calcFpts(lgRow) / gp;
    if(lg > 1){ base = lg; fpg = lg * (tc.fpg / tc.base); unit = 'PTS/G · your scoring'; }
  }
  // Source ICONS carry the "whose number" cue (words made the row wrap on phones); if an
  // icon can't load (fully offline bake without the images dir) it degrades to a text tag.
  const icoTc = `<img src="${typeof TC_APP_ICON!=='undefined'?TC_APP_ICON:'images/app-icon.png'}" class="tc-md-ico" alt="TripleCrown model" onerror="if(this.parentNode)this.outerHTML='<b class=tc-md-srcword>TC</b>'">`;
  const icoSl = `<img src="${typeof SLEEPER_ICON!=='undefined'?SLEEPER_ICON:'images/sleeper.png'}" class="tc-md-ico" alt="Sleeper baseline" onerror="if(this.parentNode)this.outerHTML='<b class=tc-md-srcword>SLPR</b>'">`;
  const slPart = base != null
    ? `<span class="tc-md-sep tc-md-sep-in">vs</span><span class="tc-md-src tc-md-src2" title="Sleeper's baseline projection">${icoSl}<span class="tc-md-colon">:</span><b>${Number(base).toFixed(1)}</b><span class="tc-md-unit">FPTS/G</span></span>`
    : '';
  const sepOut = base != null ? `<span class="tc-md-sep tc-md-sep-out">vs</span>` : '';
  return `<div class="tc-model-row" title="Projected fantasy points per game (${unit}) — the TC model next to Sleeper's baseline">
    <div class="cfb-rel-label">PROJECTIONS ${(typeof tcInfoBtn==='function') ? tcInfoBtn('tcmodel','How this number is built') : ''}</div>
    <div class="tc-md-vals"><span class="tc-md-src" title="TC model projection">${icoTc}<span class="tc-md-colon">:</span><b>${Number(fpg).toFixed(1)}</b><span class="tc-md-unit">FPTS/G</span></span>${slPart}</div>
    ${sepOut}${chip}
  </div>`;
}

// ⓘ copy — dynamic body so the popup explains THIS player's number with his own inputs.
if(typeof TC_INFO_BOOK !== 'undefined'){
  TC_INFO_BOOK.tcmodel = {
    title: 'TC model projection',
    body: () => {
      const p = (typeof pcardState !== 'undefined' && pcardState) ? tcModelRec(pcardState.pid) : null;
      const tc = p && p.tc;
      let mine = '';
      if(tc && tc.in && tc.in.rk){
        const i = tc.in;
        const bits = [];
        if(i.pick != null) bits.push(`drafted <b>pick ${i.pick}</b>`);
        if(i.prob != null) bits.push(`prospect-model hit probability <b>${Math.round(i.prob*100)}%</b>`);
        mine = `<p><b>Rookie projection:</b> ${bits.join(' · ')}. No NFL tape exists, so this number comes
          from a separate rookie model — predicted rookie-season points per 17 games, trained on every
          drafted player since 2016 with <b>bust risk priced in</b> (draftees who never played count as
          zero in training). Draft capital carries most of the signal; the PROSPECT grade below feeds in
          where it proved predictive (RB/TE).</p>`;
      }else if(tc && tc.in){
        const i = tc.in;
        const bits = [];
        if(i.fpg != null) bits.push(`<b>${i.fpg}</b> PPR FPG over <b>${i.g}</b> games`);
        if(i.xfpg != null) bits.push(`expected (XFP) <b>${i.xfpg}</b>`);
        if(i.tdoe != null) bits.push(`TDs vs expected <b>${i.tdoe > 0 ? '+' : ''}${i.tdoe}</b>`);
        if(i.age != null) bits.push(`age <b>${i.age}</b>`);
        if(i.mv) bits.push(`<b>changed teams</b> since`);
        if(i.pk!=null && i.pk>i.fpg+0.5) bits.push(`career-best season <b>${i.pk}</b> FPG`);
        mine = `<p><b>${i.yr} inputs:</b> ${bits.join(' · ')}.</p>`;
      }
      return `<p>TripleCrown's own projection of next-season <b>points per game</b> — independent
        of Sleeper's baseline, so the two can be compared honestly. When your scoring settings are
        loaded, both numbers on the row are converted into <b>your league's scoring</b> (the model
        thinks in PPR internally; its verdict is a percentage, which survives the conversion).</p>
        ${mine}
        <p>The model is trained on every NFL season since 2015 and reads the season just played:
        <b>opportunity</b> (target share, WOPR, carries), <b>expected fantasy points</b> (what the
        usage was worth before efficiency), <b>touchdown luck</b> (TDs over expectation regress hard
        the following year), <b>age</b>, and <b>offseason movement</b> (changing teams, and how much
        opportunity vacated the new roster). Out-of-sample on 2023–25 it beat regressed-repeat-production
        baselines at every position — most at WR and QB.</p>
        <p>▲/▼ marks where the model meaningfully disagrees with Sleeper's baseline; ≈ means the two
        are within ±6%. The model does <b>not</b> project playing time — for deep bench players
        Sleeper's small number bakes in "he probably won't play" while the model's answers "what
        would he score per game if he did", so those rows get a <i>per-game read</i> tag instead of
        a verdict. Rookies have no row — their read is the PROSPECT grade.</p>`;
    },
  };
}
