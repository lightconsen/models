/**
 * Read MiniMax's published rates, for both of its entries.
 *
 * One vendor, two hosts, one page shape: `platform.minimaxi.com` prices in yuan
 * and `platform.minimax.io` in dollars, and the two pages carry the same table
 * with each figure worked out twice — the intl numbers are the vendor's own round
 * ones, not a conversion. So there is one parser here and two fetches.
 *
 * The LLM section is harder to read than it looks, and every row this drops is a
 * decision worth recording:
 *
 * - The models sit in a `<Tabs>` block whose second tab is the *priority* tier:
 *   1.5x standard, the same model names, and the schema has nowhere to put a
 *   multiplier (checklist.md:43). Only the Standard tab is read — a parser that
 *   took the block whole would see every name twice and as often as not pick the
 *   priority number.
 * - M3 is tiered by input length and appears twice inside that tab, once for
 *   `≤ 512k` and once for `> 512k`. The first band becomes the row and the second
 *   becomes its `long_context`, which is exactly what that field is for.
 * - M2.5/M2.1/M2 live in an `<Accordion title="历史模型">`, priced but retired.
 *   They must not reach the entry, so the accordion goes before any table is read.
 *
 * Two spellings the page uses that this undoes. Prices are shown as
 * `~~4.20~~ 2.10` — list price, then current price — and only the second is what
 * anyone pays. And the intl page writes `\$0.30 / M tokens`, unit in the cell and
 * the dollar sign escaped, so only the number in front is taken.
 */
import { decimal, drift, getText, MEMBERSHIP } from "../lib/fetch.mjs";

const CN = "https://platform.minimaxi.com/docs/guides/pricing-paygo.md";
const INTL = "https://platform.minimax.io/docs/guides/pricing-paygo.md";

/** The page's inline HTML and markdown emphasis, minus the words they wrap. */
const text = (s) =>
  s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();

/** Which rate a column holds, read off its header rather than its position: the
    M2.7 table carries a cache-write column the M3 tab does not, and a page that
    reorders the two cache columns should move the numbers, not the labels. */
const COLUMNS = [
  [/输入|input/i, "in"],
  [/输出|output/i, "out"],
  [/读取|caching\s*read/i, "cache_read"],
  [/写入|caching\s*write/i, "cache_creation"],
];

/** `~~4.20~~ 2.10` is list price then current price, and the struck figure is not
    what anyone pays. On the intl page the unit rides in the same cell. */
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
  const m = /^##\s+(?:语言模型|Language Models|LLM)[^\n]*\n([\s\S]*?)(?=\n##\s)/m.exec(md);
  if (!m) drift(`${what}: no language-model section`);
  // 历史模型 / Legacy Models — priced, retired, and not this entry's business.
  const body = m[1].replace(/<Accordion\b[^>]*>[\s\S]*?<\/Accordion>/g, "");
  const tabs = /<Tabs\b[^>]*>([\s\S]*?)<\/Tabs>/.exec(body);
  if (!tabs) drift(`${what}: the language-model section has no <Tabs> block`);
  const std = /<Tab\b[^>]*title="(?:标准|Standard)"[^>]*>([\s\S]*?)<\/Tab>/.exec(tabs[1]);
  if (!std) drift(`${what}: no Standard tab`);

  const rows = [];
  for (const r of tables(body.replace(/<Tabs\b[^>]*>[\s\S]*?<\/Tabs>/g, "")).flatMap((t) => readTable(t, what))) {
    if (r.band) drift(`${what}: "${r.vendor}" is banded outside the tabs, where this reads one band per model`);
    rows.push({ id: idOf(r.vendor, what), name: nameOf(r.vendor), ...r.rates });
  }

  const tiered = new Map();
  for (const t of tables(std[1])) {
    for (const r of readTable(t, `${what} standard tab`)) tiered.set(r.vendor, [...(tiered.get(r.vendor) ?? []), r]);
  }
  for (const [vendor, bands] of tiered) {
    const base = bands.filter((b) => !b.band?.above);
    const over = bands.filter((b) => b.band?.above);
    if (base.length !== 1) drift(`${what}: "${vendor}" has ${base.length} bands at its base price, expected one`);
    if (over.length > 1) drift(`${what}: "${vendor}" is banded ${over.length} times above the base and the field holds one`);
    const row = { id: idOf(vendor, what), name: nameOf(vendor), ...base[0].rates };
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
  async read() {
    const [cn, intl] = await Promise.all([getText(CN), getText(INTL)]);
    return { rows: { minimax: parse(cn, "minimaxi.com"), "minimax-intl": parse(intl, "minimax.io") } };
  },
};
