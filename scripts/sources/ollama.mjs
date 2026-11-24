/**
 * Ollama's cloud-model prices, from the vendor's own pricing page.
 *
 * `ollama.com/pricing` server-renders one table: `Model | Input | Cached input |
 * Output`, all per million tokens, beside the FAQ that says how the plans and
 * the usage credits work. It is a plain table in the HTML — no JS shell, no
 * key — which is why this reads the page rather than an API, even though
 * `ollama.com/v1/models` also exists (see below).
 *
 * **Peak and off-peak are two rows on the same table, and that is the schema's
 * `off_peak`.** The page says "Off-peak pricing apply outside 12:00 and 18:00
 * UTC on weekdays and all day on weekends" and then lists discounted twins
 * named `<model> (Off-Peak)`. This is the second entry in the catalogue to use
 * `off_peak` / `peak_hours` (the first is `baidu-qianfan`), and it is what
 * those fields are for: the listed row is the peak rate, the `(Off-Peak)` row
 * is the discount, and one row carries both.
 *
 * The window is stated the way the vendor states it — "outside 12:00 and 18:00
 * UTC on weekdays and all day on weekends" — which in the schema's positive
 * form is **two peak windows**, 12:00–18:00 on each of Monday to Friday, at
 * `tz_offset: 0`. `peak_hours` carries the peak hours; everything else is off.
 *
 * **The table's names are not the API's ids.** The table prints `gpt-oss:120b`
 * and `deepseek-v4-pro`, and the off-peak rows add ` (Off-Peak)`; the API's
 * `/v1/models` returns those same strings for most models but splits two of
 * them (`gpt-oss:20b` / `gpt-oss:120b`, and `deepseek-v4.1-flash` /
 * `deepseek-v4.1-flash:1017`). The join is therefore by exact table name after
 * the marker is stripped, and the two split families resolve because the table
 * prints the full id with the tag in it.
 *
 * **`clef` is priced on input only.** Its output cell is an em dash, which the
 * schema has no way to express — `in` and `out` come together — so a row with
 * one rate but not the other is reported and left out rather than written with
 * a zero the page never stated.
 */
import { getText, drift, MEMBERSHIP } from "../lib/fetch.mjs";

const PAGE = "https://ollama.com/pricing";

/** The vendor's own sentence, which the adapter re-checks each run: it is what
    the window below is a reading of, and a page that stopped stating it would
    be a page whose discount hours are unknown again. */
const OFF_PEAK_RULE =
  /Off-peak pricing apply outside 12:00 and 18:00 UTC on weekdays and all day on weekends/i;

/** The peak window, as the schema writes it: the hours that ARE peak. The page
    states the complement, so 12:00–18:00 on weekdays is the whole of it. */
const PEAK_HOURS = {
  tz_offset: 0,
  windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "12:00", end: "18:00" }],
};

/** Every `<tr>` as an array of cell strings, markup stripped. */
const rowsIn = (html) => {
  const cells = (row) =>
    (row.match(/<t[dh][\s\S]*?<\/t[dh]>/g) ?? []).map((c) =>
      c.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim(),
    );
  return (html.match(/<tr[\s\S]*?<\/tr>/g) ?? []).map(cells).filter((c) => c.length >= 4);
};

/** "$0.30" → "0.30"; an em dash (an unpublished rate) → undefined. */
const money = (cell) => {
  const m = /^\$([0-9]+(?:\.[0-9]+)?)$/.exec(String(cell ?? "").trim());
  return m ? m[1] : undefined;
};

export default {
  ids: ["ollama"],
  source: PAGE,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "off_peak", "peak_hours"],

  async read() {
    const html = await getText(PAGE);
    if (!OFF_PEAK_RULE.test(html)) {
      drift("the off-peak sentence is gone — the discount hours are unknown for every row");
    }

    const table = rowsIn(html);
    const head = table.find((c) => /^model$/i.test(c[0]) && c.some((x) => /cached input/i.test(x)));
    if (!head) drift("no Model/Input/Cached-input/Output table — the rate card moved");
    const headLower = head.map((c) => c.toLowerCase());
    const iIn = headLower.findIndex((c) => /^input\b/.test(c));
    const iCache = headLower.findIndex((c) => /^cached input\b/.test(c));
    const iOut = headLower.findIndex((c) => /^output\b/.test(c));
    if (iIn < 0 || iCache < 0 || iOut < 0) drift(`a rate card's columns changed (${head.join(" | ")})`);

    const data = table.filter((c) => c !== head && !c.every((x) => /^:?-+:?$/.test(x)));

    const base = new Map();
    const offPeak = new Map();
    const unpriced = [];
    for (const c of data) {
      const label = c[0];
      const isOff = /\(off-peak\)/i.test(label);
      const id = label.replace(/\s*\(off-peak\)\s*$/i, "").trim();
      if (!id) continue;
      const rates = { in: money(c[iIn]), out: money(c[iOut]), cache_read: money(c[iCache]) };
      // `clef` states input only; the schema needs the pair, so it is named
      // rather than written with an invented output rate.
      if (rates.in === undefined || rates.out === undefined) {
        unpriced.push(`${id} (${isOff ? "off-peak" : "peak"} row has no ${rates.in === undefined ? "input" : "output"} rate)`);
        continue;
      }
      const target = isOff ? offPeak : base;
      if (target.has(id)) drift(`${id} is priced twice on the rate card`);
      target.set(id, rates);
    }
    if (base.size === 0) drift("no priced rows in the rate card");

    const rows = [];
    for (const [id, rates] of base) {
      const off = offPeak.get(id);
      rows.push({
        id,
        name: id,
        in: rates.in,
        out: rates.out,
        ...(rates.cache_read !== undefined ? { cache_read: rates.cache_read } : {}),
        ...(off
          ? {
              off_peak: {
                in: off.in,
                out: off.out,
                ...(off.cache_read !== undefined ? { cache_read: off.cache_read } : {}),
              },
              peak_hours: PEAK_HOURS,
            }
          : {}),
      });
    }
    // An off-peak row with no peak twin is a discount on nothing; the page would
    // have to be malformed for it, and saying so is better than dropping it.
    const orphans = [...offPeak.keys()].filter((id) => !base.has(id));

    return {
      rows: { ollama: rows },
      notes: {
        ollama: [
          `${rows.length} models priced; ${offPeak.size} of them carry an off-peak rate`,
          ...(unpriced.length ? [`not carried (schema needs both rates): ${unpriced.join(", ")}`] : []),
          ...(orphans.length ? [`off-peak rows with no peak twin: ${orphans.join(", ")}`] : []),
        ],
      },
    };
  },
};
