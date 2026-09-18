# TripleCrown — notes for Claude

Read this before changing anything. It is the stuff that is not obvious from the code and that
will waste an hour if you learn it the hard way.

## The shape of the app

TripleCrown ships as **one self-contained `index.html`** — it runs offline from `file://`, bakes
onto a phone, and has no runtime dependencies. That single file is good for users and miserable
to edit, so the source lives split under `src/` and is concatenated back together:

| Path | What it is |
| --- | --- |
| `src/index.template.html` | the shell, with `@@CSS_PARTIALS@@` / `@@JS_PARTIALS@@` tokens |
| `src/js/*.js` | 80 partials, concatenated **in filename order** (the numeric prefixes fix it) |
| `src/css/*.css` | the stylesheet, same deal |
| `src/templates/*.html` | pages rendered into an `<iframe srcdoc>` — see the warning below |
| `src/nflverse/` | the Python builders that turn nflverse data into seed payloads |
| `tools/` | developer scripts; none of it ships |

Concatenation, **not** bundling. Every function and global shares one scope, which the app and
the test harness both rely on. Do not introduce modules, and do not reorder the partials.

```bash
python build.py            # rebuild index.html from src/
python build.py --check    # verify src/ still rebuilds the committed index.html; exit 1 if not
```

**Never hand-edit `index.html`.** It is generated. Edit the partial and rebuild.

### Templates render in an iframe

`src/templates/coaching-template.html` (the playbook) is injected into an `<iframe srcdoc="…">`.
Functions defined there live in the frame's scope, not the parent's. To call one from a test or a
script you go through `document.querySelector('iframe.scheme-frame').contentWindow`, and to reach
a top-level `const` you need `.eval('NAME')` — it is not a property of `window`. Anything the
parent needs to share with the frame has to be injected as source text (see `String(fn)` in
`src/js/73-coaching-scheme.js`).

## Running the tests

```bash
tests/run_tests.sh          # rebuilds index.html, re-extracts check.js, runs everything (~12 min)
```

Three things about this that will otherwise confuse you:

1. **The runner calls bare `python3`, which has no pandas in this repo.** Eight Python suites
   therefore report `✗ FAIL` on a perfectly good tree. They are not broken. Re-run any of them
   with the project interpreter before believing a failure:
   ```bash
   ~/.pyenv/versions/nfl/bin/python tests/test_coaching_charting.py
   ```
   Treat a Python `FAIL` in the runner as "unknown" until you have done that.

2. **`tests/check.js` is generated and `build.py` does not touch it.** It is the app JS extracted
   out of the built HTML, and it is what every JS test actually executes. After a build, run
   `node tests/extract_app.js index.html` or your tests run the previous build's code.
   `run_tests.sh` does both steps for you; a manual build does not.

3. **Run Python tests from the repository root.** Several resolve data with relative paths
   (`seeds/…`), so they quietly miss checks when run from inside `tests/`.

There is **no test discovery**. A file in `tests/` runs only if it is hand-registered near the
bottom of `tests/run_tests.sh` with `run_js_test` / the Python equivalent. A new test file that
nobody registered is a test file that never runs.

## Seeds

The app reads a baked seed. `bake_seed.py` inlines one into a standalone HTML, which is how you
get a build you can actually click through:

```bash
python bake_seed.py --seed seeds/triplecrown_seed.json --html index.html --out /tmp/preview.html
```

Season payloads live in `seeds/`, with per-season sidecars like
`seeds/triplecrown_seed.coaching.2025.json`. Builders that write them are under `src/nflverse/`.
The nflverse local cache is **download-once**: delete the current season's cached files before a
local dry run of an in-season builder, or you will validate a stale partial copy.

## Working alongside another session

The checkout on the network share is often dirty with another session's work. Do not commit from
it. Make a worktree, build and commit there, and leave the shared tree alone:

```bash
git worktree add ../wt-<topic> -b <branch>
```

`tools/gate.sh` is the gated push. It takes an **explicit file list** and a message file
(`-m /path/msg.txt`) — bash 3.2 mangles heredocs on unbalanced apostrophes, so never inline a
commit message. Do not touch a file while a classic gate is running over it; its `git add` sweep
will pull half-finished edits into a commit that claims to have passed.

## House rules

- **Show UI work before pushing it.** Bake a preview and put it in front of the user. Bug fixes
  ship once the suite is green; anything that changes what the app looks like gets looked at first.
- Commit messages are lowercase `type(scope): …` with a real sentence after the colon, and a body
  that explains the *why*. Look at `git log` before writing one.
- CI runs Node 22, local is often Node 20. A getter-only `navigator` global makes stubs silently
  no-op on 22, so verify browser-global tests in `docker node:22` before trusting them locally.
- Never do O(board) work per cell in the rankings row renderer; `tests/test_rank_cols.js` pins it.

## The playbook diagrams

`src/templates/coaching-template.html` draws a formation per personnel grouping. Two rules the
data does not enforce for you:

- **Personnel decides *who* is on the field; the backfield count only decides *where* they
  stand.** The first digit is running backs, the second is tight ends. 11 personnel is one back
  and one tight end, always. The charted backfield count (`backs`, from FTN) disagrees with the
  personnel string (`pbacks`) on roughly a third of plays — a tight end motions in, a back splits
  out — and almost every bug in this drawing has come from letting `backs` decide identity.
- **Nobody may be drawn in front of the line of scrimmage.** A back split into the slot is off
  the ball and *behind* the line, which is legal; a yard in front of it is not.

The card is a **schematic with two scales**, which is the thing that will mislead you. Across
the field 330 units span 53⅓ yards (6.19 units/yard), so the NFL numbers — 12 to 15 yards off
the sideline — fall at x 237–256. Down the field the shotgun and pistol quarterbacks fix
9.2 units/yard, and `D(yd)` converts, so every backfield depth in `positions()` is written in
real yards. The offensive line is deliberately drawn far wider than either scale, because a
badge is 18 units across and five linemen at a true 2-foot split would overlap. That badge size
is a floor on everything: two men closer than about 2 yards cannot be drawn apart, which is why
an under-centre quarterback only *touches* the centre rather than standing on him, and why a
"nasty" split cannot come all the way inside the numbers.

`tools/formation_check.py` renders every formation in a real browser and checks all of that:

```bash
~/.pyenv/versions/nfl/bin/python tools/formation_check.py --html /tmp/preview.html \
    --sheet /tmp/formations.html
```

It sweeps the backfield count as well as the personnel, so it exercises the disagreement above.
It can only tell you a picture is **illegal**, never that it is **wrong** — a formation can pass
every check and still not look like the formation it is named after. Open the contact sheet and
compare against real diagrams. That is not optional; it is how the last round of bugs was found.

A last trick worth knowing: the checks pass partly because a separation sweep at the end of
`positions()` pushes apart anything that overlaps. To see what the placement code *meant*,
render with that sweep disabled — change its loop bound to zero — and diff the positions. On a
healthy tree only one card overlaps on its own; a jump in that number means new offsets are
fighting each other and the sweep is hiding it.
