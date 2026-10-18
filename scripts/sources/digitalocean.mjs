/**
 * DigitalOcean Gradient AI's serverless prices, from the vendor's own docs page.
 *
 * The page prices each model in a server-rendered `data-label` matrix, one
 * matrix per row and one matrix row per (processing mode, prompt length) pair:
 *
 *   <span role="cell" data-label="Input">$2.00</span>
 *   <span role="cell" data-label="Output">$6.00</span>
 *   <span role="cell" data-label="Cache read">$0.20</span>
 *
 * Three SKUs share the page, and only one of them is the entry's: **Standard**.
 * Fast Mode and Flex Mode are named in the same matrix for some models and are
 * other prices for the same model id; taking the first row regardless would
 * publish whichever SKU happened to be listed first.
 *
 * Prompt length splits a model into bands (`≤ 272K tokens` / `> 272K tokens`).
 * The row carries the cheaper band, as the schema asks, and the band above the
 * threshold goes to `long_context` with the threshold as `over`.
 *
 * **The page is two catalogues.** The serverless tables price the LLMs; the
 * Knowledge Bases section prices the embedding and reranking models in plain
 * `Model | Price` tables ("$0.02 per 1,000,000 tokens"). Both are read: the page
 * pricing a model is the vendor saying it is for sale, so the rebuild does not
 * drop the embedding rows merely because they sit outside the LLM table.
 *
 * **The join is a hand-written name map, and that is the honest shape here.**
 * The page states no API ids — the links on its model names go to the upstream
 * vendor's docs (Anthropic, OpenAI, Hugging Face), not to DO's — and both
 * candidate id sources answer 401 without a key: `inference.do-ai.run/v1/models`
 * and `api.digitalocean.com/v2/gen-ai/models`. So a display name is the only
 * join key the page offers, and `IDS` below is that join, written out rather
 * than guessed by normalisation. A name the map does not carry is reported in
 * the notes and skipped; it cannot invent a row.
 *
 * **Membership is `follow`.** The page is the vendor's own statement of what it
 * sells serverless, and it enumerates the lineup, so the page is the list. The
 * first pass over it was `intersect` by the decision dated 2026-10-18, to pin
 * the rows the seed and the page agreed on while the rest was reviewed; this is
 * the rebuild that decision deferred. The seed carried 84 rows; 66 of them are
 * still on the page and 18 are not — Claude 3.x/3.7/4.1, Opus 4, Sonnet 4,
 * GPT-5.1 Codex Max, GPT Image 2, GLM-5/5.1, Kimi K2.5, three Llama/Mistral
 * rows — mostly retired rather than mispriced. Seven models are new to the
 * entry.
 *
 * **Seven of the new ids are inferred, not stated.** The page carries no API
 * ids and both id endpoints answer 401 without a key, so `IDS` is the join and
 * the new names follow the entry's own convention (`anthropic-claude-haiku-5.5`,
 * `openai-gpt-6.1-sol`, …). The convention is consistent across the seed's 84
 * rows, but it is an inference: the first run with a key should confirm those
 * seven.
 *
 * Cache writes are owned in both windows. Anthropic's rows price
 * `Cache write (5m)` beside `Cache write (1h)` — the schema's `cache_creation`
 * and `cache_creation_1h` — and the GPT-6/5.6 rows price a plain `Cache write`,
 * which is the five-minute field. Recording only one window for the Anthropic
 * rows would claim the other costs the same, which the page explicitly denies.
 */
import { getText, drift, decimal, MEMBERSHIP } from "../lib/fetch.mjs";

const URL = "https://docs.digitalocean.com/products/inference/details/pricing/";

/**
 * Page display name -> entry id(s).
 *
 * Most names map one-to-one. `Claude Haiku 4.5` maps to two ids because the
 * seed carries the same model twice (`anthropic-claude-4.5-haiku` and
 * `anthropic-claude-haiku-4.5`). One page row prices both. Which of the two the
 * API accepts is not stated anywhere without a key, so the rebuild keeps both;
 * the duplicate is recorded for the first keyed check rather than guessed away.
 */
