#!/usr/bin/env node
/**
 * Read every entry's price source and show what it would change.
 *
 * One program in place of the per-vendor `fetch-*` scripts, which still work and
 * are still worth reading for the detail of any single vendor. This calls the
 * same reading logic — `scripts/sources/` holds one adapter per vendor — and adds
 * what none of them could do alone: run all of them, keep going when one fails,
 * and report the whole catalogue in one pass.
 *
 * Same contract as the family it replaces. It prints a diff and writes nothing
 * unless given `--write`; the data stays hand-reviewed and git-committed, never
 * fetched into a build. `generate.mjs` still never touches the network.
 *
 * Which fields move, and which do not, is the heart of it. The source wins on
 * what it can actually know — the prices, and for a `follow` source the list of
 * models itself. The entry wins on judgement the source has no way to express:
 * `flagship` (which model leads the list) and `serves` (which upstream string the
 * endpoint answers to). Both are carried across untouched, because a scraper that
 * re-derives them would silently rewrite a human's decision as a guess.
 *
 * Usage:
 *   node scripts/fetch-all.mjs                 show the diff for every entry
 *   node scripts/fetch-all.mjs --entry xai     just one
 *   node scripts/fetch-all.mjs --write         apply
 */
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Drift, MEMBERSHIP, argOf, has, readEntry, repo } from "./lib/fetch.mjs";
import adapters from "./sources/index.mjs";

/** The fields a source is allowed to set. Everything else on a row is the entry's. */
const PRICE_FIELDS = ["in", "out", "cache_read", "cache_creation", "long_context", "off_peak", "peak_hours"];

const ONLY = argOf("--entry");
const WRITE = has("--write");

/** A price field by value: the entry writes "0.20" where a vendor writes "0.2",
    and the same price spelled two ways is not a change worth committing. */
const same = (a, b) => {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return Number(a) === Number(b);
};

const show = (v) => (v === undefined ? "unpriced" : JSON.stringify(v));

/**
 * Fold one source's rows into one entry.
 *
 * `follow` lets the source add and remove rows — it is a complete statement of
 * what the vendor sells. `intersect` only re-prices rows that are already there:
 * an entry can be a deliberate selection from a much larger catalogue, and a
 * price list is in no position to decide membership.
 */
const merge = (id, current, proposed, membership) => {
  const lines = [];
  const follow = membership === MEMBERSHIP.FOLLOW;
  const byId = new Map(proposed.map((r) => [r.id, r]));
  const currentIds = new Set(current.map((r) => r.id));
  // Membership is one decision, so it is made once: a source that only prices
  // what is already there may neither add a row nor remove one.
  const removed = follow ? current.filter((r) => !byId.has(r.id)) : [];
  const added = follow ? proposed.filter((r) => !currentIds.has(r.id)) : [];
  const matched = current.filter((r) => byId.has(r.id)).length;

  // An `intersect` source that matches nothing has not found prices unchanged —
  // it has lost the join between its ids and ours, and would silently leave every
  // number as it was. That is the one failure a diff cannot show.
  if (!follow && matched === 0 && current.length > 0) {
    throw new Drift(`${id}: none of the source's ${proposed.length} rows matched the entry's ${current.length} — the id join is broken`);
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
      if (membership === MEMBERSHIP.FOLLOW) continue; // gone from the source
      merged.push(now);
      continue;
    }
    const out = { ...now };
    for (const f of PRICE_FIELDS) {
      if (!(f in p)) continue;
      if (same(now[f], p[f])) continue;
      lines.push(`~ ${now.id}.${f}: ${show(now[f])} -> ${show(p[f])}`);
      out[f] = p[f];
    }
    // The source supplies a name, but only a row that has none takes it: which
    // spelling reads better is the author's call, not a price fact.
    if (!out.name && p.name) out.name = p.name;
    merged.push(out);
  }
  for (const p of added) {
    const row = { id: p.id };
    if (p.name) row.name = p.name;
    for (const f of PRICE_FIELDS) if (f in p) row[f] = p[f];
    merged.push(row);
  }
  for (const now of removed) lines.push(`- ${now.id} is gone from the source`);

  if (merged.length === 0) throw new Drift(`${id}: the source yielded no rows — refusing to empty the entry`);
  if (added.length) lines.unshift(...added.map((p) => `+ ${p.id} is new`));
  return { merged, lines };
};

// ── read every source ──
const results = [];
for (const adapter of adapters) {
  const ids = ONLY ? adapter.ids.filter((id) => id === ONLY) : adapter.ids;
  if (ids.length === 0) continue;
  try {
    const { rows = {}, notes = {} } = (await adapter.read()) ?? {};
    for (const id of ids) {
      const current = readEntry(id).models;
      if (!rows[id]) throw new Drift(`${id}: the adapter returned nothing for this entry`);
      const { merged, lines } = merge(id, current, rows[id], adapter.membership ?? MEMBERSHIP.FOLLOW);
      results.push({ id, source: adapter.source, lines, notes: notes[id] ?? [], merged });
    }
  } catch (err) {
    // One vendor's docs restructuring must not cost the other eleven their update.
    for (const id of ids) results.push({ id, source: adapter.source, error: err.message });
  }
}

// ── report ──
let changed = 0;
let failed = 0;
for (const r of results) {
  const head = `${r.id}  (${r.source})`;
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
  changed += r.lines.length;
  console.log(`\n${head}`);
  for (const line of r.lines) console.log(`  ${line}`);
}

if (ONLY && results.length === 0) {
  console.error(`\nno source for entry "${ONLY}" — see the list in scripts/sources/index.mjs`);
  process.exit(1);
}

console.log(`\n${changed === 0 ? "no change — every entry matches its source" : `${changed} change(s) across ${results.filter((r) => r.lines?.length).length} entr(ies)`}`);
if (failed) console.log(`${failed} entr(ies) skipped — see the ✗ above`);

// Only meaningful on a full run: narrowing to one entry would otherwise report
// every entry it did not look at as having no source.
// Every entry the adapters do not reach, said out loud: an entry with no source
// is a fact about the entry, and silence about it reads as coverage.
if (!ONLY) {
  const covered = new Set(adapters.flatMap((a) => a.ids));
  const untouched = readdirSync(path.join(repo, "entries"))
    .filter((id) => !covered.has(id))
    .sort();
  if (untouched.length) console.log(`no source, still hand-maintained: ${untouched.join(", ")}`);
}

if (WRITE) {
  let written = 0;
  for (const r of results) {
    if (r.error || r.lines.length === 0) continue;
    writeFileSync(readEntry(r.id).modelsPath, JSON.stringify(r.merged, null, 2) + "\n");
    console.log(`✓ wrote entries/${r.id}/models.json`);
    written++;
  }
  if (written > 0) console.log("\nbump global.json's version, then run: node scripts/generate.mjs --check");
  else console.log("\nnothing to write");
}

process.exit(failed > 0 ? 1 : 0);
