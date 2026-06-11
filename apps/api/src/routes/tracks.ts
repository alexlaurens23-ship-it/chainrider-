import type { FastifyPluginAsync } from "fastify";

/** Frozen, versioned tracks (cr_tracks). Active tracks are never mutated in place. */
export const tracksRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => ({ todo: true }));
};
