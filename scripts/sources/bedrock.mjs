/**
 * Amazon Bedrock's on-demand token prices, from AWS's own Price List Bulk API —
 * the machine-readable form of aws.amazon.com/bedrock/pricing, which itself
 * client-renders from this file. No key; the file is large (~17MB) so the
 * adapter fetches once and filters.
 *
 * The product records carry what the price depends on and the offer carries the
 * figure: attributes.regionCode, .model ("Claude 3 Haiku"), .inferenceType
 * ("Input tokens" / "Output tokens"), .usagetype — whose suffix says which
 * route a price belongs to. The suffix is the mapping, because Bedrock sells
 * the same model at different rates per route and the entry carries one row
 * per (route, model):
 *
 *   USE1-Nova2.0Lite-input-tokens                              region-level on-demand  → us.amazon.nova-2-lite-v1:0
 *   USE1-Nova2.0Lite-input-tokens-cross-region-global          global cross-region     → global.…
 *   EU-Nova…-input-tokens-cross-region-eu                      EU cross-region         → eu.…
 *   …-cross-region-apac / -jp / -au / -ca / -in                the other cross-regions → apac.… / jp.… / au.… / ca.… / in.…
 *
 * The rate suffixes this deliberately skips: -batch and -flex (discounted
 * throughput tiers), -priority (priority processing), -cross-region (bare,
 * without a region name — appears beside the named ones), ProvisionedThroughput
 * (per hour), Customization-Training (training, not inference), and every
 * usage type that is not token-billed at all (Nova Canvas/Reel/Sonic — images
 * and speech; Guardrail, Flows, Data Automation — per request). Cache rides
 * in usagetype too (-cache-read-input-token-count / -cache-write-) and joins
 * the row it belongs to; the flex/priority/batch variants of it are skipped
 * with their tier, keeping one cache rate per row — the standard tier, the
 * one the pricing page leads with.
 *
 * Region code → the entry's id prefix is one table, read off the usagetype
 * itself rather than the regionCode field: what the entry prices is the
 * route (us. / global. / eu. / …), not the source region, and the bare
 * -tokens suffix on a us-east-1 row is the on-demand region rate.
 */
import { drift, MEMBERSHIP, getJson } from "../lib/fetch.mjs";

const API = "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/index.json";

/** usagetype → entry id prefix. The region routes the entry carries; a
    usagetype whose cross-region suffix is not in this table is a new route
    the vendor added, and it is dropped loudly (counted in the notes). */
const ROUTES = {
  "-cross-region-global": "global",
  "-cross-region-eu": "eu",
  "-cross-region-apac": "apac",
  "-cross-region-jp": "jp",
  "-cross-region-au": "au",
  "-cross-region-ca": "ca",
  "-cross-region-in": "in",
  // bare region-level on-demand (us-east-1 rows): the entry spells it "us"
  "": "us",
};

/** us-east-1's own region rows do not say "us" anywhere in the usagetype —
    the -cross-region-* suffixes are named, the bare `-tokens` / `-cache-*`
    suffixes are the region rate. Regions whose code is not us-east-1 price
    their own region rate, and the entry carries none of those (only the
    cross-region routes + the US one) — same rule the seed followed. */
const HOME_REGION = "us-east-1";

/** One inferenceType label → one field. Everything else in inferenceType
    (cache lines have their own usagetype markers; the priority/flex variants
    are dropped by the suffix filter before this map runs). */
const FIELDS = { "Input tokens": "in", "Output tokens": "out" };

/** "Nova 2.0 Lite" and friends are the API's display names; the entry ids are
    the API model ids (amazon.nova-2-lite-v1:0). The offer file does not carry
    ids, so the join runs against the entry's own names — by hand below, one
    line per model, the way the checklist records the provenance. A name the
    table lacks is a new vendor model, and it is dropped loudly. */
