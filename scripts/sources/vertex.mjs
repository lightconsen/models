/**
 * Google Vertex AI's generative-ai prices, from the vendor's own pricing page
 * (`cloud.google.com/vertex-ai/generative-ai/pricing` — renamed "Agent Platform
 * pricing" in the October 2026 redesign) — server-rendered tables (~3.5MB,
 * no key) covering Gemini, Claude, Llama, Mistral, Qwen, Grok, DeepSeek and
 * the embeddings, plus Google's own extras (grounding, image generation).
 *
 * The redesign tripled the table count and wrapped most of them in tab
 * groups, so the walk is three filters deep:
 *
 *   sections    a token table is read only under a heading that names a
 *               model family (Gemini N, Anthropic's Claude models, xAI's
 *               Grok models, Meta's Llama models). Agent products price
 *               their own SKU under a model's name — the CodeMender table
 *               carries a "Gemini 3.1 Pro" row whose figures are the
 *               agent's, not the model's — so the section has to vouch for
 *               the table, not just the row label.
 *   tabs        each group renders every variant: Standard Model /
 *               Priority / Flex/Batch for Gemini, Global / US / EU /
 *               us-east5 / … for Claude, Token-based / Modality-based for
 *               the 2.0s. The first tab (`-t0`, "Standard Model", "Global",
 *               "Token-based pricing") is the rate the direct API charges;
 *               the rest are other SKUs. The tab's <button> names itself in
 *               track-metadata-eventdetail, the panel points back with
 *               aria-labelledby.
 *   bands       the price columns pair up per context threshold — [=<200K,
 *               >200K] for most models, [=<100K, >100K] where the model's
 *               long-context rate starts earlier (Claude Haiku 5.5). A row
 *               fills only its own band's columns; the filled pair is the
 *               model's, and its threshold is the long_context `over`. A
 *               model with no long band (Claude Opus 4.5 is a 200K-context
 *               model) leaves the long columns empty and gets none.
 *
 * Rows carry their own traps, all observed on the live page: the Type cell
 * is typo'd ("Inpur", "Outpur") on the newest Claude rows, so the match is
 * on the prefix; "Batch Input" / "Batch Cache Hit" rows price the batch SKU
 * and are skipped; the model-name cell spans rows, so continuation rows
 * open with an empty cell; and the dated labels carry the pricing windows
 * ("through December 31, 2026" beside "starting January 1, 2027"), of which
 * the in-force one reads. Ragged rows are the norm (a model fills four of
 * six price columns), so every cell read is optional-chained — the pre-
 * redesign adapter died on exactly that.
 *
 * The ids are the API model ids the seed carried (`claude-opus-4-6@default`,
 * `gemini-3.5-flash`…) — Vertex's deployment naming, distinct from the
 * upstream vendors' own ids. The map below carries the page label each id
 * prices; a label the map lacks is a new or retired model and is dropped
 * loudly.
 */
import { drift, getText, MEMBERSHIP } from "../lib/fetch.mjs";

const URL = "https://cloud.google.com/vertex-ai/generative-ai/pricing";

/** Page row label → entry id. The labels are the page's display names; the
    ids are the seed's Vertex deployment ids. Dated suffixes are handled by
    the date parser, not here — but the label the map carries is the model's
    own name, and a row whose label names a DIFFERENT model (a batch copy, a
    regional repeat) prices another SKU. */
const MODELS = {
  "Gemini 3.5 Flash": "gemini-3.5-flash",
  "Gemini 3.5 Flash-Lite": "gemini-3.5-flash-lite",
  "Gemini 3.6 Flash": "gemini-3.6-flash",
  "Gemini 3.7 Flash": "gemini-3.7-flash",
  "Gemini 3.8 Flash": "gemini-3.8-flash",
  "Gemini 3.1 Flash-Lite": "gemini-3.1-flash-lite",
  "Gemini 3.1 Pro Preview": "gemini-3.1-pro-preview",
  "Gemini 2.5 Pro": "gemini-2.5-pro",
  "Gemini 2.5 Flash": "gemini-2.5-flash",
  "Gemini 2.5 Flash Lite": "gemini-2.5-flash-lite",
  "Claude Fable 5": "claude-fable-5@default",
  "Claude Fable 5.1": "claude-fable-5-1@default",
  "Claude Opus 4.8": "claude-opus-4-8@default",
  "Claude Opus 4.7": "claude-opus-4-7@default",
  "Claude Opus 4.6": "claude-opus-4-6@default",
  "Claude Opus 4.5": "claude-opus-4-5@20251101",
  "Claude Sonnet 5": "claude-sonnet-5@default",
  "Claude Sonnet 4.6": "claude-sonnet-4-6@default",
  "Claude Sonnet 4.5": "claude-sonnet-4-5@20250929",
  "Llama 4 Maverick": "meta/llama-4-maverick-17b-128e-instruct-fp8@default",
  "Grok 4.6": "xai/grok-4-6@default",
  "Grok 4.3": "xai/grok-4-3@default",
};

