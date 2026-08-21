// ═══════════════════════════════════════════════════════════════════════════════
// Envelope encryption for stored league credentials
// ═══════════════════════════════════════════════════════════════════════════════
// Deliberately plain JavaScript over the Web Crypto API and NOTHING else — no npm, no JSR,
// no Deno-specific globals. Two reasons, both security ones:
//
//   1. Supply chain. This module handles unscoped account credentials. A dependency here is
//      a party that can read them. There are no dependencies, so there is no such party.
//   2. Testability. Web Crypto is identical in Deno and in Node 20, so the exact bytes that
//      run in production also run under `node tests/test_gateway_crypto.js`. Crypto that only
//      executes after deployment is crypto nobody has checked.
//
// SCHEME  (see supabase/schema.sql for the storage side and the threat model)
//
//   master key    32 bytes, base64, from the TC_CRED_MASTER_KEY Edge Function secret.
//                 Never written to Postgres — that is what makes a database dump useless.
//
//   per record    salt = 16 random bytes
//                 dek  = HKDF-SHA256(master, salt, info = "tc-cred-v1|<ver>|<user>|<prov>")
//                 A fresh salt per write means every row has a distinct 256-bit key, so
//                 recovering one data key unlocks one row rather than the table.
//
//   encryption    AES-256-GCM, nonce = 12 fresh random bytes on EVERY write.
//                 aad = "<ver>|<user>|<prov>"
//
// ON THE OVERLAP BETWEEN `info` AND `aad` — worth being precise rather than claiming two
// independent defences where there is really one and a half. Binding the identity into the
// HKDF `info` is what actually separates tenants: a row copied to another user derives a
// different key and cannot be decrypted at all. The AAD binding is defence in depth over the
// same fields, and it additionally covers key_version so a rotation cannot be silently
// down-graded by editing that column. Both are cheap; neither is theatre; only the first is
// load-bearing.
//
// WHAT THIS CANNOT DO
//   JavaScript offers no reliable way to wipe a plaintext string from memory — no explicit
//   zeroing, and the GC may copy it. Plaintext therefore lives as long as the request does.
//   The mitigation is scope, not erasure: decrypt as late as possible, never assign it to
//   anything outer, and never let it reach a response body or a log line.
// ═══════════════════════════════════════════════════════════════════════════════

const enc = new TextEncoder();
const dec = new TextDecoder();

const SCHEME = 'tc-cred-v1';
const SALT_BYTES = 16;
const NONCE_BYTES = 12;    // 96-bit GCM nonce, the size the spec is defined for
const DEK_BITS = 256;

// Fail loudly on a short or malformed master key. A quietly-accepted 8-byte "key" would
// still encrypt and decrypt perfectly well while providing almost no security, which is the
// worst possible failure mode: silent.
export async function importMasterKey(base64) {
  if (typeof base64 !== 'string' || !base64.trim()) {
    throw new Error('TC_CRED_MASTER_KEY is not set');
  }
  let raw;
  try {
    raw = base64ToBytes(base64.trim());
  } catch {
    throw new Error('TC_CRED_MASTER_KEY is not valid base64');
  }
  if (raw.length !== 32) {
    throw new Error(`TC_CRED_MASTER_KEY must decode to 32 bytes, got ${raw.length}`);
  }
  // extractable:false — the key material cannot be read back out of the CryptoKey, so a bug
  // elsewhere in the function cannot serialise it into a log or a response.
  return crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits']);
}

// Identity that a ciphertext is cryptographically bound to. Any change here is a breaking
// format change and needs a key_version bump.
function context(keyVersion, userId, provider) {
  if (!Number.isInteger(keyVersion) || keyVersion < 1) throw new Error('bad keyVersion');
  if (!userId || typeof userId !== 'string') throw new Error('bad userId');
  if (provider !== 'yahoo' && provider !== 'espn') throw new Error('bad provider');
  return `${keyVersion}|${userId}|${provider}`;
}

async function deriveKey(masterKey, salt, ctx) {
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(`${SCHEME}|${ctx}`) },
    masterKey,
    DEK_BITS,
  );
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// Encrypt a credential. Returns the three columns the table stores; there is no variant that
// returns anything else, so a caller cannot accidentally persist plaintext.
export async function seal(masterKey, { keyVersion, userId, provider }, plaintext) {
  const ctx = context(keyVersion, userId, provider);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const dek = await deriveKey(masterKey, salt, ctx);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: enc.encode(ctx) },
    dek,
    enc.encode(plaintext),
  ));
  return { salt, nonce, ciphertext };
}

// Decrypt. Throws on ANY mismatch — wrong user, wrong provider, wrong key version, tampered
// ciphertext, wrong master key. Callers must treat a throw as "no credential", never as
// "proceed unauthenticated": falling through to an anonymous upstream call would report a
// private league as merely unreadable and hide the real failure.
export async function open(masterKey, { keyVersion, userId, provider }, { salt, nonce, ciphertext }) {
  const ctx = context(keyVersion, userId, provider);
  const dek = await deriveKey(masterKey, salt, ctx);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: enc.encode(ctx) },
    dek,
    ciphertext,
  );
  return dec.decode(plain);
}

// Link tokens are stored only as a SHA-256 digest, so a dump of tc_link_tokens cannot be
// replayed. Lookup is by digest (an index probe), not by comparing secrets in application
// code, which sidesteps timing-comparison concerns entirely.
export async function hashToken(token) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(token)));
}

// 32 bytes from the CSPRNG, base64url. Not a UUID: v4 UUIDs carry only 122 bits and some
// runtimes generate them from a weaker source.
export function mintToken() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

// ── encoding helpers (no dependencies, work in Deno and Node alike) ────────────
export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// Postgres renders bytea as "\x<hex>" over PostgREST; these convert at that boundary.
export function bytesToHexLiteral(bytes) {
  let h = '';
  for (let i = 0; i < bytes.length; i++) h += bytes[i].toString(16).padStart(2, '0');
  return `\\x${h}`;
}
export function hexLiteralToBytes(literal) {
  const hex = String(literal).startsWith('\\x') ? String(literal).slice(2) : String(literal);
  if (hex.length % 2) throw new Error('bad hex literal');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
