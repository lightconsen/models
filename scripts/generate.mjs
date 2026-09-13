#!/usr/bin/env node
/**
 * Validate + build the Kiwano Hub data files.
 *
 * Source of truth (hand-edited, git-reviewed) — two files per provider, split by
 * how often they change:
 *   entries/<id>/provider.json – the stable half: identity, protocols, billing.
 *                                Changes when a vendor's endpoint/protocol/billing
 *                                changes, never when a model is repriced.
 *                                Its `currency` is the one the provider bills in
 *                                (default USD when omitted) — the currency its
 *                                spending limit is denominated in, so the app
 *                                never has to guess it from model names.
 *                                `logo_color` is a hand-picked brand colour (see
 *                                the note next to PALETTE in the app's vm.rs);
 *                                `logo_char` is NOT stored — it is derived from
 *                                `name` at build time.
 *   entries/<id>/models.json   – the volatile half: one entry per model this
 *                                provider serves, prices inline. Repricing, new
 *                                models and retirements touch only this file.
 *                                Rows carry no currency: the provider's applies.
 *   global.json                – exchange rates + the vendor pricing left once
 *                                every provider's own rows are split out. These
 *                                rows keep their own `currency`, since they are
 *                                shared across providers.
 *   news/<id>.json             – model news: one file per notice, each naming a
 *                                (provider, model) pair. The file name is the id.
 *                                Published whole as dist/news.json; the app
 *                                decides what is still fresh enough to show.
 *
 * Model identity: `models[].id` is the CANONICAL pricing key — it is what
 * dist/models.json is keyed by and what makes one model comparable across
 * providers. The string a provider's API actually accepts lives in `serves`
 * (protocol -> upstream string), which may differ from `id` (e.g. OpenRouter
 * wants `openai/gpt-5.2` where the canonical key is `gpt-5.2`). Measured: 36
 * such pairs across 14 providers. `endpoints[0]` is the primary protocol.
 *
 * Published shapes (written to dist/, uploaded to R2 by CI):
 *   dist/catalog.json   {"total": N, "entries": [...]}  – Hub protocol v0,
 *                         entries sorted by id. Field order is canonical (a
 *                         one-time reordering; entries used to follow each
 *                         source file's key order).
 *   dist/models.json    {...source, models: [all rows], generated_at: today}
 *                         – the flat global table the app's PricingTable reads;
 *                         every row carries a currency (the provider's for
 *                         entries/, its own for global.json).
 *   dist/news.json      {"news": [...]}  – every news/<id>.json, each with its
 *                         id folded in from the file name; by priority, then
 *                         newest. Deliberately carries no timestamp and drops
 *                         nothing by age, so its sha256 only moves when the
 *                         news does.
 *   dist/manifest.json  counts/versions + sha256 of all three
 *   dist/logos/<id>.png|svg|jpg|webp  – provider logo copied from
 *                         entries/<id>/logo.<ext> (catalog entries reference
 *                         them via the relative `logo` field)
 *
 * Usage:
 *   node scripts/generate.mjs             validate + write dist/
 *   node scripts/generate.mjs --check     validate only, no writes (PR gate)
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(path.join(repo, f), "utf8"));

let failed = 0;
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  failed++;
};
const warn = (msg) => console.warn(`  ⚠ ${msg}`);

const BILLINGS = new Set(["plan", "payg", "unl"]);
const PROTOCOLS = new Set(["anthropic", "openai", "gemini"]);
const TAGS = new Set(["official", "third", "aggregate", "local", "free"]);
const LOGO_EXTS = ["png", "svg", "jpg", "jpeg", "webp"];
/** provider.json keys we read. Anything else is warned about — that is how a
    leftover `price_line` or `icon` from the previous schema gets caught. */
