#!/usr/bin/env node
/**
 * Seed Tier C entries from models.dev's published database (api.json).
 *
 * The breadth half of the roadmap: an entry whose prices come from a third
 * party today, marked `seeded: true` in provider.json, is upgraded to Tier A/B
 * — its own adapter, or a hand read of the vendor's pages — the day someone
 * reads the vendor. The marker travels to the catalog, so the site can badge
 * the entry as unverified; it goes away the day the entry graduates.
 *
 * What a seeded entry carries:
 *   - every model models.dev prices, filtered to text-in/text-out (the
 *     catalogue prices tokens; per-image and per-second pricing has no field)
 *   - `in` / `out` / `cache_read` / `cache_creation` from its `cost`, which is
 *     per million USD — vendor-checked against Groq and Anthropic figures
 *   - `context` / `max_output` from its `limit`
 *   - reasoning / tool_call / temperature as **true only** — models.dev's
 *     explicit false is a third party's no, and this catalogue writes a false
 *     only when the vendor itself negates (absent means "not stated")
 *   - a placeholder logo.svg (a neutral monogram) — the real logo is part of
 *     the upgrade, and generate.mjs requires the file to exist
 *   - rating 3.5, the unverified rung below every verified entry
 *   - endpoints only where a single public API base exists; entries whose API
 *     is resource-pinned (Azure, Bedrock, Databricks) ship with none, which
 *     `seeded: true` permits and a guessed URL never would
 *
 * Run:
 *   node scripts/seed-modelsdev.mjs                 show what would be written
 *   node scripts/seed-modelsdev.mjs --write         write the entries
 *   node scripts/seed-modelsdev.mjs --only groq,mistral   restrict to these
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "https://models.dev/api.json";
const WRITE = process.argv.includes("--write");
const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const ONLY = argOf("--only")?.split(",").map((s) => s.trim()) ?? null;

const stop = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

/** The batch. `src` is models.dev's id; `endpoints` is [] when the API base is
    resource-pinned and has no single public form to name. */
