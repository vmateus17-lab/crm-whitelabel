import assert from "node:assert/strict";
import test from "node:test";
import {
  recurringDueDate,
  recurringTotal,
  recurringTotals,
  recurringIsDueInMonth,
  recurringIsBilledInPeriod,
  buildClientRecurringItems,
  type ClientRecurringService,
} from "../src/lib/recurring-services.ts";

test("recurringDueDate clamps day 31 to the last day of short months", () => {
  assert.equal(recurringDueDate(2026, 1, 31), "2026-02-28");
  assert.equal(recurringDueDate(2028, 1, 31), "2028-02-29");
  assert.equal(recurringDueDate(2026, 3, 31), "2026-04-30");
  assert.equal(recurringDueDate(2026, 7, 31), "2026-08-31");
});

test("annual totals keep invoice amount separate from monthly-equivalent MRR", () => {
  const items: ClientRecurringService[] = [
    { service_name: "Mensal", amount: 100, due_day: 10, active: true },
    {
      service_name: "Anual",
      amount: 1200,
      due_day: 29,
      due_month: 2,
      billing_cycle: "annual",
      active: true,
    },
    {
      service_name: "Inactive",
      amount: 600,
      due_day: 10,
      due_month: 2,
      billing_cycle: "annual",
      active: false,
    },
  ];
  assert.deepEqual(recurringTotals(items), { monthly: 100, annual: 1200, monthlyEquivalent: 200 });
  assert.equal(recurringTotal(items), 200);
  assert.equal(recurringIsDueInMonth(items[1], 1), true);
  assert.equal(recurringIsDueInMonth(items[1], 2), false);
  assert.equal(recurringIsDueInMonth(items[0], 2), true);
  assert.equal(recurringIsBilledInPeriod(items[1], "2026-01-01", 2026, 1, "annual"), true);
  assert.equal(recurringIsBilledInPeriod(items[1], "2025-02-01", 2026, 1, "annual"), false);
  assert.equal(recurringIsBilledInPeriod(items[0], "2026-01-01", 2026, 1), false);
});

test("annual client payload validates month while retaining February 29", () => {
  const annual: ClientRecurringService = {
    service_name: "Hospedagem",
    amount: 1200,
    due_day: 29,
    due_month: 2,
    billing_cycle: "annual",
    active: true,
  };
  assert.equal(buildClientRecurringItems([annual])[0].due_day, 29);
  assert.equal(buildClientRecurringItems([annual])[0].due_month, 2);
  assert.equal(recurringDueDate(2027, 1, 29), "2027-02-28");
  assert.equal(recurringDueDate(2028, 1, 29), "2028-02-29");
  assert.throws(() => buildClientRecurringItems([{ ...annual, due_month: null }]), /mês/);
});

test("recurringTotal includes only active services", () => {
  const items: ClientRecurringService[] = [
    { service_name: "Hospedagem", amount: 120, due_day: 10, active: true },
    { service_name: "Social Media/Blogs", amount: 800, due_day: 15, active: true },
    { service_name: "Outro", amount: 500, due_day: 20, active: false },
  ];

  assert.equal(recurringTotal(items), 920);
});
