import type { FastifyPluginAsync } from "fastify";

/** Run submission + server-side re-simulation via @chainrider/physics (cr_runs). */
export const runsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => ({ todo: true }));
};
