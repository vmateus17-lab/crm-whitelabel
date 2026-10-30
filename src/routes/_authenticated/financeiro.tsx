import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, formatBRL, handleBRLInputChange, numberToBRLInput } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  ExternalLink,
  CalendarDays,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CrmDatePicker } from "@/components/CrmDatePicker";
import { CrmMonthPicker } from "@/components/CrmMonthPicker";
import { formatDateBR, formatMonthBR } from "@/lib/date-format";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { safeExternalUrl } from "@/lib/security";
import { toSaoPauloInputParts } from "@/lib/reminders";
import {
  isPendingPaymentDueToday,
  sumPaymentAmounts,
  getEffectivePaymentStatus,
  getPaymentKind,
  isPaymentInRange,
  type PaymentDateBasis,
} from "@/lib/payment-metrics";
import {
  type ClientRecurringService,
  recurringDueDate,
  recurringCycle,
  recurringIsDueInMonth,
  recurringIsBilledInPeriod,
} from "@/lib/recurring-services";
import {
  buildRecurringPaymentArgs,
  recurringPaymentServiceOptions,
  validatePaymentDraft,
  isValidPaymentDate,
  type RecurringPaymentSelection,
} from "@/lib/recurring-payment";
import { fetchAllRows } from "@/lib/query-pagination";
import { useListFilters } from "@/lib/list-filters";
import { matchesDateShortcut } from "@/lib/filter-utils";
import { FilterBar, FilterSelect, FilterPeriod } from "@/components/FilterBar";
import { UpdatedTooltip } from "@/components/PageHeading";
import { sortClientsByName } from "@/lib/client-options";

export const Route = createFileRoute("/_authenticated/financeiro")({
  component: FinanceiroPage,
  head: () => ({ meta: [{ title: "CRM | Financeiro" }] }),
  errorComponent: ({ error }) => (
    <div className="p-10 flex flex-col items-center justify-center text-center">
      <div className="bg-red-50 text-red-900 border border-red-200 p-6 rounded-xl max-w-2xl w-full">
        <h2 className="text-xl font-bold mb-2">Erro na tela do Financeiro</h2>
        <p>Ocorreu um erro inesperado. Tente novamente ou entre em contato com o suporte.</p>
        {import.meta.env.DEV && (
          <>
            <code className="block bg-white p-4 rounded text-left text-sm overflow-auto my-2 text-red-600 font-mono">
              {error instanceof Error ? error.message : "Erro desconhecido"}
            </code>
            <code className="block bg-white p-4 rounded text-left text-xs overflow-auto text-red-500 font-mono whitespace-pre-wrap">
              {error instanceof Error ? error.stack : "Sem stack trace"}
            </code>
          </>
        )}
      </div>
    </div>
  ),
});

type PaymentStatus = "pendente" | "pago" | "atrasado";
type PaymentSortField = "client" | "due_date" | "status" | "amount";
type SortDirection = "asc" | "desc";

interface Payment {
  id: string;
  client_id: string | null;
  lead_id?: string | null;
  description: string;
  amount: number;
  due_date: string;
  paid_at: string | null;
  status: PaymentStatus;
  contract_url: string | null;
  payment_type?: string;
  reference_month?: string | null;
  recurring_service_id?: string | null;
  recurring_billing_cycle?: "monthly" | "annual";
}
interface ClientLite {
  id: string;
  name: string;
  status: string;
  client_recurring_services: ClientRecurringService[];
  source?: string | null;
  services?: string[];
}
interface FinancialLeadContext {
  id: string;
  source?: string | null;
  services?: string[];
}
interface BillingCandidate extends ClientRecurringService {
  id: string;
  client_name: string;
  alreadyBilled: boolean;
}
interface BillingDraft {
  selected: boolean;
  amount: number;
  due_date: string;
}

const STATUS_LABEL: Record<PaymentStatus, string> = {
  pendente: "Pendente",
  pago: "Pago",
  atrasado: "Atrasado",
};

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function SortableHeader({
  label,
  field,
  activeField,
  direction,
  onSort,
  align = "left",
}: {
  label: string;
  field: PaymentSortField;
  activeField: PaymentSortField;
  direction: SortDirection;
  onSort: (field: PaymentSortField) => void;
  align?: "left" | "right";
}) {
  const active = field === activeField;
  const Icon = active ? (direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={cn(
        "inline-flex w-full items-center gap-1.5 rounded-sm py-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        align === "right" ? "justify-end" : "justify-start",
      )}
      aria-label={`Ordenar por ${label}`}
    >
      {label}
      <Icon className={cn("h-3.5 w-3.5", !active && "opacity-45")} aria-hidden="true" />
    </button>
  );
}

