import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The site lives at https://<owner>.github.io/models/ — the repo is literally
// named `models`. `base` must match the repository name exactly; renaming the
// repo breaks the URL. Data fetches go through `import.meta.env.BASE_URL` to
// stay on this path without hardcoding it there too.
export default defineConfig({
  base: "/models/",
  plugins: [react()],
  build: {
    outDir: "dist",
    assetsInlineLimit: 0,
  },
});