const PROVIDER_KEYS = new Set([
  "id", "name", "tag", "rating", "billing", "currency", "endpoints", "desc",
]);
/** models.json keys we read. */
const MODEL_KEYS = new Set([
  "id", "name", "in", "out", "cache_read", "cache_creation", "serves", "flagship",
]);
const CURRENCY_RE = /^[A-Z]{3}$/;
const DEFAULT_CURRENCY = "USD";

/** A non-negative decimal in a string, the shape every price field uses. */
function isDecimal(v) {
  return typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) && Number(v) >= 0;
}

/** Validate one row of global.json. `rates` is null before global.json is read,
    since a row's currency can only be checked against the exchange rates.
    Provider rows no longer go through here: they are built from models.json,
    which is validated separately, and inherit the provider's currency. */
function checkPriceRow(m, where, rates) {
  const id = m?.model_id ?? "?";
  for (const f of ["model_id", "display_name", "input", "output", "cache_read", "cache_creation", "currency"]) {
    if (typeof m?.[f] !== "string" || m[f].trim() === "") fail(`${where}: price row "${id}" missing/empty ${f}`);
  }
  for (const f of ["input", "output", "cache_read", "cache_creation"]) {
    if (m?.[f] !== undefined && !isDecimal(m[f])) {
      fail(`${where}: price row "${id}" ${f} "${m[f]}" is not a non-negative decimal`);
    }
  }
  if (rates && typeof m?.currency === "string" && !(m.currency in rates)) {
    fail(`${where}: price row "${id}" currency "${m.currency}" has no exchange rate`);
  }
}

/** Identity of a price row for duplicate detection: the priced fields only,
    so a shared model may repeat across entries but never drift between them.
    The currency counts: the same model priced in USD by one entry and CNY by
    another is a conflict, not a duplicate.

    JSON.stringify does the joining rather than a separator character: it escapes
    whatever a model id could contain, so this file carries no invisible byte. An
    earlier version used a literal NUL here, which made the whole script read as
    binary to grep and git. */
const PRICE_FIELDS = ["model_id", "display_name", "input", "output", "cache_read", "cache_creation"];
const priceKey = (m) => JSON.stringify([...PRICE_FIELDS, "currency"].map((f) => String(m?.[f] ?? "")));

/** The published catalog entry, in a canonical key order. Canonical on purpose:
    the order used to follow each source file's own key order, which produced
    seven different orderings across 82 entries.

    Nothing derivable is published. `logo_char`, `logo_color`, `tag_label` and
    the primary endpoint (`protocol` / `endpoint` / `models`) are all computed on
    the app side from `name`, `tag` and `endpoints[0]` — a glyph from a name, a
    label from a tag, an avatar colour from the palette the locally-added
    providers already use. Keeping them here meant two sources for one value, and
    for the tag label that drift was real: three entries carried a label
    contradicting their own tag. */
function catalogEntry(e, derived) {
  return {
    id: e.id,
    name: e.name,
    tag: e.tag,
    rating: e.rating,
    billing: e.billing,
    currency: e.currency,
    // Every endpoint, primary first — the source's own shape. The app hoists the
    // first into its own fields on the way in, because that is what its screens
    // read.
    endpoints: derived.endpoints,
    logo: `logos/${e.id}.${derived.logoExt}`,
    ...(e.desc === undefined ? {} : { desc: e.desc }),
    ...(derived.priceRef === undefined ? {} : { price_ref: derived.priceRef }),
  };
}

// ── entries/<id>/{provider.json, models.json} ──

console.log("entries/");
const entryDirs = readdirSync(path.join(repo, "entries"), { withFileTypes: true })
  .filter((d) => statSync(path.join(repo, "entries", d.name)).isDirectory())
  .map((d) => d.name)
  .sort();
const catalog = [];
const ids = new Set();
const logoFiles = [];
/** Entries that leaned on the USD default, reported at the end. */
const defaultedCurrency = [];
// { entry, row } for every priced model; merged into dist/models.json once the
// exchange rates are known.
const entryPriceRows = [];
// provider id -> the set of model names it serves, for the news check below.
// Built from canonical ids AND the upstream strings, so a notice may name
// either form.
const served = new Map();

