import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL, useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { DashboardCommercial } from "@/components/DashboardCommercial";
import { isMissingCommercialSchema, type ForecastStage } from "@/lib/dashboard-metrics";
import { FilterBar, FilterPeriod, FilterSelect } from "@/components/FilterBar";
import { filterChips, getDatePreset } from "@/lib/filter-utils";
import { useListFilters } from "@/lib/list-filters";
import { formatTimeBR } from "@/lib/date-format";
import { fetchAllRows, isMissingAnalyticsHistory } from "@/lib/query-pagination";
import { PAYMENT_DATE_BASIS_LABELS, type PaymentDateBasis } from "@/lib/payment-metrics";
import {
  commercialMetrics,
  financialMetrics,
  dateInRange,
  getSaoPauloDate,
  getClientServices,
  type LeadStageEvent,
} from "@/lib/analytics";
import {
  Inbox,
  Handshake,
  Trophy,
  XCircle,
  RefreshCw,
  AlertCircle,
  ArrowUpRight,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
  head: () => ({ meta: [{ title: "CRM | Dashboard" }] }),
});

interface Lead {
  id: string;
  name: string;
  company?: string | null;
  stage: string;
  estimated_value: number | null;
  created_at: string;
  closed_at: string | null;
  source: string | null;
  services: string[];
}
interface PaymentMetric {
  id: string;
  client_id: string | null;
  lead_id?: string | null;
  amount: number;
  status: string;
  due_date: string;
  paid_at: string | null;
  reference_month: string | null;
}
interface ClientMetric {
  id: string;
  name: string;
  company?: string | null;
  status: string;
  monthly_value: number | null;
  source: string | null;
  services: string[];
  client_recurring_services?: Array<{
    service_name: string;
    active: boolean;
    amount: number;
    billing_cycle?: "monthly" | "annual";
  }>;
}

