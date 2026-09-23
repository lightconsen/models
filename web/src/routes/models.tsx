import { useState } from "react";
import type { Catalog, ModelsFile } from "../data/types";
import { DataTable, type ColumnDef } from "../components/dataTable";
import { ExpandableDetail, PriceCell } from "../components/priceCell";
import { modelKey, parsePrice } from "../data/pricing";

const columns = (catalog: Catalog): ColumnDef<ModelsFile["models"][number]>[] => {
  const asOf = new Map(catalog.entries.map((e) => [e.id, e.prices_as_of]));
  return [
    {
      key: "provider",
      label: "Provider",
      render: (r) => catalog.entries.find((e) => e.id === r.provider_id)?.name ?? r.provider_id,
    },
    { key: "model", label: "Model", numeric: false, render: (r) => <span className="mono">{r.model_id}</span> },
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
      key: "cache_write",
      label: "Cache write /1M",
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
    {
      key: "as_of",
      label: "As of",
      numeric: false,
      sortValue: (r) => asOf.get(r.provider_id) ?? "",
      render: (r) => asOf.get(r.provider_id) ?? "—",
    },
  ];
};

export function ModelsPage({ catalog, models }: { catalog: Catalog; models: ModelsFile }) {
  const [provider, setProvider] = useState("all");
  const latestStamp = catalog.entries
    .map((e) => e.prices_as_of)
    .filter(Boolean)
    .sort()
    .at(-1);

  // Only providers this table actually has rows for, newest first by their own
  // prices_as_of so the picker reads as a recency list rather than a dump.
  const withRows = catalog.entries
    .filter((e) => models.models.some((r) => r.provider_id === e.id))
    .sort((a, b) => (b.prices_as_of ?? "").localeCompare(a.prices_as_of ?? "") || a.name.localeCompare(b.name));
  const shown = provider === "all" ? models.models : models.models.filter((r) => r.provider_id === provider);

  return (
    <main className="page">
      <h1 className="page-title">Models</h1>
      <p className="muted">
        {models.models.length} price rows across {catalog.total} providers — all prices per 1M tokens.
        {latestStamp && ` Most recent provider update ${latestStamp}.`}
      </p>
      <DataTable
        rows={shown}
        columns={columns(catalog)}
        rowKey={modelKey}
        detail={(r) => <ExpandableDetail row={r} />}
        toolbar={
          <>
            <select
              className="filter-input select"
              aria-label="Filter by provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="all">All providers ({models.models.length} rows)</option>
              {withRows.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({models.models.filter((r) => r.provider_id === e.id).length} rows)
                </option>
              ))}
            </select>
            {provider !== "all" && (
              <button className="chip" onClick={() => setProvider("all")}>
                Clear
              </button>
            )}
          </>
        }
      />
    </main>
  );
}