for (const dir of entryDirs) {
  const file = path.join("entries", dir, "provider.json");
  let e;
  try {
    e = JSON.parse(readFileSync(path.join(repo, file), "utf8"));
  } catch (err) {
    fail(`${file}: invalid JSON (${err.message})`);
    continue;
  }
  const where = `${dir}: entry ${e.id ?? "?"}`;
  if (e.id !== dir) fail(`${where}: id must match the directory name`);
  if (ids.has(e.id)) fail(`${where}: duplicate id`);
  ids.add(e.id);

  // ── provider.json ──
  if (typeof e.name !== "string" || e.name.trim() === "") fail(`${where}: missing/empty name`);
  if (!TAGS.has(e.tag)) fail(`${where}: tag "${e.tag}" not one of ${[...TAGS].join("|")}`);
  if (typeof e.rating !== "number" || e.rating < 0 || e.rating > 5) fail(`${where}: rating must be a number in 0..5`);
  if (!BILLINGS.has(e.billing)) fail(`${where}: billing "${e.billing}" not one of ${[...BILLINGS].join("|")}`);
  // The provider bills in one currency; its model rows and the spending limit
  // the app offers are both denominated in it. Missing → USD (the table's base
  // currency), so an unfilled entry cannot make the app guess per model name.
  if (e.currency === undefined || e.currency === null) {
    defaultedCurrency.push(e.id);
    e.currency = DEFAULT_CURRENCY;
  } else if (typeof e.currency !== "string" || !CURRENCY_RE.test(e.currency)) {
    fail(`${where}: currency "${e.currency}" must be an ISO-4217 code like USD`);
  }
  if (e.desc !== undefined && typeof e.desc !== "string") fail(`${where}: desc must be a string`);
  if (!Array.isArray(e.endpoints) || e.endpoints.length === 0) {
    fail(`${where}: endpoints must be a non-empty array — the first one is the primary protocol`);
  } else {
    // One endpoint per protocol: the provider's PK app-side is
    // (provider_id, protocol) — a repeat here would be silently dropped when
    // the entry is added, losing the endpoint.
    const seen = new Set();
    for (const x of e.endpoints) {
      if (!PROTOCOLS.has(x?.protocol)) fail(`${where}: endpoint protocol "${x?.protocol}" not one of ${[...PROTOCOLS].join("|")}`);
      else if (seen.has(x.protocol)) fail(`${where}: duplicate protocol "${x.protocol}"`);
      seen.add(x.protocol);
      if (typeof x?.endpoint !== "string" || x.endpoint.trim() === "") fail(`${where}: endpoint for "${x?.protocol}" is empty`);
    }
  }
  for (const k of Object.keys(e)) if (!PROVIDER_KEYS.has(k)) warn(`${where}: unknown key "${k}" — ignored (known: ${[...PROVIDER_KEYS].join(", ")})`);

  // ── logo file ──
  let logoExt = null;
  for (const ext of LOGO_EXTS) {
    const f = path.join(repo, "entries", dir, `logo.${ext}`);
    if (existsSync(f)) {
      if (logoExt) fail(`${where}: multiple logo files (logo.${logoExt} and logo.${ext})`);
      else logoExt = ext;
    }
  }
  if (!logoExt) {
    fail(`${where}: missing logo file (logo.png|svg|jpg|jpeg|webp)`);
  } else {
    logoFiles.push({ id: e.id, ext: logoExt });
  }

  // ── models.json ──
  // A leftover price.json means the directory was never migrated: fail loudly
  // rather than publish a provider with no models.
  if (existsSync(path.join(repo, "entries", dir, "price.json"))) {
    fail(`entries/${dir}/price.json: this file was replaced by models.json — delete it`);
  }
  const modelsPath = path.join("entries", dir, "models.json");
  let models;
  try {
    models = JSON.parse(readFileSync(path.join(repo, modelsPath), "utf8"));
  } catch (err) {
    fail(
      err.code === "ENOENT"
        ? `${modelsPath}: missing (use [] when this provider serves no models yet)`
        : `${modelsPath}: invalid JSON (${err.message})`,
    );
    models = [];
  }
  if (!Array.isArray(models)) {
    fail(`${modelsPath}: must be an array of models`);
    models = [];
  }
  const protocols = new Set((e.endpoints ?? []).map((x) => x?.protocol));
  const seenModelIds = new Set();
  const priced = [];
  let flagshipCount = 0;
  for (const m of models) {
    const mid = typeof m?.id === "string" ? m.id : "?";
    const mw = `${modelsPath}: model "${mid}"`;
    if (typeof m?.id !== "string" || m.id.trim() === "") {
      fail(`${mw}: id is required`);
      continue;
    }
    const key = m.id.toLowerCase();
    if (seenModelIds.has(key)) fail(`${mw}: duplicate id`);
    seenModelIds.add(key);
    if (m.name !== undefined && typeof m.name !== "string") fail(`${mw}: name must be a string`);
    const hasIn = m.in !== undefined;
    const hasOut = m.out !== undefined;
    if (hasIn !== hasOut) fail(`${mw}: in and out come together — a model is either priced or not`);
    for (const f of ["in", "out", "cache_read", "cache_creation"]) {
      if (m[f] !== undefined && !isDecimal(m[f])) fail(`${mw}: ${f} "${m[f]}" is not a non-negative decimal`);
    }
    if (hasIn && hasOut) {
      // dist/models.json rows carry display_name and the app's ModelPriceEntry
      // requires it, so a priced model without a name would break the price
      // table for every client.
      if (typeof m.name !== "string" || m.name.trim() === "") {
        fail(`${mw}: a priced model needs a name — it becomes display_name in dist/models.json`);
      }
      priced.push(m);
    }
    if (m.serves !== undefined) {
      const okShape = m.serves !== null && typeof m.serves === "object" && !Array.isArray(m.serves);
      if (!okShape) fail(`${mw}: serves must be an object of protocol -> upstream string`);
      else {
        const entries = Object.entries(m.serves);
        if (entries.length === 0) fail(`${mw}: serves must not be empty — omit it to mean every endpoint`);
        for (const [proto, upstream] of entries) {
          if (!protocols.has(proto)) fail(`${mw}: serves names protocol "${proto}", which this provider has no endpoint for`);
          if (typeof upstream !== "string" || upstream.trim() === "") fail(`${mw}: serves["${proto}"] must be a non-empty string`);
        }
      }
    }
    if (m.flagship !== undefined && typeof m.flagship !== "boolean") {
      fail(`${mw}: flagship must be boolean`);
    }
    if (m.currency !== undefined) fail(`${mw}: must not carry a currency — the provider's applies`);
    for (const k of Object.keys(m)) if (!MODEL_KEYS.has(k)) warn(`${mw}: unknown key "${k}" — ignored (known: ${[...MODEL_KEYS].join(", ")})`);
  }
  // Flagged models are validated after the loop so the message does not depend
  // on iteration order. A provider with no priced model simply carries no
  // flagship — there would be no numbers to project into `price_ref`.
  const flagged = models.filter((m) => m?.flagship === true);
  if (flagged.length > 1) {
    fail(`${where}: ${flagged.length} models are flagged flagship — at most one per provider`);
  }
  for (const m of flagged) {
    if (m.in === undefined || m.out === undefined) {
      fail(`${where}: flagship "${m.id}" must be a priced model — it is what the list shows for this provider`);
    }
  }

  // ── derived: serves -> per-protocol upstream strings ──
  const byProtocol = new Map(); // protocol -> [upstream string]
  for (const x of e.endpoints ?? []) byProtocol.set(x.protocol, []);
  const allServed = new Set();
  for (const m of models) {
    if (typeof m?.id !== "string" || m.id.trim() === "") continue;
    const targets = m.serves === undefined ? [...protocols] : Object.keys(m.serves);
    for (const proto of targets) {
      const upstream = m.serves === undefined ? m.id : m.serves[proto];
      byProtocol.get(proto)?.push(upstream);
      allServed.add(String(upstream).toLowerCase());
    }
    allServed.add(m.id.toLowerCase());
  }
  served.set(e.id, allServed);

  // ── derived: price_ref from the flagship ──
  const flagship = models.find((m) => m?.flagship === true) ?? null;
  const priceRef =
    flagship === null
      ? undefined
      : {
          model_id: flagship.id,
          display_name: flagship.name,
          input: flagship.in,
          output: flagship.out,
          currency: e.currency,
        };

  catalog.push(
    catalogEntry(e, {
      endpoints: (e.endpoints ?? []).map((x) => ({
        protocol: x.protocol,
        endpoint: x.endpoint,
        models: byProtocol.get(x.protocol) ?? [],
      })),
      priceRef,
      logoExt: logoExt ?? "svg",
    }),
  );

  for (const m of priced) {
    entryPriceRows.push({
      entry: dir,
      row: {
        model_id: m.id,
        display_name: m.name,
        input: m.in,
        output: m.out,
        cache_read: m.cache_read ?? "0",
        cache_creation: m.cache_creation ?? "0",
      },
      currency: e.currency,
    });
  }
}
console.log(`  ✓ ${catalog.length} provider directories validated`);

