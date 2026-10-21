/**
 * Read MiniMax's published rates, for both of its entries.
 *
 * One vendor, two hosts, one page shape: `platform.minimax.cn` prices in yuan
 * and `platform.minimax.io` in dollars, and the two pages carry the same table
 * with each figure worked out twice — the intl numbers are the vendor's own
 * round ones, not a conversion. So there is one parser here and two fetches.
 *
 * **The page moved in October 2026.** `docs/guides/pricing-paygo.md` now
 * redirects to `docs/pricing/overview.md`, and the LLM section is plain
 * Markdown tables rather than the MDX `<Tabs>`/`<Accordion>` blocks this
 * adapter used to walk. The reading below is of the new page; the old one is
 * no longer served.
 *
 * The section holds three tables:
 *
 * - a flat table for `MiniMax-M3.1-Flash`, the new Flash tier;
 * - `标准` / `Standard`, where M3 is priced once for `≤ 512k` input tokens and
 *   once for `> 512k`. The first becomes the row and the second its
 *   `long_context`, which is what that field is for;
 * - `优先` / `Priority`: 1.5x standard, the same names and bands. The schema
 *   records the multiplier on the row (`service_tier`) rather than a second
 *   set of prices, so the section is cut before the priority table and only
 *   the standard prices are read.
 *
 * **Membership follows the vendor's model list**, not this page alone. As of
 * 2026-10-21 `docs/faq/models.md` lists exactly two current language models,
 * `MiniMax-M3.1-Flash` and `MiniMax-M3`; **M2.7 and M2.7-highspeed are retired**
 * (new-user calls stopped 2026-10-19, final shutdown 2026-11-18, and plan
 * requests route to M3.1 Flash in the meantime). The entry's two M2.7 rows
 * therefore leave and M3.1-Flash joins.
 *
 * Two spellings the page uses that this undoes. Prices are shown as
 * `~~4.20~~ 2.10` — list price, then current price — and only the second is
 * what anyone pays. And the intl page writes `\$0.30`, the dollar sign
 * escaped, so the escape is removed before the number is taken.
 */
import { decimal, drift, getText, MEMBERSHIP } from "../lib/fetch.mjs";

const CN = "https://platform.minimax.cn/docs/pricing/overview.md";
const INTL = "https://platform.minimax.io/docs/pricing/overview.md";

/** The page's inline HTML and markdown emphasis, minus the words they wrap. */
const text = (s) =>
  s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();

/** Which rate a column holds, read off its header rather than its position. */
const COLUMNS = [
  [/输入|input/i, "in"],
  [/输出|output/i, "out"],
  [/读取|caching\s*read/i, "cache_read"],
  [/写入|caching\s*write/i, "cache_creation"],
];

/** `~~4.20~~ 2.10` is list price then current price, and the struck figure is
    not what anyone pays. On the intl page the dollar sign is escaped. */
const rate = (cell, what) => {
  const now = cell.split("~~").pop().replace(/\\\$/g, "$");
  const m = /(\d+(?:\.\d+)?)/.exec(now);
  if (!m) drift(`${what}: "${cell}" holds no price`);
  return decimal(m[1], what);
};

/** `≤ 512k 输入 tokens` / `> 512k input tokens`. The comparator is the whole of
    the difference between the two bands, and `k` is a thousand here — the entry
    records the second band's floor as 512000, not 524288. */
const bandOf = (cell) => {
  const m = /([<≤>≥])\s*(\d+(?:\.\d+)?)\s*k/i.exec(cell);
  return m ? { over: Number(m[2]) * 1000, above: m[1] === ">" || m[1] === "≥" } : null;
};

/** The model as the vendor spells it, which is the only name in the cell. */
const vendorOf = (cell, what) => {
  const m = /^MiniMax-[\w.-]*\w/.exec(cell);
  if (!m) drift(`${what}: no model name in "${cell}"`);
  return m[0];
};

/** The entry spells the vendor's models lower case over the same hyphens
    (`MiniMax-M2.7-highspeed` and `minimax-m2.7-highspeed`), so both the id and
    the display name come off the page rather than off a table kept in step by
    hand. The name is spelling only; the entry's own is what gets written. */
