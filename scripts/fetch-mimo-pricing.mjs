#!/usr/bin/env node
/**
 * Read MiMo's published prices and show what they would change.
 *
 * Same kind of authoring aid as the other `fetch-*` scripts: it prints a diff and
 * writes nothing unless given `--write`, and it stops rather than guesses when the
 * page is not the shape it knows.
 *
 * The easiest of the family to read, and the reason is worth recording: the docs
 * publish an `llms.txt` whose index links every page as a `.md` file, so this
 * fetches markdown rather than a rendered page and parses the HTML tables inside
 * it. No browser, no key, no HTML scraping of a layout.
 *
 * Three things the page does that shape this script. It prices **twice** — one
 * table for domestic billing in yuan and one for overseas in dollars — so the
 * table is chosen by the entry's own currency unless `--table` says otherwise.
 * Its language table groups rows under an "Inference Type" column (**Real-time
 * API** / **Batch API**): only the real-time rows are carried, because a batch
 * row prices a different billed mode (offline jobs) for which there is no field
 * here. And it bills the ASR series by audio duration (`¥0.5 /h`), which also has
 * no field here: those rows, like the batch ones, are reported and skipped rather
 * than forced into a per-token number.
 *
 * Usage:
 *   node scripts/fetch-mimo-pricing.mjs                    show the diff
 *   node scripts/fetch-mimo-pricing.mjs --entry xiaomi-mimo
 *   node scripts/fetch-mimo-pricing.mjs --table domestic   pick the yuan table
 *   node scripts/fetch-mimo-pricing.mjs --write            apply it
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const URL = "https://mimo.mi.com/static/docs/price/pay-as-you-go.md";
const WRITE = process.argv.includes("--write");
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const ENTRY = argOf("--entry", "xiaomi-mimo");
const WHICH = argOf("--table", null); // domestic | overseas, else the entry decides

const stop = (msg) => {
  console.error(`✗ ${msg}`);
  console.error("  Nothing was written. Check the page, then update this script's parser.");
  process.exit(1);
};

const res = await fetch(URL, { headers: { "user-agent": "Mozilla/5.0 (compatible; kiwano-price-check)" } });
if (!res.ok) stop(`${URL}: HTTP ${res.status}`);
const md = await res.text();

/** The markdown's own headings name the two price lists; the tables sit under them. */
const sections = {};
for (const part of md.split(/^###\s+/m).slice(1)) {
  const title = part.split("\n")[0].trim();
  const where = /Domestic/i.test(title) ? "domestic" : /Overseas/i.test(title) ? "overseas" : null;
  if (!where) continue;
  const text = (x) => x.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
  sections[where] = [...part.matchAll(/<table>[\s\S]*?<\/table>/g)].flatMap((t) => {
    // A row that carries an Inference-Type label opens its group; the rows after
    // it (the label's rowspan) inherit it until the next label.
    let group = null;
    return [...t[0].matchAll(/<tr>[\s\S]*?<\/tr>/g)].flatMap((r) => {
      const cells = [...r[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1]));
      const kind = cells.find((c) => /Real-time API|Batch API/i.test(c));
      if (kind) group = /Batch/i.test(kind) ? "batch" : "real-time";
      // The backticked ids in a model cell — one, or a new model paired with the
      // one it replaces, sharing one price. A row with none (a header, a feature
      // cell) is not a price row.
      const ids = cells.flatMap((c) => [...c.matchAll(/`([^`]+)`/g)].map((m) => m[1])).filter((id) => /^mimo-/.test(id));
      if (ids.length === 0) return [];
      const prices = cells.map((c) => c.replace(/^[¥$]\s*/, "")).filter((c) => /^\d+(\.\d+)?$/.test(c));
      return { group, ids, prices };
    });
  });
}
if (!sections.domestic || !sections.overseas) stop("could not find both the domestic and overseas price tables");

const money = { domestic: "CNY", overseas: "USD" };
const strip = (s) => {
  const m = /^[¥$]?\s*([0-9]+(?:\.[0-9]+)?)$/.exec(String(s).trim());
  return m ? m[1] : null;
};

// ── the entry ──
const provPath = path.join(repo, `entries/${ENTRY}/provider.json`);
const modelsPath = path.join(repo, `entries/${ENTRY}/models.json`);
const prov = JSON.parse(readFileSync(provPath, "utf8"));
const current = JSON.parse(readFileSync(modelsPath, "utf8"));

const which = WHICH ?? (prov.currency === "CNY" ? "domestic" : "overseas");
const rows = sections[which];
console.log(`fetched ${URL}\n  reading the ${which} table (${money[which]}); ${ENTRY} bills in ${prov.currency}\n`);
if (prov.currency !== money[which]) {
  console.log(`  ! ${ENTRY} declares ${prov.currency} and this table is in ${money[which]} — --table picks the other\n`);
}

/** A real-time row with three prices is per token: hit, miss, output. A batch row
    prices a different billed mode and an ASR row prices by the hour — neither has a
    field here, and both are reported and skipped. */
const priced = [];
const onPage = new Set();
const batch = [];
const byDuration = [];
for (const r of rows) {
  if (r.group === "batch") {
    batch.push(r.ids.join("、"));
  } else if (r.prices.length >= 3) {
    for (const id of r.ids) priced.push({ id, cache_read: strip(r.prices[0]), in: strip(r.prices[1]), out: strip(r.prices[2]) });
  } else {
    byDuration.push(`${r.ids.join("、")} (${r.prices.length ? r.prices.join(" / ") : "no per-token price"})`);
  }
  r.ids.forEach((id) => onPage.add(id));
}

console.log(`${which} table:`);
for (const p of priced) console.log(`  ${p.id.padEnd(16)} in ${p.in}  out ${p.out}${p.cache_read ? `  cache_read ${p.cache_read}` : ""}`);
if (batch.length) console.log(`  batch API, a different billed mode with no field here: ${batch.join(", ")}`);
if (byDuration.length) console.log(`  billed by duration, no field for it: ${byDuration.join(", ")}`);

let changes = 0;
for (const p of priced) {
  const now = current.find((r) => r.id === p.id);
  if (!now) {
    console.log(`\n+ ${p.id} is not in the entry`);
    changes++;
    continue;
  }
  for (const f of ["in", "out", "cache_read"]) {
    if (p[f] === null || now[f] === undefined) continue;
    if (Number(now[f]) === Number(p[f])) continue;
    console.log(`\n~ ${p.id}.${f}: ${JSON.stringify(now[f])} -> ${JSON.stringify(p[f])}`);
    changes++;
  }
}
for (const now of current) {
  if (onPage.has(now.id)) continue;
  console.log(`\n- ${now.id} is not on the page — check whether it is live`);
  changes++;
}
console.log(`\n${changes === 0 ? "no price change" : `${changes} change(s)`}`);

if (WRITE) {
  const updated = current.map((row) => {
    const p = priced.find((x) => x.id === row.id);
    if (!p) return row;
    const out = { ...row };
    for (const f of ["in", "out", "cache_read"]) if (p[f] !== null) out[f] = p[f];
    return out;
  });
  writeFileSync(modelsPath, JSON.stringify(updated, null, 2) + "\n");
  console.log(`\n✓ wrote entries/${ENTRY}/models.json`);
}
