import type { FastifyPluginAsync } from "fastify";

/** 30-minute UTC-aligned payout windows (cr_payout_windows), paid manually by the owner. */
export const payoutsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => ({ todo: true }));
};
