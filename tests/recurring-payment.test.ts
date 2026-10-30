import assert from "node:assert/strict";
import test from "node:test";
import { toSaoPauloInputParts } from "../src/lib/reminders.ts";
import { isPendingPaymentDueToday } from "../src/lib/payment-metrics.ts";
import {
  buildRecurringPaymentArgs,
  isValidPaymentDate,
  recurringPaymentServiceOptions,
  validatePaymentDraft,
} from "../src/lib/recurring-payment.ts";

const form = {
  client_id: "client-1",
  description: " Mensalidade de hospedagem ",
  amount: 120,
  due_date: "2026-09-30",
  status: "pendente" as const,
};
const selection = { enabled: true, service_name: "Hospedagem", recurring_service_id: null };

test("dia financeiro ainda é hoje em São Paulo mesmo depois da virada UTC", () => {
  const today = toSaoPauloInputParts("2026-10-01T01:30:00.000Z").date;
  assert.equal(today, "2026-09-30");
  assert.equal(isPendingPaymentDueToday(form, today), true);
  assert.equal(form.due_date < today, false);
});

test("recorrência exige cliente, serviço e valor positivo", () => {
  assert.match(validatePaymentDraft({ ...form, client_id: null }, selection)!, /cliente/);
  assert.match(validatePaymentDraft(form, { ...selection, service_name: " " })!, /serviço/);
  assert.match(validatePaymentDraft({ ...form, amount: 0 }, selection)!, /maior que zero/);
  assert.equal(validatePaymentDraft(form, selection), null);
  assert.match(validatePaymentDraft({ ...form, amount: 1.234 }, selection)!, /duas casas/);
  assert.equal(
    validatePaymentDraft({ ...form, amount: 0, client_id: null }, { ...selection, enabled: false }),
    null,
  );
});

test("valida campos e datas reais antes de salvar", () => {
  assert.equal(isValidPaymentDate("2026-02-30"), false);
  assert.equal(isValidPaymentDate("2028-02-29"), true);
  assert.equal(isValidPaymentDate("2026-02-29"), false);
  assert.equal(isValidPaymentDate("0000-01-01"), false);
  assert.match(validatePaymentDraft({ ...form, due_date: "" }, selection)!, /vencimento/);
  assert.match(validatePaymentDraft({ ...form, description: " " }, selection)!, /descrição/);
  assert.match(validatePaymentDraft({ ...form, amount: NaN }, selection)!, /valor válido/);
});

test("serviços existentes são selecionados pelo id e não aparecem como novas recorrências", () => {
  const options = recurringPaymentServiceOptions([
    { id: "r1", service_name: "hospedagem", amount: 100, due_day: 10, active: false },
    { id: "r2", service_name: "hospedagem", amount: 200, due_day: 20, active: true },
  ]);
  assert.equal(
    options.filter((option) => option.service_name.toLowerCase() === "hospedagem").length,
    2,
  );
  assert.equal(options[0].recurring_service_id, "r1");
  assert.equal(options[1].recurring_service_id, "r2");
  assert.ok(options.some((option) => option.key === "new:Tráfego Pago"));
});

test("payload da operação atômica vincula a cobrança ao cliente e à recorrência escolhida", () => {
  assert.deepEqual(buildRecurringPaymentArgs(form, { ...selection, recurring_service_id: "r1" }), {
    p_payment: {
      ...form,
      description: "Mensalidade de hospedagem",
      paid_at: null,
      contract_url: null,
      recurring_cycle: "monthly",
      recurring_due_month: null,
    },
    p_service_name: "Hospedagem",
    p_recurring_service_id: "r1",
  });
  assert.throws(
    () => buildRecurringPaymentArgs({ ...form, client_id: null }, selection),
    /cliente/,
  );
});

test("pagamento não pago não carrega a data de quitação", () => {
  const args = buildRecurringPaymentArgs({ ...form, paid_at: "2026-09-01" }, selection);
  assert.equal(args.p_payment.paid_at, null);
});

test("dia mensal preserva o dia 31 mesmo com a primeira fatura no mês curto", () => {
  const args = buildRecurringPaymentArgs(
    { ...form, due_date: "2026-09-30" },
    { ...selection, due_day: 31 },
  );
  assert.equal(args.p_payment.recurring_due_day, 31);
  assert.equal(args.p_payment.due_date, "2026-09-30");
  assert.match(validatePaymentDraft(form, { ...selection, due_day: 32 })!, /entre 1 e 31/);
});

test("recorrência anual exige mês e preserva valor integral e dia do contrato", () => {
  const annual = { ...selection, billing_cycle: "annual" as const, due_day: 29, due_month: 2 };
  assert.match(validatePaymentDraft(form, { ...annual, due_month: undefined })!, /mês/);
  assert.match(validatePaymentDraft(form, { ...annual, due_month: 13 })!, /mês/);
  const args = buildRecurringPaymentArgs({ ...form, amount: 1200, due_date: "2027-02-28" }, annual);
  assert.equal(args.p_payment.amount, 1200);
  assert.equal(args.p_payment.recurring_cycle, "annual");
  assert.equal(args.p_payment.recurring_due_month, 2);
  assert.equal(args.p_payment.recurring_due_day, 29);
});
