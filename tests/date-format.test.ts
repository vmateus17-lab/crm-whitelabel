import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatDateBR,
  formatDateTimeBR,
  formatMonthBR,
  formatTimeBR,
} from "../src/lib/date-format.ts";

test("date-only values use DD/MM/YYYY without shifting the day", () => {
  assert.equal(formatDateBR("2026-10-02"), "02/10/2026");
  assert.equal(formatDateBR("2024-02-29"), "29/02/2024");
  assert.equal(formatDateBR("2026-02-31"), "—");
  assert.equal(formatDateBR("invalid"), "—");
  assert.equal(formatDateBR(null), "—");
});
test("timestamps display the São Paulo date and 24-hour time", () => {
  assert.equal(formatDateBR("2026-10-02T01:00:00Z"), "01/10/2026");
  assert.match(formatDateTimeBR("2026-10-02T15:30:00Z"), /^02\/10\/2026,? 12:30$/);
});
test("competence uses MM/YYYY while storage stays ISO", () => {
  assert.equal(formatMonthBR("2026-10"), "10/2026");
  assert.equal(formatMonthBR("2026-10-01"), "10/2026");
  assert.equal(formatMonthBR("2026-13"), "—");
  assert.equal(formatMonthBR("bad"), "—");
});

test("horário de atualização usa HH:mm em São Paulo, incluindo meia-noite", () => {
  assert.equal(formatTimeBR("2026-10-02T19:16:00Z"), "16:16");
  assert.equal(formatTimeBR(new Date("2026-10-02T03:00:00Z")), "00:00");
  assert.equal(formatTimeBR(null), "—");
  assert.equal(formatTimeBR("invalid"), "—");
});
