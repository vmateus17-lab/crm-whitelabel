import { createFileRoute } from "@tanstack/react-router";
import { LeadDialog, LabelManagerDialog } from "@/components/LeadEditor";
import {
  buildLeadUpdate,
  type Lead,
  type LeadStage as Stage,
  type LeadLabel,
  type LabelAssignment,
} from "@/lib/leads";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useState, useEffect, useEffectEvent, useMemo, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { supabase } from "@/integrations/supabase/client";
import {
  useAuth,
  formatBRL,
  formatPhone,
  handleBRLInputChange,
  numberToBRLInput,
} from "@/lib/auth";
import { cn, getLabelColorClasses } from "@/lib/utils";
import { FilterBar, FilterPeriod, FilterSelect } from "@/components/FilterBar";
import { filterChips, getDatePreset } from "@/lib/filter-utils";
import { useListFilters } from "@/lib/list-filters";
import { dateInRange, localToday, matchesDateShortcut } from "@/lib/filter-utils";
import { fetchAllRows, isMissingAnalyticsHistory } from "@/lib/query-pagination";
import { commercialMetrics, type LeadStageEvent } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  Pencil,
  AlertTriangle,
  UserPlus,
  GripVertical,
  ChevronLeft,
  ChevronRight,
  Search,
  Filter,
  Paperclip,
  CalendarClock,
  Bell,
  MoreHorizontal,
  Copy,
} from "lucide-react";
import { AnimatedPeriodControls, PeriodToggle } from "@/components/PeriodToggle";
import { CrmDatePicker } from "@/components/CrmDatePicker";
import { toast } from "sonner";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { moveAttachmentToTrash } from "@/lib/storage";
import type { AttachmentItem } from "@/components/AttachmentViewerModal";
import {
  formatSaoPauloDateTime,
  normalizeReminderOffsets,
  toSaoPauloInputParts,
} from "@/lib/reminders";
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

export const Route = createFileRoute("/_authenticated/pipeline")({
  component: PipelinePage,
  head: () => ({ meta: [{ title: "CRM | Pipeline" }] }),
});

const DRAG_PREVIEW_DELAY_MS = 1_000;
const PIPELINE_FILTERS = {
  search: "",
  stage: "all",
  label: "all",
  source: "all",
  service: "all",
  from: "",
  to: "",
  dateBasis: "created",
  followUp: "all",
  history: "",
  leadIds: "",
};
const KANBAN_DROP_ANIMATION = {
  duration: 220,
  easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
};

interface StageConfig {
  id: string;
  stage_key: string;
  label: string;
  position: number;
  color: string | null;
}

const DEFAULT_STAGES: { id: Stage; label: string; color: string | null }[] = [
  { id: "novo", label: "Novo Lead", color: null },
  { id: "contatado", label: "Contatado", color: null },
  { id: "proposta", label: "Proposta Enviada", color: null },
  { id: "negociacao", label: "Negociação", color: null },
  { id: "ganho", label: "Ganho", color: "emerald" },
  { id: "perdido", label: "Perdido", color: null },
];

// Column color palette
const COLOR_OPTIONS = [
  { value: "", label: "Padrão" },
  { value: "slate", label: "Cinza" },
  { value: "blue", label: "Azul" },
  { value: "emerald", label: "Verde" },
  { value: "amber", label: "Âmbar" },
  { value: "rose", label: "Rosa" },
  { value: "violet", label: "Violeta" },
  { value: "cyan", label: "Ciano" },
];

