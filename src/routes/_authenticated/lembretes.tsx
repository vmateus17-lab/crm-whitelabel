import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import {
  Bell,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { FilterBar, FilterPeriod, FilterSelect } from "@/components/FilterBar";
import { filterChips } from "@/lib/filter-utils";
import { useListFilters } from "@/lib/list-filters";
import { dateInRange, localToday, matchesDateShortcut } from "@/lib/filter-utils";
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
import { DateReminderEditor } from "@/components/DateReminderEditor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  formatSaoPauloDateTime,
  normalizeReminderOffsets,
  toSaoPauloInputParts,
  toSaoPauloTimestamp,
  type ReminderOffsetMinutes,
} from "@/lib/reminders";

export const Route = createFileRoute("/_authenticated/lembretes")({
  component: LembretesPage,
  head: () => ({ meta: [{ title: "CRM | Lembretes" }] }),
});

const REMINDER_FILTERS = { search: "", status: "all", date: "all", from: "", to: "" };

interface Reminder {
  id: string;
  content: string;
  done: boolean;
  due_date: string | null;
  due_has_time: boolean;
  reminder_offsets_minutes: ReminderOffsetMinutes[];
  created_at: string;
}

type ReminderSectionKey = "overdue" | "today" | "upcoming" | "unscheduled" | "completed";

interface ReminderSection {
  key: ReminderSectionKey;
  title: string;
  accent: string;
  dot: string;
  items: Reminder[];
}

const REMINDER_CONTENT_PREFIX = "__crm_reminder_v1__";

function decodeReminderContent(value: string) {
  if (!value.startsWith(REMINDER_CONTENT_PREFIX)) {
    return {
      content: value,
      due_date: null,
      due_has_time: false,
      reminder_offsets_minutes: [] as ReminderOffsetMinutes[],
    };
  }
  try {
    const parsed = JSON.parse(value.slice(REMINDER_CONTENT_PREFIX.length)) as {
      content?: unknown;
      due_date?: unknown;
      due_has_time?: unknown;
      reminder_offsets_minutes?: unknown;
    };
    return {
      content: typeof parsed.content === "string" ? parsed.content : "",
      due_date: typeof parsed.due_date === "string" ? parsed.due_date : null,
      due_has_time: parsed.due_has_time === true,
      reminder_offsets_minutes: normalizeReminderOffsets(parsed.reminder_offsets_minutes),
    };
  } catch {
    return {
      content: value,
      due_date: null,
      due_has_time: false,
      reminder_offsets_minutes: [] as ReminderOffsetMinutes[],
    };
  }
}

function encodeReminderContent(
  content: string,
  dueDate: string | null,
  dueHasTime: boolean,
  offsets: ReminderOffsetMinutes[],
) {
  if (!dueDate) return content;
  return `${REMINDER_CONTENT_PREFIX}${JSON.stringify({ content, due_date: dueDate, due_has_time: dueHasTime, reminder_offsets_minutes: offsets })}`;
}

