import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useState, useMemo, useRef } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  useDraggable,
} from "@dnd-kit/core";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { cn, getLabelColorClasses, LABEL_COLORS } from "@/lib/utils";
import { FilterBar, FilterPeriod, FilterSelect } from "@/components/FilterBar";
import { filterChips } from "@/lib/filter-utils";
import { useListFilters } from "@/lib/list-filters";
import { dateInRange, localToday, matchesDateShortcut } from "@/lib/filter-utils";
import { fetchAllRows } from "@/lib/query-pagination";
import { restoreTrashedTask } from "@/lib/task-trash";
import { formatDateBR } from "@/lib/date-format";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  Trash2,
  Pencil,
  GripVertical,
  Calendar,
  Clock,
  AlertTriangle,
  Tag,
  Check,
  CheckSquare,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  User,
  CheckCircle2,
  Paperclip,
  Eye,
  Download,
  FileText,
  Bell,
  MoreHorizontal,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { DateReminderEditor } from "@/components/DateReminderEditor";
import {
  formatSaoPauloDateTime,
  normalizeReminderOffsets,
  toSaoPauloInputParts,
  toSaoPauloTimestamp,
  type ReminderOffsetMinutes,
} from "@/lib/reminders";
import {
  uploadAttachment,
  formatFileSize,
  openAttachmentInNewTab,
  removeAttachmentObject,
  moveAttachmentToTrash,
} from "@/lib/storage";
import { AttachmentViewerModal, AttachmentItem } from "@/components/AttachmentViewerModal";
import type { Json } from "@/integrations/supabase/types";

const DRAG_REORDER_DELAY_MS = 1_000;
const TASK_FILTERS = {
  search: "",
  priority: "all",
  date: "all",
  client: "all",
  completed: "all",
  label: "all",
  from: "",
  to: "",
};
const KANBAN_DROP_ANIMATION = {
  duration: 220,
  easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
};

export const Route = createFileRoute("/_authenticated/tarefas")({
  component: TarefasPage,
  head: () => ({ meta: [{ title: "CRM | Tarefas" }] }),
});

export type Priority = "baixa" | "media" | "alta" | "urgente";

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface TaskColumn {
  id: string;
  user_id: string;
  name: string;
  position: number;
  color: string | null;
  created_at: string;
}

