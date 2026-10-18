/**
 * Sakana's per-token rates, from the product pages that state them.
 *
 * There is no pricing table. The two models the entry carries are priced on
 * their own landing pages, in the same server-rendered `fg-pricegrid` shape:
 * a labelled block of three price cells (Input / Output / Cached input), with
 * the long-context rate in the cell's note:
 *
 *   <div class="fg-subcell__name">Fugu Ultra</div>
 *   <div class="fg-pricecell__p">$5 …</div>
 *   <div class="fg-pricecell__n">$10 when context > 272K …</div>
 *
 * `https://sakana.ai/fugu/` prices Fugu Ultra and Fugu Max; Fugu itself is
 * "the standard rate of the underlying model" (no single rate) and Fugu Cyber
 * is contact-sales, so neither has a row. `https://sakana.ai/namazu/` prices
 * Sakana Namazu, and its code sample confirms the API id `sakana-namazu`.
 *
 * **Membership is `intersect`.** The pages price a third product the entry has
 * no id for — Fugu Max at 2 / 6 / 0.25 — and the page states no API id for it
 * (it names `fugu-ultra-v2.0` only in the Ultra caption, while the entry's id
 * is the `fugu-ultra` alias). Adding a guessed id is the one thing this
 * adapter will not do. The two rows it can identify are re-priced; Fugu Max is
 * recorded here and in the checklist for a pass with an API key.
 *
 * The Fugu Ultra caption is worth keeping in view: the page calls the priced
 * model `fugu-ultra-v2.0`, while the entry carries `fugu-ultra` (the spelling
 * OpenRouter uses). The rates agree with the entry, so this pass re-prices the
 * row without renaming it; the id spelling is a question for the API.
 */
import { getText, drift, decimal, MEMBERSHIP } from "../lib/fetch.mjs";

const FUGU_URL = "https://sakana.ai/fugu/";
const NAMAZU_URL = "https://sakana.ai/namazu/";

/** The block name on the page -> the entry id. */
const IDS = {
  "Fugu Ultra": "fugu-ultra",
  "sakana-namazu": "sakana-namazu",
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

const money = (s) => {
  const m = /\$([0-9]+(?:\.[0-9]+)?)/.exec(s ?? "");
  return m ? decimal(m[1], "price").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : undefined;
};

/** The first price grid after a named block, as {Input, Output, Cached input}
    plus the long-context notes. */
const gridFor = (html, name) => {
  // The name also appears in the model cards near the top, so match the
  // pricing block's own label rather than the first `>name<` on the page.
  const marks = [
    `class="fg-subcell__name">${name}<`,
    `class="fg-plan__title fg-mono">${name}<`,
  ]
    .map((m) => html.indexOf(m))
    .filter((i) => i >= 0);
  if (marks.length === 0) return null;
  const at = Math.min(...marks);
  const start = html.indexOf("fg-pricegrid", at);
  if (start < 0) return null;
  // One grid belongs to the block; the next named block ends it.
  const nextSub = html.indexOf("fg-subcell__name", start);
  const nextPlan = html.indexOf("fg-plan__title", start);
  const ends = [nextSub, nextPlan].filter((i) => i > start);
  const seg = html.slice(start, ends.length ? Math.min(...ends) : start + 6000);

  const cells = {};
  for (const cell of seg.match(/<div class="fg-pricecell">[\s\S]*?<\/div>\s*<\/div>/g) ?? []) {
    const label = /<span class="t-en">([^<]+)<\/span>/.exec(
      /<div class="fg-pricecell__l">([\s\S]*?)<\/div>/.exec(cell)?.[1] ?? "",
    )?.[1];
    if (!label) continue;
    const price = money(/<div class="fg-pricecell__p">([\s\S]*?)<\/div>/.exec(cell)?.[1] ?? "");
    const note = money(/<div class="fg-pricecell__n">([\s\S]*?)<\/div>/.exec(cell)?.[1] ?? "");
    if (price !== undefined) cells[strip(label)] = { price, note };
  }
  return cells;
};

export default {
  ids: ["sakana"],
  source: FUGU_URL,
  membership: MEMBERSHIP.INTERSECT,
  owns: ["in", "out", "cache_read", "long_context"],

  async read() {
    const fugu = await getText(FUGU_URL, { headers: { accept: "text/html" } });
    const namazu = await getText(NAMAZU_URL, { headers: { accept: "text/html" } });

    const rows = [];
    const notes = [];
    for (const [name, id] of Object.entries(IDS)) {
      const cells = gridFor(name === "Fugu Ultra" ? fugu : namazu, name);
      if (!cells) drift(`no pricing grid for "${name}" — the page restructured`);
      const input = cells.Input?.price;
      const out = cells.Output?.price;
      if (input === undefined || out === undefined) drift(`"${name}" has no input/output pair`);
      const row = { id, name, in: input, out };
      const cache = cells["Cached input"]?.price;
      if (cache !== undefined) row.cache_read = cache;

      // The long band is stated in each cell's note as `$X when context > 272K`.
      const lc = {
        ...(cells.Input?.note !== undefined ? { in: cells.Input.note } : {}),
        ...(cells.Output?.note !== undefined ? { out: cells.Output.note } : {}),
        ...(cells["Cached input"]?.note !== undefined ? { cache_read: cells["Cached input"].note } : {}),
      };
      if (Object.keys(lc).length) {
        if (lc.in === undefined || lc.out === undefined) {
          drift(`"${name}" states a long-context rate without both directions`);
        }
        row.long_context = { over: 272000, ...lc };
      }
      rows.push(row);
    }
    if (rows.length === 0) drift("neither product page yielded a rate");

    const max = gridFor(fugu, "Fugu Max");
    notes.push("2 rows re-priced from the product pages; Fugu and Fugu Cyber carry no per-token rate");
    if (max) {
      notes.push(
        `Fugu Max is priced on the page (${max.Input?.price ?? "?"} / ${max.Output?.price ?? "?"} / ${
          max["Cached input"]?.price ?? "?"
        }) but it has no entry id and the page states no API id, so it was not added`,
      );
    }
    notes.push("the Fugu Ultra caption names the priced model `fugu-ultra-v2.0`; the entry keeps its `fugu-ultra` id this pass");
    return { rows: { sakana: rows }, notes: { sakana: notes } };
  },
};
