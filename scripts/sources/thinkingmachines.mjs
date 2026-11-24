/**
 * Thinking Machines' serverless inference prices, from the docs' own feed.
 *
 * Thinking Machines publishes two machine-readable tables under
 * `tinker-docs.thinkingmachines.ai/tinker/`, and they are **different products**:
 *
 *   - `serverless.json` — 2 rows, the **per-token inference** rates
 *     (`input` / `cached_input` / `output`). "Serverless inference is currently
 *     in beta and is available for Inkling and Inkling-Small only", with a
 *     waitlist for production use. This is the one that is a price for calling a
 *     model, so it is the source.
 *   - `models.json` — 38 rows, the **training** table. Its columns are `prefill`
 *     / `cached_prefill` / `sample` / **`train`**, and `train` is a forward *and
 *     backward* pass for gradient computation — a different meter, not an
 *     inference price. The 38 models a discovery run lists are this table, which
 *     is why it is not the source: carrying its `sample` as a per-token price
 *     would publish a number nobody pays for inference.
 *
 * **The 2 serverless rows match the entry this catalogue removed.** An earlier
 * `thinkingmachines` entry carried one row — `inkling`, 1 / 4.05 / 0.17 — and it
 * was dropped in 2026-09 on the ground that its price was "contradicted by its
 * own resellers". The serverless table states exactly 1.00 / 4.05 / 0.17 for
 * Inkling today, so that removal is vindicated rather than overtaken: the old row
 * was right about the number and wrong about the source. This adapter reads the
 * source, and the entry can now be rebuilt on primary evidence.
 *
 * **The id is the string the API accepts.** The docs' inference pages say `Use
 * thinkingmachines/Inkling for Inkling`, so the row's id is that namespaced
 * string — it is what a client at either base sends — and no `serves` mapping is
 * needed. The table's separate `Tinker ID` column (`…:peft:262144:sampling-nvfp4`)
 * is the string the *Python SDK*'s `create_sampling_client` takes, a checkpoint
 * path rather than an HTTP model name, so it is not this catalogue's id.
 *
 * **`cached_input` is `cache_read`**, not a write: the table prices a cache *hit*
 * (`Pricing Terms: Cached prefill … applies to input tokens that hit the prompt
 * cache`), which is the catalogue's `cache_read`. No cache-write rate is stated,
 * so none is written. `context` comes from the row's own `"256K"`, read as
 * 256 × 1024 — the only prefix the table uses is a size, not a token exact.
 *
 * Both inference bases are documented and live: the OpenAI-compatible one under
 * `…/services/tinker-prod/oai/api/v1` and the Anthropic-compatible one under
 * `…/services/tinker-prod/anthropic/api`; the entry lists both.
 */
import { drift, MEMBERSHIP, getJson } from "../lib/fetch.mjs";

const FEED = "https://tinker-docs.thinkingmachines.ai/tinker/serverless.json";
const TRAINING = "https://tinker-docs.thinkingmachines.ai/tinker/models.json";

/** "$0.30" → "0.30"; the feed states the currency mark before every rate. */
const money = (cell, what) => {
  const m = /^\$([0-9]+(?:\.[0-9]+)?)$/.exec(String(cell ?? "").trim());
  if (!m) drift(`a ${what} cell "${cell}" is not a $ price`);
  return m[1];
};

/** "256K" → 262144, "1M" → 1048576. A bare number is tokens. */
const contextOf = (s) => {
  const m = /^(\d+(?:\.\d+)?)\s*([KM])?$/i.exec(String(s ?? "").trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  const mul = /^k$/i.test(m[2] ?? "") ? 1024 : /^m$/i.test(m[2] ?? "") ? 1024 * 1024 : 1;
  return Math.round(n * mul);
};

export default {
  ids: ["thinkingmachines"],
  source: FEED,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "context"],

  async read() {
    const body = await getJson(FEED);
    const models = Array.isArray(body) ? body : body?.data;
    if (!Array.isArray(models) || models.length === 0) drift("the serverless feed returned no rows");

    // The training table is read only to say, in the notes, how large the other
    // product is — the count a reader would otherwise confuse with this one.
    let training = 0;
    try {
      const t = await getJson(TRAINING);
      training = (Array.isArray(t) ? t : t?.data ?? []).length;
    } catch {
      // The training feed is a note, not a source: its absence changes no price.
    }

    const rows = [];
    for (const m of models) {
      // Every row is a servable model at a published rate; one without a name
      // or a base rate is a reshaped feed.
      const name = String(m?.name ?? "").trim();
      if (!name) drift("a serverless row has no name");
      const id = /^thinkingmachines\//.test(name) ? name : `thinkingmachines/${name}`;
      const inRate = money(m.input, "input");
      const outRate = money(m.output, "output");
      // `cached_input` is optional; a row that omits it prices no cache read.
      const cached = m.cached_input === undefined ? undefined : money(m.cached_input, "cached-input");
      const ctx = contextOf(m.context);
      if (ctx === undefined) drift(`${name}: context "${m.context}" is not a size`);
      rows.push({
        id,
        name: name.replace(/^thinkingmachines\//, ""),
        in: inRate,
        out: outRate,
        ...(cached !== undefined ? { cache_read: cached } : {}),
        context: ctx,
      });
    }
    if (rows.length === 0) drift("no priced rows in the serverless feed");

    return {
      rows: { thinkingmachines: rows },
      notes: {
        thinkingmachines: [
          `${rows.length} serverless inference models priced (beta, waitlist for production)`,
          `the training table lists ${training} models at prefill/sample/train rates — a different meter, not read as an inference price`,
        ],
      },
    };
  },
};
