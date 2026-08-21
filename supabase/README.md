# League gateway — setup

The gateway is one Supabase Edge Function that lets TripleCrown read leagues a static page
cannot reach on its own. It is **provider-routed, not Yahoo-specific**, because the two
providers need it for different reasons:

| Provider | Needs the gateway? | Why |
|---|---|---|
| Sleeper | Never | Fully open and CORS-friendly. Always called direct. |
| ESPN — public league | No (fallback only) | ESPN reflects `Origin`, so the browser can call it directly. The gateway is insurance in case that changes. |
| ESPN — private league | Yes | `Cookie` is a forbidden header in `fetch()`; only a server can attach `espn_s2`. |
| Yahoo | Yes, always | Yahoo sends no CORS headers at all, and its OAuth requires a client secret. |

The client stays **direct-first**: it only falls back to the gateway when a direct call is
impossible (Yahoo), returns 401 with a stored credential (ESPN private), or fails outright
(ESPN CORS withdrawn). That keeps the local-first promise intact for the common case.

---

## 1. Yahoo app registration — the spike

Do this first; everything else depends on the answer.

1. Sign in at <https://developer.yahoo.com/apps/create/>.
2. Fill in:
   - **Application Name** — anything, e.g. `TripleCrown`
   - **Application Type** — *Web Application*
   - **Redirect URI(s)** — `https://<your-project-ref>.supabase.co/functions/v1/league-gateway/yahoo/callback`
     (must be HTTPS; Yahoo rejects plain HTTP)
   - **API Permissions** — tick **Fantasy Sports** → **Read**
3. Save. Copy the **Client ID** and **Client Secret**.

**The question the spike answers:** does a self-serve app still get the `fspt-r` scope, or
does Yahoo now gate it behind their application-review queue? Their docs moved to an
approval-based portal, but the self-serve creation page still exists — these may have
diverged. If the Fantasy Sports permission checkbox is present at step 2 and the test below
returns league data, we're clear.

### The 2-minute test

Once you have the Client ID, open this URL (substitute your values):

```
https://api.login.yahoo.com/oauth2/request_auth
  ?client_id=<CLIENT_ID>
  &redirect_uri=<YOUR_REDIRECT_URI>
  &response_type=code
  &scope=fspt-r
```

If Yahoo shows a consent screen naming **Fantasy Sports**, the scope is live. Approve it, and
Yahoo redirects with `?code=…`. Exchange it (this is the only step needing the secret):

```bash
curl -s -u "<CLIENT_ID>:<CLIENT_SECRET>" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=<YOUR_REDIRECT_URI>" \
  -d "code=<THE_CODE>" \
  https://api.login.yahoo.com/oauth2/get_token
```

Then confirm the token actually reads fantasy data:

```bash
curl -s -H "Authorization: Bearer <ACCESS_TOKEN>" \
  "https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl/leagues?format=json"
```

Your leagues coming back = spike passed. An `unauthorized_client` or a consent screen with no
Fantasy Sports line = the approval queue is real, and we plan around it.

**Verified already (no account needed):**
- Authorization endpoint: `https://api.login.yahoo.com/oauth2/request_auth`
- Token endpoint: `https://api.login.yahoo.com/oauth2/get_token`
- Grant types: `authorization_code`, `refresh_token`
- Client auth: `client_secret_basic` **or** `client_secret_post` — both accepted
- **No PKCE.** `code_challenge_methods_supported` is absent from Yahoo's OIDC discovery
  document, so there is no public-client flow. A confidential server leg is mandatory.
- Access tokens last 1 hour; refresh tokens are long-lived and may be rotated on use.

---

## 2. What I need from you in Supabase

Nothing here exposes a secret to the browser. All of it lives server-side.

1. **Enable Edge Functions** (included on the free tier — no action beyond having the CLI).
2. **Run `schema.sql`** in the SQL editor. Read the header first — it documents the threat
   model and the two access-control layers, and you should disagree with it now rather than
   after it holds credentials.
3. **Set these Edge Function secrets:**

   ```bash
   supabase secrets set YAHOO_CLIENT_ID=...
   supabase secrets set YAHOO_CLIENT_SECRET=...
   supabase secrets set TC_CRED_MASTER_KEY="$(openssl rand -base64 32)"
   ```

   `TC_CRED_MASTER_KEY` is the root of the envelope encryption. **It must never be written to
   Postgres** — that is the entire reason a database dump is worthless on its own. Keep an
   offline copy somewhere you'd keep a root key; losing it means every stored credential
   becomes undecryptable (recoverable only by users re-linking).
4. **Confirm your project ref** — `agnbcpczmrsoszdjxrqr`, from `src/js/86-supabase.js`. That
   determines the redirect URI above.
5. **Decide on `pg_cron`.** If your plan has it, schedule `tc_prune_credentials()` daily
   (one-liner at the bottom of `schema.sql`). If not, the gateway prunes opportunistically.

