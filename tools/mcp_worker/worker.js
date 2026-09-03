// TripleCrown remote MCP server — a Cloudflare Worker with no dependencies and no state.
//
// It serves the same tools as tools/tc_mcp.py, but instead of loading the 8 MB seed it reads
// the small JSON shards that `tools/tc_mcp.py --bake` writes into the Pages site at deploy
// time (…/triplecrown/mcp/). Every tool call is one or two edge-cached fetches plus a few
// microseconds of string work, which is what keeps it inside the Workers free plan (10 ms CPU
// per request) — parsing the whole seed here would not be.
//
// Transport: MCP Streamable HTTP, stateless. POST /mcp with a JSON-RPC message (or batch),
// JSON back. GET /mcp is 405 (no server-initiated stream), DELETE /mcp is 200 (nothing to end).
// Pick the scoring format by path: /mcp (env.TC_FORMAT, default ppr), /ppr/mcp, /half_ppr/mcp,
// /std/mcp, /superflex/mcp.
//
// The data lives on GitHub Pages (env.TC_DATA); this worker never needs redeploying for a new
// seed — the Pages deploy rebakes the shards and the edge cache turns over within TTL.

const FORMATS = ["ppr", "half_ppr", "std", "superflex"];
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const CACHE_TTL = 600;         // seconds; matches Pages' own max-age
const JSON_HDR = { "content-type": "application/json; charset=utf-8" };
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-session-id, mcp-protocol-version, authorization",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};

// ── data access (all edge-cached) ──────────────────────────────────────────────────────────
class Data {
  constructor(base, fmt) { this.base = base.replace(/\/+$/, ""); this.fmt = fmt; this.memo = new Map(); }
  get(rel, optional = false) {
    // Memoise the promise, so two concurrent lookups share one read.
    if (!this.memo.has(rel)) this.memo.set(rel, (async () => {
      const res = await fetch(`${this.base}/${rel}`, { cf: { cacheTtl: CACHE_TTL, cacheEverything: true } });
      if (res.status === 404 && optional) return null;
      if (!res.ok) throw new Error(`data ${res.status} for ${rel}`);
      return res.json();
    })());
    return this.memo.get(rel);
  }
  manifest() { return this.get("manifest.json"); }
  meta() { return this.get(`${this.fmt}/meta.json`); }
  index() { return this.get(`${this.fmt}/index.json`); }
  async player(id) {
    const p = await this.get(`p/${encodeURIComponent(id)}.json`, true);
    const v = p && p.by && p.by[this.fmt];
    return v ? { n: p.n, pos: p.pos, team: p.team, sheet: v.sheet, f: v.f } : null;
  }
  team(code) { return this.get(`${this.fmt}/team/${code}.json`, true); }
  rank(pos, sort) { return this.get(`${this.fmt}/rank/${pos || "all"}.${sort}.json`, true); }
  sched(code) { return this.get(`sched/${code}.json`, true); }
  sos() { return this.get("sos.json"); }
}

// ── lookup: mirror of TripleCrown.find in tc_mcp.py ────────────────────────────────────────
// norm_name from draft_sim.py: lowercase, strip suffixes and everything but letters/digits.
function normName(s) {
  const t = String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  return t.split(/\s+/).filter(p => !["jr", "sr", "ii", "iii", "iv", "v"].includes(p)).join("");
}
function bigrams(s) { const b = new Set(); for (let i = 0; i + 1 < s.length; i++) b.add(s.slice(i, i + 2)); return b; }
function dice(a, b) {
  if (!a.length || !b.length) return 0;
  const A = bigrams(a), B = bigrams(b); let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return (2 * n) / (A.size + B.size);
}
function find(index, query, pos, limit = 8) {
  const q = String(query || "").trim();
  if (!q) return [];
  let hits = index.filter(r => r.id === q);
  const nq = normName(q);
  if (!hits.length) hits = index.filter(r => r.k === nq);
  if (!hits.length && nq) hits = index.filter(r => r.k.includes(nq));
  if (!hits.length && nq) {
    hits = index.map(r => [dice(nq, r.k), r]).filter(([s]) => s >= 0.6)
      .sort((x, y) => y[0] - x[0]).slice(0, limit).map(([, r]) => r);
  }
  if (pos) hits = hits.filter(r => r.pos === String(pos).toUpperCase());
  hits.sort((x, y) => (x.adp ?? 999) - (y.adp ?? 999));
  return hits.slice(0, limit);
}

