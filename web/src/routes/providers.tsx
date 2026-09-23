import { useState } from "react";
import type { Catalog, ModelsFile, NewsFile } from "../data/types";
import { logoUrl } from "../data/api";
import { navigate } from "../routes/router";
import { Badge, PriceRefLine, billingLabel } from "../components/bits";
import { useDismissedNews } from "../components/dismissNews";

function ProviderCard({ entry }: { entry: Catalog["entries"][number] }) {
  return (
    <div className="provider-card" onClick={() => navigate({ page: "provider", id: entry.id })}>
      <div className="provider-card-top">
        <img className="provider-logo" src={logoUrl(entry.logo)} alt="" loading="lazy" />
        <div className="provider-card-title">
          <h3>{entry.name}</h3>
          <span className="mono muted">{entry.id}</span>
        </div>
        <div className="provider-card-badges">
          {entry.tag === "aggregate" && <Badge kind="tag">Aggregate</Badge>}
          {entry.tag === "official" && <Badge kind="tag">Official</Badge>}
          <Badge kind="billing">{billingLabel(entry.billing)}</Badge>
          {entry.seeded && (
            <Badge kind="seeded" >
              <span title="Prices seeded from a third-party database — not yet verified against the vendor">Seeded</span>
            </Badge>
          )}
        </div>
      </div>
      <p className="desc">{entry.desc ?? ""}</p>
      <div className="provider-card-bottom">
        <PriceRefLine entry={entry} />
      </div>
    </div>
  );
}

function NewsStrip({ news }: { news: NewsFile }) {
  const { isDismissed, dismiss } = useDismissedNews();
  const items = news.news.filter((n) => !isDismissed(n.id));
  if (items.length === 0) return null;
  return (
    <div className="news-strip">
      {items.map((n) => (
        <div key={n.id} className="news-item">
          {n.badge && <Badge kind="news">{n.badge}</Badge>}
          <strong>{n.title}</strong>
          <span className="muted"> — {n.body.slice(0, 120)}</span>
          <button className="news-close" aria-label="dismiss notice" onClick={() => dismiss(n.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

/** The categories a reader actually sorts providers into: what the vendor
    sells at that address (the badge the card shows), plus the one reseller.
    Built from the data so a tag the catalogue gains later appears on its own. */
const categoryOf = (e: Catalog["entries"][number]) => (e.tag === "aggregate" ? "aggregate" : e.billing);

export function ProvidersPage({ catalog, news }: { catalog: Catalog; news: NewsFile }) {
  const [cat, setCat] = useState("all");
  const counts = new Map<string, number>();
  for (const e of catalog.entries) counts.set(categoryOf(e), (counts.get(categoryOf(e)) ?? 0) + 1);
  const cats = ["all", ...[...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!)];
  const label = (c: string) =>
    c === "all" ? "All" : c === "aggregate" ? "Aggregate" : (billingLabel(c) ?? c);
  const shown = cat === "all" ? catalog.entries : catalog.entries.filter((e) => categoryOf(e) === cat);

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
      <div className="provider-grid">
        {shown.map((e) => (
          <ProviderCard key={e.id} entry={e} />
        ))}
      </div>
      {shown.length === 0 && <p className="muted">No provider in this category.</p>}
    </main>
  );
}
