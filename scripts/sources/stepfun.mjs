/**
 * StepFun's prices, from its own international docs — which serve markdown.
 *
 * `platform.stepfun.ai/docs/en/guides/pricing/details.md`. The docs split by
 * market, and the split is not cosmetic: the Chinese page bills ¥1.35/¥0.27/¥8.1
 * for `step-3.7-flash` and its cache-hit rate is **20% of input**, while the
 * international page sells the same model at $0.20/$0.04/$1.15 with a cache hit
 * of **10%** — a different structure, not a currency swap. The earlier entry and
 * its successor here follow the international market, so the page read is the
 * `.ai` one and the endpoint the `.ai` host (both answer 401 without a key).
 *
 * models.dev, the source before this one, had 0.185/1.11/0.037 — a division of
 * the *Chinese* CNY rates by the catalogue's display FX, wrong in every column:
 * the number is the international market's own, the cache structure is not even
 * the same model, and the vendor publishes the real figures as plain markdown
 * tables. The case for reading vendors directly, and the cost of a third party's
 * arithmetic, in one row.
 *
 * The page is several tables with the same five or six columns — reasoning and
 * multimodal tables priced per million tokens, speech tables that add a status
 * column and mix in rows billed per hour or per character. So: **tables that
 * have no cache-hit column are not read** (their columns would slide), rows whose
 * billing unit is not `1M tokens` are skipped, and `\$` is a currency escape,
 * not a regex.
 */
import { getText, drift, decimal, MEMBERSHIP, readEntry } from "../lib/fetch.mjs";

const URL = "https://platform.stepfun.ai/docs/en/guides/pricing/details.md";

const rate = (cell) => {
  const m = /\$\s*([0-9]+(?:\.[0-9]+)?)/.exec(String(cell ?? "").replace(/\\\$/g, "$"));
  return m ? decimal(m[1]) : undefined;
};

export default {
  ids: ["stepfun"],
  source: URL,
  membership: MEMBERSHIP.INTERSECT,
  owns: ["in", "out", "cache_read"],

  async read() {
    const md = await getText(URL);
    const lines = md.split("\n");

    const byVendor = new Map();
    let head = null;
    let cols = null;
    for (const l of lines) {
      if (!l.trimStart().startsWith("|")) {
        head = null;
        cols = null;
        continue;
      }
      const cells = (row) =>
        row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().replace(/\\\$/g, "$"));
      if (head === null) {
        head = cells(l).map((c) => c.toLowerCase());
        const idCol = head.findIndex((c) => c === "model");
        const inCol = head.findIndex((c) => c.includes("cache miss"));
        const cacheCol = head.findIndex((c) => c.includes("cache hit"));
        const outCol = head.findIndex((c) => c.includes("output price"));
        const unitCol = head.findIndex((c) => c.includes("billing unit"));
        // A table is read only if its header names all four; the per-hour and
        // per-character tables share neither columns nor units with the per-token
        // ones, and taking their cells positionally would invent prices.
        cols = [idCol, inCol, cacheCol, outCol, unitCol].every((i) => i >= 0)
          ? { idCol, inCol, cacheCol, outCol, unitCol }
          : null;
        continue;
      }
      if (!cols || /^:?-+/.test(l.replace(/[|\s:-]/g, "") === "" ? l : "----")) {
        if (!cols) continue;
      }
      const c = cells(l);
      // The `| :-- |` alignment rule under each header.
      if (c.every((x) => x === "" || /^:?-{2,}:?$/.test(x))) continue;
      if (!c[0]?.startsWith("`")) continue;
      // per-hour / per-character rows bill in another unit: skip rather than
      // read their number as a token rate.
      if (!/1m tokens/i.test(c[cols.unitCol] ?? "")) continue;
      const vendorId = c[cols.idCol].replace(/`/g, "");
      const row = { id: vendorId.toLowerCase() };
      for (const [field, i] of [["in", cols.inCol], ["cache_read", cols.cacheCol], ["out", cols.outCol]]) {
        const v = rate(c[i]);
        if (v !== undefined) row[field] = v;
      }
      if (!byVendor.has(row.id)) byVendor.set(row.id, row);
    }
    if (byVendor.size === 0) drift("no per-token model rows in the pricing page");

    const current = readEntry("stepfun").models;
    const rows = [];
    const missed = [];
    for (const r of current) {
      const hit = byVendor.get(r.id) ?? byVendor.get(r.serves?.openai ?? r.id);
      if (!hit) {
        missed.push(r.id);
        continue;
      }
      rows.push({ id: r.id, in: hit.in, out: hit.out, ...(hit.cache_read ? { cache_read: hit.cache_read } : {}) });
    }
    if (rows.length === 0) drift(`none of stepfun's rows are in its own pricing page (missed: ${missed.join(", ")})`);

    const notes = [`${rows.length}/${current.length} rows priced from the vendor's own international page`];
    if (missed.length) notes.push(`not priced there: ${missed.join(", ")} (left as they are)`);
    return { rows: { stepfun: rows }, notes: { stepfun: notes } };
  },
};
