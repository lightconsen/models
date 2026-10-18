/**
 * SiliconFlow's international per-token prices, from the Framer pricing page.
 *
 * This is the intl arm of the platform whose CN address (siliconflow.cn) has
 * its own adapter, `siliconflow.mjs`; the two bill in different currencies and
 * at different rates, so they are two entries and two readers. The intl page
 * is a Framer site: the rows are server-rendered per vendor as `LLM - Desktop`
 * components, each with a repeated text sequence
 *
 *   DeepSeek-V4.1-Flash | 1049K | $ | 0.15 | $ | 0.003 | $ | 0.6 | Details
 *
 * and each vendor section ends in a client-side "Load More". So the page
 * states a subset at fetch time — 27 models on 2026-10-18 — and the rest are
 * not in the served HTML at all. This pass is therefore `intersect`: re-price
 * the rows the page states, leave the rest where the 2026-09-23 review put
 * them, and record that the page's own subset is the limit.
 *
 * Two figures mean Input/Output; three mean Input/Cached Input/Output, the
 * order the table header states. A model whose name has no id in the entry is
 * reported rather than invented; on 2026-10-18 that was `DeepSeek-V4.1-Flash`,
 * whose row was added by hand at the page's rate with the id spelling the
 * catalogue's other entries use, and is now in the map below.
 *
 * The page's rates disagree with the seed wherever they can be compared, which
 * is the point of the pass: `gemma-4-31B-it` is 0.75 / 1.0 on the page against
 * the seed's 0.13 / 0.4, and `Qwen3.6-35B-A3B` is 0.24 / 1.8 with a 0.15 cache
 * rate against 0.2 / 1.6. Those are corrections, not a different catalogue.
 */
import { getText, drift, MEMBERSHIP } from "../lib/fetch.mjs";

const URL = "https://www.siliconflow.com/pricing";

/** Page display name -> entry id. The page states display names, not ids. */
const IDS = {
  "DeepSeek-V4-Flash-0731": "deepseek-ai/DeepSeek-V4-Flash-0731",
  "DeepSeek-V4-Flash-Vision-Exp": "deepseek-ai/DeepSeek-V4-Flash-Vision-Exp",
  "DeepSeek-V4-Pro": "deepseek-ai/DeepSeek-V4-Pro",
  "DeepSeek-V4-Pro-0813": "deepseek-ai/DeepSeek-V4-Pro-0813",
  "DeepSeek-V4.1-Flash": "deepseek-ai/DeepSeek-V4.1-Flash",
  "GLM-5": "zai-org/GLM-5",
  "GLM-5.1": "zai-org/GLM-5.1",
  "GLM-5.2": "zai-org/GLM-5.2",
  "GLM-5.3": "zai-org/GLM-5.3",
  "GLM-5.3-Flash": "zai-org/GLM-5.3-Flash",
  "Hunyuan-A13B-Instruct": "tencent/Hunyuan-A13B-Instruct",
  Hy3: "tencent/Hy3",
  "Kimi-K2.5": "moonshotai/Kimi-K2.5",
  "Kimi-K2.6": "moonshotai/Kimi-K2.6",
  "Kimi-K2.7-Code": "moonshotai/Kimi-K2.7-Code",
  "Kimi-K3": "moonshotai/Kimi-K3",
  "MiniMax-M3": "MiniMaxAI/MiniMax-M3",
  "Qwen3.5-122B-A10B": "Qwen/Qwen3.5-122B-A10B",
  "Qwen3.5-9B": "Qwen/Qwen3.5-9B",
  "Qwen3.6-27B": "Qwen/Qwen3.6-27B",
  "Qwen3.6-35B-A3B": "Qwen/Qwen3.6-35B-A3B",
  "Qwen3.8-2.4T-A95B": "Qwen/Qwen3.8-2.4T-A95B",
  "gemma-4-12B-it": "google/gemma-4-12B-it",
  "gemma-4-26B-A4B-it": "google/gemma-4-26B-A4B-it",
  "gemma-4-31B-it": "google/gemma-4-31B-it",
  "gpt-oss-120b": "openai/gpt-oss-120b",
  "gpt-oss-20b": "openai/gpt-oss-20b",
};

const strip = (s) =>
  s
    .replace(/<[^>]+>/g, "|")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\|+/g, "|");

const money = (s) => {
  const v = String(s).trim();
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(v)) return undefined;
  return v.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

export default {
  ids: ["siliconflow"],
  source: URL,
  membership: MEMBERSHIP.INTERSECT,
  owns: ["in", "out", "cache_read"],

  async read() {
    const html = await getText(URL, { headers: { accept: "text/html" } });

    // Each desktop row component carries its values in one repeated sequence.
    const starts = [...html.matchAll(/data-framer-name="LLM - Desktop"/g)].map((m) => m.index);
    if (starts.length === 0) drift("no 'LLM - Desktop' rows — the page restructured");

    const rows = [];
    const unmapped = [];
    const seen = new Set();
    for (let i = 0; i < starts.length; i++) {
      const seg = html.slice(starts[i], starts[i + 1] ?? html.length);
      const tokens = strip(seg)
        .split("|")
        .map((t) => t.trim())
        .filter(Boolean);
      const at = tokens.findIndex((t) => /^\d+K$/.test(t));
      if (at <= 0) continue;
      const name = tokens[at - 1];
      if (seen.has(name)) continue;
      seen.add(name);

      // The values are `$`, number, `$`, number, … until the Details link.
      const figures = [];
      for (let j = at + 1; j < tokens.length && tokens[j] !== "Details"; j++) {
        if (tokens[j] === "$") {
          const v = money(tokens[j + 1] ?? "");
          if (v !== undefined) {
            figures.push(v);
            j++;
          }
        }
      }
      if (figures.length !== 2 && figures.length !== 3) continue;

      const id = IDS[name];
      if (!id) {
        unmapped.push(`${name} (${figures.join(" / ")})`);
        continue;
      }
      const row = { id, name, in: figures[0], out: figures[figures.length - 1] };
      if (figures.length === 3) row.cache_read = figures[1];
      rows.push(row);
    }

    if (rows.length === 0) drift("the page's rows yielded no priced models — the layout changed");

    const notes = [
      `${seen.size} models server-rendered on the intl page, ${rows.length} matched to the entry`,
      "the page loads the rest of each vendor section behind a client-side 'Load More'; those rows are not in the served HTML and are left untouched",
      "the page states display names, not API ids, so the join is the adapter's hand-written map",
    ];
    if (unmapped.length) notes.push(`no entry id for: ${unmapped.join(", ")}`);
    return { rows: { siliconflow: rows }, notes: { siliconflow: notes } };
  },
};
