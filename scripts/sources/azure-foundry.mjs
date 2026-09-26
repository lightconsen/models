/**
 * Azure AI Foundry's hosted partner models (MAAS — Models as a Service), from
 * the same Retail Prices API the `azure-openai` adapter reads — but the
 * partner product families, not the OpenAI ones: `Azure Kimi`, `Azure Grok`,
 * `Azure Llama`, `Azure Mistral`, `Azure Phi`, `Cohere Models`. Microsoft
 * prices its partners under its own retail feed; the meter grammar is the
 * same four eras of spelling the azure-openai adapter documents.
 *
 * What the feed does not price: Claude and DeepSeek. Both are genuinely
 * served on Foundry, but their meters appear nowhere in the retail feed
 * (`contains(meterName,'Claude')` is empty across every product) — MAAS
 * pricing for those lives in the Foundry portal, not the public feed. So the
 * seed's claude and deepseek rows have no vendor backing here and FOLLOW
 * drops them; the checklist records where their prices actually state
 * themselves (Anthropic's and DeepSeek's own entries price the models
 * directly — Azure's markup is the part published nowhere).
 *
 * Deployment/tier reading is the azure-openai adapter's: Global where stated,
 * Regional-eastus where Global is not, Data Zone when that is all there is.
 * Embeddings/rerankers (input-only or per-search) are skipped — half a rate
 * is not a rate — and the FT (fine-tuned) variants ride their own meters,
 * skipped with their class.
 */
import { drift, getJson, MEMBERSHIP } from "../lib/fetch.mjs";

const API = "https://prices.azure.com/api/retail/prices";
/** The partner families. Each is a separate productName prefix; the filter is
    one OR-chain per family so the fetch pages are bounded. */
const FAMILIES = ["Azure Kimi", "Azure Grok", "Azure Llama", "Azure Mistral", "Azure Phi", "Cohere Models"];
const FILTER = FAMILIES.map((f) => `startswith(productName,%27${f.replace(/ /g, "%20")}%27)`).join("%20or%20");

/** Meter model prefix → entry id. The ids are the vendor's own deployment
    names (verified against Microsoft's Foundry model list), minus the
    deployment spellings. */
const MODELS = {
  // Azure Kimi
  "K2 Thinking": { id: "kimi-k2-thinking" },
  "K2.5 Thinking": { id: "kimi-k2.5" },
  "K2.6 Thinking": { id: "kimi-k2.6" },
  "K2.7 Code": { id: "kimi-k2.7-code" },
  // Azure Grok
  "Grok 4.1": { id: "grok-4-1-fast-reasoning" },
  "4.3": { id: "grok-4-3" },
  "4.6": { id: "grok-4-6" },
  "Code Fast 1": { id: "grok-code-fast-1" },
  // Azure Llama
  "Llama 4 Maverick 17B": { id: "llama-4-maverick-17b-128e-instruct-fp8" },
  "Llama 4 Scout 17B": { id: "llama-4-scout-17b-16e-instruct" },
  "Llama 3.3 70B": { id: "llama-3.3-70b-instruct" },
  "3.3 70b": { id: "llama-3.3-70b-instruct" },
  // Azure Mistral
  Codestral: { id: "codestral-2501" },
  "Large 3": { id: "mistral-large-3" },
    "MM3.5": { id: "mistral-medium-3.5" },
  "Mistral Medium 3.5": { id: "mistral-medium-3.5" },
  "Mnstrl 3b": { id: "ministral-3b" },
  "Ministral 3B": { id: "ministral-3b" },
  // Azure Phi — the -Input/-Output suffix runs hyphenated INTO the model
  // name ('Phi-4-Input Tokens'); the FT variants drop to SKIP_CLASS.
  "Phi-4-Input": { id: "phi-4" },
  "Phi-4-Output": { id: "phi-4" },
  "Phi-4-Mini-Input": { id: "phi-4-mini" },
  "Phi-4-Mini-Output": { id: "phi-4-mini" },
  "Phi-4-mini-reasoning-Input": { id: "phi-4-mini-reasoning" },
  "Phi-4-mini-reasoning-Output": { id: "phi-4-mini-reasoning" },
  "Phi-4-reasoning-Input": { id: "phi-4-reasoning" },
  "Phi-4-reasoning-Output": { id: "phi-4-reasoning" },
  "Phi-4-reasoning-plus-Input": { id: "phi-4-reasoning-plus" },
  "Phi-4-reasoning-plus-Output": { id: "phi-4-reasoning-plus" },
  "Phi-4-Multimodal-Input": { id: "phi-4-multimodal" },
  "Phi-4-Multimodal-Output": { id: "phi-4-multimodal" },
  // Cohere Models
  "Command A Plus": { id: "cohere-command-a-plus" },
  "Command A": { id: "cohere-command-a" },
};

