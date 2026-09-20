/**
 * Kimi's published per-token prices, from a markdown page carrying a JS array.
 *
 * Their docs are kinder than most: every page is served as markdown too
 * (`/docs/llms.txt` lists them), and the price table is a literal JS array inside
 * a `<DocTable>` element. So this needs no HTML parsing and no browser.
 *
 * Columns are matched by their wording rather than their position, so a reworded
 * header still lands — and a header that stops matching aborts the read instead of
 * shifting every number one column left.
 *
 * The model list is read as well, purely to tell apart the two reasons a row can
 * be absent from the price table: the page says the model was retired, or it just
 * does not price it. Two were found retired this way, unnoticed.
 */
import { getText, drift, decimal, MEMBERSHIP } from "../lib/fetch.mjs";

const PRICING_MD = "https://platform.kimi.com/docs/pricing/chat.md";
const MODELS_MD = "https://platform.kimi.com/docs/models.md";

/** Column title -> our field. Matched loosely so a reworded header still lands. */
const columnField = (title) => {
  if (/缓存命中/.test(title)) return "cache_read";
  if (/缓存未命中|输入/.test(title)) return "in";
  if (/输出/.test(title)) return "out";
  return null;
};

export default {
  ids: ["kimi"],
  source: PRICING_MD,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read"],

  async read() {
    const md = await getText(PRICING_MD);
    // The page carries **more than one** <DocTable> — the current models in one,
    // the rest of the catalogue in another — and reading only the first made the
    // older models look retired the day the split landed. Every table is read and
    // their rows merged; a model listed twice prices identically or the first row
    // wins, which the compare below would catch as a diff.
    const tables = [...md.matchAll(/<DocTable[\s\S]*?\/>/g)].map((m) => m[0]);
    if (tables.length === 0) drift("no <DocTable> element in the pricing markdown");

    const out = [];
    for (const table of tables) {
      const titles = [...table.matchAll(/\{\s*title:\s*"([^"]+)"/g)].map((m) => m[1]);
      const rowBlocks = [...table.matchAll(/\[([^\][]*)\]/g)].map((m) => m[1]);
      if (titles.length === 0 || rowBlocks.length === 0) drift("could not read the table's columns or rows");
      const rows = rowBlocks
        .map((b) => {
          try {
            return JSON.parse(`[${b.replace(/,\s*$/, "")}]`);
          } catch {
            return null;
          }
        })
        .filter((r) => Array.isArray(r) && r.every((c) => typeof c === "string"));

      const cols = titles.map((t, i) => [columnField(t), i, t]).filter(([f]) => f);
      if (cols.length < 3) drift(`could not map the columns: ${titles.join(" | ")}`);
      const modelAt = titles.findIndex((t) => t === "模型");
      if (modelAt < 0) drift(`no "模型" column among: ${titles.join(" | ")}`);

      for (const r of rows) {
        const row = { id: String(r[modelAt]).trim() };
        if (row.id === "" || out.some((x) => x.id === row.id)) continue;
        for (const [field, i] of cols) row[field] = decimal(r[i]);
        out.push(row);
      }
    }
    if (out.length === 0) drift("no parseable rows in the pricing tables");

    // A model the vendor has retired, so a row missing from the price table can be
    // told apart from one the vendor simply does not bill for.
    const modelsMd = await getText(MODELS_MD);
    const retired = [...modelsMd.matchAll(/^\|\s*`?([a-z0-9.-]+)`?\s*\|\s*已下线\s*\|/gm)].map((m) => m[1]);
    const notes = retired.length ? [`the vendor marks these retired: ${retired.join(", ")}`] : [];

    return { rows: { kimi: out }, notes: { kimi: notes } };
  },
};
