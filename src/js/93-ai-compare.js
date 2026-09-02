// ── "Stuck between two players" — BYO-model AI compare ──────────────────────
// The one AI feature that earns its tokens: a grounded, on-demand verdict
// between two players, fed the app's OWN numbers (projections, VOR, market
// price, schedule, charting, your notes) so the model reasons over current
// data instead of its training cutoff.
//
// FREE-FIRST, BY DESIGN. Nothing here ever calls a model on its own:
//   • one click = one request, no retries, no background calls, no fan-out
//   • the default model is an OpenRouter ":free" tier; the picker labels cost
//   • responses are capped (TC_AI_MAX_TOKENS) and the prompt is shown as an
//     estimate BEFORE you send
//   • a running local counter of calls and tokens sits in the modal footer
// Your key, entered by you, stays in this browser's localStorage and is sent
// only to the endpoint you configured (https enforced). This app ships no key
// and pays for nothing — which is the point.

const TC_AI_DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
// Known-free OpenRouter tiers (rate-limited, occasionally rotated by the
// provider — hence suggestions, not a hardcoded registry).
const TC_AI_FREE_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'deepseek/deepseek-chat-v3-0324:free',
  'qwen/qwen-2.5-72b-instruct:free',
];
const TC_AI_MAX_TOKENS = 600;

