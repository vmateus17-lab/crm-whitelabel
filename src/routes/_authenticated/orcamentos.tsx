import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { FileDown, FileText, Plus, Search, Settings2, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/AppLayout";
import { FilterBar, FilterPeriod, FilterSelect } from "@/components/FilterBar";
import { filterChips } from "@/lib/filter-utils";
import { useListFilters } from "@/lib/list-filters";
import { dateInRange, localToday, matchesDateShortcut } from "@/lib/filter-utils";
import { shiftDate } from "@/lib/filter-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CrmDatePicker } from "@/components/CrmDatePicker";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL, handleBRLInputChange, numberToBRLInput, useAuth } from "@/lib/auth";
import { createQuotePdf, type QuotePdfProfile } from "@/lib/quote-pdf";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/orcamentos")({
  component: QuotesPage,
  head: () => ({ meta: [{ title: "CRM | Orçamentos" }] }),
});

type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";

interface QuoteItem {
  id?: string;
  localId: string;
  description: string;
  quantity: number;
  unit_price: number;
}

interface Quote {
  id: string;
  quote_number: number;
  lead_id: string | null;
  client_id: string | null;
  recipient_name: string;
  recipient_company: string | null;
  recipient_email: string | null;
  recipient_phone: string | null;
  status: QuoteStatus;
  issue_date: string;
  valid_until: string | null;
  payment_terms: string | null;
  delivery_terms: string | null;
  scope: string | null;
  notes: string | null;
  subtotal: number;
  discount: number;
  total: number;
  pdf_path: string | null;
  created_at: string;
  quote_items: Array<Omit<QuoteItem, "localId"> & { id: string; position: number }>;
}

interface PersonOption {
  id: string;
  name: string;
  company: string | null;
  contact: string | null;
  whatsapp: string | null;
}

interface BusinessProfile extends QuotePdfProfile {
  user_id?: string;
}

interface QuoteForm {
  lead_id: string | null;
  client_id: string | null;
  recipient_name: string;
  recipient_company: string;
  recipient_email: string;
  recipient_phone: string;
  issue_date: string;
  valid_until: string;
  payment_terms: string;
  delivery_terms: string;
  scope: string;
  notes: string;
  discount: number;
  items: QuoteItem[];
}

const STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Rascunho",
  sent: "Enviado",
  accepted: "Aceito",
  rejected: "Recusado",
  expired: "Expirado",
};

const STATUS_STYLE: Record<QuoteStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  accepted: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  rejected: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  expired: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
};

const today = () => localToday();
const plusDays = (days: number) => shiftDate(localToday(), days);
const QUOTE_FILTERS = {
  search: "",
  status: "all",
  client: "all",
  validity: "all",
  from: "",
  to: "",
};
const newItem = (): QuoteItem => ({
  localId: crypto.randomUUID(),
  description: "",
  quantity: 1,
  unit_price: 0,
});
const emptyForm = (): QuoteForm => ({
  lead_id: null,
  client_id: null,
  recipient_name: "",
  recipient_company: "",
  recipient_email: "",
  recipient_phone: "",
  issue_date: today(),
  valid_until: plusDays(15),
  payment_terms: "",
  delivery_terms: "",
  scope: "",
  notes: "",
  discount: 0,
  items: [newItem()],
});

