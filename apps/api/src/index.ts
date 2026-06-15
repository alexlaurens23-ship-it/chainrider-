import "dotenv/config";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { assertJwtSecretStrength } from "./auth.js";
import { startWindowEngine } from "./windows.js";
import { adminRoutes } from "./routes/admin.js";
import { adminPayoutsRoutes } from "./routes/adminPayouts.js";
import { authRoutes } from "./routes/auth.js";
import { leaderboardsRoutes } from "./routes/leaderboards.js";
import { payoutPoolRoutes } from "./routes/payoutPool.js";
import { payoutsRoutes } from "./routes/payouts.js";
import { runsRoutes } from "./routes/runs.js";
import { statsRoutes } from "./routes/stats.js";
import { mapsRoutes, tracksRoutes } from "./routes/tracks.js";

const PORT = 8787;

async function main(): Promise<void> {
  // Refuse to boot with a blank/weak JWT secret (H2).
  assertJwtSecretStrength();

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  app.get("/api/health", async () => ({ status: "ok" }));

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(statsRoutes, { prefix: "/api/stats" });
  await app.register(mapsRoutes, { prefix: "/api/maps" });
  await app.register(tracksRoutes, { prefix: "/api/tracks" });
  await app.register(runsRoutes, { prefix: "/api/runs" });
  await app.register(leaderboardsRoutes, { prefix: "/api/leaderboards" });
  await app.register(payoutsRoutes, { prefix: "/api/payouts" });
  await app.register(payoutPoolRoutes, { prefix: "/api/payout-pool" });
  await app.register(adminRoutes, { prefix: "/api/admin" });
  await app.register(adminPayoutsRoutes, { prefix: "/api/admin" });

  // Open/close the 30-min UTC payout windows on a cron. SINGLE INSTANCE ONLY.
  startWindowEngine(app);

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
