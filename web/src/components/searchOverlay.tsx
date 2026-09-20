import { useEffect, useMemo, useRef, useState } from "react";
import type { Catalog, ModelsFile } from "../data/types";
import { navigate } from "../routes/router";

/**
 * The Ctrl-K / ⌘K finder. A single in-memory index over entries and models —
 * the dataset is small (24 entries + 85 rows), so no server-side search is
 * needed. Arrow keys select, Enter opens, Esc closes.
 */
interface Hit {
  kind: "provider" | "model";
  title: string;
  sub: string;
  logo?: string;
}

export function SearchOverlay({
  open,
  onClose,
  catalog,
  models,
}: {
  open: boolean;
  onClose: () => void;
  catalog: Catalog;
  models: ModelsFile;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo<Hit[]>(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    const out: Hit[] = [];
    for (const e of catalog.entries) {
      if (e.name.toLowerCase().includes(query) || e.id.toLowerCase().includes(query)) {
        out.push({ kind: "provider", title: e.name, sub: e.id, logo: e.logo });
      }
    }
    for (const r of models.models) {
      if (r.model_id.toLowerCase().includes(query) || r.display_name.toLowerCase().includes(query)) {
        out.push({ kind: "model", title: r.display_name, sub: `${r.provider_id}/${r.model_id}` });
      }
    }
    return out.slice(0, 40);
  }, [q, catalog, models]);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const pick = (h: Hit) => {
    onClose();
    if (h.kind === "provider") navigate({ page: "provider", id: h.sub });
    else {
      const [pid] = h.sub.split("/");
      navigate({ page: "provider", id: pid });
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") setSel((s) => Math.min(s + 1, hits.length - 1));
    else if (e.key === "ArrowUp") setSel((s) => Math.max(s - 1, 0));
    else if (e.key === "Enter" && hits[sel]) pick(hits[sel]);
  };

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="overlay-input"
          placeholder="Search models, providers…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKey}
        />
        <ul className="overlay-results">
          {hits.length === 0 && <li className="muted">No matches.</li>}
          {hits.map((h, i) => (
            <li key={`${h.kind}:${h.sub}`} className={i === sel ? "selected" : ""} onMouseEnter={() => setSel(i)} onClick={() => pick(h)}>
              <span className="overlay-kind">{h.kind === "provider" ? "P" : "M"}</span>
              <span className="overlay-title">{h.title}</span>
              <span className="mono muted">{h.sub}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}