// ── Latest news: the player's newest notes, as the Sleeper app shows them ─────
// Sleeper serves each player's news feed (Rotowire and FantasyPros blurbs: a headline, a
// one-line description, an analysis paragraph, the source article) from a public, CORS-open
// endpoint. It is the card's News tab — its own tab, so the card still opens on the stats
// and the notes never crowd the hero — shown only once the feed has notes for him: the
// fetch starts when the tab row first renders, the row repaints when the feed lands.
// Fetched once per card open, kept ten minutes; a team's D/ST card (a non-numeric id) has none.
let _pcardNews={};   // pid → {at, items, pending}
const PCARD_NEWS_TTL=10*60*1000;
const PCARD_NEWS_N=5;
const PCARD_NEWS_SOURCES={rotowire:'Rotowire', fantasy_pros:'FantasyPros', fantasypros:'FantasyPros', sleeper:'Sleeper'};

function pcardNewsAgo(ms, now){
  const t=Number(ms||0); if(!t) return '';
  const s=((now!=null?now:Date.now())-t)/1000;
  if(!(s>=0)) return 'now';
  if(s<3600) return `${Math.max(1,Math.round(s/60))}m ago`;
  if(s<86400) return `${Math.round(s/3600)}h ago`;
  if(s<86400*14) return `${Math.round(s/86400)}d ago`;
  try{ return new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric'}); }catch(e){ return ''; }
}
function pcardNewsSource(s){
  const k=String(s||'').toLowerCase().trim();
  return PCARD_NEWS_SOURCES[k] || (k ? k.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()) : '');
}
function pcardNewsNorm(r){
  const m=(r && r.metadata) || {};
  const title=String(m.title||'').trim(); if(!title) return null;
  return { title, desc:String(m.description||'').trim(), analysis:String(m.analysis||'').trim(),
           url:/^https?:\/\//.test(String(m.url||'')) ? String(m.url) : '', source:pcardNewsSource(r.source), at:Number(r.published||0) };
}
function pcardNewsItems(pid){ const c=_pcardNews[String(pid)]; return (c && Array.isArray(c.items)) ? c.items : null; }
function pcardNewsLoad(pid){
  const id=String(pid||''); if(!/^\d+$/.test(id)) return Promise.resolve([]);
  const c=_pcardNews[id];
  if(c && c.pending) return c.pending;
  if(c && Array.isArray(c.items) && (Date.now()-c.at)<PCARD_NEWS_TTL) return Promise.resolve(c.items);
  const p=(async()=>{
    let items=[];
    try{
      const raw=await sleeperFetch(SLEEPER_PLAYER_NEWS_URL(id, PCARD_NEWS_N));
      items=(Array.isArray(raw)?raw:[]).map(pcardNewsNorm).filter(Boolean).sort((a,b)=>b.at-a.at).slice(0, PCARD_NEWS_N);
    }catch(e){ items=[]; }
    _pcardNews[id]={at:Date.now(), items, pending:null};
    _pcardNewsRepaint(id);
    return items;
  })();
  _pcardNews[id]={at:c?c.at:0, items:c?c.items:null, pending:p};
  return p;
}
// Does the card get a News tab? Yes once the feed has notes; asking starts the fetch.
function pcardNewsAvailable(pid){
  const id=String(pid||''); if(!/^\d+$/.test(id)) return false;
  const c=_pcardNews[id];
  if(!c || c.items===null || (Date.now()-c.at)>=PCARD_NEWS_TTL) pcardNewsLoad(id);
  const items=pcardNewsItems(id);
  return !!(items && items.length);
}
// The tab: every note in full — headline, when and where from, the description, the
// analysis, a link to the source article.
function renderPcardNews(pid){
  const items=pcardNewsItems(pid)||[];
  if(!items.length) return `<div class="pcard-news-empty">No news for him yet.</div>`;
  const row=(it)=>`<article class="pcard-news-it">
    <div class="pcard-news-h">${escHtml(it.title)}</div>
    <div class="pcard-news-m">${escHtml(pcardNewsAgo(it.at))}${it.source?`${it.at?' · ':''}via ${escHtml(it.source)}`:''}</div>
    ${it.desc?`<p class="pcard-news-d">${escHtml(it.desc)}</p>`:''}
    ${it.analysis?`<p class="pcard-news-a">${escHtml(it.analysis)}</p>`:''}
    ${it.url?`<a class="pcard-news-src" href="${escAttr(it.url)}" target="_blank" rel="noopener">source ↗</a>`:''}
  </article>`;
  return `<div class="pcard-news">${items.map(row).join('')}</div>`;
}
// The feed landed: the tab row gains (or keeps) its News tab; an open News tab refills.
function _pcardNewsRepaint(pid){
  if(typeof pcardState==='undefined' || !pcardState || String(pcardState.pid)!==String(pid)) return;
  if(typeof renderPcardStatTabs==='function') renderPcardStatTabs();
  if(typeof pcardStatsMode!=='undefined' && pcardStatsMode==='news'){
    const body=(typeof document!=='undefined') ? document.getElementById('pcardBody') : null;
    if(body) body.innerHTML=renderPcardNews(pid);
  }
}
