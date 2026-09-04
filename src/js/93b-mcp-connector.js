// ── TripleCrown in the Claude app — the remote MCP connector ────────────────
// tools/mcp_worker/ serves TripleCrown's data as MCP tools from a free Cloudflare
// Worker: the curated tools (compare, rankings, team, schedule…) plus the ENTIRE
// seed, raw (seed_ls / seed_get / player_data). Anything that speaks MCP —
// claude.ai, the Claude phone app, Claude Code, Cursor — can add the URL as a
// connector and then ask questions against the app's own numbers.
//
// Two uses in the app:
//   1. Hand the user the URL for THEIR format (☰ → Ask in Claude, and the ⚖ setup).
//   2. Opt-in lookups for the ⚖ compare: with a key, the model may call these
//      same tools mid-answer (route trees, weekly EPA, situational splits…)
//      instead of guessing. Off by default — every lookup is another request
//      against a free tier's daily cap, so the switch says so and counts them.
// The worker is CORS-open and stateless; it reads the public seed Pages already
// serves. Nothing from this browser (rosters, notes, keys) is ever sent to it.

const TC_MCP_BASE = 'https://triplecrown-mcp.sengi.workers.dev';
const TC_MCP_FORMATS = ['half_ppr','ppr','std','superflex','dynasty','dynasty_superflex'];

// The endpoint for a format: /<format>/mcp. A saved https override (self-hosted
// worker) replaces the base; the format still rides on the path.
function tcMcpBase(){
  try{ const s=JSON.parse(localStorage.getItem('tc_ai_settings')||'{}')||{};
       if(typeof s.mcp==='string' && /^https:\/\//.test(s.mcp)) return s.mcp.replace(/\/+$/,''); }catch(e){}
  return TC_MCP_BASE;
}
function tcMcpUrl(fmt){
  const f=TC_MCP_FORMATS.includes(fmt)?fmt:(typeof rankFormat!=='undefined' && TC_MCP_FORMATS.includes(rankFormat)?rankFormat:'half_ppr');
  return `${tcMcpBase()}/${f}/mcp`;
}

// One JSON-RPC call to the worker. Stateless transport: no session, no stream.
async function tcMcpRpc(method, params, fmt){
  const res=await fetch(tcMcpUrl(fmt), { method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ jsonrpc:'2.0', id:1, method, params:params||{} }) });
  if(!res.ok) throw new Error(`TripleCrown connector HTTP ${res.status}`);
  const j=await res.json();
  if(j && j.error) throw new Error(j.error.message||'connector error');
  return j.result;
}
// The tool list, once per session (it only changes when the worker is redeployed).
let _mcpTools=null;
async function tcMcpTools(fmt){
  if(!_mcpTools) _mcpTools=tcMcpRpc('tools/list', {}, fmt).then(r=>(r&&r.tools)||[]).catch(e=>{ _mcpTools=null; throw e; });
  return _mcpTools;
}
// The same list in the OpenAI-compatible shape chat endpoints take.
function tcMcpToOpenAiTools(tools){
  return (tools||[]).map(t=>({ type:'function', function:{
    name:t.name, description:t.description||'',
    parameters:t.inputSchema||{type:'object',properties:{}} } }));
}
// Run one tool; the text the model gets back.
async function tcMcpCallTool(name, args, fmt){
  const r=await tcMcpRpc('tools/call', { name, arguments:args||{} }, fmt);
  const parts=(r&&r.content)||[];
  return parts.map(c=>c&&c.text||'').join('\n') || '(empty)';
}
// "seed_get nflverse/2025/routes/…" — the one-line label for progress and the footer.
function tcMcpCallLabel(name, args){
  const a=args||{};
  const v=a.path||a.name||a.query||a.team||(a.a&&a.b?`${a.a} vs ${a.b}`:'')||a.pos||'';
  return `${name}${v?' '+String(v):''}`.slice(0,80);
}

