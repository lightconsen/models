import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The site lives at https://models.kiwano.cc — a custom domain served from
// the root, so assets live at `/` and the old /models/ subpath is gone with the
// `github.io` URL. `base` stays a single knob here; data fetches resolve it via
// `import.meta.env.BASE_URL`.
export default defineConfig({
  base: "/",
  plugins: [react()],
  build: {
    outDir: "dist",
    assetsInlineLimit: 0,
  },
});