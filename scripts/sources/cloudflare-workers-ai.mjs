/**
 * Cloudflare Workers AI's per-token prices, from the vendor's own pricing page.
 *
 * The page lists its models by category, one server-rendered table each —
 * LLM, embeddings, image, audio, other — and only the LLM table prices a
 * model per input *and* output token. The others are read by nothing here,
 * which is why the section heading is matched rather than "the first table
 * with a Model column": the image table prices per tile and per step, and the
 * audio table per minute, neither of which has a field.
 *
 * A price cell carries one to three figures in one string:
 *
 *   $0.027 per M input tokens $0.201 per M output tokens
 *   $0.440 per M input tokens $0.014 per M cached input tokens $1.320 per M output tokens
 *
 * The cache figure sits between the two, so each is matched by its whole
 * phrase — `per M input tokens` does not match `per M cached input tokens`,
 * and a parser that looked for `$x per M` alone would take the cached rate for
 * the input one on exactly the rows that have both.
 *
 * **The dollars are the vendor's, not a derivation.** models.dev carried a
 * different fourth decimal on four of these rows (0.0509 where the page says
 * $0.051) because it computed the rate from the neuron figure — 4625 neurons
 * per M input tokens at $0.011 per 1,000 neurons is $0.050875. The page states
 * both numbers, and the one a reader is billed in is the dollar one.
 */
import { getText, drift, decimal, MEMBERSHIP } from "../lib/fetch.mjs";

const URL = "https://developers.cloudflare.com/workers-ai/platform/pricing/";

const strip = (s) =>
  s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** One figure out of the cell, by its whole phrase. */
const figure = (cell, phrase) => {
  const m = new RegExp(`\\$([0-9]+(?:\\.[0-9]+)?)\\s+per M ${phrase}`).exec(cell);
  return m ? decimal(m[1]) : undefined;
};

export default {
  ids: ["cloudflare-workers-ai"],
  source: URL,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read"],

  async read() {
    const html = await getText(URL, { headers: { accept: "text/html" } });

    // Walk headings and tables in document order and take the table under
    // "LLM model pricing" — the only one whose rows price both directions.
    let section = "";
    let table = null;
    for (const node of html.match(/<h[2-4][^>]*>[\s\S]*?<\/h[2-4]>|<table[\s\S]*?<\/table>/g) ?? []) {
      if (node.startsWith("<h")) { section = strip(node); continue; }
      if (/^LLM model pricing$/i.test(section)) { table = node; break; }
    }
    if (!table) drift("no 'LLM model pricing' table — the page has been restructured");

    const rows = (table.match(/<tr[\s\S]*?<\/tr>/g) ?? []).map((r) =>
      (r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) ?? []).map(strip),
    );
    const head = rows[0] ?? [];
    if (!/^model$/i.test(head[0] ?? "") || !/price in tokens/i.test(head[1] ?? "")) {
      drift(`the LLM table's columns changed (${head.join(" | ")})`);
    }

    const out = [];
    for (const cells of rows.slice(1)) {
      const id = cells[0];
      if (!id || !id.startsWith("@cf/")) continue;
      const inRate = figure(cells[1], "input tokens");
      const outRate = figure(cells[1], "output tokens");
      const cached = figure(cells[1], "cached input tokens");
      // The schema wants both directions or neither; a row with only an input
      // rate is not a priced text model here.
      if (inRate === undefined || outRate === undefined) continue;
      out.push({
        id,
        name: id,
        in: inRate,
        out: outRate,
        ...(cached !== undefined ? { cache_read: cached } : {}),
      });
    }
    if (out.length === 0) drift("the LLM table yielded no priced rows");

    return { rows: { "cloudflare-workers-ai": out }, notes: { "cloudflare-workers-ai": [`${out.length} LLM rows read from the vendor's own table`] } };
  },
};
