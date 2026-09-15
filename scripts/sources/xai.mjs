/**
 * Read xAI's published prices from the docs' own markdown.
 *
 * `docs.x.ai/docs/models.md` is the source the rendered docs page is built from,
 * so the tables arrive as markdown rather than as a scraped layout. It holds
 * three of them, and only the first is per-token text pricing: Imagine bills per
 * image and per second, Voice per minute and per character, and a row here has no
 * field for any of those. Those tables are left unread rather than bent into a
 * number.
 *
 * The quirk that shapes the parser: a model with long-context pricing is listed
 * TWICE, once for prompts under the threshold and once for prompts at or above
 * it, and the two rows carry the same model name apart from that parenthetical.
 * So the table is read as pairs, not as one row per model — the under-threshold
 * row is the row's own `in`/`out`/`cache_read`, and the at-or-above row becomes
 * `long_context`. The threshold is parsed from the page rather than hard-coded:
 * it is stated per row, and a vendor that moves the line should move the entry
 * with it. A pair whose two halves disagree about the threshold is drift, not a
 * guess about which one is right.
 *
 * xAI prices its whole catalogue here, so membership follows the source: a model
 * it drops leaves the entry.
 */
import { getText, decimal, drift, MEMBERSHIP } from "../lib/fetch.mjs";

const URL = "https://docs.x.ai/docs/models.md";

/* `grok-4.6 (< 200k prompt tokens)` — the two halves of one long-context pair.
   The `≥` is written as a Unicode character on the page, not as `>=`. */
const UNDER = /^([^\s(]+)\s*\(<\s*(\d+)k prompt tokens\)$/;
const AT_OR_OVER = /^([^\s(]+)\s*\((?:≥|>=)\s*(\d+)k prompt tokens\)$/;

/** The lines under one heading, up to the next heading of the same level. */
const section = (md, title) => {
  const lines = md.split("\n");
  const heads = lines.map((l) => /^(#+)\s+(.*)$/.exec(l));
  const at = heads.findIndex((h) => h && h[2].trim() === title);
  if (at < 0) drift(`${URL}: no "${title}" heading — the page has been restructured`);
  const end = heads.findIndex((h, i) => i > at && h && h[1].length <= heads[at][1].length);
  return lines.slice(at + 1, end < 0 ? undefined : end);
};

/** A markdown table as [header, ...body] of trimmed cells; the `---` line dropped. */
const table = (lines) => {
  const pipes = lines.filter((l) => l.trim().startsWith("|"));
  if (pipes.length < 2) drift(`${URL}: the pricing table is missing or no longer a table`);
  const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  return [cells(pipes[0]), pipes.slice(1).filter((l) => !/^\|[\s:|-]+\|$/.test(l.trim())).map(cells)];
};

export default {
  ids: ["xai"],
  source: URL,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "long_context"],

  async read() {
    const [head, body] = table(section(await getText(URL), "Text API Pricing"));
    const col = (name) => head.findIndex((h) => h.toLowerCase() === name);
    const [model, input, cached, output] = ["model", "input / 1m tokens", "cached input / 1m tokens", "output / 1m tokens"].map(col);
    if ([model, input, cached, output].some((i) => i < 0)) drift(`${URL}: the text price table's columns changed (${head.join(" | ")})`);

    const pairs = new Map();
    for (const c of body) {
      const low = UNDER.exec(c[model]);
      const high = low ? null : AT_OR_OVER.exec(c[model]);
      if (!low && !high) drift(`${URL}: "${c[model]}" is neither half of a long-context pair`);
      const m = low ?? high;
      const id = m[1].toLowerCase();
      const seen = pairs.get(id) ?? [];
      if (seen.length === 2) drift(`${URL}: "${id}" has more than the two rows a long-context pair allows`);
      pairs.set(id, [...seen, { high: !!high, over: Number(m[2]) * 1000, in: decimal(c[input]), out: decimal(c[output]), cache_read: decimal(c[cached]) }]);
    }

    const rows = [];
    const notes = [];
    for (const [id, pair] of pairs) {
      const [first, second] = pair;
      if (first.high) drift(`${URL}: "${id}" lists its long-context row before its standard one`);
      const row = { id, in: first.in, out: first.out, cache_read: first.cache_read };
      if (second) {
        if (!second.high || second.over !== first.over) drift(`${URL}: "${id}"'s two rows do not bracket the same threshold`);
        row.long_context = { over: second.over, in: second.in, out: second.out, cache_read: second.cache_read };
      } else {
        // The runner sets the fields a source returns and clears none, so a model
        // that loses its second row would keep a stale long_context silently.
        notes.push(`${id} is listed without a long-context row — drop its long_context by hand if the entry has one`);
      }
      rows.push(row);
    }
    if (rows.length === 0) drift(`${URL}: the text pricing table yielded no models`);

    return { rows: { xai: rows }, notes: { xai: notes } };
  },
};
