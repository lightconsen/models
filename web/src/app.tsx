import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "./components/header";
import { Footer } from "./components/footer";
import { SearchOverlay } from "./components/searchOverlay";
import { ProviderDetailPage } from "./routes/provider";
import { ProvidersPage } from "./routes/providers";
import { ModelsPage } from "./routes/models";
import { useRoute } from "./routes/router";
import { LoadError, loadData } from "./data/api";
import { SettingsProvider, type CurrencyMode, type ThemeMode } from "./settings";
import type { Dataset } from "./data/types";

const LS_THEME = "kiwano.theme";
const LS_CURRENCY = "kiwano.currency";

function applyTheme(theme: ThemeMode) {
  const el = document.documentElement;
  el.dataset.theme = theme === "light" ? "light" : "dark";
  if (theme === "auto") delete el.dataset.theme; // CSS follow prefers-color-scheme
}

export function App() {
  const route = useRoute();
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem(LS_THEME) as ThemeMode) || "auto");
  const [currency, setCurrency] = useState<CurrencyMode>(() => (localStorage.getItem(LS_CURRENCY) as CurrencyMode) || "native");

  useEffect(() => {
    loadData()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof LoadError ? e.message : String(e)));
  }, [reload]);

  useEffect(() => {
    localStorage.setItem(LS_THEME, theme);
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(LS_CURRENCY, currency);
  }, [currency]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleSearch = useCallback(() => setSearchOpen((v) => !v), []);

  const value = useMemo(
    () => ({
      theme,
      currency,
      unitRateCny: data ? 1 / (data.models.exchange_rates["CNY"] ?? 7.1) : 0,
      setTheme,
      setCurrency,
      toggleSearch,
    }),
    [theme, currency, data, toggleSearch],
  );

  return (
    <SettingsProvider.Provider value={value}>
      <Header />
      {error && !data ? (
        <main className="page error-page">
          <h1 className="page-title">Could not load the catalogue</h1>
          <p className="mono">{error}</p>
          <button className="btn" onClick={() => setReload((n) => n + 1)}>
            Retry
          </button>
        </main>
      ) : !data ? (
        <main className="page"><p className="muted">Loading…</p></main>
      ) : (
        <>
          {route.page === "providers" && <ProvidersPage catalog={data.catalog} news={data.news} />}
          {route.page === "models" && <ModelsPage catalog={data.catalog} models={data.models} />}
          {route.page === "provider" && <ProviderDetailPage catalog={data.catalog} models={data.models} news={data.news} id={route.id} />}
          <Footer manifest={data.manifest} />
        </>
      )}
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} catalog={data?.catalog ?? { total: 0, entries: [] }} models={data?.models ?? { version: 0, exchange_rates: { USD: 1, CNY: 7.1 }, generated_at: "" } as never} />
    </SettingsProvider.Provider>
  );
}