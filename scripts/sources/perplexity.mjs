/**
 * Perplexity's Router prices, from the vendor's own rate card.
 *
 * `docs.perplexity.ai/docs/router/models.md` is a Mintlify page serving markdown
 * for free. Its tables are the router's catalogue; the API reference says the
 * same list is the allowlist, so a model missing from it cannot be requested.
 *
 * **The rate card moved into blockquotes.** Until 2026-11 the page had one
 * plain `| Model | … | Cache read |` table. It is now seven tabbed tables —
 * `> [tab] Anthropic`, `> [tab] OpenAI`, `> [tab] Google`, `> [tab] xAI`,
 * `> [tab] Z.AI`, `> [tab] DeepSeek`, `> [tab] Moonshot AI` — each a markdown
 * blockquote whose header still ends `Cache read (\$/1M)`. The old reader
 * looked for a line *starting* with `|`, which a `> |` line does not, so it
 * found no rate card at all and the entry stopped syncing. The reader now
 * strips the quote marker and treats a run of quoted table lines as one table.
 *
 * **The list grew from four models to forty-seven, and that is a membership
 * decision, not a price.** The seven tables carry Anthropic, OpenAI, Google and
 * xAI models the router resells at those vendors' own rates, alongside the four
 * open-weight models Perplexity hosts itself (`perplexity/kimi-k3`,
 * `perplexity/glm-5.3`, `perplexity/glm-5.3-flash`,
 * `perplexity/deepseek-v4-pro-0813`). This entry carries the hosted four — the
 * selection that made it a distinct vendor rather than a mirror of four other
 * entries. So membership is `intersect`: re-price the rows it carries, and
 * report the rest in the notes for a human to decide rather than adding 43
 * resale rows whose `serves` mapping no adapter can author (see below).
 *
 * **A new row would need `serves` and cannot be written by an adapter.** The
 * router's own string for a model is `anthropic/claude-fable-5-2`; this
 * catalogue's id would be `claude-fable-5-2`, and the API accepts only the
 * former. `serves` carries that mapping, and `fetch-all` refuses a field an
 * adapter emits without owning — `serves` is authored by hand, deliberately.
 * That is a second reason the un-carried models are reported and not added.
 *
 * **Cache writes are no longer "the input rate".** The old note said writes
 * bill "at the rate shown (or at the input rate where no dedicated write rate
 * is listed)", and `cache_creation` was each row's input rate because of it.
 * The page now states the premium instead: writes "are billed once, at 1.25
 * times the input rate, on Anthropic models and on the `openai/gpt-6.2-*`,
 * `openai/gpt-6.1-*`, `openai/gpt-6-*`, and `openai/gpt-5.6-*` models", with
 * one-hour writes at 2 times the input rate on Anthropic models. None of the
 * four hosted rows is in that list. Rather than zero a price on that reading,
 * the adapter does not own `cache_creation`: the rows keep what they have, and
 * the change in the vendor's statement is reported every run so the decision
 * stays visible.
 *
 * From this machine the host needs the proxy (`node scripts/probe-sources.mjs`);
 * from GitHub's US runners it does not.
 */
import { getText, drift, decimal, MEMBERSHIP, readEntry } from "../lib/fetch.mjs";

const URL = "https://docs.perplexity.ai/docs/router/models.md";

/** The page's statement of how cache writes bill, quoted by its opening. Its
    shape changed on 2026-11 (see the header) — a page that stopped stating the
    premium entirely would be a page where the write rate is unknown again. */
const WRITE_RULE = /cache writes[\s\S]{0,120}?are billed once, at 1\.25 times the input rate/i;

/** Every markdown table on the page, with the `>` quote markers stripped.
 *
 *  The rate card is a blockquote now, so a table's lines read `> | Model | …`
 *  — and the old reader, which wanted a line starting with `|`, found none of
 *  them. A run of quoted (or unquoted) table lines is one table; the `| - | - |`
 *  alignment rule (with optional `:` for alignment) is not a row. Exported for
 *  the test suite. */
export const tablesIn = (md) => {
  const tables = [];
  let table = null;
  for (const raw of md.split("\n")) {
    const line = raw.replace(/^\s*>\s?/, "").trim();
    if (!line.startsWith("|")) {
      table = null;
      continue;
    }
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // the alignment rule
    if (!table) tables.push((table = []));
    table.push(cells);
  }
  return tables;
};

