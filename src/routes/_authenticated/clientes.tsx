import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useState, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, formatBRL, formatPhone, stripPhone, toWhatsAppNumber } from "@/lib/auth";
import { formatDateBR } from "@/lib/date-format";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  Download,
} from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { toast } from "sonner";
import { safeCsvCell, safeExternalUrl } from "@/lib/security";
import { RecurringServicesEditor } from "@/components/RecurringServicesEditor";
import {
  type ClientRecurringService,
  recurringCycle,
  recurringTotals,
  buildClientRecurringItems,
} from "@/lib/recurring-services";
import { FilterBar, FilterSelect } from "@/components/FilterBar";
import { useListFilters } from "@/lib/list-filters";
import { localToday } from "@/lib/filter-utils";
import { fetchAllRows } from "@/lib/query-pagination";

export const Route = createFileRoute("/_authenticated/clientes")({
  component: ClientesLayout,
  head: () => ({ meta: [{ title: "CRM | Clientes" }] }),
});

type ClientStatus = "ativo" | "pausado" | "ex_cliente";

interface Client {
  id: string;
  name: string;
  company: string | null;
  contact: string | null;
  whatsapp: string | null;
  status: ClientStatus;
  services: string[];
  whatsapp_log: string | null;
  folder_links: string[];
  monthly_value: number | null;
  client_recurring_services: ClientRecurringService[];
  notes: string | null;
  source: string | null;
}

const STATUS_LABEL: Record<ClientStatus, string> = {
  ativo: "Ativo",
  pausado: "Pausado",
  ex_cliente: "Ex-cliente",
};
const STATUS_ORDER: Record<ClientStatus, number> = { ativo: 0, pausado: 1, ex_cliente: 2 };
const SERVICES = [
  "Tráfego Pago",
  "Sites/Landing Pages",
  "Social Media/Blogs",
  "Hospedagens",
  "Desenvolvimento",
  "Outros",
];
const ITEMS_PER_PAGE = 10;

type SortField = "name" | "status" | "monthly_value";
type SortDirection = "asc" | "desc";

// Layout component: shows list OR child route (detail page)
function ClientesLayout() {
  const matchRoute = useMatchRoute();
  const isChildRoute = matchRoute({ to: "/clientes/$clientId", fuzzy: true });

  if (isChildRoute) {
    return <Outlet />;
  }

  return <ClientesPage />;
}

