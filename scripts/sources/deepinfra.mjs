/**
 * DeepInfra's prices, from its own public models API — the same JSON its
 * catalogue page renders from (`api.deepinfra.com/v1/openai/models`, no key).
 *
 * `metadata.pricing` is keyed by what the request is billed in:
 * `input_tokens`/`output_tokens` for text, `input_seconds` for speech, `per_image_unit`
 * for images — and only the token pair has a field here, which is also the
 * filter: a model whose pricing carries `input_seconds` or `per_image_unit` is
 * billed by another measure and is reported as skipped rather than forced into
 * a per-token number, the way every duration-billed row in this repo is.
 * `cache_read_tokens` rides beside the token pair on some models and carries
 * over as `cache_read`.
 *
 * The catalogue rotates freely — the models.dev seed carried models this API
 * no longer lists, and the API lists models models.dev has not heard of. The
 * vendor's live list is the one this entry follows; that is the whole reason
 * the entry was upgraded off the seed.
 */
import { drift, MEMBERSHIP } from "../lib/fetch.mjs";

const API = "https://api.deepinfra.com/v1/openai/models";

/** The API's per-token floats arrive with binary artefacts (2.9999999999999996
    where the site shows 3). Six decimals is the vendor's own display precision;
    rounding to it is transcription, not alteration. */
const clean = (v) => String(Math.round(v * 1_000_000) / 1_000_000);

export default {
  ids: ["deepinfra"],
  source: API,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "context", "max_output"],

  async read() {
    const res = await fetch(API, { headers: { "user-agent": "Mozilla/5.0 (compatible; kiwano-price-check)" } });
    if (!res.ok) drift(`${API}: HTTP ${res.status}`);
    const body = await res.json();
    const models = body?.data;
    if (!Array.isArray(models) || models.length === 0) drift("the models API returned no data array");

    const rows = [];
    const skipped = new Map();
    const skip = (why, id) => skipped.set(why, (skipped.get(why) ?? []).concat(id));
    for (const m of models) {
      const p = m?.metadata?.pricing ?? {};
      if (p.input_tokens == null || p.output_tokens == null) {
        skip("not token-billed (audio/seconds/images)", m?.id);
        continue;
      }
      const meta = m.metadata ?? {};
      rows.push({
        id: m.id,
        name: m.id,
        in: clean(p.input_tokens),
        out: clean(p.output_tokens),
        ...(p.cache_read_tokens != null ? { cache_read: clean(p.cache_read_tokens) } : {}),
        ...(Number.isInteger(meta.context_length) && meta.context_length > 0 ? { context: meta.context_length } : {}),
        ...(Number(meta.max_tokens) > 0 ? { max_output: meta.max_tokens } : {}),
      });
    }
    if (rows.length === 0) drift("no token-billed rows in the models API");
    const notes = [...skipped.entries()].map(([why, ids]) => `${why}: ${ids.length} row(s), e.g. ${ids.slice(0, 3).join(", ")}`);
    return { rows: { deepinfra: rows }, notes: { deepinfra: notes } };
  },
};
