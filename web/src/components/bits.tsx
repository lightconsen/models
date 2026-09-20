import type { ReactNode } from "react";
import type { Entry } from "../data/types";
import { currencySymbol, formatPrice, parsePrice } from "../data/pricing";
import { useSettings } from "../settings";

export function Badge({ children, kind }: { children: ReactNode; kind: "tag" | "billing" | "news" }) {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}

export function Rating({ value }: { value: number }) {
  return (
    <span className="rating" title={`rating ${value}`}>
      {"★".repeat(Math.round(value))}
      <span className="rating-num">{value.toFixed(1)}</span>
    </span>
  );
}

const BILLING_LABEL: Record<string, string> = { payg: "PAYG", plan: "Plan", both: "Both", unl: "Unlimited" };

export const billingLabel = (b: string) => BILLING_LABEL[b] ?? b;

/** The flagship's "from ¥X" line, shown on the provider card and detail header. */
export function PriceRefLine({ entry }: { entry: Entry }) {
  const { currency: mode } = useSettings();
  const ref = entry.price_ref;
  if (!ref) {
    return entry.billing === "plan" ? (
      <span className="price-ref price-ref-plan">Plan pricing — page only</span>
    ) : (
      <span className="price-ref-empty">No flagship price published</span>
    );
  }
  const sym = currencySymbol(ref.currency);
  const note = mode === "usd" && ref.currency === "CNY" ? " · converted below" : "";
  return (
    <span className="price-ref">
      {ref.display_name} — {sym}
      {formatPrice(parsePrice(ref.input))} in / {sym}
      {formatPrice(parsePrice(ref.output))} out{note}
    </span>
  );
}