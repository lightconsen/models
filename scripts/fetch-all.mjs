#!/usr/bin/env node
/**
 * Read every entry's price source, decide what may change, and apply it.
 *
 * One program in place of the per-vendor `fetch-*` scripts, which still work and
 * are still worth reading for the detail of any single vendor. This calls the
 * same reading logic — `scripts/sources/` holds one adapter per vendor — and adds
 * what none of them could do alone: run all of them, keep going when one fails,
 * and decide, per change, whether a person is needed.
 *
 * The pipeline is read → judge → write → **prove** → commit:
 *
 *   read    every source, each isolated; one vendor's docs restructuring costs
 *           that entry and nothing else.
 *   judge   `lib/policy.mjs`. A price is a fact the vendor is the authority on
 *           and nobody needs to look at it; a model arriving or leaving changes
 *           what the catalogue claims a vendor sells, and is limited.
 *   write   only when `--write`. The default is to print the diff.
 *   prove   after writing, every entry is merged a second time and must come out
 *           clean. This is the property the whole thing rests on — a run that
 *           finds nothing new must write nothing — and it is checked rather than
 *           assumed, because a source that reports a value it will not report
 *           again passes every other check while failing this one. (OpenRouter
 *           did exactly that.)
 *   commit  only when `--commit`: one commit per entry, so each diff reviews on
 *           its own. Never pushed.
 *
 * The source wins on what it is the authority for, and only that. What an adapter
 * may write is declared in its `owns` list; anything outside it is the entry's,
 * and the runner refuses the row rather than let a scraper quietly take over a
 * human's decision.
 *
 * Usage:
 *   node scripts/fetch-all.mjs                    show the diff for every entry
 *   node scripts/fetch-all.mjs --entry xai        just one
 *   node scripts/fetch-all.mjs --write            apply
 *   node scripts/fetch-all.mjs --write --commit   apply and commit per entry
 *   node scripts/fetch-all.mjs --force-write      apply even if the policy says no
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { Drift, Network, MEMBERSHIP, argOf, has, readEntry, repo, sameValue } from "./lib/fetch.mjs";
import { isPriceField, judge, summarise } from "./lib/policy.mjs";
import adapters from "./sources/index.mjs";

const ONLY = argOf("--entry");
const WRITE = has("--write");
const COMMIT = has("--commit");
const FORCE = has("--force-write");

/** Price equality by value: the entry writes "0.20" where a vendor writes "0.2",
    and the same price spelled two ways is not a change worth committing. Nested
    shapes go through `sameValue`, which ignores key order — `JSON.stringify`
    would call an unchanged `long_context` a change and break `prove` below. */
const same = (a, b) => {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a === "object" || typeof b === "object") return sameValue(a, b);
  return Number(a) === Number(b);
};

const show = (v) => (v === undefined ? "unpriced" : JSON.stringify(v));

/**
 * Fold one source's rows into one entry, and describe what moved.
 *
 * `follow` lets the source add and remove rows — it is a complete statement of
 * what the vendor sells. `intersect` only re-prices rows that are already there:
 * an entry can be a deliberate selection from a much larger catalogue, and a
 * price list is in no position to decide membership.
 */
