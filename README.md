# 👑 Triple 👑 Crown 👑

**Build your own NFL season projections, then draft from them.**

TripleCrown is a self-contained fantasy football projection tool. Instead of trusting someone else's rankings, you build the season yourself — team by team, slider by slider — and the app turns your projections into live draft rankings entirely from your browser.

---

<!-- Center align -->
<div align="center">
  <img src="./images/receiving.png" alt="Centered Image">
</div>

## What it does

- **Team-by-team projections.** For each of the 32 NFL teams, set QB passing volume, then distribute targets, receptions, receiving yards, and rushing work across the roster with pie-chart sliders. Everything is editable inline — type a number and the rest rebalances.
- **QB games model.** Each QB has a games-played slider (0–17) that drives their pace. A QB set to 0 games contributes nothing to team totals but keeps their per-game rate, so backups and committees behave sensibly.
- **Rankings that follow your scoring.** Your projections become a ranked player board scored by your league's exact settings. Switch between **Full PPR, Half PPR, Standard, Superflex, and Dynasty** — each applies the right scoring *and* pulls the matching FantasyPros Expert Consensus Ranking (ECR) and tier. Change the reception value directly and the format label follows.
- **Dynasty contract columns.** In Dynasty mode, the rankings add **Age / APY / Free-Agency year** per player (from OverTheCap). A player whose contract expires next season is highlighted in red — a quick read on who's about to change situations.
- **Reference past seasons.** Click any prior season to view real stats, read-only, without touching your working projections. A **week-range slider** lets you filter a player's stats to a stretch of games — e.g. a receiver's hot start before an injury — and see how they compared to the rest of the team over just those weeks.
- **Copy last season into your working set.** Pull a team's (or a single player's) prior-season line into your current projections as a starting point, with per-team **undo**.
- **Live draft follow.** Point it at a Sleeper draft and drafted players are marked/hidden on your board in real time.
- **Works offline.** Bake a data snapshot into the HTML and open it on your phone — no server, no CORS, fully offline.

---

<!-- Center align -->
<div align="center">
  <img src="./images/rankings.png" alt="Centered Image">
</div>

## Quick start

**Just want to use it?** Open `triplecrown.html` in any modern browser. On first load it pulls live 2026 projections from Sleeper. That's it.

For the full experience (expert rankings, contracts, prior-season history), build a **seed** — see below.

---

### Quarterback UI Layout
<!-- Center align -->
<div align="center">
  <img src="./images/passing.png" alt="Centered Image">
</div>

### Running Back UI Layout
<!-- Center align -->
<div align="center">
  <img src="./images/rushing.png" alt="Centered Image">
</div>

## The three files

| File | What it is |
|------|-----------|
| `triplecrown.html` | The entire app. Open it in a browser. |
| `build_seed.py` | Run locally to fetch all the data and produce `triplecrown_seed.json`. |
| `bake_seed.py` | Embeds a seed directly into the HTML for a phone-friendly, offline copy. |

---

## Building a seed (recommended)

The app can pull live projections on its own, but **FantasyPros ECR and OverTheCap contracts can't be fetched from the browser** (those sites aren't CORS-enabled). The seed builder runs on your own machine, where there's no such restriction, and bundles everything into one file.

```bash
python build_seed.py                 # 2026 projections + last 5 seasons of stats + ECR + contracts
python build_seed.py --season 2026   # choose the projection season
python build_seed.py --history 5     # how many prior seasons of stats to bundle
python build_seed.py --refresh       # ignore caches and re-download everything
```

It fetches, in order:

1. Sleeper player database
2. Season projections
3. Historical stats (last N seasons)
4. Per-team QB weekly splits (so traded QBs land on the right team)
5. FantasyPros ECR — all six formats
6. OverTheCap contracts (age / APY / free-agency year)

Output: **`triplecrown_seed.json`** (and a `triplecrown_seed.js` equivalent). Requires only Python 3 standard library — no pip installs. Runs are cached in `triplecrown_cache/`, so re-runs are fast; use `--refresh` to force a re-download.

**Load it into the app** with the 📦 Seed button, or place it next to `triplecrown.html` when hosted over http(s) and it auto-loads on page open.

---

## Hosting for beta / sharing

Because it's a static site, hosting is trivial and free. **GitHub Pages** is the tightest fit:

1. Create a **public** repo.
2. Rename `triplecrown.html` → **`index.html`** and upload it, plus `triplecrown_seed.json`, to the repo root.
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
# reads ./triplecrown_seed.json + ./triplecrown.html → writes triplecrown_baked.html
```

AirDrop or email `triplecrown_baked.html` to your phone and open it. Projections, history, ECR, and contracts are all embedded — zero network requests, works offline. (A baked file is a snapshot; re-run `bake_seed.py` after building a fresh seed.)

---

## Extra tools

- **`ecr_diagnostic.html`** — drop a seed file onto this page to verify whether FantasyPros ECR loaded correctly and is in the shape the app expects. Handy if the rankings show "No ECR loaded."

---

## How the data flows

```
build_seed.py  ──fetches──▶  Sleeper (projections, stats, weekly splits)
      │                       FantasyPros (ECR + tiers, 6 formats)
      │                       OverTheCap (age / APY / free-agency year)
      ▼
triplecrown_seed.json  ──loaded by──▶  triplecrown.html
      │                                     │
      │  (optional)                         ├─ you build projections
      ▼                                     ▼
bake_seed.py  ──embeds──▶  triplecrown_baked.html   rankings scored to your league
   (offline / phone copy)                           + live Sleeper draft follow
```

- **Live-reachable from the browser:** Sleeper and ESPN APIs (projections, stats, records, draft picks).
- **Not browser-reachable (CORS):** FantasyPros and OverTheCap — these must come from `build_seed.py` and a loaded/baked seed.

---

## Notes & limitations

- **Data accuracy is best online.** Some roster-verification steps (e.g. "copy team from last season" filtering out players who left) rely on the live Sleeper roster. Fully offline from a baked file, the app copies the whole reference roster and flags it as unverified.
- **Nothing is saved server-side.** All projections live in the browser session. Reference seasons are read-only and never overwrite your working set.
- **Baked files are snapshots.** Re-run `build_seed.py` then `bake_seed.py` to refresh a phone copy with new projections/ECR.
- **Default scoring is Half PPR** (0.5 per reception), matching the default rankings format.

---

## Tests

The project ships with a regression suite (Node + Python) covering the projection math, QB games model, week-range filtering, ECR/format sync, dynasty contracts, per-team undo, copy-to-working, seed loading/baking, and the season-switching edge cases.

```bash
./run_tests.sh triplecrown.html
```

---

TripleCrown is licensed under the **[PolyForm Noncommercial License 1.0.0](./LICENSE)**.

In plain terms: you're free to use, run, modify, and share it for any **noncommercial** purpose — personal use, hobby projects, research, study, and use by nonprofits, schools, or government. **Commercial use requires a separate license from the copyright holder.** The project author retains all rights not granted by that license.

This isn't legal advice; the [full license text](./LICENSE) governs.

---

*TripleCrown is a personal projection tool and is not affiliated with the NFL, Sleeper, FantasyPros, OverTheCap, Spotrac or Warren Sharp. Data from those sources is used under their respective terms for personal, non-commercial use.*
