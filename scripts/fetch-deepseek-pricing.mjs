#!/usr/bin/env node
/**
 * Read DeepSeek's published price table and show what it would change.
 *
 * This is an AUTHORING AID, not part of the build. `generate.mjs` never fetches
 * anything: the data here is hand-edited and git-reviewed, and the CI that
 * validates it has no network. Nothing keeps a scraped number fresh either —
 * this repo has no cron, so a price only moves when somebody runs a script and
 * commits the result. What this does is make that minute of work reliable:
 * it reads the table, maps it onto our schema, and prints the difference.
 *
 * It never writes unless asked (`--write`), and it stops rather than guesses
 * whenever the page is not the shape it knows: a docs restructure must fail
 * loudly, not quietly publish a wrong number.
 *
 * Usage:
 *   node scripts/fetch-deepseek-pricing.mjs           show the diff
 *   node scripts/fetch-deepseek-pricing.mjs --write   apply it
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const URL_ZH = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
const WRITE = process.argv.includes("--write");

/** Field names the page uses for the three rates we record. */
const RATE_LABELS = {
  "百万tokens输入（缓存命中）": "cache_read",
  "百万tokens输入（缓存未命中）": "in",
  "百万tokens输出": "out",
};
const DAY_NAMES = { 周一: "mon", 周二: "tue", 周三: "wed", 周四: "thu", 周五: "fri", 周六: "sat", 周日: "sun" };

const stop = (msg) => {
  console.error(`✗ ${msg}`);
  console.error("  Nothing was written. Check the page, then update this script's parser.");
  process.exit(1);
};
const text = (html) => html.replace(/<[^>]*>/g, "").replace(/\s+/g, "").trim();
/** Drop a trailing footnote marker ("deepseek-flash<sup>(1)</sup>" -> the name). */
const unnote = (s) => s.replace(/\(\d+\)$/, "");
const yuan = (s) => {
  const v = text(s).replace(/元$/, "");
  if (!/^\d+(\.\d+)?$/.test(v)) stop(`"${v}" is not a plain decimal price`);
  return v;
};

const res = await fetch(URL_ZH, { headers: { "user-agent": "Mozilla/5.0 (compatible; kiwano-price-check)" } });
if (!res.ok) stop(`fetch failed: HTTP ${res.status}`);
// The response carries a stray NUL byte, which is enough to make `file` call it
// binary and `grep` refuse to match anything. Strip it before parsing, or every
// search below silently finds nothing.
const html = (await res.text()).split(String.fromCharCode(0)).join("");

const rows = (html.match(/<tr>[\s\S]*?<\/tr>/g) ?? []).map((r) =>
  (r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) ?? []).map(text),
);
if (rows.length === 0) stop("no <tr> rows found — the page is no longer static HTML");

// ── the model columns, from the header row ──
const header = rows.find((cells) => cells[0] === "模型");
if (!header || header.length < 3) stop('no "模型" row with model columns');
const modelIds = header.slice(1).map(unnote);

// ── their display names, from the 模型版本 row ──
const versions = rows.find((cells) => cells[0] === "模型版本");
const modelNames = versions && versions.length === header.length ? versions.slice(1) : modelIds;

// ── the base URLs, so a stale endpoint in the entry is caught here too ──
const baseUrls = {};
for (const proto of ["OpenAI 格式", "Anthropic 格式"]) {
  const r = rows.find((cells) => cells[0] === `BASEURL(${proto})`);
  if (r) baseUrls[proto] = r[r.length - 1];
}

// ── the price rows: a full row names the rate, its continuation just switches
//    the time of day (the label cell above it spans two rows).
//    Rows are recognised by their content rather than their width: the page has
//    other narrow rows (`并发限制` is also label + one value per model), and a
//    width test would read those as prices. ──
const priced = new Map(); // modelId -> { in, out, cache_read, off_peak: {} }
let label = null;
for (const cells of rows) {
  // Cells are located by content, not by index: the price block's rowspans make
  // its rows different widths (5, 3, 4, 3, 4, 3), so "the third cell" names a
  // different thing from one row to the next.
  const labelAt = cells.findIndex((c) => RATE_LABELS[c] !== undefined);
  const periodAt = cells.findIndex((c) => c === "空闲时段" || c === "高峰时段");
  if (periodAt < 0) continue; // 图像理解 / 并发限制 / … — not a price row
  if (labelAt >= 0) {
    if (labelAt > periodAt) stop(`the rate label follows its time-of-day cell: ${JSON.stringify(cells)}`);
    label = RATE_LABELS[cells[labelAt]];
  }
  if (!label) stop(`a ${cells[periodAt]} row appears before any rate label`);
  const period = cells[periodAt];
  const values = cells.slice(periodAt + 1).map(yuan);
  if (values.length !== modelIds.length) {
    stop(`row "${label}/${period}" has ${values.length} values for ${modelIds.length} models`);
  }
  modelIds.forEach((id, i) => {
    const m = priced.get(id) ?? { off_peak: {} };
    if (period === "高峰时段") m[label] = values[i];
    else m.off_peak[label] = values[i];
    priced.set(id, m);
  });
}
for (const id of modelIds) {
  const m = priced.get(id);
  if (!m || m.in === undefined || m.out === undefined || m.cache_read === undefined) stop(`model "${id}" is missing one of the three peak rates`);
  if (Object.keys(m.off_peak).length !== 3) stop(`model "${id}" is missing one of the three off-peak rates`);
}

