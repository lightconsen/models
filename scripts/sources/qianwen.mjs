/**
 * Alibaba Cloud's Model Studio price list, for the Qianwen entry.
 *
 * The page is a server-rendered app rather than a document: the article is not in
 * the markup, it is a JSON string inside `window.__ICE_PAGE_PROPS__`, at
 * `docDetailData.storeData.data.content`, holding the whole article as HTML with
 * every quote escaped. So this reads the page, pulls that global out by brace
 * matching, and parses the HTML inside it. (`window.__ICE_APP_DATA__` sits on the
 * same page and is empty — the obvious global is the wrong one.)
 *
 * The article repeats itself by region. Every model family is an `h3` and each
 * deployment region under it an `h4`, and the same model carries different money
 * in different ones: qwen3.8-max is ¥12/¥36 in 华北2（北京） and ¥14.988/¥44.965 in
 * 新加坡, which is the international rate rather than a conversion. The entry
 * bills in yuan, so this reads the 华北2（北京） tables — matching on the region
 * alone would also pull in 德国（法兰克福） and 日本（东京）, which happen to quote
 * the same 全球 rate and would look correct right up until they didn't.
 *
 * Membership is `intersect`: the page prices several hundred models and this
 * entry carries two, so the entry decides which rows exist and this only
 * re-prices them.
 *
 * **Cache rates are deliberately not read.** Every row says 上下文缓存 享有折扣 —
 * "the cache enjoys a discount" — and the number lives on a separate page
 * (`/zh/model-studio/context-cache`) that states the general rule as 10% of the
 * input rate for a hit and 125% for a write, both hedged with 通常. This entry
 * records 1.5 against an input of 12, which is 12.5%, not 10%. Either the entry
 * is wrong or there is a per-model discount not on either page, and guessing
 * would settle a question that is still open — so `cache_read` is left untouched
 * and the disagreement is reported instead.
 *
 * Headings straddle a `<span class="help-letter-space">` between their Chinese and
 * Latin halves ("千问" + span + "Flash"), so the text has to be assembled from the
 * markup rather than searched for.
 */
import { MEMBERSHIP, decimal, drift, getText, readEntry } from "../lib/fetch.mjs";

const URL = "https://help.aliyun.com/zh/model-studio/billing-for-model-studio";
// 华北2（北京）, the region the yuan prices belong to. Written with a space
// because the heading is "华北" + <span class="help-letter-space"> + "2", and the
// span is markup rather than content — the same reason this file assembles
// heading text out of the markup instead of searching the page for it.
const DOMESTIC = /华北\s*2/;

/** Markup dropped, entities decoded. The order matters: decoding `&lt;` before
    stripping tags would turn `0&lt;Token≤1M` into something that reads as one. */
const text = (html) =>
  String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const cellsOf = (row) =>
  [...row.matchAll(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g)].map((c) => text(c[0]));

/** Every table in the article with the h3 family and h4 region it sits under. */
const sections = (html) => {
  const out = [];
  const stack = {};
  const re = /<(h[1-4])[^>]*>([\s\S]*?)<\/\1>|<table[\s\S]*?<\/table>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) {
      const level = Number(m[1][1]);
      stack[level] = text(m[2]);
      for (const k of Object.keys(stack)) if (Number(k) > level) delete stack[k];
    } else {
      out.push({ family: stack[3] ?? "", region: stack[4] ?? "", html: m[0] });
    }
  }
  return out;
};

/** The article HTML, out of the JSON global that holds it. */
const article = async () => {
  const page = await getText(URL, { headers: { accept: "text/html" } });
  const at = page.indexOf("window.__ICE_PAGE_PROPS__");
  if (at < 0) drift(`${URL}: no __ICE_PAGE_PROPS__ — the page has been rebuilt`);
  const start = page.indexOf("{", at);
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < page.length; i++) {
    const c = page[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  if (end < 0) drift(`${URL}: __ICE_PAGE_PROPS__ is not a closed object`);
  let props;
  try {
    props = JSON.parse(page.slice(start, end));
  } catch (err) {
    drift(`${URL}: __ICE_PAGE_PROPS__ is not JSON (${err.message})`);
  }
  const html = props?.docDetailData?.storeData?.data?.content;
  if (typeof html !== "string" || html === "") drift(`${URL}: no article content in __ICE_PAGE_PROPS__`);
  return html;
};

export default {
  ids: ["qianwenai"],
  source: URL,
  membership: MEMBERSHIP.INTERSECT,

  async read() {
    const html = await article();
    const wanted = new Set(readEntry("qianwenai").models.map((r) => r.id));
    if (wanted.size === 0) drift("the entry carries no models to price");

    const rows = new Map();
    for (const s of sections(html)) {
      if (!DOMESTIC.test(s.region)) continue;
      const grid = [...s.html.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((r) => cellsOf(r[0]));
      const head = grid[0];
      if (!head) continue;
      // Only a per-token price table, told apart from the dozens of others by the
      // two rate columns rather than by anything about the section it sits in.
      const inAt = head.findIndex((c) => /输入单价/.test(c));
      const outAt = head.findIndex((c) => /输出单价/.test(c));
      if (inAt < 0 || outAt < 0) continue;

      for (const line of grid.slice(1)) {
        // The id is the first word of a cell that carries 更多详情 or 上下文缓存
        // annotations after it. Model ids have no spaces, so the first word is it.
        const id = (line[0] ?? "").split(" ")[0];
        if (!wanted.has(id)) continue;
        if (rows.has(id)) {
          drift(`${s.family}/${s.region}: ${id} is priced in more than one 华北2 table — the section has changed shape`);
        }
        const rate = (c) => {
          const v = String(c ?? "").replace(/元.*$/, "").trim();
          return v === "" || v === "-" ? undefined : decimal(v);
        };
        const row = { id };
        const inRate = rate(line[inAt]);
        const outRate = rate(line[outAt]);
        if (inRate !== undefined) row.in = inRate;
        if (outRate !== undefined) row.out = outRate;
        rows.set(id, row);
      }
    }

    const missing = [...wanted].filter((id) => !rows.has(id));
    if (rows.size === 0) drift("no carried model was found in the 华北2 tables — the headings have moved");
    const notes = [];
    if (missing.length) notes.push(`not priced in 华北2: ${missing.join(", ")}`);
    notes.push(
      "cache rates are not read: the page says 上下文缓存 享有折扣 without a number, and the entry's " +
        "rates disagree with the 10% the context-cache page states — needs a decision, not a scrape",
    );

    return { rows: { qianwenai: [...rows.values()] }, notes: { qianwenai: notes } };
  },
};
