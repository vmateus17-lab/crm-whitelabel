import assert from "node:assert/strict";
import test from "node:test";
import {
  commercialMetrics,
  financialMetrics,
  quoteMetrics,
  getSaoPauloDate,
  dateInRange,
  previousPeriod,
  getRangePreset,
  relativeChange,
  getClientServices,
  type AnalyticsLead,
  type LeadStageEvent,
} from "../src/lib/analytics.ts";
import {
  getEffectivePaymentStatus,
  getPaymentDate,
  isPaymentInRange,
  getPaymentKind,
} from "../src/lib/payment-metrics.ts";

const september = { from: "2026-09-01", to: "2026-09-30" };
const october = { from: "2026-10-01", to: "2026-10-31" };

test("encerramentos antigos sem data confiável são sinalizados, nunca datados pela criação", () => {
  const lead: AnalyticsLead = {
    id: "legacy",
    stage: "perdido",
    estimated_value: 100,
    created_at: "2026-10-01T12:00:00Z",
    closed_at: null,
  };
  const missing = commercialMetrics([lead], [], october);
  assert.equal(missing.lost, 0);
  assert.equal(missing.missingClosureDates, 1);
  const known = commercialMetrics(
    [lead],
    [{ id: "event", lead_id: lead.id, to_stage: "perdido", entered_at: "2026-09-01T12:00:00Z" }],
    october,
  );
  assert.equal(known.lost, 0);
  assert.equal(known.missingClosureDates, 0);
});

test("serviços dos filtros incluem cobranças recorrentes ativas sem duplicar o cadastro", () => {
  assert.deepEqual(
    getClientServices({
      services: ["SEO"],
      client_recurring_services: [
        { service_name: "SEO", active: true },
        { service_name: "Outro", active: true },
        { service_name: "Inativo", active: false },
      ],
    }),
    ["SEO", "Outro"],
  );
  assert.deepEqual(
    getClientServices({
      services: [],
      client_recurring_services: [{ service_name: "Outro", active: true }],
    }),
    ["Outro"],
  );
});

test("tipo recorrente usa o snapshot anual, sem reclassificar pela recorrência atual", () => {
  assert.equal(
    getPaymentKind({ payment_type: "monthly", recurring_billing_cycle: "annual" }),
    "annual",
  );
  assert.equal(getPaymentKind({ payment_type: "monthly" }), "monthly");
  assert.equal(getPaymentKind({ payment_type: "initial_sale" }), "initial_sale");
  assert.equal(getPaymentKind({ payment_type: "one_off" }), "one_off");
});

test("timestamps usam o dia de São Paulo, datas civis não mudam de dia", () => {
  assert.equal(getSaoPauloDate("2026-10-01T01:00:00Z"), "2026-09-30");
  assert.equal(getSaoPauloDate("2026-10-01"), "2026-10-01");
  assert.equal(dateInRange("2026-10-01T01:00:00Z", september), true);
  assert.equal(dateInRange("2026-10-01T03:00:00Z", september), false);
  assert.equal(dateInRange("invalid", september), false);
});

test("bases de vencimento, recebimento e competência produzem totais distintos", () => {
  const payments = [
    {
      amount: 1000,
      status: "pago",
      due_date: "2026-09-25",
      paid_at: "2026-10-01",
      reference_month: "2026-08-01",
    },
  ];
  assert.equal(financialMetrics(payments, september, "due", "2026-10-01").received, 1000);
  assert.equal(financialMetrics(payments, september, "paid", "2026-10-01").received, 0);
  assert.equal(financialMetrics(payments, october, "paid", "2026-10-01").received, 1000);
  assert.equal(
    financialMetrics(payments, { from: "2026-08-01", to: "2026-08-31" }, "reference", "2026-10-01")
      .received,
    1000,
  );
});

test("ausência de competência ou recebimento não inventa a data", () => {
  const payment = {
    amount: 100,
    status: "pago",
    due_date: "2026-10-01",
    paid_at: null,
    reference_month: null,
  };
  assert.equal(getPaymentDate(payment, "reference"), null);
  assert.equal(isPaymentInRange(payment, "", "", "paid"), false);
  assert.equal(isPaymentInRange(payment, "", "", "due"), true);
  assert.equal(financialMetrics([payment], october, "paid", "2026-10-01").missingBasis, 1);
  assert.equal(financialMetrics([payment], october, "reference", "2026-10-01").received, 0);
});

