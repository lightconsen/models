import type { Catalog, ModelsFile, NewsFile } from "../data/types";
import { modelsByProvider, providerEntry, logoUrl } from "../data/api";
import { DataTable, type ColumnDef } from "../components/dataTable";
import { ExpandableDetail, PriceCell } from "../components/priceCell";
import { Badge, PriceRefLine, Rating, billingLabel } from "../components/bits";
import { modelKey, parsePrice } from "../data/pricing";

const detailColumns = (entry: Catalog["entries"][number]): ColumnDef<ModelsFile["models"][number]>[] => [
  { key: "model", label: "Model", render: (r) => <span className="mono">{r.model_id}</span> },
  {
    key: "in",
    label: "In",
    numeric: true,
    sortValue: (r) => parsePrice(r.in),
    render: (r) => <PriceCell value={r.in} raw={r.in} currency={r.currency} />,
  },
  {
    key: "out",
    label: "Out",
    numeric: true,
    sortValue: (r) => parsePrice(r.out),
    render: (r) => <PriceCell value={r.out} raw={r.out} currency={r.currency} />,
  },
  {
    key: "cache_read",
    label: "Cache read",
    numeric: true,
    sortValue: (r) => parsePrice(r.cache_read ?? "0"),
    render: (r) =>
      parsePrice(r.cache_read ?? "0") > 0 ? <PriceCell value={r.cache_read ?? "0"} raw={r.cache_read ?? "0"} currency={r.currency} /> : "—",
  },
  {
    key: "cache_write",
    label: "Cache write",
    numeric: true,
    sortValue: (r) => parsePrice(r.cache_creation ?? "0"),
    render: (r) =>
      parsePrice(r.cache_creation ?? "0") > 0 ? <PriceCell value={r.cache_creation ?? "0"} raw={r.cache_creation ?? "0"} currency={r.currency} /> : "—",
  },
  {
    key: "tier",
    label: "Tiering",
    render: (r) => (r.long_context ? `>${r.long_context.over}` : r.peak_hours ? "peak/off-peak" : "—"),
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
  const notice = news.news.filter((n) => n.provider_id === id);

  return (
    <main className="page">
      <div className="detail-header">
        <div className="provider-card-top detail-title">
          <img className="provider-logo" src={logoUrl(entry.logo)} alt="" />
          <div>
            <h1 className="page-title">{entry.name}</h1>
            <span className="mono">{entry.id}</span>
          </div>
          <div className="provider-card-badges">
            {entry.tag === "aggregate" && <Badge kind="tag">Aggregate</Badge>}
            <Badge kind="billing">{billingLabel(entry.billing)}</Badge>
            <Rating value={entry.rating} />
          </div>
        </div>
        <PriceRefLine entry={entry} />
        {entry.desc && <p className="desc">{entry.desc}</p>}
        {notice.map((n) => (
          <div key={n.id} className="news-item">
            {n.badge && <Badge kind="news">{n.badge}</Badge>}
            <strong>{n.title}</strong>
          </div>
        ))}
      </div>

      <h2 className="section-title">Endpoints</h2>
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

      <h2 className="section-title">Models ({rows.length})</h2>
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