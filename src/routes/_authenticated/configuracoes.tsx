import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, formatBRL } from "@/lib/auth";
import { formatDateBR } from "@/lib/date-format";
import { deleteTrashedTask, restoreTrashedTask } from "@/lib/task-trash";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  Bell,
  ChevronRight,
  DatabaseBackup,
  Download,
  File,
  HardDrive,
  KeyRound,
  Laptop,
  LogOut,
  Mail,
  MonitorCog,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  Smartphone,
  Tablet,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { BrandingSettings } from "@/components/BrandingSettings";
import {
  formatFileSize,
  getStorageUsage,
  removeAttachmentObject,
  type StorageUsage,
  type TrashableAttachment,
} from "@/lib/storage";
import {
  applySidebarPreference,
  applyThemePreference,
  type ThemePreference,
} from "@/lib/preferences";
import { getDeviceInfo } from "@/lib/device-sessions";
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushStatus,
  sendPushTestNotification,
  type PushStatus,
} from "@/lib/push-notifications";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  component: ConfiguracoesPage,
  head: () => ({ meta: [{ title: "CRM | Configurações" }] }),
});

type SettingsPanel =
  | "account"
  | "trash"
  | "preferences"
  | "notifications"
  | "backup"
  | "sessions"
  | "branding"
  | null;
type TrashTab = "leads" | "tasks" | "files";
type TaskPriority = "baixa" | "media" | "alta" | "urgente";

interface UserSettings {
  theme: ThemePreference;
  sidebar_collapsed: boolean;
  notify_tasks: boolean;
  notify_leads: boolean;
  default_task_priority: TaskPriority | null;
  default_task_column_id: string | null;
  default_lead_stage: string;
}

interface TrashedLead {
  id: string;
  name: string;
  company: string | null;
  stage: string;
  estimated_value: number | null;
  deleted_at: string;
  attachments: TrashableAttachment[];
}

interface TrashedTask {
  id: string;
  title: string;
  description: string | null;
  priority: string | null;
  deleted_at: string;
  attachments: TrashableAttachment[];
}

interface TrashedFile {
  id: string;
  owner_type: "lead" | "task";
  owner_id: string;
  attachment: TrashableAttachment;
  deleted_at: string;
}

interface UserSessionRow {
  session_id: string;
  created_at: string | null;
  updated_at: string | null;
  refreshed_at: string | null;
  user_agent: string | null;
  device_name: string | null;
  browser: string | null;
  operating_system: string | null;
  device_type: "desktop" | "mobile" | "tablet" | null;
  last_seen_at: string | null;
  is_current: boolean;
  push_enabled: boolean;
}

interface TaskColumnOption {
  id: string;
  name: string;
}

interface PendingDeletion {
  type: TrashTab;
  id: string;
  name: string;
}

const DEFAULT_SETTINGS: UserSettings = {
  theme: "system",
  sidebar_collapsed: false,
  notify_tasks: true,
  notify_leads: true,
  default_task_priority: null,
  default_task_column_id: null,
  default_lead_stage: "novo",
};

const STAGE_LABEL: Record<string, string> = {
  novo: "Novo Lead",
  contatado: "Contatado",
  proposta: "Proposta",
  negociacao: "Negociação",
  ganho: "Ganho",
  perdido: "Perdido",
};

function parseAttachments(value: unknown): TrashableAttachment[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is TrashableAttachment =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as TrashableAttachment).path === "string" &&
          typeof (item as TrashableAttachment).name === "string",
      )
    : [];
}

