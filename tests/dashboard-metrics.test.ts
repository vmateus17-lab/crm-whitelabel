import { test } from "node:test";
import assert from "node:assert/strict";
import { commercialMetrics } from "../src/lib/analytics.ts";
import {
  recurringRevenueMetrics,
  pipelineForecast,
  forecastStages,
  monthlyReceivedRevenue,
  commercialGoalProgress,
  parseCommercialAmount,
  parseStageProbability,
  isMissingCommercialSchema,
} from "../src/lib/dashboard-metrics.ts";

const clients = [
  {
    id: "mixed",
    status: "ativo",
    client_recurring_services: [
      { amount: 200, active: true, billing_cycle: "monthly" as const },
      { amount: 300, active: true },
      { amount: 1200, active: true, billing_cycle: "annual" as const },
      { amount: 900, active: false },
    ],
  },
  { id: "monthly", status: "ativo", client_recurring_services: [{ amount: 1000, active: true }] },
  {
    id: "annual",
    status: "ativo",
    client_recurring_services: [{ amount: 2400, active: true, billing_cycle: "annual" as const }],
  },
  { id: "paused", status: "pausado", client_recurring_services: [{ amount: 9999, active: true }] },
  {
    id: "former",
    status: "ex_cliente",
    client_recurring_services: [{ amount: 9999, active: true }],
  },
  { id: "one-off", status: "ativo", monthly_value: 9999, client_recurring_services: [] },
  { id: "free", status: "ativo", client_recurring_services: [{ amount: 0, active: true }] },
];
const lead = (id: string, stage: string, estimated_value = 1000) => ({
  id,
  stage,
  estimated_value,
  created_at: "2026-01-01T12:00:00Z",
  closed_at: null as string | null,
});

test("MRR only contains active monthly contracts; ARR includes annuals and ticket counts monthly clients once", () => {
  assert.deepEqual(recurringRevenueMetrics(clients), {
    mrr: 1500,
    arr: 21600,
    monthlyClients: 2,
    averageTicket: 750,
  });
});
test("recurring currency calculations preserve cents and do not infer contracts from monthly_value", () => {
  assert.deepEqual(
    recurringRevenueMetrics([
      {
        id: "a",
        status: "ativo",
        client_recurring_services: [
          { amount: 0.1, active: true },
          { amount: 0.2, active: true },
        ],
      },
    ]),
    { mrr: 0.3, arr: 3.6, monthlyClients: 1, averageTicket: 0.3 },
  );
  assert.equal(recurringRevenueMetrics([{ id: "a", status: "ativo" }]).mrr, 0);
});
test("forecast weights only current open leads, including older creations, excluding trash and terminal stages", () => {
  const leads = [
    lead("new", "novo"),
    lead("negotiating", "negociacao", 4000),
    lead("won", "ganho", 9000),
    lead("lost", "perdido", 9000),
    { ...lead("trash", "novo", 9000), deleted_at: "2026-10-01" },
  ];
  assert.deepEqual(
    pipelineForecast(leads, [
      { stage_key: "novo", probability: 10 },
      { stage_key: "negociacao", probability: 75 },
    ]),
    { value: 3100, missingStages: [], openCount: 2 },
  );
});
test("missing and invalid probabilities never turn into a misleading complete forecast; explicit 0% is valid", () => {
  assert.equal(pipelineForecast([lead("a", "novo")], []).value, null);
  assert.equal(
    pipelineForecast([lead("a", "novo")], [{ stage_key: "novo", probability: 101 }]).value,
    null,
  );
  assert.equal(
    pipelineForecast([lead("a", "novo")], [{ stage_key: "novo", probability: 0 }]).value,
    0,
  );
  assert.equal(pipelineForecast([], []).value, 0);
});
test("probability editor retains configured labels, supports unknown open stages and excludes terminal stages", () => {
  const stages = forecastStages(
    [
      { stage_key: "negociacao", label: "Fechamento", position: 0 },
      { stage_key: "perdido", label: "Arquivado", position: 1 },
    ],
    [lead("a", "custom")],
  );
  assert.equal(stages.find((row) => row.stage_key === "negociacao")?.label, "Fechamento");
  assert.ok(stages.some((row) => row.stage_key === "custom"));
  assert.ok(stages.every((row) => !["ganho", "perdido"].includes(row.stage_key)));
});
const payment = (amount: number | string, extra: Record<string, unknown> = {}) => ({
  amount,
  status: "pago",
  paid_at: "2026-10-02",
  due_date: "2026-09-10",
  reference_month: "2026-09-01",
  ...extra,
});

