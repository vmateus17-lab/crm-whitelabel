import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dateKey,
  filterChips,
  dateInRange,
  getDatePreset,
  localToday,
  matchesDateShortcut,
  readFilterParams,
  validDate,
  writeFilterParams,
} from "../src/lib/filter-utils.ts";

test("datas dos filtros são brasileiras sem modificar os valores internos", () => {
  let resetValue = "";
  const chips = filterChips(
    { from: "2026-10-02", month: "2026-10" },
    { from: "", month: "" },
    { from: "Desde", month: "Competência" },
    (_key, value) => {
      resetValue = value;
    },
  );
  assert.equal(chips[0].label, "Desde: 02/10/2026");
  assert.equal(chips[1].label, "Competência: 10/2026");
  chips[0].onClear();
  assert.equal(resetValue, "");
});

test("datas respeitam São Paulo e preservam datas civis sem UTC", () => {
  assert.equal(localToday(new Date("2026-10-02T02:59:00Z")), "2026-10-01");
  assert.equal(dateKey("2026-10-02T02:59:00Z"), "2026-10-01");
  assert.equal(dateKey("2026-10-02"), "2026-10-02");
  assert.equal(dateKey("not-a-date"), "");
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2028-02-29"), true);
});

test("intervalos incluem seus dois extremos e não inventam datas ausentes", () => {
  assert.equal(dateInRange("2026-10-01", "2026-10-01", "2026-10-31"), true);
  assert.equal(dateInRange("2026-10-31", "2026-10-01", "2026-10-31"), true);
  assert.equal(dateInRange("2026-11-01", "2026-10-01", "2026-10-31"), false);
  assert.equal(dateInRange(null, "2026-10-01", "2026-10-31"), false);
  assert.equal(dateInRange(null, "", ""), true);
});

test("presets atravessam meses e anos sem horários locais do navegador", () => {
  assert.deepEqual(getDatePreset("month", "2026-02-12"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(getDatePreset("lastMonth", "2026-01-03"), {
    from: "2025-12-01",
    to: "2025-12-31",
  });
  assert.deepEqual(getDatePreset("last7", "2026-01-03"), { from: "2025-12-28", to: "2026-01-03" });
  assert.deepEqual(getDatePreset("all", "2026-01-03"), { from: "", to: "" });
});

test("atalhos distinguem hoje, atrasados, próximos sete dias e concluídos", () => {
  assert.equal(matchesDateShortcut("2026-10-01", "today", false, "2026-10-01"), true);
  assert.equal(matchesDateShortcut("2026-09-30", "overdue", false, "2026-10-01"), true);
  assert.equal(matchesDateShortcut("2026-09-30", "overdue", true, "2026-10-01"), false);
  assert.equal(matchesDateShortcut("2026-10-07", "next7", false, "2026-10-01"), true);
  assert.equal(matchesDateShortcut("2026-10-08", "next7", false, "2026-10-01"), false);
  assert.equal(matchesDateShortcut(null, "none", false, "2026-10-01"), true);
  assert.equal(
    matchesDateShortcut(
      "2026-10-01T12:00:00Z",
      "overdue",
      false,
      "2026-10-01",
      true,
      new Date("2026-10-01T13:00:00Z"),
    ),
    true,
  );
});

test("filtros URL aceitam apenas chaves próprias, enums e datas válidas", () => {
  const defaults = { search: "", stage: "all", from: "", to: "" };
  const filters = readFilterParams(
    new URLSearchParams("search=Caio&stage=invalid&from=2026-02-30&other=1"),
    defaults,
    { stage: ["all", "ganho"] },
  );
  assert.deepEqual(filters, { search: "Caio", stage: "all", from: "", to: "" });
  assert.deepEqual(
    readFilterParams(new URLSearchParams("from=2026-10-31&to=2026-10-01"), defaults),
    defaults,
  );
});

test("serialização URL preserva contexto alheio e remove valores padrão", () => {
  const defaults = { search: "", stage: "all" };
  const params = writeFilterParams(
    new URLSearchParams("other=1&stage=perdido"),
    { search: "Caio & Ana", stage: "all" },
    defaults,
  );
  assert.equal(params.get("other"), "1");
  assert.equal(params.has("stage"), false);
  assert.equal(params.get("search"), "Caio & Ana");
  assert.deepEqual(readFilterParams(params, defaults), { search: "Caio & Ana", stage: "all" });
});

test("padrão mensal usa o mês civil completo e mantém períodos explícitos da URL", () => {
  const defaults = { search: "", ...getDatePreset("month", "2026-10-02") };
  assert.deepEqual(readFilterParams(new URLSearchParams(), defaults), {
    search: "",
    from: "2026-10-01",
    to: "2026-10-31",
  });
  assert.deepEqual(readFilterParams(new URLSearchParams("from=&to="), defaults), {
    search: "",
    from: "",
    to: "",
  });
  const custom = { search: "", from: "2026-09-01", to: "2026-09-30" };
  assert.deepEqual(
    readFilterParams(writeFilterParams(new URLSearchParams(), custom, defaults), defaults),
    custom,
  );
  const reset = writeFilterParams(
    new URLSearchParams("from=2026-09-01&to=2026-09-30&stage=novo"),
    defaults,
    defaults,
  );
  assert.equal(reset.has("from"), false);
  assert.equal(reset.has("to"), false);
  assert.equal(reset.get("stage"), "novo");
  assert.deepEqual(readFilterParams(reset, defaults), defaults);
});

test("padrão Este mês acompanha a virada do mês em São Paulo e anos bissextos", () => {
  assert.deepEqual(getDatePreset("month", localToday(new Date("2026-11-01T02:59:00Z"))), {
    from: "2026-10-01",
    to: "2026-10-31",
  });
  assert.deepEqual(getDatePreset("month", localToday(new Date("2026-11-01T03:00:00Z"))), {
    from: "2026-11-01",
    to: "2026-11-30",
  });
  assert.deepEqual(getDatePreset("month", "2028-02-01"), { from: "2028-02-01", to: "2028-02-29" });
});
