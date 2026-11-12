import handler from "@tanstack/react-start/server-entry";
import { keepSupabaseAlive, type KeepaliveEnv } from "./lib/supabase-keepalive";

export default {
  fetch: handler.fetch,
  async scheduled(_event: unknown, env: KeepaliveEnv) {
    await keepSupabaseAlive(env);
  },
};