export interface TaskCard {
  id: string;
  user_id: string;
  column_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  due_has_time: boolean;
  reminder_offsets_minutes: ReminderOffsetMinutes[];
  priority: Priority | null;
  completed: boolean;
  position: number;
  labels: string[];
  checklist: ChecklistItem[];
  client_id: string | null;
  attachments?: AttachmentItem[];
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface ClientLite {
  id: string;
  name: string;
}

interface TaskLabel {
  id: string;
  name: string;
  color: string;
}

interface TaskLabelAssignment {
  task_id: string;
  label_id: string;
}

const DEFAULT_COLUMNS = [
  { name: "A Fazer", color: "blue", position: 0 },
  { name: "Em Andamento", color: "amber", position: 1 },
  { name: "Revisão", color: "violet", position: 2 },
  { name: "Concluído", color: "emerald", position: 3 },
];

const PRIORITY_CONFIG: Record<Priority, { label: string; badge: string }> = {
  baixa: {
    label: "Baixa",
    badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200",
  },
  media: {
    label: "Média",
    badge: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border-blue-200",
  },
  alta: {
    label: "Alta",
    badge: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200",
  },
  urgente: {
    label: "Urgente",
    badge: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border-rose-200",
  },
};

const compareTaskPosition = (a: TaskCard, b: TaskCard) =>
  a.position - b.position ||
  new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
  a.id.localeCompare(b.id);

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

function TarefasPage() {
  const { user } = useAuth();
  const [columns, setColumns] = useState<TaskColumn[]>([]);
  const [cards, setCards] = useState<TaskCard[]>([]);
  const [trashedCards, setTrashedCards] = useState<TaskCard[]>([]);
  const [restoringTaskId, setRestoringTaskId] = useState<string | null>(null);
  const [trashedPreview, setTrashedPreview] = useState<TaskCard | null>(null);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [taskLabels, setTaskLabels] = useState<TaskLabel[]>([]);
  const [taskLabelAssignments, setTaskLabelAssignments] = useState<TaskLabelAssignment[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settledOverId, setSettledOverId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const [activeCardHeight, setActiveCardHeight] = useState(88);
  const dragPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingOverIdRef = useRef<string | null>(null);

  // Filters & Search
  const views = useListFilters(TASK_FILTERS, "tasks", user?.id, {
    priority: ["all", "none", "baixa", "media", "alta", "urgente"],
    date: ["all", "today", "next7", "overdue", "none"],
    completed: ["all", "pending", "done"],
  });
  const { filters } = views;
  const searchQuery = filters.search;
  const priorityFilter = filters.priority;

  // Modals
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<TaskCard | null>(null);
  const [defaultColumnId, setDefaultColumnId] = useState<string | undefined>(undefined);
  const [taskDefaults, setTaskDefaults] = useState<{
    columnId: string | null;
    priority: Priority | null;
  }>({ columnId: null, priority: null });

  const [columnManagerOpen, setColumnManagerOpen] = useState(false);
  const [tempColumns, setTempColumns] = useState<{ id?: string; name: string; color: string }[]>(
    [],
  );
  const [moveColumnSource, setMoveColumnSource] = useState<TaskColumn | null>(null);
  const [moveColumnTargetId, setMoveColumnTargetId] = useState("");
  const [destructiveColumnAction, setDestructiveColumnAction] = useState<{
    type: "trash-cards" | "delete-column";
    column: TaskColumn;
  } | null>(null);
  const [columnActionBusy, setColumnActionBusy] = useState(false);
  const [labelManagerOpen, setLabelManagerOpen] = useState(false);
  const [labelManagerTaskId, setLabelManagerTaskId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const clearDragPreview = () => {
    if (dragPreviewTimerRef.current) clearTimeout(dragPreviewTimerRef.current);
    dragPreviewTimerRef.current = null;
    pendingOverIdRef.current = null;
    setSettledOverId(null);
    setDragOverColumnId(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    clearDragPreview();
    setActiveId(event.active.id as string);
    setActiveCardHeight(Math.max(72, event.active.rect.current.initial?.height ?? 88));
  };

  const handleDragOver = (event: DragOverEvent) => {
    const nextOverId = event.over?.id as string | undefined;
    const draggedId = event.active.id as string;
    if (!nextOverId) {
      clearDragPreview();
      return;
    }
    if (nextOverId === draggedId) return;
    const hoveredCard = cards.find((card) => card.id === nextOverId);
    const nextColumnId = columns.some((column) => column.id === nextOverId)
      ? nextOverId
      : hoveredCard?.column_id;
    setDragOverColumnId(nextColumnId ?? null);
    if (settledOverId === nextOverId || pendingOverIdRef.current === nextOverId) return;

    if (dragPreviewTimerRef.current) clearTimeout(dragPreviewTimerRef.current);
    setSettledOverId(null);
    pendingOverIdRef.current = nextOverId;
    dragPreviewTimerRef.current = setTimeout(() => {
      setSettledOverId(nextOverId);
      pendingOverIdRef.current = null;
      dragPreviewTimerRef.current = null;
    }, DRAG_REORDER_DELAY_MS);
  };

  useEffect(
    () => () => {
      if (dragPreviewTimerRef.current) clearTimeout(dragPreviewTimerRef.current);
    },
    [],
  );

  // Initial Data Load & Seeding
  const loadData = async () => {
    if (!user) return;

    try {
      // Load columns
      const { data: loadedColumns, error: colsErr } = await supabase
        .from("task_columns")
        .select("*")
        .order("position");
      let colsData = loadedColumns;

      if (colsErr) {
        console.error("Erro ao carregar colunas:", colsErr);
        toast.error("Erro ao acessar banco de dados: " + colsErr.message);
        return;
      }

      // Seed default columns if none exist
      if (!colsData || colsData.length === 0) {
        const inserts = DEFAULT_COLUMNS.map((c) => ({
          user_id: user.id,
          name: c.name,
          color: c.color,
          position: c.position,
        }));
        const { data: seededCols, error: seedErr } = await supabase
          .from("task_columns")
          .insert(inserts)
          .select();
        if (seedErr) {
          console.error("Erro ao criar colunas padrão:", seedErr);
        }
        colsData = seededCols ?? [];
      }

      setColumns((colsData ?? []) as TaskColumn[]);

      // Load cards, clients and managed labels.
      const [
        cardsData,
        { data: clientsData },
        { data: labelsData, error: labelsErr },
        { data: assignmentsData, error: assignmentsErr },
        { data: settingsData },
      ] = await Promise.all([
        fetchAllRows<TaskCard>(
          () =>
            supabase
              .from("task_cards")
              .select("*")
              .order("column_id")
              .order("position")
              .order("created_at")
              .order("id"),
          "as tarefas",
        ),
        supabase.from("clients").select("id, name").order("name"),
        supabase.from("task_labels").select("*").order("created_at"),
        supabase.from("task_label_assignments").select("task_id, label_id"),
        supabase
          .from("user_settings")
          .select("default_task_column_id, default_task_priority")
          .maybeSingle(),
      ]);

      if (labelsErr) console.error("Erro ao carregar etiquetas de tarefas:", labelsErr);
      if (assignmentsErr)
        console.error("Erro ao carregar associações de etiquetas:", assignmentsErr);

      const formattedCards = (cardsData ?? []).map((c) => ({
        ...c,
        priority: c.priority as Priority | null,
        reminder_offsets_minutes: normalizeReminderOffsets(c.reminder_offsets_minutes),
        labels: c.labels ?? [],
        checklist: (c.checklist as unknown as ChecklistItem[]) ?? [],
        attachments: (c.attachments as unknown as AttachmentItem[]) ?? [],
      }));

      setCards(formattedCards.filter((card) => !card.deleted_at));
      setTrashedCards(formattedCards.filter((card) => Boolean(card.deleted_at)));
      setClients((clientsData ?? []) as ClientLite[]);
      setTaskLabels((labelsData ?? []) as TaskLabel[]);
      setTaskLabelAssignments((assignmentsData ?? []) as TaskLabelAssignment[]);
      setTaskDefaults({
        columnId: settingsData?.default_task_column_id ?? null,
        priority: (settingsData?.default_task_priority as Priority | null) ?? null,
      });
    } catch (error: unknown) {
      console.error("Erro ao carregar dados do Kanban:", error);
      toast.error("Não foi possível carregar as tarefas. Tente atualizar a página.");
    }
  };

  const loadForUser = useEffectEvent(loadData);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadForUser(), 0);
    return () => window.clearTimeout(timer);
  }, [user]);

  const loadTaskLabels = async () => {
    const { data, error } = await supabase.from("task_labels").select("*").order("created_at");
    if (error) {
      toast.error("Não foi possível atualizar as etiquetas.");
      return;
    }
    setTaskLabels((data ?? []) as TaskLabel[]);
  };

  const loadTaskLabelAssignments = async () => {
    const { data, error } = await supabase
      .from("task_label_assignments")
      .select("task_id, label_id");
    if (error) {
      toast.error("Não foi possível atualizar as etiquetas dos cards.");
      return;
    }
    setTaskLabelAssignments((data ?? []) as TaskLabelAssignment[]);
  };

  const getTaskLabels = (taskId: string): TaskLabel[] => {
    const assignedIds = taskLabelAssignments
      .filter((assignment) => assignment.task_id === taskId)
      .map((assignment) => assignment.label_id);
    return taskLabels.filter((label) => assignedIds.includes(label.id));
  };

  const openTaskLabelManager = (taskId: string) => {
    setLabelManagerTaskId(taskId);
    setLabelManagerOpen(true);
  };

  // Filtered Cards
  const matchingCards = useMemo(() => {
    return [...cards, ...(searchQuery.trim() ? trashedCards : [])].filter((card) => {
      const matchesSearch =
        !searchQuery.trim() ||
        card.title.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
        (card.description &&
          card.description.toLowerCase().includes(searchQuery.trim().toLowerCase()));

      const matchesPriority =
        priorityFilter === "all" ||
        (priorityFilter === "none" ? card.priority === null : card.priority === priorityFilter);

      const matchesClient = filters.client === "all" || card.client_id === filters.client;
      const matchesCompleted =
        filters.completed === "all" ||
        (filters.completed === "done" ? card.completed : !card.completed);
      const matchesLabel =
        filters.label === "all" ||
        taskLabelAssignments.some(
          (assignment) => assignment.task_id === card.id && assignment.label_id === filters.label,
        ) ||
        card.labels.includes(
          taskLabels.find((label) => label.id === filters.label)?.name ?? filters.label,
        );
      return (
        matchesSearch &&
        matchesPriority &&
        matchesClient &&
        matchesCompleted &&
        matchesLabel &&
        dateInRange(card.due_date, filters.from, filters.to) &&
        matchesDateShortcut(
          card.due_date,
          filters.date,
          filters.completed === "done" ? false : card.completed,
          localToday(),
          card.due_has_time,
        )
      );
    });
  }, [cards, trashedCards, searchQuery, priorityFilter, filters, taskLabelAssignments, taskLabels]);
  const filteredCards = matchingCards.filter((card) => !card.deleted_at);
  const filteredTrashedCards = matchingCards.filter((card) => Boolean(card.deleted_at));

  const handleRestoreTask = async (card: TaskCard) => {
    if (!user || restoringTaskId) return;
    setRestoringTaskId(card.id);
    try {
      await restoreTrashedTask(supabase, card.id, user.id);
      setTrashedPreview(null);
      toast.success("Tarefa restaurada");
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível restaurar a tarefa.");
    } finally {
      setRestoringTaskId(null);
    }
  };

  // Drag & Drop Handler (Suporte a reordenação vertical e troca de coluna)
  const handleDragEnd = async (e: DragEndEvent) => {
    clearDragPreview();
    setActiveId(null);
    const cardId = e.active.id as string;
    const overId = e.over?.id as string | undefined;

    if (!overId || cardId === overId) return;

    const card = cards.find((c) => c.id === cardId);
    if (!card) return;

    const sourceColumnId = card.column_id;
    const isOverColumn = columns.some((col) => col.id === overId);
    const overCard = isOverColumn ? null : cards.find((candidate) => candidate.id === overId);
    if (!isOverColumn && !overCard) return;

    const targetColumnId = isOverColumn ? overId : overCard!.column_id;
    const sourceCards = cards
      .filter((candidate) => candidate.column_id === sourceColumnId && candidate.id !== cardId)
      .sort(compareTaskPosition);
    const targetCards =
      targetColumnId === sourceColumnId
        ? sourceCards
        : cards
            .filter(
              (candidate) => candidate.column_id === targetColumnId && candidate.id !== cardId,
            )
            .sort(compareTaskPosition);
    const overIndex = isOverColumn
      ? targetCards.length
      : targetCards.findIndex((candidate) => candidate.id === overId);
    const insertIndex = overIndex >= 0 ? overIndex : targetCards.length;

    targetCards.splice(insertIndex, 0, { ...card, column_id: targetColumnId });

    const targetUpdates = targetCards.map((candidate, index) => ({
      ...candidate,
      column_id: targetColumnId,
      position: index,
    }));
    const sourceUpdates =
      targetColumnId === sourceColumnId
        ? []
        : sourceCards.map((candidate, index) => ({
            ...candidate,
            position: index,
          }));
    const affectedCards = [...sourceUpdates, ...targetUpdates];
    const affectedIds = new Set(affectedCards.map((candidate) => candidate.id));

    // Atualização otimista restrita às colunas de origem e destino.
    setCards((prev) => {
      const untouchedCards = prev.filter((candidate) => !affectedIds.has(candidate.id));
      return [...untouchedCards, ...affectedCards];
    });

    try {
      const results = await Promise.all(
        affectedCards.map((updatedCard) =>
          supabase
            .from("task_cards")
            .update({ column_id: updatedCard.column_id, position: updatedCard.position })
            .eq("id", updatedCard.id),
        ),
      );
      const failed = results.find((result) => result.error);
      if (failed?.error) {
        throw failed.error;
      }
    } catch (error: unknown) {
      console.error("Erro ao salvar ordem das tarefas:", error);
      toast.error("Não foi possível salvar a nova ordem das tarefas.");
      void loadData();
    }
  };

  // Card Save Handler
  const handleSaveCard = async (
    formData: Partial<TaskCard>,
    removedAttachmentPaths: string[] = [],
    selectedLabelIds: string[] = [],
  ): Promise<boolean> => {
    if (!user) return false;

    const payload = {
      title: formData.title!,
      description: formData.description ?? null,
      column_id: formData.column_id!,
      priority: formData.priority ?? null,
      due_date: formData.due_date ?? null,
      due_has_time: formData.due_has_time ?? false,
      reminder_offsets_minutes: normalizeReminderOffsets(formData.reminder_offsets_minutes),
      completed: formData.completed ?? false,
      labels: formData.labels ?? [],
      checklist: (formData.checklist ?? []) as unknown as Json,
      attachments: (formData.attachments ?? []) as unknown as Json,
      client_id: formData.client_id ?? null,
    };

    let savedTaskId = editingCard?.id ?? null;

    if (editingCard) {
      const { error } = await supabase.from("task_cards").update(payload).eq("id", editingCard.id);
      if (error) {
        toast.error("Erro ao atualizar tarefa: " + error.message);
        return false;
      }
      toast.success("Tarefa atualizada!");
    } else {
      const { data, error } = await supabase
        .from("task_cards")
        .insert({
          ...payload,
          user_id: user.id,
        })
        .select("id")
        .single();
      if (error) {
        toast.error("Erro ao criar tarefa: " + error.message);
        return false;
      }
      savedTaskId = data.id;
      toast.success("Nova tarefa criada!");
    }

    if (savedTaskId) {
      const currentLabelIds = taskLabelAssignments
        .filter((assignment) => assignment.task_id === savedTaskId)
        .map((assignment) => assignment.label_id);
      const labelsToRemove = currentLabelIds.filter(
        (labelId) => !selectedLabelIds.includes(labelId),
      );
      const labelsToAdd = selectedLabelIds.filter((labelId) => !currentLabelIds.includes(labelId));
      const labelResults = await Promise.all([
        ...labelsToRemove.map((labelId) =>
          supabase
            .from("task_label_assignments")
            .delete()
            .eq("task_id", savedTaskId)
            .eq("label_id", labelId),
        ),
        ...labelsToAdd.map((labelId) =>
          supabase
            .from("task_label_assignments")
            .insert({ task_id: savedTaskId, label_id: labelId }),
        ),
      ]);
      if (labelResults.some((result) => result.error)) {
        toast.warning("A tarefa foi salva, mas algumas etiquetas não puderam ser atualizadas.");
      }
    }

    const originalAttachments = editingCard?.attachments ?? [];
    const removalResults = await Promise.allSettled(
      removedAttachmentPaths.map((path) => {
        const attachment =
          originalAttachments.find((item) => item.path === path) ??
          ({ path, name: path.split("/").pop() ?? "Anexo" } as AttachmentItem);
        return moveAttachmentToTrash("task", savedTaskId!, attachment);
      }),
    );
    if (removalResults.some((result) => result.status === "rejected")) {
      toast.warning("A tarefa foi salva, mas um anexo não pôde ser movido para a lixeira.");
    }

    setTaskDialogOpen(false);
    setEditingCard(null);
    void loadData();
    return true;
  };

  const handleQuickAddCard = async (columnId: string, title: string): Promise<boolean> => {
    if (!user) return false;

    const normalizedTitle = title.trim().slice(0, 300);
    if (!normalizedTitle) return false;

    const { data, error } = await supabase
      .from("task_cards")
      .insert({
        user_id: user.id,
        column_id: columnId,
        title: normalizedTitle,
        description: null,
        priority: null,
        due_date: null,
        due_has_time: false,
        reminder_offsets_minutes: [],
        completed: false,
        labels: [],
        checklist: [],
        attachments: [],
        client_id: null,
      })
      .select("*")
      .single();

    if (error) {
      toast.error("Erro ao criar tarefa: " + error.message);
      return false;
    }

    setCards((previousCards) => [...previousCards, data as unknown as TaskCard]);
    toast.success("Cartão adicionado!");
    return true;
  };

  // Card Delete Handler (Soft-delete -> Lixeira)
  const handleDeleteCard = async (id: string) => {
    const { error } = await supabase
      .from("task_cards")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      toast.error("Erro ao mover tarefa para a lixeira: " + error.message);
      return;
    }
    setCards((prev) => prev.filter((c) => c.id !== id));
    toast.success("Tarefa movida para a lixeira", {
      action: {
        label: "Desfazer",
        onClick: () => {
          void supabase
            .from("task_cards")
            .update({ deleted_at: null })
            .eq("id", id)
            .then(() => loadData());
        },
      },
    });
  };

