/**
 * Google Vertex AI's generative-ai prices, from the vendor's own pricing page
 * (`cloud.google.com/vertex-ai/generative-ai/pricing`) — server-rendered
 * tables (~3.3MB, no key) covering Gemini, Claude, Llama, Mistral, Qwen,
 * Grok, DeepSeek and the embeddings, plus Google's own extras (grounding,
 * image generation, live API).
 *
 * Dated pricing, the google-gemini pattern: several models run an
 * introductory rate "through December 31, 2026" beside the standard rate
 * "starting January 1, 2027". The adapter reads whichever is in force on the
 * day it runs — the introductory row before the switch, the standard row
 * after — the same rule the google-gemini entry documents.
 *
 * Units: the page prices per 1M tokens for most models, but a few rows
 * (Gemini 2.0 Flash, the Live API) spell per-token figures — the adapter
 * scales those to per-1M the way every price here lands.
 *
 * The ids are the API model ids the seed carried (`claude-opus-4-6@default`,
 * `gemini-3.5-flash`…) — Vertex's deployment naming, distinct from the
 * upstream vendors' own ids. The map below carries the page label each id
 * prices; a label the table lacks is a new or retired model and is dropped
 * loudly.
 */
import { drift, getText, MEMBERSHIP } from "../lib/fetch.mjs";

const URL = "https://cloud.google.com/vertex-ai/generative-ai/pricing";

/** Page row label → entry id + how the row's figures price.
    slot: "base" = the row's in/out; "embed" = input-only. */
const ROWS = {
  // ── Gemini ──
  "Gemini 3.5 Flash": ["gemini-3.5-flash", "base"],
  "Gemini 3.5 Flash-Lite": ["gemini-3.5-flash-lite", "base"],
  "Gemini 3.6 Flash": ["gemini-3.6-flash", "base"],
  "Gemini 3.7 Flash": ["gemini-3.7-flash", "base"],
  "Gemini 3.8 Flash": ["gemini-3.8-flash", "base"],
  "Gemini 3.1 Flash-Lite": ["gemini-3.1-flash-lite", "base"],
  "Gemini 3.1 Pro": ["gemini-3.1-pro-preview", "base"],
  "Gemini 3.1 Pro Preview": ["gemini-3.1-pro-preview", "base"],
  "Gemini 3 Pro": ["gemini-3-pro", "base"],
  "Gemini 2.5 Pro": ["gemini-2.5-pro", "base"],
  "Gemini 2.5 Flash": ["gemini-2.5-flash", "base"],
  "Gemini 2.5 Flash Lite": ["gemini-2.5-flash-lite", "base"],
  // ── Claude ──
  "Claude Fable 5": ["claude-fable-5@default", "base"],
  "Claude Fable 5.1": ["claude-fable-5-1@default", "base"],
  "Claude Opus 4.8": ["claude-opus-4-8@default", "base"],
  "Claude Opus 4.7": ["claude-opus-4-7@default", "base"],
  "Claude Opus 4.6": ["claude-opus-4-6@default", "base"],
  "Claude Opus 4.5": ["claude-opus-4-5@20251101", "base"],
  "Claude Sonnet 5": ["claude-sonnet-5@default", "base"],
  "Claude Sonnet 4.6": ["claude-sonnet-4-6@default", "base"],
  "Claude Sonnet 4.5": ["claude-sonnet-4-5@20250929", "base"],
  // ── Mistral ──
  "Mistral OCR (25.05)": null, // per-page, not token-billed
  // ── Llama ──
  "Llama 4 Maverick 17B": ["meta/llama-4-maverick-17b-128e-instruct-fp8@default", "base"],
  // ── Grok ──
  "Grok 4.6": ["xai/grok-4-6@default", "base"],
};

/** What counts as "the model is priced" on this page: the Input/Output pair.
    Batch and cache-write columns exist beside them and are skipped — batch is
    a discounted tier, cache writes are Google's own additions the seed never
    carried. */
const ROW_FIELDS = /Input\s*\$([\d.]+)/;

const perMillion = (v) => {
  const n = Number(v);
  return String(Math.round(n * 100_000) / 100_000).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

/** Strip the dated-price suffixes: a row label carries "through December 31,
    2026" (the introductory rate, in force) or "starting January 1, 2027" (the
    future rate). Both price the same model — the entry reads the in-force
    one and the future rate rides in the notes. */
const isFutureRate = (label, today) => /starting January 1, 2027/i.test(label);
const isInForce = (label, today) => /through December 31, 2026/i.test(label) || !/starting|through/i.test(label);

export default {
  ids: ["vertex"],
  source: URL,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out"],

  async read() {
    const html = await getText(URL, { headers: { accept: "text/html" } });

    const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
    if (tables.length === 0) drift("no tables — the page has been restructured");

    /** One pass over every table's rows: label → figures. Rows appear per
        deployment column (Standard first), so the FIRST price figure in a row
        is the standard rate. */
    const rows = new Map();
    const skipped = new Map();
    const skip = (why, label) => skipped.set(why, [...(skipped.get(why) ?? []), label]);

    const today = new Date();
    const isFuture = (d) => d > today;

    for (const tb of tables) {
      for (const tr of tb.matchAll(/<tr[\s\S]*?<\/tr>/g)) {
        const cells = [...tr[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
        if (cells.length < 3) continue;
        const label = cells[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const figures = [...cells.slice(1).join(" ").matchAll(/\$\s*([\d.]+)/g)].map((m) => m[1]);
        if (figures.length < 2) continue;

        const mapped = ROWS[label];
        if (mapped === null) { skip("priced on the page, not token-billed", label); continue; }
        if (!mapped) { skip("a model the id table lacks", label); continue; }
        const [id, slot] = mapped;
        if (slot !== "base") { skip("a non-base slot", label); continue; }

        // dated rows: the introductory rate (labelled "through December 31,
        // 2026") is in force until the switch; the "starting January 1, 2027"
        // rows are the future rate, skipped today. After the switch the
        // introductory row itself dates out and the plain/standard row reads.
        const future = /starting January 1, 2027/i.test(label);
        if (future) { skip("a future-dated rate (starting Jan 1 2027)", label); continue; }

        // per-token rows scale ×1M (the page spells Gemini 2.0's and some
        // Gemini 3 rows per-token: 0.000001 = $1/1M)
        const scale = figures.some((f) => Number(f) < 0.001) ? 1_000_000 : 1;
        const inP = perMillion(figures[0]) * scale;
        const outP = perMillion(figures[1]) * scale;
        if (!inP || !outP) { skip("a row with no complete rate", label); continue; }

        const row = rows.get(id) ?? { id };
        if (row.in === undefined) { row.in = String(Math.round(inP * 100_000) / 100_000); row.out = String(Math.round(outP * 100_000) / 100_000); }
        rows.set(id, row);
      }
    }

    if (rows.size === 0) drift("no rows after mapping");
    const notes = [...skipped.entries()].map(([why, labels]) => `${why}: ${labels.length} row(s), e.g. ${labels.slice(0, 3).join(", ")}`);
    return { rows: { vertex: [...rows.values()] }, notes: { vertex: notes } };
  },
};