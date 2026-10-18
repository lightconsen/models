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
 * `ContactSales` is not a price, so those rows are named in the notes and not
 * returned — the entry keeps what it has for them, by the decision dated in
 * the checklist on 2026-09-23.
 */
import { getText, drift, decimal, MEMBERSHIP } from "../lib/fetch.mjs";

const URL = "https://console.groq.com/docs/models.md";

export default {
  ids: ["groq"],
  source: URL,
  // intersect, not follow: the entry carries three rows this table does not
  // price, and that is a decision already taken and dated in the checklist —
  // the llama pair kept at the last rates the vendor published when it moved
  // them to Contact Sales, on the grounds that unpricing a live model hides a
  // real cost. This adapter re-prices the six it can read and leaves the rest
  // where the entry has them.
  membership: MEMBERSHIP.INTERSECT,
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
