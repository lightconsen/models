/**
 * Vercel AI Gateway's prices, from its own public models API — no key, no page.
 *
 * `ai-gateway.vercel.sh/v1/models` is the catalogue the gateway routes from, and
 * it answers keyless. It returns 517 models across ten types; this reads the
 * **321 of `type: "language"`**, which is the surface with a per-token rate.
 * Embeddings, images, video, speech, transcription, reranking and the rest are
 * billed by another measure and have no token rate to carry.
 *
 * **The gateway states one price per row, and only 50 rows say it varies.** A
 * row routes to several upstreams at once and each has its own price, which the
 * gateway flags with `pricing.varies_by_provider`. On the 271 rows where that is
 * absent the model-level `input`/`output` are the price; checked across the
 * varies set on 2026-11-24, the model-level pair was **also equal to a real
 * endpoint on all 50**, so it is a price somebody charges and not an average.
 * Where it is `true` the model-level number is one upstream's, not necessarily
 * the vendor's, so this reads `…/models/<id>/endpoints` and takes the **modal**
 * price via the OpenRouter adapter's `modalPrice` — the vendor's own listing
 * if it has one, else a strict majority. 31 of the 50 resolve. For the other 19,
 * where no price has a majority (so no consensus exists), the row keeps the
 * model-level pair rather than going unpriced: it is a number an upstream really
 * charges, verified against the endpoints, and carrying it is the same
 * `follow`-the-catalogue choice the gateway makes. Which rows fell back is named
 * in the notes every run.
 *
 * **`-batch` twins fold onto their base row; `-fast` twins do not.** Both are
 * real ids the API accepts, but they are the same model on another schedule, and
 * the schema has a field for exactly one of them. A `xxxx-batch` row's rates go
 * on the base row's `batch` block, following the fold the OpenRouter entry made
 * for its `:batch` twins — otherwise every release would arrive as 48 "new
 * models" that are a billing mode. 44 of the 48 are half the standard rate and
 * the four `spacexai/grok-4.20-*` are 0.8 of it, which is fine: the block holds
 * whatever the twin charges. `fast` has no such field (`service_tier` holds a
 * multiplier on the standard rate, which is not what a fast id is — a fast id is
 * a separate product Vercel routes to its own upstreams), so the `-fast` ids
 * stay rows of their own, the way `commandcode` carries
 * `deepseek/deepseek-v4-flash-fast`. `morph/morph-v3-fast` has no base row and is
 * just a model.
 *
 * **Length bands are `input_tiers`.** 65 rows carry them: 19 are batch twins
 * (whose band the `batch` block cannot hold — see below) and the 46 carried rows
 * are 45 two-band and one (`alibaba/qwen3.7-flash`) three-band. The row takes the
 * first band and the second becomes `long_context`, the third being a recorded
 * gap. A band is a `cost` with inclusive `min` and exclusive `max`. The threshold
 * is the vendor's round figure — Vercel writes the boundary as `[0, 272001)`,
 * `[0, 272000)`, `[0, 256001)` or `[0, 200001)` for 272K / 256K / 200K, so an
 * exclusive maximum ending in `…001` is the round number below it and one ending
 * in `…000` is already it. That is how the thresholds come out as 272000 /
 * 256000 / 200000 / 32000 rather than one token above them. Cache-read and
 * cache-write bands fold in beside the two rates when the row prices them.
 *
 * **A `priority` tier becomes `service_tier` when it is the only tier and the
 * multiplier is exact.** 51 rows publish tiers; most publish two or three
 * (`flex`, `priority`, `ultrafast`), and the field holds one. `flex` is a
 * *discount* off the listed rate, which would be wrong to record as the price,
 * so only rows whose sole tier is `priority` and whose rates are an exact
 * multiple of the standard ones are written. `gpt-4o-mini`'s 5/3 is not
 * representable as a finite decimal multiplier and is left, not rounded. The
 * rest — flex, ultrafast, multi-tier rows — are a recorded gap, as are
 * region-pinned rates (`regional`, up to 1.31x), the `peak_pricing` multiplier on
 * `particle/particle-1`, per-search and audio-token charges, and the batch
 * twins' upper band where the base row is tiered (19 twins).
 *
 * 2 rows carry `deprecated_at` and are still served and priced. Membership is
 * `follow`, so each leaves the entry the day the catalogue stops listing it.
 */
