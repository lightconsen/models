/**
 * Baidu Qianfan's pay-as-you-go prices, from the vendor's own billing doc.
 *
 * This is the **sibling** of `baidu-qianfan-token-plan`, and the pair exists
 * for the reason the checklist rule names: the addresses differ. The plan
 * entry serves the prepaid token-plan route (`/v2/tokenplan/personal`, quota
 * deducted by conversion, no rate published); this one prices the standard
 * API route, whose 后付费 table is `cloud.baidu.com/doc/qianfan/s/wmh4sv6ya`
 * — server-rendered HTML, read straight off the page. Per-千tokens here;
 * the decimal point moves three for the catalogue's per-million.
 *
 * The grid is one table whose rows walk through three shapes, and the parser
 * is a small state machine over them:
 * - a model block opens with six or seven cells (name, versions, service,
 *   first sub-item, online, batch, unit) — one cell fewer for a second
 *   version of the same model, since the name cell spans. A version cell may
 *   carry several API ids; each is servable and each becomes a row at the
 *   shared price.
 * - sub-rows say what they price in their first cell: `输入`, `输出`,
 *   `命中缓存` (this doc spells it 缓存命中 as often as not), or `搜索增强` —
 *   the last billed per call (元/次) and skipped, like every non-token rate
 *   here.
 * - a token-band row (`输入Token数：[0,32k]`) opens a length band whose
 *   following sub-rows price that band; the lower band is the row's own rates
 *   and the upper folds into `long_context`.
 *
 * Two more shapes the page earns its keep with:
 * - DeepSeek rows split 高峰时段 (8:00–22:00, every day — this platform's own
 *   window, narrower at both ends than DeepSeek's own schedule) from 空闲时段
 *   (22:00–次日 8:00). Input is priced once, not by time of day, so the
 *   off-peak block inherits the peak input — the vendor discounts output and
 *   cache reads only. Where a cache row names a future effective date
 *   (9月9日起生效), the row it supersedes is dropped: the rate in force today
 *   is the one recorded.
 * - `即将下线` versions are skipped; batch prices (批量推理) ride in the same
 *   grid and are ignored — a different billed mode, no field here. Embedding
 *   and reranker rows price input only: half a rate is not a rate.
 */
import { getText, drift, MEMBERSHIP } from "../lib/fetch.mjs";

const DOC = "https://cloud.baidu.com/doc/qianfan/s/wmh4sv6ya";

/** per-千tokens → per-million, moving the point three in string space. The
    leading zeros stay put until after the move — stripping first would shift
    the point (0.00004 prices at 0.04, not 0.4). */
const perMillionFromK = (s) => {
  const [whole, frac = ""] = String(s).trim().split(".");
  const digits = `${whole}${frac}`;
  const p = frac.length - 3;
  const moved = p <= 0 ? `${digits}${"0".repeat(-p)}` : `${digits.slice(0, digits.length - p) || "0"}.${digits.slice(digits.length - p)}`;
  const [i, f = ""] = moved.split(".");
  const int = String(parseInt(i, 10));
  return f ? `${int}.${f}`.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : int;
};

const SUB = /^(输入|输出|命中缓存|缓存命中|搜索增强)/;
const decimal = (s) => (/^\d+(\.\d+)?$/.test(s.trim()) ? s.trim() : undefined);

/** A price cell may carry a standing rate and an undated limited one —
    `原价：0.008 国庆限定价：0.0048`. The limited price names no window, so the
    standing 原价 is the one recorded: a stale reading overstates while the
    promo runs and is exact again after it ends — the direction the checklist
    prefers (an un-updated client overstates, never understates). The entry's
    GLM-5.3 flagship rates are the 原价 figures, which is what settled it. */
const standingOf = (cell) => {
  const m = /原价[：:]\s*(\d+(?:\.\d+)?)/.exec(cell);
  return m ? m[1] : decimal(cell);
};

/** '推理服务 输入Token数：[0,32k]' → 'le32'; '…(128k,256]' → 'gt128'. */
const bandOf = (text) => {
  const m = /输入Token数[：:]\s*([\[(])\s*(\d+)\s*k?\s*(?:,\s*(\d+)\s*k?\s*[\])])?/.exec(text);
  if (!m) return "";
  return m[1] === "(" ? `gt${m[2]}` : `le${m[3] ?? m[2]}`;
};

