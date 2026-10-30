import {
  getEffectivePaymentStatus,
  isPaidPayment,
  isPaymentInRange,
  sumPaymentAmounts,
  type PaymentDateBasis,
  type PaymentMetricInput,
} from "./payment-metrics.ts";

export type DateInterval = { from: string; to: string };
export type AnalyticsLead = {
  id: string;
  stage: string;
  estimated_value: number | null;
  created_at: string;
  closed_at: string | null;
  source?: string | null;
  services?: string[];
  loss_reason?: string | null;
};
export type LeadStageEvent = {
  id: string;
  lead_id: string;
  to_stage: string;
  entered_at: string;
  estimated_value_snapshot?: number | null;
};
export type AnalyticsQuote = {
  id: string;
  status: string;
  total: number;
  issue_date: string;
  sent_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
};

export function getClientServices(client: {
  services?: string[];
  client_recurring_services?: Array<{ service_name: string; active: boolean }>;
}) {
  return [
    ...new Set([
      ...(client.services ?? []),
      ...(client.client_recurring_services ?? [])
        .filter((item) => item.active)
        .map((item) => item.service_name),
    ]),
  ];
}

export function getSaoPauloDate(value: string | Date = new Date()) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function dateInRange(value: string | null | undefined, range: DateInterval) {
  const date = value ? getSaoPauloDate(value) : "";
  return Boolean(date && (!range.from || date >= range.from) && (!range.to || date <= range.to));
}

export function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function monthRange(year: number, month: number, throughToday = false): DateInterval {
  const from = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const monthEnd = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  const today = getSaoPauloDate();
  return { from, to: throughToday && today >= from && today <= monthEnd ? today : monthEnd };
}

export function previousPeriod(range: DateInterval): DateInterval {
  if (!range.from || !range.to) return { from: "", to: "" };
  const duration =
    Math.round(
      (Date.parse(`${range.to}T12:00:00Z`) - Date.parse(`${range.from}T12:00:00Z`)) / 86400000,
    ) + 1;
  return { from: shiftDate(range.from, -duration), to: shiftDate(range.from, -1) };
}

