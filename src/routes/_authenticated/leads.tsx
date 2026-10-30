import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useState, useMemo } from "react";
import { LeadDialog, LabelManagerDialog } from "@/components/LeadEditor";
import { buildLeadUpdate, type Lead, type LeadLabel, type LabelAssignment } from "@/lib/leads";
import { normalizeReminderOffsets } from "@/lib/reminders";
import { FilterBar, FilterPeriod, FilterSelect } from "@/components/FilterBar";
import { filterChips } from "@/lib/filter-utils";
import { useListFilters } from "@/lib/list-filters";
import { dateInRange } from "@/lib/filter-utils";

import { moveAttachmentToTrash } from "@/lib/storage";
import type { AttachmentItem } from "@/components/AttachmentViewerModal";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, formatBRL, formatPhone, toWhatsAppNumber } from "@/lib/auth";
import { cn, getLabelColorClasses } from "@/lib/utils";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Trash2,
  Pencil,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  Filter,
  MoreHorizontal,
} from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { safeCsvCell } from "@/lib/security";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/_authenticated/leads")({
  component: LeadsLayout,
  head: () => ({ meta: [{ title: "CRM | Leads" }] }),
});

const ITEMS_PER_PAGE = 10;
const LEAD_FILTERS = {
  search: "",
  stage: "all",
  label: "all",
  source: "all",
  service: "all",
  from: "",
  to: "",
};
const STAGE_LABELS: Record<string, string> = {
  novo: "Novo Lead",
  contatado: "Contatado",
  proposta: "Proposta Enviada",
  negociacao: "Negociação",
  ganho: "Ganho",
  perdido: "Perdido",
};
const STAGE_ORDER = Object.keys(STAGE_LABELS).reduce(
  (acc, k, i) => ({ ...acc, [k]: i }),
  {} as Record<string, number>,
);

type SortField = "name" | "stage" | "estimated_value" | "created_at";
type SortDirection = "asc" | "desc";

function LeadsLayout() {
  const matchRoute = useMatchRoute();
  const isChildRoute = matchRoute({ to: "/leads/$leadId", fuzzy: true });

  if (isChildRoute) return <Outlet />;
  return <LeadsPage />;
}

