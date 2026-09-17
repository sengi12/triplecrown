// ── Latest news: the player's newest notes, as the Sleeper app shows them ─────
// Sleeper serves each player's news feed (Rotowire and FantasyPros blurbs: a headline, a
// one-line description, an analysis paragraph, the source article) from a public, CORS-open
// endpoint. The card shows the newest three as collapsed rows — headline, how long ago, the
// source — and opens one on tap. Fetched once per card open, kept ten minutes; a team's
// D/ST card (a non-numeric id) has none.
let _pcardNews={};   // pid → {at, items, pending}
const PCARD_NEWS_TTL=10*60*1000;
const PCARD_NEWS_N=3;
const PCARD_NEWS_SOURCES={rotowire:'Rotowire', fantasy_pros:'FantasyPros', fantasypros:'FantasyPros', sleeper:'Sleeper'};

function pcardNewsAgo(ms, now){
  const t=Number(ms||0); if(!t) return '';
  const s=((now!=null?now:Date.now())-t)/1000;
  if(!(s>=0)) return 'now';
  if(s<3600) return `${Math.max(1,Math.round(s/60))}m`;
  if(s<86400) return `${Math.round(s/3600)}h`;
  if(s<86400*14) return `${Math.round(s/86400)}d`;
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
function pcardNewsBodyHTML(items){
  if(!items || !items.length) return '';
  const row=(it)=>`<details class="pcard-news-it"><summary><span class="pcard-news-h">${escHtml(it.title)}</span><span class="pcard-news-m">${escHtml(pcardNewsAgo(it.at))}${it.source?` · ${escHtml(it.source)}`:''}</span></summary>
    <div class="pcard-news-b">${it.desc?`<p>${escHtml(it.desc)}</p>`:''}${it.analysis?`<p class="pcard-news-a">${escHtml(it.analysis)}</p>`:''}${it.url?`<a href="${escAttr(it.url)}" target="_blank" rel="noopener">source ↗</a>`:''}</div></details>`;
  return `<div class="pcard-news-lbl">News</div>${items.map(row).join('')}`;
}
// The band: empty (and hidden) until the feed lands, then the rows; nothing for a D/ST.
function pcardNewsHTML(pid){
  const id=String(pid||''); if(!/^\d+$/.test(id)) return '';
  const items=pcardNewsItems(id);
  if(items===null || (_pcardNews[id] && (Date.now()-_pcardNews[id].at)>=PCARD_NEWS_TTL)) pcardNewsLoad(id);
  return `<div class="pcard-news" id="pcardNews">${pcardNewsBodyHTML(items||[])}</div>`;
}
function _pcardNewsRepaint(pid){
  if(typeof pcardState==='undefined' || !pcardState || String(pcardState.pid)!==String(pid)) return;
  const el=(typeof document!=='undefined') ? document.getElementById('pcardNews') : null; if(!el) return;
  el.innerHTML=pcardNewsBodyHTML(pcardNewsItems(pid)||[]);
}
