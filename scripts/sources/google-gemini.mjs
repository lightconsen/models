/**
 * Gemini's prices, from the pricing page that answers a plain user-agent.
 *
 * **The lesson this entry exists to encode: the page's answer depends on who is
 * asking.** It returns 200 and the whole table to
 * `Mozilla/5.0 (compatible; kiwano-price-check)` — the header this repo's fetch
 * wrapper sends — and redirects a *browser* user-agent to an OAuth consent
 * screen. Probing it with a browser header, out of the habit every anti-bot page
 * teaches, is how it spent a day on the unreadable list with "OAuth wall" written
 * next to it. Refusing a browser is not refusing us.
 *
 * The markup is a gift: `<h2 id="gemini-3.8-flash">` — the anchor *is* the model
 * id, so nothing has to be parsed out of display text — and each pricing tier
 * under it is an `<h3 id="standard">`. This reads Standard only; Batch, Flex and
 * Priority are the same model on another schedule.
 *
 * Four shapes of paid-tier cell, and they are the whole difficulty:
 *
 *   $1.50                                             a plain rate
 *   $0.30 (text / image / video / audio)              a rate with its modalities
 *   $0.75 through December 31, 2026.                  a rate with an expiry, and
 *   $1.50 starting January 1, 2027.                   its replacement
 *   $2.00, prompts <= 200k tokens                     a rate that changes with
 *   $4.00, prompts > 200k tokens                      the request length
 *
 * The date-qualified case is why this is worth automating rather than
 * transcribing. The page prices a change **in advance** — every Gemini 3.x Flash
 * reads `$0.75 through December 31, 2026, $1.50 starting January 1, 2027` — and
 * the schema has nowhere to put a future rate. Rather than record today's number
 * and a note, this reads whichever is in force, so the switch happens on its own
 * and no one has to remember the date.
 *
 * Entities are decoded *after* tags are stripped, never before: the length bands
 * are written `prompts &lt;= 200k`, and decoding first turns that into
 * `prompts <= 200k`, whose `<` the tag stripper then reads as the start of a tag
 * and eats the band with it.
 */
import { getText, drift, decimal, MEMBERSHIP, readEntry } from "../lib/fetch.mjs";

const URL = "https://ai.google.dev/gemini-api/docs/pricing";

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/**
 * Markup first, entities second — and the tag pattern demands a letter or slash
 * after its `<`.
 *
 * Both halves of that are load-bearing, and both were paid for. The length bands
 * are written with a **literal** less-than — `<td>$2.00, prompts <= 200k
 * tokens<br>$4.00, prompts > 200k tokens</td>` — so a tag pattern of `<[^>]*>`
 * starts matching at the `<` of `<=`, runs to the first `>` it finds, which is the
 * one closing `<br>`, and swallows the entire first band including its price. The
 * cell then reads `$2.00, prompts $4.00, prompts > 200k tokens`: enough for a
 * plain rate to be read off, with no band, no threshold and no second price. The
 * run says `no change` and is believed, because a field the proposal omits is
 * never compared against the entry's.
 *
 * Requiring `[a-zA-Z/]` after the `<` is what tells `<=` from `<br>`.
 */
