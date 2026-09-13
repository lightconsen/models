#!/usr/bin/env node
/**
 * One-shot migration to the two-file layout (spec.local.md §4–§6).
 *
 *   entries/<id>/provider.json  20-odd hand-written fields
 *   entries/<id>/price.json     priced rows only
 *        ↓
 *   entries/<id>/provider.json  9 fields — identity, protocols, billing
 *   entries/<id>/models.json    8 fields — every model this provider serves,
 *                               prices inline, upstream strings in `serves`
 *
 * Why a script and not 82 hand edits: the mapping is mechanical, and the
 * acceptance gate is mechanical too — dist/models.json must come out byte for
 * byte identical (scripts/verify-migration.mjs). Anything this script cannot
 * decide on its own is listed in the report and in the tables below, so the
 * judgement calls are reviewable instead of buried in 82 diffs.
 *
 * Usage:
 *   node scripts/migrate-v2.mjs            dry run — report only, no writes
 *   node scripts/migrate-v2.mjs --write    rewrite entries/, delete price.json
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRITE = process.argv.includes("--write");

/**
 * Declared strings that name a model under a spelling its price row does not
 * share, in a way the app's pricing ladder cannot bridge. `normalize_model_id`
 * only rewrites `.` -> `-` for ids that start with `claude-`, so
 * `doubao-seed-2.1-pro` (declared, and what the API accepts) and
 * `doubao-seed-2-1-pro` (the price row's key) never meet. Keeping the price
 * row's key as the canonical id preserves dist/models.json byte for byte; the
 * declared spelling goes into `serves`.
 *
 * NOTE: this means the app still fails to price that model at request time —
 * its ladder cannot turn the request's dotted id into the dashed key. That is a
 * pre-existing bug, recorded in the report, not something this refactor fixes.
 */
const PAIR_OVERRIDES = [
  { entry: "doubaoseed", declared: "doubao-seed-2.1-pro", canonical: "doubao-seed-2-1-pro" },
];

/** Declared strings that are display labels rather than identifiers. The label
    moves to `name`, where a display string belongs, and `upstream` is what goes
    into `serves`: `"deepseek-chat (V3)"` is not a model id the API accepts, yet
    the app would send exactly that string if it were published as the served
    name (spec §12). */
const ID_OVERRIDES = [
  { entry: "deepseek", declared: "deepseek-chat (V3)", id: "deepseek-chat", upstream: "deepseek-chat", name: "DeepSeek Chat (V3)" },
  { entry: "deepseek", declared: "deepseek-reasoner (R1)", id: "deepseek-reasoner", upstream: "deepseek-reasoner", name: "DeepSeek Reasoner (R1)" },
];

/** The billing label the app prints for a billing mode. `price_line` was only
    duplicating it in 19 entries — that is why those entries get no `desc`. */
const BILLING_LABELS = { plan: "Plan", payg: "Pay-as-you-go", unl: "Unlimited" };
/** The placeholder 76 of 82 entries carried in `users`; it records where the
    listing came from ("Listed on cc-switch"), which is a machine-readable fact
    and does not belong in free text (spec §14 decision 3). */
const PROVENANCE_FILLER = "Listed on cc-switch";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const lastSeg = (s) => String(s).split("/").pop().toLowerCase();

/** The two pairing rules. Measured coverage: all 36 declared<->price pairs that
    are not exactly equal (spec §10.2). */
function sameModel(a, b) {
  return a.toLowerCase() === b.toLowerCase() || lastSeg(a) === lastSeg(b);
}

/** `desc`: the one line of prose a provider gets (spec §9.2). */
function buildDesc(e) {
  const parts = [];
  const priceLine = (e.price_line ?? "").trim();
  if (priceLine !== "" && priceLine !== BILLING_LABELS[e.billing]) parts.push(priceLine);
  for (const f of ["price_note", "users", "free_offer"]) {
    const v = (e[f] ?? "").trim();
    if (v !== "" && v !== PROVENANCE_FILLER) parts.push(v);
  }
  // `blurb` is dropped outright: it was empty in all 82 entries.
  return [...new Set(parts)].join(" · ");
}

