import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
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
import { formatMonthBR } from "@/lib/date-format";
import { localToday } from "@/lib/filter-utils";

const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function CrmMonthPicker({
  value,
  onChange,
  label = "Selecionar mês",
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || localToday().slice(0, 7));
  const year = Number(draft.slice(0, 4));
  const selectYear = (change: number) =>
    setDraft(`${String(year + change).padStart(4, "0")}-${draft.slice(5, 7)}`);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value || localToday().slice(0, 7));
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={label}
          disabled={disabled}
          className="h-11 w-full justify-start font-normal sm:h-9"
        >
          <CalendarDays className="mr-2 h-4 w-4 text-muted-foreground" />
          {value ? formatMonthBR(value) : "MM/AAAA"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>Escolha o mês e o ano.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Ano anterior"
            disabled={year <= 1}
            onClick={() => selectYear(-1)}
          >
            <ChevronLeft />
          </Button>
          <span className="font-semibold tabular-nums">{year}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Próximo ano"
            disabled={year >= 9999}
            onClick={() => selectYear(1)}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {months.map((month, index) => {
            const candidate = `${draft.slice(0, 4)}-${String(index + 1).padStart(2, "0")}`;
            return (
              <Button
                key={month}
                type="button"
                variant={candidate === draft ? "default" : "ghost"}
                aria-pressed={candidate === draft}
                onClick={() => setDraft(candidate)}
              >
                {month}
              </Button>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onChange(draft);
              setOpen(false);
            }}
          >
            Selecionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
