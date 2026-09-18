/**
 * Together AI's prices, from its own docs — which serve markdown for free.
 *
 * `docs.together.ai/docs/serverless-models.md` is a Fern site ("append `.md` to
 * any page"), and the page is a plain markdown table: one row per model, keyed by
 * the API model string, with input / cached-input / output rates in columns whose
 * **header names the order** — the columns do not always run in the order they
 * read, and guessing it from position is exactly how a cached rate gets recorded
 * as the output rate. So the header decides.
 *
 * This was models.dev's provider until the vendor page was found; a vendor's own
 * table outranks a third party's copy of it, whatever the copy currently says.
 * `api.together.xyz/v1` answers 401 without a key.
 */
import { getText, drift, decimal, MEMBERSHIP, readEntry } from "../lib/fetch.mjs";

const URL = "https://docs.together.ai/docs/serverless-models.md";

const rate = (cell) => {
  const m = /\$\s*([0-9]+(?:\.[0-9]+)?)/.exec(String(cell ?? ""));
  return m ? decimal(m[1]) : undefined;
};

export default {
  ids: ["togetherai"],
  source: URL,
  membership: MEMBERSHIP.INTERSECT,
  owns: ["in", "out", "cache_read"],

  async read() {
    const md = await getText(URL);
    // The page carries **two tables** — the full one, and a shorter repeat with
    // three pricing columns instead of four. Flattening both let the second
    // overwrite the first, and a row with no cached column slid the output rate
    // into `cache_read`: Kimi K3's $15.00 output recorded as its cache price. So
    // the four-column table is located by its header and read until it ends;
    // anything after it is another table.
    const all = md.split("\n");
    const start = all.findIndex((l) => /\|\s*Organization\s*\|.*Cached input pricing/i.test(l));
    if (start < 0) drift("no Organization/Cached-input-pricing header — the docs restructured");
    const lines = [all[start]];
    for (const l of all.slice(start + 1)) {
      if (!l.trimStart().startsWith("|")) break;
      lines.push(l);
    }
    if (lines.length < 3) drift("the model table has no rows");
    const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().replace(/\\\$/g, "$"));
    const head = cells(lines[0]).map((c) => c.toLowerCase());
    const at = (needle) => {
      const i = head.findIndex((c) => c.includes(needle));
      if (i < 0) drift(`the table has no "${needle}" column — docs restructured`);
      return i;
    };
    const idCol = head.findIndex((c) => c.includes("api model string"));
    if (idCol < 0) drift("the table has no 'API model string' column");
    // `cached` first, and matched against the *label* before the unit — "input
    // pricing" is a substring of "cached input pricing", so `includes` alone fed
    // the output column in as the cache rate.
    const labelOf = (c) => c.split("(")[0].trim();
    const cols = {
      cache: head.findIndex((c) => labelOf(c).includes("cached input")),
      in: head.findIndex((c) => labelOf(c) === "input pricing"),
      out: head.findIndex((c) => labelOf(c) === "output pricing"),
    };
    for (const [name, i] of Object.entries(cols)) if (i < 0) drift(`the table has no "${name}" column — docs restructured`);

    const byVendor = new Map();
    for (const line of lines.slice(2)) {
      const c = cells(line);
      const vendorId = c[idCol]?.replace(/`/g, "").trim();
      if (vendorId) byVendor.set(vendorId.toLowerCase(), c);
    }
    if (byVendor.size === 0) drift("no rows parsed — the table shape changed");

    const current = readEntry("togetherai").models;
    const rows = [];
    const missed = [];
    for (const row of current) {
      const vendorId = (row.serves?.openai ?? row.id).toLowerCase();
      const c = byVendor.get(vendorId);
      if (!c) {
        missed.push(row.id);
        continue;
      }
      const out = { id: row.id };
      for (const [field, i] of [["in", cols.in], ["out", cols.out], ["cache_read", cols.cache]]) {
        const v = rate(c[i]);
        if (v !== undefined) out[field] = v;
      }
      rows.push(out);
    }
    if (rows.length === 0) drift(`none of the entry's rows appear in the docs table (missed: ${missed.join(", ")})`);

    const notes = [`${rows.length}/${current.length} rows priced from the vendor's own docs table`];
    if (missed.length) notes.push(`not in the table: ${missed.join(", ")} (left as they are)`);
    return { rows: { togetherai: rows }, notes: { togetherai: notes } };
  },
};
