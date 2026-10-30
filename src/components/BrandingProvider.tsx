import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { DEFAULT_BRANDING, parseBranding, type Branding } from "@/lib/branding";

const BrandingContext = createContext({
  branding: DEFAULT_BRANDING,
  refreshBranding: async () => {},
});

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const matches = useRouterState({ select: (state) => state.matches });
  const refreshBranding = useCallback(async () => {
    try {
      const response = await fetch("/api/branding", { cache: "no-store" });
      if (response.ok) setBranding(parseBranding(await response.json()));
    } catch {
      /* Keep the current identity while offline. */
    }
  }, []);

  useEffect(() => {
    void refreshBranding();
    const refresh = () => {
      if (document.visibilityState === "visible") void refreshBranding();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshBranding]);

  useEffect(() => {
    const title = matches
      .flatMap((match) => match.meta ?? [])
      .reverse()
      .find((meta) => meta && "title" in meta);
    const section =
      title && "title" in title ? String(title.title).split(" | ").slice(1).join(" | ") : "";
    document.title = section ? `${branding.name} | ${section}` : branding.name;
    for (const selector of [
      'meta[property="og:title"]',
      'meta[name="apple-mobile-web-app-title"]',
    ]) {
      document.querySelector(selector)?.setAttribute("content", branding.name);
    }
    for (const link of document.querySelectorAll<HTMLLinkElement>(
      'link[rel="icon"],link[rel="shortcut icon"],link[rel="apple-touch-icon"]',
    )) {
      link.href = `/app-icon.png?v=${encodeURIComponent(branding.revision)}`;
    }
    document
      .querySelector<HTMLLinkElement>('link[rel="manifest"]')
      ?.setAttribute("href", `/app.webmanifest?v=${encodeURIComponent(branding.revision)}`);
  }, [branding, matches]);

  return (
    <BrandingContext.Provider value={{ branding, refreshBranding }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}

export function BrandLogo({
  className = "",
  decorative = false,
}: {
  className?: string;
  decorative?: boolean;
}) {
  const { branding } = useBranding();
  return (
    <img
      src={branding.logo ?? "/app-icon.png"}
      alt={decorative ? "" : branding.name}
      width={512}
      height={512}
      className={`object-contain ${className}`}
    />
  );
}
