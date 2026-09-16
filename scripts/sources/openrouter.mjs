/**
 * OpenRouter's prices, read from the upstream endpoints rather than the model.
 *
 * The obvious source is the one field `GET /api/v1/models` gives each model, and
 * it is the one to avoid. OpenRouter routes a model to many upstreams and **each
 * upstream has its own price**; the model-level `pricing` object is an aggregate
 * over them, and which value it takes moves as endpoints come and go.
 * `deepseek/deepseek-v4.1-flash` has 18 endpoints spanning 0.15 to 0.375 per
 * million, and the aggregate read 0.15 (Relace, the cheapest) at one point in a
 * single session and 0.30 (what DeepSeek itself and nine others charge) at
 * another. Two values committed from it — 0.07476 and 0.0825 — were not any
 * endpoint's price at all, across 17 and 6 upstreams respectively. An aggregator
 * that reports a number no upstream charges is not a source.
 *
 * So this reads `GET /api/v1/models/<id>/endpoints` and takes the **modal**
 * price: the one the most upstreams charge. It is a real price, it is what a
 * reader is most likely to pay, and — the point — it is a function of the
 * endpoint set rather than of which one a router felt like reporting, so two
 * runs against the same day's data agree. Ties break toward the model owner's
 * own endpoint and then toward the cheaper, both of which are at least stable
 * properties of the data rather than of the request.
 *
 * This is the only adapter that reads prices the vendor did not publish as a
 * price list. It is also why `membership` is `intersect`: the API returns some
 * four hundred text-out models and this entry deliberately carries twenty, chosen
 * by usage ranking in `fetch-openrouter-rankings.mjs`. A price list is in no
 * position to decide what the catalogue holds.
 *
 * Text-out models only, and input modality is deliberately not a filter — most
 * models take images, files, audio or video and still answer in text, and they
 * are exactly the models a reader picks. (Filtering on `modality === "text->text"`
 * looks right and is not: it drops every one of those, including all four rows
 * the entry carries.)
 */
import { getJson, drift, perMillion, MEMBERSHIP, readEntry } from "../lib/fetch.mjs";

const MODELS = "https://openrouter.ai/api/v1/models";
const ENDPOINTS = (id) => `https://openrouter.ai/api/v1/models/${id}/endpoints`;

/** A chat model: text out, and nothing else out. */
const outputsText = (m) => {
  const out = m?.architecture?.output_modalities;
  return Array.isArray(out) && out.includes("text") && out.every((x) => x === "text");
};

/** A real price, rather than the negative sentinel for a variable one. */
const fixed = (v) => v !== undefined && !String(v).startsWith("-");

/** "z-ai" and "Z.ai" are the same party; compare them that way. */
const alike = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The price the most upstreams charge, as a per-million triple — or nothing,
 * when the upstreams do not agree on one.
 *
 * Grouped on all three rates at once rather than on input alone: they move
 * together per endpoint, and grouping on one would pick an input rate whose
 * output rate came from a different upstream.
 *
 * **A tie returns undefined, deliberately.** Three of the twenty models here
 * have no modal price at all — `deepseek-v4-flash-0731` spreads 29 upstreams
 * across 25 prices with the top two holding two each, and `mimo-v2.5` has six
 * upstreams at six different prices, so its "mode" is a coin toss. For those,
 * every rule is arbitrary, and the previous tie-break proved it: it preferred the
 * cheaper of the tied pair, and the entry's `deepseek-v4-flash-0731` moved from
 * 0.13 to 0.0741 the moment the upstream set churned enough to produce a tie —
 * with no vendor change behind it, which is the exact instability this adapter
 * was written to remove. Refusing to answer is the only stable option, and it
 * matches what the rest of this repo does when a source cannot speak: keep the
 * last human-checked number and say why.
 *
 * The owner's own endpoint breaks a tie only when it is a real signal — a tie in
 * count *and* an owner present is a price the lab itself sets.
 */
