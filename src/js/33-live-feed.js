// ═════════════════════════════════════════════════════════════════════════════
// The live feed — every game at once, filtered to the leagues you play in
// ═════════════════════════════════════════════════════════════════════════════
// The Sunday-slate view: one place for the plays that matter to your teams while eight
// games run at once. It costs ONE request. The week scoreboard carries, per live game,
// the situation and the LAST PLAY — its text, its type, its yardage, the athletes in it —
// so every board poll (8 s, change-driven; see gcStreamOnBoard) appends whatever is new to
// a rolling feed. No per-game summary is fetched: opening a single game still does that.
//
// Filters: All games, or any of your synced leagues (multi-select). With leagues picked a
// play shows only when someone rostered there is in it, tagged with the owner, and carrying
// the points it just moved under THAT league's scoring — exact for the stats a play
// produces (yards, catches, touchdowns, interceptions). "My matchup" narrows again to the
// two starting line-ups of your own game that week.
var _lf = { rows:[], seen:{}, leagues:[], mineOnly:false, max:150, nameIdx:null, nameIdxAt:0,
  // how the players in the plays were found — read this when a name looks wrong
  stat:{ byId:0, byName:0, bySurname:0, unresolved:0 } };
const LF_MAX_ROWS = 150;

// ── Names → the app's player ids ─────────────────────────────────────────────
// A play names people as "A.Rodgers" with a team; the athletes ESPN lists carry their own
// ids. Both roads lead to a Sleeper id: the espn_id map first, then TEAM|A.rodgers.
function lfNameIndex(){
  const sp=(typeof sleeperPlayers!=='undefined' && sleeperPlayers) ? sleeperPlayers : null;
  const n=sp?Object.keys(sp).length:0;
  if(_lf.nameIdx && _lf.nameIdxAt===n) return _lf.nameIdx;
  const idx={};
  if(sp) for(const pid in sp){
    const p=sp[pid]; const nm=String((p&&p.name)||'').trim(); const tm=String((p&&p.team)||'').toUpperCase();
    if(!nm || !tm) continue;
    const i=nm.indexOf(' '); if(i<0) continue;
    const last=(typeof gcNameNorm==='function')?gcNameNorm(nm.slice(i+1)):nm.slice(i+1).toLowerCase();
    const cand={pid, pos:String((p&&p.pos)||'').toUpperCase()};
    (idx[`${tm}|${nm[0].toLowerCase()}.${last}`]=idx[`${tm}|${nm[0].toLowerCase()}.${last}`]||[]).push(cand);   // initial + surname
    (idx[`${tm}|*.${last}`]=idx[`${tm}|*.${last}`]||[]).push(cand);                                              // surname alone
  }
  _lf.nameIdx=idx; _lf.nameIdxAt=n;
  return idx;
}
// Who a role can plausibly be. Among namesakes on one team the ball goes to the skill
// player, not the tackle; a single candidate is taken as named (a tackle-eligible catch
// is real). Never a different surname.
const LF_ROLE_POS = {
  primary:  ['QB','RB','FB','WR','TE','K','P'],
  receiver: ['WR','TE','RB','FB','QB'],
  picker:   ['CB','S','SS','FS','DB','LB','OLB','ILB','MLB','DE','DT','DL','NT'],
};
const LF_LINE = new Set(['C','G','T','OL','OT','OG','LS']);
function lfPickByRole(cands, role){
  if(!cands || !cands.length) return null;
  if(cands.length===1) return cands[0].pid;
  const pref=LF_ROLE_POS[role]||[];
  for(const pos of pref){ const c=cands.find(x=>x.pos===pos); if(c) return c.pid; }
  const skill=cands.find(x=>!LF_LINE.has(x.pos)); if(skill) return skill.pid;
  return cands[0].pid;
}
// The ESPN athlete id when the board carries one; else the team's man with that initial
// and surname (the skill player among namesakes); else, when the surname is unique on the
// team, that man whatever his initial — "H.Brown" is Marquise (Hollywood) Brown.
function lfPidFor(token, team, espnId, role){
  if(espnId && typeof gcEspnIndex==='function'){ const p=gcEspnIndex()[String(espnId)]; if(p){ _lf.stat.byId++; return p; } }
  if(!token) return null;
  const m=/^([A-Za-z])\.(.+)$/.exec(String(token)); if(!m) return null;
  const norm=(typeof gcNameNorm==='function') ? gcNameNorm(m[2]) : String(m[2]).toLowerCase();
  const idx=lfNameIndex(); const tm=String(team||'').toUpperCase();
  const exact=lfPickByRole(idx[`${tm}|${m[1].toLowerCase()}.${norm}`], role);
  if(exact){ _lf.stat.byName++; return exact; }
  const bySur=idx[`${tm}|*.${norm}`];
  if(bySur && bySur.length===1){ _lf.stat.bySurname++; return bySur[0].pid; }
  _lf.stat.unresolved++;
  return null;
}

