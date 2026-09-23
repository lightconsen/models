import { navigate, useRoute } from "../routes/router";
import { useSettings } from "../settings";

export function Header() {
  const route = useRoute();
  const { currency, setCurrency, theme, setTheme, toggleSearch } = useSettings();
  return (
    <header className="header">
      <div className="header-inner">
        <a className="brand" onClick={() => navigate({ page: "providers" })}>
          <img className="brand-mark" src={import.meta.env.BASE_URL + "logo.svg"} alt="" />
          <span className="brand-text">models</span>
          <span className="brand-sub">Kiwano Hub · providers and prices</span>
        </a>
        <nav className="nav">
          <a className={`nav-link${route.page === "providers" ? " active" : ""}`} onClick={() => navigate({ page: "providers" })}>
            Providers
          </a>
          <a className={`nav-link${route.page === "models" ? " active" : ""}`} onClick={() => navigate({ page: "models" })}>
            Models
          </a>
        </nav>
        <div className="header-actions">
          <button className="btn" onClick={toggleSearch} title="Search providers and models (⌘K)">
            Search <kbd>⌘K</kbd>
          </button>
          <a
            className="btn"
            href="https://github.com/lightconsen/models"
            target="_blank"
            rel="noopener noreferrer"
            title="The data repo — every price cites its vendor page"
          >
            GitHub
          </a>
          <label className="seg" title="Display currency">
            <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value as "native" | "usd")}>
              <option value="native">Native</option>
              <option value="usd">USD</option>
            </select>
          </label>
          <label className="seg" title="Theme">
            <select name="theme" value={theme} onChange={(e) => setTheme(e.target.value as "auto" | "light" | "dark")}>
              <option value="auto">Auto</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </div>
    </header>
  );
}