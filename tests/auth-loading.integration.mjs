// Run against a local preview configured with https://ui-test.supabase.co only.
// Every external request is intercepted; no production accounts or data are used.
import assert from "node:assert/strict";
import puppeteer from "puppeteer";

const base = process.env.CRM_AUTH_TEST_URL ?? "http://127.0.0.1:4176";
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Local preview required");
const browser = await puppeteer.launch({
  executablePath:
    process.env.CRM_AUTH_TEST_CHROME ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "auth-test@example.invalid",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const now = Math.floor(Date.now() / 1000);
const token = (expires) =>
  `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp: expires, iat: now - 7200, role: "authenticated" })).toString("base64url")}.local-test`;
const session = (expired) => ({
  access_token: token(expired ? now - 3600 : now + 86400),
  token_type: "bearer",
  refresh_token: "local-test-not-a-real-token",
  expires_at: expired ? now - 3600 : now + 86400,
  expires_in: expired ? -3600 : 86400,
  user,
});
const checks = [];
const waitUntil = async (condition) => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Expected intercepted authentication request did not arrive");
};
async function fixture({
  stored = null,
  auth = "valid",
  refresh = "reject",
  holdUser = false,
  holdToken = false,
} = {}) {
  const page = await browser.newPage();
  const errors = [],
    requests = [],
    forbiddenRequests = [];
  let releaseUser, releaseToken;
  const userGate = new Promise((resolve) => (releaseUser = resolve));
  const tokenGate = new Promise((resolve) => (releaseToken = resolve));
  const state = { auth, refresh };
  if (!holdUser) releaseUser();
  if (!holdToken) releaseToken();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluateOnNewDocument((stored) => {
    localStorage.removeItem("sb-ui-test-auth-token");
    if (stored) localStorage.setItem("sb-ui-test-auth-token", JSON.stringify(stored));
    window.__visibleLoginFrames = 0;
    const record = () => {
      const input = document.querySelector("#password");
      if (input && input.getBoundingClientRect().width > 0) window.__visibleLoginFrames++;
    };
    document.addEventListener("DOMContentLoaded", () => {
      record();
      new MutationObserver(record).observe(document.body, { childList: true, subtree: true });
      const frame = () => {
        record();
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }, stored);
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    try {
      const url = new URL(request.url());
      if (url.hostname === new URL(base).hostname || url.protocol === "data:")
        return request.continue();
      if (url.hostname !== "ui-test.supabase.co") {
        forbiddenRequests.push(url.origin);
        return request.abort();
      }
      const headers = {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "*",
      };
      const reply = (data, status = 200) =>
        request.respond({ status, headers, body: JSON.stringify(data) });
      if (request.method() === "OPTIONS") return reply({});
      requests.push({ path: url.pathname, method: request.method() });
      if (url.pathname === "/auth/v1/user") {
        await userGate;
        if (state.auth === "reject")
          return reply({ code: "bad_jwt", msg: "Invalid test session" }, 401);
        if (state.auth === "unavailable") return reply({ msg: "Temporary test failure" }, 503);
        return reply(user);
      }
      if (url.pathname === "/auth/v1/token") {
        await tokenGate;
        if (url.searchParams.get("grant_type") === "password") {
          const body = JSON.parse(request.postData());
          assert.equal(body.email, user.email);
          if (body.password === "invalid-test-password")
            return reply({ code: "invalid_credentials", msg: "Invalid test credentials" }, 400);
          return reply(session(false));
        }
        assert.equal(url.searchParams.get("grant_type"), "refresh_token");
        return state.refresh === "valid"
          ? reply(session(false))
          : reply({ code: "refresh_token_not_found", msg: "Expired test refresh token" }, 400);
      }
      if (url.pathname === "/auth/v1/logout") return reply({});
      assert(url.pathname.startsWith("/rest/v1/"), "Unexpected simulated endpoint");
      if (url.pathname.endsWith("user_settings"))
        return reply({ theme: "light", sidebar_collapsed: false });
      if (url.pathname.includes("/rpc/")) return reply(null);
      assert.equal(request.method(), "GET", "No business-data writes allowed in this test");
      return reply([]);
    } catch (cause) {
      if (!page.isClosed()) errors.push(cause.message);
    }
  });
  const close = async () => {
    assert.deepEqual(errors, [], "No browser errors");
    assert.deepEqual(forbiddenRequests, [], "No production or other external requests");
    await page.close();
  };
  return { page, state, requests, releaseUser, releaseToken, close };
}
const waitLogin = (page) => page.waitForSelector("#password", { visible: true, timeout: 10000 });
const waitPrivate = (page, path = "/dashboard") =>
  page.waitForFunction(
    (path) =>
      location.pathname === path &&
      !document.querySelector('[data-slot="auth-loading"]') &&
      document.querySelector(".page-shell"),
    { timeout: 15000 },
    path,
  );

try {
  const html = await (await fetch(`${base}/login`)).text();
  assert(html.includes('data-slot="auth-loading"'));
  assert(
    !html.includes('type="password"'),
    "SSR must not deliver the login form before the session check",
  );
  checks.push("Server HTML shows loading, never the login form");

  {
    const f = await fixture();
    await f.page.goto(`${base}/login`, { waitUntil: "networkidle0" });
    await waitLogin(f.page);
    assert.equal(await f.page.$('[data-slot="auth-loading"]'), null);
    assert(
      !f.requests.some((row) => row.path.startsWith("/rest/v1/")),
      "Guest must not load private data",
    );
    checks.push("No session resolves to the login form without an artificial delay");
    await f.close();
  }
  for (const width of [1440, 390, 320]) {
    const f = await fixture({ stored: session(false), holdUser: true });
    await f.page.setViewport({ width, height: 900 });
    await f.page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await waitUntil(() => f.requests.some((row) => row.path === "/auth/v1/user"));
    await f.page.waitForSelector('[data-slot="auth-loading"]', { visible: true });
    // Hold the validation longer than the old one-second flash to check the full transition.
    await f.page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1600)));
    assert(
      await f.page.$('[data-slot="auth-loading"]'),
      "Loading must remain until validation finishes",
    );
    assert.equal(await f.page.$("#password"), null);
    assert.equal(
      await f.page.$eval('[data-slot="auth-loading"]', (el) => el.getAttribute("aria-busy")),
      "true",
    );
    assert.equal(
      await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    if (width === 390) {
      await f.page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
      assert.equal(
        await f.page.$eval(
          '[data-slot="auth-loading"] svg',
          (el) => getComputedStyle(el).animationName,
        ),
        "none",
      );
    }
    await f.page.screenshot({ path: `/tmp/crm-auth-loading-${width}.png` });
    f.releaseUser();
    await waitPrivate(f.page);
    assert.equal(
      await f.page.evaluate(() => window.__visibleLoginFrames),
      0,
      "A valid session must never flash the login form",
    );
    checks.push(`Active session: loading → dashboard without login flash, ${width}px`);
    await f.close();
  }
  {
    const f = await fixture({ stored: session(true), holdToken: true });
    await f.page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await waitUntil(() => f.requests.some((row) => row.path === "/auth/v1/token"));
    assert.equal(await f.page.$("#password"), null);
    assert(await f.page.$('[data-slot="auth-loading"]'));
    f.releaseToken();
    await waitLogin(f.page);
    assert.equal(await f.page.$('[data-slot="auth-loading"]'), null);
    checks.push("Expired session with rejected refresh returns to login, no endless loading");
    await f.close();
  }
  {
    const f = await fixture({ stored: session(true), refresh: "valid", holdToken: true });
    await f.page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await waitUntil(() => f.requests.some((row) => row.path === "/auth/v1/token"));
    f.releaseToken();
    await waitPrivate(f.page);
    assert.equal(await f.page.evaluate(() => window.__visibleLoginFrames), 0);
    checks.push("Renewable expired session opens dashboard without login flash");
    await f.close();
  }
  for (const auth of ["reject", "unavailable"]) {
    const f = await fixture({ stored: session(false), auth });
    await f.page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await waitLogin(f.page);
    assert.equal(new URL(f.page.url()).pathname, "/login");
    assert(
      (await f.page.$eval("body", (el) => el.innerText)).includes(
        "Não foi possível confirmar sua sessão",
      ),
    );
    assert(
      !f.requests.some((row) => row.path.startsWith("/rest/v1/")),
      "Rejected session must not load private data",
    );
    f.state.auth = "valid";
    await f.page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((el) => el.textContent.trim() === "Tentar novamente")
        .click(),
    );
    await waitPrivate(f.page);
    checks.push(`${auth}: session verification failure can be retried without an endless loader`);
    await f.close();
  }
  {
    const f = await fixture({ holdUser: true });
    await f.page.goto(`${base}/login`, { waitUntil: "networkidle0" });
    await waitLogin(f.page);
    await f.page.type("#email", user.email);
    await f.page.type("#password", "invalid-test-password");
    await f.page.click('button[type="submit"]');
    await f.page.waitForFunction(() =>
      document.body.innerText.includes("E-mail ou senha incorretos"),
    );
    assert(await f.page.$("#password"));
    await f.page.$eval("#password", (el) => {
      el.focus();
      el.select();
    });
    await f.page.keyboard.type("valid-test-password");
    await f.page.click('button[type="submit"]');
    await waitUntil(() => f.requests.some((row) => row.path === "/auth/v1/user"));
    assert.equal(await f.page.$("#password"), null);
    assert(await f.page.$('[data-slot="auth-loading"]'));
    f.releaseUser();
    await waitPrivate(f.page);
    checks.push("Manual login keeps invalid-credential feedback and shows loading after success");
    await f.close();
  }
  for (const [redirect, expected] of [
    ["/financeiro?status=pendente", "/financeiro"],
    ["https://outside.invalid", "/dashboard"],
  ]) {
    const f = await fixture({ stored: session(false) });
    await f.page.goto(`${base}/login?redirect=${encodeURIComponent(redirect)}`, {
      waitUntil: "networkidle0",
    });
    await waitPrivate(f.page, expected);
    assert.equal(await f.page.evaluate(() => window.__visibleLoginFrames), 0);
    if (expected === "/financeiro")
      assert.equal(new URL(f.page.url()).searchParams.get("status"), "pendente");
    checks.push(`Safe login redirect retained: ${expected}`);
    await f.close();
  }
  console.log(
    JSON.stringify({ passed: true, checks, productionRequests: 0, businessDataWrites: 0 }),
  );
} finally {
  await browser.close();
}