const entryDirs = readdirSync(path.join(repo, "entries"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const report = {
  entries: 0,
  dupResolutions: [],
  tagLabelDrift: [],
  pairOverrides: [],
  idOverrides: [],
  descEmpty: [],
  descMerged: [],
  unpriced: 0,
  priced: 0,
  unpairedPriceRows: [],
  orphanDeclared: [],
};

for (const dir of entryDirs) {
  const providerPath = path.join(repo, "entries", dir, "provider.json");
  const pricePath = path.join(repo, "entries", dir, "price.json");
  const e = readJson(providerPath);
  const priced = existsSync(pricePath) ? readJson(pricePath) : [];
  report.entries++;

  // ── provider.json: keep 9 fields, merge the prose into `desc` ──
  const primary = e.protocol ?? "openai";
  const newProvider = {
    id: e.id,
    name: e.name,
    logo_color: e.logo_color,
    tag: e.tag,
    rating: e.rating,
    billing: e.billing,
  };
  if (e.currency !== undefined) newProvider.currency = e.currency;
  newProvider.endpoints = [
    { protocol: primary, endpoint: e.endpoint },
    ...(e.endpoints ?? []).map((x) => ({ protocol: x.protocol, endpoint: x.endpoint })),
  ];
  const desc = buildDesc(e);
  if (desc !== "") newProvider.desc = desc;

  if ((e.tag_label ?? "") !== { official: "Official", third: "Third-party", aggregate: "Aggregator", free: "Free", local: "Local" }[e.tag]) {
    report.tagLabelDrift.push(`${dir}: tag "${e.tag}" carried label "${e.tag_label}" — becomes the label derived from tag${desc ? `; meaning kept in desc: "${desc}"` : "; nothing in desc carries it"}`);
  }
  if (desc === "") report.descEmpty.push(dir);
  else report.descMerged.push(`${dir}: "${desc}"`);

  // ── models.json: one record per model, prices inline ──
  const byProto = [[primary, e.models ?? []], ...(e.endpoints ?? []).map((x) => [x.protocol, x.models ?? []])];
  const takeOverride = (declared) => ID_OVERRIDES.find((o) => o.entry === dir && o.declared === declared);
  const takePair = (declared) => PAIR_OVERRIDES.find((o) => o.entry === dir && o.declared === declared);

  /** declared string -> the priced row it belongs to, or null */
  const pairOf = (declared) => {
    const ov = takePair(declared);
    if (ov) {
      const row = priced.find((r) => r.model_id.toLowerCase() === ov.canonical.toLowerCase());
      if (!row) throw new Error(`${dir}: PAIR_OVERRIDES names no price row for "${declared}"`);
      return row;
    }
    return priced.find((r) => sameModel(r.model_id, declared)) ?? null;
  };

  // canonical id -> { id, name, row, serves }
  const models = new Map();
  const order = [];
  // Keyed by JSON.stringify([protocol, canonical]) rather than by gluing the
  // two with a separator character — an invisible byte would make this file
  // read as binary to grep and git.
  const seenInProto = new Map(); // JSON.stringify([protocol, canonical]) -> declared kept
  for (const [proto, declaredList] of byProto) {
    for (const declared of declaredList) {
      const row = pairOf(declared);
      const idOv = takeOverride(declared);
      const id = idOv ? idOv.id : row ? row.model_id : declared;
      const key = id.toLowerCase();
      if (!models.has(key)) {
        models.set(key, { id, name: idOv?.name ?? row?.display_name, row, serves: new Map() });
        order.push(key);
      }
      const rec = models.get(key);
      const dupKey = JSON.stringify([proto, key]);
      if (seenInProto.has(dupKey)) {
        // The same model listed twice under one protocol: keep the vendor
        // prefixed spelling and drop the bare one. Every sibling protocol and
        // every price row uses the prefixed form, so the bare one is the stray.
        const kept = seenInProto.get(dupKey);
        const winner = declared.includes("/") && !kept.includes("/") ? declared : kept;
        const loser = winner === declared ? kept : declared;
        seenInProto.set(dupKey, winner);
        if (winner === declared) rec.serves.set(proto, declared);
        report.dupResolutions.push(`${dir}/${proto}: kept "${winner}", dropped "${loser}" (same model "${id}")`);
        continue;
      }
      seenInProto.set(dupKey, declared);
      rec.serves.set(proto, idOv?.upstream ?? declared);
    }
  }
  for (const key of order) {
    const rec = models.get(key);
    if (rec.row) report.priced++;
    else report.unpriced++;
  }
  // Price rows no declared string reached: the migration cannot know which
  // protocol serves them, so it stops rather than guess.
  for (const r of priced) {
    const hit = [...seenInProto.keys()].some((k) => JSON.parse(k)[1] === r.model_id.toLowerCase());
    if (!hit) report.unpairedPriceRows.push(`${dir}: price row "${r.model_id}" pairs with no declared model`);
  }
  for (const o of ID_OVERRIDES.filter((x) => x.entry === dir)) report.idOverrides.push(`${dir}: "${o.declared}" -> id "${o.id}", name "${o.name}"`);
  for (const o of PAIR_OVERRIDES.filter((x) => x.entry === dir)) report.pairOverrides.push(`${dir}: "${o.declared}" -> canonical "${o.canonical}"`);

  const allProtos = byProto.map(([p]) => p);
  const out = [];
  for (const key of order) {
    const rec = models.get(key);
    const m = { id: rec.id };
    if (rec.name !== undefined && rec.name !== rec.id) m.name = rec.name;
    if (rec.row) {
      m.in = rec.row.input;
      m.out = rec.row.output;
      if (rec.row.cache_read !== undefined && rec.row.cache_read !== "0") m.cache_read = rec.row.cache_read;
      if (rec.row.cache_creation !== undefined && rec.row.cache_creation !== "0") m.cache_creation = rec.row.cache_creation;
    }
    // `serves` is omitted when it says nothing the default does not: every
    // endpoint serves the model, and every upstream string equals the id.
    const servesUniform = allProtos.every((p) => rec.serves.get(p) === rec.id);
    if (!servesUniform) {
      m.serves = {};
      // Map iteration follows insertion order, which follows the protocol order.
      for (const p of allProtos) if (rec.serves.has(p)) m.serves[p] = rec.serves.get(p);
    }
    out.push(m);
  }

  // ── report / write ──
  const providerOut = JSON.stringify(newProvider, null, 2) + "\n";
  const modelsOut = JSON.stringify(out, null, 2) + "\n";
  if (WRITE) {
    writeFileSync(providerPath, providerOut);
    writeFileSync(path.join(repo, "entries", dir, "models.json"), modelsOut);
    if (existsSync(pricePath)) unlinkSync(pricePath);
  }
}

// ── report ──
const line = (s) => console.log(s);
line(`\n${WRITE ? "WROTE" : "DRY RUN"} — ${report.entries} entries`);
line(`  models: ${report.priced} priced + ${report.unpriced} unpriced`);
line(`  desc:   ${report.descMerged.length} written, ${report.descEmpty.length} left empty`);
line(`\nSame-protocol duplicates resolved (${report.dupResolutions.length}):`);
for (const r of report.dupResolutions) line(`  · ${r}`);
line(`\ntag_label drift — the meaning must be confirmed present in desc (${report.tagLabelDrift.length}):`);
for (const r of report.tagLabelDrift) line(`  · ${r}`);
line(`\nid overrides (${report.idOverrides.length}):`);
for (const r of report.idOverrides) line(`  · ${r}`);
line(`\npair overrides (${report.pairOverrides.length}):`);
for (const r of report.pairOverrides) line(`  · ${r}`);
if (report.unpairedPriceRows.length > 0) {
  line(`\nPRICE ROWS WITH NO DECLARED MODEL — migration cannot proceed (${report.unpairedPriceRows.length}):`);
  for (const r of report.unpairedPriceRows) line(`  ✗ ${r}`);
  process.exit(1);
}
line(`\ndesc written for ${report.descMerged.length} entries:`);
for (const r of report.descMerged) line(`  · ${r}`);
