// ── "Stuck between two players" — BYO-model AI compare ──────────────────────
// The one AI feature that earns its tokens: a grounded, on-demand verdict
// between two players, fed the app's OWN numbers (projections, VOR, market
// price, schedule, charting, your notes) so the model reasons over current
// data instead of its training cutoff.
//
// FREE-FIRST, BY DESIGN. Nothing here ever calls a model on its own:
//   • one click = one request, no retries, no background calls, no fan-out
//     (the one exception is opt-in: "Look things up" lets a keyed model call
//     TripleCrown's own MCP tools mid-answer, at most TC_AI_MAX_TOOL_ROUNDS
//     extra requests per click, each named in the footer — see 93b)
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
    // Preference ranking from a real benchmark of the app's OWN prompts
    // (2026-09-02, close pair + blowout, scored on grounding / PICK-WHY-FLIP
    // structure / honesty / LATENCY). NOT a hardcoded default — ranked over
    // whatever is live, so a rotated-out favourite yields to the next free one.
    // dots: fastest (~2.5s), clean → mobile. nano-omni: most grounded, ~4s →
    // desktop. lightning/ultra: great but 15-30s, kept as later fallbacks.
    const PREF=[/dots-3-note/i, /nemotron-3-nano-omni/i, /nemotron-3\.5-lightning/i, /nemotron-3-ultra/i];
    const general=/instruct|chat|llama|qwen|deepseek|gemma|mistral|nemotron|dots|ling/i;
    const prank=(id)=>{ for(let i=0;i<PREF.length;i++) if(PREF[i].test(id)) return i;
                        return general.test(id)?PREF.length:PREF.length+1; };
    const free=(j.data||[])
      .filter(m=>{ const pr=m.pricing||{};
        return String(pr.prompt)==='0' && String(pr.completion)==='0'; });
    const models=free.map(m=>m.id).sort((a,b)=>prank(a)-prank(b));
    // Which of them can call tools (the index says so) — the "Look things up"
    // switch only works with these, and the picker marks them.
    const tools=free.filter(m=>Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools')).map(m=>m.id);
    if(models.length){
      try{ localStorage.setItem('tc_ai_free_models', JSON.stringify({at:Date.now(), models, tools})); }catch(e){}
      return models;
    }
  }catch(e){}
  return TC_AI_FREE_MODELS.slice();
}
// Free models that can call tools, from the same cached index (empty until the
// list has been fetched once).
function tcAiToolModels(){
  try{ const c=JSON.parse(localStorage.getItem('tc_ai_free_models')||'null');
       return (c && Array.isArray(c.tools)) ? c.tools : []; }catch(e){ return []; }
}
const TC_AI_MAX_TOKENS = 600;
// Opt-in lookups: how many tool rounds one click may take, and how much of a
// tool's answer the model is handed (the worker already cuts at 12k).
const TC_AI_MAX_TOOL_ROUNDS = 3;
const TC_AI_TOOL_RESULT_CAP = 6000;
const TC_AI_TOOLS_HINT = ' You can also call TripleCrown\'s tools for data the packet lacks — route trees, '
  +'situational splits, weekly team EPA, college logs, contracts (player_data name=… section=…, '
  +'seed_get path=…). The packet already has the basics: look something up only when it would '
  +'change the pick, at most a few calls, then answer.';
