#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# FFForge Test Runner
# Extracts the app JS from the built HTML, then runs all test suites.
#
# Usage:
#   ./run_tests.sh                          # uses ../ff_projections.html
#   ./run_tests.sh /path/to/ff_projections.html
# ═══════════════════════════════════════════════════════════════════════════

DIR="$(cd "$(dirname "$0")" && pwd)"
HTML="${1:-$DIR/../ff_projections.html}"

if [ ! -f "$HTML" ]; then
  echo "ERROR: HTML file not found: $HTML"
  echo "Usage: ./run_tests.sh [path/to/ff_projections.html]"
  exit 1
fi

# Step 1: Extract the <script> block into check.js
echo "═══ Extracting app JS from $(basename "$HTML") ═══"
node "$DIR/extract_app.js" "$HTML"
echo ""

# Step 2: Syntax check
echo "═══ Syntax check ═══"
if node --check "$DIR/check.js" 2>/dev/null; then
  echo "✓ Syntax OK"
else
  echo "✗ SYNTAX ERROR"
  exit 1
fi
echo ""

# Step 3: Run all JS test suites
echo "═══ Running test suites ═══"
PASS=0
FAIL=0
SKIP=0
TOTAL=0

run_js_test() {
  local name="$1"
  local desc="$2"
  local file="$DIR/${name}.js"
  
  if [ ! -f "$file" ]; then
    echo "  SKIP  $name — file not found"
    SKIP=$((SKIP + 1))
    return
  fi
  
  local output
  output=$(node "$file" 2>&1) || true
  
  # Count PASS/FAIL — tests use various formats: "RESULT: PASS", "TEST X: PASS", "PASS (...)"
  local p f skipped
  p=$(echo "$output" | grep -ciE "PASS" || true)
  f=$(echo "$output" | grep -ciE "FAIL" || true)
  skipped=$(echo "$output" | grep -c "SKIP:" || true)
  TOTAL=$((TOTAL + p + f))
  
  if [ "$skipped" -gt 0 ]; then
    echo "  SKIP  $name ($desc)"
    SKIP=$((SKIP + 1))
  elif [ "$f" -eq 0 ] && [ "$p" -gt 0 ]; then
    echo "  ✓ OK  $name — ${p} pass ($desc)"
    PASS=$((PASS + 1))
  elif [ "$f" -eq 0 ] && [ "$p" -eq 0 ]; then
    echo "  ?     $name — no assertions ($desc)"
    SKIP=$((SKIP + 1))
  else
    echo "  ✗ FAIL $name — ${p} pass, ${f} fail ($desc)"
    echo "$output" | grep -iE "FAIL" | head -3 | sed 's/^/         /'
    FAIL=$((FAIL + 1))
  fi
}

