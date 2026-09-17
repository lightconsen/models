/**
 * Gemini's prices, from the markdown AI Studio serves for every docs page.
 *
 * `aistudio.google.com/docs/pricing.md`. The same rates are on
 * `ai.google.dev/gemini-api/docs/pricing` as HTML, and that version cost two
 * bugs before this one replaced it — both of them the quiet kind, where the
 * parser reads half a row, the merge compares only the fields the proposal
 * carries, and the run reports `no change`:
 *
 *   - **It answers in whatever language it infers.** Without an explicit
 *     `Accept-Language` it came back in Italian on some runs, and Italian is not
 *     a translation of the labels alone: the currency symbol moves after the
 *     number and the decimal separator becomes a comma (`2 $`, `$0,20`), so
 *     every pattern misses on some runs and not others.
 *   - **The length bands are written with a literal less-than.** The cell reads
 *     `$2.00, prompts <= 200k tokens<br>$4.00, prompts > 200k tokens`, so a tag
 *     pattern of `<[^>]*>` starts at the `<` of `<=` and runs to the `>` that
 *     closes `<br>`, swallowing the first band and its price whole.
 *
 * The markdown has neither problem. It is byte-identical whatever language it is
 * asked for — verified across `en`, `it` and `zh` — and it is structured text
 * rather than a rendered page, so there are no tags to tell from arithmetic
 * operators. The rates are the same on both; only the reading is easier.
 *
 * **The rates are dated in advance.** Every Gemini 3.x Flash reads `$0.75 through
 * December 31, 2026, $1.50 starting January 1, 2027`, and the schema has nowhere
 * to put a future rate — so this reads whichever is *in force*, and the switch
 * happens on its own rather than waiting for someone to remember the date. That
 * is the reason this adapter is worth having at all.
 *
 * Each model is `## <Name>  {% id="<model-id>" %}` — the template tag carries the
 * id, so nothing is parsed out of display text — and each pricing tier under it
 * is a `{% tab title="Standard" %}`. This reads Standard only; Batch, Flex and
 * Priority are the same model on another schedule.
 */
import { getText, drift, decimal, MEMBERSHIP, readEntry } from "../lib/fetch.mjs";

const URL = "https://aistudio.google.com/docs/pricing.md";

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/** "200k" -> 200000, "1M" -> 1000000. */
const tokens = (s) => {
  const m = /^([\d.]+)\s*([kKmM])$/.exec(String(s).trim());
  if (!m) return undefined;
  return Math.round(Number(m[1]) * (m[2].toLowerCase() === "k" ? 1e3 : 1e6));
};

/**
 * The rate in force today, out of a cell that may carry one rate, two dated
 * rates, or a pair of length bands.
 *
 * Returns `{ now, over, above }` — what applies, plus the rate above `over` when
 * the cell prices length bands.
 */
export function ratesIn(cell, today = new Date()) {
  const text = String(cell).replace(/\s+/g, " ").trim();

  const dated = [...text.matchAll(/\$([\d.]+)\s+(through|starting)\s+([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/g)].map(
    ([, price, kind, month, day, year]) => ({
      price,
      kind,
      at: Date.UTC(Number(year), MONTHS[month.toLowerCase()] ?? 0, Number(day)),
    }),
  );
  if (dated.length > 0) {
    // `through` holds until its date, `starting` from its date. Today is inside
    // exactly one of them; a page that states neither is drift, not a default.
    const effective = dated.find((d) => (d.kind === "through" ? today.getTime() <= d.at : today.getTime() >= d.at));
    if (!effective) drift(`no rate in force today among: ${dated.map((d) => `${d.price} ${d.kind}`).join(", ")}`);
    return { now: decimal(effective.price) };
  }

  // Length bands, price first: `$2.00, prompts <= 200k tokens` then
  // `$4.00, prompts > 200k tokens`.
  const band = /\$([\d.]+),\s*prompts\s*<\s*=\s*([\d.]+[kKmM])\s*tokens\s*\$([\d.]+),\s*prompts\s*>\s*([\d.]+[kKmM])/.exec(
    text,
  );
  if (band) {
    const over = tokens(band[2]);
    if (over === undefined) drift(`cannot read the band size in "${text}"`);
    return { now: decimal(band[1]), over, above: decimal(band[3]) };
  }

  const plain = /\$([\d.]+)/.exec(text);
  return plain ? { now: decimal(plain[1]) } : undefined;
}

/**
 * The rows of a `{% table %}`: `* label`, `* free tier`, `* paid tier`, with
 * `---` between rows and the paid cell free to wrap over several lines.
 */
const tableRows = (block) =>
  block
    .split(/\n\s*---\s*\n/)
    .map((chunk) =>
      chunk
        .split(/\n\s*\* /)
        .map((part) => part.replace(/^\s*\* /, "").replace(/\s+/g, " ").trim())
        .filter((part) => part !== ""),
    )
    .filter((cells) => cells.length >= 3);

/** Every `## <name> {% id="…" %}` section, with its Standard table. */
const sections = (md) => {
  const out = [];
  for (const part of md.split(/\n## /).slice(1)) {
    const id = /\{%\s*id="([^"]+)"\s*%\}/.exec(part.split("\n")[0])?.[1];
    if (!id) continue;
    // Standard, then everything up to the next tier's `{% tab %}`.
    const standard = part.split(/\{%\s*tab title="Standard"\s*%\}/)[1]?.split(/\{%\s*tab title=/)[0];
    const table = standard?.split(/\{%\s*table\s*%\}/)[1]?.split(/\{%\s*\/table\s*%\}/)[0];
    if (table) out.push({ id, table });
  }
  return out;
};

export default {
  ids: ["google-gemini"],
  source: URL,
  membership: MEMBERSHIP.INTERSECT,
  owns: ["in", "out", "cache_read", "long_context"],

  async read() {
    const md = await getText(URL);
    const found = new Map(sections(md).map((s) => [s.id, s.table]));
    if (found.size === 0) drift("no model sections with a Standard table — the page has changed shape");

    const current = readEntry("google-gemini").models;
    const rows = [];
    for (const want of current) {
      const table = found.get(want.id);
      if (!table) continue;
      const byLabel = new Map(tableRows(table).map((cells) => [cells[0], cells[cells.length - 1]]));

      const input = ratesIn(byLabel.get("Input price") ?? "");
      const output = ratesIn(byLabel.get("Output price (including thinking tokens)") ?? "");
      if (!input || !output) drift(`${want.id}: the Standard table has no readable input or output price`);

      const row = { id: want.id, in: input.now, out: output.now };
      const cached = ratesIn(byLabel.get("Context caching price") ?? "");
      if (cached) row.cache_read = cached.now;
      if (input.over !== undefined && output.above !== undefined) {
        row.long_context = {
          over: input.over,
          in: input.above,
          out: output.above,
          ...(cached?.above ? { cache_read: cached.above } : {}),
        };
      }
      rows.push(row);
    }
    if (rows.length === 0) drift("none of the entry's models are on the page — the join is broken");

    const missing = current.filter((r) => !found.has(r.id));
    const notes = [`${found.size} models with a Standard table, ${rows.length} of them in the entry`];
    if (missing.length) notes.push(`not on the page: ${missing.map((r) => r.id).join(", ")}`);
    return { rows: { "google-gemini": rows }, notes: { "google-gemini": notes } };
  },
};
