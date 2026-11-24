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

/** The per-token rate block, or null when the page prices no per-token API.
 *
 *  Two shapes are on the live pages. Until 2026-11 the block was an <h3> "Model
 *  API pricing" followed by <strong>label</strong><div><span>$x</span>; the
 *  November redesign moved it into the page's details rail, titled
 *  "Pricing per 1M tokens", as <dt>label</dt><dd>$x</dd>. The rail sits beside
 *  a "Training pricing per 1M tokens" block of the same shape — those are
 *  training rates, not API rates — so the read is scoped to the block that
 *  starts at the API heading and ends at the next heading. Reading only the
 *  old shape against the new page found nothing on any model and reported the
 *  whole family as restructured. */
const API_HEADINGS = ["Model API pricing", "Pricing per 1M tokens"];
const modelApiRates = (html) => {
  const at = API_HEADINGS.map((h) => html.indexOf(h)).find((i) => i >= 0);
  if (at === undefined) return null;
  const rest = html.slice(at);
  // The block ends at the next rail heading; 4000 chars is the old bound and
  // still covers the largest API block seen.
  const nextH = rest.search(/<h[23][^>]*>/);
  const block = rest.slice(0, nextH > 0 ? nextH : Math.min(rest.length, 4000));
  const cells = {};
  for (const m of block.matchAll(/<dt[^>]*>([^<]+)<\/dt><dd[^>]*>([^<]*)<\/dd>/g)) cells[strip(m[1])] = m[2];
  for (const m of block.matchAll(/<strong[^>]*>([^<]+)<\/strong><div><span[^>]*>([^<]+)<\/span>/g)) cells[strip(m[1])] ??= m[2];
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
    const broken = [];
    for (const [slug, id] of Object.entries(IDS)) {
      // One dead slug must not cost the other twelve their re-price. A retired
      // model's library page 404s while the entry still carries its last
      // seeded rate, and before this loop tolerated that, `deepseek-v3-1`
      // taking the whole adapter down every run. The row is intersect
      // membership's to keep, so the miss is reported rather than fatal — but
      // a run where nothing at all reads is still a drift, below.
      let html;
      try {
        html = await getText(LIBRARY(slug), { headers: { accept: "text/html" } });
      } catch (err) {
        broken.push(`${slug} (${id}): ${err.message}`);
        continue;
      }
      const rates = modelApiRates(html);
      if (!rates) {
        unread.push(`${slug} (${id})`);
        continue;
      }
      rows.push({ id, name: id, ...rates });
    }
    if (rows.length === 0) drift(`no library page carried a Model API pricing block — the pages restructured or moved (${broken.length} of ${Object.keys(IDS).length} pages unreadable)`);

    const notes = [
      `${rows.length} Model API pages read from the vendor's library`,
      "membership is intersect: the pricing page is not the catalogue (it omits three pages that carry a Model API rate), and the library has no complete keyless list",
    ];
    if (unread.length) notes.push(`no Model API pricing block, row left as seeded: ${unread.join(", ")}`);
    if (broken.length) notes.push(`page unreachable, row left as seeded: ${broken.join(", ")}`);
    notes.push(
      "entry rows with no page here stay seeded: thinkingmachines/inkling-small, zai-org/GLM-5; " +
        "live pages the entry has no id for (Beam, Muse Spark Open, DeepSeek V4.1 Flash 1017/Fast, DeepSeek V4-Pro, Nemotron 3.5 Super VL) are for a membership pass",
    );
    return { rows: { baseten: rows }, notes: { baseten: notes } };
  },
};