import { drift, MEMBERSHIP, getJson, perMillion } from "../lib/fetch.mjs";
import { modalPrice } from "./openrouter.mjs";

const API = "https://ai-gateway.vercel.sh/v1/models";
const ENDPOINTS = (id) => `${API}/${id}/endpoints`;
const LIMIT = 4;

/** An absent key is an absent rate, not a malformed one: `perMillion` drifts on
    anything that is not a decimal, so the "the vendor does not state this rate"
    case is filtered out before it gets there. */
const rateOf = (v) => (v === undefined || v === null ? undefined : perMillion(v));

/** A band's threshold as the round number the vendor means. The first band's
    `max` is exclusive; Vercel writes the same boundary as 272000 and 272001 for
    different rows, so an exclusive maximum one past a round thousandfold is that
    round number. */
export const boundary = (max) => (Number.isInteger(max) && max > 1000 && max % 1000 === 1 ? max - 1 : max);

/** A tier list as `long_context`, or undefined. Only the second band is
    expressible; a third is a gap the notes name. */
const longContext = (p) => {
  const t = p.input_tiers;
  if (!Array.isArray(t) || t.length < 2) return undefined;
  const over = boundary(t[0].max);
  const inRate = perMillion(t[1]?.cost);
  const outRate = perMillion(p.output_tiers?.[1]?.cost);
  if (!Number.isInteger(over) || over <= 0) drift(`a length band's first maximum is not a whole token count (${t[0].max})`);
  if (inRate === undefined || outRate === undefined) drift("a length band states no input or output rate");
  // The cache bands follow the input band's split; a row that prices one over
  // both bands gets a block, one that omits it gets no field.
  const read = rateOf(p.input_cache_read_tiers?.[1]?.cost);
  const write = rateOf(p.input_cache_write_tiers?.[1]?.cost);
  return {
    over,
    in: inRate,
    out: outRate,
    ...(read !== undefined ? { cache_read: read } : {}),
    ...(write !== undefined ? { cache_creation: write } : {}),
  };
};

/** The `priority` premium, when it is the row's only tier and an exact multiple
    of the standard rates. `service_tier` is one multiplier, so a tier set with a
    discount in it (flex) or more than one member is not expressible. */
const priorityTier = (p) => {
  const st = p.service_tiers;
  if (!st || typeof st !== "object") return undefined;
  const names = Object.keys(st);
  if (names.length !== 1 || names[0] !== "priority") return undefined;
  const t = st.priority ?? {};
  const pairs = [
    [t.input, p.input],
    [t.output, p.output],
    [t.input_cache_read, p.input_cache_read],
    [t.input_cache_write, p.input_cache_write],
  ].filter(([a, b]) => a !== undefined && b !== undefined);
  if (pairs.length < 2) return undefined;
  const r = Number(pairs[0][0]) / Number(pairs[0][1]);
  if (!pairs.every(([a, b]) => Math.abs(Number(a) / Number(b) - r) < 1e-12)) return undefined;
  // The multiplier must be exact at six places, and reproduce every tier rate
  // when multiplied back — a rounded multiplier would price the tier wrong.
  if (Math.abs(Math.round(r * 1_000_000) - r * 1_000_000) > 1e-6) return undefined;
  if (!pairs.every(([a, b]) => Math.abs(r * Number(b) - Number(a)) < 1e-12)) return undefined;
  return { name: "priority", multiplier: r };
};

/** `-batch` twins' rates, as the base row's `batch` block: the first band only,
    because the block has no threshold of its own. */
