/**
 * Volcengine Ark: the pay-as-you-go price list and the two plan pages.
 *
 * These pages were written off once as a logged-in session — the rendered docs
 * hosts are JavaScript shells, and the reviewer who tried them found
 * `ark.volcengine.com` returning 44 KB of which eighteen characters were text,
 * with the content arriving from an authenticated POST. That is not the whole
 * story: `www.volcengine.com/api/doc/getDocDetail?DocumentID=<id>` serves the
 * same content publicly, no key, and the id is the number in the page's URL.
 * The parameter is `DocumentID`, capitalised exactly — the other spellings are
 * rejected rather than redirected, which reads as a 404 for a page that exists.
 *
 * What comes back is a Quill-like delta, and that is why this adapter is longer
 * than its neighbours. The delta does not contain a table. It contains a column
 * block (`zoneType: "C"`), one row block per row (`"R"`), and one block per
 * *cell*, and neither the rows nor the columns say which cell belongs where.
 * The pairing lives in the cell block's key, which runs `x<rowCellId>…x<colCellId>…`
 * — the row and column blocks carry the ids, and the text block is the key that
 * starts with one and contains the other. So a table is reassembled from an
 * index of keys rather than read off a block, and the walk is column-block by
 * row-block because the column block is what fixes the column order. A row that
 * does not belong to a column block resolves to no key at all, which is how the
 * several tables on one page stay apart.
 *
 * `Result.Content` is a JSON *string*, so every doc is parsed twice.
 *
 * Two published facts the entries have nowhere to put, dropped rather than
 * squeezed: a model priced in three bands by input length keeps only the band on
 * its own row — the continuations below it are the second and third, and
 * `long_context` expresses one threshold — and cache storage, billed per million
 * tokens per *hour*, is not a per-token rate at all. Both are on the checklist.
 *
 * Which models the catalog carries is not derivable from either page and is
 * written down below.
 */
import { MEMBERSHIP, decimal, drift, getJson } from "../lib/fetch.mjs";

const API = "https://www.volcengine.com/api/doc/getDocDetail?DocumentID=";
const DOC = { payg: "1544106", coding: "1925114", agent: "2366394" };
const urlOf = (id) => `${API}${id}`;

/**
 * The models the catalog carries, where a page lists more.
 *
 * Both pages are complete statements of what the vendor sells, and both say
 * more than the entry does. The price list runs to 27 text models: the current
 * generation beside doubao-seed-1.5/1.6/1.8, glm-4.7, the DeepSeek preview
 * builds, and the rows the page itself prints 调整前价格 for. The Agent Plan's
 * table calls a twelfth model 文本生成 that the plan entry does not carry
 * (deepseek-v4.1-flash). No column marks which of them this catalog sells — it
 * is not a price fact — so the list is here, and the pages keep every other
 * say: a model listed here that leaves the page leaves the entry.
 *
 * The Coding Plan needs no such list: its 支持的模型 table names exactly the
 * eleven rows the entry holds, so it is read whole and a model the plan adds
 * joins the entry by itself.
 */
const CARRIED = {
  "volcesark-payg": [
    "doubao-seed-evolving",
    "doubao-seed-2.1-pro",
    "doubao-seed-2.1-turbo",
    "doubao-seed-2.0-pro",
    "doubao-seed-2.0-lite",
    "doubao-seed-2.0-mini",
    "doubao-seed-2.0-code",
    "glm-5.3-flash",
    "glm-5.2",
    "deepseek-v4-pro",
    "deepseek-v4-flash",
  ],
  "volcesark-agent-plan": [
    "doubao-seed-2.0-mini",
    "doubao-seed-2.0-lite",
    "deepseek-v4-flash",
    "glm-5.3-flash",
    "doubao-seed-2.1-turbo",
    "doubao-seed-evolving",
    "minimax-m3",
    "glm-5.3",
    "kimi-k2.7-code",
    "deepseek-v4-pro",
    "kimi-k3",
  ],
};

/** The delta, out of the JSON string the API wraps it in. */
const delta = async (id) => {
  const url = urlOf(id);
  const body = await getJson(url);
  const content = body?.Result?.Content;
  if (typeof content !== "string") drift(`${url}: no Result.Content`);
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    drift(`${url}: Result.Content is not the JSON string this adapter reads (${err.message})`);
  }
  if (!parsed?.data) drift(`${url}: the delta carries no data blocks`);
  return Object.entries(parsed.data);
};

/** One cell's text: the block whose key pairs this row with this column, or
    null when no key does — which is how a row of another table reads. */
const cell = (blocks, rowId, colId) => {
  for (const [key, block] of blocks) {
    if (!key.startsWith("x" + rowId) || !key.includes("x" + colId)) continue;
    return block.ops.filter((o) => typeof o.insert === "string").map((o) => o.insert).join("").trim();
  }
  return null;
};

