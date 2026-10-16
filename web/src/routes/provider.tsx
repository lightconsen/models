import type { Catalog, ModelsFile, NewsFile } from "../data/types";
import { modelsByProvider, providerEntry, logoUrl } from "../data/api";
import { DataTable, type ColumnDef } from "../components/dataTable";
import { ExpandableDetail, PriceCell } from "../components/priceCell";
import { Badge, PriceRefLine, Rating, billingLabel } from "../components/bits";
import { useDismissedNews } from "../components/dismissNews";
import { formatTokens, modelKey, parsePrice } from "../data/pricing";

/** One capability-flag cell: ✓ / ✗ / —. Absent is "not stated" (a dash
    without a claim); false is only ever the vendor's explicit no, so it says
    so in the title. */
function FlagCell({ v, label }: { v: boolean | undefined; label: string }) {
  if (v === undefined) {
    return (
      <span className="muted" title={`${label}: not stated by the vendor`}>
        —
      </span>
    );
  }
  return (
    <span
      className={v ? "cap-yes" : "cap-no"}
      title={v ? `${label}: stated by the vendor` : `${label}: the vendor states it is not supported`}
    >
      {v ? "✓" : "✗"}
    </span>
  );
}

/** Sort order reads worst to best: unstated < stated-no < stated-yes. */
const flagSort = (v: boolean | undefined): number => (v === undefined ? 0 : v ? 2 : 1);

/** The provider's models, in the order a reader wants them: what it is, what
    it costs, how much it takes, what it does, and last the columns most
    providers do not fill in.

    The split is by how often the catalogue fills a column, measured over the
    1,338 priced rows — In and Out on every one, Context on 92%, Max out 88%,
    Tool call 82%, Temp 74%, Reasoning 72%; then JSON 37%, Modalities 34%,
    Cache write 13%, Knowledge 11%, Tiering 5%, Weights none. A rare column is
    still drawn for a provider that states nothing for it, and reads as a run
    of dashes: a dash is a statement — the vendor does not say — and dropping
    the column would trade that statement for the reader not being able to tell
    whether the catalogue has the field at all. Prices stay together at the
    front rather than being sorted strictly by frequency — Cache read is 60%
    and belongs beside the two rates it is an alternative to, not three columns
    away among the flags. */
const detailColumns = (entry: Catalog["entries"][number]): ColumnDef<ModelsFile["models"][number]>[] => [
  {
    key: "model",
    label: "Model",
    // No wrapping and no ellipsis: a model id is the thing being looked up, and
    // `accounts/fireworks/models/…` cut off at 220px is not a name anyone can
    // check. The table scrolls sideways if a page's ids really are that long.
    render: (r) => <span className="mono model-cell" title={r.model_id}>{r.model_id}</span>,
  },
  {
    key: "in",
    label: "In /1M",
    numeric: true,
    sortValue: (r) => parsePrice(r.input),
    render: (r) => <PriceCell value={r.input} raw={r.input} currency={r.currency} />,
  },
  {
    key: "out",
    label: "Out /1M",
    numeric: true,
    sortValue: (r) => parsePrice(r.output),
    render: (r) => <PriceCell value={r.output} raw={r.output} currency={r.currency} />,
  },
  {
    key: "cache_read",
    label: "Cache read /1M",
    numeric: true,
    sortValue: (r) => parsePrice(r.cache_read ?? "0"),
    render: (r) =>
      parsePrice(r.cache_read ?? "0") > 0 ? <PriceCell value={r.cache_read ?? "0"} raw={r.cache_read ?? "0"} currency={r.currency} /> : "—",
  },
  {
    key: "context",
    label: "Context",
    numeric: true,
    sortValue: (r) => r.context ?? -1,
    render: (r) => (r.context !== undefined ? <span className="mono">{formatTokens(r.context)}</span> : "—"),
  },
  {
    key: "max_output",
    label: "Max out",
    numeric: true,
    sortValue: (r) => r.max_output ?? -1,
    render: (r) => (r.max_output !== undefined ? <span className="mono">{formatTokens(r.max_output)}</span> : "—"),
  },
  {
    key: "reasoning",
    label: "Reasoning",
    numeric: true,
    sortValue: (r) => flagSort(r.reasoning),
    render: (r) => <FlagCell v={r.reasoning} label="Reasoning" />,
  },
  {
    key: "tool_call",
    label: "Tool call",
    numeric: true,
    sortValue: (r) => flagSort(r.tool_call),
    render: (r) => <FlagCell v={r.tool_call} label="Tool calling" />,
  },
  {
    key: "temperature",
    label: "Temp",
    numeric: true,
    sortValue: (r) => flagSort(r.temperature),
    render: (r) => <FlagCell v={r.temperature} label="Temperature" />,
  },
  /* ── from here down, most providers state nothing ── */
  {
    key: "structured_output",
    label: "JSON",
    numeric: true,
    sortValue: (r) => flagSort(r.structured_output),
    render: (r) => <FlagCell v={r.structured_output} label="Structured output" />,
  },
  {
    key: "modalities",
    label: "Modalities",
    // Sorted on the joined string rather than on a count: what a reader scans
    // this column for is which models take an image, and a "how many" would not
    // group them.
    sortValue: (r) => (r.modalities ? `${r.modalities.input.join(",")} ${r.modalities.output.join(",")}` : ""),
    render: (r) =>
      r.modalities ? (
        <span
          className="mono"
          title={`Takes ${r.modalities.input.join(", ")}; gives back ${r.modalities.output.join(", ")}`}
        >
          {r.modalities.input.join(", ")} → {r.modalities.output.join(", ")}
        </span>
      ) : (
        "—"
      ),
  },
  {
    key: "cache_write",
    label: "Cache write /1M",
    numeric: true,
    sortValue: (r) => parsePrice(r.cache_creation ?? "0"),
    render: (r) =>
      parsePrice(r.cache_creation ?? "0") > 0 ? <PriceCell value={r.cache_creation ?? "0"} raw={r.cache_creation ?? "0"} currency={r.currency} /> : "—",
  },
  {
    key: "knowledge",
    label: "Knowledge to",
    // ISO dates sort chronologically as strings, and an unstated cutoff sorts
    // ahead of every stated one, which is where "we do not know" belongs.
    sortValue: (r) => r.knowledge ?? "",
    render: (r) => (r.knowledge ? <span className="mono">{r.knowledge}</span> : "—"),
  },
  {
    key: "tier",
    label: "Tiering",
    render: (r) => (r.long_context ? `>${r.long_context.over}` : r.peak_hours ? "peak/off-peak" : "—"),
  },
  {
    key: "open_weights",
    label: "Weights",
    numeric: true,
    sortValue: (r) => flagSort(r.open_weights),
    render: (r) => <FlagCell v={r.open_weights} label="Published weights" />,
  },
];

