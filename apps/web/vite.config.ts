import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