function QuotesPage() {
  const { user } = useAuth();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [clients, setClients] = useState<PersonOption[]>([]);
  const [leads, setLeads] = useState<PersonOption[]>([]);
  const [profile, setProfile] = useState<BusinessProfile>({
    business_name: "",
    accent_color: "#171717",
  });
  const views = useListFilters(QUOTE_FILTERS, "quotes", user?.id, {
    status: ["all", ...Object.keys(STATUS_LABEL)],
    validity: ["all", "overdue", "next7", "none"],
  });
  const { filters } = views;
  const search = filters.search;
  const statusFilter = filters.status;
  const [editorOpen, setEditorOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editing, setEditing] = useState<Quote | null>(null);
  const [form, setForm] = useState<QuoteForm>(emptyForm);
  const [discountDisplay, setDiscountDisplay] = useState("0,00");
  const [saving, setSaving] = useState(false);
  const [generatingPdfId, setGeneratingPdfId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Quote | null>(null);
  const [deletingQuoteId, setDeletingQuoteId] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) return;
    const api = supabase as SupabaseClient;
    const [
      { data: quoteRows, error },
      { data: clientRows },
      { data: leadRows },
      { data: profileRow },
    ] = await Promise.all([
      api.from("quotes").select("*,quote_items(*)").order("created_at", { ascending: false }),
      supabase.from("clients").select("id,name,company,contact,whatsapp").order("name"),
      supabase
        .from("leads")
        .select("id,name,company,contact,whatsapp")
        .is("deleted_at", null)
        .order("name"),
      api.from("business_profiles").select("*").maybeSingle(),
    ]);
    if (error) toast.error("Não foi possível carregar os orçamentos: " + error.message);
    setQuotes(
      (quoteRows ?? []).map((quote: Quote) => ({
        ...quote,
        quote_items: [...(quote.quote_items ?? [])].sort((a, b) => a.position - b.position),
      })),
    );
    setClients((clientRows ?? []) as PersonOption[]);
    setLeads((leadRows ?? []) as PersonOption[]);
    if (profileRow) setProfile(profileRow as BusinessProfile);
    else
      setProfile({
        business_name: user.user_metadata?.name || "",
        email: user.email ?? "",
        accent_color: "#171717",
      });
    setLoading(false);
  };

  const loadForUser = useEffectEvent(load);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadForUser(), 0);
    return () => window.clearTimeout(timer);
  }, [user?.id]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return quotes.filter(
      (quote) =>
        (statusFilter === "all" || quote.status === statusFilter) &&
        (filters.client === "all" || quote.client_id === filters.client) &&
        dateInRange(quote.issue_date, filters.from, filters.to) &&
        matchesDateShortcut(
          quote.valid_until,
          filters.validity,
          ["accepted", "rejected"].includes(quote.status),
        ) &&
        (!query ||
          quote.recipient_name.toLowerCase().includes(query) ||
          quote.recipient_company?.toLowerCase().includes(query) ||
          quoteCode(quote).toLowerCase().includes(query)),
    );
  }, [quotes, search, statusFilter, filters]);

  const subtotal = useMemo(
    () => form.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0),
    [form.items],
  );
  const total = Math.max(0, subtotal - form.discount);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm());
    setDiscountDisplay(numberToBRLInput(0));
    setEditorOpen(true);
  };

  const openEdit = (quote: Quote) => {
    setEditing(quote);
    setForm({
      lead_id: quote.lead_id,
      client_id: quote.client_id,
      recipient_name: quote.recipient_name,
      recipient_company: quote.recipient_company ?? "",
      recipient_email: quote.recipient_email ?? "",
      recipient_phone: quote.recipient_phone ?? "",
      issue_date: quote.issue_date,
      valid_until: quote.valid_until ?? "",
      payment_terms: quote.payment_terms ?? "",
      delivery_terms: quote.delivery_terms ?? "",
      scope: quote.scope ?? "",
      notes: quote.notes ?? "",
      discount: Number(quote.discount),
      items: quote.quote_items.map((item) => ({ ...item, localId: item.id })),
    });
    setDiscountDisplay(numberToBRLInput(Number(quote.discount)));
    setEditorOpen(true);
  };

  const applyPerson = (value: string) => {
    if (value === "manual") {
      setForm((current) => ({ ...current, lead_id: null, client_id: null }));
      return;
    }
    const [kind, id] = value.split(":");
    const person = (kind === "client" ? clients : leads).find((item) => item.id === id);
    if (!person) return;
    setForm((current) => ({
      ...current,
      client_id: kind === "client" ? id : null,
      lead_id: kind === "lead" ? id : null,
      recipient_name: person.name,
      recipient_company: person.company ?? "",
      recipient_email: person.contact ?? "",
      recipient_phone: person.whatsapp ?? "",
    }));
  };

  const saveQuote = async () => {
    if (!user || !form.recipient_name.trim()) {
      toast.error("Informe o nome do destinatário.");
      return;
    }
    const validItems = form.items.filter((item) => item.description.trim() && item.quantity > 0);
    if (validItems.length === 0) {
      toast.error("Adicione pelo menos um item válido.");
      return;
    }
    setSaving(true);
    const api = supabase as SupabaseClient;
    const payload = {
      user_id: user.id,
      lead_id: form.lead_id,
      client_id: form.client_id,
      recipient_name: form.recipient_name.trim(),
      recipient_company: form.recipient_company.trim() || null,
      recipient_email: form.recipient_email.trim() || null,
      recipient_phone: form.recipient_phone.trim() || null,
      issue_date: form.issue_date,
      valid_until: form.valid_until || null,
      payment_terms: form.payment_terms.trim() || null,
      delivery_terms: form.delivery_terms.trim() || null,
      scope: form.scope.trim() || null,
      notes: form.notes.trim() || null,
      subtotal,
      discount: form.discount,
      total,
    };
    let quoteId = editing?.id;
    if (editing) {
      const { error } = await api.from("quotes").update(payload).eq("id", editing.id);
      if (error) {
        toast.error("Erro ao salvar: " + error.message);
        setSaving(false);
        return;
      }
    } else {
      const { data, error } = await api
        .from("quotes")
        .insert({ ...payload, quote_number: 0 })
        .select("id")
        .single();
      if (error) {
        toast.error("Erro ao criar: " + error.message);
        setSaving(false);
        return;
      }
      quoteId = data.id;
    }

    const retainedIds = new Set(validItems.flatMap((item) => (item.id ? [item.id] : [])));
    for (const oldItem of editing?.quote_items ?? []) {
      if (!retainedIds.has(oldItem.id)) await api.from("quote_items").delete().eq("id", oldItem.id);
    }
    for (let position = 0; position < validItems.length; position += 1) {
      const item = validItems[position];
      const itemPayload = {
        user_id: user.id,
        quote_id: quoteId,
        description: item.description.trim(),
        quantity: item.quantity,
        unit_price: item.unit_price,
        position,
      };
      const result = item.id
        ? await api.from("quote_items").update(itemPayload).eq("id", item.id)
        : await api.from("quote_items").insert(itemPayload);
      if (result.error) {
        toast.error("O orçamento foi salvo, mas um item falhou: " + result.error.message);
        setSaving(false);
        return;
      }
    }
    toast.success(editing ? "Orçamento atualizado." : "Orçamento criado.");
    setSaving(false);
    setEditorOpen(false);
    await load();
  };

  const updateStatus = async (quote: Quote, status: QuoteStatus) => {
    const timestamp = new Date().toISOString();
    const payload: Record<string, string | null> = { status };
    if (status === "sent") payload.sent_at = timestamp;
    if (status === "accepted") payload.accepted_at = timestamp;
    if (status === "rejected") payload.rejected_at = timestamp;
    const { error } = await (supabase as SupabaseClient)
      .from("quotes")
      .update(payload)
      .eq("id", quote.id);
    if (error) toast.error("Erro ao atualizar status: " + error.message);
    else await load();
  };

  const saveProfile = async () => {
    if (!user || !profile.business_name.trim()) {
      toast.error("Informe o nome da empresa.");
      return;
    }
    const { error } = await (supabase as SupabaseClient)
      .from("business_profiles")
      .upsert({ ...profile, user_id: user.id }, { onConflict: "user_id" });
    if (error) toast.error("Erro ao salvar dados da empresa: " + error.message);
    else {
      toast.success("Dados da empresa salvos.");
      setProfileOpen(false);
      await load();
    }
  };

  const uploadLogo = async (file: File) => {
    if (!user) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 2 * 1024 * 1024) {
      toast.error("Use uma imagem PNG ou JPG de até 2 MB.");
      return;
    }
    setUploadingLogo(true);
    const extension = file.type === "image/png" ? "png" : "jpg";
    const path = `${user.id}/logo.${extension}`;
    const { error } = await supabase.storage
      .from("business-assets")
      .upload(path, file, { contentType: file.type, upsert: true });
    setUploadingLogo(false);
    if (error) toast.error("Erro ao enviar logo: " + error.message);
    else {
      setProfile((current) => ({ ...current, logo_path: path }));
      toast.success("Logo enviada. Salve os dados da empresa para confirmar.");
    }
  };

  const downloadPdf = async (quote: Quote) => {
    if (!user) return;
    if (!profile.business_name.trim()) {
      toast.error("Configure os dados da empresa antes de gerar o PDF.");
      setProfileOpen(true);
      return;
    }
    setGeneratingPdfId(quote.id);
    try {
      let logoBytes: Uint8Array | null = null;
      if (profile.logo_path) {
        const { data: logoFile } = await supabase.storage
          .from("business-assets")
          .download(profile.logo_path);
        if (logoFile) logoBytes = new Uint8Array(await logoFile.arrayBuffer());
      }
      const bytes = await createQuotePdf(
        { ...profile, logo_bytes: logoBytes },
        {
          ...quote,
          items: quote.quote_items.map((item) => ({
            description: item.description,
            quantity: Number(item.quantity),
            unit_price: Number(item.unit_price),
          })),
        },
      );
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const filename = `${quoteCode(quote)}-${safeFilename(quote.recipient_name)}.pdf`;
      const path = `${user.id}/${quote.id}/${filename}`;
      const { error: uploadError } = await supabase.storage
        .from("quote-pdfs")
        .upload(path, blob, { contentType: "application/pdf", upsert: true });
      if (uploadError) throw uploadError;
      await (supabase as SupabaseClient)
        .from("quotes")
        .update({ pdf_path: path })
        .eq("id", quote.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("PDF gerado e armazenado com segurança.");
      await load();
    } catch (error) {
      toast.error(
        "Não foi possível gerar o PDF: " +
          (error instanceof Error ? error.message : "erro desconhecido"),
      );
    } finally {
      setGeneratingPdfId(null);
    }
  };

  const deleteQuote = async () => {
    if (!deleteCandidate) return;
    const quote = deleteCandidate;
    setDeletingQuoteId(quote.id);
    try {
      const { error } = await (supabase as SupabaseClient)
        .from("quotes")
        .delete()
        .eq("id", quote.id);
      if (error) throw error;

      if (quote.pdf_path) {
        const { error: storageError } = await supabase.storage
          .from("quote-pdfs")
          .remove([quote.pdf_path]);
        if (storageError)
          console.error("Failed to remove quote PDF after deleting quote", storageError);
      }

      toast.success("Orçamento excluído definitivamente.");
      setDeleteCandidate(null);
      await load();
    } catch (error) {
      toast.error(
        "Não foi possível excluir o orçamento: " +
          (error instanceof Error ? error.message : "erro desconhecido"),
      );
    } finally {
      setDeletingQuoteId(null);
    }
  };

  if (loading) {
    return (
      <div className="page-shell" aria-busy="true">
        <PageHeader title="Orçamentos" description="Carregando propostas comerciais" />
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <FilterBar
        title="Orçamentos"
        description="Propostas e decisões comerciais"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setProfileOpen(true)}>
              <Settings2 />
              Dados da empresa
            </Button>
            <Button onClick={openNew}>
              <Plus />
              Novo orçamento
            </Button>
          </div>
        }
        search={{
          value: search,
          onChange: (search) => views.setFilters({ search }),
          placeholder: "Buscar orçamento ou destinatário...",
        }}
        resultCount={filtered.length}
        resultLabel="orçamentos"
        viewState={views}
        onReset={views.resetFilters}
        activeFilters={filterChips(
          filters,
          QUOTE_FILTERS,
          {
            search: "Busca",
            status: "Estado",
            client: "Cliente",
            validity: "Validade",
            from: "Desde",
            to: "Até",
          },
          (key, value) => views.setFilters({ [key]: value }),
          {
            status: STATUS_LABEL,
            client: Object.fromEntries(clients.map((client) => [client.id, client.name])),
            validity: { overdue: "Vencidos", next7: "Vencem em 7 dias", none: "Sem validade" },
          },
        )}
      >
        <FilterSelect
          label="Estado"
          value={statusFilter}
          onChange={(status) => views.setFilters({ status })}
          options={[
            { value: "all", label: "Todos os status" },
            ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
          ]}
        />
        <FilterPeriod
          from={filters.from}
          to={filters.to}
          onChange={(from, to) => views.setFilters({ from, to })}
        />
        <FilterSelect
          label="Cliente"
          value={filters.client}
          onChange={(client) => views.setFilters({ client })}
          options={[
            { value: "all", label: "Todos os clientes" },
            ...clients.map((client) => ({ value: client.id, label: client.name })),
          ]}
        />
        <FilterSelect
          label="Validade"
          value={filters.validity}
          onChange={(validity) => views.setFilters({ validity })}
          options={[
            { value: "all", label: "Todas" },
            { value: "overdue", label: "Vencidos" },
            { value: "next7", label: "Vencem em 7 dias" },
            { value: "none", label: "Sem validade" },
          ]}
        />
      </FilterBar>

      <div className="mobile-card-list">
        {filtered.map((quote) => (
          <article key={quote.id} className="mobile-data-card min-w-0 overflow-hidden">
            <div className="flex items-start justify-between gap-3">
              <button className="min-w-0 flex-1 text-left" onClick={() => openEdit(quote)}>
                <h2 className="font-semibold">{quoteCode(quote)}</h2>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {quote.recipient_name}
                  {quote.recipient_company ? ` · ${quote.recipient_company}` : ""}
                </p>
              </button>
              <Badge
                className={cn(
                  "max-w-[42%] shrink-0 truncate font-medium",
                  STATUS_STYLE[quote.status],
                )}
              >
                {STATUS_LABEL[quote.status]}
              </Badge>
            </div>
            <div className="mt-4 grid min-w-0 grid-cols-2 gap-3 border-t border-border/60 pt-3">
              <div>
                <p className="text-xs text-muted-foreground">Validade</p>
                <p className="mt-0.5 text-sm">{formatDate(quote.valid_until)}</p>
              </div>
              <div className="min-w-0 text-right">
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="mt-0.5 truncate font-semibold tabular-nums">
                  {formatBRL(Number(quote.total))}
                </p>
              </div>
            </div>
            <div className="mt-3 flex min-w-0 flex-wrap justify-end gap-1">
              <Button variant="ghost" size="sm" onClick={() => openEdit(quote)}>
                Editar
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadPdf(quote)}
                disabled={generatingPdfId === quote.id}
              >
                <FileDown />
                {generatingPdfId === quote.id ? "Gerando" : "PDF"}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDeleteCandidate(quote)}
                aria-label={`Excluir ${quoteCode(quote)}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 />
              </Button>
            </div>
          </article>
        ))}
        {filtered.length === 0 && (
          <div className="mobile-data-card py-10 text-center text-sm text-muted-foreground">
            <FileText className="mx-auto mb-2 h-7 w-7 opacity-50" />
            Nenhum orçamento encontrado.
          </div>
        )}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Orçamento</th>
                <th className="text-left px-4 py-3 font-medium">Destinatário</th>
                <th className="text-left px-4 py-3 font-medium">Validade</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Total</th>
                <th className="w-[200px] px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((quote) => (
                <tr key={quote.id} className="border-t border-border hover:bg-muted/30 group">
                  <td className="px-4 py-3 font-medium">
                    <button className="hover:underline" onClick={() => openEdit(quote)}>
                      {quoteCode(quote)}
                    </button>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {formatDate(quote.issue_date)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{quote.recipient_name}</div>
                    {quote.recipient_company && (
                      <div className="text-xs text-muted-foreground">{quote.recipient_company}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(quote.valid_until)}
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      value={quote.status}
                      onValueChange={(value) => updateStatus(quote, value as QuoteStatus)}
                    >
                      <SelectTrigger className="h-8 w-32 border-0 bg-transparent p-0 shadow-none">
                        <Badge
                          className={cn("font-medium hover:bg-inherit", STATUS_STYLE[quote.status])}
                        >
                          {STATUS_LABEL[quote.status]}
                        </Badge>
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(STATUS_LABEL).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {formatBRL(Number(quote.total))}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex flex-nowrap justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(quote)}>
                        Editar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadPdf(quote)}
                        disabled={generatingPdfId === quote.id}
                      >
                        <FileDown className="h-4 w-4 mr-1.5" />
                        {generatingPdfId === quote.id ? "Gerando" : "PDF"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteCandidate(quote)}
                        aria-label={`Excluir ${quoteCode(quote)}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-14 text-center text-muted-foreground">
                    <FileText className="h-7 w-7 mx-auto mb-2 opacity-50" />
                    Nenhum orçamento encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100vw-2rem)] xl:max-w-5xl">
          <DialogHeader className="shrink-0 border-b border-border px-5 py-5 pr-16 sm:px-6">
            <DialogTitle>{editing ? `Editar ${quoteCode(editing)}` : "Novo orçamento"}</DialogTitle>
          </DialogHeader>
          <div className="contained-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-5 sm:px-6">
            <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
              <div className="min-w-0 space-y-5">
                <div className="space-y-1.5">
                  <Label>Preencher a partir de</Label>
                  <Select onValueChange={applyPerson}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha um cliente, lead ou preencha manualmente" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Preenchimento manual</SelectItem>
                      {clients.map((person) => (
                        <SelectItem key={`client:${person.id}`} value={`client:${person.id}`}>
                          Cliente · {person.name}
                        </SelectItem>
                      ))}
                      {leads.map((person) => (
                        <SelectItem key={`lead:${person.id}`} value={`lead:${person.id}`}>
                          Lead · {person.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <Field
                    label="Nome *"
                    value={form.recipient_name}
                    onChange={(value) => setForm({ ...form, recipient_name: value })}
                  />
                  <Field
                    label="Empresa"
                    value={form.recipient_company}
                    onChange={(value) => setForm({ ...form, recipient_company: value })}
                  />
                  <Field
                    label="E-mail"
                    value={form.recipient_email}
                    onChange={(value) => setForm({ ...form, recipient_email: value })}
                  />
                  <Field
                    label="Telefone"
                    value={form.recipient_phone}
                    onChange={(value) => setForm({ ...form, recipient_phone: value })}
                  />
                </div>
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Emissão</Label>
                    <CrmDatePicker
                      value={form.issue_date}
                      onChange={(value) => setForm({ ...form, issue_date: value })}
                      label="Data de emissão"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Validade</Label>
                    <CrmDatePicker
                      value={form.valid_until}
                      onChange={(value) => setForm({ ...form, valid_until: value })}
                      label="Validade do orçamento"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Escopo</Label>
                  <Textarea
                    rows={6}
                    value={form.scope}
                    onChange={(e) => setForm({ ...form, scope: e.target.value })}
                    placeholder="Descreva o que está incluído no projeto..."
                  />
                </div>
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Condições de pagamento</Label>
                    <Textarea
                      rows={3}
                      value={form.payment_terms}
                      onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Prazo / entrega</Label>
                    <Textarea
                      rows={3}
                      value={form.delivery_terms}
                      onChange={(e) => setForm({ ...form, delivery_terms: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Observações</Label>
                  <Textarea
                    rows={3}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>
              </div>
              <div className="min-w-0 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">Itens</h3>
                    <p className="text-xs text-muted-foreground">
                      Serviços e produtos deste orçamento
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setForm({ ...form, items: [...form.items, newItem()] })}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Item
                  </Button>
                </div>
                <div className="space-y-3">
                  {form.items.map((item, index) => (
                    <QuoteItemEditor
                      key={item.localId}
                      item={item}
                      canRemove={form.items.length > 1}
                      onChange={(updated) =>
                        setForm({
                          ...form,
                          items: form.items.map((current, itemIndex) =>
                            itemIndex === index ? updated : current,
                          ),
                        })
                      }
                      onRemove={() =>
                        setForm({
                          ...form,
                          items: form.items.filter((_, itemIndex) => itemIndex !== index),
                        })
                      }
                    />
                  ))}
                </div>
                <Card className="p-4 bg-muted/30 shadow-none space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-medium tabular-nums">{formatBRL(subtotal)}</span>
                  </div>
                  <div className="grid items-center gap-2 sm:grid-cols-[1fr_160px] sm:gap-3">
                    <Label htmlFor="quote-discount">Desconto</Label>
                    <Input
                      id="quote-discount"
                      inputMode="numeric"
                      value={discountDisplay}
                      onChange={(e) => {
                        const parsed = handleBRLInputChange(e.target.value);
                        setDiscountDisplay(parsed.display);
                        setForm({ ...form, discount: parsed.numeric });
                      }}
                    />
                  </div>
                  <div className="border-t border-border pt-3 flex justify-between">
                    <strong>Total</strong>
                    <strong className="text-xl tabular-nums">{formatBRL(total)}</strong>
                  </div>
                </Card>
              </div>
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t border-border bg-popover px-5 py-4 sm:px-6">
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveQuote} disabled={saving}>
              {saving ? "Salvando..." : "Salvar orçamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Dados da empresa no PDF</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="business-logo">Logo da empresa</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="business-logo"
                  type="file"
                  accept="image/png,image/jpeg"
                  disabled={uploadingLogo}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadLogo(file);
                  }}
                />
                <span className="shrink-0 text-xs text-muted-foreground">
                  {uploadingLogo ? "Enviando..." : profile.logo_path ? "Configurada" : "Opcional"}
                </span>
              </div>
            </div>
            <Field
              label="Nome da empresa *"
              value={profile.business_name}
              onChange={(value) => setProfile({ ...profile, business_name: value })}
            />
            <Field
              label="Razão social"
              value={profile.legal_name ?? ""}
              onChange={(value) => setProfile({ ...profile, legal_name: value })}
            />
            <Field
              label="CNPJ / CPF"
              value={profile.document ?? ""}
              onChange={(value) => setProfile({ ...profile, document: value })}
            />
            <Field
              label="E-mail"
              value={profile.email ?? ""}
              onChange={(value) => setProfile({ ...profile, email: value })}
            />
            <Field
              label="Telefone"
              value={profile.phone ?? ""}
              onChange={(value) => setProfile({ ...profile, phone: value })}
            />
            <Field
              label="Site"
              value={profile.website ?? ""}
              onChange={(value) => setProfile({ ...profile, website: value })}
            />
            <div className="sm:col-span-2">
              <Field
                label="Endereço"
                value={profile.address ?? ""}
                onChange={(value) => setProfile({ ...profile, address: value })}
              />
            </div>
            <div>
              <Label>Cor de destaque</Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={profile.accent_color ?? "#171717"}
                  onChange={(e) => setProfile({ ...profile, accent_color: e.target.value })}
                  className="w-14 p-1"
                />
                <Input
                  value={profile.accent_color ?? "#171717"}
                  onChange={(e) => setProfile({ ...profile, accent_color: e.target.value })}
                />
              </div>
            </div>
            <div className="sm:col-span-2">
              <Label>Rodapé</Label>
              <Textarea
                rows={3}
                value={profile.footer_notes ?? ""}
                onChange={(e) => setProfile({ ...profile, footer_notes: e.target.value })}
                placeholder="Informações bancárias, agradecimento ou observações padrão..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveProfile} disabled={uploadingLogo}>
              Salvar dados
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteCandidate)}
        onOpenChange={(open) => {
          if (!open && !deletingQuoteId) setDeleteCandidate(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir orçamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteCandidate
                ? `${quoteCode(deleteCandidate)} de ${deleteCandidate.recipient_name} será excluído definitivamente, incluindo seus itens e o PDF armazenado.`
                : "Esta ação não pode ser desfeita."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingQuoteId)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void deleteQuote();
              }}
              disabled={Boolean(deletingQuoteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingQuoteId ? "Excluindo..." : "Excluir definitivamente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label>{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function QuoteItemEditor({
  item,
  canRemove,
  onChange,
  onRemove,
}: {
  item: QuoteItem;
  canRemove: boolean;
  onChange: (item: QuoteItem) => void;
  onRemove: () => void;
}) {
  const [priceDisplay, setPriceDisplay] = useState(numberToBRLInput(item.unit_price));
  const syncPriceDisplay = useEffectEvent(() => setPriceDisplay(numberToBRLInput(item.unit_price)));
  useEffect(() => {
    const timer = window.setTimeout(syncPriceDisplay, 0);
    return () => window.clearTimeout(timer);
  }, [item.id]);
  return (
    <div className="min-w-0 space-y-3 rounded-xl border border-border p-3">
      <div className="flex min-w-0 gap-2">
        <Input
          value={item.description}
          onChange={(e) => onChange({ ...item, description: e.target.value })}
          placeholder="Descrição do item"
          maxLength={500}
        />
        <Button
          variant="ghost"
          size="icon"
          disabled={!canRemove}
          onClick={onRemove}
          aria-label="Remover item"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label>Quantidade</Label>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            value={item.quantity}
            onChange={(e) => onChange({ ...item, quantity: Math.max(0, Number(e.target.value)) })}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label>Valor unitário</Label>
          <Input
            inputMode="numeric"
            value={priceDisplay}
            onChange={(e) => {
              const parsed = handleBRLInputChange(e.target.value);
              setPriceDisplay(parsed.display);
              onChange({ ...item, unit_price: parsed.numeric });
            }}
          />
        </div>
      </div>
      <div className="flex justify-end text-sm">
        <span className="text-muted-foreground mr-2">Subtotal:</span>
        <strong>{formatBRL(item.quantity * item.unit_price)}</strong>
      </div>
    </div>
  );
}

function quoteCode(quote: Pick<Quote, "quote_number" | "issue_date">) {
  return `ORC-${quote.issue_date.slice(0, 4)}-${String(quote.quote_number).padStart(4, "0")}`;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");
}

function safeFilename(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "cliente"
  );
}