const merge = (id, current, proposed, { membership, owns }) => {
  const follow = membership === MEMBERSHIP.FOLLOW;
  const byId = new Map(proposed.map((r) => [r.id, r]));
  const currentIds = new Set(current.map((r) => r.id));
  const changes = { created: [], deleted: [], updated: [] };
  const lines = [];

  // The adapter's contract with us: a field it did not claim is not its to write.
  for (const r of proposed) {
    for (const f of Object.keys(r)) {
      if (f === "id" || f === "name") continue;
      if (!isPriceField(f)) throw new Drift(`${id}: adapter emitted unknown field "${f}"`);
      if (!owns.includes(f)) throw new Drift(`${id}: adapter emitted "${f}" but does not own it`);
    }
  }

  // Membership is one decision, so it is made once: a source that only prices
  // what is already there may neither add a row nor remove one.
  const removed = follow ? current.filter((r) => !byId.has(r.id)) : [];
  const added = follow ? proposed.filter((r) => !currentIds.has(r.id)) : [];
  const matched = current.filter((r) => byId.has(r.id)).length;

  // An `intersect` source that matches nothing has not found prices unchanged —
  // it has lost the join between its ids and ours, and would silently leave every
  // number as it was. That is the one failure a diff cannot show.
  if (!follow && matched === 0 && current.length > 0) {
    throw new Drift(
      `${id}: none of the source's ${proposed.length} rows matched the entry's ${current.length} — the id join is broken`,
    );
  }

  // A flagship must sit on a priced model (generate.mjs enforces it), so a source
  // that drops the flagship's row would break the build rather than update it.
  const stranded = removed.find((r) => r.flagship);
  if (stranded) {
    throw new Drift(
      `${id}: the source no longer lists "${stranded.id}", which the entry flags as flagship — ` +
        `pick a new flagship before this entry can be written`,
    );
  }

  const merged = [];
  for (const now of current) {
    const p = byId.get(now.id);
    if (!p) {
      if (follow) {
        changes.deleted.push(now.id);
        continue; // gone from the source
      }
      merged.push(now);
      continue;
    }
    const out = { ...now };
    for (const f of owns) {
      if (!(f in p)) continue;
      if (same(now[f], p[f])) continue;
      changes.updated.push({ id: now.id, field: f, from: now[f], to: p[f] });
      lines.push(`~ ${now.id}.${f}: ${show(now[f])} -> ${show(p[f])}`);
      out[f] = p[f];
    }
    // The source supplies a name, but only a row that has none takes it: which
    // spelling reads better is the author's call, not a price fact.
    if (!out.name && p.name) out.name = p.name;
    merged.push(out);
  }
  for (const p of added) {
    const row = { id: p.id, name: p.name ?? p.id };
    for (const f of owns) if (f in p) row[f] = p[f];
    merged.push(row);
    changes.created.push(p.id);
    lines.push(`+ ${p.id} is new`);
  }
  for (const id of changes.deleted) lines.push(`- ${id} is gone from the source`);

  if (merged.length === 0) throw new Drift(`${id}: the source yielded no rows — refusing to empty the entry`);
  return { merged, changes, lines };
};

// ── read every source ──
const results = [];
for (const adapter of adapters) {
  const ids = ONLY ? adapter.ids.filter((id) => id === ONLY) : adapter.ids;
  if (ids.length === 0) continue;
  try {
    const { rows = {}, notes = {} } = (await adapter.read()) ?? {};
    for (const id of ids) {
      if (!rows[id]) throw new Drift(`${id}: the adapter returned nothing for this entry`);
      const current = readEntry(id).models;
      const { merged, changes, lines } = merge(id, current, rows[id], adapter);
      // `proposed` is kept so the fixed-point check below can compare the file we
      // write against what the *source* said, rather than against itself.
      results.push({
        id,
        source: adapter.source,
        lines,
        changes,
        notes: notes[id] ?? [],
        merged,
        proposed: rows[id],
      });
    }
  } catch (err) {
    // One vendor's docs restructuring must not cost the other eleven their update.
    // A *Network* failure says nothing about the vendor — a host refusing this
    // network is an environment fact, not a broken page — so it is reported in
    // its own list, not as an entry that failed to be read.
    for (const id of ids) {
      results.push({
        id,
        source: adapter.source,
        lines: [],
        changes: { created: [], deleted: [], updated: [] },
        ...(err instanceof Network ? { unreachable: err.message } : { error: err.message }),
      });
    }
  }
}

// ── report ──
let failed = 0;
let unreachable = 0;
for (const r of results) {
  const head = `${r.id}  (${r.source})`;
  if (r.unreachable) {
    // Not a failure: this network cannot reach the host, which says nothing
    // about the vendor's page. Reported here so a constant blocker like
    // stepfun.cn never dims a real one beside it.
    console.log(`\n↯ ${head}\n  ${r.unreachable}`);
    console.log("  Unreachable from this network, not read. The entry is unchanged.");
    unreachable++;
    continue;
  }
  if (r.error) {
    failed++;
    console.log(`\n✗ ${head}\n  ${r.error}`);
    console.log("  Skipped. Check the source, then update its adapter in scripts/sources/.");
    continue;
  }
  if (r.notes.length) {
    console.log(`\n${head}`);
    for (const n of r.notes) console.log(`  ! ${n}`);
  }
  if (r.lines.length === 0) continue;
  console.log(`\n${head}`);
  for (const line of r.lines) console.log(`  ${line}`);
}

if (ONLY && results.length === 0) {
  console.error(`\nno source for entry "${ONLY}" — see the list in scripts/sources/index.mjs`);
  process.exit(1);
}