const IDS = {
  // Anthropic Models
  "Claude Fable 5.1": ["anthropic-claude-fable-5.1"],
  "Claude Fable 5": ["anthropic-claude-fable-5"],
  "Claude Haiku 5.5": ["anthropic-claude-haiku-5.5"],
  "Claude Haiku 4.5": ["anthropic-claude-4.5-haiku", "anthropic-claude-haiku-4.5"],
  "Claude Opus 5.5": ["anthropic-claude-opus-5.5"],
  "Claude Opus 5": ["anthropic-claude-opus-5"],
  "Claude Opus 4.8": ["anthropic-claude-opus-4.8"],
  "Claude Opus 4.7": ["anthropic-claude-opus-4.7"],
  "Claude Opus 4.6": ["anthropic-claude-opus-4.6"],
  "Claude Opus 4.5": ["anthropic-claude-opus-4.5"],
  "Claude Sonnet 5.5": ["anthropic-claude-sonnet-5.5"],
  "Claude Sonnet 5": ["anthropic-claude-5-sonnet"],
  "Claude Sonnet 4.6": ["anthropic-claude-4.6-sonnet"],
  "Claude Sonnet 4.5": ["anthropic-claude-4.5-sonnet"],

  // Arcee Models. The page's link (`arcee.ai/trinity#trinity-large-preview`)
  // and the identical three rates are what identify the entry's "Thinking
  // (Public Preview)" row; the display names differ.
  "Trinity Large": ["arcee-trinity-large-thinking"],

  // OpenAI Models
  "gpt-oss-120b": ["openai-gpt-oss-120b"],
  "gpt-oss-20b": ["openai-gpt-oss-20b"],
  "GPT-6.1 Sol": ["openai-gpt-6.1-sol"],
  "GPT-6 Astra": ["openai-gpt-6-astra"],
  "GPT-6 Sol": ["openai-gpt-6-sol"],
  "GPT-6 Luna": ["openai-gpt-6-luna"],
  "GPT-5.6 Sol": ["openai-gpt-5.6-sol"],
  "GPT-5.6 Terra": ["openai-gpt-5.6-terra"],
  "GPT-5.6 Luna": ["openai-gpt-5.6-luna"],
  "GPT-5.5": ["openai-gpt-5.5"],
  "GPT-5.4": ["openai-gpt-5.4"],
  "GPT-5.4 mini": ["openai-gpt-5.4-mini"],
  "GPT-5.4 nano": ["openai-gpt-5.4-nano"],
  "GPT-5.4 pro": ["openai-gpt-5.4-pro"],
  "GPT-5.3-Codex": ["openai-gpt-5.3-codex"],
  "GPT-5.2": ["openai-gpt-5.2"],
  "GPT-5.2 pro": ["openai-gpt-5.2-pro"],
  "GPT-5": ["openai-gpt-5"],
  "GPT-5 mini": ["openai-gpt-5-mini"],
  "GPT-5 nano": ["openai-gpt-5-nano"],
  "GPT-4.1": ["openai-gpt-4.1"],
  "GPT-4o": ["openai-gpt-4o"],
  "GPT-4o mini": ["openai-gpt-4o-mini"],
  "o1": ["openai-o1"],
  "o3": ["openai-o3"],
  "o3-mini": ["openai-o3-mini"],
  "GPT-image-1": ["openai-gpt-image-1"],
  "GPT Image 1.5": ["openai-gpt-image-1.5"],

  // DigitalOcean-Hosted Models
  "Qwen3.8-Max": ["qwen3.8-max"],
  "Qwen 3.5 397B A17B": ["qwen3.5-397b-a17b"],
  "DeepSeek V4.1 Flash": ["deepseek-v4.1-flash"],
  "DeepSeek V4 Pro 0813": ["deepseek-v4-pro-0813"],
  "DeepSeek V4 Flash 0731": ["deepseek-v4-flash-0731"],
  "DeepSeek V4 Pro": ["deepseek-v4-pro"],
  "DeepSeek V4 Flash": ["deepseek-4-flash"],
  "DeepSeek V3.2": ["deepseek-3.2"],
  "Gemma 4": ["gemma-4-31B-it"],
  "MiniMax M2.5 (Public Preview)": ["minimax-m2.5"],
  "Kimi K3": ["kimi-k3"],
  "Kimi K2.6": ["kimi-k2.6"],
  "Llama 4 Maverick 17B 128E Instruct": ["llama-4-maverick"],
  "Ministral 3 14B Instruct": ["mistral-3-14B"],
  "NVIDIA Nemotron 3.5 Super VL": ["nvidia-nemotron-3-super-120b"],
  "Nemotron 3 Ultra": ["nemotron-3-ultra-550b"],
  "Nemotron Nano 3 Omni": ["nemotron-3-nano-omni"],
  "Nemotron Nano 12B v2 VL": ["nemotron-nano-12b-v2-vl"],
  "MiMo V2.5 Pro": ["mimo-v2.5-pro"],
  "GLM-5.3": ["glm-5.3"],
  "GLM-5.3 Flash": ["glm-5.3-flash"],
  "GLM-5.2": ["glm-5.2"],
};

