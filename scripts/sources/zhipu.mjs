/**
 * Read Zhipu's two price lists — the mainland one in yuan and Z.AI's in dollars.
 *
 * One file for two entries because they are one catalogue billed twice: the CN
 * page and the intl page list the same models at a regional price, and the two
 * entries exist so the app can show the price a reader's region is actually
 * charged. Splitting this into two adapters would put the same parsing decision
 * in two files.
 *
 * Three things about the pages shape this.
 *
 * The CN table's columns are not in the entry's field order — the two unit
 * prices sit between the model name and the cache column, and the cache columns
 * themselves are two different things: `缓存存储` is what holding a cache costs
 * per hour and `缓存命中` is what reading it costs per token. Only the second has
 * a field here, so columns are found by their header text and the storage column
 * is named nowhere, which is what keeps a reorder from silently swapping the two.
 *
 * The intl page escapes its dollar signs (`\$1.4`) because the docs are rendered
 * as MDX, so a leading backslash is stripped before the price is read.
 *
 * Both pages price far more than the entry carries: the entry is a deliberate
 * selection of the current generation, and the price list is in no position to
 * decide membership — the intl page's own "Latest Models" table still lists
 * GLM-5.2, which is not an entry row and must not become one. So only the page's
 * current-generation table is read, and of that only the ids the entry already
 * has are returned. The narrowing is done here rather than left to INTERSECT
 * because `merge()` in fetch-all.mjs adds every proposed row the entry lacks,
 * the membership tag notwithstanding, so handing it the whole table would grow
 * the entry. A page that stops pricing a curated model cannot drop it, only
 * leave it stale, so that case is reported as a note rather than passing in
 * silence.
 */
import { getText, decimal, drift, readEntry, MEMBERSHIP } from "../lib/fetch.mjs";

const CN = "https://docs.bigmodel.cn/cn/guide/start/pricing.md";
const INTL = "https://docs.z.ai/guides/overview/pricing.md";

/** The lines under one heading, up to the next heading of the same level. */
const section = (md, title) => {
  const lines = md.split("\n");
  const heads = lines.map((l) => /^(#+)\s+(.*)$/.exec(l));
  const at = heads.findIndex((h) => h && h[2].trim() === title);
  if (at < 0) drift(`${title}: no such heading — the page has been restructured`);
  const end = heads.findIndex((h, i) => i > at && h && h[1].length <= heads[at][1].length);
  return lines.slice(at + 1, end < 0 ? undefined : end);
};

/** A markdown table as [header, ...body] of trimmed cells; the `---` line dropped. */
const table = (lines, where) => {
  const pipes = lines.filter((l) => l.trim().startsWith("|"));
  if (pipes.length < 2) drift(`${where}: the pricing table is missing or no longer a table`);
  const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  return [cells(pipes[0]), pipes.slice(1).filter((l) => !/^\|[\s:|-]+\|$/.test(l.trim())).map(cells)];
};

/** Where each field lives, found by header text rather than by position. */
const columns = (where, head, wanted) => {
  const at = {};
  for (const [field, prefix] of Object.entries(wanted)) {
    at[field] = head.findIndex((h) => h.startsWith(prefix));
    if (at[field] < 0) drift(`${where}: the price table no longer has a "${prefix}" column (${head.join(" | ")})`);
  }
  return at;
};

/** The CN page's 旗舰模型 table: the current generation, in yuan. */
const cnRows = (md) => {
  const [head, body] = table(section(md, "旗舰模型"), CN);
  const at = columns(CN, head, { model: "模型名称", input: "输入单价", output: "输出单价", cache_read: "缓存命中" });
  return body.map((c) => ({
    id: c[at.model].toLowerCase(),
    in: decimal(c[at.input]),
    out: decimal(c[at.output]),
    cache_read: decimal(c[at.cache_read]),
  }));
};

/** Z.AI's Latest Models table: the current generation, in dollars. */
const intlRows = (md) => {
  const [head, body] = table(section(md, "Latest Models"), INTL);
  const at = columns(INTL, head, { model: "Model", input: "Input", output: "Output", cache_read: "Cached Input" });
  // `\$1.4` — the docs escape the sign, and decimal() only strips a bare one.
  const price = (s) => decimal(s.replace(/^\\/, ""));
  return body.map((c) => ({
    id: c[at.model].toLowerCase(),
    in: price(c[at.input]),
    out: price(c[at.output]),
    cache_read: price(c[at.cache_read]),
  }));
};

/** The currency the page is quoted in has to be the one the entry publishes. */
const check = (id, currency, url) => {
  const { prov } = readEntry(id);
  if (prov.currency !== currency) drift(`${id} bills in ${prov.currency} but ${url} prices in ${currency}`);
};

export default {
  ids: ["zhipu-glm", "zhipu-glm-intl"],
  source: `${CN} + ${INTL}`,
  membership: MEMBERSHIP.INTERSECT,
  owns: ["in", "out", "cache_read"],

  async read() {
    const [cn, intl] = await Promise.all([getText(CN), getText(INTL)]);
    check("zhipu-glm", "CNY", CN);
    check("zhipu-glm-intl", "USD", INTL);

    const rows = {};
    const notes = {};
    for (const [id, url, priced] of [
      ["zhipu-glm", CN, cnRows(cn)],
      ["zhipu-glm-intl", INTL, intlRows(intl)],
    ]) {
      if (priced.length === 0) drift(`${url}: the price table yielded no models`);
      const curated = readEntry(id).models.map((m) => m.id);
      const have = new Set(priced.map((r) => r.id));
      rows[id] = priced.filter((r) => curated.includes(r.id));
      if (rows[id].length === 0) drift(`${id}: none of the models this entry carries are still priced at ${url}`);
      const gone = curated.filter((m) => !have.has(m));
      if (gone.length) notes[id] = [`${gone.join(", ")}: no longer priced on the page — the entry keeps its old price, so check it by hand`];
    }

    return { rows, notes };
  },
};
