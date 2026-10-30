import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTimeBR } from "@/lib/date-format";
import {
  useAuth,
  formatPhone,
  stripPhone,
  handleBRLInputChange,
  numberToBRLInput,
} from "@/lib/auth";
import { cn, getLabelColorClasses, LABEL_COLORS } from "@/lib/utils";
import type { Lead, LeadLabel, LabelAssignment } from "@/lib/leads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Tag,
  Trash2,
  Pencil,
  Check,
  Clock,
  Paperclip,
  FileText,
  Eye,
  Download,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import {
  uploadAttachment,
  formatFileSize,
  openAttachmentInNewTab,
  removeAttachmentObject,
} from "@/lib/storage";
import { AttachmentViewerModal, type AttachmentItem } from "@/components/AttachmentViewerModal";
import { DateReminderEditor } from "@/components/DateReminderEditor";
import {
  normalizeReminderOffsets,
  toSaoPauloInputParts,
  toSaoPauloTimestamp,
  type ReminderOffsetMinutes,
} from "@/lib/reminders";

const SERVICES = [
  "Tráfego Pago",
  "Sites/Landing Pages",
  "Social Media/Blogs",
  "Hospedagens",
  "Desenvolvimento",
  "Outros",
];

function formatDateTime(dt: string | null): string {
  return dt ? formatDateTimeBR(dt) : "";
}