/**
 * Knowledge Bases display name -> entry id. These rows are not in the
 * serverless LLM tables; the same page prices them in the section that bills
 * indexing and retrieval, as "Model | Price" tables. An embedding row bills
 * input only, and the catalogue carries that as `out: "0"`, the shape these
 * rows already had in the seed. `BGE Reranker v2 m3` is billed per reranking
 * token; the entry has always carried that in `in`, and the vendor bills it on
 * the tokens it reranks, so the field is the same one.
 */
const EMBEDDING_IDS = {
  "all-mini-lm-l6-v2": "all-mini-lm-l6-v2",
  "multi-qa-mpnet-base-dot-v1": "multi-qa-mpnet-base-dot-v1",
  "gte-large-en-v1.5": "gte-large-en-v1.5",
  "Qwen3 Embedding 0.6B": "qwen3-embedding-0.6b",
  "BGE-M3": "bge-m3",
  "E5 Large V2": "e5-large-v2",
  "BGE Reranker v2 m3": "bge-reranker-v2-m3",
};

const strip = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The page's `$12.50` -> the row's `12.5`, so a new field is written the way
    the entry writes numbers rather than the way the page pads them. */
const money = (s) => {
  const v = s === undefined ? "" : strip(s);
  if (v === "") return undefined;
  return decimal(v, "price").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

/** `≤ 272K tokens` -> `{above: false, over: 272000}`; `> 272K tokens` ->
    `{above: true, over: 272000}`. `All prompts` is a band with no threshold. */
const bandOf = (label) => {
  if (/^all prompts$/i.test(label)) return { above: false };
  const m = /^(≤|>)?\s*([\d.]+)K\s+tokens$/i.exec(label);
  if (!m) drift(`unreadable prompt-length label "${label}"`);
  return { above: m[1] === ">", over: Math.round(Number(m[2]) * 1000) };
};

export default {
  ids: ["digitalocean"],
  source: URL,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "cache_creation", "cache_creation_1h", "long_context"],

  async read() {
    const html = await getText(URL, { headers: { accept: "text/html" } });
    if (!/Serverless Inference/i.test(html) || !/USD per 1M tokens/i.test(html)) {
      drift("no serverless-inference table with USD per 1M tokens — the page restructured");
    }

    const rows = [];
    const unmapped = [];
    let priced = 0;

    for (const m of html.matchAll(/<tr[\s\S]*?<\/tr>/g)) {
      const cells = (m[0].match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? []).map(strip);
      // LLM tables are Model | Pricing; the hosted table is Provider | Model | Pricing.
      const name = cells.length >= 3 ? cells[1] : cells[0];
      if (!name) continue;

      // One matrix row per processing mode / prompt-length pair.
      const bands = [];
      for (const b of m[0].matchAll(/<span class="gen-ai-pricing-matrix-row" role="row">([\s\S]*?)<\/span><\/span>/g)) {
        const cell = {};
        for (const c of b[1].matchAll(/data-label="([^"]*)">([^<]*)/g)) cell[c[1]] = strip(c[2]);
        if (Object.keys(cell).length) bands.push(cell);
      }
      if (bands.length === 0) continue;
      priced++;

      if (!IDS[name]) {
        unmapped.push(name);
        continue;
      }

      const standard = bands.filter((b) => b["Processing mode"] === "Standard");
      if (standard.length === 0) {
        unmapped.push(`${name} (no Standard rate)`);
        continue;
      }

      let base;
      let long;
      for (const b of standard) {
        const band = bandOf(b["Prompt length"] ?? "");
        if (band.above) long = { band, cells: b };
        else base = { band, cells: b };
      }
      if (!base) {
        unmapped.push(`${name} (no base band)`);
        continue;
      }

      const rate = (cells, label) => money(cells[label]);
      const out = rate(base.cells, "Output");
      const input = rate(base.cells, "Input");
      // The schema wants both directions or neither.
      if (input === undefined || out === undefined) {
        unmapped.push(`${name} (no per-token input/output pair)`);
        continue;
      }

      /** The cache-write columns, whichever pair this row carries. Anthropic's
          rows say `Cache write (5m)` / `Cache write (1h)`; the GPT-6/5.6 rows
          say a plain `Cache write`, which is the five-minute rate. */
      const writes = (cells) => {
        const five = money(cells["Cache write (5m)"] ?? cells["Cache write"]);
        const one = money(cells["Cache write (1h)"]);
        return {
          ...(five !== undefined ? { cache_creation: five } : {}),
          ...(one !== undefined ? { cache_creation_1h: one } : {}),
        };
      };

      const row = { id: null, name, in: input, out };
      const cache = rate(base.cells, "Cache read");
      if (cache !== undefined) row.cache_read = cache;
      Object.assign(row, writes(base.cells));

      if (long) {
        const lcIn = rate(long.cells, "Input");
        const lcOut = rate(long.cells, "Output");
        if (lcIn === undefined || lcOut === undefined) {
          drift(`${name}: the >${long.band.over / 1000}K band has no input/output pair`);
        }
        row.long_context = { over: long.band.over, in: lcIn, out: lcOut };
        const lcCache = rate(long.cells, "Cache read");
        if (lcCache !== undefined) row.long_context.cache_read = lcCache;
        Object.assign(row.long_context, writes(long.cells));
      }

      for (const id of IDS[name]) rows.push({ ...row, id });
    }

    // ── embeddings and reranking, from the Knowledge Bases section ──
    // Their tables are `Model | Price` with a per-token sentence; the LLM
    // tables above have a "Serverless Inference" column instead, so the header
    // is what tells the two shapes apart.
    let simple = 0;
    for (const table of html.match(/<table[\s\S]*?<\/table>/g) ?? []) {
      const trs = (table.match(/<tr[\s\S]*?<\/tr>/g) ?? []).map((r) =>
        (r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) ?? []).map(strip),
      );
      const head = trs[0] ?? [];
      if (!/^model$/i.test(head[0] ?? "") || !/^price$/i.test(head[1] ?? "")) continue;
      for (const cells of trs.slice(1)) {
        const name = cells[0];
        // "per 1M input tokens", "per 1,000,000 tokens", "per 1M reranking
        // tokens" — the wording varies within the one section.
        const m = /^\$([0-9.]+)\s+per\s+(?:1M|1,000,000)\s+(?:(?:input|reranking)\s+)?tokens$/i.exec(
          cells[1] ?? "",
        );
        if (!m) continue;
        const id = EMBEDDING_IDS[name];
        if (!id) {
          unmapped.push(name);
          continue;
        }
        rows.push({ id, name, in: money(m[1]), out: "0" });
        simple++;
      }
    }
    if (simple === 0) drift("no embedding/reranking pricing table — the Knowledge Bases section restructured");

    if (priced === 0) drift("the page yielded no pricing matrices — the page restructured");
    if (rows.length === 0) drift("none of the page's model names matched the entry's id map");

    const notes = [
      `${priced} priced serverless models and ${simple} embedding/reranking rows on the page; ${rows.length} entry row(s) after the name join`,
      "the page states no API ids (both id endpoints answer 401), so the join is the adapter's hand-written name map",
      "seven new ids (Claude Haiku/Opus/Sonnet 5.5, GPT-6 Sol/Luna/6.1 Sol, GPT-image-1) follow the entry's own naming convention and are inferred, not vendor-stated",
      "cache writes: `Cache write (5m)` -> cache_creation, `Cache write (1h)` -> cache_creation_1h; a plain `Cache write` is the five-minute rate",
      "Claude Haiku 4.5 is one page row and two seeded ids; both are kept because which id the API accepts is not stated without a key",
      "embedding and reranking rows are priced in the Knowledge Bases section, not the serverless table, and carry `out: \"0\"`",
    ];
    if (unmapped.length) notes.push(`no entry id for: ${unmapped.sort().join(", ")}`);
    return { rows: { digitalocean: rows }, notes: { digitalocean: notes } };
  },
};
