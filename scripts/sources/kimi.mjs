/**
 * Kimi's published per-token prices, from the page the docs site serves.
 *
 * The pricing page is a Mintlify page whose table is a `<DocTable>` component:
 * on 2026-10-22 the markdown rendering (`…/pricing/chat.md`) began emitting an
 * **empty** `<table>` — the rows live in the component's props, which only the
 * HTML carries. So this reads the served HTML and takes the props out of the
 * React payload:
 *
 *   children:_jsx(DocTable,{ className:`doc-table-bordered`, …
 *     columns:[{title:`模型`},{title:`输入`},…,{title:`缓存写入（5min）`},…],
 *     rows:[[_jsx(_components.a,{href:`/guide/…`,children:`kimi-k3.1-pro`}),
 *            `¥13.00 / MTok`,`¥68.00 / MTok`,…]] })
 *
 * Two tables (K3 series, K2 series) are read and their rows merged.
 *
 * Columns are matched by their wording rather than position, so a reworded
 * header still lands — and a header that stops matching aborts the read instead
 * of shifting every number one column left. The two cache-write windows map to
 * the schema's `cache_creation` (5min, the default) and `cache_creation_1h`.
 *
 * The model list is read as well, purely to tell apart the two reasons a row can
 * be absent from the price table: the page says the model was retired, or it just
 * does not price it.
 */
import { getText, drift, decimal, MEMBERSHIP } from "../lib/fetch.mjs";

const PRICING_HTML = "https://platform.kimi.com/docs/pricing/chat";
const MODELS_MD = "https://platform.kimi.com/docs/models.md";

/** Column title -> our field. Matched loosely so a reworded header still lands. */
const columnField = (title) => {
  if (/缓存命中|cached input/i.test(title)) return "cache_read";
  if (/缓存写入.*1h|1h writes/i.test(title)) return "cache_creation_1h";
  if (/缓存写入|writes/i.test(title)) return "cache_creation";
  if (/缓存未命中|输入|input/i.test(title)) return "in";
  if (/输出|output/i.test(title)) return "out";
  return null;
};

/** The object literal of each `DocTable` component in the served page, by brace
    depth with backtick strings skipped (their text may contain braces). */
const docTables = (html) => {
  const out = [];
  for (const m of html.matchAll(/children:_jsx\(DocTable,\{/g)) {
    const start = m.index + m[0].length - 1;
    let depth = 0;
    let inTick = false;
    let i = start;
    for (; i < html.length; i++) {
      const ch = html[i];
      if (ch === "`") {
        inTick = !inTick;
        continue;
      }
      if (inTick) continue;
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        i++;
        break;
      }
    }
    out.push(html.slice(start, i));
  }
  return out;
};

/** Column labels, in order. A label may be plain (`title:\`模型\``) or wrapped in
    a Tooltip, where the label is the tooltip's `children`. */
const columnsOf = (payload) => {
  const a = payload.indexOf("columns:[");
  const b = payload.indexOf("],rows:");
  if (a < 0 || b < 0) return null;
  return payload
    .slice(a + "columns:[".length, b)
    .split("{title:")
    .slice(1)
    .map((seg) => {
      const child = /children:`([^`]*)`/.exec(seg);
      if (child) return child[1].trim();
      const plain = /^`([^`]*)`/.exec(seg.trim());
      return plain ? plain[1].trim() : "";
    });
};

/** Each row as `{ id, values }`, the values in column order. */
const rowsOf = (payload) => {
  const rows = [];
  for (const m of payload.matchAll(
    /\[_jsx\(_components\.a,[^\]]*?children:`([^`]+)`\}\)((?:,`[^`]*`)*)\]/g,
  )) {
    rows.push({ id: m[1].trim(), values: [...m[2].matchAll(/`([^`]*)`/g)].map((x) => x[1]) });
  }
  return rows;
};

/** `¥13.00 / MTok` -> `13.00`; a missing cell is left absent. */
const money = (cell) => {
  const m = /[¥$]\s*([0-9]+(?:\.[0-9]+)?)/.exec(cell ?? "");
  return m ? decimal(m[1]) : undefined;
};

export default {
  ids: ["kimi"],
  source: PRICING_HTML,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "cache_creation", "cache_creation_1h"],

  async read() {
    const html = await getText(PRICING_HTML, { headers: { accept: "text/html" } });
    const tables = docTables(html);
    if (tables.length === 0) drift("no DocTable payload in the pricing page");

    const out = [];
    const seen = new Set();
    for (const payload of tables) {
      const titles = columnsOf(payload);
      const rows = rowsOf(payload);
      // The page also carries `<DocTable>` boundary stubs whose props are only
      // the heading groups — no columns, no rows. They are not tables.
      if (!titles || titles.length === 0 || rows.length === 0) continue;

      // The price cells start after the model cell.
      const cols = [];
      for (let i = 0; i < titles.length; i++) {
        const field = columnField(titles[i]);
        if (field) cols.push([field, i - 1, titles[i]]);
      }
      if (!cols.some(([f]) => f === "in") || !cols.some(([f]) => f === "out")) {
        drift(`could not map the columns: ${titles.join(" | ")}`);
      }

      for (const r of rows) {
        if (!r.id || seen.has(r.id)) continue;
        const row = { id: r.id };
        for (const [field, at, title] of cols) {
          const v = money(r.values[at]);
          if (v === undefined) drift(`${r.id}: column "${title}" holds no price`);
          row[field] = v;
        }
        seen.add(r.id);
        out.push(row);
      }
    }
    if (out.length === 0) drift("no parseable rows in the pricing tables");

    // A model the vendor has retired, so a row missing from the price table can be
    // told apart from one the vendor simply does not bill for.
    const modelsMd = await getText(MODELS_MD);
    const retired = [...modelsMd.matchAll(/^\|\s*`?([a-z0-9.-]+)`?\s*\|\s*已下线\s*\|/gm)].map((m) => m[1]);
    const notes = retired.length ? [`the vendor marks these retired: ${retired.join(", ")}`] : [];

    return { rows: { kimi: out }, notes: { kimi: notes } };
  },
};
