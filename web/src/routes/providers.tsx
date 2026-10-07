import { useMemo, useState } from "react";
import type { Catalog, ModelsFile, NewsFile } from "../data/types";
import { DataTable, type ColumnDef } from "../components/dataTable";
import { logoUrl } from "../data/api";
import { navigate } from "../routes/router";
import { Badge, Rating, billingLabel } from "../components/bits";
import { useDismissedNews } from "../components/dismissNews";
import { PriceCell } from "../components/priceCell";
import { parsePrice } from "../data/pricing";

type Entry = Catalog["entries"][number];

/**
 * The name is the way into the provider's page, and the click stops there so the
 * row's own expansion does not fire with it — the same split the models table
 * uses, so a click means the same thing on both.
 */
function ProviderLink({ entry }: { entry: Entry }) {
  return (
    <a
      className="provider-cell"
      href={`#/provider/${entry.id}`}
      title={`${entry.name} — open the provider page`}
      onClick={(ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        navigate({ page: "provider", id: entry.id });
      }}
    >
      <img className="provider-logo" src={logoUrl(entry.logo)} alt="" loading="lazy" />
      <span className="provider-name">{entry.name}</span>
      <span className="mono muted provider-id">{entry.id}</span>
      {/* One entry in fifty-six is an aggregator, so it rides the name rather
          than taking a column that is constant for everything else. */}
      {entry.tag === "aggregate" && <Badge kind="tag">Aggregate</Badge>}
    </a>
  );
}

/** Why a price cell is empty, in the cell's own title — a plan-billed vendor and
    one whose rate nobody publishes are different facts. */
const noPrice = (e: Entry) =>
  e.billing === "plan" ? "Bills by plan — no per-token rate is published" : "No flagship price published";

const columns = (models: ModelsFile): ColumnDef<Entry>[] => {
  const rowsPer = new Map<string, number>();
  for (const r of models.models) rowsPer.set(r.provider_id, (rowsPer.get(r.provider_id) ?? 0) + 1);

  return [
    {
      key: "provider",
      label: "Provider",
      render: (e) => <ProviderLink entry={e} />,
      sortValue: (e) => e.name,
    },
    {
      key: "billing",
      label: "Billing",
      render: (e) => <Badge kind="billing">{billingLabel(e.billing)}</Badge>,
      sortValue: (e) => billingLabel(e.billing),
    },
    {
      key: "rating",
      label: "Rating",
      numeric: true,
      render: (e) => <Rating value={e.rating} />,
      sortValue: (e) => e.rating,
    },
    {
      key: "flagship",
      label: <span title="The model the two price columns price — the entry's flagship">Flagship</span>,
      render: (e) =>
        e.price_ref ? (
          <span className="mono" title={`${e.price_ref.display_name} — the model the price columns price`}>
            {e.price_ref.display_name}
          </span>
        ) : (
          <span className="muted" title={noPrice(e)}>
            —
          </span>
        ),
      sortValue: (e) => e.price_ref?.display_name ?? "",
    },
    {
      key: "in",
      label: "In /1M",
      numeric: true,
      render: (e) =>
        e.price_ref ? (
          <PriceCell value={e.price_ref.input} raw={e.price_ref.input} currency={e.price_ref.currency} />
        ) : (
          <span className="muted" title={noPrice(e)}>—</span>
        ),
      sortValue: (e) => parsePrice(e.price_ref?.input ?? "0"),
    },
    {
      key: "out",
      label: "Out /1M",
      numeric: true,
      render: (e) =>
        e.price_ref ? (
          <PriceCell value={e.price_ref.output} raw={e.price_ref.output} currency={e.price_ref.currency} />
        ) : (
          <span className="muted" title={noPrice(e)}>—</span>
        ),
      sortValue: (e) => parsePrice(e.price_ref?.output ?? "0"),
    },
    {
      key: "rows",
      label: <span title="Price rows this provider contributes to the models table">Models</span>,
      numeric: true,
      render: (e) => <span className="mono">{rowsPer.get(e.id) ?? 0}</span>,
      sortValue: (e) => rowsPer.get(e.id) ?? 0,
    },
    {
      key: "as_of",
      label: (
        <span title="When this provider's price rows were last written from its own pages. A dash means the entry is seeded from a third party and not yet verified, or plan-billed with no rate to write.">
          Prices updated
        </span>
      ),
      render: (e) => (
        <span
          title={
            e.prices_as_of
              ? `Price rows last written from the vendor's pages on ${e.prices_as_of}`
              : e.seeded
                ? "Seeded from a third party — not yet verified against the vendor"
                : "No per-token rate written for this provider"
          }
        >
          {/* A seeded entry has no date of its own — the badge is the date's
              replacement, not a decoration beside a dash. */}
          {e.seeded ? <Badge kind="seeded">Seeded</Badge> : (e.prices_as_of ?? "—")}
        </span>
      ),
      sortValue: (e) => e.prices_as_of ?? "",
    },
  ];
};

