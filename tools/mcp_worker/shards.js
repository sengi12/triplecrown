// How the whole seed is cut into shards the Worker can read one at a time — shared between
// the bake (bake_seed.js, Node, at deploy) and the Worker (worker.js, at the edge), so both
// sides agree on where any path lives without a lookup table per key.
//
// The decoded seed is a tree. Every node whose JSON is bigger than LIMIT becomes a
// directory: `_ls.json` (its keys) plus `c<i>.json` chunks holding its children — a dict
// child goes to chunk fnv1a(key) % c, a list child to floor(i * c / n). Children that are
// themselves bigger than LIMIT recurse into their own directory instead. `_tree.json` at the
// root lists every directory node {t, n, c, split}, so the Worker resolves "which file holds
// this path" from one small map, then reads exactly one chunk.

export const LIMIT = 64 * 1024;           // bytes of compact JSON per shard, roughly
export const SEP = "/";                   // path separator in tool arguments: a/b/c

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(String(str))) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

// A key as a file-system / URL-safe path component (reversible, case-preserving; two keys
// that differ only in case are the only ones that could collide, and they'd need a
// case-insensitive disk to do it).
export function safe(k) {
  return String(k).replace(/[^A-Za-z0-9_-]/g, c => "_" + c.charCodeAt(0).toString(16).padStart(2, "0"));
}

export function splitPath(p) {
  return String(p ?? "").split(SEP).map(s => s.trim()).filter(Boolean);
}

export function dirOf(parts) { return ["seed", ...parts.map(safe)].join("/"); }

export function chunkIndex(rec, key) {
  return rec.t === "list" ? Math.min(rec.c - 1, Math.floor((Number(key) * rec.c) / rec.n)) : fnv1a(key) % rec.c;
}

// The deepest directory node on the way to `parts`: [prefixLength, record].
export function resolve(tree, parts) {
  let best = 0, rec = tree[""];
  for (let i = 1; i <= parts.length; i++) {
    const r = tree[parts.slice(0, i).join(SEP)];
    if (r) { best = i; rec = r; }
  }
  return [best, rec];
}

// Mirror of ecrNormName (src/js/60-rankings-data.js): the key the ECR, contract, dynasty
// and nflverse name tables are written under.
export function ecrNorm(s) {
  return String(s || "").toLowerCase().replace(/[.'\-]/g, "").replace(/\s+(jr|sr|ii|iii|iv|v)$/, "").replace(/\s+/g, " ").trim();
}