export function modalPrice(endpoints, owner) {
  const groups = new Map();
  for (const e of endpoints) {
    const p = e?.pricing ?? {};
    if (!fixed(p.prompt) || !fixed(p.completion)) continue;
    const rates = {
      in: perMillion(p.prompt),
      out: perMillion(p.completion),
      ...(fixed(p.input_cache_read) ? { cache_read: perMillion(p.input_cache_read) } : {}),
    };
    const key = `${rates.in}/${rates.out}/${rates.cache_read ?? "-"}`;
    const g = groups.get(key) ?? { rates, count: 0, owned: false };
    g.count++;
    g.owned ||= alike(e?.provider_name) === alike(owner);
    groups.set(key, g);
  }
  const ranked = [...groups.values()].sort((a, b) => b.count - a.count || Number(b.owned) - Number(a.owned));
  const [best, next] = ranked;
  if (!best) return undefined;
  if (next && next.count === best.count && next.owned === best.owned) return undefined;
  return best.rates;
}

export default {
  ids: ["openrouter"],
  source: `${MODELS} + /{id}/endpoints`,
  membership: MEMBERSHIP.INTERSECT,
  owns: ["in", "out", "cache_read", "cache_creation"],

  async read() {
    const body = await getJson(MODELS);
    const all = Array.isArray(body) ? body : body?.data;
    if (!Array.isArray(all) || all.length === 0) drift("no model array in the response");

    const text = all.filter(outputsText);
    if (text.length === 0) drift("no text-out models in the response");

    // Only rows the entry already carries are priced, and they are re-keyed onto
    // the entry's own id so the runner can join them. An API model with no
    // upstream in the entry is not a gap to fill — it is one of the 400-odd the
    // ranking did not select.
    const current = readEntry("openrouter").models;
    const upstreams = (r) => [r.id, ...Object.values(r.serves ?? {})];

    const rows = [];
    const failed = [];
    const spread = [];
    for (const m of text) {
      const now = current.find((r) => upstreams(r).includes(String(m.id)));
      if (!now) continue;
      let rates;
      let endpoints = [];
      try {
        const detail = await getJson(ENDPOINTS(String(m.id)));
        endpoints = (detail?.data ?? detail)?.endpoints ?? [];
        if (endpoints.length === 0) {
          failed.push(`${m.id} (no endpoints)`);
          continue;
        }
        rates = modalPrice(endpoints, String(m.id).split("/")[0]);
        const distinct = new Set(
          endpoints
            .map((e) => e?.pricing?.prompt)
            .filter(fixed)
            .map((v) => perMillion(v)),
        );
        if (distinct.size > 1) spread.push(`${m.id} (${endpoints.length} endpoints, ${distinct.size} prices)`);
      } catch (err) {
        // One model's endpoint list failing must not cost the entry its prices
        // for the other nineteen — but it is said out loud, not swallowed.
        failed.push(`${m.id} (${err.message})`);
        continue;
      }
      if (!rates) {
        // No modal price, or none at all. The entry keeps whatever it carries and
        // the run says so, rather than rewriting a number on a coin toss.
        failed.push(`${m.id} (no agreed price among ${endpoints.length} upstreams — left as is)`);
        continue;
      }
      rows.push({ id: now.id, ...rates });
    }
    if (rows.length === 0) drift("no carried model resolved to an endpoint price — the join is broken");

    const missing = current.filter((r) => !rows.some((x) => x.id === r.id));
    const notes = [`${rows.length} of the entry's ${current.length} models priced from their upstreams`];
    if (spread.length) notes.push(`priced differently per upstream: ${spread.join(", ")}`);
    if (missing.length) notes.push(`not resolved: ${missing.map((r) => r.id).join(", ")}`);
    if (failed.length) notes.push(`could not be read this run: ${failed.join(", ")}`);

    return { rows: { openrouter: rows }, notes: { openrouter: notes } };
  },
};
