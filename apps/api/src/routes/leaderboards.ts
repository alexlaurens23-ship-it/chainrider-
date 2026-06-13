import type { FastifyPluginAsync } from "fastify";

const ID_PATTERN = "^[0-9]+$";

/** Per-track leaderboards built from validated runs only. */
export const leaderboardsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => ({ todo: true }));

  // Top-10 all-time for a track. Stubbed to [] until runs are validated (P7);
  // the client renders an empty-state from this.
  app.get<{ Params: { trackId: string } }>(
    "/:trackId",
    {
      schema: {
        params: {
          type: "object",
          required: ["trackId"],
          properties: { trackId: { type: "string", pattern: ID_PATTERN } },
        },
      },
    },
    async () => [],
  );
};
