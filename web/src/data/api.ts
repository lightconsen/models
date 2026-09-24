/**
 * Loading the dataset over three same-origin fetches.
 *
 * Paths are resolved through Vite's `BASE_URL` (which is `/models/` in this
 * build), so a subpath deployment never breaks the fetch URLs. The shapes are
 * guarded with a minimal assertion before anything renders; `catalog` and
 * `models` failing is fatal (both pages need them), `news` failing is a
 * dismissed banner and nothing more.
 */
import type { ArchiveVersion, Catalog, Dataset, ModelsFile, NewsFile, Manifest, PriceArchive } from "./types";

const BASE = import.meta.env.BASE_URL; // "/models/"

const dataUrl = (f: string) => `${BASE}data/${f}`;

const isObj = (o: unknown): o is Record<string, unknown> => typeof o === "object" && o !== null;

const guard = {
  catalog: (o: unknown): o is Catalog => isObj(o) && Array.isArray(o.entries),
  models: (o: unknown): o is ModelsFile => isObj(o) && Array.isArray(o.models),
  news: (o: unknown): o is NewsFile => isObj(o) && Array.isArray(o.news),
  manifest: (o: unknown): o is Manifest => isObj(o) && o.generated_at !== undefined,
};

export class LoadError extends Error {}

const fetchJson = async <T>(f: string): Promise<T> => {
  const res = await fetch(dataUrl(f), { cache: "no-store" });
  if (!res.ok) throw new LoadError(`${f}: HTTP ${res.status}`);
  return (await res.json()) as T;
};

export async function loadData(): Promise<Dataset> {
  const [catalog, models, newsRaw, manifestRaw] = await Promise.all([
    fetchJson<unknown>("catalog.json").then((body) => {
      if (!guard.catalog(body)) throw new LoadError("catalog.json did not match the expected shape");
      return body;
    }),
    fetchJson<unknown>("models.json").then((body) => {
      if (!guard.models(body)) throw new LoadError("models.json did not match the expected shape");
      return body;
    }),
    fetchJson<unknown>("news.json").catch(() => null),
    fetchJson<unknown>("manifest.json").catch(() => null),
  ]);

  return {
    catalog,
    models,
    news: guard.news(newsRaw) ? newsRaw : { news: [] },
    manifest: guard.manifest(manifestRaw)
      ? manifestRaw
      : ({ generated_at: "", catalog: { count: 0, sha256: "" }, models: { version: 0, sha256: "" }, news: { count: 0, sha256: "" } } as Manifest),
  };
}

/** Provider rows + entries paired for the pages that need both. */
export const modelsByProvider = (models: ModelsFile, providerId: string) =>
  models.models.filter((r) => r.provider_id === providerId);

/** A logo's real URL. The catalog carries `logos/<id>.<ext>` relative to the
    data directory, so the fetch path is `<base>/data/logos/…` — skipping the
    `data/` segment 404s every card image (which it did, live, 24 times). */
export const logoUrl = (logo: string): string => `${BASE}data/${logo}`;

export const providerEntry = (catalog: Catalog, id: string) => catalog.entries.find((e) => e.id === id);
/**
 * The price archive, loaded lazily: dist/history/archive.json is small, but
 * every per-version models.json is a full table (~1.5MB), so nothing is
 * fetched until a viewer asks for a model's history — and then only the
 * versions whose sha differs from what is already in hand. A sha repeat (a
 * version bump that moved no price) is skipped on sight.
 */
let archivePromise: Promise<PriceArchive | null> | null = null;

export const loadArchiveIndex = (): Promise<PriceArchive | null> => {
  archivePromise ??= fetchJson<unknown>("history/archive.json")
    .then((body) => (isObj(body) && isObj(body.versions) ? (body as unknown as PriceArchive) : null))
    .catch(() => null);
  return archivePromise;
};

export interface HistoryPoint {
  version: number;
  date: string;
  input: string;
  output: string;
  cache_read?: string;
}

/** The price timeline of one (provider, model) pair, oldest first. Rows the
    versions do not carry (a model added after v53) simply start later — the
    curve shows the span it has. */
export async function loadPriceHistory(providerId: string, modelId: string): Promise<HistoryPoint[]> {
  const archive = await loadArchiveIndex();
  if (!archive) return [];
  const versions = Object.entries(archive.versions)
    .map(([v, e]) => ({ version: Number(v), ...e }) as ArchiveVersion)
    .sort((a, b) => a.version - b.version);
  const seen = new Set<string>();
  const points: HistoryPoint[] = [];
  // Fetches run one at a time: versions arrive in order and each response is
  // big, so parallelism would only multiply the bytes on a slow day.
  for (const v of versions) {
    if (seen.has(v.sha256)) continue;
    seen.add(v.sha256);
    try {
      const file = await fetchJson<ModelsFile>(`history/${v.version}/models.json`);
      const row = file.models.find((r) => r.provider_id === providerId && r.model_id === modelId);
      if (row) points.push({ version: v.version, date: v.generated_at, input: row.input, output: row.output, cache_read: row.cache_read });
    } catch {
      // A version that never landed (an old bucket, a pruned archive) is a gap
      // in the line, not an error — the curve shows what it has.
    }
  }
  return points;
}
