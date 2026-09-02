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
const TC_AI_MODELS_URL = 'https://openrouter.ai/api/v1/models';
// ABSOLUTE last resort only. Free tiers rotate — the first shipped version
// hardcoded three slugs and every one had gone paid within a day of shipping.
// The real list comes from tcAiFreeModels(), which asks OpenRouter's public
// model index (no auth, no tokens) which models cost $0 RIGHT NOW.
const TC_AI_FREE_MODELS = ['meta-llama/llama-3.3-70b-instruct:free'];
const TC_AI_FREE_TTL = 24*3600*1000;
async function tcAiFreeModels(force){
  try{
    const c=JSON.parse(localStorage.getItem('tc_ai_free_models')||'null');
    if(!force && c && Array.isArray(c.models) && c.models.length
       && (Date.now()-(c.at||0)) < TC_AI_FREE_TTL) return c.models;
  }catch(e){}
  try{
    const res=await fetch(TC_AI_MODELS_URL);          // public index — never sends the key
    const j=await res.json();
    const models=(j.data||[])
      .filter(m=>{ const pr=m.pricing||{};
        return String(pr.prompt)==='0' && String(pr.completion)==='0'; })
      .map(m=>m.id);
    if(models.length){
      try{ localStorage.setItem('tc_ai_free_models', JSON.stringify({at:Date.now(), models})); }catch(e){}
      return models;
    }
  }catch(e){}
  return TC_AI_FREE_MODELS.slice();
}
const TC_AI_MAX_TOKENS = 600;

// ── No-key engines: the model runs IN the browser ───────────────────────────
// For people who don't want an account anywhere. Two tiers, tried in order:
//   1. The browser's built-in model (Chrome's Prompt API / Gemini Nano) —
//      no key, no download, managed by the browser. Feature-detected only.
//   2. WebLLM: a small open model on WebGPU, downloaded ONCE (~1.8 GB, cached
//      by the browser, works offline afterward). Unbillable by construction —
//      there is no account to bill. Needs a desktop-class browser/GPU, and a
//      3B model is a junior analyst: fine for reasoning over the numbers we
//      hand it, which is all this feature asks.
const TC_AI_WEBLLM_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.84/+esm';
const TC_AI_LOCAL_MODEL = 'Llama-3.2-3B-Instruct-q4f16_1-MLC';
function tcAiBuiltinAvailable(){
  try{
    if(typeof LanguageModel!=='undefined' && LanguageModel && LanguageModel.create) return true;
    if(typeof window!=='undefined' && window.ai && (window.ai.languageModel||window.ai.assistant)) return true;
  }catch(e){}
  return false;
}
function tcAiWebGpuAvailable(){
  try{ return typeof navigator!=='undefined' && !!navigator.gpu; }catch(e){ return false; }
}
async function _aiBuiltinGenerate(messages){
  const sys=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
  const user=messages.filter(m=>m.role!=='system').map(m=>m.content).join('\n');
  if(typeof LanguageModel!=='undefined' && LanguageModel && LanguageModel.create){
    const sess=await LanguageModel.create({ initialPrompts:[{role:'system',content:sys}] });
    try{ return await sess.prompt(user); }finally{ try{ sess.destroy(); }catch(e){} }
  }
  const lm=window.ai.languageModel||window.ai.assistant;
  const sess=await lm.create({ systemPrompt: sys });
  try{ return await sess.prompt(user); }finally{ try{ sess.destroy(); }catch(e){} }
}
let _aiLocalEngine=null, _aiLocalLoading=null;
// Injectable for tests; real path dynamically imports the pinned CDN build.
let _aiWebLlmLoader = ()=>import(/* webpackIgnore: true */ TC_AI_WEBLLM_URL);
async function _aiLocalGenerate(messages, onProgress){
  if(!_aiLocalEngine){
    if(!_aiLocalLoading){
      _aiLocalLoading=(async()=>{
        const webllm=await _aiWebLlmLoader();
        return webllm.CreateMLCEngine(TC_AI_LOCAL_MODEL, {
          initProgressCallback:(r)=>{ if(onProgress) onProgress(r&&r.text||''); },
        });
      })();
    }
    _aiLocalEngine=await _aiLocalLoading;
  }
  const out=await _aiLocalEngine.chat.completions.create({
    messages, max_tokens:TC_AI_MAX_TOKENS });
  const txt=out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content;
  if(!txt) throw new Error('Empty response from the local model');
  return String(txt);
}
// The router: which engine answers, given settings + what this browser has.
function tcAiMode(){
  const s=tcAiSettings();
  const m=s.mode||'';
  if(m==='key' && s.key) return 'key';
  if(m==='builtin' && tcAiBuiltinAvailable()) return 'builtin';
  if(m==='local' && tcAiWebGpuAvailable()) return 'local';
  // No explicit (working) choice: a saved key wins, then the built-in model.
  if(s.key) return 'key';
  if(tcAiBuiltinAvailable()) return 'builtin';
  return null;
}
async function tcAiGenerate(messages, onProgress){
  const mode=tcAiMode();
  if(mode==='builtin'){ const t=await _aiBuiltinGenerate(messages); tcAiRecordUsage(null); return t; }
  if(mode==='local'){ const t=await _aiLocalGenerate(messages, onProgress); tcAiRecordUsage(null); return t; }
  return tcAiCall(messages);   // 'key' — records real token usage itself
}

