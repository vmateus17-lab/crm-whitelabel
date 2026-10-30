import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useEffectEvent, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  useAuth,
  formatBRL,
  handleBRLInputChange,
  numberToBRLInput,
  formatPhone,
  stripPhone,
  toWhatsAppNumber,
} from "@/lib/auth";
import { cn, getLabelColorClasses } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Edit2, Save, X, Trash2, ArrowRightLeft } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { toast } from "sonner";
import { formatDateTimeBR } from "@/lib/date-format";
import { localToday } from "@/lib/filter-utils";

export const Route = createFileRoute("/_authenticated/leads/$leadId")({
  component: LeadProfilePage,
  head: () => ({ meta: [{ title: "CRM | Lead" }] }),
});

type LeadStage = "novo" | "contatado" | "proposta" | "negociacao" | "ganho" | "perdido";

interface Lead {
  id: string;
  name: string;
  company: string | null;
  contact: string | null;
  whatsapp: string | null;
  stage: LeadStage;
  services: string[];
  estimated_value: number | null;
  notes: string | null;
  source: string | null;
  created_at: string;
  closed_at: string | null;
  converted_client_id?: string | null;
  loss_reason: string | null;
  loss_reason_details: string | null;
}

interface LeadLabel {
  id: string;
  name: string;
  color: string;
}

const STAGE_LABELS: Record<string, string> = {
  novo: "Novo Lead",
  contatado: "Contatado",
  proposta: "Proposta Enviada",
  negociacao: "Negociação",
  ganho: "Ganho",
  perdido: "Perdido",
};

const SERVICES = [
  "Tráfego Pago",
  "Sites/Landing Pages",
  "Social Media/Blogs",
  "Hospedagens",
  "Desenvolvimento",
  "Outros",
];

const LOSS_REASONS = [
  "Preço muito alto",
  "Fechou com concorrente",
  "Sem orçamento no momento",
  "Projeto cancelado",
  "Sem retorno (Ghosting)",
  "Não era o perfil ideal (Fit)",
  "Outro motivo",
];