function FinanceiroPage() {
  const { user } = useAuth();
  const today = toSaoPauloInputParts(new Date().toISOString()).date;
  const currentMonth = today.slice(0, 7);
  const monthEnd = recurringDueDate(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 31);
  const view = useListFilters(
    {
      search: "",
      status: "all",
      client: "all",
      type: "all",
      from: `${currentMonth}-01`,
      to: monthEnd,
      basis: "due",
      date: "all",
      source: "all",
      service: "all",
    },
    "financeiro",
    user?.id,
    {
      status: ["all", "pendente", "pago", "atrasado"],
      type: ["all", "monthly", "annual", "one_off", "initial_sale", "other"],
      basis: ["due", "paid", "reference"],
      date: ["all", "today", "next7", "overdue"],
    },
  );
  const { filters, setFilter, setFilters } = view;
  const basis = filters.basis as PaymentDateBasis;
  const [payments, setPayments] = useState<Payment[]>([]);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [leadContexts, setLeadContexts] = useState<FinancialLeadContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Payment | null>(null);
  const [sortField, setSortField] = useState<PaymentSortField>("due_date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [actionPayment, setActionPayment] = useState<Payment | null>(null);
  const [receiptDate, setReceiptDate] = useState(today);
  const [deleting, setDeleting] = useState<Payment | null>(null);
  const [mutating, setMutating] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [billingMonth, setBillingMonth] = useState(currentMonth);
  const [billingSearch, setBillingSearch] = useState("");
  const [billingDrafts, setBillingDrafts] = useState<Record<string, BillingDraft>>({});
  const viewYear = Number(billingMonth.slice(0, 4));
  const viewMonth = Number(billingMonth.slice(5, 7)) - 1;

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [pays, cls, leadRows] = await Promise.all([
        fetchAllRows<Payment>(
          () => supabase.from("payments").select("*").order("id"),
          "Lançamentos",
        ),
        fetchAllRows<ClientLite>(
          () =>
            supabase
              .from("clients")
              .select("id,name,status,source,services,client_recurring_services(*)")
              .order("id"),
          "Clientes",
        ),
        fetchAllRows<FinancialLeadContext>(
          () =>
            supabase.from("leads").select("id,source,services").is("deleted_at", null).order("id"),
          "Origens dos lançamentos",
        ),
      ]);
      setPayments(pays);
      setClients(cls);
      setLeadContexts(leadRows);
      setUpdatedAt(new Date().toISOString());
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Não foi possível carregar o financeiro.",
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
  const clientNames = useMemo(
    () => new Map(clients.map((client) => [client.id, client.name])),
    [clients],
  );
  const clientName = (id: string | null) => clientNames.get(id ?? "") ?? "Sem cliente";
  const kindLabel = (payment: Payment) =>
    (
      ({
        monthly: "Mensal",
        annual: "Anual",
        one_off: "Avulso",
        initial_sale: "Venda inicial",
        other: "Outros",
      }) as Record<string, string>
    )[getPaymentKind(payment)] ?? "Outros";
  const sources = [
    ...new Set([...clients, ...leadContexts].map((person) => person.source || "Não informado")),
  ].sort();
  const personServices = (person: {
    services?: string[];
    client_recurring_services?: ClientRecurringService[];
  }) => [
    ...new Set([
      ...(person.services ?? []),
      ...(person.client_recurring_services ?? [])
        .filter((item) => item.active)
        .map((item) => item.service_name),
    ]),
  ];
  const services = [...new Set([...clients, ...leadContexts].flatMap(personServices))].sort();
  const segmentationIds = useMemo(() => {
    const matches = (person: {
      source?: string | null;
      services?: string[];
      client_recurring_services?: ClientRecurringService[];
    }) =>
      (filters.source === "all" || (person.source || "Não informado") === filters.source) &&
      (filters.service === "all" || personServices(person).includes(filters.service));
    return {
      clients: new Set(clients.filter(matches).map((client) => client.id)),
      leads: new Set(leadContexts.filter(matches).map((lead) => lead.id)),
    };
  }, [clients, leadContexts, filters.source, filters.service]);
  const statusOf = (payment: Payment) => getEffectivePaymentStatus(payment, today) as PaymentStatus;
  const contextPayments = useMemo(
    () =>
      payments.filter((payment) => {
        const query = filters.search.trim().toLocaleLowerCase("pt-BR");
        return (
          (!query ||
            `${payment.description} ${clientNames.get(payment.client_id ?? "") ?? ""}`
              .toLocaleLowerCase("pt-BR")
              .includes(query)) &&
          (filters.client === "all" ||
            (filters.client === "none"
              ? !payment.client_id
              : payment.client_id === filters.client)) &&
          (filters.type === "all" || getPaymentKind(payment) === filters.type) &&
          ((filters.source === "all" && filters.service === "all") ||
            segmentationIds.clients.has(payment.client_id ?? "") ||
            segmentationIds.leads.has(payment.lead_id ?? ""))
        );
      }),
    [
      payments,
      filters.search,
      filters.client,
      filters.type,
      filters.source,
      filters.service,
      segmentationIds,
      clientNames,
    ],
  );
  const selection = useMemo(
    () =>
      contextPayments.filter(
        (payment) =>
          isPaymentInRange(
            payment,
            filters.from,
            filters.to,
            basis === "paid" && payment.status !== "pago" ? "due" : basis,
          ) &&
          (filters.status === "all" ||
            getEffectivePaymentStatus(payment, today) === filters.status) &&
          (filters.date === "all" ||
            (filters.date === "overdue"
              ? getEffectivePaymentStatus(payment, today) === "atrasado"
              : matchesDateShortcut(
                  payment.due_date,
                  filters.date,
                  payment.status === "pago",
                  today,
                ))),
      ),
    [contextPayments, filters.from, filters.to, filters.status, filters.date, basis, today],
  );
  const filtered = useMemo(
    () =>
      [...selection].sort((a, b) => {
        const direction = sortDirection === "asc" ? 1 : -1;
        const comparison =
          sortField === "client"
            ? (clientNames.get(a.client_id ?? "") ?? "").localeCompare(
                clientNames.get(b.client_id ?? "") ?? "",
                "pt-BR",
              )
            : sortField === "amount"
              ? Number(a.amount) - Number(b.amount)
              : sortField === "status"
                ? getEffectivePaymentStatus(a, today).localeCompare(
                    getEffectivePaymentStatus(b, today),
                    "pt-BR",
                  )
                : (a.due_date ?? "").localeCompare(b.due_date ?? "");
        return (comparison || a.id.localeCompare(b.id)) * direction;
      }),
    [selection, sortField, sortDirection, clientNames, today],
  );
  const summary = {
    received: sumPaymentAmounts(selection.filter((p) => p.status === "pago")),
    pending: sumPaymentAmounts(selection.filter((p) => statusOf(p) === "pendente")),
    overdue: sumPaymentAmounts(selection.filter((p) => statusOf(p) === "atrasado")),
    today: sumPaymentAmounts(contextPayments.filter((p) => isPendingPaymentDueToday(p, today))),
  };
  const handleSort = (field: PaymentSortField) => {
    if (field === sortField) setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const billingCandidates = useMemo<BillingCandidate[]>(
    () =>
      clients
        .filter((client) => client.status === "ativo")
        .flatMap((client) =>
          (client.client_recurring_services ?? [])
            .filter(
              (item) =>
                item.id &&
                item.active &&
                Number(item.amount) > 0 &&
                recurringIsDueInMonth(item, viewMonth),
            )
            .map((item) => ({
              ...item,
              id: item.id!,
              client_name: client.name,
              alreadyBilled: payments.some(
                (payment) =>
                  payment.recurring_service_id === item.id &&
                  recurringIsBilledInPeriod(
                    item,
                    payment.reference_month,
                    viewYear,
                    viewMonth,
                    payment.recurring_billing_cycle ?? "monthly",
                  ),
              ),
            })),
        ),
    [clients, payments, viewYear, viewMonth],
  );
  const visibleCandidates = billingCandidates.filter((candidate) =>
    `${candidate.client_name} ${candidate.service_name}`
      .toLocaleLowerCase("pt-BR")
      .includes(billingSearch.trim().toLocaleLowerCase("pt-BR")),
  );
  const openBillingDialog = () => {
    const selectedMonth =
      filters.from && filters.from.slice(0, 7) === filters.to.slice(0, 7)
        ? filters.from.slice(0, 7)
        : currentMonth;
    setBillingMonth(selectedMonth);
    setBillingSearch("");
    setGenerateDialogOpen(true);
  };
  useEffect(() => {
    if (!generateDialogOpen) return;
    const timer = window.setTimeout(
      () =>
        setBillingDrafts(
          Object.fromEntries(
            billingCandidates.map((candidate) => [
              candidate.id,
              {
                selected: !candidate.alreadyBilled,
                amount: Number(candidate.amount),
                due_date: recurringDueDate(viewYear, viewMonth, candidate.due_day),
              },
            ]),
          ),
        ),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [generateDialogOpen, billingCandidates, viewYear, viewMonth]);
  const selectedCandidates = billingCandidates.filter(
    (candidate) => billingDrafts[candidate.id]?.selected && !candidate.alreadyBilled,
  );
  const generateInvoices = async () => {
    if (!user || !selectedCandidates.length || generating) return;
    if (
      selectedCandidates.some(
        (candidate) =>
          !isValidPaymentDate(billingDrafts[candidate.id]?.due_date) ||
          !Number.isFinite(billingDrafts[candidate.id]?.amount) ||
          billingDrafts[candidate.id].amount < 0,
      )
    ) {
      toast.error("Confira os valores e vencimentos das faturas.");
      return;
    }
    setGenerating(true);
    try {
      const { data, error } = await (supabase as SupabaseClient).rpc("generate_monthly_payments", {
        p_items: selectedCandidates.map((candidate) => ({
          recurring_service_id: candidate.id,
          amount: billingDrafts[candidate.id].amount,
          due_date: billingDrafts[candidate.id].due_date,
        })),
        p_reference_month: `${billingMonth}-01`,
      });
      if (error) throw error;
      toast.success(`${Number(data ?? 0)} fatura(s) gerada(s).`);
      setGenerateDialogOpen(false);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível gerar. Confira se a migração de recorrência está aplicada.",
      );
    } finally {
      setGenerating(false);
    }
  };
  const handleSave = async (
    form: Partial<Payment>,
    recurring: RecurringPaymentSelection,
  ): Promise<boolean> => {
    if (!user) {
      toast.error("Sua sessão expirou. Entre novamente.");
      return false;
    }
    const validationError = validatePaymentDraft(form, recurring);
    if (validationError) {
      toast.error(validationError);
      return false;
    }
    const contractUrl = form.contract_url?.trim() ? safeExternalUrl(form.contract_url) : null;
    if (form.contract_url?.trim() && !contractUrl) {
      toast.error("Informe uma URL HTTPS válida para o contrato.");
      return false;
    }
    if (editing?.recurring_service_id && form.client_id !== editing.client_id) {
      toast.error("O cliente de uma fatura recorrente não pode ser alterado.");
      return false;
    }
    const payload = {
      client_id: form.client_id ?? null,
      description: form.description!.trim(),
      amount: form.amount ?? 0,
      due_date: form.due_date!,
      paid_at: form.status === "pago" ? (form.paid_at ?? today) : null,
      status: form.status ?? "pendente",
      contract_url: contractUrl,
    };
    try {
      let error;
      const referenceMonth = form.reference_month
        ? `${form.reference_month.slice(0, 7)}-01`
        : `${form.due_date!.slice(0, 7)}-01`;
      if (!isValidPaymentDate(referenceMonth)) {
        toast.error("Informe uma competência válida.");
        return false;
      }
      if (editing) {
        const result = await supabase
          .from("payments")
          .update({
            ...payload,
            ...(!editing.recurring_service_id ? { reference_month: referenceMonth } : {}),
          })
          .eq("id", editing.id)
          .select("id")
          .single();
        error = result.error;
      } else if (recurring.enabled) {
        if (recurring.billing_cycle === "annual") {
          const capability = await (supabase as SupabaseClient)
            .from("client_recurring_services")
            .select("billing_cycle,due_month")
            .limit(1);
          if (capability.error) {
            toast.error("Aplique o SQL de recorrência anual antes de salvar uma anuidade.");
            return false;
          }
        }
        const result = await (supabase as SupabaseClient).rpc(
          "save_recurring_payment",
          buildRecurringPaymentArgs(payload, recurring),
        );
        error = result.error;
      } else {
        const result = await supabase
          .from("payments")
          .insert({
            ...payload,
            reference_month: referenceMonth,
            payment_type: "one_off",
            user_id: user.id,
          })
          .select("id")
          .single();
        error = result.error;
      }
      if (error) {
        toast.error(
          error.code === "PGRST202"
            ? "Aplique a migração SQL de recorrência no Supabase antes de salvar."
            : error.code === "23505"
              ? "Já existe uma fatura desse serviço para o período. Edite a existente."
              : `Não foi possível salvar: ${error.message}`,
        );
        return false;
      }
      toast.success(recurring.enabled ? "Lançamento e recorrência salvos." : "Lançamento salvo.");
      setOpen(false);
      setEditing(null);
      await load();
      return true;
    } catch {
      toast.error("Não foi possível salvar. Confira sua conexão.");
      return false;
    }
  };
  const confirmPayment = async () => {
    if (!actionPayment || mutating) return;
    const previous = { status: actionPayment.status, paid_at: actionPayment.paid_at };
    const receiving = actionPayment.status !== "pago";
    if (receiving && !isValidPaymentDate(receiptDate)) {
      toast.error("Selecione a data do recebimento.");
      return;
    }
    const next: { status: PaymentStatus; paid_at: string | null } = {
      status: receiving ? "pago" : actionPayment.due_date < today ? "atrasado" : "pendente",
      paid_at: receiving ? receiptDate : null,
    };
    setMutating(true);
    try {
      let receiptQuery = supabase
        .from("payments")
        .update(next)
        .eq("id", actionPayment.id)
        .eq("status", actionPayment.status);
      receiptQuery = previous.paid_at
        ? receiptQuery.eq("paid_at", previous.paid_at)
        : receiptQuery.is("paid_at", null);
      const { error } = await receiptQuery.select("id").single();
      if (error) throw error;
      const id = actionPayment.id;
      toast.success(receiving ? "Recebimento registrado." : "Recebimento desfeito.", {
        action: {
          label: "Desfazer",
          onClick: async () => {
            let undoQuery = supabase
              .from("payments")
              .update(previous)
              .eq("id", id)
              .eq("status", next.status);
            undoQuery = next.paid_at
              ? undoQuery.eq("paid_at", next.paid_at)
              : undoQuery.is("paid_at", null);
            const { error: undoError } = await undoQuery.select("id").single();
            if (undoError)
              toast.error("Não foi possível desfazer; o lançamento pode ter sido alterado.");
            else await load();
          },
        },
      });
      setActionPayment(null);
      await load();
    } catch {
      toast.error("Não foi possível alterar o recebimento. Atualize a lista e tente novamente.");
    } finally {
      setMutating(false);
    }
  };
  const deletePayment = async () => {
    if (!deleting || mutating) return;
    setMutating(true);
    try {
      const { error } = await supabase
        .from("payments")
        .delete()
        .eq("id", deleting.id)
        .select("id")
        .single();
      if (error) throw error;
      toast.success("Lançamento excluído. As próximas recorrências do cliente foram preservadas.");
      setDeleting(null);
      await load();
    } catch {
      toast.error("Não foi possível excluir o lançamento.");
    } finally {
      setMutating(false);
    }
  };
  const startReceipt = (payment: Payment) => {
    setReceiptDate(payment.paid_at ?? today);
    setActionPayment(payment);
  };
  const dateLabel = formatDateBR;
  const statusButton = (payment: Payment) => (
    <Badge
      asChild
      variant={
        statusOf(payment) === "pago"
          ? "default"
          : statusOf(payment) === "atrasado"
            ? "destructive"
            : "secondary"
      }
      className="cursor-pointer transition-opacity hover:opacity-80"
    >
      <button
        type="button"
        disabled={mutating}
        onClick={() => startReceipt(payment)}
        aria-label={`${STATUS_LABEL[statusOf(payment)]}: ${payment.status === "pago" ? "desfazer recebimento" : "marcar como recebido"} de ${payment.description}`}
        title={payment.status === "pago" ? "Desfazer recebimento" : "Marcar como recebido"}
      >
        {STATUS_LABEL[statusOf(payment)]}
      </button>
    </Badge>
  );
  const activeFilters = Object.entries(filters)
    .filter(
      ([key, value]) =>
        value && value !== "all" && !["from", "to", "basis", "search"].includes(key),
    )
    .map(([key, value]) => ({
      key,
      label:
        key === "client"
          ? clientName(value === "none" ? null : value)
          : key === "status"
            ? STATUS_LABEL[value as PaymentStatus]
            : key === "type"
              ? ({
                  monthly: "Mensal",
                  annual: "Anual",
                  one_off: "Avulso",
                  initial_sale: "Venda inicial",
                  other: "Outros",
                }[value] ?? value)
              : key === "source" || key === "service"
                ? `${key === "source" ? "Origem" : "Serviço"}: ${value}`
                : ({ today: "Hoje", next7: "Próximos 7 dias", overdue: "Atrasados" }[value] ??
                  value),
      onClear: () => setFilter(key as keyof typeof filters, "all"),
    }));

  return (
    <div className="page-shell">
      <FilterBar
        title="Financeiro"
        description="Recebimentos e cobranças mensais, anuais e avulsas"
        actions={
          <div className="flex flex-wrap gap-2">
            <UpdatedTooltip updatedAt={updatedAt}>
              <Button
                variant="outline"
                size="icon"
                onClick={() => void load()}
                disabled={loading}
                aria-label="Atualizar financeiro"
              >
                <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                <span className="xl:hidden">Atualizar</span>
              </Button>
            </UpdatedTooltip>
            <Button
              variant="outline"
              onClick={openBillingDialog}
              disabled={loading || Boolean(loadError)}
            >
              <CalendarDays className="mr-2 h-4 w-4" />
              Gerar faturas
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
              disabled={loading || Boolean(loadError)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Novo lançamento
            </Button>
          </div>
        }
        search={{
          value: filters.search,
          onChange: (value) => setFilter("search", value),
          placeholder: "Buscar descrição ou cliente...",
        }}
        activeFilters={activeFilters}
        onReset={view.resetFilters}
        resultCount={filtered.length}
        resultLabel="lançamentos"
        viewState={view}
      >
        <FilterPeriod
          from={filters.from}
          to={filters.to}
          onChange={(from, to) => setFilters({ from, to, date: "all" })}
        />
        <FilterSelect
          label="Base do período"
          value={basis}
          onChange={(value) => setFilter("basis", value)}
          options={[
            { value: "due", label: "Vencimento" },
            { value: "paid", label: "Recebimento" },
            { value: "reference", label: "Competência" },
          ]}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(value) => setFilter("status", value)}
          options={[
            { value: "all", label: "Todos" },
            ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
          ]}
        />
        <FilterSelect
          label="Cliente"
          value={filters.client}
          onChange={(value) => setFilter("client", value)}
          options={[
            { value: "all", label: "Todos" },
            { value: "none", label: "Sem cliente" },
            ...clients.map((client) => ({ value: client.id, label: client.name })),
          ]}
        />
        <FilterSelect
          label="Tipo"
          value={filters.type}
          onChange={(value) => setFilter("type", value)}
          options={[
            { value: "all", label: "Todos" },
            { value: "monthly", label: "Recorrente mensal" },
            { value: "annual", label: "Recorrente anual" },
            { value: "one_off", label: "Avulso" },
            { value: "initial_sale", label: "Venda inicial" },
            { value: "other", label: "Outros" },
          ]}
        />
        <FilterSelect
          label="Atalho de vencimento"
          value={filters.date}
          onChange={(value) => setFilters({ date: value, from: "", to: "", basis: "due" })}
          options={[
            { value: "all", label: "Sem atalho" },
            { value: "today", label: "Hoje" },
            { value: "next7", label: "Próximos 7 dias" },
            { value: "overdue", label: "Em atraso" },
          ]}
        />
        <FilterSelect
          label="Origem"
          value={filters.source}
          onChange={(value) => setFilter("source", value)}
          options={[
            { value: "all", label: "Todas as origens" },
            ...sources.map((value) => ({ value, label: value })),
          ]}
        />
        <FilterSelect
          label="Serviço"
          value={filters.service}
          onChange={(value) => setFilter("service", value)}
          options={[
            { value: "all", label: "Todos os serviços" },
            ...services.map((value) => ({ value, label: value })),
          ]}
        />
      </FilterBar>
      {loadError ? (
        <Card role="alert" className="p-6">
          <h2 className="font-medium">Não foi possível calcular os indicadores</h2>
          <p className="my-3 text-sm text-muted-foreground">{loadError}</p>
          <Button onClick={() => void load()}>Tentar novamente</Button>
        </Card>
      ) : loading ? (
        <div aria-busy="true">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <Skeleton className="mt-6 h-64 rounded-xl" />
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                label: "Recebido na seleção",
                value: summary.received,
                cls: "",
                click: () => setFilter("status", "pago"),
              },
              {
                label: "A receber hoje",
                value: summary.today,
                cls: "text-blue-600 dark:text-blue-400",
                hint: "Hoje · independente do período",
                click: () =>
                  setFilters({
                    from: today,
                    to: today,
                    basis: "due",
                    status: "pendente",
                    date: "all",
                  }),
              },
              {
                label: "Pendente na seleção",
                value: summary.pending,
                cls: "",
                click: () => setFilter("status", "pendente"),
              },
              {
                label: "Em atraso na seleção",
                value: summary.overdue,
                cls: "text-destructive",
                click: () => setFilter("status", "atrasado"),
              },
            ].map((item) => (
              <button
                key={item.label}
                className={`rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${item.cls}`}
                onClick={item.click}
              >
                <p className="text-[11px] font-medium uppercase tracking-wide">{item.label}</p>
                <p className="mt-4 truncate text-2xl font-semibold tracking-tight">
                  <AnimatedNumber value={item.value} formatter={formatBRL} />
                </p>
                <p className="mt-1 min-h-4 text-[10px] text-muted-foreground">
                  {item.hint ?? "Abrir lançamentos"}
                </p>
              </button>
            ))}
          </div>
          {!filtered.length && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Nenhum lançamento corresponde aos filtros selecionados.
            </Card>
          )}
          <div className="grid gap-3 md:hidden">
            {filtered.map((payment) => (
              <Card key={payment.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-medium">{payment.description}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {clientName(payment.client_id)} · {kindLabel(payment)}
                    </p>
                  </div>
                  {statusButton(payment)}
                </div>
                <div className="mt-3 grid grid-cols-2 border-t pt-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Vencimento</p>
                    {dateLabel(payment.due_date)}
                    {payment.paid_at && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Recebido em {dateLabel(payment.paid_at)}
                      </p>
                    )}
                  </div>
                  <strong className="text-right tabular-nums">{formatBRL(payment.amount)}</strong>
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(payment);
                      setOpen(true);
                    }}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Excluir ${payment.description}`}
                    onClick={() => setDeleting(payment)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
          {filtered.length > 0 && (
            <div className="hidden overflow-x-auto rounded-xl border md:block">
              <table className="w-full min-w-[850px] text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">Descrição</th>
                    {(
                      [
                        ["Cliente", "client"],
                        ["Vencimento", "due_date"],
                        ["Status", "status"],
                        ["Valor", "amount"],
                      ] as const
                    ).map(([label, field]) => (
                      <th
                        key={field}
                        className="px-3 py-2"
                        aria-sort={
                          sortField === field
                            ? sortDirection === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <SortableHeader
                          label={label}
                          field={field}
                          activeField={sortField}
                          direction={sortDirection}
                          onSort={handleSort}
                          align={field === "amount" ? "right" : "left"}
                        />
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((payment) => (
                    <tr key={payment.id} className="border-t hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <p className="font-medium">{payment.description}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {kindLabel(payment)}
                          {payment.reference_month &&
                            ` · competência ${formatMonthBR(payment.reference_month)}`}
                        </p>
                        {safeExternalUrl(payment.contract_url) && (
                          <a
                            className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            href={safeExternalUrl(payment.contract_url)!}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Contrato
                          </a>
                        )}
                      </td>
                      <td className="px-3 py-3">{clientName(payment.client_id)}</td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {dateLabel(payment.due_date)}
                        {payment.paid_at && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Recebido {dateLabel(payment.paid_at)}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3">{statusButton(payment)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-medium tabular-nums">
                        {formatBRL(payment.amount)}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditing(payment);
                              setOpen(true);
                            }}
                          >
                            Editar
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleting(payment)}
                            aria-label={`Excluir ${payment.description}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <PaymentDialog
        key={`${editing?.id ?? "new"}:${open}`}
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        clients={clients}
        onSave={handleSave}
      />
      <Dialog
        open={Boolean(actionPayment)}
        onOpenChange={(value) => {
          if (!value && !mutating) setActionPayment(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionPayment?.status === "pago" ? "Desfazer recebimento" : "Registrar recebimento"}
            </DialogTitle>
            <DialogDescription>
              {actionPayment?.description} · {formatBRL(actionPayment?.amount)}
            </DialogDescription>
          </DialogHeader>
          {actionPayment?.status !== "pago" ? (
            <div className="space-y-2">
              <Label>Data do recebimento</Label>
              <CrmDatePicker
                value={receiptDate}
                onChange={setReceiptDate}
                label="Data do recebimento"
              />
              <p className="text-xs text-muted-foreground">
                Esta data será usada nos indicadores pela base de recebimento.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              O lançamento voltará para pendente ou atrasado conforme o vencimento. A recorrência
              não será alterada.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={mutating} onClick={() => setActionPayment(null)}>
              Cancelar
            </Button>
            <Button disabled={mutating} onClick={() => void confirmPayment()}>
              {mutating
                ? "Salvando..."
                : actionPayment?.status === "pago"
                  ? "Desfazer recebimento"
                  : "Confirmar recebimento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(value) => {
          if (!value && !mutating) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir lançamento?</DialogTitle>
            <DialogDescription>
              {deleting?.description} · {formatBRL(deleting?.amount)}. Esta fatura será removida,
              sem excluir a recorrência do cliente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={mutating} onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={mutating} onClick={() => void deletePayment()}>
              {mutating ? "Excluindo..." : "Excluir lançamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={generateDialogOpen}
        onOpenChange={(value) => {
          if (!generating) setGenerateDialogOpen(value);
        }}
      >
        <DialogContent className="flex flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Gerar faturas recorrentes</DialogTitle>
            <DialogDescription>
              Mensais e anuais com cobrança prevista para o mês escolhido. Nenhuma cobrança anual
              será repetida no mesmo ano.
            </DialogDescription>
          </DialogHeader>
          <div className="modal-form-scroll min-h-0 flex-1 space-y-4 overflow-y-auto">
            <div className="form-paired-fields">
              <div className="form-field">
                <Label>Mês de cobrança</Label>
                <CrmMonthPicker
                  label="Mês de cobrança"
                  value={billingMonth}
                  disabled={generating}
                  onChange={setBillingMonth}
                />
              </div>
              <div className="form-field">
                <Label>Buscar cliente ou serviço</Label>
                <Input
                  value={billingSearch}
                  onChange={(event) => setBillingSearch(event.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={generating}
                onClick={() =>
                  setBillingDrafts((current) =>
                    Object.fromEntries(
                      Object.entries(current).map(([id, draft]) => [
                        id,
                        {
                          ...draft,
                          selected: !billingCandidates.find((candidate) => candidate.id === id)
                            ?.alreadyBilled,
                        },
                      ]),
                    ),
                  )
                }
              >
                Selecionar todos
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={generating}
                onClick={() =>
                  setBillingDrafts((current) =>
                    Object.fromEntries(
                      Object.entries(current).map(([id, draft]) => [
                        id,
                        { ...draft, selected: false },
                      ]),
                    ),
                  )
                }
              >
                Limpar seleção
              </Button>
            </div>
            <fieldset disabled={generating} className="space-y-3">
              {visibleCandidates.map((candidate) => {
                const draft = billingDrafts[candidate.id];
                return (
                  <div key={candidate.id} className="rounded-xl border p-3">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={candidate.alreadyBilled || Boolean(draft?.selected)}
                        disabled={candidate.alreadyBilled}
                        aria-label={`Selecionar ${candidate.service_name} de ${candidate.client_name}`}
                        onCheckedChange={(checked) =>
                          setBillingDrafts((current) => ({
                            ...current,
                            [candidate.id]: {
                              ...current[candidate.id],
                              selected: checked === true,
                            },
                          }))
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{candidate.client_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {candidate.service_name} ·{" "}
                          {recurringCycle(candidate) === "annual" ? "Anual" : "Mensal"}
                        </p>
                      </div>
                      {candidate.alreadyBilled && <Badge variant="secondary">Já gerada</Badge>}
                    </div>
                    {!candidate.alreadyBilled && draft && (
                      <div className="mt-3 form-paired-fields">
                        <div className="form-field">
                          <Label>Valor desta fatura</Label>
                          <Input
                            disabled={!draft.selected}
                            value={numberToBRLInput(draft.amount)}
                            inputMode="numeric"
                            onChange={(event) => {
                              const { numeric } = handleBRLInputChange(event.target.value);
                              setBillingDrafts((current) => ({
                                ...current,
                                [candidate.id]: { ...current[candidate.id], amount: numeric },
                              }));
                            }}
                          />
                        </div>
                        <div className="form-field">
                          <Label>Vencimento desta fatura</Label>
                          <CrmDatePicker
                            value={draft.due_date}
                            disabled={!draft.selected}
                            onChange={(due_date) =>
                              setBillingDrafts((current) => ({
                                ...current,
                                [candidate.id]: { ...current[candidate.id], due_date },
                              }))
                            }
                            label="Vencimento desta fatura"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </fieldset>
            {!visibleCandidates.length && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhum serviço ativo tem cobrança prevista neste mês.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Ajustes de valor e vencimento valem somente para estas faturas; o cadastro do cliente
              permanece igual.
            </p>
            <p className="text-right font-medium tabular-nums">
              {selectedCandidates.length} selecionada(s) ·{" "}
              {formatBRL(
                selectedCandidates.reduce(
                  (total, candidate) => total + Number(billingDrafts[candidate.id]?.amount ?? 0),
                  0,
                ),
              )}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={generating}
              onClick={() => setGenerateDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              disabled={generating || !selectedCandidates.length}
              onClick={() => void generateInvoices()}
            >
              {generating ? "Gerando..." : `Gerar ${selectedCandidates.length} fatura(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaymentDialog({
  open,
  onOpenChange,
  editing,
  clients,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Payment | null;
  clients: ClientLite[];
  onSave: (form: Partial<Payment>, recurring: RecurringPaymentSelection) => Promise<boolean>;
}) {
  const sortedClients = useMemo(() => sortClientsByName(clients), [clients]);
  const initialPayment: Partial<Payment> = editing ?? {
    description: "",
    amount: 0,
    due_date: toSaoPauloInputParts(new Date().toISOString()).date,
    status: "pendente",
    client_id: null,
    contract_url: "",
  };
  const [form, setForm] = useState<Partial<Payment>>(initialPayment);
  const [valueDisplay, setValueDisplay] = useState(() => numberToBRLInput(initialPayment.amount));
  const [recurringEnabled, setRecurringEnabled] = useState(false);
  const [serviceKey, setServiceKey] = useState("");
  const [recurringDueDay, setRecurringDueDay] = useState(
    Number(initialPayment.due_date?.slice(8, 10)) || 10,
  );
  const [recurringCycleValue, setRecurringCycleValue] = useState<"monthly" | "annual">("monthly");
  const [recurringDueMonth, setRecurringDueMonth] = useState(
    Number(initialPayment.due_date?.slice(5, 7)) || 1,
  );
  const [saving, setSaving] = useState(false);
  const selectedClient = clients.find((client) => client.id === form.client_id);
  const serviceOptions = recurringPaymentServiceOptions(
    selectedClient?.client_recurring_services ?? [],
  );
  const selectedService = serviceOptions.find((option) => option.key === serviceKey);
  const recurring: RecurringPaymentSelection = {
    enabled: recurringEnabled,
    service_name: selectedService?.service_name ?? "",
    recurring_service_id: selectedService?.recurring_service_id ?? null,
    due_day: recurringDueDay,
    billing_cycle: recurringCycleValue,
    due_month: recurringCycleValue === "annual" ? recurringDueMonth : undefined,
  };
  const save = async () => {
    if (saving) return;
    const error = validatePaymentDraft(form, recurring);
    if (error) {
      toast.error(error);
      return;
    }
    setSaving(true);
    try {
      await onSave(form, recurring);
    } finally {
      setSaving(false);
    }
  };
  const selectService = (key: string) => {
    setServiceKey(key);
    const option = serviceOptions.find((item) => item.key === key);
    if (!option) return;
    const item = option.recurring;
    setRecurringCycleValue(item ? recurringCycle(item) : recurringCycleValue);
    setRecurringDueMonth(item?.due_month ?? (Number(form.due_date?.slice(5, 7)) || 1));
    setRecurringDueDay(item?.due_day ?? (Number(form.due_date?.slice(8, 10)) || 10));
    let dueDate = form.due_date;
    if (item && dueDate) {
      const [year, month] = dueDate.split("-").map(Number);
      dueDate = recurringDueDate(
        year,
        recurringCycle(item) === "annual" ? (item.due_month ?? month) - 1 : month - 1,
        item.due_day,
      );
    }
    if (item) setValueDisplay(numberToBRLInput(item.amount));
    setForm({
      ...form,
      amount: item ? Number(item.amount) : form.amount,
      due_date: dueDate,
      description: form.description?.trim()
        ? form.description
        : `${selectedClient?.name} | ${item && recurringCycle(item) === "annual" ? "Anuidade" : recurringCycleValue === "annual" ? "Anuidade" : "Mensalidade"} ${option.service_name}`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent className="overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar lançamento" : "Novo lançamento"}</DialogTitle>
        </DialogHeader>
        <fieldset disabled={saving} className="min-w-0 space-y-3">
          {!editing && (
            <div className="flex items-start justify-between gap-4 rounded-xl border bg-muted/20 p-3">
              <div className="space-y-1">
                <Label htmlFor="payment-recurring">Valor recorrente</Label>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Vincula este lançamento a um serviço do cliente e às próximas faturas.
                </p>
              </div>
              <Switch
                id="payment-recurring"
                checked={recurringEnabled}
                onCheckedChange={(value) => {
                  setRecurringEnabled(value);
                  setServiceKey("");
                }}
                className="mt-0.5 shrink-0"
              />
            </div>
          )}
          {editing?.recurring_service_id && (
            <p className="rounded-lg bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
              Esta edição altera apenas a fatura. Os valores e a frequência das próximas cobranças
              podem ser alterados no cadastro do cliente.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="payment-description">Descrição</Label>
            <Input
              id="payment-description"
              maxLength={500}
              value={form.description ?? ""}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              autoCapitalize="sentences"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="payment-amount">Valor (R$)</Label>
              <Input
                id="payment-amount"
                value={valueDisplay}
                onChange={(e) => {
                  const { display, numeric } = handleBRLInputChange(e.target.value);
                  setValueDisplay(display);
                  setForm({ ...form, amount: numeric });
                }}
                placeholder="R$ 0,00"
                inputMode="numeric"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label>Vencimento</Label>
              <CrmDatePicker
                value={form.due_date ?? ""}
                onChange={(value) => {
                  setForm({ ...form, due_date: value });
                  if (value) {
                    setRecurringDueDay(Number(value.slice(8, 10)));
                    setRecurringDueMonth(Number(value.slice(5, 7)));
                  }
                }}
                label="Data de vencimento"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(8rem,0.8fr)]">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="payment-client">Cliente{recurringEnabled ? " *" : ""}</Label>
              <Select
                value={form.client_id ?? "none"}
                disabled={saving || Boolean(editing?.recurring_service_id)}
                onValueChange={(v) => {
                  setForm({ ...form, client_id: v === "none" ? null : v });
                  setServiceKey("");
                }}
              >
                <SelectTrigger
                  id="payment-client"
                  className="w-full min-w-0"
                  title={
                    clients.find((client) => client.id === form.client_id)?.name ?? "Sem cliente"
                  }
                >
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    {recurringEnabled ? "Selecione um cliente" : "Sem cliente"}
                  </SelectItem>
                  {sortedClients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label>Status</Label>
              <Select
                value={form.status ?? "pendente"}
                onValueChange={(v) => setForm({ ...form, status: v as PaymentStatus })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="pago">Pago</SelectItem>
                  <SelectItem value="atrasado">Atrasado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {form.status === "pago" && (
            <div className="space-y-1.5">
              <Label>Data do recebimento</Label>
              <CrmDatePicker
                value={form.paid_at ?? toSaoPauloInputParts(new Date().toISOString()).date}
                onChange={(paid_at) => setForm({ ...form, paid_at })}
                label="Data do recebimento"
              />
            </div>
          )}
          {!recurringEnabled && (
            <div className="space-y-1.5">
              <Label>Competência</Label>
              <CrmMonthPicker
                label="Competência"
                disabled={Boolean(editing?.recurring_service_id)}
                value={(form.reference_month ?? form.due_date ?? "").slice(0, 7)}
                onChange={(value) =>
                  setForm({
                    ...form,
                    reference_month: value ? value + "-01" : null,
                  })
                }
              />
              <p className="text-xs text-muted-foreground">
                Mês de referência deste lançamento, separado da data de recebimento.
              </p>
            </div>
          )}
          {recurringEnabled && (
            <div className="space-y-2 rounded-xl border p-3">
              <Label htmlFor="payment-service">Serviço recorrente *</Label>
              <div className="form-paired-fields mb-3">
                <div className="form-field">
                  <Label>Frequência</Label>
                  <Select
                    value={recurringCycleValue}
                    onValueChange={(value) => setRecurringCycleValue(value as "monthly" | "annual")}
                  >
                    <SelectTrigger aria-label="Frequência da recorrência">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Mensal</SelectItem>
                      <SelectItem value="annual">Anual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {recurringCycleValue === "annual" && (
                  <div className="form-field">
                    <Label>Mês da cobrança anual</Label>
                    <Select
                      value={String(recurringDueMonth)}
                      onValueChange={(value) => setRecurringDueMonth(Number(value))}
                    >
                      <SelectTrigger aria-label="Mês da cobrança anual">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MONTH_NAMES.map((name, index) => (
                          <SelectItem key={name} value={String(index + 1)}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <Select
                value={serviceKey}
                onValueChange={selectService}
                disabled={!selectedClient || saving}
              >
                <SelectTrigger id="payment-service">
                  <SelectValue
                    placeholder={
                      selectedClient ? "Selecione o serviço" : "Selecione um cliente primeiro"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {serviceOptions.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.service_name}
                      {option.recurring
                        ? ` · ${formatBRL(option.recurring.amount)} · ${recurringCycle(option.recurring) === "annual" ? "anual" : "mensal"} · dia ${option.recurring.due_day}${option.recurring.active ? "" : " · inativo"}`
                        : " · nova recorrência"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="space-y-1.5">
                <Label htmlFor="payment-recurring-day">Dia da cobrança recorrente</Label>
                <Input
                  id="payment-recurring-day"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={31}
                  value={recurringDueDay || ""}
                  onChange={(event) => setRecurringDueDay(Number(event.target.value))}
                  className="w-24"
                />
                <p className="text-xs text-muted-foreground">
                  Nos meses mais curtos, dias 29, 30 ou 31 usam o último dia do mês.
                </p>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {selectedService?.recurring
                  ? "Ao salvar, o valor e o dia de vencimento deste serviço serão atualizados no cliente."
                  : "Ao salvar, o serviço será adicionado aos valores recorrentes do cliente."}{" "}
                Este lançamento já conta como a fatura do período. As próximas cobranças mensais ou
                anuais ficam disponíveis em Gerar faturas. O valor anual é integral e compõe o ARR;
                somente contratos mensais entram no MRR.
              </p>
              {selectedService?.recurring && !selectedService.recurring.active && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Este serviço está inativo e será reativado ao salvar.
                </p>
              )}
              {selectedClient && selectedClient.status !== "ativo" && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Este cliente está inativo. As próximas faturas só serão geradas depois de
                  ativá-lo.
                </p>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Link do contrato/proposta</Label>
            <Input
              value={form.contract_url ?? ""}
              onChange={(e) => setForm({ ...form, contract_url: e.target.value })}
              placeholder="https://..."
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              autoCapitalize="none"
              type="url"
            />
          </div>
        </fieldset>
        <DialogFooter>
          <Button disabled={saving} variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
