# <img src="images/app-icon.png" align="left" width="120" style="margin-right: 10px;">

# <span style="color:#1599E6">Triple</span>Crown

# <div style="clear: both;"></div>


**Build your own NFL season projections, then draft from them.**

TripleCrown is a self-contained fantasy football projection tool. Instead of trusting someone else's rankings, you build the season yourself — team by team, slider by slider — and the app turns your projections into live draft rankings entirely from your browser. Highly configured to function well on both desktop and mobile.

---

| | |
|:--:|:--:|
| <img src="./images/rec_mobile.png" width="330"> | <img src="./images/receiving.png" width="660"> |

## What it does

- **Team-by-team projections.** For each of the 32 NFL teams, set QB passing volume, then distribute targets, receptions, receiving yards, and rushing work across the roster with pie-chart sliders. Everything is editable inline — type a number and the rest rebalances.
- **QB games model.** Each QB has a games-played slider (0–17) that drives their pace. A QB set to 0 games contributes nothing to team totals but keeps their per-game rate, so backups and committees behave sensibly.

<!-- Center align -->
<div align="center">
  <img src="./images/passing.png" alt="Centered Image">
</div>

- **Rankings that follow your scoring.** Your projections become a ranked player board scored by your league's exact settings. Switch between **Full PPR, Half PPR, Standard, Superflex, and Dynasty** — each applies the right scoring *and* pulls the matching FantasyPros Expert Consensus Ranking (ECR) and tier. Change the reception value directly and the format label follows.
- **Link a Sleeper league to auto-detect scoring.** Enter your Sleeper username, pick a league, and TripleCrown reads its scoring settings and format directly — points per reception, yardage values, superflex/dynasty detection — and applies them to the rankings for you.
- **Dynasty contract columns.** In Dynasty mode, the rankings add **Age / APY / Free-Agency year** per player (from OverTheCap). A player whose contract expires next season is highlighted in red — a quick read on who's about to change situations.
- **Advanced metrics on the board.** On the Full Rankings page you can flip the stat columns to per-player **advanced metrics** (EPA, YPRR, success rate, target share, box counts, and more) for any completed season, and a **Situational** dropdown re-cuts them by game situation — Red Zone, When Leading/Trailing, vs. Man/Zone, Play-Action, box-count splits, and so on. Per-position minimum-volume filters keep small samples from cluttering the board.

<!-- Center align -->
<div align="center">
  <img src="./images/rankings.png" alt="Centered Image">
</div>

- **Advanced Stats.** A read-only advanced statistics tab surfaces last season's team-level analytics from Warren Sharp — offensive and defensive line, pace, personnel, tendencies, and coverage. Every stat is league-ranked and color-coded best→worst, per team and league-wide. This is reference context to inform your projections; it never changes them.
- **Strength of schedule.** Each team shows its upcoming-season SOS rank and Vegas win total, plus a league-wide SOS chart.
- **Coaching staff & scheme carryover.** Every team surfaces its head coach (live from ESPN), flags head coaches who call their own plays, and lists the current offensive/defensive coordinators. When a coordinator (or a play-calling head coach) is new this season and came from another team, TripleCrown carries over that former team's scheme tendencies as a forecast — because scheme travels with the play-caller.

<!-- Center align -->
<div align="center">
  <img src="./images/adv_stats.png" alt="Centered Image">
</div>

- **Roster changes.** A per-team **Roster Changes** tab pulls the offseason's free-agent signings, draft picks, trades, and notable free-agent losses derived from nflverse rosters, draft picks and trades — sorted by contract value — so you can see how a team addressed last season's weaknesses (and where new holes may have opened). The same tab also renders the team's current **depth chart** — ordered starters → backups by position slot, live from ESPN.

<!-- Center align -->
<div align="center">
  <img src="./images/roster_changes.png" alt="Centered Image">
</div>

- **Reference past seasons.** Click any prior season to view real stats, read-only, without touching your working projections. A **week-range slider** lets you filter a player's stats to a stretch of games — e.g. a receiver's hot start before an injury — and see how they compared to the rest of the team over just those weeks.
- **Copy last season into your working set.** Pull a team's (or a single player's) prior-season line into your current projections as a starting point, with per-team **undo**.

<!-- Center align -->
<div align="center">
  <img src="./images/rushing.png" alt="Centered Image">
</div>

