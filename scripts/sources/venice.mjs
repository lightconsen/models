/**
 * Venice's prices, from its own public models API — no key, no page.
 *
 * `api.venice.ai/api/v1/models` is the OpenAI-style catalogue the pricing page
 * renders from, and it answers without a key. Checked 2026-11-24: it returns
 * **the same 147 text models, at the same prices, as `docs.venice.ai/pricing.md`**
 * — every base rate and all 31 long-context rows compared cell for cell, zero
 * differences — while also carrying what the page has no room for: the context
 * window, the max output, and the capability flags. So the API is the source and
 * the rate card is the corroboration; a card the API disagrees with would be the
 * thing to report, not to prefer.
 *
 * **`diem` is not a currency to convert.** Every price arrives twice, `usd` and
 * `diem`, at the same number — Venice's own token, pegged 1:1 and spendable in
 * the same wallet. `usd` is the one transcribed; the entry is `currency: "USD"`
 * and `diem` is a payment rail, not a separate rate.
 *
 * **`ID` is the string the API accepts**, and it is Venice's own spelling
 * throughout, never the upstream vendor's: `openai-gpt-55` rather than `gpt-5.5`,
 * `zai-org-glm-5` rather than `glm-5`, `claude-fable-5-2` rather than
 * `claude-fable-5.2`. That is why no row here needs a `serves` mapping — a
 * client asking this address sends exactly the id this catalogue stores.
 *
 * **This is an `aggregate`, and it carries every row the API prices.** The
 * catalogue spans the models Venice hosts itself (the `venice-*` pair, the
 * abliterated and uncensored variants, the `e2ee-*` private ones) beside the
 * ones it resells (Claude, GPT, Gemini, Grok, GLM, Kimi, Qwen, DeepSeek). That
 * is the `openrouter` shape, not the `perplexity` one: OpenRouter is `aggregate`
 * with `follow` over its whole catalogue because its list is its complete
 * statement of what it sells, and Perplexity is `official` with `intersect`
 * because it is a model vendor carrying the four models it hosts. Venice sells
 * 147 ids at one address and a client that calls it needs all 147 prices, so the
 * list is the membership. Whether a row duplicates a price another entry already
 * holds is reported every run and decided nowhere: on 2026-11-24, 7 of the 147
 * resolve to an id an upstream entry here also carries and the other 140 are ids
 * no entry in this catalogue holds.
 *
 * **Long context is the `extended` block, not a multiplier.** 31 rows carry
 * `pricing.extended` with a `context_token_threshold` and the four rates that
 * apply once a request's input passes it; that is `long_context.over` and the
 * four rates, transcribed. The vendor states the whole-request rule the same way
 * OpenAI does — the higher rates apply to everything, not just the excess.
 *
 * **An absent rate is absent.** 108 rows price no cache write and 22 no cache
 * read; the API simply omits the key, so the row keeps no such field rather than
 * a zero the vendor never stated. 16 rows price an hour-long cache write apart
 * from the five-minute one (`cache_write_1h`), which is the row's
 * `cache_creation_1h`.
 *
 * **Capabilities are true only.** The API states every flag as a boolean on
 * every row, which is the vendor saying no as well as yes — so `true` is written
 * and `false` is left absent, the rule this catalogue applies everywhere: a
 * field's absence means the vendor does not say, and here it does say, so a
 * `false` is simply not the same claim as `true` and the schema has no way to
 * carry it. The modality pair is assembled from `supportsVision` (image),
 * `supportsAudioInput` (audio), `supportsVideoInput` (video) on top of the
 * `text` every text model takes and returns.
 */
import { drift, MEMBERSHIP, readEntry } from "../lib/fetch.mjs";

const API = "https://api.venice.ai/api/v1/models";

/** The API's floats are already the vendor's decimals (`0.1`, `0.0039`); a
    stray binary artefact would arrive as `0.30000000000000004` and six
    decimals is Venice's own display precision, so rounding to it is
    transcription rather than alteration. */
const clean = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return String(Math.round(n * 1_000_000) / 1_000_000);
};

const rate = (b) => clean(b?.usd);

/** The modality pair spelled the catalogue's way: `text` always, plus whatever
    the capability flags say this model accepts. Sorted for stability. */
const modalitiesOf = (caps) => {
  const input = ["text"];
  if (caps?.supportsVision === true) input.push("image");
  if (caps?.supportsAudioInput === true) input.push("audio");
  if (caps?.supportsVideoInput === true) input.push("video");
  return { input: input.sort(), output: ["text"] };
};

