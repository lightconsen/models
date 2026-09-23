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
 * **A tie returns undefined, deliberately.** `deepseek-v4-flash-0731` spreads 29
 * upstreams across 25 prices with the top two holding two each, and `mimo-v2.5`
 * has six upstreams at six different prices, so its "mode" is a coin toss. For
 * those, every rule is arbitrary, and the previous tie-break proved it: it
 * preferred the cheaper of the tied pair, and the entry's `deepseek-v4-flash-0731`
 * moved from 0.13 to 0.0741 the moment the upstream set churned enough to produce
 * a tie — with no vendor change behind it, which is the exact instability this
 * adapter was written to remove. Refusing to answer leaves the row priced as it
 * was — an unpriced *proposal* changes nothing the row already carries — and the
 * run says so.
 *
 * Membership is **every text-out model in the models API** (2026-09-23: the
 * entry used to carry the usage ranking's top 100, chosen by
 * `fetch-openrouter-rankings.mjs`, which stays as a verification report). The
 * models API is the vendor's own canonical catalogue, so the list is theirs and
 * the ranking is no longer the gate. The `:free` mirrors are excluded — a price
 * of zero beside the priced model is a promo surface, and the owner's call
 * (2026-09-15) was to drop them. Capability facts — context, max output and the
 * parameter flags — come from the same API's per-model fields: `context_length`,
 * `top_provider` (the limit OpenRouter actually routes under; on some rows the
 * conservative choice over the model's nominal `context_length`),
 * `max_completion_tokens`, and the **closed** `supported_parameters` list, where
 * absence from the list is the vendor saying no.
 *
 * Text-out models only, and input modality is deliberately not a filter — most
 * models take images, files, audio or video and still answer in text, and they
 * are exactly the models a reader picks. (Filtering on `modality === "text->text"`
 * looks right and is not: it drops every one of those, including all four rows
 * the entry carries.)
 *
 * ~400 endpoint fetches per run: pooled four at a time, and a 429 or a dropped
 * connection backs off and retries before the row is left unpriced and named.
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
      ...(fixed(p.input_cache_write) ? { cache_creation: perMillion(p.input_cache_write) } : {}),
    };
    const key = `${rates.in}/${rates.out}/${rates.cache_read ?? "-"}${rates.cache_creation ?? "-"}`;
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

/** Pooled with backoff: ~400 requests a run must neither stampede nor die on
    one 429. A row whose endpoint list never arrives is proposed unpriced and
    named in the notes — it keeps whatever numbers it already carries. */
const LIMIT = 4;
const RETRIES = 3;

async function endpointsOf(id) {
  for (let attempt = 0; ; attempt++) {
    try {
      const detail = await getJson(ENDPOINTS(id));
      return (detail?.data ?? detail)?.endpoints ?? [];
    } catch (err) {
      const transient = /HTTP 429|429|timed out|no response|fetch failed|network/i.test(String(err));
      if (!transient || attempt >= RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
    }
  }
}

export default {
  ids: ["openrouter"],
  source: `${MODELS} + /{id}/endpoints`,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "cache_creation", "context", "max_output", "reasoning", "tool_call", "structured_output", "temperature"],

  async read() {
    const body = await getJson(MODELS);
    const all = Array.isArray(body) ? body : body?.data;
    if (!Array.isArray(all) || all.length === 0) drift("no model array in the response");

    const text = all
      .filter(outputsText)
      .filter((m) => !String(m.id).endsWith(":free"))
      // "~vendor/name-latest" rows are alias stubs: the API lists them as
      // redirects to the dated model and gives them no endpoints. They are not
      // a product surface; the models they point at are already carried.
      .filter((m) => !String(m.id).startsWith("~"));
    if (text.length === 0) drift("no text-out models in the response");

    // Rows the entry carries keep their canonical id (the bare model name the
    // entry chose), joined through `serves`; a model the entry has not met yet
    // takes the API's own namespaced id, which is what makes its reseller price
    // its own row rather than a false divergence from the vendor's.
    const current = readEntry("openrouter").models;
    const upstreams = (r) => [String(r.id).toLowerCase(), ...Object.values(r.serves ?? {}).map((v) => String(v).toLowerCase())];
    const canonical = new Map();
    for (const r of current) for (const u of upstreams(r)) if (!canonical.has(u)) canonical.set(u, r.id);

    const rows = [];
    const failed = [];
    const spread = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(LIMIT, text.length) }, async () => {
      while (cursor < text.length) {
        const m = text[cursor++];
        const id = String(m.id);
        let endpoints;
        try {
          endpoints = await endpointsOf(id);
        } catch (err) {
          failed.push(`${id} (${String(err).slice(0, 60)})`);
          endpoints = null;
        }
        const row = { id: canonical.get(id.toLowerCase()) ?? id, name: m.name ?? id };
        // Capability facts off the vendor's own fields. `supported_parameters`
        // is a closed list, so absence from it is a statement — a false here
        // is OpenRouter's, which is more than most vendors publish.
        const sp = Array.isArray(m.supported_parameters) ? m.supported_parameters : [];
        row.reasoning = sp.includes("reasoning") || sp.includes("include_reasoning");
        row.tool_call = sp.includes("tools");
        row.structured_output = sp.includes("structured_outputs") || sp.includes("response_format");
        row.temperature = sp.includes("temperature");
        const top = m.top_provider ?? {};
        const ctx = Number(top.context_length ?? m.context_length);
        if (ctx > 0) row.context = ctx;
        const out = Number(top.max_completion_tokens);
        if (out > 0) row.max_output = out;
        if (endpoints && endpoints.length > 0) {
          const rates = modalPrice(endpoints, id.split("/")[0]);
          const distinct = new Set(
            endpoints
              .map((e) => e?.pricing?.prompt)
              .filter(fixed)
              .map((v) => perMillion(v)),
          );
          if (distinct.size > 1) spread.push(`${id} (${endpoints.length} endpoints, ${distinct.size} prices)`);
          if (rates) {
            row.in = rates.in;
            row.out = rates.out;
            if (rates.cache_read !== undefined) row.cache_read = rates.cache_read;
            if (rates.cache_creation !== undefined) row.cache_creation = rates.cache_creation;
          } else {
            failed.push(`${id} (no agreed price among ${endpoints.length} upstreams — left as is)`);
          }
        } else if (endpoints !== null) {
          failed.push(`${id} (no endpoints)`);
        }
        rows.push(row);
      }
    });
    await Promise.all(workers);
    if (rows.every((r) => r.in === undefined)) drift("no model resolved to an endpoint price — the join is broken");

    const notes = [
      `${rows.filter((r) => r.in !== undefined).length} of ${rows.length} models priced from their upstreams; ${text.length} text-out models enumerated (:free mirrors excluded)`,
    ];
    if (spread.length) notes.push(`priced differently per upstream: ${spread.slice(0, 12).join(", ")}`);
    if (failed.length) notes.push(`left unpriced this run (rows keep their numbers): ${failed.slice(0, 12).join(", ")}`);

    return { rows: { openrouter: rows }, notes: { openrouter: notes } };
  },
};