// ── ☰ Ask in Claude: the URL for your format, copy, and how-to behind ⓘ ─────
let _mcpPickFmt=null;
// The URL the modal is showing: a per-format path, or the bare generic endpoint.
function _mcpShownUrl(){ return _mcpPickFmt==='all' ? `${tcMcpBase()}/mcp` : tcMcpUrl(_mcpPickFmt); }
function openMcpConnector(){
  const old=document.getElementById('mcpOverlay'); if(old) old.remove();
  _mcpPickFmt=(typeof rankFormat!=='undefined' && TC_MCP_FORMATS.includes(rankFormat))?rankFormat:'half_ppr';
  const ov=document.createElement('div');
  ov.id='mcpOverlay'; ov.className='ps-overlay';
  ov.innerHTML=`<div class="ps-modal mcp-modal" role="dialog" aria-label="TripleCrown in Claude">
    <div class="ps-head"><span class="ai-cmp-title">TripleCrown in Claude ${(typeof tcInfoBtn==='function')?tcInfoBtn('mcp','How to connect'):''}</span>
      <button class="ps-close" onclick="document.getElementById('mcpOverlay').remove()" aria-label="Close">${TC_ICON('close')}</button></div>
    <div id="mcpBody" class="ai-cmp-body"></div>
  </div>`;
  ov.addEventListener('mousedown', e=>{ if(e.target===ov) ov.remove(); });
  document.body.appendChild(ov);
  renderMcpConnector();
}
function renderMcpConnector(){
  const body=document.getElementById('mcpBody'); if(!body) return;
  // 'all' is the generic endpoint: one connector, every format — Claude passes the
  // format per question (each tool takes it as an argument; the path just sets a default).
  const url=_mcpShownUrl();
  body.innerHTML=`
    <div class="ai-cmp-lbl">League format</div>
    <div class="mcp-fmts">${TC_MCP_FORMATS.map(f=>`<button class="mcp-fmt ${f===_mcpPickFmt?'on':''}" onclick="_mcpPickFmt='${f}';renderMcpConnector()">${escHtml((typeof formatLabel==='function')?formatLabel(f):f)}</button>`).join('')}<button class="mcp-fmt ${_mcpPickFmt==='all'?'on':''}" onclick="_mcpPickFmt='all';renderMcpConnector()" title="One connector for every format — name your league's format in the question">All formats</button></div>
    <div class="ai-cmp-lbl">Connector URL</div>
    <div class="mcp-urlrow"><input id="mcpUrl" class="ai-cmp-in mcp-url" readonly value="${escAttr(url)}" onclick="this.select()">
      <button id="mcpCopyBtn" class="btn-accent mcp-copy" onclick="tcMcpCopyUrl()">Copy</button></div>
    <div class="mcp-steps">Claude app <i>\u203a</i> Settings <i>\u203a</i> Connectors <i>\u203a</i> <b>Add custom connector</b> <i>\u203a</i> paste</div>
    <div class="mcp-foot">free · public seed only · one connector on Claude's free plan</div>`;
}
async function tcMcpCopyUrl(){
  const url=_mcpShownUrl(), btn=document.getElementById('mcpCopyBtn');
  let ok=false;
  try{ if(typeof navigator!=='undefined' && navigator.clipboard && navigator.clipboard.writeText){ await navigator.clipboard.writeText(url); ok=true; } }catch(e){}
  if(!ok){ try{ const inp=document.getElementById('mcpUrl'); if(inp){ inp.select(); ok=!!(document.execCommand && document.execCommand('copy')); } }catch(e){} }
  if(btn){ btn.textContent= ok ? 'Copied' : 'Select & copy'; setTimeout(()=>{ if(document.getElementById('mcpCopyBtn')) btn.textContent='Copy'; }, 2000); }
  return ok;
}

if(typeof TC_INFO_BOOK!=='undefined'){
  TC_INFO_BOOK['mcp']={title:'TripleCrown in Claude', body:`
    TripleCrown runs a free, always-on <b>MCP connector</b>: the app's data as tools any Claude can
    call — the compare sheet, rankings, team pages, schedules, and the <b>entire seed</b> raw
    (five seasons of advanced stats and situational splits, route trees, passing and rushing charts,
    college logs, contracts, dynasty values, weekly team and line data, coaching formations).
    <b>Pick your league's format</b> — or <b>All formats</b>, one connector that answers for any
    league (every tool takes the format as an argument; name yours in the question) — copy the
    URL, then: <b>claude.ai or the Claude app</b> →
    Settings → Connectors → <i>Add custom connector</i> → paste (the free plan allows one
    custom connector, so pick the format you play). <b>Claude Code</b>:
    <code>claude mcp add --transport http triplecrown &lt;url&gt;</code>. Then ask — “who do I
    start, Gibbs or Bijan?”, “show Amon-Ra's route tree”, “Detroit's weekly EPA” — and
    the answers cite TripleCrown's numbers instead of the model's memory. It is the public seed the
    site already serves: nothing from this browser (your roster, notes, keys) is in it, so paste your
    roster into the chat when the question needs it. Costs nothing, sends nothing, and needs no account
    beyond the Claude you already use.`};
}
