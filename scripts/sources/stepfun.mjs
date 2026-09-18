/**
 * StepFun, both markets, from the vendor's own pricing pages.
 *
 * StepFun splits its platform in two and the split is **not cosmetic**:
 *
 *   China  `platform.stepfun.com/…/pricing/details.md`  ¥1.35 / ¥0.27 / ¥8.1 — cache hits at 20% of input
 *   Intl   `platform.stepfun.ai/…/pricing/details.md`   $0.20 / $0.04 / $1.15 — cache hits at 10% of input
 *
 * Different discount *structures*, not just different currencies — which is why
 * the catalogue carries two entries the way it carries minimax/minimax-intl and
 * zhipu-glm/zhipu-glm-intl, each priced in the money its market bills. The two
 * markets also run separate API hosts (`api.stepfun.com` / `api.stepfun.ai`,
 * both 401-verified); docs reachability differs too — `.com`'s docs drop TLS
 * from some networks while `.ai` answers everyone, so this file reads both pages
 * and says plainly when one could not be reached rather than pricing that market
 * from the other's numbers.
 *
 * A single earlier entry here got this wrong twice over: first via models.dev,
 * which divided the Chinese CNY by an exchange rate to invent USD the vendor
 * never sells; then by keeping one market's numbers under both hats. The
 * international page's own figures differ from that arithmetic in every column,
 * and its cache discount follows a different rule.
 *
 * The pages are Fern-served markdown, five or six columns wide, several tables
 * per page — and the tables are not interchangeable: speech sections bill per
 * hour and per character with their own units, and the per-character tables have
 * no cache-hit column at all. So **a table without a cache-hit column is not
 * read**, rows whose billing unit is not `1M tokens` are skipped, `\$` is a
 * markdown currency escape rather than a regex, and **only the Chinese page
 * leaves the model name out of backticks** — either form is accepted, because
 * guessing one convention across two localized pages is how a market silently
 * stops being priced at all.
 */
import { getText, drift, decimal, MEMBERSHIP, readEntry } from "../lib/fetch.mjs";

const CN = { entry: "stepfun", url: "https://platform.stepfun.com/docs/zh/guides/pricing/details.md" };
const INTL = { entry: "stepfun-intl", url: "https://platform.stepfun.ai/docs/en/guides/pricing/details.md" };

const cells = (row) =>
  row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().replace(/\\\$/g, "$"));

/** `1.35元`, `$0.20`, `¥8.1` — the number is what matters, the mark is locale. */
const rate = (cell) => {
  const m = /([0-9]+(?:\.[0-9]+)?)/.exec(String(cell ?? "").replace(/\\\$/g, "$").replace(/[$¥￥]|元/g, " "));
  return m ? decimal(m[1]) : undefined;
};

const isNameCell = (c) => /^`?[a-z][a-z0-9.\-]*`?$/i.test(String(c ?? "").trim());

/** Every per-1M-token row on one page, keyed by its vendor model string. */
const parsePage = (md) => {
  const byVendor = new Map();
  let cols = null;
  for (const l of md.split("\n")) {
    if (!l.trimStart().startsWith("|")) {
      cols = null;
      continue;
    }
    const head = cells(l).map((c) => c.toLowerCase());
    const hasHeader = head.some((c) => c.includes("model") || c.includes("模型"));
    const align = cells(l).every((x) => x === "" || /^:?-{2,}:?$/.test(x));
    if (hasHeader && !align) {
      // The same table localized: every column needs both wordings, and a
      // single-needle lookup silently misses the whole market — the first cut
      // found `模型` as a header but then looked for "model" inside it, matched
      // nothing, and reported the Chinese page as having no prices at all.
      const find = (...needles) => head.findIndex((c) => needles.some((n) => c.includes(n)));
      const unit = find("billing unit", "计费单位");
      const model = find("model", "模型");
      const inCol = find("cache miss", "缓存未命中");
      const cacheCol = find("cache hit", "缓存命中");
      const outCol = find("output price", "输出价格");
      // A table without a cache column has other meanings for its columns;
      // reading it positionally invents numbers.
      cols = [model, inCol, cacheCol, outCol, unit].every((i) => i >= 0)
        ? { model, inCol, cacheCol, outCol, unit }
        : null;
      continue;
    }
    if (!cols || align) continue;
    const c = cells(l);
    const name = String(c[cols.model] ?? "").replace(/`/g, "").trim().toLowerCase();
    if (!isNameCell(c[cols.model])) continue;
    if (!/1m\s*tokens|百万|1m=|1m =/i.test(String(c[cols.unit] ?? ""))) continue;
    const row = { id: name };
    for (const [field, i] of [["in", cols.inCol], ["cache_read", cols.cacheCol], ["out", cols.outCol]]) {
      const v = rate(c[i]);
      if (v !== undefined) row[field] = v;
    }
    if (!byVendor.has(name)) byVendor.set(name, row);
  }
  return byVendor;
};

const readMarket = async ({ entry, url }, current) => {
  const md = await getText(url);
  const byVendor = parsePage(md);
  if (byVendor.size === 0) drift(`${entry}: no per-token rows on ${url} — the page changed shape`);
  const rows = [];
  const missed = [];
  for (const r of current) {
    const hit = byVendor.get(r.id) ?? byVendor.get(String(r.serves?.openai ?? r.id).toLowerCase());
    if (!hit) {
      missed.push(r.id);
      continue;
    }
    rows.push({ id: r.id, in: hit.in, out: hit.out, ...(hit.cache_read ? { cache_read: hit.cache_read } : {}) });
  }
  if (rows.length === 0) drift(`${entry}: none of its rows are on its own market's page (missed: ${missed.join(", ")})`);
  const notes = [`${rows.length}/${current.length} rows priced from the vendor's ${entry === "stepfun" ? "China" : "international"} page`];
  if (missed.length) notes.push(`not priced there: ${missed.join(", ")} (left as they are)`);
  return { rows: { [entry]: rows }, notes: { [entry]: notes } };
};

const shared = {
  ids: [CN.entry, INTL.entry],
  source: `${CN.url} + ${INTL.url}`,
  membership: MEMBERSHIP.INTERSECT,
  owns: ["in", "out", "cache_read"],
};

/**
 * One adapter per market — `fetch-all` merges `rows` under each entry it maps,
 * so a single object could return both; separate objects keep a market's failure
 * its own, which is the same lesson `modelsdev` learned the hard way.
 */
export default [
  { ...shared, ids: [CN.entry], async read() { return readMarket(CN, readEntry(CN.entry).models); } },
  { ...shared, ids: [INTL.entry], async read() { return readMarket(INTL, readEntry(INTL.entry).models); } },
];
