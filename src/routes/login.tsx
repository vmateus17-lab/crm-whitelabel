import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { safeLoginRedirect } from "@/lib/navigation";
import { AuthLoadingScreen } from "@/components/AuthLoadingScreen";
import { BrandLogo, useBranding } from "@/components/BrandingProvider";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({ meta: [{ title: "CRM | Entrar" }] }),
});

function LoginPage() {
  const { branding } = useBranding();
  const { signIn, user, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [redirectFailure, setRedirectFailure] = useState<{ user: typeof user } | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const redirectFailed = Boolean(user && redirectFailure?.user === user);

  useEffect(() => {
    let active = true;
    if (!loading && user) {
      const target = safeLoginRedirect(
        new URLSearchParams(window.location.search).get("redirect"),
        window.location.origin,
      );
      void navigate({ href: target, replace: true })
        .then(() => {
          // A rejected/expired session can send the protected route back here.
          // Do not leave a cached user stuck on a loading screen forever.
          if (active && window.location.pathname === "/login") setRedirectFailure({ user });
        })
        .catch(() => {
          if (active) setRedirectFailure({ user });
        });
    }
    return () => {
      active = false;
    };
  }, [user, loading, navigate, retryAttempt]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await signIn(email, password);
      if (result.error) {
        toast.error(result.error);
      } else {
        setRedirectFailure(null);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || (user && !redirectFailed)) return <AuthLoadingScreen />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <BrandLogo className="h-12 w-12 rounded-xl mx-auto mb-4" />
          <h1 className="text-2xl font-semibold tracking-tight">{branding.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">Acesse o painel administrativo</p>
        </div>

        {redirectFailed && (
          <div className="mb-6 space-y-3 rounded-xl border bg-muted/20 p-4">
            <p role="status" className="text-sm text-muted-foreground">
              Não foi possível confirmar sua sessão. Tente novamente ou faça login abaixo.
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                setRedirectFailure(null);
                setRetryAttempt((value) => value + 1);
              }}
            >
              Tentar novamente
            </Button>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@exemplo.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <Button type="submit" className="w-full h-10" disabled={submitting}>
            {submitting ? "Aguarde..." : "Entrar"}
          </Button>
        </form>
      </div>
    </div>
  );
}
