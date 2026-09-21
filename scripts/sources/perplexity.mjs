/**
 * Perplexity's Router prices, from the vendor's own rate card.
 *
 * `docs.perplexity.ai/docs/router/models.md` is a Mintlify page serving markdown
 * for free, and its "Perplexity-Hosted Models" table is the whole catalogue the
 * router serves — the API reference says the same list is the allowlist, so a
 * model missing from it cannot be requested. That is what makes this source
 * *follow* rather than *intersect*: it is not a selection from a longer price
 * list, it is the endpoint's own contents.
 *
 * Three things about the page are easy to get wrong.
 *
 * **The currency is escaped in the header and not in the cells.** Column labels
 * read `Input (\$/1M)` — a backslash before the dollar, which is markdown being
 * told not to start maths — while the rows carry a bare `3.00`. A parser that
 * expects the escape everywhere sees no rate in either place.
 *
 * **Cache writes are priced by a sentence, not a column.** The table gives input,
 * output and cache read; the note under it says cache writes bill "at the rate
 * shown (or at the input rate where no dedicated write rate is listed)". There is
 * no dedicated write rate in the table, so every row that supports writes bills
 * them at its own input rate — and one row is excepted from writes entirely. That
 * exception is a sentence too, so it is read as one, and the rule sentence is
 * **required**: a page that stopped saying it would be a page where the rates
 * below may no longer be input, which is a change no diff in the table would show.
 *
 * **The three APIs at this host are not three entries.** The Sonar models are on
 * the path being retired (Perplexity's own notice: supported until 2026-09-27),
 * and the Agent API answers `POST /v1/agent`, which is not the path the catalog's
 * `openai` protocol composes. The Router speaks both — `/router/v1` for OpenAI
 * clients and `/router` for the Anthropic SDK, which appends `/v1/messages` — and
 * those are the two URLs this entry carries. `GET /router/v1/models` returns the
 * same catalogue with the same prices for a key-holder; this reads the published
 * table so the run needs no credential.
 *
 * From this machine the host needs the proxy (`node scripts/probe-sources.mjs`);
 * from GitHub's US runners it does not.
 */
import { getText, drift, decimal, MEMBERSHIP, readEntry } from "../lib/fetch.mjs";

const URL = "https://docs.perplexity.ai/docs/router/models.md";

/** The write-rate rule, quoted. Its disappearance is the one change the table
    itself cannot show — see the header. */
const WRITE_RULE = /cache writes at the rate shown \(or at the input rate where no dedicated write rate is listed\)/;

export default {
  ids: ["perplexity"],
  source: URL,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "cache_creation"],

  async read() {
    const md = await getText(URL);

    const lines = md.split("\n");
    const start = lines.findIndex((l) => /^\|\s*Model\s*\|.*Cache read/i.test(l));
    if (start < 0) drift("no Model/…/Cache-read header — the rate card moved or was restructured");
    const table = [lines[start]];
    for (const l of lines.slice(start + 1)) {
      if (!l.trimStart().startsWith("|")) break;
      table.push(l);
    }
    if (table.length < 3) drift("the rate card has no rows");

    // The escape belongs to the header only, so it is stripped from the cells we
    // read as labels and never required in the cells we read as numbers.
    const cells = (l) =>
      l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

    const current = readEntry("perplexity").models;
    // The join the README describes: our id is canonical, the router's string
    // reaches the API through `serves`, and this translates between them.
    const canonical = new Map();
    for (const m of current) {
      for (const upstream of Object.values(m.serves ?? {})) canonical.set(upstream, m.id);
      canonical.set(m.id, m.id);
    }

    const exempted = new Set(
      [...md.matchAll(/`([A-Za-z0-9/._-]+)`\s+supports cache reads but not cache writes/g)].map(
        (m) => m[1],
      ),
    );
    if (!WRITE_RULE.test(md)) {
      drift("the cache-write note is gone — the write rate may no longer be the input rate");
    }

    const rows = [];
    const seen = new Set();
    for (const line of table.slice(2)) {
      const c = cells(line);
      const upstream = /\*\*`([^`]+)`\*\*/.exec(c[0])?.[1] ?? c[0].replace(/[`*\s]/g, "");
      if (!upstream || !/^[a-z0-9-]+\/[a-z0-9.-]+$/i.test(upstream)) {
        drift(`a row names "${c[0]}" where a \`creator/model\` id belongs`);
      }
      const id = canonical.get(upstream) ?? upstream.split("/").slice(1).join("/");
      const row = { id, name: linkText(c[4]) };
      const read = {
        in: rate(c[1], "input", upstream),
        out: rate(c[2], "output", upstream),
        cache_read: rate(c[3], "cache read", upstream),
      };
      Object.assign(row, read);
      if (!exempted.has(upstream)) row.cache_creation = read.in;
      rows.push(row);
      seen.add(upstream);
    }
    if (rows.length === 0) drift("no rows parsed — the rate card shape changed");
    if (new Set(rows.map((r) => r.id)).size !== rows.length) {
      drift("two rows translate to one of this entry's ids — the join is ambiguous");
    }

    const notes = [
      `${rows.length} rows from the vendor's own rate card`,
      "cache writes billed at each row's input rate (the page lists no dedicated write rate)",
    ];
    if (exempted.size) notes.push(`except ${[...exempted].join(", ")}, which supports no cache writes`);
    const lost = current.filter((m) => !(m.serves?.openai && seen.has(m.serves.openai))).map((m) => m.id);
    if (lost.length) notes.push(`not in the rate card: ${lost.join(", ")} (removed from the entry)`);
    return { rows: { perplexity: rows }, notes: { perplexity: notes } };
  },
};

const rate = (cell, what, upstream) => {
  const m = /([0-9]+(?:\.[0-9]+)?)/.exec(String(cell ?? ""));
  if (!m) drift(`${upstream}: no ${what} rate in "${cell}"`);
  return decimal(m[1]);
};

/** The Docs column's link text — "Kimi K3", "GLM-5.3 Flash". Only ever names a
    row that has none: the entry's own spelling wins wherever it has one. */
const linkText = (cell) => /\[([^\]]+)\]\(/.exec(String(cell ?? ""))?.[1]?.trim() || undefined;