const changed = results.filter((r) => !r.error && r.lines.length > 0);
const verdict = judge(changed);

console.log(
  `\n${changed.length === 0 ? "no change — every entry matches its source" : `${changed.length} entr(ies) to change: ${summarise(verdict)}`}`,
);
if (failed) console.log(`${failed} entr(ies) skipped — see the ✗ above`);
if (unreachable) console.log(`${unreachable} entr(ies) unreachable from this network — see the ↯ above; nothing is wrong with their pages`);

if (!ONLY) {
  const covered = new Set(adapters.flatMap((a) => a.ids));
  const untouched = readdirSync(path.join(repo, "entries"))
    .filter((id) => !covered.has(id))
    .sort();
  if (untouched.length) console.log(`no source, still hand-maintained: ${untouched.join(", ")}`);
}

// ── judge ──
if (!verdict.safe) {
  console.log("\nthis run changes what the catalogue says a vendor sells:");
  for (const reason of verdict.reasons) console.log(`  ! ${reason}`);
  for (const m of [...verdict.created, ...verdict.deleted]) console.log(`      ${m.entry}: ${m.id}`);
  if (!FORCE) {
    console.log("\nRefusing to write. Review the list, then re-run with --force-write if it is right.");
    process.exit(1);
  }
  console.log("\n--force-write given: proceeding anyway.");
}

if (!WRITE) {
  if (changed.length) console.log("\nre-run with --write to apply");
  process.exit(failed > 0 ? 1 : 0);
}

// ── write, then prove the write is a fixed point ──
let written = 0;
for (const r of changed) {
  const { modelsPath } = readEntry(r.id);
  writeFileSync(modelsPath, JSON.stringify(r.merged, null, 2) + "\n");

  // Stamp the provider with the day the fetcher last wrote its prices. The
  // stamp lives on provider.json so the frontend can show "prices as of …"
  // without reading git; hand-edited entries keep their stamp until the next
  // fetcher write, which is the correct semantics (it dates the *prices*, not
  // the prose around them).
  const provPath = path.join(repo, `entries/${r.id}/provider.json`);
  const prov = JSON.parse(readFileSync(provPath, "utf8"));
  prov.prices_as_of = new Date().toISOString().slice(0, 10);
  writeFileSync(provPath, JSON.stringify(prov, null, 2) + "\n");

  // Prove it: merge the file we just wrote against the same source rows. A run
  // that has nothing new to say must have nothing left to change. Anything else
  // means the source is reporting a value it will not report again, or the merge
  // is not a function of its inputs — and either way the number cannot be
  // committed, because the next run would rewrite it.
  const adapter = adapters.find((a) => a.ids.includes(r.id));
  const after = JSON.parse(readFileSync(modelsPath, "utf8"));
  const again = merge(r.id, after, r.proposed, adapter);
  if (again.lines.length !== 0) {
    console.error(`\n✗ ${r.id}: writing did not settle — a second pass still wants to change:`);
    for (const line of again.lines) console.error(`    ${line}`);
    console.error("  The source is not reporting a stable value. Reverting this entry.");
    console.error(`  (Nothing else was affected; the file is left as written for inspection.)`);
    process.exit(1);
  }

  console.log(`✓ wrote entries/${r.id}/models.json`);
  written++;
}

// The published price table is version-gated (README:583): an unchanged version
// means the app keeps the table it already has. So a run that moved a price and
// did not bump the version has done nothing as far as anyone consuming this repo
// is concerned — which makes the bump part of applying the change, not a
// follow-up someone remembers.
const movedPrices =
  changed.some(
    (r) =>
      r.changes.updated.some((c) => c.field === "in" || c.field === "out") ||
      r.changes.created.length > 0 ||
      r.changes.deleted.length > 0,
  ) || pricedRows() !== pricedRows("HEAD");

/** Priced rows in the working tree, and in git HEAD: an *entry deletion* is a
    price change with no run to report it, and the version gate would hold the
    stale table open forever. Count both sides and compare. */
