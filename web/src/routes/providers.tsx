import type { Catalog, ModelsFile, NewsFile } from "../data/types";
import { logoUrl } from "../data/api";
import { navigate } from "../routes/router";
import { Badge, PriceRefLine, billingLabel } from "../components/bits";

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
  if (news.news.length === 0) return null;
  return (
    <div className="news-strip">
      {news.news.map((n) => (
        <div key={n.id} className="news-item">
          {n.badge && <Badge kind="news">{n.badge}</Badge>}
          <strong>{n.title}</strong>
          <span className="muted"> — {n.body.slice(0, 120)}</span>
        </div>
      ))}
    </div>
  );
}

export function ProvidersPage({ catalog, news }: { catalog: Catalog; news: NewsFile }) {
  return (
    <main className="page">
      <NewsStrip news={news} />
      <h1 className="page-title">Providers</h1>
      <p className="muted">
        {catalog.total} entries — {catalog.entries.filter((e) => e.price_ref).length} with published flagship prices.
      </p>
      <div className="provider-grid">
        {catalog.entries.map((e) => (
          <ProviderCard key={e.id} entry={e} />
        ))}
      </div>
    </main>
  );
}