/** Every table on the page, as grids of text. */
const grids = (blocks) => {
  const columns = blocks.filter(([, b]) => b.zoneType === "C");
  const rows = blocks.filter(([, b]) => b.zoneType === "R");
  const out = [];
  for (const [, column] of columns) {
    const colIds = column.ops.filter((o) => typeof o.insert === "object").map((o) => o.insert.id);
    for (const [, row] of rows) {
      const rowIds = row.ops.filter((o) => typeof o.insert === "object").map((o) => o.insert.id);
      if (rowIds.length === 0 || cell(blocks, rowIds[0], colIds[0]) === null) continue;
      const grid = rowIds.map((r) => colIds.map((c) => cell(blocks, r, c)));
      if (grid.some((line) => line.some((x) => x))) out.push(grid);
    }
  }
  return out;
};

/** The delta opens every line it wrote with "*", inside a cell as much as out. */
const lines = (text) => String(text ?? "").split("\n").map((l) => l.replace(/^\*+/, "").trim()).filter(Boolean);
const line1 = (text) => lines(text)[0] ?? "";

/** A header label, with the two widths of parenthesis read as one. */
const norm = (text) => line1(text).replace(/[（）]/g, (c) => (c === "（" ? "(" : ")")).replace(/\s+/g, "");
/** Where a column sits, or drift: a renamed column would otherwise read as a
    table of empty cells and quietly unpriced every row. */
const columnOf = (doc, head, name) => {
  const at = head.findIndex((c) => norm(c) === name);
  if (at < 0) drift(`doc ${doc}: the table has no "${name}" column — the page has changed shape`);
  return at;
};

const tableHaving = (blocks, doc, head, why) => {
  const grid = grids(blocks).find((g) => head(g[0]));
  if (!grid) drift(`doc ${doc}: ${why} — the page has changed shape`);
  return grid;
};

/** The metered price list: 在线推理（常规）, the one table that bills cache storage. */
const paygRows = (blocks) => {
  const grid = tableHaving(blocks, DOC.payg, (h) => norm(h[0]) === "模型名称" && h.some((c) => norm(c).startsWith("缓存存储")), "there is no 在线推理（常规）table");
  const at = {
    model: columnOf(DOC.payg, grid[0], "模型名称"),
    in: columnOf(DOC.payg, grid[0], "输入(非音频)"),
    out: columnOf(DOC.payg, grid[0], "输出"),
    cache: columnOf(DOC.payg, grid[0], "缓存命中(非音频)"),
  };
  const price = (text) => {
    const v = line1(text);
    return v === "" || v === "-" ? undefined : decimal(v);
  };

  const rows = new Map();
  for (const line of grid.slice(1)) {
    const written = line[at.model] ?? "";
    // A blank name is the vendor's merged cell: a further band of the model
    // above, whose rate is in `long_context`'s single threshold or nowhere.
    if (lines(written).length === 0 || /调整前价格/.test(written)) continue;
    const id = line1(written).replace(/正式版$/, "").toLowerCase();
    if (!CARRIED["volcesark-payg"].includes(id)) continue;
    if (rows.has(id)) drift(`doc ${DOC.payg}: ${id} is priced twice in the 常规 table`);
    const row = { id };
    for (const [field, column] of [["in", at.in], ["out", at.out], ["cache_read", at.cache]]) {
      const v = price(line[column]);
      if (v !== undefined) row[field] = v;
    }
    rows.set(id, row);
  }
  return [...rows.values()];
};

/** The Coding Plan: the models it names, ids and names, no rates. */
const codingRows = (blocks) => {
  const grid = tableHaving(blocks, DOC.coding, (h) => norm(h[0]) === "模型" && norm(h[1]) === "说明", "there is no 支持的模型 table");
  return grid
    .slice(1)
    .map((line) => line1(line[0]))
    .filter(Boolean)
    // The console's own switch, which is the id the endpoint answers to.
    .map((name) => ({ id: name === "Auto" ? "ark-code-latest" : name.toLowerCase(), name }));
};

/** The Agent Plan: its text models, ids and names, no rates. */
const agentRows = (blocks) => {
  const grid = tableHaving(blocks, DOC.agent, (h) => norm(h[0]) === "分类" && norm(h[1]) === "领域", "there is no 支持模型及 Harness table");
  return grid
    .slice(1)
    .filter((line) => norm(line[1]).startsWith("文本生成"))
    .map((line) => line1(line[2]).replace(/\s*\(.*\)$/, ""))
    .filter((id) => CARRIED["volcesark-agent-plan"].includes(id))
    .map((id) => ({ id, name: id }));
};

export default {
  ids: ["volcesark-payg", "volcesark", "volcesark-agent-plan"],
  source: Object.values(DOC).map(urlOf).join(", "),
  membership: MEMBERSHIP.FOLLOW,
  async read() {
    const [payg, coding, agent] = await Promise.all([DOC.payg, DOC.coding, DOC.agent].map(delta));
    return {
      rows: {
        "volcesark-payg": paygRows(payg),
        volcesark: codingRows(coding),
        "volcesark-agent-plan": agentRows(agent),
      },
    };
  },
};