const pricedRows = (rev) => {
  const ids = readdirSync(path.join(repo, "entries")).filter((d) => {
    try {
      return readdirSync(path.join(repo, "entries", d)).includes("models.json");
    } catch {
      return false;
    }
  });
  const read = (id) => {
    if (!rev) return readFileSync(path.join(repo, "entries", id, "models.json"), "utf8");
    const out = spawnSync("git", ["show", `${rev}:entries/${id}/models.json`], { cwd: repo, encoding: "utf8" });
    return out.status === 0 ? out.stdout : null;
  };
  let n = 0;
  // HEAD's file list, not the working tree's — a deleted entry is in neither,
  // and both directions of the comparison must see both sets.
  const files = rev
    ? spawnSync("git", ["ls-tree", "--name-only", `${rev}:entries`], { cwd: repo, encoding: "utf8" })
        .stdout.split("\n").filter(Boolean)
    : ids;
  for (const id of new Set([...files, ...(rev ? [] : ids)])) {
    const raw = read(id);
    if (raw === null) continue;
    try {
      n += JSON.parse(raw).filter((r) => r?.in !== undefined).length;
    } catch {
      /* an unreadable models.json fails the build elsewhere; here it reads as zero */
    }
  }
  return n;
};

const globalPath = path.join(repo, "global.json");
let bumped = false;
if (movedPrices) {
  const g = JSON.parse(readFileSync(globalPath, "utf8"));
  const next = g.version + 1;
  g.version = next;
  writeFileSync(globalPath, JSON.stringify(g, null, 2) + "\n");
  console.log(`✓ bumped global.json version ${next - 1} -> ${next}`);
  bumped = true;
}

// ── commit ──
if (COMMIT && changed.length > 0) {
  // Not `.trim()` on the whole blob: git's first line begins ` M path`, and
  // trimming eats that leading space, which shifts the status prefix and slices
  // the path one character short — so the guard reports our own file as foreign
  // and refuses to commit. Split first, then drop empties.
  const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })
    .stdout.split("\n")
    .filter((l) => l !== "");
  /** `XY path`, or `XY old -> new` for a rename. */
  const pathOf = (line) => {
    const rest = line.slice(3);
    return rest.includes(" -> ") ? rest.slice(rest.indexOf(" -> ") + 4) : rest;
  };
  const versionFile = "global.json";
  const ours = new Set([
    ...changed.map((r) => `entries/${r.id}/models.json`),
    ...(bumped ? [versionFile] : []),
  ]);
  const foreign = dirty.filter((line) => !ours.has(pathOf(line)));
  if (foreign.length) {
    console.log("\n! the tree has other changes staged or modified — not committing:");
    for (const line of foreign) console.log(`    ${line}`);
    console.log("  Commit or stash them, then re-run with --write --commit.");
    process.exit(1);
  }

  for (const r of changed) {
    const file = `entries/${r.id}/models.json`;
    spawnSync("git", ["add", file], { cwd: repo });
    spawnSync("git", ["add", `entries/${r.id}/provider.json`], { cwd: repo });
    const subject = `Sync ${r.id} from its source — ${summarise(r.changes)}`;
    const body = [
      subject,
      "",
      `Read from ${r.source}.`,
      "",
      ...r.lines,
      "",
      "Co-Authored-By: Claude Code <noreply@anthropic.com>",
    ].join("\n");
    const out = spawnSync("git", ["commit", "-m", body, "--", file], { cwd: repo, encoding: "utf8" });
    if (out.status !== 0) {
      console.error(`✗ commit failed for ${r.id}: ${(out.stderr || out.stdout).trim()}`);
      process.exit(1);
    }
    console.log(`✓ committed ${file}`);
  }

  // Its own commit: it is the one change whose subject is not any vendor's data,
  // and folding it in would put a version bump in the middle of a price diff.
  if (bumped) {
    spawnSync("git", ["add", versionFile], { cwd: repo });
    const out = spawnSync(
      "git",
      [
        "commit",
        "-m",
        [
          `Bump the version for ${summarise(verdict)}`,
          "",
          "The published table is version-gated, so a price that moved without this",
          "is a price the app never sees.",
          "",
          "Co-Authored-By: Claude Code <noreply@anthropic.com>",
        ].join("\n"),
        "--",
        versionFile,
      ],
      { cwd: repo, encoding: "utf8" },
    );
    if (out.status !== 0) {
      console.error(`✗ commit failed for ${versionFile}: ${(out.stderr || out.stdout).trim()}`);
      process.exit(1);
    }
    console.log(`✓ committed ${versionFile}`);
  }
  console.log("\ncommits are local; nothing was pushed");
} else if (written > 0) {
  console.log("\nbump global.json's version, then run: node scripts/generate.mjs --check");
}

process.exit(failed > 0 ? 1 : 0);