// ── What a play did, in fantasy stats ────────────────────────────────────────
// The board's last play gives the type, the yardage and who was in it. That is enough to
// say exactly which counting stats the play produced — and so, under any league's table,
// exactly how many points it just moved.
function lfPlayStats(kind, yds, roles){
  const out={};
  const add=(who, k, v)=>{ if(!who) return; (out[who]=out[who]||{})[k]=(out[who][k]||0)+v; };
  switch(kind){
    case 'rush': case 'rushTd':
      add('primary','rush_yd',yds); add('primary','rush_att',1);
      if(kind==='rushTd') add('primary','rush_td',1); break;
    case 'rec': case 'recTd':
      add('receiver','rec',1); add('receiver','rec_yd',yds); add('primary','pass_yd',yds); add('primary','pass_cmp',1); add('primary','pass_att',1);
      if(kind==='recTd'){ add('receiver','rec_td',1); add('primary','pass_td',1); } break;
    case 'inc': add('primary','pass_att',1); break;
    case 'int': add('primary','pass_att',1); add('primary','pass_int',1); break;
    case 'fg': add('primary','fgm',1); add('primary','fga',1); break;
    case 'fgMiss': add('primary','fga',1); break;
    case 'xp': add('primary','xpm',1); add('primary','xpa',1); break;
    case 'xpMiss': add('primary','xpa',1); break;
    default: break;
  }
  const byPid={};
  for(const role in out){ const pid=roles[role]; if(pid) byPid[pid]=Object.assign(byPid[pid]||{}, out[role]); }
  return byPid;
}
// The play, typed for the feed: what it was, who did it, what it produced.
function lfReadPlay(lp){
  const type=String(lp.type||''), text=String(lp.text||'');
  // the yardage: the board's number, else the words ("for 60 yards", "32 yard field goal")
  let yds=Number(lp.yds||0);
  if(!yds){ const m=/for (-?\d+) yards?/.exec(text) || /(\d+) yard field goal/.exec(text); if(m) yds=Number(m[1]); }
  const names=(typeof gcPlayNames==='function') ? gcPlayNames(text) : {primary:'', receiver:'', picker:''};
  let kind='other', title='';
  const ath=Array.isArray(lp.athletes)?lp.athletes:[];
  const roleTok={ primary:names.primary, receiver:names.receiver, picker:names.picker };
  const roles={};
  ['primary','receiver','picker'].forEach(r=>{
    const tok=roleTok[r]; if(!tok) return;
    const m=/^([A-Za-z])\.(.+)$/.exec(tok); const last=m?m[2]:'';
    const hit=ath.find(a=>{
      const nm=String(a.name||''); const i=nm.indexOf(' '); const ln=i>0?nm.slice(i+1):nm;
      return (typeof gcNameNorm==='function') ? gcNameNorm(ln)===gcNameNorm(last) : ln.toLowerCase()===last.toLowerCase();
    });
    roles[r]=lfPidFor(tok, (hit&&hit.team)||lp.team, hit&&hit.id, r);
  });
  const nm=(role, tok)=>{
    const pid=roles[role];
    const sp=(typeof sleeperPlayers!=='undefined' && sleeperPlayers) ? sleeperPlayers : {};
    const full=(pid && sp[pid] && sp[pid].name) || '';
    return full ? ((typeof gcShort==='function')?gcShort(full):full) : String(tok||'').replace('.', '. ');
  };
  if(/Rushing Touchdown/.test(type)){ kind='rushTd'; title=`${nm('primary',names.primary)} ${yds} yd rush TD 🎉`; }
  else if(/Passing Touchdown/.test(type)){ kind='recTd'; title=`${nm('receiver',names.receiver)} ${yds} yd TD catch 🎉`; }
  else if(type==='Rush'){ kind='rush'; title=`${nm('primary',names.primary)} ${yds} yd rush`; }
  else if(type==='Pass Reception'){ kind='rec'; title=`${nm('primary',names.primary)} ${yds} yd pass to ${nm('receiver',names.receiver)}`; }
  else if(type==='Pass Incompletion'){ kind='inc'; title=`${nm('primary',names.primary)} incomplete`; }
  else if(/Interception/.test(type)){ kind='int'; title=`INT! ${nm('primary',names.primary)} picked off${/Touchdown/.test(type)?' — pick six 🎉':''}`; }
  else if(type==='Field Goal Good'){ kind='fg'; title=`${nm('primary',names.primary)} ${yds} yd FG 🙌`; }
  else if(/Field Goal Missed|Blocked Field Goal/.test(type)){ kind='fgMiss'; title=`${nm('primary',names.primary)} ${yds} yd FG, no good`; }
  else if(type==='Extra Point Good'){ kind='xp'; title=`${nm('primary',names.primary)} XP, good`; }
  else if(/Extra Point Missed|Blocked Extra Point/.test(type)){ kind='xpMiss'; title=`${nm('primary',names.primary)} XP, missed`; }
  else if(/^Sack/.test(type)){ kind='sack'; title=`${nm('primary',names.primary)} sacked, ${yds} yds`; }
  else if(/Fumble/.test(type)){ kind='fum'; title=`Fumble! ${nm('primary',names.primary)}`; }
  else if(type==='Punt'){ kind='punt'; title=`${nm('primary',names.primary)} punts`; }
  else if(type==='Kickoff'){ kind='ko'; title=`${nm('primary',names.primary)} kicks off`; }
  else if(type==='Penalty'){ kind='pen'; const m=/penalty on ([A-Z]{2,3})-([^,]+), ([^,.]+)/i.exec(text); title=m?`Flag: ${m[3]} on ${m[1]}`:'Penalty'; }
  else { title=text.replace(/^\s*(\([^)]*\)\s*)+/,'').slice(0,90); }
  return {kind, title, roles, stats:lfPlayStats(kind, yds, roles), tokens:roleTok};
}
// The kinds the feed keeps when it is not showing everything.
const LF_KEY_KINDS = new Set(['rushTd','recTd','fg','fgMiss','int','fum','sack','xp','xpMiss']);
function lfIsKey(r){ return LF_KEY_KINDS.has(r.kind) || r.yds>=20 || r.scoreValue>0; }

