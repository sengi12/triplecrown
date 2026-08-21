// League-gateway envelope encryption.
//
// This is the only code in the project that guards unscoped account credentials, so the tests
// are written adversarially: most of them try to DECRYPT SOMETHING THEY SHOULD NOT BE ABLE TO,
// and pass only when that attempt throws. A test suite that merely proves round-tripping works
// would pass just as happily against ECB with a fixed key.
//
// Runs on Node 20+ using the same Web Crypto implementation the Deno runtime uses, so what is
// verified here is the code that actually executes in production.
const path = require('path');

(async () => {
  const C = await import('file://' + path.join(__dirname, '..', 'supabase', 'functions', 'league-gateway', 'crypto.js'));

  let pass = 0, total = 0;
  const chk = (c, l) => { total++; if (c) { pass++; console.log('  PASS:', l); } else console.log('  FAIL:', l); };
  // Assert that a promise rejects. Used for every "must not decrypt" case below.
  const denied = async (fn, l) => {
    total++;
    try { await fn(); console.log('  FAIL:', l, '(it succeeded — that is the bug)'); }
    catch { pass++; console.log('  PASS:', l); }
  };

  const KEY_A = C.bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  const KEY_B = C.bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  const USER_1 = '11111111-1111-4111-8111-111111111111';
  const USER_2 = '22222222-2222-4222-8222-222222222222';
  const SECRET = 'espn_s2=AEA7mysExampleNotARealCredential%2Bpadding; SWID={DEAD-BEEF}';

  const mA = await C.importMasterKey(KEY_A);
  const mB = await C.importMasterKey(KEY_B);
  // NB: `v || 1` would quietly turn keyVersion 0 into 1 and make the "keyVersion 0 rejected"
  // case test nothing. Pass 0 through untouched so the validation is actually exercised.
  const ctxOf = (u, p, v) => ({ keyVersion: v === undefined ? 1 : v, userId: u, provider: p });

  console.log('=== TEST 1: master key validation is strict ===');
  await denied(() => C.importMasterKey(''), 'empty key rejected');
  await denied(() => C.importMasterKey(undefined), 'missing key rejected');
  await denied(() => C.importMasterKey('not!valid!base64!'), 'malformed base64 rejected');
  await denied(() => C.importMasterKey(C.bytesToBase64(new Uint8Array(8))),
    'a SHORT key is rejected rather than silently accepted');
  await denied(() => C.importMasterKey(C.bytesToBase64(new Uint8Array(64))),
    'an over-long key is rejected too (no silent truncation)');

  console.log('\n=== TEST 2: round trip ===');
  const sealed = await C.seal(mA, ctxOf(USER_1, 'espn'), SECRET);
  chk(await C.open(mA, ctxOf(USER_1, 'espn'), sealed) === SECRET, 'seal → open returns the original');
  chk(sealed.salt.length === 16, 'salt is 16 bytes');
  chk(sealed.nonce.length === 12, 'nonce is 12 bytes (GCM standard)');
  chk(sealed.ciphertext.length === new TextEncoder().encode(SECRET).length + 16,
      'ciphertext carries the 16-byte GCM tag');

  console.log('\n=== TEST 3: the ciphertext leaks nothing recognisable ===');
  const blob = C.bytesToBase64(sealed.ciphertext);
  chk(!blob.includes('espn_s2'), 'no plaintext marker survives into the ciphertext');
  chk(!/SWID/.test(new TextDecoder().decode(sealed.ciphertext)), 'raw bytes contain no readable SWID');

  console.log('\n=== TEST 4: nonce and salt are never reused ===');
  // Nonce reuse under GCM is catastrophic — it leaks the XOR of plaintexts and can expose the
  // authentication subkey. This asserts fresh randomness on every single write.
  const salts = new Set(), nonces = new Set(), cts = new Set();
  for (let i = 0; i < 200; i++) {
    const s = await C.seal(mA, ctxOf(USER_1, 'espn'), SECRET);
    salts.add(C.bytesToBase64(s.salt));
    nonces.add(C.bytesToBase64(s.nonce));
    cts.add(C.bytesToBase64(s.ciphertext));
  }
  chk(salts.size === 200, '200 seals produced 200 distinct salts');
  chk(nonces.size === 200, '200 seals produced 200 distinct nonces');
  chk(cts.size === 200, 'identical plaintext never produces identical ciphertext');

  console.log('\n=== TEST 5: tenant separation (the load-bearing property) ===');
  // The attack: someone with write access to Postgres copies user 1's row onto user 2's id,
  // then signs in as user 2 to read a credential that is not theirs.
  await denied(() => C.open(mA, ctxOf(USER_2, 'espn'), sealed),
    'user 2 CANNOT decrypt user 1’s row (row-substitution attack)');
  await denied(() => C.open(mA, ctxOf(USER_1, 'yahoo'), sealed),
    'an espn row cannot be read as a yahoo row');
  await denied(() => C.open(mA, ctxOf(USER_1, 'espn', 2), sealed),
    'a key_version bump invalidates the old ciphertext (no silent downgrade)');

  console.log('\n=== TEST 6: a stolen database without the master key is inert ===');
  await denied(() => C.open(mB, ctxOf(USER_1, 'espn'), sealed),
    'the wrong master key cannot decrypt (T1/T2: dump + leaked service_role)');

  console.log('\n=== TEST 7: tampering is detected, not tolerated ===');
  const bitFlip = (buf, i) => { const c = buf.slice(); c[i] ^= 0x01; return c; };
  await denied(() => C.open(mA, ctxOf(USER_1, 'espn'),
      { ...sealed, ciphertext: bitFlip(sealed.ciphertext, 0) }),
    'a flipped ciphertext bit is caught by the GCM tag');
  await denied(() => C.open(mA, ctxOf(USER_1, 'espn'),
      { ...sealed, ciphertext: bitFlip(sealed.ciphertext, sealed.ciphertext.length - 1) }),
    'a flipped TAG bit is rejected');
  await denied(() => C.open(mA, ctxOf(USER_1, 'espn'), { ...sealed, nonce: bitFlip(sealed.nonce, 0) }),
    'a swapped nonce is rejected');
  await denied(() => C.open(mA, ctxOf(USER_1, 'espn'), { ...sealed, salt: bitFlip(sealed.salt, 0) }),
    'a swapped salt is rejected (it derives a different key)');
  await denied(() => C.open(mA, ctxOf(USER_1, 'espn'),
      { ...sealed, ciphertext: sealed.ciphertext.slice(0, -1) }),
    'a truncated ciphertext is rejected');

  console.log('\n=== TEST 8: context validation rejects junk before any crypto runs ===');
  await denied(() => C.seal(mA, ctxOf(USER_1, 'sleeper'), SECRET), 'unknown provider rejected');
  await denied(() => C.seal(mA, ctxOf('', 'espn'), SECRET), 'empty userId rejected');
  await denied(() => C.seal(mA, ctxOf(USER_1, 'espn', 0), SECRET), 'keyVersion 0 rejected');
  await denied(() => C.seal(mA, ctxOf(USER_1, 'espn', 1.5), SECRET), 'non-integer keyVersion rejected');

  console.log('\n=== TEST 9: key rotation path works ===');
  // Re-wrapping under a new version must produce something the new context reads and the old
  // one does not — otherwise "rotation" would be cosmetic.
  const v2 = await C.seal(mA, ctxOf(USER_1, 'espn', 2), SECRET);
  chk(await C.open(mA, ctxOf(USER_1, 'espn', 2), v2) === SECRET, 'v2 ciphertext opens under v2');
  await denied(() => C.open(mA, ctxOf(USER_1, 'espn', 1), v2), 'and does NOT open under v1');

  console.log('\n=== TEST 10: link tokens ===');
  const t1 = C.mintToken(), t2 = C.mintToken();
  chk(t1 !== t2, 'tokens are unique');
  const unUrl = (s) => { const b = s.replace(/-/g, '+').replace(/_/g, '/');
                         return b + '='.repeat((4 - b.length % 4) % 4); };
  chk(C.base64ToBytes(unUrl(t1)).length === 32, 'token carries 32 bytes of entropy (256 bits)');
  chk(!/[+/=]/.test(t1), 'token is base64url — URL-safe, no padding to mangle');
  const h1 = await C.hashToken(t1);
  chk(h1.length === 32, 'token hash is SHA-256');
  chk(C.bytesToBase64(await C.hashToken(t1)) === C.bytesToBase64(h1), 'hashing is deterministic');
  chk(C.bytesToBase64(await C.hashToken(t2)) !== C.bytesToBase64(h1), 'different tokens hash differently');
  chk(!C.bytesToBase64(h1).includes(t1.slice(0, 12)), 'the hash does not embed the token');

  console.log('\n=== TEST 11: bytea round trip at the Postgres boundary ===');
  const lit = C.bytesToHexLiteral(sealed.nonce);
  chk(/^\\x[0-9a-f]+$/.test(lit), 'renders as a \\x hex literal');
  chk(C.bytesToBase64(C.hexLiteralToBytes(lit)) === C.bytesToBase64(sealed.nonce), 'and parses back exactly');
  const big = crypto.getRandomValues(new Uint8Array(512));
  chk(C.bytesToBase64(C.hexLiteralToBytes(C.bytesToHexLiteral(big))) === C.bytesToBase64(big),
      'round trip holds for a full-size ciphertext');

  console.log('\n=== TEST 12: a realistic credential survives intact ===');
  // espn_s2 is ~250 chars of percent-encoded base64 with + / % = in it. Encoding bugs here
  // would silently corrupt a credential and present as "ESPN says your league is private".
  const REAL_SHAPE = 'AEA7mys%2Bmb1S8oh1SlmFePhps0rqwEt6TdiVP9v5r27fGmXU7zFTX7sOQXCOCSzRvThEHIjQyh2dYTinnXSwA9FYSNU9nWYgQJ%2BLl%2F6g4mjlshiMvz8YeGOJSWY0T6OQtLDxdVtOOJpolCJnQx5HAjt2akJP1wh%2Brn32ea1boxPXiHRcasoyEseZyfMUScEYMBGcwuw6VYQ2E7hHF9bNnUVQ2fA%3D%3D';
  const rt = await C.seal(mA, ctxOf(USER_1, 'espn'), REAL_SHAPE);
  chk(await C.open(mA, ctxOf(USER_1, 'espn'), rt) === REAL_SHAPE, 'percent-encoded credential round-trips byte-exact');
  const UNICODE = 'team=Jürgen’s Ünicode 🏈 League';
  const ru = await C.seal(mA, ctxOf(USER_1, 'yahoo'), UNICODE);
  chk(await C.open(mA, ctxOf(USER_1, 'yahoo'), ru) === UNICODE, 'non-ASCII round-trips (UTF-8 safe)');

  console.log(`\nRESULT: ${pass === total ? 'PASS' : 'FAIL'} (${pass}/${total} checks)`);
  process.exit(pass === total ? 0 : 1);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
