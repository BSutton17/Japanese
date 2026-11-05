import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // One .env.local at the repo root. Only the listed prefixes ever reach the browser.
  envDir: "..",
  envPrefix: ["VITE_", "GOOGLE_CLIENT_ID"],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://localhost:8787" },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png"],
      manifest: {
        name: "Japanese Tutor",
        short_name: "Tutor",
        description: "A personal Japanese tutor",
        theme_color: "#1f1b16",
        background_color: "#1f1b16",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Progress must always come from the server, never a stale cached response.
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
});
