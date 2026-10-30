import assert from "node:assert/strict";
import test from "node:test";
import {
  isPaidPayment,
  isPaymentDueInMonth,
  isPaymentDueInRange,
  isPendingPaymentDueToday,
  sumPaymentAmounts,
} from "../src/lib/payment-metrics.ts";

const payments = [
  { client_id: "claudia", amount: 1_200, status: "pago", due_date: "2026-05-01" },
  { client_id: "claudia", amount: 1_200, status: "pago", due_date: "2026-07-01" },
  { client_id: "outros", amount: 16_665.36, status: "pago", due_date: "2026-07-31" },
  { client_id: "outros", amount: 500, status: "pendente", due_date: "2026-07-10" },
];

test("recebido mensal considera somente status pago e mês do vencimento", () => {
  const receivedInJuly = payments.filter(
    (payment) => isPaidPayment(payment) && isPaymentDueInMonth(payment, "2026-07"),
  );

  assert.equal(sumPaymentAmounts(receivedInJuly), 17_865.36);
});

test("receita da cliente não carrega lançamentos vencidos em outros meses", () => {
  const claudiaInJuly = payments.filter(
    (payment) =>
      payment.client_id === "claudia" &&
      isPaidPayment(payment) &&
      isPaymentDueInRange(payment, "2026-07-01", "2026-07-31"),
  );

  assert.equal(sumPaymentAmounts(claudiaInJuly), 1_200);
});

test("a receber hoje soma somente lançamentos pendentes com vencimento no dia", () => {
  const today = "2026-07-10";
  const entries = [
    { amount: 500, status: "pendente", due_date: today },
    { amount: 250, status: "pago", due_date: today },
    { amount: 300, status: "atrasado", due_date: today },
    { amount: 900, status: "pendente", due_date: "2026-07-11" },
  ];

  assert.equal(
    sumPaymentAmounts(entries.filter((payment) => isPendingPaymentDueToday(payment, today))),
    500,
  );
});
