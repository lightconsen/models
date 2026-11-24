/**
 * Chutes' prices, from its own public models API — no key, no page.
 *
 * `llm.chutes.ai/v1/models` is the OpenAI-compatible catalogue the site's
 * `/models` page renders from. It is the rare source that gives everything at
 * once: `pricing` in **per-million dollars** (the site prints `$0.04 in` where
 * the API carries `0.039`, so the number is taken as it is rather than moved by
 * six places the way a per-token feed has to be), the context window, the max
 * output, both modality directions, and a feature list.
 *
 * **The rates are floats, not strings.** `0.003899999999999999` is what the API
 * returns for a rate the site prints as `$0.0039` — binary noise around the
 * decimal the vendor meant. Six decimals is the vendor's own display precision,
 * so rounding to it is transcription rather than alteration.
 *
 * The site's `/models` page and the API disagree on the size of the catalogue
 * (33 public models against 22 in this feed) because the page counts the image,
 * video and speech chutes as well. This feed is the text one, which is also the
 * filter: `output_modalities` is `["text"]` on every row here, and a chute that
 * answers in anything else is billed by another measure and has no token rate to
 * carry.
 *
 * `supported_features` is the vendor's own list (`tools`, `structured_outputs`,
 * `reasoning`, `json_mode`), so those flags are true only — a feature the list
 * omits stays absent rather than false, the way this catalogue writes
 * capabilities everywhere else. `supported_sampling_parameters` carries
 * `temperature` on the rows that take one.
 *
 * Two of Chutes' rows are third-party chutes rather than its own (`vonkaiser/…`),
 * hosted on the platform at the platform's price. They are rows of this entry
 * for the same reason the rest are: this address prices what it prices.
 */
import { drift, MEMBERSHIP } from "../lib/fetch.mjs";

const API = "https://llm.chutes.ai/v1/models";

/** The modality pair, sorted — Chutes does not keep a stable order, and an
    incidental reorder would read as a change on every sync. */
const modalitiesOf = (m) => {
  const dir = (k) => {
    const v = m?.[k];
    if (!Array.isArray(v) || v.length === 0) return null;
    return [...new Set(v)].sort();
  };
  const input = dir("input_modalities");
  const output = dir("output_modalities");
  return input && output ? { input, output } : null;
};

/** Binary noise around the vendor's own decimal — see the header. */
const clean = (v) => String(Math.round(v * 1_000_000) / 1_000_000);

export default {
  ids: ["chutes"],
  source: API,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "context", "max_output", "modalities", "reasoning", "tool_call", "structured_output", "temperature"],

  async read() {
    const res = await fetch(API, { headers: { "user-agent": "Mozilla/5.0 (compatible; kiwano-price-check)" } });
    if (!res.ok) drift(`${API}: HTTP ${res.status}`);
    const body = await res.json();
    const models = body?.data;
    if (!Array.isArray(models) || models.length === 0) drift("the models API returned no data array");

    const rows = [];
    let skipped = 0;
    for (const m of models) {
      const p = m?.pricing ?? {};
      const outs = Array.isArray(m?.output_modalities) ? m.output_modalities : [];
      if (outs.length > 0 && !outs.every((x) => x === "text")) { skipped++; continue; }
      if (p.prompt == null || p.completion == null) { skipped++; continue; }
      const feats = Array.isArray(m.supported_features) ? m.supported_features : [];
      const params = Array.isArray(m.supported_sampling_parameters) ? m.supported_sampling_parameters : [];
      const mods = modalitiesOf(m);
      rows.push({
        id: m.id,
        name: m.id,
        in: clean(p.prompt),
        out: clean(p.completion),
        ...(p.input_cache_read != null ? { cache_read: clean(p.input_cache_read) } : {}),
        ...(Number.isInteger(m.context_length) && m.context_length > 0 ? { context: m.context_length } : {}),
        ...(Number(m.max_output_length) > 0 ? { max_output: m.max_output_length } : {}),
        ...(mods ? { modalities: mods } : {}),
        ...(feats.includes("reasoning") ? { reasoning: true } : {}),
        ...(feats.includes("tools") ? { tool_call: true } : {}),
        ...(feats.includes("structured_outputs") ? { structured_output: true } : {}),
        ...(params.includes("temperature") ? { temperature: true } : {}),
      });
    }
    if (rows.length === 0) drift("no text-out rows in the models API");
    return {
      rows: { chutes: rows },
      notes: { chutes: skipped ? [`${skipped} row(s) skipped — not text-out or unpriced`] : [] },
    };
  },
};
