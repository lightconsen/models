/**
 * MiMo's published prices, from the markdown their docs serve directly.
 *
 * The easiest source in the set, and the reason is worth recording: the docs
 * publish an `llms.txt` whose index links every page as a `.md`, so this reads
 * markdown rather than a rendered page — no browser, no key, no layout to scrape.
 *
 * Two things the page does that shape this. It prices **twice**, a domestic table
 * in yuan and an overseas one in dollars, so the table is chosen by the entry's
 * own currency. And it bills the ASR series by audio duration (`¥0.5 /h`), which
 * has no field here — those rows are reported and skipped rather than forced into
 * a per-token number.
 *
 * The token-plan entry carries the same two models with no prices at all, which
 * is what a plan looks like: the models are declarable, the rate is not, because
 * a plan bills by subscription rather than by token.
 */
import { getText, drift, MEMBERSHIP, decimal } from "../lib/fetch.mjs";

const URL = "https://mimo.mi.com/static/docs/price/pay-as-you-go.md";

export default {
  ids: ["xiaomi-mimo", "xiaomi-mimo-token-plan"],
  source: URL,
  membership: MEMBERSHIP.FOLLOW,

  async read() {
    const md = await getText(URL);

    // The markdown's own headings name the two price lists; the tables sit under them.
    const sections = {};
    for (const part of md.split(/^###\s+/m).slice(1)) {
      const title = part.split("\n")[0].trim();
      const where = /Domestic/i.test(title) ? "domestic" : /Overseas/i.test(title) ? "overseas" : null;
      if (!where) continue;
      const text = (x) => x.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
      sections[where] = [...part.matchAll(/<table>[\s\S]*?<\/table>/g)].flatMap((t) =>
        [...t[0].matchAll(/<tr>[\s\S]*?<\/tr>/g)]
          .map((r) => [...r[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1])))
          .filter((cells) => cells.length >= 2 && /^`?mimo-/.test(cells[0]))
          .map((cells) => ({ model: cells[0].replace(/`/g, ""), cells: cells.slice(1) })),
      );
    }
    if (!sections.domestic || !sections.overseas) drift("could not find both the domestic and overseas price tables");

    // A row with three prices is per token: hit, miss, output. One with fewer is
    // billed another way, and there is no field for that here.
    const priced = [];
    for (const r of sections.domestic) {
      if (r.cells.length < 3) continue; // billed by duration — no field for it
      priced.push({ id: r.model, cache_read: decimal(r.cells[0]), in: decimal(r.cells[1]), out: decimal(r.cells[2]) });
    }
    if (priced.length === 0) drift("no per-token rows in the domestic table");

    return {
      rows: {
        "xiaomi-mimo": priced,
        // Same models, no rates: the plan is billed by subscription, not by token.
        "xiaomi-mimo-token-plan": priced.map((r) => ({ id: r.id })),
      },
    };
  },
};
