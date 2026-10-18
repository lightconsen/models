/**
 * Groq's published rates, from its docs' markdown rendering of the model list.
 *
 * `console.groq.com/docs/models` serves the same page as HTML and, at
 * `.md`, as markdown — and the markdown is the usable one: one table per
 * section, with the columns already flat and the prices in one cell.
 *
 *   | ...llama-3.1-8b-instant | 560 | ContactSales | ... |
 *   | ...openai/gpt-oss-120b  | 500 | $0.15 input$0.60 output | ... |
 *
 * The model id is taken from the cell's `/docs/model/<id>` link rather than
 * from its text: the text ends with the id but "Enterprise" is glued to it
 * (`Enterprisellama-3.1-8b-instant`), and a text match takes all of it.
 *
 * **`ContactSales` is not a price and is not carried.** Two models this entry
 * used to price — llama-3.1-8b-instant and llama-3.3-70b-versatile — are now
 * in the page's Enterprise row with no published rate, and the entry followed
 * the vendor rather than keeping a number the vendor no longer states.
 */
import { getText, drift, decimal, MEMBERSHIP } from "../lib/fetch.mjs";

const URL = "https://console.groq.com/docs/models.md";

export default {
  ids: ["groq"],
  source: URL,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out"],

  async read() {
    const md = await getText(URL);
    if (!/PRICE PER 1M TOKENS/i.test(md)) drift("no 'PRICE PER 1M TOKENS' column — the docs restructured");

    const rows = [];
    const unpriced = [];
    let tables = 0;
    for (const line of md.split("\n")) {
      if (!line.startsWith("|")) continue;
      const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      if (cells.length < 3) continue;
      if (/MODEL ID/i.test(cells[0])) { tables++; continue; }
      if (/^:?-{2,}/.test(cells[0])) continue;

      const link = /\]\(\/docs\/model\/([^)]+)\)/.exec(cells[0]);
      if (!link) continue;
      const id = link[1].trim();

      const price = cells[2];
      if (/contact\s*sales/i.test(price)) { unpriced.push(id); continue; }
      const m = /\$([0-9.]+)\s*(?:input|prompt)/i.exec(price);
      const n = /\$([0-9.]+)\s*(?:output|completion)/i.exec(price);
      if (!m || !n) continue; // per-hour, per-character — no field for those
      rows.push({ id, name: id, in: decimal(m[1]), out: decimal(n[1]) });
    }
    if (tables === 0) drift("no model table header — the docs restructured");
    if (rows.length === 0) drift("the tables yielded no per-token rows");

    const notes = [`${rows.length} per-token rows read from the models table`];
    if (unpriced.length) notes.push(`listed as ContactSales, no rate to carry: ${unpriced.join(", ")}`);
    return { rows: { groq: rows }, notes: { groq: notes } };
  },
};