- **Live draft follow.** Point it at a Sleeper draft (or one-tap link the league you already synced in the League Analyzer) and drafted players are hidden from your board in real time — hide-drafted is on by default for a clean board. A glowing **LIVE** pill keeps the follow out of your way until you tap it (being on the clock always shows), pick lines mark exactly where your turns land, a sortable **ADP** column (matched to your scoring format's market board) sits beside your ranks, and the roster tracker is a slide-up drawer: drag it open, keep pulling to maximize, flick down to close.
- **VOR and VONA roster advice.** Your projections drive VOR (Value Over Replacement — what a player is worth against what's left at his position under your league's exact lineup) and VONA (Value Over Next Available — a Monte-Carlo sim of the picks before your next turn, using the market's ADP for your format). The on-the-clock advisory ranks positions by what the pick does for your weekly starting lineup — value added now vs what the position is expected to hand you at your next turn — under a pick budget that weighs every remaining pick against unfilled starters, RB/WR depth, and your K/DEF slots, so following the headline never strands a roster hole (the decision core is tuned and validated by full mock-draft Monte Carlo in `tools/draft_sim.py`, which can also replay the advisory itself via `--strategy`). **Within a position it will not let you reach.** The named player is chosen over two picks rather than straight off your board: if your #1 there would still be sitting at your next turn and your #2 would not, it names the #2 and lets the other come back to you — the cost of reaching is simply the value you forfeit at your next pick, so no arbitrary "reach penalty" is needed. Each position row shows that pick with headshots, its ADP against the pick you're on, the odds the player makes it back to you, and a ▾ popover listing the next viable options. On a desktop-width screen the same advice renders as a **suggestions list** — one card per player, a position filter to browse a position's own board, and a take-now / can-wait verdict — instead of the compact rows a phone needs. **Those odds read the room, not just the market.** ADP is a national average and the twelve people in front of you are not — in this sample's superflex leagues 5.8 quarterbacks go in round one where the 2QB board says three — so the advisory measures how far ahead of the board each position is actually running and prices the rest of that position accordingly, with a dead zone so an ordinary room's wobble doesn't move anything. In mock drafts against rooms calibrated to real league history this cuts the survival model's error at the hoarded position from +10.4pp to +2.7pp (a single-QB room chasing RBs) and from +6.2pp to −1.6pp (superflex QBs), and when a row's odds move for this reason it says so ("room 8 picks ahead here"). **And the room model no longer starts from zero:** when the league you're following has past drafts, the app walks its `previous_league_id` chain in the background, summarizes each completed draft (cached locally — past drafts never change), and seeds the drift with the room's own history — "this room takes its sixth QB by pick 30" is known at pick one, worth a few pseudo-picks of evidence, and outvoted by the live room as real picks land. The Draft plan's mock opponents draft with the same habit, and its header says so. **The odds are also conditioned on the board you can see and calibrated against real drafts.** A player still sitting twenty picks past his ADP is evidence, not an accident: pretending the draft hasn’t started priced fallers at "3% he’s back" when, across 116 real 2026 drafts, the answer was ~45% — the availability model now computes survival *given he’s still there*, with a fitted allowance for players whose ADP anchor is simply wrong for this room. Scored leave-one-out on that corpus (`tools/draft_corpus.py score`), this cuts the survival model’s Brier error by ~40% in both 1QB and superflex and takes its bias from −19 points to −2. **And the calibration re-trains itself**: the parameters are not frozen at this year’s hand fit — a weekly CI step (`tools/draft_corpus.py refresh`) re-crawls newly completed drafts, re-fits, and writes `seeds/market_model.json`, which `build_seed.py` bakes into the seed and both the app and the sim adopt within hard bounds (a thin corpus or an out-of-bounds fit changes nothing). ADP itself already rides the daily seed refresh, and the in-draft drift correction reads each live room — so all three timescales of market movement (daily prices, seasonal behaviour, this room right now) stay current without anyone retuning constants.

| | |
|:--:|:--:|
| <img src="./images/vor.png" width="330"> | <img src="./images/live_draft.png" width="660"> |

- **Cloud save + projections manager (optional).** Sign in to save your projection scenarios to Supabase, then load, delete, and drag-to-reorder them in a built-in manager. If you never sign in, everything continues to work locally in-session as usual.
- **Player Notes + stat tagging.** Add notes on any player card and tag important stats directly from rankings/cards into those notes so your own scouting context stays attached to the player.
- **Rankings productivity tools.** Use built-in player search, switch imported analysts when multi-analyst files are loaded, and launch the KeepTradeCut game overlay from the Rankings view.
- **League Analyzer controls.** Sync **Sleeper or ESPN** leagues into explicit snapshots, re-sync on demand, and switch leagues from the menu while keeping all analyzer views tied to the same snapshot context. Whichever platform a league lives on, every player, stat and projection still comes from Sleeper — a linked league contributes only its own teams, owners, rosters, scoring and lineup slots.
- **In-season suite (appears automatically once the NFL season kicks off).** The app tracks Sleeper's NFL state (season, phase, week), and when the regular season starts two things happen. The projections view gains a **Live** toggle — the current season's actual stats to date as a read-only reference season (red-zone and air-yard columns, injury designations, and an opt-in **Δ proj** column showing each player's pace against the projections frozen at kickoff, so you can edit all season without moving your own goalposts). And the League Analyzer gains one **Season** tab holding four panes behind Sleeper-style icon chips: **Matchup** (live weekly scoreboard, your matchup featured, auto-refreshing during games), **Lineup** (optimal lineup vs your set starters, blending your projections with season and recent form, adjusted for opponent defense-vs-position and injuries), **Defense** (each defense's fantasy points allowed per game vs QB/RB/WR/TE, scored under *your league's* settings), and **Trends** — Sleeper-style ranked boards for weekly risers/fallers, pace vs projection, raw opportunity, TD-regression candidates built on real red-zone volume, **team tendencies** (who's passing more lately, whose offense is heating up or going cold by EPA), and a **rest-of-season outlook** that re-projects every player from form, remaining schedule and injury status. Advanced weekly data ships in a small in-season sidecar rebuilt weekly by CI from nflverse and retired automatically each offseason.

| | |
|:--:|:--:|
| <img src="./images/la_mobile.png" width="330"> | <img src="./images/la_pc.png" width="660"> |

- **Injury-aware everywhere.** Sleeper injury designations (Q/D/OUT/IR/SUS/PUP) badge player names across the app; tapping one opens a knowledge-book popup with a typical timetable for that injury type — and when a concrete timeline has been reported ("out 4–6 weeks", "out until Week 12") the popup shows *that* instead of an estimate. Season-ending IR is detected even when the structured feed misses it, by scanning ESPN news headlines.
- **A UI that stays out of the way.** Methodology and source notes live behind small ⓘ buttons (popups that stay in the window) instead of paragraphs in the layout; sliders compress to realistic ranges so small values are actually draggable (a 30% target share reads as a nearly-full bar — typed values above the visual cap still work); warnings like vacated production and receiver-vs-QB mismatches are compact flag icons whose popups keep the one-click reconcile actions; roster changes and the QB room fold into collapsible blocks; **Cmd/Ctrl+Z** fires undo with a toast naming what it reverted. Scrolling is contained — popups and cards never scroll the page behind them, and iOS doesn't rubber-band.
- **Schedule on every team view.** For the current season, a week-by-week opponent rail (colored by Vegas win totals) rides the top of Passing/Receiving/Rushing/Adv Metrics — tap any opponent to jump to that team *in the same view*.
- **Player Cards.** Every Player has a back story as to how they got here and the best way to see that summarized is in their player card. Here you'll find a summary of their current contract, draft selection and past performance with the added bonus of being able to see their college per game stats as well. Their pro gamelogs are color-graded per game and label playoff weeks by round (WC / DIV / AFC / NFC / SB).

<!-- Center align -->
<div align="center">
  <img src="./images/player_cards.png" alt="Centered Image" width="600">
</div>

- **Passing Charts.** Every QB has strengths and weakness and it can difficult to determine what those are when just looking at raw fantasy totals at the end of each week. Introducing Passing Charts attached to every QB's player card where you can visually see how a QB performs doing what matters most for fantasy and see beyond the fantasy point totals.

<!-- Center align -->
<div align="center">
  <img src="./images/pass_chart.png" alt="Centered Image" width="600">
</div>

- **Route Trees.** Every Player that was targeted on routes in the past five seasons has a dedicated tab on their player cards that showcases their route trees. This feature shows what routes receivers tend to run more as they progress in their careers and adds more context to routes run as well as target totals to really showcase what type of receiver this player is.

<!-- Center align -->
<div align="center">
  <img src="./images/route_tree.png" alt="Centered Image" width="600">
</div>

- **Rushing Fans.** A Major aspect of fantasy football, and the sport itself, that is often overlooked is the offensive line. Although available data for individual OL performance is poor, I created an ever evolving +/- algorithm that hands out rush and pass block grades to every qualifying offensive linemen so that you can see clearly how offensive line talent, performance, entanglement, and health directly affects key areas of the run and pass game with every rusher's rushing fan chart!

<!-- Center align -->
<div align="center">
  <img src="./images/rushing_fan.png" alt="Centered Image" width="600">
</div>

- **Playbooks.** Every team has been had their personnel groupings, formations, run success rates vs gaps and route concepts mapped into trends in this new visualization tool which allows you to see all the different passing and rushing concepts that these teams rely on in different situations in game!

<!-- Center align -->
<div align="center">
  <img src="./images/playbook.png" alt="Centered Image">
</div>

---

## Quick start

**Just want to use it?** Open `index.html` in any modern browser. On first load it pulls the current season's live projections from Sleeper (the season is detected from Sleeper's NFL state — no yearly code changes). That's it.

For the full experience (expert rankings, contracts, advanced stats, coaching, roster changes, prior-season history), build a **seed** — see below.

---

## The project files

| File | What it is |
|------|-----------|
| `index.html` | The entire app, as one self-contained file. Open it in a browser. **Generated from `src/` — don't hand-edit it; edit `src/` and run `python build.py`.** |
| `src/` | The editable source: `src/css/*.css` + `src/js/*.js` (split by feature) and `src/index.template.html` (the shell). |
| `build.py` | Concatenates `src/` back into `index.html`. Output is byte-identical to a hand-edited single file — the shipped app is unchanged. Add `--dev` for a developer build that includes the 📦 Seed loader button and other developer-only UI. |
| `build_seed.py` | Run locally to fetch all the data and produce `triplecrown_seed.json`. |
| `bake_seed.py` | Embeds a seed directly into the HTML for a phone-friendly, offline copy. |
| `tools/draft_sim.py` | Monte-Carlo mock-draft simulator that tunes and validates the app's on-the-clock advisory. `--proj` swaps in an analyst projection file as the value baseline. |
| `tools/draft_history.py` | Scores every past manager-season in a league's history on what its draft-day roster really did, so "what wins here" is measured rather than assumed. |
| `tools/draft_playbook.py` | Drives the other two and writes one markdown playbook for one league and one seat. |
| `tools/draft_corpus.py` | Harvests real completed Sleeper drafts (league → managers → their leagues), fits the market model to them — sigma curve, K/DEF timing, QB volume — and Brier-scores the advisory's survival predictions against held-out drafts. |

> **Why a build step?** The app ships as one file on purpose (works offline from `file://`, bakes onto a phone, zero runtime dependencies). That's great for *users* but unwieldy to *edit*, so the source lives split under `src/` and `build.py` (Python 3 stdlib, no installs) reassembles it. It's plain concatenation — everything stays in one shared scope, so the app and test suite behave exactly as before. `run_tests.sh` rebuilds from `src/` automatically, and `python build.py --check` verifies `src/` matches the committed `index.html`. The default build is the normal user-facing app; `python build.py --dev` keeps the manual 📦 Seed loader and other developer-only UI.

---

## Building a seed (recommended)

The app can pull live projections and a few live stats on its own, but several sources **can't be fetched from the browser** — FantasyPros, OverTheCap, Warren Sharp, SumerSports, Wikipedia and nflverse aren't reachable from client-side JavaScript (CORS). The seed builder runs on your own machine, where there's no such restriction, and bundles everything into one file.

```bash
python build_seed.py                    # current-season projections + last 5 seasons of stats + all reference data
python build_seed.py --season 2027      # override the projection season (defaults to Sleeper's NFL state)
python build_seed.py --history 5        # how many prior seasons of stats to bundle
python build_seed.py --refresh sleeper  # re-download one source by name; repeat/comma-separate for more
python build_seed.py --refresh-all      # ignore caches and re-download everything
```

Refresh is per-source — each name maps to one upstream site/API, and anything not named
stays cached: `sleeper`, `ecr`, `dynasty`, `ktc`, `contracts`, `sharp`, `sos`,
`coordinators`, `roster_moves`, `sumer`, `nflverse`, `cfb` (see `--help` for what each covers).

It fetches, in order:

1. Sleeper player database
2. Season projections
3. Historical stats (last N seasons, including red-zone opportunities and air yards)
4. Per-team QB weekly splits (so traded QBs land on the right team)
5. FantasyPros ECR — all formats
6. OverTheCap contracts for every position (age / APY / total value / guaranteed / free-agency year)
7. Warren Sharp advanced stats (offense + defense) and strength of schedule
8. SumerSports per-player advanced metrics + situational splits (past seasons, QB/RB/WR/TE)
9. NFL coordinators and head coaches (Wikipedia), plus a maintained play-calling-HC list
10. nflverse offseason roster changes (free agency, draft, trades, losses)

Output: **`triplecrown_seed.json`** (plus optional sidecars `triplecrown_seed.def_weekly.json` and `triplecrown_seed.coaching.json` for lazy nflverse sections). Requires only Python 3 standard library — no pip installs. Runs are cached in `cache/`, so re-runs are fast; use `--refresh <source>` (or `--refresh-all`) to force a re-download.

**Load it into the app** by placing it next to `index.html` when hosted over http(s) — it auto-loads on page open. (Manual seed-loading is developer-only: a `python build.py --dev` build adds a 📦 Seed button for loading a `triplecrown_seed.json` by hand; the normal build omits it since hosted copies auto-load the seed.)

---

## Working out a draft strategy

Three command-line tools under `tools/` answer the strategy question the app faces
live, and they answer it from *your* league rather than from received wisdom. Each
is stdlib-only and each is useful alone, but they are built to chain.

### 1. What has actually won your league — `tools/draft_history.py`

Walks a league's `previous_league_id` chain and, for every manager-season it finds,
rebuilds the draft as a shape (which positions, which rounds) and scores it against
what really happened. The scoring matters: each drafted player is valued on his real
end-of-season stats under **that league's own settings**, and only the draft-day
roster is counted — waivers and trades are held out — so what comes back is what
the *draft* was worth, not what the manager did afterwards. Results are converted to
a percentile within each room before pooling, so a 10-team standard league and a
12-team PPR superflex league can sit in one table.

```bash
python3 tools/draft_history.py --league <league_id> --redraft-only
python3 tools/draft_history.py --user <sleeper_user_id> --redraft-only --split-format
```

It reports whether the champion won the draft or won the season some other way, the
share of each lineup's points that came from each block of rounds, hit rate by round,
and outcome broken out by opening pattern, by RB/WR count in the first six rounds,
by when the first QB and TE went, and by draft slot.

### 2. Draft off the analysts' board — `tools/draft_sim.py --proj`

The simulator can now take an external projection file as its value baseline:

```bash
python3 tools/draft_sim.py --league <league_id> --slot 5 --sims 2000 \
  --proj path/to/projections.json --proj-analyst consensus
```

The file is keyed by Sleeper `player_id` with one row per analyst; `consensus`
averages every analyst who projected that player, or name one to use them alone.
Those stat lines then replace the seed's for everyone they cover, and the players
they *don't* cover are rescaled per position onto the same scale by the median
ratio across the overlap — so the deep board stays comparable with the top of it
instead of quietly ranking above or below it. Because the board is what VOR and
VONA are computed from, this makes every downstream number an expression of what
the analysts project. Consensus rows also carry the analysts' spread, which is a
usable proxy for how contested a player's outlook is.

`--tc-weight 0` uses the projections alone; the default `0.5` blends them with the
TC model exactly as the app's `tcPts` does.

**Format awareness.** The simulator picks the ADP board the room actually drafts
off — `adp_2qb` for superflex/2QB, otherwise the column matching the scoring —
the same rule as `adpFor()` in `src/js/60-rankings-data.js`, and it models a
`SUPER_FLEX` slot as a slot a quarterback can start in: replacement level is set
after the superflex slots are consumed (with the app's 2.3-QB-per-team floor),
the second QB counts toward the starting lineup, and league-wide flex demand is
spread over four positions rather than three. Without that a superflex board
prices quarterbacks off the 1QB replacement level, which reads as "wait on QB" in
exactly the format where waiting is worst — in a 12-team superflex room it moves
the QB1 from +53 VOR to +154, and the simulated agent from taking its first QB in
round 13 to round 4.

### 3. The playbook — `tools/draft_playbook.py`

Ties the two together into one page for one league and one seat:

```bash
python3 tools/draft_playbook.py --league <league_id> --slot 5 \
  --proj path/to/projections.json --sims 400 --out playbook.md
```

It reads that league's history, builds the board from the projections under the
league's scoring, forces every opening pattern onto the same simulated rooms
(common random numbers, so the differences are the strategy's and not the RNG's),
lets the advisory's decision core draft freely for comparison, and writes: what has
won in that room, whether the opening pattern is worth committing to, the
round-by-round positional plan the agent converges on, per-pick targets with the
odds each one survives to the next turn, and the players this market prices above
and below what the board says they are worth.

Every number is computed at run time from that league's data. Point it at a
different league, seat, or projection source and the advice moves with it.


---

## Hosting for beta / sharing

Because it's a static site, hosting is trivial and free. **GitHub Pages** is the tightest fit:

1. Create a **public** repo.
2. Upload `index.html` plus `triplecrown_seed.json` to the repo root.
3. (Optional) add an empty `.nojekyll` file to the root.
4. **Settings → Pages → Source: `main` / `root` → Save.**
5. Wait ~1–2 minutes; your site is live at `https://<username>.github.io/<repo>`.

Served over `https://`, the browser can fetch `triplecrown_seed.json` normally (no CORS block), so your data auto-loads. Your update loop becomes: run `build_seed.py` → commit the new `triplecrown_seed.json` → Pages republishes automatically.

> Vercel (drag-and-drop a folder at vercel.com) works equally well if you prefer it.

---

## Using it on a phone, fully offline

Opening the HTML directly from a phone uses the `file://` protocol, where browsers block `fetch()` — so the app can't auto-load a seed sitting next to it. The fix is to **bake** the seed into the HTML itself:

```bash
python bake_seed.py
# reads ./triplecrown_seed.json + ./index.html → writes index_baked.html
```

AirDrop or email `index_baked.html` to your phone and open it. Projections, history, ECR, contracts, advanced stats, coaching, and roster changes are all embedded — zero network requests, works offline. (A baked file is a snapshot; re-run `bake_seed.py` after building a fresh seed.)

---

## Testing the in-season tools in the offseason (time machine)

Every in-season feature keys off one clock — Sleeper's NFL state (season · phase · week). The time machine builds a seed as if it were a past regular-season week and freezes that clock, so Live/Pace, the Matchup/Lineup/DvP/Trends tabs, the in-season sidecar and the live season stats all light up against a real season:

```bash
python build_seed.py --as-of 2025:10 --out-dir seeds_tm    # "it is 2025, week 10" (weeks 1–9 complete)
python tools/preview.py --seeds seeds_tm                    # hosted: http://localhost:8080/
python bake_seed.py --seed seeds_tm/triplecrown_seed.json --out index_tm.html   # or a phone copy
```

What the frozen build does: the projection season is 2025 (Sleeper's 2025 preseason projections, so Pace compares real 2025 actuals to real 2025 projections), the state block is `{season:2025, season_type:"regular", week:10, frozen:true}`, the in-season sidecar carries only weeks 1–9 (schedule stays whole — future opponents are the point), and in the app the live Sleeper state probe is skipped while every live pull for the frozen season (season totals, per-player weekly lines) is cut at the completed weeks, so nothing from week 10 onward leaks in. League sync lists your **2025** leagues, so Matchup shows that league's real week-10 scoreboard and Lineup your real week-10 roster. A ⏱ TIME MACHINE chip sits at the bottom of the screen so the copy can't be mistaken for the live app. `--out-dir` keeps `seeds/` (what CI deploys) untouched; the in-season sidecar in `seeds/` is governed by CI, not by this build.

The in-season sidecar (`triplecrown_seed.inseason.json`, rebuilt weekly by CI during the season) also carries a **live nflverse block** for the season in progress — team tables, per-player advanced tables, route trees, QB passing zones, RB rushing fans, rosters and OL weekly — so the player-card charts, the projection view's Advanced tab and the rankings' Adv. Metrics show *this* season to date ("2026 · wk 9") next to the completed seasons, and the time machine truncates all of it to the frozen week.

Not time-travelled (these are "now" data with no history): ECR, contracts, KTC/dynasty values, Sharp/SoS tables, coordinators and New Additions, the Sleeper player DB (current teams, injury designations, vacated-production notes), ESPN head coaches, and the NGS/PFR season-total columns inside the team tables. Use them as UI fixtures, not as week-10-2025 truth.

---

## How the data flows

```
build_seed.py  --fetches-->  Sleeper (projections, stats, weekly splits, red-zone)
      |                       FantasyPros (ECR + tiers)
      |                       OverTheCap (contracts, all positions)
      |                       Warren Sharp (advanced stats + strength of schedule)
      |                       SumerSports (advanced metrics + situational splits)
      |                       Wikipedia (coordinators + head coaches)
      |                       nflverse (offseason roster changes)
      v
triplecrown_seed.json  --loaded by-->  index.html
      |                                    |
      |  (optional)                        +- you build projections
      v                                    v
bake_seed.py  --embeds-->  index_baked.html   rankings scored to your league
   (offline / phone copy)                      + advanced stats + coaching + roster changes
                                               + live Sleeper draft follow
```

- **Live-reachable from the browser:** Sleeper and ESPN APIs (projections, stats, records, head coaches, draft picks), including ESPN's fantasy league endpoints — `lm-api-reads.fantasy.espn.com` and `fan.api.espn.com` reflect the caller's origin back in `access-control-allow-origin`, so league linking needs no proxy, key or server.
- **Not browser-reachable (CORS):** FantasyPros, OverTheCap, Warren Sharp, SumerSports and Wikipedia — these must come from `build_seed.py` and a loaded/baked seed. All are reachable from a server, so `.github/workflows/refresh-seed.yml` refreshes them on a schedule.

---

## Linking an ESPN league

The League Analyzer can snapshot an ESPN league alongside a Sleeper one. **Sleeper remains the
source of every player, stat and projection** — a linked ESPN league contributes only what a
league knows about itself: team names, owners, rosters, records, scoring and lineup slots. Each
ESPN player is resolved to a Sleeper `player_id` (by `espn_id` where Sleeper has one, then by
normalised name + position), so values, VOR, rankings, headshots and player cards all behave
exactly as they do for a Sleeper league.

**How linking works.** Paste your ESPN league link — the address bar while you're looking at
your league. TripleCrown reads that league's manager list and asks **which one is you**; tap your
name and it finds the rest of your ESPN leagues automatically. That happens once: your account is
remembered, and afterwards the ESPN tab opens straight onto your league list, exactly like the
Sleeper tab does with a remembered username.

Why it works this way: ESPN publishes no username lookup, so an account can only be identified by
its SWID — a cookie value no ordinary user can produce. But any public league hands out the
display-name→SWID mapping for everyone in it, so pointing at yourself in a league you're already
in gets there without anyone opening developer tools.

### Known limitations

- **Public leagues only.** ESPN gates private leagues behind the `espn_s2` and `SWID` *cookies*,
  which are set on `espn.com` with no `SameSite` and no `Secure` attribute. Browsers therefore
  treat them as `SameSite=Lax` and never send them cross-site, and `SameSite=None` would require
  `Secure` — so `credentials:'include'` cannot help. This is ESPN's cookie policy, not something
  a page can work around. A private league fails with a message naming the setting to change
  (League Settings → Basic Settings → *Make League Viewable to Public*).
- **No cold username search.** You can't type an ESPN handle and find someone you share no league
  with — ESPN publishes no such endpoint. Identification always starts from a league link.
- **Your league list shows public leagues only.** ESPN's account lookup reports how many leagues
  you're really in, but only lists the ones we're allowed to read; a sampled account showed 9
  leagues with none listed. Leagues we can see but can't read are shown greyed out and tagged
  *private*, so a short list is never mistaken for a broken lookup.
- **No pick capital.** ESPN has no future-pick market or traded-pick feed, so ESPN snapshots
  carry no draft picks and the value lenses score rosters only.
- **No dynasty flag.** ESPN models keepers (`keeperCount`) but has no dynasty league type, so an
  ESPN league never auto-selects the dynasty value lens. The Auto/VOR/Dynasty toggle still forces it.
- **Undocumented endpoint.** ESPN publishes no fantasy API and makes no compatibility promises;
  these are the endpoints its own web client uses. They can change without notice, so every
  failure path degrades to a plain message rather than a broken view.

---

## Notes & limitations

- **Advanced stats, coaching, and roster changes describe the *previous/offseason* period, not your projection.** They're read-only reference context — they never alter your projected numbers. Advanced-stat tables are labeled with the season they cover to avoid confusion.
- **Scheme carryover is a forecast, not a guarantee.** When a new coordinator or play-calling head coach arrives, TripleCrown shows their former team's tendencies as a starting hypothesis for how a unit might shift — use it as a prompt, not a projection.
- **Red-zone / air-yard columns appear only for past seasons.** They're live stats and aren't projectable, so they show only when you're viewing a prior season in the rankings. A missing value shows a dash rather than a zero.
- **Data accuracy is best online.** Some roster-verification steps (e.g. "copy team from last season" filtering out players who left) rely on the live Sleeper roster. Fully offline from a baked file, the app copies the whole reference roster and flags it as unverified.
- **Local-first by default.** If you do not sign in, all projections live in the browser session only. If you sign in, named scenarios can be saved to your own cloud account and reloaded later. Reference seasons are read-only and never overwrite your working set.
- **Baked files are snapshots.** Re-run `build_seed.py` then `bake_seed.py` to refresh a phone copy with new data.
- **A linked league's scoring is adopted whole.** Syncing a league replaces the scoring settings
  with that league's rules, including leagues that award no points for yardage at all (ESPN omits
  a stat entirely when it isn't scored, and TripleCrown reads an omission as zero rather than
  keeping the previous league's value).
- **Default scoring is Half PPR** (0.5 per reception), matching the default rankings format.

---

## Tests

The project ships with a regression suite (Node + Python) covering the projection math, QB games model, week-range filtering, ECR/format sync, Sleeper league linking + scoring detection, ESPN league linking (SWID→leagues, player resolution to Sleeper ids, slot/scoring translation, zero-yardage leagues, public-only guard), dynasty contracts, per-team undo, copy-to-working, Sharp advanced-stat pulling and display, strength of schedule, coordinator/head-coach parsing and scheme carryover, nflverse roster-change derivation, red-zone rankings, SumerSports advanced metrics + situational splits, player cards (ESPN gamelogs, contract/draft summaries, college stats, playoff-round labels), the live-draft lifecycle (start/stop races, keeper-aware clocks, pick-line placement, VONA popovers), injury designations and reported timelines, the input-injection and cloud-save/gateway security suites, mobile layout + slider scaling, scroll containment, seed loading/baking, and the season-switching edge cases — 146 suites / 2,000+ assertions at last count.

```bash
./tests/run_tests.sh index.html
```

---

## To Do
### New Features
- [🛠️] add Yahoo league support: needs a server. Yahoo's API sends **no CORS headers at all**, so the
  browser can't call it even with a valid token, and its OAuth2 flow requires a client secret plus hourly
  token refresh. Plan: one Supabase Edge Function doing the code exchange, refresh and read-only proxying.
  Two gates first — Yahoo now gates API access behind an application/approval process and requires
  “Fantasy data provided by Yahoo Fantasy” attribution with their logo; and a Yahoo league would need
  sign-in plus a live connection, which breaks the local-first and baked-offline guarantees above.
- [ ] AWS my own Domain
- [ ] Google Play Store
- [ ] Apple iOS Store
- [ ] Generate my own proprietary projections based on all the metrics we have
- [ ] TC model: add opponent-strength / strength-of-schedule as a projection input (era-split tested) —
  SOS is display-only today, and only the in-season lineup optimizer adjusts for defense-vs-position
- [ ] TC model: add a coaching/coordinator-change signal (offense and defense) as a model feature —
  the current `env_*` features are prior-season team output, not a change flag, and scheme carryover
  is display-only
- [ ] TC model: measure and calibrate systematic under-projection — add signed mean error /
  calibration-slope per position and decile to `proj_eval.py`, and diagnose the QB `td_oe`
  construction (rush+rec TDs differenced against *total* expected TDs incl. passing)
- [ ] Bring-your-own-model: let users plug in an OpenAI-compatible endpoint (e.g. OpenRouter) for AI
  features (no LLM integration exists yet; the league-gateway Edge Function could host the proxy route)
- [ ] AI deep-analysis fan-out: a lead "ranker" model orchestrating specialized sub-agents (offense,
  defense, player context, coaching, deep stats) rolled into an in-depth TripleCrown rank
### UI / UX
### Playercards
### Live Draft
- [ ] reach out to Sleeper
- [ ] "TripleCrown Rating" column on the draft board: blend draft rank with team-context signals
  (landing spot / vacated opportunity, open target share, coaching, other analysts' ranks) into one
  composite — the TC column today is raw projected points, and the context lives only on player
  cards and team views
- [ ] Live league-relative team rank while drafting — wire the League Analyzer's team-score engine
  to live draft rosters (`draftPicksBySlot`) and show "your team ranks Nth of M" in the roster drawer
- [ ] "Stuck between two players" button: on-demand AI deep comparison of two players (pairs with
  the AI fan-out item under New Features)
### League Analyzer
- [ ] In-Season Tools:
  - [ ] Implement future schedule on player cards (the schedule data now ships in the in-season sidecar)
  - [ ] ESPN live matchup scoring (mMatchupScore through the gateway)
  - [ ] Player-level weekly matchup-rankings view — the Defense pane ranks defenses and roster rows
    show "vs BUF (3rd)", but nothing ranks the player pool by matchup quality for the week
### Audit
### Import Projections
### Adv Metrics
- [ ] QB Metrics: on_tgt_throws, bad_throw_pct, batted_balls, is_interception_worthy, is_catchable_ball
- [ ] Charts that show team progress over the last 5 years in specific categories
### Playcalling Stats
- [ ] Improve Playbooks is_qb_sneak, n_offense_backfield

## License

TripleCrown is licensed under the **[PolyForm Noncommercial License 1.0.0](./LICENSE)**.

In plain terms: you're free to use, run, modify, and share it for any **noncommercial** purpose — personal use, hobby projects, research, study, and use by nonprofits, schools, or government. **Commercial use requires a separate license from the copyright holder.** The project author retains all rights not granted by that license.

This isn't legal advice; the [full license text](./LICENSE) governs.

---

*TripleCrown is a personal projection tool and is not affiliated with the NFL, Sleeper, FantasyPros, ESPN or NFLVerse and data from those sources is used under their respective terms for personal, non-commercial use.*
