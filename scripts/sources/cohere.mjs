/**
 * Cohere's per-token prices, out of the pricing page's own CMS payload.
 *
 * **This entry was written off twice, both times by looking at the wrong thing.**
 * `cohere.com/pricing` renders its API rates client-side, so the served HTML has
 * no per-token price in its visible text — what it shows is the Model Vault
 * infrastructure rates, `$4.00` an hour and `$2,500` a month, which is what a
 * reader skimming for `$` finds. The real prices are in the Sanity CMS data
 * embedded in the page's Next.js payload, as a `_type: "pricingGroup"` tree of
 * `_type: "model"` objects each carrying a `pricings` array:
 *
 *   {"_type":"pricing","inputLabel":"Input","inputPrice":0.15,
 *    "outputLabel":"Output","outputPrice":0.6}
 *
 * That is the cleanest shape in this directory — numbers, not text — and unlike
 * Mistral's `data-prices`, the model name sits on the same object, so the join
 * holds. The lesson is the one this repo keeps re-learning: a page that shows no
 * prices is not a page without prices, only a page whose prices are somewhere
 * else.
 *
 * The id is derived from the model name (`Command R7B` -> `command-r7b`), because
 * the payload carries a display name and no API id. Every derived id here was
 * checked against `docs.cohere.com/docs/models`, which names both an alias and a
 * dated snapshot for each — `command-a-plus` and `command-a-plus-05-2026` — and
 * the alias is what the entry uses, for the reason `mistral` records: it tracks
 * the model being priced, where a snapshot would need replacing at each release.
 *
 * Rows billed in another unit are skipped rather than converted — Rerank per
 * thousand searches, Parse per thousand pages — because those are not per-token
 * rates and this schema has no field for them. The row says so itself, in an
 * `overridePer`, which is a better test than the `per` field: `per` reads
 * `"1M tokens"` on Rerank too, and reads `"Free"` on the vendor's current
 * flagship, whose API carries no charge at all. A free model is a price.
 */
import { getText, drift, MEMBERSHIP, readEntry } from "../lib/fetch.mjs";

const URL = "https://cohere.com/pricing";

/** The page's Next.js flight payload, reassembled and unescaped. */
const payload = (html) => {
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,\s*"([\s\S]*?)"\]\)/g)].map((m) => m[1]);
  if (chunks.length === 0) drift("no __next_f payload — the page has been rebuilt");
  return chunks.join("").replace(/\\"/g, '"').replace(/\\n/g, "\n");
};

/** Every `_type: "model"` object anywhere in the payload. */
const modelsIn = (blob) => {
  const out = [];
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== "object") return;
    if (o._type === "model" && typeof o.modelName === "string") out.push(o);
    Object.values(o).forEach(walk);
  };
  for (const start of blob.matchAll(/\{"_key":"[^"]*","_type":"model"/g)) {
    // The objects are escaped JSON inside the payload rather than a parseable
    // document, so each one is brace-matched and parsed on its own.
    let depth = 0;
    for (let i = start.index; i < blob.length; i++) {
      if (blob[i] === "{") depth++;
      else if (blob[i] === "}" && --depth === 0) {
        try {
          walk(JSON.parse(blob.slice(start.index, i + 1)));
        } catch {
          /* a truncated or nested fragment; the objects we want parse */
        }
        break;
      }
    }
  }
  return out;
};

/** `Command R7B` -> `command-r7b`, `Command A+` -> `command-a-plus`. */
export const slug = (name) =>
  name
    .toLowerCase()
    .replace(/\+/g, "-plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export default {
  ids: ["cohere"],
  source: URL,
  membership: MEMBERSHIP.INTERSECT,
  owns: ["in", "out"],

  async read() {
    const html = await getText(URL, { headers: { accept: "text/html" } });
    const models = modelsIn(payload(html));
    if (models.length === 0) drift("no pricing models in the payload — the page has changed shape");

    const priced = new Map();
    for (const m of models) {
      const p = (m.pricings ?? [])[0];
      if (!p || typeof p.inputPrice !== "number" || typeof p.outputPrice !== "number") continue;
      // The rates are per token unless the row names another unit, which it does
      // in `overridePer` — Rerank bills per thousand searches, Parse per thousand
      // pages. Those have no field here and are skipped rather than converted.
      // Testing `per === "1M tokens"` instead would also drop `Command A+`, whose
      // `per` is `"Free"` — the vendor's current flagship is open-weights and its
      // API is free, and a free model is a price like any other.
      if (p.overridePer) continue;
      const id = slug(m.modelName);
      if (!priced.has(id)) priced.set(id, { id, in: String(p.inputPrice), out: String(p.outputPrice) });
    }
    if (priced.size === 0) drift("no per-token models in the payload");

    const current = readEntry("cohere").models;
    const rows = current.map((r) => priced.get(r.id)).filter(Boolean);
    if (rows.length === 0) drift("none of the entry's models are in the payload — the join is broken");

    const missing = current.filter((r) => !priced.has(r.id));
    const notes = [`${priced.size} per-token models in the payload, ${rows.length} of them in the entry`];
    if (missing.length) notes.push(`not priced there: ${missing.map((r) => r.id).join(", ")}`);
    return { rows: { cohere: rows }, notes: { cohere: notes } };
  },
};
