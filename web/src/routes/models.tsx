import type { Catalog, ModelsFile } from "../data/types";
import { DataTable, type ColumnDef } from "../components/dataTable";
import { ExpandableDetail, PriceCell } from "../components/priceCell";
import { modelKey, parsePrice } from "../data/pricing";

const columns = (catalog: Catalog): ColumnDef<ModelsFile["models"][number]>[] => [
  {
    key: "provider",
    label: "Provider",
    render: (r) => catalog.entries.find((e) => e.id === r.provider_id)?.name ?? r.provider_id,
  },
  { key: "model", label: "Model", numeric: false, render: (r) => <span className="mono">{r.model_id}</span> },
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
    numeric: false,
    render: (r) => (r.long_context ? `>${r.long_context.over}` : r.peak_hours ? "peak/off-peak" : "—"),
  },
];

export function ModelsPage({ catalog, models }: { catalog: Catalog; models: ModelsFile }) {
  return (
    <main className="page">
      <h1 className="page-title">Models</h1>
      <p className="muted">{models.models.length} price rows across {catalog.total} providers.</p>
      <DataTable
        rows={models.models}
        columns={columns(catalog)}
        rowKey={modelKey}
        detail={(r) => <ExpandableDetail row={r} />}
      />
    </main>
  );
}