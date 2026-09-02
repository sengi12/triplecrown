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
// Preference order. The 3B is the better analyst; the 1B q4f32 variant compiles
// to shaders that fit tighter WebGPU limits — some browsers (Safari notably)
// expose only 9 storage buffers per shader stage where the 3B needs 10, which
// surfaces as "maxStorageBuffersPerShaderStage exceeds limit". When that
// happens we drop down ONCE, remember what worked, and say so.
const TC_AI_LOCAL_MODELS = ['Llama-3.2-3B-Instruct-q4f16_1-MLC',
                            'Llama-3.2-1B-Instruct-q4f32_1-MLC'];
const TC_AI_LOCAL_MODEL = TC_AI_LOCAL_MODELS[0];
function _aiLocalModelPref(){
  try{ const m=localStorage.getItem('tc_ai_local_model');
       if(TC_AI_LOCAL_MODELS.includes(m)) return m; }catch(e){}
  return TC_AI_LOCAL_MODELS[0];
}
function _aiIsGpuLimitError(e){
  return /maxStorageBuffers|exceeds limit|maxBufferSize|maxComputeWorkgroup/i.test(String(e&&e.message||e||''));
}
// ── Know before you download ─────────────────────────────────────────────────
// WebGPU publishes its limits table up front — the same numbers whose breach
// produced "requested=10, limit=9" AFTER a download. Probe once, pick the model
// that fits BEFORE any bytes move, and say on the card what this GPU can run.
// What each build needs, from its compiled shaders:
const TC_AI_LOCAL_REQS = {
  'Llama-3.2-3B-Instruct-q4f16_1-MLC': { buffers:10, f16:true,  dlGB:1.8, label:'3B' },
  'Llama-3.2-1B-Instruct-q4f32_1-MLC': { buffers:8,  f16:false, dlGB:1.2, label:'1B' },
};
let _aiGpuProbe=null;
async function tcAiGpuProbe(){
  if(_aiGpuProbe) return _aiGpuProbe;
  try{
    if(typeof navigator==='undefined' || !navigator.gpu) return (_aiGpuProbe={ok:false});
    const ad=await navigator.gpu.requestAdapter();
    if(!ad) return (_aiGpuProbe={ok:false});
    const L=ad.limits||{};
    _aiGpuProbe={ ok:true,
      buffers:Number(L.maxStorageBuffersPerShaderStage)||0,
      f16:!!(ad.features && ad.features.has && ad.features.has('shader-f16')) };
  }catch(e){ _aiGpuProbe={ok:false}; }
  return _aiGpuProbe;
}
// Pure: which local build this GPU can run, and the one-line honest label.
function tcAiLocalPlan(probe){
  if(!probe || !probe.ok) return { model:null, note:'Needs WebGPU.' };
  for(const m of TC_AI_LOCAL_MODELS){
    const r=TC_AI_LOCAL_REQS[m]||{};
    if(probe.buffers>=(r.buffers||0) && (!r.f16 || probe.f16))
      return { model:m, note:`Your GPU fits the ${r.label} build — one-time ~${r.dlGB} GB, then offline.` };
  }
  return { model:null,
    note:`This GPU exposes ${probe.buffers} shader buffers — below what even the smallest build needs. Chrome desktop usually clears this.` };
}
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
async function _aiLocalInit(onProgress){
  const webllm=await _aiWebLlmLoader();
  // Probe first: skip straight past builds this GPU provably can't run, so a
  // doomed 3B never downloads. The error-ladder below stays as the backstop
  // for whatever the probe can't see.
  let start=_aiLocalModelPref();
  try{
    const plan=tcAiLocalPlan(await tcAiGpuProbe());
    if(plan.model && !localStorage.getItem('tc_ai_local_model')) start=plan.model;
  }catch(e){}
  const order=[start, ...TC_AI_LOCAL_MODELS.filter(m=>m!==start)];
  let lastErr=null;
  for(const model of order){
    try{
      const eng=await webllm.CreateMLCEngine(model, {
        initProgressCallback:(r)=>{ if(onProgress) onProgress(r&&r.text||''); },
      });
      try{ localStorage.setItem('tc_ai_local_model', model); }catch(e){}
      return eng;
    }catch(e){
      lastErr=e;
      // Only a GPU-limits failure earns the smaller model; anything else
      // (network, cancelled download) surfaces as-is — no silent downgrades.
      if(!_aiIsGpuLimitError(e)) throw e;
      if(onProgress) onProgress(`this GPU can't fit ${model} — trying a smaller build…`);
    }
  }
  throw new Error(`This browser's WebGPU exposes fewer GPU buffers than even the smallest local model needs (${String(lastErr&&lastErr.message||'').slice(0,120)}). Chrome desktop usually works; the built-in-AI or own-key options are unaffected.`);
}
async function _aiLocalGenerate(messages, onProgress){
  if(!_aiLocalEngine){
    if(!_aiLocalLoading){
      // A failed init must not poison later attempts: clear the latch on the
      // way out of a rejection so the next click starts clean.
      _aiLocalLoading=_aiLocalInit(onProgress).catch(e=>{ _aiLocalLoading=null; throw e; });
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
  // No explicit choice: FREE leads. The browser's own model when it exists;
  // a saved key only answers by default when nothing keyless is available.
  if(tcAiBuiltinAvailable()) return 'builtin';
  if(s.key) return 'key';
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

// ── Grounding: everything the app knows about the player, one sheet ─────────
// The owner's rule: whichever model answers, it answers from the ENTIRETY of
// TripleCrown's data on these two players — board, market, model, contract,
// schedule, injury, live form, charting, the user's own notes — compacted to
// fit even a local 3B model's context. What the app doesn't know isn't invented.
function tcAiPlayerContext(p){
  if(!p) return '';
  const L=[];
  const adp=(typeof adpFor==='function')?adpFor(p):null;
  const sp=(typeof sleeperPlayers!=='undefined' && sleeperPlayers && sleeperPlayers[p.player_id])||{};
  const idbits=[];
  if(sp.age!=null) idbits.push(`age ${sp.age}`);
  if(sp.years_exp!=null) idbits.push(`${sp.years_exp} yrs exp`);
  L.push(`${p.name} (${p.pos}, ${p.team||'FA'}${idbits.length?'; '+idbits.join(', '):''})`);
  try{
    if(typeof tcInjuryInfo==='function'){
      const inj=tcInjuryInfo(p.player_id);
      if(inj && (inj.status||inj.seasonOut))
        L.push(`  injury: ${inj.seasonOut?'OUT FOR SEASON':(inj.status||'')}${inj.note?` — ${String(inj.note).slice(0,120)}`:''}`);
    }
  }catch(e){}
  const bits=[];
  if(p.fpts!=null) bits.push(`projected ${Math.round(p.fpts)} pts (this league's scoring)`);
  if(p.vor!=null) bits.push(`value over replacement ${p.vor>0?'+':''}${Math.round(p.vor)}`);
  if(p.ecr!=null) bits.push(`expert consensus rank ${p.ecr}`);
  if(adp!=null && adp<999) bits.push(`market ADP ${Math.round(adp)}`);
  if(p.ecr_tier!=null) bits.push(`tier ${p.ecr_tier}`);
  if(p.tcPts!=null) bits.push(`TC model ${Math.round(p.tcPts)} pts`);
  if(bits.length) L.push('  board: '+bits.join(' · '));
  try{
    const c=(typeof CONTRACTS!=='undefined' && CONTRACTS && CONTRACTS[ecrNormName(p.name)])||null;
    if(c && c.apy) L.push(`  contract: $${Math.round(c.apy/1e6)}M/yr through ${c.fa?c.fa-1:'?'} (FA ${c.fa||'?'})`);
  }catch(e){}
  try{
    const so=(typeof SOS!=='undefined' && SOS && p.team && SOS[p.team])||null;
    if(so) L.push(`  team: SOS rank ${so.rank} of 32 · Vegas win total ${so.win_total}`);
  }catch(e){}
  try{
    if(typeof paceForPlayer==='function'){
      const e=paceForPlayer(p.name, p.pos, p.player_id);
      if(e && e.gp>0) L.push(`  this season: ${(e.act/e.gp).toFixed(1)} FPPG over ${e.gp} gm (17-game pace ${Math.round(e.pace17)} vs proj ${Math.round(e.base)})`);
    }
  }catch(e){}
  // stat-line projection, position-appropriate
  const st=[];
  const n=(k)=>{ const v=parseFloat(p[k]); return isFinite(v)&&v>0?Math.round(v):null; };
  const g=n('games')||n('games_played')||17;
  if(p.pos==='QB'){
    if(n('passing_yards')) st.push(`${n('passing_yards')} pass yds`);
    if(n('passing_touchdowns')) st.push(`${n('passing_touchdowns')} pass TD`);
    if(n('passing_attempts')) st.push(`${n('passing_attempts')} att`);
    if(n('rushing_yards')) st.push(`${n('rushing_yards')} rush yds`);
    if(n('rushing_tds')) st.push(`${n('rushing_tds')} rush TD`);
  } else {
    if(n('rushing_attempts')) st.push(`${n('rushing_attempts')} carries`);
    if(n('rushing_yards')) st.push(`${n('rushing_yards')} rush yds`);
    if(n('rushing_tds')) st.push(`${n('rushing_tds')} rush TD`);
    if(n('receiving_targets')) st.push(`${n('receiving_targets')} targets`);
    if(n('receptions')) st.push(`${n('receptions')} rec`);
    if(n('receiving_yards')) st.push(`${n('receiving_yards')} rec yds`);
    if(n('receiving_tds')) st.push(`${n('receiving_tds')} rec TD`);
  }
  if(st.length) L.push(`  projection (${g} gm): `+st.join(', ')
    +(p.fpts!=null&&g?` → ${(p.fpts/g).toFixed(1)} FP/gm`:''));
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

// Small models don't FIND differences — they anchor on the first ordinal they
// see and restate it. They're far better at JUDGING differences someone else
// computed. So the head-to-head contrasts are calculated here, numerically,
// and the model's job is reduced to weighing highlighted evidence.
function tcAiDeltas(pa, pb){
  const L=[];
  const num=(p,k)=>{ const v=parseFloat(p&&p[k]); return isFinite(v)?v:null; };
  const gap=(label,a,b,unit,perGm)=>{
    if(a==null||b==null) return;
    const d=a-b;
    if(Math.abs(d)<1e-9) return;
    const who=d>0?pa.name:pb.name;
    L.push(`${label}: ${who} by ${Math.abs(perGm?d:Math.round(d))}${unit||''}`);
  };
  const va=num(pa,'vor'), vb=num(pb,'vor');
  let close=false;
  if(va!=null && vb!=null){
    const span=Math.max(Math.abs(va),Math.abs(vb),1);
    close=Math.abs(va-vb)/span<=0.15 || Math.abs(va-vb)<8;
    L.push(close
      ? `board value: EFFECTIVELY TIED (${Math.abs(va-vb).toFixed(0)} VOR apart) — the ranks cannot decide this one`
      : `board value: ${va>vb?pa.name:pb.name} by ${Math.abs(va-vb).toFixed(0)} VOR`);
  }
  gap('projected points', num(pa,'fpts'), num(pb,'fpts'), ' pts');
  gap('targets', num(pa,'receiving_targets'), num(pb,'receiving_targets'));
  gap('carries', num(pa,'rushing_attempts'), num(pb,'rushing_attempts'));
  gap('total TDs', (num(pa,'rushing_tds')||0)+(num(pa,'receiving_tds')||0)+(num(pa,'passing_touchdowns')||0),
                   (num(pb,'rushing_tds')||0)+(num(pb,'receiving_tds')||0)+(num(pb,'passing_touchdowns')||0));
  const aa=(typeof adpFor==='function')?adpFor(pa):null, ab=(typeof adpFor==='function')?adpFor(pb):null;
  if(aa!=null&&ab!=null&&aa<999&&ab<999&&Math.round(aa)!==Math.round(ab))
    L.push(`market: drafters take ${aa<ab?pa.name:pb.name} ${Math.abs(Math.round(aa-ab))} picks earlier`);
  try{
    const so=(t)=>((typeof SOS!=='undefined'&&SOS&&t&&SOS[t])||null);
    const sa=so(pa.team), sb=so(pb.team);
    if(sa&&sb&&sa.rank!==sb.rank) L.push(`easier season schedule: ${sa.rank<sb.rank?pa.name:pb.name} (SOS ${sa.rank} vs ${sb.rank})`);
  }catch(e){}
  return { lines:L, close };
}

function tcAiCompareMessages(pa, pb, question){
  const fmt=(typeof formatLabel==='function' && typeof rankFormat!=='undefined')?formatLabel(rankFormat):'';
  const shape=(typeof draftLineup!=='undefined' && draftLineup && draftLineup.length)
    ? draftLineup.join('/') : '';
  const d=tcAiDeltas(pa, pb);
  const sys='You are a fantasy football analyst auditing a draft board, not reading it back. '
    +'The board ranks (VOR/ECR/ADP) are the CONSENSUS UNDER REVIEW — never cite a rank as your '
    +'reason. Decide from the underlying evidence: volume (targets, carries, attempts), '
    +'touchdown access, per-game rates, schedule, role, age, injury, contract situation and '
    +'the computed head-to-head differences. '
    +(d.close?'The board values here are effectively tied, so the ranks CANNOT be the answer. ':'')
    +'Answer in exactly this shape: "PICK: <name>." then "WHY:" with 2-4 sentences that cite '
    +'specific numbers from the data, then "FLIP IF:" one sentence naming what would reverse it. '
    +'If the evidence truly cannot separate them, say "PICK: coin flip" and what would tip it.';
  const user=`League: ${fmt}${shape?` · lineup ${shape}`:''}\n\nPLAYER A\n${tcAiPlayerContext(pa)}\n\nPLAYER B\n${tcAiPlayerContext(pb)}\n\nCOMPUTED HEAD-TO-HEAD DIFFERENCES\n${d.lines.map(l=>'- '+l).join('\n')||'- none material'}\n\nQuestion: ${question||'Who should I take?'}`;
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
      <div class="ai-cmp-setup-h">How should the model run? ${(typeof tcInfoBtn==='function')?tcInfoBtn('aicmp','About the compare feature'):''}</div>
      <div class="ai-cmp-modes">
        <button class="ai-cmp-mode ${s.mode==='builtin'?'on':''}" ${builtin?'':'disabled'}
          onclick="_aiCfgOpen=false;tcAiSaveSettings({mode:'builtin'});renderAiCompare()">
          <b>Browser's built-in AI ${builtin?'<em class="ai-cmp-rec">free · default</em>':''}</b>
          <span>${builtin?'No key, no download.':'Not in this browser.'}</span></button>
        <button id="aiLocalCard" class="ai-cmp-mode ${s.mode==='local'?'on':''}" ${gpu?'':'disabled'}
          onclick="_aiCfgOpen=false;tcAiSaveSettings({mode:'local'});renderAiCompare()">
          <b>Local model ${gpu&&!builtin?'<em class="ai-cmp-rec">free · recommended</em>':''}</b>
          <span id="aiLocalNote">${gpu?'Checking what your GPU can run…':'Needs WebGPU.'}</span></button>
      </div>
      <div class="ai-cmp-or">or your own key</div>
      <label class="ai-cmp-lbl">API key</label>
      <input id="aiKey" class="ai-cmp-in" type="password" placeholder="sk-or-…" autocomplete="off" value="${escAttr(s.key)}">
      <label class="ai-cmp-lbl">Model <span id="aiFreeCount" class="ai-cmp-free-note">checking what's free right now…</span></label>
      <input id="aiModel" class="ai-cmp-in" list="aiFreeModels" value="${escAttr(s.model)}">
      <datalist id="aiFreeModels"></datalist>
      <label class="ai-cmp-lbl">Endpoint (OpenAI-compatible, https)</label>
      <input id="aiEndpoint" class="ai-cmp-in" value="${escAttr(s.endpoint)}">
      <button class="btn-accent ai-cmp-go" onclick="_aiCfgOpen=false;tcAiSaveSettings({mode:'key',key:document.getElementById('aiKey').value.trim(),model:document.getElementById('aiModel').value.trim(),endpoint:document.getElementById('aiEndpoint').value.trim()});renderAiCompare()">Save key</button>
    </div>`;
    // The GPU probe is instant and download-free: the card says which build
    // THIS machine can run before anyone commits to gigabytes.
    if(gpu) tcAiGpuProbe().then(pr=>{
      const plan=tcAiLocalPlan(pr);
      const note=document.getElementById('aiLocalNote');
      const card=document.getElementById('aiLocalCard');
      if(note) note.textContent=plan.note;
      if(card && !plan.model) card.disabled=true;
    }).catch(()=>{});
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

if(typeof TC_INFO_BOOK!=='undefined'){
  TC_INFO_BOOK['aicmp']={title:'Stuck between two players', body:`
    A grounded second opinion: the model is handed <b>everything TripleCrown knows</b> about the
    two players \u2014 projections under this league's scoring, VOR, market ADP, tier, TC model,
    contract, team SOS, upcoming schedule, injury status, live-season form, QB charting, and your
    own notes \u2014 and told to reason from that, not from its training data.
    <b>Every default is $0.</b> The browser's built-in model needs no key and no download; the
    local model downloads once (~1.8 GB, cached, offline afterwards) and runs on your GPU; a
    small local model is a junior analyst \u2014 grounded, but junior. Bringing your own key is
    optional: get one free at openrouter.ai, the picker lists what costs $0 <i>right now</i>
    (free tiers rotate), the key lives only in this browser's localStorage and is sent only to
    the endpoint you configure \u2014 don't paste it on shared machines. Whatever the engine:
    one click is one capped request, nothing retries, nothing runs in the background, and the
    footer counts every call.`};
}
