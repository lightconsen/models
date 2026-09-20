import { currencySymbol, formatPrice, parsePrice, describePeak } from "../data/pricing";
import type { PriceRow } from "../data/types";
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
    </div>
  );
}