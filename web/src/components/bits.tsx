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

/** The vendor's own site — the address a reader follows to see who they are
    dealing with, which is the whole of what the field is for.
 *
 * The label drops the scheme and a leading `www.`, because a reader needs to
 * know where the link goes and not that it is https; whatever path the entry
 * carries is kept, so `cloud.baidu.com/product/s/qianfan_home` still says which
 * product it names. `website` is validated as an http(s) URL in the data repo,
 * so nothing is defended against here — a website that is not one is a data
 * problem, and labelling it more cleverly would only hide it. */
export function SiteLink({ url }: { url: string }) {
  const label = url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  return (
    <a className="site-link" href={url} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

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
      {formatPrice(parsePrice(ref.output))} out per 1M tokens{note}
    </span>
  );
}