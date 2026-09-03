// ── Ask TripleCrown — the in-app chat, guided ────────────────────────────────
// The ⚖ compare generalized to a conversation: same engines (browser AI, local
// model, your key — tcAiGenerate decides), same grounding stance (the app's
// numbers are the truth; the model judges), same free-first bounds (one send =
// one request, or ≤1+TC_AI_MAX_TOOL_ROUNDS with Research on; nothing retries,
// every request is counted). The guided experience is five workflow chips — the
// same five workflows the MCP connector ships as prompts (tools/mcp_worker/
// prompts.js), worded for a model that gets the app's numbers by Research loop
// rather than by discovering MCP tools. Change a workflow there, mirror it here.

const TC_CHAT_GUIDES=[
  {k:'start_sit', label:'Start / Sit', fill:'Who do I start: ',
   coach:'This is a start/sit call. Verdict first — who starts and how confident — then the two or three numbers that decided it (projection, matchup, usage).'},
  {k:'draft_pick', label:'Draft pick', fill:'I’m on the clock. Considering: ',
   coach:'This is a draft-pick call. Weigh best value against positional need and ADP (who likely survives to the next pick). Verdict first: the pick, then the case.'},
  {k:'trade_eval', label:'Trade eval', fill:'Evaluate this trade. I give: … I get: ',
   coach:'This is a trade evaluation. Price each player (projection, VOR, rank; in dynasty, age and contract count as much as this season), sum both sides, name the winner and by how much, and say what would flip it.'},
  {k:'waiver_scan', label:'Waiver scan', fill:'Scan waivers. My roster: ',
   coach:'This is a waiver scan. Recommend at most three moves — add who, drop who, and the numbers that justify each — or say the wire beats nobody they have.'},
  {k:'player_deep_dive', label:'Player deep dive', fill:'Give me the full picture on ',
   coach:'This is a player deep dive: role and usage now, what the underlying data says, then the fantasy read — what they are right now and the one thing that would change it.'},
];
const TC_CHAT_KEEP=12;   // conversation turns per request (plus the system message)

let _chat={ msgs:[], guide:null, draft:'', busy:false };

// The wire messages: one system line that knows the league and the chosen
// workflow, then the last TC_CHAT_KEEP turns (failed turns never ride again).
function tcChatMessages(){
  const fmt=(typeof formatLabel==='function' && typeof rankFormat!=='undefined')?formatLabel(rankFormat):'';
  const shape=(typeof draftLineup!=='undefined' && draftLineup && draftLineup.length)?draftLineup.join('/'):'';
  const g=_chat.guide?TC_CHAT_GUIDES.find(x=>x.k===_chat.guide):null;
  const sys='You are TripleCrown’s fantasy football assistant, inside the app.'
    +(fmt?` League: ${fmt}${shape?` · lineup ${shape}`:''}.`:'')
    +' The app’s own numbers are the ground truth — cite the ones you use, never invent a stat.'
    +' Be concise: verdict first, then the case.'
    +' The user’s roster and league are private to them — ask when the answer depends on them.'
    +(g?' '+g.coach:'');
  return [{role:'system',content:sys},
          ..._chat.msgs.filter(m=>!m.error).slice(-TC_CHAT_KEEP).map(m=>({role:m.role,content:m.content}))];
}

function openTcChat(){
  const old=document.getElementById('tcChatOverlay'); if(old) old.remove();
  const ov=document.createElement('div');
  ov.id='tcChatOverlay'; ov.className='ps-overlay';
  ov.innerHTML=`<div class="ps-modal tc-chat" role="dialog" aria-label="Ask TripleCrown">
    <div class="ps-head"><span class="ai-cmp-title">${TC_ICON('chat')} Ask TripleCrown ${(typeof tcInfoBtn==='function')?tcInfoBtn('tcchat','About the chat'):''}</span>
      <button class="ps-close" onclick="document.getElementById('tcChatOverlay').remove()" aria-label="Close">${TC_ICON('close')}</button></div>
    <div id="tcChatBody" class="ai-cmp-body tc-chat-body"></div>
  </div>`;
  ov.addEventListener('mousedown', e=>{ if(e.target===ov) ov.remove(); });
  document.body.appendChild(ov);
  tcChatRender();
}

