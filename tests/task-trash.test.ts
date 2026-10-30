import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertTrashMutation,
  deleteTrashedTask,
  restoreTrashedTask,
} from "../src/lib/task-trash.ts";

test("trash mutations only accept the exact affected task", () => {
  assert.doesNotThrow(() => assertTrashMutation({ data: { id: "task-1" }, error: null }, "task-1"));
  for (const data of [null, { id: "other-task" }]) {
    assert.throws(
      () => assertTrashMutation({ data, error: null }, "task-1"),
      /não está mais na lixeira/,
    );
  }
  assert.throws(
    () => assertTrashMutation({ data: null, error: { message: "permission denied" } }, "task-1"),
    /permission denied/,
  );
});

function fakeClient(result: { data: { id: string } | null; error: { message: string } | null }) {
  const calls: unknown[][] = [];
  const chain = {
    from: (...args: unknown[]) => {
      calls.push(["from", ...args]);
      return chain;
    },
    update: (...args: unknown[]) => {
      calls.push(["update", ...args]);
      return chain;
    },
    delete: (...args: unknown[]) => {
      calls.push(["delete", ...args]);
      return chain;
    },
    eq: (...args: unknown[]) => {
      calls.push(["eq", ...args]);
      return chain;
    },
    not: (...args: unknown[]) => {
      calls.push(["not", ...args]);
      return chain;
    },
    select: (...args: unknown[]) => {
      calls.push(["select", ...args]);
      return chain;
    },
    single: async () => {
      calls.push(["single"]);
      return result;
    },
  };
  return { calls, client: chain as unknown as Parameters<typeof restoreTrashedTask>[0] };
}

for (const [name, mutation] of [
  ["restore", restoreTrashedTask],
  ["delete", deleteTrashedTask],
] as const) {
  test(`${name} guards the owner, exact ID and trashed status and verifies the returned row`, async () => {
    const { calls, client } = fakeClient({ data: { id: "task-1" }, error: null });
    await mutation(client, "task-1", "owner-1");
    assert.deepEqual(calls, [
      ["from", "task_cards"],
      name === "restore" ? ["update", { deleted_at: null }] : ["delete"],
      ["eq", "id", "task-1"],
      ["eq", "user_id", "owner-1"],
      ["not", "deleted_at", "is", null],
      ["select", "id"],
      ["single"],
    ]);
  });
  test(`${name} rejects zero affected rows and failed queries`, async () => {
    for (const result of [
      { data: null, error: null },
      { data: null, error: { message: "RLS denied" } },
    ]) {
      await assert.rejects(() => mutation(fakeClient(result).client, "task-1", "owner-1"));
    }
  });
  test(`${name} requires a valid session and task before sending a request`, async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    await assert.rejects(() => mutation(client, "task-1", ""), /Sessão inválida/);
    await assert.rejects(() => mutation(client, "", "owner-1"), /Sessão inválida/);
    assert.equal(calls.length, 0);
  });
}
