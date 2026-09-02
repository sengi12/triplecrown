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
const ctx=app.tcAiPlayerContext(pa);
chk(ctx.includes('Alpha Back') && ctx.includes('+61'), 'context carries name and VOR');
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

console.log('=== output is untrusted text ===');
const html=app.tcAiRenderText('Take A.\n\nHe has <script>alert(1)</script> upside.');
chk(!html.includes('<script>'), 'markup in model output is escaped');
chk(html.includes('&lt;script&gt;'), 'visibly, not silently dropped');
chk(html.split('<p>').length===3, 'paragraphs survive');

console.log(`\n${pass}/${total} checks passed`);
process.exit(pass===total?0:1);
})();
