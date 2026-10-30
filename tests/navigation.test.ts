import assert from "node:assert/strict";
import test from "node:test";
import { safeLoginRedirect } from "../src/lib/navigation.ts";

test("login preserves private path and filters on the same origin", () => {
  assert.equal(
    safeLoginRedirect("/financeiro?type=annual&status=pendente", "https://crm.example.com"),
    "/financeiro?type=annual&status=pendente",
  );
  assert.equal(
    safeLoginRedirect(
      "https://crm.example.com/pipeline?dateBasis=closed",
      "https://crm.example.com",
    ),
    "/pipeline?dateBasis=closed",
  );
});
test("login rejects external and deceptive destinations", () => {
  for (const path of [
    "https://evil.invalid",
    "//evil.invalid",
    "/\\evil.invalid",
    "javascript:alert(1)",
    "/login",
    null,
  ])
    assert.equal(safeLoginRedirect(path, "https://crm.example.com"), "/dashboard");
});
