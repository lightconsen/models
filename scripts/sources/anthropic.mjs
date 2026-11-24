/**
 * Anthropic's published prices, scraped from the rendered pricing page.
 *
 * The page carries two tables of the same shape — the current models and a
 * "Legacy models" tab — and they are not distinguishable by their columns: both
 * list a name, an input, an output and a cached read and write. What separates
 * them is one line: every current model is followed by a marketing description,
 * and no legacy row has one. So the read cuts at the "Legacy models" marker and
 * then requires the description, which fails loudly if that ever stops being true
 * rather than quietly pricing Fable 5 in place of Fable 5.1.
 *
 * The row's `id` is derived from the page's display name ("Fable 5.1" ->
 * `claude-fable-5-1`) rather than carried on the page, which spells the model
 * out only in prose. The derivation is the vendor's own naming convention, and
 * generate.mjs validates the result against the entry, so a name the convention
 * does not cover lands as a new row for a human to look at rather than as a
 * silent edit.
 *
 * The page also prices one model in two length bands — Haiku 5.5, at 100K input
 * tokens. That block has the same opening (name, description, "Prompt caching")
 * but prefixes each rate group with its band, so it matched neither the plain
 * pattern nor nothing: it was silently the latter, and the entry simply never
 * carried the model. There is now a second pattern for it, and every block's
 * name is checked against the two parsers so a third shape drifts loudly.
 */
import { getText, drift, decimal, MEMBERSHIP } from "../lib/fetch.mjs";

const URL = "https://www.anthropic.com/pricing";

/** A current model: name, description, then the four rates in this order. The
    2026-09-24 restructure moved the prompt-caching block ahead of input and
    output — until then the page read Input, Output, then Prompt caching, and
    the reorder is the whole reason this adapter failed for a day (the values
    and their labels were untouched; only their order changed). */
const BLOCK =
  /([^\n]+)\n[^\n]+\nPrompt caching\nRead\n\$([0-9.]+)\n\/ MTok\nWrite\n\$([0-9.]+)\n\/ MTok\nInput\n\$([0-9.]+)\n\/ MTok\nOutput\n\$([0-9.]+)\n\/ MTok/g;

/** A current model priced in two length bands — Haiku 5.5 is the one. The same
    block, with each rate group prefixed by its band ("Prompts ≤ 100K tokens" /
    "Prompts &gt; 100K tokens"; the page prints the `&gt;` entity literally and
    the tag stripper keeps it). The base band is the row's own rate and the long
    band is `long_context`, whose `over` is the threshold the page states.
    Reading only the plain shape drops this model without a word — the entry
    would simply not carry it, which no price diff can show. The block count is
    checked against the rows below so that cannot happen quietly again. */
const TIERED =
  /([^\n]+)\n[^\n]+\nPrompt caching\nPrompts ≤ (\d+)K tokens\nRead\n\$([0-9.]+)\n\/ MTok\nWrite\n\$([0-9.]+)\n\/ MTok\nPrompts &gt; \d+K tokens\nRead\n\$([0-9.]+)\n\/ MTok\nWrite\n\$([0-9.]+)\n\/ MTok\nInput\nPrompts ≤ \d+K tokens\n\$([0-9.]+)\n\/ MTok\nPrompts &gt; \d+K tokens\n\$([0-9.]+)\n\/ MTok\nOutput\nPrompts ≤ \d+K tokens\n\$([0-9.]+)\n\/ MTok\nPrompts &gt; \d+K tokens\n\$([0-9.]+)\n\/ MTok/g;

/** "Fable 5.1" -> "claude-fable-5-1". */
const idOf = (name) => `claude-${name.toLowerCase().replace(/[.\s]+/g, "-")}`;

/** "Fable 5.1" -> "Claude Fable 5.1": the page drops the family word in the
    block's heading, and the entry's own names spell it out. Only a row that
    has no name takes this — an existing spelling wins. */
const displayName = (name) => (/^claude\b/i.test(name) ? name : `Claude ${name}`);

/** The current models' price blocks → rows. `visible` is the page's text with
    the legacy tab cut off and the markup stripped to one token per line.
    Exported for the test suite, which pins both shapes with text copied from
    the page. */
export const parseBlocks = (visible) => {
  const rows = [...visible.matchAll(BLOCK)].map(([, name, read, write, i, o]) => ({
    id: idOf(name),
    name: displayName(name),
    in: decimal(i),
    out: decimal(o),
    cache_read: decimal(read),
    cache_creation: decimal(write),
  }));
  const tiered = [...visible.matchAll(TIERED)].map(([, name, over, read, write, lread, lwrite, i, li, o, lo]) => ({
    id: idOf(name),
    name: displayName(name),
    in: decimal(i),
    out: decimal(o),
    cache_read: decimal(read),
    cache_creation: decimal(write),
    long_context: {
      over: Number(over) * 1000,
      in: decimal(li),
      out: decimal(lo),
      cache_read: decimal(lread),
      cache_creation: decimal(lwrite),
    },
  }));
  if (rows.length === 0 && tiered.length === 0) drift("no current-model price blocks matched — the page has been restructured");
  // Every current block opens with a name and a description and then
  // "Prompt caching". A block whose rates match neither shape is a model the
  // reader would otherwise drop without a word — the entry would simply not
  // carry it, which no price diff can show. Comparing the names the page
  // states against the ids the parsers produced catches exactly that.
  const named = [...visible.matchAll(/([^\n]+)\n[^\n]+\nPrompt caching\n/g)].map(([, name]) => idOf(name));
  const seen = new Set([...rows, ...tiered].map((r) => r.id));
  const missed = [...new Set(named)].filter((id) => !seen.has(id));
  if (missed.length) {
    drift(`the page prices ${missed.map((id) => `"${id}"`).join(", ")} in a shape this reader does not know — the price block changed again`);
  }
  return [...rows, ...tiered];
};

export default {
  ids: ["anthropic"],
  source: URL,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "cache_creation", "long_context"],

  async read() {
    const html = await getText(URL, { headers: { accept: "text/html" } });

    // Everything after this marker is the legacy tab, whose rows have no
    // description and would otherwise match the same shape.
    const cut = html.indexOf("Legacy models");
    if (cut < 0) drift('no "Legacy models" marker — the page has been restructured');
    const visible = html
      .slice(0, cut)
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "")
      .replace(/<[^>]+>/g, "\n")
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");

    const rows = parseBlocks(visible);
    return { rows: { anthropic: rows } };
  },
};
