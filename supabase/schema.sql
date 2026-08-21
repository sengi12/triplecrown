-- ═══════════════════════════════════════════════════════════════════════════════
-- TripleCrown league gateway — credential storage
-- ═══════════════════════════════════════════════════════════════════════════════
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
--
-- WHAT THIS STORES
--   Per-user, per-provider credentials the league gateway needs to read a league on the
--   user's behalf:
--     • yahoo — an OAuth 2.0 refresh token (scope fspt-r: read fantasy, nothing else)
--     • espn  — the espn_s2 + SWID cookies for a PRIVATE league
--
--   These are NOT equivalent in sensitivity and the code must not treat them as such.
--   A Yahoo refresh token is scoped and the user can revoke it at Yahoo. espn_s2 is an
--   unscoped session credential for the user's whole ESPN/Disney account with no
--   third-party revocation UI — the only kill switch is "log out of ESPN everywhere".
--   That asymmetry is why everything below is built for the ESPN case; Yahoo rides along.
--
-- THREAT MODEL — what this design does and does not defend against
--   Defended:
--     T1  Database dump / stolen backup ....... ciphertext only; the key is not in Postgres.
--     T2  Leaked service_role key ............. still needs TC_CRED_MASTER_KEY, which lives
--                                               only in Edge Function secrets.
--     T3  PostgREST misconfiguration .......... table is not exposed to anon/authenticated
--                                               at all (grants revoked), so the REST API
--                                               cannot see it even if RLS were wrong.
--     T4  Cross-tenant read (user A → B) ...... RLS + AEAD additional-data binding: a row
--                                               moved between users fails to decrypt.
--     T5  XSS in the TripleCrown app .......... the credential never enters app JavaScript.
--                                               Capture goes espn.com → gateway directly;
--                                               there is no endpoint that returns it.
--     T6  Stale-credential accumulation ....... rows unused for 90 days are deleted.
--   NOT defended (be honest about these):
--     T7  Compromise of the Edge Function runtime or its secrets — that yields plaintext.
--         Mitigation is operational: minimal function surface, no third-party imports in
--         the crypto path, secret rotation, and key_version to make rotation cheap.
--     T8  A malicious operator with both the DB and the master key. Nothing technical
--         prevents this; it is why we store as little as possible for as short as possible.
--     T9  Endpoint compromise on the user's own machine at capture time.
--
-- CRYPTO
--   Envelope encryption, AES-256-GCM.
--     master key   TC_CRED_MASTER_KEY — 32 random bytes, base64, Edge Function secret only.
--     per row      salt (16B random) → HKDF-SHA256 → a distinct 256-bit data key.
--     AEAD AAD     "<key_version>|<user_id>|<provider>" — binds the ciphertext to its owner
--                  and provider, so a row cannot be replayed under another identity.
--     nonce        12B random, never reused (new nonce on every write).
--   Rationale for per-row derivation rather than one key: a single leaked data key unlocks
--   one row, not the table, and rotation can proceed row by row under key_version.
-- ═══════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

create table if not exists tc_league_credentials (
  user_id       uuid        not null references auth.users(id) on delete cascade,
  provider      text        not null check (provider in ('yahoo','espn')),

  -- Envelope-encrypted payload. Never a plaintext column, and never selected by the client.
  key_version   smallint    not null default 1,
  salt          bytea       not null,          -- HKDF salt, 16 bytes
  nonce         bytea       not null,          -- AES-GCM IV, 12 bytes
  ciphertext    bytea       not null,          -- AES-256-GCM output incl. 16-byte tag

  -- Non-secret metadata. Deliberately enough to run the feature and audit it, and no more.
  -- Nothing here can be used to authenticate to ESPN or Yahoo.
  label         text,                          -- e.g. the ESPN display name the user picked
  last_used_at  timestamptz,
  last_ok_at    timestamptz,                   -- last time upstream ACCEPTED the credential
  fail_count    smallint    not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  primary key (user_id, provider)
);

comment on table tc_league_credentials is
  'Envelope-encrypted per-user league credentials. Written and read ONLY by the league-gateway '
  'Edge Function via service_role. Never exposed through PostgREST; see revoked grants below.';

-- ── Access control ────────────────────────────────────────────────────────────
-- Two independent controls, deliberately redundant.
--
-- (1) GRANTS. This is the primary control. Supabase exposes tables through PostgREST using
--     the anon/authenticated roles; revoking every privilege means the REST API has no path
--     to this table at all, regardless of what RLS says. service_role (used only by the Edge
--     Function, whose key never reaches a browser) retains access.
revoke all on table tc_league_credentials from anon, authenticated;

-- (2) RLS. service_role bypasses RLS by design, so this is NOT what protects the table — it
--     is a backstop against a future migration accidentally re-granting access. Policy is
--     scoped to the owning user and covers reads only; writes stay server-side.
alter table tc_league_credentials enable row level security;

drop policy if exists "own credentials only" on tc_league_credentials;
create policy "own credentials only"
  on tc_league_credentials for select
  to authenticated
  using (auth.uid() = user_id);

