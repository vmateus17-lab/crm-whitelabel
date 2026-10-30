import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { Download, RefreshCw, AlertCircle } from "lucide-react";
import { UpdatedTooltip } from "@/components/PageHeading";
import { PageHeader } from "@/components/AppLayout";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FilterBar, FilterSelect, FilterPeriod } from "@/components/FilterBar";
import { filterChips } from "@/lib/filter-utils";
import { useListFilters } from "@/lib/list-filters";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL, useAuth } from "@/lib/auth";
import {
  PAYMENT_DATE_BASIS_LABELS,
  getPaymentKind,
  type PaymentDateBasis,
} from "@/lib/payment-metrics";
import { fetchAllRows, isMissingAnalyticsHistory } from "@/lib/query-pagination";
import {
  commercialMetrics,
  financialMetrics,
  getSaoPauloDate,
  dateInRange,
  previousPeriod,
  getRangePreset,
  relativeChange,
  getClientServices,
  type LeadStageEvent,
} from "@/lib/analytics";
import { toast } from "sonner";
import { safeCsvCell } from "@/lib/security";
import { formatDateBR, formatDateTimeBR } from "@/lib/date-format";
import { buildReportCharts, type ReportStage } from "@/lib/report-charts";
import { CommercialReportCharts, FinancialReportChart } from "@/components/ReportCharts";
import { recurringRevenueMetrics, isMissingCommercialSchema } from "@/lib/dashboard-metrics";

export const Route = createFileRoute("/_authenticated/relatorios")({
  component: ReportsPage,
  head: () => ({ meta: [{ title: "CRM | Relatórios" }] }),
});

