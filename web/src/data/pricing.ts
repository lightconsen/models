/**
 * Price parsing, formatting and conversion — the small helpers every table cell
 * and the currency toggle lean on.
 *
 * All prices arrive as strings, and the vendor precision varies wildly: `"2.50"`,
 * `"8.1"`, `"0.0416666666666667"` (an OpenRouter cache rate). The raw string is
 * always kept as the cell's `title`, so the exact vendor figure is one hover
 * away no matter how we round when rendering.
 */

export type CurrencyMode = "native" | "USD";

export const parsePrice = (s: string): number => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/** Present one of the catalogue's decimal price strings the way a human reads it:
    two decimals above 1, up to three below, trailing zeros stripped. */
export const formatPrice = (n: number): string => {
  if (n === 0) return "0";
  const s = n < 1 ? n.toFixed(3) : n.toFixed(2);
  return s.replace(/\.?0+$/, "");
};

export const currencySymbol = (c: string): string => (c === "CNY" ? "¥" : "$");

/**
 * Turn a native amount into its USD equivalent when the toggle asks for it.
 * The rate comes from models.json's own `exchange_rates`, never hardcoded —
 * `CNY ÷ 7.1` today, whatever `models.json` says tomorrow.
 */
export const toUsd = (native: number, rates: Record<string, number>): number => {
  const r = rates["CNY"];
  return r && r > 0 ? native / r : native;
};

/** 200000 -> "200K", 272000 -> "272K", 524288 -> "512K". */
export const formatOver = (n: number): string => {
  if (n >= 1_000_000) return `${formatPrice(n / 1_000_000)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
};

/** Compress a capability token count the way it is read, while keeping the
    vendor's own precision: clean decimal thousands become K/M ("128K",
    "1.02M"), and everything else — the 2^n windows several vendors state —
    stays an exact grouped number, so OpenAI's 1,050,000 and Google's
    1,048,576 never render as the same string. */
export const formatTokens = (n: number): string => {
  if (n % 1_000_000 === 0) return `${n / 1_000_000}M`;
  if (n % 1000 === 0) return n >= 1_000_000 ? `${formatPrice(n / 1_000_000)}M` : `${n / 1000}K`;
  return n.toLocaleString("en-US");
};

const DAYS: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

/** A peak_hours schedule as prose: "Mon–Fri 09:00–12:00, 14:00–18:00 · UTC+8". */
export const describePeak = (ph: { tz_offset: number; windows: { days: string[]; start: string; end: string }[] }): string => {
  const tz = ph.tz_offset / 60;
  const name = ph.windows.map((w) => {
    const ds = w.days.map((d) => DAYS[d] ?? d);
    const first = ds[0] ?? "?";
    const last = ds[ds.length - 1] ?? first;
    const range = ds.length > 1 ? `${first}–${last}` : first;
    return `${range} ${w.start}–${w.end}`;
  });
  return `${name.join(", ")} · UTC${tz >= 0 ? "+" : ""}${tz}`;
};

/** A long_context band as one line: ">200K input tokens: $4.00 in / $18.00 out". */
export const longContextLine = (lc: { over: number; in: string; out: string; cache_read?: string }): string =>
  `>${formatOver(lc.over)} input tokens: ${formatPrice(parsePrice(lc.in))} in / ${formatPrice(parsePrice(lc.out))} out` +
  (lc.cache_read ? ` · cache read ${formatPrice(parsePrice(lc.cache_read))}` : "");

export const modelKey = (row: { provider_id: string; model_id: string }): string =>
  `${row.provider_id}/${row.model_id}`;