/**
 * Google Vertex AI's generative-ai prices, from the vendor's own pricing page
 * (`cloud.google.com/vertex-ai/generative-ai/pricing`) — server-rendered
 * tables (~3.3MB, no key) covering Gemini, Claude, Llama, Mistral, Qwen,
 * Grok, DeepSeek and the embeddings, plus Google's own extras (grounding,
 * image generation, live API).
 *
 * The Gemini tables use a **rowspan pattern**: the model name's cell spans
 * multiple rows, one per modality/field. Row 1 is Input (text, image, …),
 * row 2 is Text output (response and reasoning). The Type column says which;
 * the model name cell is empty on the continuation rows. The adapter walks
 * each table's rows, tracking the current model, and joins Input + Output.
 *
 * The Claude/Llama/Mistral/Grok tables price differently — a separate table
 * per model with all the rates on one row. These parse the same way.
 *
 * Dated pricing, the google-gemini pattern: Gemini 3.6–3.8 Flash carry an
 * introductory rate "through December 31, 2026" beside the standard rate
 * "starting January 1, 2027". The adapter reads whichever is in force on the
 * day it runs — the introductory row before the switch, the standard row
 * after — the same rule the google-gemini entry documents.
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
    ids are the seed's Vertex deployment ids. */
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

const strip = (s) => s.replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export default {
  ids: ["vertex"],
  source: URL,
  membership: MEMBERSHIP.FOLLOW,
  owns: ["in", "out"],

  async read() {
    const html = await getText(URL, { headers: { accept: "text/html" } });

    const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
    if (tables.length === 0) drift("no tables — the page has been restructured");

    /** (modelId) → {in, out} — the per-model best rate. For the rowspan
        tables, Input and Output are on different rows of the same table; for
        the Claude/Llama single-row tables, both rates are on the same row.
        Dated rows: the introductory row (in force) wins; the future row
        (starting Jan 1 2027) is skipped. */
    const rows = new Map();
    const skipped = new Map();
    const skip = (why, label) => skipped.set(why, [...(skipped.get(why) ?? []), label]);

    for (const tb of tables) {
      // These tables carry no <thead> — the header is the first <tr> whose
      // cells are <th>. Walk the rows after it.
      const rowsAll = [...tb.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]);
      const headRow = rowsAll.find((r) => /<th[\s>]/.test(r));
      if (!headRow) continue;
      const cols = [...headRow.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => strip(c[1]));
      const isInputTable = cols.some((c) => /input tokens/i.test(c));
      const isTokenTable = cols.some((c) => /token price|price.*token/i.test(c));
      if (!isInputTable && !isTokenTable) continue;

      let currentModel = null;
      let currentLabel = null;
      let currentFuture = false;

      for (const tr of rowsAll) {
        if (tr === headRow) continue;
        const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => strip(c[1]));
        if (cells.length < 3) continue;

        // the model name cell: non-empty opens a new model; empty carries over
        const label = cells[0];
        if (label) {
          currentModel = MODELS[label] ?? null;
          currentLabel = label;
          currentFuture = /starting January 1, 2027/i.test(label);
          if (!currentModel) skip("a model the id table lacks", label);
        }
        if (!currentModel) continue;

        // the type cell: Input vs Text output
        const type = cells[1] ?? "";
        const isOutput = /output|response/i.test(type);
        const isInput = /input/i.test(type);
        if (!isInput && !isOutput) continue;
        const field = isOutput ? "out" : "in";

        // the prices: the first $ figure in the price cells
        const priceCells = cells.slice(3);
        const figures = priceCells.map((c) => (c.match(/\$([\d.]+)/) ?? [])[1]).filter((v) => v !== undefined);
        if (figures.length === 0) continue;
        // per-token figures scale ×1M (0.000001 = $1/1M)
        const scale = figures.some((f) => Number(f) < 0.001) ? 1_000_000 : 1;
        let v = figures[0];
        if (scale > 1) v = String(Number(v) * scale);
        v = String(Math.round(Number(v) * 100) / 100);

        if (currentFuture) { skip("a future-dated rate (starting Jan 1 2027)", currentLabel ?? "?"); continue; }

        const row = rows.get(currentModel) ?? { id: currentModel };
        if (row[field] === undefined) row[field] = v;
        rows.set(currentModel, row);
      }
    }

    if (rows.size === 0) drift("no rows after mapping");
    const out = [...rows.values()].filter((r) => r.in !== undefined && r.out !== undefined);
    if (out.length === 0) drift("no complete rows after the Input/Output join");
    const notes = [...skipped.entries()].map(([why, labels]) => `${why}: ${labels.length} row(s), e.g. ${labels.slice(0, 3).join(", ")}`);
    return { rows: { vertex: out }, notes: { vertex: notes } };
  },
};