export default {
  ids: ["baidu-qianfan"],
  source: DOC,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "off_peak", "peak_hours", "long_context"],

  async read() {
    const html = await getText(DOC);
    const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
    // The table repeats per section (ERNIE+DeepSeek in one, GLM/Kimi/Qwen in
    // another) with the same header — every section is part of one price list.
    const grids = tables.filter((t) => t.includes("在线推理") && t.includes("批量推理") && t.includes("模型名称"));
    if (grids.length === 0) drift("the billing doc's online-inference table is gone or reshaped");

    const trs = grids.flatMap((grid) => [...grid.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) =>
      [...m[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)]
        .map((c) => c[1].replace(/<[^>]+>/g, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim())
        .map((c) => c.replace(/^﻿/, "")),
    ));

    // block: {ids, name, groups: Map("<band>|<peak>" → {band, isPeak, rates})}
    const blocks = [];
    let block = null;
    let band = "";
    const addSub = (sub, raw) => {
      if (!block || raw === undefined) return;
      const price = perMillionFromK(raw);
      const kind = sub.startsWith("输入") ? "in" : sub.startsWith("输出") ? "out" : /命中/.test(sub) ? "cache" : null;
      if (!kind) return;
      const isPeak = /高峰/.test(sub);
      const leM = /输入\s*(?:<=|=<)\s*(\d+)\s*k/.exec(sub);
      const gtM = /(\d+)\s*k\s*<\s*输入/.exec(sub);
      // A band text like （32k<输入<=128k） matches both shapes — the
      // lower bound is the band's identity, so gt reads first.
      const b = gtM ? `gt${gtM[1]}` : leM ? `le${leM[1]}` : band;
      const key = `${b}|${isPeak}`;
      const g = block.groups.get(key) ?? { band: b, isPeak, rates: {} };
      if (g.rates[kind] === undefined || /起生效/.test(sub)) g.rates[kind] = price;
      block.groups.set(key, g);
    };

    // A model id: a bare token, letters somewhere, and not one of the
    // service/prose spellings that open a sub-row or band row.
    const looksId = (s) =>
      /^[A-Za-z0-9][A-Za-z0-9 .\/\-]*$/.test(s) &&
      (s.match(/[A-Za-z]/g) ?? []).length >= 3 &&
      !/^(推理|输入|输出|命中|缓存|搜索)/.test(s);

    for (const cells of trs) {
      if (cells.length < 3 || cells[0] === "模型名称") continue;
      const joined = cells.join(" ");
      const firstIsId = looksId(cells[0]);
      const secondIsId = cells.length >= 7 && looksId(cells[1]);
      // Sub-row: its first cell says what it prices.
      if (!firstIsId && !secondIsId && (SUB.test(cells[0]) || /^缓存/.test(cells[0]))) {
        addSub(cells[0], cells.map(standingOf).find((v, i) => i >= 1 && v !== undefined));
        continue;
      }
      // Block or version row — a model id sits in the first (or, when the
      // name cell spans, second) cell. A band may ride in the block row.
      if (firstIsId || secondIsId) {
        if (block) blocks.push(block);
        const versions = (cells.length >= 7 ? cells[1] : cells[0]).split(/\s+/).filter(Boolean);
        const name = cells.length >= 7 ? cells[0] : blocks.at(-1)?.name ?? versions[0];
        block = { ids: versions, name, groups: new Map() };
        band = /输入Token数/.test(joined) ? bandOf(joined) : "";
        const sub = cells.find((c) => SUB.test(c)) ?? "输入";
        const onlineIdx = cells.findIndex((c) => standingOf(c) !== undefined);
        addSub(sub, onlineIdx >= 0 ? standingOf(cells[onlineIdx]) : undefined);
        continue;
      }
      // Band marker: 推理服务 输入Token数：… — its band applies to the
      // sub-rows that follow, and the row prices one itself.
      if (/输入Token数/.test(joined)) {
        band = bandOf(joined);
        const sub = cells.find((c) => SUB.test(c)) ?? "输入";
        addSub(sub, cells.map(standingOf).find(Boolean));
        continue;
      }
      addSub(cells[0], cells.map(standingOf).find((v, i) => i >= 1 && v !== undefined));
    }
    if (block) blocks.push(block);

    const notes = [];
    const skipped = { retired: 0, perCall: 0, half: 0 };
    const seen = new Set();
    const rows = [];
    for (const v of blocks) {
      if (v.ids.some((x) => /即将下线/.test(x)) || /即将下线/.test(v.name)) { skipped.retired++; continue; }
      const leBand = [...v.groups.values()].find((g) => g.band.startsWith("le") && g.rates.in !== undefined && g.rates.out !== undefined);
      const off = v.groups.get("|false");
      const peak = v.groups.get("|true");
      // Prefer a group that prices both sides; an off-peak group with no
      // input of its own inherits the peak input below.
      const listed = leBand ?? [off, peak].find((g) => g?.rates.in !== undefined && g?.rates.out !== undefined) ?? peak ?? off;
      if (!listed?.rates.in || !listed?.rates.out) { skipped.half++; continue; }
      const row = { id: v.ids[0], name: v.name, in: listed.rates.in, out: listed.rates.out };
      if (listed.rates.cache !== undefined) row.cache_read = listed.rates.cache;
      if (peak && off) {
        row.peak_hours = { tz_offset: 480, windows: [{ days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], start: "08:00", end: "22:00" }] };
        // Input prices once, not by time of day: the off-peak block inherits
        // the peak input — the vendor discounts output and cache reads only.
        row.off_peak = {
          in: off.rates.in ?? peak.rates.in,
          out: off.rates.out ?? listed.rates.out,
          ...(off.rates.cache !== undefined ? { cache_read: off.rates.cache } : row.cache_read !== undefined ? { cache_read: row.cache_read } : {}),
        };
      }
      // The widest >Nk band folds into long_context (over = its lower bound).
      const gt = [...v.groups.values()]
        .filter((g) => g.band.startsWith("gt") && g.rates.in !== undefined && g.rates.out !== undefined)
        .sort((a, b) => Number(/(\d+)/.exec(a.band)[1]) - Number(/(\d+)/.exec(b.band)[1]))
        .at(-1);
      if (gt && leBand) {
        row.long_context = {
          over: Number(/(\d+)/.exec(gt.band)[1]) * 1000,
          in: gt.rates.in,
          out: gt.rates.out,
          ...(gt.rates.cache !== undefined ? { cache_read: gt.rates.cache } : {}),
        };
      }
      for (const id of v.ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        rows.push({ ...row, id });
      }
    }

    if (rows.length === 0) drift("no priced rows parsed from the billing doc");
    notes.push(`batch prices ignored (a different billed mode); 搜索增强 per-call rows skipped: ${skipped.perCall}`);
    notes.push(`即将下线 versions skipped: ${skipped.retired}`);
    if (skipped.half) notes.push(`blocks with one rate only (embeddings price input alone): ${skipped.half}`);

    return { rows: { "baidu-qianfan": rows }, notes: { "baidu-qianfan": notes } };
  },
};
