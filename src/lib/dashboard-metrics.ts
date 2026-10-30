import { getSaoPauloDate, type AnalyticsLead } from "./analytics.ts";
import { isPaidPayment, type PaymentMetricInput } from "./payment-metrics.ts";
import type { RecurringBillingCycle } from "./recurring-services.ts";

type RecurringClient = {
  id: string;
  status: string;
  client_recurring_services?: Array<{
    active: boolean;
    amount: number;
    billing_cycle?: RecurringBillingCycle;
  }>;
};
export type ForecastStage = { stage_key: string; label: string; position: number };
export type StageProbability = { stage_key: string; probability: number };
export type CommercialTarget = { month: string; target_amount: number };

function positiveCents(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
}

/** MRR is deliberately monthly-only. Annual contracts belong to ARR, not MRR. */
export function recurringRevenueMetrics(clients: RecurringClient[]) {
  let monthly = 0;
  let annual = 0;
  const monthlyClients = new Set<string>();
  for (const client of clients) {
    if (client.status !== "ativo") continue;
    let clientMonthly = 0;
    for (const item of client.client_recurring_services ?? []) {
      if (!item.active) continue;
      const cents = positiveCents(item.amount);
      if (item.billing_cycle === "annual") annual += cents;
      else clientMonthly += cents;
    }
    monthly += clientMonthly;
    if (clientMonthly > 0) monthlyClients.add(client.id);
  }
  return {
    mrr: monthly / 100,
    arr: (monthly * 12 + annual) / 100,
    monthlyClients: monthlyClients.size,
    averageTicket: monthlyClients.size ? monthly / 100 / monthlyClients.size : 0,
  };
}

const defaultOpenStages: ForecastStage[] = [
  { stage_key: "novo", label: "Novos", position: 0 },
  { stage_key: "contatado", label: "Contatados", position: 1 },
  { stage_key: "proposta", label: "Propostas", position: 2 },
  { stage_key: "negociacao", label: "Negociação", position: 3 },
];

export function forecastStages(stages: ForecastStage[], leads: AnalyticsLead[]) {
  const mapped = new Map(
    [...stages, ...defaultOpenStages]
      .filter((stage) => !["ganho", "perdido"].includes(stage.stage_key))
      .map((stage) => [stage.stage_key, stage]),
  );
  // Preserve the user's labels and order; defaults only fill absent stage keys.
  for (const stage of stages)
    if (!["ganho", "perdido"].includes(stage.stage_key)) mapped.set(stage.stage_key, stage);
  for (const lead of leads)
    if (!["ganho", "perdido"].includes(lead.stage) && !mapped.has(lead.stage))
      mapped.set(lead.stage, { stage_key: lead.stage, label: lead.stage, position: mapped.size });
  return [...mapped.values()].sort((a, b) => a.position - b.position);
}

/** Missing probabilities never silently become 0% or arbitrary defaults. */
export function pipelineForecast(
  leads: Array<AnalyticsLead & { deleted_at?: string | null }>,
  probabilities: StageProbability[],
) {
  const byStage = new Map(
    probabilities
      .filter(
        (row) =>
          Number.isFinite(Number(row.probability)) &&
          Number(row.probability) >= 0 &&
          Number(row.probability) <= 100,
      )
      .map((row) => [row.stage_key, Number(row.probability)]),
  );
  const open = leads.filter(
    (lead) => !lead.deleted_at && !["ganho", "perdido"].includes(lead.stage),
  );
  const missingStages = [
    ...new Set(open.filter((lead) => !byStage.has(lead.stage)).map((lead) => lead.stage)),
  ];
  const cents = open.reduce(
    (total, lead) =>
      total + (positiveCents(lead.estimated_value) * (byStage.get(lead.stage) ?? 0)) / 100,
    0,
  );
  return {
    value: missingStages.length ? null : Math.round(cents) / 100,
    missingStages,
    openCount: open.length,
  };
}

/** Only actual receipts count: neither pipeline wins nor unpaid recurring contracts are revenue. */
export function monthlyReceivedRevenue(
  payments: ReadonlyArray<Pick<PaymentMetricInput, "amount" | "status" | "paid_at">>,
  month: string,
) {
  let cents = 0;
  let missingReceiptDates = 0;
  for (const payment of payments) {
    if (!isPaidPayment(payment)) continue;
    const date = payment.paid_at ? getSaoPauloDate(payment.paid_at) : "";
    const timestamp = date ? Date.parse(`${date}T12:00:00Z`) : NaN;
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
      missingReceiptDates += 1;
      continue;
    }
    if (date.slice(0, 7) === month) cents += positiveCents(payment.amount);
  }
  return { value: cents / 100, missingReceiptDates };
}

export function commercialGoalProgress(realized: number, target: number | null) {
  if (target === null || !Number.isFinite(target) || target <= 0) return null;
  const value = Math.max(0, realized);
  const percent = Math.round((value / target) * 1000) / 10;
  return {
    percent,
    barPercent: Math.min(percent, 100),
    remaining: Math.max(0, Math.round((target - value) * 100) / 100),
  };
}

export function parseCommercialAmount(value: string) {
  const text = value.trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return null;
  const amount = Number(text.replace(",", "."));
  return Number.isFinite(amount) && amount > 0 && amount <= 9999999999.99 ? amount : null;
}

export function parseStageProbability(value: string) {
  const text = value.trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return null;
  const probability = Number(text.replace(",", "."));
  return Number.isFinite(probability) && probability >= 0 && probability <= 100
    ? probability
    : null;
}

export function isMissingCommercialSchema(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : "";
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(String(code));
}
