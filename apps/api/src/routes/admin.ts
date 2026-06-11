import type { FastifyPluginAsync } from "fastify";

/** Owner admin panel (ADMIN_KEY-gated): payout review and manual SOL payment marking. */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => ({ todo: true }));
};