test("atraso efetivo independe de visitar Financeiro e usa dia civil", () => {
  assert.equal(
    getEffectivePaymentStatus({ status: "pendente", due_date: "2026-09-30" }, "2026-10-01"),
    "atrasado",
  );
  assert.equal(
    getEffectivePaymentStatus({ status: "pendente", due_date: "2026-10-01" }, "2026-10-01"),
    "pendente",
  );
  assert.equal(
    getEffectivePaymentStatus({ status: "pago", due_date: "2026-09-30" }, "2026-10-01"),
    "pago",
  );
  assert.equal(
    getEffectivePaymentStatus({ status: "atrasado", due_date: "2026-10-05" }, "2026-10-01"),
    "pendente",
  );
});

test("na base caixa a agenda dos não pagos continua por vencimento", () => {
  const payments = [{ amount: 500, status: "pendente", due_date: "2026-09-20", paid_at: null }];
  const metrics = financialMetrics(payments, september, "paid", "2026-10-01");
  assert.equal(metrics.received, 0);
  assert.equal(metrics.overdue, 500);
  assert.equal(metrics.obligationBasis, "due");
});

test("histórico preserva perdas depois que um lead é reaberto", () => {
  const lead: AnalyticsLead = {
    id: "lead-1",
    stage: "novo",
    estimated_value: 1200,
    created_at: "2026-08-01T12:00:00Z",
    closed_at: null,
  };
  const events: LeadStageEvent[] = [
    { id: "event-1", lead_id: lead.id, to_stage: "perdido", entered_at: "2026-09-10T12:00:00Z" },
    { id: "event-2", lead_id: lead.id, to_stage: "novo", entered_at: "2026-10-01T12:00:00Z" },
  ];
  assert.equal(commercialMetrics([lead], events, september).lost, 1);
  assert.equal(commercialMetrics([lead], events, october).lost, 0);
});

test("encerramento com evento não é duplicado pelo closed_at e legado continua visível", () => {
  const lead: AnalyticsLead = {
    id: "lead-1",
    stage: "ganho",
    estimated_value: 1200,
    created_at: "2026-09-01T12:00:00Z",
    closed_at: "2026-09-10T12:00:00Z",
  };
  const events = [
    { id: "event-1", lead_id: lead.id, to_stage: "ganho", entered_at: lead.closed_at! },
  ];
  assert.equal(commercialMetrics([lead], events, september).won, 1);
  assert.equal(commercialMetrics([lead], null, september).won, 1);
  assert.equal(commercialMetrics([], events, september).won, 0);
  assert.equal(commercialMetrics([lead], events, september).avgCycle, 9);
});

test("orçamentos contam eventos no período e não confundem emissão com aceite", () => {
  const quote = {
    id: "q1",
    status: "accepted",
    total: 3000,
    issue_date: "2026-09-15",
    sent_at: "2026-09-16T12:00:00Z",
    accepted_at: "2026-10-02T12:00:00Z",
    rejected_at: null,
  };
  const old = { ...quote, id: "q2", accepted_at: null };
  assert.deepEqual(
    [
      quoteMetrics([quote], september).created,
      quoteMetrics([quote], september).sent,
      quoteMetrics([quote], september).accepted,
    ],
    [1, 1, 0],
  );
  assert.equal(quoteMetrics([quote], october).acceptedValue, 3000);
  assert.equal(quoteMetrics([old], october).accepted, 0);
  assert.equal(quoteMetrics([old], october).missingEventDates, 1);
});

test("comparação anterior tem a mesma duração, inclusive em ano bissexto", () => {
  assert.deepEqual(previousPeriod({ from: "2026-10-01", to: "2026-10-07" }), {
    from: "2026-09-24",
    to: "2026-09-30",
  });
  assert.deepEqual(getRangePreset("7days", "2024-03-03"), { from: "2024-02-26", to: "2024-03-03" });
  assert.deepEqual(getRangePreset("previousMonth", "2024-03-03"), {
    from: "2024-02-01",
    to: "2024-02-29",
  });
  assert.equal(relativeChange(10, 0), null);
  assert.equal(relativeChange(30, 20), 50);
});
