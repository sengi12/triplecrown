# Handoff — `playbook-formations`

Delete this file when the branch merges. It exists so another session can pick the work up
without the conversation that produced it. Read `CLAUDE.md` first for how the repo builds.

## Where things stand

The playbook's formation diagrams now carry real NFL/Madden formation names and draw the shapes
those names describe. The catalogue is 204 names across 31 personnel groupings, baked into
`src/templates/coaching-template.html` as `FORMATION_NAMES`.

**Everything is committed on this branch and nothing is pushed.** The branch is rebased onto
`origin/main` at the time of writing, so it does not revert the map work in #149 or #154.

## What was wrong, and what fixed it

Two defects the user reported by looking at rendered cards:

- **Receivers were not split wide.** The layout stepped *outward from the tackle*, so on a card
  330 units across the outside receiver reached only 264 and every formation read as a
  compressed set. Receivers are now anchored near the sideline and laid *inward* toward the
  formation; tight ends run the other way, attached ones on the tackle's hip and flexed ones in
  the slot just outside. The two ladders meet in the middle. Median outermost eligible went
  264 → 300.
- **Power I was not a straight line.** All three backs were already placed on centre. The
  under-centre quarterback stood close enough to the snap to count as touching the centre, the
  overlap-separation pass shoved him sideways, and the push rippled down the backfield. The
  quarterback now stands off the ball and the backs are spaced so nothing touches.

Four more found by rendering every card and looking:

- a back split out of an empty set was marched outward until he ran out of field and ended up
  stacked on the outside receiver; he now drops into the widest gap on his side, the slot
- three tight ends could stack on one hip, putting the third out at the numbers
- the shotgun back sat inside the quarterback's own badge, and with two backs both landed on the
  same spot when the offset pointed left
- **found by the new checker, not by eye:** with four bodies in the backfield the named
  arrangements placed only three, so a player silently vanished and the card drew ten men.
  Surplus backfield bodies are now placed as upbacks.

## How to verify it

```bash
python build.py
python bake_seed.py --seed seeds/triplecrown_seed.json --html index.html --out /tmp/preview.html
~/.pyenv/versions/nfl/bin/python tools/formation_check.py --html /tmp/preview.html \
    --sheet /tmp/formations.html
```

Current state: **395 formation/backfield combinations, 0 render errors, 0 faults, 249 distinct
shapes.** The only pairs closer than a badge width are the deliberate ones — a stacked receiver,
the point man of a bunch — which the renderer marks `data-snug` so the checker can tell them
apart from a collision.

Then **open the contact sheet and look at it.** The checks catch illegal pictures, not wrong
ones. Every real defect above was found by comparing a rendered card against an actual formation
diagram, and the user's standing instruction is to do exactly that rather than add more rules.

Test suite: 208 files pass, 4,676 assertions, 3 skipped. Eight Python suites report `FAIL` in the
runner because it calls a `python3` without pandas — see `CLAUDE.md`. `test_roster_moves` misses
one check when run from inside `tests/` rather than the repo root, on clean `main` too.

## Reading the renderer

All of it is `positions(g, av)` in `src/templates/coaching-template.html`.

| Piece | What it does |
| --- | --- |
| `FORMATION_NAMES` | the catalogue: `{f:{…}, e:{…}}`, keyed `align\|rb\|te\|wr`, each entry `[family, [name, shapeToken], …]` |
| `_mods(name)` | reads keywords out of a name — tight/spread, wing/flex, strong/weak, stack, slot, twins, doubles, the backfield arrangements |
| `_shapeToken(...)` | turns a shape token into `{wrR, teR, wrBunch, teBunch, triangle, rbSide}` |
| `variantsFor(g)` | the looks offered for a grouping; `familyFor(g)` names the family |
| `positions(g, av)` | places everyone, then a separation pass pushes apart anything that overlaps |

Card geometry: 330 wide, centre at 165, the line at y=196, linemen at x = 121/143/165/187/209,
badges r=9. A receiver at 300 is out by the numbers; one at 264 is not.

The separation pass is the subtle part. It is a general "nobody stands on top of anyone" sweep,
and it caused the Power I bug by cascading from a collision that had nothing to do with the
backs. If a formation comes out subtly deformed, suspect it before you suspect the placement.

## What is not done

- 13 personnel, under-centre empty and some three-back groupings have no catalogued names and
  fall back to the nearest grouping in the same family, never across families.
- 249 distinct shapes across 395 cards, so some names still draw the same picture as a sibling.
  Worth another pass against real diagrams if the user wants more separation.
- Where receivers *actually* lined up is not in public play-by-play. The specific look is a
  schematic the user cycles through, and the card says so. Only the family, the backfield count
  and the tight end / receiver counts are measured.

## Picking this up somewhere else

The commit lives in the shared `.git` on the network share, so the branch is already visible from
the main checkout there. It has **not** been pushed to GitHub, so nothing outside this machine
can see it. To continue elsewhere, push it first:

```bash
git push -u origin playbook-formations
```
