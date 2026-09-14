#!/usr/bin/env node
/**
 * Build OpenRouter's model list from its own usage ranking.
 *
 * `fetch-openrouter-pricing.mjs` diffs prices for the rows an entry already
 * carries. This one decides *which* rows it should carry: the models people
 * actually call, ranked by tokens served. Same shape as its siblings — it prints
 * what it would change and writes nothing without `--write`.
 *
 * Needs a key: unlike the models list, the rankings dataset is authenticated.
 * Read it from `OPENROUTER_API_KEY`, or point `--key-file` at a JSON file that
 * has it at `.env.OPENROUTER_API_KEY` (a Claude Code settings file does). The
 * key is never printed and never written — it is not this repo's data.
 *
 * The window is the *latest week*, not a sum over several. openrouter.ai/rankings
 * shows one week, and its numbers are a reader's way of checking this script: the
 * weekly bucket starting 2026-09-07 gives GPT-5.6 Luna 18.18T tokens, which is the
 * 18.2T the page prints. Summing four weeks instead puts a model that has since
 * gone quiet (`stealth/ox-alpha`, 27T then, zero for the last two weeks) high on a
 * list it does not belong on at all.
 *
 * The two datasets spell model ids differently, and the difference is load-bearing:
 * the ranking reports `deepseek/deepseek-v4-flash-20260731` where the models list
 * says `deepseek/deepseek-v4-flash-0731` — the same snapshot with the year dropped
 * from the date. That translation is what keeps two ranked snapshots of one model
 * apart, which they must be: the page ranks `-20260731` (11.6T) and `-20260423`
 * (4.36T) as separate entries, and so does this. Stripping the whole date instead
 * would collapse them into one row; a ranked model with no models record at all
 * (`stealth/ox-alpha`) is reported, never dropped quietly.
 *
 * Token counts come from each upstream's own tokenizer, so a token in one row is
 * not comparable to a token in another. The order is still theirs, which is the
 * point of using it.
 *
 * Attribution is a condition of the data (CC BY 4.0): anything republished from
 * it must carry "Source: OpenRouter (openrouter.ai/rankings), as of {as_of}".
 *
 * Usage:
 *   node scripts/fetch-openrouter-rankings.mjs --key-file ~/.claude/settings.open.json
 *   node scripts/fetch-openrouter-rankings.mjs ... --top 10
 *   node scripts/fetch-openrouter-rankings.mjs ... --write
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = "openrouter";
const WRITE = process.argv.includes("--write");
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const TOP = Number(argOf("--top", "20"));
const KEY_FILE = argOf("--key-file", null);

const stop = (msg) => {
  console.error(`✗ ${msg}`);
  console.error("  Nothing was written.");
  process.exit(1);
};

/** The key stays in the process. It is the user's credential, not catalogue data. */
const apiKey = (() => {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  if (!KEY_FILE) stop("no key — set OPENROUTER_API_KEY or pass --key-file <json with .env.OPENROUTER_API_KEY>");
  let raw;
  try {
    raw = JSON.parse(readFileSync(KEY_FILE.replace(/^~(?=\/)/, process.env.HOME ?? "~"), "utf8"));
  } catch (err) {
    stop(`could not read ${KEY_FILE}: ${err.message}`);
  }
  const k = raw?.env?.OPENROUTER_API_KEY;
  if (typeof k !== "string" || k.trim() === "") stop(`${KEY_FILE} has no .env.OPENROUTER_API_KEY`);
  return k.trim();
})();

const get = async (url) => {
  const res = await fetch(url, { headers: { accept: "application/json", authorization: `Bearer ${apiKey}` } });
  if (res.status === 401) stop("the key was rejected (401) — it needs to be a valid OpenRouter key");
  if (res.status === 429) stop("rate limited (429) — 30 requests/minute, 500/day per account");
  if (!res.ok) stop(`${url}: HTTP ${res.status}`);
  return res.json();
};

/** Per-token USD decimal -> per-million, moving the point in the string.
    Arithmetic would carry float noise: 0.00000003 * 1_000_000 is not 0.03.
    Kept in step with the same helper in `fetch-openrouter-pricing.mjs`. */
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

// ── the ranking ──
// Three weeks back is enough for the API to return whole weekly buckets; only the
// newest one is used, and asking for more than one means a partial leading bucket
// can never be mistaken for a quiet week.
const end = new Date();
const start = new Date(end.getTime() - 21 * 86_400_000);
const iso = (d) => d.toISOString().slice(0, 10);
const RANK_URL = `https://openrouter.ai/api/v1/datasets/rankings-daily?period=week&start_date=${iso(start)}&end_date=${iso(end)}`;
const ranking = await get(RANK_URL);
if (!Array.isArray(ranking?.data) || ranking.data.length === 0) stop("no rows in the ranking response");

const latest = ranking.data.reduce((max, r) => (r.date > max ? r.date : max), "");
const totals = new Map();
for (const r of ranking.data) {
  if (r?.model_permaslug === "other" || r?.date !== latest) continue;
  totals.set(r.model_permaslug, (totals.get(r.model_permaslug) ?? 0) + Number(r.total_tokens));
}
const weekOf = new Date(`${latest}T00:00:00Z`);
const weekEnd = new Date(weekOf.getTime() + 6 * 86_400_000);
console.log(`week of ${latest} .. ${iso(weekEnd)}  (the latest the API has; the same week openrouter.ai/rankings shows)`);
console.log(`as of ${ranking.meta.as_of}\n`);

// ── the models list, and the join between the two id spellings ──
const models = await get("https://openrouter.ai/api/v1/models");
const byId = new Map((Array.isArray(models) ? models : models.data).map((m) => [m.id, m]));

