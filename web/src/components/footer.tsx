import type { Manifest } from "../data/types";

export function Footer({ manifest }: { manifest: Manifest }) {
  const m = manifest?.models ?? { version: 0, sha256: "" };
  return (
    <footer className="footer">
      <span>
        data as of {manifest?.generated_at ? manifest.generated_at.slice(0, 10) : "—"} · v{m.version} · catalog{" "}
        {manifest?.catalog?.count ?? 0} / models {manifest?.models?.version ?? 0}
      </span>
      <span className="mono muted">{manifest?.models?.sha256 ? `sha ${manifest.models.sha256.slice(0, 12)}` : ""}</span>
    </footer>
  );
}