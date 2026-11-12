import assert from "node:assert/strict";
import { test } from "node:test";
import { keepSupabaseAlive } from "../src/lib/supabase-keepalive.ts";

const env = {
  SUPABASE_URL: "https://supabase.example.invalid",
  SUPABASE_PUBLISHABLE_KEY: "public-test-key",
};

test("keepalive queries the database RPC using only the publishable key", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, `${env.SUPABASE_URL}/rest/v1/rpc/get_crm_branding`);
    assert.equal(options.method, "POST");
    assert.equal(new Headers(options.headers).get("apikey"), env.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(options.body, "{}");
    assert.ok(options.signal);
    return Response.json({ name: "CRM", logo: null });
  });
  await keepSupabaseAlive(env);
});

test("keepalive surfaces database errors and does not log response contents", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("private server detail", { status: 503 }),
  );
  await assert.rejects(keepSupabaseAlive(env), { message: "Supabase keepalive failed (HTTP 503)" });
});

test("keepalive rejects missing configuration and malformed successes", async (t) => {
  await assert.rejects(keepSupabaseAlive({}), /configuration is missing/);
  t.mock.method(globalThis, "fetch", async () => Response.json({}));
  await assert.rejects(keepSupabaseAlive(env), /unexpected response/);
});