export default {
  ids: ["venice"],
  source: API,
  membership: MEMBERSHIP.FOLLOW,
  owns: [
    "in", "out", "cache_read", "cache_creation", "cache_creation_1h", "long_context",
    "context", "max_output", "reasoning", "tool_call", "structured_output", "modalities",
  ],

  async read() {
    const res = await fetch(API, { headers: { "user-agent": "Mozilla/5.0 (compatible; kiwano-price-check)" } });
    if (!res.ok) drift(`${API}: HTTP ${res.status}`);
    const body = await res.json();
    const models = body?.data;
    if (!Array.isArray(models) || models.length === 0) drift("the models API returned no data array");

    const rows = [];
    const skipped = [];
    for (const m of models) {
      // The endpoint serves one surface; a non-text type would be billed by
      // another measure and has no token rate to carry.
      if (m?.type !== "text") { skipped.push(`${m?.id} (${m?.type})`); continue; }
      const p = m?.model_spec?.pricing ?? {};
      const inRate = rate(p.input);
      const outRate = rate(p.output);
      // Every text row states both; one that stopped would be a reshaped
      // catalogue, not a model billed some other way.
      if (inRate === undefined || outRate === undefined) {
        drift(`${m.id}: the ${inRate === undefined ? "input" : "output"} rate is missing from the API`);
      }
      const caps = m?.model_spec?.capabilities ?? {};
      const read = rate(p.cache_input);
      const write = rate(p.cache_write);
      const write1h = rate(p.cache_write_1h);
      const row = {
        id: m.id,
        name: m?.model_spec?.name || m.id,
        in: inRate,
        out: outRate,
        ...(read !== undefined ? { cache_read: read } : {}),
        ...(write !== undefined ? { cache_creation: write } : {}),
        ...(write1h !== undefined ? { cache_creation_1h: write1h } : {}),
        ...(Number.isInteger(m.context_length) && m.context_length > 0 ? { context: m.context_length } : {}),
        ...(Number.isInteger(m?.model_spec?.maxCompletionTokens) && m.model_spec.maxCompletionTokens > 0
          ? { max_output: m.model_spec.maxCompletionTokens }
          : {}),
        ...(caps.supportsReasoning === true ? { reasoning: true } : {}),
        ...(caps.supportsFunctionCalling === true ? { tool_call: true } : {}),
        ...(caps.supportsResponseSchema === true ? { structured_output: true } : {}),
        modalities: modalitiesOf(caps),
      };
      const ext = p.extended;
      if (ext) {
        const over = ext.context_token_threshold;
        const lIn = rate(ext.input);
        const lOut = rate(ext.output);
        if (!Number.isInteger(over) || over <= 0) drift(`${m.id}: extended.context_token_threshold is not a positive whole number`);
        if (lIn === undefined || lOut === undefined) drift(`${m.id}: the extended block states no ${lIn === undefined ? "input" : "output"} rate`);
        const lRead = rate(ext.cache_input);
        const lWrite = rate(ext.cache_write);
        const lWrite1h = rate(ext.cache_write_1h);
        row.long_context = {
          over,
          in: lIn,
          out: lOut,
          ...(lRead !== undefined ? { cache_read: lRead } : {}),
          ...(lWrite !== undefined ? { cache_creation: lWrite } : {}),
          ...(lWrite1h !== undefined ? { cache_creation_1h: lWrite1h } : {}),
        };
      }
      rows.push(row);
    }
    if (rows.length === 0) drift("no text rows in the models API");

    // Which rows another entry in this catalogue already carries under its own
    // vendor. Reported, not decided: the count is what makes "should this entry
    // hold 147 resale rows" a question a reader can see.
    const VENDOR_ENTRY = { anthropic: "anthropic", openai: "openai", google: "google-gemini", xai: "xai", zai: "zhipu-glm", kimi: "kimi", deepseek: "deepseek", qwen: "alibaba", minimax: "minimax" };
    const own = new Set();
    for (const m of rows) {
      for (const [prefix, entry] of Object.entries(VENDOR_ENTRY)) {
        let bare = null;
        if (prefix === "openai" && m.id.startsWith("openai-")) bare = m.id.slice("openai-".length);
        else if (prefix === "anthropic" && m.id.startsWith("claude-")) bare = m.id;
        else if (prefix === "google" && m.id.startsWith("gemini-")) bare = m.id;
        else if (prefix === "xai" && m.id.startsWith("grok-")) bare = m.id;
        else if (prefix === "deepseek" && m.id.startsWith("deepseek-")) bare = m.id;
        else if (prefix === "kimi" && m.id.startsWith("kimi-")) bare = m.id;
        else if (prefix === "qwen" && m.id.startsWith("qwen")) bare = m.id;
        else if (prefix === "minimax" && m.id.startsWith("minimax")) bare = m.id;
        else if (prefix === "zai" && /glm/.test(m.id)) bare = m.id;
        if (!bare) continue;
        try {
          if (readEntry(entry).models.some((x) => x.id === bare || x.id === m.id)) own.add(m.id);
        } catch {
          // no such entry: this row cannot duplicate it
        }
        break;
      }
    }

    const lcCount = rows.filter((r) => r.long_context).length;
    return {
      rows: { venice: rows },
      notes: {
        venice: [
          `${rows.length} text models priced (${lcCount} with long-context rates, ${rows.filter((r) => r.cache_creation_1h).length} with a 1-hour cache-write rate)`,
          `${own.size} of them are models another entry in this catalogue also carries — the other ${rows.length - own.size} are ids no entry here holds`,
          ...(skipped.length ? [`not carried (no token rate): ${skipped.join(", ")}`] : []),
        ],
      },
    };
  },
};