// ── The rolling feed, fed by every board poll ────────────────────────────────
function lfOnBoard(teams){
  if(!teams) return 0;
  const games={};
  Object.keys(teams).forEach(code=>{
    const t=teams[code]; if(!t || t.state!=='in' || !t.eid || !t.sit || !t.sit.lastPlay) return;
    const eid=String(t.eid);
    if(!games[eid]) games[eid]={ eid, sit:t.sit, home:t.home?code:t.opp, away:t.home?t.opp:code,
      hs:t.home?t.score:t.oppScore, as:t.home?t.oppScore:t.score };
  });
  let added=0;
  Object.keys(games).forEach(eid=>{
    const g=games[eid], lp=g.sit.lastPlay, id=String(lp.id||'');
    if(!id) return;
    const key=`${eid}:${id}`;
    const prev=_lf.rows.find(r=>r.key===key);
    if(prev && prev.text===String(lp.text||'') && prev.scoreValue===Number(lp.scoreValue||0)) return;   // the same play again
    _lf.seen[eid]=id;
    const read=lfReadPlay(lp);
    if(read.kind==='other' && !lp.text) return;
    const row={
      key, eid, id, at:Date.now(),
      home:g.home, away:g.away, hs:g.hs, as:g.as, team:lp.team||'',
      q:Number(g.sit.period||0), clock:String(g.sit.clock||''),
      down:Number(lp.down||0), ddt:String(lp.ddt||''), spot:String(lp.spot||''),
      rz: lp.yte!=null && lp.yte<=20, yds:Number(lp.yds||0), scoreValue:Number(lp.scoreValue||0),
      kind:read.kind, title:read.title, roles:read.roles, stats:read.stats, tokens:read.tokens, text:String(lp.text||''),
    };
    if(prev){ Object.assign(prev, row, {at:prev.at, corrected:true}); }   // a correction: same place, new words
    else _lf.rows.unshift(row);
    added++;
  });
  if(_lf.rows.length>LF_MAX_ROWS) _lf.rows.length=LF_MAX_ROWS;
  if(added && typeof lfRepaint==='function') lfRepaint();
  return added;
}
function lfClear(){ _lf.rows=[]; _lf.seen={}; }

