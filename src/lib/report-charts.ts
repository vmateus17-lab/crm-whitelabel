import {
  commercialMetrics,
  dateInRange,
  financialMetrics,
  getSaoPauloDate,
  groupCount,
  monthRange,
  type AnalyticsLead,
  type DateInterval,
  type LeadStageEvent,
} from "./analytics.ts";
import { formatDateBR, formatMonthBR } from "./date-format.ts";
import type { PaymentDateBasis, PaymentMetricInput } from "./payment-metrics.ts";

export type ReportStage = { stage_key: string; label: string; position: number };

const defaultStages = [
  ["novo", "Novos"],
  ["contatado", "Contatados"],
  ["proposta", "Propostas"],
  ["negociacao", "Negociação"],
  ["ganho", "Ganhos"],
  ["perdido", "Perdidos"],
] as const;

export function reportChartMonths(range: DateInterval, today = getSaoPauloDate()) {
  const ending = range.to || today;
  const [year, month] = ending.split("-").map(Number);
  const beginning = range.from || monthRange(year, month - 6).from;
  const [startYear, startMonth] = beginning.split("-").map(Number);
  const duration = (year - startYear) * 12 + month - startMonth + 1;
  const count = Math.min(Math.max(duration, 1), 36);
  return Array.from({ length: count }, (_, index) => {
    const bucket = monthRange(year, month - count + index);
    return { range: bucket, label: formatMonthBR(bucket.from) };
  });
}

function intersectRanges(month: DateInterval, selected: DateInterval): DateInterval {
  return {
    from: selected.from && selected.from > month.from ? selected.from : month.from,
    to: selected.to && selected.to < month.to ? selected.to : month.to,
  };
}

/** Charts and report cards use exactly the same filtered records and metric functions. */
export function buildReportCharts({
  leads,
  payments,
  events,
  range,
  basis,
  stages = [],
  today = getSaoPauloDate(),
}: {
  leads: AnalyticsLead[];
  payments: PaymentMetricInput[];
  events: LeadStageEvent[] | null;
  range: DateInterval;
  basis: PaymentDateBasis;
  stages?: ReportStage[];
  today?: string;
}) {
  const months = reportChartMonths(range, today);
  const created = leads.filter((lead) => dateInRange(lead.created_at, range));
  const configured = [...stages].sort((a, b) => a.position - b.position);
  const stageLabels = new Map(configured.map((stage) => [stage.stage_key, stage.label]));
  for (const [key, label] of defaultStages) if (!stageLabels.has(key)) stageLabels.set(key, label);
  for (const lead of created)
    if (!stageLabels.has(lead.stage)) stageLabels.set(lead.stage, lead.stage);
  return {
    financial: months.map((month) => {
      const values = financialMetrics(payments, intersectRanges(month.range, range), basis, today);
      return { mes: month.label, recebido: values.received, atrasado: values.overdue };
    }),
    acquisition: months.map((month) => {
      const values = commercialMetrics(leads, events, intersectRanges(month.range, range));
      return { mes: month.label, criados: values.created, ganhos: values.won };
    }),
    pipeline: [...stageLabels].map(([stage, etapa]) => ({
      etapa,
      quantidade: created.filter((lead) => lead.stage === stage).length,
    })),
    interests: groupCount(created.flatMap((lead) => [...new Set(lead.services ?? [])])),
    caption: months.length
      ? `${formatDateBR(intersectRanges(months[0].range, range).from)} a ${formatDateBR(intersectRanges(months.at(-1)!.range, range).to)}${months.length === 36 ? " · últimos 36 meses do período" : ""}`
      : "",
  };
}

export type ReportChartsData = ReturnType<typeof buildReportCharts>;