// ─── Label Manager Dialog ─────────────────────────────────────────
export function LabelManagerDialog({
  open,
  onOpenChange,
  leadId,
  allLabels,
  assignments,
  onLabelsChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadId: string | null;
  allLabels: LeadLabel[];
  assignments: LabelAssignment[];
  onLabelsChanged: () => void;
}) {
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("blue");
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

  const assignedIds = leadId
    ? assignments.filter((a) => a.lead_id === leadId).map((a) => a.label_id)
    : [];
  const assignedCount = assignedIds.length;

  const toggleLabel = async (labelId: string) => {
    if (!leadId) return;
    const isAssigned = assignedIds.includes(labelId);
    if (isAssigned) {
      await supabase
        .from("lead_label_assignments")
        .delete()
        .eq("lead_id", leadId)
        .eq("label_id", labelId);
    } else {
      if (assignedCount >= 3) {
        toast.error("Máximo de 3 etiquetas por lead");
        return;
      }
      await supabase.from("lead_label_assignments").insert({ lead_id: leadId, label_id: labelId });
    }
    onLabelsChanged();
  };

  const createLabel = async () => {
    if (!user || !newName.trim()) return;
    await supabase
      .from("lead_labels")
      .insert({ user_id: user.id, name: newName.trim(), color: newColor });
    setNewName("");
    setNewColor("blue");
    setCreating(false);
    onLabelsChanged();
    toast.success("Etiqueta criada");
  };

  const updateLabel = async (id: string) => {
    if (!editName.trim()) return;
    await supabase
      .from("lead_labels")
      .update({ name: editName.trim(), color: editColor })
      .eq("id", id);
    setEditingLabel(null);
    onLabelsChanged();
  };

  const deleteLabel = async (id: string) => {
    await supabase.from("lead_labels").delete().eq("id", id);
    onLabelsChanged();
    toast.success("Etiqueta excluída");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        setCreating(false);
        setEditingLabel(null);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4" />
            Etiquetas
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
          {allLabels.length === 0 && !creating && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhuma etiqueta criada ainda.
            </p>
          )}
          {allLabels.map((label) => {
            const isAssigned = assignedIds.includes(label.id);
            const colorInfo = getLabelColorClasses(label.color);
            const isEditing = editingLabel === label.id;

            if (isEditing) {
              return (
                <div key={label.id} className="p-2 rounded-lg border border-border space-y-2">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-8 text-sm"
                    placeholder="Nome da etiqueta"
                  />
                  <div className="flex gap-1.5 flex-wrap">
                    {LABEL_COLORS.map((c) => (
                      <button
                        key={c.value}
                        onClick={() => setEditColor(c.value)}
                        className={`w-6 h-6 rounded-md ${c.bg} border-2 transition-all ${editColor === c.value ? "border-foreground scale-110 ring-1 ring-foreground" : "border-transparent"}`}
                      />
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      className="h-7 text-xs flex-1"
                      onClick={() => updateLabel(label.id)}
                    >
                      Salvar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => setEditingLabel(null)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      onClick={() => deleteLabel(label.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={label.id}
                className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-muted/50 transition-colors group"
              >
                <button
                  onClick={() => toggleLabel(label.id)}
                  className={`flex-1 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${colorInfo.light} ${isAssigned ? "ring-2 ring-offset-1 ring-offset-background ring-current" : "opacity-70 hover:opacity-100"}`}
                >
                  {isAssigned && <Check className="h-3 w-3 shrink-0" />}
                  {label.name}
                </button>
                <button
                  onClick={() => {
                    setEditingLabel(label.id);
                    setEditName(label.name);
                    setEditColor(label.color);
                  }}
                  className="touch-visible-action opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity p-1"
                  aria-label={`Editar etiqueta ${label.name}`}
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            );
          })}

          {creating && (
            <div className="p-2 rounded-lg border border-border space-y-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-8 text-sm"
                placeholder="Nome da etiqueta"
                onKeyDown={(e) => e.key === "Enter" && createLabel()}
                autoFocus
              />
              <div className="flex gap-1.5 flex-wrap">
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setNewColor(c.value)}
                    className={`w-6 h-6 rounded-md ${c.bg} border-2 transition-all ${newColor === c.value ? "border-foreground scale-110 ring-1 ring-foreground" : "border-transparent"}`}
                  />
                ))}
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  className="h-7 text-xs flex-1"
                  onClick={createLabel}
                  disabled={!newName.trim()}
                >
                  Criar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setCreating(false)}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>

        {!creating && (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Nova etiqueta
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Lead Dialog ──────────────────────────────────────────────────
export function LeadDialog({
  open,
  onOpenChange,
  editing,
  onSave,
  onDelete,
  onDuplicate,
  onManageLabels,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Lead | null;
  onSave: (form: Partial<Lead>, removedAttachmentPaths?: string[]) => Promise<boolean>;
  onDelete?: (lead: Lead) => void;
  onDuplicate?: (lead: Lead) => void;
  onManageLabels?: (lead: Lead) => void;
}) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialLead: Partial<Lead> = editing ?? {
    name: "",
    company: "",
    contact: "",
    whatsapp: "",
    estimated_value: 0,
    notes: "",
    services: [],
    source: "",
    attachments: [],
    follow_up_at: null,
    follow_up_has_time: false,
    reminder_offsets_minutes: [],
  };
  const initialFollowUp = toSaoPauloInputParts(initialLead.follow_up_at);
  const [form, setForm] = useState<Partial<Lead>>(initialLead);
  const [valueDisplay, setValueDisplay] = useState(() =>
    numberToBRLInput(initialLead.estimated_value),
  );
  const [phoneDisplay, setPhoneDisplay] = useState(() => formatPhone(initialLead.whatsapp ?? ""));
  const [followUpDate, setFollowUpDate] = useState(initialFollowUp.date);
  const [followUpTime, setFollowUpTime] = useState(
    initialLead.follow_up_has_time ? initialFollowUp.time : "",
  );
  const [reminderOffsets, setReminderOffsets] = useState<ReminderOffsetMinutes[]>(() =>
    initialLead.follow_up_has_time
      ? normalizeReminderOffsets(initialLead.reminder_offsets_minutes)
      : [],
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewingAttachment, setViewingAttachment] = useState<AttachmentItem | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [removedAttachmentPaths, setRemovedAttachmentPaths] = useState<string[]>([]);
  const uploadedAttachmentPathsRef = useRef<string[]>([]);

  const toggleService = (svc: string) => {
    const cur = form.services ?? [];
    setForm({
      ...form,
      services: cur.includes(svc) ? cur.filter((s) => s !== svc) : [...cur, svc],
    });
  };

  const attachments = (form.attachments ?? []) as AttachmentItem[];

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploading(true);
    try {
      const res = await uploadAttachment(user.id, "leads", file);
      const newAttachment: AttachmentItem = {
        name: res.name,
        path: res.path,
        size: res.size,
        type: res.type,
      };
      uploadedAttachmentPathsRef.current.push(res.path);
      setForm((prev) => ({ ...prev, attachments: [...(prev.attachments ?? []), newAttachment] }));
      toast.success("Anexo enviado com sucesso!");
    } catch (error: unknown) {
      toast.error(
        "Erro ao enviar anexo: " + (error instanceof Error ? error.message : "erro desconhecido"),
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (path: string) => {
    setForm((prev) => ({
      ...prev,
      attachments: ((prev.attachments ?? []) as AttachmentItem[]).filter((a) => a.path !== path),
    }));
    setRemovedAttachmentPaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
    toast.success("O anexo será removido ao salvar.");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (saving || uploading) return;
    if (!nextOpen && uploadedAttachmentPathsRef.current.length > 0) {
      void Promise.allSettled(uploadedAttachmentPathsRef.current.map(removeAttachmentObject));
      uploadedAttachmentPathsRef.current = [];
    }
    onOpenChange(nextOpen);
  };

  const handleSave = async () => {
    if (saving || uploading || !form.name?.trim()) return;
    setSaving(true);
    try {
      const hasFollowUpTime = Boolean(followUpDate && followUpTime);
      const saved = await onSave(
        {
          ...form,
          name: form.name.trim().slice(0, 200),
          company: form.company?.trim().slice(0, 200) || null,
          contact: form.contact?.trim().slice(0, 320) || null,
          whatsapp: form.whatsapp?.slice(0, 32) || null,
          notes: form.notes?.slice(0, 10_000) || null,
          follow_up_at: toSaoPauloTimestamp(followUpDate, followUpTime),
          follow_up_has_time: hasFollowUpTime,
          reminder_offsets_minutes: hasFollowUpTime
            ? normalizeReminderOffsets(reminderOffsets)
            : [],
        },
        removedAttachmentPaths,
      );
      if (saved) {
        uploadedAttachmentPathsRef.current = [];
        setRemovedAttachmentPaths([]);
      }
    } catch (error) {
      toast.error(
        "Não foi possível salvar o lead: " +
          (error instanceof Error ? error.message : "erro desconhecido"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader className="pr-10">
          <DialogTitle>{editing ? "Editar lead" : "Novo lead"}</DialogTitle>
        </DialogHeader>
        <div className="modal-form-scroll min-h-0 flex-1 space-y-4 overflow-y-auto">
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
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>E-mail</Label>
              <Input
                value={form.contact ?? ""}
                onChange={(e) => setForm({ ...form, contact: e.target.value })}
                placeholder="email@exemplo.com"
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
                placeholder="(11) 99999-9999"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Valor estimado (R$)</Label>
              <Input
                value={valueDisplay}
                onChange={(e) => {
                  const { display, numeric } = handleBRLInputChange(e.target.value);
                  setValueDisplay(display);
                  setForm({ ...form, estimated_value: numeric });
                }}
                placeholder="R$ 0,00"
              />
            </div>
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
          <DateReminderEditor
            title="Editar follow-up"
            emptyText="Nenhum follow-up agendado"
            date={followUpDate}
            time={followUpTime}
            reminders={reminderOffsets}
            onDateChange={setFollowUpDate}
            onTimeChange={setFollowUpTime}
            onRemindersChange={setReminderOffsets}
          />
          <div>
            <Label>Serviços de interesse</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {SERVICES.map((s) => {
                const active = (form.services ?? []).includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleService(s)}
                    className={`min-h-10 px-3 py-1 rounded-full text-xs border transition-colors sm:min-h-0 ${active ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Observações</Label>
            <Textarea
              rows={3}
              value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          {/* Anexos & Documentos */}
          <div className="space-y-2 pt-2 border-t border-border/40">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 font-medium">
                <Paperclip className="h-4 w-4 text-primary" /> Anexos e Documentos (
                {attachments.length})
              </Label>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx"
                onChange={handleFileUpload}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Plus className="h-3.5 w-3.5" />
                {uploading ? "Enviando..." : "Anexar arquivo / PDF"}
              </Button>
            </div>

            {attachments.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-1">
                Nenhum anexo adicionado a este lead.
              </p>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {attachments.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 rounded-lg border border-border/60 bg-muted/20 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
                      <FileText className="h-4 w-4 shrink-0 text-primary" />
                      <span className="font-medium truncate" title={item.name}>
                        {item.name}
                      </span>
                      {item.size && (
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          ({formatFileSize(item.size)})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 gap-1 text-[11px]"
                        title="Visualizar na plataforma"
                        onClick={() => {
                          setViewingAttachment(item);
                          setViewerOpen(true);
                        }}
                      >
                        <Eye className="h-3.5 w-3.5 text-blue-500" />
                        Ver
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        title="Download"
                        onClick={() =>
                          void openAttachmentInNewTab(item.path, item.url).catch(() =>
                            toast.error("Não foi possível abrir o anexo."),
                          )
                        }
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        title="Remover"
                        onClick={() => removeAttachment(item.path)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {editing && (
            <div className="pt-2">
              <Label className="text-muted-foreground mb-2 block">Histórico do Lead</Label>
              <div className="space-y-1.5 bg-muted/20 p-3 rounded-lg border border-border/50">
                {[
                  { label: "Criado", date: editing.created_at },
                  editing.contacted_at ? { label: "Contatado", date: editing.contacted_at } : null,
                  editing.proposal_sent_at
                    ? { label: "Proposta", date: editing.proposal_sent_at }
                    : null,
                  editing.negotiation_at
                    ? { label: "Negociação", date: editing.negotiation_at }
                    : null,
                  editing.closed_at
                    ? {
                        label: editing.stage === "ganho" ? "Ganho" : "Perdido",
                        date: editing.closed_at,
                      }
                    : null,
                ]
                  .filter((item): item is { label: string; date: string } => item !== null)
                  .map((t, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      <span className="font-medium">{t.label}:</span>
                      <span>{formatDateTime(t.date)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="flex w-full shrink-0 flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between">
          {editing && onDelete ? (
            <Button
              variant="ghost"
              className="w-fit text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={saving || uploading}
              onClick={() => onDelete(editing)}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Excluir lead
            </Button>
          ) : (
            <span className="hidden sm:block" />
          )}
          <div className="grid w-full grid-cols-2 gap-2 sm:ml-auto sm:flex sm:w-auto sm:items-center">
            {editing && onDuplicate && (
              <Button
                type="button"
                variant="ghost"
                className="sm:w-auto"
                disabled={saving || uploading}
                onClick={() => onDuplicate(editing)}
              >
                <Copy className="mr-2 h-4 w-4" /> Duplicar lead
              </Button>
            )}
            {editing && onManageLabels && (
              <Button
                variant="ghost"
                className={cn(!onDuplicate && "col-span-2", "sm:w-auto")}
                disabled={saving || uploading}
                onClick={() => onManageLabels(editing)}
              >
                <Tag className="mr-2 h-4 w-4" /> Etiquetas
              </Button>
            )}
            <Button
              variant="outline"
              disabled={saving || uploading}
              onClick={() => handleOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              disabled={saving || uploading || !form.name?.trim()}
              onClick={() => void handleSave()}
            >
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </DialogFooter>

        {/* Modal de Pré-Visualização de Anexos */}
        <AttachmentViewerModal
          attachment={viewingAttachment}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
        />
      </DialogContent>
    </Dialog>
  );
}