// ── Leagues: who is rostered where, and what a play was worth there ──────────
// The leagues: the player card's map (every synced league — rosters, owners, scoring —
// loaded on the Game Center's first paint) with this week's matchup per league from
// gcMatchupFor; the Week Hub's results stand in when that map has not loaded.
function lfLeagueList(){
  const out=[];
  const pc=(typeof _pcardLg!=='undefined' && _pcardLg && _pcardLg.byLeague) ? _pcardLg.byLeague : {};
  const wk=(typeof gcCurWeek==='function') ? gcCurWeek() : ((typeof TC_SEASON!=='undefined')?Number(TC_SEASON.week||0):0);
  Object.keys(pc).forEach(id=>{
    const L=pc[id]; if(!L || L.inactive || L.error || L.noRoster) return;   // a league I only run: no team to follow
    const m=(typeof gcMatchupFor==='function') ? gcMatchupFor(id, wk) : null;
    const rostered=new Set(Object.keys(L.byPid||{}));
    const mineRoster=new Set(Object.keys(L.byPid||{}).filter(p=>L.byPid[p]&&L.byPid[p].mine));
    out.push({ id:String(id), name:String(L.name||'League'), avatar:L.avatar||null, scoring:L.scoring||null, rostered,
      mine:(m&&!m.pending)?m.mine:mineRoster, opp:(m&&!m.pending)?m.opp:new Set(), oppName:(m&&m.oppName)||'' });
  });
  if(out.length) return out;
  const res=(typeof hubState!=='undefined' && hubState && hubState.results) ? hubState.results : {};
  Object.keys(res).forEach(id=>{
    const r=res[id]; if(!r || r.inactive || !r.league) return;
    out.push({ id:String(id), name:String(r.league.name||'League'),
      scoring:(r.league.scoring_settings && typeof r.league.scoring_settings==='object')?r.league.scoring_settings:null,
      rostered:r.rostered || new Set(),
      mine:new Set(((r.lineup&&r.lineup.starters)||[]).map(String)),
      opp:new Set(((r.lineup&&r.lineup.oppStarters)||[]).map(String)),
      oppName:(r.lineup&&r.lineup.opponent)||'' });
  });
  return out;
}
function lfSelected(){
  const all=lfLeagueList();
  if(!_lf.leagues.length) return [];
  return all.filter(l=>_lf.leagues.includes(l.id));
}
function lfToggleLeague(id){
  id=String(id);
  const i=_lf.leagues.indexOf(id);
  if(i<0) _lf.leagues.push(id); else _lf.leagues.splice(i,1);
  if(!_lf.leagues.length) _lf.mineOnly=false;
  if(typeof lfRepaint==='function') lfRepaint();
}
function lfSetAll(){ _lf.leagues=[]; _lf.mineOnly=false; if(typeof lfRepaint==='function') lfRepaint(); }
// Every league you are in: the plays that touch anyone you or a leaguemate rosters.
function lfSetAllLeagues(){ _lf.leagues=lfLeagueList().map(l=>l.id); if(typeof lfRepaint==='function') lfRepaint(); }
function lfAllLeaguesOn(){ const all=lfLeagueList(); return all.length>0 && _lf.leagues.length===all.length; }
function lfSetMineOnly(v){ _lf.mineOnly=!!v; if(typeof lfRepaint==='function') lfRepaint(); }
// What this play moved in one league: Σ stat × setting over the players it involved.
function lfDelta(row, lg){
  if(!lg || !lg.scoring) return null;
  let sum=0, hit=false;
  for(const pid in row.stats){
    if(!lg.rostered.has(String(pid))) continue;
    const v=(typeof tcSleeperPoints==='function') ? tcSleeperPoints(row.stats[pid], lg.scoring) : null;
    if(v!=null){ sum+=v; hit=true; }
  }
  return hit ? Math.round(sum*100)/100 : null;
}
// Which selected leagues care about this play, and how.
function lfRelevance(row){
  const sel=lfSelected(); if(!sel.length) return {show:true, tags:[]};
  const tags=[];
  sel.forEach(lg=>{
    const pids=Object.keys(row.roles).map(k=>row.roles[k]).filter(Boolean);
    const inLg=pids.filter(p=>lg.rostered.has(String(p)));
    if(!inLg.length) return;
    const mine=inLg.some(p=>lg.mine.has(String(p)));
    const opp=inLg.some(p=>lg.opp.has(String(p)));
    if(_lf.mineOnly && !mine && !opp) return;
    tags.push({ id:lg.id, name:lg.name, mine, opp, delta:lfDelta(row, lg) });
  });
  return {show:tags.length>0, tags};
}
function lfRows(){
  const out=[];
  for(const r of _lf.rows){
    const rel=lfRelevance(r);
    if(!rel.show) continue;
    out.push(Object.assign({}, r, {tags:rel.tags}));
  }
  return out;
}

