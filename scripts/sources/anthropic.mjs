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

/** "Fable 5.1" -> "claude-fable-5-1". */
const idOf = (name) => `claude-${name.toLowerCase().replace(/[.\s]+/g, "-")}`;

export default {
  ids: ["anthropic"],
  source: URL,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "cache_creation"],

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

    const rows = [...visible.matchAll(BLOCK)].map(([, name, read, write, i, o]) => ({
      id: idOf(name),
      in: decimal(i),
      out: decimal(o),
      cache_read: decimal(read),
      cache_creation: decimal(write),
    }));
    if (rows.length === 0) drift("no current-model price blocks matched — the page has been restructured");

    return { rows: { anthropic: rows } };
  },
};