/** A ranked permaslug is a pinned snapshot; the models list carries the same
    snapshot with the year dropped from its date — `-20260731` there is `-0731`
    here. That is tried first, and it matters: it is what keeps the two ranked
    `deepseek-v4-flash` snapshots distinct. Only if the snapshot has no record is
    the date dropped entirely, then the `-latest` alias tried. */
const resolve = (permaslug) => {
  if (byId.has(permaslug)) return permaslug;
  const [base, variant] = permaslug.split(":");
  const withVariant = (s) => (variant ? `${s}:${variant}` : s);
  const dated = /^(.*)-(\d{4})(\d{2})(\d{2})$/.exec(base);
  if (dated) {
    const short = withVariant(`${dated[1]}-${dated[3]}${dated[4]}`);
    if (byId.has(short)) return short;
  }
  const undated = base.replace(/-\d{8}$/, "");
  const bare = withVariant(undated);
  if (byId.has(bare)) return bare;
  const slash = undated.indexOf("/");
  if (slash > 0) {
    const alias = withVariant(`${undated.slice(0, slash)}/~${undated.slice(slash + 1)}-latest`);
    if (byId.has(alias)) return alias;
    const tilde = withVariant(`~${undated}`);
    if (byId.has(tilde)) return tilde;
  }
  return null;
};

// ── the entry ──
const provPath = path.join(repo, `entries/${ENTRY}/provider.json`);
const modelsPath = path.join(repo, `entries/${ENTRY}/models.json`);
const prov = JSON.parse(readFileSync(provPath, "utf8"));
const current = JSON.parse(readFileSync(modelsPath, "utf8"));
const protocols = prov.endpoints.map((e) => e.protocol);

// One row per resolved id. With the date shortened rather than dropped this is
// 1:1 — the group exists so that a future pair which *does* collapse is summed
// and reported instead of writing two rows with one id, which the entry rejects.
const groups = new Map();
for (const [permaslug, tokens] of totals) {
  const id = resolve(permaslug);
  const key = id ?? `?${permaslug}`;
  const g = groups.get(key) ?? { id, tokens: 0, slugs: [] };
  g.tokens += tokens;
  g.slugs.push(permaslug);
  groups.set(key, g);
}
const ranked = [...groups.values()].sort((a, b) => b.tokens - a.tokens).slice(0, TOP);

console.log(`top ${TOP} models by tokens served, as the models list spells them:\n`);

const rows = [];
const unresolved = [];
for (const [i, g] of ranked.entries()) {
  const m = g.id && byId.get(g.id);
  if (!m) {
    unresolved.push([i + 1, g.slugs, g.tokens]);
    console.log(`  ${String(i + 1).padStart(2)}. ${g.slugs.join(" + ").padEnd(48)} ${(g.tokens / 1e9).toFixed(1).padStart(9)}B tok   — not in the models list`);
    continue;
  }
  const p = m.pricing ?? {};
  const row = { id: g.id.split("/").pop(), name: String(m.name ?? g.id) };
  if (p.prompt !== undefined && !String(p.prompt).startsWith("-")) {
    row.in = perMillion(p.prompt);
    row.out = perMillion(p.completion);
    if (p.input_cache_read !== undefined) row.cache_read = perMillion(p.input_cache_read);
    if (p.input_cache_write !== undefined) row.cache_creation = perMillion(p.input_cache_write);
  }
  // The upstream string is the vendor's own, on every protocol — OpenRouter
  // takes the same `vendor/model` whichever shape the caller speaks.
  row.serves = Object.fromEntries(protocols.map((x) => [x, g.id]));
  rows.push({ row, rank: i + 1, tokens: g.tokens, id: g.id });

  const bits = row.in === undefined ? ["no fixed price"] : [`in ${row.in}`, `out ${row.out}`];
  const merged = g.slugs.length > 1 ? `   (${g.slugs.length} snapshots merged)` : "";
  console.log(`  ${String(i + 1).padStart(2)}. ${g.slugs.join(" + ").padEnd(48)} ${(g.tokens / 1e9).toFixed(1).padStart(9)}B tok → ${g.id.padEnd(40)} ${bits.join(" ")}${merged}`);
}

if (rows.length === 0) stop("nothing resolved — refusing to write an empty entry");

// The flagship is the one model whose price represents the provider. The rule in
// the README picks the highest output price; here the ranking already says which
// model this provider is known for, which is the same question asked better.
const first = rows.find((r) => r.row.in !== undefined) ?? rows[0];
first.row.flagship = true;

if (unresolved.length) {
  console.log(`\n! ${unresolved.length} ranked model(s) are not in the models list, so they have nothing to write:`);
  for (const [rank, slug, tokens] of unresolved) console.log(`    #${rank} ${slug} (${(tokens / 1e9).toFixed(1)}B tok)`);
}

const before = new Set(current.map((r) => r.id));
const after = new Set(rows.map((r) => r.row.id));
console.log(`\nrows: ${current.length} -> ${rows.length}` +
  `  (+${[...after].filter((i) => !before.has(i)).length} new, -${[...before].filter((i) => !after.has(i)).length} dropped)`);
console.log(`flagship: ${current.find((r) => r.flagship)?.id ?? "(none)"} -> ${first.row.id}`);
console.log(`\nRepublishing this data requires: "Source: OpenRouter (openrouter.ai/rankings), as of ${ranking.meta.as_of}"`);

if (WRITE) {
  writeFileSync(modelsPath, JSON.stringify(rows.map((r) => r.row), null, 2) + "\n");
  console.log(`\n✓ wrote entries/${ENTRY}/models.json — ${rows.length} rows`);
}