function ClientesPage() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const views = useListFilters(
    { search: "", status: "all", service: "all", recurrence: "all", overdue: "all" },
    "clients",
    user?.id,
    {
      status: ["all", "ativo", "pausado", "ex_cliente"],
      recurrence: ["all", "monthly", "annual", "none"],
      overdue: ["all", "yes", "no"],
    },
  );
  const { filters } = views;
  const search = filters.search;
  const statusFilter = filters.status;
  const [overdueClients, setOverdueClients] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setLoadError(null);
      const overdue = new Set<string>();
      const [allClients, overduePayments] = await Promise.all([
        fetchAllRows<Client>(
          () =>
            supabase
              .from("clients")
              .select("*,client_recurring_services(*)", { count: "exact" })
              .order("created_at", { ascending: false })
              .order("id"),
          "clientes",
        ),
        fetchAllRows<{ id: string; client_id: string | null }>(
          () =>
            supabase
              .from("payments")
              .select("id,client_id", { count: "exact" })
              .neq("status", "pago")
              .lt("due_date", localToday())
              .order("id"),
          "recebimentos em atraso",
        ),
      ]);
      for (const payment of overduePayments) if (payment.client_id) overdue.add(payment.client_id);
      setClients(
        allClients.map((client) => ({
          ...client,
          client_recurring_services: [...(client.client_recurring_services ?? [])].sort(
            (a, b) => (a.position ?? 0) - (b.position ?? 0),
          ),
        })),
      );
      setOverdueClients(overdue);
    } catch {
      setLoadError("Não foi possível carregar clientes e recebimentos. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };
  const loadOnMount = useEffectEvent(load);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOnMount(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const filtered = useMemo(() => {
    let result = clients.filter((c) => {
      const matchSearch =
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.company ?? "").toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "all" || c.status === statusFilter;
      const activeRecurring = c.client_recurring_services.filter(
        (item) => item.active && Number(item.amount) > 0,
      );
      const matchService =
        filters.service === "all" ||
        c.services.includes(filters.service) ||
        activeRecurring.some((item) => item.service_name === filters.service);
      const matchRecurrence =
        filters.recurrence === "all" ||
        (filters.recurrence === "none"
          ? activeRecurring.length === 0
          : activeRecurring.some((item) => recurringCycle(item) === filters.recurrence));
      const matchOverdue =
        filters.overdue === "all" ||
        (filters.overdue === "yes" ? overdueClients.has(c.id) : !overdueClients.has(c.id));
      return matchSearch && matchStatus && matchService && matchRecurrence && matchOverdue;
    });

    if (sortField) {
      result = [...result].sort((a, b) => {
        let comparison = 0;
        if (sortField === "name") {
          comparison = a.name.localeCompare(b.name, "pt-BR");
        } else if (sortField === "status") {
          comparison = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        } else if (sortField === "monthly_value") {
          comparison = (a.monthly_value ?? 0) - (b.monthly_value ?? 0);
        }
        return sortDirection === "desc" ? -comparison : comparison;
      });
    }

    return result;
  }, [
    clients,
    search,
    statusFilter,
    filters.service,
    filters.recurrence,
    filters.overdue,
    overdueClients,
    sortField,
    sortDirection,
  ]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedClients = filtered.slice(
    (safeCurrentPage - 1) * ITEMS_PER_PAGE,
    safeCurrentPage * ITEMS_PER_PAGE,
  );
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE + 1;
  const endIndex = Math.min(safeCurrentPage * ITEMS_PER_PAGE, filtered.length);

  const handleSort = (field: SortField) => {
    setCurrentPage(1);
    if (sortField === field) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else {
        // Third click: remove sorting
        setSortField(null);
        setSortDirection("asc");
      }
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleSearchChange = (value: string) => {
    views.setFilter("search", value);
    setCurrentPage(1);
  };

  const handleStatusFilterChange = (value: string) => {
    views.setFilter("status", value);
    setCurrentPage(1);
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="h-3.5 w-3.5 ml-1 opacity-40" />;
    if (sortDirection === "asc") return <ArrowUp className="h-3.5 w-3.5 ml-1" />;
    return <ArrowDown className="h-3.5 w-3.5 ml-1" />;
  };

  const handleSave = async (form: Partial<Client>) => {
    if (!user) return;
    const requestedLinks = (form.folder_links ?? []).map((link) => link.trim()).filter(Boolean);
    const safeLinks = requestedLinks
      .map(safeExternalUrl)
      .filter((link): link is string => Boolean(link));
    if (safeLinks.length !== requestedLinks.length) {
      toast.error("Use apenas links HTTPS válidos.");
      return;
    }

    const payload = {
      name: form.name!,
      company: form.company ?? null,
      contact: form.contact ?? null,
      whatsapp: form.whatsapp ?? null,
      status: form.status ?? "ativo",
      services: form.services ?? [],
      whatsapp_log: form.whatsapp_log ?? null,
      folder_links: safeLinks,
      notes: form.notes ?? null,
      source: form.source ?? null,
    };
    let recurringItems;
    try {
      recurringItems = buildClientRecurringItems(form.client_recurring_services ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Recorrências inválidas.");
      return;
    }
    const { error } = await supabase.rpc("save_client_with_billing_cycles", {
      p_client_id: editing?.id ?? null,
      p_client: payload,
      p_items: recurringItems,
    });
    if (error) {
      toast.error(
        `Não foi possível ${editing ? "atualizar" : "criar"} o cliente: ${error.message}`,
      );
      return;
    }
    toast.success(editing ? "Cliente atualizado" : "Cliente criado");
    setOpen(false);
    setEditing(null);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este cliente?")) return;
    await supabase.from("clients").delete().eq("id", id);
    toast.success("Cliente removido");
    load();
  };

  // Export CSV
  const exportToCSV = (data: Client[], filename: string) => {
    const headers = [
      "Nome",
      "Empresa",
      "E-mail",
      "WhatsApp",
      "Status",
      "Serviços",
      "Cobranças mensais",
      "Cobranças anuais",
      "Equivalente mensal",
    ];
    const rows = data.map((c) => [
      c.name,
      c.company ?? "",
      c.contact ?? "",
      c.whatsapp ?? "",
      STATUS_LABEL[c.status],
      c.services.join("; "),
      recurringTotals(c.client_recurring_services).monthly.toFixed(2).replace(".", ","),
      recurringTotals(c.client_recurring_services).annual.toFixed(2).replace(".", ","),
      recurringTotals(c.client_recurring_services).monthlyEquivalent.toFixed(2).replace(".", ","),
    ]);

    const BOM = "\uFEFF";
    const csvContent =
      BOM +
      [headers.map(safeCsvCell).join(";"), ...rows.map((r) => r.map(safeCsvCell).join(";"))].join(
        "\n",
      );

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Arquivo exportado com sucesso!");
  };

  const [showExportMenu, setShowExportMenu] = useState(false);
  const serviceOptions = [
    ...new Set(
      clients.flatMap((client) => [
        ...client.services,
        ...client.client_recurring_services.map((item) => item.service_name),
      ]),
    ),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const filterLabels: Record<string, string> = {
    status: statusFilter === "all" ? "" : STATUS_LABEL[statusFilter as ClientStatus],
    service: filters.service === "all" ? "" : filters.service,
    recurrence:
      ({ monthly: "Mensal", annual: "Anual", none: "Sem recorrência" } as Record<string, string>)[
        filters.recurrence
      ] ?? "",
    overdue:
      filters.overdue === "yes"
        ? "Com recebimentos em atraso"
        : filters.overdue === "no"
          ? "Sem recebimentos em atraso"
          : "",
  };

  if (loading) {
    return (
      <div className="page-shell" aria-busy="true">
        <PageHeader title="Clientes" description="Carregando sua base de clientes" />
        <div className="space-y-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (loadError)
    return (
      <div className="page-shell">
        <PageHeader title="Clientes" />
        <p role="alert" className="text-destructive">
          {loadError}
        </p>
        <Button variant="outline" className="mt-4" onClick={() => void load()}>
          Tentar novamente
        </Button>
      </div>
    );

  return (
    <div className="page-shell">
      <FilterBar
        title="Clientes"
        description="Gerencie sua base de clientes e serviços"
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowExportMenu(!showExportMenu)}
                aria-label="Exportar clientes"
                aria-haspopup="menu"
                aria-expanded={showExportMenu}
              >
                <Download className="h-4 w-4" />
                Exportar
              </Button>
              {showExportMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg py-1 z-50 min-w-[200px]">
                    <button
                      onClick={() => {
                        exportToCSV(
                          filtered,
                          `clientes-filtrados-${formatDateBR(new Date()).replaceAll("/", "-")}`,
                        );
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors"
                    >
                      Exportar filtrados ({filtered.length})
                    </button>
                    <button
                      onClick={() => {
                        exportToCSV(
                          clients,
                          `clientes-todos-${formatDateBR(new Date()).replaceAll("/", "-")}`,
                        );
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors"
                    >
                      Exportar todos ({clients.length})
                    </button>
                  </div>
                </>
              )}
            </div>
            <Button
              size="sm"
              className="min-w-0"
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="truncate">Novo cliente</span>
            </Button>
          </div>
        }
        search={{
          value: search,
          onChange: handleSearchChange,
          placeholder: "Buscar por nome ou empresa...",
        }}
        resultCount={filtered.length}
        resultLabel="clientes"
        viewState={views}
        activeFilters={Object.entries(filterLabels)
          .filter(([, label]) => label)
          .map(([key, label]) => ({
            key,
            label,
            onClear: () => {
              views.setFilter(key as keyof typeof filters, "all");
              setCurrentPage(1);
            },
          }))}
        onReset={() => {
          views.resetFilters();
          setCurrentPage(1);
        }}
      >
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={handleStatusFilterChange}
          options={[
            { value: "all", label: "Todos" },
            ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
          ]}
        />
        <FilterSelect
          label="Serviço"
          value={filters.service}
          onChange={(value) => {
            views.setFilter("service", value);
            setCurrentPage(1);
          }}
          options={[
            { value: "all", label: "Todos" },
            ...serviceOptions.map((value) => ({ value, label: value })),
          ]}
        />
        <FilterSelect
          label="Recorrência"
          value={filters.recurrence}
          onChange={(value) => {
            views.setFilter("recurrence", value);
            setCurrentPage(1);
          }}
          options={[
            { value: "all", label: "Todas" },
            { value: "monthly", label: "Mensal" },
            { value: "annual", label: "Anual" },
            { value: "none", label: "Sem recorrência" },
          ]}
        />
        <FilterSelect
          label="Recebimentos em atraso"
          value={filters.overdue}
          onChange={(value) => {
            views.setFilter("overdue", value);
            setCurrentPage(1);
          }}
          options={[
            { value: "all", label: "Todos" },
            { value: "yes", label: "Com atraso" },
            { value: "no", label: "Sem atraso" },
          ]}
        />
      </FilterBar>

      <div className="mobile-card-list">
        {paginatedClients.length === 0 && (
          <div className="mobile-data-card py-10 text-center text-sm text-muted-foreground">
            Nenhum cliente encontrado. Ajuste os filtros ou cadastre um novo cliente.
          </div>
        )}
        {paginatedClients.map((client) => (
          <article key={client.id} className="mobile-data-card">
            <div className="flex items-start justify-between gap-3">
              <Link
                to="/clientes/$clientId"
                params={{ clientId: client.id }}
                className="min-w-0 flex-1"
              >
                <h2 className="truncate font-semibold">{client.name}</h2>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {client.company || "Sem empresa informada"}
                </p>
              </Link>
              <Badge
                variant={
                  client.status === "ativo"
                    ? "default"
                    : client.status === "pausado"
                      ? "secondary"
                      : "outline"
                }
              >
                {STATUS_LABEL[client.status]}
              </Badge>
            </div>
            <div className="mt-4 flex items-end justify-between gap-3 border-t border-border/60 pt-3">
              <div>
                <p className="text-xs text-muted-foreground">Equivalente mensal</p>
                <p className="mt-0.5 font-semibold tabular-nums">
                  {formatBRL(client.monthly_value ?? 0)}
                </p>
                {recurringTotals(client.client_recurring_services).annual > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {formatBRL(recurringTotals(client.client_recurring_services).monthly)}/mês ·{" "}
                    {formatBRL(recurringTotals(client.client_recurring_services).annual)}/ano
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                {client.whatsapp && (
                  <Button
                    variant="ghost"
                    size="icon"
                    asChild
                    aria-label={`Abrir WhatsApp de ${client.name}`}
                  >
                    <a
                      href={`https://wa.me/${toWhatsAppNumber(client.whatsapp)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <FaWhatsapp />
                    </a>
                  </Button>
                )}
                <Button variant="outline" size="sm" asChild>
                  <Link to="/clientes/$clientId" params={{ clientId: client.id }}>
                    Abrir
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(client);
                    setOpen(true);
                  }}
                >
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(client.id)}
                  aria-label={`Excluir ${client.name}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[550px]">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">
                  <button
                    onClick={() => handleSort("name")}
                    aria-sort={
                      sortField === "name"
                        ? sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    className="inline-flex items-center hover:text-foreground transition-colors"
                  >
                    Cliente{getSortIcon("name")}
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-medium">
                  <button
                    onClick={() => handleSort("status")}
                    className="inline-flex items-center hover:text-foreground transition-colors"
                  >
                    Status{getSortIcon("status")}
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Serviços</th>
                <th className="text-right px-4 py-3 font-medium">
                  <button
                    onClick={() => handleSort("monthly_value")}
                    className="inline-flex items-center hover:text-foreground transition-colors ml-auto"
                  >
                    Equivalente mensal{getSortIcon("monthly_value")}
                  </button>
                </th>
                <th className="w-[230px] px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {paginatedClients.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-muted-foreground">
                    Nenhum cliente encontrado.
                  </td>
                </tr>
              )}
              {paginatedClients.map((c) => (
                <tr
                  key={c.id}
                  className="border-t border-border hover:bg-muted/30 transition-colors group"
                >
                  <td className="px-4 py-3">
                    <Link
                      to="/clientes/$clientId"
                      params={{ clientId: c.id }}
                      className="hover:underline"
                    >
                      <div className="font-medium">{c.name}</div>
                      {c.company && (
                        <div className="text-xs text-muted-foreground">{c.company}</div>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        c.status === "ativo"
                          ? "default"
                          : c.status === "pausado"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {STATUS_LABEL[c.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {c.services.slice(0, 3).map((s) => (
                        <Badge key={s} variant="outline" className="text-xs font-normal">
                          {s}
                        </Badge>
                      ))}
                      {c.services.length > 3 && (
                        <span className="text-xs text-muted-foreground">
                          +{c.services.length - 3}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatBRL(c.monthly_value ?? 0)}
                    {recurringTotals(c.client_recurring_services).annual > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {formatBRL(recurringTotals(c.client_recurring_services).monthly)}/mês ·{" "}
                        {formatBRL(recurringTotals(c.client_recurring_services).annual)}/ano
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="touch-visible-action flex min-h-8 flex-nowrap items-center justify-end gap-1 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                      {c.whatsapp && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          asChild
                          aria-label={`Abrir WhatsApp de ${c.name}`}
                        >
                          <a
                            href={`https://wa.me/${toWhatsAppNumber(c.whatsapp)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <FaWhatsapp className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" asChild>
                        <Link to="/clientes/$clientId" params={{ clientId: c.id }}>
                          Abrir
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(c);
                          setOpen(true);
                        }}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(c.id)}
                        aria-label={`Excluir ${c.name}`}
                        className="text-muted-foreground hover:text-destructive"
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

        {/* Pagination */}
        {filtered.length > ITEMS_PER_PAGE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/30">
            <span className="text-sm text-muted-foreground">
              Mostrando {startIndex}–{endIndex} de {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={safeCurrentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="h-11 w-11 p-0 sm:h-8 sm:w-8"
                aria-label="Página anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <Button
                  key={page}
                  variant={page === safeCurrentPage ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setCurrentPage(page)}
                  className="hidden h-8 w-8 p-0 text-xs sm:inline-flex"
                  aria-current={page === safeCurrentPage ? "page" : undefined}
                >
                  {page}
                </Button>
              ))}
              <span className="px-2 text-sm text-muted-foreground sm:hidden">
                {safeCurrentPage} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={safeCurrentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="h-11 w-11 p-0 sm:h-8 sm:w-8"
                aria-label="Próxima página"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <ClientDialog
        key={`${editing?.id ?? "new"}:${open}`}
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        onSave={handleSave}
      />
    </div>
  );
}

function ClientDialog({
  open,
  onOpenChange,
  editing,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Client | null;
  onSave: (form: Partial<Client>) => Promise<void>;
}) {
  const initialClient: Partial<Client> = editing ?? {
    name: "",
    company: "",
    contact: "",
    whatsapp: "",
    status: "ativo",
    services: [],
    folder_links: [],
    client_recurring_services: [],
    whatsapp_log: "",
    notes: "",
    source: "",
  };
  const [form, setForm] = useState<Partial<Client>>(initialClient);
  const [folderText, setFolderText] = useState(() => (initialClient.folder_links ?? []).join("\n"));
  const [phoneDisplay, setPhoneDisplay] = useState(() => formatPhone(initialClient.whatsapp ?? ""));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const submit = async () => {
    if (savingRef.current || !form.name?.trim()) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave(form);
    } catch {
      toast.error("Não foi possível salvar o cliente. Tente novamente.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const toggleService = (svc: string) => {
    const cur = form.services ?? [];
    setForm({
      ...form,
      services: cur.includes(svc) ? cur.filter((s) => s !== svc) : [...cur, svc],
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!savingRef.current) onOpenChange(next);
      }}
    >
      <DialogContent className="flex flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar cliente" : "Novo cliente"}</DialogTitle>
        </DialogHeader>
        <fieldset
          disabled={saving}
          className="modal-form-scroll min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Nome</Label>
              <Input
                value={form.name ?? ""}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label>Empresa</Label>
              <Input
                value={form.company ?? ""}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label>E-mail</Label>
              <Input
                value={form.contact ?? ""}
                onChange={(e) => setForm({ ...form, contact: e.target.value })}
                placeholder="email@exemplo.com"
              />
            </div>
            <div>
              <Label>WhatsApp</Label>
              <Input
                value={phoneDisplay}
                onChange={(e) => {
                  const formatted = formatPhone(e.target.value);
                  setPhoneDisplay(formatted);
                  setForm({ ...form, whatsapp: stripPhone(e.target.value) });
                }}
                placeholder="(11) 99999-9999"
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select
                value={form.status ?? "ativo"}
                onValueChange={(v) => setForm({ ...form, status: v as ClientStatus })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="pausado">Pausado</SelectItem>
                  <SelectItem value="ex_cliente">Ex-cliente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Origem</Label>
              <Select
                value={form.source ?? ""}
                onValueChange={(val) => setForm({ ...form, source: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Instagram">Instagram</SelectItem>
                  <SelectItem value="Meta Ads">Meta Ads</SelectItem>
                  <SelectItem value="Google Ads">Google Ads</SelectItem>
                  <SelectItem value="TikTok">TikTok</SelectItem>
                  <SelectItem value="LinkedIn">LinkedIn</SelectItem>
                  <SelectItem value="Busca Orgânica">Busca Orgânica</SelectItem>
                  <SelectItem value="Indicação">Indicação</SelectItem>
                  <SelectItem value="Parceria Comercial">Parceria Comercial</SelectItem>
                  <SelectItem value="Prospecção Ativa">Prospecção Ativa</SelectItem>
                  <SelectItem value="Outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <RecurringServicesEditor
            items={form.client_recurring_services ?? []}
            onChange={(client_recurring_services) =>
              setForm({ ...form, client_recurring_services })
            }
          />
          <div>
            <Label>Serviços</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {SERVICES.map((s) => {
                const active = (form.services ?? []).includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleService(s)}
                    className={`min-h-10 rounded-full border px-3 py-1 text-xs transition-colors sm:min-h-0 ${active ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label>Histórico WhatsApp / Anotações</Label>
            <Textarea
              rows={5}
              value={form.whatsapp_log ?? ""}
              onChange={(e) => setForm({ ...form, whatsapp_log: e.target.value })}
              placeholder="Cole conversas, links, contexto..."
            />
          </div>
          <div>
            <Label>Links de pastas/trabalhos (um por linha)</Label>
            <Textarea
              rows={3}
              value={folderText}
              onChange={(e) => {
                setFolderText(e.target.value);
                setForm({
                  ...form,
                  folder_links: e.target.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                });
              }}
              placeholder="https://drive.google.com/..."
            />
          </div>
        </fieldset>
        <DialogFooter className="shrink-0 border-t border-border/60 pt-3">
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={saving || !form.name?.trim()} onClick={() => void submit()}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
