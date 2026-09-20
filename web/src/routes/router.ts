/**
 * A hand-rolled hash router — small enough that pulling react-router in for
 * three routes would be worse than writing the handful of switches it does.
 *
 * Hash routing also happens to be the right choice for GitHub Pages, which
 * cannot rewrite arbitrary paths to /index.html: `#/provider/x` never leaves
 * the browser, so deep links and refresh both work.
 *
 * **The snapshot must be a stable reference.** `useSyncExternalStore` re-renders
 * when `getSnapshot` returns a different object — a fresh `{page:"providers"}`
 * per call is per-render a new value, so React re-renders forever and dies with
 * error #185. The parsed route is cached per hash and re-parsed only when the
 * hash actually changes.
 */
import { useEffect, useSyncExternalStore } from "react";

export type Route =
  | { page: "providers" }
  | { page: "models" }
  | { page: "provider"; id: string };

const parse = (hash: string): Route => {
  const h = hash.startsWith("#/") ? hash.slice(2) : hash.slice(1);
  if (h === "" || h === "/") return { page: "providers" };
  if (h.startsWith("provider/")) return { page: "provider", id: h.slice("provider/".length) };
  if (h === "models") return { page: "models" };
  return { page: "providers" };
};

let cache: { hash: string; route: Route } | null = null;

const read = (): Route => {
  if (!cache || cache.hash !== location.hash) {
    cache = { hash: location.hash, route: parse(location.hash) };
  }
  return cache.route;
};

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

export const navigate = (r: Route) => {
  const h = r.page === "providers" ? "#/" : r.page === "models" ? "#/models" : `#/provider/${r.id}`;
  if (location.hash !== h) location.hash = h;
};

export const useRoute = (): Route => {
  const route = useSyncExternalStore(subscribe, read, read);
  useEffect(() => {
    document.title =
      route.page === "providers"
        ? "models — Kiwano Hub providers"
        : route.page === "models"
          ? "models — all prices"
          : `models — ${route.id}`;
  }, [route]);
  return route;
};