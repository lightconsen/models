import { useEffect, useState } from "react";
import { currencySymbol, formatPrice, parsePrice, describePeak } from "../data/pricing";
import type { PriceRow } from "../data/types";
import { loadPriceHistory, type HistoryPoint } from "../data/api";
import { useSettings } from "../settings";

/**
 * One price cell. In "usd" display mode a CNY figure converts using the rate the
 * Settings carry (loaded from models.json, never hardcoded); converted cells
 * lead with "≈" and the raw vendor string stays in the title either way.
 */
export function PriceCell({ value, raw, currency }: { value: string; raw: string; currency: string }) {
  const { currency: mode, unitRateCny } = useSettings();
  const n = parsePrice(value);
  const convert = mode === "usd" && currency === "CNY";
  return (
    <span className={convert ? "price-converted" : ""} title={`${currency} ${raw}`}>
      {convert && "≈"}
      {currencySymbol(convert ? "USD" : currency)}
      {formatPrice(convert ? n * unitRateCny : n)}
    </span>
  );
}

/** The expandable body under a price row. */
export function ExpandableDetail({ row }: { row: PriceRow }) {
  return (
    <div className="expand-body">
      {row.long_context && (
        <p>
          <span className="mono">
            &gt;{formatPrice(row.long_context.over)} input tokens: {currencySymbol(row.currency)}
            {formatPrice(parsePrice(row.long_context.in))} in / {currencySymbol(row.currency)}
            {formatPrice(parsePrice(row.long_context.out))} out
            {row.long_context.cache_read ? ` · cache read ${currencySymbol(row.currency)}${formatPrice(parsePrice(row.long_context.cache_read))}` : ""}
          </span>
          <span className="muted"> — applies above {formatPrice(row.long_context.over)} input tokens</span>
        </p>
      )}
      {row.peak_hours && (
        <p>
          <span className="mono">{describePeak(row.peak_hours)}</span>
          <span className="muted"> — the listed rates are the peak ones</span>
        </p>
      )}
      {row.off_peak && !row.peak_hours && (
        <p>
          <span className="mono">
            In {formatPrice(parsePrice(row.off_peak.in))} / Out {formatPrice(parsePrice(row.off_peak.out))}
          </span>
          <span className="muted"> — off-peak rates</span>
        </p>
      )}
      {!row.long_context && !row.peak_hours && !row.off_peak && (
        <p className="muted">No tiering published for this row.</p>
      )}
      <PriceHistory row={row} />
    </div>
  );
}
/** One archived price, drawn as a point on a text-first timeline. A version
    whose row changed from the previous point gets the delta beside it. */
function HistoryRow({ p, prev, currency }: { p: HistoryPoint; prev?: HistoryPoint; currency: string }) {
  const delta = (field: "input" | "output") => {
    if (!prev) return null;
    const a = parsePrice(prev[field]);
    const b = parsePrice(p[field]);
    if (a === b) return <span className="muted"> ·</span>;
    const pct = a === 0 ? null : Math.round(((Number(p[field]) - a) / a) * 100);
    const arrow = Number(p[field]) > a ? "↑" : "↓";
    return (
      <span className={Number(p[field]) > a ? "cap-no" : "cap-yes"}>
        {" "}
        {arrow} {pct !== null ? `${Math.abs(pct)}%` : ""}
      </span>
    );
  };
  const s = currencySymbol(currency);
  return (
    <p>
      <span className="mono">v{p.version}</span>
      <span className="muted"> · {p.date} · </span>
      <span className="mono">
        {s}
        {formatPrice(parsePrice(p.input))} in / {s}
        {formatPrice(parsePrice(p.output))} out
        {p.cache_read ? ` / ${s}${formatPrice(parsePrice(p.cache_read))} cache` : ""}
      </span>
      {delta("input")}
      {delta("output")}
    </p>
  );
}

/** The price timeline under an expanded row. Nothing fetches until the row is
    opened, and only distinct-sha versions are read — the archive fetches one
    full table per version, so the loader dedupes by sha and skips unchanged
    ones on sight. An empty result says so plainly: either the archive has not
    started yet or this model is priced only in the current table. */
export function PriceHistory({ row }: { row: PriceRow }) {
  const [points, setPoints] = useState<HistoryPoint[] | null>(null);
  useEffect(() => {
    let live = true;
    loadPriceHistory(row.provider_id, row.model_id).then((pts) => {
      if (live) setPoints(pts);
    });
    return () => {
      live = false;
    };
  }, [row.provider_id, row.model_id]);

  if (points === null) {
    return (
      <p className="muted price-history">
        Price history: loading…
      </p>
    );
  }
  if (points.length <= 1) {
    return (
      <p className="muted price-history">
        {points.length === 0
          ? "No price history yet — this row is priced only in the current table."
          : `One archived price (v${points[0].version}, ${points[0].date}) — the archive starts here.`}
      </p>
    );
  }
  return (
    <div className="price-history">
      <p className="muted">Price history — one line per change (identical tables skipped):</p>
      {points.map((p, i) => (
        <HistoryRow key={p.version} p={p} prev={points[i - 1]} currency={row.currency} />
      ))}
    </div>
  );
}
