/**
 * OpenAI's prices, from the markdown the docs site serves for every page.
 *
 * `developers.openai.com/api/docs/pricing.md` — append `.md` to any docs URL. It
 * is the plainest source in this directory: a header row naming all eight
 * columns, then one row per model with the values spelled out. Three tiers are
 * published this way (Standard, Batch, Flex) plus a fourth for fast mode, and
 * this reads **Standard** — the others are the same model on a different
 * schedule, and the catalogue carries one price per model.
 *
 * The eight columns are the schema exactly: short-context input, cached input,
 * cache writes and output are the row's own rates, and the four long-context
 * ones are `long_context`.
 *
 * **The boundary is stated on the model pages, not here.** Each of them says it
 * in the same words — `Prompts with more than 272K input tokens are priced at 2x
 * input and cache rates and 1.5x output for the full request` — which is why the
 * long-context columns are exactly 2× the input and cache rates and 1.5× the
 * output on every row, and why only some rows spell the threshold out in their
 * name (`gpt-5.5 (<272K context length)`). `for the full request` is the part
 * worth not missing: crossing the boundary re-rates every token in the request,
 * not the excess. Reading the model pages for this would cost four more requests
 * per run to learn a constant; the table's own columns carry the prices, and the
 * rows that name the threshold are enough to read it off.
 *
 * **This replaces a third-party transcription, and the reason is worth keeping.**
 * The entry was built from `models.dev/labs/openai` because this page answered
 * `unsupported_country_region_territory` from the machine that was reading. The
 * caveat recorded at the time was that a third party's reading is a weaker claim
 * than the vendor's own table. It was right: models.dev lists a model called
 * `gpt-5.6` at the same four rates as `gpt-5.6-sol`, and OpenAI publishes no such
 * model. A duplicate under a name the vendor does not use, sitting in the
 * catalogue as though it were a fifth flagship.
 *
 * Membership is `intersect`: this table runs to about thirty models including the
 * whole gpt-4.1 and o-series back catalogue, and the entry carries the current
 * flagship line.
 */
import { getText, drift, decimal, MEMBERSHIP, readEntry } from "../lib/fetch.mjs";

const URL = "https://developers.openai.com/api/docs/pricing.md";

/** The short/long boundary, as named in the rows that spell it out. */
const THRESHOLD = 272_000;

const money = (cell) => {
  const v = String(cell ?? "").trim().replace(/^\$/, "");
  return v === "" || v === "-" ? undefined : decimal(v);
};

/** The Standard tier's table, which is the one whose header names the context bands. */
const standardTable = (md) => {
  const section = md.split(/^### Standard pricing data\s*$/m)[1]?.split(/^### /m)[0];
  if (section === undefined) drift("the page has no '### Standard pricing data' section");
  const rows = section
    .split("\n")
    .filter((l) => l.trimStart().startsWith("|"))
    .map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()));
  // Row 0 is the header, row 1 the `---` rule.
  if (rows.length < 3) drift("the Standard table has no data rows");
  return { header: rows[0], rows: rows.slice(2) };
};

const columnOf = (header, name) => {
  const i = header.findIndex((c) => c.toLowerCase() === name);
  if (i < 0) drift(`the Standard table has no "${name}" column — the page has changed shape`);
  return i;
};

export default {
  ids: ["openai"],
  source: URL,
  membership: MEMBERSHIP.INTERSECT,
  owns: ["in", "out", "cache_read", "cache_creation", "long_context"],

  async read() {
    const md = await getText(URL);
    const { header, rows } = standardTable(md);

    const at = {
      model: columnOf(header, "model"),
      shortIn: columnOf(header, "short context input"),
      shortCached: columnOf(header, "short context cached input"),
      shortWrite: columnOf(header, "short context cache writes"),
      shortOut: columnOf(header, "short context output"),
      longIn: columnOf(header, "long context input"),
      longCached: columnOf(header, "long context cached input"),
      longWrite: columnOf(header, "long context cache writes"),
      longOut: columnOf(header, "long context output"),
    };

    const byId = new Map();
    for (const row of rows) {
      // Some rows carry their own context note in the name — `gpt-5.5 (<272K
      // context length)` — which is where the boundary is stated at all.
      const id = row[at.model].replace(/\s*\(<[^)]*context length\)$/i, "").trim();
      if (id === "") continue;
      const row_ = { id };
      const set = (field, cell) => {
        const v = money(cell);
        if (v !== undefined) row_[field] = v;
      };
      set("in", row[at.shortIn]);
      set("cache_read", row[at.shortCached]);
      set("cache_creation", row[at.shortWrite]);
      set("out", row[at.shortOut]);
      // Rows the page prices elsewhere — embeddings, transcription — carry `-`
      // in both rate columns and have nothing this schema can hold.
      if (row_.in === undefined && row_.out === undefined) continue;

      const long = {
        in: money(row[at.longIn]),
        out: money(row[at.longOut]),
        cache_read: money(row[at.longCached]),
        cache_creation: money(row[at.longWrite]),
      };
      if (long.in !== undefined && long.out !== undefined) {
        row_.long_context = {
          over: THRESHOLD,
          in: long.in,
          out: long.out,
          ...(long.cache_read !== undefined ? { cache_read: long.cache_read } : {}),
          ...(long.cache_creation !== undefined ? { cache_creation: long.cache_creation } : {}),
        };
      }
      // First row wins: the flagship table and the specialised table below it
      // both list `gpt-5.6-sol`, with the same rates.
      if (!byId.has(id)) byId.set(id, row_);
    }
    if (byId.size === 0) drift("no priced models in the Standard table");

    const current = readEntry("openai").models;
    const rows_ = current.map((r) => byId.get(r.id)).filter(Boolean);
    if (rows_.length === 0) drift("none of the entry's models are in the Standard table — the join is broken");

    const missing = current.filter((r) => !byId.has(r.id));
    const notes = [`${byId.size} priced models in the Standard table, ${rows_.length} of them in the entry`];
    if (missing.length) {
      notes.push(
        `not in the vendor's table: ${missing.map((r) => r.id).join(", ")} — a model the catalogue carries and OpenAI does not list`,
      );
    }

    return { rows: { openai: rows_ }, notes: { openai: notes } };
  },
};
