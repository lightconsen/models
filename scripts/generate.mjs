#!/usr/bin/env node
/**
 * Validate + build the Kiwano Hub data files.
 *
 * Source of truth (hand-edited, git-reviewed):
 *   data/catalog.json  – Models-page catalog, bare array of entries
 *   data/models.json   – model pricing + exchange rates
 *
 * Published shapes (written to dist/, uploaded to R2 by CI):
 *   dist/catalog.json   {"total": N, "entries": [...]}  – Hub protocol v0
 *   dist/models.json    {...source, generated_at: today}
 *   dist/manifest.json  counts/versions + sha256 of both artifacts
 *
 * Usage:
 *   node scripts/generate.mjs             validate + write dist/
 *   node scripts/generate.mjs --check     validate only, no writes (PR gate)
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(path.join(repo, f), "utf8"));

let failed = 0;
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  failed++;
};

// ── data/catalog.json ──

console.log("data/catalog.json");
const catalog = read("data/catalog.json");
if (!Array.isArray(catalog) || catalog.length === 0) {
  fail("must be a non-empty array");
}

const BILLINGS = new Set(["plan", "payg", "unl"]);
const PROTOCOLS = new Set(["anthropic", "openai", "gemini"]);
const TAGS = new Set(["official", "third", "aggregate", "local", "free"]);
const REQUIRED_STRINGS = [
  "id", "name", "logo_char", "logo_color", "tag", "tag_label",
  "endpoint", "price_line", "users",
];

const ids = new Set();
for (const e of Array.isArray(catalog) ? catalog : []) {
  const where = `entry ${e.id ?? "?"}`;
  for (const f of REQUIRED_STRINGS) {
    if (typeof e[f] !== "string" || e[f].trim() === "") fail(`${where}: missing/empty ${f}`);
  }
  if (ids.has(e.id)) fail(`${where}: duplicate id`);
  ids.add(e.id);
  if (!BILLINGS.has(e.billing)) fail(`${where}: billing "${e.billing}" not one of ${[...BILLINGS].join("|")}`);
  if (!TAGS.has(e.tag)) fail(`${where}: tag "${e.tag}" not one of ${[...TAGS].join("|")}`);
  if (typeof e.blurb !== "string") fail(`${where}: blurb must be a string (may be empty)`);
  if (!Array.isArray(e.models)) fail(`${where}: models must be an array (may be empty when live-fetched)`);
  if (typeof e.added !== "boolean") fail(`${where}: added must be boolean`);
  const proto = e.protocol ?? "openai";
  if (!PROTOCOLS.has(proto)) fail(`${where}: protocol "${proto}" not one of ${[...PROTOCOLS].join("|")}`);
  if (e.logo_border !== undefined && e.logo_border !== null && typeof e.logo_border !== "boolean") fail(`${where}: logo_border must be boolean`);
  if (e.icon !== undefined && e.icon !== null && typeof e.icon !== "string") fail(`${where}: icon must be a string`);
  if (e.price_note !== undefined && e.price_note !== null && typeof e.price_note !== "string") fail(`${where}: price_note must be a string`);
  if (e.free_offer !== undefined && e.free_offer !== null && typeof e.free_offer !== "string") fail(`${where}: free_offer must be a string`);
  if (e.endpoints !== undefined) {
    if (!Array.isArray(e.endpoints)) {
      fail(`${where}: endpoints must be an array`);
    } else {
      for (const x of e.endpoints) {
        if (!PROTOCOLS.has(x.protocol)) fail(`${where}: extra endpoint protocol "${x.protocol}" invalid`);
        if (typeof x.endpoint !== "string" || x.endpoint.trim() === "") fail(`${where}: extra endpoint empty`);
        if (x.models !== undefined && !Array.isArray(x.models)) fail(`${where}: endpoint models must be an array`);
      }
    }
  }
}
console.log(`  ✓ ${catalog.length} entries validated`);

// ── data/models.json ──

console.log("data/models.json");
const doc = read("data/models.json");
if (!Number.isInteger(doc.version) || doc.version < 1) {
  fail("version must be a positive integer (version-gated app-side seeding)");
}
if (typeof doc.exchange_rates !== "object" || doc.exchange_rates === null) {
  fail("exchange_rates must be an object of numbers");
} else {
  if (doc.exchange_rates.USD !== 1) fail("exchange_rates must pin USD = 1 (conversion pivot)");
  for (const [c, r] of Object.entries(doc.exchange_rates)) {
    if (typeof r !== "number" || r <= 0) fail(`rate ${c} must be a positive number`);
  }
}
const modelIds = new Set();
for (const m of Array.isArray(doc.models) ? doc.models : []) {
  const id = m.model_id ?? "?";
  if (typeof id !== "string" || id === "") fail(`model missing model_id`);
  if (modelIds.has(id)) fail(`duplicate model_id "${id}"`);
  modelIds.add(id);
  for (const f of ["display_name", "input", "output", "cache_read", "cache_creation", "currency"]) {
    if (typeof m[f] !== "string" || m[f].trim() === "") fail(`${id || "?"}: missing/empty ${f}`);
  }
  for (const f of ["input", "output", "cache_read", "cache_creation"]) {
    const n = Number(m[f]);
    if (m[f] !== undefined && (Number.isNaN(n) || n < 0)) fail(`${id}: ${f} "${m[f]}" is not a non-negative decimal`);
  }
  if (m.currency !== undefined && !(m.currency in (doc.exchange_rates ?? {}))) {
    fail(`${id}: currency "${m.currency}" has no exchange rate`);
  }
}
console.log(`  ✓ ${(doc.models ?? []).length} price rows validated (v${doc.version})`);

if (failed > 0) {
  console.error(`\n${failed} validation error(s)`);
  process.exit(1);
}

if (process.argv.includes("--check")) {
  console.log("\n--check: validation only, dist/ not written");
  process.exit(0);
}

// ── emit dist/ ──

const dist = path.join(repo, "dist");
mkdirSync(dist, { recursive: true });
const today = new Date().toISOString().slice(0, 10);

const write = (name, obj) => {
  const file = path.join(dist, name);
  writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
  return createHash("sha256").update(readFileSync(file)).digest("hex");
};

const catalogSha = write("catalog.json", { total: catalog.length, entries: catalog });
const modelsSha = write("models.json", { ...doc, generated_at: today });
write("manifest.json", {
  generated_at: new Date().toISOString(),
  catalog: { count: catalog.length, sha256: catalogSha },
  models: { version: doc.version, sha256: modelsSha },
});

console.log("\ndist/ written:");
for (const f of ["catalog.json", "models.json", "manifest.json"]) {
  console.log(`  ${f}`);
}
