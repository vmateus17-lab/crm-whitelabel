import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatTimeBR } from "@/lib/date-format";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

function HeadingTooltip({ text, children }: { text: string; children: ReactElement }) {
  return (
    <TooltipProvider delayDuration={2000} skipDelayDuration={0}>
      <Tooltip delayDuration={2000} disableHoverableContent>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          sideOffset={8}
          className="max-w-[min(20rem,calc(100vw-2rem))]"
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function PageTitle({
  title,
  description,
  className,
}: {
  title: ReactNode;
  description?: string;
  className?: string;
}) {
  return (
    <h1
      className={cn("min-w-0 truncate text-xl font-semibold tracking-tight md:text-2xl", className)}
    >
      {description ? (
        <HeadingTooltip text={description}>
          <span
            tabIndex={0}
            className="inline-block max-w-full truncate align-top rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {title}
          </span>
        </HeadingTooltip>
      ) : (
        title
      )}
    </h1>
  );
}

export function UpdatedTooltip({
  updatedAt,
  children,
}: {
  updatedAt?: string | Date | null;
  children: ReactElement;
}) {
  return (
    <HeadingTooltip
      text={updatedAt ? `Atualizado às ${formatTimeBR(updatedAt)}` : "Atualizar os dados"}
    >
      {children}
    </HeadingTooltip>
  );
}
