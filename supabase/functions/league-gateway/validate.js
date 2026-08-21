// ═══════════════════════════════════════════════════════════════════════════════
// Input validation for the league gateway
// ═══════════════════════════════════════════════════════════════════════════════
// Every value here ends up interpolated into something that leaves the function — an upstream
// URL, or a Cookie / Authorization header. That makes this file the injection boundary, so it
// lives on its own, imports nothing, and is covered by tests/test_gateway_validate.js rather
// than surviving as regexes scattered through request handlers.
//
// Two rules throughout:
//
//   ALLOW-LIST, NEVER SANITISE. Each predicate answers yes or no. Nothing here strips,
//   escapes or repairs a bad value, because a silently-repaired credential fails later as a
//   confusing "your sign-in was rejected" instead of immediately as a clear error.
//
//   BOUND EVERYTHING. Every input has a maximum length. An unbounded regex over attacker-
//   controlled input is a denial-of-service waiting to happen, and none of these fields has a
//   legitimate reason to be huge.
// ═══════════════════════════════════════════════════════════════════════════════

// espn_s2 — goes into a `Cookie:` header, so this is the highest-stakes check in the file.
// A value containing CR or LF would inject additional headers into our request to ESPN.
// In practice espn_s2 is percent-encoded base64 (~250-300 chars); the character class below
// covers that and nothing else. Control characters, spaces, semicolons, quotes and newlines
// are all outside it, which is the point.
const ESPN_S2_RE = /^[A-Za-z0-9%+/=_.-]+$/;
export function isValidEspnS2(v) {
  if (typeof v !== 'string') return false;
  if (v.length < 64 || v.length > 2048) return false;
  if (!ESPN_S2_RE.test(v)) return false;
  // A caller pasting the WHOLE cookie jar would sweep up ESPN-ONESITE.WEB-PROD.token, which
  // carries a Disney OneID refresh token and the user's email. We need neither and must never
  // hold either, so a value that looks like a token bundle is refused outright.
  if (/ESPN-ONESITE|refresh_token|access_token/i.test(v)) return false;
  return true;
}

// SWID — a braced GUID, also destined for the Cookie header.
const SWID_RE = /^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$/;
export function isValidSwid(v) {
  return typeof v === 'string' && v.length === 38 && SWID_RE.test(v);
}

// League id and season are interpolated into the upstream ESPN path.
export function isValidLeagueId(v) {
  return typeof v === 'string' && /^\d{2,12}$/.test(v);
}
export function isValidSeason(v) {
  if (typeof v !== 'string' || !/^\d{4}$/.test(v)) return false;
  const n = +v;
  return n >= 2000 && n <= 2100;
}

// ESPN `view=` parameters. Allow-listed by shape and capped in count, so a caller cannot use
// the proxy to build an arbitrarily large upstream query.
export function sanitizeViews(views) {
  if (!Array.isArray(views)) return [];
  return views.filter((v) => typeof v === 'string' && /^m[A-Za-z]{3,20}$/.test(v)).slice(0, 6);
}

// Yahoo resource path, appended to https://fantasysports.yahooapis.com/fantasy/v2/.
// This is the SSRF boundary: a permissive check here would let a caller aim the gateway's
// authenticated requests somewhere else entirely. Rejected explicitly are anything that could
// change host or escape the base path — a scheme, an authority, a traversal, a backslash, or
// a leading slash.
const YAHOO_PATH_RE = /^[A-Za-z0-9_;=,.\/-]{1,200}$/;
export function isValidYahooPath(v) {
  if (typeof v !== 'string' || !YAHOO_PATH_RE.test(v)) return false;
  if (v.startsWith('/')) return false;      // would produce a protocol-relative-looking path
  if (v.includes('..')) return false;       // traversal out of /fantasy/v2/
  if (v.includes('//')) return false;       // "//host" reads as an authority to some parsers
  return true;
}

// Supabase user ids are UUIDs. Checked before being interpolated into a PostgREST filter.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export function isValidUserId(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

export function isValidProvider(v) {
  return v === 'yahoo' || v === 'espn';
}
