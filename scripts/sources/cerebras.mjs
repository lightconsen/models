/**
 * Cerebras' prices, from its own docs — a Fern site, so every page is markdown
 * for free (`inference-docs.cerebras.ai/llms.txt` indexes them all).
 *
 * The prices are **not** on a single page and not on a price table: each model
 * page carries one sentence, `Pricing: $0.35 per million input tokens, $0.75 per
 * million output tokens`, and the sentence's own words say which number is which.
 * So the model pages are discovered from the docs index rather than hardcoded —
 * the alternative is a slug map (`gpt-oss-120b` lives at `models/openai-oss`)
 * that goes stale the day a model is added, which is the day it is needed.
 *
 * `cerebras.ai/pricing` is the page you would look at first and cannot read:
 * its tables are client-rendered, and the served HTML carries the heading and
 * then `<!--$!--><template data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING">` where
 * the numbers should be. The per-model pages say the same figures in prose.
 *
 * No cache rates are published anywhere — Prompt Caching is documented as a
 * latency feature with no price attached, and the pricing page does not price
 * it either — so this source prices fresh input and output only.
 *
 * models.dev carries the same two models at the same four rates, which is the
 * one thing it agrees about; the vendor is the source regardless.
 */
import { getText, drift, decimal, MEMBERSHIP, readEntry } from "../lib/fetch.mjs";

const INDEX = "https://inference-docs.cerebras.ai/llms.txt";

/** The model pages, by their own slug. `overview` and `choose-a-model` are
    prose about the catalogue, not entries in it. */
const modelPages = (index) =>
  [...index.matchAll(/https:\/\/inference-docs\.cerebras\.ai\/models\/([a-z0-9.-]+)\.md/g)]
    .map((m) => m[0])
    .filter((u) => !/\/(overview|choose-a-model)\.md$/.test(u));

export default {
  ids: ["cerebras"],
  source: INDEX,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out"],

  async read() {
    const index = await getText(INDEX);
    const pages = modelPages(index);
    if (pages.length === 0) drift("the docs index lists no model pages — it was restructured");

    const current = readEntry("cerebras").models;
    // The join the README describes: the entry's id is canonical, the vendor's
    // string reaches the API through `serves`, and the adapter translates.
    const canonical = new Map(
      current.map((m) => [(m.serves?.openai ?? m.id).toLowerCase(), m.id]),
    );

    const rows = [];
    const seen = new Set();
    for (const url of pages) {
      const md = await getText(url);
      const idMatch = /Model ID:\s*`([^`]+)`/.exec(md);
      if (!idMatch) drift(`${url}: no "Model ID: \`…\`" line — the page changed shape`);
      const vendorId = idMatch[1].trim();
      const id = canonical.get(vendorId.toLowerCase()) ?? vendorId;

      // Both pages spell the pair the same way, and the order is not to be
      // guessed: `input tokens` and `output tokens` are in the sentence itself,
      // so a page that swapped them would swap the labels with them.
      const rates = new Map(
        [...md.matchAll(/\$([0-9.]+)\s+per million (input|output) tokens/g)].map((m) => [
          m[2],
          decimal(m[1]),
        ]),
      );
      if (rates.size === 0) {
        // A model page with no price is a model this entry cannot price, and
        // saying so is better than inventing one — but it is also the shape a
        // restructuring takes, so it is named on the run rather than skipped.
        rows.push({ id, name: title(md) });
        seen.add(id);
        continue;
      }
      if (!rates.has("input") || !rates.has("output")) {
        drift(`${url}: names only one of input/output — a half-priced row is not a row`);
      }
      rows.push({ id, name: title(md), in: rates.get("input"), out: rates.get("output") });
      seen.add(id);
    }
    if (rows.length === 0) drift("no priced rows — every model page changed shape at once");
    if (new Set(rows.map((r) => r.id)).size !== rows.length) drift("two pages claim the same model id");

    const notes = [`${rows.length} model pages read from the vendor's own docs index`];
    const lost = current.filter((m) => !seen.has(m.id)).map((m) => m.id);
    if (lost.length) notes.push(`not in the docs index: ${lost.join(", ")} (removed from the entry)`);
    return { rows: { cerebras: rows }, notes: { cerebras: notes } };
  },
};

/** The page's own `# ` heading — "OpenAI GPT OSS" — which only ever names a row
    that has none: the entry's own spelling wins wherever it has one. */
const title = (md) => /^#\s+(.+)$/m.exec(md)?.[1]?.trim() ?? undefined;
