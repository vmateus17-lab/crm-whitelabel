import { CalendarDays, ChevronRight, Clock, X } from "lucide-react";
import { ptBR } from "date-fns/locale";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ReminderPicker } from "@/components/ReminderPicker";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  formatSaoPauloDateTime,
  toSaoPauloTimestamp,
  type ReminderOffsetMinutes,
} from "@/lib/reminders";

interface DateReminderEditorProps {
  date: string;
  time: string;
  reminders: ReminderOffsetMinutes[];
  title?: string;
  emptyText?: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  onRemindersChange: (value: ReminderOffsetMinutes[]) => void;
}

function dateInputToDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return undefined;
  return new Date(year, month - 1, day);
}

function dateToInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function DateEditorContent({
  date,
  time,
  reminders,
  onDateChange,
  onTimeChange,
  onRemindersChange,
  onDone,
  idPrefix,
}: DateReminderEditorProps & { onDone: () => void; idPrefix: string }) {
  const clearDate = () => {
    onDateChange("");
    onTimeChange("");
    onRemindersChange([]);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-4 pb-3 sm:px-5">
        <Calendar
          mode="single"
          locale={ptBR}
          selected={dateInputToDate(date)}
          onSelect={(selected) => {
            if (!selected) return;
            onDateChange(dateToInputValue(selected));
          }}
          className="mx-auto p-0 [--cell-size:2.25rem]"
        />

        <div className="mt-5 space-y-4 border-t border-border/60 pt-4">
          <div className="grid grid-cols-2 items-start gap-3">
            <div className="grid min-w-0 grid-rows-[1.25rem_auto] gap-1.5">
              <Label className="flex items-center" htmlFor={`${idPrefix}-date`}>
                Data
              </Label>
              <Input
                id={`${idPrefix}-date`}
                type="text"
                readOnly
                value={date ? date.split("-").reverse().join("/") : "Selecione no calendário"}
                className="cursor-default bg-background text-muted-foreground"
              />
            </div>
            <div className="grid min-w-0 grid-rows-[1.25rem_auto] gap-1.5">
              <Label className="flex items-center" htmlFor={`${idPrefix}-time`}>
                Horário
              </Label>
              <div className="relative min-w-0">
                <Clock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id={`${idPrefix}-time`}
                  type="time"
                  value={time}
                  disabled={!date}
                  onChange={(event) => {
                    const nextTime = event.target.value;
                    onTimeChange(nextTime);
                    if (!nextTime) onRemindersChange([]);
                  }}
                  className="max-w-full min-w-0 appearance-none bg-background !pl-10"
                />
              </div>
            </div>
          </div>

          <ReminderPicker
            value={reminders}
            onChange={onRemindersChange}
            disabled={!date || !time}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-popover px-4 py-3 sm:px-5">
        <Button type="button" variant="ghost" onClick={clearDate} disabled={!date}>
          Limpar
        </Button>
        <Button type="button" onClick={onDone}>
          Aplicar
        </Button>
      </div>
    </div>
  );
}

export function DateReminderEditor({
  title = "Editar data",
  emptyText = "Sem data definida",
  ...props
}: DateReminderEditorProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const idPrefix = useId();
  const dueTimestamp = toSaoPauloTimestamp(props.date, props.time);
  const summary = dueTimestamp
    ? `${formatSaoPauloDateTime(dueTimestamp, Boolean(props.time))}${
        props.reminders.length > 0
          ? ` · ${props.reminders.length} ${props.reminders.length === 1 ? "alerta" : "alertas"}`
          : ""
      }`
    : emptyText;

  const trigger = (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-lg border border-input bg-background px-3 py-2.5 text-left shadow-xs transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <CalendarDays className="h-4 w-4 text-foreground" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{summary}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent className="max-h-[calc(100dvh-env(safe-area-inset-top)-1rem)] overflow-hidden pb-[env(safe-area-inset-bottom)]">
          <DrawerHeader className="flex-row items-center justify-between border-b border-border/60 text-left">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </Button>
            </DrawerClose>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 overflow-hidden pt-4">
            <DateEditorContent {...props} idPrefix={idPrefix} onDone={() => setOpen(false)} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="left"
        sideOffset={12}
        collisionPadding={16}
        className="flex w-[400px] flex-col overflow-hidden p-0"
        style={{ maxHeight: "min(680px, var(--radix-popover-content-available-height))" }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-5 py-3.5">
          <p className="text-sm font-semibold">{title}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Fechar"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <DateEditorContent {...props} idPrefix={idPrefix} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
