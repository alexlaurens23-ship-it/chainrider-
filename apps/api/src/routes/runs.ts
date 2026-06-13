import type { FastifyPluginAsync } from "fastify";

interface SubmitBody {
  trackId: number;
  mode: "raw" | "smooth";
  score: number;
  timeMs: number;
  ticks: number;
  flips: number;
  crashes: number;
  maxCombo: number;
  simVersion: number;
  inputLog: [number, number][];
}

/** Run submission + server-side re-simulation via @chainrider/physics (cr_runs). */
export const runsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => ({ todo: true }));

  // Accepts the real submission payload (incl. the [tick,keymask] input log
  // that P6 will re-simulate) but stores nothing yet. Lets the Ride screen's
  // Submit button exercise the wire format now.
  app.post<{ Body: SubmitBody }>(
    "/submit",
    {
      schema: {
        body: {
          type: "object",
          required: ["trackId", "mode", "score", "ticks", "simVersion", "inputLog"],
          properties: {
            trackId: { type: "integer" },
            mode: { enum: ["raw", "smooth"] },
            score: { type: "number" },
            timeMs: { type: "number" },
            ticks: { type: "integer" },
            flips: { type: "integer" },
            crashes: { type: "integer" },
            maxCombo: { type: "integer" },
            simVersion: { type: "integer" },
            inputLog: { type: "array", items: { type: "array", items: { type: "number" } } },
          },
        },
      },
    },
    async (req) => {
      req.log.info(
        { trackId: req.body.trackId, score: req.body.score, events: req.body.inputLog.length },
        "run submission received (P6 re-sim not wired yet)",
      );
      return { ok: true, todo: true };
    },
  );
};
