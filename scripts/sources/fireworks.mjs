/**
 * Fireworks' serverless prices, from the three pages that together state them.
 *
 * Fireworks does not put per-token rates on one table. The pricing page
 * (`docs.fireworks.ai/serverless/pricing`) prices the headline models and says
 * everything else in the serverless catalogue is billed by parameter count and
 * architecture; each model's own page carries the actual rate in a
 * server-rendered display —
 *
 *   <div class="text-display-sm font-medium text-black">$3.00 / $0.30 / $15.00</div>
 *   Per 1M Tokens (input/cached input/output)
 *
 * — and the router aliases (`glm-latest`, `kimi-fast-latest`, …) are a table in
 * `docs.fireworks.ai/nexus/open-models` that says which model each alias
 * currently points at and in which tier. So the adapter reads:
 *
 *   models    `fireworks.ai/models?modelTypes=Serverless` — the vendor's own
 *             filtered catalogue, which is the live statement of what Fireworks
 *             sells serverless. Each listed model page must carry a price
 *             display; one that does not is a drift, not a row to drop, because
 *             a follow source would otherwise delete a live model's row.
 *   prices    the display on each of those model pages.
 *   fast      the Standard column of the pricing page's "Text and vision models"
 *             table, which is the only place the Fast tier (`kimi-k3-fast`,
 *             `glm-5p3-fast`) is priced.
 *   aliases   the "Current aliases" table in the open-models doc: alias ->
 *             current model + Standard/Fast tier. A `-latest` alias is a
 *             serverless model id in its own right, so its row is priced at its
 *             target's rate.
 *
 * **Membership is `follow`.** The filtered catalogue is a complete statement of
 * what the vendor sells serverless, and the entry is a Fireworks serverless
 * catalogue. That is a rebuild rather than a re-price: on 2026-10-18 the live
 * list held 15 models while the seed carried 33 rows, and most of the rows the
 * list has dropped were deprecated on serverless on 2026-09-25 — their pages
 * still show a billing sentence and a rate in the FAQ, but the same page's
 * metadata says `Serverless Not supported` and the FAQ says "Only on serverless,
 * starting September 25, 2026". A page that still states a dead model's rate is
 * not evidence that the model is for sale.
 *
 * The two router rows that are not in the alias table are the retired
 * `deepseek-pro-latest` and `glm-5p2-fast`, whose family left serverless, so
 * they leave with the models. `qwen3-embedding-8b` and `qwen3-reranker-8b` join
 * as input-only rows (`out: "0"`), the shape the embedding rows already use
 * elsewhere in the catalogue.
 *
 * A caution that is the vendor's own: the alias table is labelled "as of
 * September 27, 2026" and says to treat it as a snapshot. It is the only
 * keyless statement of the aliases — the serverless models endpoint that would
 * be live needs an API key — so the adapter follows it and reports the counts,
 * rather than pretending it is as current as the model filter.
 */
import { getText, drift, decimal, MEMBERSHIP } from "../lib/fetch.mjs";

const MODELS_URL = "https://fireworks.ai/models?modelTypes=Serverless";
const PRICING_URL = "https://docs.fireworks.ai/serverless/pricing";
const ALIASES_URL = "https://docs.fireworks.ai/nexus/open-models";

const strip = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The vendor's own number, without its padding: `$0.30` -> `0.3`. */
const money = (s) => decimal(s.trim(), "price").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

/** `$3.00 / $0.30 / $15.00` -> the three figures, in the order the page labels
    them under the display: input / cached input / output. A one-figure display
    is an embedding/reranker rate, which bills input only. */
const displayRates = (text) => {
  const figures = [...text.matchAll(/\$([0-9]+(?:\.[0-9]+)?)/g)].map((m) => money(m[1]));
  if (figures.length === 3) return { in: figures[0], cache_read: figures[1], out: figures[2] };
  if (figures.length === 1) return { in: figures[0], out: "0" };
  return null;
};

/** `<title>Kimi K3 API & Playground | Fireworks</title>` -> `Kimi K3`. */
const titleOf = (html) => {
  const t = /<title>([\s\S]*?)<\/title>/i.exec(html);
  return t ? strip(t[1]).replace(/\s+API & Playground.*$/i, "").trim() : null;
};

/** The `<tr>` elements of the first table after a heading id, kept as HTML so a
    link's href survives alongside its text. */
