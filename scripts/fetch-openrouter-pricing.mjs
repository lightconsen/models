#!/usr/bin/env node
/**
 * Read OpenRouter's published model list and prices, and show what they would
 * change.
 *
 * Third of the same kind as `fetch-deepseek-pricing.mjs` and
 * `fetch-kimi-pricing.mjs`: it prints a diff and writes nothing unless given
 * `--write`, and it stops rather than guesses when the response is not the shape
 * it knows. See the DeepSeek one for why this is not a data source — no cron
 * runs it, and the data stays hand-reviewed.
 *
 * The kindest of the three to read: a plain JSON API, no key, no HTML, no
 * browser. `GET /api/v1/models` returns every model it routes, each with a
 * `name` and per-token USD prices under `pricing`. We count in million-token
 * units, so the decimal point moves six places — done on the string, not with
 * arithmetic, so `0.00000003` becomes `0.03` rather than `0.030000000000000002`.
 *
 * Text-out models only: the 15 rows that also emit images or audio are a
 * different price shape, and this catalogue holds per-token text rates alone.
 * Input modality is deliberately not a filter — 272 of the 430 take images,
 * files, audio or video and still answer in text, and they are the models a
 * reader picks. (Filtering on `modality === "text->text"` looks right and is
 * not: it drops every one of those, including all four rows the entry carries.)
 *
 * `:batch` variants are text-out and are kept by default; `--no-batch` drops
 * them. Worth knowing what they are before writing them into an entry: a cheaper
 * schedule for the same model over a different endpoint, not a model a reader
 * can pick from a list.
 *
 * Usage:
 *   node scripts/fetch-openrouter-pricing.mjs             show the diff
 *   node scripts/fetch-openrouter-pricing.mjs --no-batch  leave the `:batch` rows out
 *   node scripts/fetch-openrouter-pricing.mjs --write     apply it to entries/openrouter
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODELS_URL = "https://openrouter.ai/api/v1/models";
const WRITE = process.argv.includes("--write");
const KEEP_BATCH = !process.argv.includes("--no-batch");
const ENTRY = "openrouter";

const stop = (msg) => {
  console.error(`✗ ${msg}`);
  console.error("  Nothing was written. Check the response, then update this script's reader.");
  process.exit(1);
};

/** Per-token USD decimal -> per-million, moving the point in the string.
    Arithmetic would carry float noise: 0.00000003 * 1_000_000 is not 0.03.
    The digits are the integer `whole+frac`, and the point moves `frac.length - 6`
    places from its right — which is why a short fraction gains zeros (`0.00001`
    becomes `10`, not `1`). */
