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
 * Two things the page does that shape this script. It prices **twice** — one table
 * for domestic billing in yuan and one for overseas in dollars — so the table is
 * chosen by the entry's own currency unless `--table` says otherwise. And it bills
 * the ASR series by audio duration (`¥0.5 /h`), which has no field here: those rows
 * are reported and skipped rather than forced into a per-token number.
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
  sections[where] = [...part.matchAll(/<table>[\s\S]*?<\/table>/g)].flatMap((t) =>
    [...t[0].matchAll(/<tr>[\s\S]*?<\/tr>/g)]
      .map((r) => [...r[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1])))
      .filter((cells) => cells.length >= 2 && /^`?mimo-/.test(cells[0]))
      .map((cells) => ({ model: cells[0].replace(/`/g, ""), cells: cells.slice(1) })),
  );
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

/** A row with three prices is per token: hit, miss, output. A row with one is
    billed by duration, and there is no field for that here. */
const priced = [];
const byDuration = [];
for (const r of rows) {
  if (r.cells.length >= 3) priced.push({ id: r.model, cache_read: strip(r.cells[0]), in: strip(r.cells[1]), out: strip(r.cells[2]) });
  else byDuration.push(`${r.model} (${r.cells.join(" ")})`);
}

console.log(`${which} table:`);
for (const p of priced) console.log(`  ${p.id.padEnd(16)} in ${p.in}  out ${p.out}${p.cache_read ? `  cache_read ${p.cache_read}` : ""}`);
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
  if (priced.some((p) => p.id === now.id)) continue;
  if (byDuration.some((d) => d.startsWith(now.id))) continue;
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
