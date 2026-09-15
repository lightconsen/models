/**
 * Volcengine Ark: the pay-as-you-go price list and the two plan pages.
 *
 * These were written off once as a logged-in session — the rendered docs hosts
 * are JavaScript shells, and `ark.volcengine.com` returns 44 KB of which eighteen
 * characters are text. But `www.volcengine.com/api/doc/getDocDetail?`
 * `DocumentID=<id>` serves the same documents publicly, no key, and the id is the
 * number in the page's URL. `DocumentID` is capitalised exactly; other spellings
 * are rejected rather than redirected, which reads as a 404 for a page that
 * exists.
 *
 * **Read `Result.MDContent`, not `Result.Content`.** Both are in the response and
 * they are the same document. `Content` is a Quill-style delta with no tables in
 * it — a column block, a row block, and a block per cell, with the pairing hidden
 * in each cell block's key — so rebuilding a table means walking block ids and
 * matching key prefixes on `x<rowId>…x<colId>…`. It is the obvious thing to reach
 * for, it works, and `MDContent` is the same page already rendered as markdown.
 * This reads `|` rows like every other source here.
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
 * That makes these two entries `intersect` in every way but the declaration: the
 * page cannot decide membership for them. The Coding Plan needs no such list —
 * its 支持的模型 table names exactly the eleven rows the entry holds, so it is
 * read whole and a model the plan adds joins by itself.
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

/** A cell's text: markup dropped and the markdown's backslash escapes removed (a
    model is written `doubao\-seed\-evolving` so the hyphens cannot be read as a
    list). The line breaks are kept, because a cell is not one thing: a header
    puts its unit on a second line ("输入(非音频)" then "元/百万token") and a model
    cell puts its badges there ("glm-5.3 (glm-latest)" then a 注意 callout). Reading
    only the first line is what tells the label from the annotation. */
const cell = (s) =>
  String(s)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/\\/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

const line1 = (text) => String(text ?? "").split("\n")[0].trim();

/** A header cell's label, without the unit on the line below it. */
const label = (c) => line1(cell(c));

/** Every markdown table in the document, in order, as grids of cell text. A row
    of `---` is the alignment rule under a header rather than a row of data. */
const tablesOf = (md) => {
  const out = [];
  let grid = null;
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("|")) {
      grid = null; // a blank line ends the table
      continue;
    }
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell);
    if (cells.every((c) => c === "" || /^-+$/.test(c))) continue;
    if (!grid) out.push((grid = []));
    grid.push(cells);
  }
  return out;
};

/** The one table on the page matching a header shape, or drift. Returning the
    wrong table is the failure this prevents: most of them are two columns of
    prose, and a loose match would price nothing and look like no change. */
const tableOf = (md, doc, wanted, columns) => {
  const grid = tablesOf(md).find((g) => wanted(g[0].map(label)));
  if (!grid) drift(`doc ${doc}: no table with columns ${columns.join("/")} — the page has changed shape`);
  return grid;
};

/** Where a named column sits, or drift: a renamed column would otherwise read as
    a grid of empty cells and quietly unpriced every row. */
const columnsOf = (grid, doc, names) => {
  const head = grid[0].map(label);
  const at = {};
  for (const [field, name] of Object.entries(names)) {
    const i = head.indexOf(name);
    if (i < 0) drift(`doc ${doc}: the table has no "${name}" column — the page has changed shape`);
    at[field] = i;
  }
  return at;
};

const markdown = async (id) => {
  const url = urlOf(id);
  const body = await getJson(url);
  const md = body?.Result?.MDContent;
  if (typeof md !== "string" || md === "") drift(`${url}: no Result.MDContent — the response shape has changed`);
  return md;
};

/** The metered price list: 在线推理（常规）, the one table that bills cache storage. */
const paygRows = (md) => {
  const grid = tableOf(md, DOC.payg, (h) => h.includes("模型名称") && h.some((c) => c.startsWith("缓存存储")), [
    "模型名称",
    "缓存存储",
  ]);
  const at = columnsOf(grid, DOC.payg, {
    model: "模型名称",
    in: "输入(非音频)",
    out: "输出",
    cache: "缓存命中(非音频)",
  });

  const rows = new Map();
  for (const line of grid.slice(1)) {
    // A blank name is the vendor's merged cell: a further band of the model
    // above, whose rate is in `long_context`'s single threshold or nowhere. The
    // 调整前价格 marker sits on a later line of the cell, so it is looked for in
    // the whole thing — reading only the first line would miss it and price the
    // superseded row twice.
    const raw = line[at.model];
    const written = line1(raw);
    if (!written || /调整前价格/.test(raw)) continue;
    const id = written.replace(/正式版$/, "").toLowerCase();
    if (!CARRIED["volcesark-payg"].includes(id)) continue;
    if (rows.has(id)) drift(`doc ${DOC.payg}: ${id} is priced twice in the 常规 table`);
    const row = { id };
    for (const [field, i] of [["in", at.in], ["out", at.out], ["cache_read", at.cache]]) {
      const v = line[i];
      if (v && v !== "-") row[field] = decimal(v);
    }
    rows.set(id, row);
  }
  return [...rows.values()];
};

/** The Coding Plan: the models it names, ids and names, no rates. */
const codingRows = (md) => {
  const grid = tableOf(md, DOC.coding, (h) => h[0] === "模型" && h[1] === "说明", ["模型", "说明"]);
  return grid
    .slice(1)
    .map((line) => line1(line[0]))
    .filter(Boolean)
    // The console's own switch, which is the id the endpoint answers to.
    .map((name) => ({ id: name === "Auto" ? "ark-code-latest" : name.toLowerCase(), name }));
};

/** The Agent Plan: its text models, ids and names, no rates. */
const agentRows = (md) => {
  const grid = tableOf(md, DOC.agent, (h) => h[0] === "分类" && h[1] === "领域", ["分类", "领域", "模型名称"]);
  return grid
    .slice(1)
    .filter((line) => line1(line[1]).startsWith("文本生成"))
    .map((line) => line1(line[2]).replace(/\s*\(.*\)$/, ""))
    .filter((id) => CARRIED["volcesark-agent-plan"].includes(id))
    .map((id) => ({ id, name: id }));
};

export default {
  ids: ["volcesark-payg", "volcesark", "volcesark-agent-plan"],
  source: Object.values(DOC).map(urlOf).join(", "),
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read"],
  async read() {
    const [payg, coding, agent] = await Promise.all([DOC.payg, DOC.coding, DOC.agent].map(markdown));
    return {
      rows: {
        "volcesark-payg": paygRows(payg),
        volcesark: codingRows(coding),
        "volcesark-agent-plan": agentRows(agent),
      },
    };
  },
};
