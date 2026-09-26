/**
 * Amazon Bedrock's on-demand token prices, from two sources the vendor
 * publishes:
 *
 * 1. The Price List Bulk API (`pricing.us-east-1.amazonaws.com/offers/v1.0/aws/
 *    AmazonBedrock/current/index.json`, ~17MB, no key) — every product's
 *    attributes (region, model, inference type, usage type) joined to its
 *    offer's price dimensions. This covers the models the catalogue prices
 *    through inference profiles and the older generations.
 * 2. The pricing page's own metered-unit map (`calculator.aws/pricing/2.0/
 *    meteredUnitMaps/bedrockfoundationmodels/USD/current/
 *    bedrockfoundationmodels.json`, no key) — the JSON the page's
 *    `{priceOf!…}` placeholders resolve against, keyed by an opaque hash per
 *    (model, field, region). The NEW Claude generation (Opus 5.5, Fable 5.1,
 *    Sonnet 5…) prices here and nowhere in the bulk feed, so the adapter
 *    fetches both: the bulk feed for what it covers, the page's markup (the
 *    `data-pricing-markup` tables carry model name → hash → column role) for
 *    what only the map has.
 *
 * Route semantics (why the entry carries `us.`/`eu.`/`global.` prefixes): a
 * Bedrock inference profile routes a request through a region group, and the
 * price is the SAME figure the source region charges — the profile is a
 * routing choice, not a separate SKU. The bulk feed prices the source region;
 * the seed's per-route rows repeat one figure under several prefixes. This
 * adapter therefore prices each model ONCE at its source region and lets the
 * entry decide the route rows — the join the seed carried by hand.
 */
import { drift, getJson, getText, MEMBERSHIP } from "../lib/fetch.mjs";

const OFFER = "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/index.json";
const PAGE = "https://aws.amazon.com/bedrock/pricing/";
const MAP = "https://calculator.aws/pricing/2.0/meteredUnitMaps/bedrockfoundationmodels/USD/current/bedrockfoundationmodels.json";

/** Bulk-feed meter prefix → entry id (the feed spells display names; the
    entry spells API ids). A name the table lacks drops loudly. */
const FEED_IDS = {
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
  "R1": "deepseek.r1-v1:0",
  "gpt-oss-120b": "openai.gpt-oss-120b",
  "gpt-oss-20b": "openai.gpt-oss-20b",
  "openai.gpt-5.4": "openai.gpt-5.4",
  "openai.gpt-5.6-luna": "openai.gpt-5.6-luna",
  "openai.gpt-5.6-terra": "openai.gpt-5.6-terra",
  "qwen3-next-80b-a3b": "qwen.qwen3-next-80b-a3b",
  "xai.grok-4.3": "xai.grok-4.3",
  "xai.grok-4.6": "xai.grok-4.6",
};

/** The calculator map's model rows (page markup) → entry ids, for the new
    Claude generation the bulk feed does not carry. The markup table spells
    the field order per row: Input, Output, [Batch×2], 5m Cache Write, 1h
    Cache Write, [cache read] — with N/A where a tier does not exist. */
const PAGE_IDS = {
  "Claude Opus 5.5": "anthropic.claude-opus-5-5",
  "Claude Fable 5.1": "anthropic.claude-fable-5-1",
  "Claude Fable 5": "anthropic.claude-fable-5",
  "Claude Sonnet 5": "anthropic.claude-sonnet-5",
  "Claude Sonnet 4.6": "anthropic.claude-sonnet-4-6",
  "Claude Sonnet 4.5": "anthropic.claude-sonnet-4-5",
  "Claude Opus 4.8": "anthropic.claude-opus-4-8",
  "Claude Opus 4.7": "anthropic.claude-opus-4-7",
  "Claude Opus 4.6": "anthropic.claude-opus-4-6",
  "Claude Opus 4.5": "anthropic.claude-opus-4-5",
  "Claude Haiku 4.5": "anthropic.claude-haiku-4-5",
};

/** per 1K tokens is the offer's usual unit; per 1M appears on some rows. */
const perMillion = (v, unit) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  const scaled = unit === "1K tokens" ? n * 1000 : unit === "1M tokens" ? n : undefined;
  if (scaled === undefined) return undefined;
  return String(Math.round(scaled * 100_000) / 100_000).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

