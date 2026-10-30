import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceInfo, getSessionId, registerCurrentDeviceSession } from "@/lib/device-sessions";

export type PushStatus =
  | "unsupported"
  | "ios-install-required"
  | "permission-denied"
  | "available"
  | "enabled";

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const bytes = Uint8Array.from([...rawData].map((character) => character.charCodeAt(0)));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  return registration;
}

async function getVapidPublicKey(): Promise<string> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!supabaseUrl) throw new Error("URL do Supabase não configurada.");
  const response = await fetch(`${supabaseUrl}/functions/v1/send-task-notifications/public-key`);
  if (!response.ok) throw new Error("Não foi possível obter a chave pública de notificações.");
  const data = (await response.json()) as { publicKey?: string };
  if (!data.publicKey) throw new Error("Chave pública de notificações indisponível.");
  return data.publicKey;
}

export async function getPushStatus(): Promise<PushStatus> {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return "unsupported";
  }
  if (isIOS() && !isStandalone()) return "ios-install-required";
  if (Notification.permission === "denied") return "permission-denied";

  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? "enabled" : "available";
}

export async function enablePushNotifications(session: Session | null): Promise<void> {
  if ((await getPushStatus()) === "ios-install-required") {
    throw new Error("No iPhone ou iPad, adicione o CRM à Tela de Início antes de ativar.");
  }
  if (!("Notification" in window)) throw new Error("Este navegador não oferece notificações.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("A permissão de notificações não foi concedida.");

  const sessionId = getSessionId(session) ?? (await registerCurrentDeviceSession(session));
  if (!sessionId) throw new Error("Não foi possível identificar a sessão atual.");
  await registerCurrentDeviceSession(session);

  const registration = await getServiceWorkerRegistration();
  const existingSubscription = await registration.pushManager.getSubscription();
  const subscription =
    existingSubscription ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToArrayBuffer(await getVapidPublicKey()),
    }));
  const subscriptionJson = subscription.toJSON();
  if (
    !subscriptionJson.endpoint ||
    !subscriptionJson.keys?.p256dh ||
    !subscriptionJson.keys?.auth
  ) {
    throw new Error("O navegador retornou uma assinatura incompleta.");
  }

  const { error } = await supabase.rpc("upsert_web_push_subscription", {
    p_session_id: sessionId,
    p_endpoint: subscriptionJson.endpoint,
    p_p256dh: subscriptionJson.keys.p256dh,
    p_auth_key: subscriptionJson.keys.auth,
    p_device_name: getDeviceInfo().deviceName,
  });
  if (error) {
    await subscription.unsubscribe();
    throw error;
  }
}

export async function disablePushNotifications(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  const { error } = await supabase.rpc("delete_web_push_subscription", { p_endpoint: endpoint });
  await subscription.unsubscribe();
  if (error) throw error;
}

interface PushTestResponse {
  delivered?: number;
  code?: string;
  error?: string;
  providerStatus?: number;
}

class PushTestError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "PushTestError";
  }
}

function pushTestMessage(payload: PushTestResponse): string {
  switch (payload.code) {
    case "subscription_not_registered":
      return "A assinatura deste dispositivo estava desatualizada.";
    case "push_provider_rejected":
      return payload.providerStatus
        ? `O serviço de push recusou a entrega (código ${payload.providerStatus}).`
        : "O serviço de push recusou a entrega.";
    case "notification_service_not_configured":
      return "O serviço de notificações ainda não está configurado no servidor.";
    default:
      return payload.error || "O serviço não confirmou a entrega da notificação.";
  }
}

async function parseFunctionError(error: unknown): Promise<PushTestResponse> {
  if (
    error &&
    typeof error === "object" &&
    "context" in error &&
    (error as { context?: unknown }).context instanceof Response
  ) {
    try {
      return (await (error as { context: Response }).context.clone().json()) as PushTestResponse;
    } catch {
      // Fall through to the generic error message.
    }
  }
  return {
    error: error instanceof Error ? error.message : "Falha ao chamar o serviço de notificações.",
  };
}

async function invokePushTest(): Promise<void> {
  const { data, error } = await supabase.functions.invoke("send-task-notifications", {
    body: { mode: "test" },
  });
  if (error) {
    const payload = await parseFunctionError(error);
    throw new PushTestError(pushTestMessage(payload), payload.code || "function_error");
  }
  const payload = (data ?? {}) as PushTestResponse;
  if (!payload.delivered) {
    throw new PushTestError(pushTestMessage(payload), payload.code || "delivery_failed");
  }
}

async function renewPushSubscription(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  try {
    await disablePushNotifications();
  } catch {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  }
  await enablePushNotifications(data.session);
}

export async function sendPushTestNotification(): Promise<void> {
  try {
    await invokePushTest();
  } catch (error) {
    const recoverable =
      error instanceof PushTestError &&
      ["subscription_not_registered", "push_provider_rejected", "delivery_failed"].includes(
        error.code,
      );
    if (!recoverable) throw error;

    await renewPushSubscription();
    try {
      await invokePushTest();
    } catch (retryError) {
      const reason = retryError instanceof Error ? retryError.message : "motivo desconhecido";
      throw new Error(`A assinatura foi renovada, mas o teste ainda falhou: ${reason}`, {
        cause: retryError,
      });
    }
  }
}