// With "think first" on, the model's hidden reasoning shares the output budget —
// at 600 it burns the lot and answers with silence (field report). Opt-in only,
// and the cap rises with it so the answer actually arrives.
const TC_AI_MAX_TOKENS_REASONING = 2400;

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
// The give-up-mid-upload class (Android/Vivaldi field report): the device or
// tab lost its GPU context under the weight transfer. Not a limits problem, not
// model-dependent, not retryable — the machine is telling us it can't do this.
function _aiIsGpuFatalError(e){
  return /mapAsync|unmapped|device.?lost|GPUDevice|destroyed/i.test(String(e&&e.message||e||''));
}
// ── Know before you download ─────────────────────────────────────────────────
// WebGPU publishes its limits table up front — the same numbers whose breach
// produced "requested=10, limit=9" AFTER a download. Probe once, pick the model
// that fits BEFORE any bytes move, and say on the card what this GPU can run.
// What each build needs. Field-tested correction (Firefox, 2026-09-02): the
// 10-storage-buffer demand is the WebLLM RUNTIME's, not the big model's — the
// 1B q4f32 build failed on a 9-buffer adapter with the identical error, so no
// build runs below 10. What still distinguishes the 1B: no shader-f16
// requirement and half the memory, for adapters that clear the buffer bar.
const TC_AI_RUNTIME_BUFFERS = 10;
const TC_AI_LOCAL_REQS = {
  'Llama-3.2-3B-Instruct-q4f16_1-MLC': { f16:true,  dlGB:1.8, label:'3B' },
  'Llama-3.2-1B-Instruct-q4f32_1-MLC': { f16:false, dlGB:1.2, label:'1B' },
};
let _aiGpuProbe=null;
// A phone can pass every adapter limit and still die uploading gigabytes of
// weights — and a crashed browser process can't be caught, only prevented.
function tcAiIsMobile(){
  try{
    if(typeof navigator==='undefined') return false;
    if(navigator.userAgentData && navigator.userAgentData.mobile===true) return true;
    if(/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent||'')) return true;
    // UA masking (Vivaldi) and "desktop site" mode strip every token above —
    // but the HARDWARE still tells the truth: a coarse primary pointer means a
    // touch-first device, and touch-first devices don't hold these weights.
    if(typeof window!=='undefined' && window.matchMedia
       && window.matchMedia('(pointer: coarse)').matches) return true;
    return false;
  }catch(e){ return false; }
}
async function tcAiGpuProbe(){
  if(_aiGpuProbe) return _aiGpuProbe;
  try{
    if(typeof navigator==='undefined' || !navigator.gpu) return (_aiGpuProbe={ok:false});
    const ad=await navigator.gpu.requestAdapter();
    if(!ad) return (_aiGpuProbe={ok:false});
    const L=ad.limits||{};
    _aiGpuProbe={ ok:true,
      mobile:tcAiIsMobile(),
      buffers:Number(L.maxStorageBuffersPerShaderStage)||0,
      maxBufMB:Math.round((Number(L.maxBufferSize)||0)/1048576),
      f16:!!(ad.features && ad.features.has && ad.features.has('shader-f16')) };
  }catch(e){ _aiGpuProbe={ok:false}; }
  return _aiGpuProbe;
}
// Pure: which local build this GPU can run, and the one-line honest label.
function tcAiLocalPlan(probe){
  if(!probe || !probe.ok) return { model:null, note:'Needs WebGPU.' };
  // Field report (Android, 2026-09-02): the download crashed the browser
  // outright — phones can pass every limit and still not hold the weights.
  if(probe.mobile)
    return { model:null,
      note:'Phones can\u2019t hold the local model \u2014 the download crashes the tab. On mobile, use the built-in model (newer Android Chrome offers it automatically) or a free-tier key: both are network-light and $0.' };
  // Not enough addressable buffer memory for even the small build's weights.
  if(probe.maxBufMB && probe.maxBufMB < 1024)
    return { model:null,
      note:`This GPU can address ${probe.maxBufMB} MB per buffer \u2014 under what the smallest build's weights need. The built-in-AI and own-key options are unaffected.` };
  if(probe.buffers < TC_AI_RUNTIME_BUFFERS)
    return { model:null,
      note:`This browser's WebGPU allows ${probe.buffers} storage buffers per shader stage; the local runtime needs ${TC_AI_RUNTIME_BUFFERS} — no build fits (Firefox commonly caps here; Chrome/Edge desktop usually clear it). The built-in-AI and own-key options are unaffected.` };
  for(const m of TC_AI_LOCAL_MODELS){
    const r=TC_AI_LOCAL_REQS[m]||{};
    if(!r.f16 || probe.f16)
      return { model:m, note:`Your GPU fits the ${r.label} build — one-time ~${r.dlGB} GB, then offline.` };
  }
  return { model:null, note:'This GPU lacks the shader features every build needs.' };
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
      if(_aiIsGpuFatalError(e))
        throw new Error(`This device's GPU gave up while loading the model weights (${String(e&&e.message||'').slice(0,90)}). That is the hardware's answer, not a glitch \u2014 on phones and tablets use the built-in model or a free-tier key instead; both are network-light and $0.`);
      // Only a GPU-limits failure earns the smaller model; anything else
      // (network, cancelled download) surfaces as-is — no silent downgrades.
      if(!_aiIsGpuLimitError(e)) throw e;
      if(onProgress) onProgress(`this GPU can't fit ${model} — trying a smaller build…`);
    }
  }
  throw new Error(`This browser's WebGPU can't satisfy the local runtime — every build needs ${TC_AI_RUNTIME_BUFFERS} storage buffers per shader stage and this adapter offers fewer (${String(lastErr&&lastErr.message||'').slice(0,110)}). Firefox commonly caps here; Chrome/Edge desktop usually work. Built-in-AI and own-key options are unaffected.`);
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
  if(m==='paste') return 'paste';   // any AI app, by clipboard — always available
  // No explicit choice: FREE leads. The browser's own model when it exists;
  // a saved key only answers by default when nothing keyless is available.
  if(tcAiBuiltinAvailable()) return 'builtin';
  if(s.key) return 'key';
  return null;
}
async function tcAiGenerate(messages, onProgress){
  const mode=tcAiMode();
  if(mode==='paste') throw new Error('Paste mode: copy the packet and ask your own AI');
  if(mode==='builtin'){ const t=await _aiBuiltinGenerate(messages); tcAiRecordUsage(null); return t; }
  if(mode==='local'){ const t=await _aiLocalGenerate(messages, onProgress); tcAiRecordUsage(null); return t; }
  return tcAiCall(messages, onProgress);   // 'key' — records real token usage itself
}