test("monthly goal includes manual receipts and monthly/annual recurring invoices, never pending or overdue amounts", () => {
  const payments = [
    payment(1000, { payment_type: "one_off" }),
    payment(500, { payment_type: "monthly", recurring_billing_cycle: "monthly" }),
    payment(1200, { recurring_service_id: "annual", recurring_billing_cycle: "annual" }),
    payment(10000, { status: "pendente" }),
    payment(10000, { status: "atrasado" }),
    payment(10000, { paid_at: "2026-09-30", due_date: "2026-10-02" }),
  ];
  assert.deepEqual(monthlyReceivedRevenue(payments, "2026-10"), {
    value: 2700,
    missingReceiptDates: 0,
  });
  assert.equal(monthlyReceivedRevenue(payments, "2026-09").value, 10000);
});
test("receipt goal removes an undone payment and includes distinct payments for the same client or lead", () => {
  const payments = [
    payment(1000, { id: "manual", client_id: "client", lead_id: "won" }),
    payment(200, { id: "recurring", client_id: "client", lead_id: "won" }),
  ];
  assert.equal(monthlyReceivedRevenue(payments, "2026-10").value, 1200);
  const undone = payments.map((row, index) =>
    index === 0 ? { ...row, status: "pendente", paid_at: null } : row,
  );
  assert.equal(monthlyReceivedRevenue(undone, "2026-10").value, 200);
  assert.equal(monthlyReceivedRevenue([payment(1000, { status: "pendente" })], "2026-10").value, 0);
});
test("receipt month uses date-only values unchanged and the Brazilian timezone for timestamps", () => {
  const payments = [
    payment(100, { paid_at: "2026-10-01T01:00:00Z" }),
    payment(200, { paid_at: "2026-10-01T03:00:00Z" }),
    payment(300, { paid_at: "2026-10-01" }),
    payment(400, { paid_at: "2026-11-01" }),
  ];
  assert.equal(monthlyReceivedRevenue(payments, "2026-09").value, 100);
  assert.equal(monthlyReceivedRevenue(payments, "2026-10").value, 500);
  assert.equal(monthlyReceivedRevenue(payments, "2026-11").value, 400);
});
test("missing/invalid receipt dates are explicit, never inferred from due date, competence or today", () => {
  const payments = [null, "", "invalid", "2026-02-30", "2026-13-01"].map((paid_at) =>
    payment(1000, { paid_at }),
  );
  assert.deepEqual(monthlyReceivedRevenue(payments, "2026-10"), {
    value: 0,
    missingReceiptDates: 5,
  });
  assert.deepEqual(
    monthlyReceivedRevenue([payment(1000, { status: "pendente", paid_at: null })], "2026-10"),
    {
      value: 0,
      missingReceiptDates: 0,
    },
  );
});
test("receipt goal preserves currency cents and ignores invalid or negative amounts", () => {
  assert.equal(
    monthlyReceivedRevenue(
      [payment(0.1), payment("0.20"), payment(-1), payment("NaN"), payment("Infinity")],
      "2026-10",
    ).value,
    0.3,
  );
});
test("goal progress preserves percentages above 100 but never overflows the bar or displays negative remaining", () => {
  assert.equal(commercialGoalProgress(100, null), null);
  assert.equal(commercialGoalProgress(100, 0), null);
  assert.deepEqual(commercialGoalProgress(2500, 10000), {
    percent: 25,
    barPercent: 25,
    remaining: 7500,
  });
  assert.deepEqual(commercialGoalProgress(12000, 10000), {
    percent: 120,
    barPercent: 100,
    remaining: 0,
  });
});
test("commercial input accepts Brazilian decimals and rejects blanks, negatives, excess precision and non-finite values", () => {
  assert.equal(parseCommercialAmount("15000,50"), 15000.5);
  assert.equal(parseStageProbability("0"), 0);
  assert.equal(parseStageProbability("99,95"), 99.95);
  for (const invalid of ["", "-1", "0", "Infinity", "1.234", "10000000000", "1,2,3"])
    assert.equal(parseCommercialAmount(invalid), null);
  for (const invalid of ["", "-1", "100,01", "Infinity", "20.555"])
    assert.equal(parseStageProbability(invalid), null);
});
test("absent migration is distinguished from authorization and network errors", () => {
  assert.equal(isMissingCommercialSchema({ code: "PGRST205" }), true);
  assert.equal(isMissingCommercialSchema({ code: "42703" }), true);
  assert.equal(isMissingCommercialSchema({ code: "42501" }), false);
  assert.equal(isMissingCommercialSchema(new Error("Failed to fetch")), false);
});

test("commercial summaries preserve event values after the lead is edited", () => {
  const leads = [lead("sale", "ganho", 9999)];
  const events = [
    {
      id: "closed",
      lead_id: "sale",
      to_stage: "ganho",
      entered_at: "2026-10-01T12:00:00Z",
      estimated_value_snapshot: 2200,
    },
  ];
  const metrics = commercialMetrics(leads, events, { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(metrics.wonValue, 2200);
  assert.equal(metrics.avgTicket, 2200);
});