const rowsAfter = (html, id, what) => {
  const at = html.indexOf(`id="${id}"`);
  if (at < 0) drift(`no "${what}" section — the page restructured`);
  const table = /<table[\s\S]*?<\/table>/i.exec(html.slice(at));
  if (!table) drift(`"${what}" has no table`);
  return (table[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((r) =>
    (r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map((cell) => ({ html: cell, text: strip(cell) })),
  );
};

export default {
  ids: ["fireworks"],
  source: MODELS_URL,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read"],

  async read() {
    // ── the live serverless catalogue ──
    const library = await getText(MODELS_URL, { headers: { accept: "text/html" } });
    const links = [...new Set([...library.matchAll(/href="(\/models\/[^"]+)"/g)].map((m) => m[1]))];
    if (links.length === 0) drift("the serverless catalogue lists no models — the page restructured");

    const rows = [];
    const priced = new Map(); // slug -> {in, cache_read?, out}
    for (const link of links) {
      const slug = link.slice(link.lastIndexOf("/") + 1);
      const html = await getText(`https://fireworks.ai${link}`, { headers: { accept: "text/html" } });
      const display = /class="text-display-sm font-medium text-black">([^<]*)<\/div>/.exec(
        html.replace(/<!-- -->/g, ""),
      );
      const rates = display ? displayRates(strip(display[1])) : null;
      if (!rates) drift(`${link} is in the serverless catalogue but states no price display`);
      priced.set(slug, rates);
      rows.push({ id: `accounts/fireworks/models/${slug}`, name: titleOf(html) ?? slug, ...rates });
    }

    // ── the Fast tier, which only the pricing table states ──
    const pricing = await getText(PRICING_URL, { headers: { accept: "text/html" } });
    const priceRows = rowsAfter(pricing, "text-and-vision-models", "Text and vision models");
    const fast = new Map(); // base slug -> {name, rates}
    for (const cells of priceRows.slice(1)) {
      if (cells.length < 2) continue;
      const name = cells[0].text;
      // A US row is a region switch, not another model id; it is priced on the
      // same id and has no row in this entry.
      if (/\(US\)$/i.test(name)) continue;
      const href = /\/models\/([^/"]+\/[^/"]+)/.exec(cells[0].html);
      if (!href) continue; // the free-standing size tables have no model link
      if (!/\bFast$/i.test(name)) continue;
      const slug = href[1].slice(href[1].lastIndexOf("/") + 1);
      const rates = displayRates(cells[1].text);
      if (!rates) drift(`the pricing table's "${name}" row has no readable rate`);
      fast.set(slug, { name, rates });
    }
    if (fast.size === 0) drift("the pricing table has no Fast rows — the table restructured");
    // `Kimi K3 Fast` is the vendor's own id `kimi-k3-fast`; the family table in
    // the FireRouter doc spells both pinned Fast ids that way. They are called
    // through the router address (`accounts/fireworks/routers/<id>`), not the
    // base-model address, which is how the entry already carries them.
    for (const [slug, { name, rates }] of fast) {
      rows.push({ id: `accounts/fireworks/routers/${slug}-fast`, name, ...rates });
    }

    // ── the `-latest` aliases, priced at their target's tier ──
    const aliasesDoc = await getText(ALIASES_URL, { headers: { accept: "text/html" } });
    const aliasRows = rowsAfter(aliasesDoc, "current-aliases", "Current aliases");
    const header = aliasRows[0] ?? [];
    if (!/^alias$/i.test(header[0]?.text ?? "") || !/^current model$/i.test(header[1]?.text ?? "")) {
      drift(`the alias table's columns changed (${header.map((c) => c.text).join(" | ")})`);
    }
    const aliases = [];
    for (const cells of aliasRows.slice(1)) {
      const [alias, model, tier] = cells.map((c) => c.text);
      if (!alias || !model || !tier) continue;
      if (!/^(Standard|Fast)$/i.test(tier)) drift(`alias "${alias}" names an unknown tier "${tier}"`);
      const base = /^Standard$/i.test(tier) ? priced.get(model) : fast.get(model)?.rates;
      if (!base) drift(`alias "${alias}" points at "${model}" but the ${tier} rate for it was not read`);
      aliases.push({ id: `accounts/fireworks/routers/${alias}`, alias, model, tier, ...base });
      rows.push({ id: `accounts/fireworks/routers/${alias}`, name: alias, ...base });
    }
    if (aliases.length === 0) drift("the alias table yielded no rows");

    return {
      rows: { fireworks: rows },
      notes: {
        fireworks: [
          `${links.length} live serverless models on the filtered catalogue, ${aliases.length} aliases in the open-models snapshot`,
          "the alias table is labelled a snapshot (2026-09-27); the live alias source needs an API key, so it is followed as published",
          "Fast-tier ids are the pricing table's `Fast` rows, suffixed with -fast as the vendor's own family table spells them",
        ],
      },
    };
  },
};