const MODEL_IDS = {
  "Claude 2.0": "anthropic.claude-2.0",
  "Claude 2.1": "anthropic.claude-2.1",
  "Claude 3 Haiku": "anthropic.claude-3-haiku-20240307-v1:0",
  "Claude 3 Sonnet": "anthropic.claude-3-sonnet-20240229-v1:0",
  "Claude Instant": "anthropic.claude-instant-v1",
  "DeepSeek V3.1": "deepseek.v3.1",
  "DeepSeek v3.2": "deepseek.v3.2",
  Devstral: "mistral.devstral-2512",
  "GLM 4.7": "zai.glm-4.7",
  "GLM 4.7 Flash": "zai.glm-4.7-flash",
  "GLM 5": "zai.glm-5",
  "GPT OSS Safeguard 120B": "openai.gpt-oss-safeguard-120b",
  "GPT OSS Safeguard 20B": "openai.gpt-oss-safeguard-20b",
  "Kimi K2 Thinking": "moonshot.kimi-k2-thinking",
  "Kimi K2.5": "moonshot.kimi-k2.5",
  "Kimi K3": "moonshotai.kimi-k3",
  "Llama 3 70B": "meta.llama3-70b-instruct-v1:0",
  "Llama 3 8B": "meta.llama3-8b-instruct-v1:0",
  "Llama 3.1 405B": "meta.llama3-1-405b-instruct-v1:0",
  "Llama 3.1 70B": "meta.llama3-1-70b-instruct-v1:0",
  "Llama 3.1 8B": "meta.llama3-1-8b-instruct-v1:0",
  "Llama 3.2 11B": "meta.llama3-2-11b-instruct-v1:0",
  "Llama 3.2 1B": "meta.llama3-2-1b-instruct-v1:0",
  "Llama 3.2 3B": "meta.llama3-2-3b-instruct-v1:0",
  "Llama 3.2 90B": "meta.llama3-2-90b-instruct-v1:0",
  "Llama 3.3 70B": "meta.llama3-3-70b-instruct-v1:0",
  "Llama 4 Maverick 17B": "meta.llama4-maverick-17b-instruct-v1:0",
  "Llama 4 Scout 17B": "meta.llama4-scout-17b-instruct-v1:0",
  "Magistral Small 1.2": "mistral.magistral-small-1.2",
  "MiniMax M2.5": "minimax.minimax-m2.5",
  "Minimax M2": "minimax.minimax-m2",
  "Minimax M2.1": "minimax.minimax-m2.1",
  "Ministral 14B 3.0": "mistral.ministral-14b-3.0",
  "Ministral 8B 3.0": "mistral.ministral-8b-3.0",
  "Mistral 7B": "mistral.mistral-7b-instruct-v0.3",
  "Mistral Large 2407": "mistral.mistral-large-2407-v1:0",
  "Mistral Large 3": "mistral.mistral-large-3",
  "Mistral Small": "mistral.mistral-small-3.1",
  "Mixtral 8x7B": "mistral.mixtral-8x7b-instruct-v0:1",
  "NVIDIA Nemotron 3 Super 120B A12B": "nvidia.nemotron-3-super-120b-a12b",
  "NVIDIA Nemotron Nano 2": "nvidia.nemotron-nano-2",
  "NVIDIA Nemotron Nano 2 VL": "nvidia.nemotron-nano-2-vl",
  "Nemotron Nano 3 30B": "nvidia.nemotron-nano-3-30b",
  "Nova 2.0 Lite": "amazon.nova-2-lite-v1:0",
  "Nova 2.0 Pro": "amazon.nova-2-pro-v1:0",
  "Nova Lite": "amazon.nova-lite-v1:0",
  "Nova Micro": "amazon.nova-micro-v1:0",
  "Nova Premier": "amazon.nova-premier-v1:0",
  "Nova Pro": "amazon.nova-pro-v1:0",
  "Pixtral Large 25.02": "mistral.pixtral-large-2502",
  "Qwen3 235B A22B 2507": "qwen.qwen3-235b-a22b-2507",
  "Qwen3 32B": "qwen.qwen3-32b",
  "Qwen3 Coder 30B A3B": "qwen.qwen3-coder-30b-a3b",
  "Qwen3 Coder 480B A35B": "qwen.qwen3-coder-480b-a35b",
  "Qwen3 Coder Next": "qwen.qwen3-coder-next",
  "Qwen3 Next 80B A3B": "qwen.qwen3-next-80b-a3b",
  "Qwen3 VL 235B A22B": "qwen.qwen3-vl-235b-a22b",
  R1: "deepseek.r1-v1:0",
  "gpt-oss-120b": "openai.gpt-oss-120b",
  "gpt-oss-20b": "openai.gpt-oss-20b",
  "openai.gpt-5.4": "openai.gpt-5.4",
  "openai.gpt-5.6-luna": "openai.gpt-5.6-luna",
  "openai.gpt-5.6-terra": "openai.gpt-5.6-terra",
  "qwen3-next-80b-a3b": "qwen.qwen3-next-80b-a3b",
  "xai.grok-4.3": "xai.grok-4.3",
  "xai.grok-4.6": "xai.grok-4.6",
};

/** Per 1K tokens is the offer's usual unit; per 1M appears on some rows. Both
    normalize to the catalogue's per-million, in string space, the way every
    price here lands. */
