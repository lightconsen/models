/**
 * Loading the dataset over three same-origin fetches.
 *
 * Paths are resolved through Vite's `BASE_URL` (which is `/models/` in this
 * build), so a subpath deployment never breaks the fetch URLs. The shapes are
 * guarded with a minimal assertion before anything renders; `catalog` and
 * `models` failing is fatal (both pages need them), `news` failing is a
 * dismissed banner and nothing more.
 */
import type { Catalog, Dataset, ModelsFile, NewsFile, Manifest } from "./types";

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

export const providerEntry = (catalog: Catalog, id: string) => catalog.entries.find((e) => e.id === id);