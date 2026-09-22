/**
 * Novita AI's prices, from its own public models API — no key, no page.
 *
 * `api.novita.ai/v3/openai/models` is the catalogue the docs' pricing page
 * renders from: each chat model carries `pricing` in two shapes at once, an
 * integer per-million in some internal unit (`price_per_m: 1500`) and the
 * vendor's own decimal spelling of the same number (`price_per_m_decimal:
 * "0.15"`). The decimal string is the rate as the vendor bills it, so that is
 * the one transcribed — deriving it from the integer would mean guessing the
 * unit, which is the one thing this file must not do.
 *
 * `model_type` is `"chat"` for every row the API serves through this endpoint,
 * which is also the filter: the audio and image surfaces are billed elsewhere,
 * with no token rate to carry. `features` is the vendor's own capability list
 * (`function-calling`, `reasoning`, `structured-outputs`), so those flags are
 * true only — a feature the list omits stays absent rather than false, the way
 * this catalogue writes capabilities everywhere else.
 */
import { drift, MEMBERSHIP } from "../lib/fetch.mjs";

const API = "https://api.novita.ai/v3/openai/models";

export default {
  ids: ["novita"],
  source: API,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "context", "max_output", "reasoning", "tool_call", "structured_output"],

  async read() {
    const res = await fetch(API, { headers: { "user-agent": "Mozilla/5.0 (compatible; kiwano-price-check)" } });
    if (!res.ok) drift(`${API}: HTTP ${res.status}`);
    const body = await res.json();
    const models = body?.data;
    if (!Array.isArray(models) || models.length === 0) drift("the models API returned no data array");

    const rows = [];
    let skipped = 0;
    for (const m of models) {
      if (m?.model_type !== "chat") { skipped++; continue; }
      const p = m.pricing ?? {};
      const row = {
        id: m.id,
        name: m.display_name || m.id,
        in: p.prompt?.price_per_m_decimal,
        out: p.completion?.price_per_m_decimal,
        ...(p.input_cache_read?.price_per_m_decimal != null ? { cache_read: p.input_cache_read.price_per_m_decimal } : {}),
        ...(Number.isInteger(m.context_size) && m.context_size > 0 ? { context: m.context_size } : {}),
        ...(Number(m.max_output_tokens) > 0 ? { max_output: m.max_output_tokens } : {}),
        ...(m.features?.includes("function-calling") ? { tool_call: true } : {}),
        ...(m.features?.includes("reasoning") ? { reasoning: true } : {}),
        ...(m.features?.includes("structured-outputs") ? { structured_output: true } : {}),
      };
      if (row.in === undefined || row.out === undefined) { skipped++; continue; }
      rows.push(row);
    }
    if (rows.length === 0) drift("no priced chat rows in the models API");
    return {
      rows: { novita: rows },
      notes: { novita: skipped ? [`${skipped} row(s) skipped — non-chat or unpriced`] : [] },
    };
  },
};
