import { createClient } from "npm:@supabase/supabase-js@2.105.1";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const vapidPublicKey = Deno.env.get("WEB_PUSH_PUBLIC_KEY") ?? "";
const vapidPrivateKey = Deno.env.get("WEB_PUSH_PRIVATE_KEY") ?? "";
const vapidSubject = Deno.env.get("WEB_PUSH_SUBJECT") ?? "";
const cronSecret = Deno.env.get("PUSH_CRON_SECRET") ?? "";
const DELIVERY_WINDOW_MS = 5 * 60 * 1000;
const MAX_REMINDER_OFFSET_MINUTES = 1440;
const ALLOWED_REMINDER_OFFSETS = new Set([1440, 720, 360, 60, 30, 0]);

if (vapidPublicKey && vapidPrivateKey && vapidSubject) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface PushSubscriptionRow {
  id: string;
  user_id: string;
  session_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

interface TaskRow {
  id: string;
  user_id: string;
  title: string;
  due_date: string;
  reminder_offsets_minutes: number[];
}

interface LeadRow {
  id: string;
  user_id: string;
  name: string;
  follow_up_at: string;
  reminder_offsets_minutes: number[];
}

interface ReminderRow {
  id: string;
  user_id: string;
  content: string;
}

interface UserSettingRow {
  user_id: string;
  notify_tasks: boolean;
  notify_leads: boolean;
}

interface PushMessage {
  key: string;
  title: string;
  body: string;
  tag: string;
  url: string;
  ttl?: number;
}

interface DeliveryResult {
  delivered: boolean;
  providerStatus: number;
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

function formatSaoPauloDateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function offsetLabel(offset: number): string {
  switch (offset) {
    case 1440:
      return "1 dia";
    case 720:
      return "12 horas";
    case 360:
      return "6 horas";
    case 60:
      return "1 hora";
    case 30:
      return "30 minutos";
    default:
      return "agora";
  }
}

function normalizeOffsets(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is number => typeof item === "number" && ALLOWED_REMINDER_OFFSETS.has(item),
      ),
    ),
  ];
}

function subscriptionForWebPush(subscription: PushSubscriptionRow) {
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
  };
}

