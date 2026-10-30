import { test } from "node:test";
import assert from "node:assert/strict";
import { sortClientsByName } from "../src/lib/client-options.ts";

test("client dropdown sorts A–Z in Brazilian Portuguese, regardless of case or accents", () => {
  const clients = [
    { id: "1", name: "Zuleica", status: "pausado" },
    { id: "2", name: " bruno " },
    { id: "3", name: "Érica" },
    { id: "4", name: "Álvaro" },
    { id: "5", name: "ana" },
  ];
  const sorted = sortClientsByName(clients);
  assert.deepEqual(
    sorted.map((client) => client.name),
    ["Álvaro", "ana", " bruno ", "Érica", "Zuleica"],
  );
  assert.equal(sorted.at(-1)?.status, "pausado");
  assert.equal(sorted[0], clients[3]);
  assert.equal(clients[0].name, "Zuleica");
});

test("sorting has deterministic ties and natural numbers and supports empty lists without mutating input", () => {
  const clients = Object.freeze([
    { id: "z", name: "Ana" },
    { id: "a", name: "ana" },
    { id: "10", name: "Cliente 10" },
    { id: "2", name: "Cliente 2" },
  ]);
  assert.deepEqual(
    sortClientsByName(clients).map((client) => client.id),
    ["a", "z", "2", "10"],
  );
  assert.deepEqual(sortClientsByName([]), []);
});