export default {
  ids: ["bedrock"],
  source: `${OFFER} + ${MAP}`,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "cache_creation"],

  async read() {
    const rows = new Map();
    const dropped = new Map();
    const drop = (why) => dropped.set(why, (dropped.get(why) ?? 0) + 1);

    // ── source 1: the bulk feed, us-east-1 on-demand standard tier ──
    const offer = await getJson(OFFER);
    const products = offer?.products;
    const terms = offer?.terms?.OnDemand;
    if (!products || !terms) drift("the offer file's shape has changed — products/terms missing");

    for (const p of Object.values(products)) {
      const a = p?.attributes ?? {};
      if (p.productFamily !== "Amazon Bedrock") continue;
      const ut = a.usagetype ?? "";
      if (a.regionCode !== "us-east-1") { drop("another region's rate"); continue; }
      if (/batch|cross-region|flex|priority/i.test(ut)) { drop("a discounted or routed tier"); continue; }
      const field = a.inferenceType === "Input tokens" ? "in" : a.inferenceType === "Output tokens" ? "out" : null;
      if (!field) { drop("not a token rate (cache/provisioned/training)"); continue; }
      const modelId = FEED_IDS[a.model ?? ""];
      if (!modelId) { drop(`a model the id table lacks (${a.model ?? "?"})`); continue; }
      const off = terms[p.sku];
      if (!off) { drop("a sku with no published offer"); continue; }
      let usd, unit;
      for (const ov of Object.values(off)) {
        for (const dim of Object.values(ov.priceDimensions ?? {})) {
          usd = dim.pricePerUnit?.USD;
          unit = dim.unit;
          break;
        }
        if (usd != null) break;
      }
      if (usd == null || !unit) { drop("an offer with no price dimension"); continue; }
      const v = perMillion(usd, unit);
      if (v === undefined) { drop("a price that did not parse"); continue; }
      const row = rows.get(modelId) ?? { id: modelId, _r: {} };
      if (row[field] === undefined || row._r[field] > 1) {
        // rank 1 = the standard tier; cache rows (usagetype -cache-*) join as
        // cache_read/cache_creation on the same model row.
        if (/cache-read/.test(ut)) { if (row.cache_read === undefined) { row.cache_read = v; row._r.cache_read = 1; } }
        else if (/cache-write/.test(ut)) { if (row.cache_creation === undefined) { row.cache_creation = v; row._r.cache_creation = 1; } }
        else { row[field] = v; row._r[field] = 1; }
      }
      rows.set(modelId, row);
    }

    // ── source 2: the page markup + the metered map, for the new Claude rows ──
    const page = await getText(PAGE, { headers: { accept: "text/html" } });
    const map = await getJson(MAP);
    const regionRows = map?.regions?.["US East (N. Virginia)"];
    if (!regionRows) drift("the metered map has no US East (N. Virginia) region");

    // The page's pricing-markup tables: one row per model, cells carrying
    // {priceOf!service!hash} placeholders in column order.
    for (const mk of page.matchAll(/data-pricing-markup="([^"]+)"/g)) {
      const table = mk[1].replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
      // the column roles come from the header row
      const head = table.match(/<thead>([\s\S]*?)<\/thead>/);
      if (!head) continue;
      const cols = [...head[1].matchAll(/<th>(?:<strong>)?([^<]{0,70})/g)].map((c) => c[1].trim());
      for (const tr of table.matchAll(/<tr><td>([^<]+)<\/td>([\s\S]*?)<\/tr>/g)) {
        const name = tr[1].trim();
        const id = PAGE_IDS[name];
        if (!id) { if (/\bClaude\b/.test(name)) drop(`a Claude model the page map lacks (${name})`); continue; }
        const cells = [...tr[2].matchAll(/\{priceOf![^}]*\}|N\/A/g)].map((c) => {
      // "{priceOf!service!HASH!opt}" — the hash is the third '!'-separated
      // part; the trailing "!opt" marks an optional column, not part of it.
      if (c[0] === "N/A") return c[0];
      const hash = c[0].split("!")[2] ?? null;
      return hash ? hash.replace(/\}\s*$/, "") : null;
    });
        const row = rows.get(id) ?? { id, _r: {} };
        cells.forEach((c, i) => {
          if (c === "N/A" || c === null) return;
          const role = cols[i + 1] ?? "";
          const rec = regionRows[c];
          if (!rec) return;
          const v = String(Math.round(Number(rec.price) * 100) / 100);
          if (/^Price per 1M input tokens$/.test(role)) { if (row.in === undefined) { row.in = v; row._r.in = 0; } }
          else if (/^Price per 1M output tokens$/.test(role)) { if (row.out === undefined) { row.out = v; row._r.out = 0; } }
          else if (/5m Cache Write/.test(role)) { if (row.cache_creation === undefined) { row.cache_creation = v; row._r.cache_creation = 0; } }
          else if (/cache read/i.test(role)) { if (row.cache_read === undefined) { row.cache_read = v; row._r.cache_read = 0; } }
        });
        rows.set(id, row);
      }
    }

    const out = [...rows.values()].map(({ _r, ...r }) => r)
      .filter((r) => r.in !== undefined && r.out !== undefined);
    if (out.length === 0) drift("no complete rows from either source");

    const notes = [...dropped.entries()].map(([why, n]) => `${why}: ${n} row(s)`);
    return { rows: { bedrock: out }, notes: { bedrock: notes } };
  },
};