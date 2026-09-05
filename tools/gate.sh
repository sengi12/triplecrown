#!/bin/bash
# The gated push, as a command.
#
#   tools/gate.sh -m /path/msg.txt file1 file2 ...          # classic: local 12-min suite, then push
#   tools/gate.sh --ci -m /path/msg.txt file1 file2 ...     # CI mode: branch + PR + auto-merge;
#                                                           # GitHub runs the suite, merges on green
#
# CI mode frees the machine in seconds and enforces the same full suite via the Tests
# workflow (plus its build-drift check). Rules either way: explicit file lists only,
# message via -F file (bash 3.2 heredoc quoting bites), never touch listed files while
# a classic gate runs.
set -e
cd "$(dirname "$0")/.."
CI=0; MSG=""
while [ $# -gt 0 ]; do case "$1" in
  --ci) CI=1; shift;;
  -m) MSG="$2"; shift 2;;
  *) break;;
esac; done
[ -n "$MSG" ] && [ -f "$MSG" ] || { echo "usage: gate.sh [--ci] -m msgfile files..."; exit 2; }
[ $# -gt 0 ] || { echo "no files listed"; exit 2; }

if [ "$CI" = "1" ]; then
  BR="gate/$(date +%Y%m%d-%H%M%S)"
  git checkout -b "$BR"
  git add "$@"
  git commit -F "$MSG"
  git push -u origin "$BR"
  gh pr create --fill-first --body-file "$MSG" >/dev/null
  gh pr merge --auto --squash
  git checkout main
  echo "CI gate open: suite runs on GitHub; auto-merges on green. Branch: $BR"
else
  bash tests/run_tests.sh > /tmp/gate_tests.log 2>&1 || { echo "SUITE FAILED"; tail -20 /tmp/gate_tests.log; exit 1; }
  tail -3 /tmp/gate_tests.log
  git add "$@"
  git commit -F "$MSG"
  git pull --rebase
  git push
  echo PUSHED
fi
