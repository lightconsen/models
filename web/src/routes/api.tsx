import type { Catalog } from "../data/types";

/** The API page: how to use the catalogue's public data. The content is the
    published contract (docs/hub-api.md) rendered for a browser reader — the
    four files, the sync pattern, the MCP server. Hand-written prose, not
    generated: the contract changes rarely and reads better as prose. */

const BASE = "https://models.kiwano.cc/data";

function Code({ children }: { children: string }) {
  return <code className="mono">{children}</code>;
}

function Endpoint({ method, path }: { method: string; path: string }) {
  return (
    <p className="api-endpoint">
      <span className="mono api-method">{method}</span> <span className="mono">{path}</span>
    </p>
  );
}

export function ApiPage({ catalog }: { catalog: Catalog }) {
  const total = catalog.total;
  const rows = catalog.entries.reduce((n, e) => n + (e.endpoints[0]?.models.length ?? 0), 0);
  return (
    <main className="page">
      <h1 className="page-title">API</h1>
      <p className="muted">
        The whole catalogue is public static JSON — no key, no auth, no rate limit.{" "}
        {total} providers, {catalog.entries.reduce((n, e) => n + (e.endpoints.reduce((m, ep) => m + ep.models.length, 0) || 0), 0) || "all"} models served
        from <a href={`${BASE}/`} target="_blank" rel="noopener noreferrer" className="mono">{BASE}/</a> (mirrored to{" "}
        <a href="https://hub.kiwano.cc" target="_blank" rel="noopener noreferrer" className="mono">hub.kiwano.cc</a>).
      </p>

      <h2 className="section-title">The four files</h2>
      <Endpoint method="GET" path="/data/manifest.json" />
      <p className="muted">
        The gate: sha256 of each file plus the price-table version. Fetch this
        first (≈400 bytes) — if your cached <Code>catalog.sha256</Code> matches,
        nothing changed and you can stop.
      </p>
      <Endpoint method="GET" path="/data/catalog.json" />
      <p className="muted">
        Providers: identity, endpoints, the flagship's <Code>price_ref</Code> —
        enough to render the list page without the second file.
      </p>
      <Endpoint method="GET" path="/data/models.json" />
      <p className="muted">
        The flat price table: one row per (provider, model), keyed by{" "}
        <Code>model_id</Code> — the same id across providers is the same model,
        comparable. Prices are <strong>strings, not numbers</strong> — parse,
        never compare lexically. <Code>models.version</Code> is the price-table
        version: an unchanged version means your table is current.
      </p>
      <Endpoint method="GET" path="/data/news.json" />
      <p className="muted">
        Dated notices per (provider, model) — new models, discounts,
        retirements. Carries <Code>released</Code>; the client decides what is
        still fresh.
      </p>
      <Endpoint method="GET" path="/logos/&lt;id&gt;.&lt;ext&gt;" />
      <p className="muted">Provider logos, referenced by each entry's <Code>logo</Code> field.</p>

      <h2 className="section-title">The sync pattern</h2>
      <ol>
        <li>Fetch <Code>manifest.json</Code>. If the cached <Code>catalog.sha256</Code> matches, stop — nothing changed.</li>
        <li>Otherwise fetch <Code>catalog.json</Code> + <Code>models.json</Code> and re-seed the price table.</li>
        <li><Code>models.version</Code> gates the price table: an unchanged version means the app keeps what it has.</li>
      </ol>
      <p className="muted">
        The manifest is an optimisation only — missing or malformed, the sync
        degrades to an unconditional full fetch, never to an error.{" "}
        <Code>cache: no-store</Code> recommended — the files are regenerated on
        every push to <Code>main</Code>.
      </p>

      <h2 className="section-title">The price table's shape</h2>
      <p className="muted">
        One row per (provider, model). Every row carries its currency (the
        provider's own), and its <Code>off_peak</Code> /{" "}
        <Code>peak_hours</Code> / <Code>long_context</Code> when the provider
        has them, so the schedule and the band travel with the prices they
        modify. Capability facts (<Code>context</Code>, <Code>max_output</Code>,{" "}
        <Code>reasoning</Code>…) travel when present: a client that does not
        read them loses nothing, and one that does never guesses them from a
        model name.
      </p>
      <p className="muted">
        The table is <strong>the whole table, not a patch</strong> — a model the
        catalogue stops pricing disappears from it, and a client that caches
        must drop what is no longer there. A model resold by several providers
        is listed by each of them at its own price: the rows are keyed{" "}
        <Code>(provider, model)</Code> precisely so both survive.
      </p>

      <h2 className="section-title">MCP server</h2>
      <p className="muted">
        The catalogue also serves the tool loop: a zero-dependency MCP server
        (stdio) reading <Code>dist/</Code> directly, so a build refreshes
        everything it serves. Three tools: <Code>list_providers</Code>,{" "}
        <Code>search_models</Code> (name substring, min context, tool/reasoning
        filters), <Code>get_model_price</Code>.
      </p>
      <p className="mono api-wire">claude mcp add kiwano-hub -- node /path/to/models/scripts/hub-mcp.mjs</p>
      <p className="muted">
        Failures degrade to empty results with the reason — the server never
        guesses half-matched prices, and nothing here needs a key: the data is
        public, the server is read-only.
      </p>

      <h2 className="section-title">The full contract</h2>
      <p className="muted">
        Field-by-field shapes and the edge cases (per-provider price
        divergence is legitimate data; the whole-table-not-a-patch rule; the
        absent-means-the-vendor-does-not-say rule for capability flags):{" "}
        <a
          href="https://github.com/lightconsen/models/blob/main/docs/hub-api.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          docs/hub-api.md
        </a>
        .
      </p>
    </main>
  );
}