#!/usr/bin/env node
/**
 * Acceptance gate for the two-file migration (spec.local.md §12, plan.local.md A5).
 *
 * Compares dist/ against a pre-migration snapshot and asserts two things:
 *
 *   1. dist/models.json is unchanged except for `generated_at` (a date stamp
 *      that always moves) — i.e. not one price, model id or cache figure moved.
 *   2. dist/catalog.json differs only in the ways the migration set out to
 *      differ. Field ORDER is normalised to canonical, so this compares parsed
 *      values, not text.
 *
 * Anything outside the expected set is reported as a failure, so an accidental
 * change cannot hide among 82 rewritten files.
 *
 * Usage:
 *   node scripts/verify-migration.mjs [baselineDir]     (default /tmp/kw-baseline)
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselineDir = process.argv[2] ?? "/tmp/kw-baseline";

/** Fields the migration is allowed to change, and why. Any change to a field
    outside this map fails the gate. */
const EXPECTED = {
  // removed from the source, and from the artifact where the app can tolerate it
  icon: "removed — second icon system, superseded by the logo file",
  logo_border: "removed — dead field (the app hardcodes false)",
  price_note: "merged into desc",
  free_offer: "merged into desc",
  // placeholders kept only so pre-migration app builds still parse (§8.1)
  price_line: "published as \"\" — merged into desc, kept as a placeholder",
  users: "published as \"\" — merged into desc, kept as a placeholder",
  blurb: "published as \"\" — was empty in all 82 entries",
  added: "published as false — the app derives it at read time",
  // derived at build time
  tag_label: "derived from tag (3 entries carried a contradicting label)",
  // new
  desc: "new — one line of prose",
  price_ref: "new — projected from `flagship` (71 of 82 entries flagged)",
  // value changes with a specific cause
  models: "same-protocol duplicates dropped (8) + deepseek's label-as-id fixed",
  endpoints:
    "one extra endpoint's model order follows the models array — `serves` is a per-model map, so two endpoints with different orders cannot both be expressed. Cosmetic: it is the chip order of an extra endpoint; the primary list (which supplies the default model) keeps its order",
};

const failures = [];
const note = (ok, msg) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failures.push(msg);
};

if (!existsSync(path.join(baselineDir, "models.json"))) {
  console.error(`baseline not found in ${baselineDir} — the pre-migration snapshot is required`);
  process.exit(2);
}
const baseModels = JSON.parse(readFileSync(path.join(baselineDir, "models.json"), "utf8"));
const newModels = JSON.parse(readFileSync(path.join(repo, "dist/models.json"), "utf8"));
const baseCatalog = JSON.parse(readFileSync(path.join(baselineDir, "catalog.json"), "utf8"));
const newCatalog = JSON.parse(readFileSync(path.join(repo, "dist/catalog.json"), "utf8"));

console.log(`baseline: ${baselineDir}\n`);

// ── 1. the price table must not have moved ──
console.log("dist/models.json");
{
  const diffs = [];
  for (const k of new Set([...Object.keys(baseModels), ...Object.keys(newModels)])) {
    if (k === "generated_at") continue;
    const a = JSON.stringify(baseModels[k]);
    const b = JSON.stringify(newModels[k]);
    if (a !== b) diffs.push(k);
  }
  note(diffs.length === 0, `every key identical except generated_at (moving fields: ${diffs.join(", ") || "none"})`);
  note(
    baseModels.models.length === newModels.models.length,
    `row count unchanged (${baseModels.models.length} -> ${newModels.models.length})`,
  );
  // Values are compared row by row as well, so a reordering cannot pass as "same set".
  const sameRows =
    baseModels.models.length === newModels.models.length &&
    baseModels.models.every((r, i) => JSON.stringify(r) === JSON.stringify(newModels.models[i]));
  note(sameRows, "all rows byte-identical in the same order");
  note(newModels.version === baseModels.version, `version unchanged (${newModels.version})`);
}

// ── 2. the catalog may only differ in the expected ways ──
console.log("\ndist/catalog.json");
{
  const baseById = new Map(baseCatalog.entries.map((e) => [e.id, e]));
  const newById = new Map(newCatalog.entries.map((e) => [e.id, e]));
  note(baseById.size === newById.size, `entry count unchanged (${baseById.size} -> ${newById.size})`);
  const idsAdded = [...newById.keys()].filter((k) => !baseById.has(k));
  const idsRemoved = [...baseById.keys()].filter((k) => !newById.has(k));
  note(idsAdded.length === 0 && idsRemoved.length === 0, `same ids (added: ${idsAdded.join(",") || "none"}; removed: ${idsRemoved.join(",") || "none"})`);

  // field -> [entries where it changed], plus the split of add / change / remove
  const changed = new Map();
  const record = (field, detail) => {
    if (!changed.has(field)) changed.set(field, []);
    changed.get(field).push(detail);
  };
  for (const [id, b] of baseById) {
    const n = newById.get(id);
    if (!n) continue;
    for (const k of new Set([...Object.keys(b), ...Object.keys(n)])) {
      if (JSON.stringify(b[k]) === JSON.stringify(n[k])) continue;
      const kind = !(k in b) ? "added" : !(k in n) ? "removed" : "changed";
      record(k, `${id} (${kind})`);
    }
  }
  const unexpected = [...changed.keys()].filter((k) => !(k in EXPECTED));
  note(unexpected.length === 0, `only expected fields differ (unexpected: ${unexpected.join(", ") || "none"})`);

  console.log("\n  field                     entries  disposition");
  for (const [field, list] of [...changed.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const why = EXPECTED[field] ?? "UNEXPECTED";
    console.log(`  ${field.padEnd(24)} ${String(list.length).padStart(5)}   ${why}`);
    if (field === "tag_label" || field === "added" || field === "models") {
      for (const d of list.slice(0, 12)) console.log(`  ${"".padEnd(24)}         · ${d}`);
      if (list.length > 12) console.log(`  ${"".padEnd(24)}         · … and ${list.length - 12} more`);
    }
  }
  const untouched = Object.keys(baseCatalog.entries[0]).filter((k) => !changed.has(k));
  console.log(`\n  untouched fields: ${untouched.join(", ")}`);
}

console.log(`\n${failures.length === 0 ? "PASS" : `FAIL — ${failures.length} check(s)`}`);
process.exit(failures.length === 0 ? 0 : 1);