function buildReminderSections(items: Reminder[]): ReminderSection[] {
  const now = new Date();
  const nowTimestamp = now.getTime();
  const today = toSaoPauloInputParts(now.toISOString()).date;
  const groups: Record<ReminderSectionKey, Reminder[]> = {
    overdue: [],
    today: [],
    upcoming: [],
    unscheduled: [],
    completed: [],
  };

  const sortedItems = [...items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return b.created_at.localeCompare(a.created_at);
  });

  for (const item of sortedItems) {
    if (item.done) {
      groups.completed.push(item);
      continue;
    }
    if (!item.due_date) {
      groups.unscheduled.push(item);
      continue;
    }

    const due = toSaoPauloInputParts(item.due_date);
    const isPastTime = item.due_has_time && new Date(item.due_date).getTime() < nowTimestamp;
    if (due.date < today || (due.date === today && isPastTime)) groups.overdue.push(item);
    else if (due.date === today) groups.today.push(item);
    else groups.upcoming.push(item);
  }

  const sections: ReminderSection[] = [
    {
      key: "overdue",
      title: "Atrasados",
      accent: "text-rose-600 dark:text-rose-400",
      dot: "bg-rose-500",
      items: groups.overdue,
    },
    {
      key: "today",
      title: "Hoje",
      accent: "text-blue-600 dark:text-blue-400",
      dot: "bg-blue-500",
      items: groups.today,
    },
    {
      key: "upcoming",
      title: "Próximos",
      accent: "text-violet-600 dark:text-violet-400",
      dot: "bg-violet-500",
      items: groups.upcoming,
    },
    {
      key: "unscheduled",
      title: "Sem data",
      accent: "text-muted-foreground",
      dot: "bg-muted-foreground/60",
      items: groups.unscheduled,
    },
    {
      key: "completed",
      title: "Concluídos",
      accent: "text-emerald-600 dark:text-emerald-400",
      dot: "bg-emerald-500",
      items: groups.completed,
    },
  ];

  return sections.filter((section) => section.items.length > 0);
}

function LembretesPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const views = useListFilters(REMINDER_FILTERS, "reminders", user?.id, {
    status: ["all", "pending", "done"],
    date: ["all", "today", "overdue", "next7", "none"],
  });
  const { filters } = views;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ completed: true });
  const [deleteCandidate, setDeleteCandidate] = useState<Reminder | null>(null);
  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (!filters.search ||
            item.content
              .toLocaleLowerCase("pt-BR")
              .includes(filters.search.toLocaleLowerCase("pt-BR"))) &&
          (filters.status === "all" || (filters.status === "done" ? item.done : !item.done)) &&
          dateInRange(item.due_date, filters.from, filters.to) &&
          matchesDateShortcut(
            item.due_date,
            filters.date,
            filters.status === "done" ? false : item.done,
            localToday(),
            item.due_has_time,
          ),
      ),
    [items, filters],
  );
  const sections = useMemo(() => buildReminderSections(filtered), [filtered]);

  const load = async () => {
    const { data, error } = await supabase
      .from("todos")
      .select("*")
      .order("done")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Não foi possível carregar os lembretes.");
      return;
    }
    setItems((data ?? []).map((item) => ({ ...item, ...decodeReminderContent(item.content) })));
  };

  const initialLoad = useEffectEvent(() => load().finally(() => setLoading(false)));
  useEffect(() => {
    const timer = window.setTimeout(() => void initialLoad(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };

  const toggle = async (item: Reminder) => {
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id ? { ...candidate, done: !candidate.done } : candidate,
      ),
    );
    const { error } = await supabase.from("todos").update({ done: !item.done }).eq("id", item.id);
    if (error) {
      toast.error("Não foi possível atualizar o lembrete.");
      void load();
    }
  };

  const remove = async (item: Reminder) => {
    const { error } = await supabase.from("todos").delete().eq("id", item.id);
    if (error) {
      toast.error("Não foi possível excluir o lembrete.");
      return;
    }
    setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    toast.success("Lembrete excluído.");
  };

  return (
    <div className="page-shell">
      <FilterBar
        title="Lembretes"
        description="Anotações rápidas com data, horário e alertas"
        actions={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" />
            Novo lembrete
          </Button>
        }
        search={{
          value: filters.search,
          onChange: (search) => views.setFilters({ search }),
          placeholder: "Buscar lembrete...",
        }}
        resultCount={filtered.length}
        resultLabel="lembretes"
        viewState={views}
        onReset={views.resetFilters}
        activeFilters={filterChips(
          filters,
          REMINDER_FILTERS,
          { search: "Busca", status: "Estado", date: "Prazo", from: "Desde", to: "Até" },
          (key, value) => views.setFilters({ [key]: value }),
          {
            status: { pending: "Pendentes", done: "Concluídos" },
            date: {
              today: "Hoje",
              overdue: "Atrasados",
              next7: "Próximos 7 dias",
              none: "Sem data",
            },
          },
        )}
      >
        <FilterSelect
          label="Estado"
          value={filters.status}
          onChange={(status) => views.setFilters({ status })}
          options={[
            { value: "all", label: "Todos" },
            { value: "pending", label: "Pendentes" },
            { value: "done", label: "Concluídos" },
          ]}
        />
        <FilterSelect
          label="Prazo"
          value={filters.date}
          onChange={(date) => views.setFilters({ date })}
          options={[
            { value: "all", label: "Todos os prazos" },
            { value: "today", label: "Hoje" },
            { value: "overdue", label: "Atrasados" },
            { value: "next7", label: "Próximos 7 dias" },
            { value: "none", label: "Sem data" },
          ]}
        />
        <FilterPeriod
          from={filters.from}
          to={filters.to}
          onChange={(from, to) => views.setFilters({ from, to })}
        />
      </FilterBar>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="flex min-h-56 flex-col items-center justify-center gap-3 border-dashed p-6 text-center">
          <Bell className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-medium">
              {items.length ? "Nenhum lembrete para estes filtros" : "Nenhum lembrete"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Crie um lembrete e configure alertas quando precisar.
            </p>
          </div>
          <Button onClick={openNew} variant="outline">
            Criar lembrete
          </Button>
        </Card>
      ) : (
        <div className="space-y-6">
          {sections.map((section) => (
            <section key={section.key} aria-labelledby={`reminder-section-${section.key}`}>
              <h2 id={`reminder-section-${section.key}`} className="mb-2">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((current) => ({
                      ...current,
                      [section.key]: !current[section.key],
                    }))
                  }
                  aria-expanded={
                    section.key === "completed" && filters.status === "done"
                      ? true
                      : !collapsed[section.key]
                  }
                  className={`flex min-h-9 w-full items-center gap-2 px-1 text-left text-sm font-semibold ${section.accent}`}
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${section.dot}`} aria-hidden="true" />
                  {section.title}
                  <span className="text-xs font-normal tabular-nums text-muted-foreground">
                    {section.items.length}
                  </span>
                  <span className="ml-auto text-muted-foreground">
                    {collapsed[section.key] &&
                    !(section.key === "completed" && filters.status === "done") ? (
                      <ChevronRight className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </span>
                </button>
              </h2>
              {(!collapsed[section.key] ||
                (section.key === "completed" && filters.status === "done")) && (
                <Card className="overflow-hidden border-border/70 p-0 shadow-sm">
                  {section.items.map((item, index) => (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setEditing(item);
                        setOpen(true);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setEditing(item);
                          setOpen(true);
                        }
                      }}
                      className={`group/reminder flex min-w-0 cursor-pointer items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none ${
                        index > 0 ? "border-t border-border/60" : ""
                      } ${item.done ? "bg-muted/15" : ""}`}
                    >
                      <Checkbox
                        checked={item.done}
                        onClick={(event) => event.stopPropagation()}
                        onCheckedChange={() => void toggle(item)}
                        aria-label={`Marcar ${item.content} como ${item.done ? "pendente" : "concluído"}`}
                        className="mt-0.5 h-5 w-5 shrink-0 rounded-full"
                      />

                      <div className="min-w-0 flex-1">
                        <p
                          className={
                            item.done
                              ? "break-words text-sm leading-5 text-muted-foreground line-through"
                              : "break-words text-sm font-medium leading-5 text-foreground"
                          }
                        >
                          {item.content}
                        </p>
                        {(item.due_date || item.reminder_offsets_minutes.length > 0) && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            {item.due_date && (
                              <span
                                className={`inline-flex items-center gap-1.5 ${
                                  section.key === "overdue"
                                    ? "font-medium text-rose-600 dark:text-rose-400"
                                    : ""
                                }`}
                              >
                                <CalendarClock className="h-3.5 w-3.5" />
                                {formatSaoPauloDateTime(item.due_date, item.due_has_time)}
                              </span>
                            )}
                            {item.reminder_offsets_minutes.length > 0 && (
                              <span className="inline-flex items-center gap-1.5">
                                <Bell className="h-3.5 w-3.5" />
                                {item.reminder_offsets_minutes.length}{" "}
                                {item.reminder_offsets_minutes.length === 1 ? "alerta" : "alertas"}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="-mr-2 h-9 w-9 shrink-0 text-muted-foreground opacity-100 sm:opacity-0 sm:group-hover/reminder:opacity-100 sm:group-focus-within/reminder:opacity-100"
                            aria-label={`Ações de ${item.content}`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <DropdownMenuItem
                            onSelect={() => {
                              setEditing(item);
                              setOpen(true);
                            }}
                          >
                            <Pencil />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setDeleteCandidate(item)}
                          >
                            <Trash2 />
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))}
                </Card>
              )}
            </section>
          ))}
        </div>
      )}

      <AlertDialog
        open={Boolean(deleteCandidate)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeleteCandidate(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lembrete?</AlertDialogTitle>
            <AlertDialogDescription>
              O lembrete será excluído definitivamente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deleteCandidate) void remove(deleteCandidate);
              }}
            >
              Excluir lembrete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ReminderDialog
        key={`${editing?.id ?? "new"}:${open}`}
        open={open}
        editing={editing}
        onOpenChange={setOpen}
        onSaved={() => void load()}
        userId={user?.id ?? ""}
      />
    </div>
  );
}

function ReminderDialog({
  open,
  editing,
  onOpenChange,
  onSaved,
  userId,
}: {
  open: boolean;
  editing: Reminder | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  userId: string;
}) {
  const dateParts = toSaoPauloInputParts(editing?.due_date);
  const [content, setContent] = useState(editing?.content ?? "");
  const [date, setDate] = useState(dateParts.date);
  const [time, setTime] = useState(editing?.due_has_time ? dateParts.time : "");
  const [offsets, setOffsets] = useState<ReminderOffsetMinutes[]>(
    editing?.due_has_time ? normalizeReminderOffsets(editing.reminder_offsets_minutes) : [],
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const trimmed = content.trim();
    if (!trimmed || !userId) return;
    setSaving(true);
    const hasTime = Boolean(date && time);
    const dueDate = toSaoPauloTimestamp(date, time);
    const payload = {
      content: encodeReminderContent(
        trimmed.slice(0, 500),
        dueDate,
        hasTime,
        hasTime ? normalizeReminderOffsets(offsets) : [],
      ),
    };
    const result = editing
      ? await supabase.from("todos").update(payload).eq("id", editing.id)
      : await supabase.from("todos").insert({ ...payload, user_id: userId });
    setSaving(false);
    if (result.error) {
      toast.error("Não foi possível salvar o lembrete.");
      return;
    }
    toast.success(editing ? "Lembrete atualizado." : "Lembrete criado.");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar lembrete" : "Novo lembrete"}</DialogTitle>
        </DialogHeader>
        <div className="modal-form-scroll min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <Label htmlFor="reminder-content">Lembrete</Label>
            <Input
              id="reminder-content"
              value={content}
              maxLength={500}
              autoFocus
              onChange={(event) => setContent(event.target.value)}
              placeholder="O que você precisa lembrar?"
            />
          </div>
          <DateReminderEditor
            title="Data e alertas"
            emptyText="Sem data definida"
            date={date}
            time={time}
            reminders={offsets}
            onDateChange={setDate}
            onTimeChange={setTime}
            onRemindersChange={setOffsets}
          />
        </div>
        <DialogFooter className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!content.trim() || saving} onClick={() => void save()}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