const cellText = (html) =>
  String(html)
    .replace(/<[a-zA-Z/][^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const cellsOf = (row) => [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => cellText(c[1]));

/** "200k" -> 200000, "1M" -> 1000000. */
const tokens = (s) => {
  const m = /^([\d.]+)\s*([kKmM])$/.exec(String(s).trim());
  if (!m) return undefined;
  return Math.round(Number(m[1]) * (m[2].toLowerCase() === "k" ? 1e3 : 1e6));
};

/**
 * The rate in force today, out of a cell that may carry one rate, two dated
 * rates, a length band, or a list of modalities.
 *
 * Returns `{ now, over, above }` — the rate that applies, plus the band above
 * `over` when the cell prices length bands.
 */
export function ratesIn(cell, today = new Date()) {
  const text = cellText(cell);
  const dated = [...text.matchAll(/\$([\d.]+)\s+(through|starting)\s+([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/g)].map(
    ([, price, kind, month, day, year]) => ({
      price,
      kind,
      at: Date.UTC(Number(year), MONTHS[month.toLowerCase()] ?? 0, Number(day)),
    }),
  );

  if (dated.length > 0) {
    // `through` holds until its date; `starting` holds from its date. Today falls
    // in exactly one of them, and if a page ever states neither, that is drift.
    const effective = dated.find((d) => (d.kind === "through" ? today.getTime() <= d.at : today.getTime() >= d.at));
    if (!effective) drift(`no rate in force today among: ${dated.map((d) => `${d.price} ${d.kind}`).join(", ")}`);
    return { now: decimal(effective.price) };
  }

  // Length bands. Each is written price-first: `$2.00, prompts <= 200k tokens`
  // then `$4.00, prompts > 200k tokens` — so the second rate arrives *before* the
  // band it belongs to, and a pattern that looks for a price after the band finds
  // nothing and falls through to the first number. Which it did, silently: the
  // entry kept its `long_context` because a field the proposal omits is never
  // compared, and the run reported no change while reading half the row.
  const band =
    /\$([\d.]+),\s*prompts\s*<\s*=\s*([\d.]+[kKmM])\s*tokens\s*\$([\d.]+),\s*prompts\s*>\s*([\d.]+[kKmM])/.exec(
      text,
    );
  if (band) {
    const over = tokens(band[2]);
    if (over === undefined) drift(`cannot read the band size in "${text}"`);
    return { now: decimal(band[1]), over, above: decimal(band[3]) };
  }

  // A plain rate, with or without its modalities named after it.
  const plain = /\$([\d.]+)/.exec(text);
  if (!plain) return undefined;
  return { now: decimal(plain[1]) };
}

/** Every `<h2 id="model-id">` section, with its Standard table's rows. */
const sections = (html) => {
  const out = [];
  const re = /<h([23])[^>]*\bid="([^"]*)"[^>]*>|<table[\s\S]*?<\/table>/g;
  let tier = null;
  let current = null;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith("<h")) {
      if (m[1] === "2") {
        tier = null;
        current = { id: m[2], rows: null };
        out.push(current);
      } else {
        // `standard`, `standard_1`, `standard_2` … — the anchor is suffixed once
        // the same tier appears a second time.
        tier = m[2].replace(/_\d+$/, "");
      }
      continue;
    }
    if (current && tier === "standard" && current.rows === null) current.rows = m[0];
  }
  return out.filter((s) => s.rows !== null);
};

export default {
  ids: ["google-gemini"],
  source: URL,
  membership: MEMBERSHIP.INTERSECT,
  owns: ["in", "out", "cache_read", "long_context"],

  async read() {
    // **Ask for English explicitly.** Without it this page answers in whatever
    // locale it infers, and the Italian one is not a translation of the labels
    // alone — it moves the currency symbol after the number and the decimal
    // separator to a comma (`2 $`, `$0,20`, `200.000 token`). Every pattern below
    // then misses, on some runs and not others, which is the worst way for a
    // scheduled job to fail: three runs read the page fine and the fourth reports
    // a source it cannot parse.
    const html = await getText(URL, { headers: { accept: "text/html", "accept-language": "en-US,en;q=0.9" } });
    const found = new Map(sections(html).map((s) => [s.id, s.rows]));
    if (found.size === 0) drift("no model sections with a Standard table — the page has changed shape");

    const current = readEntry("google-gemini").models;
    const rows = [];
    for (const want of current) {
      const table = found.get(want.id);
      if (!table) continue;
      const byLabel = new Map(
        [...table.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((r) => {
          const c = cellsOf(r[0]);
          return [c[0], c[c.length - 1]];
        }),
      );
      // The paid column is the last one; the one before it is the free tier.
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
