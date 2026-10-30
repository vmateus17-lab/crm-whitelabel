import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchAllRows,
  DataLoadError,
  isMissingAnalyticsHistory,
} from "../src/lib/query-pagination.ts";

test("lê mais de mil registros mesmo quando a API limita cada página abaixo do solicitado", async () => {
  const source = Array.from({ length: 1205 }, (_, id) => ({ id: String(id) }));
  const offsets: number[] = [];
  const result = await fetchAllRows<{ id: string }>(
    () => ({
      range: async (from, to) => {
        offsets.push(from);
        return { data: source.slice(from, Math.min(to + 1, from + 23)), error: null };
      },
    }),
    "leads",
  );
  assert.equal(result.length, 1205);
  assert.equal(new Set(result.map((row) => row.id)).size, 1205);
  assert.equal(offsets[1], 23);
});

test("erro posterior rejeita a leitura inteira em vez de retornar totais parciais", async () => {
  await assert.rejects(
    fetchAllRows(
      () => ({
        range: async (from) =>
          from === 0
            ? { data: [{ id: "a" }], error: null }
            : { data: null, error: { code: "42501", message: "permission denied" } },
      }),
      "pagamentos",
    ),
    /pagamentos.*permission denied/,
  );
});

test("retorno inválido não vira uma lista vazia válida", async () => {
  await assert.rejects(
    fetchAllRows(() => ({ range: async () => ({ data: null, error: null }) })),
    /resposta inválida/,
  );
});

test("paginação inconsistente é interrompida sem consultas infinitas", async () => {
  await assert.rejects(
    fetchAllRows(() => ({ range: async () => ({ data: [{ id: "repeated" }], error: null }) })),
    /registros repetidos/,
  );
});

test("histórico ausente é distinguido de erros comuns", () => {
  assert.equal(
    isMissingAnalyticsHistory(
      new DataLoadError("histórico", { code: "PGRST205", message: "missing table" }),
    ),
    true,
  );
  assert.equal(
    isMissingAnalyticsHistory(new DataLoadError("histórico", { code: "42501", message: "denied" })),
    false,
  );
});