async function reserveDelivery(
  subscription: PushSubscriptionRow,
  message: PushMessage,
): Promise<boolean> {
  const { error } = await admin.from("push_notification_deliveries").insert({
    user_id: subscription.user_id,
    subscription_id: subscription.id,
    notification_key: message.key,
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw error;
}

async function sendMessage(
  subscription: PushSubscriptionRow,
  message: PushMessage,
): Promise<DeliveryResult> {
  const reserved = await reserveDelivery(subscription, message);
  if (!reserved) return { delivered: false, providerStatus: 0 };

  try {
    await webpush.sendNotification(
      subscriptionForWebPush(subscription),
      JSON.stringify({
        title: message.title,
        body: message.body,
        tag: message.tag,
        url: message.url,
      }),
      {
        TTL: message.ttl ?? 60 * 60,
        urgency: "high",
        topic: message.tag.slice(0, 32),
      },
    );
    return { delivered: true, providerStatus: 201 };
  } catch (error) {
    const providerStatus =
      typeof error === "object" && error && "statusCode" in error
        ? Number((error as { statusCode?: number }).statusCode)
        : 0;
    if (providerStatus === 404 || providerStatus === 410) {
      await admin
        .from("web_push_subscriptions")
        .update({ active: false })
        .eq("id", subscription.id);
    } else {
      await admin
        .from("push_notification_deliveries")
        .delete()
        .eq("subscription_id", subscription.id)
        .eq("notification_key", message.key);
    }
    console.error("Web Push delivery failed", {
      subscriptionId: subscription.id,
      providerStatus,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { delivered: false, providerStatus };
  }
}

async function authenticatedUserAndSession(
  request: Request,
): Promise<{ userId: string; sessionId: string } | { response: Response }> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return {
      response: jsonResponse(
        { code: "authentication_required", error: "Authentication required" },
        401,
      ),
    };
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) {
    return { response: jsonResponse({ code: "invalid_session", error: "Invalid session" }, 401) };
  }

  try {
    const token = authorization.slice("Bearer ".length);
    const encoded = token.split(".")[1] ?? "";
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
    if (typeof payload.session_id !== "string") throw new Error("Missing session id");
    return { userId: data.user.id, sessionId: payload.session_id };
  } catch {
    return {
      response: jsonResponse({ code: "invalid_session", error: "Invalid session token" }, 401),
    };
  }
}

async function sendTestNotification(request: Request): Promise<Response> {
  const authenticated = await authenticatedUserAndSession(request);
  if ("response" in authenticated) return authenticated.response;

  const { data: subscriptions, error } = await admin
    .from("web_push_subscriptions")
    .select("id, user_id, session_id, endpoint, p256dh, auth_key")
    .eq("user_id", authenticated.userId)
    .eq("session_id", authenticated.sessionId)
    .eq("active", true);
  if (error) return jsonResponse({ code: "database_error", error: error.message }, 500);
  if (!subscriptions?.length) {
    return jsonResponse(
      {
        delivered: 0,
        code: "subscription_not_registered",
        error: "No active subscription for this device",
      },
      409,
    );
  }

  const results = await Promise.all(
    (subscriptions as PushSubscriptionRow[]).map((subscription) =>
      sendMessage(subscription, {
        key: `test:${crypto.randomUUID()}`,
        title: "CRM",
        body: "A notificação push chegou corretamente neste dispositivo.",
        tag: `crm-test-${Date.now()}`,
        url: "/configuracoes",
        ttl: 60,
      }),
    ),
  );
  const delivered = results.filter((result) => result.delivered).length;
  if (!delivered) {
    return jsonResponse(
      {
        delivered: 0,
        code: "push_provider_rejected",
        error: "The push provider rejected the notification",
        providerStatus: results.find((result) => result.providerStatus)?.providerStatus ?? 0,
      },
      502,
    );
  }
  return jsonResponse({ delivered });
}

function isInsideDeliveryWindow(scheduledAt: number, now: number): boolean {
  return scheduledAt <= now && scheduledAt > now - DELIVERY_WINDOW_MS;
}

function taskMessages(task: TaskRow, now: number): PushMessage[] {
  const dueAt = new Date(task.due_date).getTime();
  if (!Number.isFinite(dueAt)) return [];
  return normalizeOffsets(task.reminder_offsets_minutes)
    .filter((offset) => isInsideDeliveryWindow(dueAt - offset * 60_000, now))
    .map((offset) => ({
      key: `task:${task.id}:${task.due_date}:${offset}`,
      title: offset === 0 ? "Tarefa para agora" : `Tarefa em ${offsetLabel(offset)}`,
      body: `"${task.title}" está marcada para ${formatSaoPauloDateTime(task.due_date)}.`,
      tag: `task-${task.id}-${offset}`,
      url: "/tarefas",
    }));
}

function leadMessages(lead: LeadRow, now: number): PushMessage[] {
  const followUpAt = new Date(lead.follow_up_at).getTime();
  if (!Number.isFinite(followUpAt)) return [];
  return normalizeOffsets(lead.reminder_offsets_minutes)
    .filter((offset) => isInsideDeliveryWindow(followUpAt - offset * 60_000, now))
    .map((offset) => ({
      key: `lead:${lead.id}:${lead.follow_up_at}:${offset}`,
      title: offset === 0 ? "Follow-up para agora" : `Follow-up em ${offsetLabel(offset)}`,
      body: `Próximo contato com "${lead.name}" em ${formatSaoPauloDateTime(lead.follow_up_at)}.`,
      tag: `lead-${lead.id}-${offset}`,
      url: "/pipeline",
    }));
}

function reminderMessages(reminder: ReminderRow, now: number): PushMessage[] {
  const prefix = "__crm_reminder_v1__";
  if (!reminder.content.startsWith(prefix)) return [];
  let payload: { content?: unknown; due_date?: unknown; reminder_offsets_minutes?: unknown };
  try {
    payload = JSON.parse(reminder.content.slice(prefix.length));
  } catch {
    return [];
  }
  if (typeof payload.due_date !== "string" || typeof payload.content !== "string") return [];
  const dueAt = new Date(payload.due_date).getTime();
  if (!Number.isFinite(dueAt)) return [];
  return normalizeOffsets(payload.reminder_offsets_minutes)
    .filter((offset) => isInsideDeliveryWindow(dueAt - offset * 60_000, now))
    .map((offset) => ({
      key: `reminder:${reminder.id}:${payload.due_date}:${offset}`,
      title: offset === 0 ? "Lembrete para agora" : `Lembrete em ${offsetLabel(offset)}`,
      body: `“${payload.content}” está marcado para ${formatSaoPauloDateTime(payload.due_date)}.`,
      tag: `reminder-${reminder.id}-${offset}`,
      url: "/lembretes",
    }));
}

async function sendScheduledNotifications(): Promise<Response> {
  const now = Date.now();
  const lowerBound = new Date(now - DELIVERY_WINDOW_MS).toISOString();
  const upperBound = new Date(now + MAX_REMINDER_OFFSET_MINUTES * 60_000).toISOString();
  const [
    { data: settings, error: settingsError },
    { data: subscriptions, error: subscriptionsError },
    { data: tasks, error: tasksError },
    { data: leads, error: leadsError },
    { data: reminders, error: remindersError },
  ] = await Promise.all([
    admin
      .from("user_settings")
      .select("user_id, notify_tasks, notify_leads")
      .or("notify_tasks.eq.true,notify_leads.eq.true"),
    admin
      .from("web_push_subscriptions")
      .select("id, user_id, session_id, endpoint, p256dh, auth_key")
      .eq("active", true),
    admin
      .from("task_cards")
      .select("id, user_id, title, due_date, reminder_offsets_minutes")
      .eq("completed", false)
      .eq("due_has_time", true)
      .is("deleted_at", null)
      .not("due_date", "is", null)
      .gte("due_date", lowerBound)
      .lte("due_date", upperBound),
    admin
      .from("leads")
      .select("id, user_id, name, follow_up_at, reminder_offsets_minutes")
      .eq("follow_up_has_time", true)
      .is("deleted_at", null)
      .not("stage", "in", "(ganho,perdido)")
      .not("follow_up_at", "is", null)
      .gte("follow_up_at", lowerBound)
      .lte("follow_up_at", upperBound),
    admin
      .from("todos")
      .select("id, user_id, content")
      .eq("done", false)
      .like("content", `${"__crm_reminder_v1__"}%`),
  ]);

  const queryError =
    settingsError ?? subscriptionsError ?? tasksError ?? leadsError ?? remindersError;
  if (queryError) return jsonResponse({ code: "database_error", error: queryError.message }, 500);

  const settingsByUser = new Map(
    ((settings ?? []) as UserSettingRow[]).map((item) => [item.user_id, item]),
  );
  const tasksByUser = new Map<string, TaskRow[]>();
  for (const task of (tasks ?? []) as TaskRow[]) {
    tasksByUser.set(task.user_id, [...(tasksByUser.get(task.user_id) ?? []), task]);
  }
  const leadsByUser = new Map<string, LeadRow[]>();
  for (const lead of (leads ?? []) as LeadRow[]) {
    leadsByUser.set(lead.user_id, [...(leadsByUser.get(lead.user_id) ?? []), lead]);
  }
  const remindersByUser = new Map<string, ReminderRow[]>();
  for (const reminder of (reminders ?? []) as ReminderRow[]) {
    remindersByUser.set(reminder.user_id, [
      ...(remindersByUser.get(reminder.user_id) ?? []),
      reminder,
    ]);
  }

  let delivered = 0;
  for (const subscription of (subscriptions ?? []) as PushSubscriptionRow[]) {
    const userSettings = settingsByUser.get(subscription.user_id);
    if (!userSettings) continue;
    const messages = [
      ...(userSettings.notify_tasks
        ? (tasksByUser.get(subscription.user_id) ?? []).flatMap((task) => taskMessages(task, now))
        : []),
      ...(userSettings.notify_tasks
        ? (remindersByUser.get(subscription.user_id) ?? []).flatMap((reminder) =>
            reminderMessages(reminder, now),
          )
        : []),
      ...(userSettings.notify_leads
        ? (leadsByUser.get(subscription.user_id) ?? []).flatMap((lead) => leadMessages(lead, now))
        : []),
    ];
    for (const message of messages) {
      if ((await sendMessage(subscription, message)).delivered) delivered++;
    }
  }

  return jsonResponse({
    delivered,
    checkedAt: new Date(now).toISOString(),
    taskCandidates: tasks?.length ?? 0,
    leadCandidates: leads?.length ?? 0,
    reminderCandidates: reminders?.length ?? 0,
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname.endsWith("/public-key")) {
    return vapidPublicKey
      ? jsonResponse({ publicKey: vapidPublicKey })
      : jsonResponse(
          { code: "notification_service_not_configured", error: "Web Push is not configured" },
          503,
        );
  }

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      {
        code: "notification_service_not_configured",
        error: "Notification service is not configured",
      },
      503,
    );
  }

  if (request.method === "POST") {
    const body = (await request
      .clone()
      .json()
      .catch(() => ({}))) as { mode?: string };
    if (body.mode === "test") return sendTestNotification(request);
    if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
      return jsonResponse(
        { code: "invalid_scheduler_secret", error: "Invalid scheduler secret" },
        401,
      );
    }
    return sendScheduledNotifications();
  }
  return jsonResponse({ code: "method_not_allowed", error: "Method not allowed" }, 405);
});