export function ProviderDetailPage({
  catalog,
  models,
  news,
  id,
}: {
  catalog: Catalog;
  models: ModelsFile;
  news: NewsFile;
  id: string;
}) {
  const entry = providerEntry(catalog, id);
  if (!entry) {
    return (
      <main className="page">
        <h1 className="page-title">No provider named <span className="mono">{id}</span></h1>
        <p className="muted">Check the list on the home page.</p>
      </main>
    );
  }
  const rows = modelsByProvider(models, id);
  const { isDismissed, dismiss } = useDismissedNews();
  const notice = news.news.filter((n) => n.provider_id === id && !isDismissed(n.id));

  return (
    <main className="page">
      <div className="detail-header">
        <div className="provider-card-top detail-title">
          <img className="provider-logo" src={logoUrl(entry.logo)} alt="" />
          <div>
            <h1 className="page-title">
              {/* The name is the way out to the vendor's own site — the reader
                  who wants the source follows the biggest word on the page. */}
              <a className="title-link" href={entry.website} target="_blank" rel="noopener noreferrer">
                {entry.name}
              </a>
            </h1>
            <span className="mono">{entry.id}</span>
          </div>
          <div className="provider-card-badges">
            {entry.tag === "aggregate" && <Badge kind="tag">Aggregate</Badge>}
            <Badge kind="billing">{billingLabel(entry.billing)}</Badge>
            {entry.seeded && <Badge kind="seeded">Seeded — pending verification</Badge>}
            <Rating value={entry.rating} />
          </div>
        </div>
        <PriceRefLine entry={entry} />
        {entry.prices_as_of && (
          <p className="muted prices-as-of">Prices last updated {entry.prices_as_of}</p>
        )}
        {entry.desc && <p className="desc">{entry.desc}</p>}
        {notice.map((n) => (
          <div key={n.id} className="news-item">
            <div className="news-head">
              {n.badge && <Badge kind="news">{n.badge}</Badge>}
              <strong>{n.title}</strong>
              <button className="news-close" aria-label="dismiss notice" onClick={() => dismiss(n.id)}>×</button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="section-title">Endpoints</h2>
      {entry.endpoints.length === 0 ? (
        <p className="muted">
          The catalogue publishes the prices; your deployment URL is the endpoint.
        </p>
      ) : (
        // In a table-wrap like the price table: an endpoint URL is long and
        // cannot wrap, so without a scroll container it pushes the whole page
        // sideways on a phone instead of scrolling itself.
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Protocol</th>
                <th>Endpoint</th>
                <th className="num">Models served</th>
              </tr>
            </thead>
            <tbody>
              {entry.endpoints.map((ep) => (
                <tr key={ep.protocol}>
                  <td className="mono">{ep.protocol}</td>
                  <td className="mono break">{ep.endpoint}</td>
                  <td className="num">{ep.models.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section-title">Models ({rows.length})</h2>
      <p className="muted">All prices per 1M tokens.</p>
      <DataTable
        rows={rows}
        columns={detailColumns(entry)}
        rowKey={modelKey}
        detail={(r) => <ExpandableDetail row={r} />}
        placeholder={
          <div className="empty-state">
            <p><strong>Sells by plan — per-token prices are not published.</strong></p>
            <p className="muted">The {entry.endpoints.length} endpoint(s) above answer requests; billing is by subscription, so the catalogue carries no rate for them.</p>
          </div>
        }
      />
    </main>
  );
}