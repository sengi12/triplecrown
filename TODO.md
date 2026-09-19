# TODO

Open work only. What shipped is in [CHANGELOG.md](CHANGELOG.md) (one line per merged PR).
Each item says what it needs so it can be picked up cold.

## Now

- **Tonight's live check (TNF).** The Game Center's live feed reads ESPN's scoreboard
  `situation.lastPlay`, verified only on a baseball game. During the game: run
  `tnf_shape.py` / `cdp_tnf.py` from the session scratchpad (or simply watch the feed),
  confirm `statYardage`, `start.shortDownDistanceText` and `athletesInvolved` arrive for the
  NFL, and fix the feed rows / per-league point deltas if the shape differs.
- **iOS build (free tier).** Install Xcode from the App Store, then CocoaPods
  (`brew install cocoapods`), then in `mobile/`: `npm install @capacitor/ios && npx cap add
  ios`, add the `com.sengi.triplecrown` URL type in Xcode (Info → URL Types), run in the
  Simulator, and on your own iPhone with a free Apple ID (Personal Team, re-signed weekly).
  TestFlight / App Store need the $99 program — see `mobile/README.md`.

- **Formation names that draw a shape they share (99 of 191).** The playsheet's catalogue
  gives several names one shape token and no distinguishing keyword, so they render the same
  picture: `Gun Heavy` / `Panther` / `Raven` / `Saint` are one token and three team nicknames
  `_mods()` has no rule for, and `Singleback Ace` / `Big` / `Deuce` likewise. Some pairs are
  legitimately identical (`Far Pro` and `Weak Pro` are the same alignment; a Power I offsets
  strong by default) — those need no work. The rest need a source for what each name actually
  looks like, then either a new shape token or a keyword in `_mods()`; do not guess an
  alignment from the nickname. `tools/formation_check.py --sheet` reports the distinct-shape
  count, and the groups are listed by comparing card signatures in the contact sheet.
- **`Singleback Bunch Ace` draws a tight-end pair, not a bunch.** 12 personnel has only two
  receivers, so its three bunch men must be the two receivers plus a tight end. `place()`
  lays attached ends outward from the tackle and receivers inward from the sideline, so the
  two ladders never cluster; putting the Y in the bunch means giving him a place in the
  receivers' ladder when that side is `bunched`. Also fixes `Gun Bunch Quads` in an empty set,
  where the back who split out widens the bunch to 7.7 yd.
- **`Gun Tackle Over Trips` runs out of field.** The sixth lineman slides the formation 22
  units out, leaving no room for three receivers and a flexed end, so the separation sweep
  moves someone 12 units. It is the card's geometry, not a placement bug — it needs a wider
  card (`W` in the playsheet's draw function) rather than different offsets.

- **Trade history is Sleeper-only, and its earlier seasons are behind a button.** The ledger
  (`src/js/99j-la-trade-history.js`) reads Sleeper's per-week transaction log; ESPN's adapter
  has no equivalent, so the section is off entirely for an ESPN snapshot. Two things could
  follow if they are wanted: the ESPN league-history endpoint, if it exposes trades; and
  loading the renewal chain automatically for a dynasty league rather than on the
  "+ earlier seasons" press — today the default read is the current season only, because the
  chain costs a full 18-leg sweep plus rosters and users per season.

## Live-season gaps that wait on post-season files

- **Coverage (man / zone, the shells) and the vs-man / vs-zone player splits.** The only
  free source is the participation file, which publishes after the season. No free weekly
  coverage data exists (FTN's weekly charting has blitzers and box counts, not coverage).
  The Advanced tab shows a pending card until then. Nothing to do for free.
- **Per-lineman OL grades in season.** Buildable from free weekly inputs: nflverse snap
  counts (who plays where), PFR's weekly passing file (team pressures allowed), the prior
  season's grades as a prior, and the pre-snap rookie model already in
  `src/nflverse/ol_grades_pipeline.py`. Add `ol_players` to `LIVE_NFLVERSE_PARTS`
  (`src/nflverse/inseason.py`) with a weekly-input path in `_ol_grades_by_player`. About a
  day's work; the OL card then shows the season in progress.

## Each February (the only hand-maintained inputs)

The refresh warns `⚠ … is stale` and the workflow opens one issue ("Refresh needs a hand").
- `HC_PLAYCALLERS` and `HC_PRIOR_JOBS` in `build_seed.py` — playcalling head coaches, and
  the former job of each new head coach.
- `ALLPRO_OL` in `src/nflverse/ol_grades_pipeline.py` — the All-Pro line.
- `data/espn_win_rates_<season>.csv` — ESPN's pass/run block win rates for the OL grades.
Then `gh workflow run refresh-seed.yml -f force=nflverse,ol`.

## Later

- **Yahoo leagues** need a server: Yahoo's API sends no CORS headers and its OAuth2 needs a
  client secret plus hourly refresh. Plan: one Supabase Edge Function for the code exchange,
  refresh and read-only proxying. Two gates first — Yahoo now approves API access per
  application and requires "Fantasy data provided by Yahoo Fantasy" attribution with their
  logo; and a Yahoo league would need sign-in plus a live connection, which breaks the
  local-first and baked-offline guarantees.
- **Own domain (AWS).**
- **Google Play Store** listing (the Android shell builds; store steps in `mobile/README.md`).
- **Apple App Store** (after the free-tier build above; $99 program + privacy policy).
- **Proprietary projections from all the metrics we have** — the TC model is the start
  (`projections/tc_model_research/`, era-split gate); next: measure and calibrate systematic
  under-projection (signed mean error / calibration slope per position and decile in
  `proj_eval.py`) and diagnose the QB `td_oe` construction.
- **ESPN league limits** (documented in the README): public leagues only, no cold username
  search, no pick capital, no dynasty flag. ESPN's cookie policy and undocumented endpoints;
  not fixable from our side.