function DashboardPage() {
  const { user } = useAuth();
  const initialRange = getDatePreset("month");
  const defaults = {
    search: "",
    from: initialRange.from,
    to: initialRange.to,
    basis: "due",
    source: "all",
    service: "all",
  };
  const views = useListFilters(defaults, "dashboard", user?.id, {
    basis: ["due", "paid", "reference"],
  });
  const { filters, setFilter, setFilters, resetFilters } = views;
  const { from, to, source, service, search } = filters;
  const basis = filters.basis as PaymentDateBasis;
  const [allClients, setAllClients] = useState<ClientMetric[]>([]);
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [allPayments, setAllPayments] = useState<PaymentMetric[]>([]);
  const [events, setEvents] = useState<LeadStageEvent[] | null>(null);
  const [stages, setStages] = useState<ForecastStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    const api = supabase as SupabaseClient;
    try {
      const [clients, payments, leads, stageRows] = await Promise.all([
        fetchAllRows<ClientMetric>(
          () =>
            supabase
              .from("clients")
              .select(
                "id,name,company,monthly_value,status,source,services,client_recurring_services(service_name,active,amount,billing_cycle)",
              )
              .order("id"),
          "os clientes",
        ),
        fetchAllRows<PaymentMetric>(
          () => supabase.from("payments").select("*").order("id"),
          "os lançamentos",
        ),
        fetchAllRows<Lead>(
          () =>
            supabase
              .from("leads")
              .select("id,name,company,stage,estimated_value,created_at,closed_at,source,services")
              .is("deleted_at", null)
              .order("id"),
          "os leads",
        ),
        fetchAllRows<ForecastStage>(
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
      let historyWarning: string | null = null;
      try {
        history = await fetchAllRows<LeadStageEvent>(
          () =>
            api
              .from("lead_stage_history")
              .select("id,lead_id,to_stage,entered_at,estimated_value_snapshot")
              .order("id"),
          "o histórico comercial",
        );
      } catch (cause) {
        if (isMissingAnalyticsHistory(cause)) {
          historyWarning =
            "Histórico de etapas indisponível. Ganhos e perdas usam a última data salva no lead; reaberturas anteriores não podem ser reconstruídas.";
        } else if (isMissingCommercialSchema(cause)) {
          history = await fetchAllRows<LeadStageEvent>(
            () =>
              api.from("lead_stage_history").select("id,lead_id,to_stage,entered_at").order("id"),
            "o histórico comercial",
          );
        } else throw cause;
      }
      setAllClients(clients.map((client) => ({ ...client, services: getClientServices(client) })));
      setAllPayments(payments);
      setAllLeads(leads);
      setEvents(history);
      setStages(stageRows);
      setWarning(historyWarning);
      setUpdatedAt(new Date());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar o dashboard. Tente novamente.",
      );
    } finally {
      setLoading(false);
    }
  };
  const loadDashboard = useEffectEvent(loadStats);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadDashboard(), 0);
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
    const leads = allLeads.filter(matches);
    const clients = allClients.filter(matches);
    const ids = new Set(clients.map((client) => client.id));
    const leadIds = new Set(leads.map((lead) => lead.id));
    const payments = allPayments.filter(
      (payment) =>
        (source === "all" && service === "all" && !query) ||
        ids.has(payment.client_id ?? "") ||
        leadIds.has(payment.lead_id ?? ""),
    );
    const active = clients.filter((client) => client.status === "ativo");
    const created = leads.filter((lead) => dateInRange(lead.created_at, range));
    const open = created.filter((lead) => !["ganho", "perdido"].includes(lead.stage));
    const negotiation = open.filter((lead) => lead.stage === "negociacao");
    const commercial = commercialMetrics(leads, events, range);
    const financial = financialMetrics(payments, range, basis, getSaoPauloDate());
    const total = (rows: Lead[]) =>
      rows.reduce((sum, lead) => sum + Number(lead.estimated_value ?? 0), 0);
    return {
      commercial,
      financial,
      clients,
      leads,
      activeClients: active.length,
      open: { count: open.length, value: total(open) },
      negotiation: { count: negotiation.length, value: total(negotiation) },
    };
  }, [allClients, allLeads, allPayments, events, from, to, source, service, basis, search]);

  const sources = [
    ...new Set([...allLeads, ...allClients].map((person) => person.source || "Não informado")),
  ].sort();
  const services = [
    ...new Set([...allLeads, ...allClients].flatMap((person) => person.services || [])),
  ].sort();
  const link = (path: string, values: Record<string, string> = {}) =>
    `${path}?${new URLSearchParams({ from, to, source, service, search, ...values })}`;
  const mainStats = [
    {
      key: "received",
      label: "Recebido no período",
      value: metrics.financial.received,
      currency: true,
      href: link("/financeiro", { basis, status: "pago" }),
    },
    {
      key: "active_clients",
      label: "Clientes ativos",
      value: metrics.activeClients,
      currency: false,
      href: link("/clientes", { from: "", to: "", status: "ativo" }),
    },
  ];
  const pipelineStats = [
    {
      label: "Abertos criados no período",
      ...metrics.open,
      icon: Inbox,
      href: link("/pipeline", { stage: "open", dateBasis: "created" }),
    },
    {
      label: "Em negociação agora",
      ...metrics.negotiation,
      icon: Handshake,
      href: link("/pipeline", { stage: "negociacao", dateBasis: "created" }),
    },
    {
      label: "Encerramentos ganhos",
      count: metrics.commercial.won,
      value: metrics.commercial.wonValue,
      icon: Trophy,
      href: link("/pipeline", { stage: "ganho", dateBasis: "closed", history: "ganho" }),
    },
    {
      label: "Encerramentos perdidos",
      count: metrics.commercial.lost,
      value: metrics.commercial.lostValue,
      icon: XCircle,
      href: link("/pipeline", { stage: "perdido", dateBasis: "closed", history: "perdido" }),
    },
  ];

  if (loading && !updatedAt)
    return (
      <div className="page-shell" aria-busy="true" aria-label="Carregando Dashboard">
        <PageHeader title="Dashboard" description="Preparando os indicadores da operação" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton
              key={index}
              className={`h-40 rounded-xl ${index === 2 ? "max-lg:col-span-2" : ""}`}
            />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-32 rounded-xl" />
          ))}
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    );
  if (error && !updatedAt)
    return (
      <div className="page-shell">
        <PageHeader title="Dashboard" description="Os indicadores não puderam ser carregados" />
        <DashboardError message={error} onRetry={loadStats} />
      </div>
    );

  return (
    <div className="page-shell">
      <FilterBar
        title="Dashboard"
        description="Visão geral da sua operação"
        status={updatedAt ? `Atualizado ${formatTimeBR(updatedAt)}` : undefined}
        search={{
          value: search,
          onChange: (value) => setFilter("search", value),
          placeholder: "Buscar lead ou cliente...",
        }}
        actions={
          <Button variant="outline" onClick={() => void loadStats()} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            <span>Atualizar</span>
          </Button>
        }
        viewState={views}
        onReset={resetFilters}
        activeFilters={filterChips(
          filters,
          defaults,
          { from: "De", to: "Até", basis: "Base", source: "Origem", service: "Serviço" },
          (key, value) => setFilter(key as keyof typeof filters, value),
          { basis: PAYMENT_DATE_BASIS_LABELS },
        )}
      >
        <FilterPeriod
          from={from}
          to={to}
          onChange={(nextFrom, nextTo) => setFilters({ from: nextFrom, to: nextTo })}
        />
        <FilterSelect
          label="Base financeira"
          value={basis}
          onChange={(value) => setFilter("basis", value)}
          options={Object.entries(PAYMENT_DATE_BASIS_LABELS).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        <FilterSelect
          label="Origem"
          value={source}
          onChange={(value) => setFilter("source", value)}
          options={[
            { value: "all", label: "Todas as origens" },
            ...sources.map((value) => ({ value, label: value })),
          ]}
        />
        <FilterSelect
          label="Serviço"
          value={service}
          onChange={(value) => setFilter("service", value)}
          options={[
            { value: "all", label: "Todos os serviços" },
            ...services.map((value) => ({ value, label: value })),
          ]}
        />
      </FilterBar>
      {error && (
        <DashboardError
          message={`A atualização falhou; os últimos dados foram preservados. ${error}`}
          onRetry={loadStats}
        />
      )}
      {warning && (
        <p
          role="status"
          className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
        >
          {warning}
        </p>
      )}
      {metrics.financial.missingBasis > 0 && (
        <p role="status" className="mb-5 text-sm text-muted-foreground">
          {metrics.financial.missingBasis} lançamento(s) sem data de{" "}
          {PAYMENT_DATE_BASIS_LABELS[basis].toLowerCase()} não entram no recebido desta base.
        </p>
      )}
      {metrics.commercial.missingClosureDates > 0 && (
        <p role="status" className="mb-5 text-sm text-muted-foreground">
          {metrics.commercial.missingClosureDates} lead(s) encerrado(s) sem data confiável não
          entram nos encerramentos por período. O histórico antigo não foi inventado.
        </p>
      )}
      <DashboardCommercial
        clients={metrics.clients}
        leads={metrics.leads}
        allLeads={allLeads}
        payments={allPayments}
        stages={stages}
        userId={user?.id}
        reloadKey={updatedAt?.getTime() ?? 0}
        overviewCards={mainStats.map((stat) => (
          <a
            key={stat.key}
            href={stat.href}
            data-dashboard-metric={stat.key}
            className="group min-w-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="@container h-full min-w-0 gap-0 border-border p-4 shadow-none transition-colors group-hover:bg-muted/30 sm:p-5">
              <div className="mb-4 flex min-h-10 items-start justify-between gap-1">
                <h2 className="min-w-0 break-words pt-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:text-xs">
                  {stat.label}
                </h2>
                <ArrowUpRight className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              <div className="text-[clamp(0.875rem,11.5cqw,1.5rem)] font-semibold leading-snug tracking-tight">
                <AnimatedNumber
                  value={stat.value}
                  formatter={
                    stat.currency
                      ? (value) => formatBRL(value).replaceAll("\u00a0", " ")
                      : undefined
                  }
                />
              </div>
            </Card>
          </a>
        ))}
      />
      <section className="mb-8" aria-label="Dados do Pipeline">
        <div className="mb-4">
          <h2 className="text-base font-semibold">Dados do Pipeline</h2>
        </div>
        <div data-dashboard-row="pipeline" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {pipelineStats.map((stat) => (
            <a
              key={stat.label}
              href={stat.href}
              className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="h-full border-border p-4 shadow-none transition-colors group-hover:bg-muted/30 sm:p-5">
                <div className="mb-3 flex min-h-10 items-start justify-between gap-2 lg:min-h-16 xl:min-h-10">
                  <span className="text-[10px] font-medium uppercase leading-relaxed tracking-wider text-muted-foreground sm:text-xs">
                    {stat.label}
                  </span>
                  <stat.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
                <div className="text-2xl font-semibold tracking-tight">
                  <AnimatedNumber value={stat.count} />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  <AnimatedNumber value={stat.value} formatter={formatBRL} />
                </div>
              </Card>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

function DashboardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card role="alert" className="mb-5 flex flex-wrap items-center gap-3 border-destructive/30 p-4">
      <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
      <p className="min-w-0 flex-1 text-sm">{message}</p>
      <Button variant="outline" onClick={onRetry}>
        Tentar novamente
      </Button>
    </Card>
  );
}
