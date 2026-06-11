import type { FastifyPluginAsync } from "fastify";

/** Per-track leaderboards built from validated runs only. */
export const leaderboardsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => ({ todo: true }));
};