-- ── Capture handoff (link tokens) ─────────────────────────────────────────────
-- The ESPN bookmarklet runs on espn.com and therefore cannot read the app's Supabase
-- session (different origin). Rather than route the credential through app JavaScript —
-- which would put an unscoped account session inside the XSS blast radius — the app mints a
-- short-lived, single-use link token. The bookmarklet posts {link_token, espn_s2, SWID}
-- straight to the gateway, which resolves the token to a user and stores the ciphertext.
--
-- Only a SHA-256 hash of the token is stored, so a dump of this table cannot be replayed.
create table if not exists tc_link_tokens (
  token_hash  bytea       primary key,          -- sha256(token); the token itself is never stored
  user_id     uuid        not null references auth.users(id) on delete cascade,
  provider    text        not null check (provider in ('yahoo','espn')),
  expires_at  timestamptz not null,
  used_at     timestamptz,                      -- non-null = spent; single use enforced here
  created_at  timestamptz not null default now()
);

comment on table tc_link_tokens is
  'Single-use, short-lived (10 min) handoff tokens that let the ESPN bookmarklet post a '
  'credential to the gateway without the credential passing through app JavaScript.';

revoke all on table tc_link_tokens from anon, authenticated;
alter table tc_link_tokens enable row level security;

create index if not exists tc_link_tokens_expiry on tc_link_tokens (expires_at);

-- ── Atomic failure counter ────────────────────────────────────────────────────
-- PostgREST cannot express `fail_count = fail_count + 1`, and a read-modify-write from the
-- Edge Function would lose increments under concurrency. A credential that upstream keeps
-- rejecting is a signal worth trusting, so the increment is done in the database.
create or replace function tc_note_credential_failure(p_user uuid, p_provider text)
returns void
language sql
security definer
set search_path = public
as $$
  update tc_league_credentials
     set fail_count = least(fail_count + 1, 32767)
   where user_id = p_user and provider = p_provider;
$$;

-- Callable only by the gateway (service_role), never by a signed-in browser.
revoke all on function tc_note_credential_failure(uuid, text) from public, anon, authenticated;

-- ── Rate limiting ─────────────────────────────────────────────────────────────
-- Closes the gap noted in the security document: without this, a stolen app JWT could be used
-- to drive the proxy at whatever rate the attacker liked — hammering ESPN or Yahoo from our
-- IP, with our reputation, using someone else's stored credential.
--
-- A fixed window rather than a sliding one, deliberately. A sliding window needs per-request
-- history; a fixed window needs one row per user per bucket and can be enforced in a single
-- atomic statement. The cost is that a caller can burst up to 2× the limit across a window
-- boundary, which is irrelevant here — the goal is to stop sustained abuse, not to meter
-- billing.
create table if not exists tc_rate_limit (
  user_id       uuid        not null references auth.users(id) on delete cascade,
  bucket        text        not null,           -- e.g. 'espn.read'
  window_start  timestamptz not null default now(),
  count         integer     not null default 0,
  primary key (user_id, bucket)
);

revoke all on table tc_rate_limit from anon, authenticated;
alter table tc_rate_limit enable row level security;

-- Take one token. Returns true if the caller may proceed, false if they are over the limit.
--
-- The whole decision is ONE statement, so concurrent requests cannot both read "count = 9"
-- and both proceed. `insert … on conflict do update` locks the row for the duration; the
-- window reset and the increment happen inside that same lock.
create or replace function tc_rate_take(
  p_user     uuid,
  p_bucket   text,
  p_limit    integer,
  p_window_s integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into tc_rate_limit (user_id, bucket, window_start, count)
       values (p_user, p_bucket, now(), 1)
  on conflict (user_id, bucket) do update
      set count        = case
                           when tc_rate_limit.window_start < now() - make_interval(secs => p_window_s)
                           then 1                              -- window expired: start over
                           else tc_rate_limit.count + 1
                         end,
          window_start = case
                           when tc_rate_limit.window_start < now() - make_interval(secs => p_window_s)
                           then now()
                           else tc_rate_limit.window_start
                         end
    returning count into v_count;

  return v_count <= p_limit;
end $$;

revoke all on function tc_rate_take(uuid, text, integer, integer) from public, anon, authenticated;

-- ── Retention ─────────────────────────────────────────────────────────────────
-- A credential nobody has used in 90 days is a liability with no benefit. Same logic for
-- spent or expired link tokens, which are worthless within minutes.
--
-- Call from pg_cron if available, or from the gateway on a sampled basis.
create or replace function tc_prune_credentials()
returns void
language sql
security definer
set search_path = public
as $$
  delete from tc_link_tokens
   where expires_at < now() - interval '1 day';
  delete from tc_league_credentials
   where coalesce(last_used_at, created_at) < now() - interval '90 days';
  delete from tc_rate_limit
   where window_start < now() - interval '1 day';
$$;

-- Enable if the pg_cron extension is available on your plan:
--   select cron.schedule('tc-prune-credentials', '0 4 * * *', $$select tc_prune_credentials()$$);

-- ── Bookkeeping ───────────────────────────────────────────────────────────────
create or replace function tc_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists tc_league_credentials_touch on tc_league_credentials;
create trigger tc_league_credentials_touch
  before update on tc_league_credentials
  for each row execute function tc_touch_updated_at();
