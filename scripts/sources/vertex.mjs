/**
 * Google Vertex AI's generative-ai prices, from the vendor's own pricing page
 * (`cloud.google.com/vertex-ai/generative-ai/pricing`) — server-rendered
 * tables (~3.3MB, no key) covering Gemini, Claude, Llama, Mistral, Qwen,
 * Grok, DeepSeek and the embeddings, plus Google's own extras (grounding,
 * image generation, live API).
 *
 * The page prices a model in SEVERAL tables — the Gemini 3 section carries
 * one table per deployment (Global, Non-global — the region premium, Batch —
 * the discounted tier), each with the model name's cell spanning rows: Input
 * on one row, Text output on the next, the Type column says which. The
 * adapter walks every table, tracks the current model, and joins the rates
 * per (deployment, field):
 *
 *   deployment  the table's rows carry a Region cell ("Global" / "Non-
 *               global" / …) — Global is the rate the direct API charges,
 *               and it is what this entry prices; Non-global's premium (1.8×)
 *               and Batch's discount are skipped as other SKUs.
 *   dated       the labels carry the pricing windows — "through December 31,
 *               2026" (introductory, in force) beside "starting January 1,
 *               2027" (the future standard). The adapter parses the date and
 *               reads whichever is in force on the day it runs — the same
 *               rule the google-gemini entry documents.
 *   bands       the price columns are [≤200K, >200K, cached ≤200K, cached
 *               >200K] — the first is the base rate, the second folds into
 *               long_context, the cached pair into cache_read.
 *
 * The ids are the API model ids the seed carried (`claude-opus-4-6@default`,
 * `gemini-3.5-flash`…) — Vertex's deployment naming, distinct from the
 * upstream vendors' own ids. The map below carries the page label each id
 * prices; a label the table lacks is a new or retired model and is dropped
 * loudly.
 */
import { drift, getText, MEMBERSHIP } from "../lib/fetch.mjs";

const URL = "https://cloud.google.com/vertex-ai/generative-ai/pricing";

/** Page row label → entry id. The labels are the page's display names; the
    ids are the seed's Vertex deployment ids. Dated suffixes are handled by
    the date parser, not here — but the label the map carries is the model's
    own name, and a row whose label names a DIFFERENT model (a batch copy, a
    "Non-global" repeat) prices another SKU. */
const MODELS = {
  "Gemini 3.5 Flash": "gemini-3.5-flash",
  "Gemini 3.5 Flash-Lite": "gemini-3.5-flash-lite",
  "Gemini 3.6 Flash": "gemini-3.6-flash",
  "Gemini 3.7 Flash": "gemini-3.7-flash",
  "Gemini 3.8 Flash": "gemini-3.8-flash",
  "Gemini 3.1 Flash-Lite": "gemini-3.1-flash-lite",
  "Gemini 3.1 Pro": "gemini-3.1-pro-preview",
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
  "Llama 4 Maverick 17B": "meta/llama-4-maverick-17b-128e-instruct-fp8@default",
  "Grok 4.6": "xai/grok-4-6@default",
  "Grok 4.3": "xai/grok-4-3@default",
};

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

    const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
    if (tables.length === 0) drift("no tables — the page has been restructured");

    /** (modelId) → {in, out, cache_read?, long_context?} — Global only (the
        direct-API price), with the long band in long_context. Rows collect
        per (field, band); the in-force date window decides which row's
        figures read. */
    const rows = new Map();
    const skipped = new Map();
    const skip = (why, label) => skipped.set(why, [...(skipped.get(why) ?? []), label]);
    const now = new Date();

    for (const tb of tables) {
      const rowsAll = [...tb.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]);
      const headRow = rowsAll.find((r) => /<th[\s>]/.test(r));
      if (!headRow) continue;
      const cols = [...headRow.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => strip(c[1]));
      // this table prices tokens if its header names token prices
      const isTokenTable = cols.some((c) => /token price|price.*token|input tok/i.test(c));
      if (!isTokenTable) continue;
      // the header may carry a Region column (the Gemini deployment tables);
      // the partner tables (Claude/Llama/Mistral) price straight — no Region
      const hasRegionCol = cols.some((c) => /^region$/i.test(c));

      let currentModel = null;
      let currentLabel = null;

      /** The price columns' roles, from the header: which index prices the
          base band (≤200K), which the long band (>200K), which the cached
          pair. The Model/Type/Region columns are not prices. */
      const priceIdx = cols
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => /price/i.test(c) && !/cache/i.test(c))
        .map(({ i }) => i);
      const cachedIdx = cols
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => /cache/i.test(c))
        .map(({ i }) => i);
      if (priceIdx.length === 0) continue;

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

        // the type cell: the column the header labels "Type" — Input vs
        // Text output vs cached
        const typeIdx = cols.findIndex((c) => /^type$/i.test(c));
        const type = cells[typeIdx >= 0 ? typeIdx : 1] ?? "";
        const isOutput = /output|response/i.test(type);
        const isInput = /input/i.test(type);
        const isCached = /cached/i.test(type);
        if (!isInput && !isOutput && !isCached) continue;

        // the Region cell, where the table carries one (the Gemini deployment
        // tables): Global vs Non-global vs other — Global is the direct-API
        // rate; the Non-global premium is another SKU.
        if (hasRegionCol) {
          const regionCell = cells[2] ?? "";
          if (!/global/i.test(regionCell)) {
            skip("a non-Global deployment", `${currentLabel ?? "?"} (${regionCell.slice(0, 20)})`);
            continue;
          }
        }

        // the figures: the price columns in header order — [base, long] on a
        // token row
        const figures = priceIdx.map((i) => (cells[i].match(/\$([\d.]+)/) ?? [])[1]).filter((v) => v !== undefined);
        if (figures.length === 0) continue;
        const scale = figures.some((f) => Number(f) < 0.001) ? 1_000_000 : 1;
        const fmt = (x) => String(Math.round(Number(x) * scale * 100) / 100);

        // the date windows: the introductory row is in force until its date;
        // the future row from its date. A row in neither window (no date in
        // the label) is always in force. Today decides.
        const untilDate = dateOf(currentLabel ?? "", "until");
        const fromDate = dateOf(currentLabel ?? "", "from");
        if (fromDate && now < fromDate) { skip("a future-dated rate", currentLabel ?? "?"); continue; }
        if (untilDate && now >= untilDate) { skip("an expired introductory rate", currentLabel ?? "?"); continue; }

        const row = rows.get(currentModel) ?? { id: currentModel };
        if (isOutput) {
          if (row.out === undefined) row.out = fmt(figures[0]);
          if (figures[1] !== undefined) {
            row.long_context ??= { over: 200000 };
            if (row.long_context.out === undefined) row.long_context.out = fmt(figures[1]);
          }
        } else if (isInput) {
          if (row.in === undefined) row.in = fmt(figures[0]);
          if (figures[1] !== undefined) {
            row.long_context ??= { over: 200000 };
            if (row.long_context.in === undefined) row.long_context.in = fmt(figures[1]);
          }
        } else if (isCached) {
          if (row.cache_read === undefined) row.cache_read = fmt(figures[0]);
        }
        rows.set(currentModel, row);
      }
    }

    if (rows.size === 0) drift("no rows after mapping");
    const out = [...rows.values()]
      .map(({ _r, ...r }) => r)
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
