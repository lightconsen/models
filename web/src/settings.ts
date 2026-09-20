import { createContext, useContext } from "react";

export type ThemeMode = "auto" | "light" | "dark";
/** "native" shows each row's own currency; "usd" converts CNY rows to USD. */
export type CurrencyMode = "native" | "usd";

export interface Settings {
  theme: ThemeMode;
  currency: CurrencyMode;
  /** 1 CNY in USD, from models.json's own rates (today 1/7.1). */
  unitRateCny: number;
  setTheme: (t: ThemeMode) => void;
  setCurrency: (c: CurrencyMode) => void;
  toggleSearch: () => void;
}

export const SettingsProvider = createContext<Settings | null>(null);

export const useSettings = (): Settings => {
  const s = useContext(SettingsProvider);
  if (!s) throw new Error("useSettings outside SettingsProvider");
  return s;
};