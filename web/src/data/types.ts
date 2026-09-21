/**
 * Typed mirrors of the three published JSON files, field for field.
 *
 * `catalog.json` carries the 24 provider entries (with the flagship's `price_ref`
 * and the endpoint model lists); `models.json` the flat 85-row global price
 * table; `news.json` the notices. Prices are **strings everywhere** — sorting
 * and conversion must parse them, never compare them lexically.
 */

export type Currency = "USD" | "CNY";
export type Tag = "official" | "aggregate";
export type Billing = "payg" | "plan" | "both";

/** A row's top-level rates. The wire shape of both catalog `price_ref` and
    models.json rows names them **input/output** (not in/out — conflating the
    two made every flagship and every price column render 0). */
export interface RateBand {
  input: string;
  output: string;
  cache_read?: string;
  cache_creation?: string;
}

/** The tier bands nested inside a row use the *other* naming — in/out. This is
    a genuine second shape in the same JSON, not a typo: generate.mjs spreads
    the source `long_context` / `off_peak` objects verbatim, and the entries
    store those as in/out. */
export interface NestedBand {
  in: string;
  out: string;
  cache_read?: string;
  cache_creation?: string;
}

export interface PeakWindow {
  days: string[];
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface PeakHours {
  tz_offset: number; // minutes east of UTC
  windows: PeakWindow[];
}

/** Rates that apply once input exceeds `over` tokens on a single request. */
export interface LongContext extends NestedBand {
  over: number;
}

export interface Endpoint {
  protocol: string; // "openai" | "anthropic" | "gemini"
  endpoint: string;
  models: string[]; // upstream strings, not canonical model ids
}

/** The flagship's rates, projected onto the catalog entry so the list page
    needs no second request to show a "from ¥X" line.
    NOTE: the catalog names these *input/output*, unlike models.json rows which
    use in/out — mirroring the wire shape here is what keeps the two from being
    confused, and confusing them renders every flagship price as 0. */
/** The flagship's rates, projected onto the catalog entry so the list page
    needs no second request to show a "from ¥X" line. */
export interface PriceRef extends RateBand {
  model_id: string;
  display_name: string;
  currency: Currency;
  off_peak?: NestedBand;
  peak_hours?: PeakHours;
  long_context?: LongContext;
}

export interface Entry {
  id: string;
  name: string;
  website: string;
  tag: Tag;
  rating: number;
  billing: Billing;
  currency: Currency;
  endpoints: Endpoint[];
  logo: string; // "logos/<id>.<ext>"
  desc?: string;
  plan_query?: { template: string };
  price_ref?: PriceRef;
  /** The day the fetcher last wrote this entry's price rows (YYYY-MM-DD).
      Maintained by fetch-all; hand-edited entries may omit it. */
  prices_as_of?: string;
}

export interface Catalog {
  total: number;
  entries: Entry[];
}

export interface PriceRow extends RateBand {
  provider_id: string;
  model_id: string;
  display_name: string;
  currency: Currency;
  off_peak?: NestedBand;
  peak_hours?: PeakHours;
  long_context?: LongContext;
}

export interface ModelsFile {
  version: number;
  exchange_rates: Record<Currency, number>;
  generated_at: string; // YYYY-MM-DD
  models: PriceRow[];
}

export interface NewsItem {
  id: string;
  kind: "new_model" | "free" | "discount" | "announce";
  provider_id: string;
  model_id: string;
  released: string; // YYYY-MM-DD
  title: string;
  body: string;
  badge?: string;
  priority?: number;
  expires_at?: string;
  url?: string;
}

export interface NewsFile {
  news: NewsItem[];
}

export interface Manifest {
  generated_at: string;
  catalog: { count: number; sha256: string };
  models: { version: number; sha256: string };
  news: { count: number; sha256: string };
}

export interface Dataset {
  catalog: Catalog;
  models: ModelsFile;
  news: NewsFile;
  manifest: Manifest;
}