export function getRangePreset(
  preset: "month" | "previousMonth" | "7days" | "30days" | "90days" | "year",
  today = getSaoPauloDate(),
): DateInterval {
  const [year, month] = today.split("-").map(Number);
  if (preset === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (preset === "previousMonth") return monthRange(year, month - 2);
  if (preset === "year") return { from: `${year}-01-01`, to: today };
  const days = preset === "7days" ? 7 : preset === "30days" ? 30 : 90;
  return { from: shiftDate(today, -(days - 1)), to: today };
}

export function relativeChange(current: number, previous: number) {
  return previous === 0 ? null : ((current - previous) / Math.abs(previous)) * 100;
}

export function groupCount(values: string[]): Array<[string, number]> {
  const groups = new Map<string, number>();
  values.forEach((value) => groups.set(value, (groups.get(value) ?? 0) + 1));
  return [...groups.entries()].sort((a, b) => b[1] - a[1]);
}

export function commercialMetrics(
  leads: AnalyticsLead[],
  events: LeadStageEvent[] | null,
  range: DateInterval,
) {
  const byId = new Map(leads.map((lead) => [lead.id, lead]));
  const terminalIds = new Set(
    events
      ?.filter((event) => ["ganho", "perdido"].includes(event.to_stage))
      .map((event) => event.lead_id),
  );
  const outcomes: AnalyticsLead[] = (events ?? [])
    .filter(
      (event) =>
        ["ganho", "perdido"].includes(event.to_stage) &&
        dateInRange(event.entered_at, range) &&
        byId.has(event.lead_id),
    )
    .map((event) => ({
      ...byId.get(event.lead_id)!,
      estimated_value: event.estimated_value_snapshot ?? byId.get(event.lead_id)!.estimated_value,
      stage: event.to_stage,
      closed_at: event.entered_at,
    }));
  // Registros antigos sem evento de encerramento continuam visíveis por closed_at.
  outcomes.push(
    ...leads.filter(
      (lead) =>
        !terminalIds.has(lead.id) &&
        ["ganho", "perdido"].includes(lead.stage) &&
        dateInRange(lead.closed_at, range),
    ),
  );
  const won = outcomes.filter((lead) => lead.stage === "ganho");
  const lost = outcomes.filter((lead) => lead.stage === "perdido");
  const created = leads.filter((lead) => dateInRange(lead.created_at, range));
  const avg = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return {
    created: created.length,
    missingClosureDates: leads.filter(
      (lead) =>
        ["ganho", "perdido"].includes(lead.stage) &&
        !terminalIds.has(lead.id) &&
        (!lead.closed_at || !getSaoPauloDate(lead.closed_at)),
    ).length,
    won: won.length,
    lost: lost.length,
    conversion: outcomes.length ? (won.length / outcomes.length) * 100 : 0,
    avgTicket: avg(won.map((lead) => Number(lead.estimated_value ?? 0))),
    avgCycle: avg(
      won.map((lead) =>
        Math.max(0, (Date.parse(lead.closed_at!) - Date.parse(lead.created_at)) / 86400000),
      ),
    ),
    wonValue: sumPaymentAmounts(won.map((lead) => ({ amount: lead.estimated_value }))),
    lostValue: sumPaymentAmounts(lost.map((lead) => ({ amount: lead.estimated_value }))),
    sources: groupCount(created.map((lead) => lead.source || "Não informado")),
    losses: groupCount(lost.map((lead) => lead.loss_reason || "Não informado")),
    outcomes,
  };
}

export function financialMetrics<T extends PaymentMetricInput>(
  payments: T[],
  range: DateInterval,
  basis: PaymentDateBasis,
  today: string,
) {
  const paid = payments.filter(
    (payment) => isPaidPayment(payment) && isPaymentInRange(payment, range.from, range.to, basis),
  );
  // Não há data de recebimento para um valor em aberto: nesta base, a agenda permanece por vencimento.
  const obligationBasis = basis === "paid" ? "due" : basis;
  const period = payments.filter((payment) =>
    isPaymentInRange(payment, range.from, range.to, obligationBasis),
  );
  const pending = period.filter(
    (payment) => getEffectivePaymentStatus(payment, today) === "pendente",
  );
  const overdue = period.filter(
    (payment) => getEffectivePaymentStatus(payment, today) === "atrasado",
  );
  const total = sumPaymentAmounts(period);
  return {
    received: sumPaymentAmounts(paid),
    pending: sumPaymentAmounts(pending),
    overdue: sumPaymentAmounts(overdue),
    delinquency: total ? (sumPaymentAmounts(overdue) / total) * 100 : 0,
    paid,
    obligationBasis,
    missingBasis: payments.filter((payment) =>
      basis === "reference"
        ? !payment.reference_month
        : basis === "paid" && isPaidPayment(payment)
          ? !payment.paid_at
          : false,
    ).length,
  };
}

export function quoteMetrics(quotes: AnalyticsQuote[], range: DateInterval) {
  const issued = quotes.filter((quote) => dateInRange(quote.issue_date, range));
  const sent = quotes.filter((quote) => dateInRange(quote.sent_at, range));
  const accepted = quotes.filter((quote) => dateInRange(quote.accepted_at, range));
  const rejected = quotes.filter((quote) => dateInRange(quote.rejected_at, range));
  return {
    created: issued.length,
    sent: sent.length,
    accepted: accepted.length,
    rejected: rejected.length,
    conversion:
      accepted.length + rejected.length
        ? (accepted.length / (accepted.length + rejected.length)) * 100
        : 0,
    total: issued.reduce((sum, quote) => sum + Number(quote.total), 0),
    acceptedValue: accepted.reduce((sum, quote) => sum + Number(quote.total), 0),
    missingEventDates: quotes.filter(
      (quote) =>
        (quote.status === "sent" && !quote.sent_at) ||
        (quote.status === "accepted" && !quote.accepted_at) ||
        (quote.status === "rejected" && !quote.rejected_at),
    ).length,
  };
}
