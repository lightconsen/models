/**
 * Baseten's Model API rates, from each model's own page in the vendor's library.
 *
 * The pricing page (`baseten.co/pricing`) has a Model API table, but it is not
 * the catalogue: on 2026-10-18 it listed 16 models while three more with a
 * Model API rate had library pages of their own (`DeepSeek-V3.1`, `Inkling`,
 * `DeepSeek-V4-Pro`), and two pages the entry carries (`Inkling Small`, `GLM 5`)
 * had no Model API pricing at all. So membership is not taken from the table;
 * this pass is `intersect`, re-pricing the rows whose pages state a rate and
 * leaving the rest where the 2026-09-24 review put them.
 *
 * Each library page carries the rate in a small labelled block:
 *
 *   <h3>Model API pricing</h3><p>Per 1M tokens</p>
 *   <li><strong>Input</strong><div><span>$1.40</span></div></li>
 *   <li><strong>Cache input</strong><div><span>$0.14</span></div></li>
 *   <li><strong>Output</strong><div><span>$4.40</span></div></li>
 *
 * A page without that block sells the model for dedicated deployment only, and
 * is skipped rather than priced from anything else.
 *
 * **The join is a hand-written slug map.** The library URL slug is not derivable
 * from the entry id (`deepseek-v41-flash` is `deepseek-ai/DeepSeek-V4.1-Flash`;
 * `nvidia-nemotron-ultra` is `nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B`), and
 * the model path the API accepts is not on the page. The map below is that
 * join; the Hugging Face link on each page agrees with it where the page has
 * one (`inkling` links `thinkingmachines/Inkling`, `glm-5.2` has no link at
 * all), so the map is the only key that covers every row.
 *
 * The pages the adapter does not carry are reported, not guessed:
 *   - `thinkingmachines/inkling-small` and `zai-org/GLM-5` have no Model API
 *     price page, so their seeded rates stay (the 2026-09-24 decision);
 *   - the live pages the entry has no id for (`Beam`, `Muse Spark Open`,
 *     `DeepSeek V4.1 Flash 1017`, `DeepSeek V4.1 Flash Fast`,
 *     `DeepSeek V4-Pro`, `Nemotron 3.5 Super VL`) are left to a membership
 *     pass, because the vendor publishes no complete, keyless list of them.
 */
import { getText, drift, decimal, MEMBERSHIP } from "../lib/fetch.mjs";

const SOURCE = "https://www.baseten.co/library/";
const LIBRARY = (slug) => `https://www.baseten.co/library/${slug}/`;

/** Library slug -> the id the entry (and the API) uses. */
const IDS = {
  "deepseek-v3-1": "deepseek-ai/DeepSeek-V3.1",
  "deepseek-v4-flash-0731": "deepseek-ai/DeepSeek-V4-Flash-0731",
  "deepseek-v4-pro-0813": "deepseek-ai/DeepSeek-V4-Pro-0813",
  "deepseek-v41-flash": "deepseek-ai/DeepSeek-V4.1-Flash",
  "glm-52": "zai-org/GLM-5.2",
  "glm-52-fast": "zai-org/GLM-5.2-Fast",
  "glm-53": "zai-org/GLM-5.3",
  "glm-53-fast": "zai-org/GLM-5.3-Fast",
  "glm-53-flash": "zai-org/GLM-5.3-Flash",
  "gpt-oss-120b": "openai/gpt-oss-120b",
  inkling: "thinkingmachines/inkling",
  "kimi-k3": "moonshotai/Kimi-K3",
  "nvidia-nemotron-ultra": "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B",
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

/** `$0.30` -> `0.3`, the way the entry writes numbers. */
const money = (s) => {
  const v = strip(s);
  if (!/\$/.test(v)) return undefined;
  return decimal(v, "price").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

/** The Model API block, or null when the page prices no per-token API. */
const modelApiRates = (html) => {
  const at = html.indexOf("Model API pricing");
  if (at < 0) return null;
  const block = html.slice(at, at + 4000);
  const cells = {};
  for (const m of block.matchAll(/<strong[^>]*>([^<]+)<\/strong><div><span[^>]*>([^<]+)<\/span>/g)) {
    cells[strip(m[1])] = m[2];
  }
  const input = money(cells.Input ?? "");
  const out = money(cells.Output ?? "");
  // The schema wants both directions or neither.
  if (input === undefined || out === undefined) return null;
  const cache = money(cells["Cache input"] ?? "");
  return { in: input, out, ...(cache !== undefined ? { cache_read: cache } : {}) };
};

export default {
  ids: ["baseten"],
  source: SOURCE,
  membership: MEMBERSHIP.INTERSECT,
  owns: ["in", "out", "cache_read"],

  async read() {
    const rows = [];
    const unread = [];
    for (const [slug, id] of Object.entries(IDS)) {
      const html = await getText(LIBRARY(slug), { headers: { accept: "text/html" } });
      const rates = modelApiRates(html);
      if (!rates) {
        unread.push(`${slug} (${id})`);
        continue;
      }
      rows.push({ id, name: id, ...rates });
    }
    if (rows.length === 0) drift("no library page carried a Model API pricing block — the pages restructured");

    const notes = [
      `${rows.length} Model API pages read from the vendor's library`,
      "membership is intersect: the pricing page is not the catalogue (it omits three pages that carry a Model API rate), and the library has no complete keyless list",
    ];
    if (unread.length) notes.push(`no Model API pricing block, row left as seeded: ${unread.join(", ")}`);
    notes.push(
      "entry rows with no page here stay seeded: thinkingmachines/inkling-small, zai-org/GLM-5; " +
        "live pages the entry has no id for (Beam, Muse Spark Open, DeepSeek V4.1 Flash 1017/Fast, DeepSeek V4-Pro, Nemotron 3.5 Super VL) are for a membership pass",
    );
    return { rows: { baseten: rows }, notes: { baseten: notes } };
  },
};
