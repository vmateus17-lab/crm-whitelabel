import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type DeviceType = "desktop" | "mobile" | "tablet";

export interface DeviceInfo {
  deviceName: string;
  browser: string;
  operatingSystem: string;
  deviceType: DeviceType;
  userAgent: string;
}

interface JwtPayload {
  session_id?: string;
}

function decodeJwtPayload(accessToken: string): JwtPayload | null {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as JwtPayload;
  } catch {
    return null;
  }
}

export function getSessionId(session: Session | null): string | null {
  if (!session?.access_token) return null;
  const sessionId = decodeJwtPayload(session.access_token)?.session_id;
  return typeof sessionId === "string" ? sessionId : null;
}

export function getDeviceInfo(
  userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "",
): DeviceInfo {
  const isIPad =
    /iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && /Mobile/i.test(userAgent));
  const isIPhone = /iPhone|iPod/i.test(userAgent);
  const isAndroid = /Android/i.test(userAgent);
  const isTablet = isIPad || (isAndroid && !/Mobile/i.test(userAgent));
  const isMobile = isIPhone || (isAndroid && /Mobile/i.test(userAgent));

  let operatingSystem = "Sistema desconhecido";
  if (isIPhone) operatingSystem = "iOS";
  else if (isIPad) operatingSystem = "iPadOS";
  else if (isAndroid) operatingSystem = "Android";
  else if (/Windows NT/i.test(userAgent)) operatingSystem = "Windows";
  else if (/Mac OS X|Macintosh/i.test(userAgent)) operatingSystem = "macOS";
  else if (/Linux/i.test(userAgent)) operatingSystem = "Linux";

  let browser = "Navegador";
  if (/Edg\//i.test(userAgent)) browser = "Microsoft Edge";
  else if (/OPR\//i.test(userAgent)) browser = "Opera";
  else if (/CriOS\//i.test(userAgent)) browser = "Google Chrome";
  else if (/FxiOS\//i.test(userAgent)) browser = "Mozilla Firefox";
  else if (/Chrome\//i.test(userAgent)) browser = "Google Chrome";
  else if (/Firefox\//i.test(userAgent)) browser = "Mozilla Firefox";
  else if (/Safari\//i.test(userAgent)) browser = "Safari";

  const deviceType: DeviceType = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";
  const deviceLabel = isIPhone
    ? "iPhone"
    : isIPad
      ? "iPad"
      : isAndroid
        ? isTablet
          ? "Tablet Android"
          : "Celular Android"
        : operatingSystem;

  return {
    deviceName: `${deviceLabel} · ${browser}`,
    browser,
    operatingSystem,
    deviceType,
    userAgent: userAgent || "User agent indisponível",
  };
}

export async function registerCurrentDeviceSession(
  session: Session | null,
): Promise<string | null> {
  const sessionId = getSessionId(session);
  if (!sessionId) return null;
  const device = getDeviceInfo();
  const { error } = await supabase.rpc("register_device_session", {
    p_session_id: sessionId,
    p_device_name: device.deviceName,
    p_browser: device.browser,
    p_operating_system: device.operatingSystem,
    p_device_type: device.deviceType,
    p_user_agent: device.userAgent,
  });
  if (error) throw error;
  return sessionId;
}
