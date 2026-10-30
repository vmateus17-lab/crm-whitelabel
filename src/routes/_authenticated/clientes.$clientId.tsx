import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL, toWhatsAppNumber } from "@/lib/auth";
import { formatDateBR } from "@/lib/date-format";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Receipt, Edit2, Save, X } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { toast } from "sonner";
import { fetchAllRows } from "@/lib/query-pagination";
import { safeExternalUrl } from "@/lib/security";
import { RecurringServicesEditor } from "@/components/RecurringServicesEditor";
import {
  type ClientRecurringService,
  recurringCycle,
  recurringTotals,
  recurringScheduleLabel,
  buildClientRecurringItems,
} from "@/lib/recurring-services";

export const Route = createFileRoute("/_authenticated/clientes/$clientId")({
  component: ClientProfilePage,
  head: () => ({ meta: [{ title: "CRM | Cliente" }] }),
});

type ClientStatus = "ativo" | "pausado" | "ex_cliente";
type PaymentStatus = "pendente" | "pago" | "atrasado";

interface Client {
  id: string;
  name: string;
  company: string | null;
  contact: string | null;
  whatsapp: string | null;
  status: ClientStatus;
  services: string[];
  whatsapp_log: string | null;
  folder_links: string[];
  monthly_value: number | null;
  client_recurring_services: ClientRecurringService[];
  notes: string | null;
  source: string | null;
  created_at: string;
}

interface Payment {
  id: string;
  description: string;
  amount: number;
  due_date: string;
  paid_at: string | null;
  status: PaymentStatus;
}

const STATUS_LABEL: Record<ClientStatus, string> = {
  ativo: "Ativo",
  pausado: "Pausado",
  ex_cliente: "Ex-cliente",
};
const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pendente: "Pendente",
  pago: "Pago",
  atrasado: "Atrasado",
};
const SERVICES = ["Tráfego Pago", "Landing Pages", "CRM", "SEO", "Social Media", "Branding"];