const batchOf = (twin) => {
  const p = twin?.pricing;
  if (!p) return undefined;
  const inRate = perMillion(p.input_tiers?.[0]?.cost ?? p.input);
  const outRate = perMillion(p.output_tiers?.[0]?.cost ?? p.output);
  if (inRate === undefined || outRate === undefined) return undefined;
  const read = rateOf(p.input_cache_read_tiers?.[0]?.cost ?? p.input_cache_read);
  const write = rateOf(p.input_cache_write_tiers?.[0]?.cost ?? p.input_cache_write);
  return {
    in: inRate,
    out: outRate,
    ...(read !== undefined ? { cache_read: read } : {}),
    ...(write !== undefined ? { cache_creation: write } : {}),
  };
};

/** The modality pair, each direction sorted and de-duplicated — the gateway does
    not keep a stable order, and an incidental reorder would read as a change on
    every sync. */
const modalitiesOf = (m) => {
  const dir = (k) => {
    const v = m?.modalities?.[k];
    if (!Array.isArray(v) || v.length === 0) return null;
    return [...new Set(v)].sort();
  };
  const input = dir("input");
  const output = dir("output");
  return input ? (output ? { input, output } : { input }) : undefined;
};

export default {
  ids: ["vercel"],
  source: API,
  membership: MEMBERSHIP.FOLLOW,
  owns: [
    "in", "out", "cache_read", "cache_creation", "long_context", "batch", "service_tier",
    "context", "max_output", "reasoning", "tool_call", "structured_output", "temperature",
    "modalities", "open_weights", "knowledge",
  ],

  async read() {
    const body = await getJson(API);
    const all = (body?.data ?? []).filter((m) => m?.type === "language");
    if (all.length === 0) drift("the models API returned no language models");

    const byId = new Map(all.map((m) => [m.id, m]));
    const batchTwin = new Map();
    for (const m of all) if (/-batch$/.test(m.id)) batchTwin.set(m.id.replace(/-batch$/, ""), m);

    // Rows this entry carries: no batch twins (folded onto their base) and no
    // `-free` mirror of a priced model (a promo surface beside the model it
    // mirrors — the rule the OpenRouter entry follows for `:free`).
    const rowsIn = all.filter((m) => {
      if (/-batch$/.test(m.id)) return false;
      if (/-free$/.test(m.id) && byId.has(m.id.replace(/-free$/, ""))) return false;
      return true;
    });

    // The rows the gateway says vary: read their price from the endpoints the
    // way OpenRouter's is. A row with no strict majority gets no modal price and
    // falls back to the model-level pair below — verified equal to a real
    // endpoint, so it is a price somebody charges, not an aggregate.
    const varies = rowsIn.filter((m) => m?.pricing?.varies_by_provider === true);
    const modal = new Map();
    const fellBack = [];
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(LIMIT, varies.length) }, async () => {
        while (cursor < varies.length) {
          const m = varies[cursor++];
          try {
            const detail = await getJson(ENDPOINTS(m.id));
            const eps = detail?.data?.endpoints ?? [];
            const rates = eps.length > 0 ? modalPrice(eps, m.owned_by) : undefined;
            if (rates) modal.set(m.id, rates);
            else fellBack.push(`${m.id} (${eps.length} upstreams, no majority — kept the gateway's model-level price)`);
          } catch (err) {
            fellBack.push(`${m.id} (endpoints unread: ${String(err).slice(0, 40)} — kept the gateway's model-level price)`);
          }
        }
      }),
    );

    const rows = [];
    const folded = [];
    const gaps = { thirdBand: [], flexOrMulti: [], peaked: [], tieredBatch: [] };
    for (const m of rowsIn) {
      const p = m.pricing ?? {};
      const variesHere = p.varies_by_provider === true;
      // The modal price when there is one; else the model-level pair. Only a
      // non-varying row that states no pair would be a reshaped catalogue.
      const rates = variesHere && modal.has(m.id)
        ? modal.get(m.id)
        : {
            in: rateOf(p.input),
            out: rateOf(p.output),
            cache_read: rateOf(p.input_cache_read),
            cache_creation: rateOf(p.input_cache_write),
          };
      const row = { id: m.id, name: m.name || m.id };

      if (rates?.in !== undefined && rates?.out !== undefined) {
        row.in = rates.in;
        row.out = rates.out;
        if (rates.cache_read !== undefined) row.cache_read = rates.cache_read;
        if (rates.cache_creation !== undefined) row.cache_creation = rates.cache_creation;
      } else if (rateOf(p.input) === undefined || rateOf(p.output) === undefined) {
        drift(`${m.id}: the gateway states no ${p.input === undefined ? "input" : "output"} rate`);
      }

      const lc = longContext(p);
      if (lc) row.long_context = lc;
      if (Array.isArray(p.input_tiers) && p.input_tiers.length > 2) gaps.thirdBand.push(m.id);

      const twin = batchTwin.get(m.id);
      if (twin) {
        const b = batchOf(twin);
        if (b) row.batch = b;
        else drift(`${m.id}-batch states no rates to fold`);
        if (row.long_context) gaps.tieredBatch.push(`${m.id}-batch`);
        folded.push(`${m.id}-batch`);
      }

      const st = priorityTier(p);
      if (st) row.service_tier = st;
      else if (p.service_tiers && Object.keys(p.service_tiers).length > 0) gaps.flexOrMulti.push(m.id);
      if (p.peak_pricing) gaps.peaked.push(m.id);

      if (Number.isInteger(m.context_window) && m.context_window > 0) row.context = m.context_window;
      if (Number.isInteger(m.max_tokens) && m.max_tokens > 0) row.max_output = m.max_tokens;
      const tags = Array.isArray(m.tags) ? m.tags : [];
      const sp = Array.isArray(m.supported_parameters) ? m.supported_parameters : [];
      if (tags.includes("reasoning") || sp.includes("reasoning") || sp.includes("include_reasoning")) row.reasoning = true;
      if (tags.includes("tool-use") || sp.includes("tools")) row.tool_call = true;
      if (tags.includes("structured-output") || sp.includes("structured_outputs") || sp.includes("response_format")) row.structured_output = true;
      if (m.temperature === true) row.temperature = true;
      if (tags.includes("open-weights")) row.open_weights = true;
      if (typeof m.knowledge === "string" && /^\d{4}-\d{2}(-\d{2})?$/.test(m.knowledge)) row.knowledge = m.knowledge;
      const mo = modalitiesOf(m);
      if (mo) row.modalities = mo;

      rows.push(row);
    }
    if (rows.length === 0) drift("no language rows to write");

    const freeMirrors = all
      .filter((m) => /-free$/.test(m.id) && byId.has(m.id.replace(/-free$/, "")))
      .map((m) => m.id);
    return {
      rows: { vercel: rows },
      notes: {
        vercel: [
          `${rows.length} language models carried of ${all.length} listed; ${folded.length} \`-batch\` twins folded onto their base rows`,
          `${varies.length} rows price by upstream: ${modal.size} resolved to a majority price, ${fellBack.length} kept the gateway's model-level price (each verified equal to a real endpoint)`,
          ...(fellBack.length ? [`kept the model-level price: ${fellBack.join("; ")}`] : []),
          ...(freeMirrors.length ? [`free-tier mirrors of a priced model not carried: ${freeMirrors.join(", ")}`] : []),
          "no field, recorded instead: region-pinned rates (regional), flex/ultrafast and multi-tier service tiers, per-search and audio-token charges, and a time-of-day multiplier on " + (gaps.peaked.join(", ") || "none"),
          `third length band not expressible: ${gaps.thirdBand.join(", ") || "none"}`,
          `batch twins whose band above the threshold is not expressible: ${gaps.tieredBatch.join(", ") || "none"}`,
          `service tier not expressible (discount or multi-tier): ${gaps.flexOrMulti.length} rows`,
        ],
      },
    };
  },
};
