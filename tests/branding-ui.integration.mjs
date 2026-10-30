// Isolated browser fixture: no real accounts, projects or external requests.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import puppeteer from "puppeteer";

const root = fileURLToPath(new URL("../", import.meta.url));
let branding = { name: "CRM", logo: null, revision: "default" };
let saves = 0;
const calls = [];
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "owner@example.invalid",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const now = Math.floor(Date.now() / 1000);
const accessToken = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp: now + 86400, iat: now, role: "authenticated" })).toString("base64url")}.local-test`;
const session = {
  access_token: accessToken,
  token_type: "bearer",
  refresh_token: "local-test",
  expires_in: 86400,
  expires_at: now + 86400,
  user,
};
const mock = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const pathname = new URL(req.url, "http://localhost").pathname;
  calls.push(pathname);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "*",
  });
  const reply = (data) => res.end(JSON.stringify(data));
  if (req.method === "OPTIONS") return reply({});
  if (pathname === "/auth/v1/token") return reply(session);
  if (pathname === "/auth/v1/user") return reply(user);
  if (pathname === "/rest/v1/rpc/get_crm_branding") return reply(branding);
  if (pathname === "/rest/v1/rpc/can_manage_crm_branding") return reply(true);
  if (pathname === "/rest/v1/rpc/save_crm_branding") {
    saves++;
    branding = { name: body.p_name, logo: body.p_logo, revision: `revision-${saves}` };
    return reply(branding);
  }
  if (pathname === "/rest/v1/user_settings")
    return reply({ theme: "light", sidebar_collapsed: false });
  if (pathname.includes("/rpc/")) return reply(null);
  return reply([]);
});
await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
const mockUrl = `http://127.0.0.1:${mock.address().port}`;
const port = process.env.CRM_BRANDING_TEST_PORT ?? "4291";
const base = `http://127.0.0.1:${port}`;
const app = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", port, "--strictPort"],
  {
    cwd: root,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: mockUrl,
      SUPABASE_URL: mockUrl,
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-public-key",
      SUPABASE_PUBLISHABLE_KEY: "test-public-key",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let appLog = "";
app.stdout.on("data", (data) => {
  appLog += data;
});
app.stderr.on("data", (data) => {
  appLog += data;
});
let browser;
const errors = [];
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${base}/api/branding`)).ok) break;
    } catch {
      /* Wait for the local fixture. */
    }
    if (attempt === 99) throw new Error(appLog);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = await puppeteer.launch({
    executablePath:
      process.env.CRM_TEST_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const preparePage = async (context) => {
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (
        ["127.0.0.1", "localhost"].includes(url.hostname) ||
        ["data:", "blob:"].includes(url.protocol)
      )
        void req.continue();
      else {
        errors.push(`Blocked external request: ${url.origin}`);
        void req.abort();
      }
    });
    return page;
  };
  const page = await preparePage(browser.defaultBrowserContext());
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${base}/login`);
  await page.waitForSelector("#email");
  await page.type("#email", user.email);
  await page.type("#password", "Test-password-123!");
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname === "/dashboard");
  await page.goto(`${base}/configuracoes`);
  await page.locator("button::-p-text(Identidade visual)").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#crm-brand-name") &&
      !document.querySelector("#crm-brand-name").disabled,
  );
  await page.$eval("#crm-brand-name", (el) => el.select());
  await page.keyboard.press("Backspace");
  await page.type("#crm-brand-name", "ABCDEFGHIJKLM");
  assert.equal(await page.$eval("#crm-brand-name", (el) => el.value), "ABCDEFGHIJKL");
  await page.$eval("#crm-brand-name", (el) => el.select());
  await page.keyboard.press("Backspace");
  await page.type("#crm-brand-name", "Minha Marca");
  await page.$eval("#crm-brand-logo", async (el) => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "rectangle.png", { type: "image/png" }));
    el.files = transfer.files;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => document.body.textContent.includes("Use uma imagem quadrada"));
  assert.equal(saves, 0);
  const logoInput = await page.$("#crm-brand-logo");
  await logoInput.uploadFile(`${root}/public/icons/default.png`);
  await page.waitForFunction(() =>
    document.querySelector('img[alt="Prévia do logo"]').src.startsWith("data:image/png"),
  );
  await page.locator("button::-p-text(Salvar identidade)").click();
  await page.waitForFunction(() => !document.querySelector("#crm-brand-name"));
  await page.waitForFunction(() => document.title === "Minha Marca | Configurações");
  assert.equal(saves, 1);
  assert.equal(branding.name, "Minha Marca");
  assert.equal(await page.$eval("aside img", (el) => el.src), branding.logo);
  await page.reload();
  await page.waitForFunction(() => document.title === "Minha Marca | Configurações");
  await page.screenshot({ path: "/tmp/crm-whitelabel-settings-desktop.png", fullPage: true });
  await page.setViewport({ width: 390, height: 844 });
  await page.locator("button::-p-text(Identidade visual)").click();
  await page.waitForSelector("#crm-brand-name");
  await page.screenshot({ path: "/tmp/crm-whitelabel-settings-mobile.png", fullPage: true });
  assert(
    await page.$eval(
      '[role="dialog"]',
      (el) => el.getBoundingClientRect().width <= window.innerWidth,
    ),
  );
  const freshContext = await browser.createBrowserContext();
  const fresh = await preparePage(freshContext);
  await fresh.goto(`${base}/login`);
  await fresh.waitForFunction(
    () =>
      document.querySelector("h1")?.textContent === "Minha Marca" &&
      document.title === "Minha Marca | Entrar",
  );
  assert.equal(await fresh.$eval('img[alt="Minha Marca"]', (el) => el.src), branding.logo);
  const favicon = await fetch(`${base}/app-icon.png`);
  assert.equal(favicon.headers.get("content-type"), "image/png");
  assert.deepEqual(
    Buffer.from(await favicon.arrayBuffer()),
    Buffer.from(branding.logo.split(",")[1], "base64"),
  );
  const manifest = await (await fetch(`${base}/app.webmanifest`)).json();
  assert.equal(manifest.name, "Minha Marca");
  assert.equal(manifest.icons[0].src, "/app-icon.png?v=revision-1");
  assert(calls.includes("/rest/v1/rpc/save_crm_branding"));
  assert.deepEqual(errors, []);
  console.log(
    "Branding UI passed: name limit, square validation, upload, save, reload, fresh login, title, favicon, manifest and mobile layout.",
  );
} catch (error) {
  console.error(appLog.slice(-5000));
  throw error;
} finally {
  if (browser) await browser.close();
  app.kill("SIGTERM");
  mock.closeAllConnections();
  await new Promise((resolve) => mock.close(resolve));
}
