import { Link, useRouterState, useNavigate, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  KanbanSquare,
  Users,
  Receipt,
  StickyNote,
  Settings,
  LogOut,
  Target,
  MoreHorizontal,
  X,
  ListTodo,
  FileSignature,
  BarChart3,
  Bell,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { PREFERENCES_EVENT, SIDEBAR_STORAGE_KEY } from "@/lib/preferences";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PageTitle } from "@/components/PageHeading";
import { BrandLogo, useBranding } from "@/components/BrandingProvider";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/leads", label: "Leads", icon: Target },
  { to: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/financeiro", label: "Financeiro", icon: Receipt },
  { to: "/orcamentos", label: "Orçamentos", icon: FileSignature },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { to: "/tarefas", label: "Tarefas", icon: ListTodo },
  { to: "/lembretes", label: "Lembretes", icon: Bell },
  { to: "/notas", label: "Notas", icon: StickyNote },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

// Primary tabs shown in mobile tab bar (max 5)
const mobileTabPaths = ["/", "/pipeline", "/tarefas", "/financeiro"] as const;
const mobileTabs = mobileTabPaths.map((path) => nav.find((item) => item.to === path)!);
const moreItems = nav.filter(
  (item) => !mobileTabPaths.includes(item.to as (typeof mobileTabPaths)[number]),
);

export function AppLayout() {
  const { branding } = useBranding();
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [moreOpen, setMoreOpen] = useState(false);
  const [hoveredTooltip, setHoveredTooltip] = useState<string | null>(null);

  // Collapsible sidebar state stored in localStorage
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
    }
    return false;
  });

  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      }
      return next;
    });
  };

  useEffect(() => {
    const handlePreferencesChange = (event: Event) => {
      const preferenceEvent = event as CustomEvent<{ sidebarCollapsed?: boolean }>;
      if (typeof preferenceEvent.detail?.sidebarCollapsed === "boolean") {
        setCollapsed(preferenceEvent.detail.sidebarCollapsed);
      }
    };
    window.addEventListener(PREFERENCES_EVENT, handlePreferencesChange);
    return () => window.removeEventListener(PREFERENCES_EVENT, handlePreferencesChange);
  }, []);

  useEffect(() => {
    const handleHorizontalWheel = (event: WheelEvent) => {
      const origin = event.target instanceof Element ? event.target : null;
      const scroller = origin?.closest<HTMLElement>(
        "[data-horizontal-scroll], [class*='overflow-x-auto']",
      );
      if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;

      const delta = Math.abs(event.deltaX) > 0.5 ? event.deltaX : event.shiftKey ? event.deltaY : 0;
      if (!delta) return;

      const maxScroll = scroller.scrollWidth - scroller.clientWidth;
      const canMove = delta < 0 ? scroller.scrollLeft > 0 : scroller.scrollLeft < maxScroll;
      if (!canMove) return;

      event.preventDefault();
      scroller.scrollLeft += delta;
    };

    window.addEventListener("wheel", handleHorizontalWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleHorizontalWheel);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  const isActive = (to: string) => pathname === to || (to !== "/" && pathname.startsWith(to));
  const isMoreActive = moreItems.some((item) => isActive(item.to));

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-screen w-full bg-background text-foreground overflow-hidden flex-col lg:flex-row">
        {/* Desktop sidebar — hidden on mobile */}
        <aside
          className={cn(
            "hidden lg:flex border-r border-border bg-sidebar flex-col shrink-0 transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
            collapsed ? "w-16" : "w-60",
          )}
        >
          {/* Sidebar Header */}
          <div
            className={cn(
              "flex items-center border-b border-border/40 py-5",
              "px-3 transition-[padding] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
              collapsed ? "justify-center px-2" : "px-5",
            )}
          >
            <Tooltip open={hoveredTooltip === "sidebar-toggle"}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggleSidebar}
                  onPointerEnter={() => setHoveredTooltip("sidebar-toggle")}
                  onPointerLeave={() => setHoveredTooltip(null)}
                  className={cn(
                    "flex h-10 items-center overflow-hidden rounded-lg outline-none transition-[width,gap,background-color,transform] duration-300 hover:bg-sidebar-accent active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring",
                    collapsed ? "w-10 justify-center gap-0" : "w-full gap-2.5 px-1",
                  )}
                  aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
                >
                  <BrandLogo decorative className="h-7 w-7 shrink-0 rounded-lg" />
                  <span
                    className={cn(
                      "overflow-hidden whitespace-nowrap text-sm font-semibold tracking-tight transition-[max-width,opacity,transform] duration-400 ease-[cubic-bezier(0.22,1,0.36,1)]",
                      collapsed
                        ? "max-w-0 -translate-x-2 opacity-0"
                        : "max-w-32 translate-x-0 opacity-100",
                    )}
                  >
                    {branding.name}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {collapsed ? "Expandir menu" : "Recolher menu"}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Navigation Items */}
          <nav
            className={cn(
              "flex-1 space-y-1 overflow-y-auto py-3",
              collapsed ? "scrollbar-hide px-2" : "contained-scrollbar px-3",
            )}
          >
            {nav.map((item) => {
              const active = isActive(item.to);

              return (
                <Tooltip key={item.to} open={collapsed && hoveredTooltip === item.to}>
                  <TooltipTrigger asChild>
                    <Link
                      to={item.to}
                      onPointerEnter={() => setHoveredTooltip(item.to)}
                      onPointerLeave={() => setHoveredTooltip(null)}
                      aria-current={active ? "page" : undefined}
                      aria-label={item.label}
                      className={cn(
                        "mx-auto flex h-10 w-full items-center overflow-hidden rounded-lg text-sm whitespace-nowrap transition-[padding,gap,color,background-color] duration-300",
                        collapsed ? "justify-center gap-0 px-0" : "gap-3 px-3",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span
                        className={cn(
                          "overflow-hidden transition-[max-width,opacity,transform,margin] duration-400 ease-[cubic-bezier(0.22,1,0.36,1)]",
                          collapsed
                            ? "ml-0 max-w-0 -translate-x-2 opacity-0"
                            : "max-w-40 translate-x-0 opacity-100",
                        )}
                      >
                        {item.label}
                      </span>
                    </Link>
                  </TooltipTrigger>
                  {collapsed && (
                    <TooltipContent side="right" sideOffset={12}>
                      {item.label}
                    </TooltipContent>
                  )}
                </Tooltip>
              );
            })}
          </nav>

          {/* Sidebar Footer */}
          <div className={cn("border-t border-border/40", collapsed ? "p-2" : "p-3")}>
            <div
              className={cn(
                "overflow-hidden px-3 text-xs text-muted-foreground transition-[max-height,opacity] duration-300",
                collapsed ? "max-h-0 opacity-0" : "max-h-8 py-1.5 opacity-100",
              )}
              title={user?.email ?? ""}
            >
              <span className="block truncate">{user?.email}</span>
            </div>
            <Tooltip open={collapsed && hoveredTooltip === "sign-out"}>
              <TooltipTrigger asChild>
                <button
                  onClick={handleSignOut}
                  onPointerEnter={() => setHoveredTooltip("sign-out")}
                  onPointerLeave={() => setHoveredTooltip(null)}
                  aria-label="Sair da conta"
                  className={cn(
                    "mx-auto flex h-10 w-full items-center overflow-hidden rounded-lg px-3 text-sm text-muted-foreground transition-[gap,color,background-color] duration-300 hover:bg-sidebar-accent hover:text-foreground",
                    collapsed ? "justify-center gap-0 px-0" : "gap-3",
                  )}
                >
                  <LogOut className="h-4 w-4 shrink-0" />
                  <span
                    className={cn(
                      "overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-400",
                      collapsed ? "max-w-0 -translate-x-2 opacity-0" : "max-w-20 opacity-100",
                    )}
                  >
                    Sair
                  </span>
                </button>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right" sideOffset={12}>
                  Sair da conta ({user?.email})
                </TooltipContent>
              )}
            </Tooltip>
          </div>
        </aside>

        {/* Main content */}
        <main
          className="contained-scrollbar flex-1 overflow-auto pb-[calc(env(safe-area-inset-bottom)+3.5rem)] lg:pb-0"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <Outlet />
        </main>

        {/* Mobile tab bar — hidden on desktop */}
        <nav
          className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-sidebar border-t border-border flex items-center justify-around px-1"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {mobileTabs.map((item) => {
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-2 py-2 transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <item.icon className="h-5 w-5" />
                <span className="text-[11px] font-medium truncate">{item.label}</span>
              </Link>
            );
          })}

          {/* More button */}
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            aria-expanded={moreOpen}
            aria-label="Abrir mais opções"
            className={cn(
              "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-2 py-2 transition-colors",
              isMoreActive || moreOpen ? "text-primary" : "text-muted-foreground",
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            <span className="text-[11px] font-medium">Mais</span>
          </button>
        </nav>

        {/* More menu overlay (mobile) */}
        {moreOpen && (
          <>
            <div
              className="lg:hidden fixed inset-0 z-40 bg-black/40"
              onClick={() => setMoreOpen(false)}
            />
            <div
              className="contained-scrollbar fixed bottom-0 left-0 right-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-sidebar animate-in slide-in-from-bottom duration-200 lg:hidden"
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            >
              <div className="flex items-center justify-between px-5 pt-4 pb-2">
                <span className="text-sm font-semibold">Mais opções</span>
                <button
                  onClick={() => setMoreOpen(false)}
                  className="touch-target text-muted-foreground hover:text-foreground"
                  aria-label="Fechar mais opções"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="px-3 pb-3 space-y-0.5">
                {moreItems.map((item) => {
                  const active = isActive(item.to);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setMoreOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-colors",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                      )}
                    >
                      <item.icon className="h-5 w-5" />
                      {item.label}
                    </Link>
                  );
                })}
                <button
                  onClick={() => {
                    handleSignOut();
                    setMoreOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <LogOut className="h-5 w-5" />
                  Sair da conta
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </TooltipProvider>
  );
}

export function PageHeader({
  title,
  description,
  center,
  action,
  mobileTitleAction,
  centerClassName,
  actionClassName,
}: {
  title: React.ReactNode;
  description?: string;
  center?: React.ReactNode;
  action?: React.ReactNode;
  mobileTitleAction?: React.ReactNode;
  centerClassName?: string;
  actionClassName?: string;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle title={title} description={description} />
        </div>
        {mobileTitleAction && <div className="shrink-0 sm:hidden">{mobileTitleAction}</div>}
      </div>
      {center && (
        <div className={cn("w-full min-w-0 lg:flex-1 lg:px-4", centerClassName)}>{center}</div>
      )}
      {action && (
        <div
          className={cn(
            "w-full min-w-0 border-t border-border/60 pt-3 sm:border-t-0 sm:pt-0 lg:w-auto lg:shrink-0",
            actionClassName,
          )}
        >
          {action}
        </div>
      )}
    </div>
  );
}
