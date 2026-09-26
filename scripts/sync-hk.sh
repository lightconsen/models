#!/usr/bin/env bash
# sync-hk — the Hong Kong observation point's daily price sync.
#
# The same pipeline as .github/workflows/sync.yml, on a box whose network reads
# what the US runner cannot: the Chinese vendors (stepfun, baidu-qianfan, the
# long tail as it lands) and ovhcloud. What this box cannot read — today openai
# and togetherai — fetch-all skips, exactly as the US run skips stepfun; between
# the two vantage points every entry is read every day.
#
# Two rules carried over from sync.yml:
# - never touch main: the run commits to a branch and opens a PR. Price-only
#   PRs merge themselves (automerge.yml); one that adds or leaves a model
#   waits for a person — an unattended membership change is what would make
#   every "checked <date>" line in the checklist mean nothing
# - one fixed branch name, so a run that finds something updates the PR already
#   open instead of stacking one per day
#
# The branch is not the US one (automation/sync vs automation/sync-hk) because
# the US push is --force-with-lease and would clobber commits parked here.
#
# Setup lives in docs/sync-hk.md. `install` (run as root, from the pulled
# clone) copies deploy/sync-hk.* into /etc/systemd/system and enables the
# timer — nothing is copied between machines; the repo is the only source.
# With no argument the script runs the sync, and env comes from the systemd
# env file:
#   REPO_DIR  where the clone lives           (/root/models)
#   BRANCH    the fixed branch to push        (automation/sync-hk)
#   GH_TOKEN  fine-grained PAT, this repo only (contents + pull-requests)
#   API       override only for a fork        (lightconsen/models)

set -uo pipefail

MODE="${1:-run}"

if [ "$MODE" = "install" ]; then
  [ "$(id -u)" = 0 ] || { echo "install must run as root (sudo)" >&2; exit 1; }
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  [ -f "$here/deploy/sync-hk.service" ] && [ -f "$here/deploy/sync-hk.timer" ] \
    || { echo "unit files missing under $here/deploy" >&2; exit 1; }
  [ -f /etc/kiwano-sync.env ] \
    || { echo "/etc/kiwano-sync.env is missing — write it first (docs/sync-hk.md, step 4)" >&2; exit 1; }
  cp -f "$here/deploy/sync-hk.service" "$here/deploy/sync-hk.timer" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now sync-hk.timer
  echo "timer enabled (daily 13:23 HKT) — first run now, blocking until it finishes:"
  code=0
  systemctl start sync-hk.service || code=$?
  journalctl -u sync-hk.service -n 100 --no-pager
  exit $code
fi

REPO_DIR="${REPO_DIR:?REPO_DIR must be set (docs/sync-hk.md)}"
BRANCH="${BRANCH:-automation/sync-hk}"
GH_TOKEN="${GH_TOKEN:?GH_TOKEN must be set (fine-grained PAT for this repo)}"
API="${API:-https://api.github.com/repos/lightconsen/models}"

cd "$REPO_DIR" || { echo "no repository at $REPO_DIR" >&2; exit 1; }

# systemd does not read .bashrc and does not even set $HOME for a root
# service, so an nvm-installed node is invisible to the service. Fall back to
# the newest nvm copy before declaring failure.
if ! command -v node >/dev/null 2>&1; then
  home="${HOME:-$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f6)}"
  home="${home:-$(awk -F: -v u="$(id -un)" '$1==u {print $6}' /etc/passwd 2>/dev/null)}"
  home="${home:-$(dirname "$REPO_DIR")}"
  newest="$(ls -d "$home"/.nvm/versions/node/v* 2>/dev/null | sort -V | tail -1)"
  [ -n "$newest" ] && export PATH="$newest/bin:$PATH"
fi
command -v node >/dev/null 2>&1 || { echo "node not on PATH and no nvm copy found" >&2; exit 1; }

# Run from the current main every time. Commits and the global.json bump then
# sit on the newest base, so when the other observation point's PR has merged,
# this run's bump lands past it instead of colliding with it in a merge.
#
# The reset can replace this very file (a pull that touched sync-hk.sh). Bash
# reads scripts lazily, so continuing in-process would run a mix of the old and
# new text — which is exactly what the first broken run did. Re-exec instead.
old_blob="$(git rev-parse "HEAD:scripts/sync-hk.sh" 2>/dev/null || true)"
git fetch origin main || exit 1
git reset --hard origin/main
git clean -fdq
[ "$old_blob" = "$(git rev-parse "HEAD:scripts/sync-hk.sh" 2>/dev/null)" ] \
  || exec bash "${BASH_SOURCE[0]}" "$@"

