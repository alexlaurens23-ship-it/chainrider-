import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5180,
    strictPort: true, // 5173 belongs to another project on this machine; never fall back
    // Listen on all interfaces so a tunnel (cloudflared/ngrok) can reach the dev
    // server, and accept the tunnel's Host header — Vite rejects unknown hosts by
    // default, which is the #1 thing that breaks tunneling.
    host: true,
    allowedHosts: [".trycloudflare.com", ".ngrok-free.app", "localhost"],
    proxy: {
      // Same-origin API in dev (and behind the tunnel): /api → local Fastify.
      "/api": "http://localhost:8787",
    },
    // NOTE: HMR's websocket may fail to connect over a tunnel (wss host mismatch).
    // That's non-blocking — the page still loads and is fine for testing; just
    // refresh manually after edits. Left at the default rather than hard-wiring a
    // tunnel-specific clientPort.
  },
});
