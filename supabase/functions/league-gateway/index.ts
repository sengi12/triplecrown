// ═══════════════════════════════════════════════════════════════════════════════
// TripleCrown league gateway
// ═══════════════════════════════════════════════════════════════════════════════
// One Supabase Edge Function that does the small number of things a static page cannot:
//
//   • Yahoo — the whole conversation. Yahoo sends no CORS headers, so the browser cannot
//     reach it at all, and its OAuth has no PKCE, so the client secret must live on a server.
//   • ESPN private leagues — `Cookie` is a forbidden header name in fetch(), so only a server
//     can attach espn_s2. Public ESPN leagues never come through here; the client calls ESPN
//     directly and this is only a fallback if ESPN ever stops reflecting Origin.
//   • Sleeper — never. It is open and CORS-friendly; routing it through here would add
//     latency, a dependency and a quota for nothing.
//
// DESIGN RULES, in priority order. Later code is expected to obey these; where a rule is
// enforced structurally rather than by discipline, that is called out inline.
//
//   R1  No credential is ever returned to any client. There is deliberately no read endpoint.
//       Storage is write-only from outside; the only way a credential leaves this file is as
//       an Authorization header or Cookie header aimed at Yahoo or ESPN.
//   R2  No request or response body is ever logged. Credentials arrive in POST bodies; a
//       single console.log(req) would put an unscoped account session into log retention.
//       `logEvent` below takes structured, allow-listed fields only — never free-form objects.
//   R3  Fail closed. A decrypt failure, a missing credential or a bad token returns an error.
//       It must never fall through to an unauthenticated upstream call, which would report a
//       private league as merely "not public" and hide the real fault.
//   R4  Zero dependencies. No npm, no JSR, no third-party imports. The only import is our own
//       crypto.js, which itself imports nothing. Every line here is auditable in one sitting.
//   R5  Least origin. CORS is allow-listed per route, not globally. Only the credential
//       hand-off route accepts espn.com, and only the app origin gets everything else.
// ═══════════════════════════════════════════════════════════════════════════════

import {
  importMasterKey, seal, open, hashToken, mintToken,
  bytesToHexLiteral, hexLiteralToBytes,
} from './crypto.js';
import {
  isValidEspnS2, isValidSwid, isValidLeagueId, isValidSeason,
  sanitizeViews, isValidYahooPath, isValidProvider,
} from './validate.js';

// ── Configuration ─────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const YAHOO_CLIENT_ID = Deno.env.get('YAHOO_CLIENT_ID') || '';
const YAHOO_CLIENT_SECRET = Deno.env.get('YAHOO_CLIENT_SECRET') || '';
const MASTER_KEY_B64 = Deno.env.get('TC_CRED_MASTER_KEY') || '';

// The current envelope key version. Bump ONLY together with a re-wrap migration; a bump
// alone makes every existing ciphertext undecryptable (which the crypto tests assert).
const KEY_VERSION = 1;

// R5: allow-listed origins. Add a deployment origin here rather than loosening to '*' —
// '*' is incompatible with credentialed requests anyway, so a wildcard here would be both
// less safe and non-functional.
const APP_ORIGINS = new Set([
  'https://sengi12.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
]);
// Only the bookmarklet hand-off accepts these, and that route accepts nothing else.
const CAPTURE_ORIGINS = new Set([
  'https://www.espn.com',
  'https://fantasy.espn.com',
]);

const LINK_TOKEN_TTL_MS = 10 * 60 * 1000;   // 10 minutes: long enough to click, short enough
                                            // that a leaked token is near-worthless.