function ConfiguracoesPage() {
  const { user, session, signOut } = useAuth();
  const navigate = useNavigate();
  const [panel, setPanel] = useState<SettingsPanel>(null);
  const [trashTab, setTrashTab] = useState<TrashTab>("leads");
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [columns, setColumns] = useState<TaskColumnOption[]>([]);
  const [trashedLeads, setTrashedLeads] = useState<TrashedLead[]>([]);
  const [trashedTasks, setTrashedTasks] = useState<TrashedTask[]>([]);
  const [trashedFiles, setTrashedFiles] = useState<TrashedFile[]>([]);
  const [userSessions, setUserSessions] = useState<UserSessionRow[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushStatus>("available");
  const [updatingPush, setUpdatingPush] = useState(false);
  const [storageStats, setStorageStats] = useState<StorageUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingStorage, setLoadingStorage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);
  const [clearTrashDialogOpen, setClearTrashDialogOpen] = useState(false);

  const formatDate = (value: string, includeTime = false) => {
    const date = new Date(value);
    return date.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
  };

  const loadStorageUsage = async () => {
    if (!user) return;
    setLoadingStorage(true);
    const stats = await getStorageUsage(user.id);
    setStorageStats(stats);
    setLoadingStorage(false);
  };

  const loadData = async () => {
    if (!user) return;
    setLoading(true);

    const [
      { data: settingsData, error: settingsError },
      { data: columnsData },
      { data: leadsData },
      { data: tasksData },
      { data: filesData },
    ] = await Promise.all([
      supabase
        .from("user_settings")
        .select(
          "theme, sidebar_collapsed, notify_tasks, notify_leads, default_task_priority, default_task_column_id, default_lead_stage",
        )
        .maybeSingle(),
      supabase.from("task_columns").select("id, name").order("position"),
      supabase
        .from("leads")
        .select("id, name, company, stage, estimated_value, deleted_at, attachments")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false }),
      supabase
        .from("task_cards")
        .select("id, title, description, priority, deleted_at, attachments")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false }),
      supabase.from("trashed_attachments").select("*").order("deleted_at", { ascending: false }),
    ]);

    let resolvedSettings = settingsData as UserSettings | null;
    if (!resolvedSettings && !settingsError) {
      const { data: inserted } = await supabase
        .from("user_settings")
        .upsert({ user_id: user.id })
        .select(
          "theme, sidebar_collapsed, notify_tasks, notify_leads, default_task_priority, default_task_column_id, default_lead_stage",
        )
        .single();
      resolvedSettings = inserted as UserSettings | null;
    }

    setSettings({ ...DEFAULT_SETTINGS, ...(resolvedSettings ?? {}) });
    setColumns((columnsData ?? []) as TaskColumnOption[]);
    setTrashedLeads(
      (leadsData ?? []).map((lead) => ({
        ...lead,
        deleted_at: lead.deleted_at!,
        attachments: parseAttachments(lead.attachments),
      })) as TrashedLead[],
    );
    setTrashedTasks(
      (tasksData ?? []).map((task) => ({
        ...task,
        deleted_at: task.deleted_at!,
        attachments: parseAttachments(task.attachments),
      })) as TrashedTask[],
    );
    setTrashedFiles(
      (filesData ?? []).map((file) => ({
        ...file,
        owner_type: file.owner_type as "lead" | "task",
        attachment: file.attachment as unknown as TrashableAttachment,
      })) as TrashedFile[],
    );
    setLoading(false);
  };

  const loadUserSessions = async () => {
    setLoadingSessions(true);
    const { data, error } = await supabase.rpc("list_user_sessions");
    setLoadingSessions(false);
    if (error) {
      toast.error("Não foi possível carregar as sessões.");
      return;
    }
    setUserSessions((data ?? []) as UserSessionRow[]);
  };

  const loadInitialSettings = useEffectEvent(() => Promise.all([loadData(), loadStorageUsage()]));

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadInitialSettings();
    });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      if (panel === "sessions") void loadUserSessions();
      if (panel === "notifications")
        void getPushStatus().then((status) => active && setPushStatus(status));
    });
    return () => {
      active = false;
    };
  }, [panel]);

  const saveSettings = async (changes: Partial<UserSettings>) => {
    if (!user) return;
    setSaving(true);
    const nextSettings = { ...settings, ...changes };
    const { error } = await supabase.from("user_settings").upsert({
      user_id: user.id,
      ...nextSettings,
    });
    setSaving(false);

    if (error) {
      toast.error("Não foi possível salvar as configurações: " + error.message);
      return;
    }
    setSettings(nextSettings);
    applyThemePreference(nextSettings.theme);
    applySidebarPreference(nextSettings.sidebar_collapsed);
    toast.success("Configurações salvas");
    setPanel(null);
    void loadData();
  };

  const handlePasswordChange = async () => {
    if (newPassword.length < 12) {
      toast.error("A senha deve ter no mínimo 12 caracteres.");
      return;
    }
    if (
      !/[a-z]/.test(newPassword) ||
      !/[A-Z]/.test(newPassword) ||
      !/\d/.test(newPassword) ||
      !/[^A-Za-z0-9]/.test(newPassword)
    ) {
      toast.error("Use letras maiúsculas, minúsculas, número e caractere especial.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("As senhas não coincidem.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);
    if (error) {
      toast.error("Erro ao alterar senha: " + error.message);
      return;
    }
    setNewPassword("");
    setConfirmPassword("");
    toast.success("Senha alterada com sucesso");
    void loadData();
  };

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  const handlePanelOpenChange = (open: boolean) => {
    if (open) return;
    setPanel(null);
    setNewPassword("");
    setConfirmPassword("");
    void loadData();
  };

  const restoreLead = async (id: string) => {
    const { error } = await supabase.from("leads").update({ deleted_at: null }).eq("id", id);
    if (error) return toast.error("Não foi possível restaurar o lead.");
    toast.success("Lead restaurado");
    void loadData();
  };

  const restoreTask = async (id: string) => {
    if (!user || saving) return;
    setSaving(true);
    try {
      await restoreTrashedTask(supabase, id, user.id);
      toast.success("Tarefa restaurada");
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível restaurar a tarefa.");
    } finally {
      setSaving(false);
    }
  };

  const restoreFile = async (id: string) => {
    const { error } = await supabase.rpc("restore_trashed_attachment", { p_trash_id: id });
    if (error) {
      toast.error(
        error.message.includes("Original record")
          ? "O lead ou a tarefa original não existe mais."
          : "Não foi possível restaurar o arquivo.",
      );
      return;
    }
    toast.success("Arquivo restaurado");
    void Promise.all([loadData(), loadStorageUsage()]);
  };

  const removeStoredFiles = async (attachments: TrashableAttachment[]) => {
    const results = await Promise.allSettled(
      attachments.map((attachment) => removeAttachmentObject(attachment.path)),
    );
    return results.every((result) => result.status === "fulfilled");
  };

  const removeAllOwnerFiles = async (
    ownerType: "lead" | "task",
    ownerId: string,
    activeAttachments: TrashableAttachment[],
  ) => {
    const alreadyTrashed = trashedFiles.filter(
      (file) => file.owner_type === ownerType && file.owner_id === ownerId,
    );
    const uniqueAttachments = [
      ...activeAttachments,
      ...alreadyTrashed.map((file) => file.attachment),
    ].filter(
      (attachment, index, items) =>
        items.findIndex((item) => item.path === attachment.path) === index,
    );

    if (!(await removeStoredFiles(uniqueAttachments))) return false;
    if (alreadyTrashed.length) {
      const { error } = await supabase
        .from("trashed_attachments")
        .delete()
        .eq("owner_type", ownerType)
        .eq("owner_id", ownerId);
      if (error) return false;
    }
    return true;
  };

  const permanentlyDelete = async (target: PendingDeletion) => {
    if (!user || saving) return;
    setSaving(true);
    let errorMessage: string | null;
    let cleanupWarning: string | null = null;

    if (target.type === "leads") {
      const item = trashedLeads.find((lead) => lead.id === target.id);
      if (item && !(await removeAllOwnerFiles("lead", item.id, item.attachments))) {
        errorMessage = "Alguns anexos do lead não puderam ser removidos.";
      } else {
        const { error } = await supabase
          .from("leads")
          .delete()
          .eq("id", target.id)
          .not("deleted_at", "is", null);
        errorMessage = error?.message ?? null;
      }
    } else if (target.type === "tasks") {
      const item = trashedTasks.find((task) => task.id === target.id);
      errorMessage = null;
      try {
        if (!item) throw new Error("A tarefa não está mais na lixeira. Atualize a lista.");
        // Confirm the scoped deletion before touching files: a failed deletion must not
        // remove attachments from a task that was restored in another tab.
        await deleteTrashedTask(supabase, item.id, user.id);
        if (!(await removeAllOwnerFiles("task", item.id, item.attachments))) {
          cleanupWarning =
            "Tarefa excluída. Alguns anexos não puderam ser removidos do armazenamento.";
        }
      } catch (error) {
        errorMessage =
          error instanceof Error ? error.message : "Não foi possível excluir a tarefa.";
      }
    } else {
      const item = trashedFiles.find((file) => file.id === target.id);
      if (!item || !(await removeStoredFiles([item.attachment]))) {
        errorMessage = "O arquivo não pôde ser removido do armazenamento.";
      } else {
        const { error } = await supabase.from("trashed_attachments").delete().eq("id", target.id);
        errorMessage = error?.message ?? null;
      }
    }

    setSaving(false);
    if (errorMessage) {
      toast.error(errorMessage);
      return;
    }
    setPendingDeletion(null);
    if (cleanupWarning) toast.warning(cleanupWarning);
    else toast.success("Item excluído permanentemente");
    void Promise.all([loadData(), loadStorageUsage()]);
  };

  const emptyActiveTrash = async () => {
    const items: PendingDeletion[] =
      trashTab === "leads"
        ? trashedLeads.map((item) => ({ type: "leads", id: item.id, name: item.name }))
        : trashTab === "tasks"
          ? trashedTasks.map((item) => ({ type: "tasks", id: item.id, name: item.title }))
          : trashedFiles.map((item) => ({
              type: "files",
              id: item.id,
              name: item.attachment.name,
            }));

    setSaving(true);
    let failures = 0;
    for (const target of items) {
      if (target.type === "leads") {
        const item = trashedLeads.find((lead) => lead.id === target.id)!;
        if (!(await removeAllOwnerFiles("lead", item.id, item.attachments))) {
          failures++;
          continue;
        }
        const { error } = await supabase
          .from("leads")
          .delete()
          .eq("id", target.id)
          .not("deleted_at", "is", null);
        if (error) failures++;
      } else if (target.type === "tasks") {
        const item = trashedTasks.find((task) => task.id === target.id)!;
        if (!(await removeAllOwnerFiles("task", item.id, item.attachments))) {
          failures++;
          continue;
        }
        const { error } = await supabase
          .from("task_cards")
          .delete()
          .eq("id", target.id)
          .not("deleted_at", "is", null);
        if (error) failures++;
      } else {
        const item = trashedFiles.find((file) => file.id === target.id)!;
        if (!(await removeStoredFiles([item.attachment]))) {
          failures++;
          continue;
        }
        const { error } = await supabase.from("trashed_attachments").delete().eq("id", target.id);
        if (error) failures++;
      }
    }

    setSaving(false);
    setClearTrashDialogOpen(false);
    if (failures) {
      toast.warning(`${failures} item(ns) não puderam ser excluídos.`);
    } else {
      toast.success("Lixeira esvaziada");
    }
    void Promise.all([loadData(), loadStorageUsage()]);
  };

  const exportBackup = async () => {
    if (!user) return;
    setExporting(true);
    const [
      clients,
      leads,
      payments,
      notes,
      taskColumns,
      taskCards,
      taskLabels,
      taskAssignments,
      leadLabels,
      leadAssignments,
      pipelineStages,
      todos,
      settingsResult,
    ] = await Promise.all([
      supabase.from("clients").select("*"),
      supabase.from("leads").select("*"),
      supabase.from("payments").select("*"),
      supabase.from("notes").select("*"),
      supabase.from("task_columns").select("*"),
      supabase.from("task_cards").select("*"),
      supabase.from("task_labels").select("*"),
      supabase.from("task_label_assignments").select("*"),
      supabase.from("lead_labels").select("*"),
      supabase.from("lead_label_assignments").select("*"),
      supabase.from("pipeline_stages").select("*"),
      supabase.from("todos").select("*"),
      supabase.from("user_settings").select("*"),
    ]);

    const results = [
      clients,
      leads,
      payments,
      notes,
      taskColumns,
      taskCards,
      taskLabels,
      taskAssignments,
      leadLabels,
      leadAssignments,
      pipelineStages,
      todos,
      settingsResult,
    ];
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      setExporting(false);
      toast.error("Não foi possível gerar o backup: " + failed.error.message);
      return;
    }

    const backup = {
      format: "crm-backup",
      version: 1,
      exported_at: new Date().toISOString(),
      data: {
        clients: clients.data,
        leads: leads.data,
        payments: payments.data,
        notes: notes.data,
        task_columns: taskColumns.data,
        task_cards: taskCards.data,
        task_labels: taskLabels.data,
        task_label_assignments: taskAssignments.data,
        lead_labels: leadLabels.data,
        lead_label_assignments: leadAssignments.data,
        pipeline_stages: pipelineStages.data,
        todos: todos.data,
        user_settings: settingsResult.data,
      },
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `crm-backup-${formatDateBR(new Date()).replaceAll("/", "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setExporting(false);
    toast.success("Backup exportado");
    void loadData();
  };

  const signOutOtherSessions = async () => {
    setSaving(true);
    const { error } = await supabase.auth.signOut({ scope: "others" });
    setSaving(false);
    if (error) {
      toast.error("Não foi possível encerrar as outras sessões.");
      return;
    }
    toast.success("Outras sessões foram encerradas");
    void loadUserSessions();
  };

  const revokeSession = async (sessionId: string) => {
    setSaving(true);
    const { data, error } = await supabase.rpc("revoke_user_session", { p_session_id: sessionId });
    setSaving(false);
    if (error || !data) {
      toast.error("Não foi possível encerrar esta sessão.");
      return;
    }
    toast.success("Sessão encerrada");
    void loadUserSessions();
  };

  const enablePush = async () => {
    setUpdatingPush(true);
    try {
      await enablePushNotifications(session);
      setPushStatus("enabled");
      toast.success("Notificações ativadas neste dispositivo");
      void loadUserSessions();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível ativar as notificações.",
      );
      setPushStatus(await getPushStatus());
    } finally {
      setUpdatingPush(false);
    }
  };

  const disablePush = async () => {
    setUpdatingPush(true);
    try {
      await disablePushNotifications();
      setPushStatus("available");
      toast.success("Notificações desativadas neste dispositivo");
      void loadUserSessions();
    } catch {
      toast.error("Não foi possível desativar as notificações.");
    } finally {
      setUpdatingPush(false);
    }
  };

  const testPush = async () => {
    setUpdatingPush(true);
    try {
      await sendPushTestNotification();
      toast.success("Notificação de teste enviada");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "O teste não pôde ser entregue neste dispositivo.",
      );
    } finally {
      setUpdatingPush(false);
    }
  };

  const activeTrashCount =
    trashTab === "leads"
      ? trashedLeads.length
      : trashTab === "tasks"
        ? trashedTasks.length
        : trashedFiles.length;

  return (
    <div className="page-shell">
      <PageHeader
        title="Configurações"
        description="Gerencie sua conta, preferências e dados do CRM"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <SettingsCard
          icon={<MonitorCog />}
          title="Identidade visual"
          description="Nome do CRM com até 12 caracteres e logo quadrado para a interface e o favicon."
          onClick={() => setPanel("branding")}
        />
        <SettingsCard
          icon={<Mail />}
          title="Conta"
          description="Dados da conta, alteração de senha e informações de segurança."
          meta={user?.email}
          onClick={() => setPanel("account")}
        />
        <SettingsCard
          icon={<Trash2 />}
          title="Lixeira"
          description="Restaure ou exclua definitivamente leads, tarefas e arquivos."
          meta={`${trashedLeads.length + trashedTasks.length + trashedFiles.length} item(ns)`}
          onClick={() => setPanel("trash")}
        />
        <Card className="min-h-40 border-border p-4 shadow-none flex flex-col">
          <div className="flex items-start justify-between gap-3">
            <div className="rounded-lg bg-muted p-2.5">
              <HardDrive className="h-5 w-5" />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void loadStorageUsage()}
              disabled={loadingStorage}
              aria-label="Atualizar uso do armazenamento"
            >
              <RefreshCw className={`h-4 w-4 ${loadingStorage ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <h2 className="font-semibold mt-4">Armazenamento</h2>
          <p className="text-sm text-muted-foreground mt-1">Uso dos anexos no Supabase Storage.</p>
          <div className="mt-auto pt-4">
            <div className="flex justify-between text-xs mb-2">
              <span>{storageStats?.formattedUsed ?? "Calculando..."}</span>
              <span>{storageStats?.percentage ?? 0}%</span>
            </div>
            <Progress value={storageStats?.percentage ?? 0} className="h-2" />
            <div className="flex justify-between mt-2 text-[11px] text-muted-foreground">
              <span>{storageStats?.fileCount ?? 0} arquivos</span>
              <span>
                {storageStats
                  ? formatFileSize(storageStats.totalBytes - storageStats.usedBytes)
                  : "500 MB"}{" "}
                livres
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-3 text-[11px] text-muted-foreground">
              <UploadCloud className="h-3.5 w-3.5" />
              Imagens são otimizadas em WebP antes do envio.
            </div>
          </div>
        </Card>
        <SettingsCard
          icon={<MonitorCog />}
          title="Preferências"
          description="Tema, barra lateral e padrões usados ao criar tarefas e leads."
          meta={
            settings.theme === "system"
              ? "Tema do sistema"
              : settings.theme === "dark"
                ? "Tema escuro"
                : "Tema claro"
          }
          onClick={() => setPanel("preferences")}
        />
        <SettingsCard
          icon={<Bell />}
          title="Notificações"
          description="Alertas de tarefas e follow-ups no computador e celular."
          meta={pushStatus === "enabled" ? "Ativadas neste dispositivo" : "Configurar dispositivo"}
          onClick={() => setPanel("notifications")}
        />
        <SettingsCard
          icon={<DatabaseBackup />}
          title="Exportação e backup"
          description="Baixe uma cópia em JSON dos dados acessíveis pela sua conta."
          meta="Backup manual"
          onClick={() => setPanel("backup")}
        />
        <SettingsCard
          icon={<Laptop />}
          title="Sessões e dispositivos"
          description="Visualize os logins reais do Supabase e encerre dispositivos."
          meta="Logins reais do Supabase"
          onClick={() => setPanel("sessions")}
        />
      </div>

      <Dialog open={panel === "account"} onOpenChange={handlePanelOpenChange}>
        <DialogContent className="overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Conta e segurança</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <div className="grid sm:grid-cols-2 gap-4 rounded-lg border p-4">
              <div>
                <Label className="text-xs text-muted-foreground">E-mail</Label>
                <p className="text-sm font-medium mt-1 break-all">{user?.email}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">ID do usuário</Label>
                <p className="text-xs font-mono text-muted-foreground mt-1 break-all">{user?.id}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2 font-medium">
                <KeyRound className="h-4 w-4" />
                Alterar senha
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Nova senha</Label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    placeholder="Mínimo 12 caracteres"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Confirmar senha</Label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    placeholder="Repita a nova senha"
                  />
                </div>
              </div>
              <Button onClick={() => void handlePasswordChange()} disabled={saving || !newPassword}>
                Alterar senha
              </Button>
            </div>

            <div className="rounded-lg bg-muted/50 p-4">
              <div className="flex items-center gap-2 font-medium">
                <Shield className="h-4 w-4" />
                Segurança e dados
              </div>
              <div className="text-sm text-muted-foreground mt-3 space-y-2">
                <p>
                  Os dados trafegam por conexão criptografada e ficam no PostgreSQL gerenciado pelo
                  Supabase.
                </p>
                <p>
                  As políticas de Row Level Security isolam os registros pelo seu usuário
                  autenticado.
                </p>
                <p>
                  O acesso usa tokens de sessão com renovação automática. Você pode revogar as
                  outras sessões no bloco “Sessões e dispositivos”.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="destructive" onClick={() => void handleSignOut()}>
              <LogOut className="h-4 w-4 mr-2" />
              Sair da conta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BrandingSettings
        open={panel === "branding"}
        onOpenChange={(open) => {
          if (!open) setPanel(null);
        }}
      />
      <Dialog open={panel === "trash"} onOpenChange={handlePanelOpenChange}>
        <DialogContent className="flex w-[calc(100vw-1rem)] flex-col overflow-hidden sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Lixeira</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Os itens permanecem aqui até você restaurá-los ou excluí-los definitivamente.
            </p>
          </DialogHeader>
          <Tabs
            value={trashTab}
            onValueChange={(value) => setTrashTab(value as TrashTab)}
            className="flex-1 min-h-0"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <TabsList className="grid grid-cols-3">
                <TabsTrigger value="leads">Leads ({trashedLeads.length})</TabsTrigger>
                <TabsTrigger value="tasks">Tarefas ({trashedTasks.length})</TabsTrigger>
                <TabsTrigger value="files">Arquivos ({trashedFiles.length})</TabsTrigger>
              </TabsList>
              <Button
                variant="destructive"
                size="sm"
                disabled={!activeTrashCount || saving}
                onClick={() => setClearTrashDialogOpen(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Esvaziar esta lixeira
              </Button>
            </div>
            <div
              className="mt-4 h-[52dvh] min-w-0 overflow-y-auto overflow-x-hidden pr-2"
              data-slot="trash-list"
            >
              <TabsContent value="leads" className="mt-0">
                <TrashListEmpty
                  show={!loading && trashedLeads.length === 0}
                  label="Nenhum lead na lixeira."
                />
                {trashedLeads.map((lead) => (
                  <TrashRow
                    key={lead.id}
                    title={lead.name}
                    description={`${lead.company ?? "Sem empresa"} · ${STAGE_LABEL[lead.stage] ?? lead.stage} · ${formatBRL(lead.estimated_value)}`}
                    deletedAt={formatDate(lead.deleted_at, true)}
                    onRestore={() => void restoreLead(lead.id)}
                    disabled={saving}
                    onDelete={() =>
                      setPendingDeletion({ type: "leads", id: lead.id, name: lead.name })
                    }
                  />
                ))}
              </TabsContent>
              <TabsContent value="tasks" className="mt-0">
                <TrashListEmpty
                  show={!loading && trashedTasks.length === 0}
                  label="Nenhuma tarefa na lixeira."
                />
                {trashedTasks.map((task) => (
                  <TrashRow
                    key={task.id}
                    title={task.title}
                    description={`${task.priority ? `Prioridade ${task.priority}` : "Sem prioridade"}${task.description ? ` · ${task.description}` : ""}`}
                    deletedAt={formatDate(task.deleted_at, true)}
                    onRestore={() => void restoreTask(task.id)}
                    disabled={saving}
                    onDelete={() =>
                      setPendingDeletion({ type: "tasks", id: task.id, name: task.title })
                    }
                  />
                ))}
              </TabsContent>
              <TabsContent value="files" className="mt-0">
                <TrashListEmpty
                  show={!loading && trashedFiles.length === 0}
                  label="Nenhum arquivo na lixeira."
                />
                {trashedFiles.map((file) => (
                  <TrashRow
                    key={file.id}
                    title={file.attachment.name}
                    description={`${file.owner_type === "lead" ? "Lead" : "Tarefa"}${file.attachment.size ? ` · ${formatFileSize(file.attachment.size)}` : ""}`}
                    deletedAt={formatDate(file.deleted_at, true)}
                    icon={<File className="h-4 w-4" />}
                    onRestore={() => void restoreFile(file.id)}
                    disabled={saving}
                    onDelete={() =>
                      setPendingDeletion({ type: "files", id: file.id, name: file.attachment.name })
                    }
                  />
                ))}
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      <Dialog open={panel === "preferences"} onOpenChange={handlePanelOpenChange}>
        <DialogContent className="overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Preferências</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <SettingSelect
              label="Tema"
              value={settings.theme}
              onValueChange={(value) =>
                setSettings((current) => ({ ...current, theme: value as ThemePreference }))
              }
            >
              <SelectItem value="system">Usar tema do sistema</SelectItem>
              <SelectItem value="light">Claro</SelectItem>
              <SelectItem value="dark">Escuro</SelectItem>
            </SettingSelect>
            <SettingSwitch
              label="Iniciar com a barra lateral recolhida"
              description="Economiza espaço horizontal nas telas do CRM."
              checked={settings.sidebar_collapsed}
              onCheckedChange={(checked) =>
                setSettings((current) => ({ ...current, sidebar_collapsed: checked }))
              }
            />
            <div className="border-t pt-5">
              <h3 className="text-sm font-semibold mb-1">Padrões do CRM</h3>
              <p className="text-xs text-muted-foreground mb-4">
                Valores iniciais usados ao criar novos registros.
              </p>
              <div className="space-y-4">
                <SettingSelect
                  label="Prioridade de novas tarefas"
                  value={settings.default_task_priority ?? "none"}
                  onValueChange={(value) =>
                    setSettings((current) => ({
                      ...current,
                      default_task_priority: value === "none" ? null : (value as TaskPriority),
                    }))
                  }
                >
                  <SelectItem value="none">Sem prioridade</SelectItem>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="media">Média</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="urgente">Urgente</SelectItem>
                </SettingSelect>
                <SettingSelect
                  label="Coluna padrão para novas tarefas"
                  value={settings.default_task_column_id ?? "first"}
                  onValueChange={(value) =>
                    setSettings((current) => ({
                      ...current,
                      default_task_column_id: value === "first" ? null : value,
                    }))
                  }
                >
                  <SelectItem value="first">Primeira coluna do quadro</SelectItem>
                  {columns.map((column) => (
                    <SelectItem key={column.id} value={column.id}>
                      {column.name}
                    </SelectItem>
                  ))}
                </SettingSelect>
                <SettingSelect
                  label="Etapa padrão para novos leads"
                  value={settings.default_lead_stage}
                  onValueChange={(value) =>
                    setSettings((current) => ({ ...current, default_lead_stage: value }))
                  }
                >
                  {Object.entries(STAGE_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SettingSelect>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => void saveSettings(settings)} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={panel === "notifications"} onOpenChange={handlePanelOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Notificações e lembretes</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Notificações neste dispositivo</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {pushStatusLabel(pushStatus)}
                  </p>
                </div>
                <Badge variant={pushStatus === "enabled" ? "default" : "outline"}>
                  {pushStatus === "enabled" ? "Ativas" : "Inativas"}
                </Badge>
              </div>
              {pushStatus === "ios-install-required" && (
                <div className="mt-3 rounded-md bg-muted p-3 text-xs text-muted-foreground">
                  No iPhone ou iPad, abra o menu Compartilhar, escolha “Adicionar à Tela de Início”,
                  abra o CRM pelo novo ícone e volte aqui para ativar.
                </div>
              )}
              <div className="flex flex-wrap gap-2 mt-4">
                {pushStatus === "enabled" ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={updatingPush}
                      onClick={() => void testPush()}
                    >
                      Enviar teste real
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={updatingPush}
                      onClick={() => void disablePush()}
                    >
                      Desativar neste dispositivo
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    disabled={
                      updatingPush ||
                      pushStatus === "unsupported" ||
                      pushStatus === "permission-denied" ||
                      pushStatus === "ios-install-required"
                    }
                    onClick={() => void enablePush()}
                  >
                    Ativar neste dispositivo
                  </Button>
                )}
              </div>
            </div>
            <SettingSwitch
              label="Notificações de tarefas"
              description="Permite os alertas configurados individualmente nas tarefas."
              checked={settings.notify_tasks}
              onCheckedChange={(checked) =>
                setSettings((current) => ({ ...current, notify_tasks: checked }))
              }
            />
            <SettingSwitch
              label="Notificações de leads"
              description="Permite alertas de follow-up configurados no Pipeline."
              checked={settings.notify_leads}
              onCheckedChange={(checked) =>
                setSettings((current) => ({ ...current, notify_leads: checked }))
              }
            />
          </div>
          <DialogFooter>
            <Button onClick={() => void saveSettings(settings)} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              Salvar preferências
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={panel === "backup"} onOpenChange={handlePanelOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Exportação e backup</DialogTitle>
          </DialogHeader>
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-muted p-2">
                <Download className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium">Backup completo em JSON</p>
                <p className="text-xs text-muted-foreground">
                  Inclui clientes, leads, financeiro, notas, tarefas, etiquetas e preferências.
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Os anexos não são incorporados ao arquivo; o backup contém apenas seus metadados e
              referências.
            </p>
            <Button className="w-full" onClick={() => void exportBackup()} disabled={exporting}>
              {exporting ? "Gerando backup..." : "Baixar backup agora"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={panel === "sessions"} onOpenChange={handlePanelOpenChange}>
        <DialogContent className="flex flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>Sessões e dispositivos</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Logins ativos consultados diretamente nas sessões do Supabase Auth.
            </p>
          </DialogHeader>
          <ScrollArea className="min-h-0 flex-1 pr-3">
            {loadingSessions ? (
              <p className="text-sm text-muted-foreground py-10 text-center">
                Carregando sessões...
              </p>
            ) : userSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-10 text-center">
                Nenhuma sessão ativa encontrada.
              </p>
            ) : (
              <div className="space-y-2">
                {userSessions.map((item) => {
                  const detected = getDeviceInfo(item.user_agent ?? "");
                  const type = item.device_type ?? detected.deviceType;
                  const name = item.device_name ?? detected.deviceName;
                  const browser = item.browser ?? detected.browser;
                  const operatingSystem = item.operating_system ?? detected.operatingSystem;
                  const lastSeen =
                    item.last_seen_at ?? item.refreshed_at ?? item.updated_at ?? item.created_at;
                  return (
                    <div
                      key={item.session_id}
                      className="rounded-lg border p-4 flex items-start gap-3"
                    >
                      <div className="rounded-lg bg-muted p-2.5 shrink-0">
                        <SessionDeviceIcon type={type} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{name}</p>
                          {item.is_current && <Badge>Sessão atual</Badge>}
                          {item.push_enabled && <Badge variant="outline">Push ativo</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {browser} · {operatingSystem}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Última atividade: {lastSeen ? formatDate(lastSeen, true) : "indisponível"}
                        </p>
                      </div>
                      {!item.is_current && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive shrink-0"
                          disabled={saving}
                          onClick={() => void revokeSession(item.session_id)}
                        >
                          Encerrar
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
          <DialogFooter className="shrink-0 border-t bg-popover pt-3">
            <Button
              variant="outline"
              onClick={() => void loadUserSessions()}
              disabled={loadingSessions}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loadingSessions ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Button
              variant="destructive"
              onClick={() => void signOutOtherSessions()}
              disabled={saving || userSessions.filter((item) => !item.is_current).length === 0}
            >
              Encerrar todas as outras
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingDeletion)}
        onOpenChange={(open) => !open && setPendingDeletion(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Excluir permanentemente?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            “{pendingDeletion?.name}” será excluído definitivamente. Esta ação não pode ser
            desfeita.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeletion(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={saving}
              onClick={() => pendingDeletion && void permanentlyDelete(pendingDeletion)}
            >
              Excluir definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={clearTrashDialogOpen} onOpenChange={setClearTrashDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Esvaziar esta lixeira?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Os {activeTrashCount} item(ns) da seção “
            {trashTab === "leads" ? "Leads" : trashTab === "tasks" ? "Tarefas" : "Arquivos"}” serão
            excluídos permanentemente.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearTrashDialogOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={saving} onClick={() => void emptyActiveTrash()}>
              Excluir tudo definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function pushStatusLabel(status: PushStatus): string {
  switch (status) {
    case "enabled":
      return "Este dispositivo está inscrito e pode receber avisos mesmo com o CRM fechado.";
    case "ios-install-required":
      return "No iPhone ou iPad, instale o CRM na Tela de Início para habilitar Web Push.";
    case "permission-denied":
      return "As notificações foram bloqueadas nas configurações deste navegador.";
    case "unsupported":
      return "Este navegador ou contexto não oferece suporte a Web Push.";
    default:
      return "Ative para receber avisos do sistema neste computador ou celular.";
  }
}

function SessionDeviceIcon({ type }: { type: "desktop" | "mobile" | "tablet" }) {
  if (type === "mobile") return <Smartphone className="h-5 w-5" />;
  if (type === "tablet") return <Tablet className="h-5 w-5" />;
  return <Laptop className="h-5 w-5" />;
}

function SettingsCard({
  icon,
  title,
  description,
  meta,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="min-h-40 h-full border-border p-4 shadow-none flex flex-col transition-colors hover:bg-muted/30">
        <div className="flex items-start justify-between">
          <div className="rounded-lg bg-muted p-2.5 [&>svg]:h-5 [&>svg]:w-5">{icon}</div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
        <h2 className="font-semibold mt-3">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
        {meta && <p className="text-xs text-muted-foreground mt-auto pt-3 truncate">{meta}</p>}
      </Card>
    </button>
  );
}

function TrashRow({
  title,
  description,
  deletedAt,
  icon,
  onRestore,
  onDelete,
  disabled,
}: {
  title: string;
  description: string;
  deletedAt: string;
  icon?: ReactNode;
  onRestore: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      data-slot="trash-row"
      className="mb-2 grid min-w-0 gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="shrink-0 rounded-md bg-muted p-2">{icon}</div>}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={title}>
            {title}
          </p>
          <p className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">
            {description}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">Movido em {deletedAt}</p>
        </div>
      </div>
      <div className="flex gap-2 sm:shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 sm:flex-none"
          onClick={onRestore}
          disabled={disabled}
          aria-label={`Restaurar ${title}`}
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          Restaurar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 sm:flex-none text-destructive hover:text-destructive"
          onClick={onDelete}
          disabled={disabled}
          aria-label={`Excluir permanentemente ${title}`}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
          Excluir
        </Button>
      </div>
    </div>
  );
}

function TrashListEmpty({ show, label }: { show: boolean; label: string }) {
  return show ? <p className="text-sm text-muted-foreground text-center py-12">{label}</p> : null;
}

function SettingSelect({
  label,
  value,
  onValueChange,
  children,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}

function SettingSwitch({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="rounded-lg border p-4 flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
