export interface QueryError {
  message: string;
  code?: string;
}

export interface QueryPage {
  data: unknown[] | null;
  error: QueryError | null;
  count?: number | null;
}

export interface RangeQuery {
  range(from: number, to: number): PromiseLike<QueryPage>;
}

export class DataLoadError extends Error {
  code?: string;
  constructor(label: string, error: QueryError) {
    super(`Não foi possível carregar ${label}: ${error.message}`);
    this.name = "DataLoadError";
    this.code = error.code;
  }
}

/** Use uma ordenação estável (por exemplo order("id")) na factory da consulta. */
export async function fetchAllRows<T>(
  query: () => RangeQuery,
  label = "os dados",
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? 500;
  const maxPages = options.maxPages ?? 10000;
  if (!Number.isInteger(pageSize) || pageSize < 1 || !Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error("Os limites de paginação devem ser inteiros positivos.");
  }
  const rows: T[] = [];
  const seenIds = new Set<string>();
  for (let page = 0; page < maxPages; page += 1) {
    const response = await query().range(rows.length, rows.length + pageSize - 1);
    if (response.error) throw new DataLoadError(label, response.error);
    if (!Array.isArray(response.data)) {
      throw new DataLoadError(label, { message: "A consulta retornou uma resposta inválida." });
    }
    if (!response.data.length) return rows;
    for (const row of response.data) {
      if (row && typeof row === "object" && "id" in row && typeof row.id === "string") {
        if (seenIds.has(row.id))
          throw new DataLoadError(label, {
            message:
              "A paginação retornou registros repetidos. Atualize para obter uma leitura consistente.",
          });
        seenIds.add(row.id);
      }
    }
    rows.push(...(response.data as T[]));
    if (typeof response.count === "number" && rows.length >= response.count) return rows;
    // Uma página curta também pode ser um teto menor configurado no Data API.
    // Avançamos pelo número recebido em vez de presumir que toda a coleção foi lida.
  }
  throw new DataLoadError(label, {
    message:
      "A leitura excedeu o limite de segurança. Os totais não foram calculados com dados parciais.",
  });
}

export function isMissingAnalyticsHistory(error: unknown) {
  return error instanceof DataLoadError && ["42P01", "PGRST205"].includes(error.code ?? "");
}
