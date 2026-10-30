import { useRef, useState, type ReactNode } from "react";
import { Bookmark, Filter, MoreHorizontal, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CrmDateRangePicker } from "@/components/CrmDatePicker";
import { getDatePreset, type DatePreset } from "@/lib/filter-utils";
import type { SavedFilterView } from "@/lib/list-filters";
import { toast } from "sonner";
import { PageTitle } from "@/components/PageHeading";

type ViewState = {
  savedViews: SavedFilterView[];
  saveView: (name: string) => boolean;
  applyView: (view: SavedFilterView) => void;
  deleteView: (id: string) => unknown;
};

export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="w-full min-w-0 bg-background">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const presets: Array<{ value: DatePreset; label: string }> = [
  { value: "all", label: "Todo o período" },
  { value: "today", label: "Hoje" },
  { value: "last7", label: "Últimos 7 dias" },
  { value: "last30", label: "Últimos 30 dias" },
  { value: "month", label: "Este mês" },
  { value: "lastMonth", label: "Mês passado" },
  { value: "year", label: "Este ano" },
];

export function FilterPeriod({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const selected =
    presets.find((preset) => {
      const range = getDatePreset(preset.value);
      return range.from === from && range.to === to;
    })?.value ?? "custom";
  return (
    <div className="min-w-0 space-y-1.5 sm:col-span-2">
      <Label className="text-xs text-muted-foreground">Período</Label>
      <div className="flex flex-wrap gap-2">
        <Select
          value={selected}
          onValueChange={(value) => {
            if (value === "custom") return;
            const range = getDatePreset(value as DatePreset);
            onChange(range.from, range.to);
          }}
        >
          <SelectTrigger
            aria-label="Atalho de período"
            className="w-full min-w-36 bg-background sm:w-auto"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presets.map((preset) => (
              <SelectItem key={preset.value} value={preset.value}>
                {preset.label}
              </SelectItem>
            ))}
            <SelectItem value="custom">Personalizado</SelectItem>
          </SelectContent>
        </Select>
        <CrmDateRangePicker from={from} to={to} onChange={onChange} className="max-w-full" />
      </div>
    </div>
  );
}

