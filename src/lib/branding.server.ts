import { DEFAULT_BRANDING, parseBranding } from "./branding";

export async function readPublicBranding() {
  const url = process.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return DEFAULT_BRANDING;
  try {
    const response = await fetch(`${url}/rest/v1/rpc/get_crm_branding`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return DEFAULT_BRANDING;
    return parseBranding(await response.json());
  } catch {
    return DEFAULT_BRANDING;
  }
}