function _chatGuide(k){
  const g=TC_CHAT_GUIDES.find(x=>x.k===k); if(!g) return;
  _chat.guide=k; _chat.draft=g.fill;
  tcChatRender();
  const inp=document.getElementById('tcChatIn');
  if(inp){ inp.focus(); try{ inp.setSelectionRange(inp.value.length, inp.value.length); }catch(e){} }
}

function tcChatRender(){
  const body=document.getElementById('tcChatBody'); if(!body) return;
  if(tcAiMode()===null || _aiCfgOpen){ tcAiRenderSetup(body,'tcChatRender'); return; }
  const mode=tcAiMode();
  if(mode==='paste'){
    body.innerHTML=`<div class="tc-chat-hello"><div class="tc-chat-sub">Chat needs a model running in the app —
      the browser’s built-in AI, a local model, or your own key. Paste mode has no model here
      (for that, copy a packet from the ⚖ compare).</div>
      <button class="btn-accent tc-chat-send" onclick="_aiCfgOpen=true;tcChatRender()">Choose how the model runs</button></div>`;
    return;
  }
  const s=tcAiSettings(), u=tcAiUsage();
  const usage=`${u.calls||0} calls · ${(u.prompt||0)+(u.completion||0)} tokens total, this browser`;
  const lookups= mode==='key' && s.tools && typeof tcMcpTools==='function';
  const cost= mode==='key'
    ? `${lookups?`≤${1+TC_AI_MAX_TOOL_ROUNDS} requests`:'1 request'} per send · your key`
    : 'runs on this device · $0';
  const sw= mode==='key' ? `<div class="ai-cmp-tgls tc-chat-tgls">
      <button class="ai-cmp-sw ${s.reasoning?'on':''}" title="Lets a reasoning model think before it answers — deeper, several times slower, and it costs more of a free tier's daily budget."
        onclick="tcAiSaveSettings({reasoning:${s.reasoning?'false':'true'}});tcChatRender()">Reasoning <span class="ai-cmp-sw-sub">slower · deeper</span></button>
      ${(typeof tcMcpTools==='function')?`<button class="ai-cmp-sw ${s.tools?'on':''}" title="Lets the model call TripleCrown's own tools mid-answer (route trees, splits, weekly EPA, college logs) instead of guessing. Up to ${TC_AI_MAX_TOOL_ROUNDS} extra requests per send, each named under the answer. Needs a model marked “tools”."
        onclick="tcAiSaveSettings({tools:${s.tools?'false':'true'}});tcChatRender()">Research <span class="ai-cmp-sw-sub">deeper · more requests</span></button>`:''}</div>` : '';
  const bub=(m)=> m.role==='user'
    ? `<div class="tc-chat-msg me"><div class="tc-chat-bub">${escHtml(m.content)}</div></div>`
    : m.error
      ? `<div class="tc-chat-msg"><div class="tc-chat-bub err">${escHtml(m.content)}${m.hint?`<div class="tc-chat-hint">${escHtml(m.hint)}</div>`:''}</div></div>`
      : `<div class="tc-chat-msg"><div class="tc-chat-bub">${tcAiRenderText(m.content)}${(m.lookups&&m.lookups.length)?`<div class="tc-chat-lk">Looked up: ${m.lookups.map(escHtml).join(' · ')}</div>`:''}</div></div>`;
  const hello=!_chat.msgs.length?`<div class="tc-chat-hello">
      <div class="tc-chat-guides">${TC_CHAT_GUIDES.map(g=>`<button class="tc-chat-guide ${_chat.guide===g.k?'on':''}" onclick="_chatGuide('${g.k}')">${escHtml(g.label)}</button>`).join('')}</div>
      <div class="tc-chat-sub">Grounded in the app’s numbers — pick a play or just ask.${lookups?'':' Research (with a key) lets it look things up.'}</div>
    </div>`:'';
  body.innerHTML=`
    <div id="tcChatLog" class="tc-chat-log">${hello||_chat.msgs.map(bub).join('')}
      ${_chat.busy?`<div class="tc-chat-msg"><div class="tc-chat-bub wait" id="tcChatWait">…</div></div>`:''}</div>
    ${sw}
    <div class="tc-chat-inrow">
      <input id="tcChatIn" class="ai-cmp-in tc-chat-in" placeholder="Ask about any player, pick or matchup…"
        value="${escAttr(_chat.draft)}" ${_chat.busy?'disabled':''} autocomplete="off">
      <button class="btn-accent tc-chat-send" onclick="_chatSend()" ${_chat.busy?'disabled':''}>Ask</button></div>
    <div class="ai-cmp-foot"><span>${cost} · ${usage}</span>
      <a href="#" onclick="_aiCfgOpen=true;tcChatRender();return false">key & model…</a></div>`;
  const inp=document.getElementById('tcChatIn');
  if(inp){
    inp.addEventListener('input', ()=>{ _chat.draft=inp.value; });
    inp.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); _chatSend(); } });
  }
  const log=document.getElementById('tcChatLog');
  if(log) log.scrollTop=log.scrollHeight;
}

