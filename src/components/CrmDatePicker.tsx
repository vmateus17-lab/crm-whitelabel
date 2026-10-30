import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { localToday } from "@/lib/filter-utils";

function parseDate(value?: string | null) {
  if (!value) return undefined;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function serializeDate(value?: Date) {
  if (!value) return "";
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function displayDate(value?: Date) {
  return value ? format(value, "dd/MM/yyyy", { locale: ptBR }) : "Selecionar data";
}

export function CrmDatePicker({
  value,
  onChange,
  label = "Selecionar data",
  className,
  min,
  max,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date | undefined>(() => parseDate(value));

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) setDraft(parseDate(value));
    setOpen(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          data-slot="date-picker-trigger"
          className={cn("h-11 w-full min-w-0 justify-start font-normal sm:h-9", className)}
          aria-label={label}
          disabled={disabled}
        >
          <CalendarDays className="mr-2 h-4 w-4 text-muted-foreground" />
          {displayDate(parseDate(value))}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100%-1rem)] max-w-sm gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4 pr-14">
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>Escolha o dia no calendário.</DialogDescription>
        </DialogHeader>
        <div className="flex justify-center overflow-x-auto p-2 sm:p-4">
          <Calendar
            mode="single"
            selected={draft}
            onSelect={setDraft}
            defaultMonth={draft}
            locale={ptBR}
            disabled={(date) => {
              const serialized = serializeDate(date);
              return Boolean((min && serialized < min) || (max && serialized > max));
            }}
          />
        </div>
        <DialogFooter className="border-t p-4">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!draft}
            onClick={() => {
              onChange(serializeDate(draft));
              setOpen(false);
            }}
          >
            Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CrmDateRangePicker({
  from,
  to,
  onChange,
  className,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const selected = useMemo<DateRange | undefined>(() => {
    const fromDate = parseDate(from);
    if (!fromDate) return undefined;
    return { from: fromDate, to: parseDate(to) };
  }, [from, to]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(selected);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) setDraft(selected);
    setOpen(nextOpen);
  };

  const setPreset = (months: number) => {
    const end = parseDate(localToday())!;
    const start = new Date(end.getFullYear(), end.getMonth() - months + 1, 1);
    setDraft({ from: start, to: end });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-11 w-full justify-start whitespace-nowrap font-normal sm:h-9 sm:w-auto",
            className,
          )}
          aria-label="Selecionar período"
        >
          <CalendarDays className="mr-2 h-4 w-4 text-muted-foreground" />
          <span>{displayDate(selected?.from)}</span>
          <span className="mx-1 text-muted-foreground">até</span>
          <span>{displayDate(selected?.to)}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100%-1rem)] max-w-md gap-0 overflow-hidden p-0 sm:w-auto sm:max-w-fit">
        <DialogHeader className="border-b px-5 py-4 pr-14">
          <DialogTitle>Selecionar período</DialogTitle>
          <DialogDescription>Selecione a data inicial e a data final.</DialogDescription>
        </DialogHeader>
        <div className="contained-scrollbar max-h-[calc(100dvh-11rem)] overflow-y-auto">
          <div className="flex flex-wrap gap-2 border-b px-4 py-3">
            <Button type="button" size="sm" variant="outline" onClick={() => setPreset(1)}>
              Este mês
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setPreset(3)}>
              Últimos 3 meses
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setPreset(6)}>
              Últimos 6 meses
            </Button>
          </div>
          <div className="flex justify-center overflow-x-auto p-2 sm:p-4">
            <Calendar
              mode="range"
              selected={draft}
              onSelect={setDraft}
              defaultMonth={draft?.from}
              numberOfMonths={isMobile ? 1 : 2}
              locale={ptBR}
              className="w-full [--cell-size:--spacing(9)] sm:w-auto sm:[--cell-size:--spacing(8)]"
            />
          </div>
        </div>
        <DialogFooter className="border-t p-4">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!draft?.from || !draft.to}
            onClick={() => {
              if (!draft?.from || !draft.to) return;
              onChange(serializeDate(draft.from), serializeDate(draft.to));
              setOpen(false);
            }}
          >
            Aplicar período
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
