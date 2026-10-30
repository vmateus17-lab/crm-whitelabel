import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReportCharts, reportChartMonths } from "../src/lib/report-charts.ts";
import { commercialMetrics, financialMetrics } from "../src/lib/analytics.ts";

const range = { from: "2026-09-01", to: "2026-10-31" };
const today = "2026-10-02";
const leads = [
  {
    id: "new",
    stage: "proposta",
    estimated_value: 400,
    created_at: "2026-09-10T12:00:00Z",
    closed_at: null,
    services: ["Sites", "Sites", "Hospedagem"],
  },
  {
    id: "old",
    stage: "ganho",
    estimated_value: 1000,
    created_at: "2026-01-01T12:00:00Z",
    closed_at: "2026-10-01T12:00:00Z",
    services: ["Sites"],
  },
  {
    id: "another",
    stage: "perdido",
    estimated_value: 500,
    created_at: "2026-10-01T12:00:00Z",
    closed_at: "2026-10-01T12:00:00Z",
    services: ["Sites"],
  },
];
const payments = [
  {
    amount: 100,
    status: "pago",
    due_date: "2026-09-10",
    paid_at: "2026-10-01",
    reference_month: "2026-09-01",
  },
  {
    amount: 200,
    status: "pendente",
    due_date: "2026-09-30",
    paid_at: null,
    reference_month: "2026-09-01",
  },
  {
    amount: 300,
    status: "pendente",
    due_date: "2026-10-10",
    paid_at: null,
    reference_month: "2026-10-01",
  },
];

for (const basis of ["due", "paid", "reference"] as const) {
  test(`monthly ${basis} chart totals reconcile with financial cards from the same records`, () => {
    const chart = buildReportCharts({ leads, payments, events: null, range, basis, today });
    const totals = financialMetrics(payments, range, basis, today);
    assert.equal(
      chart.financial.reduce((sum, row) => sum + row.recebido, 0),
      totals.received,
    );
    assert.equal(
      chart.financial.reduce((sum, row) => sum + row.atrasado, 0),
      totals.overdue,
    );
    assert.equal(chart.financial[0].recebido, basis === "paid" ? 0 : 100);
    assert.equal(chart.financial[1].recebido, basis === "paid" ? 100 : 0);
    assert.equal(chart.financial[0].atrasado, 200);
  });
}

test("commercial chart reconciles event dates without confusing creation and closure", () => {
  const events = [
    { id: "event-1", lead_id: "old", to_stage: "ganho", entered_at: "2026-10-01T12:00:00Z" },
  ];
  const chart = buildReportCharts({ leads, payments, events, range, basis: "due", today });
  const totals = commercialMetrics(leads, events, range);
  assert.equal(
    chart.acquisition.reduce((sum, row) => sum + row.criados, 0),
    totals.created,
  );
  assert.equal(
    chart.acquisition.reduce((sum, row) => sum + row.ganhos, 0),
    totals.won,
  );
  assert.equal(chart.acquisition[1].ganhos, 1, "An old lead can close in this period");
  assert.equal(
    chart.pipeline.reduce((sum, row) => sum + row.quantidade, 0),
    2,
    "Only current stages of leads created in period",
  );
});

test("pipeline chart respects configured stage labels and counts each record once", () => {
  const chart = buildReportCharts({
    leads,
    payments,
    events: null,
    range,
    basis: "due",
    today,
    stages: [{ stage_key: "proposta", label: "Orçamento enviado", position: 0 }],
  });
  assert.deepEqual(chart.pipeline[0], { etapa: "Orçamento enviado", quantidade: 1 });
  assert.deepEqual(
    chart.interests,
    [
      ["Sites", 2],
      ["Hospedagem", 1],
    ],
    "Duplicate service names on one lead must not inflate counts",
  );
});

test("partial months clip actual records and date captions to the selected range", () => {
  const chart = buildReportCharts({
    leads,
    payments,
    events: null,
    range: { from: "2026-10-02", to: "2026-10-10" },
    basis: "paid",
    today,
  });
  assert.equal(chart.caption, "02/10/2026 a 10/10/2026");
  assert.equal(chart.financial[0].recebido, 0);
  assert.equal(chart.acquisition[0].criados, 0);
});

test("empty charts stay empty and monthly labels use Brazilian dates across year boundaries", () => {
  const chart = buildReportCharts({
    leads: [],
    payments: [],
    events: [],
    range: { from: "2025-12-01", to: "2026-02-28" },
    basis: "due",
    today,
  });
  assert.deepEqual(
    chart.financial.map((row) => row.mes),
    ["12/2025", "01/2026", "02/2026"],
  );
  assert.ok(chart.financial.every((row) => row.recebido === 0 && row.atrasado === 0));
  assert.equal(chart.interests.length, 0);
  assert.equal(reportChartMonths({ from: "2020-01-01", to: "2026-10-31" }, today).length, 36);
  assert.equal(reportChartMonths({ from: "", to: "" }, today).length, 6);
});
