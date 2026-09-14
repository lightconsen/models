/**
 * OpenRouter's prices, from a plain JSON API. No key, no HTML, no browser.
 *
 * The one source that must NOT decide membership, which is why it is the one
 * `intersect` adapter here. `GET /api/v1/models` returns every model OpenRouter
 * routes — around four hundred text-out rows — and this entry deliberately carries
 * twenty. Which twenty is a separate question, answered by usage ranking in
 * `fetch-openrouter-rankings.mjs`; letting the price list answer it too would
 * replace a curated list with the whole catalogue. So this re-prices what is
 * already there and reports the rest.
 *
 * Text-out models only: the rows that also emit images or audio are a different
 * price shape, and this catalogue holds per-token text rates alone. Input modality
 * is deliberately not a filter — most models take images, files, audio or video
 * and still answer in text, and they are exactly the models a reader picks.
 * (Filtering on `modality === "text->text"` looks right and is not: it drops every
 * one of those, including all four rows the entry carries.)
 *
 * A price can be a negative sentinel, which OpenRouter uses for its own routing
 * meta-models — they charge whatever the model they pick charges, so there is no
 * number to carry. Those rows are left unpriced rather than guessed at.
 */
import { getJson, drift, perMillion, MEMBERSHIP, readEntry } from "../lib/fetch.mjs";

const URL = "https://openrouter.ai/api/v1/models";

/** The upstream strings a row claims: its own `id`, plus every `serves` value.
    Both, because `serves` may name only some protocols and the rest fall back to
    the id. This is the join the whole adapter lives on — the entry's ids are
    canonical ("deepseek-v4-pro"), the API's are the vendor's own
    ("deepseek/deepseek-v4-pro"), and nothing but `serves` connects them. */
const upstreams = (r) => [r.id, ...Object.values(r.serves ?? {})];

/** A chat model: text out, and nothing else out. */
const outputsText = (m) => {
  const out = m?.architecture?.output_modalities;
  return Array.isArray(out) && out.includes("text") && out.every((x) => x === "text");
};

/** A real price, rather than the negative sentinel for a variable one. */
const fixed = (v) => v !== undefined && !String(v).startsWith("-");

export default {
  ids: ["openrouter"],
  source: URL,
  membership: MEMBERSHIP.INTERSECT,

  async read() {
    const body = await getJson(URL);
    const all = Array.isArray(body) ? body : body?.data;
    if (!Array.isArray(all) || all.length === 0) drift("no model array in the response");

    const text = all.filter(outputsText);
    if (text.length === 0) drift("no text-out models in the response");

    // Only rows the entry already carries are priced, and they are re-keyed onto
    // the entry's own id so the runner can join them. An API model with no
    // upstream in the entry is not a gap to fill — it is the 400-odd models the
    // ranking did not select.
    const current = readEntry("openrouter").models;
    const rowFor = (apiId) => current.find((r) => upstreams(r).includes(apiId));

    const rows = [];
    const unmatched = [];
    for (const m of text) {
      const now = rowFor(String(m.id));
      if (!now) {
        unmatched.push(String(m.id));
        continue;
      }
      const p = m?.pricing ?? {};
      const row = { id: now.id };
      const priced = [p.prompt, p.completion].filter(fixed).length;
      if (priced === 1) drift(`"${m.id}" prices only one of prompt/completion — a shape this reader does not know`);
      if (priced === 2) {
        row.in = perMillion(p.prompt);
        row.out = perMillion(p.completion);
        if (fixed(p.input_cache_read)) row.cache_read = perMillion(p.input_cache_read);
        if (fixed(p.input_cache_write)) row.cache_creation = perMillion(p.input_cache_write);
      }
      rows.push(row);
    }
    if (rows.length === 0) drift("none of the entry's models are in the API — the join is broken");

    const missing = current.filter((r) => !rows.some((x) => x.id === r.id));
    const notes = [`${text.length} text-out models in the API, ${rows.length} of them in the entry`];
    if (missing.length) notes.push(`not found in the API: ${missing.map((r) => r.id).join(", ")}`);

    return { rows: { openrouter: rows }, notes: { openrouter: notes } };
  },
};