run_js_test test_harness      "Core unit tests — QB state, slider fill, delta display"
run_js_test test_edits         "Editable field handlers (targets, receptions, catch%, yards, TDs)"
run_js_test test_v5            "Slider key dispatch (QB stats, target share, rushing)"
run_js_test test_v6            "Multi-QB snap shares and game splits"
run_js_test test_roster        "Historical roster accuracy (per-season team assignment)"
run_js_test test_integration2  "End-to-end integration (seed→state→rankings)"
run_js_test test_inflation     "Target inflation fix (Chase actuals preserved)"
run_js_test test_cascade       "QB attempts cascade to receiver target pool"
run_js_test test_receivers     "Receivers populate when projections omit targets"
run_js_test test_pace          "Pace extrapolation (games slider scales stats)"
run_js_test test_zero          "0-games pace preservation (rate survives trip through 0)"
run_js_test test_workingset    "Working set preserved across reference season views"
run_js_test test_batch2        "Format presets, vacated production, auto-populate rankings"
run_js_test test_batch3        "Editable reception share, vacated roster membership"
run_js_test test_batch4        "Headshot resolution, roster merge, vacated sort, target reconcile"
run_js_test test_games         "Projected games from passing-yards share (ATL/CIN)"
run_js_test test_seasons       "10-year season tab rendering"
run_js_test test_discrepancy   "Receiving-yards discrepancy detection and reconcile"
run_js_test test_flacco_app    "Flacco per-team split flows through app correctly"
run_js_test test_app_weekly    "App-side weekly aggregation matches Python builder"
run_js_test test_season_click  "Season click loads instantly with real data"
run_js_test test_roster_merge_flag "mergeRosterPlayers must not pollute SEED[team] with a non-array flag (season-switch bug)"
run_js_test test_league_picker  "Sleeper league picker: username→leagues, scoring/SF labels, completed-draft handling"
run_js_test test_link_open       "League picker links an upcoming draft via existing follow machinery"
run_js_test test_dynasty_drafts   "Dynasty league /drafts resolution (real Sleeper data: single complete draft)"
run_js_test test_scoring_apply    "Sleeper scoring→model conversion + format detection (real QCK/dynasty data)"
run_js_test test_rounding        "Sleeper scoring float-noise rounding (clean 10/25, preserves custom values)"
run_js_test test_pick_applies_scoring "Linking a league applies its full scoring & switches format"
run_js_test test_dynasty_sf       "Dynasty-superflex format detection (dynasty_2qb) + graceful ECR fallback"
run_js_test test_sharp_app       "Advanced Stats (Warren Sharp): per-team cards, league-wide sortable table, rank badges"
run_js_test test_sharp_edge      "Advanced Stats edge cases (empty seed, missing team, no-team fallback)"
run_js_test test_sos_defense    "SOS chart/table, defensive tables, Offense-Defense toggle, % on rate cols, full team names"
run_js_test test_history_path  "Prebuilt seed HISTORY path produces correct splits"
run_js_test test_snap_fallback "Snap-data-missing fallback counts games correctly"
run_js_test test_weekrange     "Week-range slider aggregation (Tucker Kraft hot stretch)"
run_js_test test_weekrange_e2e "Week-range filter flows through shares + pools end-to-end"
run_js_test test_ecr           "ECR lookup, format↔scoring sync, default sort"
run_js_test test_ypc_build     "YPC calculation + ECR attached to player list"
run_js_test test_undo          "Per-team undo: restore, multi-step, isolation, dedup"
run_js_test test_autoload      "Auto-load ffforge_seed.json at boot (ECR), graceful CORS fallback"
run_js_test test_baked_boot    "Baked-in seed boots self-contained with no fetch (phone/file:// safe)"
run_js_test test_ecr_load      "Seed load populates ECR (incl. ECR-only seeds, the empty-seed bug fix)"
run_js_test test_copy_undo     "Undo for copy-to-working actions (cross-team Pittman case, seed+working revert)"
run_js_test test_copy_noroster "Copy-from-prev-season works when roster unverifiable (seed-only, no Sleeper DB)"
run_js_test test_contracts     "Dynasty contract columns (Age/APY/FA, next-year FA red, dynasty-only)"

# Step 4: Python tests
echo ""
PYBUILD="$DIR/../build_seed.py"
if [ -f "$DIR/test_flacco_split.py" ] && [ -f "$PYBUILD" ]; then
  echo "═══ Python tests ═══"
  for pyt in test_flacco_split test_ecr_py test_bake test_ecr_extract test_otc_extract test_sharp_scrape test_sos_scrape; do
    [ -f "$DIR/${pyt}.py" ] || continue
    output=$(python3 "$DIR/${pyt}.py" 2>&1) || true
    p=$(echo "$output" | grep -ciE "PASS" || true)
    f=$(echo "$output" | grep -ciE "FAIL" || true)
    TOTAL=$((TOTAL + p + f))
    if [ "$f" -eq 0 ] && [ "$p" -gt 0 ]; then
      echo "  ✓ OK  ${pyt}.py"
      PASS=$((PASS + 1))
    else
      echo "  ✗ FAIL ${pyt}.py"
      echo "$output" | grep -iE "FAIL" | head -3 | sed 's/^/         /'
      FAIL=$((FAIL + 1))
    fi
  done
else
  echo "(Skipping Python tests — build_seed.py not found at $PYBUILD)"
  SKIP=$((SKIP + 1))
fi

# Summary
echo ""
echo "═══════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✓ ALL PASSED: ${PASS} suites, ${TOTAL} assertions, ${SKIP} skipped"
else
  echo "  ✗ ${FAIL} FAILED, ${PASS} passed, ${TOTAL} assertions, ${SKIP} skipped"
fi
echo "═══════════════════════════════════════════════════"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
