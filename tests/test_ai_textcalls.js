// Models that write their tool calls as TEXT (field report: a free model answered
// "<dots_function_call><invoke name="seed_get">…" and the raw call reached the
// bubble). Pinned: the text-call parser, the final-request reserve (the last
// request of a send is always an answer, tools off), and the render strip.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};
const fetchCalls=[];
let replies=[];
// Only chat completions consume scripted replies; the model-list GET and friends get an empty 200.
const isChat=(opts)=>!!(opts && opts.body && /"messages"/.test(String(opts.body)));
global.fetch=async(url,opts)=>{ if(!isChat(opts)) return {ok:true,status:200,headers:{get:()=>null},json:async()=>({data:[]})}; fetchCalls.push({url,opts}); const r=replies.shift()||{content:'PICK: nobody.'}; return {ok:true,status:200,headers:{get:()=>null},json:async()=>({choices:[{message:r,finish_reason:'stop'}],usage:{total_tokens:10}})}; };
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  tcMcpTools=async()=>[{name:'seed_get',description:'x',inputSchema:{type:'object',properties:{path:{type:'string'}}}}];
  const toolCalls=[];
  tcMcpCallTool=async(name,args)=>{ toolCalls.push({name,args}); return 'RESULT for '+name+' '+JSON.stringify(args); };
  tcAiSaveSettings({mode:'key', key:'sk-test', tools:true, model:'m'});
  return { parse:_aiParseLookup, call:tcAiCall, render:tcAiRenderText, strip:tcAiStripCalls, toolCalls, lookups:()=>_aiLastLookups.slice(), MAX:TC_AI_MAX_TOOL_ROUNDS };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== the text-call parser ===');
const xml='<dots_function_call>\n<invoke name="seed_get">\n<parameter name="path">\nnflverse/2026/team\n</parameter>\n<parameter name="keys">\n["NE", "SEA"]\n</parameter>\n</invoke>\n</dots_function_call>';
let p=app.parse(xml);
chk(p && p.name==='seed_get' && p.args.path==='nflverse/2026/team' && Array.isArray(p.args.keys) && p.args.keys[1]==='SEA', 'the <invoke> form parses, JSON parameters decoded');
p=app.parse('Let me check. {"lookup":"player_data","args":{"name":"JSN"}}');
chk(p && p.name==='player_data' && p.args.name==='JSN', 'the {"lookup":…} form still parses');
p=app.parse('<function=seed_get>{"path":"state"}</function>');
chk(p && p.name==='seed_get' && p.args.path==='state', 'the <function=…> form parses');
p=app.parse('```json\n{"name":"seed_get","arguments":{"path":"state"}}\n```');
chk(p && p.name==='seed_get' && p.args.path==='state', 'a fenced {"name","arguments"} call parses');
chk(app.parse('PICK: Stevenson. WHY: 18 carries.')===null, 'an answer is not a call');

console.log('=== a text call runs like a real one, and the last request is always an answer ===');
(async()=>{
  fetchCalls.length=0; app.toolCalls.length=0;
  replies=[{content:xml}, {content:xml}, {content:xml}, {content:xml}, {content:'PICK: Maye. WHY: 33 attempts.'}];
  const out=await app.call([{role:'system',content:'sys'},{role:'user',content:'q'}]);
  chk(app.toolCalls.length===app.MAX-0 || app.toolCalls.length===app.MAX-1, `text calls were executed (${app.toolCalls.length} lookups)`);
  chk(app.lookups().length===app.toolCalls.length, 'each one is named under the answer');
  chk(fetchCalls.length<=1+app.MAX, `the send stayed within ≤${1+app.MAX} requests (${fetchCalls.length})`);
  const lastBody=JSON.parse(fetchCalls[fetchCalls.length-1].opts.body);
  chk(!lastBody.tools, 'the final request carries no tools — it must answer');
  chk(/no more lookups/i.test(JSON.stringify(lastBody.messages)), 'and says so');
  chk(!/<invoke|function_call/.test(out), `what comes back is an answer, not a call (${JSON.stringify(out).slice(0,40)})`);

  console.log('=== the render strip (belt and braces) ===');
  chk(/^Here you go\.\s+PICK: Maye\.$/.test(app.strip('Here you go.\n'+xml+'\nPICK: Maye.')), 'a stray call block is removed from the text');
  const html=app.render(xml);
  chk(!/invoke|function_call/.test(html) && /more data than one send allows/.test(html), 'a bubble that was ONLY a call renders a plain note instead');
  chk(/<b>PICK<\/b>/.test(app.render('**PICK**: Maye')), 'markdown still renders');

  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
