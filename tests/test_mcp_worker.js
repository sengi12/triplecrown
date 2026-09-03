// The Cloudflare Worker (tools/mcp_worker/worker.js) against a real bake of the seed.
// Bakes into a temp dir with tools/tc_mcp.py --bake, then serves those files to the worker
// through a stubbed fetch — the same shape GitHub Pages gives it, minus the network.
//
//   node tests/test_mcp_worker.js
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');

let pass = 0, total = 0;
function chk(ok, msg){ total++; if(ok) pass++; console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${msg}`); }

const ROOT = path.join(__dirname, '..');
const seedThere = fs.existsSync(path.join(ROOT, 'seeds', 'triplecrown_seed.json')) || fs.existsSync(path.join(ROOT, 'seeds', 'triplecrown_seed.json.gz'));
if(!seedThere){ console.log('SKIP: no seed to bake'); process.exit(0); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-mcp-'));
execFileSync('python3', [path.join(ROOT, 'tools', 'tc_mcp.py'), '--bake', dir], { stdio: ['ignore', 'ignore', 'inherit'] });

// Pages, minus the network: every fetch reads the baked file.
let fetches = 0;
globalThis.fetch = async (url) => {
  fetches++;
  const rel = decodeURIComponent(new URL(url).pathname.replace(/^\/mcp\//, ''));
  const f = path.join(dir, rel);
  if(!fs.existsSync(f)) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')) };
};

(async () => {
  const w = await import(path.join(ROOT, 'tools', 'mcp_worker', 'worker.js'));
  const env = { TC_DATA: 'https://pages.test/mcp' };
  const post = async (body, p = '/mcp') => {
    const res = await w.default.fetch(new Request('https://tc.test' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);
    return { status: res.status, body: res.status === 202 ? null : await res.json(), headers: res.headers };
  };
  const call = async (name, args, p) => (await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, p)).body.result;

  console.log('=== the bake: small shards, one per answer ===');
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  chk(man.tools.length === 8 && man.frame.startsWith('How to answer'), 'manifest carries the tool list and the analyst frame — the Python stays the source');
  chk(['half_ppr', 'ppr', 'std', 'superflex'].every(f => fs.existsSync(path.join(dir, f, 'index.json'))), 'every format is baked');
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'ppr', 'index.json'), 'utf8'));
  chk(idx.length > 300 && idx.every(r => r.id && r.k && r.line), 'the index is the search table: id, norm key, one line per player');
  const big = Math.max(...['manifest.json', 'ppr/index.json', 'sos.json'].map(f => fs.statSync(path.join(dir, f)).size));
  chk(big < 400_000, `no shard the worker reads per call is heavy (largest ${(big / 1024).toFixed(0)} KB)`);
  const gibbs = idx.find(r => r.k === 'jahmyrgibbs');
  chk(!!gibbs, 'Gibbs is on the board');
  const pf = JSON.parse(fs.readFileSync(path.join(dir, 'p', gibbs.id + '.json'), 'utf8')).by.superflex;
  chk(/board: projected \d+ pts/.test(pf.sheet) && pf.f.vor != null && pf.f.pts > 100, 'a player shard is the sheet plus the compare facts, per format');
  const nfiles = execFileSync('find', [dir, '-type', 'f'], { encoding: 'utf8' }).trim().split('\n').length;
  chk(nfiles < 1000, `a deploy ships ${nfiles} shards, not thousands`);

  console.log('=== protocol over HTTP ===');
  const init = await post({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't' } } });
  chk(init.status === 200 && init.body.result.protocolVersion === '2025-03-26' && init.body.result.serverInfo.name === 'triplecrown', 'initialize negotiates the client\'s version');
  const init2 = await post({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  chk(init2.body.result.protocolVersion === '2024-11-05', 'unknown version → oldest supported');
  const note = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  chk(note.status === 202, 'a notification is accepted with no body');
  const tl = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  chk(tl.body.result.tools.map(t => t.name).join() === 'state,search_players,get_player,compare,rankings,team,schedule,sos', 'tools/list is the Python list, verbatim');
  const nf = await post({ jsonrpc: '2.0', id: 3, method: 'nope' });
  chk(nf.body.error.code === -32601, 'unknown method → -32601');
  const ut = await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } });
  chk(ut.body.error.code === -32602, 'unknown tool → -32602');
  const bad = await w.default.fetch(new Request('https://tc.test/mcp', { method: 'POST', body: '{not json' }), env);
  chk(bad.status === 400 && (await bad.json()).error.code === -32700, 'garbage → parse error');
  const batch = await post([{ jsonrpc: '2.0', id: 5, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/x' }, { jsonrpc: '2.0', id: 6, method: 'prompts/list' }]);
  chk(Array.isArray(batch.body) && batch.body.length === 2 && batch.body[1].result.prompts.length === 0, 'a batch answers each request, skips notifications');
  const get = await w.default.fetch(new Request('https://tc.test/mcp'), env);
  chk(get.status === 405, 'GET is 405: no server stream, nothing to subscribe to');
  const opt = await w.default.fetch(new Request('https://tc.test/mcp', { method: 'OPTIONS' }), env);
  chk(opt.status === 204 && opt.headers.get('access-control-allow-origin') === '*', 'CORS preflight for browser clients');
  const home = await w.default.fetch(new Request('https://tc.test/'), env);
  chk(home.status === 200 && /claude mcp add/.test(await home.text()), 'the landing page says how to connect');
  const rr = await post({ jsonrpc: '2.0', id: 7, method: 'resources/read', params: { uri: 'triplecrown://state' } });
  chk(/TripleCrown seed: season/.test(rr.body.result.contents[0].text), 'the state resource reads');

  console.log('=== tools: the same answers as the stdio server ===');
  const py = (args, fmt = 'ppr') => execFileSync('python3', [path.join(ROOT, 'tools', 'tc_mcp.py'), '--format', fmt, '--call', ...args], { encoding: 'utf8' }).trimEnd();
  chk((await call('state', {})).content[0].text === py(['state']), 'state matches');
  chk((await call('get_player', { name: 'Jahmyr Gibbs' })).content[0].text === py(['get_player', 'name=Jahmyr Gibbs']), 'get_player matches, byte for byte');
  chk((await call('get_player', { name: 'jamyr gibs' })).content[0].text.startsWith('Jahmyr Gibbs'), 'and forgives a misspelling');
  chk((await call('get_player', { name: 'Jahmyr Gibbs' }, '/superflex/mcp')).content[0].text === py(['get_player', 'name=Jahmyr Gibbs'], 'superflex'), 'the path picks the format');
  chk((await call('search_players', { query: 'gibbs', limit: 3 })).content[0].text === py(['search_players', 'query=gibbs', 'limit=3']), 'search matches');
  const cmp = (await call('compare', { a: 'Jahmyr Gibbs', b: 'Bijan Robinson', question: 'Q?' })).content[0].text;
  chk(cmp === py(['compare', 'a=Jahmyr Gibbs', 'b=Bijan Robinson', 'question=Q?']), 'compare matches — deltas ported exactly');
  chk(/COMPUTED HEAD-TO-HEAD DIFFERENCES\n- board value/.test(cmp), 'with the head-to-head lines');
  chk((await call('compare', { a: 'Jahmyr Gibbs', b: 'Nobody Realname' })).content[0].text.startsWith('No player matches "Nobody Realname"'), 'a missing side is named');
  chk((await call('rankings', { pos: 'RB', limit: 10, sort: 'adp' })).content[0].text === py(['rankings', 'pos=RB', 'limit=10', 'sort=adp']), 'rankings match');
  chk(/unknown sort/.test((await call('rankings', { sort: 'zzz' })).content[0].text), 'bad sort is told');
  chk((await call('team', { team: 'DET' })).content[0].text === py(['team', 'team=DET']), 'team matches');
  chk((await call('team', { team: 'lions' })).content[0].text === py(['team', 'team=lions']), 'by name too');
  chk((await call('schedule', { team: 'DET', from_week: 10 })).content[0].text === py(['schedule', 'team=DET', 'from_week=10']), 'schedule matches');
  chk((await call('sos', {})).content[0].text === py(['sos']), 'sos matches');
  const miss = await call('team', { team: 'ZZZ' });
  chk(/Unknown team/.test(miss.content[0].text) && miss.isError === false, 'a wrong team is an answer, not an error');

  console.log('=== cost: a handful of cached reads per call ===');
  fetches = 0; await call('compare', { a: 'Jahmyr Gibbs', b: 'Bijan Robinson' });
  chk(fetches <= 5, `compare is ${fetches} data reads (index, two players, meta, manifest)`);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${pass}/${total} checks passed`);
  process.exit(pass === total ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