  const openMoveAllCards = (column: TaskColumn) => {
    const firstTarget = columns.find((candidate) => candidate.id !== column.id);
    setMoveColumnSource(column);
    setMoveColumnTargetId(firstTarget?.id ?? "");
  };

  const handleMoveAllCards = async () => {
    if (!moveColumnSource || !moveColumnTargetId || moveColumnSource.id === moveColumnTargetId)
      return;
    setColumnActionBusy(true);
    const { data, error } = await supabase.rpc("move_all_task_cards", {
      p_source_column_id: moveColumnSource.id,
      p_target_column_id: moveColumnTargetId,
    });
    setColumnActionBusy(false);

    if (error) {
      toast.error("Não foi possível mover os cartões: " + error.message);
      return;
    }

    const movedCount = data ?? 0;
    toast.success(
      movedCount === 1
        ? "1 cartão movido com sucesso."
        : `${movedCount} cartões movidos com sucesso.`,
    );
    setMoveColumnSource(null);
    setMoveColumnTargetId("");
    void loadData();
  };

  const handleTrashAllCards = async (column: TaskColumn) => {
    setColumnActionBusy(true);
    const { data, error } = await supabase.rpc("trash_all_task_cards", {
      p_column_id: column.id,
    });
    setColumnActionBusy(false);

    if (error) {
      toast.error("Não foi possível apagar os cartões: " + error.message);
      return;
    }

    const deletedCount = data ?? 0;
    toast.success(
      deletedCount === 1
        ? "1 cartão movido para a lixeira."
        : `${deletedCount} cartões movidos para a lixeira.`,
    );
    setDestructiveColumnAction(null);
    void loadData();
  };

  const handleDeleteColumn = async (column: TaskColumn) => {
    setColumnActionBusy(true);
    const { data, error } = await supabase.rpc("delete_task_column_safely", {
      p_column_id: column.id,
    });
    setColumnActionBusy(false);

    if (error) {
      const isLastColumn = error.message.includes("last task column");
      toast.error(
        isLastColumn
          ? "É necessário manter pelo menos uma lista."
          : "Não foi possível apagar a lista: " + error.message,
      );
      return;
    }

    const trashedCount = data ?? 0;
    toast.success(
      trashedCount > 0
        ? `Lista apagada e ${trashedCount} ${trashedCount === 1 ? "cartão enviado" : "cartões enviados"} para a lixeira.`
        : "Lista apagada com sucesso.",
    );
    setDestructiveColumnAction(null);
    void loadData();
  };

  // Column Management Handlers
  const openColumnManager = () => {
    setTempColumns(columns.map((c) => ({ id: c.id, name: c.name, color: c.color ?? "" })));
    setColumnManagerOpen(true);
  };

  const saveColumns = async () => {
    if (!user) return;

    // Filter valid non-empty column names
    const valid = tempColumns.filter((c) => c.name.trim());
    if (valid.length === 0) {
      toast.error("É necessário ter pelo menos uma coluna.");
      return;
    }

    try {
      // Identify deleted columns to cleanup
      const currentIds = columns.map((c) => c.id);
      const updatedIds = valid.map((c) => c.id).filter(Boolean);
      const toDelete = currentIds.filter((id) => !updatedIds.includes(id));

      const updatedColumnsList: TaskColumn[] = [];

      // Upsert columns with new positions
      for (let i = 0; i < valid.length; i++) {
        const col = valid[i];
        if (col.id) {
          const { data: updData, error: updErr } = await supabase
            .from("task_columns")
            .update({ name: col.name.trim(), color: col.color || null, position: i })
            .eq("id", col.id)
            .select()
            .single();

          if (updErr) {
            toast.error("Erro ao atualizar coluna: " + updErr.message);
            return;
          }
          if (updData) updatedColumnsList.push(updData as TaskColumn);
        } else {
          const { data: insData, error: insErr } = await supabase
            .from("task_columns")
            .insert({
              user_id: user.id,
              name: col.name.trim(),
              color: col.color || null,
              position: i,
            })
            .select()
            .single();

          if (insErr) {
            toast.error("Erro ao criar coluna: " + insErr.message);
            return;
          }
          if (insData) updatedColumnsList.push(insData as TaskColumn);
        }
      }

      // Delete only after creating any replacement column, so the board never
      // becomes columnless and recoverable cards always have a safe fallback.
      if (toDelete.length > 0) {
        for (const columnId of toDelete) {
          const { error: delErr } = await supabase.rpc("delete_task_column_safely", {
            p_column_id: columnId,
          });
          if (delErr) {
            toast.error("Erro ao excluir coluna no banco: " + delErr.message);
            return;
          }
        }
      }

      toast.success("Colunas atualizadas com sucesso!");
      setColumns(updatedColumnsList);
      setColumnManagerOpen(false);
      loadData();
    } catch (error: unknown) {
      toast.error(
        "Erro ao salvar colunas: " +
          (error instanceof Error ? error.message : "Consulte o console."),
      );
    }
  };

