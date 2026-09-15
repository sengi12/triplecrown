// ═════════════════════════════════════════════════════════════════════════════
// League Analyzer — Standings & the playoff picture (in season)
// ═════════════════════════════════════════════════════════════════════════════
// The league table as Sleeper orders it — wins, then points for — with the playoff line
// drawn where the league's format puts it, and what the standings imply: who has clinched,
// who is in on the current line, who is on the bubble, who is out. All of it is arithmetic
// on the snapshot (wins, losses, ties, points, division, the playoff settings); nothing is
// fetched. The picture is deliberately conservative — a spot is CLINCHED only when no team
// outside the line can catch that record even by winning out, and a team is OUT only when
// winning out cannot reach the line's current record — so it never promises what a
// points tiebreak could still take away.
//
//   games played   wins + losses + ties (Sleeper's counts, so a bye week counts nothing)
//   remaining      regular-season weeks (playoff_week_start − 1) − games played
//   seeds          division leaders first when the league seeds by division (the Sleeper
//                  default); by record straight through otherwise
//   GB             games behind the last playoff seed, in the usual half-game units

function laStdRegularWeeks(s){
  const p=(s&&s.playoffs)||{};
  const ws=Number(p.weekStart)||0;
  return ws>1 ? ws-1 : 14;                 // Sleeper's default: playoffs start week 15
}
function laStdRows(s){
  const teams=(s&&s.teamList)||[];
  const reg=laStdRegularWeeks(s);
  return teams.map(t=>{
    const w=Number(t.wins)||0, l=Number(t.losses)||0, ti=Number(t.ties)||0;
    const played=w+l+ti;
    return { t, w, l, ti, played, remaining:Math.max(0, reg-played),
             pct: played ? (w+0.5*ti)/played : 0,
             pf:Number(t.fpts)||0, pa:Number(t.fptsAgainst)||0,
             division:(t.division!=null)?Number(t.division):null };
  });
}
// Sleeper's order: wins, then points for (ties count half toward the percentage).
function laStdCmp(a,b){ return (b.pct-a.pct) || (b.w-a.w) || (b.pf-a.pf) || String(a.t.teamName||'').localeCompare(String(b.t.teamName||'')); }
function laStdOrder(s){
  const rows=laStdRows(s).sort(laStdCmp);
  const p=(s&&s.playoffs)||{};
  const byDivision = (Number(p.divisions)||0) > 1 && Number(p.seedType||0)!==1 && rows.some(r=>r.division!=null);
  if(!byDivision){ rows.forEach((r,i)=>{ r.seed=i+1; r.divLeader=false; }); return rows; }
  // Division leaders take the top seeds (in record order among themselves), the rest follow.
  const seen=new Set(), leaders=[], rest=[];
  rows.forEach(r=>{ if(r.division!=null && !seen.has(r.division)){ seen.add(r.division); r.divLeader=true; leaders.push(r); } else { r.divLeader=false; rest.push(r); } });
  const out=leaders.concat(rest);
  out.forEach((r,i)=>{ r.seed=i+1; });
  return out;
}
// Clinched / in / bubble / out, from what winning out could still do.
function laPlayoffPicture(s){
  const rows=laStdOrder(s);
  const n=rows.length;
  const p=(s&&s.playoffs)||{};
  let spots=Number(p.teams)||0;
  if(!(spots>0) || spots>=n) spots=Math.min(n, spots>0?spots:Math.max(1, Math.round(n/2)));
  const inside=rows.slice(0, spots), outside=rows.slice(spots);
  const outsideCeiling = outside.length ? Math.max(...outside.map(r=>r.w+r.remaining)) : -1;   // the best any outsider can finish
  const lineWins = inside.length ? Math.min(...inside.map(r=>r.w)) : 0;                        // the line's current record
  const lineRow = inside[inside.length-1];
  rows.forEach((r,i)=>{
    const isIn = i<spots;
    let status;
    if(isIn && r.w > outsideCeiling) status='clinched';
    else if(isIn) status='in';
    else if(r.w + r.remaining < lineWins) status='out';
    else status='bubble';
    r.status=status;
    // Games behind the last seed (a half game per unmatched win or loss).
    r.gb = lineRow ? ((lineRow.w - r.w) + (r.l - lineRow.l))/2 : 0;
  });
  return { rows, spots, regularWeeks:laStdRegularWeeks(s), byDivision: rows.some(r=>r.divLeader) };
}
const LA_STD_STATUS = { clinched:['Clinched','la-std-clinched'], in:['In','la-std-in'], bubble:['Bubble','la-std-bubble'], out:['Out','la-std-out'] };
function laStandingsView(s){
  if(!s || !Array.isArray(s.teamList) || !s.teamList.length) return '<div class="la-empty">No standings yet.</div>';
  const pic=laPlayoffPicture(s);
  const p=s.playoffs||{};
  const played=Math.max(...pic.rows.map(r=>r.played), 0);
  const divName=(d)=>(p.divNames&&p.divNames[d])||`Div ${d}`;
  const rec=(r)=>`${r.w}-${r.l}${r.ti?`-${r.ti}`:''}`;
  const fmtGb=(g)=>g<=0?'–':(Number.isInteger(g)?String(g):g.toFixed(1));
  const rowHTML=(r)=>{
    const t=r.t, mine=s.myUserId && (t.ownerId===s.myUserId || (t.coOwners||[]).includes(s.myUserId));
    const [label, cls]=LA_STD_STATUS[r.status]||['',''];
    const av=t.avatar?`<img class="la-std-av" src="${escAttr(t.avatar)}" alt="" onerror="this.style.display='none'">`:'<span class="la-std-av la-std-av-empty"></span>';
    return `<tr class="la-std-row ${mine?'la-std-mine':''} la-std-${r.status}" data-roster="${escAttr(String(t.rosterId))}">
      <td class="la-std-seed">${r.seed}</td>
      <td class="la-std-team">${av}<span class="la-std-name">${escHtml(t.teamName||t.owner||'')}</span><span class="la-std-owner">@${escHtml(t.owner||'')}${r.divLeader?` · <b title="Division leader">${escHtml(divName(r.division))} leader</b>`:(r.division!=null&&pic.byDivision?` · ${escHtml(divName(r.division))}`:'')}</span></td>
      <td class="la-std-rec">${rec(r)}</td>
      <td class="la-std-num">${r.pf.toFixed(1)}</td>
      <td class="la-std-num la-std-pa">${r.pa?r.pa.toFixed(1):'–'}</td>
      <td class="la-std-strk">${escHtml(t.streak||'')}</td>
      <td class="la-std-num">${fmtGb(r.gb)}</td>
      <td class="la-std-status"><span class="la-std-pill ${cls}">${label}</span></td>
    </tr>`;
  };
  const rows=pic.rows.map((r,i)=>rowHTML(r) + (i===pic.spots-1 && i<pic.rows.length-1 ? `<tr class="la-std-line"><td colspan="8"><span>playoff line · ${pic.spots} of ${pic.rows.length} make it</span></td></tr>` : '')).join('');
  const counts={clinched:0,in:0,bubble:0,out:0}; pic.rows.forEach(r=>{ counts[r.status]++; });
  const weeksLeft=Math.max(0, pic.regularWeeks-played);
  return `<div class="la-std">
    <div class="la-std-head">
      <div class="la-std-title">Standings <span class="la-std-sub">${played} of ${pic.regularWeeks} regular-season weeks played · ${weeksLeft} to go${pic.byDivision?' · division leaders seeded first':''}</span></div>
      <div class="la-std-sum"><span class="la-std-pill la-std-clinched">${counts.clinched} clinched</span><span class="la-std-pill la-std-in">${counts.in} in</span><span class="la-std-pill la-std-bubble">${counts.bubble} on the bubble</span><span class="la-std-pill la-std-out">${counts.out} out</span></div>
    </div>
    <div class="la-std-wrap"><table class="la-std-table">
      <thead><tr><th>#</th><th>Team</th><th>W-L</th><th>PF</th><th>PA</th><th>STRK</th><th title="Games behind the last playoff seed">GB</th><th>Picture</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="la-std-note">Sleeper's order: wins, then points for. Clinched = no team below the line can catch that record even by winning out; Out = winning out cannot reach the line's record. Points tiebreaks are not assumed either way.</div>
  </div>`;
}