function LeadProfilePage() {
  const { leadId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [labels, setLabels] = useState<LeadLabel[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Lead>>({});
  const [valueDisplay, setValueDisplay] = useState("");
  const [phoneDisplay, setPhoneDisplay] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"delete" | "convert" | null>(null);

  const load = async () => {
    const [{ data: leadData }, { data: assignsData }, { data: labelsData }] = await Promise.all([
      supabase.from("leads").select("*").eq("id", leadId).single(),
      supabase.from("lead_label_assignments").select("label_id").eq("lead_id", leadId),
      supabase.from("lead_labels").select("*"),
    ]);

    if (leadData) {
      setLead(leadData as Lead);
      setForm(leadData as Lead);
      setValueDisplay(numberToBRLInput((leadData as Lead).estimated_value ?? 0));
      setPhoneDisplay(formatPhone((leadData as Lead).whatsapp ?? ""));
    }
    if (assignsData && labelsData) {
      const assignedIds = assignsData.map((a) => a.label_id);
      const assignedLabels = labelsData.filter((l) => assignedIds.includes(l.id));
      setLabels(assignedLabels as LeadLabel[]);
    }
    setLoading(false);
  };

  const loadForRouteChange = useEffectEvent(load);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadForRouteChange(), 0);
    return () => window.clearTimeout(timer);
  }, [leadId]);

  const handleSave = async () => {
    if (!lead || !user || saving) return;
    if (!form.name?.trim()) {
      toast.error("Informe o nome do lead.");
      return;
    }

    // Validate if lost
    if (form.stage === "perdido" && !form.loss_reason) {
      toast.error("Selecione um motivo para a perda do lead.");
      return;
    }

    const payload = {
      name: form.name.trim(),
      company: form.company ?? null,
      contact: form.contact ?? null,
      whatsapp: form.whatsapp ?? null,
      stage: form.stage ?? "novo",
      services: form.services ?? [],
      estimated_value: form.estimated_value ?? 0,
      notes: form.notes ?? null,
      source: form.source ?? null,
      loss_reason: form.stage === "perdido" ? form.loss_reason : null,
      loss_reason_details: form.stage === "perdido" ? form.loss_reason_details : null,
      closed_at: ["ganho", "perdido"].includes(form.stage ?? lead.stage)
        ? (form.stage ?? lead.stage) === lead.stage
          ? (lead.closed_at ?? new Date().toISOString())
          : new Date().toISOString()
        : null,
    };

    setSaving(true);
    const { error } = await supabase
      .from("leads")
      .update(payload)
      .eq("id", lead.id)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .select("id")
      .single();
    setSaving(false);
    if (error) {
      toast.error("Não foi possível salvar o lead: " + error.message);
      return;
    }
    toast.success("Lead atualizado");
    setEditing(false);
    load();
  };

  const handleDelete = async () => {
    if (!user || saving) return;
    setSaving(true);
    const { error } = await supabase
      .from("leads")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", leadId)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .select("id")
      .single();
    setSaving(false);
    if (error) {
      toast.error("Erro ao deletar lead.");
      return;
    }
    toast.success("Lead movido para lixeira");
    navigate({ to: "/leads" });
  };

  const convertToClient = async () => {
    if (!user || !lead || saving) return;
    setSaving(true);
    const { error } = await (supabase as SupabaseClient).rpc("close_won_lead", {
      p_lead_id: lead.id,
      p_convert_client: true,
      p_create_payment: false,
      p_payment_amount: 0,
      p_payment_description: null,
      p_paid_at: localToday(),
      p_monthly_value: 0,
    });
    setSaving(false);

    if (error) {
      toast.error("Erro ao converter lead: " + error.message);
      return;
    }
    toast.success(`"${lead.name}" convertido para cliente!`);

    navigate({ to: "/clientes" });
  };

  const toggleService = (svc: string) => {
    const cur = form.services ?? [];
    setForm({
      ...form,
      services: cur.includes(svc) ? cur.filter((s) => s !== svc) : [...cur, svc],
    });
  };

  if (loading)
    return (
      <div className="page-shell space-y-6" aria-label="Carregando lead">
        <Skeleton className="h-5 w-32" />
        <div className="space-y-3">
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="h-5 w-44 max-w-full" />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 rounded-2xl lg:col-span-2" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    );

  if (!lead)
    return (
      <div className="page-shell">
        <Card className="mx-auto max-w-lg p-8 text-center shadow-none">
          <h1 className="text-xl font-semibold">Lead não encontrado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Este lead pode ter sido removido ou você não tem acesso a ele.
          </p>
          <Button asChild className="mt-6">
            <Link to="/leads">Voltar para leads</Link>
          </Button>
        </Card>
      </div>
    );

  return (
    <div className="page-shell">
      {/* Back button + header */}
      <div className="mb-6">
        <Link
          to="/leads"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar para leads
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{lead.name}</h1>
              <Badge
                variant={
                  lead.stage === "ganho"
                    ? "default"
                    : lead.stage === "perdido"
                      ? "destructive"
                      : "secondary"
                }
              >
                {STAGE_LABELS[lead.stage] || lead.stage}
              </Badge>
            </div>
            {lead.company && <p className="text-sm text-muted-foreground mt-1">{lead.company}</p>}
            <p className="text-xs text-muted-foreground mt-1">
              Criado em {formatDateTimeBR(lead.created_at)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {lead.whatsapp && (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`https://wa.me/${toWhatsAppNumber(lead.whatsapp)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FaWhatsapp className="h-4 w-4 mr-2" /> WhatsApp
                </a>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmAction("convert")}
              disabled={saving}
              className="text-primary hover:text-primary"
            >
              <ArrowRightLeft className="h-4 w-4 mr-2" /> Converter em Cliente
            </Button>
            {!editing ? (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Edit2 className="h-4 w-4 mr-2" /> Editar
              </Button>
            ) : (
              <Button variant="default" size="sm" onClick={handleSave} disabled={saving}>
                <Save className="h-4 w-4 mr-2" /> {saving ? "Salvando..." : "Salvar"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Etiquetas e Motivo de perda (Visualização) */}
      {!editing && (labels.length > 0 || lead.stage === "perdido") && (
        <div className="mb-6 flex flex-col gap-3">
          {labels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {labels.map((lbl) => {
                const theme = getLabelColorClasses(lbl.color);
                return (
                  <span
                    key={lbl.id}
                    className={cn(
                      "px-2 py-1 rounded text-xs font-medium uppercase tracking-wider",
                      theme.light,
                    )}
                  >
                    {lbl.name}
                  </span>
                );
              })}
            </div>
          )}

          {lead.stage === "perdido" && lead.loss_reason && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-sm text-destructive mt-2">
              <div className="font-semibold mb-1">Motivo da perda: {lead.loss_reason}</div>
              {lead.loss_reason_details && (
                <div className="opacity-90">{lead.loss_reason_details}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
        <div className="space-y-4 lg:col-span-2 lg:space-y-6">
          {/* Dados Pessoais / Editar */}
          {editing ? (
            <div className="bg-card border border-border rounded-xl p-4 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Editar Lead</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(false);
                    setForm(lead);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Nome</Label>
                  <Input
                    value={form.name ?? ""}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Empresa</Label>
                  <Input
                    value={form.company ?? ""}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>E-mail</Label>
                  <Input
                    value={form.contact ?? ""}
                    onChange={(e) => setForm({ ...form, contact: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>WhatsApp</Label>
                  <Input
                    value={phoneDisplay}
                    onChange={(e) => {
                      const formatted = formatPhone(e.target.value);
                      setPhoneDisplay(formatted);
                      setForm({ ...form, whatsapp: stripPhone(e.target.value) });
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Valor Estimado (R$)</Label>
                  <Input
                    value={valueDisplay}
                    onChange={(e) => {
                      const { display, numeric } = handleBRLInputChange(e.target.value);
                      setValueDisplay(display);
                      setForm({ ...form, estimated_value: numeric });
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-2">Estágio</Label>
                  <Select
                    value={form.stage ?? "novo"}
                    onValueChange={(v) => setForm({ ...form, stage: v as LeadStage })}
                  >
                    <SelectTrigger
                      className={cn(
                        form.stage === "perdido" && "border-destructive text-destructive",
                      )}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(STAGE_LABELS).map(([k, l]) => (
                        <SelectItem key={k} value={k}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Origem</Label>
                  <Select
                    value={form.source ?? ""}
                    onValueChange={(val) => setForm({ ...form, source: val })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Instagram">Instagram</SelectItem>
                      <SelectItem value="Meta Ads">Meta Ads</SelectItem>
                      <SelectItem value="Google Ads">Google Ads</SelectItem>
                      <SelectItem value="TikTok">TikTok</SelectItem>
                      <SelectItem value="LinkedIn">LinkedIn</SelectItem>
                      <SelectItem value="Busca Orgânica">Busca Orgânica</SelectItem>
                      <SelectItem value="Indicação">Indicação</SelectItem>
                      <SelectItem value="Parceria Comercial">Parceria Comercial</SelectItem>
                      <SelectItem value="Prospecção Ativa">Prospecção Ativa</SelectItem>
                      <SelectItem value="Outro">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {form.stage === "perdido" && (
                <div className="bg-destructive/5 p-4 rounded-lg border border-destructive/20 space-y-4 mt-2">
                  <h4 className="font-medium text-sm text-destructive">Detalhes da Perda</h4>
                  <div className="space-y-1.5">
                    <Label className="text-destructive">Motivo Principal *</Label>
                    <Select
                      value={form.loss_reason ?? ""}
                      onValueChange={(v) => setForm({ ...form, loss_reason: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o motivo..." />
                      </SelectTrigger>
                      <SelectContent>
                        {LOSS_REASONS.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-destructive">Observações (Opcional)</Label>
                    <Textarea
                      rows={2}
                      value={form.loss_reason_details ?? ""}
                      onChange={(e) => setForm({ ...form, loss_reason_details: e.target.value })}
                      placeholder="Explique com mais detalhes por que o lead foi perdido..."
                    />
                  </div>
                </div>
              )}

              <div>
                <Label>Serviços Interessados</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {SERVICES.map((s) => {
                    const active = (form.services ?? []).includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleService(s)}
                        className={`px-3 py-1 rounded-full text-xs border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl p-4 sm:p-6 space-y-6">
              <h3 className="font-medium border-b border-border pb-2">Informações de Contato</h3>
              <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <div>
                  <div className="text-muted-foreground mb-1">E-mail</div>
                  <div>{lead.contact || "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">WhatsApp</div>
                  <div>{lead.whatsapp ? formatPhone(lead.whatsapp) : "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Valor Estimado</div>
                  <div>{formatBRL(lead.estimated_value ?? 0)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Origem</div>
                  <div>{lead.source || "—"}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-muted-foreground mb-1">Serviços</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {lead.services?.length
                      ? lead.services.map((s) => (
                          <Badge key={s} variant="outline" className="text-xs font-normal">
                            {s}
                          </Badge>
                        ))
                      : "—"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Anotações */}
          <div className="bg-card border border-border rounded-xl p-4 sm:p-6">
            <h3 className="font-medium border-b border-border pb-2 mb-4">Anotações Internas</h3>
            {editing ? (
              <Textarea
                rows={6}
                value={form.notes ?? ""}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Reuniões, detalhes do projeto..."
              />
            ) : (
              <div className="text-sm whitespace-pre-wrap">
                {lead.notes || (
                  <span className="text-muted-foreground italic">Nenhuma anotação registrada.</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Direita */}
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-medium text-sm mb-4">Ações</h3>
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmAction("delete")}
                disabled={saving}
              >
                <Trash2 className="h-4 w-4 mr-2" /> Mover para Lixeira
              </Button>
            </div>
          </div>
        </div>
      </div>
      <Dialog
        open={Boolean(confirmAction)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !saving) setConfirmAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmAction === "delete" ? "Mover lead para a lixeira?" : "Converter em cliente?"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmAction === "delete"
              ? "O lead sai das listas e pode ser restaurado nas Configurações."
              : "O lead será marcado como ganho e vinculado a um cliente. O valor estimado da venda não vira recorrência: configure os serviços recorrentes no cadastro do cliente."}
          </p>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setConfirmAction(null)}>
              Cancelar
            </Button>
            <Button
              variant={confirmAction === "delete" ? "destructive" : "default"}
              disabled={saving}
              onClick={() => void (confirmAction === "delete" ? handleDelete() : convertToClient())}
            >
              {saving
                ? "Processando..."
                : confirmAction === "delete"
                  ? "Mover para a lixeira"
                  : "Converter em cliente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