const perMillion = (s) => {
  const v = String(s).trim();
  if (!/^\d+(\.\d+)?$/.test(v)) stop(`"${s}" is not a plain decimal price`);
  const [whole, frac = ""] = v.split(".");
  const digits = (whole + frac).replace(/^0+/, "");
  if (digits === "") return "0";
  const k = frac.length - 6;
  const out = k <= 0
    ? digits + "0".repeat(-k)
    : digits.length > k
      ? `${digits.slice(0, digits.length - k)}.${digits.slice(digits.length - k)}`
      : `0.${"0".repeat(k - digits.length)}${digits}`;
  return out.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

const res = await fetch(MODELS_URL, { headers: { accept: "application/json" } });
if (!res.ok) stop(`${MODELS_URL}: HTTP ${res.status}`);
const body = await res.json();
const all = Array.isArray(body) ? body : body?.data;
if (!Array.isArray(all) || all.length === 0) stop("no model array in the response");

/** A chat model: text out, and nothing else out. */
const outputsText = (m) => {
  const out = m?.architecture?.output_modalities;
  return Array.isArray(out) && out.includes("text") && out.every((x) => x === "text");
};
const text = all.filter(outputsText);
if (text.length === 0) stop("no text-out models in the response");
const batch = text.filter((m) => String(m.id).includes(":batch"));
const kept = KEEP_BATCH ? text : text.filter((m) => !batch.includes(m));

/** A real price. OpenRouter marks a variable one with a negative sentinel — its
    own routing meta-models (`openrouter/fusion`) charge whatever the model they
    pick charges, so there is no number to carry. That is our "declared, no
    price" row: the model exists and shows in the list, with no cost attached. */
const fixed = (v) => v !== undefined && !String(v).startsWith("-");

const rows = kept
  .map((m) => {
    const p = m?.pricing ?? {};
    const row = { id: String(m.id), name: String(m.name ?? m.id) };
    const priced = [p.prompt, p.completion].filter(fixed).length;
    if (priced === 1) stop(`"${m.id}" prices only one of prompt/completion — a shape this reader does not know`);
    if (priced === 2) {
      row.in = perMillion(p.prompt);
      row.out = perMillion(p.completion);
      if (fixed(p.input_cache_read)) row.cache_read = perMillion(p.input_cache_read);
      if (fixed(p.input_cache_write)) row.cache_creation = perMillion(p.input_cache_write);
    }
    return row;
  })
  .sort((a, b) => a.id.localeCompare(b.id));

// ── compare with the entry ──
const modelsPath = path.join(repo, `entries/${ENTRY}/models.json`);
const current = JSON.parse(readFileSync(modelsPath, "utf8"));

/** The upstream strings a row claims: its own `id`, plus every `serves` value.
    Both, because `serves` may name only some protocols and the rest fall back
    to the id. This is the join this script lives or dies on — the entry's ids
    are canonical, the API's are the vendor's own. */
const upstreams = (r) => [r.id, ...Object.values(r.serves ?? {})];
const rowFor = (apiId) => current.find((r) => upstreams(r).includes(apiId));

console.log(`fetched ${MODELS_URL}`);
console.log(`  ${all.length} models, ${text.length} text-out, ${kept.length} compared` +
  (KEEP_BATCH && batch.length ? `  (${batch.length} of them \`:batch\`)` : "") + "\n");

console.log("the API:");
for (const r of rows) {
  const bits = r.in === undefined
    ? ["no fixed price — the vendor reports a variable one"]
    : [`in ${r.in}`, `out ${r.out}`];
  if (r.cache_read) bits.push(`cache_read ${r.cache_read}`);
  if (r.cache_creation) bits.push(`cache_write ${r.cache_creation}`);
  console.log(`  ${r.id.padEnd(46)} ${r.name.slice(0, 34).padEnd(36)} ${bits.join("  ")}`);
}

let changes = 0;
for (const r of rows) {
  const now = rowFor(r.id);
  if (!now) {
    console.log(`\n+ ${r.id} is not in the entry`);
    changes++;
    continue;
  }
  for (const f of ["in", "out", "cache_read", "cache_creation"]) {
    // By value, not by text: the entry writes "0.20" where the vendor writes
    // "0.2", and the same price spelled two ways is not a change to review.
    const a = now[f];
    const b = r[f];
    if (a !== undefined && b !== undefined && Number(a) === Number(b)) continue;
    if (a === undefined && b === undefined) continue;
    const show = (v) => (v === undefined ? "unpriced" : JSON.stringify(v));
    console.log(`\n~ ${now.id}.${f}: ${show(a)} -> ${show(b)}`);
    changes++;
  }
}
for (const now of current) {
  if (rows.some((r) => upstreams(now).includes(r.id))) continue;
  console.log(`\n- ${now.id} is not in the API (upstream: ${upstreams(now).join(", ")}) — check whether it is live`);
  changes++;
}

const unpriced = rows.filter((r) => r.in === undefined).length;
const free = rows.filter((r) => r.in === "0" && r.out === "0").length;
console.log(`\n${changes === 0 ? "no price change" : `${changes} change(s)`}`);
console.log(`${rows.length} rows: ${rows.length - unpriced - free} metered, ${free} free, ${unpriced} with no fixed price`);
console.log("(a flagship must sit on a priced model — move it if its model goes)");

if (WRITE) {
  // The row's `id` becomes the vendor's own string, so `serves` has nothing
  // left to carry and is dropped. `flagship` is the one hand-made choice, and
  // it is carried over by matching the old row's upstream.
  const flagship = current.find((r) => r.flagship);
  const flagged = flagship ? rows.find((r) => upstreams(flagship).includes(r.id)) : null;
  const out = rows.map((r) => (r === flagged ? { ...r, flagship: true } : r));
  writeFileSync(modelsPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`\n✓ wrote entries/${ENTRY}/models.json — ${current.length} rows -> ${out.length}`);
  if (flagship) {
    console.log(flagged
      ? `  flagship ${flagship.id} -> ${flagged.id}`
      : `  ! flagship ${flagship.id} no longer has an upstream in the API — none set`);
  }
}
