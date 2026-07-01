# FFForge Test Suite

Headless regression tests for `ff_projections.html`. Runs in Node.js (no browser needed) by extracting the `<script>` block and executing it against mock DOM objects.

## Quick Start

```bash
# From the project root (where ff_projections.html and build_seed.py live):
chmod +x tests/run_tests.sh
./tests/run_tests.sh

# Or specify the HTML path explicitly:
./tests/run_tests.sh /path/to/ff_projections.html
```

**Requirements:** Node.js 18+ and Python 3.8+ (Python only needed for `test_flacco_split.py`).

## How It Works

1. `extract_app.js` pulls the `<script>` block from the built HTML into `check.js`
2. Each test file mocks the browser DOM (getElementById, querySelector, Chart.js, fetch, etc.)
3. Tests load `check.js` via `new Function(code + 'return {...}')()` to expose specific internals
4. Assertions print `RESULT: PASS` or `RESULT: FAIL`; the runner counts these

## Test Suites

| File | Assertions | What it tests |
|------|-----------|---------------|
| `test_harness.js` | 5 | Core unit tests — QB state init, slider fill, delta display |
| `test_edits.js` | 9 | Editable field handlers — targets, receptions, catch%, yards, TDs, carries |
| `test_v5.js` | 5 | Slider key dispatch — QB stats, target share, rushing volume |
| `test_v6.js` | 4 | Multi-QB snap shares, game splits, starter detection |
| `test_roster.js` | 5 | Historical roster accuracy — per-season team assignment (DJ Moore CHI→BUF) |
| `test_integration2.js` | 7 | End-to-end: seed → state → fantasy points → rankings |
| `test_inflation.js` | 1 | Target inflation fix — Chase's actuals (120 tgt / 1100 yds) preserved |
| `test_cascade.js` | 1 | QB pass-attempt changes cascade to receiver target pool |
| `test_receivers.js` | 2 | Receivers populate when Sleeper projections omit targets (derives from receptions) |
| `test_pace.js` | 4 | Pace extrapolation — games slider scales stats proportionally (8g→17g→4g) |
| `test_zero.js` | 1 | 0-games pace preservation — per-game rate survives a trip through 0 games |
| `test_workingset.js` | 1 | Working set preserved across reference-season views (edit→browse→return) |
| `test_batch2.js` | 4 | Format presets (PPR/Half/Std change scoring), vacated production, auto-populate |
| `test_batch3.js` | 2 | Editable reception-share rescales others; vacated respects current roster |
| `test_batch4.js` | 4 | Headshot name→id resolution, zero-stat roster merge, vacated sort, target reconcile |
| `test_games.js` | 2 | Projected games from passing-yards share (ATL committee, CIN clear starter) |
| `test_seasons.js` | 1 | 10-year season tab rendering |
| `test_discrepancy.js` | 2 | Receiving-yards discrepancy detection + one-click reconcile to QB total |
| `test_flacco_app.js` | 1 | Flacco per-team split (CLE 4g / CIN 7g) flows through app seed building |
| `test_app_weekly.js` | 1 | App-side weekly aggregation produces identical results to Python builder |
| `test_season_click.js` | 1 | Season click loads instantly from real 2025 data (7ms, not 30s) |
| `test_history_path.js` | 1 | Prebuilt-seed HISTORY path produces correct per-team QB splits |
| `test_snap_fallback.js` | 1 | Snap-data-missing weeks still count as games (Sleeper week 18 edge case) |
| `test_flacco_split.py` | 1 | **Python** — `build_seed.py` weekly aggregation with snap-based games |

**Total: 66 assertions across 24 suites**

## Optional Data Files

- `flacco_real.json` — Joe Flacco's 2025 weekly stats from Sleeper (included; used by snap/weekly tests)
- `stats_2025.json` — Full 2025 season stats (~7MB; NOT included; place here to enable `test_season_click`)

## Adding a Test

```javascript
// test_example.js
const elStore = {};
function mkEl(id) { /* ... standard mock ... */ }
// ... (copy the mock block from any existing test)

const fs = require('fs');
const code = fs.readFileSync(require('path').join(__dirname, 'check.js'), 'utf8');
const app = new Function(code + `return { functionToTest };`)();

// Test
const result = app.functionToTest(input);
console.log('RESULT:', result === expected ? 'PASS' : 'FAIL');
```

The `new Function(code + 'return {...}')()` pattern lets you expose any internal function or variable from the app for testing, even though they're not normally exported.

## File Layout

```
ff_projections.html    ← the app (one level up)
build_seed.py          ← the data builder (one level up)
tests/
  run_tests.sh         ← runner script
  extract_app.js       ← extracts <script> from HTML → check.js
  check.js             ← auto-generated; DO NOT EDIT
  test_mock.js         ← shared mock (optional; tests currently self-contained)
  test_*.js            ← JS test suites
  test_*.py            ← Python test suites
  flacco_real.json     ← test data (Flacco 2025 weekly)
  README.md            ← this file
```
