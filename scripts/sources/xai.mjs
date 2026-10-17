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


/** The one knowledge cutoff this page states, as a note:
        The knowledge cut-off date of Grok 4.7 is May 2026.
    A single model, named in prose rather than in a column — and written here
    because it is the vendor saying it, not because a parser can do it in
    general. If the note goes, the field goes with it; no other row on the page
    ever carried one. */
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const knowledgeNotes = (md) => {
  const out = new Map();
  for (const m of md.matchAll(/knowledge cut-?off date of (.+?) is ([A-Za-z]+) (\d{4})/gi)) {
    const mo = MONTHS.indexOf(m[2].toLowerCase());
    if (mo < 0) continue;
    out.set(m[1].trim().toLowerCase().replace(/\s+/g, "-"), `${m[3]}-${String(mo + 1).padStart(2, "0")}`);
  }
  return out;
};

const URL = "https://docs.x.ai/docs/models.md";
/** One page per model, and the only place xAI states what a model takes:
        - **Modalities:** text, image → text
    Both directions on one line, in this catalogue's words. */
const MODEL_URL = (id) => `https://docs.x.ai/developers/models/${id}.md`;
const MEDIA = new Set(["text", "image", "audio", "video", "pdf"]);
const modalitiesOf = (md) => {
  const m = /^[-*]\s*\*\*Modalities:\*\*\s*(.+?)\s*(?:→|->)\s*(.+)$/mi.exec(md);
  if (!m) return null;
  const words = (s) => {
    const v = s.split(/[,+]/).map((w) => w.trim().toLowerCase()).filter(Boolean);
    return v.length > 0 && v.every((w) => MEDIA.has(w)) ? [...new Set(v)].sort() : null;
  };
  const input = words(m[1]);
  const output = words(m[2]);
  if (!input) return null;
  return output ? { input, output } : { input };
};

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
  owns: ["in", "out", "cache_read", "long_context", "modalities", "knowledge"],

  async read() {
    const md = await getText(URL);
    const knowledge = knowledgeNotes(md);
    const [head, body] = table(section(md, "Text API Pricing"));
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

    // The model pages, fetched together. A page that does not answer leaves
    // the field alone rather than failing the run.
    const pages = new Map(
      await Promise.all(
        [...pairs.keys()].map(async (id) => {
          try {
            return [id, await getText(MODEL_URL(id))];
          } catch {
            return [id, null];
          }
        }),
      ),
    );

    const rows = [];
    const notes = [];
    for (const [id, pair] of pairs) {
      const [first, second] = pair;
      if (first.high) drift(`${URL}: "${id}" lists its long-context row before its standard one`);
      const row = { id, in: first.in, out: first.out, cache_read: first.cache_read };
      const mods = pages.get(id) ? modalitiesOf(pages.get(id)) : null;
      if (mods) row.modalities = mods;
      const cutoff = knowledge.get(id);
      if (cutoff) row.knowledge = cutoff;
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
