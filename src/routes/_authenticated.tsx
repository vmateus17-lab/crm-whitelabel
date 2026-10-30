import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import {
  applySidebarPreference,
  applyStoredThemePreference,
  applyThemePreference,
  SIDEBAR_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/preferences";
import { registerCurrentDeviceSession } from "@/lib/device-sessions";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, session } = useAuth();

  useEffect(() => {
    applyStoredThemePreference();
    if (!user) return;

    let active = true;
    void (async () => {
      const { data: settings } = await supabase
        .from("user_settings")
        .select("theme, sidebar_collapsed")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!active || !settings) return;

      applyThemePreference(settings.theme as ThemePreference);
      // A escolha feita diretamente na barra lateral é específica deste navegador
      // e não deve ser sobrescrita a cada troca de rota pelo valor padrão da conta.
      if (localStorage.getItem(SIDEBAR_STORAGE_KEY) === null) {
        applySidebarPreference(settings.sidebar_collapsed);
      }
    })();

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    const heartbeat = () => {
      if (!active) return;
      void registerCurrentDeviceSession(session).catch((error) => {
        console.error("Não foi possível atualizar a sessão do dispositivo:", error);
      });
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 5 * 60 * 1000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") heartbeat();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [session]);

  return <AppLayout />;
}
