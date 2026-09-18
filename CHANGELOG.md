# Changelog

Every change ships as one squash-merged pull request through the CI gate (`tools/gate.sh`), so
this file is the merge history, newest first, one line per PR. Add a line when a PR merges;
`git log --pretty='%ad %s' --date=short | grep '(#'` regenerates the same list.

Open work lives in [TODO.md](TODO.md).

## 2026-09-18

- feat(cards): the run after a catch is drawn, not ruled — it leans and settles the way a runner does, and carries on to the sideline when the play ended out of bounds; the uncharted stem from the line of scrimmage bends too (#151)
- fix(mobile): tapping a text box no longer zooms the page and stays zoomed; the rankings position strip is reachable; a baked copy stops 404ing its own icons (#150)
- fix(live): a game kicking off or going final redraws the Live view on its own — the week sliders, the "thru wk" chip and the games-played counts follow the games as they happen (#148)

- fix(live): the week sliders show the whole season and follow the games a team has played — a Thursday-night team's week is in on Friday, not on Tuesday (#147)
- fix(tracker+cards): the drive line and uprights on the field's centre, the win probability filled for the winner with the clubs on the right, no sideline bar on out-of-bounds runs, and no two runs alike (#146)
- feat(cards): the maps are per-game views that open on the latest game (Season is the zone view / the fan); out-of-bounds runs angle out to the sideline they left by; playoff games join the game picker; the picker owns a row on phones and the season chip is the bare year; manager pills are a star or a dot in narrow rows (#143)
- feat(tracker): the game page, Sleeper's way — a hero that carries the situation, the last play as one line, the drive drawn on the field, win probability, a pill rail (#145)
- fix(pace): the 17-game pace popup says the week the stats run through, not the last week Sleeper closed (#144)
- feat(analyzer): the snap tracker — Trends · Snaps, snap share week over week from Sleeper's weekly rows, nflverse filling the blanks via the sidecar, last season as the week-1 baseline, role tiers (#142)

## 2026-09-17

- fix(tracker): a live read never repaints under your finger, an open picker or a focused field; the left sidebar repaints only on a state change; no position filter row in the Game Center (#141)
- feat(live-feed): the tab's badge counts the plays that matter since you last looked, not the games on (#140)
- fix(live-feed): timeouts, the two-minute warning and the end of a quarter are pauses, not plays — the live feed skips them like the game feed does (#139)
- feat(tracker): the scoreboard's last play leads the game feed while the summary is behind, and the ticking "Ns ago" is back on the refresh mark (#138)
- fix(tracker): halftime says Halftime, live reads skip the browser cache, and the refresh mark is the icon alone (#137)
- feat(tracker): a freshness stamp — when ESPN was last read, ticking, and a tap that reads again now (#136)
- feat(tracker): a 5-second live poll, the fantasy pane scored off the box score as the plays land, the live feed back to kickoff, and a league chip that means my matchup (#135)
- fix(tracker): a live game's plays came through twice and one play late — ESPN lists the drive in progress under both previous and current, and its summary lags the scoreboard (#134)
- fix(cards): the scoring throw is one arc again on the pass map and the target map — bowed perpendicular to the throw, landing on the catch dot (#133)
- feat(cards): the top bar fits a phone — wordmark + icon tabs, the vs-projection chips behind a tap on the PROJECTIONS row, a season menu, one shared edge for every band (#132)
- fix(cards): availability leaves the hero — a LEAGUES · Availability line under the contract band, Sleeper style; the contract line abbreviates to one line on phones (#131)
- fix(cards): the scoring throw lands on the catch dot; runs bend early and finish straight; the phone hero foot never overlaps (#130)
- feat(cards): the scoring throw is a real lob from where the passer stood (FTN formation + out of pocket); the tags off the top of a map never overlap (#129)
- feat(analyzer): the O-Line pane — every line's run blocking and pass protection over a recent stretch vs the season, surging and slipping, beside Defense in the Season tools (#128)
- feat(cards): the rushing fan's run-blocking banner follows the selected game; unpublished PFR weekly fields stay missing in the week-window recompute (#127)
- feat(cards): the carry map — every carry of every game drawn from the backfield through its gap, NGS-style, Map first on the rushing fan; scoring-throw arcs on the pass and target maps; the maps' field goes grey (#126)
- feat(cards): the pass map — every attempt of every game on the QB's field with the receiver on the mark, Map first on the passing chart; the offseason bakes the season just played (#125)
- fix(cards): the Map / Zones / Tree toggle keeps its place — the view row is its own row, the metric buttons take the row beneath (#124)
- feat(league): My Team overview cards and a height-packed layout — this week, upgrade path, trade fit, heat map, bye exposure, age timeline, roster construction (#123)
- feat(cards): the target map — every target of every game on the field, the charted route to each catch once a season's charting lands, Map first on the Routes tab; baked copies adopt the in-season sidecar offline (#122)
- fix(analyzer): the value lens pin is per league, the trade page says what its numbers are, and one week is noise in rest-of-season worth (#115)
- feat(cards): the news is its own tab — the card still opens on the stats (#114)
- feat(cards+tracker): a player's latest news on the card; the game tracker lists only leagues I have a roster in (#113)
- feat(live-feed): league chips are the league's icon — nine leagues fit one row instead of spilling names (#112)
- feat(personnel): the live prior is keyed on what FTN measures — Advanced tab groupings and Playbook sets both read the H-back right (#111)
- feat(adv-metrics): the season in progress tracks PFR's weekly charting and infers personnel; rollover guards (#110)
- feat(keys+playbook): shortcuts for the Game Center, Rankings and Leagues you can rebind; every Tendencies number taggable (#109)
- fix(cards): the open-alongside search reaches every player — a linebacker's card finds his teammate at the position (#108)
- fix(game-center): my players ARE blue — the blue rule lost the cascade to the names' own colour (#107)
- feat(cards): a D/ST row in the Game Center opens the team defense's card; the compare reaches every player in the app (#106)
- fix(game-center): blue and red throughout — for the league in view and the WEEK in view (#105)
- fix(game-center): a LIST of linemen reporting eligible is stripped too (the Ezeudu touchdown); names resolve by role, tolerate a nickname initial, and colour the headline (#104)

## 2026-09-16

- fix(game-center): the week picker reads in order, swipes follow the week on screen, plays name the right man, your team is blue and your opponent red (#103)
- feat(game-center): a live feed of every game at once, filtered to the leagues you play in (#102)
- feat(game-center): the feed paints the moment ESPN posts a play; the playoff rounds are weeks 19-22 everywhere (#101)
- fix(game-center): every synced league in the switcher (loaded on first paint), the whole season in the week picker, a 15-second live poll (#100)
- feat(game-center): a play feed, the quarter line, box scores, and a fantasy pane that scores any synced league — from ESPN's game summary (#99)
- feat(ai+mcp): the chat browses every nflverse season (tendencies, team tables, coaching payloads); the MCP table of contents names tendencies and charted sets (#98)
- ux(tendencies): the predictability stamp is a rank, not a grade — neutral yellow, and the info button says why (and what pp is) (#97)
- fix(playbook): the sheet's player labels take lanes so they never overlap; Tendencies says predictable, and its rank reads from the nearer end (#96)
- ux(playbook): the explanations go behind info buttons — the Tendencies method, the charted-sets note, the sheet's footnote (#95)
- feat(playbook): charted sets carry the team's own personnel codes and estimated routes for the season in progress (#94)
- feat(playbook+advanced): the season in progress gets a Playbook on charted sets; team rush and pass success rate with league rank; the Playbook's tab row holds one line on a phone (#93)
- fix(playbook+mobile): Tendencies in the Playbook's tab row, the call sheet back to one page (its grid had gone empty), 2026 tendencies from the sidecar; the phone sign-in hops by an Android intent link (#92)
- feat(playbook+mobile): Tendencies as the call sheet's own page, on a phone too; the phone sign-in returns through an https page; the build shows in the sign-in modal (#91)
- feat(playbook): Tendencies — when a team calls what, and how guessable it is (The Side Quest's methods); the sign-in's cold-relaunch return (#90)
- fix(mobile): drive the Browser and App plugins through the injected bridge (#89)
- fix(mobile): reach the Browser and App plugins from the live-site page (#88)
- feat(mobile+tracker): the sheet's swipes slide the next game in under the finger; Google sign-in inside the app; the Leaders open on the season until kickoff (#87)
- feat(mobile): the launcher icon and splash, generated from the app's icon (#86)
- feat(mobile): the app as a native shell for Android and iOS (Capacitor), and the in-season blend ramps with games played (#85)
- feat(game-center): a game still ahead shows each side's projected lines; the picker looks three weeks ahead (#84)
- feat(in-season): Sleeper's weekly line informs every projection, defenses and kickers get one, redraft values are rest-of-season worth (#83)

## 2026-09-15

- fix(ol): the pre-snap rows reach the seed — and Rush 1D Rate has its column (#82)
- feat(ol): a rookie lineman's grade reads draft capital + college line + level — and says so with an asterisk (#81)
- feat: phone leaders columns, every pane swipes, the Waivers tab priced, sorts that hold their place, O-line tables that fill from the play-by-play (#80)
- feat(ai): Ask TripleCrown sees every league and the season in progress (#79)
- feat(analyzer): every FAAB league prices its whole wire — the board and the Trends tags (#78)
- feat(analyzer): the chop market on the Lineup pane's wire — every free agent priced (#77)
- feat(hub): the chop market reads every Eliminator season — the hand-chopped years too (#76)
- fix(hub): the chop-market bid no longer rides one outlier — interpolated percentiles, shrinkage toward the study, the 60th percentile, a cap over the market (#75)
- feat(hub): Chopped leagues price a released player on the chop market — caliber × teams alive, from the league's own history (#74)
- fix(leaders): a real drag handle on the sidebar's edge — wider, half outside, with a visible pill (#73)
- feat(in-season): the tracker holds the finished week until Wednesday morning; the phone's Games sheet gets the Leaders; Standings & the playoff picture in the League Analyzer (#72)
- feat(game-center): the Games sheet — the Game Center on a phone, in the draft follow's corner (#72)

## 2026-09-14

- feat(ol): rookie linemen graded on draft capital — the first-season composite their slot has earned, on the same scale as the NFL grades (#71)
- feat(rookies): college line context for rookie offensive linemen — the unit's line by season, as division percentiles (#70)
- feat(game-center): the game banner wears both clubs' colours, meeting in the middle (#69)
- feat(leaders): the list grows with the sidebar — full names, then the position's stat columns, sortable by header (#68)
- feat(app): Game Center by kickoff order with filters, a drag-to-resize sidebar, every defender's week, one QB box line everywhere (#67)
- fix(refresh): a trimmed-but-complete FantasyPros list no longer rejects the whole seed (#66)
- feat(standings): the sidebar's divisions follow the NFL's own tiebreakers (#65)
- feat(in-season): defenders keep updating — the live sidecar carries def_weekly, the card loads every season, the live Roster tab leads with the depth chart (#64)
- feat(app): the right sidebar — Leaders and a Game Center with scores and stat lines (#63)
- feat(league): the Trends pane fills from week 1 — breakouts against the projection, Sleeper's 24h adds/drops, thin-marked pace and usage, season-so-far team boards (#62)
- feat(league): Chopped leagues in season — the Chopping Block: safe %, league-wide rank, chop/danger/safe bands (#61)
- fix(ci): a queued refresh decides on the latest main and keeps its own seed on a push race (#60)
- fix(advanced): the Power Score chart's phone frame scrolls sideways only (#59)
- fix(pcard): the row is "Under pressure"; PFR's line is "PFR pressures" (#58)
- fix(pcard): Under Duress says "FTN charting not posted yet" instead of a zero-blitz line (#57)
- feat(pcard): Under Duress on the passing chart — a game's dropbacks by what the defense did; refresh looks every 30 min on game days (#56)

## 2026-09-13

- fix(season): the Live view is the sum of the weeks — Sleeper's season aggregate lags the games (#55)
- feat(season): live stats during games — the Live view refreshes every minute while a game is on (#54)

## 2026-09-12

- feat(sidebar): in season, each division lists as the standings — the leader first (#53)
- fix(advanced): the Power Score chart draws at its natural size on a desktop (#52)
- fix(playbook): the in-season Red Zone / Regression freeze — a repaint loop, plus the frozen seasons' weekly blocks never loading in season (#51)
- feat(advanced): Power Score chart — logos end the lines, ordinal pills at every week, the week range names its window (#50)
- feat(season): the Power Score tracked through the season (line graph + SOS column, real points); Live view game dots and the big record (#49)

## 2026-09-11

- fix(league): the matchup hero fits a phone — stacked score, no vs column, tight bar; win % in green and red (#48)
- feat(league): one matchup hero for every format — the BAFL win bar across both sides; BAFL carries its category score and rows inside it (#47)
- fix(league): BAFL stat lines fit a phone — under the name in matchup rows, wrapping in lineup rows (#46)
- feat(league): BAFL Mode prints what each player is projected FOR — stat lines in the category currency, not a points number (#45)
- feat(league): BAFL matchups render as the BAFL app's own card — categories, ticks, projected finishes, the win-probability bar (#44)
- feat(season): the live tabs say which games they hold — "thru Thu 9/10 · LAR@SF" in the Lineup pane, the full story on hover (#43)
- feat(seed): the nflverse pulse — the live sidecar says which games it holds, the refresher rebuilds when nflverse moves, the workflow looks every two hours in season (#42)
- feat(league): waiver engine weighs sticky vs fleeting; dynasty leagues price the wire on chart value; Chopped is redraft; SR on the rushing fan (#41)
- feat(league): BAFL Mode in the League Analyzer — the category lens on sync, and a best-3-of-5 matchup card (#40)
- fix(league): projections stay projections on the Live tab; in-season only leagues in play (#39)
- feat(league+pcard): waiver wire in the Lineup pane's own rows; Leagues pill on the card; mobile hero + team-header fixes (#38)
- feat(season): in-season the Projections view opens on Live once a game has been played (#37)
- fix(rbfan): the lane label is a bare percentage; the subtitle names it (rush success rate) (#36)
- fix(ai): tool calls written as text run like real ones, the last request always answers, no call ever reaches the bubble; the Shortcuts menu icon (#35)
- feat(league): the Team tab carries This Week for the league on screen; the hub tab reads "Multi-League"; in-season refresh every scheduled run (#34)

## 2026-09-10

- feat(keys): keyboard shortcuts, one table for the handler and the sheet; the tab strip scrolls sideways (#33)
- feat(pcard+ai): open another player alongside (same chart, season, game); Compare knows what week it is (#32)
- feat(week): waiver suggestions on VOR with a protected roster; rushing-fan fantasy metrics per game (#31)
- feat(league): This Week — every league, one action list (lineup callouts, waiver reasons, FAAB pacing) (#30)
- feat(advanced): league-wide view gets its own season pills and season-over-season sparklines (#29)
- fix(charts): receiving ranks are per position (#28)
- feat(charts): league ranks on every live chart total, target chart v3, game picker, scramble rate; fix lanes/grades/OL columns in-season (#27)
- feat(inseason): Next Gen Stats per game under every chart; FTN/pbp stand-ins for the participation splits; routes-run estimate (#26)
- feat(pcard): player tabs across the card (Sleeper-style); live charts keep every player who touched the ball (#25)
- fix(inseason+pcard): live Advanced tab and season charts after one game; the back button was under ⚖ (#24)
- fix(playbook+inseason): the live-season Playbook hang, and the weekly blocks that never built (#23)
- fix(ai): the chat guard knows players by initials, and knows what "stats" means (#22)
- feat(inseason): live Playbook cards + the target chart - the free in-season route view (#21)
- feat(charts): per-game route trees, rush fans and passing charts for the season in progress (#20)
- feat(pcard)+fix(live): season tabs (BAFL design), college honesty, week-1 receiving, rookie NFL default (#19)
- fix(live): opening night showed a blank Live tab - entry raced the refresher, and the week latch froze mid-week (#18)

## 2026-09-09

- fix(advisory): BAFL derivative weighting compared partial draft sums - and had no cap (#17)

## 2026-09-08

- feat(cheat-sheet): the QB shelf at every one of your picks (#16)
- feat(advisory+ai): tier-break urgency, BAFL derivative weighting, local app-data tools (#15)
- feat(advisory): TD-scaled QB-receiver stacking in both decision cores (#14)
- feat(scoring): BAFL Mode - a category-league lens for the whole advisory (#13)
- feat(playbook): QB-first openings join the forced-pattern grid (#12)
- fix(sim): room culture applies to every chair when seats are unassigned (#11)
- feat(sim): room priors - a league's own history outweighs the market (#10)

## 2026-09-07

- feat(sim): opponents wear their validated draft personalities (#9)
- feat(manager-profile): v2/v3 study - draft tendencies are stable personal traits (#8)
- fix(ol): run half of Overall Score was a constant 50; Success Rate is RB-only and joins the grade (#7)
- feat(advanced): sparklines track league rank with a viewed-season dot; OL run card gains rush Success Rate (#6)

## 2026-09-05

- fix(mobile): seed retries behind the live board; tray only offers live columns; ADP joins the default-hidden set (#5)
- perf(link)+fix(layout): faster Sleeper league linking; window-bottom-aware shell (#4)
- fix(mobile): reveal-tray chips survive their own taps (#3)
- perf(mobile): team logos baked in — 32 data URIs, zero fetches, instant dropdown (#2)
- feat(rankings): the house columns wear the crown — TC and TC★ headers become the app logo (#1)

## Before the gate (2026-07 → 2026-09-05)

- v1.7 (2026-09-05): TC model takes opponent strength / SOS as a projection input (QB only; RB/WR null, TE rejected in the era-split test).
- Coaching / coordinator-change signal for the TC model investigated and rejected (2026-09-05): playcaller track records add nothing over the environment terms; the table stays as display data.
- Bring-your-own-model compare (⚖ on every card): browser built-in AI, a local WebLLM model, your own key against any OpenAI-compatible endpoint, or copy the grounding packet for any assistant; free-first, keys opt-in.
- MCP server (`tools/tc_mcp.py`) and the remote Cloudflare worker (`tools/mcp_worker/`): the whole seed as tools for Claude Desktop / Claude Code / the phone app; in-app Research loop bounded at three lookups.