function tcAiSettings(){
  let s={};
  try{ s=JSON.parse(localStorage.getItem('tc_ai_settings')||'{}')||{}; }catch(e){}
  const endpoint=(typeof s.endpoint==='string' && /^https:\/\//.test(s.endpoint)) ? s.endpoint : TC_AI_DEFAULT_ENDPOINT;
  return { endpoint, key:(typeof s.key==='string')?s.key:'',
           model:(typeof s.model==='string' && s.model)?s.model:TC_AI_FREE_MODELS[0],
           modelChosen: !!s.model,
           mode:(['key','builtin','local'].includes(s.mode))?s.mode:'' };
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
let _aiCfgOpen=false;
function tcAiOpenSetup(){ _aiCfgOpen=true; renderAiCompare(); }
function renderAiCompare(){
  const body=document.getElementById('aiCmpBody'); if(!body) return;
  const s=tcAiSettings(), u=tcAiUsage();
  const usage=`${u.calls||0} calls · ${(u.prompt||0)+(u.completion||0)} tokens total, this browser`;
  if(tcAiMode()===null || _aiCfgOpen){
    const builtin=tcAiBuiltinAvailable(), gpu=tcAiWebGpuAvailable();
    body.innerHTML=`<div class="ai-cmp-setup">
      <p><b>Pick how the model runs. Every option is $0 by construction.</b></p>
      <div class="ai-cmp-modes">
        <button class="ai-cmp-mode ${s.mode==='builtin'?'on':''}" ${builtin?'':'disabled'}
          onclick="_aiCfgOpen=false;tcAiSaveSettings({mode:'builtin'});renderAiCompare()">
          <b>This browser's built-in AI</b>
          <span>${builtin?'No key, no download — Chrome runs the model on-device.'
                        :'Not available in this browser (Chrome\u2019s built-in model only).'}</span></button>
        <button class="ai-cmp-mode ${s.mode==='local'?'on':''}" ${gpu?'':'disabled'}
          onclick="_aiCfgOpen=false;tcAiSaveSettings({mode:'local'});renderAiCompare()">
          <b>Download a local model</b>
          <span>${gpu?'No key, no account. One-time ~1.8 GB download, cached by the browser, then works offline. Needs a decent GPU; a small model \u2014 grounded but junior.'
                     :'Needs WebGPU — not available in this browser.'}</span></button>
      </div>
      <p class="ai-cmp-or">— or bring your own key —</p>
      <p>Get a free key at openrouter.ai; the picker below lists what's <b>$0 right now</b>.
      Your key stays in this browser's localStorage and is sent only to the endpoint
      configured here. Don't paste it on shared machines.</p>
      <label class="ai-cmp-lbl">API key</label>
      <input id="aiKey" class="ai-cmp-in" type="password" placeholder="sk-or-…" autocomplete="off" value="${escAttr(s.key)}">
      <label class="ai-cmp-lbl">Model <span id="aiFreeCount" class="ai-cmp-free-note">checking what's free right now…</span></label>
      <input id="aiModel" class="ai-cmp-in" list="aiFreeModels" value="${escAttr(s.model)}">
      <datalist id="aiFreeModels"></datalist>
      <label class="ai-cmp-lbl">Endpoint (OpenAI-compatible, https)</label>
      <input id="aiEndpoint" class="ai-cmp-in" value="${escAttr(s.endpoint)}">
      <button class="btn-accent ai-cmp-go" onclick="_aiCfgOpen=false;tcAiSaveSettings({mode:'key',key:document.getElementById('aiKey').value.trim(),model:document.getElementById('aiModel').value.trim(),endpoint:document.getElementById('aiEndpoint').value.trim()});renderAiCompare()">Save key</button>
    </div>`;
    // Free tiers rotate weekly — the list is fetched live (public index, no key,
    // no tokens) so the picker can never go stale the way a hardcoded one did.
    tcAiFreeModels().then(models=>{
      const dl=document.getElementById('aiFreeModels');
      const note=document.getElementById('aiFreeCount');
      const inp=document.getElementById('aiModel');
      if(dl) dl.innerHTML=models.map(m=>`<option value="${escAttr(m)}">FREE — ${escAttr(m)}</option>`).join('');
      if(note) note.textContent=`${models.length} free right now — pick from the list`;
      // A default the user never chose that is no longer free gets upgraded to
      // a live free model; anything the user typed themselves is respected.
      if(inp && !s.modelChosen && !models.includes(inp.value)) inp.value=models[0]||inp.value;
    }).catch(()=>{});
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
    ${a&&b?(()=>{ const mode=tcAiMode();
      const who = mode==='builtin' ? 'the browser\u2019s built-in model'
                : mode==='local' ? TC_AI_LOCAL_MODEL.replace(/-q4.*$/,'')+' (local)'
                : escHtml(s.model.split('/').pop());
      const cost = mode==='key' ? `~${est} tokens in \u00b7 \u2264${TC_AI_MAX_TOKENS} out \u00b7 your key`
                : 'runs on this device \u00b7 $0';
      return `<button id="aiAskBtn" class="btn-accent ai-cmp-go" onclick="_aiAsk()">Ask ${who} <span class="ai-cmp-est">${cost}</span></button>`; })():''}
    <div id="aiCmpOut" class="ai-cmp-out"></div>
    <div class="ai-cmp-foot">
      <span>${escHtml(usage)}</span>
      <button class="ai-cmp-cfg" onclick="tcAiOpenSetup()" title="Change key, model or endpoint (key stays unless you clear it)">key &amp; model…</button>
    </div>`;
}
async function _aiAsk(){
  const btn=document.getElementById('aiAskBtn'), out=document.getElementById('aiCmpOut');
  if(!btn||!out||!_aiCmp.a||!_aiCmp.b) return;
  btn.disabled=true; btn.textContent='Asking…';
  out.innerHTML='';
  try{
    const txt=await tcAiGenerate(tcAiCompareMessages(_aiCmp.a,_aiCmp.b),
      (p)=>{ if(out) out.innerHTML=`<div class="ai-cmp-dl">Preparing the local model \u2014 one-time download, cached after this.<br><span>${escHtml(p||'')}</span></div>`; });
    out.innerHTML=tcAiRenderText(txt)+`<div class="ai-cmp-src">Model output — judgment, not data. The numbers it saw are the app's.</div>`;
  }catch(e){
    const msg=String(e.message||'failed');
    const modelGone=/free|404|model/i.test(msg);
    out.innerHTML=`<div class="ai-cmp-err">${escHtml(msg)} — nothing was retried.</div>`
      +(modelGone?`<div class="ai-cmp-err-hint">Free tiers rotate on the provider's side — nothing you did.
        <button class="ai-cmp-cfg" onclick="localStorage.removeItem('tc_ai_free_models');tcAiOpenSetup()">show what's free right now</button></div>`:'');
  }finally{
    if(document.getElementById('aiAskBtn')){ btn.disabled=false; renderAiCompare_footOnly(); btn.textContent='Ask again'; }
  }
}
function renderAiCompare_footOnly(){
  const f=document.querySelector('#aiCmpBody .ai-cmp-foot span');
  const u=tcAiUsage();
  if(f) f.textContent=`${u.calls||0} calls · ${(u.prompt||0)+(u.completion||0)} tokens total, this browser`;
}
