#!/usr/bin/env node
/**
 * Read Kimi's published per-token prices and show what they would change.
 *
 * Same kind of authoring aid as `fetch-deepseek-pricing.mjs`: it prints a diff
 * and writes nothing unless given `--write`, and it stops rather than guesses
 * when the page is not the shape it knows. See that file for why this is not a
 * data source — no cron runs it, and the data stays hand-reviewed.
 *
 * Their docs are kinder than most: every page is also served as markdown
 * (`/docs/llms.txt` lists them), and the price table is a literal JS array inside
 * a `<DocTable>` element. So this needs no HTML parsing and no browser. It also
 * reads the model list to report models we carry that the vendor has retired —
 * two of them were, unnoticed.
 *
 * Usage:
 *   node scripts/fetch-kimi-pricing.mjs           show the diff
 *   node scripts/fetch-kimi-pricing.mjs --write   apply it to entries/kimi
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRICING_MD = "https://platform.kimi.com/docs/pricing/chat.md";
const MODELS_MD = "https://platform.kimi.com/docs/models.md";
const WRITE = process.argv.includes("--write");
const ENTRY = "kimi"; // the API platform entry; api.kimi.com/coding is a subscription

const stop = (msg) => {
  console.error(`✗ ${msg}`);
  console.error("  Nothing was written. Check the page, then update this script's parser.");
  process.exit(1);
};

const get = async (url) => {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; kiwano-price-check)" } });
  if (!res.ok) stop(`${url}: HTTP ${res.status}`);
  return res.text();
};

// ── the price table ──
const md = await get(PRICING_MD);
const table = /<DocTable[\s\S]*?\/>/.exec(md);
if (!table) stop("no <DocTable> element in the pricing markdown");

const titles = [...table[0].matchAll(/\{\s*title:\s*"([^"]+)"/g)].map((m) => m[1]);
const rowBlocks = [...table[0].matchAll(/\[([^\][]*)\]/g)].map((m) => m[1]);
if (titles.length === 0 || rowBlocks.length === 0) stop("could not read the table's columns or rows");
const rows = rowBlocks.map((b) => {
  try {
    return JSON.parse(`[${b.replace(/,\s*$/, "")}]`);
  } catch {
    return null;
  }
}).filter((r) => Array.isArray(r) && r.every((c) => typeof c === "string"));
if (rows.length === 0) stop("no parseable rows in the table");

/** Column title -> our field. Matched loosely so a reworded header still lands. */
const columnField = (title) => {
  if (/缓存命中/.test(title)) return "cache_read";
  if (/缓存未命中|输入/.test(title)) return "in";
  if (/输出/.test(title)) return "out";
  return null;
};
const cols = titles.map((t, i) => [columnField(t), i, t]).filter(([f]) => f);
if (cols.length < 3) stop(`could not map the columns: ${titles.join(" | ")}`);
const modelAt = titles.findIndex((t) => t === "模型");
if (modelAt < 0) stop(`no "模型" column among: ${titles.join(" | ")}`);

// The page prices in yuan; the entry has to say so, or the numbers mean nothing.
const money = /¥|元/.test(rows[0].join(" ")) ? "CNY" : "$|USD";
const strip = (s) => {
  const v = String(s).replace(/[¥元$\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(v)) stop(`"${s}" is not a plain decimal price`);
  return v;
};

const priced = rows.map((r) => {
  const id = r[modelAt].trim();
  const out = { id };
  for (const [field, i] of cols) out[field] = strip(r[i]);
  return out;
});

// ── retired models, so we can flag the ones we still carry ──
const modelsMd = await get(MODELS_MD);
const retired = new Set([...modelsMd.matchAll(/^\|\s*`?([a-z0-9.-]+)`?\s*\|\s*已下线\s*\|/gm)].map((m) => m[1]));

// ── compare with the entry ──
const provPath = path.join(repo, `entries/${ENTRY}/provider.json`);
const modelsPath = path.join(repo, `entries/${ENTRY}/models.json`);
const prov = JSON.parse(readFileSync(provPath, "utf8"));
const current = JSON.parse(readFileSync(modelsPath, "utf8"));

console.log(`fetched ${PRICING_MD}\n`);
if (prov.currency !== money) {
  console.log(`! entries/${ENTRY}/provider.json currency is ${prov.currency}, the page prices in ${money}`);
}
console.log("page:");
for (const p of priced) console.log(`  ${p.id.padEnd(26)} in ${p.in}  cache_read ${p.cache_read}  out ${p.out}`);

let changes = 0;
const proposed = [];
for (const p of priced) {
  const now = current.find((r) => r.id === p.id);
  const row = { id: p.id, name: now?.name ?? p.id, in: p.in, out: p.out, cache_read: p.cache_read };
  if (now?.serves) row.serves = now.serves;
  if (now?.flagship) row.flagship = true;
  proposed.push(row);
  if (!now) console.log(`\n+ ${p.id} is new (unpriced, or absent)`);
  else {
    for (const f of ["in", "out", "cache_read"]) {
      if (String(now[f]) !== String(p[f])) {
        console.log(`\n~ ${p.id}.${f}: ${JSON.stringify(now[f])} -> ${JSON.stringify(p[f])}`);
        changes++;
      }
    }
  }
}
for (const now of current) {
  if (priced.some((p) => p.id === now.id)) continue;
  const why = retired.has(now.id)
    ? "is retired by the vendor — drop it"
    : "is not on the page — check whether it is live";
  console.log(`\n- ${now.id} ${why}`);
  changes++;
}
// Unpriced declarations the page does not mention are the same question.
const unpriced = current.filter((r) => r.in === undefined && !priced.some((p) => p.id === r.id));

console.log(`\n${changes === 0 ? "no price change" : `${changes} price change(s)`}`);
if (unpriced.length) console.log(`unpriced rows not on the page: ${unpriced.map((r) => r.id).join(", ")}`);
console.log("(a flagship must sit on a priced model — move it if its model goes)");

if (WRITE) {
  // Keep the entry's own key order, and only replace the price fields.
  const merged = proposed.map((p) => {
    const now = current.find((r) => r.id === p.id);
    if (!now) return p;
    const out = {};
    for (const k of Object.keys(now)) out[k] = k in p ? p[k] : now[k];
    for (const k of Object.keys(p)) if (!(k in out)) out[k] = p[k];
    return out;
  });
  writeFileSync(modelsPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\n✓ wrote entries/${ENTRY}/models.json`);
}