const COLOR_CLASSES: Record<string, { header: string; dot: string; border: string }> = {
  "": { header: "", dot: "bg-muted-foreground/40", border: "" },
  slate: {
    header: "text-slate-600 dark:text-slate-400",
    dot: "bg-slate-400",
    border: "border-t-slate-400/50",
  },
  blue: {
    header: "text-blue-600 dark:text-blue-400",
    dot: "bg-blue-400",
    border: "border-t-blue-400/50",
  },
  emerald: {
    header: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-400",
    border: "border-t-emerald-400/50",
  },
  amber: {
    header: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-400",
    border: "border-t-amber-400/50",
  },
  rose: {
    header: "text-rose-600 dark:text-rose-400",
    dot: "bg-rose-400",
    border: "border-t-rose-400/50",
  },
  violet: {
    header: "text-violet-600 dark:text-violet-400",
    dot: "bg-violet-400",
    border: "border-t-violet-400/50",
  },
  cyan: {
    header: "text-cyan-600 dark:text-cyan-400",
    dot: "bg-cyan-400",
    border: "border-t-cyan-400/50",
  },
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

function PipelinePage() {
  const { user } = useAuth();
  const monthRange = getDatePreset("month");
  const pipelineDefaults = { ...PIPELINE_FILTERS, from: monthRange.from, to: monthRange.to };
  const [leads, setLeads] = useState<Lead[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [duplicatingLead, setDuplicatingLead] = useState<Lead | null>(null);
  const [savingDuplicate, setSavingDuplicate] = useState(false);
  const [defaultLeadStage, setDefaultLeadStage] = useState<Stage>("novo");
  const [newLeadStage, setNewLeadStage] = useState<Stage | null>(null);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertingLead, setConvertingLead] = useState<Lead | null>(null);
  const [convertToClient, setConvertToClient] = useState(true);
  const [registerPayment, setRegisterPayment] = useState(true);
  const [wonPaymentValue, setWonPaymentValue] = useState(0);
  const [wonPaymentDisplay, setWonPaymentDisplay] = useState("");
  const [wonMonthlyValue, setWonMonthlyValue] = useState(0);
  const [wonMonthlyDisplay, setWonMonthlyDisplay] = useState("");
  const [wonPaymentDescription, setWonPaymentDescription] = useState("");
  const [wonPaidAt, setWonPaidAt] = useState(localToday());
  const [savingWonLead, setSavingWonLead] = useState(false);

  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingLead, setDeletingLead] = useState<Lead | null>(null);

  // Labels
  const [allLabels, setAllLabels] = useState<LeadLabel[]>([]);
  const [assignments, setAssignments] = useState<LabelAssignment[]>([]);
  const [labelDialogOpen, setLabelDialogOpen] = useState(false);
  const [labelDialogLeadId, setLabelDialogLeadId] = useState<string | null>(null);

  // Stage customization
  const [stageConfigs, setStageConfigs] = useState<StageConfig[]>([]);
  const [editingStages, setEditingStages] = useState(false);
  const [tempStages, setTempStages] = useState<{ key: string; label: string; color: string }[]>([]);

  const views = useListFilters(pipelineDefaults, "pipeline", user?.id, {
    stage: ["all", "open", "novo", "contatado", "proposta", "negociacao", "ganho", "perdido"],
    dateBasis: ["created", "closed"],
    followUp: ["all", "today", "overdue", "next7", "none"],
    history: ["", "ganho", "perdido"],
  });
  const { filters } = views;
  const [historyEvents, setHistoryEvents] = useState<LeadStageEvent[] | null>(null);
  const [historyNotice, setHistoryNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const sourceOptions = [...new Set(leads.map((lead) => lead.source || "Não informado"))].sort(
    (a, b) => a.localeCompare(b, "pt-BR"),
  );
  const serviceOptions = [...new Set(leads.flatMap((lead) => lead.services ?? []))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  const historicalIds = useMemo(() => {
    if (filters.history)
      return new Set(
        commercialMetrics(leads, historyEvents, { from: filters.from, to: filters.to })
          .outcomes.filter((lead) => lead.stage === filters.history)
          .map((lead) => lead.id),
      );
    if (filters.leadIds)
      return new Set(
        filters.leadIds
          .split(",")
          .filter((id) =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
          ),
      );
    return null;
  }, [leads, historyEvents, filters.history, filters.leadIds, filters.from, filters.to]);

  // Lost lead reason dialog
  const [lostReasonDialogOpen, setLostReasonDialogOpen] = useState(false);
  const [losingLead, setLosingLead] = useState<Lead | null>(null);
  const [settledOverStage, setSettledOverStage] = useState<Stage | null>(null);
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null);
  const [activeCardHeight, setActiveCardHeight] = useState(88);
  const dragPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStageRef = useRef<Stage | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const clearDragPreview = () => {
    if (dragPreviewTimerRef.current) clearTimeout(dragPreviewTimerRef.current);
    dragPreviewTimerRef.current = null;
    pendingStageRef.current = null;
    setSettledOverStage(null);
    setDragOverStage(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    clearDragPreview();
    setActiveId(event.active.id as string);
    setActiveCardHeight(Math.max(72, event.active.rect.current.initial?.height ?? 88));
  };

  const handleDragOver = (event: DragOverEvent) => {
    const nextStage = event.over?.id as Stage | undefined;
    const lead = leads.find((candidate) => candidate.id === event.active.id);
    if (!nextStage || !lead || nextStage === lead.stage) {
      clearDragPreview();
      return;
    }
    setDragOverStage(nextStage);
    if (settledOverStage === nextStage || pendingStageRef.current === nextStage) return;

    if (dragPreviewTimerRef.current) clearTimeout(dragPreviewTimerRef.current);
    setSettledOverStage(null);
    pendingStageRef.current = nextStage;
    dragPreviewTimerRef.current = setTimeout(() => {
      setSettledOverStage(nextStage);
      pendingStageRef.current = null;
      dragPreviewTimerRef.current = null;
    }, DRAG_PREVIEW_DELAY_MS);
  };

  useEffect(
    () => () => {
      if (dragPreviewTimerRef.current) clearTimeout(dragPreviewTimerRef.current);
    },
    [],
  );

  const stages = useMemo(() => {
    if (stageConfigs.length === 0) return DEFAULT_STAGES;
    const sorted = [...stageConfigs].sort((a, b) => a.position - b.position);
    return sorted.map((sc) => ({ id: sc.stage_key as Stage, label: sc.label, color: sc.color }));
  }, [stageConfigs]);

  const load = async () => {
    try {
      const data = await fetchAllRows<Lead>(
        () => supabase.from("leads").select("*").is("deleted_at", null).order("id"),
        "os leads",
      );
      setLeads(
        data.map((lead) => ({
          ...lead,
          reminder_offsets_minutes: normalizeReminderOffsets(lead.reminder_offsets_minutes),
          attachments: Array.isArray(lead.attachments)
            ? (lead.attachments as unknown as AttachmentItem[])
            : [],
        })),
      );
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Não foi possível carregar os leads.");
    }
    try {
      const events = await fetchAllRows<LeadStageEvent>(
        () =>
          (supabase as SupabaseClient)
            .from("lead_stage_history")
            .select("id,lead_id,to_stage,entered_at")
            .order("id"),
        "o histórico comercial",
      );
      setHistoryEvents(events);
      setHistoryNotice("");
    } catch (error) {
      setHistoryEvents(null);
      setHistoryNotice(
        isMissingAnalyticsHistory(error)
          ? "O histórico por evento ainda não está disponível. Os encerramentos antigos usam o status e a data de fechamento cadastrados; aplique o SQL para registrar reaberturas e mudanças futuras."
          : error instanceof Error
            ? error.message
            : "Não foi possível carregar o histórico comercial.",
      );
    }
  };

  const loadStageConfigs = async () => {
    const { data } = await supabase.from("pipeline_stages").select("*").order("position");
    if (data && data.length > 0) setStageConfigs(data as StageConfig[]);
  };

  const loadLabels = async () => {
    const { data } = await supabase.from("lead_labels").select("*").order("created_at");
    setAllLabels((data ?? []) as LeadLabel[]);
  };

  const loadAssignments = async () => {
    const { data } = await supabase.from("lead_label_assignments").select("lead_id, label_id");
    setAssignments((data ?? []) as LabelAssignment[]);
  };

  const loadDefaults = async () => {
    const { data } = await supabase
      .from("user_settings")
      .select("default_lead_stage")
      .maybeSingle();
    if (data?.default_lead_stage) setDefaultLeadStage(data.default_lead_stage as Stage);
  };

  const loadOnMount = useEffectEvent(() =>
    Promise.all([load(), loadStageConfigs(), loadLabels(), loadAssignments(), loadDefaults()]),
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOnMount(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Get labels for a specific lead
  const getLeadLabels = (leadId: string): LeadLabel[] => {
    const labelIds = assignments.filter((a) => a.lead_id === leadId).map((a) => a.label_id);
    return allLabels.filter((l) => labelIds.includes(l.id));
  };

  const filteredLeads = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    return leads.filter((lead) => {
      const matchesSearch =
        !query ||
        lead.name.toLowerCase().includes(query) ||
        (lead.company ?? "").toLowerCase().includes(query);
      const matchesPeriod = historicalIds
        ? historicalIds.has(lead.id)
        : dateInRange(
            filters.dateBasis === "closed" ? lead.closed_at : lead.created_at,
            filters.from,
            filters.to,
          );
      const matchesStage =
        historicalIds ||
        filters.stage === "all" ||
        (filters.stage === "open"
          ? !["ganho", "perdido"].includes(lead.stage)
          : lead.stage === filters.stage);
      const matchesLabel =
        filters.label === "all" ||
        assignments.some(
          (assignment) => assignment.lead_id === lead.id && assignment.label_id === filters.label,
        );
      const matchesSource =
        filters.source === "all" || (lead.source || "Não informado") === filters.source;
      const matchesService =
        filters.service === "all" || (lead.services ?? []).includes(filters.service);
      return (
        matchesSearch &&
        matchesPeriod &&
        matchesStage &&
        matchesLabel &&
        matchesSource &&
        matchesService &&
        matchesDateShortcut(
          lead.follow_up_at,
          filters.followUp,
          ["ganho", "perdido"].includes(lead.stage),
          localToday(),
          lead.follow_up_has_time,
        )
      );
    });
  }, [leads, assignments, filters, historicalIds]);

  const getStageTransitionField = (newStage: Stage): Record<string, string | null> => {
    const nowISO = new Date().toISOString();
    switch (newStage) {
      case "contatado":
        return { contacted_at: nowISO, closed_at: null };
      case "proposta":
        return { proposal_sent_at: nowISO, closed_at: null };
      case "negociacao":
        return { negotiation_at: nowISO, closed_at: null };
      case "ganho":
        return { closed_at: nowISO };
      case "perdido":
        return { closed_at: nowISO };
      default:
        return { closed_at: null };
    }
  };

  const openWonDialog = (lead: Lead) => {
    const estimated = Number(lead.estimated_value ?? 0);
    setConvertingLead(lead);
    setConvertToClient(true);
    setRegisterPayment(estimated > 0);
    setWonPaymentValue(estimated);
    setWonPaymentDisplay(numberToBRLInput(estimated));
    setWonMonthlyValue(0);
    setWonMonthlyDisplay(numberToBRLInput(0));
    setWonPaymentDescription(`Venda - ${lead.name}`);
    setWonPaidAt(localToday());
    setConvertDialogOpen(true);
  };

  const closeWonLead = async (onlyMove = false) => {
    if (!convertingLead) return;
    if (!onlyMove && registerPayment && wonPaymentValue <= 0) {
      toast.error("Informe um valor recebido maior que zero.");
      return;
    }
    setSavingWonLead(true);
    const { error } = await (supabase as SupabaseClient).rpc("close_won_lead", {
      p_lead_id: convertingLead.id,
      p_convert_client: onlyMove ? false : convertToClient,
      p_create_payment: onlyMove ? false : registerPayment,
      p_payment_amount: wonPaymentValue,
      p_payment_description: wonPaymentDescription,
      p_paid_at: wonPaidAt,
      p_monthly_value: wonMonthlyValue,
    });
    setSavingWonLead(false);
    if (error) {
      toast.error("Não foi possível concluir a venda: " + error.message);
      return;
    }
    toast.success(onlyMove ? "Lead marcado como ganho." : "Venda registrada com sucesso.");
    setConvertDialogOpen(false);
    setConvertingLead(null);
    await load();
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    clearDragPreview();
    setActiveId(null);
    const leadId = e.active.id as string;
    const newStage = e.over?.id as Stage | undefined;
    if (!newStage) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage === newStage) return;

    if (newStage === "perdido") {
      setLosingLead(lead);
      setLostReasonDialogOpen(true);
      return;
    }

    if (newStage === "ganho") {
      openWonDialog(lead);
      return;
    }

    const transitionFields = getStageTransitionField(newStage);
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, stage: newStage, ...transitionFields } : l)),
    );
    const { error } = await supabase
      .from("leads")
      .update({
        stage: newStage,
        loss_reason: null,
        loss_reason_details: null,
        ...transitionFields,
      })
      .eq("id", leadId)
      .is("deleted_at", null);
    if (error) toast.error("Não foi possível mover o lead: " + error.message);
    await load();
  };

  const handleLostReasonSave = async (reason: string, details: string) => {
    if (!losingLead) return;
    const transitionFields = getStageTransitionField("perdido");

    setLeads((prev) =>
      prev.map((l) =>
        l.id === losingLead.id
          ? {
              ...l,
              stage: "perdido",
              loss_reason: reason,
              loss_reason_details: details,
              ...transitionFields,
            }
          : l,
      ),
    );
    const { error } = await supabase
      .from("leads")
      .update({
        stage: "perdido",
        loss_reason: reason,
        loss_reason_details: details,
        ...transitionFields,
      })
      .eq("id", losingLead.id)
      .is("deleted_at", null);
    if (error) {
      toast.error("Não foi possível registrar a perda: " + error.message);
      await load();
      return;
    }
    await load();

    setLostReasonDialogOpen(false);
    setLosingLead(null);
    toast.success("Lead marcado como perdido");
  };

  const handleSave = async (
    form: Partial<Lead>,
    removedAttachmentPaths: string[] = [],
  ): Promise<boolean> => {
    if (!user) return false;
    let savedLeadId = editing?.id ?? null;
    if (editing) {
      const { error } = await supabase
        .from("leads")
        .update(buildLeadUpdate(form))
        .eq("id", editing.id)
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .select("id")
        .single();
      if (error) {
        toast.error("Erro: " + error.message);
        return false;
      }
      toast.success("Lead atualizado");
    } else {
      const { data, error } = await supabase
        .from("leads")
        .insert({
          ...buildLeadUpdate(form),
          user_id: user.id,
          stage: newLeadStage ?? defaultLeadStage,
        })
        .select("id")
        .single();
      if (error) {
        toast.error("Erro ao criar lead: " + error.message);
        return false;
      }
      savedLeadId = data.id;
      setNewLeadStage(null);
      toast.success("Lead criado");
    }

    const originalAttachments = editing?.attachments ?? [];
    const removalResults = await Promise.allSettled(
      removedAttachmentPaths.map((path) => {
        const attachment =
          originalAttachments.find((item) => item.path === path) ??
          ({ path, name: path.split("/").pop() ?? "Anexo" } as AttachmentItem);
        return moveAttachmentToTrash("lead", savedLeadId!, attachment);
      }),
    );
    if (removalResults.some((result) => result.status === "rejected")) {
      toast.warning("O lead foi salvo, mas um anexo não pôde ser movido para a lixeira.");
    }

    setOpen(false);
    setEditing(null);
    load();
    return true;
  };

  const handleDuplicate = async () => {
    if (!user || !duplicatingLead || savingDuplicate) return;
    setSavingDuplicate(true);
    try {
      const { error } = await (supabase as SupabaseClient).rpc("duplicate_lead", {
        p_lead_id: duplicatingLead.id,
      });
      if (error) {
        toast.error("Não foi possível duplicar o lead: " + error.message);
        return;
      }
      views.setFilters({
        ...PIPELINE_FILTERS,
        stage: "novo",
        from: localToday(),
        to: localToday(),
      });
      setDuplicatingLead(null);
      await Promise.all([load(), loadAssignments()]);
      toast.success("Lead duplicado na etapa Novo Lead, com a data de hoje.");
    } catch (error) {
      toast.error(
        "Não foi possível duplicar o lead: " +
          (error instanceof Error ? error.message : "erro desconhecido"),
      );
    } finally {
      setSavingDuplicate(false);
    }
  };

  const confirmDelete = (lead: Lead) => {
    setDeletingLead(lead);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingLead) return;
    await supabase
      .from("leads")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", deletingLead.id);
    toast.success("Lead movido para a lixeira", {
      action: {
        label: "Desfazer",
        onClick: () => {
          if (deletingLead)
            void supabase
              .from("leads")
              .update({ deleted_at: null })
              .eq("id", deletingLead.id)
              .then(() => load());
        },
      },
    });
    setDeleteDialogOpen(false);
    setDeletingLead(null);
    load();
  };

  const openLabelDialog = (leadId: string) => {
    setLabelDialogLeadId(leadId);
    setLabelDialogOpen(true);
  };

  const openStageEditor = () => {
    setTempStages(stages.map((s) => ({ key: s.id, label: s.label, color: s.color ?? "" })));
    setEditingStages(true);
  };

  const saveStageConfigs = async () => {
    if (!user) return;
    await supabase.from("pipeline_stages").delete().eq("user_id", user.id);
    const inserts = tempStages.map((s, i) => ({
      user_id: user.id,
      stage_key: s.key,
      label: s.label,
      position: i,
      color: s.color || null,
    }));
    const { error } = await supabase.from("pipeline_stages").insert(inserts);
    if (error) {
      toast.error("Erro: " + error.message);
      return;
    }
    toast.success("Colunas atualizadas");
    setEditingStages(false);
    loadStageConfigs();
  };

  const moveStage = (index: number, direction: "up" | "down") => {
    const newStages = [...tempStages];
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= newStages.length) return;
    [newStages[index], newStages[targetIdx]] = [newStages[targetIdx], newStages[index]];
    setTempStages(newStages);
  };

  const activeLead = leads.find((l) => l.id === activeId);
  const openNewLeadDialog = () => {
    setEditing(null);
    setNewLeadStage(null);
    setOpen(true);
  };

  return (
    <div className="page-shell h-full flex flex-col">
      <FilterBar
        title="Pipeline"
        description="Acompanhe oportunidades e próximos contatos"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={openStageEditor}>
              <Pencil />
              Editar etapas
            </Button>
            <Button onClick={openNewLeadDialog}>
              <Plus />
              Novo lead
            </Button>
          </div>
        }
        search={{
          value: filters.search,
          onChange: (search) => views.setFilters({ search }),
          placeholder: "Buscar lead ou empresa...",
        }}
        resultCount={filteredLeads.length}
        resultLabel="oportunidades"
        viewState={views}
        onReset={views.resetFilters}
        activeFilters={filterChips(
          filters,
          pipelineDefaults,
          {
            search: "Busca",
            stage: "Etapa",
            label: "Etiqueta",
            source: "Origem",
            service: "Serviço",
            from: "Desde",
            to: "Até",
            dateBasis: "Data",
            followUp: "Follow-up",
            history: "Encerramentos",
            leadIds: "Encerramentos por registro",
          },
          (key, value) => {
            if (key === "history" || key === "leadIds")
              views.setFilters({ history: "", leadIds: "", stage: "all" });
            else views.setFilters({ [key]: value });
          },
          {
            stage: Object.fromEntries(stages.map((stage) => [stage.id, stage.label])),
            label: Object.fromEntries(allLabels.map((label) => [label.id, label.name])),
            dateBasis: { created: "Criação", closed: "Fechamento" },
            followUp: {
              today: "Hoje",
              overdue: "Atrasado",
              next7: "Próximos 7 dias",
              none: "Sem agendamento",
            },
            history: { ganho: "Ganhos no período", perdido: "Perdas no período" },
            leadIds: { [filters.leadIds]: "Registros do relatório" },
          },
        )}
      >
        <FilterPeriod
          from={filters.from}
          to={filters.to}
          onChange={(from, to) => views.setFilters({ from, to })}
        />
        <FilterSelect
          label="Follow-up"
          value={filters.followUp}
          onChange={(followUp) => views.setFilters({ followUp })}
          options={[
            { value: "all", label: "Todos" },
            { value: "today", label: "Hoje" },
            { value: "overdue", label: "Atrasados" },
            { value: "next7", label: "Próximos 7 dias" },
            { value: "none", label: "Sem agendamento" },
          ]}
        />
        <FilterSelect
          label="Data do período"
          value={filters.dateBasis}
          onChange={(dateBasis) => views.setFilters({ dateBasis, history: "", leadIds: "" })}
          options={[
            { value: "created", label: "Criação do lead" },
            { value: "closed", label: "Fechamento atual" },
          ]}
        />
        <FilterSelect
          label="Etapa atual"
          value={filters.stage}
          onChange={(stage) => views.setFilters({ stage, history: "", leadIds: "" })}
          options={[
            { value: "all", label: "Todas as etapas" },
            { value: "open", label: "Abertos" },
            ...stages.map((stage) => ({ value: stage.id, label: stage.label })),
          ]}
        />
        <FilterSelect
          label="Etiqueta"
          value={filters.label}
          onChange={(label) => views.setFilters({ label })}
          options={[
            { value: "all", label: "Todas as etiquetas" },
            ...allLabels.map((label) => ({ value: label.id, label: label.name })),
          ]}
        />
        <FilterSelect
          label="Origem"
          value={filters.source}
          onChange={(source) => views.setFilters({ source })}
          options={[
            { value: "all", label: "Todas as origens" },
            ...sourceOptions.map((value) => ({ value, label: value })),
          ]}
        />
        <FilterSelect
          label="Serviço"
          value={filters.service}
          onChange={(service) => views.setFilters({ service })}
          options={[
            { value: "all", label: "Todos os serviços" },
            ...serviceOptions.map((value) => ({ value, label: value })),
          ]}
        />
      </FilterBar>
      {historicalIds && (
        <p className="mb-4 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Posição atual dos leads encerrados no período selecionado. Um lead reaberto aparece na
          etapa atual; vários encerramentos do mesmo lead representam uma única oportunidade aqui.
        </p>
      )}
      {historyNotice && historicalIds && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          {historyNotice}
        </p>
      )}
      {loadError && (
        <Card role="alert" className="mb-4 p-4">
          <p className="text-sm">{loadError}</p>
          <Button className="mt-3" variant="outline" onClick={() => void load()}>
            Tentar novamente
          </Button>
        </Card>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          clearDragPreview();
          setActiveId(null);
        }}
      >
        <div
          className="flex min-h-0 flex-1 snap-x snap-mandatory items-stretch gap-4 overflow-x-auto pb-4 sm:snap-none"
          aria-label="Etapas do pipeline"
        >
          {stages.map((stage) => {
            const stageLeads = filteredLeads.filter((l) => l.stage === stage.id);
            const totalValue = stageLeads.reduce(
              (sum, l) => sum + Number(l.estimated_value ?? 0),
              0,
            );
            return (
              <Column
                key={stage.id}
                stage={stage}
                leads={stageLeads}
                totalValue={totalValue}
                color={stage.color ?? ""}
                onEdit={(l) => {
                  setEditing(l);
                  setNewLeadStage(null);
                  setOpen(true);
                }}
                onAdd={() => {
                  setEditing(null);
                  setNewLeadStage(stage.id);
                  setOpen(true);
                }}
                getLeadLabels={getLeadLabels}
                settledOverStage={settledOverStage}
                highlighted={dragOverStage === stage.id}
                activeCardHeight={activeCardHeight}
              />
            );
          })}
        </div>
        <DragOverlay dropAnimation={KANBAN_DROP_ANIMATION} zIndex={80}>
          {activeLead ? (
            <LeadCard lead={activeLead} labels={getLeadLabels(activeLead.id)} dragging />
          ) : null}
        </DragOverlay>
      </DndContext>

      <LeadDialog
        key={`${editing?.id ?? "new"}:${open}`}
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setNewLeadStage(null);
        }}
        editing={editing}
        onSave={handleSave}
        onDuplicate={setDuplicatingLead}
        onDelete={(lead) => {
          setOpen(false);
          confirmDelete(lead);
        }}
        onManageLabels={(lead) => openLabelDialog(lead.id)}
      />

      {/* Label manager dialog */}
      <LabelManagerDialog
        open={labelDialogOpen}
        onOpenChange={setLabelDialogOpen}
        leadId={labelDialogLeadId}
        allLabels={allLabels}
        assignments={assignments}
        onLabelsChanged={() => {
          loadLabels();
          loadAssignments();
        }}
      />

      <Dialog
        open={Boolean(duplicatingLead)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !savingDuplicate) setDuplicatingLead(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="h-4 w-4" /> Duplicar lead
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Criar uma nova oportunidade para{" "}
            <span className="font-medium text-foreground">{duplicatingLead?.name}</span> na etapa
            Novo Lead, com a data de hoje?
          </p>
          <p className="text-sm text-muted-foreground">
            Os dados já salvos de cadastro e etiquetas serão copiados. Salve eventuais alterações
            antes de duplicar. O original será preservado; histórico, anexos, follow-ups e
            pagamentos não serão copiados.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={savingDuplicate}
              onClick={() => setDuplicatingLead(null)}
            >
              Cancelar
            </Button>
            <Button disabled={savingDuplicate} onClick={() => void handleDuplicate()}>
              {savingDuplicate ? "Duplicando..." : "Duplicar lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Mover para a lixeira?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              O lead <strong>"{deletingLead?.name}"</strong> será movido para a lixeira. Você poderá
              restaurá-lo em <strong>Configurações → Lixeira</strong>.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setDeletingLead(null);
              }}
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 mr-2" />
              Mover para lixeira
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert to client dialog */}
      <Dialog
        open={convertDialogOpen}
        onOpenChange={(open) => {
          if (!savingWonLead) {
            setConvertDialogOpen(open);
            if (!open) setConvertingLead(null);
          }
        }}
      >
        <DialogContent className="overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-emerald-600" />
              Concluir venda
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Defina o que deve acontecer ao mover <strong>"{convertingLead?.name}"</strong> para
              Ganho.
            </p>
            {convertingLead && (
              <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
                <div>
                  <span className="text-muted-foreground">Nome:</span> {convertingLead.name}
                </div>
                {convertingLead.company && (
                  <div>
                    <span className="text-muted-foreground">Empresa:</span> {convertingLead.company}
                  </div>
                )}
                {convertingLead.whatsapp && (
                  <div>
                    <span className="text-muted-foreground">WhatsApp:</span>{" "}
                    {formatPhone(convertingLead.whatsapp)}
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Valor estimado:</span>{" "}
                  {formatBRL(convertingLead.estimated_value ?? 0)}
                </div>
              </div>
            )}
            <label className="flex items-start gap-3 rounded-xl border border-border p-3 cursor-pointer">
              <Checkbox
                checked={convertToClient}
                onCheckedChange={(value) => setConvertToClient(value === true)}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-medium">Converter em cliente</span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Cria o cliente uma única vez e mantém o vínculo com este lead.
                </span>
              </span>
            </label>
            {convertToClient && (
              <div>
                <Label htmlFor="won-monthly-value">Mensalidade recorrente do cliente</Label>
                <Input
                  id="won-monthly-value"
                  inputMode="numeric"
                  value={wonMonthlyDisplay}
                  onChange={(e) => {
                    const value = handleBRLInputChange(e.target.value);
                    setWonMonthlyDisplay(value.display);
                    setWonMonthlyValue(value.numeric);
                  }}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Começa em R$ 0,00. O valor estimado da venda não vira mensalidade automaticamente.
                </p>
              </div>
            )}
            <label className="flex items-start gap-3 rounded-xl border border-border p-3 cursor-pointer">
              <Checkbox
                checked={registerPayment}
                onCheckedChange={(value) => setRegisterPayment(value === true)}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-medium">
                  Registrar recebimento no Financeiro
                </span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Cria um lançamento pago e evita duplicá-lo se o lead voltar ao pipeline.
                </span>
              </span>
            </label>
            {registerPayment && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="won-payment-value">Valor recebido</Label>
                  <Input
                    id="won-payment-value"
                    inputMode="numeric"
                    value={wonPaymentDisplay}
                    onChange={(e) => {
                      const value = handleBRLInputChange(e.target.value);
                      setWonPaymentDisplay(value.display);
                      setWonPaymentValue(value.numeric);
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="won-paid-at">Data do pagamento</Label>
                  <CrmDatePicker
                    value={wonPaidAt}
                    onChange={setWonPaidAt}
                    label="Data do pagamento"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="won-payment-description">Descrição</Label>
                  <Input
                    id="won-payment-description"
                    value={wonPaymentDescription}
                    onChange={(e) => setWonPaymentDescription(e.target.value)}
                    maxLength={500}
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => closeWonLead(true)} disabled={savingWonLead}>
              Apenas marcar como ganho
            </Button>
            <Button
              onClick={() => closeWonLead(false)}
              disabled={savingWonLead || (!convertToClient && !registerPayment)}
            >
              {savingWonLead ? "Salvando..." : "Concluir venda"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lost reason dialog */}
      <LostReasonDialog
        key={`${losingLead?.id ?? "none"}:${lostReasonDialogOpen}`}
        open={lostReasonDialogOpen}
        onOpenChange={(open) => {
          setLostReasonDialogOpen(open);
          if (!open) setLosingLead(null);
        }}
        lead={losingLead}
        onSave={handleLostReasonSave}
      />

      {/* Stage editor dialog */}
      <Dialog open={editingStages} onOpenChange={setEditingStages}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar etapas do pipeline</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {tempStages.map((s, i) => (
              <div
                key={s.key}
                className="flex items-center gap-2 p-2 rounded-lg border border-border/50"
              >
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => moveStage(i, "up")}
                    disabled={i === 0}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5"
                  >
                    <ChevronLeft className="h-3 w-3 rotate-90" />
                  </button>
                  <button
                    onClick={() => moveStage(i, "down")}
                    disabled={i === tempStages.length - 1}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5"
                  >
                    <ChevronRight className="h-3 w-3 rotate-90" />
                  </button>
                </div>
                <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input
                  value={s.label}
                  onChange={(e) => {
                    const updated = [...tempStages];
                    updated[i] = { ...updated[i], label: e.target.value };
                    setTempStages(updated);
                  }}
                  className="flex-1"
                />
                <div className="flex gap-1">
                  {COLOR_OPTIONS.map((c) => (
                    <button
                      key={c.value}
                      title={c.label}
                      onClick={() => {
                        const updated = [...tempStages];
                        updated[i] = { ...updated[i], color: c.value };
                        setTempStages(updated);
                      }}
                      className={`w-5 h-5 rounded-full border-2 transition-all ${s.color === c.value ? "border-foreground scale-110" : "border-transparent"} ${(COLOR_CLASSES[c.value] ?? COLOR_CLASSES[""]).dot}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingStages(false)}>
              Cancelar
            </Button>
            <Button onClick={saveStageConfigs}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Column ───────────────────────────────────────────────────────
function Column({
  stage,
  leads,
  totalValue,
  color,
  onEdit,
  onAdd,
  getLeadLabels,
  settledOverStage,
  highlighted,
  activeCardHeight,
}: {
  stage: { id: Stage; label: string };
  leads: Lead[];
  totalValue: number;
  color: string;
  onEdit: (l: Lead) => void;
  onAdd: () => void;
  getLeadLabels: (leadId: string) => LeadLabel[];
  settledOverStage: Stage | null;
  highlighted: boolean;
  activeCardHeight: number;
}) {
  const { setNodeRef } = useDroppable({ id: stage.id });
  const colorClasses = COLOR_CLASSES[color] ?? COLOR_CLASSES[""];

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full min-h-0 w-[calc(100vw-2rem)] max-w-80 shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-border bg-muted/45 p-2 transition-[background-color,border-color,box-shadow] duration-200 sm:w-80",
        highlighted &&
          "border-primary/50 bg-primary/[0.07] shadow-[0_14px_36px_-24px_var(--primary)] ring-2 ring-primary/15",
      )}
    >
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 px-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${colorClasses.dot}`} />
          <h3 className={`truncate text-sm font-semibold tracking-tight ${colorClasses.header}`}>
            {stage.label}
          </h3>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            <AnimatedNumber value={leads.length} />
          </span>
        </div>
        <div className="shrink-0 text-xs font-medium text-muted-foreground">
          <AnimatedNumber value={totalValue} formatter={formatBRL} />
        </div>
      </div>
      <div className="scrollbar-hide min-h-[100px] flex-1 space-y-2 overflow-y-auto rounded-xl">
        {settledOverStage === stage.id && <PipelineDragPlaceholder height={activeCardHeight} />}
        {leads.map((l) => (
          <LeadCard key={l.id} lead={l} labels={getLeadLabels(l.id)} onEdit={() => onEdit(l)} />
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="mt-2 flex h-10 shrink-0 items-center gap-2 rounded-xl px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="h-4 w-4" />
        Adicionar um lead
      </button>
    </div>
  );
}

function PipelineDragPlaceholder({ height }: { height: number }) {
  return (
    <div
      aria-hidden="true"
      className="kanban-insertion-slot rounded-xl border border-dashed border-primary/30 bg-primary/[0.04]"
      style={{ height }}
    />
  );
}

// ─── Lead Card ────────────────────────────────────────────────────
function LeadCard({
  lead,
  labels,
  onEdit,
  dragging,
}: {
  lead: Lead;
  labels: LeadLabel[];
  onEdit?: () => void;
  dragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    disabled: dragging,
  });
  const followUpOverdue = Boolean(
    lead.follow_up_at && new Date(lead.follow_up_at).getTime() < new Date().getTime(),
  );

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      tabIndex={dragging ? -1 : 0}
      className={`group/card relative rounded-xl border border-border/70 bg-card p-3.5 outline-none cursor-grab active:cursor-grabbing transition-[border-color,opacity,transform,box-shadow] duration-200 ${
        isDragging && !dragging
          ? "invisible"
          : "shadow-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring"
      } ${dragging ? "pointer-events-none scale-[1.01] border-foreground/15 shadow-xl shadow-black/15" : ""}`}
    >
      {/* Labels */}
      {labels.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1 pr-10">
          {labels.map((label) => {
            const colorInfo = getLabelColorClasses(label.color);
            return (
              <span
                key={label.id}
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${colorInfo.light}`}
              >
                {label.name}
              </span>
            );
          })}
        </div>
      )}

      <div className="mb-1 flex items-start gap-2 pr-10">
        <div className="text-sm font-medium leading-tight">{lead.name}</div>
        {!dragging && onEdit && (
          <div className="touch-visible-action pointer-events-none absolute right-0.5 top-0.5 flex opacity-0 transition-opacity duration-200 group-hover/card:pointer-events-auto group-hover/card:opacity-100 group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100">
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="touch-target text-muted-foreground transition-colors hover:text-foreground"
              aria-label={`Editar ${lead.name}`}
              title="Editar lead"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      {lead.company && <div className="text-xs text-muted-foreground">{lead.company}</div>}

      {lead.services && lead.services.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {lead.services.slice(0, 2).map((s) => (
            <span
              key={s}
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/50"
            >
              {s}
            </span>
          ))}
          {lead.services.length > 2 && (
            <span className="text-[10px] text-muted-foreground">+{lead.services.length - 2}</span>
          )}
        </div>
      )}

      {lead.follow_up_at && (
        <div
          className={cn(
            "mt-1.5 flex w-fit items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
            followUpOverdue
              ? "border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
              : "border-border bg-muted/60 text-muted-foreground",
          )}
          title="Próximo follow-up"
        >
          <CalendarClock className="h-3 w-3" />
          <span>{formatSaoPauloDateTime(lead.follow_up_at, lead.follow_up_has_time)}</span>
          {lead.reminder_offsets_minutes.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <Bell className="h-3 w-3" />
              <span>{lead.reminder_offsets_minutes.length}</span>
            </>
          )}
        </div>
      )}

      {lead.attachments && lead.attachments.length > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-1.5 bg-muted/40 px-1.5 py-0.5 rounded w-fit">
          <Paperclip className="h-3 w-3 text-primary" />
          <span>
            {lead.attachments.length} {lead.attachments.length === 1 ? "anexo" : "anexos"}
          </span>
        </div>
      )}

      <div className="mt-2 border-t border-border/50 pt-1.5">
        <span className="text-xs font-medium">{formatBRL(lead.estimated_value ?? 0)}</span>
      </div>
    </div>
  );
}

function LostReasonDialog({
  open,
  onOpenChange,
  lead,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead: Lead | null;
  onSave: (reason: string, details: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");

  const LOSS_REASONS = [
    "Preço muito alto",
    "Fechou com concorrente",
    "Sem orçamento no momento",
    "Projeto cancelado",
    "Sem retorno (Ghosting)",
    "Não era o perfil ideal (Fit)",
    "Outro motivo",
  ];

  const handleSave = () => {
    if (!reason) {
      toast.error("Por favor, selecione um motivo principal.");
      return;
    }
    onSave(reason, details);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Lead Perdido</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Você está marcando <strong>{lead?.name}</strong> como perdido. Por favor, informe o
            motivo para mantermos um histórico.
          </p>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Motivo Principal *</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o motivo..." />
              </SelectTrigger>
              <SelectContent>
                {LOSS_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Observações adicionais (Opcional)</Label>
            <Textarea
              rows={3}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Ex: Achou o prazo muito longo, preferiu a agência X..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={handleSave}>
            Confirmar Perda
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
