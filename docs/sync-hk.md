# The HK observation point

The scheduled sync in `.github/workflows/sync.yml` runs on a US runner, and two
kinds of source refuse it: Chinese vendors that block foreign datacentre IPs
(stepfun has skipped every run since it was checked, and baidu-qianfan fails
the same way), and `ovhcloud`, which refuses the mainland networks that would
otherwise read it. A box in Hong Kong answers 200 to all of these and fails
only `openai` and `togetherai` — so the two vantage points split the catalogue
between them:

| source | US runner | HK box |
|---|---|---|
| Chinese vendors (stepfun, baidu-qianfan, …) | ✗ | ✓ |
| `ovhcloud` | ✓ | ✓ |
| `openai`, `togetherai` | ✓ | ✗ (403) |
| everything else (anthropic, gemini, …) | ✓ | ✓ |

`scripts/sync-hk.sh` is the same pipeline as the workflow — `fetch-all --write
--commit`, offline validation, a PR — with two differences: it pushes to its own
fixed branch `automation/sync-hk` (the US push is `--force-with-lease` and would
clobber commits parked on `automation/sync`), and it opens the PR with `curl`
against the REST API instead of `gh`.

## One-time setup on the box

Node ≥ 24 and a clone are assumed in place (`/root/models` below; adjust
`REPO_DIR` if different). An nvm-installed node is fine — systemd does not read
`.bashrc`, so `scripts/sync-hk.sh` falls back to the newest `~/.nvm` copy when
`node` is not on the service's PATH.

**1. A fine-grained PAT.** GitHub → Settings → Developer settings → Fine-grained
personal access tokens. Repository access: only `lightconsen/models`.
Permissions: **Contents: read and write**, **Pull requests: read and write**.
Expiry 90 days; calendar the rotation — the timer has no other secret.

**2. Push credentials.** Nothing to configure: the script pushes with the env
file's `GH_TOKEN` through a credential helper it installs for itself, and the
service has no terminal to prompt on. A `~/.git-credentials` file and a
`credential.helper` config are neither needed nor consulted.

**3. Commit identity.** The commits carry this name through review:

```bash
cd /root/models
git config user.name "kiwano-sync-hk"
git config user.email "kiwano-sync-hk@users.noreply.github.com"
```

**4. The env file.** `/etc/kiwano-sync.env`, mode 600 — the token lives here,
not in the repo:

```ini
REPO_DIR=/root/models
BRANCH=automation/sync-hk
GH_TOKEN=github_pat_…
```

**5. The timer.** The unit files live in this repo's `deploy/`, so the box gets
them the way it gets everything else — by pulling. Nothing is copied between
machines; the clone is the only source:

```bash
cd /root/models && git pull
sudo scripts/sync-hk.sh install
```

`install` copies `deploy/sync-hk.service` and `deploy/sync-hk.timer` into
`/etc/systemd/system/`, daemon-reloads, enables the timer, and runs the sync
once so the first output is right there. It refuses to run if
`/etc/kiwano-sync.env` is missing, and is safe to re-run after a pull that
changed the units.

The timer fires 13:23 HKT daily, ahead of the US run (06:43 UTC = 14:43 HKT), so
both PRs are ready for review in the same afternoon. `Persistent=true` catches
up a missed run after downtime.

## First run and verification

`install` already runs the sync once. To rerun it at any time:

```bash
systemctl start sync-hk.service
journalctl -u sync-hk.service -n 100
```

Expected: the fetch-all output, `no commits — nothing to open a PR for` on a
quiet day, or a push plus `opened a PR` when a vendor moved. On GitHub, the PR
titled "Sync prices from the HK observation point" reads like PR #1 does:
per-entry commits, skipped sources named. Price-only runs merge themselves (automerge.yml); a run that adds or leaves a model waits for a person.

## Operations

- **Logs** live in the journal: `journalctl -u sync-hk.service`. Rerun any time
  with `systemctl start sync-hk.service` — it is idempotent (reset to origin
  main, re-read, re-propose).
- **Exit codes**: 0 ran fine; 2 = offline validation failed, nothing was pushed;
  3 = push failed (usually the PAT expiring).
- **Version collisions.** Most days at most one point finds a change. If both
  PRs carry the `global.json` bump, merge one; the other re-bases itself on its
  next run — the reset to `origin/main` at the top of the script re-reads from
  the merged base and re-proposes, a day later. There is nothing to resolve by
  hand.
- **A skipped source is a fact, not a failure.** `fetch-all` exits nonzero when
  any entry cannot be read; the commits from the others still push, and the PR
  body carries the exit code. That is how `openai`/`togetherai` (403 from here)
  live their daily life.

## Why not the mainland box

The mainland machine that started this investigation runs an OS too old for
Node 24 (its glibc predates 2.28), and the HK box covers its role entirely:
every Chinese source answers 200 from Hong Kong, because these vendors block
*foreign datacentre* IPs, not all of them — the HK range is not on stepfun's
list. The mainland machine is retired for this job.
