import { cn } from "@/lib/utils";

export type PeriodMode = "all" | "month";

export function PeriodToggle({
  value,
  onValueChange,
  className,
}: {
  value: PeriodMode;
  onValueChange: (value: PeriodMode) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative grid h-11 w-[240px] shrink-0 grid-cols-2 rounded-lg bg-muted p-1",
        className,
      )}
      role="group"
      aria-label="Período dos dados"
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-md bg-background shadow-sm ring-1 ring-border/60 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          value === "month" && "translate-x-full",
        )}
      />
      <button
        type="button"
        onClick={() => onValueChange("all")}
        aria-pressed={value === "all"}
        className={cn(
          "relative z-10 whitespace-nowrap rounded-md px-3 text-xs font-medium transition-colors duration-300",
          value === "all" ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        Todo o período
      </button>
      <button
        type="button"
        onClick={() => onValueChange("month")}
        aria-pressed={value === "month"}
        className={cn(
          "relative z-10 whitespace-nowrap rounded-md px-3 text-xs font-medium transition-colors duration-300",
          value === "month" ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        Por mês
      </button>
    </div>
  );
}

export function AnimatedPeriodControls({
  visible,
  children,
  className,
}: {
  visible: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "grid transition-[grid-template-columns,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        visible
          ? "grid-cols-[1fr] translate-x-0 opacity-100"
          : "pointer-events-none grid-cols-[0fr] translate-x-2 opacity-0",
        className,
      )}
    >
      <div className="min-w-0 overflow-hidden">
        <div className="flex w-full items-center gap-2">{children}</div>
      </div>
    </div>
  );
}