function LeadsPage() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [allLabels, setAllLabels] = useState<LeadLabel[]>([]);
  const [assignments, setAssignments] = useState<LabelAssignment[]>([]);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [labelDialogOpen, setLabelDialogOpen] = useState(false);

  const views = useListFilters(LEAD_FILTERS, "leads", user?.id, {
    stage: ["all", ...Object.keys(STAGE_LABELS)],
  });
  const { filters } = views;
  const search = filters.search;
  const stageFilter = filters.stage;
  const labelFilter = filters.label;
  const setSearch = (value: string) => views.setFilter("search", value);
  const setStageFilter = (value: string) => views.setFilter("stage", value);
  const setLabelFilter = (value: string) => views.setFilter("label", value);
  const sourceOptions = [...new Set(leads.map((lead) => lead.source || "Não informado"))].sort(
    (a, b) => a.localeCompare(b, "pt-BR"),
  );
  const serviceOptions = [...new Set(leads.flatMap((lead) => lead.services ?? []))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );

  // Date filter (month)
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    const [leadsRes, labelsRes, assignsRes] = await Promise.all([
      supabase
        .from("leads")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase.from("lead_labels").select("*").order("created_at"),
      supabase.from("lead_label_assignments").select("lead_id, label_id"),
    ]);

    if (leadsRes.data)
      setLeads(
        leadsRes.data.map((lead) => ({
          ...lead,
          reminder_offsets_minutes: normalizeReminderOffsets(lead.reminder_offsets_minutes),
          attachments: Array.isArray(lead.attachments)
            ? (lead.attachments as unknown as AttachmentItem[])
            : [],
        })),
      );
    if (labelsRes.data) setAllLabels(labelsRes.data as LeadLabel[]);
    if (assignsRes.data) setAssignments(assignsRes.data as LabelAssignment[]);
    setLoading(false);
  };

  const loadOnMount = useEffectEvent(loadData);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOnMount(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const getLeadLabels = (leadId: string): LeadLabel[] => {
    const labelIds = assignments.filter((a) => a.lead_id === leadId).map((a) => a.label_id);
    return allLabels.filter((l) => labelIds.includes(l.id));
  };

  const filtered = useMemo(() => {
    let result = leads.filter((l) => {
      // Name/company search
      const matchSearch =
        !search ||
        l.name.toLowerCase().includes(search.toLowerCase()) ||
        (l.company ?? "").toLowerCase().includes(search.toLowerCase());

      // Stage filter
      const matchStage = stageFilter === "all" || l.stage === stageFilter;

      // Label filter
      const matchLabel =
        labelFilter === "all" ||
        assignments.some((a) => a.lead_id === l.id && a.label_id === labelFilter);

      const matchSource =
        filters.source === "all" || (l.source || "Não informado") === filters.source;
      const matchService =
        filters.service === "all" || (l.services ?? []).includes(filters.service);
      return (
        matchSearch &&
        matchStage &&
        matchLabel &&
        matchSource &&
        matchService &&
        dateInRange(l.created_at, filters.from, filters.to)
      );
    });

    if (sortField) {
      result = [...result].sort((a, b) => {
        let comparison = 0;
        if (sortField === "name") {
          comparison = a.name.localeCompare(b.name, "pt-BR");
        } else if (sortField === "stage") {
          comparison = STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
        } else if (sortField === "estimated_value") {
          comparison = (a.estimated_value ?? 0) - (b.estimated_value ?? 0);
        } else if (sortField === "created_at") {
          comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        }
        return sortDirection === "desc" ? -comparison : comparison;
      });
    }

    return result;
  }, [leads, assignments, search, stageFilter, labelFilter, sortField, sortDirection, filters]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedLeads = filtered.slice(
    (safeCurrentPage - 1) * ITEMS_PER_PAGE,
    safeCurrentPage * ITEMS_PER_PAGE,
  );
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE + 1;
  const endIndex = Math.min(safeCurrentPage * ITEMS_PER_PAGE, filtered.length);

  const handleSort = (field: SortField) => {
    setCurrentPage(1);
    if (sortField === field) {
      if (sortDirection === "asc") setSortDirection("desc");
      else {
        setSortField("created_at");
        setSortDirection("desc");
      }
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };

  const handleStageFilterChange = (value: string) => {
    setStageFilter(value);
    setCurrentPage(1);
  };

  const handleLabelFilterChange = (value: string) => {
    setLabelFilter(value);
    setCurrentPage(1);
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="h-3.5 w-3.5 ml-1 opacity-40" />;
    return sortDirection === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 ml-1" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 ml-1" />
    );
  };

  const exportToCSV = (data: Lead[], filename: string) => {
    const headers = [
      "Nome",
      "Empresa",
      "E-mail",
      "WhatsApp",
      "Estágio",
      "Valor Estimado",
      "Data de Criação",
      "Etiquetas",
      "Origem",
    ];
    const rows = data.map((l) => [
      l.name,
      l.company ?? "",
      l.contact ?? "",
      l.whatsapp ?? "",
      STAGE_LABELS[l.stage] || l.stage,
      (l.estimated_value ?? 0).toFixed(2).replace(".", ","),
      format(new Date(l.created_at), "dd/MM/yyyy HH:mm"),
      getLeadLabels(l.id)
        .map((lbl) => lbl.name)
        .join(", "),
      l.source ?? "",
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

  const openEditor = (lead: Lead) => {
    setEditing(lead);
    setEditorOpen(true);
  };

  const handleSave = async (form: Partial<Lead>, removedAttachmentPaths: string[] = []) => {
    if (!user || !editing) return false;
    const { error } = await supabase
      .from("leads")
      .update(buildLeadUpdate(form))
      .eq("id", editing.id)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .select("id")
      .single();
    if (error) {
      toast.error("Erro ao atualizar lead: " + error.message);
      return false;
    }
    const removalResults = await Promise.allSettled(
      removedAttachmentPaths.map((path) => {
        const attachment = editing.attachments?.find((item) => item.path === path) ?? {
          path,
          name: path.split("/").pop() ?? "Anexo",
        };
        return moveAttachmentToTrash("lead", editing.id, attachment);
      }),
    );
    if (removalResults.some((result) => result.status === "rejected")) {
      toast.warning("O lead foi salvo, mas um anexo não pôde ser movido para a lixeira.");
    }
    toast.success("Lead atualizado");
    setEditorOpen(false);
    setEditing(null);
    await loadData();
    return true;
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja mover este lead para a lixeira?")) return;
    const { error } = await supabase
      .from("leads")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error("Erro ao deletar lead.");
      return;
    }
    if (editing?.id === id) {
      setEditorOpen(false);
      setEditing(null);
    }
    toast.success("Lead movido para a lixeira", {
      action: {
        label: "Desfazer",
        onClick: () => {
          void supabase
            .from("leads")
            .update({ deleted_at: null })
            .eq("id", id)
            .then(() => loadData());
        },
      },
    });
    loadData();
  };

  if (loading) {
    return (
      <div className="page-shell" aria-busy="true">
        <PageHeader title="Todos os Leads" description="Carregando oportunidades" />
        <div className="space-y-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <FilterBar
        title="Todos os Leads"
        description="Sua base de oportunidades comerciais"
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Download />
                Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => exportToCSV(filtered, "leads-filtrados")}>
                Exportar filtrados ({filtered.length})
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportToCSV(leads, "leads-todos")}>
                Exportar todos ({leads.length})
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
        search={{
          value: search,
          onChange: handleSearchChange,
          placeholder: "Buscar lead ou empresa...",
        }}
        resultCount={filtered.length}
        resultLabel="leads"
        viewState={views}
        onReset={() => {
          views.resetFilters();
          setCurrentPage(1);
        }}
        activeFilters={filterChips(
          filters,
          LEAD_FILTERS,
          {
            search: "Busca",
            stage: "Etapa",
            label: "Etiqueta",
            source: "Origem",
            service: "Serviço",
            from: "Desde",
            to: "Até",
          },
          (key, value) => {
            views.setFilters({ [key]: value });
            setCurrentPage(1);
          },
          {
            stage: STAGE_LABELS,
            label: Object.fromEntries(allLabels.map((label) => [label.id, label.name])),
          },
        )}
      >
        <FilterSelect
          label="Etapa"
          value={stageFilter}
          onChange={handleStageFilterChange}
          options={[
            { value: "all", label: "Todas as etapas" },
            ...Object.entries(STAGE_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
        <FilterPeriod
          from={filters.from}
          to={filters.to}
          onChange={(from, to) => {
            views.setFilters({ from, to });
            setCurrentPage(1);
          }}
        />
        <FilterSelect
          label="Etiqueta"
          value={labelFilter}
          onChange={handleLabelFilterChange}
          options={[
            { value: "all", label: "Todas as etiquetas" },
            ...allLabels.map((label) => ({ value: label.id, label: label.name })),
          ]}
        />
        <FilterSelect
          label="Origem"
          value={filters.source}
          onChange={(source) => {
            views.setFilters({ source });
            setCurrentPage(1);
          }}
          options={[
            { value: "all", label: "Todas as origens" },
            ...sourceOptions.map((value) => ({ value, label: value })),
          ]}
        />
        <FilterSelect
          label="Serviço"
          value={filters.service}
          onChange={(service) => {
            views.setFilters({ service });
            setCurrentPage(1);
          }}
          options={[
            { value: "all", label: "Todos os serviços" },
            ...serviceOptions.map((value) => ({ value, label: value })),
          ]}
        />
      </FilterBar>

      <div className="mobile-card-list">
        {paginatedLeads.length === 0 && (
          <div className="mobile-data-card py-10 text-center text-sm text-muted-foreground">
            Nenhum lead encontrado. Ajuste os filtros ou crie um lead no Pipeline.
          </div>
        )}
        {paginatedLeads.map((lead) => (
          <article key={lead.id} className="mobile-data-card">
            <div className="flex items-start justify-between gap-3">
              <Link to="/leads/$leadId" params={{ leadId: lead.id }} className="min-w-0 flex-1">
                <h2 className="truncate font-semibold">{lead.name}</h2>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {lead.company || "Sem empresa informada"}
                </p>
              </Link>
              <Badge
                variant={lead.stage === "perdido" ? "destructive" : "secondary"}
                className={
                  lead.stage === "ganho" ? "border-transparent bg-emerald-500 text-white" : ""
                }
              >
                {STAGE_LABELS[lead.stage] || lead.stage}
              </Badge>
            </div>
            {getLeadLabels(lead.id).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {getLeadLabels(lead.id).map((label) => (
                  <span
                    key={label.id}
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[11px] font-medium",
                      getLabelColorClasses(label.color).light,
                    )}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-4 flex items-end justify-between gap-3 border-t border-border/60 pt-3">
              <div>
                <p className="text-xs text-muted-foreground">Valor estimado</p>
                <p className="mt-0.5 font-semibold tabular-nums">
                  {formatBRL(lead.estimated_value ?? 0)}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {lead.whatsapp && (
                  <Button
                    variant="ghost"
                    size="icon"
                    asChild
                    aria-label={`Abrir WhatsApp de ${lead.name}`}
                  >
                    <a
                      href={`https://wa.me/${toWhatsAppNumber(lead.whatsapp)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <FaWhatsapp />
                    </a>
                  </Button>
                )}
                <Button variant="outline" size="sm" asChild>
                  <Link to="/leads/$leadId" params={{ leadId: lead.id }}>
                    Abrir
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openEditor(lead)}
                  aria-label={`Editar ${lead.name}`}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(lead.id)}
                  aria-label={`Excluir ${lead.name}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {/* Table */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">
                  <button
                    onClick={() => handleSort("name")}
                    className="inline-flex items-center hover:text-foreground transition-colors"
                  >
                    Lead{getSortIcon("name")}
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-medium">
                  <button
                    onClick={() => handleSort("stage")}
                    className="inline-flex items-center hover:text-foreground transition-colors"
                  >
                    Estágio{getSortIcon("stage")}
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Etiquetas</th>
                <th className="text-right px-4 py-3 font-medium">
                  <button
                    onClick={() => handleSort("estimated_value")}
                    className="inline-flex items-center hover:text-foreground transition-colors ml-auto"
                  >
                    Valor{getSortIcon("estimated_value")}
                  </button>
                </th>
                <th className="text-right px-4 py-3 font-medium hidden sm:table-cell">
                  <button
                    onClick={() => handleSort("created_at")}
                    className="inline-flex items-center hover:text-foreground transition-colors ml-auto"
                  >
                    Data{getSortIcon("created_at")}
                  </button>
                </th>
                <th className="w-[180px] px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {paginatedLeads.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-muted-foreground">
                    Nenhum lead encontrado.
                  </td>
                </tr>
              )}
              {paginatedLeads.map((l) => (
                <tr
                  key={l.id}
                  className="border-t border-border hover:bg-muted/30 transition-colors group"
                >
                  <td className="px-4 py-3">
                    <Link to="/leads/$leadId" params={{ leadId: l.id }} className="hover:underline">
                      <div className="font-medium">{l.name}</div>
                      {l.company && (
                        <div className="text-xs text-muted-foreground">{l.company}</div>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={l.stage === "perdido" ? "destructive" : "secondary"}
                      className={
                        l.stage === "ganho"
                          ? "bg-emerald-500 hover:bg-emerald-600 text-white border-transparent"
                          : ""
                      }
                    >
                      {STAGE_LABELS[l.stage] || l.stage}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {getLeadLabels(l.id).map((lbl) => {
                        const theme = getLabelColorClasses(lbl.color);
                        return (
                          <span
                            key={lbl.id}
                            className={cn(
                              "px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider",
                              theme.light,
                            )}
                          >
                            {lbl.name}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatBRL(l.estimated_value ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground tabular-nums hidden sm:table-cell">
                    {format(new Date(l.created_at), "dd/MM/yyyy")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="touch-visible-action flex min-h-8 flex-nowrap items-center justify-end gap-1 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                      {l.whatsapp && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          asChild
                          aria-label={`Abrir WhatsApp de ${l.name}`}
                        >
                          <a
                            href={`https://wa.me/${toWhatsAppNumber(l.whatsapp)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <FaWhatsapp className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" asChild>
                        <Link to="/leads/$leadId" params={{ leadId: l.id }}>
                          Abrir
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEditor(l)}
                        aria-label={`Editar ${l.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(l.id)}
                        aria-label={`Excluir ${l.name}`}
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
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                // Show at most 5 pages (simplified)
                if (
                  totalPages > 5 &&
                  Math.abs(page - safeCurrentPage) > 2 &&
                  page !== 1 &&
                  page !== totalPages
                ) {
                  if (page === 2 || page === totalPages - 1)
                    return (
                      <span key={page} className="text-muted-foreground">
                        ...
                      </span>
                    );
                  return null;
                }
                return (
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
                );
              })}
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
      <LeadDialog
        key={`${editing?.id ?? "none"}:${editorOpen}`}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
        onSave={handleSave}
        onDelete={(lead) => void handleDelete(lead.id)}
        onManageLabels={() => setLabelDialogOpen(true)}
      />
      <LabelManagerDialog
        open={labelDialogOpen}
        onOpenChange={setLabelDialogOpen}
        leadId={editing?.id ?? null}
        allLabels={allLabels}
        assignments={assignments}
        onLabelsChanged={() => void loadData()}
      />
    </div>
  );
}
