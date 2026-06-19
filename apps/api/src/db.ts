import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { WebSocket as WsWebSocket } from "ws";

let client: SupabaseClient | null = null;

/** The realtime transport constructor type expected by createClient (WebSocketLikeConstructor),
 *  derived from its own signature so we don't import from a nested package path. */
type RealtimeTransport = NonNullable<
  NonNullable<Parameters<typeof createClient>[2]>["realtime"]
>["transport"];

/**
 * Lazy service-role Supabase client. Lazy so the dev server (and /api/health)
 * boots without env; routes that need the DB fail with a clear message.
 */
export function getDb(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    }
    // @supabase/realtime-js eagerly builds a RealtimeClient inside createClient
    // and throws on Node < 22 ("detected without native WebSocket support") because
    // it can't find a WebSocket constructor. We only run DB queries (no realtime
    // subscriptions), but the client is constructed regardless — so hand it the `ws`
    // implementation as its transport. Providing `transport` short-circuits the
    // factory's native-WebSocket detection, so this is robust on Node 20 and 22+.
    client = createClient(url, key, {
      auth: { persistSession: false },
      realtime: { transport: WsWebSocket as unknown as RealtimeTransport },
    });
  }
  return client;
}
