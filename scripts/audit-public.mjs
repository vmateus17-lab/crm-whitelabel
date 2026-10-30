import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const ignored = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-ssr",
  ".output",
  ".wrangler",
  ".tanstack",
  ".vinxi",
  ".nitro",
]);
async function walk(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(file)));
    else result.push(path.relative(root, file));
  }
  return result;
}
let files;
try {
  files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
    .split("\0")
    .filter(Boolean);
} catch {
  files = await walk(root);
}
const errors = [];
for (const file of files) {
  if (
    /(^|\/)(\.env($|\.(?!example$))|\.dev\.vars|readme-lastchat\.md)|\.(pem|key|p12|pfx|db|sqlite|dump|bak)$|(^|\/)(backups|exports|\.temp)(\/|$)/i.test(
      file,
    )
  )
    errors.push(`${file}: private runtime/export file`);
  if (/\.(png|jpg|jpeg|webp|ico)$/i.test(file)) continue;
  const text = await readFile(file, "utf8");
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:ghp_|github_pat_|sb_secret_|sk_live_)[A-Za-z0-9_]{16,}/,
    /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/,
    /\bsb_publishable_[A-Za-z0-9_-]{15,}/,
    /https:\/\/[a-z]{20}\.supabase\.co/,
    /(?:password|service_role_key|api_key|access_token)\s*[:=]\s*["'][A-Za-z0-9_/-]{24,}["']/i,
  ];
  if (patterns.some((pattern) => pattern.test(text)))
    errors.push(`${file}: possible live credential or project identifier`);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else console.log(`Public-source audit passed (${files.length} files).`);
