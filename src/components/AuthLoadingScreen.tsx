import { LoaderCircle } from "lucide-react";
import { BrandLogo } from "@/components/BrandingProvider";

/** The same initial screen is rendered on the server and during browser session checks. */
export function AuthLoadingScreen() {
  return (
    <main
      className="flex min-h-dvh items-center justify-center bg-background px-6"
      data-slot="auth-loading"
      aria-busy="true"
    >
      <div role="status" aria-live="polite" className="flex flex-col items-center text-center">
        <BrandLogo className="mb-6 h-14 w-14 rounded-2xl" />
        <LoaderCircle
          aria-hidden="true"
          className="mb-3 h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none"
        />
        <p className="text-sm text-muted-foreground">Carregando seu CRM…</p>
      </div>
    </main>
  );
}
