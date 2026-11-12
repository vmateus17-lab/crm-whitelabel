import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";

const command = process.argv[2];
if (!["login", "deploy"].includes(command)) throw new Error("Expected login or deploy");
// Keep Sprint's OAuth session separate from other Cloudflare accounts on this computer.
const env = {
  ...process.env,
  XDG_CONFIG_HOME: resolve(".wrangler/oauth"),
  WRANGLER_SEND_METRICS: "false",
};
const args = ["node_modules/wrangler/bin/wrangler.js", command];
if (command === "deploy") {
  const local = parseEnv(readFileSync(".env", "utf8"));
  const file = "dist/server/wrangler.json";
  const config = JSON.parse(readFileSync(file, "utf8"));
  config.vars = {
    ...config.vars,
    SUPABASE_URL: local.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: local.SUPABASE_PUBLISHABLE_KEY,
  };
  if (!config.vars.SUPABASE_URL || !config.vars.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Configure the Supabase URL and publishable key in .env first");
  }
  writeFileSync(file, JSON.stringify(config, null, 2));
  args.push("--config", file);
}
const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