function ClientProfilePage() {
  const { clientId } = Route.useParams();
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Client>>({});
  const [folderText, setFolderText] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [{ data: clientData, error: clientError }, payData] = await Promise.all([
        supabase
          .from("clients")
          .select("*,client_recurring_services(*)")
          .eq("id", clientId)
          .single(),
        fetchAllRows<Payment>(
          () =>
            supabase
              .from("payments")
              .select("*", { count: "exact" })
              .eq("client_id", clientId)
              .order("due_date", { ascending: false })
              .order("id"),
          "recebimentos do cliente",
        ),
      ]);
      if (clientError) throw clientError;
      if (clientData) {
        const nextClient = {
          ...(clientData as Client),
          client_recurring_services: [
            ...((clientData as Client).client_recurring_services ?? []),
          ].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
        };
        setClient(nextClient);
        setForm(nextClient);
        setFolderText(nextClient.folder_links?.join("\n") ?? "");
      } else setClient(null);
      setPayments((payData ?? []) as Payment[]);
    } catch {
      setLoadError("Não foi possível carregar o cliente e todos os recebimentos. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const loadForRouteChange = useEffectEvent(load);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadForRouteChange(), 0);
    return () => window.clearTimeout(timer);
  }, [clientId]);

  const saveClient = async () => {
    if (!client) return;
    const requestedLinks = folderText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const safeLinks = requestedLinks
      .map(safeExternalUrl)
      .filter((link): link is string => Boolean(link));
    if (safeLinks.length !== requestedLinks.length) {
      toast.error("Use apenas links HTTPS válidos.");
      return;
    }

    const payload = {
      name: form.name!,
      company: form.company ?? null,
      contact: form.contact ?? null,
      whatsapp: form.whatsapp ?? null,
      status: form.status ?? "ativo",
      services: form.services ?? [],
      whatsapp_log: form.whatsapp_log ?? null,
      folder_links: safeLinks,
      notes: form.notes ?? null,
      source: form.source ?? null,
    };
    let recurringItems;
    try {
      recurringItems = buildClientRecurringItems(form.client_recurring_services ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Recorrências inválidas.");
      return;
    }
    const { error } = await supabase.rpc("save_client_with_billing_cycles", {
      p_client_id: client.id,
      p_client: payload,
      p_items: recurringItems,
    });
    if (error) {
      toast.error("Não foi possível atualizar o cliente: " + error.message);
      return;
    }
    toast.success("Cliente atualizado");
    setEditing(false);
    load();
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await saveClient();
    } catch {
      toast.error("Não foi possível salvar o cliente. Tente novamente.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const toggleService = (svc: string) => {
    const cur = form.services ?? [];
    setForm({
      ...form,
      services: cur.includes(svc) ? cur.filter((s) => s !== svc) : [...cur, svc],
    });
  };

  const totalPaid = payments
    .filter((p) => p.status === "pago")
    .reduce((s, p) => s + Number(p.amount), 0);
  const totalPending = payments
    .filter((p) => p.status !== "pago")
    .reduce((s, p) => s + Number(p.amount), 0);

  if (loading)
    return (
      <div className="page-shell space-y-6" aria-label="Carregando cliente">
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

  if (loadError)
    return (
      <div className="page-shell">
        <PageHeader title="Cliente" />
        <p role="alert" className="text-destructive">
          {loadError}
        </p>
        <Button variant="outline" className="mt-4" onClick={() => void load()}>
          Tentar novamente
        </Button>
      </div>
    );

  if (!client)
    return (
      <div className="page-shell">
        <Card className="mx-auto max-w-lg p-8 text-center shadow-none">
          <h1 className="text-xl font-semibold">Cliente não encontrado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Este cliente pode ter sido removido ou você não tem acesso a ele.
          </p>
          <Button asChild className="mt-6">
            <Link to="/clientes">Voltar para clientes</Link>
          </Button>
        </Card>
      </div>
    );

  return (
    <div className="page-shell">
      {/* Back button + header */}
      <div className="mb-6">
        <Link
          to="/clientes"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar para clientes
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
              <Badge
                variant={
                  client.status === "ativo"
                    ? "default"
                    : client.status === "pausado"
                      ? "secondary"
                      : "outline"
                }
              >
                {STATUS_LABEL[client.status]}
              </Badge>
            </div>
            {client.company && (
              <p className="text-sm text-muted-foreground mt-1">{client.company}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Cliente desde {formatDateBR(client.created_at)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {client.whatsapp && (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`https://wa.me/${toWhatsAppNumber(client.whatsapp)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FaWhatsapp className="h-4 w-4 mr-2" /> WhatsApp
                </a>
              </Button>
            )}
            {!editing ? (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Edit2 className="h-4 w-4 mr-2" /> Editar
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setEditing(false);
                    setForm(client);
                    setFolderText(client.folder_links?.join("\n") ?? "");
                  }}
                >
                  <X className="h-4 w-4 mr-2" /> Cancelar
                </Button>
                <Button size="sm" disabled={saving} onClick={() => void handleSave()}>
                  <Save className="h-4 w-4 mr-2" /> {saving ? "Salvando..." : "Salvar"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Contact info */}
          <Card className="p-5 border-border shadow-none">
            <h2 className="text-sm font-semibold mb-4">Informações de contato</h2>
            {editing ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Nome</Label>
                    <Input
                      value={form.name ?? ""}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Empresa</Label>
                    <Input
                      value={form.company ?? ""}
                      onChange={(e) => setForm({ ...form, company: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <Label>E-mail</Label>
                    <Input
                      value={form.contact ?? ""}
                      onChange={(e) => setForm({ ...form, contact: e.target.value })}
                      placeholder="email@exemplo.com"
                    />
                  </div>
                  <div>
                    <Label>WhatsApp</Label>
                    <Input
                      value={form.whatsapp ?? ""}
                      onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Status</Label>
                    <Select
                      value={form.status ?? "ativo"}
                      onValueChange={(v) => setForm({ ...form, status: v as ClientStatus })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ativo">Ativo</SelectItem>
                        <SelectItem value="pausado">Pausado</SelectItem>
                        <SelectItem value="ex_cliente">Ex-cliente</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
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
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <span className="text-muted-foreground">E-mail:</span> {client.contact || "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">WhatsApp:</span> {client.whatsapp || "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">Origem:</span> {client.source || "—"}
                </div>
              </div>
            )}
          </Card>

          <Card className="p-5 border-border shadow-none">
            {editing ? (
              <RecurringServicesEditor
                items={form.client_recurring_services ?? []}
                onChange={(client_recurring_services) =>
                  setForm({ ...form, client_recurring_services })
                }
              />
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold">Valores recorrentes</h2>
                  <strong className="text-sm tabular-nums">
                    MRR {formatBRL(recurringTotals(client.client_recurring_services).monthly)}
                  </strong>
                </div>
                <p className="mb-4 text-xs text-muted-foreground">
                  Cobranças: {formatBRL(recurringTotals(client.client_recurring_services).monthly)}
                  /mês · {formatBRL(recurringTotals(client.client_recurring_services).annual)}/ano
                </p>
                <div className="space-y-2">
                  {client.client_recurring_services.length === 0 && (
                    <span className="text-sm text-muted-foreground">
                      Nenhum valor recorrente cadastrado.
                    </span>
                  )}
                  {client.client_recurring_services.map((recurring) => (
                    <div
                      key={recurring.id}
                      className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{recurring.service_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {recurringScheduleLabel(recurring)}
                          {!recurring.active && " · Inativo"}
                        </p>
                      </div>
                      <span className="shrink-0 tabular-nums font-medium">
                        {formatBRL(recurring.amount)}
                        <span className="text-xs text-muted-foreground">
                          /{recurringCycle(recurring) === "annual" ? "ano" : "mês"}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>

          {/* Services */}
          <Card className="p-5 border-border shadow-none">
            <h2 className="text-sm font-semibold mb-4">Serviços contratados</h2>
            {editing ? (
              <div className="flex flex-wrap gap-2">
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
            ) : (
              <div className="flex flex-wrap gap-2">
                {client.services.length === 0 && (
                  <span className="text-sm text-muted-foreground">Nenhum serviço cadastrado.</span>
                )}
                {client.services.map((s) => (
                  <Badge key={s} variant="outline" className="font-normal">
                    {s}
                  </Badge>
                ))}
              </div>
            )}
          </Card>

          {/* WhatsApp log / Notes */}
          <Card className="p-5 border-border shadow-none">
            <h2 className="text-sm font-semibold mb-4">Anotações e histórico</h2>
            {editing ? (
              <div className="space-y-3">
                <div>
                  <Label>Histórico WhatsApp / Anotações</Label>
                  <Textarea
                    rows={6}
                    value={form.whatsapp_log ?? ""}
                    onChange={(e) => setForm({ ...form, whatsapp_log: e.target.value })}
                    placeholder="Cole conversas, links, contexto..."
                  />
                </div>
                <div>
                  <Label>Links de pastas/trabalhos (um por linha)</Label>
                  <Textarea
                    rows={3}
                    value={folderText}
                    onChange={(e) => {
                      setFolderText(e.target.value);
                    }}
                    placeholder="https://drive.google.com/..."
                  />
                </div>
                <div>
                  <Label>Observações gerais</Label>
                  <Textarea
                    rows={3}
                    value={form.notes ?? ""}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4 text-sm">
                {client.whatsapp_log && (
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                      Histórico
                    </div>
                    <p className="whitespace-pre-wrap text-muted-foreground">
                      {client.whatsapp_log}
                    </p>
                  </div>
                )}
                {client.notes && (
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                      Observações
                    </div>
                    <p className="whitespace-pre-wrap text-muted-foreground">{client.notes}</p>
                  </div>
                )}
                {client.folder_links.length > 0 && (
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                      Links
                    </div>
                    <div className="space-y-1">
                      {client.folder_links.map((link, i) => {
                        const safeLink = safeExternalUrl(link);
                        return safeLink ? (
                          <a
                            key={i}
                            href={safeLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-sm text-primary hover:underline truncate"
                          >
                            {link}
                          </a>
                        ) : (
                          <span
                            key={i}
                            className="block text-sm text-muted-foreground truncate"
                            title="Link inválido ou inseguro"
                          >
                            {link}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
                {!client.whatsapp_log && !client.notes && client.folder_links.length === 0 && (
                  <p className="text-muted-foreground">Nenhuma anotação ainda.</p>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Sidebar: Financial summary + recent payments */}
        <div className="space-y-6">
          <Card className="p-5 border-border shadow-none">
            <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Receipt className="h-4 w-4" /> Resumo financeiro
            </h2>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total pago</span>
                <span className="font-medium tabular-nums">{formatBRL(totalPaid)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Pendente / Atrasado</span>
                <span className="font-medium tabular-nums text-destructive">
                  {formatBRL(totalPending)}
                </span>
              </div>
              <div className="flex justify-between text-sm border-t border-border pt-2">
                <span className="text-muted-foreground">Total geral</span>
                <span className="font-semibold tabular-nums">
                  {formatBRL(totalPaid + totalPending)}
                </span>
              </div>
            </div>
          </Card>

          <Card className="p-5 border-border shadow-none">
            <h2 className="text-sm font-semibold mb-4">Últimos lançamentos</h2>
            {payments.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum lançamento.</p>
            )}
            <div className="space-y-2">
              {payments.slice(0, 10).map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm">{p.description}</div>
                    <div className="text-xs text-muted-foreground">{formatDateBR(p.due_date)}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <Badge
                      variant={
                        p.status === "pago"
                          ? "default"
                          : p.status === "atrasado"
                            ? "destructive"
                            : "secondary"
                      }
                      className="text-[10px]"
                    >
                      {PAYMENT_STATUS_LABEL[p.status]}
                    </Badge>
                    <span className="tabular-nums text-sm font-medium">{formatBRL(p.amount)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