log="$(mktemp)"
code=0
node scripts/fetch-all.mjs --write --commit >"$log" 2>&1 || code=$?
cat "$log"

# A source this box cannot read exits nonzero having written nothing for that
# entry — that is not a reason to lose the entries that did work.
n="$(git rev-list --count origin/main..HEAD)"
if [ "$n" = 0 ]; then
  echo "no commits — nothing to open a PR for (fetch exited $code)"
  exit 0
fi

# The written data has to pass the gate a person's PR would.
node scripts/generate.mjs --check || exit 2
node scripts/test-policy.mjs || exit 2

# The push authenticates from GH_TOKEN itself: systemd gives this process no
# terminal to prompt on, and with no $HOME its global config would hide any
# stored credential anyway. Clear the helper list, install one that answers
# git's prompt from the env file, and forbid a terminal fallback — a bad token
# must fail loudly, not hang.
GIT_TERMINAL_PROMPT=0 git -c credential.helper= \
  -c 'credential.helper=!f(){ printf "username=%s\npassword=%s\n" "$GH_TOKEN" "$GH_TOKEN"; }; f' \
  push --force-with-lease origin "HEAD:refs/heads/$BRANCH" || exit 3

# The PR body, worded like the US one's: per-entry commits, the skipped sources
# named, the full log folded away.
body="$(mktemp)"
{
  echo "The HK observation point's daily run found changes in the vendors' published prices."
  echo
  echo "Each commit below is one entry, so every diff is the change to that vendor"
  echo "alone. The last is the \`global.json\` version bump — the published table is"
  echo "version-gated, so without it the app never sees any of this."
  echo
  echo "Read it the way the checklist asks: \`in\` / \`out\` / \`cache_read\` against"
  echo "the vendor's own page. A correct reading reports \`no change\`, so anything"
  echo "here is a source disagreeing with what the entry carries."
  echo
  if [ "$code" != "0" ]; then
    echo "> **This run exited $code** — at least one source could not be read from"
    echo "> this box and was skipped (today that is openai and togetherai, the US"
    echo "> runner's half). The log below names every one."
    echo
  fi
  echo "### Commits"
  echo
  git log --format='- `%h` %s' origin/main..HEAD
  echo
  echo "<details><summary>Full run log</summary>"
  echo
  echo '```'
  cat "$log"
  echo '```'
  echo
  echo "</details>"
  echo
  echo "---"
  echo
  echo "Opened by \`scripts/sync-hk.sh\` on the HK box. Price-only runs merge"
  echo "themselves; a run that adds or leaves a model waits for a person."
} >"$body"

post="$(mktemp)" patch="$(mktemp)"
BODY="$body" POST="$post" PATCH="$patch" BRANCH="$BRANCH" node -e '
  const fs = require("fs");
  const body = fs.readFileSync(process.env.BODY, "utf8");
  fs.writeFileSync(process.env.POST, JSON.stringify({
    title: "Sync prices from the HK observation point",
    body, base: "main", head: process.env.BRANCH,
  }));
  fs.writeFileSync(process.env.PATCH, JSON.stringify({
    title: "Sync prices from the HK observation point", body,
  }));
'

# Plain curl — no gh on this box. A PAT for the same repo drives both the push
# (credential.helper store, seeded once) and these calls.
auth=(-H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" -H "Content-Type: application/json")
existing="$(curl -fsS "${auth[@]}" "$API/pulls?head=lightconsen:$BRANCH&state=open" \
  | grep -m1 -o '"number":[0-9]*' | tr -dc 0-9 || true)"

if [ -n "$existing" ]; then
  curl -fsS -X PATCH "${auth[@]}" "$API/pulls/$existing" -d @"$patch" >/dev/null \
    && echo "updated PR #$existing" \
    || echo "⚠ the commits are pushed, but the PR could not be updated — check GH_TOKEN and API in /etc/kiwano-sync.env"
else
  curl -fsS -X POST "${auth[@]}" "$API/pulls" -d @"$post" >/dev/null \
    && echo "opened a PR" \
    || echo "⚠ the commits are pushed, but the PR could not be opened — check GH_TOKEN and API in /etc/kiwano-sync.env"
fi
