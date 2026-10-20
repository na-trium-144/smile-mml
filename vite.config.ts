import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { execFileSync } from "node:child_process";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    license: { fileName: "third-party-licenses.json" },
  },
  define: {
    _GIT_COMMIT_: JSON.stringify(
      execFileSync("git", ["rev-parse", "--short", "HEAD"], {
        encoding: "utf8",
      }).trim(),
    ),
    _GIT_COMMIT_COUNT_: JSON.stringify(
      execFileSync("git", ["rev-list", "--count", "HEAD"], {
        encoding: "utf8",
      }).trim(),
    ),
  },
});