// ── The panel ────────────────────────────────────────────────────────────────
function lfRepaint(){
  if(typeof renderRightSidebar!=='function') return;
  if(typeof tcPreserveViewScroll==='function') tcPreserveViewScroll(()=>renderRightSidebar(), ['.lf-body','.gcm-sheet','.gc-body']);
  else renderRightSidebar();
}
function lfLiveCount(){
  const b=(typeof tcWeekBoard==='function') ? tcWeekBoard() : null;
  if(!b) return 0;
  const eids=new Set();
  Object.keys(b).forEach(c=>{ const t=b[c]; if(t && t.state==='in' && t.eid) eids.add(String(t.eid)); });
  return eids.size;
}
// A league chip is its Sleeper icon (the name on hover); a league without one, or whose icon
// fails to load, shows its initials — so a row of nine leagues stays one row of icons.
function lfLeagueInitials(name){
  const words=String(name||'').replace(/[^\p{L}\p{N}\s]/gu,' ').trim().split(/\s+/).filter(Boolean);
  const ini=words.length>1 ? words.slice(0,3).map(w=>w[0]).join('') : String(name||'L').slice(0,3);
  return ini.toUpperCase();
}
function lfLeagueChipInner(l){
  const ini=escHtml(lfLeagueInitials(l.name));
  if(!l.avatar) return `<span class="lf-lg-ini">${ini}</span>`;
  return `<img class="lf-lg-av" src="${escAttr(l.avatar)}" alt="" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="lf-lg-ini" hidden>${ini}</span>`;
}
function lfChipsHTML(){
  const list=lfLeagueList(), sel=_lf.leagues;
  const chips=[`<button class="ld-pos ${sel.length?'':'active'}" onclick="lfSetAll()">All games</button>`]
    .concat(list.length>1 ? [`<button class="ld-pos ${lfAllLeaguesOn()?'active':''}" onclick="lfSetAllLeagues()">All leagues</button>`] : [])
    .concat(list.map(l=>`<button class="ld-pos lf-lg ${sel.includes(l.id)?'active':''}" onclick="lfToggleLeague('${escAttr(l.id)}')" title="${escAttr(l.name)}" aria-label="${escAttr(l.name)}">${lfLeagueChipInner(l)}</button>`));
  const mine=sel.length ? `<label class="lf-mine"><input type="checkbox" ${_lf.mineOnly?'checked':''} onchange="lfSetMineOnly(this.checked)"> My matchup only</label>` : '';
  return `<div class="ld-posrow lf-chips">${chips.join('')}</div>${mine}`;
}
function lfTagHTML(t){
  const d=t.delta;
  const cls = t.mine ? 'lf-tag-mine' : (t.opp ? 'lf-tag-opp' : '');
  const who = t.mine ? '★' : (t.opp ? 'vs' : '');
  return `<span class="lf-tag ${cls}">${who?`<b>${who}</b>`:''}${escHtml(t.name.length>18?t.name.slice(0,17)+'…':t.name)}${d!=null&&d!==0?`<em class="${d>0?'lf-up':'lf-down'}">${d>0?'+':''}${d.toFixed(2)}</em>`:''}</span>`;
}
// Blue for your starters, red for the ones you are playing — across the leagues in view
// (every league you are in when the feed is showing all games).
function lfSideSets(){
  const sel=lfSelected(); const use=sel.length?sel:lfLeagueList();
  const mine=new Set(), opp=new Set();
  use.forEach(l=>{ l.mine.forEach(p=>mine.add(String(p))); l.opp.forEach(p=>opp.add(String(p))); });
  return {mine, opp};
}
// The headline with its names coloured like the line under it (blue mine, red theirs).
function lfTitleHTML(r, S){
  let t=escHtml(r.title);
  const sp=(typeof sleeperPlayers!=='undefined' && sleeperPlayers) ? sleeperPlayers : {};
  Object.keys(r.roles||{}).forEach(role=>{
    const pid=r.roles[role]; if(!pid) return;
    const side=S.mine.has(String(pid)) ? 'gc-mine' : (S.opp.has(String(pid)) ? 'gc-opp' : '');
    if(!side) return;
    const p=sp[pid]||{}; const nm=p.name?((typeof gcShort==='function')?gcShort(p.name):p.name):''; if(!nm) return;
    const esc=escHtml(nm); if(t.indexOf(esc)<0) return;
    t=t.replace(esc, `<span class="${side}">${esc}</span>`);
  });
  return t;
}
function lfRowHTML(r, sides){
  const S=sides||lfSideSets();
  const pids=Object.keys(r.roles).map(k=>r.roles[k]).filter(Boolean);
  const sp=(typeof sleeperPlayers!=='undefined' && sleeperPlayers) ? sleeperPlayers : {};
  const who=pids.map(pid=>{
    const p=sp[pid]||{}; const nm=p.name?((typeof gcShort==='function')?gcShort(p.name):p.name):pid;
    const pos=String(p.pos||'').toUpperCase();
    const click=(pos && pos!=='DEF' && typeof pcardOnclick==='function') ? ` onclick="${pcardOnclick(pid, pos, p.team||'')}"` : '';
    const side=S.mine.has(String(pid)) ? ' gc-mine' : (S.opp.has(String(pid)) ? ' gc-opp' : '');
    return `<span class="lf-who"${click}><span class="gcf-name${side}">${escHtml(nm)}</span>${pos?`<span class="gcf-pos gcf-pos-${escAttr(pos.toLowerCase())}">${escHtml(pos)}</span>`:''}</span>`;
  }).join('');
  const sit=r.down>0 ? `${r.ddt}${r.spot?` @ ${r.spot}`:''}` : '';
  const score=`<span>${r.away} ${r.as!=null?r.as:'–'}</span><span class="gcf-dash">–</span><span>${r.hs!=null?r.hs:'–'} ${r.home}</span>`;
  const tags=(r.tags||[]).map(lfTagHTML).join('');
  return `<div class="gcf-row lf-row gcf-${r.kind==='rushTd'||r.kind==='recTd'?'td':(r.kind==='int'||r.kind==='fum'?'to':r.kind)}">
    <img src="${NFL_LOGO(r.team||r.home)}" class="gcf-logo" onerror="this.style.display='none'">
    <div class="gcf-main">
      <div class="gcf-sit">${escHtml(sit)}${r.rz?' <span class="gcf-rz">RZ</span>':''}</div>
      <div class="gcf-title">${lfTitleHTML(r, S)}</div>
      ${who?`<div class="lf-whos">${who}</div>`:''}
      ${tags?`<div class="lf-tags">${tags}</div>`:''}
    </div>
    <div class="gcf-right"><div class="gcf-clock">${r.q?`Q${r.q}`:''} ${escHtml(r.clock)}</div><div class="gcf-score">${score}</div></div>
  </div>`;
}
// The feed itself — the filters and the plays. The Game Center hosts this under its own
// header (one home for both the sidebar and the phone sheet).
function lfBodyHTML(){
  const live=lfLiveCount();
  const rows=lfRows();
  const list = rows.length
    ? (()=>{ const S=lfSideSets(); return `<div class="gcf lf-list">${rows.map(r=>lfRowHTML(r, S)).join('')}</div>`; })()
    : `<div class="ld-empty">${live
        ? (_lf.leagues.length ? 'no plays yet for the leagues you picked' : 'waiting for the next play…')
        : (_lf.rows.length ? 'nothing on right now — the last plays are above' : 'the feed fills as games kick off')}</div>`;
  return `<div class="lf-body">${lfChipsHTML()}${list}</div>`;
}
function lfPanelHTML(phone){
  const live=lfLiveCount();
  const btns=phone ? `<button class="rsb-btn gcm-x" onclick="gcmSet('closed')" title="Close" aria-label="Close">×</button>` : (typeof rsbButtonsHTML==='function'?rsbButtonsHTML():'');
  const head=`<div class="gc-head"><div class="sidebar-section ld-title">Live feed</div><span class="lf-live ${live?'on':''}">${live?`${live} live`:'no games on'}</span>${btns}</div>`;
  return `<div class="gc lf">${head}${lfBodyHTML()}</div>`;
}