// ── Small helpers ─────────────────────────────────────────────────────────────
function corsHeaders(origin: string | null, allowed: Set<string>) {
  const h: Record<string, string> = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '600',
  };
  if (origin && allowed.has(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// R3: one error shape for every failure. Callers get enough to act on and nothing that
// distinguishes "no credential stored" from "credential rejected upstream" — that difference
// is useful to an attacker probing which users have linked accounts, and useless to a user.
function fail(status: number, message: string, cors: Record<string, string>) {
  return json({ error: message }, status, cors);
}

// R2: structured, allow-listed logging. There is intentionally no parameter that accepts an
// arbitrary object, because that is how bodies end up in logs by accident.
function logEvent(event: string, fields: { userId?: string; provider?: string; status?: number; ms?: number }) {
  const safe = {
    event,
    // User id is a UUID, not PII in itself, and we need it to investigate abuse.
    user: fields.userId ? fields.userId.slice(0, 8) : undefined,
    provider: fields.provider,
    status: fields.status,
    ms: fields.ms,
  };
  console.log(JSON.stringify(safe));
}

// ── Postgres access (PostgREST + service_role, no client library) ──────────────
// service_role bypasses RLS by design, which is exactly why the tables also have their
// grants revoked from anon/authenticated: this key is the ONLY path to them, and it never
// leaves the function.
async function db(pathAndQuery: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`db ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Identify the caller from their Supabase session. Done by asking Supabase rather than by
// verifying the JWT locally: no secret to hold, no signature code to get wrong, and a token
// revoked seconds ago stops working immediately instead of at expiry.
async function requireUser(req: Request): Promise<{ id: string }> {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) throw new Error('unauthenticated');
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: auth },
  });
  if (!res.ok) throw new Error('unauthenticated');
  const user = await res.json();
  if (!user?.id) throw new Error('unauthenticated');
  return { id: user.id as string };
}

// ── Credential storage ────────────────────────────────────────────────────────
async function storeCredential(userId: string, provider: 'yahoo' | 'espn', plaintext: string, label?: string) {
  const master = await importMasterKey(MASTER_KEY_B64);
  const { salt, nonce, ciphertext } = await seal(
    master, { keyVersion: KEY_VERSION, userId, provider }, plaintext,
  );
  await db('tc_league_credentials?on_conflict=user_id,provider', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{
      user_id: userId,
      provider,
      key_version: KEY_VERSION,
      salt: bytesToHexLiteral(salt),
      nonce: bytesToHexLiteral(nonce),
      ciphertext: bytesToHexLiteral(ciphertext),
      label: label ?? null,
      fail_count: 0,
      last_ok_at: null,
    }]),
  });
}

// R1: this is a private function and its return value never reaches a Response. If you ever
// need to change that, you are changing the security model, not adding a feature.
async function loadCredential(userId: string, provider: 'yahoo' | 'espn'): Promise<string | null> {
  const rows = await db(
    `tc_league_credentials?user_id=eq.${userId}&provider=eq.${provider}` +
    `&select=key_version,salt,nonce,ciphertext`,
  );
  if (!rows?.length) return null;
  const r = rows[0];
  const master = await importMasterKey(MASTER_KEY_B64);
  // A throw here propagates and the caller fails closed (R3).
  const plain = await open(
    master,
    { keyVersion: r.key_version, userId, provider },
    {
      salt: hexLiteralToBytes(r.salt),
      nonce: hexLiteralToBytes(r.nonce),
      ciphertext: hexLiteralToBytes(r.ciphertext),
    },
  );
  await db(`tc_league_credentials?user_id=eq.${userId}&provider=eq.${provider}`, {
    method: 'PATCH',
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  });
  return plain;
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Every route that costs an upstream request takes a token first. Without this, a stolen app
// JWT could drive the proxy at any rate it liked — from our IP, with our reputation, against
// someone else's stored credential.
//
// The decision is a single atomic statement in Postgres (see tc_rate_take in schema.sql), so
// concurrent requests cannot both squeeze through on the same remaining token.
//
// FAIL CLOSED. If the limiter itself errors, the request is refused. The alternative —
// letting traffic through when the limiter is broken — turns a database blip into an open
// proxy, which is exactly the situation the limiter exists to prevent.
const LIMITS: Record<string, { limit: number; windowSec: number }> = {
  'espn.read':   { limit: 60,  windowSec: 3600 },  // a re-sync is a handful of reads
  'yahoo.read':  { limit: 120, windowSec: 3600 },  // Yahoo needs more calls per league view
  'link.mint':   { limit: 10,  windowSec: 3600 },  // linking is rare and deliberate
  'yahoo.auth':  { limit: 10,  windowSec: 3600 },
};

async function takeToken(userId: string, bucket: string): Promise<boolean> {
  const spec = LIMITS[bucket];
  if (!spec) return true;
  try {
    const allowed = await db('rpc/tc_rate_take', {
      method: 'POST',
      body: JSON.stringify({
        p_user: userId, p_bucket: bucket,
        p_limit: spec.limit, p_window_s: spec.windowSec,
      }),
    });
    return allowed === true;
  } catch {
    return false;   // fail closed
  }
}

// Wrap a handler in its rate-limit bucket. Returns 429 with Retry-After when exhausted.
async function limited(
  userId: string, bucket: string, cors: Record<string, string>,
  run: () => Promise<Response>,
): Promise<Response> {
  if (!(await takeToken(userId, bucket))) {
    logEvent('ratelimited', { userId, status: 429 });
    const retry = String(LIMITS[bucket] ? LIMITS[bucket].windowSec : 3600);
    return new Response(JSON.stringify({ error: 'too many requests — try again later' }), {
      status: 429,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': retry },
    });
  }
  return run();
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /link/mint  — the app asks for a single-use hand-off token.
// Why this exists: the bookmarklet runs on espn.com and cannot read the app's Supabase
// session (different origin). Minting a token here means the credential can travel
// espn.com → gateway without ever passing through TripleCrown's own JavaScript, which keeps
// an unscoped ESPN session outside the app's XSS blast radius.
async function routeLinkMint(req: Request, cors: Record<string, string>) {
  const user = await requireUser(req);
  if (!(await takeToken(user.id, 'link.mint'))) return fail(429, 'too many link attempts — try again later', cors);
  const token = mintToken();
  const digest = await hashToken(token);
  await db('tc_link_tokens', {
    method: 'POST',
    body: JSON.stringify([{
      token_hash: bytesToHexLiteral(digest),
      user_id: user.id,
      provider: 'espn',
      expires_at: new Date(Date.now() + LINK_TOKEN_TTL_MS).toISOString(),
    }]),
  });
  logEvent('link.mint', { userId: user.id, provider: 'espn' });
  // The token is returned ONCE, to the authenticated app, and only its hash is stored.
  return json({ token, expires_in: LINK_TOKEN_TTL_MS / 1000 }, 200, cors);
}

// POST /link/espn — the bookmarklet delivers the credential.
// Authenticated by the link token alone: the caller is a page on espn.com and has no Supabase
// session to present. That is safe because the token is single-use, expires in 10 minutes,
// is bound to one user, and is stored only as a hash.
async function routeLinkEspn(req: Request, cors: Record<string, string>) {
  const body = await req.json().catch(() => null);
  const token = body?.link_token, s2 = body?.espn_s2, swid = body?.swid;
  if (typeof token !== 'string' || typeof s2 !== 'string' || typeof swid !== 'string') {
    return fail(400, 'malformed request', cors);
  }
  // Reject obviously-wrong shapes before touching the database. espn_s2 is a long
  // percent-encoded blob; SWID is a braced GUID. This also stops someone posting a whole
  // cookie jar (which would include the Disney OneID refresh token we must never hold).
  // See validate.js — these are the injection boundary and are tested independently.
  if (!isValidEspnS2(s2) || !isValidSwid(swid)) return fail(400, 'malformed request', cors);

  const digest = bytesToHexLiteral(await hashToken(token));
  const rows = await db(
    `tc_link_tokens?token_hash=eq.${encodeURIComponent(digest)}&used_at=is.null` +
    `&expires_at=gt.${new Date().toISOString()}&select=user_id,provider`,
  );
  if (!rows?.length) return fail(401, 'link expired — start again from TripleCrown', cors);
  const userId = rows[0].user_id as string;

  // Spend the token BEFORE storing, so a replay cannot re-use it even if storage then fails.
  await db(`tc_link_tokens?token_hash=eq.${encodeURIComponent(digest)}&used_at=is.null`, {
    method: 'PATCH',
    body: JSON.stringify({ used_at: new Date().toISOString() }),
  });

  await storeCredential(userId, 'espn', JSON.stringify({ espn_s2: s2, swid }), body?.label);
  logEvent('link.espn.stored', { userId, provider: 'espn' });
  return json({ ok: true }, 200, cors);
}

// POST /espn/read — proxy one ESPN league read using the stored cookies.
// The client sends only {leagueId, season, views}; it never sends or receives a credential.
async function routeEspnRead(req: Request, cors: Record<string, string>) {
  const user = await requireUser(req);
  return limited(user.id, 'espn.read', cors, () => espnReadInner(user, req, cors));
}
async function espnReadInner(user: { id: string }, req: Request, cors: Record<string, string>) {
  const body = await req.json().catch(() => null);
  const leagueId = String(body?.leagueId || '');
  const season = String(body?.season || '');
  const views: string[] = Array.isArray(body?.views) ? body.views : [];
  // Strict validation: these values are interpolated into an upstream URL, so anything other
  // than the exact expected shape is refused rather than sanitised.
  if (!isValidLeagueId(leagueId) || !isValidSeason(season)) {
    return fail(400, 'bad league reference', cors);
  }
  const safeViews = sanitizeViews(views);

  const cred = await loadCredential(user.id, 'espn');
  if (!cred) return fail(409, 'no ESPN credential linked', cors);
  const { espn_s2, swid } = JSON.parse(cred);
  // Re-validate on the way OUT as well as the way in. A row written before the input rule
  // existed, or by some future path, must still be unable to malform the Cookie header.
  if (!isValidEspnS2(espn_s2) || !isValidSwid(swid)) {
    return fail(409, 'stored ESPN sign-in is unusable — re-link from TripleCrown', cors);
  }

  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}` +
    `/segments/0/leagues/${leagueId}` +
    (safeViews.length ? `?${safeViews.map((v) => `view=${v}`).join('&')}` : '');

  const t0 = Date.now();
  const upstream = await fetch(url, {
    headers: {
      Accept: 'application/json',
      // The entire reason this function exists: a browser cannot set this header.
      Cookie: `espn_s2=${espn_s2}; SWID=${swid}`,
    },
  });
  logEvent('espn.read', { userId: user.id, provider: 'espn', status: upstream.status, ms: Date.now() - t0 });

  if (upstream.status === 401 || upstream.status === 403) {
    // The stored cookie no longer works — almost always because the user logged out of ESPN.
    // Count it, and tell them plainly rather than reporting the league as private.
    await db('rpc/tc_note_credential_failure', {
      method: 'POST',
      body: JSON.stringify({ p_user: user.id, p_provider: 'espn' }),
    }).catch(() => {});
    return fail(401, 'ESPN rejected the saved sign-in — re-link from TripleCrown', cors);
  }
  if (!upstream.ok) return fail(502, `ESPN returned ${upstream.status}`, cors);

  await db(`tc_league_credentials?user_id=eq.${user.id}&provider=eq.espn`, {
    method: 'PATCH', body: JSON.stringify({ last_ok_at: new Date().toISOString(), fail_count: 0 }),
  }).catch(() => {});

  // Stream the league JSON straight through. It contains no credential.
  return new Response(upstream.body, {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// GET /yahoo/authorize — begin the OAuth dance.
// `state` is a link token, which gives us CSRF protection and the user binding in one object:
// the callback can only proceed if it presents a token we minted, and that token names the user.
async function routeYahooAuthorize(req: Request, cors: Record<string, string>) {
  const user = await requireUser(req);
  if (!(await takeToken(user.id, 'yahoo.auth'))) return fail(429, 'too many attempts — try again later', cors);
  if (!YAHOO_CLIENT_ID) return fail(503, 'Yahoo is not configured', cors);
  const token = mintToken();
  await db('tc_link_tokens', {
    method: 'POST',
    body: JSON.stringify([{
      token_hash: bytesToHexLiteral(await hashToken(token)),
      user_id: user.id,
      provider: 'yahoo',
      expires_at: new Date(Date.now() + LINK_TOKEN_TTL_MS).toISOString(),
    }]),
  });
  const redirect = `${SUPABASE_URL}/functions/v1/league-gateway/yahoo/callback`;
  const auth = new URL('https://api.login.yahoo.com/oauth2/request_auth');
  auth.searchParams.set('client_id', YAHOO_CLIENT_ID);
  auth.searchParams.set('redirect_uri', redirect);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', 'fspt-r');    // read fantasy only — never fspt-w
  auth.searchParams.set('state', token);
  logEvent('yahoo.authorize', { userId: user.id, provider: 'yahoo' });
  return json({ url: auth.toString() }, 200, cors);
}

// GET /yahoo/callback — Yahoo redirects the user's BROWSER here with ?code&state.
// Reached as a top-level navigation, so it returns HTML rather than JSON.
async function routeYahooCallback(req: Request, cors: Record<string, string>) {
  const u = new URL(req.url);
  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  if (!code || !state) return htmlResult('Yahoo did not return an authorisation code.', false);

  const digest = bytesToHexLiteral(await hashToken(state));
  const rows = await db(
    `tc_link_tokens?token_hash=eq.${encodeURIComponent(digest)}&used_at=is.null` +
    `&expires_at=gt.${new Date().toISOString()}&select=user_id`,
  );
  if (!rows?.length) return htmlResult('That sign-in link has expired. Try again from TripleCrown.', false);
  const userId = rows[0].user_id as string;
  await db(`tc_link_tokens?token_hash=eq.${encodeURIComponent(digest)}&used_at=is.null`, {
    method: 'PATCH', body: JSON.stringify({ used_at: new Date().toISOString() }),
  });

  const redirect = `${SUPABASE_URL}/functions/v1/league-gateway/yahoo/callback`;
  const tok = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
    method: 'POST',
    headers: {
      // Verified against Yahoo's discovery document: client_secret_basic is supported.
      Authorization: `Basic ${btoa(`${YAHOO_CLIENT_ID}:${YAHOO_CLIENT_SECRET}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect }),
  });
  if (!tok.ok) {
    logEvent('yahoo.token.rejected', { userId, provider: 'yahoo', status: tok.status });
    return htmlResult('Yahoo declined the sign-in. Please try again.', false);
  }
  const t = await tok.json();
  // Only the refresh token is kept. The access token lives an hour and is cheap to re-mint,
  // so persisting it would add exposure for no benefit.
  if (!t?.refresh_token) return htmlResult('Yahoo did not return a refresh token.', false);
  await storeCredential(userId, 'yahoo', String(t.refresh_token));
  logEvent('yahoo.linked', { userId, provider: 'yahoo' });
  return htmlResult('Yahoo connected. You can close this tab and return to TripleCrown.', true);
}

// Exchange the stored refresh token for a short-lived access token, per request.
async function yahooAccessToken(userId: string): Promise<string | null> {
  const refresh = await loadCredential(userId, 'yahoo');
  if (!refresh) return null;
  const res = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${YAHOO_CLIENT_ID}:${YAHOO_CLIENT_SECRET}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
  });
  if (!res.ok) return null;
  const t = await res.json();
  // Yahoo MAY rotate the refresh token on use. If it does, persist the new one immediately —
  // dropping it would silently strand the user at the next request.
  if (t?.refresh_token && t.refresh_token !== refresh) {
    await storeCredential(userId, 'yahoo', String(t.refresh_token));
  }
  return t?.access_token ? String(t.access_token) : null;
}

