export interface KeepaliveEnv {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
}

// This public RPC executes a real SQL query without exposing business records.
// No administrative key is needed by the deployed Worker.
export async function keepSupabaseAlive(env: KeepaliveEnv): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Supabase keepalive configuration is missing");
  }
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_crm_branding`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Supabase keepalive failed (HTTP ${response.status})`);
  }
  const result = await response.json();
  if (!result || typeof result.name !== "string") {
    throw new Error("Supabase keepalive returned an unexpected response");
  }
  console.info("Supabase keepalive completed", { at: new Date().toISOString() });
}
