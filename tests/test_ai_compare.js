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
// The benchmarked names, for the preference/default tests.
const BENCH_MODELS={data:[
  {id:'inclusionai/ling-3.0-flash-fin:free', pricing:{prompt:'0',completion:'0'}},
  {id:'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', pricing:{prompt:'0',completion:'0'}},
  {id:'dots-studio/dots-3-note-preview:free', pricing:{prompt:'0',completion:'0'}},
  {id:'meta/llama-3.3-70b:free', pricing:{prompt:'0',completion:'0'}},
]};
// Node 21+ ships a built-in `navigator` as a getter-only global: assigning to it is a silent
// no-op, so the device stubs below would never take. Start from a clean global instead.
delete global.navigator;
let aiResponse=null;   // per-test override for the chat endpoint's body
let aiHttp=null;       // per-test override for status/headers: {status, retryAfter}
global.fetch=(url,opts)=>{
  fetchCalls.push({url,opts});
  if(String(url).includes('/models')) return Promise.resolve({ok:true,json:()=>Promise.resolve(global.MODELS_SET||MODELS)});
  if(aiHttp) return Promise.resolve({ok:false, status:aiHttp.status,
    headers:{get:(k)=>k==='Retry-After'?aiHttp.retryAfter:null},
    json:()=>Promise.resolve({error:{message:'Provider returned error'}})});
  return Promise.resolve({ok:true,json:()=>Promise.resolve(aiResponse||{
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
  tcAiDeltas, tcAiErrorHint, tcAiDefaultModel, _aiSimilarToA, _aiCompareCandidates,
  TC_AI_MAX_TOKENS, TC_AI_MAX_TOKENS_REASONING,
  setDrafted:(d)=>{draftedIds=d;},
  tcAiPacketText, tcAiCopyPacket, renderAiCompare, setCmp:(a,b)=>{_aiCmp.a=a;_aiCmp.b=b;_aiCmp.list=[a,b];},
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

console.log('=== Player B suggestions: same conversation as A ===');
{
  const P=(id,pos,ecr,fpts,adp,drafted)=>({player_id:id,name:id,pos,team:'KC',ecr,fpts,adp_ppr:adp});
  const list=[
    P('rbA','RB',10,240,10), P('rbNear1','RB',12,232,13), P('rbNear2','RB',9,246,8),
    P('rbFar','RB',55,120,60), P('wr1','WR',11,238,11), P('qb1','QB',10,300,10),
    {player_id:'rbGone',name:'rbGone',pos:'RB',ecr:11,fpts:236,adp_ppr:11},
  ];
  const a=list[0];
  let sim=app._aiSimilarToA(a, list, 6);
  chk(sim.every(p=>p.pos==='RB'), 'only same-position players are suggested');
  chk(!sim.some(p=>p.player_id==='wr1'||p.player_id==='qb1'), 'other positions excluded');
  chk(!sim.some(p=>p.player_id==='rbA'), 'the player himself is never his own comparison');
  chk(['rbNear1','rbNear2','rbGone'].includes(sim[0].player_id),
      'a near-ranked back leads, not a far one');
  chk(sim.indexOf(sim.find(p=>p.player_id==='rbFar')) === sim.length-1
      || !sim.some(p=>p.player_id==='rbFar') || sim.length<6,
      'the distant RB sinks to the bottom or off the short list');
  // A drafted player can't be your pick.
  app.setDrafted({rbGone:1});
  sim=app._aiSimilarToA(a, list, 6);
  chk(!sim.some(p=>p.player_id==='rbGone'), 'a drafted player is not suggested');
  app.setDrafted({});
}

console.log('=== the B box: same position first, then the rest of the board ===');
{
  const P=(id,pos,ecr,fpts,adp)=>({player_id:id,name:id,pos,team:'KC',ecr,fpts,adp_ppr:adp});
  const list=[ P('rbA','RB',10,240,10), P('rbNear','RB',12,232,13), P('rbFar','RB',55,120,60),
               P('wrNear','WR',11,238,11), P('qbNear','QB',9,300,9), P('teFar','TE',80,90,90),
               P('k1','K',150,120,150), P('d1','DEF',140,110,140) ];
  const c=app._aiCompareCandidates(list[0], list);
  chk(c.same.every(p=>p.pos==='RB') && c.same.length===2, 'the same-position shortlist comes first');
  chk(c.other.length>0 && c.other.every(p=>p.pos!=='RB'), 'other positions follow');
  chk(!c.other.some(p=>p.pos==='K'||p.pos==='DEF'), 'kickers and defenses are not offered as comparisons');
  chk(['wrNear','qbNear'].includes(c.other[0].player_id), 'the nearest-ranked other-position player leads that group');
  chk(c.other[c.other.length-1].player_id==='teFar', 'the far one sinks to the bottom');
  app.setDrafted({wrNear:1});
  chk(!app._aiCompareCandidates(list[0], list).other.some(p=>p.player_id==='wrNear'),
      'a drafted player is excluded from the other-position group too');
  app.setDrafted({});
}

console.log('=== anti-parroting: the model judges computed evidence ===');
{
  // Close on the board, different underneath: exactly the case that was being
  // answered by restating the rank.
  const ca={player_id:'c1', name:'Close A', pos:'RB', team:'KC', fpts:240, vor:60,
            receiving_targets:'70', rushing_attempts:'180', rushing_tds:'6', receiving_tds:'3', adp_ppr:20};
  const cb={player_id:'c2', name:'Close B', pos:'RB', team:'DET', fpts:236, vor:55,
            receiving_targets:'28', rushing_attempts:'255', rushing_tds:'11', receiving_tds:'1', adp_ppr:24};
  const d=app.tcAiDeltas(ca,cb);
  chk(d.close, 'a 5-VOR gap on a 60-VOR pair reads as effectively tied');
  chk(d.lines.some(l=>/EFFECTIVELY TIED/.test(l)), 'and says so in the evidence');
  chk(d.lines.some(l=>/targets: Close A by 42/.test(l)), 'the target gap is computed, with the right owner');
  chk(d.lines.some(l=>/carries: Close B by 75/.test(l)), 'so is the carry gap, the other way');
  chk(d.lines.some(l=>/total TDs: Close B by 3/.test(l)), 'and touchdown access across all routes');
  const far=app.tcAiDeltas(ca, Object.assign({},cb,{vor:15}));
  chk(!far.close, 'a genuine value gap is not called a tie');
  const m=app.tcAiCompareMessages(ca,cb);
  chk(m[0].content.includes('never cite a rank as your reason'), 'the system prompt forbids rank-parroting');
  chk(m[0].content.includes('ranks CANNOT be the answer'), 'and hardens further on a board tie');
  chk(m[0].content.includes('PICK:') && m[0].content.includes('FLIP IF:'), 'a structured verdict is demanded');
  chk(m[1].content.includes('COMPUTED HEAD-TO-HEAD DIFFERENCES'), 'the deltas ride the user message');
  const m2=app.tcAiCompareMessages(ca, Object.assign({},cb,{vor:15}));
  chk(!m2[0].content.includes('ranks CANNOT be the answer'), 'the tie clause only appears on actual ties');
}
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

console.log('=== think first: opt-in reasoning with the budget it needs ===');
await (async()=>{
  // Boot-time fetches share the stub: read back only the AI endpoint's last body.
  const lastBody=()=>{ const ep=app.tcAiSettings().endpoint;
    const c=fetchCalls.filter(f=>f.url===ep).pop(); return JSON.parse(c.opts.body); };
  chk(app.tcAiSettings().reasoning===false, 'reasoning is OFF by default');
  aiResponse=null; aiHttp=null;
  app.tcAiSaveSettings({endpoint:'https://openrouter.ai/api/v1/chat/completions', key:'sk-test'});
  await app.tcAiCall([{role:'user',content:'u'}]);
  let sent=lastBody();
  chk(sent.reasoning.enabled===false && sent.max_tokens===app.TC_AI_MAX_TOKENS,
      'off: reasoning disabled and the tight cap');
  app.tcAiSaveSettings({reasoning:true});
  chk(app.tcAiSettings().reasoning===true, 'the toggle persists');
  await app.tcAiCall([{role:'user',content:'u'}]);
  sent=lastBody();
  chk(sent.reasoning.enabled===true && sent.reasoning.exclude===true,
      'on: reasoning enabled, its transcript still kept out of the reply');
  chk(sent.max_tokens===app.TC_AI_MAX_TOKENS_REASONING && sent.max_tokens>app.TC_AI_MAX_TOKENS,
      'and the cap rises so the answer actually arrives');
  app.tcAiSaveSettings({endpoint:'https://my-proxy.example/v1/chat/completions'});
  await app.tcAiCall([{role:'user',content:'u'}]);
  sent=lastBody();
  chk(!('reasoning' in sent) && sent.max_tokens===app.TC_AI_MAX_TOKENS_REASONING,
      'a custom endpoint never sees the vendor param but still gets the bigger cap');
  app.tcAiSaveSettings({reasoning:false, endpoint:'https://openrouter.ai/api/v1/chat/completions'});
  await app.tcAiCall([{role:'user',content:'u'}]);   // leave the defaults as the last call on record
})();

console.log('=== empty responses decoded, not shrugged at ===');
await (async()=>{
  // Reasoning models burn the budget thinking: OpenRouter calls carry the
  // opt-out, and a thinking-only reply still yields its text.
  const call=fetchCalls.filter(f=>String(f.url).includes('chat/completions')).pop();
  const sent=JSON.parse(call.opts.body);
  chk(sent.reasoning && sent.reasoning.enabled===false, 'OpenRouter calls opt out of reasoning spend');
  aiResponse={usage:{}, choices:[{message:{content:'', reasoning:'PICK: A. The targets decide it.'}}]};
  const t1=await app.tcAiCall([{role:'user',content:'u'}]);
  chk(t1.includes('targets decide'), 'a reasoning-only reply still surfaces its text');
  // Budget entirely consumed thinking: the error explains and redirects.
  aiResponse={usage:{}, choices:[{message:{content:''}, finish_reason:'length'}]};
  let m1=''; try{ await app.tcAiCall([{role:'user',content:'u'}]); }catch(e){ m1=e.message; }
  chk(/thinks out loud/.test(m1) && /free list/.test(m1),
      'an all-reasoning burn is explained, with the way out');
  // Free tiers report failures INSIDE a 200 body.
  aiResponse={error:{message:'Rate limit exceeded: free-models-per-day'}};
  let m2=''; try{ await app.tcAiCall([{role:'user',content:'u'}]); }catch(e){ m2=e.message; }
  chk(/Rate limit exceeded/.test(m2), 'an error hidden in a 200 body surfaces as itself');
  // And a custom endpoint never gets the OpenRouter-only parameter.
  app.tcAiSaveSettings({endpoint:'https://my-proxy.example/v1/chat/completions'});
  aiResponse=null;
  await app.tcAiCall([{role:'user',content:'u'}]);
  const custom=JSON.parse(fetchCalls[fetchCalls.length-1].opts.body);
  chk(!('reasoning' in custom), 'non-OpenRouter endpoints are not sent the vendor param');
  app.tcAiSaveSettings({endpoint:'https://openrouter.ai/api/v1/chat/completions'});
})();

console.log('=== preference layer + device-aware default ===');
await (async()=>{
  global.MODELS_SET=BENCH_MODELS;
  const list=await app.tcAiFreeModels(true);
  // The benchmark winner leads the live list, niche/finance model sinks.
  chk(/dots-3-note/.test(list[0]), 'the fastest benchmarked model heads the list');
  chk(list.indexOf('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free') < list.indexOf('inclusionai/ling-3.0-flash-fin:free'),
      'the grounded model outranks the finance-tuned one');
  // Mobile default = fastest; desktop default = most grounded — from the SAME list.
  global.navigator={userAgentData:{mobile:true}};
  chk(/dots-3-note/.test(app.tcAiDefaultModel(list)), 'on mobile the default is the fastest model');
  global.navigator={userAgentData:{mobile:false}};
  chk(/nano-omni/.test(app.tcAiDefaultModel(list)), 'on desktop the default is the most grounded');
  // Rotation resilience: the favourite gone, the default falls to the next pref.
  const without=list.filter(m=>!/dots-3-note/.test(m));
  chk(/nano-omni/.test(app.tcAiDefaultModel(without)), 'a rotated-out favourite yields to the next preference, not a crash');
  chk(app.tcAiDefaultModel([])!=='', 'an empty list still yields a static fallback');
  delete global.MODELS_SET; delete global.navigator; LSTORE.delete('tc_ai_free_models');
})();

console.log('=== 429 is weather, not a wall ===');
await (async()=>{
  aiHttp={status:429, retryAfter:'38'};
  let m=''; try{ await app.tcAiCall([{role:'user',content:'u'}]); }catch(e){ m=e.message; }
  chk(/FREE pool is busy/.test(m) && /daily free cap/.test(m), 'a 429 is interpreted, not parroted');
  chk(/~38s/.test(m), "the provider's own retry timing rides along when offered");
  aiHttp={status:429, retryAfter:null};
  m=''; try{ await app.tcAiCall([{role:'user',content:'u'}]); }catch(e){ m=e.message; }
  chk(/answers immediately/.test(m) && !/~\d+s/.test(m), 'and is omitted when absent');
  aiHttp=null;
  const h=app.tcAiErrorHint('HTTP 429 — Provider returned error — the FREE pool is busy');
  chk(h && /comes back on its own/.test(h.hint), 'the hint layer offers the road to another free model');
  chk(app.tcAiErrorHint('network dropped mid-download')===null,
      'but an unrelated failure earns no model-hopping hint');
})();

console.log('=== the free list is LIVE, not remembered ===');
await (async()=>{
  const before=fetchCalls.filter(f=>String(f.url).includes('/models')).length;
  const list=await app.tcAiFreeModels(true);
  chk(list.length===2 && list.includes('alpha/one:free') && list.includes('gamma/three:free'),
      'only fully-$0 models qualify');
  // The DEFAULT (list head) must be a general chat model, not a niche id.
  MODELS.data.push({id:'zeta/qwen-chat-9b:free', pricing:{prompt:'0',completion:'0'}});
  const l2=await app.tcAiFreeModels(true);
  chk(l2[0]==='zeta/qwen-chat-9b:free', 'a general chat model heads the list over niche ids');
  MODELS.data.pop();
  chk(!list.includes('delta/promo'), 'a model with any paid leg is not free');
  const call=fetchCalls.filter(f=>String(f.url).includes('/models')).pop();
  chk(!call.opts || !call.opts.headers || !call.opts.headers.Authorization,
      'the public index is fetched WITHOUT the key');
  const preCached=fetchCalls.filter(f=>String(f.url).includes('/models')).length;
  await app.tcAiFreeModels();
  const after=fetchCalls.filter(f=>String(f.url).includes('/models')).length;
  chk(after===preCached, 'a fresh list is cached — the second ask costs no request');
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
  const mk=(buffers,f16,maxBufMB)=>({ requestAdapter:async()=>({
    limits:{maxStorageBuffersPerShaderStage:buffers,
            maxBufferSize:(maxBufMB||4096)*1048576},
    features:{has:(k)=>f16&&k==='shader-f16'} }) });
  // Android field report: a capable-LOOKING mobile GPU still gets no local
  // plan — the weights crash the tab, and a crash can only be prevented.
  app.resetProbe();
  global.navigator={gpu:mk(12,true), userAgentData:{mobile:true}};
  let plan=app.tcAiLocalPlan(await app.tcAiGpuProbe());
  chk(plan.model===null && /crashes the tab/.test(plan.note),
      'mobile gets no local build, with the reason stated');
  chk(/built-in model|free-tier key/.test(plan.note),
      'and is pointed at the paths that DO work on a phone');
  // A desktop GPU that can't address the weights: same verdict, its own numbers.
  app.resetProbe(); global.navigator={gpu:mk(12,true,512)};
  plan=app.tcAiLocalPlan(await app.tcAiGpuProbe());
  chk(plan.model===null && /512 MB/.test(plan.note),
      'a 512MB-buffer GPU is refused before downloading weights it cannot hold');
  // Vivaldi-on-Android field report: masked UA, no userAgentData.mobile, no
  // "Mobile" token — but the primary pointer is coarse. Hardware outs it.
  app.resetProbe();
  global.navigator={gpu:mk(12,true), userAgent:'Mozilla/5.0 (X11; Linux x86_64) Chrome/140'};
  const oldMM=global.window.matchMedia;
  global.window.matchMedia=(q)=>({matches:/pointer:\s*coarse/.test(q)});
  plan=app.tcAiLocalPlan(await app.tcAiGpuProbe());
  chk(plan.model===null && /crashes the tab/.test(plan.note),
      'a UA-masked phone is still caught by its coarse pointer');
  global.window.matchMedia=oldMM;
  // A healthy desktop GPU: the 3B fits and the card says so.
  app.resetProbe(); global.navigator={gpu:mk(10,true)};
  plan=app.tcAiLocalPlan(await app.tcAiGpuProbe());
  chk(plan.model && plan.model.includes('3B'), 'a 10-buffer f16 GPU is offered the 3B');
  chk(/3B build/.test(plan.note), 'and told so in one line');
  // The Firefox field report: 9 buffers — and the 1B failed there too, so the
  // requirement is the RUNTIME's. Below 10, local is off the table, pre-download.
  app.resetProbe(); global.navigator={gpu:mk(9,true)};
  plan=app.tcAiLocalPlan(await app.tcAiGpuProbe());
  chk(plan.model===null, 'a 9-buffer GPU gets NO local build — the runtime needs 10, whatever the model');
  chk(/allows 9 .*needs 10/.test(plan.note) && /Firefox/.test(plan.note),
      'and the note names the numbers and the usual culprit');
  // No f16 support also rules the 3B out, whatever the buffer count.
  app.resetProbe(); global.navigator={gpu:mk(12,false)};
  plan=app.tcAiLocalPlan(await app.tcAiGpuProbe());
  chk(plan.model && plan.model.includes('1B'), 'missing shader-f16 also rules out the 3B');
  // Well below the bar: same verdict, same honesty.
  app.resetProbe(); global.navigator={gpu:mk(6,false)};
  plan=app.tcAiLocalPlan(await app.tcAiGpuProbe());
  chk(plan.model===null && /allows 6/.test(plan.note),
      'a too-small GPU gets a plain no, with its own numbers');
  // No WebGPU at all.
  app.resetProbe(); delete global.navigator;
  plan=app.tcAiLocalPlan(await app.tcAiGpuProbe());
  chk(plan.model===null, 'no WebGPU, no local plan');
  // And the init path USES the plan: a no-f16 12-buffer GPU starts at the 1B —
  // the 3B's f16 shaders never download.
  app.resetProbe(); global.navigator={gpu:mk(12,false)};
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
  // The give-up-mid-upload class: terminal, plain-language, no ladder step.
  app.resetLocal(); LSTORE.delete('tc_ai_local_model');
  let tried3=[];
  app.setWebLlmLoader(async()=>({ CreateMLCEngine: async(model)=>{
    tried3.push(model);
    throw new Error("Failed to execute 'mapAsync' on 'GPUBuffer': Buffer was unmapped before mapping was resolved.");
  }}));
  let fatalMsg='';
  try{ await app.tcAiGenerate([{role:'user',content:'u'}]); }catch(e){ fatalMsg=e.message; }
  chk(tried3.length===1, 'a GPU give-up is terminal — no pointless second download');
  chk(/gave up while loading/.test(fatalMsg) && /built-in model|free-tier key/.test(fatalMsg),
      'and the message is the verdict plus the working paths, not raw WebGPU internals');
  delete global.navigator;
  app.tcAiSaveSettings({mode:'', key:'sk-test'});
})();

console.log('=== copy for any AI: the packet leaves, no token is spent ===');
await (async()=>{
  const before=app.tcAiUsage().calls||0, beforeFetch=fetchCalls.length;
  const txt=app.tcAiPacketText(pa,pb,'Flex this week?');
  chk(txt.includes('Alpha Back') && txt.includes('Beta Back'), 'the packet carries both sheets');
  chk(/PICK:/.test(txt) && /FLIP IF/.test(txt), 'and the analyst framing, so the pasted-into model answers in shape');
  chk(/COMPUTED HEAD-TO-HEAD/.test(txt) && /Question: Flex this week\?/.test(txt), 'computed deltas and the question travel too');
  chk(/TripleCrown/.test(txt), 'signed as the app\'s data');
  app.tcAiSaveSettings({mode:'paste'});
  chk(app.tcAiMode()==='paste', 'paste is an engine of its own — always available, needs nothing');
  let threw=null; try{ await app.tcAiGenerate([{role:'user',content:'u'}]); }catch(e){ threw=e.message; }
  chk(/paste/i.test(threw||''), 'and never calls a model');
  app.setCmp(pa,pb); app.renderAiCompare();
  const body=global.document.getElementById('aiCmpBody').innerHTML;
  chk(/id="aiCopyBtn"/.test(body) && !/id="aiAskBtn"/.test(body), 'in paste mode Copy is the main button, there is no Ask');
  chk(/\$0 here/.test(body), 'labelled as free');
  let written=null; global.navigator={clipboard:{writeText:(t)=>{written=t;return Promise.resolve();}}};
  const ok=await app.tcAiCopyPacket();
  chk(ok && written===app.tcAiPacketText(pa,pb), 'copy writes the exact packet to the clipboard');
  chk(/Copied/.test(global.document.getElementById('aiCopyBtn').textContent), 'button confirms');
  chk((app.tcAiUsage().calls||0)===before && fetchCalls.length===beforeFetch, 'no call counted, no fetch made');
  global.navigator={clipboard:{writeText:()=>Promise.reject(new Error('denied'))}};
  global.document.getElementById('aiCmpOut').innerHTML='';
  const ok2=await app.tcAiCopyPacket();
  chk(!ok2 && /<textarea class="ai-cmp-paste"/.test(global.document.getElementById('aiCmpOut').innerHTML),
      'when the clipboard is refused the text is shown for a manual copy');
  delete global.navigator;
  app.tcAiSaveSettings({mode:'key', key:'sk-test'}); app.renderAiCompare();
  const body2=global.document.getElementById('aiCmpBody').innerHTML;
  chk(/id="aiAskBtn"/.test(body2) && /id="aiCopyBtn"/.test(body2), 'with a model configured, Ask leads and copy sits beside it');
  app.tcAiSaveSettings({mode:'', key:'sk-test'}); app.setCmp(null,null);
})();

console.log('=== output is untrusted text ===');
const html=app.tcAiRenderText('Take A.\n\nHe has <script>alert(1)</script> upside.');
chk(!html.includes('<script>'), 'markup in model output is escaped');
chk(html.includes('&lt;script&gt;'), 'visibly, not silently dropped');
chk(html.split('<p>').length===3, 'paragraphs survive');

console.log(`\n${pass}/${total} checks passed`);
process.exit(pass===total?0:1);
})();