const SKIP_CLASS =
  /\b(batch|pp|flex|ft|rft|hosting|training|provisioned|grader|realtime|aud\b|image|img\b|media|speech|tts|embed|rerank|parser|pages|search|ocr|doc ai|mm\b|mm-|vision|multimodal)\b/i;

const CONTINUES = /^(inp|inpt|input|out|outp|outpt|opt|output|cd|cchd|cached|global|gl|glbl|dz|dzone|datazone|regional|regnl|rgnl|rg|std|shortco|shco|loco|longco|batch|flex|pp|priority|tokens|\d{6,8})$/;
const PREFIXES = Object.keys(MODELS).sort((a, b) => b.length - a.length);

const perMillion = (v, uom) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  const scaled = uom === "1M" ? n : uom === "1K" ? n * 1000 : undefined;
  if (scaled === undefined) return undefined;
  return String(Math.round(scaled * 100_000) / 100_000).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

const readMeter = (m) => {
  const low = " " + m.toLowerCase() + " ";
  if (SKIP_CLASS.test(low)) return null;
  const prefix = PREFIXES.find((p) => {
    const at = low.indexOf(" " + p.toLowerCase().trim() + " ");
    if (at < 0) return false;
    const next = low.slice(at + p.trim().length + 1).trimStart().split(" ")[0];
    return CONTINUES.test(next);
  });
  if (!prefix) return null;
  const spec = MODELS[prefix];
  let field = null;
  if (/cd wr/.test(low)) field = "cache_creation";
  else if (/\b(cd|cchd|cached)\b/.test(low)) field = "cache_read";
  else if (/\b(inp|inpt|input)\b/.test(low)) field = "in";
  else if (/\b(out|outp|outpt|opt|output)\b/.test(low)) field = "out";
  if (!field) return null;
  const dep = /\b(global|glbl|gl)\b/.test(low) ? "global" : /\b(dz|dzone|datazone)\b/.test(low) ? "dz" : /\b(regnl|regional|rg)\b/.test(low) ? "regional" : null;
  const band = /\b(shco|shortco)\b/.test(low) ? "short" : /\b(loco|longco)\b/.test(low) ? "long" : null;
  return { spec, field, dep, band };
};

export default {
  ids: ["azure-foundry"],
  source: API,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "cache_creation"],

  async read() {
    const items = [];
    let url = `${API}?currencyCode=USD&$filter=${FILTER}`;
    for (let page = 0; page < 20 && url; page++) {
      const d = await getJson(url);
      const batch = d?.Items;
      if (!Array.isArray(batch)) drift("the feed returned no Items array");
      items.push(...batch);
      url = d.NextPageLink;
    }

    /** Per-field best rank — Global 0, Regional-eastus 1, Data Zone 2 (the
        cheapest DZ listing; the price varies by region and the page leads
        with the base). Deployment-less meters price the service. */
    const rows = new Map();
    const dropped = new Map();
    const drop = (why) => dropped.set(why, (dropped.get(why) ?? 0) + 1);
    const RANK = { global: 0, regional: 1, dz: 2 };

    for (const it of items) {
      if (it.unitOfMeasure !== "1M" && it.unitOfMeasure !== "1K") { drop(`billed by ${it.unitOfMeasure}`); continue; }
      const parsed = readMeter(it.meterName ?? "");
      if (!parsed) { drop("not this entry's pricing (other tier, modality or family)"); continue; }
      const { spec, field, dep, band } = parsed;
      const v = perMillion(it.unitPrice, it.unitOfMeasure);
      if (v === undefined) { drop("a price that did not parse"); continue; }

      const region = (it.armRegionName ?? "").toLowerCase();
      let rank;
      if (parsed.dep === "global" || parsed.dep === null || region === "global") rank = RANK.global;
      else if (parsed.dep === "regional" && (region === "eastus" || region === "")) rank = RANK.regional;
      else if (parsed.dep === "dz") rank = RANK.dz;
      else { drop(`another region's meter (${region || "none"})`); continue; }

      const row = rows.get(spec.id) ?? { id: spec.id, _r: {} };
      if (!(field in row) || rank < (row._r?.[field] ?? Infinity)) {
        row[field] = v;
        row._r[field] = rank;
      } else if (rank === row._r?.[field] && rank === RANK.dz) {
        row[field] = String(Math.min(Number(row[field]), Number(v)));
      }
      rows.set(spec.id, row);
    }

    const out = [...rows.values()].map(({ _r, ...r }) => r)
      .filter((r) => r.in !== undefined && r.out !== undefined);
    if (out.length === 0) drift("no complete rows parsed from the feed");

    const notes = [...dropped.entries()].map(([why, n]) => `${why}: ${n} row(s)`);
    return { rows: { "azure-foundry": out }, notes: { "azure-foundry": notes } };
  },
};