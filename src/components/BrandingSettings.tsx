import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { BRAND_NAME_LIMIT, prepareLogo, validateBrandName } from "@/lib/branding";
import { useBranding } from "./BrandingProvider";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { toast } from "sonner";

export function BrandingSettings({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { branding, refreshBranding } = useBranding();
  const [name, setName] = useState(branding.name);
  const [logo, setLogo] = useState<string | null>(branding.logo);
  const [busy, setBusy] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [status, setStatus] = useState("");
  const uploadGeneration = useRef(0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setName(branding.name);
    setLogo(branding.logo);
    setCanEdit(false);
    setStatus("Carregando permissões…");
    void (supabase as SupabaseClient).rpc("can_manage_crm_branding").then(({ data, error }) => {
      if (!active) return;
      setCanEdit(!error && data === true);
      setStatus(
        error
          ? "Não foi possível carregar a identidade. Verifique se as migrações foram aplicadas."
          : data
            ? ""
            : "Apenas o responsável pela identidade pode alterar estas opções.",
      );
    });
    return () => {
      active = false;
      uploadGeneration.current++;
    };
  }, [open, branding.name, branding.logo]);

  const save = async () => {
    setBusy(true);
    try {
      const validName = validateBrandName(name);
      const { error } = await (supabase as SupabaseClient).rpc("save_crm_branding", {
        p_name: validName,
        p_logo: logo,
      });
      if (error)
        throw new Error(
          error.code === "42501"
            ? "Apenas o responsável pela identidade pode alterá-la."
            : "Não foi possível salvar a identidade visual.",
        );
      await refreshBranding();
      toast.success("Identidade visual salva");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Identidade visual</DialogTitle>
          <DialogDescription>
            Personalize o nome e o logo exibidos no CRM, no login e no ícone da aba. Essa identidade
            será pública para quem acessar esta instalação.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (canEdit && !busy) void save();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="crm-brand-name">Nome do CRM</Label>
            <Input
              id="crm-brand-name"
              value={name}
              required
              disabled={!canEdit || busy}
              aria-describedby="crm-name-help"
              onChange={(event) =>
                setName(Array.from(event.target.value).slice(0, BRAND_NAME_LIMIT).join(""))
              }
            />
            <p id="crm-name-help" className="text-xs text-muted-foreground">
              {Array.from(name).length}/12 caracteres
            </p>
          </div>
          <div className="space-y-3">
            <Label htmlFor="crm-brand-logo">Logo quadrado (1:1)</Label>
            <div className="flex items-center gap-4 rounded-xl border p-4">
              <img
                src={logo ?? "/icons/default.png"}
                alt="Prévia do logo"
                className="h-16 w-16 rounded-xl object-contain"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{name.trim() || "CRM"}</p>
                <p className="text-xs text-muted-foreground mt-1">PNG, JPG ou WebP, até 5 MB.</p>
              </div>
            </div>
            <Input
              id="crm-brand-logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={!canEdit || busy}
              aria-describedby="crm-logo-help"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                const generation = ++uploadGeneration.current;
                setBusy(true);
                try {
                  const result = await prepareLogo(file);
                  if (generation === uploadGeneration.current) setLogo(result);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Imagem inválida.");
                } finally {
                  setBusy(false);
                }
              }}
            />
            <p id="crm-logo-help" className="text-xs text-muted-foreground">
              Imagem entre 32 e 8192 pixels de lado. O mesmo logo será usado na interface, no
              favicon e no ícone do aplicativo.
            </p>
            {logo && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canEdit || busy}
                onClick={() => setLogo(null)}
              >
                Remover logo
              </Button>
            )}
          </div>
          {status && (
            <p role="status" className="text-sm text-muted-foreground">
              {status}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canEdit || busy || !name.trim()}>
              {busy ? "Aguarde…" : "Salvar identidade"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
