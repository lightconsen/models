/**
 * Azure OpenAI Service's prices, from Microsoft's own Retail Prices API
 * (`prices.azure.com/api/retail/prices`, free, no key, filterable) — the same
 * feed azure.microsoft.com's pricing pages render from. Filtered to the
 * `Azure OpenAI*` product families; the Foundry-hosted partners (kimi, grok,
 * llama, mistral, phi, cohere) are separate product families that price the
 * separate `azure-foundry` entry.
 *
 * The feed's meter name packs everything the price depends on, and it packs it
 * in several spellings accumulated over eras — `5.6 sol ShortCo Inp Std Gl 1M
 * Tokens` beside `GPT 5.1 inp Gl 1M Tokens` beside `o4-mini 0416 Inp glbl
 * Tokens` beside `text embedding 3 large DZ Tokens`. The parser reads it
 * token-wise, case-insensitively, and the pieces are:
 *
 *   field       inp/inpt/input → in; out/outp/outpt/opt → out; cchd/cached/
 *               cd inp → cache_read; cd wr → cache_creation
 *   deployment  glbl/gl → Global; dz/dzone/datazone → Data Zone; rgnl/
 *               regional/rg → Regional
 *   tier        std → standard (the new spellings state it; the old ones are
 *               standard unless a tier token says otherwise)
 *   skipped     batch / pp / flex (discounted or premium tiers), ft / rft /
 *               hosting / training (fine-tuning), realtime/audio/image/media
 *               models (billed by another measure or by modality), deep
 *               research (token + per-call), computer-use
 *   context     shco/shortco vs loco/longco — the new generation prices two
 *               context bands per model; the long band folds into
 *               `long_context`, over 272k, the page's own line
 *   unit        unitOfMeasure "1M" reads as-is; "1K" scales ×1000
 *
 * One price per model: Global where the feed states it (uniform across
 * regions), Regional→eastus where Global does not exist (gpt-4o-mini), Data
 * Zone→eastus when that is all there is (the embeddings rows). The model ids
 * are the vendor's own — verified against Microsoft's Foundry model list
 * (`learn.microsoft.com … models-sold-directly-by-azure`, which spells
 * `gpt-6-sol`, `gpt-6-luna`, `o3-mini`, `gpt-5.2-chat`…), not invented from
 * meter prefixes; the map below carries the id each meter prefix prices, and
 * a prefix the table lacks is dropped loudly.
 */
import { drift, getJson, MEMBERSHIP } from "../lib/fetch.mjs";

const API = "https://prices.azure.com/api/retail/prices";
const FILTER = "startswith(productName,%27Azure%20OpenAI%27)";

/** Meter model prefix → entry id, + how the model's context bands price.
    `bands: "shortlong"` = ShortCo/LongCo spellings; `"longco"` = the 5.4-era
    LongCo-without-short spelling; `null` = no bands. */
const MODELS = {
  "5.6 sol": { id: "gpt-5.6-sol", bands: "shortlong" },
  "5.6 luna": { id: "gpt-5.6-luna", bands: "shortlong" },
  "5.6 terra": { id: "gpt-5.6-terra", bands: "shortlong" },
  "6-astra": { id: "gpt-6-astra", bands: "shortlong" },
  "6-sol": { id: "gpt-6-sol", bands: "shortlong" },
  "6-luna": { id: "gpt-6-luna", bands: "shortlong" },
  "5.5": { id: "gpt-5.5", bands: "longco" },
  "5.4": { id: "gpt-5.4", bands: "longco" },
  "5.4 mini": { id: "gpt-5.4-mini" },
  "5.4 nano": { id: "gpt-5.4-nano" },
  "5.4 pro": { id: "gpt-5.4-pro", bands: "longco" },
  "5.2": { id: "gpt-5.2" },
  "5.2 codex": { id: "gpt-5.2-codex" },
  "5.3 codex": { id: "gpt-5.3-codex" },
  "5.1": { id: "gpt-5.1" },
  "5.1 codex": { id: "gpt-5.1-codex" },
  "5.1 codex max": { id: "gpt-5.1-codex-max" },
  "5.1 codex mini": { id: "gpt-5.1-codex-mini" },
  "GPT 5.1": { id: "gpt-5.1" },
  "GPT 5.2": { id: "gpt-5.2" },
  "chat-latest": { id: "gpt-chat-latest", latestDate: true },
  "GPT 5": { id: "gpt-5" },
  "gpt 5 pro": { id: "gpt-5-pro" },
  "5.2 pro": { id: "gpt-5.2-pro" },
  "GPT 5 Chat": { id: "gpt-5-chat" },
  "GPT 5 Mini": { id: "gpt-5-mini" },
  "GPT 5 Nano": { id: "gpt-5-nano" },
  "5 mini": { id: "gpt-5-mini" },
  "5 nano": { id: "gpt-5-nano" },
  "o1 1217": { id: "o1" },
  "o1-mini": { id: "o1-mini" },
  "o1 mini": { id: "o1-mini" },
  "o1 mini": { id: "o1-mini" },
  "o3 0416": { id: "o3" },
  "o3 mini 0131": { id: "o3-mini" },
  "o3 mini": { id: "o3-mini" },
  "o4-mini 0416": { id: "o4-mini" },
  "o4 mini": { id: "o4-mini" },
  "codex mini": { id: "codex-mini" },
  "4.1": { id: "gpt-4.1" },
  "4.1 mini": { id: "gpt-4.1-mini" },
  "4.1 nano": { id: "gpt-4.1-nano" },
  "gpt 4o 1120": { id: "gpt-4o" },
  "gpt 4o 0513": { id: "gpt-4o-0513" },
  "gpt 4o 0806": { id: "gpt-4o-0806" },
  "gpt 4o mini 0718": { id: "gpt-4o-mini" },
  "gpt 4o mini": { id: "gpt-4o-mini" },
  "Az-GPT4-Turbo-128K": { id: "gpt-4-turbo" },
  "Az-GPT35-Turbo-16K-1106": { id: "gpt-3.5-turbo-1106" },
  "Az-GPT-3.5-turbo": { id: "gpt-3.5-turbo-0125" },
  "gpt-oss-120b": { id: "gpt-oss-120b" },
  "text embedding 3 large": { id: "text-embedding-3-large", embed: true },
  "text embedding 3 small": { id: "text-embedding-3-small", embed: true },
  "az-embeddings-ada": { id: "text-embedding-ada-002", embed: true },
};