export function FilterBar({
  title,
  description,
  search,
  children,
  actions,
  activeFilters = [],
  onReset,
  resultCount,
  resultLabel = "resultados",
  status,
  viewState,
}: {
  title?: ReactNode;
  description?: string;
  search?: { value: string; onChange: (value: string) => void; placeholder?: string };
  children?: ReactNode;
  actions?: ReactNode;
  activeFilters?: Array<{ key: string; label: string; onClear: () => void }>;
  onReset?: () => void;
  resultCount?: number;
  resultLabel?: string;
  status?: ReactNode;
  viewState?: ViewState;
}) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const metadata = status ?? (resultCount !== undefined ? `${resultCount} ${resultLabel}` : null);
  return (
    <section aria-label="Filtros da visualização" className="mb-6 shrink-0">
      <div data-slot="page-heading" className="flex min-w-0 items-start justify-between gap-3">
        {title && (
          <div className="min-w-0 flex-1 xl:pr-4">
            <PageTitle title={title} description={description} />
            {metadata !== null && (
              <p
                data-slot="page-status-mobile"
                className="mt-1 text-xs tabular-nums text-muted-foreground md:hidden"
                aria-live="polite"
              >
                {metadata}
              </p>
            )}
          </div>
        )}
        <div data-slot="page-toolbar" className="flex shrink-0 items-center gap-1.5 xl:gap-2">
          {metadata !== null && (
            <p
              data-slot="page-status-desktop"
              className="hidden shrink-0 whitespace-nowrap pr-2 text-xs tabular-nums text-muted-foreground md:block"
              aria-live="polite"
            >
              {metadata}
            </p>
          )}
          {search && (
            <>
              <div className="hidden w-44 min-w-0 xl:block 2xl:w-64">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label={search.placeholder ?? "Buscar"}
                    placeholder={search.placeholder ?? "Buscar..."}
                    value={search.value}
                    onChange={(event) => search.onChange(event.target.value)}
                    className="!pl-10 bg-background"
                  />
                </div>
              </div>
              <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="relative xl:hidden"
                    aria-label="Buscar"
                    title="Buscar"
                  >
                    <Search />
                    {search.value.trim() && (
                      <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-foreground" />
                    )}
                  </Button>
                </DialogTrigger>
                <DialogContent
                  className="sm:max-w-md"
                  onOpenAutoFocus={() => searchInputRef.current?.focus()}
                >
                  <DialogHeader>
                    <DialogTitle>Buscar</DialogTitle>
                    <DialogDescription>
                      {search.placeholder ?? "Encontre um item nesta página."}
                    </DialogDescription>
                  </DialogHeader>
                  <Input
                    ref={searchInputRef}
                    aria-label={search.placeholder ?? "Buscar"}
                    placeholder={search.placeholder ?? "Buscar..."}
                    value={search.value}
                    onChange={(event) => search.onChange(event.target.value)}
                  />
                  <DialogFooter>
                    <Button
                      variant="outline"
                      disabled={!search.value}
                      onClick={() => search.onChange("")}
                    >
                      Limpar busca
                    </Button>
                    <Button onClick={() => setSearchOpen(false)}>Ver resultados</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
          {(children || viewState) && (
            <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  aria-label="Filtros"
                  title="Filtros"
                  className="relative w-9 px-0 xl:w-auto xl:px-4"
                >
                  <Filter />
                  <span className="hidden xl:inline">Filtros</span>
                  {activeFilters.length > 0 && (
                    <>
                      <span className="hidden rounded-full bg-muted px-1.5 text-xs tabular-nums xl:inline">
                        {activeFilters.length}
                      </span>
                      <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-foreground xl:hidden" />
                    </>
                  )}
                </Button>
              </DialogTrigger>
              <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
                <DialogHeader className="shrink-0 border-b px-5 py-4 pr-14 text-left">
                  <DialogTitle>Filtros</DialogTitle>
                  <DialogDescription>
                    Refine os resultados e gerencie suas visualizações.
                  </DialogDescription>
                </DialogHeader>
                <div className="min-h-0 space-y-6 overflow-y-auto p-5">
                  <div className="grid gap-4 sm:grid-cols-2">{children}</div>
                  {activeFilters.length > 0 && (
                    <div className="flex flex-wrap gap-2" aria-label="Filtros ativos">
                      {activeFilters.map((filter) => (
                        <button
                          type="button"
                          key={filter.key}
                          onClick={filter.onClear}
                          className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 text-xs hover:bg-muted"
                          aria-label={`Remover filtro ${filter.label}`}
                        >
                          <span className="truncate">{filter.label}</span>
                          <X className="h-3 w-3 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                  {viewState && (
                    <section className="space-y-3 border-t pt-5" aria-label="Visualizações salvas">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="flex items-center gap-2 text-sm font-medium">
                          <Bookmark className="h-4 w-4" />
                          Visualizações
                        </h3>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setName("");
                            setFiltersOpen(false);
                            setSaveOpen(true);
                          }}
                        >
                          Salvar visualização atual
                        </Button>
                      </div>
                      {viewState.savedViews.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Nenhuma visualização salva.</p>
                      ) : (
                        <div className="space-y-1">
                          {viewState.savedViews.map((view) => (
                            <div key={view.id} className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                className="min-w-0 flex-1 justify-start"
                                onClick={() => viewState.applyView(view)}
                              >
                                <span className="truncate">{view.name}</span>
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Excluir visualização ${view.name}`}
                                onClick={() => viewState.deleteView(view.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )}
                </div>
                <DialogFooter className="shrink-0 border-t p-4">
                  <div className="flex w-full items-center justify-between gap-2">
                    <Button variant="ghost" onClick={onReset} disabled={!onReset}>
                      Limpar filtros
                    </Button>
                    <Button onClick={() => setFiltersOpen(false)}>Ver resultados</Button>
                  </div>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {actions && (
            <>
              <div data-slot="page-actions" className="hidden items-center gap-2 xl:flex">
                {actions}
              </div>
              <Dialog open={actionsOpen} onOpenChange={setActionsOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="xl:hidden"
                    aria-label="Ações da página"
                    title="Ações da página"
                  >
                    <MoreHorizontal />
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Ações{typeof title === "string" ? ` · ${title}` : ""}</DialogTitle>
                    <DialogDescription>Escolha o que deseja fazer.</DialogDescription>
                  </DialogHeader>
                  <div
                    data-slot="page-actions-mobile"
                    className="space-y-2 [&>div]:flex [&>div]:flex-col [&>div]:items-stretch [&_button]:w-full [&_button]:justify-start [&_button]:px-3"
                    onClick={(event) => {
                      const button = (event.target as HTMLElement).closest("button");
                      if (button && !button.disabled && !button.hasAttribute("aria-haspopup"))
                        setActionsOpen(false);
                    }}
                  >
                    {actions}
                  </div>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>
      {!title && metadata !== null && (
        <p
          data-slot="page-status-mobile"
          className="mt-3 text-xs tabular-nums text-muted-foreground md:hidden"
          aria-live="polite"
        >
          {metadata}
        </p>
      )}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Salvar visualização</DialogTitle>
            <DialogDescription>
              Os filtros ficam salvos neste navegador, somente para a sua conta. Até 20
              visualizações por aba.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="filter-view-name">Nome</Label>
            <Input
              id="filter-view-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Leads para retomar"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!name.trim()}
              onClick={() => {
                if (viewState?.saveView(name)) {
                  toast.success("Visualização salva.");
                  setSaveOpen(false);
                } else
                  toast.error(
                    "Não foi possível salvar. Verifique o limite e o armazenamento do navegador.",
                  );
              }}
            >
              Salvar visualização
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