const perMillion = (v, unit) => {
  const f = Number(v);
  if (!Number.isFinite(f)) drift(`"${v}" is not a number`);
  const n = unit === "1K tokens" ? f * 1000 : unit === "1M tokens" ? f : drift(`unknown unit "${unit}"`);
  return String(Math.round(n * 100_000) / 100_000).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

export default {
  ids: ["bedrock"],
  source: API,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "cache_creation"],

  async read() {
    const body = await getJson(API);
    const products = body?.products;
    const terms = body?.terms?.OnDemand;
    if (!products || !terms) drift("the offer file's shape has changed — products/terms missing");

    /** (route, modelId) → {in, out, cache_read, cache_creation}. Cache lines
        carry their own sku; the first standard-tier rate seen wins and later
        ones (batch/flex/priority repeats of the same key) are ignored. */
    const rows = new Map();
    const dropped = new Map();
    const drop = (why, label) => dropped.set(why, (dropped.get(why) ?? 0) + 1);

    for (const p of Object.values(products)) {
      const a = p?.attributes ?? {};
      if (p.productFamily !== "Amazon Bedrock") continue;
      const ut = a.usagetype ?? "";

      // Route: the cross-region suffix, or the bare region rate for us-east-1.
      let route = null;
      let cacheKind = null;
      for (const [suffix, r] of Object.entries(ROUTES)) {
        if (suffix && ut.includes(suffix)) { route = r; break; }
      }
      if (route === null) {
        // No cross-region suffix. The bare us-east-1 rows are the region rate;
        // everything else prices a region the entry does not carry.
        if (a.regionCode === HOME_REGION && !ut.includes("cross-region")) route = "us";
      }
      if (route === null) { drop("another region's rate", ut); continue; }

      // Tier: only the standard tier. The suffix tables repeat per tier.
      const isCache = ut.includes("cache-read-input-token-count") || ut.includes("cache-write-input-token-count");
      const tiered = /-batch|-flex|-priority|cross-region$/.test(ut);
      if (tiered && !(isCache && ut.includes("-cross-region-") && ROUTES[ut.slice(ut.lastIndexOf("-cross-region"))])) {
        // batch/flex/priority tiers are skipped wholesale; the cache lines of
        // the named cross-region routes are not tiered, they are the route's
        // cache rate (the bare "-cross-region" cache rows belong to the
        // unnamed route and drop with it).
        if (!ut.includes("-cross-region-") || !/global|eu|apac|jp|au|ca|in/.test(ut)) {
          drop("a discounted tier (batch/flex/priority)", ut);
          continue;
        }
      }
      if (/ProvisionedThroughput|Customization|Guardrail|Flow|Automation|Optimize/.test(ut)) {
        drop("not per-token inference (provisioned/training/other)", ut);
        continue;
      }

      // Field: the token pair from inferenceType, cache from the usagetype.
      let field = null;
      if (isCache) field = ut.includes("cache-read") ? "cache_read" : "cache_creation";
      else field = FIELDS[a.inferenceType] ?? null;
      if (!field) { drop("not token-billed (images/audio/other units)", ut); continue; }

      const modelId = MODEL_IDS[a.model ?? ""];
      if (!modelId) { drop(`a model the id table lacks (${a.model ?? "?"})`, ut); continue; }

      const offer = terms[p.sku];
      if (!offer) { drop("a sku with no published offer", ut); continue; }
      let usd = null;
      let unit = null;
      for (const ov of Object.values(offer)) {
        for (const dim of Object.values(ov.priceDimensions ?? {})) {
          usd = dim.pricePerUnit?.USD;
          unit = dim.unit;
          break;
        }
        if (usd !== null && usd !== undefined) break;
      }
      if (usd == null || !unit) { drop("an offer with no price dimension", ut); continue; }

      const key = `${route}.${modelId}`;
      const row = rows.get(key) ?? { id: key };
      // The first standard-tier figure wins per field; a later duplicate is a
      // different inferenceType spelling of the same route and stays out.
      if (row[field] === undefined) row[field] = perMillion(usd, unit);
      rows.set(key, row);
    }

    const out = [...rows.values()].filter((r) => r.in !== undefined && r.out !== undefined);
    const half = [...rows.values()].filter((r) => r.in === undefined || r.out === undefined);
    if (out.length === 0) drift("no complete token-billed rows in the offer file");

    const notes = [...dropped.entries()].map(([why, n]) => `${why}: ${n} row(s)`);
    if (half.length) notes.push(`rows with one rate only (input without output): ${half.length}, e.g. ${half.slice(0, 3).map((r) => r.id).join(", ")}`);
    return { rows: { bedrock: out }, notes: { bedrock: notes } };
  },
};