const SKIP_CLASS =
  /\b(batch|pp|flex|ft|rft|hosting|training|provisioned|grader|realtime|aud\b|image|img|media|speech|tts|trscb|transc|flare|sunburst|deep research|computer-use|sora)\b/i;

/** The prefix, case-insensitively, is the meter's model part: everything
    before the first tier/field/context token. Longest match wins — and the
    match must END at a word the meter grammar continues with, so "5.2 pro"
    does not swallow "gpt 5.2 pro" and "5.4" does not swallow "5.4 mini". */
const PREFIXES = Object.keys(MODELS).sort((a, b) => b.length - a.length);

const perMillion = (v, uom) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  const scaled = uom === "1M" ? n : uom === "1K" ? n * 1000 : undefined;
  if (scaled === undefined) return undefined;
  return String(Math.round(scaled * 100_000) / 100_000).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

/** One meter, read. Returns null for every meter this entry does not price. */
/** What may follow a model prefix inside a meter: a field, a deployment, a
    tier/context word, or the unit. "5.2 pro inp…" must match the "5.2 pro"
    prefix, not "5.2" followed by a stray "pro" — the continuation check is
    what keeps the longest-prefix rule honest. */
const CONTINUES = /^(inp|inpt|input|out|outp|outpt|opt|output|cd|cchd|cached|global|gl|glbl|dz|dzone|datazone|regional|regnl|rgnl|rg|std|shortco|shco|loco|longco|batch|flex|pp|priority|tokens|\d{6,8})$/;

const readMeter = (m) => {
  const low = " " + m.toLowerCase() + " ";
  if (SKIP_CLASS.test(low)) return null;
  const prefix = PREFIXES.find((p) => {
    const at = low.indexOf(" " + p.toLowerCase() + " ");
    if (at < 0) return false;
    // the token right after the prefix must continue the meter grammar —
    // scanning the whole rest would let a later "tokens" vouch for anything
    const next = low.slice(at + p.length + 1).trimStart().split(" ")[0];
    return CONTINUES.test(next);
  });
  if (!prefix) return null;
  const spec = MODELS[prefix];
  // field — order matters: the cache-write compound is checked before the
  // bare cache-read one, and "cd inp" alone is the cache READ (the write
  // says "cd wr").
  let field = null;
  if (/cd wr/.test(low)) field = "cache_creation";
  else if (/\b(cd|cchd|cached)\b/.test(low)) field = "cache_read";
  else if (/\b(inp|inpt|input)\b/.test(low)) field = "in";
  else if (/\b(out|outp|outpt|opt|output)\b/.test(low)) field = "out";
  if (!field && spec?.embed) field = "in";
  if (!field) return null;
  // deployment
  const dep = /\b(global|glbl|gl)\b/.test(low) ? "global" : /\b(dz|dzone|datazone|data zone)\b/.test(low) ? "dz" : /\b(regnl|regional|rg)\b/.test(low) ? "regional" : null;
  // context band
  const band = /\b(shco|shortco)\b/.test(low) ? "short" : /\b(loco|longco)\b/.test(low) ? "long" : null;
  return { spec, field, dep, band };
};