function tcAiSettings(){
  let s={};
  try{ s=JSON.parse(localStorage.getItem('tc_ai_settings')||'{}')||{}; }catch(e){}
  const endpoint=(typeof s.endpoint==='string' && /^https:\/\//.test(s.endpoint)) ? s.endpoint : TC_AI_DEFAULT_ENDPOINT;
  return { endpoint, key:(typeof s.key==='string')?s.key:'',
           model:(typeof s.model==='string' && s.model)?s.model:TC_AI_FREE_MODELS[0] };
}
function tcAiSaveSettings(patch){
  const cur=tcAiSettings();
  const next=Object.assign({}, cur, patch||{});
  if(!/^https:\/\//.test(next.endpoint||'')) next.endpoint=TC_AI_DEFAULT_ENDPOINT;
  try{ localStorage.setItem('tc_ai_settings', JSON.stringify(next)); }catch(e){}
  return next;
}
function tcAiUsage(){
  try{ return JSON.parse(localStorage.getItem('tc_ai_usage')||'{}')||{}; }catch(e){ return {}; }
}
function tcAiRecordUsage(u){
  const cur=tcAiUsage();
  const next={ calls:(cur.calls||0)+1,
               prompt:(cur.prompt||0)+((u&&u.prompt_tokens)||0),
               completion:(cur.completion||0)+((u&&u.completion_tokens)||0) };
  try{ localStorage.setItem('tc_ai_usage', JSON.stringify(next)); }catch(e){}
  return next;
}

// ── Grounding: one compact fact sheet per player, from the app's own data ────
function tcAiPlayerContext(p){
  if(!p) return '';
  const L=[];
  const adp=(typeof adpFor==='function')?adpFor(p):null;
  L.push(`${p.name} (${p.pos}, ${p.team||'FA'})`);
  const bits=[];
  if(p.fpts!=null) bits.push(`projected ${Math.round(p.fpts)} pts (this league's scoring)`);
  if(p.vor!=null) bits.push(`value over replacement ${p.vor>0?'+':''}${Math.round(p.vor)}`);
  if(p.ecr!=null) bits.push(`expert consensus rank ${p.ecr}`);
  if(adp!=null && adp<999) bits.push(`market ADP ${Math.round(adp)}`);
  if(bits.length) L.push('  board: '+bits.join(' · '));
  // stat-line projection, position-appropriate
  const st=[];
  const n=(k)=>{ const v=parseFloat(p[k]); return isFinite(v)&&v>0?Math.round(v):null; };
  if(p.pos==='QB'){
    if(n('passing_yards')) st.push(`${n('passing_yards')} pass yds`);
    if(n('passing_touchdowns')) st.push(`${n('passing_touchdowns')} pass TD`);
    if(n('rushing_yards')) st.push(`${n('rushing_yards')} rush yds`);
  } else {
    if(n('rushing_yards')) st.push(`${n('rushing_yards')} rush yds`);
    if(n('receptions')) st.push(`${n('receptions')} rec`);
    if(n('receiving_yards')) st.push(`${n('receiving_yards')} rec yds`);
  }
  if(st.length) L.push('  projection: '+st.join(', '));
  // QB accuracy charting (last completed season)
  try{
    if(p.pos==='QB' && typeof NFLVERSE!=='undefined' && NFLVERSE){
      const seasons=Object.keys(NFLVERSE).sort((a,b)=>b-a);
      for(const s of seasons){
        const q=NFLVERSE[s] && NFLVERSE[s].qb_charting && NFLVERSE[s].qb_charting.players
          && NFLVERSE[s].qb_charting.players[ecrNormName(p.name)];
        if(q){ L.push(`  ${s} charting: on-target ${q.on_tgt_pct}%, bad-throw ${q.bad_throw_pct}%, INT-worthy ${q.intw_pct!=null?q.intw_pct+'%':'n/a'}, pressured ${q.pressure_pct}%`); break; }
      }
    }
  }catch(e){}
  // upcoming schedule from the in-season sidecar
  try{
    const ins=(typeof TC_INSEASON!=='undefined'&&TC_INSEASON)||null;
    const sch=ins&&ins.schedule&&p.team?ins.schedule[p.team]:null;
    if(sch){
      const wkNow=(typeof TC_SEASON!=='undefined'&&TC_SEASON.phase==='regular')?Number(TC_SEASON.week)||1:1;
      const nxt=[];
      for(let w=wkNow; w<=18 && nxt.length<4; w++) nxt.push(`wk${w} ${sch[String(w)]||'BYE'}`);
      if(nxt.length) L.push('  schedule: '+nxt.join(', '));
    }
  }catch(e){}
  // the user's own note travels — it's their scouting context
  try{
    if(typeof noteGetByKey==='function' && typeof playerNoteKey==='function'){
      const nte=noteGetByKey(playerNoteKey(p.player_id, p.pos, p.team));
      if(nte && nte.text) L.push('  my note: '+String(nte.text).slice(0,240));
    }
  }catch(e){}
  return L.join('\n');
}

function tcAiCompareMessages(pa, pb, question){
  const fmt=(typeof formatLabel==='function' && typeof rankFormat!=='undefined')?formatLabel(rankFormat):'';
  const shape=(typeof draftLineup!=='undefined' && draftLineup && draftLineup.length)
    ? draftLineup.join('/') : '';
  const sys='You are a fantasy football analyst. Decide between the two players using ONLY '
    +'the data provided plus general football knowledge. Be direct: name a pick in the first '
    +'sentence, then at most three short paragraphs of reasoning. If the data genuinely '
    +'favors neither, say it is a coin flip and what would tip it.';
  const user=`League: ${fmt}${shape?` · lineup ${shape}`:''}\n\nPLAYER A\n${tcAiPlayerContext(pa)}\n\nPLAYER B\n${tcAiPlayerContext(pb)}\n\nQuestion: ${question||'Who should I take?'}`;
  return [{role:'system',content:sys},{role:'user',content:user}];
}
// Rough token estimate for the pre-send label (chars/4 is the usual budget rule).
function tcAiEstTokens(messages){
  return Math.round(messages.reduce((a,m)=>a+(m.content||'').length,0)/4);
}

// One click, one request. No retries — a failure renders and waits for a human.
async function tcAiCall(messages){
  const s=tcAiSettings();
  if(!s.key) throw new Error('No API key set');
  const res=await fetch(s.endpoint, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${s.key}` },
    body: JSON.stringify({ model:s.model, messages, max_tokens:TC_AI_MAX_TOKENS }),
  });
  if(!res.ok){
    let msg=`HTTP ${res.status}`;
    try{ const j=await res.json(); if(j&&j.error&&j.error.message) msg+=` — ${j.error.message}`; }catch(e){}
    throw new Error(msg);
  }
  const j=await res.json();
  tcAiRecordUsage(j.usage);
  const txt=j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if(!txt) throw new Error('Empty response');
  return String(txt);
}
// Model output is untrusted text: escape everything, keep only paragraph breaks.
function tcAiRenderText(txt){
  return String(txt).split(/\n{2,}/).map(par=>
    `<p>${escHtml(par).replace(/\n/g,'<br>')}</p>`).join('');
}

// ── The modal ────────────────────────────────────────────────────────────────
let _aiCmp={ a:null, b:null };
function openAiCompare(pidA){
  const old=document.getElementById('aiCmpOverlay'); if(old) old.remove();
  const list=(typeof buildPlayerList==='function')?buildPlayerList():[];
  const byId=new Map(list.map(p=>[String(p.player_id||p.name), p]));
  _aiCmp={ a: byId.get(String(pidA))||null, b:null, byId, list };
  const ov=document.createElement('div');
  ov.id='aiCmpOverlay'; ov.className='ps-overlay';
  ov.innerHTML=`<div class="ps-modal ai-cmp" role="dialog" aria-label="Compare two players">
    <div class="ps-head"><span class="ai-cmp-title">⚖ Stuck between two players</span>
      <button class="ps-close" onclick="document.getElementById('aiCmpOverlay').remove()" aria-label="Close">${TC_ICON('close')}</button></div>
    <div id="aiCmpBody" class="ai-cmp-body"></div>
  </div>`;
  ov.addEventListener('mousedown', e=>{ if(e.target===ov) ov.remove(); });
  document.body.appendChild(ov);
  renderAiCompare();
}
function _aiPickB(pid){ _aiCmp.b=_aiCmp.byId.get(String(pid))||null; renderAiCompare(); }
function _aiCmpSearch(q){
  const box=document.getElementById('aiCmpMatches'); if(!box) return;
  q=(q||'').trim().toLowerCase();
  if(q.length<2){ box.innerHTML=''; return; }
  const hits=(_aiCmp.list||[]).filter(p=>String(p.name||'').toLowerCase().includes(q)).slice(0,6);
  box.innerHTML=hits.map(p=>`<button class="ai-cmp-hit" onclick="_aiPickB('${escAttr(String(p.player_id||p.name))}')">
    ${escHtml(p.name)} <span class="ai-cmp-hit-sub">${p.pos} · ${escHtml(p.team||'FA')}</span></button>`).join('')
    || '<div class="ai-cmp-none">No match on the board.</div>';
}
function renderAiCompare(){
  const body=document.getElementById('aiCmpBody'); if(!body) return;
  const s=tcAiSettings(), u=tcAiUsage();
  const usage=`${u.calls||0} calls · ${(u.prompt||0)+(u.completion||0)} tokens total, this browser`;
  if(!s.key){
    body.innerHTML=`<div class="ai-cmp-setup">
      <p><b>Bring your own model — this app ships no key and pays for nothing.</b>
      Get a free key at openrouter.ai; the default model below is a <b>free tier</b>
      (rate-limited, $0). Your key stays in this browser's localStorage and is sent only
      to the endpoint configured here. Don't paste it on shared machines.</p>
      <label class="ai-cmp-lbl">API key</label>
      <input id="aiKey" class="ai-cmp-in" type="password" placeholder="sk-or-…" autocomplete="off">
      <label class="ai-cmp-lbl">Model</label>
      <input id="aiModel" class="ai-cmp-in" list="aiFreeModels" value="${escAttr(s.model)}">
      <datalist id="aiFreeModels">${TC_AI_FREE_MODELS.map(m=>`<option value="${escAttr(m)}">FREE — ${escAttr(m)}</option>`).join('')}</datalist>
      <label class="ai-cmp-lbl">Endpoint (OpenAI-compatible, https)</label>
      <input id="aiEndpoint" class="ai-cmp-in" value="${escAttr(s.endpoint)}">
      <button class="btn-accent ai-cmp-go" onclick="tcAiSaveSettings({key:document.getElementById('aiKey').value.trim(),model:document.getElementById('aiModel').value.trim(),endpoint:document.getElementById('aiEndpoint').value.trim()});renderAiCompare()">Save</button>
    </div>`;
    return;
  }
  const a=_aiCmp.a, b=_aiCmp.b;
  const chip=(p,side)=> p
    ? `<div class="ai-cmp-chip"><b>${escHtml(p.name)}</b><span>${p.pos} · ${escHtml(p.team||'FA')}</span></div>`
    : `<div class="ai-cmp-chip empty">pick player ${side}</div>`;
  const msgs=(a&&b)?tcAiCompareMessages(a,b):null;
  const est=msgs?tcAiEstTokens(msgs):0;
  body.innerHTML=`
    <div class="ai-cmp-pair">${chip(a,'A')}<span class="ai-cmp-vs">vs</span>${chip(b,'B')}</div>
    ${!b?`<input class="ai-cmp-in" placeholder="Type the other player's name…" oninput="_aiCmpSearch(this.value)" autocomplete="off">
          <div id="aiCmpMatches" class="ai-cmp-matches"></div>`:''}
    ${a&&b?`<button id="aiAskBtn" class="btn-accent ai-cmp-go" onclick="_aiAsk()">Ask ${escHtml(s.model.split('/').pop())} <span class="ai-cmp-est">~${est} tokens in · ≤${TC_AI_MAX_TOKENS} out · your key</span></button>`:''}
    <div id="aiCmpOut" class="ai-cmp-out"></div>
    <div class="ai-cmp-foot">
      <span>${escHtml(usage)}</span>
      <button class="ai-cmp-cfg" onclick="tcAiSaveSettings({key:''});renderAiCompare()" title="Clear the stored key and reopen setup">key &amp; model…</button>
    </div>`;
}
async function _aiAsk(){
  const btn=document.getElementById('aiAskBtn'), out=document.getElementById('aiCmpOut');
  if(!btn||!out||!_aiCmp.a||!_aiCmp.b) return;
  btn.disabled=true; btn.textContent='Asking…';
  out.innerHTML='';
  try{
    const txt=await tcAiCall(tcAiCompareMessages(_aiCmp.a,_aiCmp.b));
    out.innerHTML=tcAiRenderText(txt)+`<div class="ai-cmp-src">Model output — judgment, not data. The numbers it saw are the app's.</div>`;
  }catch(e){
    out.innerHTML=`<div class="ai-cmp-err">${escHtml(e.message||'failed')} — nothing was retried; press Ask to try again.</div>`;
  }finally{
    if(document.getElementById('aiAskBtn')){ btn.disabled=false; renderAiCompare_footOnly(); btn.textContent='Ask again'; }
  }
}
function renderAiCompare_footOnly(){
  const f=document.querySelector('#aiCmpBody .ai-cmp-foot span');
  const u=tcAiUsage();
  if(f) f.textContent=`${u.calls||0} calls · ${(u.prompt||0)+(u.completion||0)} tokens total, this browser`;
}