// POST /yahoo/read — proxy one Yahoo Fantasy read.
// `path` is allow-listed by pattern; it is appended to Yahoo's base URL, so a permissive
// check here would be an SSRF hole.
async function routeYahooRead(req: Request, cors: Record<string, string>) {
  const user = await requireUser(req);
  return limited(user.id, 'yahoo.read', cors, () => yahooReadInner(user, req, cors));
}
async function yahooReadInner(user: { id: string }, req: Request, cors: Record<string, string>) {
  const body = await req.json().catch(() => null);
  const path = String(body?.path || '');
  if (!isValidYahooPath(path)) return fail(400, 'bad path', cors);
  const access = await yahooAccessToken(user.id);
  if (!access) return fail(409, 'no Yahoo account linked', cors);

  const t0 = Date.now();
  const upstream = await fetch(
    `https://fantasysports.yahooapis.com/fantasy/v2/${path}${path.includes('?') ? '&' : '?'}format=json`,
    { headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' } },
  );
  logEvent('yahoo.read', { userId: user.id, provider: 'yahoo', status: upstream.status, ms: Date.now() - t0 });
  if (!upstream.ok) return fail(upstream.status === 401 ? 401 : 502, `Yahoo returned ${upstream.status}`, cors);
  return new Response(upstream.body, {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// POST /disconnect — hard delete. Not a flag, not a soft delete, not an archive.
async function routeDisconnect(req: Request, cors: Record<string, string>) {
  const user = await requireUser(req);
  const body = await req.json().catch(() => null);
  const provider = body?.provider;
  if (!isValidProvider(provider)) return fail(400, 'bad provider', cors);
  await db(`tc_league_credentials?user_id=eq.${user.id}&provider=eq.${provider}`, { method: 'DELETE' });
  logEvent('disconnect', { userId: user.id, provider });
  return json({ ok: true }, 200, cors);
}

function htmlResult(message: string, ok: boolean) {
  // Deliberately static: no interpolation of anything user- or upstream-controlled.
  const body = `<!doctype html><meta charset="utf-8">` +
    `<title>TripleCrown</title>` +
    `<body style="font:16px/1.5 system-ui;padding:3rem;max-width:32rem;margin:auto">` +
    `<h1 style="font-size:1.1rem">${ok ? 'Connected' : 'Something went wrong'}</h1>` +
    `<p>${message}</p></body>`;
  return new Response(body, {
    status: ok ? 200 : 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/league-gateway/, '') || '/';
  const origin = req.headers.get('origin');

  // R5: the capture route is the only one that trusts an espn.com origin, and it trusts
  // nothing else. Everything else is app-origin only.
  const allowed = route === '/link/espn' ? CAPTURE_ORIGINS : APP_ORIGINS;
  const cors = corsHeaders(origin, allowed);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  // Reject a cross-origin call from an origin we do not serve, before doing any work.
  // The browser would block the response anyway; refusing early avoids the side effects.
  if (origin && !allowed.has(origin)) return fail(403, 'origin not allowed', cors);

  try {
    if (!MASTER_KEY_B64) return fail(503, 'gateway not configured', cors);
    switch (`${req.method} ${route}`) {
      case 'POST /link/mint':       return await routeLinkMint(req, cors);
      case 'POST /link/espn':       return await routeLinkEspn(req, cors);
      case 'POST /espn/read':       return await routeEspnRead(req, cors);
      case 'GET /yahoo/authorize':  return await routeYahooAuthorize(req, cors);
      case 'GET /yahoo/callback':   return await routeYahooCallback(req, cors);
      case 'POST /yahoo/read':      return await routeYahooRead(req, cors);
      case 'POST /disconnect':      return await routeDisconnect(req, cors);
      default:                      return fail(404, 'no such route', cors);
    }
  } catch (e) {
    // R2/R3: log the event name and nothing else. `e` may carry a URL or body fragment, so
    // it is never serialised. The client gets a generic message.
    logEvent('error', { status: 500 });
    const unauth = e instanceof Error && e.message === 'unauthenticated';
    return fail(unauth ? 401 : 500, unauth ? 'sign in first' : 'gateway error', cors);
  }
});
