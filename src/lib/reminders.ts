export const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

export const REMINDER_OPTIONS = [
  { value: 1440, label: "1 dia antes" },
  { value: 720, label: "12h antes" },
  { value: 360, label: "6h antes" },
  { value: 60, label: "1h antes" },
  { value: 30, label: "30min antes" },
  { value: 0, label: "No horário" },
] as const;

export type ReminderOffsetMinutes = (typeof REMINDER_OPTIONS)[number]["value"];

const ALLOWED_REMINDER_OFFSETS = new Set<number>(REMINDER_OPTIONS.map((option) => option.value));

export function normalizeReminderOffsets(value: unknown): ReminderOffsetMinutes[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (offset): offset is ReminderOffsetMinutes =>
          typeof offset === "number" && ALLOWED_REMINDER_OFFSETS.has(offset),
      ),
    ),
  ].sort((a, b) => b - a);
}

function getSaoPauloOffsetMinutes(date: Date): number {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: SAO_PAULO_TIME_ZONE,
    timeZoneName: "longOffset",
  })
    .formatToParts(date)
    .find((item) => item.type === "timeZoneName")?.value;
  const match = part?.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return -180;
  const sign = match[1] === "+" ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

export function toSaoPauloTimestamp(dateValue: string, timeValue?: string): string | null {
  if (!dateValue) return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = (timeValue || "23:59").split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;

  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offsetMinutes = getSaoPauloOffsetMinutes(new Date(wallClockAsUtc));
  return new Date(wallClockAsUtc - offsetMinutes * 60_000).toISOString();
}

export function toSaoPauloInputParts(value: string | null | undefined): {
  date: string;
  time: string;
} {
  if (!value) return { date: "", time: "" };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: "", time: "" };

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SAO_PAULO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsed);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

export function formatSaoPauloDateTime(
  value: string,
  includeTime: boolean,
  options: { compact?: boolean } = {},
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SAO_PAULO_TIME_ZONE,
    day: "2-digit",
    month: options.compact ? "short" : "2-digit",
    ...(options.compact ? {} : { year: "numeric" }),
    ...(includeTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}),
  }).format(date);
}
