"""The two hand-maintained coaching tables, checked against the 2026 head-coach cycle.

HC_PRIOR_JOBS and HC_PLAYCALLERS are the only inputs build_seed.py cannot fetch: Wikipedia's
head-coach table dropped its previous-position column and no free feed replaces it, so a new
head coach's former job is typed in by hand. When they rot the refresh prints "⚠ … is stale"
and opens an issue (#121 was exactly this: nine 2026 hires with no former-role line, and a
playcaller entry still naming Miami's previous head coach).

Guessing is worse than a blank — the builder says so at the call site, because an invented
prior job stamps a scheme carryover from a team the coach never worked for. So this pins the
shape and the internal consistency of what was entered, not a scrape.
"""
import importlib.util
import os
import sys

_BS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build_seed.py")
spec = importlib.util.spec_from_file_location("build_seed", _BS)
bs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bs)

P = F = 0


def chk(c, label):
    global P, F
    if c:
        P += 1
        print("  PASS:", label)
    else:
        F += 1
        print("  FAIL:", label)


# The 2026 cycle: ten head-coach changes, tied for the most in an offseason. Team → the coach
# hired, and the job he held immediately before. Typed from reporting at the time (NFL.com /
# ESPN / the clubs' own announcements) — the same sourcing HC_PRIOR_JOBS itself requires.
HIRES_2026 = {
    "MIA": ("Jeff Hafley",     "GB",  "defensive coordinator"),
    "BAL": ("Jesse Minter",    "LAC", "defensive coordinator"),
    "BUF": ("Joe Brady",       "BUF", "offensive coordinator"),
    "NYG": ("John Harbaugh",   "BAL", "head coach"),
    "ATL": ("Kevin Stefanski", "CLE", "head coach"),
    "LV":  ("Klint Kubiak",    "SEA", "offensive coordinator"),
    "ARI": ("Mike LaFleur",    "LAR", "offensive coordinator"),
    "TEN": ("Robert Saleh",    "SF",  "defensive coordinator"),
    "CLE": ("Todd Monken",     "BAL", "offensive coordinator"),
    "PIT": ("Mike McCarthy",   "DAL", "head coach"),
}

print("=== every new head coach has a former-role line ===")
for team, (coach, prev_code, prev_role) in sorted(HIRES_2026.items()):
    entry = bs.HC_PRIOR_JOBS.get(coach)
    chk(entry is not None, f"{coach} ({team}) is in HC_PRIOR_JOBS")
    if not entry:
        continue
    chk(entry[0] == prev_code, f"  {coach} came from {prev_code} (table says {entry[0]})")
    chk(entry[1] == prev_role, f"  {coach} was a {prev_role} (table says {entry[1]})")

print("=== the entries are well formed ===")
for coach, entry in sorted(bs.HC_PRIOR_JOBS.items()):
    chk(isinstance(entry, tuple) and len(entry) == 3, f"{coach}: a (code, role, years) triple")
    code, role, years = entry
    chk(code in bs.CODE_TO_FULLNAME, f"{coach}: {code} is a real team code")
    chk(role in ("head coach", "offensive coordinator", "defensive coordinator"),
        f"{coach}: {role!r} is a role the scheme carryover understands")
    chk(all(p.isdigit() and len(p) == 4 for p in years.replace("–", "-").split("-")),
        f"{coach}: {years!r} is a year or a year range")

print("=== the playcaller table names the coach who actually holds the job ===")
for team, coach in sorted(bs.HC_PLAYCALLERS.items()):
    if team in HIRES_2026:
        chk(HIRES_2026[team][0] == coach,
            f"{team}: HC_PLAYCALLERS says {coach}, and {team}'s 2026 head coach is {HIRES_2026[team][0]}")
# Miami's new head coach is a defensive coach, so the Dolphins' head coach does NOT call the
# offense and Miami drops out of this table rather than being re-pointed at him.
chk("MIA" not in bs.HC_PLAYCALLERS,
    "Miami is gone from HC_PLAYCALLERS — its head coach is a defensive coach, not the playcaller")

print("=== a playcalling head coach who is new needs his former team ===")
# This is the pair the carryover actually depends on: with a playcalling HC the offensive
# scheme travels with the coach, so a new one in HC_PLAYCALLERS without a HC_PRIOR_JOBS line
# carries nothing over and the Scheme tab quietly loses a season of identity.
for team, coach in sorted(bs.HC_PLAYCALLERS.items()):
    if team in HIRES_2026:
        chk(coach in bs.HC_PRIOR_JOBS,
            f"{team}: {coach} calls the plays and is new, so his former team is known")

print(f"\nRESULT: {P}/{P + F} " + ("ALL PASS" if not F else "SOME FAILED"))
sys.exit(1 if F else 0)
