// AI compare (BYO-model): grounding context from app data, free-first guarantees
// (single-shot calls, capped responses, usage accounting), and untrusted-output
// escaping. The network is stubbed — this suite must never spend a token.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},value:'',dataset:{},disabled:false,textContent:'',classList:{add(){},remove(){}},setAttribute(){},appendChild(){},addEventListener(){},remove(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:id=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],
  createElement:()=>({style:{},appendChild(){},addEventListener(){},classList:{add(){}}}),
  body:{appendChild(){}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false}),innerWidth:1200,innerHeight:800};
const LSTORE=new Map();
global.localStorage={getItem:k=>(LSTORE.has(k)?LSTORE.get(k):null),
  setItem:(k,v)=>LSTORE.set(k,String(v)), removeItem:k=>LSTORE.delete(k)};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;
global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
let fetchCalls=[];
const MODELS={data:[
  {id:'alpha/one:free',   pricing:{prompt:'0',    completion:'0'}},
  {id:'beta/two',         pricing:{prompt:'0.002',completion:'0.004'}},
  {id:'gamma/three:free', pricing:{prompt:'0',    completion:'0'}},
  {id:'delta/promo',      pricing:{prompt:'0',    completion:'0.001'}},  // half-free is not free
]};
global.fetch=(url,opts)=>{
  fetchCalls.push({url,opts});
  if(String(url).includes('/models')) return Promise.resolve({ok:true,json:()=>Promise.resolve(MODELS)});
  return Promise.resolve({ok:true,json:()=>Promise.resolve({
    usage:{prompt_tokens:400,completion_tokens:150},
    choices:[{message:{content:'Take Player A.\n\nHe has the better <b>numbers</b>.'}}]})});
};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { tcAiSettings, tcAiSaveSettings, tcAiUsage, tcAiRecordUsage,
  tcAiPlayerContext, tcAiCompareMessages, tcAiEstTokens, tcAiCall, tcAiRenderText, tcAiFreeModels,
  tcAiMode, tcAiGenerate, tcAiBuiltinAvailable, tcAiWebGpuAvailable,
  setWebLlmLoader:(f)=>{_aiWebLlmLoader=f;}, resetLocal:()=>{_aiLocalEngine=null;_aiLocalLoading=null;},
  setContracts:(c)=>{CONTRACTS=c;}, setSos:(x)=>{SOS=x;},
  TC_AI_LOCAL_MODELS, _aiLocalModelPref, tcAiGpuProbe, tcAiLocalPlan, resetProbe:()=>{_aiGpuProbe=null;},
  TC_AI_MAX_TOKENS, TC_AI_FREE_MODELS,
  setFormat:(f)=>{rankFormat=f;}, setDraftLineup:(l)=>{draftLineup=l;} };`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== settings: free by default, bounded by design ===');
let s=app.tcAiSettings();
chk(s.key==='', 'ships with no key — the app can never spend on its own');
chk(/:free$/.test(s.model), 'the default model is a free tier');
chk(/^https:\/\//.test(s.endpoint), 'default endpoint is https');
app.tcAiSaveSettings({endpoint:'http://evil.example/steal'});
chk(/^https:\/\//.test(app.tcAiSettings().endpoint), 'a non-https endpoint is refused');
app.tcAiSaveSettings({key:'sk-test', model:'some/model', endpoint:'https://openrouter.ai/api/v1/chat/completions'});

console.log('=== grounding: the model sees the app\'s numbers ===');
app.setFormat('ppr'); app.setDraftLineup(['QB','RB','WR','TE']);
const pa={player_id:'1', name:'Alpha Back', pos:'RB', team:'KC', fpts:245.2, vor:61.4, ecr:9,
  adp_ppr:11, rushing_yards:'1150', receptions:'48', receiving_yards:'390'};
const pb={player_id:'2', name:'Beta Back', pos:'RB', team:'DET', fpts:238.8, vor:55.0, ecr:12, adp_ppr:14};
app.setContracts({'alpha back':{apy:14000000, fa:2029}});
app.setSos({KC:{rank:31, win_total:11.5}});
const ctx=app.tcAiPlayerContext(pa);
chk(ctx.includes('Alpha Back') && ctx.includes('+61'), 'context carries name and VOR');
chk(ctx.includes('$14M/yr') && ctx.includes('FA 2029'), 'and the contract');
chk(ctx.includes('SOS rank 31') && ctx.includes('11.5'), 'and team strength-of-schedule');
chk(ctx.includes('ADP 11') && ctx.includes('245 pts'), 'and market price and projection');
chk(ctx.includes('1150 rush yds'), 'and the position-appropriate stat line');
const msgs=app.tcAiCompareMessages(pa,pb);
chk(msgs.length===2 && msgs[0].role==='system', 'system+user message pair');
chk(msgs[1].content.includes('PLAYER A') && msgs[1].content.includes('Beta Back'), 'both players aboard');
chk(app.tcAiEstTokens(msgs)>50 && app.tcAiEstTokens(msgs)<2000, 'estimate is sane and shown before sending');

(async()=>{
console.log('=== the call: one shot, capped, accounted ===');
await (async()=>{
  // The app's own boot fetches (state probe, seed autoload) share the stub, so
  // count only requests to the AI endpoint.
  const aiCalls=()=>fetchCalls.filter(f=>f.url===app.tcAiSettings().endpoint);
  const before=aiCalls().length;
  const txt=await app.tcAiCall(msgs);
  chk(aiCalls().length===before+1, 'exactly one request per call — no retries, no fan-out');
  const call=aiCalls()[aiCalls().length-1];
  const body=JSON.parse(call.opts.body);
  chk(body.max_tokens===app.TC_AI_MAX_TOKENS, 'the response is capped');
  chk(call.opts.headers.Authorization==='Bearer sk-test', 'the key rides only the request');
  chk(txt.includes('Take Player A'), 'the verdict comes back');
  const u=app.tcAiUsage();
  chk(u.calls===1 && u.prompt===400 && u.completion===150, 'usage is recorded locally');
  await app.tcAiCall(msgs);
  chk(app.tcAiUsage().calls===2, 'and accumulates');
})();

console.log('=== the free list is LIVE, not remembered ===');
await (async()=>{
  const before=fetchCalls.filter(f=>String(f.url).includes('/models')).length;
  const list=await app.tcAiFreeModels(true);
  chk(list.length===2 && list.includes('alpha/one:free') && list.includes('gamma/three:free'),
      'only fully-$0 models qualify');
  chk(!list.includes('delta/promo'), 'a model with any paid leg is not free');
  const call=fetchCalls.filter(f=>String(f.url).includes('/models')).pop();
  chk(!call.opts || !call.opts.headers || !call.opts.headers.Authorization,
      'the public index is fetched WITHOUT the key');
  await app.tcAiFreeModels();
  const after=fetchCalls.filter(f=>String(f.url).includes('/models')).length;
  chk(after===before+1, 'a fresh list is cached — the second ask costs no request');
  // Provider index down: the stale-but-safe fallback, never a crash.
  LSTORE.delete('tc_ai_free_models');
  const realFetch=global.fetch;
  global.fetch=(url,opts)=>{ if(String(url).includes('/models')) return Promise.reject(new Error('down'));
    return realFetch(url,opts); };
  const fb=await app.tcAiFreeModels(true);
  chk(Array.isArray(fb) && fb.length>0, 'index unreachable → static fallback, not a crash');
  global.fetch=realFetch;
})();

console.log('=== keyless engines: $0 by construction ===');
await (async()=>{
  // This harness has no browser AI and no WebGPU: honesty about absence.
  chk(app.tcAiBuiltinAvailable()===false, 'built-in AI is feature-detected, never assumed');
  chk(app.tcAiWebGpuAvailable()===false, 'so is WebGPU');
  // With a saved key and no explicit mode, the key answers (back-compat).
  chk(app.tcAiMode()==='key', 'a saved key still routes to the key path');
  // Local mode, with an injected fake engine: the router uses it, the key path is
  // never touched, and usage counts the call with zero tokens.
  global.navigator={gpu:{}};
  app.tcAiSaveSettings({mode:'local'});
  let engineCalls=0;
  app.setWebLlmLoader(async()=>({ CreateMLCEngine: async(model,opts)=>{
    opts.initProgressCallback({text:'fetching shards 3/9'});
    return { chat:{ completions:{ create: async(req)=>{
      engineCalls++;
      if(req.max_tokens!==app.TC_AI_MAX_TOKENS) throw new Error('uncapped');
      return {choices:[{message:{content:'Local verdict: Player B.'}}]};
    }}}};
  }}));
  app.resetLocal();
  const keyCallsBefore=fetchCalls.filter(f=>String(f.url).includes('chat/completions')).length;
  const u0=(app.tcAiUsage().calls||0);
  let progress='';
  const txt=await app.tcAiGenerate([{role:'system',content:'s'},{role:'user',content:'u'}],
    (p)=>{progress=p;});
  chk(txt.includes('Player B'), 'the local engine answers');
  chk(progress.includes('shards'), 'download progress reaches the UI');
  chk(fetchCalls.filter(f=>String(f.url).includes('chat/completions')).length===keyCallsBefore,
      'the key path was never touched');
  chk(app.tcAiUsage().calls===u0+1, 'local calls still count in the usage ledger');
  await app.tcAiGenerate([{role:'user',content:'u2'}]);
  chk(engineCalls===2, 'the engine loads once and is reused');
  // A mode this browser cannot honor falls back rather than breaking.
  delete global.navigator;
  chk(app.tcAiMode()==='key', 'local mode without WebGPU falls back to the saved key');
  // FREE IS THE DEFAULT: with no explicit mode, a browser that HAS a built-in
  // model uses it even when a key is saved — the key is the opt-in, not the default.
  app.tcAiSaveSettings({mode:'', key:'sk-test'});
  global.LanguageModel={create:async()=>({prompt:async()=>'x',destroy(){}})};
  chk(app.tcAiMode()==='builtin', 'free built-in model outranks a saved key by default');
  delete global.LanguageModel;
  chk(app.tcAiMode()==='key', 'and without it the key still answers');
})();

console.log('=== the probe: know before you download ===');
await (async()=>{
  const mk=(buffers,f16)=>({ requestAdapter:async()=>({
    limits:{maxStorageBuffersPerShaderStage:buffers},
    features:{has:(k)=>f16&&k==='shader-f16'} }) });
  // A healthy desktop GPU: the 3B fits and the card says so.
  app.resetProbe(); global.navigator={gpu:mk(10,true)};
  let plan=app.tcAiLocalPlan(await app.tcAiGpuProbe());
  chk(plan.model && plan.model.includes('3B'), 'a 10-buffer f16 GPU is offered the 3B');
  chk(/3B build/.test(plan.note), 'and told so in one line');
  // The exact browser from the field report: 9 buffers → the 1B, BEFORE download.
  app.resetProbe(); global.navigator={gpu:mk(9,true)};
  plan=app.tcAiLocalPlan(await app.tcAiGpuProbe());
  chk(plan.model && plan.model.includes('1B'), 'a 9-buffer GPU is routed to the 1B up front');
  // No f16 support also rules the 3B out, whatever the buffer count.
  app.resetProbe(); global.navigator={gpu:mk(12,false)};
  plan=app.tcAiLocalPlan(await app.tcAiGpuProbe());
  chk(plan.model && plan.model.includes('1B'), 'missing shader-f16 also rules out the 3B');
  // A GPU below even the 1B: the card disables itself with the reason.
  app.resetProbe(); global.navigator={gpu:mk(6,false)};
  plan=app.tcAiLocalPlan(await app.tcAiGpuProbe());
  chk(plan.model===null && /6 shader buffers/.test(plan.note),
      'a too-small GPU gets a plain no, with its own numbers');
  // No WebGPU at all.
  app.resetProbe(); delete global.navigator;
  plan=app.tcAiLocalPlan(await app.tcAiGpuProbe());
  chk(plan.model===null, 'no WebGPU, no local plan');
  // And the init path USES the plan: on a 9-buffer GPU the 3B never downloads.
  app.resetProbe(); global.navigator={gpu:mk(9,true)};
  LSTORE.delete('tc_ai_local_model');
  app.tcAiSaveSettings({mode:'local'});
  const tried2=[];
  app.setWebLlmLoader(async()=>({ CreateMLCEngine: async(model,opts)=>{
    tried2.push(model); opts.initProgressCallback({text:'ok'});
    return { chat:{ completions:{ create: async()=>({choices:[{message:{content:'v'}}]}) }}};
  }}));
  app.resetLocal();
  await app.tcAiGenerate([{role:'user',content:'u'}]);
  chk(tried2.length===1 && tried2[0].includes('1B'),
      'the doomed 3B download is skipped entirely — probe first, bytes second');
  delete global.navigator; app.tcAiSaveSettings({mode:'', key:'sk-test'});
})();

console.log('=== GPU limits: fall down a model, never poison the loader ===');
await (async()=>{
  // A gpu the probe can't read: the ladder is the only safety net — which is
  // exactly the case this block exists to prove.
  app.resetProbe(); global.navigator={gpu:{}};
  app.tcAiSaveSettings({mode:'local'});
  LSTORE.delete('tc_ai_local_model');
  // First engine build hits the Safari-style buffer limit; the 1B build works.
  let tried=[];
  app.setWebLlmLoader(async()=>({ CreateMLCEngine: async(model,opts)=>{
    tried.push(model);
    if(model.includes('3B')) throw new Error('Cannot initialize runtime because of requested maxStorageBuffersPerShaderStage exceeds limit. requested=10, limit=9.');
    opts.initProgressCallback({text:'ok'});
    return { chat:{ completions:{ create: async()=>({choices:[{message:{content:'small model verdict'}}]}) }}};
  }}));
  app.resetLocal();
  let prog=[];
  const txt=await app.tcAiGenerate([{role:'user',content:'u'}], (p)=>prog.push(p));
  chk(txt.includes('small model'), 'the smaller build answers when the big one cannot fit');
  chk(tried.length===2 && tried[0].includes('3B') && tried[1].includes('1B'),
      'exactly one step down the ladder');
  chk(prog.some(p=>/smaller build/.test(p)), 'and the user is told why');
  chk(app._aiLocalModelPref().includes('1B'), 'the working model is remembered');
  tried=[];
  await app.tcAiGenerate([{role:'user',content:'u2'}]);
  chk(tried.length===0, 'next ask reuses the engine — no re-init, no re-download');
  // A NON-limit failure must surface untouched and must NOT poison later tries.
  app.resetLocal(); LSTORE.delete('tc_ai_local_model');
  let calls=0;
  app.setWebLlmLoader(async()=>({ CreateMLCEngine: async(model)=>{
    calls++;
    if(calls===1) throw new Error('network dropped mid-download');
    return { chat:{ completions:{ create: async()=>({choices:[{message:{content:'recovered'}}]}) }}};
  }}));
  let failed=false;
  try{ await app.tcAiGenerate([{role:'user',content:'u'}]); }catch(e){
    failed=true;
    chk(/network dropped/.test(e.message), 'a non-GPU failure surfaces as itself — no silent downgrade');
  }
  chk(failed, 'the failure was surfaced, not swallowed');
  const again=await app.tcAiGenerate([{role:'user',content:'u'}]);
  chk(again.includes('recovered'), 'a failed init does not poison the next attempt');
  delete global.navigator;
  app.tcAiSaveSettings({mode:'', key:'sk-test'});
})();

console.log('=== output is untrusted text ===');
const html=app.tcAiRenderText('Take A.\n\nHe has <script>alert(1)</script> upside.');
chk(!html.includes('<script>'), 'markup in model output is escaped');
chk(html.includes('&lt;script&gt;'), 'visibly, not silently dropped');
chk(html.split('<p>').length===3, 'paragraphs survive');

console.log(`\n${pass}/${total} checks passed`);
process.exit(pass===total?0:1);
})();