// ── compare deltas: mirror of TripleCrown.deltas ───────────────────────────────────────────
// Python's round(): half to even, so the numbers here match the stdio server's to the digit.
const r0 = v => { const f = Math.floor(v), d = v - f; return String(d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1)); };
function deltas(a, b) {
  const L = []; let close = false;
  const fa = a.f || {}, fb = b.f || {};
  if (fa.vor != null && fb.vor != null) {
    const d = Math.abs(fa.vor - fb.vor), span = Math.max(Math.abs(fa.vor), Math.abs(fb.vor), 1);
    close = d / span <= 0.15 || d < 8;
    L.push(close ? `board value: EFFECTIVELY TIED (${r0(d)} VOR apart) — the ranks cannot decide this one`
                 : `board value: ${fa.vor > fb.vor ? a.n : b.n} by ${r0(d)} VOR`);
  }
  const gap = (label, x, y, unit = "") => {
    if (x == null || y == null || Math.abs(x - y) < 1e-9) return;
    L.push(`${label}: ${x > y ? a.n : b.n} by ${r0(Math.abs(x - y))}${unit}`);
  };
  gap("projected points", fa.pts, fb.pts, " pts");
  gap("targets", fa.tgt, fb.tgt);
  gap("carries", fa.car, fb.car);
  gap("total TDs", fa.td, fb.td);
  if (fa.adp != null && fb.adp != null && fa.adp < 999 && fb.adp < 999 && r0(fa.adp) !== r0(fb.adp))
    L.push(`market: drafters take ${fa.adp < fb.adp ? a.n : b.n} ${r0(Math.abs(fa.adp - fb.adp))} picks earlier`);
  if (fa.sos && fb.sos && fa.sos !== fb.sos)
    L.push(`easier season schedule: ${fa.sos < fb.sos ? a.n : b.n} (SOS ${fa.sos} vs ${fb.sos})`);
  if (fa.tc != null && fb.tc != null && Math.abs(fa.tc - fb.tc) >= 1)
    L.push(`TC model: ${fa.tc > fb.tc ? a.n : b.n} by ${r0(Math.abs(fa.tc - fb.tc))} pts`);
  return [L, close];
}

// ── tools ──────────────────────────────────────────────────────────────────────────────────
async function one(d, q, pos) {
  const hits = find(await d.index(), q, pos, 1);
  return hits.length ? d.player(hits[0].id) : null;
}
async function teamCode(d, team) {
  const codes = (await d.manifest()).teams || {};
  const t = String(team || "").toUpperCase();
  if (codes[t]) return t;
  const lo = t.toLowerCase();
  return Object.keys(codes).find(c => String(codes[c]).toLowerCase().includes(lo)) || null;
}

const TOOLS = {
  async state(d) { return (await d.meta()).state; },
  async search_players(d, { query, pos, limit }) {
    const hits = find(await d.index(), query, pos, Number(limit) || 8);
    return hits.length ? hits.map(r => r.line).join("\n") : `No player matches ${JSON.stringify(query ?? "")}.`;
  },
  async get_player(d, { name, pos }) {
    const p = await one(d, name, pos);
    return p ? p.sheet : `No player matches ${JSON.stringify(name ?? "")}. Try search_players.`;
  },
  async compare(d, { a, b, question }) {
    const [pa, pb] = await Promise.all([one(d, a), one(d, b)]);
    const missing = [[a, pa], [b, pb]].filter(([, p]) => !p).map(([q]) => JSON.stringify(q ?? ""));
    if (missing.length) return `No player matches ${missing.join(", ")}. Try search_players.`;
    const [lines, close] = deltas(pa, pb);
    const [meta, man] = await Promise.all([d.meta(), d.manifest()]);
    return [
      `League: ${meta.league} · lineup ${meta.lineup}`,
      "", "PLAYER A", pa.sheet, "", "PLAYER B", pb.sheet,
      "", "COMPUTED HEAD-TO-HEAD DIFFERENCES",
      lines.map(l => "- " + l).join("\n") || "- none material",
      "", (close ? "The board values here are effectively tied, so the ranks CANNOT be the answer. " : "") + man.frame,
      "", `Question: ${question || "Who should I take?"}`,
    ].join("\n");
  },
  async rankings(d, { pos, limit, sort }) {
    sort = String(sort || "vor");
    if (!["vor", "adp", "points", "ecr"].includes(sort)) return `unknown sort ${JSON.stringify(sort)}; one of vor, adp, points, ecr`;
    const p = pos ? String(pos).toUpperCase() : "all";
    const t = await d.rank(p, sort);
    if (!t) return `No rankings for ${JSON.stringify(pos)}; one of QB, RB, WR, TE or omit.`;
    return [t.head, ...t.rows.slice(0, Number(limit) || 25), t.foot].join("\n");
  },
  async team(d, { team }) {
    const code = await teamCode(d, team);
    if (!code) return `Unknown team ${JSON.stringify(team ?? "")}. Codes: ${Object.keys((await d.manifest()).teams || {}).sort().join(", ")}`;
    const t = await d.team(code);
    return t ? t.text : `No sheet for ${code}.`;
  },
  async schedule(d, { team, from_week }) {
    const code = String(team || "").toUpperCase();
    const s = await d.sched(code);
    if (!s) return `No schedule for ${JSON.stringify(code)} (is the in-season sidecar built?).`;
    const from = Number(from_week) || s.week || 1;
    const rows = s.lines.filter(([w]) => w >= from).map(([, l]) => l);
    return `${code} schedule\n${rows.join("\n")}`;
  },
  async sos(d) { return (await d.sos()).text; },
};

