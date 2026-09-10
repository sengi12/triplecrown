// ── League rank tag ─────────────────────────────────────────────────────────
// The builders rank every chart total against the league (rk:{stat:[rank, n]},
// see _attach_ranks in src/nflverse/nflverse.py — season totals against the
// season, a game against that week). "#3 / 41" beside a number is the context
// the number lacks; the color is the quartile.
function pcardRankTag(rk, key){
  const r=rk && rk[key];
  if(!r || !(r[1]>1)) return '';
  const rank=+r[0], n=+r[1];
  const p=(rank-1)/(n-1);
  const cls = p<=0.25 ? 'rk-good' : p<=0.5 ? 'rk-okhi' : p<=0.75 ? 'rk-oklo' : 'rk-bad';
  return `<small class="pc-rank ${cls}" title="Rank ${rank} of ${n} league-wide">#${rank}<span class="pc-rank-n">/${n}</span></small>`;
}