// ── prices: global.json + the providers' own models.json ──

console.log("global.json");
const doc = read("global.json");
if (!Number.isInteger(doc.version) || doc.version < 1) {
  fail("version must be a positive integer (version-gated app-side seeding)");
}
const rates = doc.exchange_rates;
if (typeof rates !== "object" || rates === null) {
  fail("exchange_rates must be an object of numbers");
} else {
  if (rates.USD !== 1) fail("exchange_rates must pin USD = 1 (conversion pivot)");
  for (const [c, r] of Object.entries(rates)) {
    if (typeof r !== "number" || r <= 0) fail(`rate ${c} must be a positive number`);
  }
}
const docRows = Array.isArray(doc.models) ? doc.models : [];
const docIds = new Set();
for (const m of docRows) {
  const key = typeof m?.model_id === "string" ? m.model_id.toLowerCase() : "?";
  if (docIds.has(key)) fail(`global.json: duplicate model_id "${m?.model_id}"`);
  docIds.add(key);
}
docRows.forEach((m, i) => checkPriceRow(m, `global.json row ${i + 1}`, rates));
entryPriceRows.forEach(({ entry, row, currency }) => checkPriceRow({ ...row, currency }, `entries/${entry}/models.json`, rates));
// A provider's currency must be convertible: the app compares its spending
// limit against converted amounts.
for (const e of catalog) {
  if (!(e.currency in rates)) fail(`entries/${e.id}: currency "${e.currency}" has no exchange rate`);
}

