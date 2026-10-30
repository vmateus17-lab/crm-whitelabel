import { Bell, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  normalizeReminderOffsets,
  REMINDER_OPTIONS,
  type ReminderOffsetMinutes,
} from "@/lib/reminders";

interface ReminderPickerProps {
  value: ReminderOffsetMinutes[];
  onChange: (value: ReminderOffsetMinutes[]) => void;
  disabled?: boolean;
  className?: string;
}

export function ReminderPicker({
  value,
  onChange,
  disabled = false,
  className,
}: ReminderPickerProps) {
  const selected = normalizeReminderOffsets(value);

  const toggle = (offset: ReminderOffsetMinutes) => {
    if (disabled) return;
    onChange(
      selected.includes(offset)
        ? selected.filter((item) => item !== offset)
        : normalizeReminderOffsets([...selected, offset]),
    );
  };

  const selectedLabels = REMINDER_OPTIONS.filter((option) => selected.includes(option.value)).map(
    (option) => option.label,
  );
  const summary =
    selectedLabels.length === 0
      ? "Nenhum alerta"
      : selectedLabels.length === 1
        ? selectedLabels[0]
        : `${selectedLabels.length} alertas selecionados`;

  return (
    <div className={cn("space-y-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            disabled={disabled}
            className="flex h-11 w-full items-center gap-3 rounded-lg border border-input bg-background px-3 text-left shadow-xs transition-colors hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background"
          >
            <Bell className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-foreground">Alertas</span>
              <span className="block truncate text-[11px] text-muted-foreground">{summary}</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-64"
        >
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Selecione um ou mais alertas
          </DropdownMenuLabel>
          {REMINDER_OPTIONS.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={selected.includes(option.value)}
              onCheckedChange={() => toggle(option.value)}
              onSelect={(event) => event.preventDefault()}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {disabled
          ? "Defina a data e o horário para configurar alertas."
          : "Você pode selecionar mais de um alerta."}
      </p>
    </div>
  );
}
