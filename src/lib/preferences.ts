export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "crm_theme";
export const SIDEBAR_STORAGE_KEY = "crm_sidebar_collapsed";
export const PREFERENCES_EVENT = "crm-preferences-changed";

export function applyThemePreference(theme: ThemePreference): void {
  if (typeof window === "undefined") return;

  localStorage.setItem(THEME_STORAGE_KEY, theme);
  const useDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", useDark);
  document.documentElement.style.colorScheme = useDark ? "dark" : "light";
}

export function applySidebarPreference(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
  window.dispatchEvent(
    new CustomEvent(PREFERENCES_EVENT, {
      detail: { sidebarCollapsed: collapsed },
    }),
  );
}

export function applyStoredThemePreference(): void {
  if (typeof window === "undefined") return;
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  const theme: ThemePreference =
    stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  applyThemePreference(theme);
}