export default {
  ids: ["azure-openai"],
  source: API,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "cache_creation", "long_context"],

  async read() {
    /** Page through the feed; every family the filter names. */
    const items = [];
    let url = `${API}?currencyCode=USD&$filter=${FILTER}`;
    for (let page = 0; page < 40 && url; page++) {
      const d = await getJson(url);
      const batch = d?.Items;
      if (!Array.isArray(batch)) drift("the feed returned no Items array");
      items.push(...batch);
      url = d.NextPageLink;
    }

    /** (modelId) → {in, out, cache_read, cache_creation, long: {...}} —
        Global first, then Regional/eastus, then Data Zone/eastus, by the
        same preference the seed's prices were written under. */
    /** Per-field best rank: Global 0, Regional-eastus 1, Data Zone-eastus 2.
        The feed prices deployments per region; Regional/Data Zone read eastus
        (the region the page leads with), legacy meters carry no region and
        read as the service's single price. A row whose fields span
        deployments (gpt-4o-mini's cache is Global, its tokens are Data Zone)
        mixes them — recorded as such in the checklist, because one deployment
        per row would drop half a rate. */
    const rows = new Map();
    const dropped = new Map();
    const drop = (why) => dropped.set(why, (dropped.get(why) ?? 0) + 1);
    const RANK = { global: 0, regional: 1, dz: 2 };

    for (const it of items) {
      if (it.unitOfMeasure !== "1M" && it.unitOfMeasure !== "1K") { drop(`billed by ${it.unitOfMeasure}`); continue; }
      const parsed = readMeter(it.meterName ?? "");
      if (!parsed) { drop("not this entry's pricing (other tier or modality)"); continue; }
      const { spec, field, dep, band } = parsed;
      const v = perMillion(it.unitPrice, it.unitOfMeasure);
      if (v === undefined) { drop("a price that did not parse"); continue; }

      if (spec.embed) {
        // Input-only pricing: the row carries its input rate and an explicit
        // zero output — an embedding has no output tokens to bill.
        const row = rows.get(spec.id) ?? { id: spec.id, _r: {} };
        if (row.in === undefined) row.in = v;
        row.out = "0";
        rows.set(spec.id, row);
        continue;
      }

      const region = (it.armRegionName ?? "").toLowerCase();
      let rank;
      // A meter with no stated deployment (the legacy rows) prices the
      // service, not a region — its region tag is billing geography. The
      // Regional/Data Zone rows read eastus; a Data Zone row with no region
      // tag is the zone's base figure and reads eastus too.
      if (parsed.dep === "global" || parsed.dep === null || region === "global") rank = RANK.global;
      // A deployment-less meter prices the service; its region tag is billing
      // geography, not a deployment. Regional/Data Zone read eastus — and a
      // Data Zone price is the zone's base figure wherever it is listed, so
      // the cheapest listing is the one the page shows.
      else if (parsed.dep === "regional" && (region === "eastus" || region === "")) rank = RANK.regional;
      else if (parsed.dep === "dz") rank = RANK.dz;
      else { drop(`another region's meter (${region || "none"})`); continue; }

      const row = rows.get(spec.id) ?? { id: spec.id, _r: {} };
      const slot = band === "long" ? "long" : field;
      const book = slot === "long" ? row.long_context ?? (row.long_context = { over: 272000, _r: {} }) : row;
      const bookRank = slot === "long" ? "_longR" : "_r";
      if (!(field in book) || rank < (book._r?.[field] ?? Infinity)) {
        book[field] = v;
        (book._r ??= {})[field] = rank;
      } else if (rank === (book._r?.[field] ?? Infinity) && rank === RANK.dz) {
        book[field] = String(Math.min(Number(book[field]), Number(v)));
      }
      rows.set(spec.id, row);
    }

    const out = [...rows.values()].map(({ _r, ...r }) => {
      // long_context carries its own rank book — assembly scaffolding too
      const { _r: _lr, ...lc } = r.long_context ?? {};
      return lc.in !== undefined && lc.out !== undefined ? { ...r, long_context: lc } : r;
    })
      // long_context only means something beside a base rate; the rank books
      // are assembly scaffolding, not data.
      .filter((r) => r.in !== undefined && r.out !== undefined);
    if (out.length === 0) drift("no complete rows parsed from the feed");

    const notes = [...dropped.entries()].map(([why, n]) => `${why}: ${n} row(s)`);
    return { rows: { "azure-openai": out }, notes: { "azure-openai": notes } };
  },
};