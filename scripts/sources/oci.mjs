/**
 * OCI Generative AI's per-token rates, from Oracle's own public price list.
 *
 * The price list is a keyless JSON catalogue of every OCI SKU, the same feed
 * the cost estimator renders:
 *
 *   https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/?currencyCode=USD
 *
 * GenAI token SKUs carry `metricName: "1,000,000 Tokens"` and name the model,
 * the direction and (for some) the context band in `displayName`:
 *
 *   "OCI Generative AI - OpenAI - gpt-oss-120b - Input Tokens"
 *   "Oracle Cloud Infrastructure Generative AI - xAI - Grok 4.2 - Input Tokens less than 200K Tokens"
 *   "OCI - Generative AI - xAI - Grok 4.6 - Input Tokens Short Context"
 *
 * Priority SKUs are a second price for the same model and are skipped; the
 * entry carries the standard tier. The `less than` / `greater than 200K` pair
 * becomes the row and its `long_context`; the 4.6/4.7 pair says only
 * "Short Context" / "Long Context" and states no boundary, so that long band
 * is recorded here rather than given an invented `over`.
 *
 * **The Llama rows have no per-token SKU.** OCI sells them by the transaction
 * — 0.0018 per 10,000 for Llama 4 Scout/Maverick and the Large Meta SKU — and
 * the token figure the seed carries (0.72) is a derived 4-characters-per-token
 * conversion, not a vendor rate. Moving the entry onto the vendor's figure
 * would mean changing the currency of the price, which is a decision, so those
 * three rows stay on their seeded token equivalents and are named here.
 *
 * **Membership is `intersect`.** The price list also prices Grok 4.7 and three
 * Gemini 2.5 SKUs the entry does not carry, and the catalogue's id convention
 * is the seed's; adding them is a membership pass, not this one.
 */
import { getJson, drift, MEMBERSHIP } from "../lib/fetch.mjs";

const URL = "https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/?currencyCode=USD";

/** Price-list model key -> the entry id(s) that model prices. */
const IDS = {
  "gpt-oss-120b": ["openai.gpt-oss-120b"],
  "gpt-oss-20b": ["openai.gpt-oss-20b"],
  "grok-4.2": ["xai.grok-4.20-reasoning", "xai.grok-4.20-non-reasoning"],
  "grok-4.3": ["xai.grok-4.3"],
  "grok-4.6": ["xai.grok-4.6"],
};

const money = (n, what) => {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) drift(`${what}: "${n}" is not a non-negative number`);
  return String(Math.round(n * 1e6) / 1e6);
};

/** The model key, direction and band a token SKU names, or null. */
const skuOf = (item) => {
  if (item.metricName !== "1,000,000 Tokens") return null;
  const name = item.displayName ?? "";
  if (/priority/i.test(name)) return null;
  const oss = /\b(gpt-oss-(?:120b|20b))\b/i.exec(name);
  const grok = /\bGrok\s+([0-9]+\.[0-9]+)\b/i.exec(name);
  const model = oss ? oss[1].toLowerCase() : grok ? `grok-${grok[1]}` : null;
  if (!model) return null;
  const direction = /cached input/i.test(name)
    ? "cache_read"
    : /output/i.test(name)
      ? "out"
      : /input/i.test(name)
        ? "in"
        : null;
  // `less/greater than 200K` states the boundary; Short/Long does not. A SKU
  // with no band wording at all (the gpt-oss rows) prices one flat band.
  const explicit = /greater than 200K/i.test(name);
  const band = explicit || /long context/i.test(name) ? "long" : "short";
  if (!direction) return null;
  const usd = (item.currencyCodeLocalizations ?? [])
    .filter((c) => c.currencyCode === "USD")
    .flatMap((c) => c.prices ?? []);
  if (usd.length === 0) return null;
  return { model, direction, band, explicit, value: money(usd[0].value, `${model} ${direction}`) };
};

export default {
  ids: ["oci"],
  source: URL,
  membership: MEMBERSHIP.INTERSECT,
  owns: ["in", "out", "cache_read", "long_context"],

  async read() {
    const data = await getJson(URL);
    const items = data?.items;
    if (!Array.isArray(items) || items.length === 0) drift("the price list has no items — the API changed shape");

    const byModel = new Map();
    for (const item of items) {
      const sku = skuOf(item);
      if (!sku) continue;
      const m = byModel.get(sku.model) ?? { short: {}, long: {}, explicitLong: false };
      m[sku.band][sku.direction] = sku.value;
      if (sku.explicit) m.explicitLong = true;
      byModel.set(sku.model, m);
    }

    const rows = [];
    const thin = [];
    for (const [model, ids] of Object.entries(IDS)) {
      const m = byModel.get(model);
      if (!m?.short.in || !m?.short.out) {
        thin.push(`${model} (no standard input/output pair)`);
        continue;
      }
      for (const id of ids) {
        const row = {
          id,
          name: id,
          in: m.short.in,
          out: m.short.out,
          ...(m.short.cache_read !== undefined ? { cache_read: m.short.cache_read } : {}),
        };
        // A `greater than 200K` pair is the threshold; Short/Long alone is not.
        if (m.explicitLong && m.long.in !== undefined && m.long.out !== undefined) {
          row.long_context = {
            over: 200000,
            in: m.long.in,
            out: m.long.out,
            ...(m.long.cache_read !== undefined ? { cache_read: m.long.cache_read } : {}),
          };
        }
        rows.push(row);
      }
    }
    if (rows.length === 0) drift("no entry model matched a per-token SKU — the price list's names changed");

    const notes = [
      `${items.length} SKUs in Oracle's price list (last updated ${data.lastUpdated ?? "unknown"}); ${rows.length} entry row(s) priced from 1,000,000-token SKUs`,
      "Priority SKUs are other prices for the same models and are not carried",
      "the Llama rows have no per-token SKU (OCI sells them per 10,000 transactions); their seeded 0.72 is a derived conversion and is left in place",
    ];
    if (byModel.has("grok-4.7")) notes.push("Grok 4.7 is priced but the entry has no id; it, and Gemini 2.5, are for a membership pass");
    notes.push("Grok 4.6's Long Context SKUs state no token boundary, so its long band is not written without an `over`");
    if (thin.length) notes.push(`no standard pair: ${thin.join(", ")}`);
    return { rows: { oci: rows }, notes: { oci: notes } };
  },
};