// Merge both sources into the flat table the app publishes. A model_id may be
// listed by several entries (aggregators share vendor models), so repeats are
// allowed — but the copies must be identical, or the published price would
// depend on which entry happened to be merged last.
const merged = new Map();
const mergeIn = (row, src) => {
  const key = typeof row?.model_id === "string" ? row.model_id.toLowerCase() : "?";
  const prev = merged.get(key);
  if (!prev) merged.set(key, { row, src, fields: priceKey(row) });
  else if (prev.fields !== priceKey(row)) fail(`price row "${row?.model_id}" differs between ${prev.src} and ${src}`);
};
for (const { entry, row, currency } of entryPriceRows) {
  mergeIn({ ...row, currency }, `entries/${entry}/models.json`);
}
for (const row of docRows) mergeIn(row, "global.json");
const priceRows = [...merged.values()]
  .map((v) => v.row)
  .sort((a, b) => a.model_id.localeCompare(b.model_id));
console.log(
  `  ✓ ${priceRows.length} price rows (v${doc.version}): ` +
    `${entryPriceRows.length} from entries/ + ${docRows.length} global`,
);

// ── news/<id>.json ──

console.log("news/");
const KINDS = new Set(["new_model", "free", "discount", "announce"]);
// `id` is deliberately absent from the file: the file name is the id, and it is
// what the app stores "dismissed" under. Repeating it inside would be a second
// place to disagree — the same reason model rows carry no currency.
const NEWS_KEYS = new Set([
  "kind", "provider_id", "model_id", "released",
  "title", "body", "badge", "priority", "expires_at", "url",
]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date. The regex alone would accept 2026-02-30; Date.parse
    rejects the out-of-range day. */
const isDate = (s) =>
  typeof s === "string" && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const DAY_MS = 86_400_000;

/** The news directory: one <id>.json per item, so two people adding news touch
    different files and never conflict on a shared array. Sorted by file name so
    the validation output — and therefore the build — is deterministic. Dotfiles
    are skipped: macOS drops a .DS_Store into any directory you browse. */
const newsDir = path.join(repo, "news");
const newsFiles = existsSync(newsDir)
  ? readdirSync(newsDir, { withFileTypes: true })
      .filter((d) => !d.name.startsWith("."))
      .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
      .sort((a, b) => a.name.localeCompare(b.name))
  : [];

const news = [];
const newsNow = Date.now();
for (const f of newsFiles) {
  if (f.isDir || !f.name.endsWith(".json")) {
    console.warn(`  ⚠ news/${f.name}: ignored — news/ holds one <id>.json per item`);
    continue;
  }
  const id = f.name.slice(0, -".json".length);
  const where = `news/${f.name}`;
  let n;
  try {
    n = read(`news/${f.name}`);
  } catch (err) {
    fail(`${where}: invalid JSON (${err.message})`);
    continue;
  }
  if (typeof n?.id !== "undefined") {
    fail(`${where}: drop the "id" field — the file name is the id, and two sources can disagree`);
  }
  if (!/^[a-z0-9][a-z0-9.-]{2,63}$/.test(id)) {
    fail(`${where}: id must be lowercase [a-z0-9.-], 3-64 chars, starting alphanumeric — it is the file name, and it is permanent (the app keys "dismissed" on it, so a rename re-shows the item)`);
  }
  if (!KINDS.has(n?.kind)) fail(`${where}: kind "${n?.kind}" not one of ${[...KINDS].join("|")}`);
  // provider_id + model_id are what make a notice actionable: the app shows the
  // model on that provider's row and routes the call to action from that entry.
  if (typeof n?.provider_id !== "string" || !ids.has(n.provider_id)) {
    fail(`${where}: provider_id "${n?.provider_id}" is not a directory in entries/`);
  }
  if (typeof n?.model_id !== "string" || n.model_id.trim() === "") {
    fail(`${where}: model_id is required`);
  } else if (served.has(n.provider_id) && !served.get(n.provider_id).has(n.model_id.toLowerCase())) {
    fail(`${where}: entries/${n.provider_id} does not serve "${n.model_id}" — declare it in models.json first (its canonical id, or an upstream string in "serves")`);
  }
  if (!isDate(n?.released)) fail(`${where}: released must be a real YYYY-MM-DD date`);
  else if (Date.parse(`${n.released}T00:00:00Z`) > newsNow + 30 * DAY_MS) {
    fail(`${where}: released "${n.released}" is more than 30 days ahead — typo?`);
  }
  if (typeof n?.title !== "string" || n.title.trim() === "" || n.title.length > 80) {
    fail(`${where}: title must be a non-empty string of at most 80 chars`);
  }
  if (typeof n?.body !== "string" || n.body.trim() === "" || n.body.length > 300) {
    fail(`${where}: body must be a non-empty string of at most 300 chars`);
  }
  if (n?.badge !== undefined && (typeof n.badge !== "string" || n.badge.length > 8)) {
    fail(`${where}: badge must be a string of at most 8 chars`);
  }
  if (n?.priority !== undefined && !Number.isInteger(n.priority)) fail(`${where}: priority must be an integer`);
  if (n?.expires_at !== undefined) {
    if (!isDate(n.expires_at)) fail(`${where}: expires_at must be a real YYYY-MM-DD date`);
    else if (Date.parse(`${n.expires_at}T00:00:00Z`) <= Date.parse(`${n.released}T00:00:00Z`)) {
      fail(`${where}: expires_at must be after released`);
    }
  }
  if (n?.url !== undefined) {
    let ok = typeof n.url === "string";
    try {
      const u = new URL(n.url);
      ok = ok && (u.protocol === "https:" || u.protocol === "http:");
    } catch {
      ok = false;
    }
    if (!ok) fail(`${where}: url "${n.url}" must be an http(s) URL`);
  }
  // `id` is excluded here: it already failed above with a message that says
  // what to do, and reporting it twice helps nobody.
  const unknown = Object.keys(n ?? {}).filter((k) => k !== "id" && !NEWS_KEYS.has(k));
  if (unknown.length > 0) {
    console.warn(`  ⚠ ${where}: unknown key(s) ${unknown.join(", ")} — ignored (known: ${[...NEWS_KEYS].join(", ")})`);
  }
  // Rebuilt in a fixed key order rather than spread: it puts `id` first, keeps
  // the published file diff-friendly, and drops the unknown keys just warned
  // about instead of shipping them anyway. `id` comes from the file name, so a
  // stray one inside the file cannot shadow it.
  const item = { id };
  for (const k of NEWS_KEYS) if (n?.[k] !== undefined) item[k] = n[k];
  news.push(item);
}
// Publish order is display order: what the app shows first when several notices
// are live. Newest release breaks a priority tie; id keeps it deterministic.
news.sort(
  (a, b) =>
    (b.priority ?? 0) - (a.priority ?? 0) ||
    String(b.released).localeCompare(String(a.released)) ||
    String(a.id).localeCompare(String(b.id)),
);
console.log(`  ✓ ${news.length} news item(s) over ${new Set(news.map((n) => n.provider_id)).size} provider(s)`);

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
const modelsSha = write("models.json", { ...doc, models: priceRows, generated_at: today });
// No generated_at inside news.json, and no build-time freshness filter. The
// file is content-addressed: a date stamp would move the sha (and make every
// client re-download) once a day with nothing new, and dropping items by age
// would make the same commit build differently tomorrow. Publish everything and
// let the app — which knows what "today" is — decide what is still worth
// showing.
const newsSha = write("news.json", { news });
write("manifest.json", {
  generated_at: new Date().toISOString(),
  catalog: { count: catalog.length, sha256: catalogSha },
  models: { version: doc.version, sha256: modelsSha },
  news: { count: news.length, sha256: newsSha },
});

const logosDist = path.join(dist, "logos");
mkdirSync(logosDist, { recursive: true });
for (const { id, ext } of logoFiles) {
  copyFileSync(path.join(repo, "entries", id, `logo.${ext}`), path.join(logosDist, `${id}.${ext}`));
}

console.log("\ndist/ written:");
for (const f of ["catalog.json", "models.json", "news.json", "manifest.json"]) {
  console.log(`  ${f}`);
}
console.log(`  logos/ (${logoFiles.length} files)`);
if (defaultedCurrency.length > 0) {
  console.log(`\n  ${defaultedCurrency.length} entr(ies) defaulted to ${DEFAULT_CURRENCY}: ${defaultedCurrency.join(", ")}`);
}
