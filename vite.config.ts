import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { execFileSync } from "node:child_process";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: false,
      },
      includeAssets: ["*.sf3.gz", "*.svg"],
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /.*\.(?:woff2?)$/,
            handler: "CacheFirst",
          },
        ],
      },
      manifest: {
        name: "SmileMML",
        short_name: "SmileMML",
        description:
          "ブラウザ上で動作する MML プレイヤー・ビジュアライザーです。",
        theme_color: "#000000",
        background_color: "#000000",
        icons: [
          {
            src: "favicon-white-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "favicon-white-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
        ],
      },
    }),
  ],
  build: {
    license: { fileName: "third-party-licenses.json" },
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              test: /node_modules/,
              name: "libs",
            },
          ],
        },
      },
    },
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
    _BUILD_DATE_: JSON.stringify(new Date()),
  },
});
