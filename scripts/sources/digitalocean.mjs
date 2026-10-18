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
 * **The join is a hand-written name map, and that is the honest shape here.**
 * The page states no API ids — the links on its model names go to the upstream
 * vendor's docs (Anthropic, OpenAI, Hugging Face), not to DO's — and both
 * candidate id sources answer 401 without a key: `inference.do-ai.run/v1/models`
 * and `api.digitalocean.com/v2/gen-ai/models`. So a display name is the only
 * join key the page offers, and `IDS` below is that join, written out rather
 * than guessed by normalisation. A name the map does not carry is reported in
 * the notes and skipped; it cannot invent a row.
 *
 * **Membership is `intersect`, deliberately.** The seed and the page have
 * drifted apart: the page prices 66 models, the seeded entry carries 84 rows,
 * and the ones outside the map are mostly retired (Claude 3.x, GPT-5.1 Codex
 * Max, the embedding rows) rather than mispriced. Rebuilding the catalogue from
 * this page — dropping the retired rows and adding the 20-odd new ones — is a
 * separate, reviewed piece of work. This adapter pins the rows the two lists
 * agree on and leaves the rest where the seed put them, by the decision dated
 * 2026-10-18. `seeded` stays until that rebuild.
 *
 * Cache writes are not owned. Anthropic's rows price two windows
 * (`Cache write (5m)` beside `Cache write (1h)`) and some OpenAI rows price a
 * plain `Cache write`; the seeded `cache_creation` values already carry the
 * five-minute rate, and `cache_creation_1h` is not a field an adapter may write
 * yet (policy's writable list does not name it). Recording half of a two-window
 * price would state that the other window costs the same, so both are left to
 * the rebuild.
 */
import { getText, drift, decimal, MEMBERSHIP } from "../lib/fetch.mjs";

const URL = "https://docs.digitalocean.com/products/inference/details/pricing/";

/**
 * Page display name -> entry id(s).
 *
 * Most names map one-to-one. `Claude Haiku 4.5` maps to two ids because the
 * seed carries the same model twice (`anthropic-claude-4.5-haiku` and
 * `anthropic-claude-haiku-4.5`, the latter at the right cache-read rate and the
 * former at 1). One page row prices both; leaving the duplicate's wrong cache
 * rate in place because the rebuild will delete one of them would be the wrong
 * trade.
 */
const IDS = {
  // Anthropic Models
  "Claude Fable 5.1": ["anthropic-claude-fable-5.1"],
  "Claude Fable 5": ["anthropic-claude-fable-5"],
  "Claude Haiku 4.5": ["anthropic-claude-4.5-haiku", "anthropic-claude-haiku-4.5"],
  "Claude Opus 5": ["anthropic-claude-opus-5"],
  "Claude Opus 4.8": ["anthropic-claude-opus-4.8"],
  "Claude Opus 4.7": ["anthropic-claude-opus-4.7"],
  "Claude Opus 4.6": ["anthropic-claude-opus-4.6"],
  "Claude Opus 4.5": ["anthropic-claude-opus-4.5"],
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
  "GPT-6 Astra": ["openai-gpt-6-astra"],
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
  membership: MEMBERSHIP.INTERSECT,
  owns: ["in", "out", "cache_read", "long_context"],

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

      const row = { id: null, name, in: input, out };
      const cache = rate(base.cells, "Cache read");
      if (cache !== undefined) row.cache_read = cache;

      if (long) {
        const lcIn = rate(long.cells, "Input");
        const lcOut = rate(long.cells, "Output");
        if (lcIn === undefined || lcOut === undefined) {
          drift(`${name}: the >${long.band.over / 1000}K band has no input/output pair`);
        }
        row.long_context = { over: long.band.over, in: lcIn, out: lcOut };
        const lcCache = rate(long.cells, "Cache read");
        if (lcCache !== undefined) row.long_context.cache_read = lcCache;
      }

      for (const id of IDS[name]) rows.push({ ...row, id });
    }

    if (priced === 0) drift("the page yielded no pricing matrices — the page restructured");
    if (rows.length === 0) drift("none of the page's model names matched the entry's id map");

    const notes = [
      `${priced} priced models on the page; ${rows.length} entry row(s) matched by name and re-priced`,
      "the page states no API ids (both id endpoints answer 401), so the join is the adapter's hand-written name map",
      "cache writes are not owned: the page prices 5m and 1h windows (or a plain cache write), and the seeded values are left alone until the rebuild",
    ];
    if (unmapped.length) notes.push(`no entry id for: ${unmapped.sort().join(", ")}`);
    return { rows: { digitalocean: rows }, notes: { digitalocean: notes } };
  },
};