export default {
  ids: ["perplexity"],
  source: URL,
  membership: MEMBERSHIP.INTERSECT,
  owns: ["in", "out", "cache_read"],

  async read() {
    const md = await getText(URL);

    const tables = tablesIn(md);

    const rateCards = tables.filter(
      (t) => /^model$/i.test(t[0]?.[0] ?? "") && t[0].some((c) => /cache read/i.test(c)),
    );
    if (rateCards.length === 0) drift("no Model/…/Cache-read table — the rate card moved or was restructured");

    if (!WRITE_RULE.test(md)) {
      drift("the cache-write premium is no longer stated — the write rate is unknown for every row");
    }

    const current = readEntry("perplexity").models;
    // The join the README describes: our id is canonical, the router's string
    // reaches the API through `serves`, and this translates between them.
    const canonical = new Map();
    for (const m of current) {
      for (const upstream of Object.values(m.serves ?? {})) canonical.set(upstream, m.id);
      canonical.set(m.id, m.id);
    }
    const carried = new Set(current.map((m) => m.id));

    const rows = [];
    const seen = new Set();
    const uncarried = [];
    for (const table of rateCards) {
      const head = table[0].map((c) => c.toLowerCase());
      const [iIn, iOut, iCache] = [
        head.findIndex((c) => /^input\b/.test(c)),
        head.findIndex((c) => /^output\b/.test(c)),
        head.findIndex((c) => /^cache read\b/.test(c)),
      ];
      if (iIn < 0 || iOut < 0 || iCache < 0) drift(`a rate card's columns changed (${table[0].join(" | ")})`);

      for (const c of table.slice(1)) {
        const upstream = /`([^`]+)`/.exec(c[0] ?? "")?.[1];
        if (!upstream) drift(`a row names "${c[0]}" where a \`creator/model\` id belongs`);
        if (seen.has(upstream)) drift(`${upstream} is priced twice across the rate cards`);
        seen.add(upstream);

        const id = canonical.get(upstream) ?? upstream.split("/").slice(1).join("/");
        if (!carried.has(id)) {
          uncarried.push(upstream);
          continue;
        }
        // A carried row whose cell gained a second figure is a length band this
        // entry has nowhere to put (it carries no `long_context` for these).
        // Reading the base and dropping the band would understate the price.
        // The band is written `0.10 (≤100k) 0.50 (>100k)` — two decimals, where
        // a single rate is one.
        for (const [cell, what] of [[c[iIn], "input"], [c[iOut], "output"], [c[iCache], "cache read"]]) {
          const figures = (cell ?? "").match(/[0-9]+(?:\.[0-9]+)?/g) ?? [];
          if (figures.length > 1) {
            drift(`${upstream}: the ${what} cell "${cell}" states more than one rate — this entry has no length band to put it in`);
          }
        }
        rows.push({
          id,
          in: rate(c[iIn], "input", upstream),
          out: rate(c[iOut], "output", upstream),
          cache_read: rate(c[iCache], "cache read", upstream),
        });
      }
    }
    if (rows.length === 0) drift("none of the entry's rows is on the rate card");
    if (rows.length < carried.size) {
      const lost = [...carried].filter((id) => !rows.some((r) => r.id === id));
      drift(`the rate card no longer prices ${lost.join(", ")} — this entry cannot be re-priced from it`);
    }

    const notes = [
      `${rateCards.length} rate-card tables read; ${rows.length} of the entry's rows priced`,
      `the page prices ${uncarried.length + rows.length} models: ${uncarried.length} are resold from other vendors and are not this entry's rows — a membership decision`,
      "cache writes now bill at 1.25x the input rate on Anthropic and the listed OpenAI models only; this entry's rows are none of those, so `cache_creation` is left as authored",
    ];
    if (uncarried.length) notes.push(`not carried: ${uncarried.join(", ")}`);
    return { rows: { perplexity: rows }, notes: { perplexity: notes } };
  },
};

const rate = (cell, what, upstream) => {
  const m = /([0-9]+(?:\.[0-9]+)?)/.exec(String(cell ?? ""));
  if (!m) drift(`${upstream}: no ${what} rate in "${cell}"`);
  return decimal(m[1]);
};
