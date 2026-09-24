#!/usr/bin/env node
/**
 * Bridge the data repo's build output into the web app.
 *
 * The catalogue lives in ../dist (produced by the data repo's own zero-dependency
 * build, `node scripts/generate.mjs`) and is gitignored there. This copies the
 * four published JSON artifacts plus the logo directory into `public/data/`,
 * which Vite serves verbatim in dev and copies into the build output — one
 * mechanism covers both paths. `dist/promos.json` is a stale leftover of an old
 * layout that generate.mjs neither writes nor cleans, so it is deliberately not
 * copied and not referenced.
 *
 * Run automatically by the `predev` / `prebuild` hooks. Fails with a clear
 * message (not a confusing 404 in a fetch) when the data has not been built —
 * that is the normal state of a fresh clone.
 */
import { cpSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRepo = path.resolve(web, "..");
const src = path.join(dataRepo, "dist");
const dst = path.join(web, "public", "data");

const JSON_FILES = ["catalog.json", "models.json", "news.json", "manifest.json"];

if (!existsSync(path.join(src, "catalog.json"))) {
  console.error(`✗ ${path.join(src, "catalog.json")} is missing.`);
  console.error("  Run `node scripts/generate.mjs` in the data repo first (fresh clones have no dist/).");
  process.exit(1);
}

// Stale logos would live forever: a logo that changed extension (svg → webp,
// say) would leave the old file here while the catalog points at the new one,
// and both would ship. The directory is fully rebuilt every stage.
rmSync(path.join(dst, "logos"), { recursive: true, force: true });
mkdirSync(path.join(dst, "logos"), { recursive: true });
// Same for the price archive: an old dist/ carries versions the new build no
// longer emitted (a rewound version, a pruned archive), and both would ship.
rmSync(path.join(dst, "history"), { recursive: true, force: true });
for (const f of JSON_FILES) cpSync(path.join(src, f), path.join(dst, f));
for (const f of readdirSync(path.join(src, "logos"))) {
  cpSync(path.join(src, "logos", f), path.join(dst, "logos", f));
}
if (existsSync(path.join(src, "history"))) {
  cpSync(path.join(src, "history"), path.join(dst, "history"), { recursive: true });
}
console.log(`✓ staged ${JSON_FILES.length} data files + logos/ → web/public/data/`);