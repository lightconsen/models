/**
 * Nebius Token Factory's public model catalog, straight from its JSON endpoint.
 *
 * The pricing page is a client-rendered shell, but it advertises the data the
 * UI is built from, and that endpoint is the authoritative source:
 *
 *   https://tokenfactory.nebius.com/api/public/models_info
 *
 * One object per model, one flavor each, and the rates are fields rather than
 * text to parse:
 *
 *   flavors[].input_price_per_million_tokens
 *   flavors[].input_cached_price_per_million_tokens   (optional)
 *   flavors[].output_price_per_million_tokens
 *   flavors[].max_model_len
 *
 * The vendor's own `model-catalog.md` says this JSON is the authoritative
 * machine-readable source and the Markdown is a reading view, so this adapter
 * reads the JSON and no HTML.
 *
 * **Membership is `follow`.** The catalog enumerates the public models, all 28
 * of them `active` on 2026-10-18, and every one of the entry's 20 ids is in it.
 * The rebuild adds the eight the seed never carried and drops none.
 *
 * **Cache rates are removed, not carried.** The catalog's cached-input field is
 * optional and no model sets it; the seeded `cache_read` values were a
 * models.dev reading the vendor does not state (several equal the input rate,
 * which is the shape of a derived fallback). A rate the authoritative JSON does
 * not publish is not a vendor price. The adapter still owns `cache_read`, so the
 * field returns the day the catalog starts publishing it.
 *
 * The endpoint moved with the product's rename: the app now names
 * `https://api.tokenfactory.nebius.com/v1/` as its default inference base, and
 * the old `studio.nebius.com` host is a 301 to it.
 */
import { getJson, drift, MEMBERSHIP } from "../lib/fetch.mjs";

const URL = "https://tokenfactory.nebius.com/api/public/models_info";

/** A JSON number as the entry's decimal string, without float noise. */
const money = (n, what) => {
  if (n === undefined || n === null) return undefined;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) drift(`${what}: "${n}" is not a non-negative number`);
  return String(Math.round(n * 1e6) / 1e6);
};

export default {
  ids: ["nebius"],
  source: URL,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "context"],

  async read() {
    const data = await getJson(URL);
    if (!Array.isArray(data) || data.length === 0) drift("the model catalog is not a non-empty array — the endpoint changed");

    const rows = [];
    const skipped = [];
    for (const model of data) {
      if (model.status !== "active") {
        skipped.push(`${model.name ?? "?"} (${model.status})`);
        continue;
      }
      const flavors = model.flavors ?? [];
      if (flavors.length !== 1) {
        // One price per model is what the endpoint states today. A split into
        // labels or regions is a pricing decision this adapter must not guess.
        drift(`${model.name ?? "?"} has ${flavors.length} flavors — the catalog's shape changed`);
      }
      const f = flavors[0];
      const id = f.model_id;
      if (!id) drift(`${model.name ?? "?"} has a flavor with no model_id`);
      const input = money(f.input_price_per_million_tokens, `${id} input`);
      const out = money(f.output_price_per_million_tokens, `${id} output`);
      if (input === undefined || out === undefined) {
        skipped.push(`${id} (no per-token pair)`);
        continue;
      }
      const cache = money(f.input_cached_price_per_million_tokens, `${id} cached input`);
      const context = Number.isInteger(f.max_model_len) ? f.max_model_len : undefined;
      rows.push({
        id,
        name: f.model_name ?? model.name ?? id,
        in: input,
        out,
        ...(cache !== undefined ? { cache_read: cache } : {}),
        ...(context !== undefined ? { context } : {}),
      });
    }
    if (rows.length === 0) drift("the catalog yielded no priced models");

    const notes = [
      `${data.length} public models in the catalog, ${rows.length} priced rows`,
      "the catalog publishes no cached-input rate on any model, so cache_read is absent (the seeded values were removed)",
    ];
    if (skipped.length) notes.push(`skipped: ${skipped.join(", ")}`);
    return { rows: { nebius: rows }, notes: { nebius: notes } };
  },
};