  const moveColumn = (index: number, direction: "up" | "down") => {
    const newCols = [...tempColumns];
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= newCols.length) return;
    [newCols[index], newCols[targetIdx]] = [newCols[targetIdx], newCols[index]];
    setTempColumns(newCols);
  };

  // Card Complete Toggle Handler (Estilo Trello)
  const handleToggleCardComplete = async (cardId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    const newStatus = !card.completed;

    setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, completed: newStatus } : c)));

    const { error } = await supabase
      .from("task_cards")
      .update({ completed: newStatus })
      .eq("id", cardId);
    if (error) {
      toast.error("Erro ao atualizar tarefa: " + error.message);
      loadData();
    } else {
      toast.success(newStatus ? "Tarefa concluída! 🎉" : "Tarefa marcada como pendente.");
    }
  };

  const activeCard = cards.find((c) => c.id === activeId);
  const openNewTaskDialog = () => {
    setEditingCard(null);
    const configuredColumnExists = columns.some((column) => column.id === taskDefaults.columnId);
    setDefaultColumnId(configuredColumnExists ? taskDefaults.columnId! : columns[0]?.id);
    setTaskDialogOpen(true);
  };

  return (
    <div className="page-shell h-full flex flex-col">
      <FilterBar
        title="Tarefas"
        description="Organize entregas, prioridades e prazos"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={openColumnManager}>
              <Pencil />
              Editar listas
            </Button>
            <Button onClick={openNewTaskDialog}>
              <Plus />
              Nova tarefa
            </Button>
          </div>
        }
        search={{
          value: searchQuery,
          onChange: (search) => views.setFilters({ search }),
          placeholder: "Buscar título ou descrição...",
        }}
        viewState={views}
        resultCount={matchingCards.length}
        resultLabel="tarefas"
        onReset={views.resetFilters}
        activeFilters={filterChips(
          filters,
          TASK_FILTERS,
          {
            search: "Busca",
            priority: "Prioridade",
            date: "Prazo",
            client: "Cliente",
            completed: "Estado",
            label: "Etiqueta",
            from: "Desde",
            to: "Até",
          },
          (key, value) => views.setFilters({ [key]: value }),
          {
            priority: {
              none: "Sem prioridade",
              baixa: "Baixa",
              media: "Média",
              alta: "Alta",
              urgente: "Urgente",
            },
            date: {
              today: "Hoje",
              next7: "Próximos 7 dias",
              overdue: "Atrasadas",
              none: "Sem data",
            },
            completed: { pending: "Pendentes", done: "Concluídas" },
            client: Object.fromEntries(clients.map((client) => [client.id, client.name])),
            label: Object.fromEntries(taskLabels.map((label) => [label.id, label.name])),
          },
        )}
      >
        <FilterSelect
          label="Prazo"
          value={filters.date}
          onChange={(date) => views.setFilters({ date })}
          options={[
            { value: "all", label: "Todos os prazos" },
            { value: "today", label: "Hoje" },
            { value: "overdue", label: "Atrasadas" },
            { value: "next7", label: "Próximos 7 dias" },
            { value: "none", label: "Sem data" },
          ]}
        />
        <FilterSelect
          label="Cliente"
          value={filters.client}
          onChange={(client) => views.setFilters({ client })}
          options={[
            { value: "all", label: "Todos os clientes" },
            ...clients.map((client) => ({ value: client.id, label: client.name })),
          ]}
        />
        <FilterSelect
          label="Prioridade"
          value={priorityFilter}
          onChange={(priority) => views.setFilters({ priority })}
          options={[
            { value: "all", label: "Todas as prioridades" },
            { value: "none", label: "Sem prioridade" },
            { value: "baixa", label: "Baixa" },
            { value: "media", label: "Média" },
            { value: "alta", label: "Alta" },
            { value: "urgente", label: "Urgente" },
          ]}
        />
        <FilterSelect
          label="Estado"
          value={filters.completed}
          onChange={(completed) => views.setFilters({ completed })}
          options={[
            { value: "all", label: "Todas" },
            { value: "pending", label: "Pendentes" },
            { value: "done", label: "Concluídas" },
          ]}
        />
        <FilterSelect
          label="Etiqueta"
          value={filters.label}
          onChange={(label) => views.setFilters({ label })}
          options={[
            { value: "all", label: "Todas as etiquetas" },
            ...taskLabels.map((label) => ({ value: label.id, label: label.name })),
          ]}
        />
        <FilterPeriod
          from={filters.from}
          to={filters.to}
          onChange={(from, to) => views.setFilters({ from, to })}
        />
      </FilterBar>

      {filteredTrashedCards.length > 0 && (
        <section aria-label="Tarefas na lixeira" className="mb-5 shrink-0 space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Trash2 className="h-4 w-4" />
            Na lixeira ({filteredTrashedCards.length})
          </h2>
          <div className="grid gap-2 lg:grid-cols-2">
            {filteredTrashedCards.map((card) => (
              <div
                key={card.id}
                className="flex min-w-0 items-center gap-3 rounded-xl border bg-muted/20 p-3"
                data-slot="trashed-task-result"
              >
                <button
                  type="button"
                  onClick={() => setTrashedPreview(card)}
                  className="min-w-0 flex-1 space-y-1 text-left"
                  aria-label={`Ver tarefa na lixeira: ${card.title}`}
                >
                  <p className="truncate text-sm font-medium">{card.title}</p>
                  <Badge variant="secondary" className="text-[10px]">
                    Na lixeira
                  </Badge>
                  {card.description && (
                    <p className="line-clamp-2 break-words text-xs text-muted-foreground">
                      {card.description}
                    </p>
                  )}
                </button>
                <Button
                  size="icon"
                  variant="outline"
                  className="shrink-0"
                  disabled={Boolean(restoringTaskId)}
                  onClick={() => void handleRestoreTask(card)}
                  aria-label={`Restaurar ${card.title}`}
                  title="Restaurar tarefa"
                >
                  <RotateCcw className={restoringTaskId === card.id ? "animate-spin" : ""} />
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <Dialog
        open={Boolean(trashedPreview)}
        onOpenChange={(open) => {
          if (!open) setTrashedPreview(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="break-words pr-6">{trashedPreview?.title}</DialogTitle>
            <DialogDescription>
              Esta tarefa está na lixeira. Restaure-a para editar ou marcar como concluída.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[45dvh] space-y-3 overflow-y-auto">
            <Badge variant="secondary">Na lixeira</Badge>
            {trashedPreview?.description && (
              <p className="whitespace-pre-wrap break-words text-sm">
                {trashedPreview.description}
              </p>
            )}
            {trashedPreview?.deleted_at && (
              <p className="text-xs text-muted-foreground">
                Movida em {formatDateBR(trashedPreview.deleted_at)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTrashedPreview(null)}>
              Fechar
            </Button>
            <Button
              disabled={Boolean(restoringTaskId)}
              onClick={() => {
                if (trashedPreview) void handleRestoreTask(trashedPreview);
              }}
            >
              <RotateCcw />
              Restaurar tarefa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kanban Board */}
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
          aria-label="Listas de tarefas"
        >
          {columns.map((col) => {
            const columnCards = filteredCards
              .filter((card) => card.column_id === col.id)
              .sort(compareTaskPosition);
            return (
              <TaskColumnComponent
                key={col.id}
                column={col}
                cards={columnCards}
                totalCardCount={cards.filter((card) => card.column_id === col.id).length}
                onEditCard={(c) => {
                  setEditingCard(c);
                  setTaskDialogOpen(true);
                }}
                onToggleCompleteCard={handleToggleCardComplete}
                getTaskLabels={getTaskLabels}
                onQuickAddCard={(title) => handleQuickAddCard(col.id, title)}
                onMoveAllCards={() => openMoveAllCards(col)}
                onTrashAllCards={() =>
                  setDestructiveColumnAction({ type: "trash-cards", column: col })
                }
                onDeleteColumn={() =>
                  setDestructiveColumnAction({ type: "delete-column", column: col })
                }
                canDeleteColumn={columns.length > 1}
                clientList={clients}
                settledOverId={settledOverId}
                highlighted={dragOverColumnId === col.id}
                activeCardHeight={activeCardHeight}
              />
            );
          })}
        </div>
        <DragOverlay dropAnimation={KANBAN_DROP_ANIMATION} zIndex={80}>
          {activeCard ? (
            <TaskCardComponent
              card={activeCard}
              clientList={clients}
              labels={getTaskLabels(activeCard.id)}
              dragging
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Task Creation & Editing Dialog */}
      <TaskDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        editingCard={editingCard}
        columns={columns}
        clients={clients}
        allLabels={taskLabels}
        assignments={taskLabelAssignments}
        defaultColumnId={defaultColumnId}
        defaultPriority={taskDefaults.priority}
        onSave={handleSaveCard}
        onDelete={(card) => {
          setTaskDialogOpen(false);
          void handleDeleteCard(card.id);
        }}
        onManageLabels={(card) => openTaskLabelManager(card.id)}
      />

      <TaskLabelManagerDialog
        open={labelManagerOpen}
        onOpenChange={(nextOpen) => {
          setLabelManagerOpen(nextOpen);
          if (!nextOpen) setLabelManagerTaskId(null);
        }}
        taskId={labelManagerTaskId}
        allLabels={taskLabels}
        assignments={taskLabelAssignments}
        onLabelsChanged={() => {
          void Promise.all([loadTaskLabels(), loadTaskLabelAssignments()]);
        }}
      />

      <Dialog
        open={Boolean(moveColumnSource)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !columnActionBusy) {
            setMoveColumnSource(null);
            setMoveColumnTargetId("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mover todos os cartões</DialogTitle>
            <DialogDescription>
              Os cartões de “{moveColumnSource?.name}” serão adicionados ao final da lista
              escolhida, mantendo a ordem atual.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label>Lista de destino</Label>
            <Select value={moveColumnTargetId} onValueChange={setMoveColumnTargetId}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Selecione uma lista" />
              </SelectTrigger>
              <SelectContent>
                {columns
                  .filter((column) => column.id !== moveColumnSource?.id)
                  .map((column) => (
                    <SelectItem key={column.id} value={column.id}>
                      {column.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={columnActionBusy}
              onClick={() => {
                setMoveColumnSource(null);
                setMoveColumnTargetId("");
              }}
            >
              Cancelar
            </Button>
            <Button
              disabled={!moveColumnTargetId || columnActionBusy}
              onClick={() => void handleMoveAllCards()}
            >
              {columnActionBusy ? "Movendo..." : "Mover cartões"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(destructiveColumnAction)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !columnActionBusy) setDestructiveColumnAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {destructiveColumnAction?.type === "delete-column"
                ? "Apagar esta lista?"
                : "Apagar todos os cartões?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {destructiveColumnAction?.type === "delete-column"
                ? `A lista “${destructiveColumnAction.column.name}” será removida. Seus cartões serão enviados para a lixeira e continuarão disponíveis para restauração.`
                : `Todos os cartões de “${destructiveColumnAction?.column.name ?? ""}” serão enviados para a lixeira e poderão ser restaurados nas Configurações.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={columnActionBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={columnActionBusy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                if (!destructiveColumnAction) return;
                if (destructiveColumnAction.type === "delete-column") {
                  void handleDeleteColumn(destructiveColumnAction.column);
                } else {
                  void handleTrashAllCards(destructiveColumnAction.column);
                }
              }}
            >
              {columnActionBusy ? "Aguarde..." : "Apagar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Column Manager Dialog */}
      <Dialog open={columnManagerOpen} onOpenChange={setColumnManagerOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Gerenciar listas do Kanban</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto">
            {tempColumns.map((col, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 p-2 rounded-lg border border-border/50 bg-muted/20"
              >
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => moveColumn(idx, "up")}
                    disabled={idx === 0}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5"
                  >
                    <ChevronLeft className="h-3 w-3 rotate-90" />
                  </button>
                  <button
                    onClick={() => moveColumn(idx, "down")}
                    disabled={idx === tempColumns.length - 1}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5"
                  >
                    <ChevronRight className="h-3 w-3 rotate-90" />
                  </button>
                </div>
                <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input
                  value={col.name}
                  onChange={(e) => {
                    const updated = [...tempColumns];
                    updated[idx] = { ...updated[idx], name: e.target.value };
                    setTempColumns(updated);
                  }}
                  className="flex-1 h-8 text-sm"
                  placeholder="Nome da coluna"
                />
                <div className="flex gap-1">
                  {COLOR_OPTIONS.map((c) => (
                    <button
                      key={c.value}
                      title={c.label}
                      onClick={() => {
                        const updated = [...tempColumns];
                        updated[idx] = { ...updated[idx], color: c.value };
                        setTempColumns(updated);
                      }}
                      className={`w-5 h-5 rounded-full border-2 transition-all ${
                        col.color === c.value ? "border-foreground scale-110" : "border-transparent"
                      } ${(COLOR_CLASSES[c.value] ?? COLOR_CLASSES[""]).dot}`}
                    />
                  ))}
                </div>
                <button
                  onClick={() => {
                    setTempColumns(tempColumns.filter((_, i) => i !== idx));
                  }}
                  className="text-muted-foreground hover:text-destructive p-1"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-2"
              onClick={() =>
                setTempColumns([...tempColumns, { name: "Nova Coluna", color: "blue" }])
              }
            >
              <Plus className="h-4 w-4 mr-2" />
              Adicionar lista
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setColumnManagerOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveColumns}>Salvar listas</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Task Column Component ───────────────────────────────────────
function TaskColumnComponent({
  column,
  cards,
  totalCardCount,
  onEditCard,
  onToggleCompleteCard,
  getTaskLabels,
  onQuickAddCard,
  onMoveAllCards,
  onTrashAllCards,
  onDeleteColumn,
  canDeleteColumn,
  clientList,
  settledOverId,
  highlighted,
  activeCardHeight,
}: {
  column: TaskColumn;
  cards: TaskCard[];
  totalCardCount: number;
  onEditCard: (card: TaskCard) => void;
  onToggleCompleteCard: (id: string) => void;
  getTaskLabels: (id: string) => TaskLabel[];
  onQuickAddCard: (title: string) => Promise<boolean>;
  onMoveAllCards: () => void;
  onTrashAllCards: () => void;
  onDeleteColumn: () => void;
  canDeleteColumn: boolean;
  clientList: ClientLite[];
  settledOverId: string | null;
  highlighted: boolean;
  activeCardHeight: number;
}) {
  const { setNodeRef } = useDroppable({ id: column.id });
  const colorClasses = COLOR_CLASSES[column.color ?? ""] ?? COLOR_CLASSES[""];
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddTitle, setQuickAddTitle] = useState("");
  const [quickAddBusy, setQuickAddBusy] = useState(false);
  const quickAddInputRef = useRef<HTMLTextAreaElement>(null);
  const previewIsInColumn =
    settledOverId === column.id || cards.some((card) => card.id === settledOverId);

  const openQuickAdd = () => {
    setQuickAddOpen(true);
    requestAnimationFrame(() => quickAddInputRef.current?.focus());
  };

  const closeQuickAdd = () => {
    if (quickAddBusy) return;
    setQuickAddOpen(false);
    setQuickAddTitle("");
  };

  const submitQuickAdd = async () => {
    if (!quickAddTitle.trim() || quickAddBusy) return;
    setQuickAddBusy(true);
    const saved = await onQuickAddCard(quickAddTitle);
    setQuickAddBusy(false);
    if (saved) {
      setQuickAddTitle("");
      setQuickAddOpen(false);
    }
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full min-h-0 w-[calc(100vw-2rem)] max-w-80 shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-border bg-muted/45 p-2 transition-[background-color,border-color,box-shadow] duration-200 sm:w-80",
        highlighted &&
          "border-primary/50 bg-primary/[0.07] shadow-[0_14px_36px_-24px_var(--primary)] ring-2 ring-primary/15",
      )}
    >
      <div className="flex h-10 shrink-0 items-center justify-between px-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${colorClasses.dot}`} />
          <h3 className={`truncate text-sm font-semibold tracking-tight ${colorClasses.header}`}>
            {column.name}
          </h3>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            <AnimatedNumber value={cards.length} />
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label={`Ações da lista ${column.name}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuItem onSelect={openQuickAdd}>
              <Plus />
              Adicionar cartão
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onMoveAllCards}
              disabled={totalCardCount === 0 || !canDeleteColumn}
            >
              <ArrowRight />
              Mover todos os cartões dessa lista
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={onTrashAllCards}
              disabled={totalCardCount === 0}
              variant="destructive"
              className="hover:bg-destructive/10 hover:text-destructive [&_svg]:!text-destructive"
            >
              <Trash2 />
              Apagar todos os cartões dessa lista
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onDeleteColumn}
              disabled={!canDeleteColumn}
              variant="destructive"
              className="hover:bg-destructive/10 hover:text-destructive [&_svg]:!text-destructive"
            >
              <Trash2 />
              Apagar lista
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="scrollbar-hide min-h-[120px] flex-1 space-y-2 overflow-y-auto rounded-xl">
        {cards.map((card) => (
          <div key={card.id} className="space-y-2">
            {previewIsInColumn && settledOverId === card.id && (
              <DragInsertionPlaceholder height={activeCardHeight} />
            )}
            <TaskCardComponent
              card={card}
              clientList={clientList}
              labels={getTaskLabels(card.id)}
              onEdit={() => onEditCard(card)}
              onToggleComplete={() => onToggleCompleteCard?.(card.id)}
            />
          </div>
        ))}
        {previewIsInColumn && settledOverId === column.id && (
          <DragInsertionPlaceholder height={activeCardHeight} />
        )}
      </div>
      {quickAddOpen ? (
        <div className="mt-2 shrink-0 space-y-2 rounded-xl bg-background p-2 shadow-sm ring-1 ring-border">
          <Textarea
            ref={quickAddInputRef}
            value={quickAddTitle}
            onChange={(event) => setQuickAddTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submitQuickAdd();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                closeQuickAdd();
              }
            }}
            maxLength={300}
            rows={2}
            placeholder="Insira o título do cartão"
            aria-label={`Título do novo cartão em ${column.name}`}
            className="min-h-20 resize-none border-0 bg-muted/70 px-3 py-2.5 shadow-none focus-visible:ring-1"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void submitQuickAdd()}
              disabled={!quickAddTitle.trim() || quickAddBusy}
            >
              {quickAddBusy ? "Adicionando..." : "Adicionar cartão"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={closeQuickAdd}
              disabled={quickAddBusy}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={openQuickAdd}
          className="mt-2 flex h-10 shrink-0 items-center gap-2 rounded-xl px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-4 w-4" />
          Adicionar um cartão
        </button>
      )}
    </div>
  );
}

function DragInsertionPlaceholder({ height }: { height: number }) {
  return (
    <div
      aria-hidden="true"
      className="kanban-insertion-slot rounded-xl border border-dashed border-primary/30 bg-primary/[0.04]"
      style={{ height }}
    />
  );
}

// ─── Task Card Component ──────────────────────────────────────────
function TaskCardComponent({
  card,
  clientList,
  labels = [],
  onEdit,
  onToggleComplete,
  dragging,
}: {
  card: TaskCard;
  clientList: ClientLite[];
  labels?: TaskLabel[];
  onEdit?: () => void;
  onToggleComplete?: () => void;
  dragging?: boolean;
}) {
  const [mobileControlsVisible, setMobileControlsVisible] = useState(card.completed);
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    isDragging,
  } = useDraggable({ id: card.id, disabled: dragging });
  const { setNodeRef: setDroppableRef } = useDroppable({ id: card.id, disabled: dragging });

  const setCombinedRef = (node: HTMLElement | null) => {
    setDraggableRef(node);
    setDroppableRef(node);
  };

  const clientName = card.client_id ? clientList.find((c) => c.id === card.client_id)?.name : null;

  // Checklist calculations
  const totalChecklist = card.checklist?.length ?? 0;
  const doneChecklist = card.checklist?.filter((item) => item.done).length ?? 0;

  // Date status
  const dueStatus = useMemo(() => {
    if (!card.due_date) return null;
    const due = new Date(card.due_date);
    const dueParts = toSaoPauloInputParts(card.due_date);
    const todayParts = toSaoPauloInputParts(new Date().toISOString());
    const isOverdue = card.due_has_time
      ? due.getTime() < new Date().getTime()
      : dueParts.date < todayParts.date;

    if (card.completed)
      return {
        text: "Concluído",
        badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 border-emerald-200",
        icon: CheckCircle2,
      };
    if (isOverdue)
      return {
        text: "Atrasado",
        badge: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 border-rose-200",
        icon: AlertTriangle,
      };
    if (dueParts.date === todayParts.date) {
      return {
        text: card.due_has_time ? `Hoje, ${dueParts.time}` : "Hoje",
        badge: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 border-amber-200",
        icon: Clock,
      };
    }
    return {
      text: formatSaoPauloDateTime(card.due_date, card.due_has_time),
      badge: "bg-muted text-muted-foreground",
      icon: Calendar,
    };
  }, [card.due_date, card.due_has_time, card.completed]);

  const priorityConf = card.priority ? PRIORITY_CONFIG[card.priority] : null;

  return (
    <div
      ref={setCombinedRef}
      {...attributes}
      {...listeners}
      tabIndex={dragging ? -1 : 0}
      onClick={() => {
        if (!dragging) setMobileControlsVisible(true);
      }}
      className={`group/card relative rounded-xl border border-border/70 bg-card p-3.5 outline-none cursor-grab active:cursor-grabbing transition-[border-color,opacity,transform,box-shadow] duration-200 ${
        isDragging && !dragging
          ? "invisible"
          : "shadow-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring"
      } ${dragging ? "pointer-events-none scale-[1.01] border-foreground/15 shadow-xl shadow-black/15" : ""}`}
    >
      {/* Labels */}
      {(labels.length > 0 || card.labels.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-1 pr-8">
          {labels.length > 0
            ? labels.map((label) => {
                const colorInfo = getLabelColorClasses(label.color);
                return (
                  <span
                    key={label.id}
                    className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${colorInfo.light}`}
                  >
                    {label.name}
                  </span>
                );
              })
            : card.labels.map((label) => (
                <span
                  key={label}
                  className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                >
                  {label}
                </span>
              ))}
        </div>
      )}

      {/* Header / Title */}
      <div className="mb-1.5 flex items-start pr-8">
        <div className="flex min-w-0 flex-1 items-start">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleComplete?.();
            }}
            className={`relative flex h-5 shrink-0 items-center justify-center overflow-visible transition-[width,margin,opacity,color] duration-200 after:absolute after:-inset-2 ${
              card.completed
                ? "mr-2 w-5 opacity-100 text-emerald-600 hover:opacity-80 dark:text-emerald-400"
                : `${
                    mobileControlsVisible
                      ? "pointer-events-auto mr-2 w-5 opacity-100"
                      : "pointer-events-none mr-0 w-0 opacity-0"
                  } text-muted-foreground hover:text-emerald-500 sm:pointer-events-none sm:mr-0 sm:w-0 sm:opacity-0 sm:group-hover/card:pointer-events-auto sm:group-hover/card:mr-2 sm:group-hover/card:w-5 sm:group-hover/card:opacity-100 sm:group-focus-within/card:pointer-events-auto sm:group-focus-within/card:mr-2 sm:group-focus-within/card:w-5 sm:group-focus-within/card:opacity-100 focus-visible:pointer-events-auto focus-visible:mr-2 focus-visible:w-5 focus-visible:opacity-100`
            }`}
            title={card.completed ? "Marcar como pendente" : "Marcar como concluída"}
            aria-label={
              card.completed
                ? `Marcar ${card.title} como pendente`
                : `Marcar ${card.title} como concluída`
            }
          >
            {card.completed ? (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500">
                <Check className="h-3 w-3 text-white stroke-[3]" />
              </span>
            ) : (
              <span className="h-4 w-4 rounded-full border-2 border-muted-foreground/60 transition-colors hover:border-emerald-500" />
            )}
          </button>

          <div
            className={`break-words text-sm font-medium leading-5 transition-all ${card.completed ? "line-through text-muted-foreground" : "text-foreground"}`}
          >
            {card.title}
          </div>
        </div>
        {!dragging && (
          <div
            className={`absolute right-0.5 top-0.5 transition-opacity duration-200 ${
              mobileControlsVisible
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0"
            } sm:pointer-events-none sm:opacity-0 sm:group-hover/card:pointer-events-auto sm:group-hover/card:opacity-100 sm:group-focus-within/card:pointer-events-auto sm:group-focus-within/card:opacity-100`}
          >
            {onEdit && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                className="touch-target text-muted-foreground transition-colors hover:text-foreground"
                aria-label={`Editar ${card.title}`}
                title="Editar tarefa"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Description Snippet */}
      {card.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2.5 leading-relaxed">
          {card.description}
        </p>
      )}

      {/* Footer Info / Badges */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/40">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Priority */}
          {priorityConf && (
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 font-medium ${priorityConf.badge}`}
            >
              {priorityConf.label}
            </Badge>
          )}

          {/* Due Date */}
          {dueStatus && (
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md border ${dueStatus.badge}`}
            >
              <dueStatus.icon className="h-3 w-3" />
              {dueStatus.text}
            </span>
          )}

          {card.reminder_offsets_minutes.length > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
              title={`${card.reminder_offsets_minutes.length} alerta(s) configurado(s)`}
            >
              <Bell className="h-3 w-3" />
              {card.reminder_offsets_minutes.length}
            </span>
          )}

          {/* Checklist Counter */}
          {totalChecklist > 0 && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground",
                doneChecklist === totalChecklist
                  ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40"
                  : "",
              )}
            >
              <CheckSquare className="h-3 w-3" />
              {doneChecklist}/{totalChecklist}
            </span>
          )}

          {/* Attachment Badge */}
          {card.attachments && card.attachments.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">
              <Paperclip className="h-3 w-3" />
              {card.attachments.length}
            </span>
          )}
        </div>

        {/* Client Tag */}
        {clientName && (
          <div
            className="flex items-center gap-1 text-[10px] text-muted-foreground truncate max-w-[110px]"
            title={clientName}
          >
            <User className="h-3 w-3 shrink-0" />
            <span className="truncate">{clientName}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Task Label Manager ───────────────────────────────────────────
function TaskLabelManagerDialog({
  open,
  onOpenChange,
  taskId,
  allLabels,
  assignments,
  onLabelsChanged,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  taskId: string | null;
  allLabels: TaskLabel[];
  assignments: TaskLabelAssignment[];
  onLabelsChanged: () => void;
}) {
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("blue");
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("blue");

  const assignedIds = taskId
    ? assignments
        .filter((assignment) => assignment.task_id === taskId)
        .map((assignment) => assignment.label_id)
    : [];

  const toggleLabel = async (labelId: string) => {
    if (!taskId) return;

    const isAssigned = assignedIds.includes(labelId);
    if (!isAssigned && assignedIds.length >= 3) {
      toast.error("Máximo de 3 etiquetas por tarefa.");
      return;
    }

    const query = isAssigned
      ? supabase
          .from("task_label_assignments")
          .delete()
          .eq("task_id", taskId)
          .eq("label_id", labelId)
      : supabase.from("task_label_assignments").insert({ task_id: taskId, label_id: labelId });
    const { error } = await query;

    if (error) {
      toast.error("Não foi possível atualizar as etiquetas: " + error.message);
      return;
    }
    onLabelsChanged();
  };

  const createLabel = async () => {
    const name = newName.trim().slice(0, 80);
    if (!user || !name) return;

    const { error } = await supabase.from("task_labels").insert({
      user_id: user.id,
      name,
      color: newColor,
    });
    if (error) {
      toast.error(
        error.code === "23505"
          ? "Já existe uma etiqueta com esse nome."
          : "Não foi possível criar a etiqueta.",
      );
      return;
    }

    setNewName("");
    setNewColor("blue");
    setCreating(false);
    onLabelsChanged();
    toast.success("Etiqueta criada.");
  };

  const updateLabel = async (id: string) => {
    const name = editName.trim().slice(0, 80);
    if (!name) return;

    const { error } = await supabase
      .from("task_labels")
      .update({ name, color: editColor })
      .eq("id", id);
    if (error) {
      toast.error(
        error.code === "23505"
          ? "Já existe uma etiqueta com esse nome."
          : "Não foi possível atualizar a etiqueta.",
      );
      return;
    }

    setEditingLabel(null);
    onLabelsChanged();
    toast.success("Etiqueta atualizada.");
  };

  const deleteLabel = async (id: string) => {
    const { error } = await supabase.from("task_labels").delete().eq("id", id);
    if (error) {
      toast.error("Não foi possível excluir a etiqueta.");
      return;
    }

    setEditingLabel(null);
    onLabelsChanged();
    toast.success("Etiqueta excluída.");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setCreating(false);
      setEditingLabel(null);
      setNewName("");
      setNewColor("blue");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4" />
            Etiquetas da tarefa
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
          {allLabels.length === 0 && !creating && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhuma etiqueta criada ainda.
            </p>
          )}

          {allLabels.map((label) => {
            const isAssigned = assignedIds.includes(label.id);
            const colorInfo = getLabelColorClasses(label.color);
            const isEditing = editingLabel === label.id;

            if (isEditing) {
              return (
                <div key={label.id} className="p-2 rounded-lg border border-border space-y-2">
                  <Input
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    maxLength={80}
                    className="h-8 text-sm"
                    placeholder="Nome da etiqueta"
                    autoFocus
                  />
                  <div className="flex gap-1.5 flex-wrap">
                    {LABEL_COLORS.map((color) => (
                      <button
                        type="button"
                        key={color.value}
                        title={color.label}
                        onClick={() => setEditColor(color.value)}
                        className={`w-6 h-6 rounded-md ${color.bg} border-2 transition-all ${
                          editColor === color.value
                            ? "border-foreground scale-110 ring-1 ring-foreground"
                            : "border-transparent"
                        }`}
                      />
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      className="h-7 text-xs flex-1"
                      onClick={() => updateLabel(label.id)}
                    >
                      Salvar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => setEditingLabel(null)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      onClick={() => deleteLabel(label.id)}
                      title="Excluir etiqueta"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={label.id}
                className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-muted/50 transition-colors group"
              >
                <button
                  type="button"
                  onClick={() => toggleLabel(label.id)}
                  className={`flex-1 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
                    colorInfo.light
                  } ${
                    isAssigned
                      ? "ring-2 ring-offset-1 ring-offset-background ring-current"
                      : "opacity-70 hover:opacity-100"
                  }`}
                >
                  {isAssigned && <Check className="h-3 w-3 shrink-0" />}
                  {label.name}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingLabel(label.id);
                    setEditName(label.name);
                    setEditColor(label.color);
                  }}
                  className="touch-visible-action flex h-11 w-11 items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 sm:h-7 sm:w-7"
                  title="Editar etiqueta"
                  aria-label={`Editar etiqueta ${label.name}`}
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            );
          })}

          {creating && (
            <div className="p-2 rounded-lg border border-border space-y-2">
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                maxLength={80}
                className="h-8 text-sm"
                placeholder="Nome da etiqueta"
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createLabel();
                }}
                autoFocus
              />
              <div className="flex gap-1.5 flex-wrap">
                {LABEL_COLORS.map((color) => (
                  <button
                    type="button"
                    key={color.value}
                    title={color.label}
                    onClick={() => setNewColor(color.value)}
                    className={`w-6 h-6 rounded-md ${color.bg} border-2 transition-all ${
                      newColor === color.value
                        ? "border-foreground scale-110 ring-1 ring-foreground"
                        : "border-transparent"
                    }`}
                  />
                ))}
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  className="h-7 text-xs flex-1"
                  onClick={createLabel}
                  disabled={!newName.trim()}
                >
                  Criar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setCreating(false)}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>

        {!creating && (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Nova etiqueta
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface TaskDialogDraft {
  title: string;
  description: string;
  columnId: string;
  priority: Priority | "none";
  dueDate: string;
  dueTime: string;
  reminderOffsets: ReminderOffsetMinutes[];
  completed: boolean;
  clientId: string;
  selectedLabelIds: string[];
  checklist: ChecklistItem[];
  newCheckitem: string;
  attachments: AttachmentItem[];
  removedAttachmentPaths: string[];
}

// ─── Task Modal Dialog ────────────────────────────────────────────
function TaskDialog({
  open,
  onOpenChange,
  editingCard,
  columns,
  clients,
  allLabels,
  assignments,
  defaultColumnId,
  defaultPriority,
  onSave,
  onDelete,
  onManageLabels,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editingCard: TaskCard | null;
  columns: TaskColumn[];
  clients: ClientLite[];
  allLabels: TaskLabel[];
  assignments: TaskLabelAssignment[];
  defaultColumnId?: string;
  defaultPriority?: Priority | null;
  onSave: (
    form: Partial<TaskCard>,
    removedAttachmentPaths?: string[],
    selectedLabelIds?: string[],
  ) => Promise<boolean>;
  onDelete?: (card: TaskCard) => void;
  onManageLabels?: (card: TaskCard) => void;
}) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [columnId, setColumnId] = useState("");
  const [priority, setPriority] = useState<Priority | "none">("none");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [reminderOffsets, setReminderOffsets] = useState<ReminderOffsetMinutes[]>([]);
  const [completed, setCompleted] = useState(false);
  const [clientId, setClientId] = useState<string>("none");
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [viewingAttachment, setViewingAttachment] = useState<AttachmentItem | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [removedAttachmentPaths, setRemovedAttachmentPaths] = useState<string[]>([]);
  const uploadedAttachmentPathsRef = useRef<string[]>([]);

  // Checklist
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [newCheckitem, setNewCheckitem] = useState("");
  const initializedDraftKeyRef = useRef<string | null>(null);
  const skipNextDraftSaveRef = useRef(false);
  const firstColumnId = columns[0]?.id ?? "";
  const draftKey = user
    ? `crm:task-draft:${user.id}:${editingCard?.id ?? `new:${defaultColumnId ?? firstColumnId}`}`
    : null;

  useEffect(() => {
    if (!open || !draftKey || initializedDraftKeyRef.current === draftKey) return;

    const editingDateParts = toSaoPauloInputParts(editingCard?.due_date);
    const initialDraft: TaskDialogDraft = editingCard
      ? {
          title: editingCard.title ?? "",
          description: editingCard.description ?? "",
          columnId: editingCard.column_id,
          priority: editingCard.priority ?? "none",
          dueDate: editingDateParts.date,
          dueTime: editingCard.due_has_time ? editingDateParts.time : "",
          reminderOffsets: editingCard.due_has_time
            ? normalizeReminderOffsets(editingCard.reminder_offsets_minutes)
            : [],
          completed: editingCard.completed ?? false,
          clientId: editingCard.client_id ?? "none",
          selectedLabelIds: assignments
            .filter((assignment) => assignment.task_id === editingCard.id)
            .map((assignment) => assignment.label_id),
          checklist: editingCard.checklist ?? [],
          newCheckitem: "",
          attachments: editingCard.attachments ?? [],
          removedAttachmentPaths: [],
        }
      : {
          title: "",
          description: "",
          columnId: defaultColumnId ?? firstColumnId,
          priority: defaultPriority ?? "none",
          dueDate: "",
          dueTime: "",
          reminderOffsets: [],
          completed: false,
          clientId: "none",
          selectedLabelIds: [],
          checklist: [],
          newCheckitem: "",
          attachments: [],
          removedAttachmentPaths: [],
        };

    let draft = initialDraft;
    let restored = false;
    try {
      const savedDraft = sessionStorage.getItem(draftKey);
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft) as Partial<TaskDialogDraft>;
        draft = {
          ...initialDraft,
          ...parsed,
          title: typeof parsed.title === "string" ? parsed.title : initialDraft.title,
          description:
            typeof parsed.description === "string" ? parsed.description : initialDraft.description,
          checklist: Array.isArray(parsed.checklist) ? parsed.checklist : initialDraft.checklist,
          attachments: Array.isArray(parsed.attachments)
            ? parsed.attachments
            : initialDraft.attachments,
          selectedLabelIds: Array.isArray(parsed.selectedLabelIds)
            ? parsed.selectedLabelIds
                .filter((labelId): labelId is string => typeof labelId === "string")
                .slice(0, 3)
            : initialDraft.selectedLabelIds,
          removedAttachmentPaths: Array.isArray(parsed.removedAttachmentPaths)
            ? parsed.removedAttachmentPaths
            : initialDraft.removedAttachmentPaths,
          dueTime: typeof parsed.dueTime === "string" ? parsed.dueTime : initialDraft.dueTime,
          reminderOffsets:
            parsed.reminderOffsets === undefined
              ? initialDraft.reminderOffsets
              : normalizeReminderOffsets(parsed.reminderOffsets),
          priority:
            parsed.priority === "none" ||
            parsed.priority === "baixa" ||
            parsed.priority === "media" ||
            parsed.priority === "alta" ||
            parsed.priority === "urgente"
              ? parsed.priority
              : initialDraft.priority,
        };
        restored = true;
      }
    } catch {
      sessionStorage.removeItem(draftKey);
    }

    setTitle(draft.title);
    setDescription(draft.description);
    setColumnId(draft.columnId);
    setPriority(draft.priority);
    setDueDate(draft.dueDate);
    setDueTime(draft.dueTime);
    setReminderOffsets(draft.dueDate && draft.dueTime ? draft.reminderOffsets : []);
    setCompleted(draft.completed);
    setClientId(draft.clientId);
    setSelectedLabelIds(draft.selectedLabelIds);
    setChecklist(draft.checklist);
    setNewCheckitem(draft.newCheckitem);
    setAttachments(draft.attachments);
    setRemovedAttachmentPaths(draft.removedAttachmentPaths);
    uploadedAttachmentPathsRef.current = [];
    initializedDraftKeyRef.current = draftKey;
    skipNextDraftSaveRef.current = true;

    if (restored) toast.info("Rascunho da tarefa restaurado.");
  }, [assignments, defaultColumnId, defaultPriority, draftKey, editingCard, firstColumnId, open]);

  useEffect(() => {
    if (!open || !draftKey || initializedDraftKeyRef.current !== draftKey) return;
    if (skipNextDraftSaveRef.current) {
      skipNextDraftSaveRef.current = false;
      return;
    }

    const draft: TaskDialogDraft = {
      title,
      description,
      columnId,
      priority,
      dueDate,
      dueTime,
      reminderOffsets,
      completed,
      clientId,
      selectedLabelIds,
      checklist,
      newCheckitem,
      attachments,
      removedAttachmentPaths,
    };

    try {
      sessionStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // The in-memory form remains intact even if browser storage is unavailable.
    }
  }, [
    attachments,
    checklist,
    clientId,
    columnId,
    completed,
    description,
    draftKey,
    dueDate,
    dueTime,
    newCheckitem,
    open,
    priority,
    reminderOffsets,
    removedAttachmentPaths,
    selectedLabelIds,
    title,
  ]);

  const addChecklistItem = () => {
    if (!newCheckitem.trim()) return;
    setChecklist([
      ...checklist,
      { id: crypto.randomUUID(), text: newCheckitem.trim(), done: false },
    ]);
    setNewCheckitem("");
  };

  const toggleChecklistItem = (id: string) => {
    setChecklist(checklist.map((item) => (item.id === id ? { ...item, done: !item.done } : item)));
  };

  const removeChecklistItem = (id: string) => {
    setChecklist(checklist.filter((item) => item.id !== id));
  };

  const toggleTaskLabel = (labelId: string) => {
    setSelectedLabelIds((current) => {
      if (current.includes(labelId)) return current.filter((currentId) => currentId !== labelId);
      if (current.length >= 3) {
        toast.error("Máximo de 3 etiquetas por tarefa.");
        return current;
      }
      return [...current, labelId];
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploading(true);
    try {
      const res = await uploadAttachment(user.id, "tasks", file);
      const newAttachment: AttachmentItem = {
        name: res.name,
        path: res.path,
        size: res.size,
        type: res.type,
      };
      uploadedAttachmentPathsRef.current.push(res.path);
      setAttachments((prev) => [...prev, newAttachment]);
      toast.success("Anexo enviado com sucesso!");
    } catch (error: unknown) {
      toast.error(
        "Erro ao enviar anexo: " + (error instanceof Error ? error.message : "erro desconhecido"),
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (path: string) => {
    setAttachments((prev) => prev.filter((a) => a.path !== path));
    setRemovedAttachmentPaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
    toast.success("O anexo será removido ao salvar.");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && uploadedAttachmentPathsRef.current.length > 0) {
      void Promise.allSettled(uploadedAttachmentPathsRef.current.map(removeAttachmentObject));
      uploadedAttachmentPathsRef.current = [];
    }
    if (!nextOpen && draftKey) {
      sessionStorage.removeItem(draftKey);
      initializedDraftKeyRef.current = null;
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = async () => {
    if (!title.trim() || !columnId) {
      toast.error("Por favor, preencha o título da tarefa.");
      return;
    }

    const dueTimestamp = toSaoPauloTimestamp(dueDate, dueTime);
    const hasDueTime = Boolean(dueDate && dueTime);
    const saved = await onSave(
      {
        title: title.trim().slice(0, 300),
        description: description.trim().slice(0, 10_000) || null,
        column_id: columnId,
        priority: priority === "none" ? null : priority,
        due_date: dueTimestamp,
        due_has_time: hasDueTime,
        reminder_offsets_minutes: hasDueTime ? normalizeReminderOffsets(reminderOffsets) : [],
        completed,
        labels: editingCard?.labels ?? [],
        checklist: checklist
          .slice(0, 100)
          .map((item) => ({ ...item, text: item.text.slice(0, 300) })),
        attachments,
        client_id: clientId === "none" ? null : clientId,
      },
      removedAttachmentPaths,
      selectedLabelIds,
    );

    if (saved) {
      if (draftKey) sessionStorage.removeItem(draftKey);
      initializedDraftKeyRef.current = null;
      uploadedAttachmentPathsRef.current = [];
      setRemovedAttachmentPaths([]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100vw-2rem)] lg:max-w-6xl">
        <DialogHeader className="px-4 py-4 sm:px-6 border-b border-border/60 shrink-0">
          <DialogTitle>{editingCard ? "Editar Tarefa" : "Nova Tarefa"}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.75fr)] min-h-full">
            {/* Conteúdo principal */}
            <section className="p-4 sm:p-6 space-y-5 lg:border-r border-border/60">
              <div>
                <Label>Título da Tarefa *</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={300}
                  placeholder="Ex: Enviar proposta comercial para cliente..."
                  className="mt-1.5"
                />
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <Label>Descrição</Label>
                  <span className="text-[11px] text-muted-foreground">
                    {description.length}/10.000
                  </span>
                </div>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={10_000}
                  placeholder="Adicione orientações, links ou detalhes adicionais..."
                  className="mt-1.5 min-h-44 sm:min-h-56 lg:min-h-72 resize-y leading-relaxed"
                />
              </div>

              <div className="pt-1">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <Label className="font-medium">Checklist</Label>
                  {checklist.length > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      {checklist.filter((item) => item.done).length}/{checklist.length} concluídos
                    </span>
                  )}
                </div>
                <div className="flex gap-2 mb-3">
                  <Input
                    value={newCheckitem}
                    onChange={(e) => setNewCheckitem(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addChecklistItem())}
                    placeholder="Adicionar subitem..."
                    className="text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={addChecklistItem}
                    title="Adicionar item"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-1.5">
                  {checklist.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border/70 px-4 py-5 text-center text-xs text-muted-foreground">
                      Nenhum item no checklist.
                    </div>
                  )}
                  {checklist.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border/50 bg-muted/20"
                    >
                      <Checkbox
                        checked={item.done}
                        onCheckedChange={() => toggleChecklistItem(item.id)}
                      />
                      <span
                        className={`flex-1 text-sm break-words ${item.done ? "line-through text-muted-foreground" : ""}`}
                      >
                        {item.text}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeChecklistItem(item.id)}
                        className="text-muted-foreground hover:text-destructive p-1"
                        title="Remover item"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Metadados */}
            <aside className="p-4 sm:p-6 space-y-5 bg-muted/15 border-t lg:border-t-0 border-border/60">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
                <div>
                  <Label>Lista *</Label>
                  <Select value={columnId} onValueChange={setColumnId}>
                    <SelectTrigger className="mt-1.5 bg-background">
                      <SelectValue placeholder="Selecione a lista" />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map((column) => (
                        <SelectItem key={column.id} value={column.id}>
                          {column.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Prioridade</Label>
                  <Select
                    value={priority}
                    onValueChange={(value) => setPriority(value as Priority | "none")}
                  >
                    <SelectTrigger className="mt-1.5 bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem prioridade</SelectItem>
                      <SelectItem value="baixa">Baixa</SelectItem>
                      <SelectItem value="media">Média</SelectItem>
                      <SelectItem value="alta">Alta</SelectItem>
                      <SelectItem value="urgente">Urgente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="sm:col-span-2 lg:col-span-1">
                  <DateReminderEditor
                    date={dueDate}
                    time={dueTime}
                    reminders={reminderOffsets}
                    onDateChange={setDueDate}
                    onTimeChange={setDueTime}
                    onRemindersChange={setReminderOffsets}
                  />
                </div>

                <div>
                  <Label>Cliente Vinculado</Label>
                  <Select value={clientId} onValueChange={setClientId}>
                    <SelectTrigger className="mt-1.5 bg-background">
                      <SelectValue placeholder="Nenhum cliente" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum cliente</SelectItem>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2.5 pt-1">
                <div className="flex items-center justify-between gap-3">
                  <Label className="flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-primary" />
                    Etiquetas
                  </Label>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {selectedLabelIds.length}/3
                    </span>
                    {editingCard && onManageLabels && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => onManageLabels(editingCard)}
                      >
                        Gerenciar
                      </Button>
                    )}
                  </div>
                </div>
                {allLabels.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
                    Nenhuma etiqueta cadastrada.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {allLabels.map((taskLabel) => {
                      const selected = selectedLabelIds.includes(taskLabel.id);
                      const colorInfo = getLabelColorClasses(taskLabel.color);
                      return (
                        <button
                          type="button"
                          key={taskLabel.id}
                          onClick={() => toggleTaskLabel(taskLabel.id)}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all ${colorInfo.light} ${
                            selected
                              ? "ring-2 ring-offset-1 ring-offset-background ring-current"
                              : "opacity-65 hover:opacity-100"
                          }`}
                        >
                          {selected && <Check className="h-3 w-3" />}
                          {taskLabel.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-3 pt-4 border-t border-border/60">
                <div className="flex items-center justify-between gap-3">
                  <Label className="flex items-center gap-1.5 font-medium">
                    <Paperclip className="h-4 w-4 text-primary" />
                    Anexos ({attachments.length})
                  </Label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx"
                    onChange={handleFileUpload}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs bg-background"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {uploading ? "Enviando..." : "Anexar"}
                  </Button>
                </div>

                {attachments.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
                    Nenhum anexo adicionado.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {attachments.map((item) => (
                      <div
                        key={item.path}
                        className="flex items-center gap-2 p-2 rounded-lg border border-border/60 bg-background text-xs"
                      >
                        <FileText className="h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate" title={item.name}>
                            {item.name}
                          </div>
                          {item.size && (
                            <div className="text-[10px] text-muted-foreground">
                              {formatFileSize(item.size)}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center shrink-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Visualizar"
                            onClick={() => {
                              setViewingAttachment(item);
                              setViewerOpen(true);
                            }}
                          >
                            <Eye className="h-3.5 w-3.5 text-blue-500" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Download"
                            onClick={() =>
                              void openAttachmentInNewTab(item.path, item.url).catch(() =>
                                toast.error("Não foi possível abrir o anexo."),
                              )
                            }
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            title="Remover"
                            onClick={() => removeAttachment(item.path)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          </div>
        </div>

        <DialogFooter className="px-4 py-3 sm:px-6 border-t border-border/60 bg-background/95 backdrop-blur shrink-0 sm:justify-between">
          {editingCard && onDelete ? (
            <Button
              variant="ghost"
              className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto"
              onClick={() => onDelete(editingCard)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Excluir tarefa
            </Button>
          ) : (
            <div />
          )}
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={() => handleOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button className="flex-1 sm:flex-none" onClick={() => void handleSubmit()}>
              Salvar Tarefa
            </Button>
          </div>
        </DialogFooter>

        {/* Modal de Pré-Visualização de Anexos */}
        <AttachmentViewerModal
          attachment={viewingAttachment}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
        />
      </DialogContent>
    </Dialog>
  );
}
