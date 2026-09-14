/**
 * DeepSeek's published price table, from the static HTML of their docs.
 *
 * The only source here with time-of-day pricing, and the only one whose table has
 * to be read by content rather than by column position. The price block's cells
 * use rowspans, so its rows come out four or five wide in an irregular pattern
 * ("高峰时段" is both a rate label and a switch) and "the third cell" names a
 * different thing from one row to the next. Every value is therefore located by
 * what it says, not by where it sits.
 *
 * The listed rate is the **peak** one. That is a deliberate choice, argued in
 * generate.mjs: an un-updated client should overstate a night's cost rather than
 * understate it, so the flat number stays the expensive one and `off_peak` carries
 * the discount.
 *
 * The page also documents its BASE URLs, which is how a stale endpoint in
 * provider.json gets caught. Those are reported as notes and never rewritten — an
 * endpoint move deserves a look at the entry's other fields too.
 */
import { getText, drift, decimal, MEMBERSHIP } from "../lib/fetch.mjs";

const URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";

/** Field names the page uses for the three rates we record. */
const RATE_LABELS = {
  "百万tokens输入（缓存命中）": "cache_read",
  "百万tokens输入（缓存未命中）": "in",
  "百万tokens输出": "out",
};
const DAY_NAMES = { 周一: "mon", 周二: "tue", 周三: "wed", 周四: "thu", 周五: "fri", 周六: "sat", 周日: "sun" };
const RATE_ORDER = ["in", "out", "cache_read", "cache_creation"];
const PAGE_PROTOCOL = { "OpenAI 格式": "openai", "Anthropic 格式": "anthropic" };

const text = (html) => html.replace(/<[^>]*>/g, "").replace(/\s+/g, "").trim();
/** Drop a trailing footnote marker ("deepseek-flash<sup>(1)</sup>" -> the name). */
const unnote = (s) => s.replace(/\(\d+\)$/, "");
const yuan = (s) => decimal(text(s).replace(/元$/, ""));

export default {
  ids: ["deepseek"],
  source: URL,
  membership: MEMBERSHIP.FOLLOW,

  async read() {
    // The response carries a stray NUL byte, which is enough to make `file` call
    // it binary and `grep` refuse to match anything. Strip it before parsing, or
    // every search below silently finds nothing.
    const html = (await getText(URL)).split(String.fromCharCode(0)).join("");

    const rows = (html.match(/<tr>[\s\S]*?<\/tr>/g) ?? []).map((r) =>
      (r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) ?? []).map(text),
    );
    if (rows.length === 0) drift("no <tr> rows found — the page is no longer static HTML");

    const header = rows.find((cells) => cells[0] === "模型");
    if (!header || header.length < 3) drift('no "模型" row with model columns');
    const modelIds = header.slice(1).map(unnote);

    const versions = rows.find((cells) => cells[0] === "模型版本");
    const modelNames = versions && versions.length === header.length ? versions.slice(1) : modelIds;

    // ── the price rows: a full row names the rate, its continuation just switches
    //    the time of day (the label cell above it spans two rows). Rows are
    //    recognised by content, not width: the page has other narrow rows
    //    (`并发限制` is also label + one value per model) and a width test would
    //    read those as prices. ──
    const priced = new Map();
    let label = null;
    for (const cells of rows) {
      const labelAt = cells.findIndex((c) => RATE_LABELS[c] !== undefined);
      const periodAt = cells.findIndex((c) => c === "空闲时段" || c === "高峰时段");
      if (periodAt < 0) continue;
      if (labelAt >= 0) {
        if (labelAt > periodAt) drift(`the rate label follows its time-of-day cell: ${JSON.stringify(cells)}`);
        label = RATE_LABELS[cells[labelAt]];
      }
      if (!label) drift(`a ${cells[periodAt]} row appears before any rate label`);
      const period = cells[periodAt];
      const values = cells.slice(periodAt + 1).map(yuan);
      if (values.length !== modelIds.length) {
        drift(`row "${label}/${period}" has ${values.length} values for ${modelIds.length} models`);
      }
      modelIds.forEach((id, i) => {
        const m = priced.get(id) ?? { off_peak: {} };
        if (period === "高峰时段") m[label] = values[i];
        else m.off_peak[label] = values[i];
        priced.set(id, m);
      });
    }
    for (const id of modelIds) {
      const m = priced.get(id);
      if (!m || m.in === undefined || m.out === undefined || m.cache_read === undefined) {
        drift(`model "${id}" is missing one of the three peak rates`);
      }
      if (Object.keys(m.off_peak).length !== 3) drift(`model "${id}" is missing one of the three off-peak rates`);
    }

    // ── the peak window, from the footnote ──
    const note = (html.match(/高峰时段为[\s\S]{0,240}?）/)?.[0] ?? "").replace(/<[^>]*>/g, "");
    if (!note) drift("no peak-hours footnote — the window is the part we cannot guess");
    if (!note.includes("北京时间")) drift(`the footnote no longer names 北京时间: "${note}"`);
    const dayList = [];
    for (const [, from, to] of note.matchAll(/(周[一二三四五六日])(?:至(周[一二三四五六日]))?/g)) {
      const names = Object.keys(DAY_NAMES);
      const start = names.indexOf(from);
      const end = to ? names.indexOf(to) : start;
      if (start < 0 || end < start) drift(`cannot read the weekday range "${from}${to ? "至" + to : ""}"`);
      for (let i = start; i <= end; i++) dayList.push(DAY_NAMES[names[i]]);
    }
    if (dayList.length === 0) drift(`no weekdays in the footnote: "${note}"`);
    const windows = [...note.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)].map(([, h1, m1, h2, m2]) => ({
      days: [...new Set(dayList)],
      start: `${String(h1).padStart(2, "0")}:${m1}`,
      end: `${String(h2).padStart(2, "0")}:${m2}`,
    }));
    if (windows.length === 0) drift(`no clock times in the footnote: "${note}"`);

    // The schema's own order for the rate fields — the page lists cache-hit first,
    // a human writing the row would not, and key order is not a price change.
    const ordered = (o) => Object.fromEntries(RATE_ORDER.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

    const out = modelIds.map((id, i) => {
      const m = priced.get(id);
      return {
        id,
        name: modelNames[i] ?? id,
        ...ordered(m),
        off_peak: ordered(m.off_peak),
        peak_hours: { tz_offset: 480, windows },
      };
    });

    // The entry's endpoints should be the page's BASE URLs: drift there means the
    // catalogue points people at an address the vendor no longer documents.
    const notes = [];
    for (const proto of Object.keys(PAGE_PROTOCOL)) {
      const row = rows.find((cells) => cells[0] === `BASEURL(${proto})`);
      if (row) notes.push(`the page documents the ${PAGE_PROTOCOL[proto]} BASE URL as ${row[row.length - 1]} — check provider.json by hand`);
    }

    return { rows: { deepseek: out }, notes: { deepseek: notes } };
  },
};