/** A token table counts only under a heading that names a model family —
    the CodeMender / AlphaEvolve / tuning / storage sections price something
    else under a model's name. Extend this when the map gains a family. The
    apostrophes are the page's own curly ones. */
const SECTIONS = /^(gemini \d|anthropic[’']s claude models|xai[’']s grok models|meta[’']s llama models)/i;

/** In a tab group, only the base tab is this entry's price: the direct-API
    rate. Priority and Flex/Batch are other billing SKUs; the regional tabs
    (US Multi-Region, us-east5, …) price the same models at the region
    premium; "Modality-based" is the per-image/per-second view of the same
    models. */
const BASE_TAB = /^(global|standard( model)?|token-based pricing)$/i;

const strip = (s) =>
  s.replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** Parse the pricing window a label carries: "through December 31, 2026" =
    in force until (exclusive); "starting January 1, 2027" = in force from.
    The month names are the page's own English. */
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const dateOf = (label, kind) => {
  const m = new RegExp(kind === "until" ? "through\\s+([a-z]+)\\s+(\\d{1,2}),?\\s+(\\d{4})" : "starting\\s+([a-z]+)\\s+(\\d{1,2}),?\\s+(\\d{4})", "i").exec(label);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  return new Date(Date.UTC(Number(m[3]), month, Number(m[2])));
};

export default {
  ids: ["vertex"],
  source: URL,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out", "cache_read", "long_context"],

  async read() {
    const html = await getText(URL, { headers: { accept: "text/html" } });

    /** Tab id → the tab's own name, from the button's tracking attribute. */
    const tabLabel = {};
    for (const m of html.matchAll(/<button[^>]*id="(tab-[^"]+)"[^>]*>/g))
      tabLabel[m[1]] = /track-metadata-eventdetail="([^"]*)"/.exec(m[0])?.[1] ?? null;

    /** (modelId) → {in, out, cache_read?, long_context?} — the base rate
        (Standard/Global tab), with the long band in long_context. */
    const rows = new Map();
    const skipped = new Map();
    const skip = (why, label) => skipped.set(why, [...(skipped.get(why) ?? []), label]);
    const now = new Date();

    // Walk headings and tables in document order, so each token table knows
    // the section it sits in.
    let section = "";
    const walk = [...html.matchAll(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>|<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
    let tables = 0;
    for (const node of walk) {
      if (node.startsWith("<h")) { section = strip(node); continue; }
      tables++;
      const tb = node;

      // tab filter: a panel that answers to a non-base tab prices another SKU
      const pre = html.slice(Math.max(0, html.indexOf(tb) - 2500), html.indexOf(tb));
      const tabM = [...pre.matchAll(/role="tabpanel" aria-labelledby="([^"]+)"/g)].pop();
      if (tabM) {
        const label = tabLabel[tabM[1]];
        if (label === null || label === undefined) { skip("a tab whose button does not name itself", section); continue; }
        if (!BASE_TAB.test(label)) { skip(`the "${label}" tab`, section); continue; }
      }

      if (!SECTIONS.test(section)) continue;

      const rowsAll = [...tb.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]);
      const headRow = rowsAll.find((r) => /<th[\s>]/.test(r));
      if (!headRow) continue;
      const cols = [...headRow.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => strip(c[1]));
      // this table prices tokens if a header names a token price
      // this table prices tokens if a header says so — either in words
      // ("Price (/1M tokens) …") or in units (the partner tables' bare
      // "Price /1M (USD)")
      const isTokenTable = cols.some((c) => /price/i.test(c) && (/token/i.test(c) || /\/\s*1M/i.test(c)));
      if (!isTokenTable) continue;

      /** The price columns' roles, from the header: base band vs long band
          vs the cached pair, and the threshold (200K, 100K) the band turns
          at. A column with no band marker is a flat price. */
      const priceCols = [];
      cols.forEach((c, i) => {
        if (!/price/i.test(c)) return;
        const long = />\s*(\d+)\s*K/i.test(c);
        const band = /(?:<=|=<|≤|>)\s*(\d+)\s*K/i.test(c) ? Number(/(\d+)\s*K/i.exec(c)[1]) * 1000 : null;
        const cache = /cache/i.test(c);
        priceCols.push({ i, band, cache, long });
      });
      if (priceCols.length === 0) continue;
      const typeIdx = cols.findIndex((c) => /^type$/i.test(c));
      const regionIdx = cols.findIndex((c) => /^region$/i.test(c));

      let currentModel = null;
      let currentLabel = null;

      for (const tr of rowsAll) {
        if (tr === headRow) continue;
        const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => strip(c[1]));
        if (cells.length < 2) continue;

        const label = cells[0];
        if (label) {
          // the dated rows spell the model name plus the window ("Gemini 3.8
          // Flash*  through December 31, 2026") — strip the window and retry
          // the map, so the in-force introductory row prices the same model
          // the plain row does
          const bare = label.replace(/\*{0,2}\s*(through\s+\w+\s+\d{1,2},?\s+\d{4}|starting\s+\w+\s+\d{1,2},?\s+\d{4})\s*$/i, "").trim();
          currentModel = MODELS[label] ?? MODELS[bare] ?? null;
          currentLabel = label;
          if (!currentModel) skip("a model the id table lacks", label);
        }
        if (!currentModel) continue;

        // the type cell — the page itself typos "Inpur"/"Outpur" on the
        // newest Claude rows, so the match is on the prefix
        const type = cells[typeIdx >= 0 ? typeIdx : 1] ?? "";
        if (/^batch/i.test(type)) continue; // the batch SKU, at half price
        const isInput = /^inp/i.test(type);
        const isOutput = /^(out|text output)/i.test(type);
        const isCacheHit = /^cache hit/i.test(type);
        if (!isInput && !isOutput && !isCacheHit) continue;

        // the Region cell, where the table carries one (the Gemini tables):
        // Global is the direct-API rate; Non-global is the region premium
        if (regionIdx >= 0) {
          const regionCell = cells[regionIdx] ?? "";
          if (regionCell && !/^global$/i.test(regionCell)) continue;
        }

        // the date windows: the introductory row is in force until its date;
        // the future row from its date. A row in neither window (no date in
        // the label) is always in force. Today decides.
        const untilDate = dateOf(currentLabel ?? "", "until");
        const fromDate = dateOf(currentLabel ?? "", "from");
        if (fromDate && now < fromDate) { skip("a future-dated rate", currentLabel ?? "?"); continue; }
        if (untilDate && now >= untilDate) { skip("an expired introductory rate", currentLabel ?? "?"); continue; }

        // the figures. Rows are ragged — a model fills only its own band's
        // columns — so every cell read is optional. The band that carries a
        // base figure on this row is this model's band.
        const fig = (col) => /\$([\d.]+)/.exec(cells[col.i] ?? "")?.[1];
        const at = (band, { cache = false, long = false } = {}) => {
          const col = priceCols.find((c) => c.band === band && c.cache === cache && c.long === long);
          return col ? fig(col) : undefined;
        };
        const bands = [...new Set(priceCols.filter((c) => c.band).map((c) => c.band))];
        const band = bands.find((b) => at(b) !== undefined) ?? null;
        const flat = priceCols.find((c) => !c.band && !c.cache);
        const flatFig = flat ? fig(flat) : undefined;

        const figures = [band !== null ? at(band) : flatFig].filter((v) => v !== undefined);
        if (figures.length === 0) continue;
        const scale = figures.some((f) => Number(f) < 0.001) ? 1_000_000 : 1;
        // 6dp, not 2: the cache columns carry real sub-cent figures ($0.075,
        // $0.125) and rounding to cents repriced them
        const fmt = (x) => String(Math.round(Number(x) * scale * 1e6) / 1e6);

        const row = rows.get(currentModel) ?? { id: currentModel };
        if (isInput) {
          if (row.in === undefined) row.in = fmt(band !== null ? at(band) : flatFig);
          const lcIn = band !== null ? at(band, { long: true }) : undefined;
          if (lcIn !== undefined) {
            row.long_context ??= { over: band };
            if (row.long_context.in === undefined) row.long_context.in = fmt(lcIn);
            const lcCache = at(band, { long: true, cache: true });
            if (lcCache !== undefined && row.long_context.cache_read === undefined) row.long_context.cache_read = fmt(lcCache);
          }
          const cache = band !== null ? at(band, { cache: true }) : undefined;
          if (cache !== undefined && row.cache_read === undefined) row.cache_read = fmt(cache);
        } else if (isOutput) {
          if (row.out === undefined) row.out = fmt(band !== null ? at(band) : flatFig);
          const lcOut = band !== null ? at(band, { long: true }) : undefined;
          if (lcOut !== undefined) {
            row.long_context ??= { over: band };
            if (row.long_context.out === undefined) row.long_context.out = fmt(lcOut);
          }
        } else if (isCacheHit) {
          if (row.cache_read === undefined) row.cache_read = fmt(band !== null ? at(band) : flatFig);
          const lcCache = band !== null ? at(band, { long: true }) : undefined;
          if (lcCache !== undefined) {
            row.long_context ??= { over: band };
            if (row.long_context.cache_read === undefined) row.long_context.cache_read = fmt(lcCache);
          }
        }
        rows.set(currentModel, row);
      }
    }

    if (tables === 0) drift("no tables — the page has been restructured");
    if (rows.size === 0) drift("no rows after mapping");
    const out = [...rows.values()]
      // long_context only means something beside a base rate
      .filter((r) => {
        if (r.long_context && (r.long_context.in === undefined || r.long_context.out === undefined)) delete r.long_context;
        return r.in !== undefined && r.out !== undefined;
      });
    if (out.length === 0) drift("no complete rows after the Input/Output join");
    const notes = [...skipped.entries()].map(([why, labels]) => `${why}: ${labels.length} row(s), e.g. ${labels.slice(0, 3).join(", ")}`);
    return { rows: { vertex: out }, notes: { vertex: notes } };
  },
};
