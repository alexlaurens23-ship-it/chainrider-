import type { FastifyPluginAsync } from "fastify";

/** Wallet-signature auth (tweetnacl verify → JWT). Routes land with the auth phase. */
export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => ({ todo: true }));
};
