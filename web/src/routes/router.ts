/**
 * A hand-rolled hash router — small enough that pulling react-router in for
 * three routes would be worse than writing the handful of switches it does.
 *
 * Hash routing also happens to be the right choice for GitHub Pages, which
 * cannot rewrite arbitrary paths to /index.html: `#/provider/x` never leaves
 * the browser, so deep links and refresh both work.
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

const read = () => parse(location.hash);

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  const poll = setInterval(cb, 500);
  return () => {
    window.removeEventListener("hashchange", cb);
    clearInterval(poll);
  };
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