// ── the peak window, from the footnote ──
const note = (html.match(/高峰时段为[\s\S]{0,240}?）/)?.[0] ?? "").replace(/<[^>]*>/g, "");
if (!note) stop("no peak-hours footnote — the window is the part we cannot guess");
// The offset is only knowable because the note names the timezone.
if (!note.includes("北京时间")) stop(`the footnote no longer names 北京时间: "${note}"`);
const dayList = [];
for (const [, from, to] of note.matchAll(/(周[一二三四五六日])(?:至(周[一二三四五六日]))?/g)) {
  const names = Object.keys(DAY_NAMES);
  const start = names.indexOf(from);
  const end = to ? names.indexOf(to) : start;
  if (start < 0 || end < start) stop(`cannot read the weekday range "${from}${to ? "至" + to : ""}"`);
  for (let i = start; i <= end; i++) dayList.push(DAY_NAMES[names[i]]);
}
if (dayList.length === 0) stop(`no weekdays in the footnote: "${note}"`);
const windows = [...note.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)].map(([, h1, m1, h2, m2]) => ({
  days: [...new Set(dayList)],
  start: `${String(h1).padStart(2, "0")}:${m1}`,
  end: `${String(h2).padStart(2, "0")}:${m2}`,
}));
if (windows.length === 0) stop(`no clock times in the footnote: "${note}"`);

// ── compare with what the entry says today ──
const modelsPath = path.join(repo, "entries/deepseek/models.json");
const current = JSON.parse(readFileSync(modelsPath, "utf8"));
/** The schema's own order for the rate fields — the page lists cache-hit first,
    a human writing the row would not, and key order is not a price change. */
const RATE_ORDER = ["in", "out", "cache_read", "cache_creation"];
const ordered = (o) => Object.fromEntries(RATE_ORDER.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

const proposed = modelIds.map((id, i) => {
  const m = priced.get(id);
  // Keep the display name a human chose; only a model we have never seen starts
  // from the page's version string, and it is the author's to improve.
  const existing = current.find((r) => r.id === id);
  const row = { id, name: existing?.name ?? modelNames[i] ?? id, ...ordered(m), off_peak: ordered(m.off_peak) };
  row.peak_hours = { tz_offset: 480, windows };
  return row;
});

console.log(`fetched ${URL_ZH}\n`);
let changes = 0;
for (const row of proposed) {
  const now = current.find((r) => r.id === row.id);
  if (!now) {
    console.log(`+ ${row.id} is new`);
    changes++;
    continue;
  }
  // `name` is not compared: the page carries the model *version*
  // ("DeepSeek-V4-Pro-0813") where the row carries a display name, and which
  // reads better in the app is the author's call, not a price fact.
  for (const key of RATE_ORDER) {
    if (row[key] === undefined) continue;
    if (String(now[key]) !== String(row[key])) {
      console.log(`~ ${row.id}.${key}: ${JSON.stringify(now[key])} -> ${JSON.stringify(row[key])}`);
      changes++;
    }
  }
  if (JSON.stringify(now.off_peak) !== JSON.stringify(row.off_peak)) {
    console.log(`~ ${row.id}.off_peak: ${JSON.stringify(now.off_peak)} -> ${JSON.stringify(row.off_peak)}`);
    changes++;
  }
  if (JSON.stringify(now.peak_hours) !== JSON.stringify(row.peak_hours)) {
    console.log(`~ ${row.id}.peak_hours: ${JSON.stringify(now.peak_hours)} -> ${JSON.stringify(row.peak_hours)}`);
    changes++;
  }
}
for (const now of current) if (!proposed.some((r) => r.id === now.id)) {
  console.log(`- ${now.id} is gone from the page`);
  changes++;
}

// The entry's endpoints should be the page's BASE URLs: drift there means the
// catalog is pointing people at an address the vendor no longer documents. This
// script does not rewrite provider.json — an endpoint move deserves a look at
// the entry's other fields too — so it only reports.
const provPath = path.join(repo, "entries/deepseek/provider.json");
const prov = JSON.parse(readFileSync(provPath, "utf8"));
const PAGE_PROTOCOL = { "OpenAI 格式": "openai", "Anthropic 格式": "anthropic" };
for (const [label, url] of Object.entries(baseUrls)) {
  const proto = PAGE_PROTOCOL[label];
  const entry = prov.endpoints.find((x) => x.protocol === proto);
  if (!entry) console.log(`~ provider.json has no ${proto} endpoint; the page documents ${url}`);
  else if (entry.endpoint.replace(/\/$/, "") !== url.replace(/\/$/, "")) {
    console.log(`~ provider.json ${proto} endpoint: ${entry.endpoint} -> ${url} (edit by hand)`);
  }
}

console.log(`\n${changes === 0 ? "no change — the entry matches the page" : `${changes} change(s)`}`);
if (changes > 0) console.log("run again with --write to apply, then bump global.json's version");

if (WRITE && changes > 0) {
  writeFileSync(modelsPath, JSON.stringify(proposed, null, 2) + "\n");
  console.log(`✓ wrote entries/deepseek/models.json`);
}