// ── JSON-RPC ───────────────────────────────────────────────────────────────────────────────
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(d, msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return rpcError(null, -32600, "invalid request");
  const { method, id, params = {} } = msg;
  if (method == null) return null;
  if (String(method).startsWith("notifications/")) return null;
  let result;
  try {
    if (method === "initialize") {
      const man = await d.manifest();
      const want = params.protocolVersion;
      result = {
        protocolVersion: PROTOCOL_VERSIONS.includes(want) ? want : PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 1],
        capabilities: { tools: { listChanged: false }, resources: {} },
        serverInfo: { name: man.server.name, version: man.server.version },
        instructions: man.instructions,
      };
    } else if (method === "ping") {
      result = {};
    } else if (method === "tools/list") {
      result = { tools: (await d.manifest()).tools };
    } else if (method === "tools/call") {
      const name = params.name, fn = Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : null;
      if (!fn) return rpcError(id, -32602, `unknown tool ${JSON.stringify(name)}`);
      try {
        result = { content: [{ type: "text", text: await fn(d, params.arguments || {}) }], isError: false };
      } catch (e) {
        result = { content: [{ type: "text", text: `${e.name}: ${e.message}` }], isError: true };
      }
    } else if (method === "resources/list") {
      result = { resources: (await d.manifest()).resources };
    } else if (method === "resources/read") {
      const res = (await d.manifest()).resources[0];
      if (params.uri !== res.uri) return rpcError(id, -32002, `unknown resource ${JSON.stringify(params.uri)}`);
      result = { contents: [{ uri: res.uri, mimeType: "text/plain", text: (await d.meta()).state }] };
    } else if (method === "prompts/list") {
      result = { prompts: [] };
    } else {
      return rpcError(id, -32601, `method not found: ${method}`);
    }
  } catch (e) {
    return rpcError(id, -32603, `${e.name}: ${e.message}`);
  }
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function landing(base, fmt) {
  return [
    "TripleCrown MCP — fantasy football data as tools, for any MCP client.",
    "",
    `POST ${base}/mcp                 (${fmt} scoring)`,
    ...FORMATS.map(f => `POST ${base}/${f}/mcp`),
    "",
    "Claude Code:   claude mcp add --transport http triplecrown " + base + "/superflex/mcp",
    "claude.ai:     Settings → Connectors → Add custom connector → that URL",
    "",
    "Data: the TripleCrown seed on GitHub Pages, rebaked on every deploy. No accounts, no keys, no state.",
    "Source: https://github.com/sengi12/triplecrown (tools/tc_mcp.py, tools/mcp_worker/)",
  ].join("\n");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/(?:(ppr|half_ppr|std|superflex)\/)?mcp\/?$/);
    const base = `${url.protocol}//${url.host}`;
    const fmt = (m && m[1]) || (FORMATS.includes(env.TC_FORMAT) ? env.TC_FORMAT : "ppr");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (!m) {
      if (url.pathname === "/" || url.pathname === "") return new Response(landing(base, fmt), { headers: { "content-type": "text/plain; charset=utf-8", ...CORS } });
      return new Response("not found", { status: 404, headers: CORS });
    }
    if (request.method === "GET") return new Response("MCP endpoint: POST JSON-RPC here. No server-initiated stream.", { status: 405, headers: { allow: "POST, DELETE, OPTIONS", ...CORS } });
    if (request.method === "DELETE") return new Response(null, { status: 200, headers: CORS });
    if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: CORS });

    let body;
    try { body = await request.json(); }
    catch { return new Response(JSON.stringify(rpcError(null, -32700, "parse error")), { status: 400, headers: { ...JSON_HDR, ...CORS } }); }
    const d = new Data(env.TC_DATA || "https://sengi12.github.io/triplecrown/mcp", fmt);
    const msgs = Array.isArray(body) ? body : [body];
    const out = (await Promise.all(msgs.map(x => handle(d, x)))).filter(x => x !== null);
    if (!out.length) return new Response(null, { status: 202, headers: CORS });   // notifications only
    const payload = Array.isArray(body) ? out : out[0];
    return new Response(JSON.stringify(payload), { headers: { ...JSON_HDR, "mcp-protocol-version": PROTOCOL_VERSIONS[0], ...CORS } });
  },
};

export { find, normName, deltas, handle, Data, TOOLS };
