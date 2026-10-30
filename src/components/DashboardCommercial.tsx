import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CircleHelp, SlidersHorizontal, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/auth";
import { getSaoPauloDate, type AnalyticsLead } from "@/lib/analytics";
import type { PaymentMetricInput } from "@/lib/payment-metrics";
import { formatMonthBR } from "@/lib/date-format";
import { fetchAllRows } from "@/lib/query-pagination";
import {
  recurringRevenueMetrics,
  pipelineForecast,
  forecastStages,
  monthlyReceivedRevenue,
  commercialGoalProgress,
  parseCommercialAmount,
  parseStageProbability,
  isMissingCommercialSchema,
  type ForecastStage,
  type StageProbability,
  type CommercialTarget,
} from "@/lib/dashboard-metrics";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { CrmMonthPicker } from "@/components/CrmMonthPicker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function MetricExplanation({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground"
          aria-label={`Como ${label} é calculado`}
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-w-[calc(100vw-2rem)] text-xs leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  );
}

type Client = Parameters<typeof recurringRevenueMetrics>[0][number];

export function DashboardCommercial({
  clients,
  leads,
  allLeads,
  payments,
  stages,
  userId,
  reloadKey,
  overviewCards,
}: {
  clients: Client[];
  leads: AnalyticsLead[];
  allLeads: AnalyticsLead[];
  payments: PaymentMetricInput[];
  stages: ForecastStage[];
  userId?: string;
  reloadKey: number;
  overviewCards: ReactNode;
}) {
  const [probabilities, setProbabilities] = useState<StageProbability[]>([]);
  const [targets, setTargets] = useState<CommercialTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [forecastOpen, setForecastOpen] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probabilityDraft, setProbabilityDraft] = useState<Record<string, string>>({});
  const [goalMonth, setGoalMonth] = useState(() => getSaoPauloDate().slice(0, 7));
  const [targetMonthDraft, setTargetMonthDraft] = useState(goalMonth);
  const [targetDraft, setTargetDraft] = useState("");
  const recurring = useMemo(() => recurringRevenueMetrics(clients), [clients]);
  const openStages = useMemo(() => forecastStages(stages, allLeads), [stages, allLeads]);
  const forecast = useMemo(() => pipelineForecast(leads, probabilities), [leads, probabilities]);
  const revenue = useMemo(() => monthlyReceivedRevenue(payments, goalMonth), [payments, goalMonth]);
  const target = targets.find((row) => row.month.slice(0, 7) === goalMonth);
  const progress = commercialGoalProgress(
    revenue.value,
    target ? Number(target.target_amount) : null,
  );
  const api = supabase as SupabaseClient;

  const loadConfiguration = useEffectEvent(async (signal: AbortSignal) => {
    if (!userId) return;
    setLoading(true);
    setConfigError(null);
    try {
      const [stageRows, targetRows] = await Promise.all([
        fetchAllRows<StageProbability>(
          () =>
            api
              .from("commercial_stage_probabilities")
              .select("stage_key,probability")
              .eq("user_id", userId)
              .abortSignal(signal)
              .order("stage_key"),
          "as probabilidades",
        ),
        fetchAllRows<CommercialTarget>(
          () =>
            api
              .from("commercial_targets")
              .select("month,target_amount")
              .eq("user_id", userId)
              .abortSignal(signal)
              .order("month"),
          "as metas comerciais",
        ),
      ]);
      if (signal.aborted) return;
      setProbabilities(stageRows);
      setTargets(targetRows);
    } catch (cause) {
      if (signal.aborted) return;
      setConfigError(
        isMissingCommercialSchema(cause)
          ? "Aplique o SQL dos indicadores comerciais para habilitar metas e probabilidades."
          : "Não foi possível atualizar metas e probabilidades. Use Atualizar para tentar novamente.",
      );
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  });
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadConfiguration(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [userId, reloadKey]);

  const openForecast = () => {
    setProbabilityDraft(
      Object.fromEntries(
        openStages.map((stage) => {
          const row = probabilities.find((item) => item.stage_key === stage.stage_key);
          return [stage.stage_key, row ? String(row.probability).replace(".", ",") : ""];
        }),
      ),
    );
    setForecastOpen(true);
  };
  const openTarget = () => {
    setTargetMonthDraft(goalMonth);
    setTargetDraft(target ? Number(target.target_amount).toFixed(2).replace(".", ",") : "");
    setTargetOpen(true);
  };

  const saveProbabilities = async () => {
    if (!userId || saving) return;
    const rows = openStages.map((stage) => ({
      user_id: userId,
      stage_key: stage.stage_key,
      probability: parseStageProbability(probabilityDraft[stage.stage_key] ?? ""),
    }));
    if (rows.some((row) => row.probability === null)) {
      toast.error(
        "Informe uma probabilidade de 0 a 100% para cada etapa, com até duas casas decimais.",
      );
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await api
        .from("commercial_stage_probabilities")
        .upsert(rows, { onConflict: "user_id,stage_key" })
        .select("stage_key,probability");
      if (error) throw error;
      if (
        !Array.isArray(data) ||
        !rows.every((row) =>
          data.some(
            (saved) =>
              saved.stage_key === row.stage_key && Number(saved.probability) === row.probability,
          ),
        )
      )
        throw new Error("O banco não confirmou as probabilidades salvas.");
      setProbabilities(data as StageProbability[]);
      setForecastOpen(false);
      toast.success("Probabilidades salvas");
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Não foi possível salvar as probabilidades.",
      );
    } finally {
      setSaving(false);
    }
  };
  const saveTarget = async () => {
    if (!userId || saving) return;
    const amount = parseCommercialAmount(targetDraft);
    if (
      amount === null ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonthDraft) ||
      targetMonthDraft.startsWith("0000")
    ) {
      toast.error("Informe um mês válido e uma meta maior que zero, com até duas casas decimais.");
      return;
    }
    setSaving(true);
    try {
      const month = `${targetMonthDraft}-01`;
      const { data, error } = await api
        .from("commercial_targets")
        .upsert({ user_id: userId, month, target_amount: amount }, { onConflict: "user_id,month" })
        .select("month,target_amount")
        .single();
      if (error) throw error;
      if (!data || data.month !== month || Number(data.target_amount) !== amount)
        throw new Error("O banco não confirmou a meta salva.");
      setTargets((current) => [
        ...current.filter((row) => row.month !== month),
        data as CommercialTarget,
      ]);
      setGoalMonth(targetMonthDraft);
      setTargetOpen(false);
      toast.success("Meta do mês salva");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar a meta.");
    } finally {
      setSaving(false);
    }
  };

  const cards = [
    {
      key: "mrr",
      label: "MRR",
      value: recurring.mrr,
      explanation:
        "Soma dos contratos mensais ativos de clientes ativos. Contratos anuais e serviços avulsos não entram. É a base atual, independentemente do período selecionado.",
    },
    {
      key: "arr",
      label: "ARR",
      value: recurring.arr,
      explanation:
        "Contratos mensais ativos × 12 + valor integral dos contratos anuais ativos, somente de clientes ativos. Projeção da base atual, não receita recebida ou garantida.",
    },
    {
      key: "ticket",
      label: "Ticket médio",
      value: recurring.averageTicket,
      explanation:
        "MRR dividido pelo número de clientes ativos com ao menos um contrato mensal ativo de valor positivo. Cada cliente conta uma vez; contratos anuais e serviços avulsos ficam fora.",
    },
  ];

  const goalCard = (
    <Card
      data-dashboard-metric="goal"
      className="@container min-w-0 gap-0 border-border p-4 shadow-none max-lg:col-span-2 sm:p-5"
    >
      <div className="mb-4 flex min-h-10 items-start justify-between gap-1">
        <div className="flex min-w-0 items-start gap-1">
          <h2 className="min-w-0 break-words pt-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:text-xs">
            Meta do mês · {formatMonthBR(goalMonth)}
          </h2>
          <MetricExplanation label="a meta do mês">
            Soma dos lançamentos do Financeiro com status Pago e data de recebimento no mês
            indicado, incluindo avulsos e faturas recorrentes mensais ou anuais. Desfazer um
            recebimento retira seu valor da meta. A meta considera toda a operação,
            independentemente dos filtros de busca e período. Valores do pipeline e contratos ainda
            não pagos não são somados.
            {revenue.missingReceiptDates > 0 &&
              ` ${revenue.missingReceiptDates} lançamento(s) pago(s) sem data de recebimento válida não entram na meta.`}
          </MetricExplanation>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground"
          aria-label="Editar meta do mês"
          onClick={openTarget}
          disabled={loading || Boolean(configError)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>
      {loading ? (
        <Skeleton className="h-16 w-full" />
      ) : configError ? (
        <p role="status" className="text-sm text-muted-foreground">
          {configError}
        </p>
      ) : progress ? (
        <>
          <div className="mb-3 flex items-end justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[clamp(0.875rem,11.5cqw,1.5rem)] font-semibold leading-snug tracking-tight">
                <AnimatedNumber
                  value={revenue.value}
                  formatter={(value) => formatBRL(value).replaceAll("\u00a0", " ")}
                />
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                de {formatBRL(Number(target!.target_amount))}
              </p>
            </div>
            <span className="shrink-0 text-sm font-semibold">
              {progress.percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
            </span>
          </div>
          <Progress
            value={progress.barPercent}
            aria-label={`Progresso da meta do mês de ${formatMonthBR(goalMonth)}`}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            {progress.remaining > 0
              ? `Faltam ${formatBRL(progress.remaining)} para atingir a meta.`
              : "Meta atingida."}
          </p>
        </>
      ) : (
        <Button variant="outline" onClick={openTarget}>
          Definir meta em R$
        </Button>
      )}
    </Card>
  );

  return (
    <section className="mb-6 space-y-4" aria-label="Indicadores do dashboard">
      <div data-dashboard-row="overview" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {overviewCards}
        {goalCard}
      </div>
      <div data-dashboard-row="recurring" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => (
          <Card
            key={card.key}
            data-dashboard-metric={card.key}
            className="@container min-w-0 gap-0 border-border p-4 shadow-none sm:p-5"
          >
            <div className="mb-5 flex min-h-10 items-start justify-between gap-1">
              <h2 className="min-w-0 break-words pt-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:text-xs">
                {card.label}
              </h2>
              <MetricExplanation label={card.label}>{card.explanation}</MetricExplanation>
            </div>
            <div className="text-[clamp(0.875rem,11.5cqw,1.5rem)] font-semibold leading-snug tracking-tight">
              <AnimatedNumber
                value={card.value}
                formatter={(value) => formatBRL(value).replaceAll("\u00a0", " ")}
              />
            </div>
          </Card>
        ))}
        <Card
          data-dashboard-metric="forecast"
          className="@container min-w-0 gap-0 border-border p-4 shadow-none sm:p-5"
        >
          <div className="mb-5 flex min-h-10 items-start justify-between gap-1">
            <h2 className="min-w-0 break-words pt-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:text-xs">
              <span className="sm:hidden lg:inline xl:hidden">Previsão</span>
              <span className="hidden sm:inline lg:hidden xl:inline">Previsão de faturamento</span>
            </h2>
            <MetricExplanation label="a previsão">
              Soma do valor estimado dos leads abertos × probabilidade de cada etapa. Não inclui
              ganhos, perdas ou lixeira. Considera o pipeline atual, sem restringir pela data de
              criação; não é previsão de um mês nem receita confirmada.
            </MetricExplanation>
          </div>
          {loading ? (
            <Skeleton className="h-7 w-24" />
          ) : configError ? (
            <span className="text-sm text-muted-foreground">Indisponível</span>
          ) : forecast.value === null ? (
            <Button
              variant="link"
              className="h-auto max-w-full whitespace-normal p-0 text-left text-sm"
              onClick={openForecast}
            >
              Configurar previsão
            </Button>
          ) : (
            <div className="text-[clamp(0.875rem,11.5cqw,1.5rem)] font-semibold leading-snug tracking-tight">
              <AnimatedNumber
                value={forecast.value}
                formatter={(value) => formatBRL(value).replaceAll("\u00a0", " ")}
              />
            </div>
          )}
          <div className="mt-3 flex justify-end">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              aria-label="Editar probabilidades do pipeline"
              onClick={openForecast}
              disabled={loading || Boolean(configError)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      </div>
      <Dialog
        open={forecastOpen}
        onOpenChange={(open) => {
          if (!saving) setForecastOpen(open);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle>Probabilidades do pipeline</DialogTitle>
            <DialogDescription>
              Defina a chance de fechamento de cada etapa. Os valores ficam salvos na sua conta.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void saveProbabilities();
            }}
          >
            <div className="space-y-3">
              {openStages.map((stage) => (
                <div key={stage.stage_key} className="flex items-center justify-between gap-4">
                  <Label htmlFor={`probability-${stage.stage_key}`} className="min-w-0 break-words">
                    {stage.label}
                  </Label>
                  <div className="relative w-24 shrink-0">
                    <Input
                      id={`probability-${stage.stage_key}`}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0–100"
                      value={probabilityDraft[stage.stage_key] ?? ""}
                      onChange={(event) =>
                        setProbabilityDraft((draft) => ({
                          ...draft,
                          [stage.stage_key]: event.target.value,
                        }))
                      }
                      disabled={saving}
                      className="pr-7"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      %
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setForecastOpen(false)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando..." : "Salvar probabilidades"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={targetOpen}
        onOpenChange={(open) => {
          if (!saving) setTargetOpen(open);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle>Meta do mês</DialogTitle>
            <DialogDescription>
              Defina o objetivo em R$ de recebimentos no Financeiro, incluindo recorrentes pagos.
              Cada mês tem uma meta independente.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void saveTarget();
            }}
          >
            <div className="space-y-1.5">
              <Label>Mês da meta</Label>
              <CrmMonthPicker
                label="Mês da meta"
                value={targetMonthDraft}
                onChange={(month) => {
                  setTargetMonthDraft(month);
                  const saved = targets.find((row) => row.month.slice(0, 7) === month);
                  setTargetDraft(
                    saved ? Number(saved.target_amount).toFixed(2).replace(".", ",") : "",
                  );
                }}
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="commercial-target-amount">Meta de recebimentos (R$)</Label>
              <Input
                id="commercial-target-amount"
                value={targetDraft}
                onChange={(event) => setTargetDraft(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
                placeholder="Ex.: 15000,00"
                disabled={saving}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTargetOpen(false)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando..." : "Salvar meta"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