function tcAiSettings(){
  let s={};
  try{ s=JSON.parse(localStorage.getItem('tc_ai_settings')||'{}')||{}; }catch(e){}
  const endpoint=(typeof s.endpoint==='string' && /^https:\/\//.test(s.endpoint)) ? s.endpoint : TC_AI_DEFAULT_ENDPOINT;
  return { endpoint, key:(typeof s.key==='string')?s.key:'',
           model:(typeof s.model==='string' && s.model)?s.model:TC_AI_FREE_MODELS[0],
           modelChosen: !!s.model,
           reasoning: s.reasoning===true,
           tools: s.tools===true,
           mcp:(typeof s.mcp==='string' && /^https:\/\//.test(s.mcp))?s.mcp:'',
           mode:(['key','builtin','local','paste'].includes(s.mode))?s.mode:'' };
}
// The default model when the user hasn't chosen one, off the live free list:
// on a phone the fastest performer, on desktop the most grounded (both from the
// 2026-09-02 benchmark). Falls back to the preference-sorted list head, then the
// static default — never a hardcoded slug that can rotate out.
function tcAiDefaultModel(freeList){
  const list=Array.isArray(freeList)?freeList:[];
  const mobile=(typeof tcAiIsMobile==='function' && tcAiIsMobile());
  const wants= mobile ? [/dots-3-note/i, /nemotron-3-nano-omni/i]
                      : [/nemotron-3-nano-omni/i, /dots-3-note/i];
  for(const re of wants){ const hit=list.find(m=>re.test(m)); if(hit) return hit; }
  return list[0] || TC_AI_FREE_MODELS[0];
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
// The same packet as plain text, for any AI the user already has open (the Claude
// or ChatGPT app on a phone, Perplexity, a work assistant). Zero tokens spent here;
// the app does the grounding, whatever they paste it into does the judging.
function tcAiPacketText(pa, pb, question){
  const m=tcAiCompareMessages(pa, pb, question);
  return m.map(x=>x.content).join('\n\n')+'\n\n(Data: TripleCrown — every number above is from the app, not from memory.)';
}
async function tcAiCopyPacket(){
  const btn=document.getElementById('aiCopyBtn'), out=document.getElementById('aiCmpOut');
  if(!_aiCmp.a||!_aiCmp.b) return false;
  const txt=tcAiPacketText(_aiCmp.a,_aiCmp.b);
  let ok=false;
  try{
    if(typeof navigator!=='undefined' && navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(txt); ok=true;
    }
  }catch(e){}
  if(!ok){
    // No clipboard API (file://, older WebViews): hand the text over for a manual select-all.
    try{
      const ta=document.createElement('textarea'); ta.value=txt;
      document.body.appendChild(ta); ta.select();
      ok=!!(document.execCommand && document.execCommand('copy')); ta.remove();
    }catch(e){}
  }
  if(btn){ const was=btn.dataset.label||btn.textContent; btn.dataset.label=was;
    btn.textContent= ok ? 'Copied — paste it into any AI' : 'Select and copy below';
    setTimeout(()=>{ if(document.getElementById('aiCopyBtn')) btn.textContent=was; }, 2200); }
  if(!ok && out) out.innerHTML=`<textarea class="ai-cmp-paste" readonly onclick="this.select()">${escHtml(txt)}</textarea>`;
  return ok;
}
// Rough token estimate for the pre-send label (chars/4 is the usual budget rule).
function tcAiEstTokens(messages){
  return Math.round(messages.reduce((a,m)=>a+(m.content||'').length,0)/4);
}

// One click, one request. No retries — a failure renders and waits for a human.
// With "Look things up" on, the model may answer with tool calls instead of text:
// each is run against TripleCrown's MCP worker and the conversation continues,
// at most TC_AI_MAX_TOOL_ROUNDS times — so a click is bounded at 1+ROUNDS requests,
// every one counted, every lookup named in _aiLastLookups for the footer.
let _aiLastLookups=[];
async function tcAiCall(messages, onProgress){
  const s=tcAiSettings();
  if(!s.key) throw new Error('No API key set');
  _aiLastLookups=[];
  let tools=null;
  if(s.tools && typeof tcMcpTools==='function'){
    try{ tools=tcMcpToOpenAiTools(await tcMcpTools()); }catch(e){ tools=null; }   // connector down → plain answer
  }
  const msgs=messages.slice();
  if(tools && tools.length && msgs[0] && msgs[0].role==='system')
    msgs[0]={ role:'system', content: msgs[0].content+TC_AI_TOOLS_HINT };
  let rounds=0;
  for(;;){
  const body={ model:s.model, messages:msgs,
               max_tokens: s.reasoning ? TC_AI_MAX_TOKENS_REASONING : TC_AI_MAX_TOKENS };
  if(tools && tools.length && rounds<TC_AI_MAX_TOOL_ROUNDS) body.tools=tools;
  // Most current free tiers are REASONING models: left alone they spend the
  // whole max_tokens budget "thinking" and never emit visible content — the
  // response comes back 200 with an empty message (field report: mobile,
  // every free model, "Empty response"). Default: ask OpenRouter to keep the
  // thinking out of the budget. "Think first" (opt-in) turns it on WITH the
  // bigger cap; the reasoning itself stays out of the reply either way. Only on
  // OpenRouter: other OpenAI-compatible endpoints may reject the parameter.
  if(/openrouter\.ai/.test(s.endpoint))
    body.reasoning= s.reasoning ? { enabled:true, exclude:true, effort:'medium' }
                                : { enabled:false, exclude:true };
  const res=await fetch(s.endpoint, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${s.key}` },
    body: JSON.stringify(body),
  });
  if(!res.ok){
    let msg=`HTTP ${res.status}`;
    try{ const j=await res.json(); if(j&&j.error&&j.error.message) msg+=` — ${j.error.message}`; }catch(e){}
    // 429 on a free tier is the shared pool being busy or the daily free cap —
    // ordinary weather, not a fault. Say so, with the provider's own timing
    // when it offers one.
    if(res.status===429){
      let wait='';
      try{ const ra=res.headers && res.headers.get && res.headers.get('Retry-After');
           if(ra && isFinite(+ra)) wait=` Provider says retry in ~${Math.ceil(+ra)}s.`; }catch(e){}
      msg+=` — this model's FREE pool is busy (capacity is shared), or the daily free cap is reached.${wait} Another free model usually answers immediately.`;
    }
    throw new Error(msg);
  }
  const j=await res.json();
  // Providers (free tiers especially) report failures INSIDE a 200 body.
  if(j && j.error && j.error.message) throw new Error(String(j.error.message));
  tcAiRecordUsage(j.usage);
  const ch=j.choices && j.choices[0];
  const msg=(ch && ch.message) || {};
  const calls=(body.tools && Array.isArray(msg.tool_calls)) ? msg.tool_calls.filter(c=>c&&c.function&&c.function.name).slice(0,4) : [];
  if(calls.length){
    rounds++;
    msgs.push({ role:'assistant', content: msg.content||null, tool_calls: calls });
    const results=await Promise.all(calls.map(async tc=>{
      let args={}; try{ args=JSON.parse(tc.function.arguments||'{}')||{}; }catch(e){}
      const label=tcMcpCallLabel(tc.function.name, args);
      _aiLastLookups.push(label);
      if(onProgress) onProgress({ lookup:label });
      let text;
      try{ text=await tcMcpCallTool(tc.function.name, args); }
      catch(e){ text=`lookup failed: ${String(e&&e.message||e)}`; }
      return { role:'tool', tool_call_id: tc.id||label, content: String(text).slice(0,TC_AI_TOOL_RESULT_CAP) };
    }));
    msgs.push(...results);
    continue;
  }
  // A reasoning model that ignored the opt-out still leaves its thinking here.
  const txt=msg.content || msg.reasoning || '';
  if(!txt){
    const fr=ch && ch.finish_reason;
    throw new Error(fr==='length'
      ? 'The model spent its whole token budget reasoning and never answered — this free tier thinks out loud. Pick a chat/instruct model from the free list instead.'
      : `Empty response${fr?` (finish_reason: ${fr})`:''} — the model returned nothing; try another free model from the list.`);
  }
  return String(txt);
  }
}
// Which failures earn the one-click road to another free model, and the one
// sentence of interpretation that goes with it. Pure, so it's testable.
function tcAiErrorHint(msg){
  const m=String(msg||'');
  if(/tool.?use|tools? (is|are) not supported|support tool/i.test(m))
    return { hint:'This model can\u2019t call tools. Pick a free model marked \u201ctools\u201d, or switch Research off.' };
  if(/429|rate.?limit|busy|capacity|resource.?exhausted|request limit/i.test(m))
    return { hint:'Free capacity is shared and comes back on its own — or a different free pool answers right now.' };
  if(/thinks out loud|free|404|model/i.test(m))
    return { hint:'Free tiers rotate and vary on the provider\u2019s side — nothing you did.' };
  return null;
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
// The players worth comparing A against: same position, closest on the board.
// "Closest" blends ADP/ECR rank proximity with projected-points proximity, so
// the list is genuinely "same tier / similar rank / similar FPTS" rather than
// just the next names alphabetically. Draft context first — a drafted player
// can't be your pick — then nearest by that blend.
function _aiSimilarToA(a, list, n){
  if(!a) return [];
  const rankOf=(p)=> (typeof adpFor==='function' && adpFor(p)<999) ? adpFor(p)
                    : (p.ecr!=null ? p.ecr*1.2 : 999);
  const aRank=rankOf(a), aF=(a.fpts!=null)?a.fpts:null;
  const pool=(list||[]).filter(p=>p && p.pos===a.pos
    && String(p.player_id||p.name)!==String(a.player_id||a.name)
    && !(typeof draftedIds!=='undefined' && draftedIds && draftedIds[p.player_id]));
  const score=(p)=>{
    let d=Math.abs(rankOf(p)-aRank);                    // picks apart on the board
    if(aF!=null && p.fpts!=null) d += Math.abs(p.fpts-aF)*0.25;   // and projected-points apart
    return d;
  };
  return pool.sort((x,y)=>score(x)-score(y)).slice(0, n||6);
}
// The full candidate set for the B box: the same-position shortlist first
// (that's the usual question), then the nearest players at OTHER positions —
// flex calls and "which of these two do I want at all" are real questions too.
// Cross-position nearness is rank-only: projected points don't compare across
// positions (a QB3 out-scores an RB1).
function _aiCompareCandidates(a, list){
  if(!a) return { same:[], other:[] };
  const same=_aiSimilarToA(a, list, 10);
  const rankOf=(p)=> (typeof adpFor==='function' && adpFor(p)<999) ? adpFor(p)
                    : (p.ecr!=null ? p.ecr*1.2 : 999);
  const aRank=rankOf(a);
  const other=(list||[]).filter(p=>p && p.pos!==a.pos && p.pos!=='K' && p.pos!=='DEF'
      && !(typeof draftedIds!=='undefined' && draftedIds && draftedIds[p.player_id]))
    .sort((x,y)=>Math.abs(rankOf(x)-aRank)-Math.abs(rankOf(y)-aRank)).slice(0,12);
  return { same, other };
}
function _aiCandidateRows(a, list){
  const c=_aiCompareCandidates(a, list);
  return _aiSimilarRows(c.same)
    + (c.other.length ? `<div class="ai-cmp-simdiv">Other positions \u00b7 nearest by rank</div>` + _aiSimilarRows(c.other) : '');
}
function _aiSimilarRows(players){
  const rk=(p)=> (typeof adpFor==='function' && adpFor(p)<999) ? `ADP ${Math.round(adpFor(p))}`
              : (p.ecr!=null ? `ECR ${p.ecr}` : '');
  return (players||[]).map(p=>`<button class="ai-cmp-hit" onclick="_aiPickB('${escAttr(String(p.player_id||p.name))}')">
    <span class="ai-cmp-hit-nm">${escHtml(p.name)}</span>
    <span class="ai-cmp-hit-sub">${p.pos} · ${escHtml(p.team||'FA')}${rk(p)?' · '+rk(p):''}${p.fpts!=null?` · ${Math.round(p.fpts)} pts`:''}</span></button>`).join('')
    || '<div class="ai-cmp-none">No similar players on the board.</div>';
}
function _aiCmpSearch(q){
  const box=document.getElementById('aiCmpMatches'); if(!box) return;
  const head=document.getElementById('aiCmpSimHead');
  q=(q||'').trim().toLowerCase();
  // Empty box → the "similar to A" shortlist; typing → name search.
  if(q.length<2){
    box.innerHTML=_aiCandidateRows(_aiCmp.a, _aiCmp.list);
    if(head) head.textContent=_aiCmp.a?`Similar ${_aiCmp.a.pos}s \u00b7 nearest on the board`:'';
    return;
  }
  const hits=(_aiCmp.list||[]).filter(p=>String(p.name||'').toLowerCase().includes(q)).slice(0,12);
  if(head) head.textContent='Search results';
  box.innerHTML=hits.map(p=>`<button class="ai-cmp-hit" onclick="_aiPickB('${escAttr(String(p.player_id||p.name))}')">
    <span class="ai-cmp-hit-nm">${escHtml(p.name)}</span> <span class="ai-cmp-hit-sub">${p.pos} · ${escHtml(p.team||'FA')}</span></button>`).join('')
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
          <b>Local model <em id="aiLocalRec" class="ai-cmp-rec" hidden>free · recommended</em></b>
          <span id="aiLocalNote">${gpu?'Checking what your GPU can run…':'Needs WebGPU.'}</span></button>
        <button class="ai-cmp-mode ${s.mode==='paste'?'on':''}"
          onclick="_aiCfgOpen=false;tcAiSaveSettings({mode:'paste'});renderAiCompare()">
          <b>Any AI app, by paste ${(!builtin&&!gpu)?'<em class="ai-cmp-rec">free · works here</em>':''}</b>
          <span>Copy the packet, paste it into the AI you already use.</span></button>
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
      ${(typeof openMcpConnector==='function')?`<div class="ai-cmp-or">or outside the app</div>
      <button class="ai-cmp-mode ai-cmp-mcp" onclick="openMcpConnector()">
        <b>TripleCrown in the Claude app <em class="ai-cmp-rec">free \u00b7 connector</em></b>
        <span>Every tool and the whole seed, from any Claude \u2014 phone included.</span></button>`:''}
    </div>`;
    // The GPU probe is instant and download-free: the card says which build
    // THIS machine can run before anyone commits to gigabytes.
    if(gpu) tcAiGpuProbe().then(pr=>{
      const plan=tcAiLocalPlan(pr);
      const note=document.getElementById('aiLocalNote');
      const card=document.getElementById('aiLocalCard');
      const rec=document.getElementById('aiLocalRec');
      if(note) note.textContent=plan.note;
      if(card && !plan.model) card.disabled=true;
      if(rec && plan.model && !builtin) rec.hidden=false;
    }).catch(()=>{});
    // Free tiers rotate weekly — the list is fetched live (public index, no key,
    // no tokens) so the picker can never go stale the way a hardcoded one did.
    tcAiFreeModels().then(models=>{
      const dl=document.getElementById('aiFreeModels');
      const note=document.getElementById('aiFreeCount');
      const inp=document.getElementById('aiModel');
      const tm=new Set(tcAiToolModels());
      if(dl) dl.innerHTML=models.map(m=>`<option value="${escAttr(m)}">FREE — ${escAttr(m)}${tm.has(m)?' · tools':''}</option>`).join('');
      if(note) note.textContent=`${models.length} free right now — pick from the list`;
      // A default the user never chose that is no longer free gets upgraded to
      // a live free model; anything the user typed themselves is respected.
      if(inp && !s.modelChosen && !models.includes(inp.value)) inp.value=tcAiDefaultModel(models);
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
    ${!b?`<input class="ai-cmp-in" placeholder="Compare ${a?escHtml(a.name)+' with…':'with…'}" oninput="_aiCmpSearch(this.value)" onfocus="_aiCmpSearch('')" autocomplete="off">
          ${a?`<div id="aiCmpSimHead" class="ai-cmp-simhead">Similar ${a.pos}s \u00b7 nearest on the board</div>`:''}
          <div id="aiCmpMatches" class="ai-cmp-matches">${a?_aiCandidateRows(a,_aiCmp.list):''}</div>`:''}
    ${a&&b?(()=>{ const mode=tcAiMode();
      const who = mode==='builtin' ? 'the browser\u2019s built-in model'
                : mode==='local' ? TC_AI_LOCAL_MODEL.replace(/-q4.*$/,'')+' (local)'
                : escHtml(s.model.split('/').pop());
      const cap = s.reasoning ? TC_AI_MAX_TOKENS_REASONING : TC_AI_MAX_TOKENS;
      const lookups = mode==='key' && s.tools && typeof tcMcpTools==='function';
      const cost = mode==='key' ? `~${est} tokens in \u00b7 \u2264${cap} out \u00b7 ${lookups?`\u2264${1+TC_AI_MAX_TOOL_ROUNDS} requests`:'1 request'} \u00b7 your key`
                : 'runs on this device \u00b7 $0';
      const think = mode==='key' ? `<div class="ai-cmp-tgls">
        <button class="ai-cmp-sw ${s.reasoning?'on':''}" title="Lets a reasoning model think before it answers \u2014 deeper, several times slower, and it costs more of a free tier's daily budget. Off is the fast path."
          onclick="tcAiSaveSettings({reasoning:${s.reasoning?'false':'true'}});renderAiCompare()">Reasoning <span class="ai-cmp-sw-sub">slower \u00b7 deeper</span></button>
        ${(typeof tcMcpTools==='function')?`<button class="ai-cmp-sw ${s.tools?'on':''}" title="Lets the model call TripleCrown's own tools mid-answer (route trees, splits, weekly EPA, college logs) instead of guessing. Up to ${TC_AI_MAX_TOOL_ROUNDS} extra requests per click, each named below the answer. Needs a model marked \u201ctools\u201d."
          onclick="tcAiSaveSettings({tools:${s.tools?'false':'true'}});renderAiCompare()">Research <span class="ai-cmp-sw-sub">deeper \u00b7 more requests</span></button>`:''}</div>` : '';
      if(mode==='paste')
        return `<button id="aiCopyBtn" class="btn-accent ai-cmp-go" onclick="tcAiCopyPacket()">Copy for any AI <span class="ai-cmp-est">~${est} tokens \u00b7 $0 here</span></button>`;
      return `${think}<div class="ai-cmp-askrow"><button id="aiAskBtn" class="btn-accent ai-cmp-go" onclick="_aiAsk()">Ask ${who} <span class="ai-cmp-est">${cost}</span></button>
        <button id="aiCopyBtn" class="ai-cmp-copy" onclick="tcAiCopyPacket()" title="Copy the data packet for any AI app">⧉ copy</button></div>`; })():''}
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
      (p)=>{ if(!out) return;
        if(p && p.lookup) out.innerHTML=`<div class="ai-cmp-dl">Looking up <span>${escHtml(p.lookup)}</span>\u2026</div>`;
        else out.innerHTML=`<div class="ai-cmp-dl">Preparing the local model \u2014 one-time download, cached after this.<br><span>${escHtml(p||'')}</span></div>`; });
    const looked=(_aiLastLookups||[]).length ? `<div class="ai-cmp-src">Looked up: ${_aiLastLookups.map(escHtml).join(' \u00b7 ')}</div>` : '';
    out.innerHTML=tcAiRenderText(txt)+looked+`<div class="ai-cmp-src">Model output — judgment, not data. The numbers it saw are the app's.</div>`;
  }catch(e){
    const msg=String(e.message||'failed');
    const h=tcAiErrorHint(msg);
    out.innerHTML=`<div class="ai-cmp-err">${escHtml(msg)} — nothing was retried.</div>`
      +(h?`<div class="ai-cmp-err-hint">${escHtml(h.hint)}
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
    <b>Every default is $0.</b> <b>Copy for any AI</b> puts the whole packet on the clipboard for
    whatever assistant you already have open \u2014 no model needed here at all, and it works on
    any phone. The browser's built-in model needs no key and no download; the
    local model downloads once (~1.8 GB, cached, offline afterwards) and runs on your GPU; a
    small local model is a junior analyst \u2014 grounded, but junior. Bringing your own key is
    optional: get one free at openrouter.ai, the picker lists what costs $0 <i>right now</i>
    (free tiers rotate), the key lives only in this browser's localStorage and is sent only to
    the endpoint you configure \u2014 don't paste it on shared machines. Whatever the engine:
    one click is one capped request, nothing retries, nothing runs in the background, and the
    footer counts every call. Tap the <b>Player B</b> box for the players in the same
    conversation — nearest at the position first, then the nearest at other positions.
    <b>Reasoning</b> lets a reasoning model deliberate before answering: deeper, several
    times slower, and it spends more of a free tier's daily allowance — off is the fast path.
    <b>Research</b> (with a key, off by default) lets the model call TripleCrown's own
    connector mid-answer — route trees, situational splits, weekly team EPA, college logs, the
    whole seed — instead of guessing at what the packet left out. Bounded: at most three extra
    requests per click, every one counted in the footer and named under the answer; needs a
    model marked “tools” in the free list. The same connector works in the Claude app on its own —
    <b>TripleCrown in the Claude app</b> in the setup screen hands you the URL.`};
}