function NewsStrip({ news }: { news: NewsFile }) {
  const { isDismissed, dismiss } = useDismissedNews();
  const items = news.news.filter((n) => !isDismissed(n.id));
  if (items.length === 0) return null;
  return (
    <div className="news-strip">
      {items.map((n) => (
        <div key={n.id} className="news-item">
          <div className="news-head">
            {n.badge && <Badge kind="news">{n.badge}</Badge>}
            <strong>{n.title}</strong>
            <button className="news-close" aria-label="dismiss notice" onClick={() => dismiss(n.id)}>×</button>
          </div>
          <span className="muted news-body">{n.body.slice(0, 120)}</span>
        </div>
      ))}
    </div>
  );
}

/** The categories a reader actually sorts providers into: what the vendor
    sells at that address (the badge the row shows), plus the one reseller.
    Built from the data so a tag the catalogue gains later appears on its own. */
const categoryOf = (e: Entry) => (e.tag === "aggregate" ? "aggregate" : e.billing);

export function ProvidersPage({ catalog, models, news }: { catalog: Catalog; models: ModelsFile; news: NewsFile }) {
  const [cat, setCat] = useState("all");
  const counts = new Map<string, number>();
  for (const e of catalog.entries) counts.set(categoryOf(e), (counts.get(categoryOf(e)) ?? 0) + 1);
  const cats = ["all", ...[...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!)];
  const label = (c: string) =>
    c === "all" ? "All" : c === "aggregate" ? "Aggregate" : (billingLabel(c) ?? c);
  const shown = cat === "all" ? catalog.entries : catalog.entries.filter((e) => categoryOf(e) === cat);
  const cols = useMemo(() => columns(models), [models]);

  return (
    <main className="page">
      <NewsStrip news={news} />
      <h1 className="page-title">Providers</h1>
      <p className="muted">
        {catalog.total} entries — {catalog.entries.filter((e) => e.price_ref).length} with published flagship prices
        {catalog.entries.some((e) => e.seeded) &&
          `, ${catalog.entries.filter((e) => e.seeded).length} of them seeded pending vendor verification`}.
      </p>
      <div className="chip-row" role="group" aria-label="Filter by category">
        {cats.map((c) => (
          <button key={c} className={`chip${cat === c ? " chip-on" : ""}`} onClick={() => setCat(c)}>
            {label(c)} <span className="chip-count">{c === "all" ? catalog.total : counts.get(c)}</span>
          </button>
        ))}
      </div>
      <DataTable
        rows={shown}
        columns={cols}
        rowKey={(e) => e.id}
        detail={(e) => (
          <div className="expand-body">
            {e.desc && <p className="desc">{e.desc}</p>}
            {e.endpoints.length > 0 && (
              <p className="muted">
                {e.endpoints.length} endpoint(s):{" "}
                <span className="mono">
                  {e.endpoints.map((ep) => `${ep.protocol} (${ep.models.length} models)`).join(" · ")}
                </span>
              </p>
            )}
            <p>
              <a
                className="title-link provider-open"
                href={`#/provider/${e.id}`}
                onClick={(ev) => {
                  ev.preventDefault();
                  navigate({ page: "provider", id: e.id });
                }}
              >
                Open {e.name} →
              </a>
            </p>
          </div>
        )}
      />
      {shown.length === 0 && <p className="muted">No provider in this category.</p>}
    </main>
  );
}