const PROVIDERS = [
  { id: "groq", src: "groq", name: "Groq", website: "https://groq.com/", desc: "Groq's LPU inference cloud", endpoints: [{ protocol: "openai", endpoint: "https://api.groq.com/openai/v1" }] },
  { id: "fireworks", src: "fireworks-ai", name: "Fireworks AI", website: "https://fireworks.ai/", desc: "Fireworks AI's hosted inference platform", endpoints: [{ protocol: "openai", endpoint: "https://api.fireworks.ai/inference/v1" }] },
  { id: "deepinfra", src: "deepinfra", name: "DeepInfra", website: "https://deepinfra.com/", desc: "DeepInfra's hosted open-model inference", endpoints: [{ protocol: "openai", endpoint: "https://api.deepinfra.com/v1/openai" }] },
  { id: "novita", src: "novita-ai", name: "Novita AI", website: "https://novita.ai/", desc: "Novita AI's hosted model inference", endpoints: [{ protocol: "openai", endpoint: "https://api.novita.ai/v3/openai" }] },
  { id: "nebius", src: "nebius", name: "Nebius", website: "https://nebius.com/", desc: "Nebius's AI inference service", endpoints: [{ protocol: "openai", endpoint: "https://studio.nebius.com/v1" }] },
  { id: "baseten", src: "baseten", name: "Baseten", website: "https://www.baseten.co/", desc: "Baseten's model inference platform", endpoints: [{ protocol: "openai", endpoint: "https://inference.baseten.co/v1" }] },
  { id: "friendli", src: "friendli", name: "FriendliAI", website: "https://friendli.ai/", desc: "FriendliAI's serving platform", endpoints: [{ protocol: "openai", endpoint: "https://inference.friendli.ai/v1" }] },
  { id: "upstage", src: "upstage", name: "Upstage", website: "https://www.upstage.ai/", desc: "Upstage's Solar API", endpoints: [{ protocol: "openai", endpoint: "https://api.upstage.ai/v1/solar" }] },
  { id: "mistral", src: "mistral", name: "Mistral AI", website: "https://mistral.ai/", desc: "Mistral AI's own API", endpoints: [{ protocol: "openai", endpoint: "https://api.mistral.ai/v1" }] },
  { id: "cohere", src: "cohere", name: "Cohere", website: "https://cohere.com/", desc: "Cohere's own API", endpoints: [{ protocol: "openai", endpoint: "https://api.cohere.com/compatibility/v1" }] },
  { id: "ai21", src: "ai21", name: "AI21", website: "https://www.ai21.com/", desc: "AI21's own API", endpoints: [{ protocol: "openai", endpoint: "https://api.ai21.com/v1" }] },
  { id: "bedrock", src: "amazon-bedrock", name: "Amazon Bedrock", website: "https://aws.amazon.com/bedrock/", desc: "AWS's managed model hosting", endpoints: [] },
  { id: "azure-openai", src: "azure", name: "Azure OpenAI", website: "https://azure.microsoft.com/products/ai-services/openai-service", desc: "Azure's hosted OpenAI models", endpoints: [] },
  { id: "vertex", src: "google-vertex", name: "Google Vertex AI", website: "https://cloud.google.com/vertex-ai", desc: "Google Cloud's model garden on Vertex AI", endpoints: [{ protocol: "gemini", endpoint: "https://aiplatform.googleapis.com/v1" }] },
  { id: "databricks", src: "databricks", name: "Databricks", website: "https://www.databricks.com/", desc: "Databricks's model serving", endpoints: [] },
  { id: "huggingface", src: "huggingface", name: "Hugging Face", website: "https://huggingface.co/", desc: "Hugging Face's Inference Providers", endpoints: [{ protocol: "openai", endpoint: "https://router.huggingface.co/v1" }] },
  { id: "cloudflare-workers-ai", src: "cloudflare-workers-ai", name: "Cloudflare Workers AI", website: "https://developers.cloudflare.com/workers-ai/", desc: "Cloudflare's Workers AI", endpoints: [] },
  { id: "digitalocean", src: "digitalocean", name: "DigitalOcean", website: "https://www.digitalocean.com/", desc: "DigitalOcean's Gradient AI platform", endpoints: [{ protocol: "openai", endpoint: "https://inference.do-ai.run/v1" }] },
  { id: "oci", src: "oci", name: "Oracle OCI", website: "https://www.oracle.com/cloud/ai/", desc: "Oracle Cloud's Generative AI service", endpoints: [] },
  { id: "watsonx", src: "watsonx", name: "IBM watsonx", website: "https://www.ibm.com/products/watsonx-ai", desc: "IBM's watsonx.ai", endpoints: [] },
  { id: "ovhcloud", src: "ovhcloud", name: "OVHcloud", website: "https://www.ovhcloud.com/en/public-cloud/ai-endpoints/", desc: "OVHcloud's AI Endpoints", endpoints: [{ protocol: "openai", endpoint: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1" }] },
  { id: "sap-ai-core", src: "sap-ai-core", name: "SAP AI Core", website: "https://help.sap.com/docs/sap-ai-core", desc: "SAP's AI Core service", endpoints: [] },
  { id: "siliconflow", src: "siliconflow", name: "SiliconFlow", website: "https://siliconflow.com/", desc: "SiliconFlow's inference platform (international)", endpoints: [{ protocol: "openai", endpoint: "https://api.siliconflow.com/v1" }] },
  { id: "siliconflow-cn", src: "siliconflow-cn", name: "SiliconFlow (China)", website: "https://siliconflow.cn/", desc: "SiliconFlow's inference platform (China)", endpoints: [{ protocol: "openai", endpoint: "https://api.siliconflow.cn/v1" }] },
];

const res = await fetch(SOURCE, { headers: { "user-agent": "Mozilla/5.0 (compatible; kiwano-seed)" } });
if (!res.ok) stop(`${SOURCE}: HTTP ${res.status}`);
const db = await res.json();

/** models.dev's money is per million USD. String() keeps the shortest exact
    decimal — "0.59", "5", "0.0002" — the shape every price field uses. */
const money = (n) => String(n);

/** A placeholder monogram: neutral until the upgrade brings the real logo. */
const placeholderLogo = (id) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#6b7280"/><text x="32" y="43" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#ffffff" text-anchor="middle">${id[0].toUpperCase()}</text></svg>\n`;

const wanted = ONLY ? PROVIDERS.filter((p) => ONLY.includes(p.id)) : PROVIDERS;
const missing = ONLY ? ONLY.filter((id) => !wanted.some((p) => p.id === id)) : [];
if (missing.length) stop(`unknown --only id(s): ${missing.join(", ")}`);

let totalModels = 0;
for (const p of wanted) {
  const src = db[p.src];
  if (!src) stop(`models.dev has no provider "${p.src}" — check the id`);
  const priced = [];
  let skippedUnpriced = 0;
  let skippedNonText = 0;
  for (const m of Object.values(src.models ?? {})) {
    const cost = m.cost ?? {};
    const inC = cost.input ?? 0;
    const outC = cost.output ?? 0;
    if (!(inC > 0 || outC > 0)) { skippedUnpriced++; continue; }
    const mods = m.modalities ?? {};
    if (!(mods.output ?? []).includes("text")) { skippedNonText++; continue; }
    const row = { id: m.id, name: m.name || m.id };
    if (inC !== undefined && cost.input !== undefined) row.in = money(inC);
    if (cost.output !== undefined) row.out = money(outC);
    if (cost.cache_read !== undefined) row.cache_read = money(cost.cache_read);
    if (cost.cache_write !== undefined) row.cache_creation = money(cost.cache_write);
    const limit = m.limit ?? {};
    if (limit.context > 0) row.context = limit.context;
    if (limit.output > 0) row.max_output = limit.output;
    // Third-party noes are omitted, never written: a `false` here would claim a
    // negation models.dev cannot make. True travels; verification upgrades the rest.
    if (m.reasoning === true) row.reasoning = true;
    if (m.tool_call === true) row.tool_call = true;
    if (m.temperature === true) row.temperature = true;
    priced.push(row);
  }
  priced.sort((a, b) => a.id.localeCompare(b.id));
  totalModels += priced.length;

  // Flagship by the documented first-pass rule — highest output price, ties by
  // input then id — so the entry's list card and detail header have a price_ref
  // the day it is seeded. Worth a human look at upgrade time, like everywhere else.
  const flagship = priced.reduce((best, r) => {
    const k = [Number(r.out ?? 0), Number(r.in ?? 0), r.id];
    const b = [Number(best.out ?? 0), Number(best.in ?? 0), best.id];
    return k[0] > b[0] || (k[0] === b[0] && (k[1] > b[1] || (k[1] === b[1] && k[2] < b[2]))) ? r : best;
  }, priced[0]);
  if (flagship) flagship.flagship = true;

  const provider = {
    id: p.id,
    name: p.name,
    website: p.website,
    tag: "official",
    rating: 3.5,
    billing: "payg",
    currency: "USD",
    endpoints: p.endpoints,
    desc: p.desc,
    seeded: true,
  };

  const dir = path.join(repo, "entries", p.id);
  if (existsSync(dir)) {
    console.log(`  = ${p.id}: entry exists, skipped`);
    continue;
  }
  const report = `${p.id.padEnd(22)} ${String(priced.length).padStart(3)} priced rows (skipped: ${skippedUnpriced} unpriced, ${skippedNonText} non-text)`;
  console.log(`  + ${report}`);
  if (WRITE) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "provider.json"), JSON.stringify(provider, null, 2) + "\n");
    writeFileSync(path.join(dir, "models.json"), JSON.stringify(priced, null, 2) + "\n");
    writeFileSync(path.join(dir, "logo.svg"), placeholderLogo(p.id));
  }
}

console.log(`\n${wanted.length} provider(s), ${totalModels} priced rows${WRITE ? "" : " — re-run with --write to apply"}`);
if (WRITE) console.log("Next: checklist rows + `node scripts/generate.mjs --check`, then upgrade entries to Tier A/B one by one.");