// One send. The model call is tcAiGenerate — whatever engine, whatever bounds
// the settings say; a failure becomes a red bubble with the usual hint and is
// never resent on the next turn.
async function _chatSend(){
  if(_chat.busy) return;
  const inp=document.getElementById('tcChatIn');
  const q=((inp&&inp.value)||_chat.draft||'').trim(); if(!q) return;
  _chat.draft='';
  _chat.msgs.push({role:'user', content:q});
  _chat.busy=true; tcChatRender();
  try{
    const txt=await tcAiGenerate(tcChatMessages(), p=>{
      const w=document.getElementById('tcChatWait');
      if(w) w.textContent=(p && p.lookup)?`Looking up ${p.lookup}…`:(typeof p==='string'&&p?p:'…');
    });
    _chat.msgs.push({role:'assistant', content:String(txt),
      lookups:(typeof _aiLastLookups!=='undefined' && _aiLastLookups)?_aiLastLookups.slice():[]});
  }catch(e){
    const msg=String(e&&e.message||e);
    const h=(typeof tcAiErrorHint==='function')?tcAiErrorHint(msg):null;
    _chat.msgs.push({role:'assistant', error:true, content:msg, hint:(h&&h.hint)||''});
  }
  _chat.busy=false; tcChatRender();
}

if(typeof TC_INFO_BOOK!=='undefined'){
  TC_INFO_BOOK['tcchat']={title:'Ask TripleCrown', body:`
    A chat over the app’s own numbers, on the same engine the ⚖ compare uses — the browser’s
    built-in AI, a local model on your GPU, or your own key with a free model (change it any time
    under <i>key & model…</i>). <b>The guide chips</b> are ready-made plays — start/sit, draft pick,
    trade eval, waiver scan, deep dive — each one teaches the model that job’s shape before your
    words arrive; the same five ship as prompts on the Claude connector (☰ → Ask in Claude).
    <b>Free-first, as always:</b> one send is one request — with <b>Research</b> on (key mode), at
    most ${1+TC_AI_MAX_TOOL_ROUNDS}, every one counted in the footer and every lookup named under
    the answer. Only the last ${TC_CHAT_KEEP} turns ride each request, so long chats don’t quietly
    grow the bill. Your roster and league never leave this browser unless you type them into the
    conversation — the app’s public data is all the model can look up on its own.`};
}
