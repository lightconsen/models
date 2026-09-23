#!/usr/bin/env node
/**
 * The Kiwano Hub as an MCP server — the catalogue in the tool loop.
 *
 * Speaks MCP 2.0 over stdio (newline-delimited JSON-RPC, the spec's stdio
 * transport) with zero dependencies: the hub is four static JSON files and a
 * tool loop needs no more than `fs`. Reads dist/ directly, so `npm run build`
 * in the data repo refreshes everything it serves.
 *
 * Three tools, the surface an assistant actually reaches for:
 *   list_providers   — the catalogue's providers, with billing and flagship
 *   get_model_price  — exact price lookup by (provider, model)
 *   search_models    — substring/capability search over every priced row
 *
 * Wiring (one-time): claude mcp add kiwano-hub -- node <repo>/scripts/hub-mcp.mjs
 * The server is read-only over static data — no keys, no writes, nothing to
 * authenticate; failures degrade to empty results with the reason, never to a
 * half-matched guess.
 *
 * Run alone (handshake + one tool call, then exit):
 *   node scripts/hub-mcp.mjs --selftest
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(repo, "dist");
const SITE = "https://models.kiwano.cc";

const readJson = (f) => JSON.parse(readFileSync(path.join(dist, f), "utf8"));

let catalog, modelsFile, news;
try {
  catalog = readJson("catalog.json");
  modelsFile = readJson("models.json");
  news = readJson("news.json");
} catch (err) {
  console.error(`✗ dist/ is missing or unreadable (${err.message}) — run \`node scripts/generate.mjs\` first.`);
  process.exit(1);
}

const entry = (id) => catalog.entries.find((e) => e.id === id);
const cur = (c) => (c === "CNY" ? "¥" : "$");
const money = (n) => (Number.isFinite(Number(n)) ? String(Math.round(Number(n) * 100) / 100) : String(n));

const rateLine = (r) => {
  const c = cur(r.currency);
  const bits = [`${c}${money(r.input)} in / ${c}${money(r.output)} out per 1M tokens`];
  if (r.cache_read && Number(r.cache_read) > 0) bits.push(`cache read ${c}${money(r.cache_read)}`);
  if (r.cache_creation && Number(r.cache_creation) > 0) bits.push(`cache write ${c}${money(r.cache_creation)}`);
  if (r.off_peak && r.peak_hours) bits.push(`off-peak ${c}${money(r.off_peak.in)}/${c}${money(r.off_peak.out)}`);
  if (r.long_context) bits.push(`above ${money(r.long_context.over)} input: ${c}${money(r.long_context.in)}/${c}${money(r.long_context.out)}`);
  return bits.join("; ");
};

const capLine = (r) => {
  const caps = [];
  if (r.context) caps.push(`${money(r.context)} context`);
  if (r.max_output) caps.push(`${money(r.max_output)} max output`);
  const flag = (v, yes, no) => (v === true ? yes : v === false ? no : null);
  for (const [v, yes, no] of [
    [r.reasoning, "reasoning", "no reasoning"],
    [r.tool_call, "tool call", "no tool call"],
    [r.structured_output, "structured output", "no structured output"],
    [r.temperature, "temperature control", "fixed temperature"],
  ]) {
    const f = flag(v, yes, no);
    if (f) caps.push(f);
  }
  return caps.join(", ");
};

// ── tools ──

const listProviders = () => ({
  content: [
    {
      type: "text",
      text: `${catalog.total} providers (price table v${modelsFile.version}, generated ${modelsFile.generated_at}):\n\n` +
        catalog.entries
          .map((e) => {
            const ref = e.price_ref;
            const rate = ref ? `flagship ${ref.display_name}: ${cur(ref.currency)}${money(ref.input)} in / ${cur(ref.currency)}${money(ref.output)} per 1M` : "no published per-token rate";
            return `- ${e.name} (${e.id}) — ${e.billing}, ${e.currency}; ${rate}${e.seeded ? "; seeded, pending verification" : ""}`;
          })
          .join("\n"),
    },
  ],
});

const searchModels = (args) => {
  const q = String(args?.query ?? "").trim().toLowerCase();
  const minContext = Number(args?.min_context ?? 0);
  const requireTools = args?.require_tools === true;
  const requireReasoning = args?.require_reasoning === true;
  const limit = Math.min(Number(args?.limit ?? 20) || 20, 50);
  if (!q && !minContext && !requireTools && !requireReasoning) {
    return { content: [{ type: "text", text: "Give a query substring, min_context, require_tools or require_reasoning — searching every row with no filter serves nobody." }], isError: true };
  }
  const hits = modelsFile.models.filter((r) => {
    if (r.input === undefined || r.output === undefined) return false;
    if (q && !`${r.model_id} ${r.display_name} ${r.provider_id}`.toLowerCase().includes(q)) return false;
    if (minContext && !(r.context >= minContext)) return false;
    if (requireTools && r.tool_call !== true) return false;
    if (requireReasoning && r.reasoning !== true) return false;
    return true;
  });
  const shown = hits.slice(0, limit);
  const lines = shown.map((r) => {
    const e = entry(r.provider_id);
    return `- ${r.display_name} (${r.provider_id}/${r.model_id}) — ${rateLine(r)}${capLine(r) ? `; ${capLine(r)}` : ""} — ${SITE}/provider/${r.provider_id}/`;
  });
  return {
    content: [{ type: "text", text: `${hits.length} match(es), showing ${shown.length}${q ? ` for "${q}"` : ""}:\n\n${lines.join("\n") || "(none)"}` }],
  };
};

const getModelPrice = (args) => {
  const model = String(args?.model ?? "").trim().toLowerCase();
  const provider = args?.provider ? String(args.provider).trim().toLowerCase() : null;
  if (!model) return { content: [{ type: "text", text: "Name a model (model_id substring or exact)." }], isError: true };
  const hits = modelsFile.models.filter((r) => r.model_id.toLowerCase().includes(model) || r.display_name.toLowerCase().includes(model));
  const narrowed = provider ? hits.filter((r) => r.provider_id === provider || entry(r.provider_id)?.name.toLowerCase() === provider) : hits;
  if (narrowed.length === 0) {
    return { content: [{ type: "text", text: `No priced model matches "${model}"${provider ? ` on ${provider}` : ""}. Search search_models for close spellings.` }], isError: true };
  }
  const rows = narrowed.slice(0, 8).map((r) => {
    const e = entry(r.provider_id);
    return `### ${r.display_name} — ${e?.name ?? r.provider_id}\n- id: ${r.model_id}\n- ${rateLine(r)}\n- ${capLine(r) || "capabilities not published"}\n- currency: ${r.currency}; prices as of ${e?.prices_as_of ?? "unknown"}\n- ${SITE}/provider/${r.provider_id}/`;
  });
  const multi = narrowed.length > 8 ? `\n(${narrowed.length - 8} more matches — narrow with provider)` : "";
  return { content: [{ type: "text", text: rows.join("\n\n") + multi }] };
};

const TOOLS = [
  {
    name: "list_providers",
    description: "List every provider on the Kiwano Hub catalogue with billing mode, currency and flagship per-token price.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search_models",
    description: "Search every priced model row. Filter by name substring, minimum context window, tool-call or reasoning requirement.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "substring of model id / display name / provider id (optional if another filter is set)" },
        min_context: { type: "number", description: "minimum context window in tokens" },
        require_tools: { type: "boolean", description: "only models the vendor states support tool calling" },
        require_reasoning: { type: "boolean", description: "only models the vendor states support reasoning" },
        limit: { type: "number", description: "max rows to show (default 20, max 50)" },
      },
    },
  },
  {
    name: "get_model_price",
    description: "Exact per-token price and capability lookup for one model, by model id or display name (optionally narrowed to a provider).",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: "model id or display name, e.g. \"glm-5.3\" or \"Claude Opus\"" },
        provider: { type: "string", description: "provider id or name to narrow a shared model id" },
      },
      required: ["model"],
    },
  },
];

const callTool = (name, args) => {
  if (name === "list_providers") return listProviders();
  if (name === "search_models") return searchModels(args);
  if (name === "get_model_price") return getModelPrice(args);
  return { content: [{ type: "text", text: `Unknown tool "${name}".` }], isError: true };
};

// ── stdio transport ──

const write = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

const handle = (msg) => {
  if (msg.method === "initialize") {
    write({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "kiwano-hub", version: "1.0.0" } } });
  } else if (msg.method === "notifications/initialized") {
    // a notification: no reply
  } else if (msg.method === "tools/list") {
    write({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
  } else if (msg.method === "tools/call") {
    try {
      write({ jsonrpc: "2.0", id: msg.id, result: callTool(msg.params?.name, msg.params?.arguments) });
    } catch (err) {
      write({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `tool failed: ${err.message}` }], isError: true } });
    }
  } else if (msg.method === "ping") {
    write({ jsonrpc: "2.0", id: msg.id, result: {} });
  } else if (msg.id !== undefined) {
    write({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method "${msg.method}" not found` } });
  }
};

if (process.argv.includes("--selftest")) {
  // One round of the real thing: a written handshake and two tool calls read
  // back from the same dispatch the live server uses.
  const seq = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_model_price", arguments: { model: "GLM-5.3", provider: "baidu-qianfan" } } },
  ];
  for (const msg of seq) {
    handle(msg);
  }
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, crlf: false });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    handle(JSON.parse(trimmed));
  } catch {
    console.error(`unparseable line ignored: ${trimmed.slice(0, 80)}`);
  }
});
rl.on("close", () => process.exit(0));