---

## 3. ESPN private leagues — the security design

Only relevant once you decide to support private ESPN leagues. Worth reviewing before I build
it, because the credential involved is materially nastier than Yahoo's.

### The asymmetry

| | Yahoo | ESPN |
|---|---|---|
| Credential | OAuth refresh token, scope `fspt-r` | `espn_s2` session cookie |
| Grants | Read fantasy data | The user's entire ESPN/Disney account |
| Scoped | Yes | No |
| User-revocable | Yes, at Yahoo | Only by logging out of ESPN everywhere |
| Expiry | 1 hour, refreshable | No fixed expiry |

Everything below is designed for the ESPN case. Yahoo uses the same machinery because there
is no reason to run two.

### Capture: the credential never enters app JavaScript

The obvious implementation — app reads the cookie, app POSTs it — puts an unscoped account
session inside the app's XSS blast radius. TripleCrown renders remote strings (team names,
league names, manager handles) that leaguemates control, so that radius is not zero even
though those paths are escaped today.

Instead:

```
app mints a single-use link token (10 min TTL)  ─────────────┐
                                                            │
user clicks the bookmarklet while on espn.com               │
  → reads ONLY document.cookie's espn_s2 and SWID           │
  → POSTs {link_token, espn_s2, SWID} to the gateway  ──────┘
      → gateway resolves token → user, encrypts, stores
```

The credential goes espn.com → gateway. It never touches TripleCrown's own JS, and there is
**no endpoint that returns it** — storage is write-only from the client's perspective. Any
future "show me my saved credential" feature would break this property; there must not be one.

Two details that matter:

- **The bookmarklet extracts by name, never the whole jar.** A dump of `document.cookie` on
  espn.com also contains `ESPN-ONESITE.WEB-PROD.token`, which carries a Disney OneID *refresh*
  token and the user's email. We need neither and must not capture either.
- **The bookmarklet ships unminified.** It is code we ask users to run on a logged-in banking-
  adjacent origin. It should be short enough that a suspicious user can read it in full before
  clicking, and that only works if we don't compress it.

### Storage: envelope encryption, not RLS

RLS is not a confidentiality control here — `service_role` bypasses it by design, so a leaked
service key would defeat it entirely. The real controls, in order:

1. **Grants revoked** from `anon` and `authenticated`, so PostgREST has no path to the table
   at all. This is the primary control, and it holds even if an RLS policy is later written
   wrong.
2. **AES-256-GCM envelope encryption** with the master key in Edge Function secrets, never in
   Postgres. A stolen database or backup yields ciphertext.
3. **Per-row key derivation** — HKDF-SHA256 over a random 16-byte salt — so one recovered data
   key unlocks one row rather than the table.
4. **AEAD additional data** binds each ciphertext to `key_version|user_id|provider`. A row
   copied to another user's `user_id` fails authentication instead of decrypting.
5. **RLS on anyway** as a backstop against a future migration re-granting access.
6. **90-day retention** on unused credentials, and a hard-delete "Disconnect ESPN" that
   removes the row rather than flagging it.

### What this does not protect against

Stated plainly, because a design that only lists its strengths isn't a security design:

- Compromise of the Edge Function runtime or its secrets yields plaintext. Mitigation is
  operational — keep the function's dependency surface at zero in the crypto path (Deno's
  Web Crypto only, no npm imports), rotate via `key_version`, and keep the function small
  enough to audit in one sitting.
- An operator holding both the database and the master key can decrypt. Nothing technical
  prevents that; it is the reason for aggressive retention limits and for storing the minimum.
- A compromised user endpoint at capture time.

### Operational rules for the function

- **Never log request or response bodies.** Credentials arrive in a POST body; a single
  `console.log(req)` would put an account session in Supabase's log retention.
- **Decrypt into a local, use, drop.** No caching of plaintext across requests.
- **Fail closed.** A decrypt failure deletes nothing and returns a generic error; it must not
  fall through to an unauthenticated upstream call that silently returns "league is private".
- **Rate-limit per user**, so a stolen app JWT cannot be used to enumerate leagues.
- **Tell users the real kill switch.** `espn_s2` has no third-party revocation, so the
  Disconnect button must say plainly: *this deletes our copy; to invalidate the credential
  itself, log out of ESPN everywhere.*

### The alternative worth considering

**Pass-through instead of storage:** keep `espn_s2` in the user's own browser, send it with
each gateway request, and have the gateway use it transiently and persist nothing. There is
then no credential database to breach at all.

The trade is real in both directions: it removes T1/T2/T8 entirely, but puts the credential
back into app-reachable storage (re-opening the XSS path the link-token design closes), and
it forecloses background refresh — which is the feature that makes the in-season tools work
when the app isn't open.

Recommendation: **store, with the design above**, because the capture path keeps the
credential out of the browser where pass-through cannot. But it is a genuine fork and worth
your call rather than mine.
