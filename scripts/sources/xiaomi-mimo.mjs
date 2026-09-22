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
 * The language table gained an "Inference Type" column on 2026-09-21 that groups
 * its rows into **Real-time API** and **Batch API** — a labelled cell opens a
 * group and the rows under it inherit it until the next label. Only the
 * real-time rows are carried: the batch rows are the same models at a discount
 * for a different billed mode (offline jobs), and there is no field for that
 * here, so they are reported and skipped like the ASR rows. The model cells also
 * pair each new model with the V2.5 one it replaces (`mimo-v2.6-pro`、`mimo-v2.5-pro`
 * (to be deprecated)) at a single shared price — the price belongs to both, so
 * both rows are emitted and the "(to be deprecated)" mark is dropped.
 *
 * The token-plan entry carries the same text models with no prices at all, which
 * is what a plan looks like: the models are declarable, the rate is not, because
 * a plan bills by subscription rather than by token. It follows the *plan's* model
 * list, not the price table's: the UltraSpeed model is priced on the pay-as-you-go
 * page but is not one of the plan's six, so it is filtered out here.
 */
import { getText, drift, MEMBERSHIP, decimal } from "../lib/fetch.mjs";

const URL = "https://mimo.mi.com/static/docs/price/pay-as-you-go.md";

/** The display names the entry's own rows already spell; kept so a row the
    source adds (a new model) never falls back to its bare id. */
const NAME = {
  "mimo-v2.6-pro": "MiMo V2.6 Pro",
  "mimo-v2.6-flash": "MiMo V2.6 Flash",
  "mimo-v2.6-pro-ultraspeed": "MiMo V2.6 Pro UltraSpeed",
  "mimo-v2.5-pro": "MiMo V2.5 Pro",
  "mimo-v2.5": "MiMo V2.5",
};

export default {
  ids: ["xiaomi-mimo", "xiaomi-mimo-token-plan"],
  source: URL,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read"],

  async read() {
    const md = await getText(URL);

    // The markdown's own headings name the two price lists; the tables sit under them.
    const sections = {};
    for (const part of md.split(/^###\s+/m).slice(1)) {
      const title = part.split("\n")[0].trim();
      const where = /Domestic/i.test(title) ? "domestic" : /Overseas/i.test(title) ? "overseas" : null;
      if (!where) continue;
      const text = (x) => x.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
      sections[where] = [...part.matchAll(/<table>[\s\S]*?<\/table>/g)].flatMap((t) => {
        // A row that carries an Inference-Type label opens its group; the rows
        // after it (the label's rowspan) inherit it until the next label.
        let group = null;
        return [...t[0].matchAll(/<tr>[\s\S]*?<\/tr>/g)].flatMap((r) => {
          const cells = [...r[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1]));
          const kind = cells.find((c) => /Real-time API|Batch API/i.test(c));
          if (kind) group = /Batch/i.test(kind) ? "batch" : "real-time";
          // The backticked ids in a model cell — one, or a new model paired with
          // the one it replaces. A row with none (a header, a group label over a
          // feature cell) is not a price row.
          const ids = cells.flatMap((c) => [...c.matchAll(/`([^`]+)`/g)].map((m) => m[1])).filter((id) => /^mimo-/.test(id));
          if (ids.length === 0) return [];
          // The row's prices, in table order: cache hit, cache miss, output. The
          // group label and a model name are no kind of price, and "¥0.5 /h" is
          // three figures on a duration bill, so only plain decimals survive.
          const prices = cells.map((c) => c.replace(/^[¥$]\s*/, "")).filter((c) => /^\d+(\.\d+)?$/.test(c));
          return [{ group, ids, prices }];
        });
      });
    }
    if (!sections.domestic || !sections.overseas) drift("could not find both the domestic and overseas price tables");

    // Real-time rows with three prices are per token: hit, miss, output. A row is
    // reported and skipped when it is billed another way — an ASR row prices by
    // the hour, a batch row prices a different mode — because neither has a field
    // here, and forcing them into a per-token number would lie about them.
    const notes = [];
    const priced = [];
    for (const r of sections.domestic) {
      if (r.prices.length >= 3 && r.group !== "batch") {
        for (const id of r.ids) {
          priced.push({
            id,
            name: NAME[id] ?? id,
            cache_read: decimal(r.prices[0]),
            in: decimal(r.prices[1]),
            out: decimal(r.prices[2]),
          });
        }
      } else if (r.group === "batch") {
        notes.push(`batch API, a different billed mode with no field here: ${r.ids.join("、")}`);
      } else {
        notes.push(`billed by duration, no field for it: ${r.ids.join("、")}`);
      }
    }
    if (priced.length === 0) drift("no per-token real-time rows in the domestic table");

    return {
      rows: {
        "xiaomi-mimo": priced,
        // Same text models, no rates: the plan is billed by subscription, not by
        // token — and without the UltraSpeed model, which is not on the plan.
        "xiaomi-mimo-token-plan": priced.filter((r) => r.id !== "mimo-v2.6-pro-ultraspeed").map(({ id, name }) => ({ id, name })),
      },
      notes: {
        "xiaomi-mimo": notes,
        "xiaomi-mimo-token-plan": notes,
      },
    };
  },
};