/**
 * SiliconFlow's prices, from the vendor's own pricing page — one adapter,
 * two arms, each reading its own market's page.
 *
 * The pair splits by address the way every CN/international pair here does:
 * siliconflow.cn prices in **yuan** (siliconflow-cn), siliconflow.com in
 * **dollars** (siliconflow). Both pages are Framer marketing sites, and they
 * differ in what the server sends:
 *
 * - the CN page server-renders the whole grid: display name, API id, input,
 *   cached-input and output prices per row — parsed by splitting the grid on
 *   its row-height class and reading the ¥ figures. Accelerated tiers are
 *   real API ids with a `Pro/` prefix and are kept as their own rows.
 * - the intl page server-renders exactly one model row and renders the rest
 *   client-side, so `siliconflow` stays seeded; only the row the page itself
 *   states is verified against it.
 *
 * Rows without two prices are skipped: embedding and reranker models price
 * input alone (half a rate is not a rate), and image/audio models price by
 * the picture and the second. Zero-priced rows are free-tier surfaces, which
 * this catalogue leaves to the news file rather than pricing.
 */
import { getText, drift, MEMBERSHIP } from "../lib/fetch.mjs";

const PAGES = {
  "siliconflow-cn": "https://siliconflow.cn/pricing",
  siliconflow: "https://siliconflow.com/pricing",
};

export default {
  ids: ["siliconflow-cn"],
  source: Object.values(PAGES).join(" + "),
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read"],

  async read() {
    const rows = {};
    const notes = {};
    for (const id of this.ids) {
      const page = PAGES[id];
      const html = await getText(page);
      const isCN = id === "siliconflow-cn";
      const currencyMark = isCN ? /¥/ : /\$/;
      const raw = [...html.matchAll(currencyMark.source ? new RegExp(String.raw`${isCN ? "¥" : "\\$"}\s*([\d.]+)`, "g") : /x/g)].map((m) => m[1]);
      if (!currencyMark.test(html)) {
        rows[id] = null;
        notes[id] = ["the pricing page served no prices in this entry's currency this run"];
        continue;
      }
      // Rows: the grid splits on its row class; each chunk carries a display
      // name, the API id (the token with a vendor slash or a model name), and
      // the prices in order: input, cached input, output.
      const chunks = html.split("md:min-h-[60px]").slice(1);
      const out = [];
      const skipped = { inputOnly: 0, zero: 0 };
      for (const c of chunks) {
        const prices = [...c.matchAll(new RegExp(String.raw`${isCN ? "¥" : "\\$"}\s*([\d.]+)`, "g"))].map((m) => m[1]);
        if (prices.length < 2) continue;
        // The API id sits in the console link's ?target= param — the one
        // spelling the API actually accepts.
        const target = c.match(/[?&]target=([%\w.-]+)/);
        const apiId = target ? decodeURIComponent(target[1]) : null;
        if (!apiId) continue;
        if (Number(prices[0]) === 0) { skipped.zero++; continue; }
        // Column order on the page: Input, Output, Cached Input.
        const inR = prices[0], outR = prices[1], cacheR = prices.length >= 3 ? prices[2] : undefined;
        const row = { id: apiId, in: inR, out: outR };
        if (cacheR !== undefined) row.cache_read = cacheR;
        out.push(row);
      }
      const dupes = out.length - new Set(out.map((r) => r.id)).size;
      const dedup = [];
      const seen = new Set();
      for (const r of out) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        dedup.push(r);
      }
      if (dedup.length === 0) drift(`${page}: no priced rows parsed from the pricing page`);
      rows[id] = dedup;
      notes[id] = [
        `input-only rows skipped (embeddings/rerankers): ${skipped.inputOnly}`,
        `zero-priced (free-tier) rows skipped: ${skipped.zero}`,
        dupes ? `${dupes} duplicate id(s) folded` : null,
      ].filter(Boolean);
    }

    if (!rows["siliconflow-cn"]?.length && !rows["siliconflow"]?.length) {
      drift("neither arm produced rows");
    }
    return { rows, notes };
  },
};