const idOf = (vendor, what) => {
  const id = vendor.toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(id)) drift(`${what}: "${vendor}" does not make a usable id`);
  return id;
};
const nameOf = (vendor) => vendor.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");

/** Every markdown table in `md`, as rows of cells. The `| :-- | :-- |` alignment
    row under each header is not data. */
const tables = (md) => {
  const out = [];
  let cur = null;
  for (const line of md.split("\n")) {
    if (!/^\s*\|/.test(line)) {
      cur = null;
      continue;
    }
    if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
    if (!cur) out.push((cur = []));
    cur.push(line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(text));
  }
  return out;
};

/** One table read into `{ vendor, rates, band }`. */
const readTable = (rows, what) => {
  const [head, ...body] = rows;
  if (!/模型|model/i.test(head[0])) drift(`${what}: the first column is not the model`);
  const fields = head.slice(1).map((h) => {
    const col = COLUMNS.find(([re]) => re.test(h));
    if (!col) drift(`${what}: no field for the column "${h}"`);
    return col[1];
  });
  return body.map((cells) => {
    if (cells.length !== head.length) drift(`${what}: "${cells[0]}" has cells the header does not`);
    const rates = {};
    for (let i = 0; i < fields.length; i++) rates[fields[i]] = rate(cells[i + 1], `${what} ${cells[0]}`);
    return { vendor: vendorOf(cells[0], what), rates, band: bandOf(cells[0]) };
  });
};

const parse = (md, what) => {
  const m = /^\s*##\s+(?:语言模型|Language Models|LLM)[^\n]*\n([\s\S]*?)(?=\n\s*##\s)/m.exec(md);
  if (!m) drift(`${what}: no language-model section`);
  // The priority tier is a multiplier on the same rows, not a second price set.
  // Cut it off before any table is read.
  const body = m[1].split(/\*\*(?:优先|Priority)\*\*/)[0];
  if (!/MiniMax-M3\.1-Flash|MiniMax-M3/.test(body)) drift(`${what}: the LLM section names no M3 model`);

  const byVendor = new Map();
  for (const table of tables(body)) {
    for (const r of readTable(table, what)) {
      byVendor.set(r.vendor, [...(byVendor.get(r.vendor) ?? []), r]);
    }
  }

  const rows = [];
  for (const [vendor, bands] of byVendor) {
    const row = { id: idOf(vendor, what), name: nameOf(vendor) };
    if (bands.length === 1 && !bands[0].band) {
      row.in = bands[0].rates.in;
      row.out = bands[0].rates.out;
      if (bands[0].rates.cache_read !== undefined) row.cache_read = bands[0].rates.cache_read;
      rows.push(row);
      continue;
    }
    const base = bands.filter((b) => !b.band?.above);
    const over = bands.filter((b) => b.band?.above);
    if (base.length !== 1) drift(`${what}: "${vendor}" has ${base.length} bands at its base price, expected one`);
    if (over.length > 1) drift(`${what}: "${vendor}" is banded ${over.length} times above the base and the field holds one`);
    row.in = base[0].rates.in;
    row.out = base[0].rates.out;
    if (base[0].rates.cache_read !== undefined) row.cache_read = base[0].rates.cache_read;
    if (over.length === 1) row.long_context = { over: over[0].band.over, ...over[0].rates };
    rows.push(row);
  }

  // A model priced in two places would be merged away silently, the later row
  // winning, so neither price could be called wrong.
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.id)) drift(`${what}: "${r.id}" is priced twice on the page`);
    seen.add(r.id);
  }
  if (rows.length === 0) drift(`${what}: no priced models`);
  return rows;
};

export default {
  ids: ["minimax", "minimax-intl"],
  source: `${CN}, ${INTL}`,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "cache_creation", "long_context"],
  async read() {
    const [cn, intl] = await Promise.all([getText(CN), getText(INTL)]);
    return { rows: { minimax: parse(cn, "minimax.cn"), "minimax-intl": parse(intl, "minimax.io") } };
  },
};