type ReportTab = "commercial" | "financial" | "clients";
type LeadRow = {
  id: string;
  name: string;
  company?: string | null;
  stage: string;
  estimated_value: number | null;
  source: string | null;
  loss_reason: string | null;
  created_at: string;
  closed_at: string | null;
  services: string[];
};
type PaymentRow = {
  id: string;
  client_id: string | null;
  lead_id?: string | null;
  amount: number;
  status: string;
  due_date: string;
  paid_at: string | null;
  reference_month: string | null;
  payment_type: string;
  recurring_service_id?: string | null;
  recurring_billing_cycle?: "monthly" | "annual";
};
type ClientRow = {
  id: string;
  name: string;
  company?: string | null;
  status: string;
  monthly_value: number | null;
  services: string[];
  source: string | null;
  created_at: string;
  client_recurring_services?: Array<{
    service_name: string;
    active: boolean;
    amount: number;
    billing_cycle?: "monthly" | "annual";
  }>;
};
function ReportsPage() {
  const { user } = useAuth();
  const initialRange = getRangePreset("month");
  const defaults = {
    search: "",
    from: initialRange.from,
    to: initialRange.to,
    tab: "commercial",
    basis: "due",
    source: "all",
    service: "all",
    client: "all",
    type: "all",
  };
  const views = useListFilters(defaults, "reports", user?.id, {
    tab: ["commercial", "financial", "clients"],
    basis: ["due", "paid", "reference"],
    type: ["all", "monthly", "annual", "initial_sale", "one_off", "other"],
  });
  const { filters, setFilter, setFilters, resetFilters } = views;
  const { from, to, source, service, search } = filters;
  const tab = filters.tab as ReportTab;
  const basis = filters.basis as PaymentDateBasis;
  const clientId = filters.client;
  const paymentType = filters.type;
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [stages, setStages] = useState<ReportStage[]>([]);
  const [events, setEvents] = useState<LeadStageEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    const api = supabase as SupabaseClient;
    try {
      const [leadRows, paymentRows, clientRows, stageRows] = await Promise.all([
        fetchAllRows<LeadRow>(
          () =>
            supabase
              .from("leads")
              .select(
                "id,name,company,stage,estimated_value,source,services,loss_reason,created_at,closed_at",
              )
              .is("deleted_at", null)
              .order("id"),
          "os leads",
        ),
        fetchAllRows<PaymentRow>(
          () => supabase.from("payments").select("*").order("id"),
          "os lançamentos",
        ),
        fetchAllRows<ClientRow>(
          () =>
            supabase
              .from("clients")
              .select(
                "id,name,company,status,monthly_value,services,source,created_at,client_recurring_services(service_name,active,amount,billing_cycle)",
              )
              .order("id"),
          "os clientes",
        ),
        fetchAllRows<ReportStage>(
          () =>
            supabase
              .from("pipeline_stages")
              .select("id,stage_key,label,position")
              .order("position")
              .order("id"),
          "as etapas do pipeline",
        ),
      ]);
      let history: LeadStageEvent[] | null = null;
      let warning: string | null = null;
      try {
        history = await fetchAllRows<LeadStageEvent>(
          () =>
            api
              .from("lead_stage_history")
              .select("id,lead_id,to_stage,entered_at,estimated_value_snapshot")
              .order("id"),
          "o histórico comercial",
        );
      } catch (historyError) {
        if (isMissingAnalyticsHistory(historyError)) {
          warning =
            "Histórico de etapas indisponível. Os encerramentos usam a última data salva no lead; reaberturas anteriores não podem ser reconstruídas.";
        } else if (isMissingCommercialSchema(historyError)) {
          history = await fetchAllRows<LeadStageEvent>(
            () =>
              api.from("lead_stage_history").select("id,lead_id,to_stage,entered_at").order("id"),
            "o histórico comercial",
          );
        } else throw historyError;
      }
      setLeads(leadRows);
      setPayments(paymentRows);
      setClients(clientRows.map((client) => ({ ...client, services: getClientServices(client) })));
      setStages(stageRows);
      setEvents(history);
      setHistoryWarning(warning);
      setUpdatedAt(new Date());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar os relatórios. Tente novamente.",
      );
    } finally {
      setLoading(false);
    }
  };
  const loadOnMount = useEffectEvent(load);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOnMount(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const metrics = useMemo(() => {
    const range = { from, to };
    const query = search.trim().toLocaleLowerCase("pt-BR");
    const matches = (person: {
      name: string;
      company?: string | null;
      source: string | null;
      services: string[];
    }) =>
      (!query ||
        `${person.name} ${person.company ?? ""}`.toLocaleLowerCase("pt-BR").includes(query)) &&
      (source === "all" || (person.source || "Não informado") === source) &&
      (service === "all" || person.services?.includes(service));
    const selectedLeads = leads.filter(matches);
    const selectedClients = clients.filter(matches);
    const allowedClients = new Set(selectedClients.map((client) => client.id));
    const allowedLeads = new Set(selectedLeads.map((lead) => lead.id));
    const selectedPayments = payments.filter(
      (payment) =>
        (clientId === "all" || payment.client_id === clientId) &&
        (paymentType === "all" || getPaymentKind(payment) === paymentType) &&
        ((source === "all" && service === "all" && !query) ||
          allowedClients.has(payment.client_id ?? "") ||
          allowedLeads.has(payment.lead_id ?? "")),
    );
    const financial = financialMetrics(selectedPayments, range, basis, getSaoPauloDate());
    const previous = previousPeriod(range);
    const activeClients = selectedClients.filter((client) => client.status === "ativo");
    const newClients = selectedClients.filter((client) => dateInRange(client.created_at, range));
    return {
      charts: buildReportCharts({
        leads: selectedLeads,
        payments: selectedPayments,
        events,
        range,
        basis,
        stages,
      }),
      commercial: commercialMetrics(selectedLeads, events, range),
      financial: {
        ...financial,
        topClients: topClientRevenue(financial.paid, clients),
      },
      clients: {
        active: activeClients.length,
        paused: selectedClients.filter((client) => client.status === "pausado").length,
        former: selectedClients.filter((client) => client.status === "ex_cliente").length,
        mrr: recurringRevenueMetrics(activeClients).mrr,
        newClients: newClients.length,
        sources: groupCount(newClients.map((client) => client.source || "Não informado")),
        mrrBySource: groupSum(
          activeClients.map((client) => [
            client.source || "Não informado",
            recurringRevenueMetrics([client]).mrr,
          ]),
        ),
        services: groupCount(selectedClients.flatMap((client) => client.services ?? [])),
      },
      previous: {
        commercial: commercialMetrics(selectedLeads, events, previous),
        financial: financialMetrics(selectedPayments, previous, basis, getSaoPauloDate()),
        newClients: selectedClients.filter((client) => dateInRange(client.created_at, previous))
          .length,
      },
    };
  }, [
    leads,
    payments,
    clients,
    stages,
    events,
    from,
    to,
    basis,
    source,
    service,
    clientId,
    paymentType,
    search,
  ]);

  const exportCsv = () => {
    const values: Record<ReportTab, Array<[string, number]>> = {
      commercial: [
        ["Leads criados", metrics.commercial.created],
        ["Encerramentos ganhos", metrics.commercial.won],
        ["Encerramentos perdidos", metrics.commercial.lost],
        ["Conversão dos encerramentos (%)", metrics.commercial.conversion],
        ["Ticket médio estimado", metrics.commercial.avgTicket],
        ["Ciclo médio (dias)", metrics.commercial.avgCycle],
      ],
      financial: [
        ["Recebido", metrics.financial.received],
        ["Pendente", metrics.financial.pending],
        ["Em atraso agora", metrics.financial.overdue],
        ["Inadimplência atual (%)", metrics.financial.delinquency],
      ],
      clients: [
        ["Ativos agora", metrics.clients.active],
        ["Pausados agora", metrics.clients.paused],
        ["Ex-clientes agora", metrics.clients.former],
        ["Novos no período", metrics.clients.newClients],
        ["MRR atual", metrics.clients.mrr],
      ],
    };
    const rows: Array<Array<string | number>> = [
      [
        "Período",
        from || to
          ? `${from ? formatDateBR(from) : "início"} a ${to ? formatDateBR(to) : "hoje"}`
          : "Todo o histórico",
      ],
      ...(tab === "financial" ? [["Base financeira", PAYMENT_DATE_BASIS_LABELS[basis]]] : []),
      ["Origem", source],
      ["Serviço", service],
      ...(tab === "financial"
        ? [["Cliente", clients.find((client) => client.id === clientId)?.name || "Todos"]]
        : []),
      ["Busca", search],
      ["Atualizado em", formatDateTimeBR(updatedAt)],
      ["Métrica", "Valor"],
      ...values[tab],
    ];
    const content = "\uFEFF" + rows.map((row) => row.map(csvEscape).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `relatorio-${tab}-${from ? formatDateBR(from).replaceAll("/", "-") : "inicio"}-${to ? formatDateBR(to).replaceAll("/", "-") : "hoje"}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("Relatório exportado.");
  };

  if (loading && !updatedAt) {
    return (
      <div className="page-shell" aria-busy="true">
        <PageHeader title="Relatórios" description="Preparando seus indicadores" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error && !updatedAt) {
    return (
      <div className="page-shell">
        <PageHeader title="Relatórios" description="Não foi possível preparar os indicadores" />
        <LoadError message={error} onRetry={load} />
      </div>
    );
  }

  const sources = [
    ...new Set([...leads, ...clients].map((person) => person.source || "Não informado")),
  ].sort();
  const services = [
    ...new Set([...leads, ...clients].flatMap((person) => person.services || [])),
  ].sort();

  return (
    <div className="page-shell">
      <FilterBar
        title="Relatórios"
        description="Indicadores comerciais, financeiros e de clientes"
        search={{
          value: search,
          onChange: (value) => setFilter("search", value),
          placeholder: "Buscar lead ou cliente...",
        }}
        actions={
          <div className="flex gap-2">
            <UpdatedTooltip updatedAt={updatedAt}>
              <Button
                variant="outline"
                size="icon"
                disabled={loading}
                onClick={() => void load()}
                aria-label="Atualizar relatórios"
              >
                <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                <span className="xl:hidden">Atualizar</span>
              </Button>
            </UpdatedTooltip>
            <Button variant="outline" onClick={exportCsv}>
              <Download className="h-4 w-4 mr-2" />
              Exportar CSV
            </Button>
          </div>
        }
        viewState={views}
        onReset={resetFilters}
        activeFilters={filterChips(
          {
            from,
            to,
            source,
            service,
            ...(tab === "financial" ? { basis, client: clientId, type: paymentType } : {}),
          },
          defaults,
          {
            from: "De",
            to: "Até",
            tab: "Seção",
            basis: "Base",
            source: "Origem",
            service: "Serviço",
            client: "Cliente",
            type: "Tipo",
          },
          (key, value) => setFilter(key as keyof typeof filters, value),
          {
            basis: PAYMENT_DATE_BASIS_LABELS,
            client: Object.fromEntries(clients.map((client) => [client.id, client.name])),
            tab: {
              commercial: "Comercial",
              financial: "Financeiro",
              clients: "Clientes",
            },
          },
        )}
      >
        <FilterPeriod
          from={from}
          to={to}
          onChange={(nextFrom, nextTo) => setFilters({ from: nextFrom, to: nextTo })}
        />
        {tab === "financial" && (
          <FilterSelect
            label="Base financeira"
            value={basis}
            onChange={(value) => setFilter("basis", value)}
            options={Object.entries(PAYMENT_DATE_BASIS_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        )}
        {
          <FilterSelect
            label="Origem"
            value={source}
            onChange={(value) => setFilter("source", value)}
            options={[
              { value: "all", label: "Todas as origens" },
              ...sources.map((value) => ({ value, label: value })),
            ]}
          />
        }
        {
          <FilterSelect
            label="Serviço"
            value={service}
            onChange={(value) => setFilter("service", value)}
            options={[
              { value: "all", label: "Todos os serviços" },
              ...services.map((value) => ({ value, label: value })),
            ]}
          />
        }
        {tab === "financial" && (
          <FilterSelect
            label="Cliente"
            value={clientId}
            onChange={(value) => setFilter("client", value)}
            options={[
              { value: "all", label: "Todos os clientes" },
              ...clients.map((client) => ({ value: client.id, label: client.name })),
            ]}
          />
        )}
        {tab === "financial" && (
          <FilterSelect
            label="Tipo"
            value={paymentType}
            onChange={(value) => setFilter("type", value)}
            options={[
              { value: "all", label: "Todos os tipos" },
              { value: "monthly", label: "Recorrente mensal" },
              { value: "annual", label: "Recorrente anual" },
              { value: "initial_sale", label: "Venda inicial" },
              { value: "one_off", label: "Avulso" },
              { value: "other", label: "Outros" },
            ]}
          />
        )}
      </FilterBar>
      {(error || historyWarning) && (
        <div className="mb-5 space-y-3">
          {error && (
            <LoadError
              message={`A atualização falhou. Os últimos dados carregados foram preservados. ${error}`}
              onRetry={load}
            />
          )}
          {historyWarning && (
            <p
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
            >
              {historyWarning}
            </p>
          )}
        </div>
      )}
      <Tabs value={tab} onValueChange={(value) => setFilter("tab", value)}>
        {tab === "commercial" && metrics.commercial.missingClosureDates > 0 && (
          <p role="status" className="mb-4 rounded-lg border p-4 text-sm text-muted-foreground">
            {metrics.commercial.missingClosureDates} lead(s) encerrado(s) sem data confiável não
            entram nos encerramentos por período. O histórico antigo não foi inventado.
          </p>
        )}
        <TabsList className="w-full justify-start overflow-x-auto h-auto p-1 mb-6">
          <TabsTrigger value="commercial">Comercial</TabsTrigger>
          <TabsTrigger value="financial">Financeiro</TabsTrigger>
          <TabsTrigger value="clients">Clientes</TabsTrigger>
        </TabsList>
        <TabsContent value="commercial">
          <MetricGrid
            metrics={[
              ["Leads criados", metrics.commercial.created],
              ["Encerramentos ganhos", metrics.commercial.won],
              ["Encerramentos perdidos", metrics.commercial.lost],
              ["Conversão dos encerramentos", metrics.commercial.conversion, formatPercent],
              ["Ticket médio estimado", metrics.commercial.avgTicket, formatBRL],
              ["Ciclo médio", metrics.commercial.avgCycle, formatDays],
            ]}
            previousValues={
              from && to
                ? [
                    metrics.previous.commercial.created,
                    metrics.previous.commercial.won,
                    metrics.previous.commercial.lost,
                    metrics.previous.commercial.conversion,
                    metrics.previous.commercial.avgTicket,
                    metrics.previous.commercial.avgCycle,
                  ]
                : []
            }
          />
          <EmptyInsight text="Conversão = ganhos ÷ encerramentos ganhos e perdidos. Reaberturas não apagam eventos anteriores. Valores usam o histórico do encerramento quando disponível; registros antigos usam a estimativa atual do lead. Não são pagamentos recebidos." />
          <div className="mb-4">
            <CommercialReportCharts data={metrics.charts} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Ranking title="Origem dos leads" rows={metrics.commercial.sources} />
            <Ranking title="Motivos de perda" rows={metrics.commercial.losses} />
            <Ranking title="Serviços de interesse" rows={metrics.charts.interests} />
          </div>
        </TabsContent>
        <TabsContent value="financial">
          <MetricGrid
            metrics={[
              ["Recebido", metrics.financial.received, formatBRL],
              ["Pendente", metrics.financial.pending, formatBRL],
              ["Em atraso agora", metrics.financial.overdue, formatBRL],
              ["Inadimplência atual", metrics.financial.delinquency, formatPercent],
            ]}
            previousValues={from && to ? [metrics.previous.financial.received] : []}
          />
          <EmptyInsight
            text={`Recebido por ${PAYMENT_DATE_BASIS_LABELS[basis].toLowerCase()}. Pendentes e atrasos são a situação atual dos lançamentos com ${PAYMENT_DATE_BASIS_LABELS[metrics.financial.obligationBasis].toLowerCase()} no período. Não representam o saldo em aberto naquela época.${metrics.financial.missingBasis ? ` ${metrics.financial.missingBasis} lançamento(s) sem data de ${PAYMENT_DATE_BASIS_LABELS[basis].toLowerCase()} não entram no respectivo total.` : ""}`}
          />
          <Ranking
            title="Clientes por receita recebida"
            rows={metrics.financial.topClients.map((row) => [row.label, formatBRL(row.value)])}
          />
          <div className="mt-4">
            <FinancialReportChart data={metrics.charts} basis={basis} />
          </div>
        </TabsContent>
        <TabsContent value="clients">
          <MetricGrid
            metrics={[
              ["Ativos agora", metrics.clients.active],
              ["Pausados agora", metrics.clients.paused],
              ["Ex-clientes agora", metrics.clients.former],
              ["Novos no período", metrics.clients.newClients],
              ["MRR atual", metrics.clients.mrr, formatBRL],
            ]}
            previousValues={
              from && to ? [undefined, undefined, undefined, metrics.previous.newClients] : []
            }
          />
          <EmptyInsight text="Status e MRR são a fotografia atual dos clientes. MRR soma apenas contratos mensais ativos de clientes ativos; anuais não entram. Somente novos clientes seguem o período escolhido." />
          <Ranking title="Novos clientes por origem" rows={metrics.clients.sources} />
          <Ranking
            title="MRR atual por origem"
            rows={metrics.clients.mrrBySource.map(([source, value]) => [source, formatBRL(value)])}
          />
          <Ranking title="Serviços contratados" rows={metrics.clients.services} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MetricGrid({
  metrics,
  previousValues = [],
}: {
  metrics: Array<[string, number, ((value: number) => string)?]>;
  previousValues?: Array<number | undefined>;
}) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
      {metrics.map(([label, value, formatter], index) => (
        <Card key={label} className="min-w-0 p-4 shadow-none sm:p-5">
          <div className="mb-3 flex min-w-0 items-start justify-between gap-2 text-[10px] uppercase tracking-wider text-muted-foreground sm:text-xs">
            <span className="min-w-0 leading-snug">{label}</span>
          </div>
          <div className="truncate text-xl font-semibold tabular-nums sm:text-2xl">
            <AnimatedNumber value={value} formatter={formatter} />
          </div>
          {previousValues[index] !== undefined && (
            <div className="mt-2 text-xs text-muted-foreground">
              Anterior: {formatter ? formatter(previousValues[index]!) : previousValues[index]}
              <span className="ml-2">{formatChange(value, previousValues[index]!)}</span>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function Ranking({ title, rows }: { title: string; rows: Array<[string, number | string]> }) {
  const maxValue = Math.max(0, ...rows.map(([, value]) => (typeof value === "number" ? value : 0)));
  return (
    <Card className="p-5 shadow-none">
      <h2 className="font-semibold mb-4">{title}</h2>
      <div className="space-y-2">
        {rows.slice(0, 10).map(([label, value], index) => (
          <div
            key={`${label}-${index}`}
            className="relative flex min-h-10 items-center justify-between overflow-hidden rounded-md px-2 text-sm"
          >
            {typeof value === "number" && maxValue > 0 && (
              <span
                className="absolute inset-y-0 left-0 rounded-md bg-muted"
                style={{ width: `${Math.max(4, (value / maxValue) * 100)}%` }}
                aria-hidden="true"
              />
            )}
            <span className="relative z-10 truncate mr-4">{label}</span>
            <strong className="relative z-10 tabular-nums">{value}</strong>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">Sem dados neste período.</p>
        )}
      </div>
    </Card>
  );
}

function EmptyInsight({ text }: { text: string }) {
  return (
    <Card className="mb-4 p-5 shadow-none bg-muted/30 text-sm leading-relaxed text-muted-foreground">
      {text}
    </Card>
  );
}
function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}
function formatDays(value: number) {
  return `${Math.round(value)} dias`;
}
function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
function groupCount(values: string[]): Array<[string, number]> {
  const map = new Map<string, number>();
  values.forEach((value) => map.set(value, (map.get(value) ?? 0) + 1));
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}
function groupSum(values: Array<[string, number]>): Array<[string, number]> {
  const map = new Map<string, number>();
  values.forEach(([label, value]) => map.set(label, (map.get(label) ?? 0) + value));
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}
function topClientRevenue(payments: PaymentRow[], clients: ClientRow[]) {
  const names = new Map(clients.map((client) => [client.id, client.name]));
  const totals = new Map<string, number>();
  payments.forEach((payment) => {
    const key = payment.client_id ?? "sem-cliente";
    totals.set(key, (totals.get(key) ?? 0) + Number(payment.amount));
  });
  return [...totals.entries()]
    .map(([id, value]) => ({ label: names.get(id) ?? "Sem cliente vinculado", value }))
    .sort((a, b) => b.value - a.value);
}
function csvEscape(value: string | number) {
  return safeCsvCell(value);
}
function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card role="alert" className="flex flex-wrap items-center gap-3 border-destructive/30 p-4">
      <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
      <p className="min-w-0 flex-1 text-sm">{message}</p>
      <Button variant="outline" onClick={onRetry}>
        Tentar novamente
      </Button>
    </Card>
  );
}
function formatChange(current: number, previous: number) {
  const change = relativeChange(current, previous);
  return change === null ? "Sem base anterior" : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
}
